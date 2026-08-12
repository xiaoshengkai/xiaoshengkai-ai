import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const taskFile = path.join(os.tmpdir(), "xhs-tasks", taskId, "task.json");
  if (!fs.existsSync(taskFile)) {
    console.log(`[note:status] taskId=${taskId} not found`);
    return Response.json({ ok: false, error: "笔记任务不存在或已过期" }, { status: 404 });
  }

  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  return Response.json(state);
}