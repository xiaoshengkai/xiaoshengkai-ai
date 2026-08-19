"use client";

import { BASE } from "@/lib/utils/utils";
import { useMemo, useEffect, useState, useRef } from "react";
import type { UIMessage } from "ai";
import { calculateCost, formatTokens } from "@/lib/utils/cost";

interface RetrievedChunk {
  content: string;
  source: string;
}

interface Providers {
  [key: string]: {
    enabled: boolean;
    baseURL: string;
    anthropicBaseURL?: string;
    models: Record<string, string>;
  };
}

interface Selection {
  [module: string]: { provider: string; model: string };
}

const MODULE_LABELS: Record<string, string> = {
  chat: "💬 聊天",
  media: "🖼️ 图片",
  vector: "📊 向量",
  workflow: "🔧 工作流",
};

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "智谱",
};

function getLogColor(line: string) {
  if (line.includes("[ERR]")) return { color: "var(--destructive)" };
  if (line.includes("[INFO]")) return { color: "var(--blue)" };
  if (line.includes("[WARN]")) return { color: "var(--orange)" };
  return {};
}

export default function RightPanel({ messages, isLoading }: { messages: UIMessage[]; isLoading: boolean }) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const [settings, setSettings] = useState<{ providers: Providers; selection: Selection } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings/providers`).then((r) => r.json()),
      fetch(`${BASE}/api/settings/selection`).then((r) => r.json()),
    ]).then(([p, s]) => {
      setSettings({ providers: p, selection: s });
    });
  }, []);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${BASE}/api/logs`);
        if (res.ok) {
          const data = await res.json();
          setLogLines(data.lines);
        }
      } catch { /* ignore */ }
    };
    fetchLogs();
    timerRef.current = setInterval(fetchLogs, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const stats = useMemo(() => {
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let classifyTotal = 0;
    let classifyInput = 0;
    let classifyOutput = 0;
    let retrievedChunks: RetrievedChunk[] | null = null;
    let displayModel = "";

    for (const msg of messages) {
      const meta = msg.metadata as {
        usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
        provider?: string;
        model?: string;
        classifyUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
        retrievedChunks?: RetrievedChunk[];
      } | undefined;

      if (meta?.usage) {
        totalInput += meta.usage.inputTokens ?? 0;
        totalOutput += meta.usage.outputTokens ?? 0;
        totalTokens += meta.usage.totalTokens ?? 0;
        if (!displayModel && meta.model) displayModel = meta.model;
      }
      if (meta?.classifyUsage) {
        classifyInput += meta.classifyUsage.inputTokens ?? 0;
        classifyOutput += meta.classifyUsage.outputTokens ?? 0;
        classifyTotal += meta.classifyUsage.totalTokens ?? 0;
      }
      if (meta?.retrievedChunks && !retrievedChunks) {
        retrievedChunks = meta.retrievedChunks;
      }
    }

    const modelName = displayModel || "deepseek-v4-pro";
    const cost = calculateCost(modelName, totalInput, totalOutput)
      + calculateCost("deepseek-v4-flash", classifyInput, classifyOutput);

    return { totalTokens, cost, modelName, retrievedChunks };
  }, [messages]);

  return (
    <aside className="w-[280px] shrink-0 h-full flex flex-col overflow-hidden border-l-[3px] border-border bg-card">
      <div className="px-3 py-2 text-sm font-bold font-mono text-white bg-ink border-b-[3px] border-border">
        状态面板
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 模型 */}
        <div className="brutal bg-card overflow-hidden">
          <div className="px-2.5 py-1.5 text-[11px] font-bold font-mono text-foreground bg-blue border-b-[3px] border-border">
            模型
          </div>
          <div className="p-2.5">
            {settings ? (
              <div className="space-y-1.5">
                {Object.entries(MODULE_LABELS).map(([mod, label]) => {
                  const sel = settings.selection[mod];
                  if (!sel) return null;
                  const pLabel = PROVIDER_LABELS[sel.provider] || sel.provider;
                  return (
                    <div key={mod} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-bold text-foreground">{pLabel}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] font-mono text-muted-foreground">
                {stats.modelName === "MiniMax-M3" ? "🎨 MiniMax M3" : "🚀 DeepSeek"}
              </p>
            )}
          </div>
        </div>

        {/* Token 统计 */}
        <div className="brutal bg-card overflow-hidden">
          <div className="px-2.5 py-1.5 text-[11px] font-bold font-mono text-white bg-lime border-b-[3px] border-border">
            Token 统计
          </div>
          <div className="p-2.5">
            <p className="text-[11px] font-mono text-foreground/70">
              本轮消耗总 token
            </p>
            <p className="text-xs font-mono">
              {formatTokens(stats.totalTokens)} tokens
            </p>
            <p className="text-[11px] font-mono text-foreground/70 mt-1">
              本轮消耗金额
            </p>
            <p className="text-xs font-mono">
              ¥{stats.cost.toFixed(4)}
            </p>
          </div>
        </div>

        {/* 检索记忆 */}
        {stats.retrievedChunks && stats.retrievedChunks.length > 0 && (
          <div className="brutal bg-card overflow-hidden">
            <div className="px-2.5 py-1.5 text-[11px] font-bold font-mono text-white bg-purple border-b-[3px] border-border">
              检索记忆 ({stats.retrievedChunks.length})
            </div>
            <div className="p-2.5 max-h-[220px] overflow-y-auto">
              <div className="space-y-1.5">
                {stats.retrievedChunks.map((chunk, i) => (
                  <div
                    key={i}
                    className="p-1.5 border-2 border-border bg-muted text-[11px] font-mono leading-relaxed"
                  >
                    <p className="line-clamp-3">{chunk.content}</p>
                    {chunk.source && (
                      <p className="text-muted-foreground/50 mt-0.5 text-[10px]">
                        {chunk.source}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 运行日志 */}
        <div className="brutal bg-card overflow-hidden">
          <div className="px-2.5 py-1.5 text-[11px] font-bold font-mono text-foreground bg-yellow border-b-[3px] border-border">
            运行日志 ({logLines.length})
          </div>
          <div className="p-2.5 max-h-[370px] overflow-y-auto">
            <div className="space-y-0.5">
              {logLines.length === 0 && (
                <p className="text-[11px] font-mono text-muted-foreground/50">
                  暂无日志
                </p>
              )}
              {logLines.map((line, i) => (
                <div
                  key={i}
                  className="text-[10px] font-mono leading-relaxed break-all"
                  style={getLogColor(line)}
                >
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}