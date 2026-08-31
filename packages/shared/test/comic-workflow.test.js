import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

import { buildPrompt } from "../../workflows/templates/comic-generation/lib/generate-pages.js";
import { validateStoryboard } from "../../workflows/templates/comic-generation/lib/storyboard.js";
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
  assert(prompt.includes("老周: 40年？"));
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
