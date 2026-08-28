/**
 * 百度热搜抓取器（PC 版接口，带 hotScore）
 * 接口: https://top.baidu.com/api/board?platform=pc&tab=realtime
 * 结构: data.cards[0].content[] -> 每条含 { content: [...] } 嵌套，或直接是条目
 * 条目: { word, url/appUrl, hotScore }
 */
import axios from "axios";
import { config } from "../config.js";

const API = "https://top.baidu.com/api/board?platform=pc&tab=realtime";

export async function fetchBaidu() {
  try {
    const res = await axios.get(API, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://top.baidu.com/board?tab=realtime",
      },
    });

    const cards = res.data?.data?.cards;
    const content = Array.isArray(cards) ? cards[0]?.content : null;
    if (!Array.isArray(content)) {
      console.warn("[BAIDU] 返回结构异常，无 content 数组");
      return [];
    }

    // 兼容嵌套结构：条目可能在每条目的 content 子数组里
    const entries = content.flatMap((c) => (Array.isArray(c.content) ? c.content : [c]));

    const items = entries
      .filter((c) => c.word || c.query)
      .slice(0, config.topPerSource)
      .map((c) => ({
        title: c.word || c.query,
        url: c.url || c.appUrl || `https://www.baidu.com/s?wd=${encodeURIComponent(c.word || c.query)}`,
        hot: c.hotScore != null ? Number(c.hotScore) : null,
        source: "百度",
      }));

    console.log(`[BAIDU] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[BAIDU] 获取失败: ${err.message}`);
    return [];
  }
}
