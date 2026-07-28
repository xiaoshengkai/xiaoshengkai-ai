import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "get", id], { timeout: 5000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });

    const data = JSON.parse(result);
    if (data.error === "not found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] get execution error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}