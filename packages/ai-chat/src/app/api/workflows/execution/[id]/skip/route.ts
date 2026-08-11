import { NextResponse } from "next/server";
import { runWorkflowCli } from "@/lib/workflow-cli";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { stepId } = await request.json();
  if (!stepId) return NextResponse.json({ ok: false, error: "missing stepId" }, { status: 400 });

  try {
    const data = await runWorkflowCli(["skip", JSON.stringify({ executionId: id, stepId })], 10_000);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}