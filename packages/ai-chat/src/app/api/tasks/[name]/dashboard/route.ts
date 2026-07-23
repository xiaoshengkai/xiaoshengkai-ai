import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const TASKS_DIR = path.resolve(process.cwd(), "..", "..", "packages", "tasks");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  const taskDir = path.join(TASKS_DIR, name);
  const taskJson = path.join(taskDir, "task.json");

  if (!fs.existsSync(taskJson)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const meta = JSON.parse(fs.readFileSync(taskJson, "utf-8"));
  const htmlFile = meta.html;
  if (!htmlFile) {
    return new NextResponse("No dashboard", { status: 404 });
  }

  const htmlPath = path.join(taskDir, htmlFile);
  if (!fs.existsSync(htmlPath)) {
    return new NextResponse("Dashboard not generated yet", { status: 404 });
  }

  const html = fs.readFileSync(htmlPath, "utf-8");
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}