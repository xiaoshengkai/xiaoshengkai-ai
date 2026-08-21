/**
 * workflows 能力 HTTP 入口：引擎级 actions.json + 各模板 actions.json 合并
 * ai-chat 的 catch-all 路由委托此 handler
 */

import fs from "node:fs";
import path from "node:path";
import { createCapabilityHandler, loadActions } from "@app/shared/capability.js";
import { handle as generateContent } from "./templates/video-generation/lib/generate-content.js";

// ponytail: 本文件被 Next webpack 打包，import.meta.url 不可靠；
// 沿用仓库约定 process.cwd() = packages/ai-chat（dev/prod 均如此）
const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const ROOT = path.join(PROJECT_ROOT, "packages", "workflows");
const CLI_PATH = path.join(ROOT, "cli.js");

const CUSTOM_HANDLERS = {
  "generate-content": generateContent,
};

function collectActions() {
  const actions = [...loadActions(path.join(ROOT, "actions.json"))];

  const templatesDir = path.join(ROOT, "templates");
  for (const name of fs.readdirSync(templatesDir)) {
    const p = path.join(templatesDir, name, "actions.json");
    if (fs.existsSync(p)) actions.push(...loadActions(p));
  }

  const seen = new Set();
  return actions.map(a => {
    const key = `${a.method} ${a.path}`;
    if (seen.has(key)) throw new Error(`duplicate workflow action: ${key}`);
    seen.add(key);
    if (a.type === "stream") return { ...a, dir: path.join(PROJECT_ROOT, "data", "workflows") };
    if (a.type === "upload") return { ...a, destDir: path.join(PROJECT_ROOT, a.destDir) };
    if (a.type === "custom") {
      const handler = CUSTOM_HANDLERS[a.handler];
      if (!handler) throw new Error(`unknown custom handler: ${a.handler}`);
      return { ...a, handler };
    }
    return a;
  });
}

export const handler = createCapabilityHandler({ actions: collectActions(), cliPath: CLI_PATH });
