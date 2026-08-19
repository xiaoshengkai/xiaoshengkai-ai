import fs from "node:fs";
import path from "node:path";
import { getDurationSec } from "./tts.js";
import { ERRORS } from "./errors.js";
import { sleep } from "../../../../shared/utils.js";
import { generateBGM as sharedGenerateBGM } from "../../../../shared/llm/index.js";

export async function generateBGM(scriptJson, executionDir, bgmFilePath) {
  const startTime = Date.now();
  const outPath = path.join(executionDir, "bgm.mp3");

  // 用户上传了 BGM 文件
  if (bgmFilePath && fs.existsSync(bgmFilePath)) {
    fs.copyFileSync(bgmFilePath, outPath);
    const dur = await getDurationSec(outPath);
    console.log(`[bgm] 使用上传文件 (${dur.toFixed(2)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
    return { bgmFile: outPath, duration: dur, "bgm.mp3": path.basename(outPath) };
  }

  if (fs.existsSync(outPath)) {
    try {
      const dur = await getDurationSec(outPath);
      console.log(`[bgm] 复用 (${dur.toFixed(2)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return { bgmFile: outPath, duration: dur, "bgm.mp3": path.basename(outPath) };
    } catch { /* 文件损坏，重新生成 */ }
  }

  let bgmPrompt = "轻快电子";
  if (scriptJson) {
    try {
      const script = typeof scriptJson === "string" ? JSON.parse(scriptJson) : scriptJson;
      bgmPrompt = script.bgm_prompt || "轻快电子";
    } catch { /* use default */ }
  }

  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await sharedGenerateBGM({ prompt: bgmPrompt, outputPath: outPath });

      const dur = await getDurationSec(outPath);
      console.log(`[bgm] 完成 (${dur.toFixed(2)}s, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
      return { bgmFile: outPath, duration: dur, "bgm.mp3": path.basename(outPath) };
    } catch (e) {
      if (attempt < maxRetries - 1) {
        console.log(`[bgm] 重试 ${attempt + 1}/${maxRetries}`);
        await sleep(2000);
      } else {
        throw ERRORS.BGM_FAILED(e.message);
      }
    }
  }
}
