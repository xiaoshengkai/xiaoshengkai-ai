/**
 * 微博热搜抓取器
 * 接口: https://weibo.com/ajax/side/hotSearch
 * 返回 realtime[]: { word, num, label_name, ... }
 */
import axios from "axios";
import { config } from "../config.js";

const API = "https://weibo.com/ajax/side/hotSearch";

export async function fetchWeibo() {
  try {
    const res = await axios.get(API, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://weibo.com/",
      },
    });

    const realtime = res.data?.data?.realtime;
    if (!Array.isArray(realtime)) {
      console.warn("[WEIBO] 返回结构异常，无 realtime 数组");
      return [];
    }

    const items = realtime
      .filter((r) => r.word && r.word !== "·")
      .slice(0, config.topPerSource)
      .map((r) => ({
        title: r.word,
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(r.word)}`,
        hot: r.num != null ? Number(r.num) : null,
        source: "微博",
      }));

    console.log(`[WEIBO] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[WEIBO] 获取失败: ${err.message}`);
    return [];
  }
}
