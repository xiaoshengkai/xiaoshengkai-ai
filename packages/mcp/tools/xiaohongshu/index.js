import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { marked } from "marked";
import { fileURLToPath } from "node:url";
import { searchChroma } from "../../lib/chroma.js";
import { generateImage } from "../../../shared/llm/providers/minimax.js";
import { callLLM as callProviderLLM, PROVIDER } from "../../../shared/llm/index.js";
import { sleep, shortId } from "../../../shared/utils.js";
import { writeTaskState, readTaskState, updateTask, getAdaptiveWait } from "../../lib/task-state.js";
import { parseJSON } from "../../../shared/llm/parse-json.js";

const TASK_DIR = path.join(os.tmpdir(), "xhs-tasks");
const TAG = "[xhs]";

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, `${name}.md`), "utf-8");
}

const TEMPLATES = {
  knowledge: {
    finance: {
      maxTokens: 10000,
      systemPrompt: loadTemplate("knowledge/finance"),
      coverStyle: "lively hand-drawn illustration, warm gold and navy blue palette, 3:4 vertical",
      illustrationStyle: "lively hand-drawn illustration, warm gold and navy blue palette, 1:1 square",
    },
    _default: {
      maxTokens: 10000,
      systemPrompt: loadTemplate("knowledge"),
      coverStyle: "lively hand-drawn illustration, warm colors, playful, 3:4 vertical",
      illustrationStyle: "lively hand-drawn illustration, warm colors, playful, 1:1 square",
    },
  },
  product_review: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
  experience: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
  opinion: { systemPrompt: "（待实现）", coverStyle: "", illustrationStyle: "" },
};

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SITE_DIR = path.join(PROJECT_ROOT, "site");

const CATEGORY_META = {
  finance: { label: "金融学习笔记", desc: "重塑金钱观，从第一课开始", color: "card-blue" },
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || { label: category, desc: "", color: "card-blue" };
}

function syncToBlog(exportDir, state, category) {
  const safeTitle = state.title.replace(/[\/\\:*?"<>|]/g, "_");
  const blogDir = path.join(SITE_DIR, category, safeTitle);

  if (fs.existsSync(blogDir)) {
    fs.rmSync(blogDir, { recursive: true });
  }

  fs.cpSync(exportDir, blogDir, { recursive: true });

  // 保存 task.json 到博客目录，供 updateBlogIndex 读取元数据
  fs.writeFileSync(path.join(blogDir, "task.json"), JSON.stringify({
    title: state.title,
    excerpt: state.excerpt || "",
    tags: state.tags || [],
    topic: state.topic || "",
    subcategory: state.subcategory || category,
    imagery: state.images?.filter(img => img.status === "done").length || 0,
  }, null, 2));

  console.log(`${TAG} syncToBlog: category=${category} dir="${blogDir}"`);
}

function updateBlogIndex(category) {
  const catDir = path.join(SITE_DIR, category);
  if (!fs.existsSync(catDir)) return;

  const meta = getCategoryMeta(category);

  // 扫描所有文章目录
  const entries = [];
  for (const name of fs.readdirSync(catDir)) {
    const entryDir = path.join(catDir, name);
    if (!fs.statSync(entryDir).isDirectory()) continue;
    const indexHtml = path.join(entryDir, "index.html");
    if (!fs.existsSync(indexHtml)) continue;

    let title = name;
    let excerpt = "";

    const taskFile = path.join(entryDir, "task.json");
    if (fs.existsSync(taskFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        title = data.title || name;
        excerpt = data.excerpt || "";
      } catch {}
    }

    const coverPath = path.join(entryDir, "images", "cover.jpg");
    const hasCover = fs.existsSync(coverPath);

    entries.push({ name, title, excerpt, hasCover });
  }

  // 按修改时间倒序
  entries.sort((a, b) => {
    const aTime = fs.statSync(path.join(catDir, a.name)).mtimeMs;
    const bTime = fs.statSync(path.join(catDir, b.name)).mtimeMs;
    return bTime - aTime;
  });

  const cardsHtml = entries.map((entry) => {
    const encodedName = encodeURIComponent(entry.name);
    const thumbStyle = entry.hasCover
      ? ` style="background-image:url(${encodedName}/images/cover.jpg)"`
      : "";
    const excerptHtml = entry.excerpt
      ? `\n        <p class="card-sub">${entry.excerpt}</p>`
      : "";

    return `    <a href="${encodedName}/" target="_blank" class="card article-card ${meta.color}">
      <div class="card-thumb"${thumbStyle}></div>
      <div class="card-body">
        <p class="card-desc">${entry.title}</p>${excerptHtml}
      </div>
    </a>`;
  }).join("\n\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${meta.label} · 开盛的博客</title>
<meta name="description" content="${meta.desc}">
<meta property="og:title" content="${meta.label} · 开盛的博客">
<meta property="og:description" content="${meta.desc}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="../assets/pixel.css">
</head>
<body>

<div class="pixel-dots"></div>

<div class="container">
  <a href="../" class="back-link"><span class="arrow">←</span> 返回首页</a>

  <div class="section-header">
    <div class="card-body">
      <p class="card-desc">${meta.label}</p>
      <p class="card-meta">${meta.desc} · 共 ${entries.length} 篇笔记</p>
    </div>
  </div>

  <div class="card-grid">

${cardsHtml}

  </div>

  <footer class="footer">
    <p>© 2026 开盛</p>
  </footer>
</div>

</body>
</html>`;

  const indexPath = path.join(catDir, "index.html");
  fs.writeFileSync(indexPath, html, "utf-8");
  console.log(`${TAG} updateBlogIndex: category=${category} entries=${entries.length}`);
}

// writeTaskState / updateTask / parseJSON — 已迁到 shared/ 和 mcp/lib/task-state.js

async function callLLM(prompt, style, subcategory) {
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

  console.log(`${TAG} callLLM: style=${style}${subcategory ? "/" + subcategory : ""} maxTokens=${template.maxTokens || 2000} prompt=${prompt.length}字`);

  const systemContent = `${template.systemPrompt}

返回严格的 JSON 格式（不要包含 markdown 代码块标记）：
{
  "title": "笔记标题（10-20字，吸引人）",
  "excerpt": "精彩摘要，≤30字，吸引读者点击阅读",
  "content": ["段落1", "[IMG-1]", "段落2", "[IMG-2]", "段落3"],
  "tags": ["#标签1", "#标签2", "#标签3"],
  "coverPrompt": "封面图英文 prompt",
  "illustrationPrompts": ["插画1英文prompt", "插画2英文prompt"]
}

规则：
- 正文6-10段，每段3-5句，内容丰富但不啰嗦
- 每个概念配一个具体、有画面感的例子，让读者看完就能记住
- 同类数据对比用结构化列表（不要用表格，小红书不支持），每项一行，格式示例：
  - **信息差套利**：100元启动，1-2天回本，利润率50-100%，门槛低，复利2颗星
  - **技能变现**：0元启动，1-3天回本，利润率200%+，门槛中高，复利4颗星
- 可用内容形式：### 小标题分段、**加粗**强调、- 列表拆解、> 金句引用
- 每段根据内容选合适格式，不堆纯文字，段落间用空行隔开
- 插画3-5张，穿插在段落之间，长内容多配图降低阅读压力
- content 数组用 "[IMG-N]" 标记插画位置
- 封面 prompt 要求：${template.coverStyle}
- 插画 prompt 要求：${template.illustrationStyle}
- 所有 prompt 用英文，描述具体画面内容
- 涉及具体数据或关键信息要准确，不要编造`;

  const tStart = Date.now();
  const { text, usage } = await callProviderLLM({
    system: systemContent,
    user: prompt,
    maxTokens: template.maxTokens || 2000,
  });

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);

  let noteData;
  try {
    noteData = parseJSON(text);
  } catch (err) {
    console.error(`${TAG} callLLM: JSON 解析失败，原始内容(${text.length}字):\n${text.slice(0, 500)}`);
    throw err;
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
      console.log(`${TAG} image[${img.index}] ${img.type}: 失败 ${err.message}`);
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

        if (PROVIDER === "minimax") {
          if (!process.env.MINIMAX_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 MINIMAX_API_KEY" }) }] };
        } else if (PROVIDER === "glm") {
          if (!process.env.GLM_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 GLM_API_KEY" }) }] };
        } else {
          if (!process.env.DEEPSEEK_API_KEY) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 DEEPSEEK_API_KEY" }) }] };
        }

        const category = TEMPLATES[style];
        if (!category) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `未知模板: ${style}` }) }] };

        if (subcategory && category[subcategory] && category[subcategory].systemPrompt === "（待实现）") {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `「${style}/${subcategory}」模板尚未实现` }) }] };
        }

        const knowledge = await searchChroma(topic);
        console.log(`${TAG} searchChroma: 结果=${knowledge?.length || 0}字`);

        const prompt = `主题：${topic}\n${context ? `对话内容：${context}\n` : ""}相关知识：${knowledge || "无"}`;
        const noteData = await callLLM(prompt, style, subcategory);

        const taskId = shortId();
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
              note: { title: noteData.title, excerpt: noteData.excerpt, imageCount: images.length },
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
            return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "content 必须是 JSON 数组字符串，如 [\"段落1\",\"[IMG-1]\",\"段落2\"]" }) }] };
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
        const count = state.checkCount || 0;
        const wait = getAdaptiveWait(interval, count);
        updateTask(workDir, { checkCount: count + 1 });
        console.log(`${TAG} checkProgress: taskId=${taskId} status=${state.status} count=${count} wait=${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        const updated = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        const doneCount = updated.images?.filter((img) => img.status === "done").length || 0;
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId: updated.taskId, status: updated.status, title: updated.title, readyCount: doneCount, totalCount: updated.images?.length || 0 }, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId: state.taskId, status: state.status, previewUrl: `/note/${state.taskId}`, iframe: `<iframe src="/note/${state.taskId}" width="100%" height="600" style="border:none"></iframe>`, note: { title: state.title, excerpt: state.excerpt, content: state.content, tags: state.tags, images: state.images } }, null, 2) }] };
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
            const filename = img.type === "cover" ? "cover.jpg" : `illustration-${img.index}.jpg`;
            const imgPath = path.join(imgDir, filename);
            const res = await fetch(img.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw = Buffer.from(await res.arrayBuffer());
            // 压缩图片
            const sharp = (await import("sharp")).default;
            const compressed = await sharp(raw)
              .rotate()
              .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            fs.writeFileSync(imgPath, compressed);
            imgCount++;
            console.log(`${TAG} export: 图片[${img.index}] 下载成功 ${filename} (${(raw.length/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB)`);
          } catch (err) {
            console.error(`${TAG} export: 图片[${img.index}] 下载失败 ${err.message}`);
          }
        }

        const markdown = state.content
          .map((seg) => {
            const match = seg.match(/^\[IMG-(\d+)\]$/);
            if (match) {
              const img = state.images[parseInt(match[1], 10)];
              if (img?.url) return `<img src="./images/${img.type === "cover" ? "cover" : `illustration-${img.index}`}.jpg" alt="插图" class="img-block">`;
              return `<div class="img-placeholder">[插图生成失败]</div>`;
            }
            return seg;
          })
          .join("\n\n");

        const contentHtml = marked.parse(markdown);

        const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${state.title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:600px;margin:0 auto;padding:0;background:#fff;color:#333}
.cover{width:100%;aspect-ratio:3/4;object-fit:cover}
.header{padding:16px 20px}
.title{font-size:20px;font-weight:700;color:#1a1a1a;line-height:1.4}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.tag{color:#ff2442;font-size:13px}
.content{padding:0 20px 40px;font-size:15px;line-height:1.85}
.content h3{font-size:18px;font-weight:700;margin:28px 0 12px;padding-left:12px;border-left:3px solid #ff2442;color:#1a1a1a}
.content p{margin:10px 0}
.content strong{color:#1a1a1a;font-weight:700}
.content blockquote{margin:14px 0;padding:12px 16px;background:#fdf6f0;border-left:3px solid #f0a060;border-radius:0 8px 8px 0;color:#8b5e3c;font-size:14px}
.content ul,.content ol{padding-left:20px;margin:8px 0}
.content li{margin:4px 0}
.content table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px}
.content th{background:#fdf6f0;padding:8px 12px;text-align:left;font-weight:700;border-bottom:2px solid #e0d0c0}
.content td{padding:8px 12px;border-bottom:1px solid #f0e0d0}
.content hr{border:none;border-top:1px solid #e0d0c0;margin:24px 0}
.img-block{width:100%;max-width:600px;border-radius:8px;margin:12px 0}
.img-placeholder{height:200px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;border-radius:8px;margin:12px 0;font-size:14px}
</style>
</head>
<body>
<nav style="padding:14px 20px;border-bottom:3px solid #1A1A1A;background:#FFF;position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center"><a href="../" style="display:inline-flex;align-items:center;gap:6px;color:#1A1A1A;text-decoration:none;font-size:14px;font-weight:500;transition:transform 0.2s" onmouseenter="this.style.transform='translateX(-4px)'" onmouseleave="this.style.transform='translateX(0)'"><span>←</span> 返回列表</a></nav>
${state.images[0]?.url ? `<img class="cover" src="./images/cover.jpg" alt="封面">` : ""}
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
              return img?.url ? `![插图](./images/${img.type === "cover" ? "cover" : `illustration-${img.index}`}.jpg)` : "_[插图生成失败]_";
            }
            return seg + "\n";
          }),
          "",
          "",
        ].join("\n");

        const mdPath = path.join(exportDir, "note.md");
        fs.writeFileSync(mdPath, mdContent, "utf-8");

        console.log(`${TAG} export: taskId=${taskId} dir="${exportDir}" html=${(fs.statSync(htmlPath).size / 1024).toFixed(1)}KB md=${(fs.statSync(mdPath).size / 1024).toFixed(1)}KB images=${imgCount}`);

        // 同步到博客
        const category = state.subcategory || "finance";
        const safeTitle = state.title.replace(/[\/\\:*?"<>|]/g, "_");
        const blogUrl = `https://node.tailddce43.ts.net/${category}/${safeTitle}/`;
        let blogSynced = false;
        try {
          syncToBlog(exportDir, state, category);
          updateBlogIndex(category);
          blogSynced = true;
          console.log(`${TAG} export: 已同步到博客 ${blogUrl}`);
        } catch (blogErr) {
          console.error(`${TAG} export: 同步到博客失败 ${blogErr.message}`);
        }

        // 校验导出内容完整性
        const htmlExists = fs.existsSync(htmlPath);
        const mdExists = fs.existsSync(mdPath);
        const htmlSize = htmlExists ? fs.statSync(htmlPath).size : 0;
        const mdSize = mdExists ? fs.statSync(mdPath).size : 0;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              exportDir,
              blogUrl: blogSynced ? blogUrl : null,
              files: { html: htmlPath, md: mdPath, images: imgCount },
              verified: { htmlExists, mdExists, htmlSize, mdSize, imgCount },
              note: blogSynced
                ? `笔记已导出到 ${exportDir}，博客地址：${blogUrl}`
                : `笔记已导出到 ${exportDir}（博客同步失败：${blogErr?.message || "未知"}）`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );
}