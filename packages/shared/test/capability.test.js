import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchPath, parseCliOutput, createCapabilityHandler } from "../capability.js";

test("matchPath: 精确 / 参数 / 通配 / 不匹配", () => {
  assert.deepEqual(matchPath("/templates", ["templates"]), { params: {}, rest: [] });
  assert.deepEqual(matchPath("/execution/:id/next", ["execution", "abc", "next"]), {
    params: { id: "abc" }, rest: [],
  });
  assert.deepEqual(matchPath("/execution/:id/file/*", ["execution", "abc", "file", "videos", "v0.mp4"]), {
    params: { id: "abc" }, rest: ["videos", "v0.mp4"],
  });
  assert.equal(matchPath("/execution/:id/file/*", ["execution", "abc", "file"]), null);
  assert.equal(matchPath("/templates", ["templates", "x"]), null);
  assert.equal(matchPath("/a/:id", ["b", "x"]), null);
});

test("parseCliOutput: 噪音包裹 / 数组 / 无 JSON 抛错", () => {
  assert.deepEqual(parseCliOutput('{"ok":true}'), { ok: true });
  assert.deepEqual(parseCliOutput('noise\n{"a":{"b":1}}\ntail'), { a: { b: 1 } });
  assert.deepEqual(parseCliOutput('[1,2]'), [1, 2]);
  assert.deepEqual(parseCliOutput('{"s":"含{和}的字符串"}'), { s: "含{和}的字符串" });
  assert.throws(() => parseCliOutput("no json here"));
  assert.equal(parseCliOutput(""), null);
});

function makeTmpCli() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "capability-test-"));
  const cliPath = path.join(tmp, "cli.js");
  fs.writeFileSync(cliPath, `
const [cmd, argJson] = process.argv.slice(2);
const args = JSON.parse(argJson || "{}");
if (cmd === "echo") process.stdout.write(JSON.stringify({ ok: true, args }));
else if (cmd === "notfound") process.stdout.write(JSON.stringify({ error: "not found" }));
else if (cmd === "boom") { console.error("boom"); process.exit(1); }
`);
  return { tmp, cliPath };
}

async function call(handler, method, segments, init) {
  const req = new Request("http://test.local/" + segments.join("/"), init);
  return handler[method](req, { params: Promise.resolve({ path: segments }) });
}

const jsonInit = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("cli 原语: 参数映射 + 返回透传", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [
      { type: "cli", method: "POST", path: "/execution/:id/next", command: "echo",
        args: { executionId: "param.id", extra: "body.extra" }, timeout: 10000 },
    ],
  });
  const res = await call(handler, "POST", ["execution", "abc", "next"], jsonInit({ extra: 42 }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, { ok: true, args: { executionId: "abc", extra: 42 } });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("cli 原语: required 缺失 → 400", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [
      { type: "cli", method: "POST", path: "/skip", command: "echo",
        args: { stepId: "body.stepId" }, required: ["stepId"] },
    ],
  });
  const res = await call(handler, "POST", ["skip"], jsonInit({}));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: "missing stepId" });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("cli 原语: version=0 合法（required 不误杀 falsy）", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [
      { type: "cli", method: "POST", path: "/sw", command: "echo",
        args: { version: "body.version" }, required: ["version"] },
    ],
  });
  const res = await call(handler, "POST", ["sw"], jsonInit({ version: 0 }));
  assert.equal(res.status, 200);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("cli 原语: notFound 映射 → 404", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [
      { type: "cli", method: "GET", path: "/get", command: "notfound",
        notFound: { field: "error", value: "not found" } },
    ],
  });
  const res = await call(handler, "GET", ["get"]);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("cli 原语: 子进程失败 → 500 {ok:false}", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [{ type: "cli", method: "GET", path: "/boom", command: "boom" }],
  });
  const res = await call(handler, "GET", ["boom"]);
  assert.equal(res.status, 500);
  const data = await res.json();
  assert.equal(data.ok, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("stream 原语: 全量 + Range 206 + 穿越守卫", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(path.join(dataDir, "exec1"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "exec1", "a.txt"), "0123456789");

  const handler = createCapabilityHandler({
    cliPath,
    actions: [{ type: "stream", method: "GET", path: "/execution/:id/file/*", dir: dataDir }],
  });

  const full = await call(handler, "GET", ["execution", "exec1", "file", "a.txt"]);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "0123456789");

  const ranged = await call(handler, "GET", ["execution", "exec1", "file", "a.txt"], {
    headers: { range: "bytes=2-5" },
  });
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), "2345");
  assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10");

  const traversal = await call(handler, "GET", ["execution", "exec1", "file", "..", "..", "..", "cli.js"]);
  assert.equal(traversal.status, 403);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("upload 原语: 写入 + 扩展名拒绝", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const destDir = path.join(tmp, "uploads");
  const handler = createCapabilityHandler({
    cliPath,
    actions: [{ type: "upload", method: "POST", path: "/upload", destDir, allowExt: [".mp3"], error: "不支持的音频格式" }],
  });

  const fd = new FormData();
  fd.append("file", new File([Buffer.from("hello")], "bgm.mp3"));
  const ok = await call(handler, "POST", ["upload"], { method: "POST", body: fd });
  assert.equal(ok.status, 200);
  const okData = await ok.json();
  assert.equal(okData.ok, true);
  assert.ok(fs.existsSync(okData.tempPath));

  const fd2 = new FormData();
  fd2.append("file", new File([Buffer.from("x")], "evil.exe"));
  const bad = await call(handler, "POST", ["upload"], { method: "POST", body: fd2 });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "不支持的音频格式");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("custom 原语: 对象与 Response 两种返回 + 自解析 body", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({
    cliPath,
    actions: [
      { type: "custom", method: "POST", path: "/obj", handler: async ({ request }) => {
        const { n } = await request.json();
        return { doubled: n * 2 };
      } },
      { type: "custom", method: "GET", path: "/html", handler: async () =>
        new Response("<b>hi</b>", { headers: { "Content-Type": "text/html" } }) },
    ],
  });

  const obj = await call(handler, "POST", ["obj"], jsonInit({ n: 21 }));
  assert.deepEqual(await obj.json(), { doubled: 42 });

  const html = await call(handler, "GET", ["html"]);
  assert.equal(html.headers.get("content-type"), "text/html");
  assert.equal(await html.text(), "<b>hi</b>");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("无匹配动作 → 404", async () => {
  const { tmp, cliPath } = makeTmpCli();
  const handler = createCapabilityHandler({ cliPath, actions: [] });
  const res = await call(handler, "GET", ["whatever"]);
  assert.equal(res.status, 404);
  fs.rmSync(tmp, { recursive: true, force: true });
});
