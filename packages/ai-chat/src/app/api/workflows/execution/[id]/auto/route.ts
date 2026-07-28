import { NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const child = spawn("node", [CLI_PATH, "auto", JSON.stringify({ executionId: id })], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return NextResponse.json({ ok: true });
}