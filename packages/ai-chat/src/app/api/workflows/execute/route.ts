import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";
import { parseCliOutput } from "@/lib/cli-parser";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function POST(request: Request) {
  const { template, params } = await request.json();
  if (!template) return NextResponse.json({ error: "missing template" }, { status: 400 });

  console.log(`[workflow] create: template=${template}`);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "start", JSON.stringify({ template, params: params || {} })], { timeout: 5000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });

    const data = parseCliOutput(result) as Record<string, unknown>;
    if (!data.ok) {
      return NextResponse.json({ ok: false, error: data.error }, { status: 500 });
    }

    console.log(`[workflow] created: ${data.executionId}`);
    return NextResponse.json({ ok: true, executionId: data.executionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] create error:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}