import test from "node:test";
import assert from "node:assert/strict";
import { deriveTerminalStatus } from "../../workflows/engine.js";

const steps = (...statuses) => statuses.map((status) => ({ status }));

test("全部 completed/skipped → completed", () => {
  assert.equal(deriveTerminalStatus(steps("completed", "skipped", "completed")), "completed");
});

test("含 warning 步 → completed_with_warnings（不被完成吞掉）", () => {
  assert.equal(deriveTerminalStatus(steps("completed", "warning", "completed")), "completed_with_warnings");
});

test("无步骤 → completed", () => {
  assert.equal(deriveTerminalStatus([]), "completed");
});
