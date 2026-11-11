/**
 * 媒体库（公开分享资产）
 * ============================================================================
 *
 * 存储公开可分享的媒体（视频/图片等），每个文件分配一个不可猜测的 token，
 * 通过 /m/<token> 公开访问。元数据（mime/title/kind/size/createdAt）只存服务端，
 * URL 不暴露任何结构（无目录、无扩展名、无原名）。
 *
 * 布局：
 *   data/media/<token>            # 文件本体（无扩展名，token 命名）
 *   data/media/index.json         # token → 元数据表（原子写：临时文件 + rename）
 *
 * token：128-bit 随机 → base64url（约 22 字符，混大小写+数字+`-`/`_`）。
 *
 * 定位约定：被 Next webpack 打包的代码 cwd = packages/ai-chat（上两级 = 仓库根）；
 * 纯 node（测试/脚本）cwd = 仓库根。测试可用 MEDIA_DIR 环境变量覆盖存储根。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REL = ["data", "media"];
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function mediaRoot() {
  if (process.env.MEDIA_DIR) return path.resolve(process.env.MEDIA_DIR);
  const out = [
    // ai-chat / MCP：cwd = packages/ai-chat（见 uploads route 的 STATIC_ROOT 同约定）
    path.resolve(process.cwd(), "..", "..", ...REL),
    // 仓库根启动：cwd = repo root
    path.resolve(process.cwd(), ...REL),
  ];
  try {
    out.push(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ...REL));
  } catch {
    /* webpack 下 import.meta.url 可能不可用，忽略 */
  }
  for (const p of out) {
    if (fs.existsSync(p)) return p;
  }
  return out[0];
}

function indexPath() {
  return path.join(mediaRoot(), "index.json");
}

function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(idx) {
  const dir = mediaRoot();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `index.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, indexPath()); // 原子替换，避免写坏丢全表
}

/** 128-bit 随机 → base64url（约 22 字符），不可猜测 */
export function generateToken() {
  return crypto.randomBytes(16).toString("base64url");
}

export function isValidToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/**
 * 把文件加入媒体库，返回 token。
 * @param {{ filePath: string, mime: string, title?: string, kind?: string }} opts
 */
export function addMedia({ filePath, mime, title = "", kind = "file" }) {
  const dir = mediaRoot();
  fs.mkdirSync(dir, { recursive: true });
  const idx = readIndex();
  let token;
  do {
    token = generateToken();
  } while (idx[token] || fs.existsSync(path.join(dir, token)));
  fs.copyFileSync(filePath, path.join(dir, token));
  const size = fs.statSync(filePath).size;
  idx[token] = {
    mime: String(mime || "application/octet-stream"),
    title: String(title || "").slice(0, 100),
    kind: String(kind || "file"),
    size,
    createdAt: Date.now(),
  };
  writeIndex(idx);
  return token;
}

/** 按 token 取媒体：{ meta, filePath } 或 null */
export function getMedia(token) {
  if (!isValidToken(token)) return null;
  const idx = readIndex();
  const meta = idx[token];
  if (!meta) return null;
  const filePath = path.join(mediaRoot(), token);
  if (!fs.existsSync(filePath)) return null;
  return { meta, filePath };
}

/** 列出全部媒体（新→旧） */
export function listMedia() {
  const idx = readIndex();
  return Object.entries(idx)
    .map(([token, meta]) => ({ token, ...meta }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** 删除媒体：删文件 + 删索引条目，链接即刻失效。返回是否删到 */
export function deleteMedia(token) {
  if (!isValidToken(token)) return false;
  const idx = readIndex();
  if (!idx[token]) return false;
  try {
    fs.unlinkSync(path.join(mediaRoot(), token));
  } catch {
    /* 文件缺失仍清理索引 */
  }
  delete idx[token];
  writeIndex(idx);
  return true;
}
