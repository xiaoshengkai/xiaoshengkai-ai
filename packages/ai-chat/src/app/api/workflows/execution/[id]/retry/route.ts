import { NextResponse } from "next/server";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { stepId } = body;
  if (!stepId) return NextResponse.json({ ok: false, error: "missing stepId" }, { status: 400 });

  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "retry", JSON.stringify({ executionId: id, stepId })], { timeout: 10000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    const data = JSON.parse(result);
    if (!data.ok) return NextResponse.json({ ok: false, error: data.error || "retry failed" }, { status: 500 });

    // 后台执行重试的步骤
    const child = spawn("node", [CLI_PATH, "auto", JSON.stringify({ executionId: id })], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}