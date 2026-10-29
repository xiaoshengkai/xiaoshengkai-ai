/**
 * person-research HTTP 动作（custom handler，scene-groups 模式）：
 * select（选/排候选）与 continue（补充输入）负责重臂 research/report 步骤并回到 running，
 * 前端随后调既有 POST /execution/:id/auto（detached）驱动执行；
 * report（GET）组装面板数据。
 * 纯状态操作抽为 applyXxxInState 供单测。
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, readState, writeState } from "../../../lib/state.js";
import { loadClaims, loadSources, loadRounds, loadBusiness, saveClaims } from "./store.js";
import { applyCandidateRejection } from "./evidence.js";

const RESEARCH_STEP_IDS = ["research", "report"];
const CANDIDATE_ACTIONS = ["selected", "rejected", "ambiguous"];
// 商业意图检测：明确指向工商关系才触发固定商业查询集（"任职与公司关系"这类泛职业词不算）
const BUSINESS_INTENT_RE = /股东|持股|股份|法定代表人|法人代表|商业|工商|对外投资|实际控制|受益所有人|名下公司/;
// 深挖意图检测：用户主动要求放宽召回（低分来源降为 lead_only 线索）
const DEEP_DIG_RE = /深挖|挖深|再挖|更多线索/;

/** 候选 displayName/信号提取身份锚点（「不是这个人」按钮路径的负向锚点，规则法免 LLM） */
function extractAnchorsFromCandidate(c) {
  const anchors = new Set();
  const identity = String(c.displayName || "").split("·").slice(1).join("·");
  for (const part of identity.split(/[、,，/]/)) {
    const p = part.trim();
    if (p && p.length >= 2 && p.length <= 30) anchors.add(p);
  }
  for (const v of Object.values(c.signals || {})) {
    if (v && String(v).length >= 2) anchors.add(String(v));
  }
  return [...anchors].slice(0, 5);
}

function rearmResearchSteps(state) {
  for (const s of state.steps) {
    if (RESEARCH_STEP_IDS.includes(s.id)) {
      s.status = "pending";
      s.output = null;
      s.error = null;
      s.startedAt = null;
      s.elapsed = null;
      delete s.retryForce;
    }
  }
  state.status = "running";
}

export function applySelectInState(state, { candidateId, action }) {
  const research = state.research;
  if (!research) return { ok: false, error: "research 未初始化（先跑候选发现）" };
  if (!CANDIDATE_ACTIONS.includes(action)) {
    return { ok: false, error: `action 必须是 ${CANDIDATE_ACTIONS.join(" / ")}` };
  }
  const candidate = (research.candidates || []).find(c => c.id === candidateId);
  if (!candidate) return { ok: false, error: `候选不存在: ${candidateId}` };
  if (candidate.status === "rejected" && action === "selected") {
    return { ok: false, error: "候选已被排除，请先恢复待定再选定" };
  }

  if (action === "selected") {
    for (const c of research.candidates) {
      if (c.status === "selected") c.status = "unconfirmed";
    }
  }
  candidate.status = action;

  if (action === "selected") {
    research.pendingRound = {
      kind: "research",
      business: true,
      source: "selection",
      input: `已确认候选「${candidate.displayName}」，默认执行商业关系调查（股东/任职/对外投资）`,
    };
    rearmResearchSteps(state);
    return { ok: true, status: "running" };
  }
  return { ok: true, status: state.status };
}

export function applyContinueInState(state, message) {
  const research = state.research;
  if (!research) return { ok: false, error: "research 未初始化（先跑候选发现）" };
  const input = String(message || "").trim();
  if (!input) return { ok: false, error: "message 不能为空" };

  research.pendingRound = {
    kind: "research",
    source: "continue",
    business: BUSINESS_INTENT_RE.test(input),
    deep: DEEP_DIG_RE.test(input),
    input,
  };
  rearmResearchSteps(state);
  return { ok: true, status: "running" };
}

function withGuards(executionId, fn) {
  const dir = path.join(DATA_DIR, executionId);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) return { ok: false, error: "not found" };
  const state = readState(dir);
  if (state.template !== "person-research") return { ok: false, error: "非 person-research 任务" };
  if (state.status === "running") return { ok: false, error: "研究进行中，请等待本轮完成" };

  const result = fn(state);
  if (result.ok) writeState(dir, state);
  return result;
}

export async function handleSelect({ params, request }) {
  const { candidateId, action } = await request.json().catch(() => ({}));
  return withGuards(params.id, state => applySelectInState(state, { candidateId, action }));
}

export async function handleContinue({ params, request }) {
  const { message } = await request.json().catch(() => ({}));
  return withGuards(params.id, state => applyContinueInState(state, message));
}

export async function handleReport({ params }) {
  const dir = path.join(DATA_DIR, params.id);
  const stateFile = path.join(dir, "state.json");
  if (!fs.existsSync(stateFile)) return { ok: false, error: "not found" };
  const state = readState(dir);
  if (state.template !== "person-research") return { ok: false, error: "非 person-research 任务" };
  const research = state.research || {};

  let reportMd = null;
  try {
    reportMd = fs.readFileSync(path.join(dir, "report", "current.md"), "utf-8");
  } catch { /* 尚未生成 */ }

  return {
    ok: true,
    status: state.status,
    name: research.name || "",
    reportMd,
    reportVersion: research.reportVersion || 0,
    candidates: research.candidates || [],
    claims: loadClaims(dir),
    business: loadBusiness(dir),
    rounds: research.rounds || [],
    negativeAnchors: research.negativeAnchors || [],
    sources: loadSources(dir).map(s => ({
      id: s.id, url: s.url, title: s.title, domain: s.domain,
      domainClass: s.domainClass, scraped: s.scraped, snippet: (s.snippet || "").slice(0, 120),
      relevanceScore: s.relevanceScore ?? null,
      relevanceDecision: s.relevanceDecision ?? null,
      evidenceUse: s.evidenceUse ?? null,
    })),
  };
}

// ─── 整人排除 / 单条主张纠错（V1.2） ───────────────────────────────

/** 整人排除：候选 rejected + 摘要清空 + 主张连坐 + 负向锚点累积 + 置 redirect 研究轮（重新识别） */
export function applyCandidateRejectInState(state, claims, { candidateId, note }) {
  const research = state.research;
  if (!research) return { ok: false, error: "research 未初始化（先跑候选发现）" };
  const target = (research.candidates || []).find(c => c.id === candidateId);
  if (!target) return { ok: false, error: `候选不存在: ${candidateId}` };

  const anchors = extractAnchorsFromCandidate(target);
  const reason = String(note || "").trim()
    || (anchors.length > 0 ? `用户指出认错了人（非${anchors.join("、")}相关）` : "用户指出认错了人");
  const applied = applyCandidateRejection(claims, research.candidates, { candidateId, reason });

  research.candidates = applied.candidates;
  research.negativeAnchors = [...new Set([...(research.negativeAnchors || []), ...anchors])];
  research.pendingRound = {
    kind: "research",
    source: "redirect",
    business: false,
    deep: false,
    input: `已排除候选「${target.displayName}」，用已知线索重新识别目标人物`,
  };
  rearmResearchSteps(state);
  return {
    ok: true,
    status: "running",
    claims: applied.claims,
    negativeAnchors: anchors,
    rejectedClaims: claims.filter(c => c.status !== "rejected").length
      - applied.claims.filter(c => c.status !== "rejected").length,
  };
}

/** 单条主张「有误」：rejected + 理由，只重臂 report（不重跑研究） */
export function applyClaimRejectInState(state, claims, { claimId, note }) {
  const research = state.research;
  if (!research) return { ok: false, error: "research 未初始化（先跑候选发现）" };
  const target = claims.find(c => c.id === claimId);
  if (!target) return { ok: false, error: `主张不存在: ${claimId}` };

  target.status = "rejected";
  target.rejectedReason = String(note || "").trim() || "用户标记有误";

  for (const s of state.steps) {
    if (s.id === "report") {
      s.status = "pending";
      s.output = null;
      s.error = null;
      s.startedAt = null;
      s.elapsed = null;
      delete s.retryForce;
    }
  }
  state.status = "running";
  return { ok: true, status: "running" };
}

export async function handleCandidateReject({ params, request }) {
  const { candidateId, note } = await request.json().catch(() => ({}));
  const dir = path.join(DATA_DIR, params.id);
  return withGuards(params.id, state => {
    const result = applyCandidateRejectInState(state, loadClaims(dir), { candidateId, note });
    if (result.ok) saveClaims(dir, result.claims);
    return result;
  });
}

export async function handleClaimReject({ params, request }) {
  const { claimId, note } = await request.json().catch(() => ({}));
  const dir = path.join(DATA_DIR, params.id);
  return withGuards(params.id, state => {
    const claims = loadClaims(dir);
    const result = applyClaimRejectInState(state, claims, { claimId, note });
    if (result.ok) saveClaims(dir, claims);
    return result;
  });
}
