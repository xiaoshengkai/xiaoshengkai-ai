import { validateScript, validateStoryboard, checkScriptAgainstStoryboard, estimateDurationSec } from "./lib/schema.js";
import { chunkBeats, validateBatchScenes, BATCH_SIZE } from "./lib/prompt-builder.js";

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
  console.log("\n── Storyboard schema ──");

  await test("valid storyboard parses + durationSec 自动补齐", () => {
    const sb = {
      schemaVersion: 1,
      thesis: "不是A导致B，是B压低了A",
      instrument: "右上角表盘：量当前比例",
      coreMetaphor: "365 格生日日历",
      beats: [
        { id: 1, role: "hook", narration: "教室里坐了二十三个人", presentAction: "让观众动手", onScreen: "课桌逐个亮起", sceneType: "stat-card", note: "示意", takeaway: "抛出直觉" },
        { id: 2, role: "reveal", narration: "答案接近一半", presentAction: "停住亮字", onScreen: "问号", sceneType: "quote" },
        { id: 3, role: "outro", narration: "运气从此有了形状", presentAction: "回场", onScreen: "日历收拢", sceneType: "quote", takeaway: "回扣主题" },
      ],
    };
    const r = validateStoryboard(sb);
    assert(r.ok, r.error);
    assertEq(r.storyboard.beats.length, 3);
    for (const b of r.storyboard.beats) {
      assert(b.durationSec != null && b.durationSec >= 2, `beat ${b.id} durationSec 未补齐`);
    }
    assertEq(r.storyboard.thesis, "不是A导致B，是B压低了A");
    assertEq(r.storyboard.instrument, "右上角表盘：量当前比例");
    assertEq(r.storyboard.beats[0].note, "示意");
    assertEq(r.storyboard.beats[1].note, undefined, "缺省 note 应保持 undefined（在途执行兼容）");
    assertEq(r.storyboard.beats[2].takeaway, "回扣主题");
  });

  await test("storyboard JSON 字符串输入", () => {
    const r = validateStoryboard(JSON.stringify({ schemaVersion: "1", beats: [{ id: "a", narration: "x" }] }));
    assert(!r.ok, "1 拍应低于 min(3) 校验");
  });

  await test("非法 JSON 拒绝", () => {
    const r = validateStoryboard("not json");
    assert(!r.ok);
    assert(r.error.includes("合法 JSON"));
  });

  await test("时长公式：4.5 字/秒 + 0.5s 呼吸", () => {
    assertEq(estimateDurationSec(""), 2); // 空串 → max(2, 0.5) = 2
    assertEq(estimateDurationSec("一二三四五六七八九"), 2.5); // 9 字 → ceil(2) + 0.5
    assertEq(estimateDurationSec("一二三四五"), 2.5); // 5 字 → ceil(1.11) + 0.5 → max(2, 2.5)
    assertEq(estimateDurationSec("一二三四五六七八九十一二三四五六七八九十一二三四"), 6.5); // 24 字
  });

  console.log("\n── script × storyboard 一致性 ──");

  await test("一致时无告警", () => {
    const script = { scenes: [
      { narration: "甲句" }, { narration: "乙句" },
    ] };
    const sb = { beats: [
      { narration: "甲句" }, { narration: "乙句" },
    ] };
    assertEq(checkScriptAgainstStoryboard(script, sb).length, 0);
  });

  await test("旁白漂移报软告警", () => {
    const script = { scenes: [
      { narration: "甲句" }, { narration: "乙句改了" },
    ] };
    const sb = { beats: [
      { narration: "甲句" }, { narration: "乙句" },
    ] };
    const warnings = checkScriptAgainstStoryboard(script, sb);
    assertEq(warnings.length, 1);
    assert(warnings[0].includes("第 2 幕"));
  });

  await test("数量不一致告警", () => {
    const warnings = checkScriptAgainstStoryboard(
      { scenes: [{ narration: "a" }] },
      { beats: [{ narration: "a" }, { narration: "b" }] }
    );
    assertEq(warnings.length, 1);
    assert(warnings[0].includes("场景数 1"));
  });

  await test("空输入安全", () => {
    assertEq(checkScriptAgainstStoryboard(null, null).length, 0);
    assertEq(checkScriptAgainstStoryboard({ scenes: [{ narration: "a" }] }, undefined).length, 0);
  });

  console.log("\n── 分批生成 ──");

  await test("chunkBeats 切批", () => {
    const beats = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    const chunks = chunkBeats(beats, 4);
    assertEq(chunks.length, 3);
    assertEq(chunks[0].length, 4);
    assertEq(chunks[2].length, 2);
    assertEq(BATCH_SIZE, 4);
  });

  const mkBeat = (id, narration, dur) => ({ id, role: "hook", narration, presentAction: "照句子演", onScreen: "x", sceneType: "stat-card", durationSec: dur });
  const mkScene = (id, narration, dur, html) => ({
    id: String(id), type: "hook", narration,
    html: html ?? `<div class="clip" id="clip-${id}" data-duration="${dur}"><div class="title">x</div></div>`,
    css: ".a{}", jsAnimation: "var tl=1;",
  });

  await test("批内校验：通过", () => {
    const beats = [mkBeat(1, "甲句", 4), mkBeat(2, "乙句", 5.5)];
    const scenes = [mkScene(1, "甲句", 4), mkScene(2, "乙句", 5.5)];
    assertEq(validateBatchScenes(scenes, beats).length, 0);
  });

  await test("批内校验：数量/旁白/时长/clip 标记", () => {
    const beats = [mkBeat(1, "甲句", 4), mkBeat(2, "乙句", 5.5)];
    let errs = validateBatchScenes([mkScene(1, "甲句", 4)], beats);
    assertEq(errs.length, 1);
    assert(errs[0].includes("场景数 1"));

    errs = validateBatchScenes([mkScene(1, "甲句改了", 4), mkScene(2, "乙句", 5.5)], beats);
    assert(errs.some(e => e.includes("narration")));

    errs = validateBatchScenes([mkScene(1, "甲句", 3), mkScene(2, "乙句", 5.5)], beats);
    assert(errs.some(e => e.includes("data-duration=3 != 4")));

    errs = validateBatchScenes([{ ...mkScene(1, "甲句", 4), html: `<div class="clip">no id</div>` }, mkScene(2, "乙句", 5.5)], beats);
    assert(errs.some(e => e.includes("id=\"clip-1\"")));
    assert(errs.some(e => e.includes("data-duration")));
  });

  await test("批内校验：script 标签与远程资源拒绝", () => {
    const beats = [mkBeat(1, "甲句", 4)];
    let errs = validateBatchScenes([{ ...mkScene(1, "甲句", 4), html: `<div class="clip" id="clip-1" data-duration="4"><script src="https://x.js"></script></div>` }], beats);
    assert(errs.some(e => e.includes("script")));
    errs = validateBatchScenes([{ ...mkScene(1, "甲句", 4), html: `<div class="clip" id="clip-1" data-duration="4"><link rel="stylesheet" href="https://x.css"></div>` }], beats);
    assert(errs.some(e => e.includes("远程")));
  });

  await test("批内校验：非数组输出", () => {
    assertEq(validateBatchScenes({ scenes: [] }, [mkBeat(1, "a", 3)]).length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
