/**
 * 淘宝闪购平台规则联网检索
 * ============================================================================
 * 纯函数（isOfficial / rankSources / pickPrimary / mergeConflicts /
 * applyReferencesToRules）无网络/LLM 依赖，可被测试直接 import。
 *
 * 网络 + LLM 的 searchPlatformRules 内部才动态 import 服务端依赖
 * （@/lib/core/workflow-model、ai、@app/shared/*），模块级零运行时依赖，
 * 保证测试文件 import 本模块时不触发任何服务端副作用。
 */
import type { PlatformRules } from "./types";

export type Confidence = "high" | "medium" | "low";

export type RuleField =
  | "commissionRate"
  | "fixedServiceFee"
  | "merchantDeliveryFee"
  | "customerDeliveryFee";

export interface RuleReference {
  field: RuleField;
  value: number | null; // null = 无可靠来源
  unit?: string; // "%" 或 "元/单"
  sourceUrl: string;
  sourceTitle?: string;
  publishedAt?: string;
  fetchedAt: number;
  region?: string;
  conditions: string[];
  confidence: Confidence;
  official: boolean;
}

const FIELDS: RuleField[] = ["commissionRate", "fixedServiceFee", "merchantDeliveryFee", "customerDeliveryFee"];

const OFFICIAL_SUFFIXES = ["taobao.com", "tmall.com", "alibaba.com", "aliyun.com", "alicdn.com"];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** 官方来源判定：域名恰为阿里系域名或为其子域名（按域名标签边界匹配） */
export function isOfficial(url: string): boolean {
  const host = hostOf(url).toLowerCase();
  return OFFICIAL_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

/** 确定性排序：官方优先 → 地区越具体越前 → 发布时间越新越前 → 抓取时间越新越前 */
export function rankSources(refs: RuleReference[]): RuleReference[] {
  return [...refs].sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    const ra = (a.region || "").length;
    const rb = (b.region || "").length;
    if (ra !== rb) return rb - ra;
    if ((a.publishedAt || "") !== (b.publishedAt || "")) {
      return (b.publishedAt || "").localeCompare(a.publishedAt || "");
    }
    return (b.fetchedAt || 0) - (a.fetchedAt || 0);
  });
}

/** 按 field 过滤 + 排序后，取首个 value != null 的引用，否则 null */
export function pickPrimary(refs: RuleReference[], field: RuleField): RuleReference | null {
  const ranked = rankSources(refs.filter((r) => r.field === field));
  return ranked.find((r) => r.value != null) ?? null;
}

/** 同一字段多来源且存在 >1 个不同值时返回中文冲突摘要，否则返回 "" */
export function mergeConflicts(refs: RuleReference[], field: RuleField): string {
  const values = refs.filter((r) => r.field === field && r.value != null);
  const distinct = new Map<number, RuleReference>();
  for (const r of values) {
    if (!distinct.has(r.value as number)) distinct.set(r.value as number, r);
  }
  if (distinct.size <= 1) return "";
  const parts = [...distinct.values()].map((r) => {
    const label = r.sourceTitle || hostOf(r.sourceUrl) || "来源";
    return `${label}(${r.value}${r.unit || ""})`;
  });
  return `多来源冲突：${parts.join(" vs ")}`;
}

/** 用检索到的引用覆盖平台规则；不可变返回新对象，未命中字段保持原值 */
export function applyReferencesToRules(refs: RuleReference[], current: PlatformRules): PlatformRules {
  const next: PlatformRules = { ...current };

  for (const field of FIELDS) {
    const primary = pickPrimary(refs, field);
    if (primary && primary.value != null) {
      if (field === "commissionRate" && primary.unit === "%") {
        next.commissionRate = primary.value / 100;
      } else if (field === "commissionRate") {
        next.commissionRate = primary.value;
      } else {
        next[field] = primary.value;
      }
    }
  }

  const sourcePrimary = FIELDS.map((f) => pickPrimary(refs, f)).find((p) => p != null);
  const conflictNote = FIELDS.map((f) => mergeConflicts(refs, f))
    .filter(Boolean)
    .join("；");

  if (sourcePrimary) {
    next.source = {
      sourceUrl: sourcePrimary.sourceUrl,
      publishedAt: sourcePrimary.publishedAt,
      fetchedAt: sourcePrimary.fetchedAt,
      region: sourcePrimary.region,
      confidence: sourcePrimary.confidence,
      conflictNote: conflictNote || undefined,
    };
  }

  next.confirmed = false;
  return next;
}

/**
 * 联网检索淘宝闪购平台规则（搜索 + 抓取 + flash 模型抽取）。
 * 任何环节失败一律降级返回 []（绝不抛错）。
 * 多组查询命中率更高，优先抓取官方来源（terms.alicdn.com / taobao.com 等）。
 */
export async function searchPlatformRules(input: { city?: string } = {}): Promise<RuleReference[]> {
  try {
    const { loadNetworkConfig } = await import("@app/shared/network.js");
    const { withTimeout } = await import("@app/shared/utils.js");

    const network = loadNetworkConfig();
    const base = `http://${network.hosts.local}:${network.ports.searchService}`;
    const city = input.city ? ` ${input.city}` : "";

    // 多组精准查询：官方服务费标准 > 商家入驻费率 > 配送/佣金规则
    const queries = [
      `淘宝闪购 软件服务费标准 商家 扣点 费率${city}`,
      `淘宝闪购 商家入驻 佣金 扣点 配送费 规则${city}`,
      `饿了么 淘宝闪购 商家 服务费率 配送${city}`,
    ];

    // 合并多组查询结果，按 URL 去重
    const seen = new Set<string>();
    const results: { title?: string; url?: string }[] = [];
    for (const query of queries) {
      const searchUrl = new URL(`${base}/search`);
      searchUrl.searchParams.set("query", query);
      searchUrl.searchParams.set("maxResults", "8");
      searchUrl.searchParams.set("fetchContent", "false");
      searchUrl.searchParams.set("strategy", "auto");
      const searchRes = await withTimeout(fetch(searchUrl), 15000, `search ${query}`);
      const searchJson = (await searchRes.json()) as { ok?: boolean; results?: { title?: string; url?: string }[] };
      if (!searchJson.ok || !Array.isArray(searchJson.results)) continue;
      for (const r of searchJson.results) {
        if (r.url && !seen.has(r.url)) {
          seen.add(r.url);
          results.push(r);
        }
      }
    }
    if (results.length === 0) return [];

    // 官方来源优先抓取，其余按原顺序补足
    const ordered = [...results].sort((a, b) => {
      const oa = isOfficial(a.url || "") ? 0 : 1;
      const ob = isOfficial(b.url || "") ? 0 : 1;
      return oa - ob;
    });
    const top = ordered.slice(0, 4);

    const scraped: { url: string; title?: string; markdown: string }[] = [];
    for (const r of top) {
      if (!r.url) continue;
      try {
        const scrapeUrl = new URL(`${base}/scrape`);
        scrapeUrl.searchParams.set("url", r.url);
        const res = await withTimeout(fetch(scrapeUrl), 20000, `scrape ${r.url}`);
        const json = (await res.json()) as { ok?: boolean; markdown?: string };
        if (json.ok && json.markdown) {
          scraped.push({ url: r.url, title: r.title, markdown: json.markdown.slice(0, 6000) });
        }
      } catch {
        // 单页抓取失败不阻断，继续下一源
      }
    }
    if (scraped.length === 0) return [];

    const { getWorkflowModel } = await import("@/lib/core/workflow-model");
    const { generateText } = await import("ai");

    const sources = scraped
      .map((s) => `【来源】${s.url}${s.title ? `（${s.title}）` : ""}\n${s.markdown}`)
      .join("\n\n---\n\n");

    const prompt = `你是淘宝闪购平台规则解析器。请从以下资料中提取平台对商家的收费规则，只输出 JSON，不要任何解释。

字段定义（值必须来自资料原文，资料没写的字段一律省略，严禁编造）：
- commissionRate：平台扣点/佣金/软件服务费率（百分比数值，如 5 表示 5%）
- fixedServiceFee：平台固定服务费（元/单）
- merchantDeliveryFee：商家承担配送费（元/单）
- customerDeliveryFee：向顾客收取配送费（元/单）

输出 JSON 结构：
{ "rules": [{ "field": "commissionRate", "value": 5, "unit": "%", "sourceUrl": "...", "region": "...", "confidence": "high", "conditions": ["..."] }] }

要求：
- sourceUrl 必须使用资料里给出的来源 URL，不得杜撰。
- confidence 只能是 high / medium / low。
- unit 只有 "%" 或 "元/单"。
- 若某字段在资料里有多处不同取值，以官方来源（terms.alicdn.com / taobao.com / tmall.com）为准，并把差异写进 conditions。

资料：
${sources}`;

    const { text } = await generateText({
      model: getWorkflowModel("flash"),
      prompt,
    });

    return parseModelOutput(text);
  } catch {
    return [];
  }
}

function parseModelOutput(text: string): RuleReference[] {
  try {
    const stripped = text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end < 0) return [];
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as { rules?: unknown };
    if (!parsed.rules || !Array.isArray(parsed.rules)) return [];

    const known: RuleField[] = FIELDS;
    const out: RuleReference[] = [];
    for (const raw of parsed.rules) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const field = r.field as RuleField;
      if (!known.includes(field)) continue;
      const sourceUrl = typeof r.sourceUrl === "string" ? r.sourceUrl : "";
      if (!sourceUrl) continue;

      const num = typeof r.value === "number" ? r.value : Number(r.value);
      const confidence = (["high", "medium", "low"].includes(r.confidence as string)
        ? r.confidence
        : "low") as Confidence;

      const unit = field === "commissionRate" ? "%" : "元/单";

      out.push({
        field,
        value: Number.isFinite(num) ? num : null,
        unit,
        sourceUrl,
        sourceTitle: typeof r.sourceTitle === "string" ? r.sourceTitle : undefined,
        publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : undefined,
        fetchedAt: Date.now(),
        region: typeof r.region === "string" ? r.region : undefined,
        conditions: Array.isArray(r.conditions) ? r.conditions.filter((c): c is string => typeof c === "string") : [],
        confidence,
        official: isOfficial(sourceUrl),
      });
    }
    return out;
  } catch {
    return [];
  }
}
