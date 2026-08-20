import { NextResponse } from "next/server";
import { runWorkflowCli } from "../_lib/cli";

export async function GET() {
  try {
    return NextResponse.json(await runWorkflowCli(["list"]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}