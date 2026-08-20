import { NextResponse } from "next/server";
import { runWorkflowCli } from "../../../_lib/cli";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { version } = await request.json();
  if (version === undefined) return NextResponse.json({ ok: false, error: "missing version" }, { status: 400 });

  try {
    const data = await runWorkflowCli(
      ["switch-version", JSON.stringify({ executionId: id, version })],
      10_000
    ) as Record<string, unknown>;
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}