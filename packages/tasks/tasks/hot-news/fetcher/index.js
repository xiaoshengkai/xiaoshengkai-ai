/**
 * 抓取器汇总：并行抓取 5 个平台热榜，单源失败不影响整体
 */
import { fetchWeibo } from "./weibo.js";
import { fetchBaidu } from "./baidu.js";
import { fetchZhihu } from "./zhihu.js";
import { fetchToutiao } from "./toutiao.js";
import { fetchDouyin } from "./douyin.js";
import { fetchSina } from "./sina.js";

export const SOURCES = [
  { key: "weibo", label: "微博", fetcher: fetchWeibo },
  { key: "baidu", label: "百度", fetcher: fetchBaidu },
  { key: "sina", label: "新浪", fetcher: fetchSina },
  { key: "zhihu", label: "知乎", fetcher: fetchZhihu },
  { key: "toutiao", label: "头条", fetcher: fetchToutiao },
  { key: "douyin", label: "抖音", fetcher: fetchDouyin },
];

/**
 * @returns {{ items: Array, sourceStatus: {key,label,ok,count}[] }}
 */
export async function fetchAllHotNews() {
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      const items = await s.fetcher();
      return {
        key: s.key,
        label: s.label,
        ok: items.length > 0,
        count: items.length,
        items,
      };
    })
  );

  const items = results.flatMap((r) => r.items);
  const sourceStatus = results.map(({ key, label, ok, count }) => ({ key, label, ok, count }));

  console.log(
    `[FETCH] 汇总完成: 共 ${items.length} 条原始数据 | ` +
      results.map((r) => `${r.label}${r.ok ? r.count : "✗"}`).join(" / ")
  );

  return { items, sourceStatus };
}
