/**
 * AI Chat API Route
 * ============================================================================
 *
 * 接收前端 useChat hook 发来的消息,调用 DeepSeek/M3 生成回复。
 * 集成统一的 mcp (时间/文件/知识库/多模态生成/skill)。
 *
 * 数据流:浏览器 → UIMessage[] → processAttachments() → ModelMessage[] → LLM
 *
 * 多模态路径：
 * - 图片：AI SDK streamText (file→image_url 自动转换)
 * - 视频：raw fetch 绕过 AI SDK (OpenAI/Anthropic provider 都不支持 video file)
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { streamText, stepCountIs, type ModelMessage as AISDKModelMessage } from 'ai';
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { env } from '@/lib/utils/env';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { deepseek, minimax } from '@/lib/ai/providers';
import { classifyTask } from '@/lib/ai/model-router';
import { processAttachments } from '@/lib/ai/processor';
import { m3ChatStream, toUIMessageStream } from '@/lib/ai/m3-raw-fetch';
import type { Message, MessagePart } from '@/lib/utils/types';

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

- 小红书笔记: generateXiaohongshuNote → checkXiaohongshuNoteProgress | updateXiaohongshuNote | exportXiaohongshuNote
  触发: 用户说"生成笔记"、"整理成小红书"、"写篇笔记"、"做成笔记"、"总结成笔记"、"导出笔记"等
  generateXiaohongshuNote({ topic, context, style, subcategory }) 返回 taskId
    topic: 从对话中提取主题(必填)
    context: 当前对话的关键讨论内容(必填，确保笔记包含对话上下文)
    style: knowledge(知识分享)/product_review(好物推荐)/experience(经验复盘)/opinion(观点讨论)，LLM自动推断
    subcategory: 二级类目(如finance)，LLM自动推断
  checkXiaohongshuNoteProgress(taskId, interval=3): 轮询等ready，返回的iframe字段直接嵌入聊天展示预览
  修改: updateXiaohongshuNote({ taskId, field, value }), field: title/content/tags/image_N
  导出: exportXiaohongshuNote({ taskId })，仅在用户明确说"导出"时调用
  注意: 生成后不自动导出、不打开浏览器，直接输出iframe预览
  
- 其他: 时间/待办/文件/网页爬取

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
  const skillsDir = path.resolve(process.cwd(), '../skills');
  if (!fs.existsSync(skillsDir)) return '';

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const f = path.join(skillsDir, e.name, 'SKILL.md');
      if (!fs.existsSync(f)) return null;
      const content = fs.readFileSync(f, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return null;
      const lines = match[1].split('\n');
      const meta: Record<string, string> = {};
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      if (!meta.name || !meta.description) return null;
      return { name: meta.name, description: meta.description };
    })
    .filter(Boolean);

  if (skills.length === 0) return '';

  return `<available_skills>\n${skills
    .map((s) => `  <skill>\n    <name>${s!.name}</name>\n    <description>${s!.description}</description>\n  </skill>`)
    .join('\n')}\n</available_skills>`;
}

const SKILL_LIST = buildSkillList();
console.log('[SKILL_LIST]', SKILL_LIST || '(空)');

// ─── MCP 客户端(模块级复用) ───────────────────────────────────────────

let mcpClient: MCPClient | null = null;

async function getMCPClient(): Promise<MCPClient> {
  if (mcpClient) return mcpClient;

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['../mcp/index.js'],
    cwd: process.cwd(),
  });

  mcpClient = await createMCPClient({
    transport,
    clientName: 'ai-mcp-client',
  });

  return mcpClient;
}

// ─── POST /api/chat ───────────────────────────────────────────────────

/**
 * 检测消息中是否包含视频（需要走 raw fetch 路径）
 */
function messagesContainVideo(modelMessages: AISDKModelMessage[]): boolean {
  return modelMessages.some((msg) => {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((p) =>
      typeof p === 'object' && p !== null
      && (p as { type?: string }).type === 'file'
      && typeof (p as { mediaType?: string }).mediaType === 'string'
      && (p as { mediaType: string }).mediaType.startsWith('video/')
    );
  });
}

/**
 * ModelMessage 构造（自己来，因为 AI SDK 6 convertToModelMessages 会丢 file.data）
 */
function toModelMessages(messages: Message[]): AISDKModelMessage[] {
  return messages.map((msg) => {
    const content: Array<{ type: string; text?: string; mediaType?: string; data?: string }> = [];
    for (const p of msg.parts || []) {
      if (p.type === 'text') {
        const tp = p as MessagePart & { text: string };
        content.push({ type: 'text', text: tp.text });
      } else if (p.type === 'file') {
        const fp = p as MessagePart & { mediaType: string; data: string };
        content.push({ type: 'file', mediaType: fp.mediaType, data: fp.data });
      }
    }
    return { role: msg.role, content } as unknown as AISDKModelMessage;
  });
}

export async function POST(req: Request) {
  try {
    const { messages, provider = 'deepseek' } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: '请输入内容' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 任务分类（仅 DeepSeek 走 auto-route）
    const isMiniMax = provider === 'minimax';
    const userText = (messages[messages.length - 1]?.parts?.[0] as { text?: string } | undefined)?.text || '';
    const classifyResult = isMiniMax ? null : await classifyTask(userText);
    const tier = classifyResult?.tier ?? 'pro';
    const modelName = isMiniMax
      ? 'MiniMax-M3'
      : tier === 'pro'
        ? env.DEEPSEEK_PRO_MODEL
        : env.DEEPSEEK_FLASH_MODEL;

    // 多模态处理：图片 + 视频附件
    const { messages: processedMessages, systemInjection: multimodalInjection } =
      await processAttachments({ provider, model: modelName, messages });

    const modelMessages = toModelMessages(processedMessages);

    const retrieved = await retrieveRelevantChunks(userText, 5);
    const knowledgeContext = retrieved.length > 0
      ? '以下是从你的笔记中检索到的相关内容，如果与用户问题相关可以参考。\n' +
        retrieved.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
      : '';

    const tools = await loadMcpTools();

    const systemPrompt = buildSystemPrompt({
      multimodalInjection,
      knowledgeContext,
    });

    console.log(`[router] provider=${provider}, model=${modelName}, hasVideo=${messagesContainVideo(modelMessages)}`);

    // === 视频路径：raw fetch 绕过 AI SDK ===
    if (messagesContainVideo(modelMessages) && isMiniMax) {
      const openaiMessages = fileToOpenAI(modelMessages);
      const response = await m3ChatStream(openaiMessages, { modelName, systemPrompt, signal: req.signal });
      return toUIMessageStream(response);
    }

    // === 常规路径：AI SDK streamText ===
    const result = streamText({
      tools: tools as unknown as Parameters<typeof streamText>[0]['tools'],
      model: isMiniMax ? minimax(modelName) : deepseek(modelName),
      system: systemPrompt,
      messages: modelMessages,
      maxRetries: 5,
      stopWhen: stepCountIs(100),
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === 'finish') {
          return {
            usage: part.totalUsage,
            provider,
            model: modelName,
            classifyUsage: classifyResult?.usage,
            retrievedChunks: retrieved.map((c) => ({
              content: c.content.slice(0, 100),
              source: `[${c.index}]`,
            })),
          };
        }
      },
    });
  } catch (error) {
    const err = error as { responseBody?: string; message?: string; stack?: string };
    const msg = err.responseBody || err.message || '服务器内部错误';
    console.error('POST /api/chat 错误:', err.stack || msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────

/**
 * file 类型转 OpenAI 格式（给 raw fetch 路径用）
 */
function fileToOpenAI(messages: AISDKModelMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: Array.isArray(msg.content)
      ? msg.content.map((p) => {
          const mediaType = (p as { mediaType?: string }).mediaType;
          const data = (p as { data?: string }).data;
          const type = (p as { type?: string }).type;
          if (type === 'file' && mediaType?.startsWith('video/')) {
            return { type: 'video_url', video_url: { url: data, detail: 'default', fps: 1 } };
          }
          if (type === 'file' && mediaType?.startsWith('image/')) {
            return {
              type: 'image_url',
              image_url: { url: data, detail: mediaType === 'image/jpeg' ? 'low' : 'default' },
            };
          }
          return p;
        })
      : msg.content,
  }));
}

/**
 * 构建 system prompt
 */
function buildSystemPrompt({
  multimodalInjection,
  knowledgeContext,
}: {
  multimodalInjection?: string;
  knowledgeContext: string;
}): string {
  return `你是小盛开AI，一个实用的编程助手，擅长代码编写、知识管理、图表生成和多媒体创作。用中文思考，所有思考过程必须用中文描述，不要使用英文。用通俗语言回答。参考知识库时自然融入答案，不标注来源。

工具规则: 每轮评估信息是否足够，够则立即回答；工具失败可重试1次，仍失败则告知用户。

技能规则: 涉及专业领域先检查 <available_skills>，有匹配则加载执行。
        ${SKILL_LIST}
        ${TOOLS_PROMPT}
        ${multimodalInjection ? `\n${multimodalInjection}\n` : ''}
        ${knowledgeContext}`;
}

/**
 * 加载 MCP 工具（带缓存）
 */
async function loadMcpTools(): Promise<Record<string, unknown>> {
  try {
    const client = await getMCPClient();
    const t = await client.tools();
    console.log(`[mcp] loaded (${Object.keys(t).length} tools)`);
    return t;
  } catch (err) {
    console.error(`[mcp] FAILED - ${(err as Error).message}`);
    return {};
  }
}
