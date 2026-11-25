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
 * - 图片：多模态 provider 走 AI SDK file part 直传；纯文本 provider 由 vision 逐图描述内联进消息占位符
 * - 视频：已不支持，管线静默丢弃成 [视频] 占位
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { streamText, stepCountIs, type ModelMessage } from 'ai';

import { env } from '@/lib/utils/env';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';

import { getChatStrategy } from '@/lib/strategies/chat-strategy';
import { getProviderConfig } from '@/lib/settings/dispatcher';
import { getMCPClient, resetMCPClient, getAmapMCPClient, resetAmapMCPClient } from '@/lib/mcp-client';
import { processAttachments } from '@/lib/multimodal/pipeline';
import { filterToolsByMode, filterWebTools, buildToolsSection, MODE_INFO, type ChatMode } from '@/lib/modes';
import { toModelMessages } from './to-model-messages';

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

// ─── MCP 客户端(模块级复用) ──────────────────────────────────────────

// 由 lib/mcp-client.ts 提供，MCP 子进程内 shared/llm 每次调用 fresh-read 配置

// ─── POST /api/chat ───────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { messages, mode = "chat", webSearch = false } = await req.json();
    const currentMode: ChatMode = mode === "build" || mode === "plan" ? mode : "chat";

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: '请输入内容' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const strategy = getChatStrategy();
    const userText = (messages[messages.length - 1]?.parts?.[0] as { text?: string } | undefined)?.text || '';
    const { model: actualModel, classifyUsage } = await strategy.resolveModel(userText);
    const provider = strategy.getProviderName();

    // 多模态处理：图片 + 视频附件
    const { messages: processedMessages } =
      await processAttachments({ provider, model: actualModel, messages });

    const modelMessages = toModelMessages(processedMessages);

    // chat 模式纯对话：不注入知识库（0 副作用），plan/build 才做 RAG 检索
    const retrieved = currentMode === "chat" ? [] : await retrieveRelevantChunks(userText, 5);
    const knowledgeContext = retrieved.length > 0
      ? '以下是从你的笔记中检索到的相关内容，如果与用户问题相关可以参考。\n' +
        retrieved.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
      : '';

    const tools = filterWebTools(
      filterToolsByMode(await loadMcpTools(), currentMode),
      webSearch,
    );

    const systemPrompt = buildSystemPrompt({
      mode: currentMode,
      hasTools: Object.keys(tools).length > 0,
      webSearch,
    });

    // 动态上下文（日期 + RAG）prepend 到最后一条 user 消息，保持 system 静态以命中 DeepSeek 前缀缓存
    prependToLastUserMessage(modelMessages, buildDynamicContext(knowledgeContext));

    const chatConfig = getProviderConfig('chat');
    const model = strategy.createModel(actualModel, chatConfig);

    console.log(`[router] provider=${provider}, model=${actualModel}`);

    // === AI SDK streamText ===
    const result = streamText({
      tools: tools as unknown as Parameters<typeof streamText>[0]['tools'],
      model,
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
            model: actualModel,
            classifyUsage,
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
 * 构建 system prompt（静态：不含时间/RAG，二者由 buildDynamicContext 注入最后一条 user 消息，
 * 以保持 system 前缀稳定，命中 DeepSeek 上下文缓存）
 */
function buildSystemPrompt({
  mode,
  hasTools,
  webSearch,
}: {
  mode: ChatMode;
  hasTools: boolean;
  webSearch: boolean;
}): string {
  const { label: modeLabel, instruction: modeInstruction } = MODE_INFO[mode];
  const toolsSection = buildToolsSection(mode, hasTools, webSearch);
  // chat 纯对话：不注入技能清单；plan/build 保留技能规则
  const skillBlock = mode === "chat"
    ? ""
    : `\n技能规则: 涉及专业领域先检查 <available_skills>，有匹配则加载执行。\n${SKILL_LIST}`;
  return `你是小盛开AI，一个实用的编程助手，擅长代码编写、知识管理、图表生成和多媒体创作。用中文思考，所有思考过程必须用中文描述，不要使用英文。用通俗语言回答。参考知识库时自然融入答案，不标注来源。

当前模式: ${modeLabel}
${modeInstruction}

工具规则: 每轮评估信息是否足够，够则立即回答；工具失败可重试1次，仍失败则告知用户。
${skillBlock}
${toolsSection}`;
}

/**
 * 动态上下文：当前日期（日期+星期，无时分，模型据此推算周末/节假日/当季）+ RAG 检索结果。
 * 随请求变化的内容放最后一条 user 消息，避免破坏 system 前缀缓存。
 */
function buildDynamicContext(knowledgeContext: string): string {
  const now = new Date().toLocaleString("zh-CN", {
    weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const knowledgeBlock = knowledgeContext ? `\n\n${knowledgeContext}` : "";
  return `当前日期: ${now}${knowledgeBlock}`;
}

/** 将动态上下文插入最后一条 user 消息内容开头 */
function prependToLastUserMessage(messages: ModelMessage[], text: string): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return;
  if (Array.isArray(last.content)) {
    last.content.unshift({ type: "text", text });
  } else if (typeof last.content === "string") {
    last.content = `${text}\n\n${last.content}`;
  }
}

/**
 * 加载 MCP 工具（带缓存）
 */
async function loadMcpTools(): Promise<Record<string, unknown>> {
  const local = await loadLocalMcpTools();
  const amap = await loadAmapMcpTools();
  return { ...local, ...amap };
}

async function loadLocalMcpTools(): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const client = await getMCPClient();
      const t = await client.tools();
      console.log(`[mcp] loaded (${Object.keys(t).length} tools)`);
      return t;
    } catch (err) {
      console.error(`[mcp] FAILED (attempt ${attempt}) - ${(err as Error).message}`);
      resetMCPClient(); // 清掉死客户端，下次循环重新 spawn
    }
  }
  return {};
}

// 高德地图工具：失败只记日志返回空对象，不拖垮本地工具
async function loadAmapMcpTools(): Promise<Record<string, unknown>> {
  try {
    const client = await getAmapMCPClient();
    const t = await client.tools();
    console.log(`[amap-mcp] loaded (${Object.keys(t).length} tools)`);
    return t;
  } catch (err) {
    console.error(`[amap-mcp] FAILED - ${(err as Error).message}`);
    resetAmapMCPClient();
    return {};
  }
}
