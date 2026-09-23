import test from "node:test";
import assert from "node:assert/strict";
import { filterToolsByMode, WRITE_TOOLS, MODE_INFO, buildToolsSection } from "../../ai-chat/src/lib/modes";

const ALL = {
  readFile: {},
  searchWeb: {},
  searchKnowledge: {},
  generateImage: {},
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

test("chat 模式剥离全部写工具，保留只读工具", () => {
  const out = filterToolsByMode(ALL, "chat");
  assert.ok(out.readFile);
  assert.ok(out.searchWeb);
  assert.ok(out.searchKnowledge);
  assert.ok(out.generateImage);
  for (const w of WRITE_TOOLS) assert.ok(!(w in out), `chat 模式不应包含 ${w}`);
});

test("plan 模式剥离全部写工具，保留只读工具", () => {
  const out = filterToolsByMode(ALL, "plan");
  assert.ok(out.readFile);
  assert.ok(out.searchWeb);
  assert.ok(out.searchKnowledge);
  assert.ok(out.generateImage);
  for (const w of WRITE_TOOLS) assert.ok(!(w in out), `plan 模式不应包含 ${w}`);
});

test("WRITE_TOOLS 覆盖 exec/文件写/知识库写三类", () => {
  for (const t of ["exec", "writeFile", "appendFile", "replaceInFile", "createDirectory", "deleteFile", "moveFile", "addKnowledge", "updateKnowledge", "deleteKnowledge", "restoreKnowledgeById"]) {
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
  const build = buildToolsSection("build", true);
  assert.match(build, /exec\(/);
  assert.match(build, /addKnowledge/);
  assert.match(build, /replaceInFile/);

  for (const m of ["chat", "plan"] as const) {
    const s = buildToolsSection(m, true);
    assert.match(s, /searchKnowledge/);
    assert.doesNotMatch(s, /exec\(/, `${m} 不应广告 exec`);
    assert.doesNotMatch(s, /addKnowledge/, `${m} 不应广告 addKnowledge`);
    assert.doesNotMatch(s, /replaceInFile/, `${m} 不应广告 replaceInFile`);
  }
});

test("无工具时给出降级提示", () => {
  assert.match(buildToolsSection("chat", false), /无可用工具/);
  assert.match(buildToolsSection("build", false), /无可用工具/);
});
