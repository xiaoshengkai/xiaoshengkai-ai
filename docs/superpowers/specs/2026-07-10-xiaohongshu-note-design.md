# 小红书笔记自动生成 - 设计文档

## 概述

对话中一句话触发，AI 自动将当前对话 + 记忆库相关内容总结成小红书笔记，含封面、插画（穿插正文）、标签。聊天内嵌预览，通过对话修改，导出 HTML。

## 交互流程

```
用户: "帮我把这段整理成小红书笔记"
  ↓
LLM → generateXiaohongshuNote（无参数，从上下文推断）
  ↓
聊天中展示 NotePreviewCard（内嵌预览，实时更新进度）
  ↓
图片逐步就绪，卡片自动刷新
  ↓
用户: "把标题改成XXX" → LLM → updateXiaohongshuNote
用户: "第三张图换一个风格" → LLM → updateXiaohongshuNote → 重新生成图片
用户: "导出笔记" → LLM → exportXiaohongshuNote
  ↓
开发模式：控制台输出 HTML 路径
生产模式：独立预览页 /note/[taskId] 提供下载
```

## 3 个 MCP 工具

### generateXiaohongshuNote

无参数，LLM 自动从当前对话上下文推断主题。

**内部流程：**
1. 从调用上下文获取当前对话内容（LLM 工具调用时自带的对话历史）
2. 检索记忆库：用对话主题搜索 Chroma（shared + chat）
3. 构建 prompt → 调用 LLM 生成结构化笔记内容
4. 为封面和每张插画生成 prompt
5. 调用 generateImage 异步生成所有配图
6. 返回 taskId

**返回格式：**
```json
{
  "ok": true,
  "taskId": "uuid",
  "status": "generating",
  "note": {
    "title": "…",
    "content": "正文段落数组，每段可能含 [插图-N] 标记",
    "tags": ["#标签1", "#标签2", "#标签3"],
    "images": [
      { "index": 0, "type": "cover", "prompt": "…", "url": null, "status": "pending" },
      { "index": 1, "type": "illustration", "prompt": "…", "url": null, "status": "pending" }
    ]
  }
}
```

### updateXiaohongshuNote

**参数：**
```js
{
  taskId: z.string().min(1).describe("笔记任务 ID"),
  field: z.enum(["title", "content", "tags", "image_0", "image_1", "…"]).describe("要修改的字段"),
  value: z.string().describe("新值。字段为 image_N 时是新 prompt，字段为 content 时是完整正文"),
}
```

**返回：** 更新后的完整 note 数据（同 generate 返回的 note 结构）。

### checkXiaohongshuNoteProgress

**参数：**
```js
{
  taskId: z.string().min(1).describe("笔记任务 ID"),
  interval: z.number().optional().default(3).describe("查询间隔(秒)"),
}
```

**返回：** 同 generate 返回格式，前端轮询用。

### exportXiaohongshuNote

**参数：**
```js
{
  taskId: z.string().min(1).describe("笔记任务 ID"),
}
```

**返回：**
```json
{
  "ok": true,
  "htmlPath": "/Users/…/Downloads/note-title.html"
}
```

## 笔记数据模型

```json
{
  "taskId": "a1b2c3d4",
  "status": "generating | ready | error",
  "title": "笔记标题",
  "content": [
    "段落1，插画穿插在段落之间",
    "[插图-1]",
    "段落2"
  ],
  "tags": ["#标签1", "#标签2"],
  "images": [
    { "index": 0, "type": "cover", "prompt": "…", "url": null, "status": "pending" },
    { "index": 1, "type": "illustration", "prompt": "…", "url": null, "status": "pending" }
  ]
}
```

- content 是段落数组，`[插图-N]` 是占位标记，前端渲染时替换为对应图片
- N 对应 images 中 `type: "illustration"` 的图片序号（从 1 开始）
- images[0] 永远是封面（type: "cover"），显示在笔记最顶部

## 配图策略

- 封面：独立插画风格，突出标题主题
- 内容插画：与封面统一的插画风格，但视觉略轻量，穿插在段落之间
- LLM 根据内容自动决定插画数量，每张图生成独立 prompt
- 全部通过现有 generateImage 异步生成

## 前端组件

### NotePreviewCard（聊天内嵌）

- 渲染在聊天消息流中，替代普通 Markdown 消息
- 封面图在顶部 + 标题 + 正文（插画穿插） + 标签
- 生成中：显示封面占位 + 加载动画
- 就绪后：完整预览，点击展开独立页面
- 像素复古风，契合项目现有 UI

### 独立预览页 /note/[taskId]

- 完整小红书笔记预览
- 提供导出 HTML 按钮
- 开发模式下输出 HTML 路径到控制台

## 状态管理

- 任务状态持久化到 `/tmp/xhs-tasks/<taskId>/task.json`，复用现有 async task 模式
- 前端轮询 `/api/note/[taskId]/status` 获取进度
- 轮询间隔：首次 3s，后续指数衰减（同 checkImageProgress 模式）

## 新增文件

```
packages/mcp/tools/xiaohongshu/index.js  # 3 个 MCP 工具
packages/ai-chat/src/components/chat/note-preview-card.tsx  # 聊天内嵌预览卡片
packages/ai-chat/src/app/note/[taskId]/page.tsx   # 独立预览页
packages/ai-chat/src/app/api/note/[taskId]/status/route.ts  # 状态查询 API
packages/skills/xiaohongshu/SKILL.md   # 小红书笔记生成 skill（prompt 模板）
```

## 修改文件

```
packages/mcp/index.js        # 注册 xiaohongshu 模块
packages/ai-chat/src/app/api/chat/route.ts  # 工具调用返回值中识别 xhs 任务，返回特殊标记
packages/ai-chat/src/components/chat/message-item.tsx  # 识别 xhs 任务标记，渲染 NotePreviewCard
```

## 依赖

- 零新增依赖，全部复用现有能力
- generateImage（异步图片生成）
- searchKnowledge（记忆库检索）
- LLM（DeepSeek V4 Pro，内容生成）
- 现有 task 状态管理模式

## 边界情况

- 图片生成失败：单个图片失败不影响其他图片，失败图片显示占位符，用户可通过 updateXiaohongshuNote 重新生成
- 内容超长：LLM 自动控制在合理长度，单段正文不超过 500 字
- 任务状态丢失：持久化到磁盘，服务重启可恢复