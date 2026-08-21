/**
 * 通用能力 dispatcher：声明式 actions 表 + 4 原语（cli / stream / upload / custom）
 *
 * 能力包（workflows/tasks）的 http.js 组装 actions 表并导出 handler；
 * ai-chat 的 catch-all 路由只做委托。详见 docs/superpowers/specs/2026-08-21-capability-registration-design.md
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** stdout JSON 提取：cli 契约是 stdout 只出 JSON，但防御性处理首尾噪音 */
export function parseCliOutput(stdout) {
  const trimmed = (stdout || "").trim();
  if (!trimmed) return null;

  const brace = trimmed.indexOf("{");
  const bracket = trimmed.indexOf("[");
  let start;
  if (brace === -1 && bracket === -1) {
    throw new Error(`no JSON found in CLI output: ${trimmed.slice(0, 200)}`);
  } else if (brace === -1) {
    start = bracket;
  } else if (bracket === -1) {
    start = brace;
  } else {
    start = Math.min(brace, bracket);
  }

  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  let inStr = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) end = trimmed.length;
  return JSON.parse(trimmed.slice(start, end));
}

/** 过滤 dotenv 营销噪音（每次 cli 启动 stderr 打 ~1 行） */
function realStderr(stderr) {
  return (stderr || "")
    .split("\n")
    .filter(line =>
      !line.includes("◇ injected env") &&
      !line.includes("// tip:") &&
      line.trim() !== ""
    )
    .join("\n");
}

/**
 * 路径模式匹配。":name" 捕获段；尾部 "*" 捕获剩余段（至少 1 段）。
 * 返回 { params, rest } 或 null。
 */
export function matchPath(pattern, segments) {
  const parts = pattern.split("/").filter(Boolean);
  const params = {};

  if (parts[parts.length - 1] === "*") {
    const fixed = parts.slice(0, -1);
    if (segments.length <= fixed.length) return null;
    for (let i = 0; i < fixed.length; i++) {
      if (fixed[i].startsWith(":")) params[fixed[i].slice(1)] = decodeURIComponent(segments[i]);
      else if (fixed[i] !== segments[i]) return null;
    }
    return { params, rest: segments.slice(fixed.length).map(decodeURIComponent) };
  }

  if (segments.length !== parts.length) return null;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
    else if (parts[i] !== segments[i]) return null;
  }
  return { params, rest: [] };
}

function runCli(cliPath, command, argsObj, timeout) {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      [cliPath, command, JSON.stringify(argsObj)],
      { timeout, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const noise = realStderr(stderr);
        if (noise) console.log(`[capability] cli ${command} stderr:`, noise);
        if (err) {
          // cli 契约 stdout 纯 JSON：非零退出也先尝试解析 stdout
          try {
            const data = parseCliOutput(stdout);
            if (data) return resolve(data);
          } catch { /* 落到错误消息 */ }
          return reject(new Error(cleanExecError(err)));
        }
        resolve(parseCliOutput(stdout));
      }
    );
  });
}

/** execFile 错误消息清洗：去 Command failed 前缀与 dotenv 噪音行 */
function cleanExecError(err) {
  const lines = (err.message || "")
    .split("\n")
    .filter(l =>
      !l.startsWith("Command failed") &&
      !l.includes("◇ injected env") &&
      !l.includes("// tip:") &&
      l.trim() !== ""
    );
  return lines.join(" ") || "command failed";
}

async function resolveArgs(action, params, getBody) {
  const args = {};
  for (const [key, src] of Object.entries(action.args || {})) {
    if (src.startsWith("param.")) {
      args[key] = params[src.slice(6)];
    } else if (src.startsWith("body.")) {
      const body = await getBody();
      args[key] = body?.[src.slice(5)];
    }
  }
  for (const name of action.required || []) {
    const v = args[name];
    if (v === undefined || v === null || v === "") {
      throw httpError(400, `missing ${name}`);
    }
  }
  return args;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".css": "text/css",
  ".js": "application/javascript",
  ".srt": "text/plain; charset=utf-8",
};

/** stream 原语：dir + params 值 + rest 段拼文件路径，Range 206 分段（从旧 file 路由移植） */
function serveStream(action, match, request) {
  const relParts = [...Object.values(match.params), ...match.rest];
  const filePath = path.resolve(action.dir, ...relParts);

  if (!filePath.startsWith(action.dir + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  const filename = relParts[relParts.length - 1];
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const fileSize = stat.size;

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
      if (start >= fileSize || end >= fileSize) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(stream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache, must-revalidate",
        },
      });
    }
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}

/** upload 原语：formData 单文件写盘 */
async function runUpload(action, request) {
  try {
    const formData = await request.formData();
    const file = formData.get(action.field || "file");
    if (!file) return json({ ok: false, error: "missing file" }, 400);

    const ext = path.extname(file.name).toLowerCase();
    if (!action.allowExt.includes(ext)) {
      return json({ ok: false, error: action.error || "不支持的文件格式" }, 400);
    }

    const filename = `${crypto.randomBytes(8).toString("hex")}${ext}`;
    const filePath = path.join(action.destDir, filename);
    fs.mkdirSync(action.destDir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));

    return json({ ok: true, tempPath: filePath, filename });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

async function execute(action, request, match, cliPath, getBody) {
  switch (action.type) {
    case "cli": {
      const args = await resolveArgs(action, match.params, getBody);
      if (action.detached) {
        const child = spawn("node", [cliPath, action.command, JSON.stringify(args)], {
          stdio: "ignore",
          detached: true,
        });
        child.unref();
        return json(action.respond || { ok: true });
      }
      const data = await runCli(cliPath, action.command, args, action.timeout || 5000);
      if (action.notFound && data?.[action.notFound.field] === action.notFound.value) {
        return json(data, 404);
      }
      return json(data);
    }
    case "stream":
      return serveStream(action, match, request);
    case "upload":
      return runUpload(action, request);
    case "custom": {
      const result = await action.handler({ params: match.params, rest: match.rest, request });
      return result instanceof Response ? result : json(result);
    }
    default:
      throw httpError(500, `unknown action type: ${action.type}`);
  }
}

/**
 * 由 actions 表创建 Next catch-all 路由 handler。
 * @param {{ actions: Array, cliPath?: string }} options
 * @returns {{ GET, POST, PUT, DELETE }} (request, { params: Promise<{ path: string[] }> }) => Response
 */
export function createCapabilityHandler({ actions, cliPath }) {
  const dispatch = async (request, context) => {
    const params = await context.params;
    const segments = params.path || [];
    for (const action of actions) {
      if (action.method !== request.method) continue;
      const match = matchPath(action.path, segments);
      if (!match) continue;

      let bodyCache;
      const getBody = async () => {
        if (bodyCache === undefined) {
          try {
            bodyCache = await request.json();
          } catch {
            bodyCache = {};
          }
        }
        return bodyCache;
      };

      try {
        return await execute(action, request, match, cliPath, getBody);
      } catch (err) {
        const status = err.status || 500;
        return json({ ok: false, error: err.message || String(err) }, status);
      }
    }
    return json({ ok: false, error: "no matching action" }, 404);
  };

  return { GET: dispatch, POST: dispatch, PUT: dispatch, DELETE: dispatch };
}

/** 读声明式 actions 表 */
export function loadActions(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
}
