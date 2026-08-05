import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "templates");

export function loadAnimationTemplate() {
  return fs.readFileSync(path.join(TEMPLATES_DIR, "animation.html"), "utf-8");
}