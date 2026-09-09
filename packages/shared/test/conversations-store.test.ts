import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ponytail: CONVERSATIONS_DIR 测试缝隙，隔离真实 data/conversations
process.env.CONVERSATIONS_DIR = mkdtempSync(path.join(tmpdir(), "conv-store-"));

const { writeConversation, renameConversation, readConversation } = await import(
  "../../ai-chat/src/app/api/conversations/_lib/store"
);

test.after(() => {
  rmSync(process.env.CONVERSATIONS_DIR!, { recursive: true, force: true });
});

test("重命名后再次 save 不覆盖用户改的标题", () => {
  writeConversation("conv-t1", "首条消息自动标题", [{ role: "user" }]);

  const renamed = renameConversation("conv-t1", "我的重命名");
  assert.equal(renamed?.title, "我的重命名");

  writeConversation("conv-t1", "新的首条消息", [{ role: "user" }, { role: "assistant" }]);
  assert.equal(readConversation("conv-t1")?.title, "我的重命名");
});

test("重命名不存在的对话返回 null", () => {
  assert.equal(renameConversation("conv-nope", "x"), null);
});

test("mode 字段持久化，缺省默认 chat", () => {
  writeConversation("conv-m1", "标题", [{ role: "user" }], "deepseek", "plan");
  assert.equal(readConversation("conv-m1")?.mode, "plan");

  writeConversation("conv-m1", "标题2", [{ role: "user" }]);
  assert.equal(readConversation("conv-m1")?.mode, "plan");

  writeConversation("conv-m2", "标题", [{ role: "user" }]);
  assert.equal(readConversation("conv-m2")?.mode, "chat");
});
