/**
 * 外卖开店模拟器 — 销量与推广预测引擎
 * ============================================================================
 * 纯函数（competitorMedian / averageTicket / baseOrderRange / clampPromotionBudget /
 * buildPredictionContext / parsePredictionJson / applyBaselinePrediction）无网络/LLM/随机，
 * 可被测试直接 import。
 *
 * 副作用函数 predictSales 内部才动态 import 服务端依赖
 * （@/lib/core/workflow-model、ai、@app/shared/*），模块级零运行时依赖，
 * 保证测试文件 import 本模块时不触发任何服务端副作用。
 *
 * 预测只产出销量/推广估计，绝不重算利润（利润由 calculate.ts 负责）。
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Competitor,
  MerchantStore,
  SalesPhasePrediction,
  SalesPrediction,
} from "./types";

/** 预测结果减去 id/createdAt（纯函数不产生随机/时间，由调用方补齐） */
export type SalesPredictionInput = Omit<SalesPrediction, "id" | "createdAt">;

/** 返回 monthlyOrders 中位数；空数组返回 0；忽略 monthlyOrders<=0 的项 */
export function competitorMedian(competitors: Competitor[]): number {
  const orders = competitors
    .map((c) => c.monthlyOrders)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (orders.length === 0) return 0;
  const mid = Math.floor(orders.length / 2);
  if (orders.length % 2 === 1) return orders[mid];
  return (orders[mid - 1] + orders[mid]) / 2;
}

/** 返回 avgTicket 均值（忽略 0 值）；空返回 0 */
export function averageTicket(competitors: Competitor[]): number {
  const tickets = competitors.map((c) => c.avgTicket).filter((n) => n > 0);
  if (tickets.length === 0) return 0;
  return tickets.reduce((s, n) => s + n, 0) / tickets.length;
}

/** 确定性基础区间（纯公式，禁止随机/Date.now） */
export function baseOrderRange(store: MerchantStore): {
  conservative: number;
  baseline: number;
  optimistic: number;
} {
  const loc = store.locations.find((l) => l.selected) ?? store.locations[0];
  const comps = loc?.competitorList ?? [];
  const med = competitorMedian(comps);
  const poiCount = loc?.poi?.length ?? 0;
  const radius = loc?.deliveryRadius ?? 0;

  // ponytail: 无竞店用经验底值 200；录入真实竞店后以其中位数 80% 为准（可能高于或低于底值）——真实市场信号优先于猜测
  let baseline = med > 0 ? med * 0.8 : 200; // 新店约为竞店中位数 80%，无竞店给经验底值 200
  baseline += poiCount * 40; // 每类 POI 加成
  baseline += Math.max(0, radius - 2) * 30; // 配送半径越大需求越广
  baseline = Math.max(20, Math.round(baseline));

  const conservative = Math.max(10, Math.round(baseline * 0.6));
  const optimistic = Math.round(baseline * 1.5);
  return { conservative, baseline, optimistic };
}

/** cap<=0 视为无上限，返回 max(0,budget)；否则返回 min(max(0,budget), cap) */
export function clampPromotionBudget(budget: number, cap: number): number {
  const b = Math.max(0, budget);
  if (cap <= 0) return b;
  return Math.min(b, cap);
}

/** 拼装中文预测上下文（确定性数据，纯函数） */
export function buildPredictionContext(store: MerchantStore): string {
  const loc = store.locations.find((l) => l.selected) ?? store.locations[0];
  const comps = loc?.competitorList ?? [];
  const med = competitorMedian(comps);
  const ticket = averageTicket(comps);
  const poiCount = loc?.poi?.length ?? 0;
  const radius = loc?.deliveryRadius ?? 0;
  const base = baseOrderRange(store);
  const cap = store.profile.promotionBudgetCap;

  const compLines =
    comps.length > 0
      ? comps
          .map(
            (c) =>
              `- ${c.name}：月售 ${c.monthlyOrders}，客单价 ${c.avgTicket} 元，评分 ${c.rating}，距离 ${c.distance}km，活动 ${c.activities || "无"}`,
          )
          .join("\n")
      : "（无结构化竞店数据）";

  const productLines =
    store.products.map((p) => `- ${p.name}：售价 ${p.price} 元`).join("\n") || "（无商品）";
  const basketLines =
    store.baskets.map((b) => `- ${b.name}：订单占比 ${b.orderShare}%`).join("\n") ||
    "（无购物篮）";
  const activityLines =
    store.activities.list.length > 0 ? store.activities.list.map((a) => a.type).join("、") : "无";

  return [
    `店铺品类：${store.profile.category || "未填"}`,
    `城市：${store.profile.city || "未填"}`,
    `开店阶段：${store.profile.stage}`,
    `目标月净利润：${store.profile.targetNetProfit} 元`,
    `月推广预算上限：${cap > 0 ? `${cap} 元` : "未设置（无上限）"}`,
    `竞店中位数月售：${med}，竞店平均客单价：${ticket} 元`,
    `竞店列表：\n${compLines}`,
    `周边 POI 数：${poiCount}，配送半径：${radius} km`,
    `商品：\n${productLines}`,
    `购物篮：\n${basketLines}`,
    `平台规则：${store.platformRules.platform}，扣点 ${store.platformRules.commissionRate ?? "未知"}`,
    `活动：${activityLines}`,
    `确定性基础区间（保守/基准/乐观自然订单）：${base.conservative} / ${base.baseline} / ${base.optimistic}`,
  ].join("\n");
}

function toFinite(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function toNonNegInt(v: unknown): number | null {
  const n = toFinite(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function fallbackPhase(monthIndex: number, base: ReturnType<typeof baseOrderRange>): SalesPhasePrediction {
  return {
    monthIndex,
    conservative: base.conservative,
    baseline: base.baseline,
    optimistic: base.optimistic,
    promotionBudget: 0,
    promotionOrders: 0,
    notes: [],
  };
}

const predictionInputSchema = z.object({
  confidence: z.unknown().optional(),
  basis: z.array(z.unknown()).optional(),
  sources: z.array(z.unknown()).optional(),
  assumptions: z.array(z.unknown()).optional(),
  missing: z.array(z.unknown()).optional(),
  phases: z.array(z.unknown()).optional(),
});

const salesPredictionPhaseSchema = z.object({
  monthIndex: z.number().int().min(1).max(4),
  conservative: z.number().finite(),
  baseline: z.number().finite(),
  optimistic: z.number().finite(),
  promotionBudget: z.number().finite(),
  promotionOrders: z.number().finite(),
  notes: z.array(z.string()),
});

const salesPredictionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.array(z.string()),
  sources: z.array(z.string()),
  assumptions: z.array(z.string()),
  missing: z.array(z.string()),
  phases: z.array(salesPredictionPhaseSchema),
});

/**
 * 防御性解析模型返回的 JSON：剥代码围栏/前缀噪声 → JSON.parse → Zod 校验 → 数字钳制。
 * 失败返回 null。返回不含 id/createdAt（由调用方补齐）。
 */
export function parsePredictionJson(text: string, store: MerchantStore): SalesPredictionInput | null {
  try {
    const trimmed = text.trim();
    let jsonText = trimmed;
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      jsonText = fence[1].trim();
    } else {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end <= start) return null;
      jsonText = trimmed.slice(start, end + 1);
    }

    const raw = JSON.parse(jsonText);
    const parsed = predictionInputSchema.parse(raw);

    const base = baseOrderRange(store);
    const cap = store.profile.promotionBudgetCap;

    const phaseMap = new Map<number, SalesPhasePrediction>();
    const rawPhases = Array.isArray(parsed.phases) ? parsed.phases : [];
    for (const item of rawPhases) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const mi = Math.round(toFinite(obj.monthIndex));
      if (![1, 2, 3, 4].includes(mi)) continue;

      const c = toNonNegInt(obj.conservative);
      const b = toNonNegInt(obj.baseline);
      const o = toNonNegInt(obj.optimistic);
      const pOrders = toNonNegInt(obj.promotionOrders);
      const validOrder = c !== null && b !== null && o !== null && pOrders !== null && c <= b && b <= o;

      const phase: SalesPhasePrediction = validOrder
        ? {
            monthIndex: mi,
            conservative: c as number,
            baseline: b as number,
            optimistic: o as number,
            promotionBudget: clampPromotionBudget(toNonNegInt(obj.promotionBudget) ?? 0, cap),
            promotionOrders: pOrders as number,
            notes: stringArray(obj.notes),
          }
        : fallbackPhase(mi, base);

      if (!phaseMap.has(mi)) phaseMap.set(mi, phase);
    }

    const phases = [1, 2, 3, 4].map((mi) => phaseMap.get(mi) ?? fallbackPhase(mi, base));

    const confidence = (["low", "medium", "high"].includes(parsed.confidence as string)
      ? (parsed.confidence as "low" | "medium" | "high")
      : "low");

    return {
      confidence,
      basis: stringArray(parsed.basis),
      sources: stringArray(parsed.sources),
      assumptions: stringArray(parsed.assumptions),
      missing: stringArray(parsed.missing),
      phases,
    };
  } catch {
    return null;
  }
}

/**
 * 采用预测前对客户端提交的完整 SalesPrediction 做服务端重校验 + 归一化。
 * 非法返回 null；合法则逐阶段钳制负数归 0、订单取整、违规三档回退 baseOrderRange、
 * promotionBudget 经 clampPromotionBudget 裁到上限。
 */
export function sanitizePrediction(input: unknown, store: MerchantStore): SalesPrediction | null {
  const parsed = salesPredictionSchema.safeParse(input);
  if (!parsed.success) return null;

  const base = baseOrderRange(store);
  const cap = store.profile.promotionBudgetCap;

  const phases = parsed.data.phases.map((p) => {
    const conservative = Math.max(0, Math.round(p.conservative));
    const baseline = Math.max(0, Math.round(p.baseline));
    const optimistic = Math.max(0, Math.round(p.optimistic));
    if (!(conservative <= baseline && baseline <= optimistic)) {
      return fallbackPhase(p.monthIndex, base);
    }
    return {
      monthIndex: p.monthIndex,
      conservative,
      baseline,
      optimistic,
      promotionBudget: clampPromotionBudget(p.promotionBudget, cap),
      promotionOrders: Math.max(0, Math.round(p.promotionOrders)),
      notes: p.notes,
    };
  });

  return {
    id: parsed.data.id,
    createdAt: parsed.data.createdAt,
    confidence: parsed.data.confidence,
    basis: parsed.data.basis,
    sources: parsed.data.sources,
    assumptions: parsed.data.assumptions,
    missing: parsed.data.missing,
    phases,
  };
}

/** 把 salesPrediction.phases 的 baseline/promotionBudget/promotionOrders 写入 store.sales（不可变） */
export function applyBaselinePrediction(store: MerchantStore): MerchantStore {
  const pred = store.salesPrediction;
  if (!pred) return store;

  const sales = store.sales.map((s) => {
    const p = pred.phases.find((ph) => ph.monthIndex === s.monthIndex);
    if (!p) return s;
    return {
      ...s,
      naturalOrders: p.baseline,
      promotionBudget: p.promotionBudget,
      promotionOrders: p.promotionOrders,
    };
  });

  return { ...store, sales };
}

/** 确定性降级预测：base 三档 × 爬坡系数（month1=0.4 … 稳定期=1.0） */
function fallbackInput(store: MerchantStore): SalesPredictionInput {
  const base = baseOrderRange(store);
  const ramps = [0.4, 0.6, 0.8, 1.0];
  const phases = ramps.map((r, i) => ({
    monthIndex: i + 1,
    conservative: Math.max(0, Math.round(base.conservative * r)),
    baseline: Math.max(0, Math.round(base.baseline * r)),
    optimistic: Math.max(0, Math.round(base.optimistic * r)),
    promotionBudget: 0,
    promotionOrders: 0,
    notes: [],
  }));

  return {
    confidence: "low",
    basis: ["未获取到可靠公开资料，采用店铺基础数据的确定性估算"],
    sources: [],
    assumptions: ["按四阶段爬坡系数估算自然订单（第1月 40%、第2月 60%、第3月 80%、稳定期 100%）"],
    missing: ["同城同品类公开订单资料", "竞店实时月售数据"],
    phases,
  };
}

const PREDICTION_PROMPT = `你是外卖开店销量预测助手。你只能依据给定店铺数据与公开资料，输出四阶段（第1/2/3月 + 稳定期）的保守/基准/乐观自然订单、推荐推广预算、预计新增订单。

必须遵守：
1. 只输出一个 JSON 对象，不要任何解释文字、Markdown 代码块或前后缀。
2. 严禁编造淘宝闪购内部大数据；资料没有的不写。
3. 严禁重算利润，只做销量与推广推测。
4. 推荐推广预算（promotionBudget）不得大于店铺的月推广预算上限；无竞店或资料少时给保守低值。
5. 每个阶段的 conservative <= baseline <= optimistic，且均为非负整数。

JSON 结构（严格按此）：
{
  "confidence": "low" | "medium" | "high",
  "basis": ["依据1", ...],
  "sources": ["来源URL1", ...],
  "assumptions": ["假设1", ...],
  "missing": ["缺失信息1", ...],
  "phases": [
    { "monthIndex": 1, "conservative": 0, "baseline": 0, "optimistic": 0, "promotionBudget": 0, "promotionOrders": 0, "notes": [] },
    { "monthIndex": 2, "...": "..." },
    { "monthIndex": 3, "...": "..." },
    { "monthIndex": 4, "...": "..." }
  ]
}`;

/**
 * 联网搜索同城同品类公开资料 → flash 模型产出四阶段预测 → parsePredictionJson 校验。
 * 任何环节失败一律降级为确定性估算（绝不抛错）。
 */
export async function predictSales(store: MerchantStore): Promise<SalesPrediction> {
  const wrap = (input: SalesPredictionInput): SalesPrediction => ({
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  });

  try {
    const context = buildPredictionContext(store);

    let sources: string[] = [];
    let docs = "";
    try {
      const { loadNetworkConfig } = await import("@app/shared/network.js");
      const { withTimeout } = await import("@app/shared/utils.js");
      const network = loadNetworkConfig();
      const baseUrl = `http://${network.hosts.local}:${network.ports.searchService}`;

      const query =
        `淘宝闪购 ${store.profile.category || ""} 外卖 月售 订单量 ${store.profile.city || ""}`.trim();

      const searchUrl = new URL(`${baseUrl}/search`);
      searchUrl.searchParams.set("query", query);
      searchUrl.searchParams.set("maxResults", "6");
      searchUrl.searchParams.set("fetchContent", "false");
      searchUrl.searchParams.set("strategy", "auto");
      const searchRes = await withTimeout(fetch(searchUrl), 15000, `search ${query}`);
      const searchJson = (await searchRes.json()) as {
        ok?: boolean;
        results?: { title?: string; url?: string }[];
      };
      const results = searchJson.ok && Array.isArray(searchJson.results) ? searchJson.results : [];

      const scraped: { url: string; title?: string; markdown: string }[] = [];
      for (const r of results.slice(0, 2)) {
        if (!r.url) continue;
        try {
          const scrapeUrl = new URL(`${baseUrl}/scrape`);
          scrapeUrl.searchParams.set("url", r.url);
          const res = await withTimeout(fetch(scrapeUrl), 20000, `scrape ${r.url}`);
          const json = (await res.json()) as { ok?: boolean; markdown?: string };
          if (json.ok && json.markdown) {
            scraped.push({ url: r.url, title: r.title, markdown: json.markdown.slice(0, 3000) });
          }
        } catch {
          // 单页抓取失败不阻断
        }
      }

      sources = scraped.map((s) => s.url);
      if (scraped.length > 0) {
        docs = scraped
          .map((s) => `【来源】${s.url}${s.title ? `（${s.title}）` : ""}\n${s.markdown}`)
          .join("\n\n---\n\n");
      }
    } catch {
      sources = [];
    }

    const { getWorkflowModel } = await import("@/lib/core/workflow-model");
    const { generateText } = await import("ai");

    const prompt =
      `以下是你必须依据、且不得修改的店铺数据：\n\n${context}\n\n` +
      (docs ? `公开资料：\n\n${docs}\n\n` : "") +
      `请输出四阶段销量与推广预测 JSON。`;

    const { text } = await generateText({
      model: getWorkflowModel("flash"),
      prompt: `${PREDICTION_PROMPT}\n\n${prompt}`,
    });

    const parsed = parsePredictionJson(text, store);
    if (!parsed) return wrap(fallbackInput(store));
    return wrap(parsed);
  } catch {
    return wrap(fallbackInput(store));
  }
}
