import { validateStoryboard, validateSceneBatch, validateHtmlString, estimateSubtitleSec } from "./lib/schema.js";
import { buildDataJS } from "./lib/html-builder.js";

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
  console.log("\n── 双语字幕节奏 ──");

  await test("字幕时长公式：约 5-7 字/秒，[2.5, 4.5]", () => {
    assertEq(estimateSubtitleSec("一二三四五六七八九十"), 3.2, "10 字 → 1.0+2.2");
    assertEq(estimateSubtitleSec("短句"), 2.5, "短句夹到下限");
    assertEq(estimateSubtitleSec("这是一句特别长的字幕超过了二十个字的极限情况"), 4.5, "长句夹到上限");
  });

  console.log("\n── 分镜表 schema ──");

  const mkSb = (over = {}) => ({
    schemaVersion: 1,
    title: "那道门槛",
    thesis: "因果是反的",
    chapters: [{ label: "钩子" }, { label: "机制" }],
    beats: [
      { id: 1, role: "hook", chapter: 0, zh: "人越来越少，房子该跌了吧？", en: "Fewer people?", presentAction: "让观众动手", onScreen: "城市剪影", takeaway: "抛直觉" },
      { id: 2, role: "hook", chapter: 0, zh: "数据却说：不是。", en: "The data says no.", presentAction: "停住亮字", onScreen: "问号" },
      { id: 3, role: "title", chapter: 0, zh: "房价是怎么压低生育率的？", en: "How?", presentAction: "停住", onScreen: "片名卡" },
      { id: 4, role: "story", chapter: 1, zh: "二〇二二年人口首次负增长。", en: "First decline.", note: "国家统计局 2022", presentAction: "照句子演", onScreen: "年份" },
      { id: 5, role: "model", chapter: 1, zh: "一套房等于六年的「收入」", en: "Six years", note: "示意", presentAction: "照句子演", onScreen: "门槛" },
      { id: 6, role: "model", chapter: 1, zh: "涨到三十年，跨过去的更少。", en: "Thirty years.", presentAction: "小题现场跑", onScreen: "网格", note: "示意" },
      { id: 7, role: "reveal", chapter: 1, zh: "方向从一开始就「反」了。", en: "Reversed.", presentAction: "停住亮字", onScreen: "箭头翻转" },
      { id: 8, role: "outro", chapter: 1, zh: "是你眼前那道门槛。", en: "The threshold.", presentAction: "回场", onScreen: "门框" },
    ],
    ...over,
  });

  await test("合法分镜 + durationSec 自动补齐 + title 拍识别", () => {
    const r = validateStoryboard(mkSb());
    assert(r.ok, r.error);
    assertEq(r.storyboard.beats.length, 8);
    for (const b of r.storyboard.beats) {
      assert(b.durationSec != null && b.durationSec >= 2.5, `拍 ${b.id} durationSec 未补齐`);
    }
    assert(r.storyboard.beats.some(b => b.role === "title"), "title 拍应存在");
  });

  await test("chapter 越界拒绝", () => {
    const r = validateStoryboard(mkSb({ beats: mkSb().beats.map(b => ({ ...b, chapter: 5 })) }));
    assert(!r.ok);
    assert(r.error.includes("章节索引"));
  });

  await test("JSON 字符串输入 / 非法输入", () => {
    assert(validateStoryboard("not json").error.includes("合法 JSON"));
    const r = validateStoryboard(JSON.stringify(mkSb()));
    assert(r.ok, r.error);
  });

  console.log("\n── 数据表确定性组装 ──");

  await test("buildDataJS：字幕表 + 片名卡 + 章节/时间轴", () => {
    const sb = validateStoryboard(mkSb()).storyboard;
    const { dataJS, chapters, duration, subtitles } = buildDataJS(sb, { title: "那道门槛", theme: "vibe", orientation: "landscape", watermark: "@t" });
    assertEq(subtitles.length, 7, "title 拍不进字幕");
    assertEq(subtitles[0][2], "人越来越少，房子该跌了吧？", "普通句原样");
    const emSub = subtitles.find(s => s[2].includes("<em>"));
    assert(emSub && emSub[2] === "一套房等于六年的<em>收入</em>", "「」转 <em> 失败: " + subtitles[1][2]);
    assert(dataJS.includes("《那道门槛》"), "片名卡用 storyboard.title");
    assertEq(chapters.length, 2, "章节按 chapter 分组");
    assertEq(chapters[1].start, chapters[0].end, "章节时间连续");
    assert(duration > 0 && dataJS.includes(`"duration": ${duration}`), "时长写进 CFG");
    assert(dataJS.includes('"watermark": "@t"'));
    assert(dataJS.includes('"orientation": "landscape"'));
  });

  console.log("\n── 场景函数 lint ──");

  await test("确定性铁律：禁 Math.random / Date / 定时器 / 硬编码色与画幅", () => {
    const bad = [
      "function scene0(t){ var x = Math.random(); }",
      "function scene0(t){ var d = Date.now(); }",
      "function scene0(t){ setTimeout(f, 10); }",
      "function scene0(t){ requestAnimationFrame(f); }",
      "function scene0(t){ var w = 1920; }",
      "function scene0(t){ scc.fillStyle = '#FF0000'; }",
    ];
    for (const code of bad) {
      const errs = validateSceneBatch(code, ["scene0"]);
      assert(errs.length > 0, `应拒绝: ${code}`);
    }
  });

  await test("合法场景函数通过 + 缺函数拒绝 + 语法错误拒绝", () => {
    const good = `function scene0(t){ var lt=t-10; var k=easeInOut(clamp(lt/1.5,0,1)); scc.globalAlpha=k; drawCard(scc, W/2, H*0.35, 320, 180, 0, t); cardText(scc, '词', W/2, H*0.35, 64); scc.globalAlpha=1; }`;
    assertEq(validateSceneBatch(good, ["scene0"]).length, 0);
    assert(validateSceneBatch(good, ["scene1"]).some(e => e.includes("scene1")));
    assert(validateSceneBatch("", ["scene0"]).length > 0, "空代码拒绝");
    const syntaxErr = "function scene0(t){ var broken = ; }";
    assert(validateSceneBatch(syntaxErr, ["scene0"]).some(e => e.includes("语法错误")), "语法错误应被 new Function 抓到");
  });

  await test("markdown 围栏剔除由调用方负责（lint 只看内容）", () => {
    const code = "```js\nfunction scene0(t){ var lt = t - 1; var k = easeInOut(clamp(lt / 1.5, 0, 1)); scc.globalAlpha = k; drawCard(scc, W / 2, H * 0.35, 320, 180, 0, t); scc.globalAlpha = 1; }\n```";
    const errs = validateSceneBatch(code, ["scene0"]);
    assertEq(errs.length, 0, "围栏内容本身合法");
  });

  console.log("\n── 整页静态校验 ──");

  await test("validateHtmlString：render 入口 / 远程资源 / 未替换标记", () => {
    assert(validateHtmlString("<html>window.render=1</html>").length === 0);
    assert(validateHtmlString("<html>@import url(fonts.googleapis.com)</html>").some(e => e.includes("远程")));
    assert(validateHtmlString("<html>/*__DATA__*/</html>").some(e => e.includes("标记")));
    assert(validateHtmlString("<html>nothing</html>").some(e => e.includes("window.render")));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
