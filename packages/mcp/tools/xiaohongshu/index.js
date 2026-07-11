import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { searchChroma } from "../../lib/chroma.js";
import { generateImage } from "../../lib/minimax.js";
import { sleep } from "../media/utils.js";

const TASK_DIR = path.join(os.tmpdir(), "xhs-tasks");
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro";
const TAG = "[xhs]";

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.md`), "utf-8");
}

const TEMPLATES = {
  knowledge: {
    finance: {
      maxTokens: 8000,
      systemPrompt: loadTemplate("knowledge/finance"),
      coverStyle: "lively hand-drawn illustration, warm gold and navy blue palette, 3:4 vertical",
      illustrationStyle: "lively hand-drawn illustration, warm gold and navy blue palette, 1:1 square",
    },
    _default: {
      maxTokens: 8000,
      systemPrompt: loadTemplate("knowledge"),
      coverStyle: "lively hand-drawn illustration, warm colors, playful, 3:4 vertical",
      illustrationStyle: "lively hand-drawn illustration, warm colors, playful, 1:1 square",
    },
  },
  product_review: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
  experience: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
  opinion: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
};

function writeTaskState(workDir, state) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, "task.json"), JSON.stringify(state, null, 2));
}

function updateTask(workDir, update) {
  const taskFile = path.join(workDir, "task.json");
  if (!fs.existsSync(taskFile)) return;
  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  Object.assign(state, update);
  fs.writeFileSync(taskFile, JSON.stringify(state, null, 2));
}

async function callLLM(prompt, style, subcategory) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY");

  const category = TEMPLATES[style];
  if (!category) throw new Error(`未知模板: ${style}`);

  let template;
  if (subcategory && category[subcategory] && category[subcategory].systemPrompt) {
    template = category[subcategory];
  } else if (category._default) {
    template = category._default;
  } else {
    template = category;
  }

  if (!template.systemPrompt || template.systemPrompt === "（待实现）") {
    const available = category._default ? Object.keys(category).filter(k => k !== "_default" && category[k].systemPrompt !== "（待实现）").join("、") : "无";
    throw new Error(`「${style}」${subcategory ? `/${subcategory}` : ""}模板尚未实现，当前可用：${available}`);
  }

  console.log(`${TAG} callLLM: style=${style}${subcategory ? "/" + subcategory : ""} model=${DEEPSEEK_MODEL} maxTokens=${template.maxTokens || 2000} prompt=${prompt.length}字`);

  const systemContent = `${template.systemPrompt}

返回严格的 JSON 格式（不要包含 markdown 代码块标记）：
{
  "title": "笔记标题（10-20字，吸引人）",
  "excerpt": "精彩摘要，≤30字，吸引读者点击阅读",
  "content": ["段落1", "[插图-1]", "段落2", "[插图-2]", "段落3"],
  "tags": ["#标签1", "#标签2", "#标签3"],
  "coverPrompt": "封面图英文 prompt",
  "illustrationPrompts": ["插画1英文prompt", "插画2英文prompt"]
}

规则：
- 正文5-8段，每段3-6句，中文
- 插画3-5张，穿插在段落之间，长内容多配图降低阅读压力
- content 数组用 "[插图-N]" 标记插画位置
- 封面 prompt 要求：${template.coverStyle}
- 插画 prompt 要求：${template.illustrationStyle}
- 所有 prompt 用英文，描述具体画面内容
- 涉及具体数据或关键信息要准确，不要编造`;

  const tStart = Date.now();
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: template.maxTokens || 2000,
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);

  let noteData;
  try {
    noteData = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    noteData = JSON.parse(cleaned);
  }

  console.log(`${TAG} callLLM: 耗时=${elapsed}s tokens=${usage.totalTokens} title="${noteData.title}" excerpt="${noteData.excerpt}" 段落=${noteData.content?.length} 插画=${noteData.illustrationPrompts?.length} 标签=${noteData.tags?.length}`);
  return noteData;
}

async function generateAllImages(taskId, workDir, images) {
  const state = JSON.parse(fs.readFileSync(path.join(workDir, "task.json"), "utf-8"));

  console.log(`${TAG} images: 开始生成 taskId=${taskId} 共${images.length}张`);

  let doneCount = 0;
  let failedCount = 0;

  for (const img of images) {
    console.log(`${TAG} image[${img.index}] ${img.type}: prompt="${img.prompt.slice(0, 60)}..."`);
    const tStart = Date.now();
    try {
      const aspectRatio = img.type === "cover" ? "3:4" : "1:1";
      const url = await generateImage(img.prompt, { aspectRatio });

      state.images[img.index].url = url;
      state.images[img.index].status = "done";
      doneCount++;
      writeTaskState(workDir, state);
      console.log(`${TAG} image[${img.index}] ${img.type}: 成功 耗时=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
    } catch (err) {
      state.images[img.index].status = "failed";
      state.images[img.index].error = err.message;
      failedCount++;
      writeTaskState(workDir, state);
      console.error(`${TAG} image[${img.index}] ${img.type}: 失败 ${err.message}`);
    }
  }

  const allDone = state.images.every((img) => img.status === "done");
  const hasFailed = state.images.some((img) => img.status === "failed");

  state.status = allDone ? "ready" : hasFailed ? "partial" : "ready";
  writeTaskState(workDir, state);

  console.log(`${TAG} images: 完成 taskId=${taskId} done=${doneCount} failed=${failedCount} status=${state.status}`);
}

export function register(server) {
  server.tool(
    "generateXiaohongshuNote",
    "根据主题和模板生成小红书笔记（含封面、插画、标签）。自动检索记忆库补充内容，异步生成所有配图。返回 taskId 后用 checkXiaohongshuNoteProgress 查询进度。",
    {
      topic: z.string().min(1).max(200).describe("笔记主题，从对话中提取，如 'React 性能优化技巧'"),
      context: z.string().optional().describe("对话内容摘要，提取当前对话中涉及的关键讨论内容、关键结论等"),
      style: z.enum(["knowledge", "product_review", "experience", "opinion"]).optional().default("knowledge").describe("笔记模板。knowledge=知识分享, product_review=好物推荐, experience=经验复盘, opinion=观点讨论。LLM 自动推断，用户也可手动指定"),
      subcategory: z.string().optional().describe("二级类目，如 'finance'（金融知识）。LLM 自动推断，目前仅 knowledge 下支持"),
    },
    async ({ topic, context, style, subcategory }) => {
      try {
        console.log(`${TAG} generate: topic="${topic}" style=${style}${subcategory ? "/" + subcategory : ""} context=${context?.length || 0}字`);

        const deepseekKey = process.env.DEEPSEEK_API_KEY;
        const minimaxKey = process.env.MINIMAX_API_KEY;
        if (!deepseekKey) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 DEEPSEEK_API_KEY" }) }] };
        if (!minimaxKey) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 MINIMAX_API_KEY" }) }] };

        const category = TEMPLATES[style];
        if (!category) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `未知模板: ${style}` }) }] };

        if (subcategory && category[subcategory] && category[subcategory].systemPrompt === "（待实现）") {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `「${style}/${subcategory}」模板尚未实现` }) }] };
        }

        const knowledge = await searchChroma(topic);
        console.log(`${TAG} searchChroma: 结果=${knowledge?.length || 0}字`);

        const prompt = `主题：${topic}\n${context ? `对话内容：${context}\n` : ""}相关知识：${knowledge || "无"}`;
        const noteData = await callLLM(prompt, style, subcategory);

        const taskId = crypto.randomUUID().slice(0, 8);
        const workDir = path.join(TASK_DIR, taskId);

        const images = [
          { index: 0, type: "cover", prompt: noteData.coverPrompt, url: null, status: "pending" },
          ...(noteData.illustrationPrompts || []).map((p, i) => ({
            index: i + 1,
            type: "illustration",
            prompt: p,
            url: null,
            status: "pending",
          })),
        ];

        const state = {
          taskId,
          status: "generating",
          topic,
          style,
          subcategory: subcategory || null,
          title: noteData.title,
          excerpt: noteData.excerpt || "",
          content: noteData.content,
          tags: noteData.tags,
          images,
        };

        writeTaskState(workDir, state);

        generateAllImages(taskId, workDir, images).catch((err) => {
          console.error(`${TAG} generate: taskId=${taskId} 图片生成异常 ${err.message}`);
          updateTask(workDir, { status: "failed", error: err.message });
        });

        console.log(`${TAG} generate: taskId=${taskId} 已提交 共${images.length}张图`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              taskId,
              status: "generating",
              note: { title: noteData.title, excerpt: noteData.excerpt, content: noteData.content, tags: noteData.tags, images },
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );

  server.tool(
    "updateXiaohongshuNote",
    "修改已生成的小红书笔记。可修改标题、正文、标签，或替换某张图片（重新生成）。",
    {
      taskId: z.string().min(1).describe("笔记任务 ID"),
      field: z.string().min(1).describe("要修改的字段: title, excerpt, content, tags, 或 image_0, image_1 等"),
      value: z.string().min(1).describe("新值。字段为 image_N 时是新 prompt，content 时是 JSON 数组字符串"),
    },
    async ({ taskId, field, value }) => {
      try {
        console.log(`${TAG} update: taskId=${taskId} field=${field} value="${value.slice(0, 80)}"`);

        const workDir = path.join(TASK_DIR, taskId);
        const taskFile = path.join(workDir, "task.json");
        if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "笔记任务不存在" }) }] };

        const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

        if (field.startsWith("image_")) {
          const imageIndex = parseInt(field.replace("image_", ""), 10);
          const img = state.images[imageIndex];
          if (!img) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `图片索引 ${imageIndex} 不存在` }) }] };

          img.prompt = value;
          img.url = null;
          img.status = "pending";
          state.status = "generating";
          writeTaskState(workDir, state);

          generateAllImages(taskId, workDir, [img]).catch((err) => {
            updateTask(workDir, { status: "failed", error: err.message });
          });
        } else if (field === "content") {
          try {
            state.content = JSON.parse(value);
          } catch {
            return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "content 必须是 JSON 数组字符串，如 [\"段落1\",\"[插图-1]\",\"段落2\"]" }) }] };
          }
          writeTaskState(workDir, state);
        } else if (field === "tags") {
          try {
            state.tags = JSON.parse(value);
          } catch {
            state.tags = value.split(",").map((t) => t.trim());
          }
          writeTaskState(workDir, state);
        } else {
          state[field] = value;
          writeTaskState(workDir, state);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: true, note: { title: state.title, excerpt: state.excerpt, content: state.content, tags: state.tags, images: state.images } }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );

  server.tool(
    "checkXiaohongshuNoteProgress",
    "查询小红书笔记生成任务进度。返回 status 字段。status=ready 时所有图片已生成完毕。",
    {
      taskId: z.string().min(1).describe("笔记任务 ID"),
      interval: z.number().optional().default(3).describe("初始查询间隔（秒），后续每次递减 10%，最低为初始值的 60%"),
    },
    async ({ taskId, interval }) => {
      const workDir = path.join(TASK_DIR, taskId);
      const taskFile = path.join(workDir, "task.json");
      if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "笔记任务不存在或已过期" }) }] };

      const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

      if (state.status === "generating") {
        const base = interval * 1000;
        const min = base * 0.6;
        const count = state.checkCount || 0;
        let wait = base;
        for (let i = 0; i < count; i++) wait = Math.max(wait * 0.9, min);
        updateTask(workDir, { checkCount: count + 1 });
        console.log(`${TAG} checkProgress: taskId=${taskId} status=${state.status} count=${count} wait=${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        const updated = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId: updated.taskId, status: updated.status, note: { title: updated.title, excerpt: updated.excerpt, content: updated.content, tags: updated.tags, images: updated.images } }, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId: state.taskId, status: state.status, note: { title: state.title, excerpt: state.excerpt, content: state.content, tags: state.tags, images: state.images } }, null, 2) }] };
    },
  );

  server.tool(
    "exportXiaohongshuNote",
    "将小红书笔记导出为本地文件夹（含 HTML、MD 文件和图片），保存到 Downloads 目录。",
    {
      taskId: z.string().min(1).describe("笔记任务 ID"),
    },
    async ({ taskId }) => {
      try {
        const workDir = path.join(TASK_DIR, taskId);
        const taskFile = path.join(workDir, "task.json");
        if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "笔记任务不存在" }) }] };

        const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        const downloadsDir = path.join(os.homedir(), "Downloads");
        const safeName = state.title.replace(/[\/\\:*?"<>|]/g, "_");

        let exportDir = path.join(downloadsDir, safeName);
        if (fs.existsSync(exportDir)) {
          exportDir = path.join(downloadsDir, `${safeName}_${Date.now()}`);
        }
        const imgDir = path.join(exportDir, "images");
        fs.mkdirSync(imgDir, { recursive: true });

        // 下载图片
        let imgCount = 0;
        for (const img of state.images) {
          if (!img.url) continue;
          try {
            const filename = img.type === "cover" ? "cover.png" : `illustration-${img.index}.png`;
            const imgPath = path.join(imgDir, filename);
            const res = await fetch(img.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            fs.writeFileSync(imgPath, Buffer.from(await res.arrayBuffer()));
            imgCount++;
            console.log(`${TAG} export: 图片[${img.index}] 下载成功 ${filename}`);
          } catch (err) {
            console.error(`${TAG} export: 图片[${img.index}] 下载失败 ${err.message}`);
          }
        }

        const contentHtml = state.content
          .map((seg) => {
            const match = seg.match(/^\[插图-(\d+)\]$/);
            if (match) {
              const img = state.images[parseInt(match[1], 10)];
              if (img?.url) return `<img src="./images/${img.type === "cover" ? "cover" : `illustration-${img.index}`}.png" alt="插图" style="width:100%;border-radius:8px;margin:12px 0">`;
              return `<div style="background:#f0f0f0;height:200px;display:flex;align-items:center;justify-content:center;color:#999;border-radius:8px;margin:12px 0">[插图生成失败]</div>`;
            }
            return `<p style="line-height:1.8;margin:8px 0;color:#333">${seg}</p>`;
          })
          .join("\n");

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${state.title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#fff}
.cover{width:100%;aspect-ratio:3/4;object-fit:cover}
.header{padding:16px 20px}
.title{font-size:20px;font-weight:700;color:#1a1a1a;line-height:1.4}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.tag{color:#ff2442;font-size:13px}
.content{padding:0 20px 40px;font-size:15px}
</style>
</head>
<body>
${state.images[0]?.url ? `<img class="cover" src="./images/cover.png" alt="封面">` : ""}
<div class="header">
  <h1 class="title">${state.title}</h1>
  <div class="tags">${(state.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}</div>
</div>
<div class="content">${contentHtml}</div>
</body>
</html>`;

        const htmlPath = path.join(exportDir, "index.html");
        fs.writeFileSync(htmlPath, html, "utf-8");

        const mdContent = [
          `# ${state.title}`,
          state.excerpt ? `> ${state.excerpt}` : "",
          "",
          ...(state.tags || []).map((t) => `\`${t}\``),
          "",
          ...state.content.map((seg) => {
            const match = seg.match(/^\[插图-(\d+)\]$/);
            if (match) {
              const img = state.images[parseInt(match[1], 10)];
              return img?.url ? `![插图](${img.url})` : "_[插图生成失败]_";
            }
            return seg;
          }),
          "",
          "---",
          "> 由小盛开AI自动生成",
        ].join("\n");

        const mdPath = path.join(exportDir, "note.md");
        fs.writeFileSync(mdPath, mdContent, "utf-8");

        console.log(`${TAG} export: taskId=${taskId} dir="${exportDir}" html=${(fs.statSync(htmlPath).size / 1024).toFixed(1)}KB md=${(fs.statSync(mdPath).size / 1024).toFixed(1)}KB images=${imgCount}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              exportDir,
              files: { html: htmlPath, md: mdPath, images: imgCount },
              note: `笔记已导出到 ${exportDir}`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );
}