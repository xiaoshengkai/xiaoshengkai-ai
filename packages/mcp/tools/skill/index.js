import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(SCRIPT_DIR, "../../skills");

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const frontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return frontmatter;
}

function discoverSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error("[loadSkill] SKILLS_DIR not found");
    return [];
  }
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => {
      const skillFile = path.join(SKILLS_DIR, e.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) return null;
      const content = fs.readFileSync(skillFile, "utf-8");
      const meta = parseFrontmatter(content);
      if (!meta?.name || !meta?.description) return null;
      return { name: meta.name, description: meta.description };
    })
    .filter(Boolean);
}

export function register(server) {
  server.tool(
    "loadSkill",
    "加载指定 skill 的完整知识内容。不传 name 时返回所有可用 skill 列表（含名称和简短描述），AI 可根据描述选择合适的 skill 后再次调用并传入 name 加载完整内容。",
    {
      name: z.string().optional().describe("skill 名称，不传则返回可用 skill 列表"),
    },
    async ({ name }) => {
      try {
        if (!name) {
          const skills = discoverSkills();
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, skills }) }] };
        }

        const skillFile = path.join(SKILLS_DIR, name, "SKILL.md");
        if (!fs.existsSync(skillFile)) {
          const available = discoverSkills();
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: `skill "${name}" 不存在`, availableSkills: available }) }],
          };
        }

        const content = fs.readFileSync(skillFile, "utf-8");
        return { content: [{ type: "text", text: content }] };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
      }
    },
  );
}
