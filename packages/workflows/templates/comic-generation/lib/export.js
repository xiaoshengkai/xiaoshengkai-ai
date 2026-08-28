/**
 * comic-generation 特有动作：导出漫画图片到本地 Downloads 文件夹
 * 参考小红书 exportXiaohongshuNote（复制文件到 ~/Downloads/<名称>_<时间戳>/）
 * 被 Next webpack 打包，路径用 process.cwd() 定位
 */

import fs from "node:fs";
import path from "node:path";
import { downloadsDir } from "@app/shared/utils.js";

const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data", "workflows", "tasks");

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function handle({ params }) {
  const executionId = params.id;
  const execDir = path.join(DATA_DIR, executionId);
  const pagesDir = path.join(execDir, "pages");

  if (!fs.existsSync(pagesDir)) {
    return Response.json({ ok: false, error: "暂无漫画图片" }, { status: 404 });
  }
  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".png"));
  if (files.length === 0) {
    return Response.json({ ok: false, error: "暂无漫画图片" }, { status: 404 });
  }

  let title = "comic";
  try {
    const state = JSON.parse(fs.readFileSync(path.join(execDir, "state.json"), "utf-8"));
    if (state.title) title = state.title;
  } catch { /* ignore */ }

  const safeTitle = title.replace(/[\/\\:*?"<>|]/g, "_").trim() || "comic";
  const exportDir = path.join(downloadsDir, `${safeTitle}_${timestamp()}`);
  fs.mkdirSync(exportDir, { recursive: true });

  for (const f of files) {
    fs.copyFileSync(path.join(pagesDir, f), path.join(exportDir, f));
  }

  return { ok: true, exportDir, count: files.length };
}
