import test from "node:test";
import assert from "node:assert/strict";
import { filterToolsByMode, WRITE_TOOLS } from "../../ai-chat/src/lib/modes";

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

test("edit 模式保留全部工具（原对象引用）", () => {
  const out = filterToolsByMode(ALL, "edit");
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
