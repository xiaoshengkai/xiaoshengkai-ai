/**
 * 人物相关性漏斗（V1.1）：
 *   规则评分（纯函数）→ ≥6 直接保留 / 3~5 边界 LLM 批量复核 / <3 丢弃（深挖降 lead_only）
 *   边界复核前限量抓正文；LLM 失败不阻塞轮次（严格丢弃 / 深挖 lead）。
 * 只有过门槛的来源才持久化与进入证据抽取，噪声只留 filterStats 计数。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { CONFIG } from "./config.js";
import { domainOf, domainClass, canonicalUrl } from "./normalize.js";
import { buildBoundaryReviewPrompt, validateBoundaryReviewOutput } from "./prompts.js";
import { scrape } from "./search-client.js";

function clueList(ctx) {
  const c = ctx.clues || {};
  return [c.school, c.company, c.city, c.occupation]
    .map(s => String(s || "").trim())
    .filter(s => s.length >= 2);
}

function knownUrlHit(url, knownUrl) {
  if (!knownUrl) return false;
  const a = canonicalUrl(url);
  const b = canonicalUrl(knownUrl);
  return Boolean(a) && Boolean(b) && (a === b || a.startsWith(`${b}`) || a.startsWith(`${b}/`) || a.startsWith(`${b}?`));
}

/**
 * 规则评分（纯函数）：姓名命中取最高档（标题5/摘要4/正文2，不叠加）；
 * 任一身份线索 +3；手机号/已知 URL 强锚点 +8；A 级 +2、B 级 +1。
 */
export function scoreSource(raw, ctx) {
  const title = String(raw.title || "");
  const snippet = String(raw.snippet || "");
  const blob = `${title} ${snippet}`;
  const content = String(raw.content || "");
  const matchedSignals = [];
  let score = 0;

  if (ctx.name && title.includes(ctx.name)) { score += 5; matchedSignals.push("name-title"); }
  else if (ctx.name && snippet.includes(ctx.name)) { score += 4; matchedSignals.push("name-snippet"); }
  else if (ctx.name && content.includes(ctx.name)) { score += 2; matchedSignals.push("name-content"); }

  if (clueList(ctx).some(clue => blob.includes(clue))) { score += 3; matchedSignals.push("clue"); }

  if (ctx.phone && blob.includes(ctx.phone)) { score += 8; matchedSignals.push("phone"); }
  if (knownUrlHit(raw.url, ctx.knownUrl)) { score += 8; matchedSignals.push("known-url"); }

  // 负向锚点（用户明确否定的人的身份特征）：命中 -6，基本必丢弃，仅留极端强锚点逃生通道
  const negAnchors = (ctx.negativeAnchors || []).filter(Boolean);
  if (negAnchors.some(a => blob.includes(a) || content.includes(a))) {
    score -= 6;
    matchedSignals.push("negative-anchor");
  }

  const cls = raw.domainClass || domainClass(domainOf(raw.url));
  if (cls === "A") score += 2;
  else if (cls === "B") score += 1;

  return { score, matchedSignals };
}

/** 规则分档（纯函数）：≥6 direct / 3~5 boundary / <3 dropped */
export function partitionSources(raws, ctx) {
  const direct = [], boundary = [], dropped = [];
  for (const raw of raws) {
    const { score, matchedSignals } = scoreSource(raw, ctx);
    const tagged = { ...raw, relevanceScore: score, matchedSignals };
    if (score >= CONFIG.RELEVANCE_DIRECT) direct.push(tagged);
    else if (score >= CONFIG.RELEVANCE_BOUNDARY) boundary.push(tagged);
    else dropped.push(tagged);
  }
  return { direct, boundary, dropped };
}

/**
 * 相关性管线（编排）：
 *   partition → 边界限量抓正文 + LLM 批量复核 → accepted(evidence)
 *   deep 模式：dropped 与未复核边界降为 leads（lead_only，≤ MAX_PERSISTED_DEEP）
 * 返回 { accepted, leads, stats }——调用方负责持久化上限与落盘。
 */
export async function runRelevancePipeline(raws, { ctx, deep = false }) {
  const stats = {
    scored: raws.length, direct: 0, boundary: 0, lowRelevance: 0,
    llmReviewed: 0, otherPerson: 0, llmIrrelevant: 0, reviewFailed: 0,
    accepted: 0, leadOnly: 0,
  };
  const { direct, boundary, dropped } = partitionSources(raws, ctx);
  stats.direct = direct.length;
  stats.boundary = boundary.length;
  stats.lowRelevance = dropped.length;

  // 边界复核：批量上限内送 LLM；复核前限量抓正文补判据
  const toReview = boundary.slice(0, CONFIG.LLM_REVIEW_BATCH_MAX);
  const scrapeTargets = toReview.slice(0, CONFIG.BOUNDARY_SCRAPE_MAX);
  const scrapedContent = new Map();
  await Promise.all(scrapeTargets.map(async r => {
    const md = await scrape(r.url);
    if (md) scrapedContent.set(r.url, md.slice(0, CONFIG.CONTENT_TRUNCATE));
  }));
  const reviewInput = toReview.map((r, i) => ({
    ...r,
    id: `b-${i + 1}`,
    domain: r.domain || domainOf(r.url),
    content: scrapedContent.get(r.url) || null,
  }));

  const reviews = reviewInput.length > 0 ? await reviewBoundarySources(ctx, reviewInput) : [];
  stats.llmReviewed = reviewInput.length;
  const reviewByCanonical = new Map();
  for (const v of reviews) {
    const src = reviewInput.find(s => s.id === v.sourceId);
    if (src) reviewByCanonical.set(src.canonicalUrl || canonicalUrl(src.url), v);
  }

  const accepted = [];
  for (const r of direct) {
    accepted.push(annotate(r, "direct", "evidence", null));
  }
  for (const r of reviewInput) {
    const cu = r.canonicalUrl || canonicalUrl(r.url);
    const v = reviewByCanonical.get(cu);
    if (v && v.decision === "relevant") {
      accepted.push(annotate({ ...r, content: r.content || null }, "llm", "evidence", v.candidateKey));
    } else if (v && v.decision === "other_person") {
      stats.otherPerson++;
    } else if (v) {
      stats.llmIrrelevant++;
    } else {
      stats.reviewFailed++; // 超批量上限或 LLM 失败：严格丢弃，深挖降 lead
    }
  }

  // 深挖：低分与未复核项降为 lead_only（≤ MAX_PERSISTED_DEEP）
  let leads = [];
  if (deep) {
    const unreviewed = reviewInput.filter(r => !reviewByCanonical.has(r.canonicalUrl || canonicalUrl(r.url)));
    leads = [...dropped, ...unreviewed, ...boundary.slice(CONFIG.LLM_REVIEW_BATCH_MAX)]
      .map(r => annotate(r, "lead", "lead_only", null))
      .slice(0, CONFIG.MAX_PERSISTED_DEEP);
  }

  stats.accepted = accepted.length;
  stats.leadOnly = leads.length;
  return { accepted, leads, stats };
}

/** 聚合站 lead 标注（商业轮：全文匹配页是线索不是证据，不进事实抽取） */
export function markLead(raw) {
  return {
    ...raw,
    relevanceScore: raw.relevanceScore ?? 0,
    relevanceDecision: "lead",
    matchedSignals: raw.matchedSignals || ["aggregator"],
    candidateHint: raw.candidateHint || null,
    evidenceUse: "lead_only",
  };
}

function annotate(r, decision, evidenceUse, candidateKey) {
  return {
    ...r,
    relevanceDecision: decision,
    matchedSignals: r.matchedSignals || [],
    candidateHint: candidateKey || null,
    evidenceUse,
  };
}

async function reviewBoundarySources(ctx, sources) {
  let parsed = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    const { system, user } = buildBoundaryReviewPrompt(ctx, sources);
    const finalUser = lastErr ? `${user}\n\n上次输出无法解析（${lastErr}），请严格只输出 JSON。` : user;
    try {
      const { text } = await callLLM({ system, user: finalUser });
      parsed = parseJSON(text);
    } catch (err) {
      lastErr = err.message;
      // API 级错误（内容过滤 422 / 配额 / 网络）重试无意义，早退按未复核处理
      if (/API 错误|HTTP|ECONN|timeout|超时/i.test(err.message)) break;
    }
  }
  if (!parsed) {
    console.warn(`[person-research] 边界复核失败（按未复核处理）: ${lastErr}`);
    return [];
  }
  return validateBoundaryReviewOutput(parsed, sources);
}
