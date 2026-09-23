import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  // 持久化目录优先（data/xhs-tasks），旧数据回退 /tmp/xhs-tasks（重启前的任务仍可读）
  const dataDir = path.resolve(process.cwd(), "..", "..", "data", "xhs-tasks", taskId);
  const legacyDir = path.join(os.tmpdir(), "xhs-tasks", taskId);
  const hasTask = (d: string) => fs.existsSync(path.join(d, "task.json"));
  const taskDir = hasTask(dataDir) || !hasTask(legacyDir) ? dataDir : legacyDir;
  const taskFile = path.join(taskDir, "task.json");
  if (!fs.existsSync(taskFile)) {
    // ponytail: 区分"任务从未创建"vs"task.json 丢失"（目录存在但文件缺失）
    const dirExists = fs.existsSync(taskDir);
    console.log(`[note:status] taskId=${taskId} not found (dir=${dirExists})`);
    return Response.json(
      {
        ok: false,
        error: dirExists ? "任务数据已损坏（目录存在但 task.json 丢失）" : "笔记任务不存在或已过期",
      },
      { status: 404 }
    );
  }

  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  return Response.json(state);
}