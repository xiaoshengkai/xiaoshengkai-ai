import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import puppeteer from "puppeteer";
import { callLLM, callMultimodalLLM, getMultimodalProvider, getWorkflowProvider } from "@app/shared/llm/index.js";
import { getApiKey } from "@app/shared/llm/config.js";
import { sleep, shortId } from "@app/shared/utils.js";
import { writeTaskState, readTaskState, updateTask, getAdaptiveWait } from "../../lib/task-state.js";

const TAG = "[diagram]";

const CHROME_PATH = (() => {
  const candidates = [
    puppeteer.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
})();

console.log(`${TAG} Chrome 路径: ${CHROME_PATH || "未找到"}`);

const TASK_DIR = path.join(os.tmpdir(), "hf-tasks");

// ═══════════════════════════════════════════════════════════════════
// DeepSeek System Prompt
// ═══════════════════════════════════════════════════════════════════

function buildSystemPrompt(theme, audience, engine, diagramType) {
  const audienceHint = {
    executive: "隐藏技术细节，只保留里程碑和价值节点，配色简洁高端",
    technical: "展开子流程，显示输入/输出，D2 展示具体系统接口",
    mixed: "主流程简洁 + 关键节点展开子流程",
  }[audience || "mixed"];

  const base = `# 角色
你是系统架构师与可视化专家。

# 任务
根据用户描述生成 ${engine === "d2" ? "D2" : "Mermaid"} ${diagramType} 图表代码。

# 受众适配
${audienceHint}

# 配色与风格
默认马卡龙柔和色系，参考示例文件中的配色方案。用户可指定 theme 切换：
  sketch(默认): 马卡龙柔和色系  corporate: 莫兰迪商务灰调  dark: 深色科技风

# 视觉规范
- 标签: 动词+名词，标注角色，≤12 汉字，超长用 \\n 换行
- 标签中的双引号用 \\" 转义

# 自检清单（生成代码前逐项确认）
□ 色彩: 是否避开荧光色？对比度是否达标？
□ 文字: 每个节点 ≤12 汉字？超长已换行？
□ 布局: 线条是否尽量避免了交叉？

# 风格参考
参考 tools/diagram/templates/ 下的示例文件：
  flowchart-example.md（流程图）  sequence-example.md（时序图）  class-diagram-example.md（类图）  state-diagram-example.md（状态图）  er-diagram-mermaid-example.md（ER图）  gantt-example.md（甘特图）  pie-example.md（饼图）  quadrant-example.md（象限图）  architecture-d2-example.md（架构图）`;

  const rules = {
    flowchart: `

# Mermaid 流程图规则
- 格式: graph TD 或 flowchart LR
- 样式: 末尾 style 节点ID fill:#xxx,stroke:#xxx,color:#xxx
- 节点 ID 用字母 A-Z，避免中文
- 括号: 矩形[] 菱形{} 圆角() 圆形(())
- 换行: 长标签用 \\n 换行，每行 ≤15 字符
- 陷阱: 禁止英文括号 () 改用中文 （）；禁止 <> 和 & # 等特殊符号`,
    sequence: `

# Mermaid 时序图规则
- 格式: sequenceDiagram，加 autonumber 自动编号
- 参与者: participant 名称 as "显示名"，名称不含空格
- 消息: -> 同步，--> 虚线同步，->> 异步，-->> 虚线异步
- 激活: activate/deactivate 必须成对，先 activate 后 deactivate
- 控制流: loop(循环体) end、alt(条件) else(否则) end、opt(可选) end
- 注释: Note over A,B: 文本 或 Note right of A: 文本
- 样式: 不支持 style 语句，用 %%{init: {'theme':'base', 'themeVariables': {...}}}%%`,
    class: `

# Mermaid 类图规则
- 格式: classDiagram，direction TB 或 LR
- 类定义: class 类名 { 属性/方法 }
- 可见性: +公开 -私有 #保护，泛型: ~ 包裹
- 关系: <|-- 继承 *-- 组合 o-- 聚合 ..> 调用 --> 依赖
- 关系标签: 类A *-- 类B : "组合"
- 样式: 全局 %%{init: {...}}%% + 末尾 style 逐类配色
- 配色: 每个类用不同颜色，浅色背景+深色边框+深色文字，stroke-width:2px`,
    state: `

# Mermaid 状态图规则
- 格式: stateDiagram-v2，direction LR 或 TB
- 状态定义: state 状态名 { ... } 复合状态，或直接写状态名
- 转移: 状态A --> 状态B : 转移条件
- 初始/终点: [*] 表示开始和结束
- 样式: style 状态名 fill:#xxx,stroke:#xxx（注意是状态名不是节点ID）
- 配色: 每个状态用不同颜色，浅色背景+深色边框，异常路径统一红色系`,
    er: `

# Mermaid ER图规则
- 格式: erDiagram
- 实体: 实体名 { 类型 属性名 KEY }
- 类型: int varchar text boolean datetime
- 约束: PK(主键) FK(外键) UK(唯一)
- 关系: 实体A ||--o{ 实体B : "关系描述"
- 陷阱: 实体名用英文大写，属性名用 snake_case，类型用小写`,
    gantt: `

# Mermaid 甘特图规则
- 格式: gantt，title 标题，dateFormat YYYY-MM-DD，axisFormat %m-%d
- 分组: section 分组名
- 任务: 任务名 :状态, id, 开始日期, 持续天数
- 状态: done(完成) active(进行中) crit(关键路径) milestone(里程碑,0d)
- 样式: %%{init: {'theme':'base', 'themeVariables': {ganttBarColor:'#xxx',...}}}%%
- 配色: 马卡龙柔和色系，done浅绿 active浅蓝 crit浅紫 milestone金色`,
    pie: `

# Mermaid 饼图规则
- 格式: pie title 标题
- 数据: "标签 数值" : 数值
- 配色: %%{init: {'theme':'base', 'themeVariables': {'pie1':'#xxx','pie2':'#xxx',...}}}%%
- 配色原则: 高对比度，相邻扇区色差明显
- 陷阱: 标签含数值，如 "维尼 3个" : 3；数值为整数`,
    quadrant: `

# Mermaid 象限图规则
- 格式: quadrantChart，title 标题
- 坐标轴: x-axis "左标签" --> "右标签"，y-axis "下标签" --> "上标签"
- 数据: "标签": [x, y]，x和y是0-1之间的数值
- 样式: %%{init: {'theme':'base', 'themeVariables': {'quadrant1Fill':'#xxx','quadrant2Fill':'#xxx','quadrant3Fill':'#xxx','quadrant4Fill':'#xxx'}}}%%
- 配色: 马卡龙色系`,
    architecture: `

# D2 规则
- 方向: direction: down(上到下) 或 right(左到右) 或 up(下到上) 或 left(右到左)
- 容器: 嵌套 {} 表达层级，节点标签用 : "文本"
- 连接: -> 实线，--> 虚线，标签用 : "文本"
- 形状: rectangle(默认) cylinder(数据库) person diamond hexagon cloud document page oval circle sql_table(表结构)
- 样式属性（写在节点 { } 内）:
  style.fill: 背景色 | style.stroke: 边框色 | style.stroke-width: 0-15 | style.font-color: 文字色
  style.font-size: 字号 | style.bold: true/false | style.opacity: 0-1 | style.border-radius: 圆角
- 常见陷阱:
  stroke-width 必须在 0-15 之间，文字颜色是 font-color 不是 fontColor
  没有 style.padding 属性，direction 值是一个单词不能写 left_to_right 等
  shape 名称必须用英文完整名，如 rectangle 不是 rect`,
  };

  const output = `

# 输出格式
只输出代码块，不解释：
\`\`\`${engine}
${engine === "d2" ? `direction: down
CSM: {
  ...
}` : `graph TD
  A[开始] --> B[审批]
  ...`}
\`\`\``;

  return base + (rules[diagramType] || rules.flowchart) + output;
}

// ═══════════════════════════════════════════════════════════════════
// 代码生成
// ═══════════════════════════════════════════════════════════════════

async function generateCode(prompt, opts) {
  const { theme, audience, engine, diagramType } = opts;
  const systemPrompt = buildSystemPrompt(theme, audience, engine, diagramType);
  const tStart = Date.now();

  const { text: content } = await callLLM({
    system: systemPrompt,
    user: prompt,
    format: "",
  });

  if (!content) throw new Error("DeepSeek 返回空内容");

  const diagrams = [];
  const mermaidMatch = content.match(/```mermaid\s*\n([\s\S]*?)```/);
  const d2Match = content.match(/```d2\s*\n([\s\S]*?)```/);

  if (mermaidMatch) diagrams.push({ engine: "mermaid", code: mermaidMatch[1].trim() });
  if (d2Match) diagrams.push({ engine: "d2", code: d2Match[1].trim() });

  if (diagrams.length === 0) throw new Error("未生成有效代码");

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`${TAG} ① 代码生成: 耗时 ${elapsed}s, 引擎=${diagrams.map(d => d.engine).join(",")}, promptLen=${prompt.length}, prompt="${prompt.slice(0, 500)}"`);

  return diagrams;
}

// ═══════════════════════════════════════════════════════════════════
// 第一层：语法校验
// ═══════════════════════════════════════════════════════════════════

function validateSyntax(code, engine) {
  if (engine === "d2") {
    try {
      const checkPath = path.join(os.tmpdir(), `d2-check-${Date.now()}.d2`);
      fs.writeFileSync(checkPath, code);
      execSync(`d2 --check "${checkPath}"`, { stdio: "pipe", timeout: 10000 });
      fs.unlinkSync(checkPath);
      console.log(`${TAG} ② 语法校验: engine=d2, ok=true`);
      return { ok: true };
    } catch (err) {
      const stderr = err.stderr?.toString() || err.message;
      const lineMatch = stderr.match(/(\d+):(\d+)/);
      const msg = stderr.includes("command not found")
        ? "D2 未安装，请运行: brew install d2"
        : stderr.split("\n").slice(0, 3).join(" ");
      const error = { line: lineMatch ? parseInt(lineMatch[1]) : null, message: msg };
      console.log(`${TAG} ② 语法校验: engine=d2, ok=false, error=${JSON.stringify(error)}`);
      return { ok: false, error };
    }
  }

  if (engine === "mermaid") {
    const issues = [];
    const pairs = { "{": "}", "(": ")", "[": "]" };
    const closers = Object.values(pairs);
    const stack = [];
    const lines = code.split("\n");

    const firstContentLine = lines.find(l => l.trim() !== "" && !l.trim().startsWith("%%"));
    const mermaidKeywords = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|quadrantChart|mindmap|gitGraph)/i;

    if (!firstContentLine || !mermaidKeywords.test(firstContentLine.trim())) {
      issues.push("Mermaid 代码必须以有效的声明关键字开头 (如 graph, flowchart 等)");
    }

    // 流程图特有陷阱检测（graph/flowchart），时序图跳过
    const isFlowchart = /^(graph|flowchart)/i.test(firstContentLine?.trim() || "");
    // erDiagram 的 {type KEY} 语法不是嵌套括号，跳过括号配对校验
    const isER = /^erDiagram/i.test(firstContentLine?.trim() || "");
    if (isFlowchart) {
      // 陷阱检测：() 在 [] 标签内
      const trapMatches = code.matchAll(/\[[^\]]*\w\([^)]*\)[^\]]*\]/g);
      for (const m of trapMatches) {
        issues.push(`标签 "${m[0].slice(0, 30)}..." 内含英文括号 ()，请改用中文括号 （）`);
      }

      // 陷阱检测：<> 在标签内
      const ltgtMatches = code.matchAll(/[\[\(\{][^\]\)\}]*[<>][^\]\)\}]*[\]\)\}]/g);
      for (const m of ltgtMatches) {
        issues.push(`标签 "${m[0].slice(0, 30)}..." 内含 <> 符号，请移除`);
      }

      // 陷阱检测：[] 嵌套在 [] 标签内（如 [X[Y]Z]），但排除合法的 [[ 子图语法
      const nestedBracketMatches = code.matchAll(/(?!\[\[)\[[^\]]*\[[^\]]*\]/g);
      for (const m of nestedBracketMatches) {
        issues.push(`标签 "${m[0].slice(0, 30)}..." 内含 [] 嵌套，Mermaid 不支持，请去掉内层方括号`);
      }
    }

    // 时序图特有检查：activate/deactivate 配对
    const isSequence = /^sequenceDiagram/i.test(firstContentLine?.trim() || "");
    if (isSequence) {
      const participants = new Set();
      const activateCount = {};
      const participantMatches = code.matchAll(/participant\s+(\w+)/g);
      for (const m of participantMatches) participants.add(m[1]);
      for (const p of participants) activateCount[p] = 0;
      for (const line of lines) {
        const actMatch = line.match(/activate\s+(\w+)/);
        const deactMatch = line.match(/deactivate\s+(\w+)/);
        if (actMatch && activateCount[actMatch[1]] !== undefined) activateCount[actMatch[1]]++;
        if (deactMatch && activateCount[deactMatch[1]] !== undefined) activateCount[deactMatch[1]]--;
      }
      for (const [p, count] of Object.entries(activateCount)) {
        if (count > 0) issues.push(`参与者 "${p}" 有 ${count} 个未配对的 activate`);
        if (count < 0) issues.push(`参与者 "${p}" 有 ${Math.abs(count)} 个多余的 deactivate`);
      }
    }

    // erDiagram 的 {type KEY} 语法不是嵌套括号，跳过括号配对
    if (!isER) {

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let inString = false;
      let stringChar = null;

      if (line.trim().startsWith("%%")) continue;

      for (let j = 0; j < line.length; j++) {
        const ch = line[j];

        if ((ch === '"' || ch === "'") && (j === 0 || line[j - 1] !== "\\")) {
          if (!inString) {
            inString = true;
            stringChar = ch;
          } else if (ch === stringChar) {
            inString = false;
            stringChar = null;
          }
          continue;
        }

        if (inString) continue;

        if (pairs[ch]) {
          stack.push({ char: ch, line: i + 1 });
        } else if (closers.includes(ch)) {
          if (stack.length === 0) {
            issues.push(`第${i + 1}行: 发现多余的闭合符号 "${ch}"`);
          } else {
            const last = stack.pop();
            if (pairs[last.char] !== ch) {
              issues.push(`第${i + 1}行: 括号不匹配，期望 "${pairs[last.char]}" 但找到 "${ch}"`);
            }
          }
        }
      }
    }

    for (const { char, line } of stack) {
      issues.push(`第${line}行: 符号 "${char}" 未闭合`);
    }

    } // end if (!isER)

    if (issues.length > 0) {
      console.log(`${TAG} ② 语法校验: engine=mermaid, ok=false, issues=${issues.join("; ")}`);
      return { ok: false, error: { line: null, message: issues.join("; ") } };
    }
    console.log(`${TAG} ② 语法校验: engine=mermaid, ok=true`);
    return { ok: true };
  }

  return { ok: false, error: { line: null, message: `未知引擎: ${engine}` } };
}

// ═══════════════════════════════════════════════════════════════════
// 第二层：语义校验
// ═══════════════════════════════════════════════════════════════════

const D2_KEYWORDS = /^(direction|style|class|shape|label|width|height|icon|link|tooltip|near|font|font-size|font-color|border-radius|stroke-width|stroke-dash|opacity|shadow|multiple|constraint|grid-rows|grid-columns|grid-gap|explain|sql_table|scale)$/;

function validateSemantics(code, engine) {
  const tStart = Date.now();
  const warnings = [];

  if (engine === "mermaid") {
    // 提取节点 ID
    const nodeIds = new Set();
    const nodeMatches = code.matchAll(/\b([A-Z][A-Z0-9_]*)\s*[\[\(\{]/g);
    for (const m of nodeMatches) nodeIds.add(m[1]);

    // 提取边
    const edges = new Set();
    const edgeMatches = code.matchAll(/\b([A-Z][A-Z0-9_]*)\s*(-->|--->|==>|===>|---|\.\.\.->|-\.->)\s*([A-Z][A-Z0-9_]*)/g);
    for (const m of edgeMatches) {
      edges.add(m[1]);
      edges.add(m[3]);
    }

    // 孤立节点检测
    for (const id of nodeIds) {
      if (!edges.has(id)) {
        warnings.push({ type: "orphan", message: `节点 "${id}" 可能为孤立节点，缺少连线` });
      }
    }

    // 决策完整性：菱形节点
    const diamondNodes = new Set();
    const diamondMatches = code.matchAll(/\b([A-Z][A-Z0-9_]*)\s*\{(?!\{)/g);
    for (const m of diamondMatches) diamondNodes.add(m[1]);

    for (const id of diamondNodes) {
      const outEdges = code.matchAll(new RegExp(`\\b${id}\\s*(-->|--->|==>|===>)`, "g"));
      const outCount = [...outEdges].length;
      if (outCount < 2) {
        warnings.push({ type: "decision", message: `决策节点 "${id}" 只有 ${outCount} 条出边，建议至少 2 条` });
      }
    }
  }

  if (engine === "d2") {
    // 检测 sql_table 作用域，跳过内部字段
    const sqlScopes = [];
    let pos = 0;
    while ((pos = code.indexOf("shape: sql_table", pos)) !== -1) {
      const blockStart = code.lastIndexOf("{", pos);
      let depth = 0, i = blockStart;
      for (; i < code.length; i++) {
        if (code[i] === "{") depth++;
        if (code[i] === "}") depth--;
        if (depth === 0) break;
      }
      sqlScopes.push({ start: blockStart, end: i });
      pos = i + 1;
    }

    const isInSQLScope = (index) => sqlScopes.some(s => index > s.start && index < s.end);

    // 提取节点名
    const nodeIds = new Set();
    const nodeMatches = code.matchAll(/^\s*([\w\u4e00-\u9fff]+)\s*:/gm);
    for (const m of nodeMatches) {
      if (isInSQLScope(m.index)) continue;
      nodeIds.add(m[1]);
    }

    // 提取边
    const connected = new Set();
    const edgeMatches = code.matchAll(/^\s*([\w\u4e00-\u9fff]+)\s*->\s*([\w\u4e00-\u9fff]+)/gm);
    for (const m of edgeMatches) {
      connected.add(m[1]);
      connected.add(m[2]);
    }

    const D2_KEYWORDS = /^(direction|style|class|shape|label|width|height|icon|link|tooltip|near|font|font-size|font-color|border-radius|stroke-width|stroke-dash|opacity|shadow|multiple|constraint|grid-rows|grid-columns|grid-gap|explain|sql_table|scale)$/;

    // 孤立节点
    for (const id of nodeIds) {
      if (!connected.has(id) && !D2_KEYWORDS.test(id)) {
        warnings.push({ type: "orphan", message: `节点 "${id}" 可能为孤立节点，缺少连线` });
      }
    }
  }

  console.log(`${TAG} ③ 语义校验: engine=${engine}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(2)}s, warnings=${warnings.length}`);
  return { ok: true, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 第三层：视觉校验
// ═══════════════════════════════════════════════════════════════════

function validateVisual(code, engine) {
  const tStart = Date.now();
  const warnings = [];

  if (engine === "mermaid") {
    const nodeCount = (code.match(/\b[A-Z][A-Z0-9_]*\s*[\[\(\{]/g) || []).length;
    if (nodeCount > 30) {
      warnings.push({ type: "complexity", message: `节点数 ${nodeCount} > 30，建议拆分为主流程+子流程` });
    }

    // 标签长度检查
    const labelMatches = code.matchAll(/[\[\(\{]([^\]\)\}]*)[\]\)\}]/g);
    for (const m of labelMatches) {
      const label = m[1].replace(/\\n/g, "\n");
      const maxLen = Math.max(...label.split("\n").map(l => l.length));
      if (maxLen > 15) {
        warnings.push({ type: "label_length", message: `标签 "${label.slice(0, 20)}..." 单行超 15 字符，建议 \\n 换行` });
      }
    }
  }

  if (engine === "d2") {
    const nodeCount = (code.match(/^\s*([\w\u4e00-\u9fff]+)\s*:/gm) || []).filter(m => !D2_KEYWORDS.test(m.match(/^\s*([\w\u4e00-\u9fff]+)/)?.[1] || "")).length;
    if (nodeCount > 30) {
      warnings.push({ type: "complexity", message: `节点数 ${nodeCount} > 30，建议用嵌套容器折叠` });
    }
  }

  console.log(`${TAG} ④ 视觉校验: engine=${engine}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(2)}s, warnings=${warnings.length}`);
  return { warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 渲染引擎
// ═══════════════════════════════════════════════════════════════════

async function renderDiagram(code, engine, workDir) {
  if (!CHROME_PATH) throw new Error("未找到 Chrome 浏览器，请安装 Chrome 或运行 npx puppeteer browsers install chrome");
  if (engine === "mermaid") return renderMermaid(code, workDir);
  if (engine === "d2") return renderD2(code, workDir);
  throw new Error(`未知引擎: ${engine}`);
}

async function renderMermaid(code, workDir) {
  const tStart = Date.now();
  const escapedCode = code.replace(/`/g, "\\`").replace(/\$/g, "\\$");

  // 保存源码到 workDir 便于调试
  fs.writeFileSync(path.join(workDir, "source.mmd"), code);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<script>
  function loadCSS(href, fallback) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onerror = function() { if (fallback) loadCSS(fallback); };
    document.head.appendChild(l);
  }
  loadCSS('https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap');
</script>
<style>
  body { margin: 0; padding: 20px; background: #fff; font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
  #container { display: inline-block; }
  #status { color: #999; font-size: 14px; }
</style>
</head>
<body>
<div id="container"><div id="status">加载 Mermaid 中...</div></div>
<script>
  function loadScript(src, fallback) {
    return new Promise((resolve, reject) => {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function() {
        if (fallback) { loadScript(fallback, null).then(resolve).catch(reject); }
        else { reject(new Error('CDN 加载失败: ' + src)); }
      };
      document.head.appendChild(s);
    });
  }
  (async () => {
    try {
      // 主 CDN: jsdelivr，备用: unpkg
      await loadScript(
        'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js',
        'https://unpkg.com/mermaid@10/dist/mermaid.min.js'
      );
      mermaid.initialize({ startOnLoad: false, theme: 'default', fontFamily: 'Noto Sans SC' });
      const { svg } = await mermaid.render('d', \`${escapedCode}\`);
      document.getElementById('container').innerHTML = svg;
    } catch(e) {
      document.getElementById('container').innerHTML = '<pre style="color:red">' + (e.message || String(e)) + '</pre>';
    }
  })();
</script>
</body>
</html>`;

  const htmlPath = path.join(workDir, "render.html");
  fs.writeFileSync(htmlPath, html);

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 6 });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });

    await page.waitForFunction(() => {
      const svg = document.querySelector("#container svg");
      const error = document.querySelector("#container pre");
      return svg || error;
    }, { timeout: 90000 });

    const errorText = await page.evaluate(() => {
      const el = document.querySelector("#container pre");
      return el?.textContent || "";
    });
    if (errorText) throw new Error(errorText);

    const svgElement = await page.$("#container svg");
    if (!svgElement) throw new Error("Mermaid 渲染失败：未生成 SVG");

    // 缩放 SVG 到目标尺寸（CSS 触发重排，比 getBBox 更可靠）
    await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const rect = svg.getBoundingClientRect();
      const scale = Math.max(2, 1200 / Math.max(rect.width, 1));
      svg.style.width = (rect.width * scale) + 'px';
      svg.style.height = (rect.height * scale) + 'px';
    });

    // 重新获取缩放后的边界并裁剪
    const clip = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const rect = svg.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    const PADDING = 16;
    clip.x = Math.max(0, clip.x - PADDING);
    clip.y = Math.max(0, clip.y - PADDING);
    clip.width += PADDING * 2;
    clip.height += PADDING * 2;

    const pngPath = path.join(workDir, "preview.png");
    await page.screenshot({ path: pngPath, type: "png", clip });

    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    const size = fs.statSync(pngPath).size;
    console.log(`${TAG} ⑤ 渲染: engine=mermaid, 耗时 ${elapsed}s, pngSize=${size} bytes`);
    return pngPath;
  } finally {
    await browser.close();
  }
}

async function renderD2(code, workDir) {
  const tStart = Date.now();

  // 保存源码到 workDir 便于调试
  fs.writeFileSync(path.join(workDir, "source.d2"), code);

  try {
    const version = execSync("d2 --version", { stdio: "pipe" }).toString().trim();
    console.log(`${TAG} D2 版本: ${version}`);
  } catch {
    const err = new Error("D2 未安装，请运行: brew install d2");
    console.error(`${TAG} D2 未安装`);
    throw err;
  }

  const d2Path = path.join(workDir, "input.d2");
  const svgPath = path.join(workDir, "output.svg");
  fs.writeFileSync(d2Path, code);

  console.log(`${TAG} D2 CJK字体: 跳过（macOS 系统自带）`);

  try {
    execSync(`d2 compile --theme=0 --pad=20 "${d2Path}" "${svgPath}"`, {
      stdio: "pipe",
      timeout: 30000,
    });
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    const lineMatch = stderr.match(/(\d+):(\d+)/);
    console.error(`${TAG} D2 编译失败: ${stderr.split("\n").slice(0, 3).join(" ")}`);
    throw new Error(`D2 编译失败: ${lineMatch ? `第${lineMatch[1]}行 ` : ""}${stderr.split("\n").slice(0, 3).join(" ")}`);
  }

  if (!fs.existsSync(svgPath)) throw new Error("D2 编译失败：未生成 SVG");

  const svgContent = fs.readFileSync(svgPath, "utf-8");

  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME_PATH, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 6 });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:#fff">${svgContent}</body></html>`, { waitUntil: "load" });

    const svgElement = await page.$("svg");
    if (!svgElement) throw new Error("D2 渲染失败：SVG 解析错误");

// 缩放 SVG 到目标尺寸（CSS 触发重排，比 getBBox 更可靠）
    await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const rect = svg.getBoundingClientRect();
      const scale = Math.max(2, 1200 / Math.max(rect.width, 1));
      svg.style.width = (rect.width * scale) + 'px';
      svg.style.height = (rect.height * scale) + 'px';
    });

    // 重新获取缩放后的边界并裁剪
    const clip = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const rect = svg.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    const PADDING = 16;
    clip.x = Math.max(0, clip.x - PADDING);
    clip.y = Math.max(0, clip.y - PADDING);

    const pngPath = path.join(workDir, "preview.png");
    await page.screenshot({ path: pngPath, type: "png", clip });

    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    const size = fs.statSync(pngPath).size;
    console.log(`${TAG} ⑤ 渲染: engine=d2, 耗时 ${elapsed}s, pngSize=${size} bytes`);
    return pngPath;
  } finally {
    await browser.close();
  }
}

async function ensureCJKFont(workDir) {
  const fontPath = path.join(workDir, "NotoSansSC-Regular.ttf");
  if (fs.existsSync(fontPath)) return fontPath;

  const FONT_URLS = [
    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  ];

  const tStart = Date.now();
  console.log(`${TAG} 下载 CJK 字体...`);

  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        console.log(`${TAG} CJK 字体 HTTP ${res.status}, url=${url}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(fontPath, buffer);
      console.log(`${TAG} CJK 字体下载完成: ${(buffer.length / 1024).toFixed(0)}KB, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
      return fontPath;
    } catch (err) {
      if (err.name === "AbortError") {
        console.log(`${TAG} CJK 字体下载超时, url=${url}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
      } else if (err.cause?.code === "ENOTFOUND") {
        console.log(`${TAG} CJK 字体 DNS 解析失败, url=${url}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
      } else if (err.cause?.code === "ECONNREFUSED") {
        console.log(`${TAG} CJK 字体连接被拒绝, url=${url}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
      } else {
        console.log(`${TAG} CJK 字体下载失败: ${err.message}, url=${url}, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
      }
    }
  }

  console.log(`${TAG} CJK 字体下载失败: 所有源均不可用, 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════
// 产物校验
// ═══════════════════════════════════════════════════════════════════

function validateOutput(pngPath) {
  const tStart = Date.now();
  if (!fs.existsSync(pngPath)) return { ok: false, error: "PNG 文件不存在" };
  const stat = fs.statSync(pngPath);
  if (stat.size === 0) return { ok: false, error: "PNG 文件为空" };
  console.log(`${TAG} ⑥ 产物校验: 耗时 ${((Date.now() - tStart) / 1000).toFixed(2)}s, ok=true, size=${stat.size} bytes`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
// 第四层：多模态视觉校验（MiniMax-M3）
// ═══════════════════════════════════════════════════════════════════

async function compressContext(prompt) {
  if (prompt.length <= 200) return prompt;

  try {
    const { text } = await callLLM({
      user: `将以下内容压缩到200字以内，保留关键信息（主题、配色、风格、图表类型、数据）：\n\n${prompt}`,
      maxTokens: 300,
      temperature: 0.3,
      format: "",
    });
    const compressed = text.trim().slice(0, 200) || prompt.slice(0, 200);
    console.log(`${TAG} 上下文压缩: ${prompt.length} → ${compressed.length} 字`);
    return compressed;
  } catch {
    return prompt.slice(0, 200);
  }
}

async function reviewVisual(pngPath, context = "") {
  const tStart = Date.now();
  const { provider } = getMultimodalProvider();
  if (!getApiKey(provider, `${provider.toUpperCase()}_API_KEY`)) {
    console.log(`${TAG} ⑦ 视觉评估: 跳过（未配置 ${provider} API_KEY）`);
    return { score: 3, issues: [], note: `未配置 ${provider} API_KEY，跳过视觉校验` };
  }

  try {
    const pngBuffer = fs.readFileSync(pngPath);
    const base64 = pngBuffer.toString("base64");

    const { text } = await callMultimodalLLM({
      user: `参考用户需求（${context}）。评估图表视觉质量：\n1. 布局与可读性（最重要）：线条是否交叉？间距合理？文字清晰？\n2. 配色与对比度：颜色协调？是否匹配用户风格偏好？\n3. 整体专业度：信息密度合理？专业美观？\n\n打分 1-5，综合评分。返回格式：{"score": 数字, "issues": ["问题描述"]}。只输出 JSON，不要解释。`,
      images: [`data:image/png;base64,${base64}`],
      maxTokens: 500,
      temperature: 0.3,
      format: "",
    });

    const jsonMatch = text.match(/\{\s*"score"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const review = { ...JSON.parse(jsonMatch[0]), note: `${provider} 视觉评估` };
        console.log(`${TAG} ⑦ 视觉评估: 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s, score=${review.score}, issues=${JSON.stringify(review.issues)}`);
        return review;
      } catch (e) {
        console.log(`${TAG} ⑦ 视觉评估: 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s, JSON 解析失败, ${e.message}`);
        return { score: 3, issues: [], note: "视觉评估 JSON 解析失败" };
      }
    }
    console.log(`${TAG} ⑦ 视觉评估: 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s, 无 JSON, raw="${text.slice(0, 100)}"`);
    return { score: 3, issues: [], note: "视觉评估结果解析失败" };
  } catch (err) {
    console.log(`${TAG} ⑦ 视觉评估: 耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s, 失败, ${err.message}`);
    return { score: 3, issues: [], note: `视觉评估失败: ${err.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 注册工具
// ═══════════════════════════════════════════════════════════════════

// writeTaskState / updateTask / sleep — 已迁到 shared/utils.js 和 mcp/lib/task-state.js

async function executeDiagramPipeline(taskId, workDir, prompt, opts) {
  try {
    updateTask(workDir, { status: "generating", progress: 5, message: "代码生成中..." });

    const diagrams = opts.diagrams || await generateCode(prompt, opts);
    updateTask(workDir, { status: "validating", progress: 40, message: "校验中..." });

    const results = [];
    let visualScore = 0;
    let scoreCount = 0;

    for (const diagram of diagrams) {
      const { engine, code: diagCode } = diagram;

      const syntaxResult = validateSyntax(diagCode, engine);
      if (!syntaxResult.ok) {
        results.push({ engine, status: "error", error: syntaxResult.error, code: diagCode });
        continue;
      }

      const semanticResult = validateSemantics(diagCode, engine);
      const visualResult = validateVisual(diagCode, engine);

      updateTask(workDir, { status: "rendering", progress: 50, message: "渲染中..." });

      let pngPath;
      try {
        pngPath = await renderDiagram(diagCode, engine, workDir);
      } catch (renderErr) {
        console.error(`${TAG} 渲染失败: engine=${engine}, ${renderErr.stack || renderErr.message}`);
        const lineMatch = renderErr.message.match(/(\d+)/);
        results.push({ engine, status: "error", error: { line: lineMatch ? parseInt(lineMatch[1]) : null, message: renderErr.message }, code: diagCode });
        continue;
      }

      updateTask(workDir, { progress: 80 });

      const outputResult = validateOutput(pngPath);
      if (!outputResult.ok) {
        results.push({ engine, status: "error", error: { line: null, message: outputResult.error }, code: diagCode });
        continue;
      }

      updateTask(workDir, { status: "reviewing", progress: 85, message: "视觉评估中..." });

      const context = await compressContext(prompt);
      const visualReview = await reviewVisual(pngPath, context);
      visualScore += visualReview.score || 3;
      scoreCount++;

      const pngUrl = `/preview/${taskId}.png`;

      results.push({
        engine, status: "ok", pngUrl,
        summary: `${engine === "mermaid" ? "业务逻辑流程" : "系统架构拓扑"}：${prompt.slice(0, 200)}`,
        altText: visualReview.issues?.length > 0
          ? `图表: ${prompt.slice(0, 200)}。视觉问题: ${visualReview.issues.join("; ")}`
          : `图表: ${prompt.slice(0, 200)}`,
        visualScore: visualReview.score,
        visualIssues: visualReview.issues || [],
        warnings: [...(semanticResult.warnings || []), ...(visualResult.warnings || [])],
      });
    }

    const errors = results.filter(r => r.status === "error");
    if (errors.length === diagrams.length) {
      updateTask(workDir, {
        status: "failed",
        progress: 100,
        diagrams: errors.map(e => ({ engine: e.engine, line: e.error?.line, message: e.error?.message, code: e.code })),
        note: "所有图表生成失败，请根据错误信息修复代码后重试",
      });
      return;
    }

    const avgScore = scoreCount > 0 ? visualScore / scoreCount : 3;
    const okResults = results.filter(r => r.status === "ok");

    const taskState = {
      status: "done",
      progress: 100,
      message: "完成",
      visualScore: Math.round(avgScore),
    };

    if (okResults.length === 1) {
      taskState.pngUrl = okResults[0].pngUrl;
      taskState.summary = okResults[0].summary;
      taskState.altText = okResults[0].altText;
      taskState.warnings = okResults[0].warnings;
      taskState.visualIssues = okResults[0].visualIssues;
      taskState.note = "URL 为相对路径，用 ![描述](URL) 直接展示";
    } else {
      taskState.diagrams = okResults.map(r => ({
        engine: r.engine, pngUrl: r.pngUrl, summary: r.summary, altText: r.altText,
        visualScore: r.visualScore, visualIssues: r.visualIssues, warnings: r.warnings,
      }));
    }

    if (errors.length > 0) {
      taskState.partialErrors = errors.map(e => ({ engine: e.engine, line: e.error?.line, message: e.error?.message, code: e.code }));
    }

    updateTask(workDir, taskState);
    console.log(`${TAG} 完成: taskId=${taskId}, status=ok`);
  } catch (err) {
    console.error(`${TAG} 异常: taskId=${taskId}, ${err.stack || err.message}`);
    updateTask(workDir, { status: "failed", progress: 100, error: err.message });
  }
}

export function register(server) {
  server.tool(
    "generateDiagram",
    "根据描述生成图表，自动选择 Mermaid 或 D2 引擎。\n" +
      "Mermaid 支持: 流程图、时序图、类图、状态图、ER图、甘特图、饼图、象限图、思维导图、Git图\n" +
      "D2 支持: 架构图、网络拓扑图、SQL/数据库模式、容器嵌套图\n" +
      "参数: prompt（必填）、audience（executive/technical/mixed，默认 mixed）、theme（corporate/dark/sketch，默认 corporate）、code+engine（修复模式）。\n" +
      "异步模式: 提交任务后返回 taskId，用 checkDiagramProgress 查询进度。\n" +
      "简单场景单图，复杂场景 Mermaid(业务逻辑) + D2(系统架构) 双图互补。\n" +
      "失败时返回具体错误（行号+原因），根据错误修复代码后重试，最多 3 次。\n" +
      "成功后用 Markdown 图片语法展示: ![描述](图片URL)。\n" +
      "修改图表时用 readFile 读源码 → replaceInFile 编辑 → 重新调用 generateDiagram 渲染。",
    {
      prompt: z.string().min(1).describe("图表描述，如'画 SaaS 平台多租户上线方案'"),
      audience: z.enum(["executive", "technical", "mixed"]).optional().default("mixed").describe("受众: executive(决策层)/technical(执行层)/mixed(默认)"),
      theme: z.enum(["corporate", "dark", "sketch"]).optional().default("sketch").describe("主题: corporate(商务)/dark(深色)/sketch(手绘柔和，默认)"),
      code: z.string().optional().describe("修复模式：传入修正后的完整代码"),
      engine: z.enum(["mermaid", "d2"]).describe("引擎类型: mermaid 或 d2"),
      diagramType: z.enum(["flowchart", "sequence", "class", "state", "er", "gantt", "pie", "quadrant", "architecture"]).describe("图表类型: flowchart/sequence/class/state/er/gantt/pie/quadrant/architecture"),
    },
    async ({ prompt, audience, theme, code, engine, diagramType }) => {
      try {
        console.log(`${TAG} 开始: promptLen=${prompt.length}, prompt="${prompt.slice(0, 500)}", theme=${theme}, audience=${audience}, repair=${!!code}`);

        const wfProvider = getWorkflowProvider();
        if (!getApiKey(wfProvider, `${wfProvider.toUpperCase()}_API_KEY`)) {
          console.error(`${TAG} 未配置 ${wfProvider} API_KEY`);
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `未配置 ${wfProvider} API_KEY` }) }] };
        }

        const taskId = shortId();
        const workDir = path.join(TASK_DIR, taskId);
        console.log(`${TAG} taskId=${taskId}, workDir=${workDir}`);

        writeTaskState(workDir, { status: "started", progress: 0, message: "任务已提交", prompt, theme, audience });

        const diagrams = code && engine ? [{ engine, code }] : null;
        executeDiagramPipeline(taskId, workDir, prompt, { theme, audience, engine, diagramType, diagrams }).catch(err => {
          console.error(`${TAG} 后台执行失败: taskId=${taskId}, ${err.stack || err.message}`);
          updateTask(workDir, { status: "failed", progress: 100, error: err.message });
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: true, taskId, status: "started", note: "用 checkDiagramProgress(taskId, interval=20) 查询进度", }, null, 2),
          }],
        };
      } catch (err) {
        console.error(`${TAG} 异常: ${err.stack || err.message}`);
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );

  server.tool(
    "checkDiagramProgress",
    "查询图表生成任务进度。返回包含 progress(百分比)、status 字段。每次调用会等待后返回最新状态（等待时间由 interval 参数控制）。调用期间根据 progress 给用户正向反馈（如'已完成 X%'），不要输出负面描述或催促。反复调用直到 status='done' 或 'failed' 后停止。status=done 时告知用户并用 Markdown 图片语法展示。",
    {
      taskId: z.string().min(1).describe("任务 ID"),
      interval: z.number().optional().default(20).describe("初始查询间隔（秒），后续每次递减 10%，最低为初始值的 60%"),
    },
    async ({ taskId, interval }) => {
      const workDir = path.join(TASK_DIR, taskId);
      const taskFile = path.join(workDir, "task.json");
      if (!fs.existsSync(taskFile)) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "任务不存在或已过期" }) }] };
      const state = JSON.parse(fs.readFileSync(taskFile, "utf-8"));

      if (state.status === "running" || state.status === "started" || state.status === "generating" || state.status === "validating" || state.status === "rendering" || state.status === "reviewing") {
        const count = state.checkCount || 0;
        const wait = getAdaptiveWait(interval, count);
        updateTask(workDir, { checkCount: count + 1 });
        console.log(`${TAG} checkDiagramProgress: taskId=${taskId}, interval=${interval}, count=${count}, wait=${(wait / 1000).toFixed(1)}s, status=${state.status}`);
        await sleep(wait);
        const updated = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
        return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    },
  );
}