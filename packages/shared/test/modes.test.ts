import test from "node:test";
import assert from "node:assert/strict";
import {
  filterToolsByMode,
  filterWebTools,
  WRITE_TOOLS,
  CHAT_DENY,
  WEB_TOOLS,
  MODE_INFO,
  buildToolsSection,
} from "../../ai-chat/src/lib/modes";

const ALL = {
  readFile: {},
  searchWeb: {},
  searchKnowledge: {},
  generateImage: {},
  loadSkill: {},
  generateXiaohongshuNote: {},
  checkXiaohongshuNoteProgress: {},
  updateXiaohongshuNote: {},
  exportXiaohongshuNote: {},
  scrapeWebPage: {},
  mapWebsite: {},
  crawlWebsite: {},
  parseDocument: {},
  exec: {},
  writeFile: {},
  deleteFile: {},
  addKnowledge: {},
  restoreKnowledgeById: {},
};

test("build 模式保留全部工具（原对象引用）", () => {
  const out = filterToolsByMode(ALL, "build");
  assert.equal(out, ALL);
});

test("chat 模式剥离写工具与 skill/笔记，保留只读与生成工具", () => {
  const out = filterToolsByMode(ALL, "chat");
  assert.ok(out.readFile);
  assert.ok(out.searchWeb);
  assert.ok(out.searchKnowledge);
  assert.ok(out.generateImage);
  for (const w of WRITE_TOOLS) assert.ok(!(w in out), `chat 模式不应包含 ${w}`);
  for (const w of CHAT_DENY) assert.ok(!(w in out), `chat 模式不应包含 ${w}`);
});

test("plan 模式剥离写工具，保留 skill 与笔记生成", () => {
  const out = filterToolsByMode(ALL, "plan");
  assert.ok(out.readFile);
  assert.ok(out.searchWeb);
  assert.ok(out.searchKnowledge);
  assert.ok(out.generateImage);
  assert.ok(out.loadSkill, "plan 应保留 loadSkill");
  assert.ok(out.generateXiaohongshuNote, "plan 应保留 generateXiaohongshuNote");
  for (const w of WRITE_TOOLS) assert.ok(!(w in out), `plan 模式不应包含 ${w}`);
});

test("webSearch=false 剥离全部联网工具", () => {
  const out = filterWebTools(ALL, false);
  assert.ok(out.searchKnowledge);
  assert.ok(out.readFile);
  for (const w of WEB_TOOLS) assert.ok(!(w in out), `关闭联网时不应包含 ${w}`);
});

test("webSearch=true 保留联网工具", () => {
  const out = filterWebTools(ALL, true);
  assert.equal(out, ALL);
});

test("WRITE_TOOLS 覆盖 exec/文件写/知识库写/笔记改·导出", () => {
  for (const t of ["exec", "writeFile", "appendFile", "replaceInFile", "createDirectory", "deleteFile", "moveFile", "addKnowledge", "updateKnowledge", "deleteKnowledge", "restoreKnowledgeById", "updateXiaohongshuNote", "exportXiaohongshuNote"]) {
    assert.ok(WRITE_TOOLS.has(t), `缺少 ${t}`);
  }
});

test("MODE_INFO 覆盖三种模式，canWrite 与写工具权限一致", () => {
  assert.deepEqual(Object.keys(MODE_INFO).sort(), ["build", "chat", "plan"]);
  assert.equal(MODE_INFO.chat.canWrite, false);
  assert.equal(MODE_INFO.plan.canWrite, false);
  assert.equal(MODE_INFO.build.canWrite, true);
  for (const m of ["chat", "plan", "build"] as const) {
    assert.ok(MODE_INFO[m].label.length > 0, `${m} 缺 label`);
    assert.ok(MODE_INFO[m].instruction.length > 0, `${m} 缺 instruction`);
  }
});

test("plan 指令要求只读并产出计划", () => {
  const t = MODE_INFO.plan.instruction;
  assert.match(t, /只读/);
  assert.match(t, /计划/);
});

test("工具清单：build 广告写工具，chat/plan 不广告", () => {
  const build = buildToolsSection("build", true, true);
  assert.match(build, /exec\(/);
  assert.match(build, /addKnowledge/);
  assert.match(build, /replaceInFile/);

  for (const m of ["chat", "plan"] as const) {
    const s = buildToolsSection(m, true, true);
    assert.match(s, /searchKnowledge/);
    assert.doesNotMatch(s, /exec\(/, `${m} 不应广告 exec`);
    assert.doesNotMatch(s, /addKnowledge/, `${m} 不应广告 addKnowledge`);
    assert.doesNotMatch(s, /replaceInFile/, `${m} 不应广告 replaceInFile`);
  }
});

test("工具清单：chat 不广告 skill 与小红书笔记，plan 广告", () => {
  assert.doesNotMatch(buildToolsSection("chat", true, true), /loadSkill/);
  assert.doesNotMatch(buildToolsSection("chat", true, true), /generateXiaohongshuNote/);
  assert.match(buildToolsSection("plan", true, true), /loadSkill/);
  assert.match(buildToolsSection("plan", true, true), /generateXiaohongshuNote/);
});

test("工具清单：webSearch=false 不广告联网工具", () => {
  assert.doesNotMatch(buildToolsSection("build", true, false), /searchWeb/);
  assert.match(buildToolsSection("build", true, true), /searchWeb/);
});

test("无工具时给出降级提示", () => {
  assert.match(buildToolsSection("chat", false), /无可用工具/);
  assert.match(buildToolsSection("build", false), /无可用工具/);
});
