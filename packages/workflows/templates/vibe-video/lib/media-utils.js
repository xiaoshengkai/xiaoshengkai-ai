/** 视频时长探测（PATH 上的 ffprobe 优先，installer 兜底——installer 二进制偶发无执行权限） */
import { execSync } from "node:child_process";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

function resolveFfprobe() {
  try {
    execSync("command -v ffprobe", { stdio: "pipe", shell: "/bin/sh" });
    return "ffprobe";
  } catch {
    return ffprobeInstaller.path;
  }
}

export function getVideoDuration(filePath) {
  const out = execSync(
    `"${resolveFfprobe()}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    { encoding: "utf-8" }
  );
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error(`无法探测视频时长: ${filePath}`);
  return dur;
}
