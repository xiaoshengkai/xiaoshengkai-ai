import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface ToolMeta {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

function loadTools(): ToolMeta[] {
  const dir = path.resolve(process.cwd(), "..", "tools");
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const tools: ToolMeta[] = [];
  for (const name of entries) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name, "tool.json"), "utf-8"));
      if (meta && meta.id && meta.name) tools.push(meta);
    } catch {
      /* 跳过无 tool.json 的目录 */
    }
  }
  return tools;
}

export default function ToolsPage() {
  const tools = loadTools();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <h2 className="text-lg font-bold text-foreground font-heading">工具</h2>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">🧰</span>
            <p className="text-sm">暂无可用工具</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tools.map((tool) => (
              <Link
                key={tool.id}
                href={`/tools/${tool.id}`}
                className="brutal bg-card p-4 group hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{tool.emoji}</span>
                  <span className="text-sm font-bold text-foreground">{tool.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{tool.description}</p>
                <span className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground group-hover:text-foreground">
                  打开 <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
