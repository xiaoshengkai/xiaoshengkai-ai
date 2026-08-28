/**
 * 抖音热榜抓取器（第三方聚合接口，不稳定，失败自动降级为空）
 * 接口: https://api.auth.top/api/dyhot
 * 返回 data[]: { word, hot_value }
 */
import axios from "axios";
import { config } from "../config.js";

const API = "https://api.auth.top/api/dyhot";

export async function fetchDouyin() {
  try {
    const res = await axios.get(API, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });

    const list = res.data?.data;
    if (!Array.isArray(list)) {
      console.warn("[DOUYIN] 返回结构异常，无 data 数组");
      return [];
    }

    const items = list
      .filter((d) => d.word)
      .slice(0, config.topPerSource)
      .map((d) => ({
        title: d.word,
        url: `https://www.douyin.com/search/${encodeURIComponent(d.word)}?type=general`,
        hot: d.hot_value != null ? Number(d.hot_value) : null,
        source: "抖音",
      }));

    console.log(`[DOUYIN] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[DOUYIN] 获取失败（第三方接口，忽略）: ${err.message}`);
    return [];
  }
}
