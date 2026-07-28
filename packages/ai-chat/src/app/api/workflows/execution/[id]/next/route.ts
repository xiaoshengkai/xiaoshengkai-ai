import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "next", JSON.stringify({ executionId: id })], { timeout: 300000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return NextResponse.json(JSON.parse(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}