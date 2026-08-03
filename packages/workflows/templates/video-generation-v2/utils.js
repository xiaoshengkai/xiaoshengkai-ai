import { execSync } from "node:child_process";

export function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function checkFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function ensureFfmpeg() {
  if (!checkFfmpeg()) {
    throw new Error("ffmpeg 未安装或不在 PATH 中，请先安装 ffmpeg");
  }
}