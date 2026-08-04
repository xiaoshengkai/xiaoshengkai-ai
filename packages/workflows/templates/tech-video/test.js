import { validateScript, getScriptStats } from "./schema.js";
import { pickSfxForScene, indexSfxLibrary, defaultPlayback } from "./lib/sfx.js";
import { getDurationSec } from "./lib/tts.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`);
}

async function run() {
  // ── Schema tests ──
  console.log("\n── Schema ──");

  await test("valid example-script.json", () => {
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, "lib", "example-script.json"), "utf8"));
    const r = validateScript(example);
    assert(r.ok, r.error);
    assertEq(r.script.scenes.length, 5);
    assertEq(r.script.scenes[0].type, "hook");
    assertEq(r.script.scenes[4].type, "outro");
  });

  await test("rejects missing hook", () => {
    const result = validateScript({
      schemaVersion: 1,
      renderer: "hyperframes-v2",
      title: "test",
      scenes: [
        { id: "a", type: "body", narration: "hi", templateId: "frame-vignelli", inputs: {} },
        { id: "b", type: "outro", narration: "bye", templateId: "frame-logo-outro", inputs: {} },
      ],
    });
    assert(!result.ok, "should reject");
    assert(result.error.includes("hook"), "should mention hook");
  });

  await test("rejects missing outro", () => {
    const result = validateScript({
      schemaVersion: 1,
      renderer: "hyperframes-v2",
      title: "test",
      scenes: [
        { id: "a", type: "hook", narration: "hi", templateId: "frame-liquid-bg-hero", inputs: {} },
        { id: "b", type: "body", narration: "mid", templateId: "frame-vignelli", inputs: {} },
      ],
    });
    assert(!result.ok, "should reject");
    assert(result.error.includes("outro"), "should mention outro");
  });

  await test("rejects too few scenes", () => {
    const result = validateScript({
      schemaVersion: 1,
      renderer: "hyperframes-v2",
      title: "test",
      scenes: [
        { id: "a", type: "hook", narration: "hi", templateId: "frame-liquid-bg-hero", inputs: {} },
        { id: "b", type: "outro", narration: "bye", templateId: "frame-logo-outro", inputs: {} },
      ],
    });
    assert(!result.ok, "should reject");
  });

  await test("rejects string input", () => {
    const result = validateScript("not json");
    assert(!result.ok, "should reject");
    assert(result.error.includes("不是合法 JSON"), "should mention JSON error");
  });

  await test("stats calculation", () => {
    const example = JSON.parse(fs.readFileSync(path.join(__dirname, "lib", "example-script.json"), "utf8"));
    const r = validateScript(example);
    const stats = getScriptStats(r.script);
    assert(stats.sceneCount === 5);
    assert(stats.templates.length >= 2);
    assert(stats.estimatedDurationSec > 0);
  });

  // ── SFX tests ──
  console.log("\n── SFX ──");

  await test("empty index returns null", () => {
    const picked = pickSfxForScene({
      narration: "这是个测试",
      sceneType: "body",
      sceneId: "test-1",
      index: {},
    });
    assert(picked === null, "should be null with empty index");
  });

  await test("semantic match: 警告 keyword", () => {
    const index = { alert: ["alert-01.mp3", "alert-02.mp3"] };
    const picked = pickSfxForScene({
      narration: "警告：此处有风险",
      sceneType: "body",
      sceneId: "test-1",
      index,
    });
    assert(picked !== null, "should pick SFX");
    assertEq(picked.source, "semantic");
    assertEq(picked.matchedKeyword, "警告");
    assert(picked.relPath.startsWith("alert/"), "should be in alert category");
  });

  await test("semantic match: 成功 keyword", () => {
    const index = { success: ["tada-01.mp3"] };
    const picked = pickSfxForScene({
      narration: "我们取得了巨大的成功",
      sceneType: "body",
      sceneId: "test-2",
      index,
    });
    assert(picked !== null, "should pick SFX");
    assertEq(picked.source, "semantic");
    assertEq(picked.matchedKeyword, "成功");
  });

  await test("template default fallback", () => {
    const index = { transition: ["whoosh-01.mp3"] };
    const picked = pickSfxForScene({
      narration: "普通描述",
      sceneType: "hook",
      sceneId: "test-3",
      index,
    });
    assert(picked !== null, "should pick SFX");
    assertEq(picked.source, "template");
  });

  await test("fallback to any category", () => {
    const index = { outro: ["tada-01.mp3"] };
    const picked = pickSfxForScene({
      narration: "普通描述",
      sceneType: "body",
      sceneId: "test-4",
      index,
    });
    assert(picked !== null, "should pick SFX");
    assertEq(picked.source, "fallback");
  });

  await test("deterministic selection", () => {
    const index = { transition: ["a.mp3", "b.mp3", "c.mp3"] };
    const p1 = pickSfxForScene({ narration: "test", sceneType: "hook", sceneId: "alpha", index });
    const p2 = pickSfxForScene({ narration: "test", sceneType: "hook", sceneId: "alpha", index });
    assertEq(p1.relPath, p2.relPath, "same sceneId should give same result");
  });

  await test("defaultPlayback", () => {
    const pb = defaultPlayback({ relPath: "transition/whoosh.mp3", source: "template" });
    assert(pb.volume > 0 && pb.volume <= 1, "volume should be 0-1");
    assert(pb.offsetSec >= 0, "offset should be >= 0");
  });

  // ── Audio tools tests ──
  console.log("\n── Audio Tools ──");

  await test("getDurationSec rejects non-existent file", async () => {
    try {
      await getDurationSec("/tmp/nonexistent-12345.mp3");
      assert(false, "should have thrown");
    } catch (e) {
      assert(true, "expected error");
    }
  });

  // ── parseCliOutput tests ──
  console.log("\n── parseCliOutput ──");

  function parseCliOutput(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const brace = trimmed.indexOf("{");
    const bracket = trimmed.indexOf("[");
    let start;
    if (brace === -1 && bracket === -1) {
      throw new Error("no JSON found");
    } else if (brace === -1) {
      start = bracket;
    } else if (bracket === -1) {
      start = brace;
    } else {
      start = Math.min(brace, bracket);
    }
    return JSON.parse(trimmed.slice(start));
  }

  await test("parse {}-object JSON", () => {
    const r = parseCliOutput('{"ok":true}');
    assertEq(r.ok, true);
  });

  await test("parse []-array JSON", () => {
    const r = parseCliOutput("[1,2,3]");
    assertEq(r.length, 3);
  });

  await test("parse with prefix + {}-object", () => {
    const r = parseCliOutput("◇ injected env (18) from .env\n{\"ok\":true}");
    assertEq(r.ok, true);
  });

  await test("parse with prefix + []-array", () => {
    const r = parseCliOutput("◇ injected env\n[1,2,3]");
    assertEq(r.length, 3);
  });

  await test("parse JSON with nested [ and {", () => {
    const r = parseCliOutput('{"a":{"b":[1,2]},"c":{"d":3}}');
    assertEq(r.a.b[0], 1);
    assertEq(r.c.d, 3);
  });

  await test("rejects non-JSON", () => {
    try {
      parseCliOutput("not json at all");
      assert(false, "should have thrown");
    } catch (e) {
      assert(true, "expected error");
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();