import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateImage, callMultimodalLLM } from "@app/shared/llm/index.js";
import { parseJSON } from "@app/shared/llm/parse-json.js";
import { withTimeout } from "@app/shared/utils.js";
import { readState, writeState } from "../../../lib/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "data", "workflows", "assets");

// ponytail: 基础 seed 提升风格一致性，逐页加 pageNo 偏移避免相邻页过度相似（角色一致性靠参考图 subject_reference）
const SEED = 42;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return null; }
}

export function buildDialogueInstructions(dialogue, cast = []) {
  const lines = (Array.isArray(dialogue) ? dialogue : String(dialogue || "").split("\n"))
    .map(line => String(line).trim())
    .filter(Boolean);
  const sideZh = { left: "左", right: "右", center: "中间" };

  return lines.flatMap(line => {
    const match = line.match(/^\s*([^：:]+)[：:]\s*(.*)$/s);
    const speaker = match?.[1]?.trim() || "";
    const text = match?.[2]?.trim() || line;
    const person = cast.find(c => c.name === speaker);
    const side = sideZh[person?.side];
    return [
      `气泡内只写：${text}`,
      ...(speaker && side ? [`说话人定位（禁止绘制）：${side}侧的${speaker}；气泡尾巴尖端必须指向并接触${side}侧的${speaker}。`] : []),
    ];
  });
}

export function buildCharacterFidelityInstructions() {
  return [
    "人物造型必须复用参考图中的具体设计：沿用参考图的服装、发型、眼镜等特征和描边粗细，禁止简化成无特征的白身、细线或断线轮廓。",
    "人物是画面主体：每个人物高度占画面高度的50%-70%，位于画面中部，禁止把人物画得极小或大面积留白。",
    "画风文字描述与参考图冲突时，一律以参考图为准。",
  ];
}

export function buildVisualHierarchyInstructions() {
  return [
    "视觉层级固定为：背景最低层，人物位于背景上方，气泡、尾巴和文字位于最高层。",
    "背景、道具、扶手、门框和座椅不得穿过或遮挡人物轮廓、脸部，也不得进入气泡区域。人物脸部和主体轮廓必须完整清晰可见。",
    "必须覆盖参考锚点的基础脸和姿态，按本页分镜重新绘制眼睛、嘴型、身体倾斜、人物距离、动作线和情绪符号，使表情与当前台词强烈匹配。",
    "气泡、尾巴和文字不得被背景、道具或人物遮挡。",
  ];
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
  if (typeof p.narration === "string" && p.narration.trim()) {
    parts.push(`旁白：${p.narration.trim()}。旁白用灰底方框显示在画面顶部，方框内只写这段文字，不得画进对话气泡，也不得与气泡重叠。`);
  }
  parts.push(...buildDialogueInstructions(p.dialogue, p.cast));
  parts.push(...buildCharacterFidelityInstructions());
  parts.push(...buildVisualHierarchyInstructions());
  parts.push("每个说话人仅一个气泡，气泡尾部指向该人物；左人左泡、右人右泡，不得合并/重复/颠倒。");
  parts.push("同一场景ID必须沿用固定场景描述的空间布局、道具位置和人物左右关系，只改变本页动作、表情和对白。");
  parts.push("画面干净，无多余黑点、污渍、杂线。");
  return parts.join("\n\n");
}

export function buildAnchorPrompt(p, styleDesc) {
  const parts = [];
  if (styleDesc) parts.push(`画风：${styleDesc}`);
  if (p.sceneId) parts.push(`场景ID：${p.sceneId}`);
  if (p.scenePrompt) parts.push(p.scenePrompt);
  if (Array.isArray(p.cast) && p.cast.length) {
    const sideZh = { left: "左", right: "右", center: "中间" };
    parts.push("人物基础站位：" + p.cast.map(c => `${c.name}在${sideZh[c.side] || "中间"}`).join("、"));
  }
  parts.push(...buildCharacterFidelityInstructions());
  parts.push("生成该场景的干净基础画面，保持固定人物站位、镜头轴线、背景和道具布局；人物统一使用无明显情绪的基础脸和静止基础姿态，供正式页覆盖重绘。背景和道具必须全部位于人物轮廓后方，不得穿过或遮挡人物轮廓、脸部。禁止出现任何文字、对白框、旁白框、气泡和气泡尾巴。");
  return parts.join("\n\n");
}

function dialogueText(dialogue) {
  return (Array.isArray(dialogue) ? dialogue : [])
    .map(d => String(d).replace(/^\s*[^：:]+[：:]\s*/, "").trim())
    .filter(Boolean)
    .join("；");
}

// 生成后质检：读图校验气泡文字与尾巴指向；质检失败不阻断（降级通过），仅用于触发重试
async function verifyPage(imagePath, dialogue) {
  const text = dialogueText(dialogue);
  if (!text) return { ok: true };
  const b64 = `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}`;
  const system = "你是漫画质检员。检查漫画页里对白气泡中的文字是否与给定台词一致（无错字/漏字/串字/多余字），以及气泡尾巴是否指向正确的说话人。只返回 JSON：{\"ok\": true} 或 {\"ok\": false, \"issue\": \"具体问题一句话\"}";
  const user = `期望台词（冒号前是说话人，气泡内只画冒号后的文字）：${text}`;
  try {
    const { text: reply } = await withTimeout(
      callMultimodalLLM({ system, user, images: [b64] }),
      60000,
      "漫画质检"
    );
    const parsed = parseJSON(reply);
    if (parsed && typeof parsed.ok === "boolean") return { ok: parsed.ok, issue: parsed.issue || "" };
    return { ok: true };
  } catch (e) {
    console.warn(`[generate-pages] 质检失败，跳过: ${e.message}`);
    return { ok: true };
  }
}

export async function generatePages(pagesJson, characterRef, styleId, executionDir) {
  const pages = JSON.parse(pagesJson);
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("分镜 pages 为空");

  const styleMeta = readJson(path.join(ASSETS_DIR, "styles", `${styleId}.json`));
  const charImgPath = path.join(ASSETS_DIR, "characters", `${characterRef}.png`);
  if (!fs.existsSync(charImgPath)) throw new Error(`角色参考图不存在: ${characterRef}`);
  const styleDesc = styleMeta?.description || "";
  const force = readState(executionDir).steps?.find(s => s.id === "generate-pages")?.retryForce === true;

  const pagesDir = path.join(executionDir, "pages");
  const anchorsDir = path.join(executionDir, "anchors");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(anchorsDir, { recursive: true });

  const charRefB64 = `data:image/png;base64,${fs.readFileSync(charImgPath).toString("base64")}`;
  const sceneAnchors = new Map();

  async function getSceneAnchor(page) {
    if (!page.sceneId) return null;
    if (sceneAnchors.has(page.sceneId)) return sceneAnchors.get(page.sceneId);

    const anchorPrompt = buildAnchorPrompt(page, styleDesc);
    const anchorPath = path.join(anchorsDir, `${createHash("sha256").update(anchorPrompt).digest("hex").slice(0, 16)}.png`);
    if (!force && fs.existsSync(anchorPath) && fs.statSync(anchorPath).size > 0) {
      sceneAnchors.set(page.sceneId, anchorPath);
      return anchorPath;
    }

    try {
      console.log(`[generate-pages] 生成场景 ${page.sceneId} 的无气泡锚点...`);
      const urls = await generateImage(anchorPrompt, {
        aspectRatio: "2:3",
        image_url: charRefB64,
        seed: SEED,
      });
      if (!urls[0]) throw new Error("未生成图片");
      const res = await withTimeout(fetch(urls[0], { signal: AbortSignal.timeout(120000) }), 120000, "锚点下载");
      if (!res.ok) throw new Error(`图片下载失败 (${res.status})`);
      fs.writeFileSync(anchorPath, Buffer.from(await res.arrayBuffer()));
      sceneAnchors.set(page.sceneId, anchorPath);
      return anchorPath;
    } catch (err) {
      console.warn(`[generate-pages] 场景 ${page.sceneId} 锚点失败，回退角色参考图: ${err.message}`);
      sceneAnchors.set(page.sceneId, null);
      return null;
    }
  }

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
    if (!force && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      console.log(`[generate-pages] 第 ${pageNo}/${pages.length} 页已存在，复用`);
      result.push({ page: pageNo, file, dialogue: p.dialogue || [], sceneId: p.sceneId || null });
      continue;
    }

    const t0 = Date.now();
    console.log(`[generate-pages] 生成第 ${pageNo}/${pages.length} 页...`);
    const prompt = buildPrompt(p, styleDesc);
    const sceneAnchor = await getSceneAnchor(p);
    const anchorB64 = sceneAnchor && fs.existsSync(sceneAnchor)
      ? `data:image/png;base64,${fs.readFileSync(sceneAnchor).toString("base64")}`
      : null;
    const refInput = anchorB64 ? [anchorB64, charRefB64] : charRefB64;
    console.log(`[generate-pages] 第 ${pageNo} 页 提交AI图片prompt (aspectRatio=2:3, seed=${SEED}, 参考=${anchorB64 ? "场景锚点+角色参考图" : "角色参考图"}):\n${prompt}`);

    const render = async (overridePrompt) => {
      const urls = await generateImage(overridePrompt || prompt, {
        aspectRatio: "2:3",
        image_url: refInput,
        seed: SEED + pageNo,
      });
      const url = urls[0];
      if (!url) throw new Error(`第 ${pageNo} 页未生成图片`);
      const res = await withTimeout(fetch(url, { signal: AbortSignal.timeout(120000) }), 120000, "图片下载");
      if (!res.ok) throw new Error(`第 ${pageNo} 页图片下载失败 (${res.status})`);
      fs.writeFileSync(filePath, Buffer.from(await withTimeout(res.arrayBuffer(), 30000, "图片读取")));
    };

    try {
      await render();

      // 质检：有对白的页读图校验，不通过则带反馈重试一次（不重检，避免循环）
      const check = await verifyPage(filePath, p.dialogue);
      if (!check.ok && check.issue) {
        console.warn(`[generate-pages] 第 ${pageNo} 页质检未通过，重试一次: ${check.issue}`);
        await render(`${prompt}\n\n【修正要求】上一版问题：${check.issue}。修正该问题后重新绘制，保持构图、人物、背景、其余对白完全不变。`);
      }

      console.log(`[generate-pages] 第 ${pageNo} 页完成 (合计 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
