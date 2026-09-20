"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookImage, Ruler, Cpu, Film, Sparkles, type LucideIcon } from "lucide-react";

interface Template {
  id: string; label: string; description: string;
  available?: boolean;
  steps: { name: string }[];
}

// 图标 + 卡片点缀色（糖果色只做点缀，卡片保持白底）
const TEMPLATE_ICON: Record<string, LucideIcon> = {
  "comic-generation": BookImage,
  "floorplan-remodel": Ruler,
  "tech-video": Cpu,
  "video-generation": Film,
};
const ACCENT_BG: Record<string, string> = {
  "comic-generation": "bg-pink-soft",
  "floorplan-remodel": "bg-blue-soft",
  "tech-video": "bg-orange-soft",
  "video-generation": "bg-purple-soft",
};
const DEFAULT_ACCENT_BG = "bg-yellow-soft";

export default function WorkflowPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [execCounts, setExecCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/workflows/templates`);
        if (res.ok) setTemplates(((await res.json()).templates || []) as Template[]);
      } catch { /* ignore */ }
      try {
        const res = await fetch(`${BASE}/api/workflows/executions`);
        if (res.ok) {
          const list = await res.json();
          const counts: Record<string, number> = {};
          list.forEach((e: { template: string }) => { counts[e.template] = (counts[e.template] || 0) + 1; });
          setExecCounts(counts);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const availableCount = templates.filter(t => t.available !== false).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">工作流</h2>
          <p className="text-xs text-muted-foreground">选择一种工作流类型开始创作</p>
        </div>
        <div className="flex items-center gap-2">
          {templates.length > 0 && (
            <span className="brutal-chip px-2 py-0.5 text-[11px] bg-lime-soft">
              {availableCount}/{templates.length} 可用
            </span>
          )}
          <button onClick={() => router.push("/")}
            className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground">
            返回聊天
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {templates.map(t => {
            const available = t.available !== false;
            const Icon = TEMPLATE_ICON[t.id] ?? Sparkles;
            const accent = ACCENT_BG[t.id] || DEFAULT_ACCENT_BG;
            return (
              <div key={t.id}
                onClick={() => router.push(`/workflow/type/${t.id}`)}
                className={`brutal-btn bg-card p-4 cursor-pointer flex flex-col gap-2.5 text-left ${
                  available ? "" : "border-dashed"
                }`}
                title={available ? t.description : `${t.description}（暂不可用）`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 shrink-0 border-2 border-border flex items-center justify-center ${
                    available ? accent : "bg-muted text-muted-foreground"
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-black text-foreground truncate">{t.label}</span>
                      <span className={`inline-flex items-center gap-1 shrink-0 text-[11px] font-bold px-1.5 py-0.5 border-2 ${
                        available
                          ? "bg-lime-soft border-lime text-foreground"
                          : "bg-muted border-border text-muted-foreground"
                      }`}>
                        <span className={`w-1.5 h-1.5 ${available ? "bg-lime" : "bg-muted-foreground/60"}`} />
                        {available ? "可用" : "不可用"}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {t.steps.length} 步 · {execCounts[t.id] ?? 0} 条记录
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {t.description}
                </div>
                <div className="mt-auto pt-2 border-t-2 border-muted text-[11px] text-muted-foreground/70 leading-relaxed line-clamp-1">
                  {t.steps.map((s, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-1 text-muted-foreground/40">→</span>}
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}