/**
 * 工作流级通用资产库：角色参考图（图片）+ 风格（文本）
 * 被 Next webpack 打包（跑在 ai-chat 进程），路径用 process.cwd() 定位
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { generateImage } from "@app/shared/llm/index.js";

const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets");
const CHARACTERS_DIR = path.join(ASSETS_DIR, "characters");
const STYLES_DIR = path.join(ASSETS_DIR, "styles");

const CHARACTER_SHEET_PROMPT =
  "角色设定图要求：纯白背景、角色全身像、所有角色并排站立、每人头顶标注名字、统一画风、构图清晰、不要出现多余文字和背景元素。";

const newId = () => crypto.randomBytes(8).toString("hex");
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null);

function listCharacters() {
  if (!fs.existsSync(CHARACTERS_DIR)) return [];
  return fs.readdirSync(CHARACTERS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(CHARACTERS_DIR, f)))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listStyles() {
  if (!fs.existsSync(STYLES_DIR)) return [];
  return fs.readdirSync(STYLES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(path.join(STYLES_DIR, f)))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ─── 角色参考图 ─────────────────────────────────────────────────────────

export async function listCharacterHandler() {
  return { characters: listCharacters() };
}

export async function generateCharacterHandler({ request }) {
  const { description, imageUrl } = await request.json();
  if (!description) return Response.json({ ok: false, error: "missing description" }, { status: 400 });

  try {
    const imageUrls = await generateImage(`${description}\n\n${CHARACTER_SHEET_PROMPT}`, {
      aspectRatio: "16:9",
      n: 1,
      image_url: imageUrl || undefined,
    });
    return { ok: true, imageUrls };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function saveCharacterHandler({ request }) {
  const { name, description, imageUrl } = await request.json();
  if (!name) return Response.json({ ok: false, error: "missing name" }, { status: 400 });
  if (!imageUrl) return Response.json({ ok: false, error: "missing imageUrl" }, { status: 400 });

  fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
  const id = newId();
  const imgPath = path.join(CHARACTERS_DIR, `${id}.png`);

  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`图片下载失败 (${res.status})`);
    fs.writeFileSync(imgPath, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  const meta = { id, name, description: description || "", createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(CHARACTERS_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
  return { ok: true, characters: listCharacters() };
}

export async function deleteCharacterHandler({ params }) {
  const id = params.id;
  if (!id) return Response.json({ ok: false, error: "missing id" }, { status: 400 });
  for (const ext of [".png", ".json"]) {
    const p = path.join(CHARACTERS_DIR, `${id}${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return { ok: true, characters: listCharacters() };
}

// ─── 风格 ───────────────────────────────────────────────────────────────

export async function listStyleHandler() {
  return { styles: listStyles() };
}

export async function createStyleHandler({ request }) {
  const { name, description } = await request.json();
  if (!name) return Response.json({ ok: false, error: "missing name" }, { status: 400 });

  fs.mkdirSync(STYLES_DIR, { recursive: true });
  const id = newId();
  const meta = { id, name, description: description || "", createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(STYLES_DIR, `${id}.json`), JSON.stringify(meta, null, 2));
  return { ok: true, styles: listStyles() };
}

export async function deleteStyleHandler({ params }) {
  const id = params.id;
  if (!id) return Response.json({ ok: false, error: "missing id" }, { status: 400 });
  const p = path.join(STYLES_DIR, `${id}.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return { ok: true, styles: listStyles() };
}
