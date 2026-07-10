import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "../../..");

function rp(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
}

export function register(server) {
  server.tool(
    "readFile",
    "读取文件内容，返回完整文本（可能很长）。建议每次只读取 1-2 个关键文件，不要一次性读取所有文件。",
    {
      filePath: z.string().describe("要读取的文件路径"),
    },
    async ({ filePath }) => {
      try {
        const fp = rp(filePath);
        console.error(`[file:readFile] ${fp}`);
        const content = await fs.readFile(fp, "utf-8");
        return {
          content: [{ type: "text", text: `文件路径: ${fp}\n文件大小: ${content.length} 字符\n--- 内容开始 ---\n${content}\n--- 内容结束 ---` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `读取文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "readDirectory",
    "读取目录内容，返回当前目录下的文件和子目录列表。建议先了解顶层结构，再选择性地深入子目录，避免逐层遍历所有目录。",
    {
      dirPath: z.string().describe("要读取的目录路径"),
      depth: z.number().optional().describe("遍历深度，默认 1。设为 2 可同时返回子目录的第一层内容"),
    },
    async ({ dirPath, depth = 1 }) => {
      try {
        const dp = rp(dirPath);
        async function readDirWithDepth(dir, depth) {
          if (depth <= 0) return [];
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const results = [];
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results.push(fullPath + "/");
              if (depth > 1) {
                const children = await readDirWithDepth(fullPath, depth - 1);
                results.push(...children.map(c => "  " + c));
              }
            } else {
              results.push(fullPath);
            }
          }
          return results;
        }
        const files = await readDirWithDepth(dp, depth);
        return {
          content: [{ type: "text", text: `目录路径: ${dp}\n共 ${files.length} 个条目\n---\n${files.join("\n")}` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `读取目录失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "getFileInfo",
    "获取文件或目录的元数据（大小、类型、修改时间、权限）。",
    {
      filePath: z.string().describe("文件或目录路径"),
    },
    async ({ filePath }) => {
      try {
        const fp = rp(filePath);
        const stat = await fs.stat(fp);
        const type = stat.isDirectory() ? "目录" : stat.isFile() ? "文件" : "其他";
        return {
          content: [{ type: "text", text: [
            `路径: ${fp}`,
            `类型: ${type}`,
            `大小: ${stat.size} 字节`,
            `创建时间: ${stat.birthtime.toISOString()}`,
            `修改时间: ${stat.mtime.toISOString()}`,
            `权限: ${stat.mode.toString(8).slice(-3)}`,
          ].join("\n") }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `获取文件信息失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "searchFiles",
    "在目录中按名称模式搜索文件，支持通配符（如 *.java、test*.ts）。",
    {
      dirPath: z.string().describe("搜索的根目录路径"),
      pattern: z.string().describe("文件名匹配模式，支持通配符，如 *.java、test*.ts"),
      recursive: z.boolean().optional().describe("是否递归搜索子目录，默认 false"),
    },
    async ({ dirPath, pattern, recursive = false }) => {
      try {
        const dp = rp(dirPath);
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        const results = [];
        async function search(dir) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && recursive) {
              await search(fullPath);
            } else if (entry.isFile() && regex.test(entry.name)) {
              results.push(fullPath);
            }
          }
        }
        await search(dp);
        return {
          content: [{ type: "text", text: results.length > 0
            ? `搜索模式: ${pattern}\n递归: ${recursive}\n共 ${results.length} 个匹配文件\n---\n${results.join("\n")}`
            : `未找到匹配 "${pattern}" 的文件` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `搜索文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "writeFile",
    "创建新文件或覆盖已有文件。会自动创建不存在的父目录。注意：此操作会覆盖已有内容。",
    {
      filePath: z.string().describe("要写入的文件路径"),
      content: z.string().describe("要写入的文件内容"),
    },
    async ({ filePath, content }) => {
      try {
        const fp = rp(filePath);
        console.error(`[file:writeFile] ${fp} size=${content.length}`);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, content, "utf-8");
        return { content: [{ type: "text", text: `文件已写入: ${fp}\n写入大小: ${content.length} 字符` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `写入文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "appendFile",
    "追加内容到文件末尾。如果文件不存在会自动创建。",
    {
      filePath: z.string().describe("要追加的文件路径"),
      content: z.string().describe("要追加的内容"),
    },
    async ({ filePath, content }) => {
      try {
        const fp = rp(filePath);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.appendFile(fp, content, "utf-8");
        const stat = await fs.stat(fp);
        return { content: [{ type: "text", text: `内容已追加到: ${fp}\n追加大小: ${content.length} 字符\n文件总大小: ${stat.size} 字节` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `追加文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "replaceInFile",
    "在文件中查找并替换文本。只替换第一个匹配项，建议用于精确的代码修改。",
    {
      filePath: z.string().describe("要修改的文件路径"),
      oldStr: z.string().describe("要替换的原始文本，必须精确匹配"),
      newStr: z.string().describe("替换后的新文本"),
    },
    async ({ filePath, oldStr, newStr }) => {
      try {
        const fp = rp(filePath);
        const content = await fs.readFile(fp, "utf-8");
        if (!content.includes(oldStr)) {
          return { content: [{ type: "text", text: `替换失败：文件中未找到指定文本\n文件: ${fp}` }] };
        }
        const updated = content.replace(oldStr, newStr);
        await fs.writeFile(fp, updated, "utf-8");
        return { content: [{ type: "text", text: `替换成功: ${fp}\n替换前大小: ${content.length} 字符\n替换后大小: ${updated.length} 字符` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `替换文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "createDirectory",
    "创建目录。默认不递归，设置 recursive=true 可创建多级目录。",
    {
      dirPath: z.string().describe("要创建的目录路径"),
      recursive: z.boolean().optional().describe("是否递归创建父目录，默认 false"),
    },
    async ({ dirPath, recursive = false }) => {
      try {
        const dp = rp(dirPath);
        await fs.mkdir(dp, { recursive });
        return { content: [{ type: "text", text: `目录已创建: ${dp}${recursive ? " (递归)" : ""}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `创建目录失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "deleteFile",
    "删除文件。注意：此操作不可逆，请确认后再调用。",
    {
      filePath: z.string().describe("要删除的文件路径"),
    },
    async ({ filePath }) => {
      try {
        const fp = rp(filePath);
        console.error(`[file:deleteFile] ${fp}`);
        await fs.unlink(fp);
        return { content: [{ type: "text", text: `文件已删除: ${fp}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `删除文件失败：${error.message}` }] };
      }
    },
  );

  server.tool(
    "moveFile",
    "移动或重命名文件/目录。",
    {
      sourcePath: z.string().describe("源文件或目录路径"),
      targetPath: z.string().describe("目标路径"),
    },
    async ({ sourcePath, targetPath }) => {
      try {
        const sp = rp(sourcePath);
        const tp = rp(targetPath);
        console.error(`[file:moveFile] ${sp} → ${tp}`);
        await fs.mkdir(path.dirname(tp), { recursive: true });
        await fs.rename(sp, tp);
        return { content: [{ type: "text", text: `已移动: ${sp} → ${tp}` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `移动失败：${error.message}` }] };
      }
    },
  );
}