import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowRight, QrCode, Sparkles, type LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

interface ToolMeta {
  id: string;
  name: string;
  description: string;
  icon?: string;
  accent?: string;
}

const ICONS: Record<string, LucideIcon> = {
  "qr-code": QrCode,
};

const ACCENTS: Record<string, string> = {
  blue: "bg-blue-soft",
  pink: "bg-pink-soft",
  yellow: "bg-yellow-soft",
  lime: "bg-lime-soft",
  orange: "bg-orange-soft",
  purple: "bg-purple-soft",
};

const DEFAULT_ACCENT = "bg-yellow-soft";

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
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">工具</h2>
          <p className="text-xs text-muted-foreground">小工具集合，随取随用</p>
        </div>
        <div className="flex items-center gap-2">
          {tools.length > 0 && (
            <span className="brutal-chip px-2 py-0.5 text-[11px] bg-lime-soft">
              {tools.length} 个工具
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">🧰</span>
            <p className="text-sm">暂无可用工具</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {tools.map((tool) => {
              const Icon = (tool.icon && ICONS[tool.icon]) || Sparkles;
              const accent = (tool.accent && ACCENTS[tool.accent]) || DEFAULT_ACCENT;
              return (
                <Link
                  key={tool.id}
                  href={`/tools/${tool.id}`}
                  className="brutal-btn bg-card p-4 cursor-pointer flex flex-col gap-2.5 text-left"
                  title={tool.description}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 shrink-0 border-2 border-border flex items-center justify-center ${accent}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-black text-foreground truncate">{tool.name}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {tool.description}
                  </div>
                  <div className="mt-auto pt-2 border-t-2 border-muted inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground/70">
                    打开 <ArrowRight className="w-3 h-3" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
