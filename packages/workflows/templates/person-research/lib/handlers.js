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
import { loadClaims, loadSources, loadRounds, loadBusiness } from "./store.js";

const RESEARCH_STEP_IDS = ["research", "report"];
const CANDIDATE_ACTIONS = ["selected", "rejected", "ambiguous"];
// 商业意图检测：明确指向工商关系才触发固定商业查询集（"任职与公司关系"这类泛职业词不算）
const BUSINESS_INTENT_RE = /股东|持股|股份|法定代表人|法人代表|商业|工商|对外投资|实际控制|受益所有人|名下公司/;
// 深挖意图检测：用户主动要求放宽召回（低分来源降为 lead_only 线索）
const DEEP_DIG_RE = /深挖|挖深|再挖|更多线索/;

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
    sources: loadSources(dir).map(s => ({
      id: s.id, url: s.url, title: s.title, domain: s.domain,
      domainClass: s.domainClass, scraped: s.scraped, snippet: (s.snippet || "").slice(0, 120),
    })),
  };
}
