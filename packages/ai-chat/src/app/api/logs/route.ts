import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * 日志接口：
 *  无参            → 今日 app 日志 tail 200（兼容旧调用）
 *  ?list=1         → 各分组下的日志文件列表
 *  ?group&file     → 指定文件 tail（?tail=N，默认 200）
 *  ?group&file&download=1 → 附件下载
 * 分组：app/tasks/services/workflows（logs/<group>/）+ backup（logs/backup.log）
 */
const LOG_ROOT = path.resolve(process.cwd(), "..", "..", "logs");
const GROUPS = ["app", "tasks", "services", "workflows"] as const;
const FILE_RE = /^[\w.-]+\.log$/;

function resolveLogFile(group: string, file: string): string | null {
  if (!FILE_RE.test(file)) return null;
  if (group === "backup") {
    return file === "backup.log" ? path.join(LOG_ROOT, "backup.log") : null;
  }
  if (!(GROUPS as readonly string[]).includes(group)) return null;
  return path.join(LOG_ROOT, group, file);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const group = url.searchParams.get("group");
  const file = url.searchParams.get("file");

  // 文件列表
  if (url.searchParams.get("list") === "1") {
    const groups: { name: string; files: { file: string; size: number }[] }[] = GROUPS.map((g) => {
      const dir = path.join(LOG_ROOT, g);
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort().reverse()
            .map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size }))
        : [];
      return { name: g, files };
    });
    const backupFile = path.join(LOG_ROOT, "backup.log");
    groups.push({
      name: "backup",
      files: fs.existsSync(backupFile) ? [{ file: "backup.log", size: fs.statSync(backupFile).size }] : [],
    });
    return Response.json({ groups });
  }

  // 指定文件：tail 或下载
  if (group && file) {
    const full = resolveLogFile(group, file);
    if (!full || !fs.existsSync(full)) {
      return Response.json({ ok: false, error: "日志文件不存在" }, { status: 404 });
    }

    if (url.searchParams.get("download") === "1") {
      const stream = Readable.toWeb(fs.createReadStream(full)) as ReadableStream;
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file}"`,
        },
      });
    }

    const tail = Math.min(Number(url.searchParams.get("tail")) || 200, 2000);
    const lines = fs.readFileSync(full, "utf-8").split("\n").filter(Boolean).slice(-tail).reverse();
    return Response.json({ lines: lines.map((l) => (l.length > 500 ? l.slice(0, 500) + "..." : l)) });
  }

  // 兼容旧调用：今日 app 日志 tail 200
  const today = new Date().toISOString().slice(0, 10);
  const full = path.join(LOG_ROOT, "app", `app-${today}.log`);
  if (!fs.existsSync(full)) return Response.json({ lines: [] });
  const lines = fs.readFileSync(full, "utf-8").split("\n").filter(Boolean).slice(-200).reverse();
  return Response.json({ lines: lines.map((l) => (l.length > 500 ? l.slice(0, 500) + "..." : l)) });
}
