import { NextResponse } from "next/server";
import { runWorkflowCli } from "../_lib/cli";

export async function POST(request: Request) {
  const { template, params } = await request.json();
  if (!template) return NextResponse.json({ error: "missing template" }, { status: 400 });

  console.log(`[workflow] create: template=${template}`);
  try {
    const data = (await runWorkflowCli(["start", JSON.stringify({ template, params: params || {} })])) as Record<string, unknown>;
    if (!data.ok) return NextResponse.json({ ok: false, error: data.error }, { status: 500 });
    console.log(`[workflow] created: ${data.executionId}`);
    return NextResponse.json({ ok: true, executionId: data.executionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] create error:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}