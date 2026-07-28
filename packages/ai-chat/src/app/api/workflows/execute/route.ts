import { NextResponse } from "next/server";
import path from "node:path";
import { execFile } from "node:child_process";

const CLI_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "cli.js");

export async function POST(request: Request) {
  const { template, params } = await request.json();
  if (!template) return NextResponse.json({ error: "missing template" }, { status: 400 });

  console.log(`[workflow] execute: template=${template} params=${JSON.stringify(params)}`);

  try {
    const result = await new Promise<string>((resolve, reject) => {
      execFile("node", [CLI_PATH, "start", JSON.stringify({ template, params: params || {} })], { timeout: 10000 }, (err, stdout, stderr) => {
        if (stderr) console.error(`[workflow] cli stderr:`, stderr);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });

    const data = JSON.parse(result);
    if (data.ok === false) {
      console.error(`[workflow] execute failed: ${data.error}`);
      return NextResponse.json({ ok: false, error: data.error }, { status: 500 });
    }

    console.log(`[workflow] execute started: ${data.executionId}`);
    return NextResponse.json({ ok: true, executionId: data.executionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] execute error:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}