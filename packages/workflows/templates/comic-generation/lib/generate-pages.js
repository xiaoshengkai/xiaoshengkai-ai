import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateImage } from "@app/shared/llm/index.js";
import { readState, writeState } from "../../../lib/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets");

// ponytail: 固定 seed 提升逐页风格一致性（角色一致性靠参考图 subject_reference）
const SEED = 42;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

// 每页开始处理前，把进度写进 state，前端轮询可实时显示「第 N/29 页」
function updateProgress(executionDir, pageNo, total) {
  try {
    const st = readState(executionDir);
    const gs = st.steps?.find(s => s.id === "generate-pages");
    if (gs) {
      gs.progress = `${pageNo}/${total} 页`;
      writeState(executionDir, st);
    }
  } catch { /* ignore */ }
}

export function buildPrompt(p, styleDesc) {
  const parts = [];
  if (styleDesc) parts.push(`画风：${styleDesc}`);
  if (p.sceneId) parts.push(`场景ID：${p.sceneId}`);
  if (p.scenePrompt) parts.push(p.scenePrompt);
  parts.push(`画面：${p.imagePrompt}`);
  if (Array.isArray(p.cast) && p.cast.length) {
    const sideZh = { left: "左", right: "右", center: "中间" };
    parts.push("人物位置：" + p.cast.map(c => `${c.name}在${sideZh[c.side] || "中间"}`).join("、") + "；每个对白气泡靠近对应说话人。");
  }
  const dialogueText = Array.isArray(p.dialogue) ? p.dialogue.join("\n") : (p.dialogue || "");
  if (dialogueText) parts.push(`对白气泡文字（尽量准确画进画面，气泡内标注说话人名字）：\n${dialogueText}`);
  parts.push("每个说话人仅一个气泡，气泡尾部指向该人物；左人左泡、右人右泡，不得合并/重复/颠倒。");
  parts.push("同一场景ID必须沿用固定场景描述的空间布局、道具位置和人物左右关系，只改变本页动作、表情和对白。");
  parts.push("画面干净，无多余黑点、污渍、杂线。");
  return parts.join("\n\n");
}

export async function generatePages(pagesJson, characterRef, styleId, executionDir) {
  const pages = JSON.parse(pagesJson);
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("分镜 pages 为空");

  const styleMeta = readJson(path.join(ASSETS_DIR, "styles", `${styleId}.json`));
  const charImgPath = path.join(ASSETS_DIR, "characters", `${characterRef}.png`);
  if (!fs.existsSync(charImgPath)) throw new Error(`角色参考图不存在: ${characterRef}`);
  const styleDesc = styleMeta?.description || "";

  const pagesDir = path.join(executionDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  const charRefB64 = `data:image/png;base64,${fs.readFileSync(charImgPath).toString("base64")}`;
  const sceneAnchors = new Map();

  const totalStart = Date.now();
  const result = [];
  let failed = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageNo = p.page || i + 1;
    const file = `pages/page-${String(pageNo).padStart(2, "0")}.png`;
    const filePath = path.join(executionDir, file);

    updateProgress(executionDir, pageNo, pages.length);

    // 幂等：已存在的页直接复用（重试只补缺页，不重生成好页）
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      console.log(`[generate-pages] 第 ${pageNo}/${pages.length} 页已存在，复用`);
      if (p.sceneId && !sceneAnchors.has(p.sceneId)) sceneAnchors.set(p.sceneId, filePath);
      result.push({ page: pageNo, file, dialogue: p.dialogue || [], sceneId: p.sceneId || null });
      continue;
    }

    const t0 = Date.now();
    console.log(`[generate-pages] 生成第 ${pageNo}/${pages.length} 页...`);
    const prompt = buildPrompt(p, styleDesc);
    const sceneAnchor = p.sceneId ? sceneAnchors.get(p.sceneId) : null;
    const refB64 = sceneAnchor && fs.existsSync(sceneAnchor)
      ? `data:image/png;base64,${fs.readFileSync(sceneAnchor).toString("base64")}`
      : charRefB64;
    console.log(`[generate-pages] 第 ${pageNo} 页 提交AI图片prompt (aspectRatio=2:3, seed=${SEED}, 参考=${sceneAnchor ? "场景锚点" : "角色参考图"}, 参考图base64长度=${refB64.length}):\n${prompt}`);
    try {
      const genStart = Date.now();
      const urls = await generateImage(prompt, {
        aspectRatio: "2:3",
        image_url: refB64,
        seed: SEED,
      });
      const genElapsed = ((Date.now() - genStart) / 1000).toFixed(1);
      const url = urls[0];
      if (!url) throw new Error(`第 ${pageNo} 页未生成图片`);

      const dlStart = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`第 ${pageNo} 页图片下载失败 (${res.status})`);
      fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
      if (p.sceneId && !sceneAnchors.has(p.sceneId)) sceneAnchors.set(p.sceneId, filePath);
      const dlElapsed = ((Date.now() - dlStart) / 1000).toFixed(1);
      console.log(`[generate-pages] 第 ${pageNo} 页完成 (生成 ${genElapsed}s, 下载 ${dlElapsed}s, 合计 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

      result.push({ page: pageNo, file, dialogue: p.dialogue || [], sceneId: p.sceneId || null });
    } catch (err) {
      // 单页失败（如敏感内容）不中断整批，标记 error 后继续，前端展示占位图
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[generate-pages] 第 ${pageNo} 页失败: ${message}`);
      result.push({ page: pageNo, file, dialogue: p.dialogue || [], sceneId: p.sceneId || null, error: message });
    }
  }

  console.log(`[generate-pages] 全部完成: ${result.length} 页 (失败 ${failed} 页), 总耗时 ${((Date.now() - totalStart) / 1000).toFixed(1)}s`);
  return { pages: result };
}
