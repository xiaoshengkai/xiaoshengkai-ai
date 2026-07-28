import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

export function loadStyleMD(name) {
  const p = path.join(TEMPLATES_DIR, `${name || "default"}.md`);
  if (!fs.existsSync(p)) {
    if (name) throw new Error(`风格模板 ${name} 不存在: ${p}`);
    throw new Error(`默认风格模板不存在: ${p}`);
  }
  return fs.readFileSync(p, "utf-8");
}

export function loadAnimationTemplate() {
  return fs.readFileSync(path.join(TEMPLATES_DIR, "animation.html"), "utf-8");
}

export function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}