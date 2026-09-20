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

import { env } from '@/lib/utils/env';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';

import { getChatStrategy } from '@/lib/strategies/chat-strategy';
import { getProviderConfig } from '@/lib/settings/dispatcher';
import { getMCPClient, resetMCPClient } from '@/lib/mcp-client';
import { processAttachments } from '@/lib/multimodal/pipeline';
import { filterToolsByMode, type ChatMode } from '@/lib/modes';
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
   checkXiaohongshuNoteProgress(taskId, interval=3): 轮询直到ready、partial或failed；partial表示部分图片失败，是终态，不要继续轮询。ready/partial返回的iframe字段直接嵌入聊天展示预览
  修改: updateXiaohongshuNote({ taskId, field, value }), field: title/content/tags/image_N
  导出: exportXiaohongshuNote({ taskId })，仅在用户明确说"导出"时调用
  注意: 生成后不自动导出、不打开浏览器，直接输出iframe预览
  
- 联网搜索: searchWeb({ query, category, maxResults=5, fetchContent=true })
  触发: 涉及时效性信息/新闻/开源项目/当前价格/未知事实等需要联网的内容
  category: general(综合网页)/images(图片)/videos(视频)/news(新闻)/wechat(微信公众号)
  searchWeb 返回结构化结果(标题/URL/摘要/来源引擎)，回答必须引用结果 URL
  contentFetched=false 时只能使用标题/摘要，或明确说明无法读取正文
  禁止自行猜测 API 地址或用 exec 替代搜索；对同一问题最多补充搜索一次

- 网页抓取(Firecrawl):
  scrapeWebPage({ url })    抓指定 URL 正文为 Markdown（知道具体 URL 时用）
  mapWebsite({ url })       发现网站内所有 URL（定位页面时用）
  crawlWebsite({ url, limit }) 抓网站多页正文（整站/栏目提取，最多 20 页）
  parseDocument({ url })    解析在线 PDF 为 Markdown
  选型: 不知道 URL→searchWeb；知道单个 URL→scrapeWebPage；找站内 URL→mapWebsite；抓整站→crawlWebsite；在线 PDF→parseDocument

- 其他: 时间/待办/文件

使用规则:
- 用户说"画图"/"流程图"等 → 调用 generateDiagram，不确定类型时询问用户
- generateDiagram 返回 taskId → checkDiagramProgress(taskId, interval=20) 轮询等 done
- 修改图表用 readFile → replaceInFile → 重新调用 generateDiagram
- 生成图片后用 ![描述](URL) 展示，URL 原样输出不得修改
- generateImage/generateImageFromImage 返回 taskId → checkImageProgress(taskId, interval=5) 轮询等 done
- 用户说"生成视频" → 先问风格，确认后 generateHTMLPreview → checkTaskProgress(interval=18) → 输出 iframe
- 渲染视频用 renderVideo → checkTaskProgress(interval=30) 等 done
- 用户说"记住"/"下载"时主动调用对应工具
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

// ─── MCP 客户端(模块级复用) ──────────────────────────────────────────

// 由 lib/mcp-client.ts 提供，MCP 子进程内 shared/llm 每次调用 fresh-read 配置

// ─── POST /api/chat ───────────────────────────────────────────────────

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
    const { messages, mode = "chat" } = await req.json();
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
    const { messages: processedMessages, systemInjection: multimodalInjection } =
      await processAttachments({ provider, model: actualModel, messages });
    console.log(`[multimodal] systemInjection len=${multimodalInjection?.length ?? 0}`);

    const modelMessages = toModelMessages(processedMessages);

    const retrieved = await retrieveRelevantChunks(userText, 5);
    const knowledgeContext = retrieved.length > 0
      ? '以下是从你的笔记中检索到的相关内容，如果与用户问题相关可以参考。\n' +
        retrieved.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
      : '';

    const tools = filterToolsByMode(await loadMcpTools(), currentMode);

    const systemPrompt = buildSystemPrompt({
      multimodalInjection,
      knowledgeContext,
      mode: currentMode,
      hasTools: Object.keys(tools).length > 0,
    });

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
 * 构建 system prompt
 */
function buildSystemPrompt({
  multimodalInjection,
  knowledgeContext,
  mode,
  hasTools,
}: {
  multimodalInjection?: string;
  knowledgeContext: string;
  mode: ChatMode;
  hasTools: boolean;
}): string {
  const modeInstruction = mode === "plan"
    ? "\n当前处于 plan 模式：只读分析，只输出方案，禁止修改文件、执行命令或写入知识库。"
    : "";
  const toolsSection = hasTools
    ? TOOLS_PROMPT
    : "当前无可用工具（工具服务暂不可用）。直接回答用户问题；若用户要求执行操作，如实说明暂时无法执行，绝对不要伪造工具调用。";
  return `你是小盛开AI，一个实用的编程助手，擅长代码编写、知识管理、图表生成和多媒体创作。用中文思考，所有思考过程必须用中文描述，不要使用英文。用通俗语言回答。参考知识库时自然融入答案，不标注来源。

 工具规则: 每轮评估信息是否足够，够则立即回答；工具失败可重试1次，仍失败则告知用户。${modeInstruction}

技能规则: 涉及专业领域先检查 <available_skills>，有匹配则加载执行。
        ${SKILL_LIST}
        ${toolsSection}
        ${multimodalInjection ? `\n用户消息中的 [图片]/[视频] 占位符对应的实际内容如下（由视觉模型生成，等同附件本身）。请据此理解并回答用户问题，不要声称看不到附件：\n${multimodalInjection}\n` : ''}
        ${knowledgeContext}`;
}

/**
 * 加载 MCP 工具（带缓存）
 */
async function loadMcpTools(): Promise<Record<string, unknown>> {
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
