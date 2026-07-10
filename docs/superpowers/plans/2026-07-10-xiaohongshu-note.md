# 小红书笔记自动生成 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话中一句话触发，自动将当前对话 + 记忆库内容生成带封面、插画、标签的完整小红书笔记，聊天内嵌预览，对话修改，导出 HTML。

**Architecture:** 4 个 MCP 工具（generate/update/check/export）+ 1 个 skill（SKILL.md）+ 前端 NotePreviewCard 组件 + 独立预览页 + 状态 API。图片异步生成复用现有 MiniMax image-01 模式，任务状态持久化到 `/tmp/xhs-tasks/`。

**Tech Stack:** Node.js (ESM) / zod / ChromaDB / MiniMax image-01 / DeepSeek API / Next.js 16 / React 19 / TypeScript / Tailwind CSS 4

## Global Constraints

- 零新增依赖，全部复用现有能力
- 图片生成使用 MiniMax image-01，异步 taskId 模式
- 任务状态持久化到 `/tmp/xhs-tasks/<taskId>/task.json`
- MCP 工具返回 `{ ok: true/false, ... }` 格式
- 前端像素复古风，使用 shadcn/ui 组件
- 封面 3:4 竖版，插画 1:1 方形

---

### Task 1: 创建小红书笔记生成 Skill

**Files:**
- Create: `packages/skills/xiaohongshu-note/SKILL.md`

**Interfaces:**
- Consumes: nothing
- Produces: Skill 被 `buildSkillList()` 扫描注入 system prompt，LLM 按 skill 指令调用 MCP 工具

- [ ] **Step 1: 创建 SKILL.md**

```markdown
---
name: xiaohongshu-note
description: 小红书笔记自动生成技能，将当前对话内容+记忆库知识整理为带封面、插画和标签的完整小红书笔记，支持修改和导出
---

# 小红书笔记生成技能

## 角色
你是专业的小红书内容创作者，擅长将对话/知识整理为吸引人的图文笔记。

## 使用流程

1. 用户说"生成小红书笔记"、"整理成笔记"、"导出笔记"等 → 先调用 generateXiaohongshuNote({ topic }) 生成笔记
   - topic 从当前对话中提取，概括主题（如"OpenCode 配置技巧"、"React 性能优化"）
2. 用 checkXiaohongshuNoteProgress(taskId, interval=3) 轮询进度，等 status=ready
3. 笔记就绪后展示预览
4. 用户要修改 → 调用 updateXiaohongshuNote({ taskId, field, value })
   - field: title/content/tags 或 image_N（N 是图片索引）
   - 修改 image_N 时会重新生成该图片，需再次轮询进度
5. 用户要导出 → 调用 exportXiaohongshuNote({ taskId })
   - 开发模式下告诉用户 HTML 文件路径
   - 生产模式下打开预览页 /note/[taskId]

## 笔记内容规范

- 标题：10-20 字，吸引眼球，可加 emoji
- 正文：分段清晰，每段 2-4 句，配插画穿插
- 标签：3-5 个相关话题标签
- 封面：3:4 竖版插画风格，突出主题
- 插画：1:1 方形插画风格，与封面统一但更轻量
```

- [ ] **Step 2: 验证 skill 文件存在**

```bash
cat packages/skills/xiaohongshu-note/SKILL.md | head -3
```
Expected: 显示 frontmatter `---` 头部

---

### Task 2: 创建 MCP 工具模块

**Files:**
- Create: `packages/mcp/tools/xiaohongshu/index.js`

**Interfaces:**
- Consumes: `chromadb` (ChromaClient), `node:fs/path/os/crypto`, `zod`
- Produces: `export function register(server)` — 注册 4 个工具
  - `generateXiaohongshuNote({ topic: string })` → `{ ok, taskId, status }`
  - `updateXiaohongshuNote({ taskId: string, field: enum, value: string })` → `{ ok, note }`
  - `checkXiaohongshuNoteProgress({ taskId: string, interval?: number })` → `{ ok, taskId, status, note }`
  - `exportXiaohongshuNote({ taskId: string })` → `{ ok, htmlPath }`

- [ ] **Step 1: 创建 xiaohongshu/index.js 完整实现**

```js
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ChromaClient } from "chromadb";

const TASK_DIR = path.join(os.tmpdir(), "xhs-tasks");
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const MINIMAX_BASE = "https://api.minimax.chat/v1";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchKnowledgeBase(query) {
  try {
    const client = new ChromaClient({ path: "http://localhost:8000" });
    const results = [];

    const collections = [
      { name: "chat_knowledge", db: "chat" },
      { name: "base_knowledge", db: "shared" },
    ];

    for (const { name } of collections) {
      try {
        const col = await client.getCollection({ name });
        const r = await col.query({ queryTexts: [query], nResults: 5 });
        const docs = r.documents?.[0] || [];
        results.push(...docs);
      } catch {
        // collection may not exist
      }
    }

    return results.slice(0, 8).join("\n\n");
  } catch (err) {
    console.error("[xhs] searchKnowledgeBase error:", err.message);
    return "";
  }
}

async function callLLM(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY");

  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `你是专业的小红书内容创作者。根据用户提供的主题和知识素材，生成一篇小红书笔记。

返回严格的 JSON 格式（不要包含 markdown 代码块标记）：
{
  "title": "笔记标题（10-20字，吸引人）",
  "content": ["段落1", "[插图-1]", "段落2", "[插图-2]", "段落3"],
  "tags": ["#标签1", "#标签2", "#标签3"],
  "coverPrompt": "封面图英文 prompt，插画风格，3:4竖版，突出主题，色彩温暖",
  "illustrationPrompts": ["插画1英文prompt，1:1方形，插画风格", "插画2英文prompt"]
}

规则：
- 正文3-5段，每段2-4句，中文
- 插画数量根据内容决定（1-3张），穿插在段落之间
- content 数组用 "[插图-N]" 标记插画位置
- 封面和插画都用插画风格（illustration style），封面更突出主题，插画更轻量
- 所有 prompt 用英文，描述具体画面内容
- 涉及具体数据或关键信息要准确，不要编造`
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

async function generateImageAsync(taskId, imageIndex, prompt, aspectRatio) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) throw new Error("未配置 MINIMAX_API_KEY");

    const res = await fetch(`${MINIMAX_BASE}/image_generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "image-01",
        prompt,
        aspect_ratio: aspectRatio,
        n: 1,
        prompt_optimizer: true,
        response_format: "url",
      }),
    });

    const result = await res.json();
    if (result.base_resp?.status_code !== 0) {
      throw new Error(result.base_resp?.status_msg || "图片生成失败");
    }

    const url = result.data?.image_urls?.[0];
    if (!url) throw new Error("未获取到图片 URL");

    return url;
  } catch (err) {
    throw new Error(`图片 ${imageIndex} 生成失败: ${err.message}`);
  }
}

async function generateAllImages(taskId, workDir, images) {
  const state = JSON.parse(fs.readFileSync(path.join(workDir, "task.json"), "utf-8"));

  for (const img of images) {
    try {
      updateTask(workDir, {
        [`images.${img.index}.status`]: null,
        [`images.${img.index}.url`]: null,
      });
      // ponytail: 就地更新单个 image 状态，task.json 结构简单够用
      const aspectRatio = img.type === "cover" ? "3:4" : "1:1";
      const url = await generateImageAsync(taskId, img.index, img.prompt, aspectRatio);

      state.images[img.index].url = url;
      state.images[img.index].status = "done";
      writeTaskState(workDir, state);
    } catch (err) {
      state.images[img.index].status = "failed";
      state.images[img.index].error = err.message;
      writeTaskState(workDir, state);
    }
  }

  const allDone = state.images.every((img) => img.status === "done");
  const hasFailed = state.images.some((img) => img.status === "failed");

  state.status = allDone ? "ready" : hasFailed ? "partial" : "ready";
  writeTaskState(workDir, state);
}

export function register(server) {
  server.tool(
    "generateXiaohongshuNote",
    "根据主题生成小红书笔记（含封面、插画、标签）。自动检索记忆库补充内容，异步生成所有配图。返回 taskId 后用 checkXiaohongshuNoteProgress 查询进度。",
    {
      topic: z.string().min(1).max(200).describe("笔记主题，从对话中提取，如 'React 性能优化技巧'"),
    },
    async ({ topic }) => {
      try {
        const deepseekKey = process.env.DEEPSEEK_API_KEY;
        const minimaxKey = process.env.MINIMAX_API_KEY;
        if (!deepseekKey) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 DEEPSEEK_API_KEY" }) }] };
        if (!minimaxKey) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "未配置 MINIMAX_API_KEY" }) }] };

        const knowledge = await searchKnowledgeBase(topic);
        const prompt = `主题：${topic}\n\n相关知识：${knowledge || "无"}`;
        const noteData = await callLLM(prompt);

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
          title: noteData.title,
          content: noteData.content,
          tags: noteData.tags,
          images,
        };

        writeTaskState(workDir, state);

        generateAllImages(taskId, workDir, images).catch((err) => {
          updateTask(workDir, { status: "failed", error: err.message });
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              taskId,
              status: "generating",
              note: { title: noteData.title, content: noteData.content, tags: noteData.tags, images },
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
      field: z.string().min(1).describe("要修改的字段: title, content, tags, 或 image_0, image_1 等"),
      value: z.string().min(1).describe("新值。字段为 image_N 时是新 prompt，content 时是 JSON 数组字符串"),
    },
    async ({ taskId, field, value }) => {
      try {
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
            state.content = value;
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
            text: JSON.stringify({ ok: true, note: { title: state.title, content: state.content, tags: state.tags, images: state.images } }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );

  server.tool(
    "checkXiaohongshuNoteProgress",
    "查询小红书笔记生成任务进度。返回 progress 和 status 字段。status=ready 时所有图片已生成完毕。",
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
        await sleep(wait);
        const updated = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    },
  );

  server.tool(
    "exportXiaohongshuNote",
    "将小红书笔记导出为 HTML 文件，保存到 Downloads 目录。",
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

        const contentHtml = state.content
          .map((seg) => {
            const match = seg.match(/^\[插图-(\d+)\]$/);
            if (match) {
              const img = state.images[parseInt(match[1], 10)];
              if (img?.url) return `<img src="${img.url}" alt="插图" style="width:100%;border-radius:8px;margin:12px 0">`;
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
${state.images[0]?.url ? `<img class="cover" src="${state.images[0].url}" alt="封面">` : ""}
<div class="header">
  <h1 class="title">${state.title}</h1>
  <div class="tags">${(state.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}</div>
</div>
<div class="content">${contentHtml}</div>
</body>
</html>`;

        const safeName = state.title.replace(/[\/\\:*?"<>|]/g, "_");
        const htmlPath = path.join(downloadsDir, `${safeName}.html`);
        fs.writeFileSync(htmlPath, html, "utf-8");

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: true, htmlPath, note: `笔记已导出到 ${htmlPath}` }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );
}
```

- [ ] **Step 2: 验证语法正确**

```bash
node --check packages/mcp/tools/xiaohongshu/index.js
```
Expected: 无输出（语法正确）

---

### Task 3: 注册 MCP 模块

**Files:**
- Modify: `packages/mcp/index.js`

**Interfaces:**
- Consumes: `./tools/xiaohongshu/index.js` → `register(server)`
- Produces: xiaohongshu 模块加入 modules 数组

- [ ] **Step 1: 在 packages/mcp/index.js 添加 import 和注册**

在 `import { register as registerDiagram }` 行之后添加：

```js
import { register as registerXiaohongshu } from "./tools/xiaohongshu/index.js";
```

在 modules 数组末尾（`diagram` 之后）添加：

```js
  { name: "xiaohongshu", register: registerXiaohongshu },
```

- [ ] **Step 2: 验证 modules 数组完整**

```bash
grep -n "register" packages/mcp/index.js | head -20
```
Expected: 输出包含 `registerXiaohongshu` 和对应的 modules 条目

---

### Task 4: 创建笔记状态查询 API

**Files:**
- Create: `packages/ai-chat/src/app/api/note/[taskId]/status/route.ts`

**Interfaces:**
- Consumes: `/tmp/xhs-tasks/<taskId>/task.json`
- Produces: `GET /api/note/[taskId]/status` → JSON `{ taskId, status, title, content, tags, images }`

- [ ] **Step 1: 创建 route.ts**

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const taskFile = path.join(os.tmpdir(), "xhs-tasks", taskId, "task.json");
  if (!fs.existsSync(taskFile)) {
    return Response.json({ ok: false, error: "笔记任务不存在或已过期" }, { status: 404 });
  }

  const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
  return Response.json(state);
}
```

- [ ] **Step 2: 验证语法正确**

```bash
npx tsc --noEmit packages/ai-chat/src/app/api/note/\[taskId\]/status/route.ts 2>&1 | head -5
```

---

### Task 5: 创建 NotePreviewCard 组件

**Files:**
- Create: `packages/ai-chat/src/components/chat/note-preview-card.tsx`

**Interfaces:**
- Consumes: `NoteData` type `{ taskId, status, title, content: string[], tags: string[], images: { index, type, url, status }[] }`
- Produces: React 组件，接收 `taskId` prop，渲染聊天内嵌预览卡片

- [ ] **Step 1: 创建 note-preview-card.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface NoteImage {
  index: number;
  type: "cover" | "illustration";
  prompt: string;
  url: string | null;
  status: "pending" | "done" | "failed";
}

interface NoteData {
  taskId: string;
  status: "generating" | "ready" | "failed" | "partial";
  title: string;
  content: string[];
  tags: string[];
  images: NoteImage[];
}

export default function NotePreviewCard({ taskId }: { taskId: string }) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      while (!cancelled && attempts < 30) {
        try {
          const res = await fetch(`/api/note/${taskId}/status`);
          const data = await res.json();
          if (!cancelled) {
            setNote(data);
            if (data.status === "ready" || data.status === "partial" || data.status === "failed") {
              return;
            }
          }
        } catch {
          // retry
        }
        attempts++;
        const wait = Math.max(3000 * Math.pow(0.9, attempts), 1800);
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!cancelled && !note) setError("笔记生成超时");
    }

    poll();
    return () => { cancelled = true; };
  }, [taskId]);

  if (error) {
    return (
      <div className="pixel-card p-4 my-2 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!note) {
    return (
      <div className="pixel-card p-4 my-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="pixel-loading-dots" />
          小红书笔记生成中...
        </div>
      </div>
    );
  }

  const cover = note.images?.[0];
  const illustrations = note.images?.filter((img) => img.type === "illustration") || [];

  return (
    <div className="pixel-card my-2 overflow-hidden">
      {/* 封面 */}
      {cover?.url ? (
        <img src={cover.url} alt={note.title} className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="w-full aspect-[3/4] bg-muted flex items-center justify-center text-sm text-muted-foreground">
          封面生成中...
        </div>
      )}

      {/* 标题 + 正文 */}
      <div className="p-4">
        <h3 className="text-base font-bold mb-3">{note.title}</h3>
        <div className="text-sm space-y-2">
          {note.content?.map((seg, i) => {
            const match = seg.match(/^\[插图-(\d+)\]$/);
            if (match) {
              const img = illustrations[parseInt(match[1], 10) - 1];
              if (img?.url) {
                return <img key={i} src={img.url} alt="插画" className="w-full rounded pixel-img my-2" />;
              }
              return (
                <div key={i} className="h-32 bg-muted flex items-center justify-center text-xs text-muted-foreground my-2">
                  插画生成中...
                </div>
              );
            }
            return <p key={i} className="leading-relaxed">{seg}</p>;
          })}
        </div>

        {/* 标签 */}
        <div className="flex flex-wrap gap-2 mt-3">
          {note.tags?.map((tag) => (
            <span key={tag} className="text-xs text-[#ff2442]">{tag}</span>
          ))}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
          <a
            href={`/note/${taskId}`}
            target="_blank"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            rel="noreferrer"
          >
            <ExternalLink className="size-3" />
            打开预览
          </a>
          {note.status === "generating" && (
            <span className="text-xs text-muted-foreground ml-auto">
              {note.images?.filter((img) => img.status === "done").length}/{note.images?.length} 张图片
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证语法正确**

```bash
npx tsc --noEmit packages/ai-chat/src/components/chat/note-preview-card.tsx 2>&1 | head -10
```

---

### Task 6: 创建独立预览页

**Files:**
- Create: `packages/ai-chat/src/app/note/[taskId]/page.tsx`

**Interfaces:**
- Consumes: `/api/note/[taskId]/status` (fetch)
- Produces: 完整小红书笔记预览页，含导出按钮

- [ ] **Step 1: 创建 page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";

interface NoteImage {
  index: number;
  type: "cover" | "illustration";
  prompt: string;
  url: string | null;
  status: string;
}

interface NoteData {
  taskId: string;
  status: string;
  title: string;
  content: string[];
  tags: string[];
  images: NoteImage[];
}

export default function NotePreviewPage() {
  const params = useParams();
  const taskId = params.taskId as string;
  const [note, setNote] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/note/${taskId}/status`)
      .then((r) => r.json())
      .then((data) => {
        setNote(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [taskId]);

  const handleExport = async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: `导出小红书笔记 ${taskId}` }],
          },
        ],
      }),
    });
    // 触发 LLM 调用 exportXiaohongshuNote
    const data = await res.json();
    console.log("Export triggered:", data);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-400">笔记不存在或已过期</div>
      </div>
    );
  }

  const cover = note.images?.[0];
  const illustrations = note.images?.filter((img) => img.type === "illustration") || [];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[600px] mx-auto">
        {cover?.url ? (
          <img src={cover.url} alt={note.title} className="w-full" style={{ aspectRatio: "3/4", objectFit: "cover" }} />
        ) : (
          <div className="w-full bg-gray-100 flex items-center justify-center text-gray-400" style={{ aspectRatio: "3/4" }}>
            封面生成中...
          </div>
        )}

        <div className="px-5 pt-4 pb-5">
          <h1 className="text-xl font-bold text-gray-900 leading-snug">{note.title}</h1>

          <div className="flex flex-wrap gap-2 mt-3">
            {note.tags?.map((tag) => (
              <span key={tag} className="text-sm text-[#ff2442]">{tag}</span>
            ))}
          </div>

          <div className="mt-4 text-[15px] leading-relaxed text-gray-800 space-y-3">
            {note.content?.map((seg, i) => {
              const match = seg.match(/^\[插图-(\d+)\]$/);
              if (match) {
                const img = illustrations[parseInt(match[1], 10) - 1];
                if (img?.url) {
                  return <img key={i} src={img.url} alt="插画" className="w-full rounded-lg my-4" />;
                }
                return (
                  <div key={i} className="h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm my-4">
                    插画生成中...
                  </div>
                );
              }
              return <p key={i}>{seg}</p>;
            })}
          </div>

          <div className="mt-8 pt-4 border-t border-gray-100">
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-[#ff2442] text-white text-sm rounded-full hover:bg-[#e02038] transition-colors"
            >
              <Download className="size-4" />
              导出 HTML
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证语法正确**

```bash
npx tsc --noEmit packages/ai-chat/src/app/note/\[taskId\]/page.tsx 2>&1 | head -10
```

---

### Task 7: 修改 message-item.tsx 识别 xhs 任务

**Files:**
- Modify: `packages/ai-chat/src/components/chat/message-item.tsx`

**Interfaces:**
- Consumes: `NotePreviewCard` 组件
- Produces: 检测 AI 消息中的 xhs 任务标记，渲染 NotePreviewCard 替代 tool 标记

- [ ] **Step 1: 在 message-item.tsx 顶部添加 import**

```tsx
import NotePreviewCard from "@/components/chat/note-preview-card";
```

- [ ] **Step 2: 在渲染 tool parts 处添加 xhs 检测**

找到 `if (part.type && isToolUIPart(part))` 这段（约第 150 行），替换为：

```tsx
if (part.type && isToolUIPart(part)) {
  const toolPart = part as { toolName: string; state: string; output: string };
  if (toolPart.toolName === "generateXiaohongshuNote" && toolPart.state === "result") {
    try {
      const output = JSON.parse(toolPart.output);
      if (output?.ok && output?.taskId) {
        return <NotePreviewCard key={i} taskId={output.taskId} />;
      }
    } catch { /* fall through to tool label */ }
  }
  return <span key={i} className="text-xs text-muted-foreground/50">[{toolPart.toolName}]</span>;
}
```

- [ ] **Step 3: 验证语法正确**

```bash
npx tsc --noEmit packages/ai-chat/src/components/chat/message-item.tsx 2>&1 | head -10
```

---

### Task 8: 更新 chat route 系统提示

**Files:**
- Modify: `packages/ai-chat/src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: TOOLS_PROMPT 增加 xiaohongshu 工具说明

- [ ] **Step 1: 在 TOOLS_PROMPT 中添加 xiaohongshu 工具说明**

在 TOOLS_PROMPT 常量末尾（`其他: 时间/待办/文件/网页爬取` 之前或之后）添加：

```
- 小红书笔记: generateXiaohongshuNote → checkXiaohongshuNoteProgress | updateXiaohongshuNote | exportXiaohongshuNote
  用户说"生成笔记"、"整理成小红书"、"导出笔记"时调用
  generateXiaohongshuNote 返回 taskId → checkXiaohongshuNoteProgress(taskId, interval=3) 轮询等 ready
  修改笔记用 updateXiaohongshuNote({ taskId, field, value })，field 取值: title/content/tags/image_N
  导出用 exportXiaohongshuNote({ taskId })
```

- [ ] **Step 2: 验证完整 system prompt 构建**

```bash
grep -A 2 "xiaohongshu" packages/ai-chat/src/app/api/chat/route.ts
```
Expected: 输出包含 xiaohongshu 工具说明

---

### Task 9: 端到端验证

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 测试 generate 流程**

在聊天输入框发送："帮我把这段对话整理成小红书笔记，主题是 AI 编程助手"

Expected:
- 聊天中显示"小红书笔记生成中..."加载状态
- 图片逐步就绪后显示 NotePreviewCard 完整预览
- 封面图 + 标题 + 正文 + 插画 + 标签

- [ ] **Step 3: 测试 update 流程**

在聊天中输入："把标题改成 'AI 编程助手使用指南'"

Expected:
- LLM 调用 updateXiaohongshuNote
- 预览卡片标题更新

- [ ] **Step 4: 测试独立预览页**

点击 NotePreviewCard 中的"打开预览"链接

Expected:
- 新标签页打开 `/note/[taskId]`
- 显示完整笔记预览

- [ ] **Step 5: 测试导出**

在聊天中输入："导出这个笔记"

Expected:
- LLM 调用 exportXiaohongshuNote
- 控制台输出 HTML 文件路径
- 文件存在于 ~/Downloads/ 目录