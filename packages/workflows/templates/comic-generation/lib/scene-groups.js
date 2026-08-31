import path from "node:path";
import { DATA_DIR, readState, writeState } from "../../../lib/state.js";

function scriptFromStep(scriptStep) {
  const out = typeof scriptStep?.output === "string" ? JSON.parse(scriptStep.output) : scriptStep?.output;
  const script = typeof out?.script === "string" ? JSON.parse(out.script) : out?.script;
  return { out, script };
}

export function updateSceneGroupInState(state, pageNo, mode) {
  const scriptStep = state.steps?.find(s => s.id === "script");
  const { out, script } = scriptFromStep(scriptStep);
  const pages = script?.pages;
  if (!Array.isArray(pages)) return { ok: false, error: "暂无分镜" };

  const idx = pages.findIndex(p => Number(p.page) === Number(pageNo));
  if (idx < 0) return { ok: false, error: `第 ${pageNo} 页不存在` };

  if (mode === "merge-prev") {
    if (idx === 0) return { ok: false, error: "第一页不能并入上一场景" };
    pages[idx].sceneId = pages[idx - 1].sceneId;
    pages[idx].scenePrompt = pages[idx - 1].scenePrompt;
  } else if (mode === "new-scene") {
    pages[idx].sceneId = `${pages[idx].sceneId || "scene"}-${pageNo}`;
  } else {
    return { ok: false, error: "unknown mode" };
  }

  out.script = JSON.stringify(script, null, 2);
  out.pagesJson = JSON.stringify(pages);
  scriptStep.output = out;
  return { ok: true, page: Number(pageNo), sceneId: pages[idx].sceneId };
}

export function updateSceneGroup(executionId, pageNo, mode) {
  const dir = path.join(DATA_DIR, executionId);
  const state = readState(dir);
  const result = updateSceneGroupInState(state, pageNo, mode);
  if (result.ok) writeState(dir, state);
  return result;
}

export async function handle({ params, body }) {
  return updateSceneGroup(params.id, body?.page, body?.mode);
}
