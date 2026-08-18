import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { shortId, downloadsDir } from "../../../shared/utils.js";
import { loadNetworkConfig } from "../../../shared/network.js";

const TAG = "[doc]";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "../../../..");

function rp(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
}

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

const MIN_TEXT_LEN = 20;  // 产物最少文字字符数，低于此视为内容为空

const FONT_NAME = "NotoSansCJKsc-Regular.otf";
const FONT_DIR = path.join(PROJECT_ROOT, "data", "static");
const FONT_FILE = path.join(FONT_DIR, FONT_NAME);
const FONT_DOWNLOAD_URLS = [
  "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
  "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
];

// 从 config/network.json 读端口 + host（共享读取器）
const PORTS_CONFIG = loadNetworkConfig();
const LOCAL_HOST = PORTS_CONFIG.hosts.local;
const PROD_PROXY = PORTS_CONFIG.ports.aiChat.prodProxy;
const PROD_DIRECT = PORTS_CONFIG.ports.aiChat.prodDirect;
const DEV_PORT = PORTS_CONFIG.ports.aiChat.dev;

console.log(`${TAG} config: aiChat dev=${DEV_PORT} prodDirect=${PROD_DIRECT} prodProxy=${PROD_PROXY} host=${LOCAL_HOST}`);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeName(name) {
  return (name || "document").replace(/[\/\\:*?"<>|]/g, "_");
}

// ─── 子进程执行（异步，不阻塞事件循环） ───

function run(cmd, args, opts = {}) {
  const { timeout, ...spawnOpts } = opts;
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, spawnOpts);
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = timeout
      ? setTimeout(() => {
          if (!done) {
            done = true;
            proc.kill("SIGKILL");
            reject(new Error(`${cmd} 超时(${(timeout / 1000).toFixed(0)}s)`));
          }
        }, timeout)
      : null;
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} 退出码 ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// ─── pandoc 检测 + 自动安装 ───

export async function checkPandoc() {
  try {
    const { stdout } = await run("pandoc", ["--version"], { timeout: 5000 });
    return (stdout.split("\n")[0] || "").trim();
  } catch {
    return null;
  }
}

async function ensurePandoc() {
  const v = await checkPandoc();
  if (v) {
    console.log(`${TAG} ensurePandoc: 已安装 ${v}`);
    return "pandoc";
  }

  if (process.env.DOC_AUTO_INSTALL === "0") {
    throw new Error("pandoc 未安装，且 DOC_AUTO_INSTALL=0 已禁用自动安装。请手动运行: brew install pandoc");
  }

  const platform = process.platform;
  let installCmd;
  if (platform === "darwin") installCmd = ["brew", "install", "pandoc"];
  else if (platform === "linux") installCmd = ["sudo", "apt-get", "install", "-y", "pandoc"];
  else if (platform === "win32") installCmd = ["choco", "install", "pandoc", "-y"];
  else throw new Error(`不支持的平台: ${platform}，请手动安装 pandoc`);

  console.log(`${TAG} ensurePandoc: 未检测到 pandoc，自动安装中 platform=${platform} cmd=${installCmd.join(" ")}`);
  try {
    await run(installCmd[0], installCmd.slice(1), { timeout: 180000 });
  } catch (err) {
    throw new Error(`pandoc 自动安装失败: ${err.message}。请手动运行: ${installCmd.join(" ")}`);
  }

  const v2 = await checkPandoc();
  if (v2) {
    console.log(`${TAG} ensurePandoc: 安装成功 ${v2}`);
    return "pandoc";
  }
  throw new Error(`pandoc 安装后仍无法运行，请手动检查: ${installCmd.join(" ")}`);
}

// ─── CJK 字体：本地源（MCP工具自带）→ ai-chat data/static（Next.js 路由服务） ───

const FONT_SOURCE = path.join(SCRIPT_DIR, "NotoSansCJKsc-Regular.otf");

export async function ensureCJKFont() {
  try {
    fs.mkdirSync(FONT_DIR, { recursive: true });
  } catch { /* ignore */ }

  // 1. 目标已存在
  if (fs.existsSync(FONT_FILE) && fs.statSync(FONT_FILE).size > 1_000_000) {
    const size = (fs.statSync(FONT_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`${TAG} ensureCJKFont: 目标已存在 ${size}MB`);
    return FONT_FILE;
  }

  // 2. 从 MCP 工具本地源复制
  if (fs.existsSync(FONT_SOURCE) && fs.statSync(FONT_SOURCE).size > 1_000_000) {
    fs.copyFileSync(FONT_SOURCE, FONT_FILE);
    console.log(`${TAG} ensureCJKFont: 本地源复制 → ${(fs.statSync(FONT_FILE).size / 1024 / 1024).toFixed(1)}MB`);
    return FONT_FILE;
  }

  // 3. CDN 兜底
  console.log(`${TAG} ensureCJKFont: 本地源缺失，CDN 下载...`);
  for (const url of FONT_DOWNLOAD_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) {
        console.log(`${TAG} ensureCJKFont: HTTP ${res.status} ${url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1_000_000) {
        console.log(`${TAG} ensureCJKFont: 文件太小 (${buf.length}B) ${url}`);
        continue;
      }
      fs.writeFileSync(FONT_FILE, buf);
      console.log(`${TAG} ensureCJKFont: CDN 下载完成 ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
      return FONT_FILE;
    } catch (err) {
      console.log(`${TAG} ensureCJKFont: 失败 ${err.message} ${url}`);
    }
  }
  console.log(`${TAG} ensureCJKFont: 所有源失败，降级用系统字体`);
  return null;
}

// ─── 输入解析 ───

function resolveInput({ source, filePath, content }) {
  if (source === "file") {
    if (!filePath) throw new Error("source=file 时必须提供 filePath");
    const fp = rp(filePath);
    if (!fs.existsSync(fp)) throw new Error(`文件不存在: ${fp}`);
    const text = fs.readFileSync(fp, "utf-8");
    const baseDir = path.dirname(fp);
    const title = path.basename(fp, path.extname(fp));
    console.log(`${TAG} resolveInput: file=${fp} size=${text.length}字 baseDir=${baseDir}`);
    return { text, baseDir, title };
  }
  if (!content) throw new Error("source=content 时必须提供 content");
  const baseDir = process.cwd();
  console.log(`${TAG} resolveInput: content size=${content.length}字 baseDir=${baseDir}`);
  return { text: content, baseDir, title: null };
}

// ─── 图片内联 base64（PDF 需要，本地相对路径 → data URI） ───

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function inlineImages(html, baseDir) {
  let count = 0;
  const out = html.replace(/<img[^>]*src="([^"]+)"[^>]*>/g, (full, src) => {
    if (/^(data:|https?:|file:)/.test(src)) return full;
    const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    try {
      const buf = fs.readFileSync(abs);
      const mime = MIME_MAP[path.extname(abs).toLowerCase()] || "image/png";
      count++;
      return full.replace(`src="${src}"`, `src="data:${mime};base64,${buf.toString("base64")}"`);
    } catch {
      console.log(`${TAG} inlineImages: 图片无法读取 ${abs}，保留原样`);
      return full;
    }
  });
  console.log(`${TAG} inlineImages: 内联 ${count} 张图片`);
  return out;
}

// ─── HTML 模板（CJK 打印样式） ───

function buildHtml(title, bodyHtml, fontUrl) {
  const fontFace = fontUrl
    ? `@font-face{font-family:"DocCJK";src:url("${fontUrl}") format("opentype");}\n`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || "document")}</title>
<style>
${fontFace}*{box-sizing:border-box}
body{font-family:"DocCJK","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#1a1a1a;font-size:14px;line-height:1.8;margin:0;padding:8px}
h1{font-size:24px;border-bottom:2px solid #1a1a1a;padding-bottom:8px;margin:0 0 16px}
h2{font-size:20px;margin:28px 0 12px;padding-left:10px;border-left:4px solid #c0392b}
h3{font-size:17px;margin:20px 0 8px}
h4,h5,h6{font-size:15px;margin:16px 0 6px}
p{margin:8px 0}
strong{font-weight:700}
blockquote{margin:12px 0;padding:10px 14px;background:#fdf6f0;border-left:3px solid #f0a060;color:#7a5230}
code{background:#f4f4f4;padding:2px 6px;border-radius:3px;font-family:Menlo,Consolas,monospace;font-size:13px}
pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13px}
th{background:#f5f5f5;font-weight:700}
th,td{border:1px solid #d0d0d0;padding:6px 10px;text-align:left}
tr:nth-child(even) td{background:#fafafa}
img{max-width:100%}
input[type=checkbox]{transform:scale(1.1);margin-right:4px}
hr{border:none;border-top:1px solid #d0d0d0;margin:20px 0}
ul,ol{padding-left:24px;margin:8px 0}
li{margin:4px 0}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ─── 惰性探测 ai-chat 实际运行端口，永久缓存 ───

let _fontBaseUrl = null;  // null=未探测；""=探测失败；string=命中 URL

async function getFontBaseUrl() {
  if (_fontBaseUrl !== null) return _fontBaseUrl || null;

  const candidates = [
    `http://${LOCAL_HOST}:${PROD_PROXY}`,  // 优先 prodProxy
    `http://${LOCAL_HOST}:${DEV_PORT}`,      // 其次 dev
  ];

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/api/uploads/${FONT_NAME}`, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok && res.headers.get("access-control-allow-origin")) {
        _fontBaseUrl = base;
        console.log(`${TAG} getFontBaseUrl: 探测命中 ${base}`);
        return _fontBaseUrl;
      }
    } catch { /* timeout or refused */ }
  }

  _fontBaseUrl = "";
  console.log(`${TAG} getFontBaseUrl: 探测全部失败 (prodProxy=${PROD_PROXY} dev=${DEV_PORT} 都不通)`);
  return null;
}

// ─── MD/HTML/文本 → PDF ───

async function mdToPdf({ text, from, baseDir, title, outputPath }) {
  if (!CHROME_PATH) throw new Error("未找到 Chrome，请运行 npx puppeteer browsers install chrome");

  const fontPath = await ensureCJKFont();
  const fontBaseUrl = fontPath ? await getFontBaseUrl() : null;
  const fontUrl = fontBaseUrl ? `${fontBaseUrl}/api/uploads/${FONT_NAME}` : null;
  if (fontPath && !fontUrl) console.log(`${TAG} mdToPdf: 字体已就位但 ai-chat 不可达，降级用系统字体`);

  const htmlBody =
    from === "html"
      ? text
      : from === "plaintext"
        ? escapeHtml(text).replace(/\n/g, "<br>")
        : marked.parse(text);
  const withImages = inlineImages(htmlBody, baseDir);
  const html = buildHtml(title, withImages, fontUrl);

  const tStart = Date.now();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let textLength = 0;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    if (fontUrl) {
      await page.evaluate(() => document.fonts.ready);
      const fontsState = await page.evaluate(() => {
        const out = [];
        for (const f of document.fonts.values()) out.push(`${f.family}/${f.status}`);
        return out;
      });
      console.log(`${TAG} mdToPdf: 字体状态 ${JSON.stringify(fontsState)}`);
    }
    const bodyText = await page.evaluate(() => document.body.innerText || "");
    textLength = bodyText.replace(/\s/g, "").length;
    if (textLength < MIN_TEXT_LEN) {
      throw new Error(`PDF 内容为空（提取文本仅 ${textLength} 字符），输入可能丢失正文`);
    }
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await browser.close();
  }

  const size = fs.statSync(outputPath).size;
  console.log(`${TAG} mdToPdf: from=${from} 字体=${fontUrl ? "DocCJK(http)" : "系统"} 文本=${textLength}字 pdf=${(size / 1024).toFixed(1)}KB 耗时=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  return { textLength };
}

// ─── 内容 → docx（pandoc） ───

async function getDocxTextLength(docxPath) {
  return new Promise((resolve) => {
    const proc = spawn("unzip", ["-p", docxPath, "word/document.xml"]);
    let xml = "";
    proc.stdout?.on("data", (d) => (xml += d));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const matches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      const text = matches.map((m) => m.replace(/<[^>]+>/g, "")).join("").replace(/\s/g, "");
      resolve(text.length);
    });
  });
}

async function toDocx({ text, from, baseDir, title, outputPath }) {
  const pandoc = await ensurePandoc();
  // gfm 的 task_lists 会吞掉 - [ ] 复选框标记，禁用后 [ ]/[x] 原样保留为文字（打印问卷友好）
  const fmt = from === "html" ? "html" : from === "plaintext" ? "markdown" : "gfm-task_lists";
  const tStart = Date.now();

  const args = ["-f", fmt, "-t", "docx", "-o", outputPath];

  const proc = spawn(pandoc, args, { cwd: baseDir });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  proc.stdin.end(text);

  await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`pandoc 退出码 ${code}: ${stderr.slice(-500)}`)),
    );
  });

  const textLength = await getDocxTextLength(outputPath);
  if (textLength !== null && textLength < MIN_TEXT_LEN) {
    throw new Error(`docx 内容为空（提取文本仅 ${textLength} 字符），输入可能丢失正文`);
  }

  const size = fs.statSync(outputPath).size;
  console.log(`${TAG} toDocx: from=${from} fmt=${fmt} 文本=${textLength ?? "?"}字 docx=${(size / 1024).toFixed(1)}KB 耗时=${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  return { textLength };
}

// ─── 输出路径 ───

function buildOutputPath({ outputPath, title, format }) {
  const dir = outputPath ? rp(outputPath) : downloadsDir;
  fs.mkdirSync(dir, { recursive: true });
  const base = safeName(title);
  const ext = format === "pdf" ? ".pdf" : ".docx";
  let out = path.join(dir, base + ext);
  if (fs.existsSync(out)) out = path.join(dir, `${base}_${Date.now()}${ext}`);
  return out;
}

// ─── 注册工具 ───

export function register(server) {
  server.tool(
    "convertDocument",
    "将 Markdown / HTML / 纯文本内容转换为 PDF 或 Word(.docx)。支持从文件读取或直接传内容。输出到 Downloads（可用 outputPath 指定）。同步返回产物绝对路径。",
    {
      format: z.enum(["pdf", "docx"]).describe("目标格式: pdf 或 docx"),
      from: z.enum(["markdown", "html", "plaintext"]).optional().default("markdown").describe("输入内容格式，默认 markdown"),
      source: z.enum(["file", "content"]).optional().default("content").describe("输入来源: file=读文件 / content=直接传内容，默认 content"),
      filePath: z.string().optional().describe("输入文件路径（source=file 时必填）"),
      content: z.string().optional().describe("要转换的内容（source=content 时必填）"),
      title: z.string().optional().describe("文档标题，用作输出文件名。缺省取文件名或首个标题"),
      outputPath: z.string().optional().describe("输出目录，默认 ~/Downloads"),
    },
    async ({ format, from, source, filePath, content, title, outputPath }) => {
      try {
        console.log(`${TAG} convertDocument: format=${format} from=${from} source=${source} title="${title || ""}"`);
        const { text, baseDir, title: fileTitle } = resolveInput({ source, filePath, content });
        const finalTitle = title || fileTitle;
        const out = buildOutputPath({ outputPath, title: finalTitle, format });
        const { textLength } = format === "pdf"
          ? await mdToPdf({ text, from, baseDir, title: finalTitle, outputPath: out })
          : await toDocx({ text, from, baseDir, title: finalTitle, outputPath: out });
        const size = fs.statSync(out).size;
        console.log(`${TAG} convertDocument: 完成 ${out} (${(size / 1024).toFixed(1)}KB, 已校验 ${textLength ?? "?"} 字符)`);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, format, outputFile: out, size, textLength, note: `已验证产物含 ${textLength ?? "?"} 个字符 → ${out}` }, null, 2) }],
        };
      } catch (err) {
        console.error(`${TAG} convertDocument: 失败 ${err.message}`);
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );

  server.tool(
    "convertDocumentBatch",
    "批量将目录下的 Markdown 文件转换为 PDF 或 Word。返回每个文件的产物路径和失败清单。",
    {
      dirPath: z.string().describe("要批量转换的目录路径"),
      format: z.enum(["pdf", "docx"]).describe("目标格式: pdf 或 docx"),
      pattern: z.string().optional().default("*.md").describe("文件名匹配模式，默认 *.md"),
      recursive: z.boolean().optional().default(false).describe("是否递归子目录，默认 false"),
      outputPath: z.string().optional().describe("输出目录，默认 ~/Downloads"),
    },
    async ({ dirPath, format, pattern = "*.md", recursive = false, outputPath }) => {
      try {
        const dir = rp(dirPath);
        if (!fs.existsSync(dir)) throw new Error(`目录不存在: ${dir}`);
        const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        const mdFiles = [];
        const walk = (d) => {
          for (const name of fs.readdirSync(d)) {
            const fp = path.join(d, name);
            const st = fs.statSync(fp);
            if (st.isDirectory() && recursive) walk(fp);
            else if (st.isFile() && regex.test(name)) mdFiles.push(fp);
          }
        };
        walk(dir);
        console.log(`${TAG} convertDocumentBatch: dir=${dir} pattern=${pattern} recursive=${recursive} 匹配=${mdFiles.length}`);

        const files = [];
        const failed = [];
        for (const fp of mdFiles) {
          try {
            const { text, baseDir, title } = resolveInput({ source: "file", filePath: fp });
            const out = buildOutputPath({ outputPath, title, format });
            if (format === "pdf") await mdToPdf({ text, from: "markdown", baseDir, title, outputPath: out });
            else await toDocx({ text, from: "markdown", baseDir, title, outputPath: out });
            files.push({ name: path.basename(fp), outputFile: out, size: fs.statSync(out).size });
          } catch (err) {
            console.error(`${TAG} convertDocumentBatch: ${fp} 失败 ${err.message}`);
            failed.push({ name: path.basename(fp), error: err.message });
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, format, total: mdFiles.length, files, failed }, null, 2) }],
        };
      } catch (err) {
        console.error(`${TAG} convertDocumentBatch: 失败 ${err.message}`);
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );
}

// ─── 自检 ───

const SAMPLE_MD = `# 测试文档

> 这是一段引用，用于验证中文渲染。

## 表格

| 项目 | 金额 | 说明 |
|------|------|------|
| 合作费 | 39,800 | 一次性 |
| 保证金 | 5,000 | 可退 |

## 复选框

- [ ] 未勾选项
- [x] 已勾选项

## 其他

**加粗文本**、*斜体*、\`行内代码\`，以及 💡📎 emoji。

1. 有序列表一
2. 有序列表二
   - 嵌套无序一
   - 嵌套无序二
`;

async function demo() {
  const t0 = Date.now();
  const tmp = path.join(os.tmpdir(), `doc-demo-${shortId()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const pdf = path.join(tmp, "demo.pdf");
  const docx = path.join(tmp, "demo.docx");

  await mdToPdf({ text: SAMPLE_MD, from: "markdown", baseDir: tmp, title: "demo", outputPath: pdf });
  await toDocx({ text: SAMPLE_MD, from: "markdown", baseDir: tmp, title: "demo", outputPath: docx });

  const pdfOk = fs.existsSync(pdf) && fs.statSync(pdf).size > 0;
  const docxOk = fs.existsSync(docx) && fs.statSync(docx).size > 0;
  console.log(`${TAG} demo: pdf=${pdfOk ? "OK" : "FAIL"} docx=${docxOk ? "OK" : "FAIL"} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!pdfOk || !docxOk) throw new Error("demo 自检失败");
  return { pdf, docx };
}

// 真实文件实测（可选：文件存在才跑，不硬依赖 Downloads 路径）
const REAL_FILE = "/Users/zcy/Downloads/TOMBLIBOO尽调问卷.md";

async function demoReal() {
  if (!fs.existsSync(REAL_FILE)) {
    console.log(`${TAG} demoReal: 跳过（文件不存在） ${REAL_FILE}`);
    return null;
  }
  const t0 = Date.now();
  const { text, baseDir, title } = resolveInput({ source: "file", filePath: REAL_FILE });
  const pdf = path.join(os.tmpdir(), `doc-real-${shortId()}.pdf`);
  const docx = path.join(os.tmpdir(), `doc-real-${shortId()}.docx`);
  await mdToPdf({ text, from: "markdown", baseDir, title, outputPath: pdf });
  await toDocx({ text, from: "markdown", baseDir, title, outputPath: docx });
  console.log(`${TAG} demoReal: title="${title}" 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { pdf, docx };
}

async function testEmpty() {
  const tmp = path.join(os.tmpdir(), `doc-empty-${shortId()}`);
  fs.mkdirSync(tmp, { recursive: true });
  let pdfOk = false;
  let docxOk = false;
  try {
    await mdToPdf({ text: "---\n> ", from: "markdown", baseDir: tmp, title: "empty", outputPath: path.join(tmp, "e.pdf") });
  } catch (err) {
    pdfOk = /内容为空/.test(err.message);
    console.log(`${TAG} testEmpty pdf: ${pdfOk ? "OK (正确报错)" : "FAIL (未拦截)"} ${err.message}`);
  }
  try {
    await toDocx({ text: "---\n> ", from: "markdown", baseDir: tmp, title: "empty", outputPath: path.join(tmp, "e.docx") });
  } catch (err) {
    docxOk = /内容为空/.test(err.message);
    console.log(`${TAG} testEmpty docx: ${docxOk ? "OK (正确报错)" : "FAIL (未拦截)"} ${err.message}`);
  }
  if (!pdfOk || !docxOk) throw new Error("testEmpty 失败：校验未生效");
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  demo()
    .then(({ pdf, docx }) => {
      console.log(`${TAG} demo 产物: ${pdf}\n${TAG} demo 产物: ${docx}`);
      return demoReal();
    })
    .then((real) => {
      if (real) console.log(`${TAG} demoReal 产物: ${real.pdf}\n${TAG} demoReal 产物: ${real.docx}`);
      return testEmpty();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`${TAG} 自检失败: ${err.message}`);
      process.exit(1);
    });
}
