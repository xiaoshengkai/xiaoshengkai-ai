import { NextResponse } from "next/server";
import path from "node:path";

const ENGINE_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "engine.js");

export async function POST(request: Request) {
  const { template, params } = await request.json();
  if (!template) return NextResponse.json({ error: "missing template" }, { status: 400 });

  try {
    const { startExecution } = await import(ENGINE_PATH);
    const result = await startExecution(template, params || {});
    return NextResponse.json({ ok: true, executionId: result.executionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}