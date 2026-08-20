import { NextResponse } from "next/server";
import { runWorkflowCli } from "../../../_lib/cli";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    return NextResponse.json(await runWorkflowCli(["next", JSON.stringify({ executionId: id })], 900_000));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}