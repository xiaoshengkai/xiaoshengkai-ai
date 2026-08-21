/**
 * tasks 能力 HTTP 入口：actions.json + handlers
 * ai-chat 的 catch-all 路由委托此 handler
 */

import path from "node:path";
import { createCapabilityHandler, loadActions } from "@app/shared/capability.js";
import { handleList, handleRun, handleEdit, handleDashboard } from "./lib/handlers.js";

const CUSTOM_HANDLERS = {
  list: handleList,
  run: handleRun,
  edit: handleEdit,
  dashboard: handleDashboard,
};

// ponytail: 本文件被 Next webpack 打包，沿用 process.cwd() = packages/ai-chat 约定
const ACTIONS_PATH = path.resolve(process.cwd(), "..", "..", "packages", "tasks", "actions.json");

const actions = loadActions(ACTIONS_PATH)
  .map(a => {
    if (a.type !== "custom") return a;
    const handler = CUSTOM_HANDLERS[a.handler];
    if (!handler) throw new Error(`unknown custom handler: ${a.handler}`);
    return { ...a, handler };
  });

export const handler = createCapabilityHandler({ actions });
