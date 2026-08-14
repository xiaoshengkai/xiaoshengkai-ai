import { NextResponse } from "next/server";
import { readSelection, writeSelection } from "@/lib/settings/store";
import { initSettings } from "@/lib/settings/init";

export async function GET() {
  initSettings();
  const data = readSelection();
  return NextResponse.json(data);
}

export async function PUT(request: Request) {
  const body = await request.json();
  writeSelection(body);
  return NextResponse.json({ ok: true });
}