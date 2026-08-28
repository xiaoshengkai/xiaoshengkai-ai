"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Template {
  id: string; label: string; description: string;
  steps: { name: string }[];
}

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">工作流</h2>
          <p className="text-xs text-muted-foreground">选择一种工作流类型开始创作</p>
        </div>
        <button onClick={() => router.push("/")}
          className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground">
          返回聊天
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {templates.map(t => (
            <div key={t.id}
              onClick={() => router.push(`/workflow/type/${t.id}`)}
              className="brutal-btn bg-card p-4 cursor-pointer flex flex-col gap-2 text-left"
              title={t.description}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground truncate">{t.label}</span>
                <span className="inline-block text-xs px-1.5 py-0.5 bg-muted text-muted-foreground shrink-0">
                  {t.steps.length} 步
                </span>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{t.description}</div>
              <div className="text-[11px] text-muted-foreground/80 leading-relaxed line-clamp-2">
                {t.steps.map((s, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-muted-foreground/40">→</span>}
                    {s.name}
                  </span>
                ))}
              </div>
              <div className="text-xs text-foreground/50 mt-auto">
                {execCounts[t.id] ?? 0} 条记录
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
