import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DATA_DIR = path.resolve(
  __dirname, "..", "..", "..", "..", "data", "tasks", "daily-reminder-am", "bridge-data"
);

/**
 * 10:00 执行入口
 * - 检查 inbox 是否有我写入的任务卡
 * - 有 → 确认日志
 * - 没有 → 写兜底任务卡（防止断联）
 */
export async function run() {
  const inboxDir = path.join(BRIDGE_DATA_DIR, "inbox");

  // 确保目录存在
  fs.mkdirSync(inboxDir, { recursive: true });

  // 找最新的任务卡
  const files = fs.readdirSync(inboxDir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length > 0) {
    const latest = files[0];
    const content = JSON.parse(fs.readFileSync(path.join(inboxDir, latest), "utf-8"));
    console.log(`[daily-reminder-am] 找到任务卡: ${latest}`);
    console.log(`[daily-reminder-am] 课程: ${content.course || "未指定"}`);
    console.log(`[daily-reminder-am] 状态: 就绪，等待 Chrome 扩展推送`);
  } else {
    // 兜底：写入一个默认任务卡
    const fallback = {
      type: "learn",
      course: "金融学习",
      createdAt: new Date().toISOString(),
      message: "该学习了！从金融地图继续推进。"
    };
    const fallbackPath = path.join(inboxDir, `fallback-${Date.now()}.json`);
    fs.writeFileSync(fallbackPath, JSON.stringify(fallback, null, 2));
    console.log(`[daily-reminder-am] 未找到任务卡，已写入兜底任务卡`);
  }
}
