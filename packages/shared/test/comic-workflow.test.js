import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { buildAnchorPrompt, buildPrompt } from "../../workflows/templates/comic-generation/lib/generate-pages.js";
import { buildStoryboardPrompt, validateStoryboard } from "../../workflows/templates/comic-generation/lib/storyboard.js";
import { retryStep } from "../../workflows/engine.js";
import { DATA_DIR } from "../../workflows/lib/state.js";
import { replaceComicPage } from "../../workflows/templates/comic-generation/lib/tweak.js";

test("comic storyboard rejects overlong dialogue and missing scene fields", () => {
  const errors = validateStoryboard({
    pages: [{
      page: 1,
      imagePrompt: "【背景】银行柜台【人物】左:老周【构图】中景【说话人】老周",
      cast: [{ name: "老周", side: "left" }],
      dialogue: ["老周: 这句话明显超过十二个中文字符"],
    }],
  });

  assert(errors.some(e => e.includes("sceneId")));
  assert(errors.some(e => e.includes("scenePrompt")));
  assert(errors.some(e => e.includes("对白过长")));
});

test("comic image prompt carries reusable scene prompt", () => {
  const prompt = buildPrompt({
    imagePrompt: "【人物】左:老周(皱眉) 右:小李(微笑)【构图】中景【说话人】老周",
    sceneId: "bank-counter",
    scenePrompt: "固定场景：银行柜台，计算器在桌面左侧，合同在桌面中间，老周在左，小李在右。",
    cast: [{ name: "老周", side: "left" }, { name: "小李", side: "right" }],
    dialogue: ["老周: 40年？"],
  }, "黑白简笔漫画");

  assert(prompt.includes("场景ID：bank-counter"));
  assert(prompt.includes("固定场景：银行柜台"));
  assert(prompt.includes("气泡内只写：40年？"));
  assert(!prompt.includes("气泡内只写：老周"));
});

test("comic scene anchor prompt excludes dialogue and bubbles", () => {
  const prompt = buildAnchorPrompt({
    sceneId: "bank-counter",
    scenePrompt: "固定场景：银行柜台，老周在左，小李在右。",
    imagePrompt: "【人物】左:老周(皱眉) 右:小李(微笑)",
    cast: [{ name: "老周", side: "left" }, { name: "小李", side: "right" }],
    dialogue: ["老周: 40年？"],
  }, "黑白简笔漫画");

  assert(prompt.includes("固定场景：银行柜台"));
  assert(prompt.includes("禁止出现任何文字、对白框、气泡和气泡尾巴"));
  assert(prompt.includes("无明显情绪的基础脸"));
  assert(prompt.includes("背景和道具必须全部位于人物轮廓后方"));
  assert(prompt.includes("不得穿过或遮挡人物轮廓、脸部"));
  assert(prompt.includes("人物基础站位：老周在左、小李在右"));
  assert(!prompt.includes("40年"));
});

test("comic image prompt maps each dialogue tail to its speaker side", () => {
  const prompt = buildPrompt({
    imagePrompt: "【人物】左:老周 右:小李【构图】中景",
    cast: [{ name: "老周", side: "left" }, { name: "小李", side: "right" }],
    dialogue: ["老周: 结论：40年？", "小李：是的。"],
  }, "黑白简笔漫画");

  assert(prompt.includes("气泡内只写：结论：40年？"));
  assert(prompt.includes("气泡内只写：是的。"));
  assert(prompt.includes("说话人定位（禁止绘制）：左侧的老周；气泡尾巴尖端必须指向并接触左侧的老周"));
  assert(prompt.includes("说话人定位（禁止绘制）：右侧的小李；气泡尾巴尖端必须指向并接触右侧的小李"));
  assert(!prompt.includes("气泡内只写：老周"));
  assert(!prompt.includes("气泡内只写：小李"));
  assert(prompt.includes("视觉层级固定为：背景最低层，人物位于背景上方，气泡、尾巴和文字位于最高层"));
  assert(prompt.includes("必须覆盖参考锚点的基础脸和姿态"));
});

test("comic storyboard prompt makes actions match limb-less character style", () => {
  const prompt = buildStoryboardPrompt("Characters have no limbs, no arms or legs.");

  assert(prompt.includes("当前画风：Characters have no limbs, no arms or legs."));
  assert(prompt.includes("无肢体角色禁止描述抓手、摊手、挥手、指向、迈步等手脚动作"));
  assert(prompt.includes("身体倾斜、人物距离、视线、眼睛、嘴型、动作线和情绪符号"));
});

test("comic prompts enforce character fidelity and size from reference image", () => {
  const page = {
    imagePrompt: "【人物】左:老周【构图】中景",
    sceneId: "bank-counter",
    scenePrompt: "固定场景：银行柜台",
    cast: [{ name: "老周", side: "left" }],
    dialogue: [],
  };

  for (const prompt of [buildPrompt(page, "黑白简笔漫画"), buildAnchorPrompt(page, "黑白简笔漫画")]) {
    assert(prompt.includes("人物造型必须复用参考图中的具体设计"));
    assert(prompt.includes("每个人物高度占画面高度的50%-70%"));
    assert(prompt.includes("画风文字描述与参考图冲突时，一律以参考图为准"));
  }
});

test("replaceComicPage copies uploaded image into selected page and updates state", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "comic-replace-"));
  const projectRoot = path.join(dir, "project");
  const execDir = path.join(dir, "exec");
  mkdirSync(path.join(projectRoot, "data/static/images"), { recursive: true });
  mkdirSync(path.join(execDir, "pages"), { recursive: true });
  const uploadPath = path.join(projectRoot, "data/static/images/replacement.png");
  const pagePath = path.join(execDir, "pages/page-03.png");
  writeFileSync(uploadPath, "new-image");
  writeFileSync(pagePath, "old-image");
  writeFileSync(path.join(execDir, "state.json"), JSON.stringify({
    tweakCount: 2,
    steps: [{ id: "generate-pages", output: { pages: [{ page: 3, file: "pages/page-03.png", dialogue: ["老周: 40年？"] }] } }],
  }));

  try {
    const result = replaceComicPage(execDir, 3, "/api/uploads/replacement.png", projectRoot);
    const state = JSON.parse(fs.readFileSync(path.join(execDir, "state.json"), "utf-8"));

    assert.deepEqual(result, { ok: true, file: "pages/page-03.png" });
    assert.equal(fs.readFileSync(pagePath, "utf-8"), "new-image");
    assert.equal(state.steps[0].output.pages[0].replaced, true);
    assert.equal(state.tweakCount, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("retryStep marks forced generate-pages retries without deleting existing files", () => {
  const executionId = `test-retry-${Date.now()}`;
  const execDir = path.join(DATA_DIR, executionId);
  mkdirSync(path.join(execDir, "pages"), { recursive: true });
  writeFileSync(path.join(execDir, "pages/page-01.png"), "old-image");
  writeFileSync(path.join(execDir, "state.json"), JSON.stringify({
    executionId,
    template: "comic-generation",
    status: "completed",
    steps: [{ id: "generate-pages", status: "completed", output: { pages: [] }, error: null }],
  }));

  try {
    retryStep(executionId, "generate-pages", { force: true });
    const state = JSON.parse(fs.readFileSync(path.join(execDir, "state.json"), "utf-8"));

    assert.equal(state.steps[0].status, "pending");
    assert.equal(state.steps[0].retryForce, true);
    assert.equal(fs.readFileSync(path.join(execDir, "pages/page-01.png"), "utf-8"), "old-image");
  } finally {
    rmSync(execDir, { recursive: true, force: true });
  }
});


test("retryStep force on script invalidates downstream comic page generation", () => {
  const executionId = `test-retry-chain-${Date.now()}`;
  const execDir = path.join(DATA_DIR, executionId);
  mkdirSync(execDir, { recursive: true });
  writeFileSync(path.join(execDir, "state.json"), JSON.stringify({
    executionId,
    template: "comic-generation",
    status: "completed",
    steps: [
      { id: "script", status: "completed", output: { script: "{}" }, error: null },
      { id: "generate-pages", status: "completed", output: { pages: [{ page: 1 }] }, error: null },
    ],
  }));

  try {
    retryStep(executionId, "script", { force: true });
    const state = JSON.parse(fs.readFileSync(path.join(execDir, "state.json"), "utf-8"));

    assert.equal(state.steps[0].retryForce, true);
    assert.equal(state.steps[1].status, "pending");
    assert.equal(state.steps[1].output, null);
    assert.equal(state.steps[1].retryForce, true);
  } finally {
    rmSync(execDir, { recursive: true, force: true });
  }
});


test("updateSceneGroup merges a page into the previous scene", async () => {
  const { updateSceneGroupInState } = await import("../../workflows/templates/comic-generation/lib/scene-groups.js");
  const state = {
    steps: [{ id: "script", output: { script: JSON.stringify({ pages: [
      { page: 1, sceneId: "bank", scenePrompt: "固定场景：银行柜台", imagePrompt: "p1", dialogue: [] },
      { page: 2, sceneId: "bank-close", scenePrompt: "固定场景：银行近景", imagePrompt: "p2", dialogue: [] },
    ] }) } }],
  };

  const result = updateSceneGroupInState(state, 2, "merge-prev");
  const script = JSON.parse(state.steps[0].output.script);

  assert.deepEqual(result, { ok: true, page: 2, sceneId: "bank" });
  assert.equal(script.pages[1].sceneId, "bank");
  assert.equal(script.pages[1].scenePrompt, "固定场景：银行柜台");
  assert.equal(state.steps[0].output.pagesJson, JSON.stringify(script.pages));
});
