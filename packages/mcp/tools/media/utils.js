import fs from "node:fs";
import path from "node:path";

export const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

const MCP_DIR = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const TEMPLATES_DIR = path.join(MCP_DIR, "..", "templates");

// 加载风格 MD 文件，返回文本内容
export function loadStyleMD(name) {
  const p = path.join(TEMPLATES_DIR, `${name || "default"}.md`);
  if (!fs.existsSync(p)) {
    if (name) throw new Error(`风格模板 ${name} 不存在: ${p}`);
    throw new Error(`默认风格模板不存在: ${p}`);
  }
  return fs.readFileSync(p, "utf-8");
}

// 加载动画骨架模板
export function loadAnimationTemplate() {
  return fs.readFileSync(path.join(TEMPLATES_DIR, "animation.html"), "utf-8");
}

export function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}