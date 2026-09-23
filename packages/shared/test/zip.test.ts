import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { zipSync } from "../../ai-chat/src/lib/zip";

test("zipSync: 生成合法 zip（本地头/EOCD），可被 unzip 读取", () => {
  const buf = zipSync([
    { name: "index.html", data: Buffer.from("<h1>你好</h1>") },
    { name: "images/cover.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) },
  ]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50, "缺本地文件头");
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, "缺 EOCD");

  const tmp = path.join(os.tmpdir(), `ziptest-${Date.now()}.zip`);
  fs.writeFileSync(tmp, buf);
  try {
    const out = execFileSync("unzip", ["-l", tmp], { encoding: "utf-8" });
    assert.match(out, /index\.html/);
    assert.match(out, /images\/cover\.jpg/);
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return; // 无 unzip 则只校验结构
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
