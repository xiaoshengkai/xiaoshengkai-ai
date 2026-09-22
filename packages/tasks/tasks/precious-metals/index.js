import { validate } from "./config.js";
import { fetchAllPrices } from "./fetcher/index.js";
import { formatMessage } from "./formatter.js";
import { pushToWechat } from "./pusher.js";
import { saveHistory, saveMacroHistory } from "./history.js";
import { generateDashboard } from "./generate-dashboard.js";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { publicBase } from "@app/shared/public-base.js";

const DASHBOARD_URL = `${publicBase()}/ai/api/tasks/precious-metals/dashboard`;

export async function run() {
  validate();

  console.log("开始执行市场监控...");

  try {
    const data = await fetchAllPrices();
    const message = formatMessage(data.categories, data.usdCny, data.macroIndicators);
    console.log("\n" + message);

    const success = await pushToWechat("市场早报", message);
    saveHistory(data);
    saveMacroHistory(data.macroIndicators, data.usdCny);
    await generateDashboard(data);

    // 仪表盘生成完毕，在浏览器中打开（仅本机桌面环境；headless 服务器跳过）
    const opener =
      process.platform === "darwin" ? "open" : process.env.DISPLAY ? "xdg-open" : null;
    if (opener) {
      console.log(`正在浏览器中打开仪表盘: ${DASHBOARD_URL}`);
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

    if (success) {
      console.log("执行完毕，推送成功，仪表盘已更新");
    } else {
      console.log("执行完毕，推送失败（数据已保存，仪表盘已更新）");
    }
  } catch (err) {
    console.error("执行失败:", err.message);
    try {
      await pushToWechat("市场监控异常", `数据获取失败: ${err.message}`);
    } catch (pushErr) {
      console.error("报警推送也失败了:", pushErr.message);
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
