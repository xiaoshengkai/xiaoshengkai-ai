import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..");
const TEMPLATES_DIR = path.join(ROOT, "packages", "workflows", "templates");

export async function GET() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return NextResponse.json({ templates: [] });
  }
  const templates = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => fs.statSync(path.join(TEMPLATES_DIR, f)).isDirectory())
    .map(f => {
      const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f, "template.json"), "utf-8"));
      return { id: f, ...t };
    });
  return NextResponse.json({ templates });
}