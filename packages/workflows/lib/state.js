import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

export const DATA_DIR = path.join(PROJECT_ROOT, "data", "workflows", "tasks");
export const LOG_DIR = path.join(PROJECT_ROOT, "logs", "workflows");
export const VIDEOS_DIRNAME = "videos";

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function writeState(dir, state) {
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

export function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf-8"));
}

export function getVideosDir(execDir) {
  const d = path.join(execDir, VIDEOS_DIRNAME);
  ensureDir(d);
  return d;
}

export function saveVideoVersion(executionId, version, videoPath) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  if (!state.scriptHistory) return { ok: false, error: "无历史记录" };

  const entry = state.scriptHistory.find(h => h.version === version);
  if (!entry) return { ok: false, error: `版本 v${version} 不存在` };

  const videosDir = getVideosDir(dir);
  const ext = path.extname(videoPath);
  const dest = path.join(videosDir, `v${version}${ext}`);
  if (fs.existsSync(videoPath)) {
    fs.copyFileSync(videoPath, dest);
  }

  entry.videoFile = `videos/v${version}${ext}`;
  writeState(dir, state);
  return { ok: true, videoFile: entry.videoFile };
}
