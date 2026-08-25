import axios from "axios";
import { config } from "./config.js";

async function sendOnce(payload, label, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axios.post(
        "https://www.pushplus.plus/send",
        payload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      if (response.data && response.data.code === 200) {
        console.log(`[PUSH] ${label} 推送成功`);
        return true;
      }

      console.error(`[PUSH] ${label} 推送返回异常:`, JSON.stringify(response.data));
      if (i < retries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      console.error(`[PUSH] ${label} 推送异常 (${i + 1}/${retries + 1}):`, err.message);
      if (i < retries) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return false;
}

export async function pushToWechat(title, content) {
  const basePayload = {
    token: config.pushPlusToken,
    title,
    content,
    template: "html",
  };

  const results = [];

  results.push(await sendOnce(basePayload, "自己"));

  if (config.pushPlusTopic) {
    results.push(
      await sendOnce({ ...basePayload, topic: config.pushPlusTopic }, "群组")
    );
  }

  if (config.pushPlusTo) {
    results.push(
      await sendOnce({ ...basePayload, to: config.pushPlusTo }, "好友")
    );
  }

  return results.every(Boolean);
}