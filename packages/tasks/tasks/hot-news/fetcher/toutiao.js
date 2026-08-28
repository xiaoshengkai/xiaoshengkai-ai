/**
 * 今日头条热榜抓取器
 * 接口: https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc
 * 返回 data[]: { Title, HotValue, Url }
 */
import axios from "axios";
import { config } from "../config.js";

const API = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";

export async function fetchToutiao() {
  try {
    const res = await axios.get(API, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://www.toutiao.com/",
      },
    });

    const list = res.data?.data;
    if (!Array.isArray(list)) {
      console.warn("[TOUTIAO] 返回结构异常，无 data 数组");
      return [];
    }

    const items = list
      .filter((d) => d.Title)
      .slice(0, config.topPerSource)
      .map((d) => ({
        title: d.Title,
        url: d.Url || "https://www.toutiao.com/",
        hot: d.HotValue != null ? Number(d.HotValue) : null,
        source: "头条",
      }));

    console.log(`[TOUTIAO] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[TOUTIAO] 获取失败: ${err.message}`);
    return [];
  }
}
