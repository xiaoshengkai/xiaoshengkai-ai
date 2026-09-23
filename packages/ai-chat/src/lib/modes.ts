export type ChatMode = "chat" | "plan" | "build";

// 仅 build 模式暴露的写工具（文件写/exec/知识库写）
export const WRITE_TOOLS = new Set([
  "exec",
  "writeFile",
  "appendFile",
  "replaceInFile",
  "createDirectory",
  "deleteFile",
  "moveFile",
  "addKnowledge",
  "updateKnowledge",
  "deleteKnowledge",
  "restoreKnowledgeById",
]);

export function filterToolsByMode(tools: Record<string, unknown>, mode: ChatMode): Record<string, unknown> {
  if (mode === "build") return tools;
  const filtered: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!WRITE_TOOLS.has(name)) filtered[name] = tool;
  }
  return filtered;
}

// 每个模式的定位与行为约束（单一真相源）：注入 system prompt，让模型明确当前状态与能做什么
export interface ModeInfo {
  label: string;
  canWrite: boolean;
  instruction: string;
}

export const MODE_INFO: Record<ChatMode, ModeInfo> = {
  chat: {
    label: "chat（自由对话）",
    canWrite: false,
    instruction:
      "当前处于 chat 模式：自由对话/答疑，只能使用只读工具。禁止修改文件、执行命令或写入知识库；用户要求执行写操作时，说明需要切换到 build 模式。",
  },
  plan: {
    label: "plan（只读规划）",
    canWrite: false,
    instruction:
      "当前处于 plan 模式：只读规划。先只读调研，把需求拆成结构化计划（目标 / 步骤 / 涉及文件 / 风险 / 待确认项）交给用户确认，禁止修改文件、执行命令或写入知识库，也不要在计划阶段直接动手；用户确认后提示切换到 build 模式执行。",
  },
  build: {
    label: "build（全权执行）",
    canWrite: true,
    instruction:
      "当前处于 build 模式：全权执行，可读可写可执行。直接动手完成任务并汇报结果。",
  },
};

// 工具清单按模式拆分：只读段恒注入，写入段仅 build 注入，保证「广告的工具 = 实际可用的工具」
const TOOLS_PROMPT_READ = `
可用工具:

- loadSkill(加载技能)

- Chroma知识库(只读检索): searchKnowledge
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
   checkXiaohongshuNoteProgress(taskId, interval=3): 轮询直到ready、partial或failed；partial表示部分图片失败，是终态，不要继续轮询。ready/partial的预览卡由界面自动渲染，禁止手写 <iframe>（会因 basePath/端口导致空白）
  修改: updateXiaohongshuNote({ taskId, field, value }), field: title/content/tags/image_N
  导出: exportXiaohongshuNote({ taskId })，仅在用户明确说"导出"时调用；返回的 downloadUrl 直接给用户（可点击/复制到浏览器或手机下载）
  注意: 生成后不自动导出、不打开浏览器，直接输出iframe预览
  
- 联网搜索: searchWeb({ query, category, maxResults=5, fetchContent=true })
  触发: 涉及时效性信息/新闻/开源项目/当前价格/未知事实等需要联网的内容
  category: general(综合网页)/images(图片)/videos(视频)/news(新闻)/wechat(微信公众号)
  searchWeb 返回结构化结果(标题/URL/摘要/来源引擎)，回答必须引用结果 URL
  contentFetched=false 时只能使用标题/摘要，或明确说明无法读取正文
  禁止自行猜测 API 地址或改用其他方式搜索；对同一问题最多补充搜索一次

- 网页抓取(Firecrawl):
  scrapeWebPage({ url })    抓指定 URL 正文为 Markdown（知道具体 URL 时用）
  mapWebsite({ url })       发现网站内所有 URL（定位页面时用）
  crawlWebsite({ url, limit }) 抓网站多页正文（整站/栏目提取，最多 20 页）
  parseDocument({ url })    解析在线 PDF 为 Markdown
  选型: 不知道 URL→searchWeb；知道单个 URL→scrapeWebPage；找站内 URL→mapWebsite；抓整站→crawlWebsite；在线 PDF→parseDocument

- 其他: 时间/待办/文件(读)

使用规则:
- 用户说"画图"/"流程图"等 → 调用 generateDiagram，不确定类型时询问用户
- generateDiagram 返回 taskId → checkDiagramProgress(taskId, interval=20) 轮询等 done
- 生成图片后用 ![描述](URL) 展示，URL 原样输出不得修改
- generateImage/generateImageFromImage 返回 taskId → checkImageProgress(taskId, interval=5) 轮询等 done
- 用户说"生成视频" → 先问风格，确认后 generateHTMLPreview → checkTaskProgress(interval=18) → 输出 iframe
- 渲染视频用 renderVideo → checkTaskProgress(interval=30) 等 done
`.trim();

const TOOLS_PROMPT_WRITE = `
- exec(执行Shell)

- Chroma知识库(写入): addKnowledge/updateKnowledge/deleteKnowledge/restoreKnowledgeById
  库表: shared(规则/偏好) chat(日常/主题笔记)  database和collection必须同时传

使用规则(写/执行，仅 build 模式):
- 修改图表用 readFile → replaceInFile → 重新调用 generateDiagram
- 用户说"记住"/"下载"时主动调用对应工具
`.trim();

const NO_WRITE_NOTE =
  "本模式未启用写/执行工具（exec、文件写、知识库写均不可用）：不要尝试调用这些工具；用户要求执行写操作时，说明需要切换到 build 模式。";

const NO_TOOLS_NOTE =
  "当前无可用工具（工具服务暂不可用）。直接回答用户问题；若用户要求执行操作，如实说明暂时无法执行，绝对不要伪造工具调用。";

export function buildToolsSection(mode: ChatMode, hasTools: boolean): string {
  if (!hasTools) return NO_TOOLS_NOTE;
  return mode === "build"
    ? `${TOOLS_PROMPT_READ}\n\n${TOOLS_PROMPT_WRITE}`
    : `${TOOLS_PROMPT_READ}\n\n${NO_WRITE_NOTE}`;
}