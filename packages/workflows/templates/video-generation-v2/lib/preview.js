import fs from "node:fs";
import path from "node:path";
import { escHtml } from "../utils.js";
import { ERRORS } from "./errors.js";

const ANIMATION_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #000; display: flex; align-items: center; justify-content: center; width: 100vw; height: 100vh; overflow: hidden; }
#stage { position: relative; overflow: hidden; }
.scene { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; text-align: center; opacity: 0; overflow: hidden; word-break: break-word; }
.scene > * { max-width: 100%; flex-shrink: 1; min-width: 0; }
.subtitle-track { position: absolute; bottom: 80px; left: 40px; right: 40px; text-align: center; z-index: 100; opacity: 0; }
.subtitle-text { display: inline-block; font-size: 48px; font-weight: 700; color: #fff; text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 8px rgba(0,0,0,0.6); max-width: 800px; line-height: 1.3; }
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-width="1080" data-height="1920">
  <!-- AI 在此处填充场景 -->
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script>
(function() {
  var scenes = document.querySelectorAll('.scene');
  if (scenes.length === 0) return;
  var tl = gsap.timeline({ paused: true });
  var startAccum = 0;
  scenes.forEach(function(s) {
    var start = parseFloat(s.getAttribute('data-start'));
    if (isNaN(start)) start = startAccum;
    var dur = parseFloat(s.getAttribute('data-duration')) || 4;
    startAccum = start + dur;
    tl.set(s, { opacity: 0 }, start);
    tl.to(s, { opacity: 1, duration: 0.5 }, start);
    tl.to(s, { opacity: 0, duration: 0.3 }, start + dur - 0.3);
    var sub = s.querySelector('.subtitle-track');
    if (sub) {
      tl.set(sub, { opacity: 0 }, start);
      tl.to(sub, { opacity: 1, duration: 0.3 }, start + 0.3);
      tl.to(sub, { opacity: 0, duration: 0.2 }, start + dur - 0.3);
    }
  });
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
  window.addEventListener('load', function() { tl.play(); });
})();
</script>
</body>
</html>`;

export async function buildPreview(scriptJson, executionDir) {
  let script;
  if (typeof scriptJson === "string") {
    try { script = JSON.parse(scriptJson); } catch { throw ERRORS.SCRIPT_INVALID_JSON("解析失败"); }
  } else {
    script = scriptJson;
  }

  if (!script.scenes || script.scenes.length === 0) {
    throw ERRORS.PREVIEW_NO_SCENES();
  }

  let durations = {};
  const durationsPath = path.join(executionDir, "voice", "durations.json");
  if (fs.existsSync(durationsPath)) {
    durations = JSON.parse(fs.readFileSync(durationsPath, "utf-8"));
  }

  const previewDir = path.join(executionDir, "preview");
  fs.mkdirSync(previewDir, { recursive: true });

  let currentTime = 0;
  const sceneFragments = [];

  for (const scene of script.scenes) {
    const dur = durations[scene.id] || 5;
    const subtitleText = escHtml(scene.narration || "");

    const sceneHtml = `<div class="scene" data-scene-id="${scene.id}" data-template-id="${scene.templateId}" data-start="${currentTime.toFixed(1)}" data-duration="${dur.toFixed(1)}">
  <div style="color:#fff;font-size:32px;font-weight:700">${escHtml(scene.templateId)}</div>
  <div style="color:#aaa;font-size:20px;margin-top:12px">${escHtml(scene.id)} · ${scene.type}</div>
  <div class="subtitle-track"><span class="subtitle-text">${subtitleText}</span></div>
</div>`;

    sceneFragments.push(sceneHtml);

    const singleHtml = ANIMATION_TEMPLATE.replace("<!-- AI 在此处填充场景 -->", sceneHtml);
    fs.writeFileSync(path.join(previewDir, `scene-${scene.id}.html`), singleHtml);

    currentTime += dur + 0.3;
  }

  const fullHtml = ANIMATION_TEMPLATE.replace("<!-- AI 在此处填充场景 -->", sceneFragments.join("\n"));
  fs.writeFileSync(path.join(previewDir, "full.html"), fullHtml);

  return {
    previewFile: `${previewDir}/full.html`,
    "preview/full.html": "preview/full.html",
    output: `预览生成完成: ${sceneFragments.length} 个场景`,
    sceneCount: sceneFragments.length,
  };
}