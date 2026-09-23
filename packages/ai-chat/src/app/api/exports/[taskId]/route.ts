import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, type ZipEntry } from "@/lib/zip";

/**
 * 下载小红书笔记导出：把 data/exports/<taskId>/ 打成 zip 流式返回。
 * 注：导出目录由 MCP 的 exportXiaohongshuNote 生成；taskId 白名单校验防穿越。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  if (!/^[\w-]+$/.test(taskId)) {
    return Response.json({ ok: false, error: "非法 taskId" }, { status: 400 });
  }

  const root = path.resolve(process.cwd(), "..", "..");
  const exportDir = path.join(root, "data", "exports", taskId);
  if (!fs.existsSync(exportDir)) {
    return Response.json({ ok: false, error: "导出不存在或已过期（先让 AI 导出）" }, { status: 404 });
  }

  const entries: ZipEntry[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else entries.push({ name: rel, data: fs.readFileSync(full) });
    }
  };
  walk(exportDir, "");

  const zip = zipSync(entries);

  // 文件名优先取笔记标题（task.json），失败回退 taskId
  let title = taskId;
  for (const d of [path.join(root, "data", "xhs-tasks", taskId), path.join(os.tmpdir(), "xhs-tasks", taskId)]) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(d, "task.json"), "utf-8")).title;
      if (t) { title = String(t).replace(/[\/\\:*?"<>|]/g, "_"); break; }
    } catch { /* next */ }
  }

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${taskId}.zip"; filename*=UTF-8''${encodeURIComponent(title)}.zip`,
      "Content-Length": String(zip.length),
    },
  });
}
