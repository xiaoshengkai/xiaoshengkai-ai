/**
 * 新浪热榜抓取器
 * 页面: https://sinanews.sina.cn/h5/top_news_list.d.html
 * 热榜数据直接内嵌在 HTML 的 <script> 里（protobuf JSON 序列化）
 * 条目: {"@type":"...ItemHotSearchMod", ... "dynamicName":"标题", ... "hotValue":"375万", ...}
 * 链接: 页面内是 sinanews:// app 协议，转成 so.sina.cn 搜索页供浏览器点击
 */
import axios from "axios";
import { config } from "../config.js";

const URL = "https://sinanews.sina.cn/h5/top_news_list.d.html";

function parseHotValue(str) {
  const s = String(str).trim();
  const m = s.match(/^([\d.]+)\s*万?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return s.includes("万") ? Math.round(v * 10000) : Math.round(v);
}

export async function fetchSina() {
  try {
    const res = await axios.get(URL, {
      timeout: config.timeout,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        Referer: "https://sina.cn/",
      },
    });
    const html = String(res.data);

    // 按 ItemHotSearchMod 块切分，块内就近取 dynamicName + hotValue
    const parts = html.split('"@type":"type.googleapis.com\\/datamodel.item.ItemHotSearchMod"');
    const seen = new Set();
    const items = [];

    for (const part of parts) {
      const titleMatch = part.match(/"dynamicName":"([^"]+)"/);
      if (!titleMatch) continue;
      const title = titleMatch[1];
      if (!title || seen.has(title)) continue;
      const hotMatch = part.match(/"hotValue":"([^"]+)"/);
      items.push({
        title,
        url: `https://so.sina.cn/search/list.d.html?keyword=${encodeURIComponent(title)}`,
        hot: hotMatch ? parseHotValue(hotMatch[1]) : null,
        source: "新浪",
      });
      seen.add(title);
      if (items.length >= config.topPerSource) break;
    }

    console.log(`[SINA] 获取成功: ${items.length} 条`);
    return items;
  } catch (err) {
    console.warn(`[SINA] 获取失败: ${err.message}`);
    return [];
  }
}
