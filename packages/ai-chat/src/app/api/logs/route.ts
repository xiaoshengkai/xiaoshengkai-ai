import fs from "node:fs";
import path from "node:path";

export async function GET() {
  const LOG_DIR = path.resolve(process.cwd(), "..", "..", "logs", "app");
  const today = new Date().toISOString().slice(0, 10);
  const LOG_FILE = path.join(LOG_DIR, `app-${today}.log`);

  if (!fs.existsSync(LOG_FILE)) {
    return Response.json({ lines: [] });
  }

  const content = fs.readFileSync(LOG_FILE, "utf-8");
  const lines = content.split("\n").filter(Boolean).slice(0, 200);
  return Response.json({ lines: lines.map(l => l.length > 500 ? l.slice(0, 500) + "..." : l) });
}