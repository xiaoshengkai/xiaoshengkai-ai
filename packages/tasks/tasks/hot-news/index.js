/**
 * hot-news 主入口
 * 流程: 并行抓取 5 源 → 关键词分类去重 → 生成 HTML 仪表盘 → 浏览器打开
 */
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchAllHotNews } from "./fetcher/index.js";
import { classifyAndMerge } from "./classifier.js";
import { generateDashboard } from "./generate-dashboard.js";
import { config } from "./config.js";
import { publicBase } from "@app/shared/public-base.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_URL = `${publicBase()}/ai/api/tasks/hot-news/dashboard`;

export async function run() {
  console.log("=== 每日热点新闻聚合开始 ===");

  try {
    // 1. 抓取
    const { items, sourceStatus } = await fetchAllHotNews();

    // 2. 分类 + 去重合并
    const grouped = classifyAndMerge(items, config.topPerCategory);

    // 统计每个分类条数
    const summary = [...grouped.entries()]
      .map(([k, g]) => `${g.emoji}${g.label}${g.items.length}`)
      .join("  ");
    console.log(`[CLASSIFY] 分类结果: ${summary}`);

    // 3. 生成 HTML
    await generateDashboard(grouped, { sourceStatus, totalRaw: items.length });

    // 4. 浏览器打开（仅本机桌面环境；headless 服务器跳过）
    const opener =
      process.platform === "darwin" ? "open" : process.env.DISPLAY ? "xdg-open" : null;
    if (opener) {
      console.log(`正在浏览器中打开: ${DASHBOARD_URL}`);
      await new Promise((resolve, reject) => {
        exec(`${opener} "${DASHBOARD_URL}"`, (err) => {
          if (err) reject(new Error(`打开浏览器失败: ${err.message}`));
          else resolve();
        });
      });
      console.log("浏览器已打开 ✅");
    } else {
      console.log(`[headless] 跳过浏览器打开: ${DASHBOARD_URL}`);
    }

    console.log("=== 执行完毕，HTML 已更新 ===");
    return { ok: true };
  } catch (err) {
    console.error("[HOT-NEWS] 执行失败:", err.message);
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
