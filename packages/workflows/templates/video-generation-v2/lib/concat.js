import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { getDurationSec } from "./tts.js";
import { ERRORS } from "./errors.js";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} failed (exit ${code}): ${err.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

async function concatVideos(clipPaths, outPath) {
  if (clipPaths.length === 0) throw new Error("concatVideos: empty clipPaths");
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outPath);
    return;
  }
  const listPath = path.join(path.dirname(outPath), "concat-list.txt");
  const body = clipPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, body, "utf8");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  fs.unlinkSync(listPath);
}

async function muxAudioOntoVideo(videoPath, audioPath, outPath) {
  await run("ffmpeg", [
    "-y", "-i", videoPath, "-i", audioPath,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    outPath,
  ]);
}

async function mixBgmAtLowVolume(voicePath, bgmPath, outPath, volume = 0.2) {
  if (!fs.existsSync(bgmPath)) {
    fs.copyFileSync(voicePath, outPath);
    return;
  }
  await run("ffmpeg", [
    "-y", "-i", voicePath, "-i", bgmPath,
    "-filter_complex",
    `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[v];` +
    `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,volume=${volume}[b];` +
    `[v][b]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
    "-map", "[out]",
    "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100",
    outPath,
  ]);
}

async function mixSfxOntoVoice(voicePath, sfxList, outPath) {
  if (!sfxList || sfxList.length === 0) {
    fs.copyFileSync(voicePath, outPath);
    return;
  }

  const args = ["-y", "-i", voicePath];
  const filterParts = [];
  const sfxLabels = [];

  sfxList.forEach((s, i) => {
    if (!s.path || !fs.existsSync(s.path)) return;
    args.push("-i", s.path);
    const inputIdx = i + 1;
    const delayMs = Math.max(0, Math.round((s.startAt || 0) * 1000));
    filterParts.push(
      `[${inputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,` +
      `adelay=${delayMs}|${delayMs},volume=${s.volume || 0.3}[sfx${i}]`
    );
    sfxLabels.push(`[sfx${i}]`);
  });

  if (sfxLabels.length === 0) {
    fs.copyFileSync(voicePath, outPath);
    return;
  }

  // Mix all SFX → mix with voice
  if (sfxLabels.length === 1) {
    filterParts.push(
      `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[v];` +
      `${sfxLabels[0]}[v]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`
    );
  } else {
    filterParts.push(
      `${sfxLabels.join("")}amix=inputs=${sfxLabels.length}:dropout_transition=0:normalize=0[sfxall];` +
      `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[v];` +
      `[v][sfxall]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`
    );
  }

  args.push("-filter_complex", filterParts.join(";"), "-map", "[out]",
    "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", outPath);

  await run("ffmpeg", args);
}

export async function concatFinalVideo(scriptJson, executionDir) {
  let script;
  if (typeof scriptJson === "string") {
    try { script = JSON.parse(scriptJson); } catch { throw ERRORS.SCRIPT_INVALID_JSON("解析失败"); }
  } else {
    script = scriptJson;
  }

  const clipsDir = path.join(executionDir, "clips");
  const voiceDir = path.join(executionDir, "voice");
  const bgmPath = path.join(executionDir, "bgm.mp3");
  const sfxManifest = path.join(executionDir, "sfx", "manifest.json");

  const clipPaths = [];
  const sceneAudioPaths = [];

  for (const scene of script.scenes) {
    const clipPath = path.join(clipsDir, `scene-${scene.id}.mp4`);
    if (fs.existsSync(clipPath)) clipPaths.push(clipPath);
    const audioPath = path.join(voiceDir, `scene-${scene.id}.mp3`);
    if (fs.existsSync(audioPath)) sceneAudioPaths.push(audioPath);
  }

  if (clipPaths.length === 0) {
    throw ERRORS.CONCAT_NO_CLIPS();
  }

  const steps = [];
  const startTime = Date.now();

  // Step 1: concat videos → video-silent.mp4
  const step1Start = Date.now();
  console.log("[concat] 1/5 拼接视频片段...");
  const silentVideo = path.join(executionDir, "video-silent.mp4");
  await concatVideos(clipPaths, silentVideo);
  const silentSize = fs.statSync(silentVideo).size;
  console.log(`[concat] 1/5 完成 (${((Date.now() - step1Start) / 1000).toFixed(1)}s)`);
  steps.push({ name: "concatVideos", durationSec: (Date.now() - startTime) / 1000, fileSize: silentSize, command: "ffmpeg concat" });

  // Step 2: concat scene audio
  const step2Start = Date.now();
  console.log("[concat] 2/5 拼接音频...");
  const voiceRaw = path.join(executionDir, "voice-raw.mp3");
  if (sceneAudioPaths.length === 0) {
    console.log("[concat] 2/5 无音频文件，跳过");
  } else if (sceneAudioPaths.length === 1) {
    fs.copyFileSync(sceneAudioPaths[0], voiceRaw);
  } else if (sceneAudioPaths.length > 1) {
    const args = ["-y"];
    const filterParts = [];
    const labels = [];
    sceneAudioPaths.forEach((p, i) => {
      args.push("-i", p);
      filterParts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono[a${i}]`);
      labels.push(`[a${i}]`);
    });
    filterParts.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`);
    args.push("-filter_complex", filterParts.join(";"), "-map", "[out]",
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", voiceRaw);
    await run("ffmpeg", args);
  }
  if (fs.existsSync(voiceRaw)) {
    const voiceRawDuration = await getDurationSec(voiceRaw);
    console.log(`[concat] 2/5 完成 (${((Date.now() - step2Start) / 1000).toFixed(1)}s)`);
    steps.push({ name: "concatVoice", durationSec: voiceRawDuration, fileSize: fs.statSync(voiceRaw).size, command: "ffmpeg concat filter" });
  }

  // Step 3: mix SFX onto voice
  const step3Start = Date.now();
  console.log("[concat] 3/5 混入音效...");
  let sfxList = [];
  if (fs.existsSync(sfxManifest)) {
    const raw = JSON.parse(fs.readFileSync(sfxManifest, "utf-8"));
    sfxList = (Array.isArray(raw) ? raw : []).filter((r) => r.sfx && r.sfx.path);
  }
  const voiceWithSfx = path.join(executionDir, "voice-with-sfx.mp3");
  if (fs.existsSync(voiceRaw)) {
    await mixSfxOntoVoice(voiceRaw, sfxList, voiceWithSfx);
    console.log(`[concat] 3/5 完成 (${((Date.now() - step3Start) / 1000).toFixed(1)}s)`);
    steps.push({ name: "mixSfx", durationSec: await getDurationSec(voiceWithSfx), fileSize: fs.statSync(voiceWithSfx).size, command: "ffmpeg amix" });
  } else {
    console.log("[concat] 3/5 无音频，跳过");
  }

  // Step 4: mix BGM at low volume
  const step4Start = Date.now();
  console.log("[concat] 4/5 混入背景音乐...");
  const voiceFinal = path.join(executionDir, "voice-final.mp3");
  if (fs.existsSync(voiceWithSfx)) {
    await mixBgmAtLowVolume(voiceWithSfx, bgmPath, voiceFinal, 0.2);
    console.log(`[concat] 4/5 完成 (${((Date.now() - step4Start) / 1000).toFixed(1)}s)`);
    steps.push({ name: "mixBgm", durationSec: await getDurationSec(voiceFinal), fileSize: fs.statSync(voiceFinal).size, command: "ffmpeg amix" });
  } else {
    console.log("[concat] 4/5 无音频，跳过");
  }

  // Step 5: mux audio onto video
  const step5Start = Date.now();
  console.log("[concat] 5/5 合成最终视频...");
  const videoPath = path.join(executionDir, "video.mp4");
  if (fs.existsSync(voiceFinal)) {
    await muxAudioOntoVideo(silentVideo, voiceFinal, videoPath);
  } else {
    fs.copyFileSync(silentVideo, videoPath);
  }
  const videoSize = fs.statSync(videoPath).size;
  const videoDuration = await getDurationSec(videoPath);
  console.log(`[concat] 5/5 完成 (${((Date.now() - step5Start) / 1000).toFixed(1)}s)`);
  steps.push({ name: "mux", durationSec: videoDuration, fileSize: videoSize, command: "ffmpeg mux" });

  console.log(`[concat] 全部完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s total)`);

  // 生成 SRT
  console.log("[concat] 生成 SRT 字幕...");
  const srtPath = path.join(executionDir, "video.srt");
  generateSRT(script, executionDir, srtPath);

  // 写 concat manifest
  const manifest = { steps, totalDurationSec: videoDuration, totalSize: videoSize };
  fs.writeFileSync(path.join(executionDir, "concat-manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    videoFile: videoPath,
    srtFile: srtPath,
    output: `合成完成: ${videoDuration.toFixed(1)}s, ${(videoSize / 1024 / 1024).toFixed(1)}MB`,
    manifest,
    "video.mp4": path.basename(videoPath),
  };
}

function generateSRT(script, executionDir, outPath) {
  const durationsPath = path.join(executionDir, "voice", "durations.json");
  let durations = {};
  if (fs.existsSync(durationsPath)) {
    durations = JSON.parse(fs.readFileSync(durationsPath, "utf-8"));
  }

  let cursor = 0;
  const entries = [];
  script.scenes.forEach((scene, i) => {
    const dur = durations[scene.id] || 5;
    const start = cursor;
    const end = cursor + dur;
    entries.push({
      index: i + 1,
      start: start,
      end: end,
      text: scene.narration,
    });
    cursor += dur + 0.3;
  });

  const srt = entries.map((e) => {
    const fmt = (sec) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };
    return `${e.index}\n${fmt(e.start)} --> ${fmt(e.end)}\n${e.text}\n`;
  }).join("\n");

  fs.writeFileSync(outPath, srt);
}