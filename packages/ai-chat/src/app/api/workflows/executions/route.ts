import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseCliOutput } from "@/lib/cli-parser";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function GET() {
  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "list"], { timeout: 5000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return NextResponse.json(parseCliOutput(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}