import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.resolve(__dirname, "sfx");

export function indexSfxLibrary() {
  const index = {};
  if (!fs.existsSync(SFX_DIR)) return index;
  for (const cat of fs.readdirSync(SFX_DIR)) {
    const catDir = path.join(SFX_DIR, cat);
    try {
      if (!fs.statSync(catDir).isDirectory()) continue;
      const files = fs.readdirSync(catDir).filter((f) => f.toLowerCase().endsWith(".mp3"));
      if (files.length > 0) index[cat] = files.sort();
    } catch { /* skip */ }
  }
  return index;
}

const TEMPLATE_TO_CATEGORY = {
  hook: ["transition", "cinematic"],
  body: ["emphasis", "transition"],
  outro: ["outro", "success"],
};

const KEYWORD_RULES = [
  { pattern: /(警告|风险|危险|警惕|注意|小心|alert|warning|danger|risk)/i, category: "alert", label: "警告" },
  { pattern: /(失败|错误|崩溃|下跌|fault|error|fail|crash|wrong)/i, category: "fail", label: "失败" },
  { pattern: /(成功|突破|记录|纪录|领先|第一|冠军|最高|success|record|win|breakthrough)/i, category: "success", label: "成功" },
  { pattern: /(揭秘|发现|首次|发布|推出|亮相|揭晓|reveal|launch|unveil|debut|announce)/i, category: "reveal", label: "揭秘" },
  { pattern: /(倒计时|倒数|最后|deadline|countdown|timer|hurry)/i, category: "countdown", label: "倒计时" },
  { pattern: /(震撼|宏伟|巨大|史诗|cinematic|epic|massive|huge)/i, category: "cinematic", label: "震撼" },
  { pattern: /(期待|悬念|揭晓|drumroll|suspense|anticipation)/i, category: "drumroll", label: "悬念" },
  { pattern: /(对比|VS|vs|比较|comparison|battle)/i, category: "transition", label: "对比" },
  { pattern: /(数据|统计|数字|比例|percent|stat|number)/i, category: "emphasis", label: "数据" },
];

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickFromCategory(category, sceneId, index) {
  const pool = index[category];
  if (!pool || pool.length === 0) return null;
  const idx = hashCode(sceneId) % pool.length;
  return pool[idx];
}

export function pickSfxForScene({ narration, sceneType, sceneId, index }) {
  for (const rule of KEYWORD_RULES) {
    if (!narration.match(rule.pattern)) continue;
    const file = pickFromCategory(rule.category, sceneId, index);
    if (file) {
      return {
        relPath: `${rule.category}/${file}`,
        source: "semantic",
        matchedKeyword: rule.label,
        tier: 2,
      };
    }
  }

  const candidates = TEMPLATE_TO_CATEGORY[sceneType] || ["emphasis"];
  for (const cat of candidates) {
    const file = pickFromCategory(cat, sceneId, index);
    if (file) {
      return { relPath: `${cat}/${file}`, source: "template", tier: 3 };
    }
  }

  const allCats = Object.keys(index);
  for (const cat of allCats) {
    const file = pickFromCategory(cat, sceneId, index);
    if (file) {
      return { relPath: `${cat}/${file}`, source: "fallback", tier: 4 };
    }
  }

  return null;
}

export function defaultPlayback(picked) {
  const cat = picked.relPath.split("/")[0];
  const map = {
    transition: { volume: 0.40, offsetSec: 0.0 },
    emphasis: { volume: 0.35, offsetSec: 0.2 },
    alert: { volume: 0.40, offsetSec: 0.1 },
    success: { volume: 0.35, offsetSec: 0.3 },
    fail: { volume: 0.35, offsetSec: 0.1 },
    reveal: { volume: 0.30, offsetSec: 0.2 },
    countdown: { volume: 0.30, offsetSec: 0.0 },
    cinematic: { volume: 0.35, offsetSec: 0.0 },
    drumroll: { volume: 0.40, offsetSec: 0.0 },
    outro: { volume: 0.35, offsetSec: 0.5 },
  };
  return map[cat] || { volume: 0.35, offsetSec: 0.1 };
}

export async function pickSfxForAllScenes(scriptJson, executionDir) {
  const startTime = Date.now();
  let script;
  if (typeof scriptJson === "string") {
    try { script = JSON.parse(scriptJson); } catch { return { output: "script 解析失败" }; }
  } else {
    script = scriptJson;
  }

  const index = indexSfxLibrary();
  if (Object.keys(index).length === 0) {
    return { output: "SFX 库为空，跳过（首次使用请运行 sfx-downloader.js 下载音效）" };
  }

  const results = [];
  for (const scene of script.scenes) {
    if (scene.sfx && scene.sfx.name === "none") {
      results.push({ sceneId: scene.id, sfx: null, reason: "explicit:none" });
      continue;
    }
    if (scene.sfx && scene.sfx.name) {
      const p = path.join(SFX_DIR, `${scene.sfx.name}.mp3`);
      if (fs.existsSync(p)) {
        results.push({
          sceneId: scene.id,
          sfx: { path: p, volume: scene.sfx.volume || 0.3, startAt: 0 },
          source: "explicit",
          tier: 1,
        });
      }
      continue;
    }

    const picked = pickSfxForScene({
      narration: scene.narration,
      sceneType: scene.type,
      sceneId: scene.id,
      index,
    });

    if (picked) {
      const pb = defaultPlayback(picked);
      results.push({
        sceneId: scene.id,
        sfx: { path: path.join(SFX_DIR, picked.relPath), volume: pb.volume, startAt: pb.offsetSec },
        source: picked.source,
        matchedKeyword: picked.matchedKeyword,
        tier: picked.tier,
      });
    } else {
      results.push({ sceneId: scene.id, sfx: null, reason: "no_match" });
    }
  }

  const manifestPath = path.join(executionDir, "sfx", "manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));

  const matched = results.filter((r) => r.sfx).length;
  console.log(`[sfx] 完成: ${matched}/${results.length} 场景 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
  return {
    output: `SFX 匹配完成: ${matched}/${results.length} 个场景匹配到音效`,
    manifest: results,
  };
}