import { NextResponse } from "next/server";
import { listServices } from "@/lib/services/manager";

export async function GET() {
  const data = await listServices();
  return NextResponse.json(data);
}
