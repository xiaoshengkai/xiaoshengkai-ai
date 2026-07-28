import { NextResponse } from "next/server";
import path from "node:path";

const ENGINE_PATH = path.resolve(process.cwd(), "..", "..", "packages", "workflows", "engine.js");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { getExecution } = await import(ENGINE_PATH);
  const state = getExecution(id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}