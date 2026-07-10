/**
 * AI Chat API Route
 * ============================================================================
 *
 * 接收前端 useChat hook 发来的消息,通过 DeepSeek V4 Pro 模型生成回复。
 * 集成统一的 mcp (时间/文件/知识库/多模态生成/skill)。
 *
 * 数据流:浏览器 → UIMessage[] → convertToModelMessages → ModelMessage[] → LLM
 * ============================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { streamText, convertToModelMessages, stepCountIs, generateText } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { retrieveRelevantChunks } from "@/lib/retrieve";
import { deepseek, minimax } from "@/lib/providers";
import { classifyTask } from "@/lib/model-router";

// ─── 提示词常量 ────────────────────────────────────────────────────────

const TOOLS_PROMPT = `
可用工具:

- loadSkill(加载技能) | exec(执行Shell)

- Chroma知识库: addKnowledge/searchKnowledge/updateKnowledge/deleteKnowledge/restoreKnowledgeById
  库表: shared(规则/偏好) chat(日常/主题笔记)  database和collection必须同时传

- 图片: generateImage → checkImageProgress | generateImageFromImage → checkImageProgress

- 视频: generateHTMLPreview → checkTaskProgress → renderVideo

- 图表: generateDiagram → checkDiagramProgress
  类型映射: 流程图=mermaid+flowchart 时序图=mermaid+sequence 类图=mermaid+class
           状态图=mermaid+state ER图=mermaid+er 甘特图=mermaid+gantt
           饼图=mermaid+pie 象限图=mermaid+quadrant 架构图=d2+architecture
  不确定类型时必须询问用户

- 其他: 时间/待办/文件/网页爬取

- 小红书笔记: generateXiaohongshuNote → checkXiaohongshuNoteProgress | updateXiaohongshuNote | exportXiaohongshuNote
  用户说"生成笔记"、"整理成小红书"、"导出笔记"时调用
  generateXiaohongshuNote({ topic, context, style, subcategory }) 返回 taskId → checkXiaohongshuNoteProgress(taskId, interval=3) 轮询等 ready
  topic 从对话中提取主题，context 提取当前对话的关键讨论内容（必传，确保笔记内容包含对话信息）
  style: knowledge=知识分享/product_review=好物推荐/experience=经验复盘/opinion=观点讨论，默认 automatic
  subcategory: 二级类目，如 finance=金融知识，目前仅 knowledge 下支持，LLM 自动推断
  修改笔记用 updateXiaohongshuNote({ taskId, field, value })，field 取值: title/content/tags/image_N
  导出用 exportXiaohongshuNote({ taskId })

使用规则:
- 用户说"画图"/"流程图"等 → 调用 generateDiagram，不确定类型时询问用户
- generateDiagram 返回 taskId → checkDiagramProgress(taskId, interval=20) 轮询等 done
- 修改图表用 readFile → replaceInFile → 重新调用 generateDiagram
- 生成图片后用 ![描述](URL) 展示，URL 原样输出不得修改
- generateImage/generateImageFromImage 返回 taskId → checkImageProgress(taskId, interval=5) 轮询等 done
- 用户说"生成视频" → 先问风格，确认后 generateHTMLPreview → checkTaskProgress(interval=18) → 输出 iframe
- 渲染视频用 renderVideo → checkTaskProgress(interval=30) 等 done
- 用户说"记住"/"下载"/"爬取"时主动调用对应工具
`.trim();

// ─── Skill 列表（启动时扫描，注入 system prompt）───────────────────────

function buildSkillList(): string {
  const skillsDir = path.resolve(process.cwd(), "../skills");
  if (!fs.existsSync(skillsDir)) return "";

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills = entries
    .filter(e => e.isDirectory())
    .map(e => {
      const f = path.join(skillsDir, e.name, "SKILL.md");
      if (!fs.existsSync(f)) return null;
      const content = fs.readFileSync(f, "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return null;
      const lines = match[1].split("\n");
      const meta: Record<string, string> = {};
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      if (!meta.name || !meta.description) return null;
      return { name: meta.name, description: meta.description };
    })
    .filter(Boolean);

  if (skills.length === 0) return "";

  return `<available_skills>\n${skills.map(s =>
    `  <skill>\n    <name>${s!.name}</name>\n    <description>${s!.description}</description>\n  </skill>`
  ).join("\n")}\n</available_skills>`;
}

const SKILL_LIST = buildSkillList();
console.log("[SKILL_LIST]", SKILL_LIST || "(空)");

// ─── MCP 客户端(模块级复用) ───────────────────────────────────────────

let mcpClient: MCPClient | null = null;

async function getMCPClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: "node",
    args: ["../mcp/index.js"],
    cwd: process.cwd(),
  });

  mcpClient = await createMCPClient({
    transport,
    clientName: "ai-mcp-client",
  });

  return mcpClient;
}

// ─── 图片预处理 ────────────────────────────────────────────────────────

async function preprocessImages(messages: any[]): Promise<{ messages: any[]; imageDescription?: string }> {
  const last = messages[messages.length - 1];
  if (!last?.parts) return { messages };

  const textParts = last.parts.filter((p: any) => p?.type === "text");
  const imageUrlParts = textParts.filter((p: any) => /^https?:\/\/.*\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(p.text?.trim()));

  // 检测 [图片数据:base64] 标记
  const dataParts = textParts.filter((p: any) => p.text?.includes("[图片数据:data:image/"));
  const hasImages = dataParts.length > 0 || imageUrlParts.length > 0;
  if (!hasImages) return { messages };

  let imageDescription = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const imageContent: any[] = [];

    if (dataParts.length > 0) {
      for (const dp of dataParts) {
        const match = dp.text.match(/\[图片数据:(data:image\/[^\]]+)\]/);
        if (match) imageContent.push({ type: "image" as const, image: match[1] });
      }
    }
    if (imageUrlParts.length > 0) {
      imageContent.push(...imageUrlParts.map((p: any) => ({ type: "image" as const, image: p.text.trim() })));
    }

    const tStart = Date.now();
    console.log(`[preprocess] 检测到图片: ${imageContent.length} 张, MiniMax-M3 调用中...`);

    const { text: description } = await generateText({
      model: minimax("MiniMax-M3"),
      abortSignal: controller.signal,
      maxOutputTokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "请客观描述这张图片的内容即可，不要做多余事情。" },
          ...imageContent,
        ],
      }],
    });

    clearTimeout(timeout);
    imageDescription = description;
    console.log(`[preprocess] MiniMax-M3 完成: 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s, 描述 ${description.length} 字`);
  } catch (err) {
    clearTimeout(timeout);
    console.error("[preprocess] 图片描述失败:", (err as Error).message);
  }

  // 剥离 [图片数据:...] 前缀，只保留用户可见文本
  const cleanedParts = last.parts.map((p: any) => {
    if (p?.type !== "text") return p;
    return { ...p, text: p.text.replace(/\[图片数据:data:image\/[^\]]+\]\n?/g, "").replace(/\[上传图片:\d+\]\n?/g, "") };
  });

  return {
    messages: [...messages.slice(0, -1), { ...last, parts: cleanedParts }],
    imageDescription: imageDescription || undefined,
  };
}

// ─── POST /api/chat ───────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "请输入内容" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { messages: processedMessages, imageDescription } = await preprocessImages(messages);
    const lastMessage = processedMessages[processedMessages.length - 1];
    const userQuery = typeof lastMessage?.parts?.[0]?.text === "string"
      ? lastMessage.parts[0].text
      : "";

    // 检索相关知识 + 任务分类（并行）
    let knowledgeContext = "";
    const [retrieved, classifyResult] = await Promise.all([
      retrieveRelevantChunks(userQuery, 3),
      classifyTask(userQuery),
    ]);
    const tier = classifyResult.tier;
    if (retrieved.length > 0) {
      knowledgeContext = "以下是从你的笔记中检索到的相关内容，如果与用户问题相关可以参考。\n" +
        retrieved.map((c, i) => `[${i + 1}] ${c.content}`).join("\n\n");
    }

    // 加载 MCP 工具
    const tools: Record<string, unknown> = {};
    try {
      const client = await getMCPClient();
      const t = await client.tools();
      Object.assign(tools, t);
      console.log(`[mcp] loaded (${Object.keys(t).length} tools)`);
    } catch (err) {
      console.error(`[mcp] FAILED - ${(err as Error).message}`);
    }

    const cleanMessages = processedMessages.map((msg: any) => {
      const badParts = (msg.parts || []).filter((p: any) => p != null && !p.type);
      if (badParts.length > 0) {
        console.log("[cleanMessages] 发现无 type 的 parts:", JSON.stringify(badParts));
      }
      return {
        ...msg,
        parts: (msg.parts || []).filter((p: any) => p != null && p.type),
      };
    });
    const modelMessages = await convertToModelMessages(cleanMessages);

    console.log("用户查询:", userQuery);
    console.log(`[router] 模型: ${tier === "pro" ? (process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro") : (process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash")}`);
    console.log("检索到的知识片段:", retrieved.map(r => `[${r.index}] ${r.content.slice(0, 50)}...`));
    console.log("可用工具:", Object.keys(tools));
console.log("[system] SKILL_LIST in prompt:", SKILL_LIST ? "有内容" : "空");

    const modelName = tier === "pro" ? (process.env.DEEPSEEK_PRO_MODEL || "deepseek-v4-pro") : (process.env.DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash");

    const result = streamText({
      tools: tools as unknown as Parameters<typeof streamText>[0]["tools"],
      model: deepseek(modelName),
      system: `你是小盛开AI，一个实用的编程助手，擅长代码编写、知识管理、图表生成和多媒体创作。用中文思考，用通俗语言回答。参考知识库时自然融入答案，不标注来源。

工具规则: 每轮评估信息是否足够，够则立即回答；工具失败可重试1次，仍失败则告知用户。

技能规则: 涉及专业领域先检查 <available_skills>，有匹配则加载执行。
        ${SKILL_LIST}
        ${TOOLS_PROMPT}
        ${imageDescription ? `\n用户上传了一张图片，图片内容描述：${imageDescription}\n` : ""}
        ${knowledgeContext}`,
      messages: modelMessages,
      maxRetries: 5,
      stopWhen: stepCountIs(100),
      onStepFinish({ text, toolCalls, toolResults, finishReason }) {
        console.log("步骤完成:", {
          finishReason,
          textSnapshot: text?.slice(0, 100),
          toolCalls: toolCalls?.map(t => ({ name: t.toolName, input: t.input })),
          toolResults: toolResults?.map(t => t.toolName),
        });
      },
      onError(error) {
        console.error("streamText 错误:", error);
      },
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === "finish") {
          return {
            usage: part.totalUsage,
            modelTier: tier,
            classifyUsage: classifyResult.usage,
          };
        }
      },
    });
  } catch (error) {
    console.error("POST /api/chat 错误:", (error as Error)?.stack || (error as Error)?.message || String(error));
    return new Response(
      JSON.stringify({ error: "服务器内部错误,请重试" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}