/**
 * person-research 任务内持久化：state.research 字段 + sources/ + claims.json + rounds/ + report/
 * （手机号原始值另存 private.json，见 privacy.js）
 */
import fs from "node:fs";
import path from "node:path";
import { readState, writeState, ensureDir } from "../../../lib/state.js";

// ─── state.research ───────────────────────────────────────────────

export function initResearch(executionDir, { name, clues }) {
  const state = readState(executionDir);
  state.research = {
    name,
    clues,
    candidates: [],
    claimIds: [],
    rounds: [],
    nextSourceSeq: 1,
    nextClaimSeq: 1,
    reportVersion: 0,
    pendingRound: null,
  };
  writeState(executionDir, state);
  return state.research;
}

export function getResearch(executionDir) {
  return readState(executionDir).research || null;
}

export function updateResearch(executionDir, patch) {
  const state = readState(executionDir);
  if (!state.research) throw new Error("research 未初始化");
  state.research = { ...state.research, ...patch };
  writeState(executionDir, state);
  return state.research;
}

export function allocSourceIds(executionDir, n) {
  const state = readState(executionDir);
  if (!state.research) throw new Error("research 未初始化");
  const ids = Array.from({ length: n }, (_, i) => `s-${state.research.nextSourceSeq + i}`);
  state.research.nextSourceSeq += n;
  writeState(executionDir, state);
  return ids;
}

export function allocClaimIds(executionDir, n) {
  const state = readState(executionDir);
  if (!state.research) throw new Error("research 未初始化");
  const ids = Array.from({ length: n }, (_, i) => `c-${state.research.nextClaimSeq + i}`);
  state.research.nextClaimSeq += n;
  writeState(executionDir, state);
  return ids;
}

// ─── sources/<id>.json ────────────────────────────────────────────

export function saveSource(executionDir, source) {
  ensureDir(path.join(executionDir, "sources"));
  fs.writeFileSync(path.join(executionDir, "sources", `${source.id}.json`), JSON.stringify(source, null, 2));
}

export function loadSources(executionDir) {
  const dir = path.join(executionDir, "sources");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ─── claims.json ──────────────────────────────────────────────────

export function loadClaims(executionDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(executionDir, "claims.json"), "utf-8"));
  } catch {
    return [];
  }
}

export function saveClaims(executionDir, claims) {
  fs.writeFileSync(path.join(executionDir, "claims.json"), JSON.stringify(claims, null, 2));
}

// ─── rounds/00N-kind.json ─────────────────────────────────────────

export function saveRound(executionDir, round) {
  ensureDir(path.join(executionDir, "rounds"));
  const file = `${String(round.n).padStart(3, "0")}-${round.kind}.json`;
  fs.writeFileSync(path.join(executionDir, "rounds", file), JSON.stringify(round, null, 2));
}

export function loadRounds(executionDir) {
  const dir = path.join(executionDir, "rounds");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ─── business.json（结构化商业关系） ───────────────────────────────

export function loadBusiness(executionDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(executionDir, "business.json"), "utf-8"));
  } catch {
    return [];
  }
}

export function saveBusiness(executionDir, relations) {
  fs.writeFileSync(path.join(executionDir, "business.json"), JSON.stringify(relations, null, 2));
}

// ─── report/v00N.md + current.md ──────────────────────────────────

export function writeReport(executionDir, md) {
  const state = readState(executionDir);
  if (!state.research) throw new Error("research 未初始化");
  const version = state.research.reportVersion + 1;
  ensureDir(path.join(executionDir, "report"));
  fs.writeFileSync(path.join(executionDir, "report", `v${String(version).padStart(3, "0")}.md`), md);
  fs.writeFileSync(path.join(executionDir, "report", "current.md"), md);
  state.research.reportVersion = version;
  writeState(executionDir, state);
  return version;
}
