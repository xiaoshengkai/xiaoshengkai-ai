import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseCliOutput } from "@/lib/cli-parser";

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
    const data = parseCliOutput(result) as Record<string, unknown>;
    if (!data.ok) return NextResponse.json({ ok: false, error: data.error || "retry failed" }, { status: 500 });

    // 重试该步骤
    const nextResult = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "next", JSON.stringify({ executionId: id })], { timeout: 300000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    const nextData = parseCliOutput(nextResult) as Record<string, unknown>;
    return NextResponse.json(nextData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}