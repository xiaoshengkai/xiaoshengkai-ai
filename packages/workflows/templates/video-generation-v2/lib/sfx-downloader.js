// 首次运行前执行：node lib/sfx-downloader.js
// 从 myinstants.com 下载 SFX 音效文件
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.resolve(__dirname, "sfx");

const CATEGORIES = {
  transition: ["whoosh", "swoosh", "swish", "pop", "click"],
  emphasis: ["ding", "tick", "chime", "bell", "ping"],
  alert: ["notification", "alert", "warning", "alarm"],
  success: ["tada", "win", "achievement", "success", "victory"],
  fail: ["wrong", "buzzer", "error", "fail"],
  drumroll: ["drumroll", "snare", "boom"],
  cinematic: ["cinematic", "epic", "impact", "rise"],
  reveal: ["reveal", "bling", "magic", "sparkle"],
  countdown: ["countdown", "beep", "timer"],
  outro: ["tada", "outro", "ending", "finale"],
};

async function searchMyInstants(query) {
  const url = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await resp.text();
  const matches = html.match(/\/media\/sounds\/[^"'\s]+\.mp3/g);
  if (!matches) return [];
  return [...new Set(matches)].map((m) => `https://www.myinstants.com${m}`).slice(0, 3);
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`  SKIP (已存在): ${path.basename(destPath)}`);
    return;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  console.log(`  OK: ${path.basename(destPath)} (${buf.length} bytes)`);
}

async function main() {
  console.log("SFX 下载器 - 从 myinstants.com 下载音效\n");

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    const catDir = path.join(SFX_DIR, category);
    fs.mkdirSync(catDir, { recursive: true });
    console.log(`[${category}]`);

    for (const keyword of keywords.slice(0, 3)) {
      try {
        const urls = await searchMyInstants(keyword);
        if (urls.length > 0) {
          const dest = path.join(catDir, `${keyword}.mp3`);
          await downloadFile(urls[0], dest);
        }
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        console.log(`  FAIL: ${keyword} - ${e.message}`);
      }
    }
  }

  console.log("\n下载完成！");
}

main().catch((e) => {
  console.error("下载失败:", e.message);
  process.exit(1);
});