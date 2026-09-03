import { NextResponse } from "next/server";
import { controlService } from "@/lib/services/manager";

const ACTIONS = new Set(["start", "restart", "stop"]);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  try {
    const service = await controlService(id, action as "start" | "restart" | "stop");
    return NextResponse.json({ ok: true, service }, { status: action === "stop" ? 200 : 202 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "service action failed" }, { status: 500 });
  }
}
