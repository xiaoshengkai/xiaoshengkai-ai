/**
 * 知乎热榜抓取器
 * 接口: https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50
 * 返回 data[]: { target: { title, url }, detail_text: "1234 万热度" }
 * 注意: 需要 UA，偶发 403，失败降级为空
 */
import axios from "axios";
import { config } from "../config.js";

const API = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50";

/** 解析知乎热度文本: "1234 万热度" -> 12340000 */
function parseHot(detailText) {
  if (!detailText) return null;
  const m = String(detailText).match(/([\d.]+)\s*(万|亿)?/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  if (m[2] === "万") return num * 10000;
  if (m[2] === "亿") return num * 100000000;
  return num;
}

export async function fetchZhihu() {
  try {
    const res = await axios.get(API, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://www.zhihu.com/hot",
      },
    });

    const list = res.data?.data;
    if (!Array.isArray(list)) {
      console.warn("[ZHIHU] 返回结构异常，无 data 数组");
      return [];
    }

    const items = list
      .filter((d) => d.target?.title)
      .slice(0, config.topPerSource)
      .map((d) => ({
        title: d.target.title,
        url: d.target.url || "https://www.zhihu.com/hot",
        hot: parseHot(d.detail_text),
        source: "知乎",
      }));

    console.log(`[ZHIHU] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[ZHIHU] 获取失败: ${err.message}`);
    return [];
  }
}
