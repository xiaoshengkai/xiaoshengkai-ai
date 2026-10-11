import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaToType } from "./schema-to-ts.js";

test("原始类型", () => {
  assert.equal(schemaToType({ type: "string" }), "string");
  assert.equal(schemaToType({ type: "boolean" }), "boolean");
  assert.equal(schemaToType({ type: "integer" }), "number");
  assert.equal(schemaToType({ type: "number" }), "number");
  assert.equal(schemaToType({ type: "null" }), "null");
  assert.equal(schemaToType({ type: "file" }), "File");
});

test("未知/缺失类型 → unknown", () => {
  assert.equal(schemaToType(null), "unknown");
  assert.equal(schemaToType({}), "unknown");
  assert.equal(schemaToType({ type: "whatever" }), "unknown");
});

test("空对象 → Record", () => {
  assert.equal(schemaToType({ type: "object", properties: {} }), "Record<string, unknown>");
});

test("对象 + required/optional", () => {
  const out = schemaToType({
    type: "object",
    properties: { a: { type: "string" }, b: { type: "integer" } },
    required: ["a"],
  });
  assert.equal(out, "{\n  a: string\n  b?: number\n}");
});

test("嵌套对象内联 + 数组", () => {
  const out = schemaToType({
    type: "object",
    properties: {
      result: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
          },
        },
        required: ["data"],
      },
    },
    required: ["result"],
  });
  assert.equal(
    out,
    "{\n  result: {\n    data: {\n      id: number\n    }[]\n  }\n}",
  );
});

test("enum → 字面量联合", () => {
  assert.equal(schemaToType({ type: "string", enum: ["a", "b"] }), '"a" | "b"');
  assert.equal(schemaToType({ enum: [1, 2, 3] }), "1 | 2 | 3");
});

test("非法属性名加引号", () => {
  const out = schemaToType({
    type: "object",
    properties: { "foo-bar": { type: "string" }, "中文": { type: "number" } },
    required: ["foo-bar", "中文"],
  });
  assert.equal(out, '{\n  "foo-bar": string\n  "中文": number\n}');
});

test("description → JSDoc 注释（多行保留、*/ 转义）", () => {
  const out = schemaToType({
    type: "object",
    properties: {
      a: { type: "string", description: "第一行\n第二行" },
      b: { type: "string", description: "含 */ 结束符" },
    },
    required: ["a", "b"],
  });
  assert.equal(
    out,
    "{\n  /**\n   * 第一行\n   * 第二行\n   */\n  a: string\n  /**\n   * 含 *\\/ 结束符\n   */\n  b: string\n}",
  );
});

test("enum + enumDesc → 值备注列表", () => {
  const out = schemaToType({
    type: "object",
    properties: {
      t: {
        type: "string",
        description: "响应要求类型",
        enum: ["RADIO", "TEXT"],
        enumDesc: "RADIO :单选,单选下没有对比规则\nTEXT :文本",
      },
    },
  });
  assert.equal(
    out,
    '{\n  /**\n   * 响应要求类型\n   * - RADIO：单选,单选下没有对比规则\n   * - TEXT：文本\n   */\n  t?: "RADIO" | "TEXT"\n}',
  );
});

test("type 数组 → 联合", () => {
  assert.equal(schemaToType({ type: ["string", "null"] }), "string | null");
});
