import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  if (taskId.endsWith(".png")) {
    const id = taskId.replace(/\.png$/, "");
    const pngPath = path.join(os.tmpdir(), "hf-tasks", id, "preview.png");
    if (!fs.existsSync(pngPath)) {
      return new Response("预览不存在或已过期", { status: 404 });
    }
    const png = fs.readFileSync(pngPath);
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache, no-store, must-revalidate" },
    });
  }

  const filePath = path.join(os.tmpdir(), "hf-tasks", taskId, "preview.html");
  if (!fs.existsSync(filePath)) {
    return new Response("预览不存在或已过期", { status: 404 });
  }
  const html = fs.readFileSync(filePath, "utf-8");
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" },
  });
}