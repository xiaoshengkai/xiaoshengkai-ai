"use client";

import { useMemo, useEffect, useState, useRef } from "react";
import type { UIMessage } from "ai";
import { calculateCost, formatTokens } from "@/lib/cost";

interface RetrievedChunk {
  content: string;
  source: string;
}

interface RightPanelProps {
  messages: UIMessage[];
  isLoading: boolean;
}

function getLogColor(line: string) {
  if (line.includes("[ERR]")) return { color: "var(--pixel-red)" };
  if (line.includes("[INFO]")) return { color: "var(--pixel-blue)" };
  if (line.includes("[WARN]")) return { color: "var(--pixel-yellow)" };
  return {};
}

export default function RightPanel({ messages, isLoading }: RightPanelProps) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch("/api/logs");
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
    const modelTiers = new Set<string>();
    let classifyTotal = 0;
    let classifyInput = 0;
    let classifyOutput = 0;
    let retrievedChunks: RetrievedChunk[] | null = null;

    for (const msg of messages) {
      const meta = msg.metadata as {
        usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
        modelTier?: string;
        classifyUsage?: { inputTokens: number; outputTokens: number; totalTokens: number };
        retrievedChunks?: RetrievedChunk[];
      } | undefined;

      if (meta?.usage) {
        totalInput += meta.usage.inputTokens ?? 0;
        totalOutput += meta.usage.outputTokens ?? 0;
        totalTokens += meta.usage.totalTokens ?? 0;
        if (meta.modelTier) modelTiers.add(meta.modelTier);
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

    const modelName = modelTiers.has("pro") ? "deepseek-v4-pro" : "deepseek-v4-flash";
    const cost = calculateCost(modelName, totalInput, totalOutput)
      + calculateCost("deepseek-v4-flash", classifyInput, classifyOutput);

    return { totalTokens, cost, modelName, retrievedChunks };
  }, [messages]);

  return (
    <aside className="pixel-panel w-[280px] shrink-0 h-full flex flex-col overflow-hidden border-l-2 border-border">
      <div className="pixel-panel-header">
        状态面板
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 模型 */}
        <div className="pixel-panel-card">
          <div className="pixel-panel-card-header" style={{ background: "var(--pixel-blue)", borderBottomColor: "var(--pixel-blue-dark)" }}>
            模型
          </div>
          <div className="pixel-panel-card-body">
            <p className="text-xs font-[family-name:var(--font-pixel)]">
              {stats.modelName === "deepseek-v4-pro" ? "🚀 DeepSeek V4 Pro" : "⚡ DeepSeek V4 Flash"}
            </p>
          </div>
        </div>

        {/* Token 统计 */}
        <div className="pixel-panel-card">
          <div className="pixel-panel-card-header" style={{ background: "var(--pixel-green)", borderBottomColor: "var(--pixel-green-dark)" }}>
            Token 统计
          </div>
          <div className="pixel-panel-card-body">
            <p className="text-[11px] font-[family-name:var(--font-pixel)] text-foreground/70">
              本轮消耗总 token
            </p>
            <p className="text-xs font-mono">
              {formatTokens(stats.totalTokens)} tokens
            </p>
            <p className="text-[11px] font-[family-name:var(--font-pixel)] text-foreground/70 mt-1">
              本轮消耗金额
            </p>
            <p className="text-xs font-mono">
              ¥{stats.cost.toFixed(4)}
            </p>
          </div>
        </div>

        {/* 检索记忆 */}
        {stats.retrievedChunks && stats.retrievedChunks.length > 0 && (
          <div className="pixel-panel-card">
            <div className="pixel-panel-card-header" style={{ background: "var(--pixel-purple)", borderBottomColor: "var(--pixel-purple-dark)" }}>
              检索记忆 ({stats.retrievedChunks.length})
            </div>
            <div className="pixel-panel-card-body max-h-[220px] overflow-y-auto">
              <div className="space-y-1.5">
                {stats.retrievedChunks.map((chunk, i) => (
                  <div
                    key={i}
                    className="pixel-panel-item text-[11px] font-[family-name:var(--font-pixel)] leading-relaxed"
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
        <div className="pixel-panel-card">
          <div className="pixel-panel-card-header" style={{ background: "var(--pixel-yellow)", borderBottomColor: "var(--pixel-yellow-dark)" }}>
            运行日志 ({logLines.length})
          </div>
          <div className="pixel-panel-card-body max-h-[400px] overflow-y-auto">
            <div className="space-y-0.5">
              {logLines.length === 0 && (
                <p className="text-[11px] font-[family-name:var(--font-pixel)] text-muted-foreground/50">
                  暂无日志
                </p>
              )}
              {logLines.map((line, i) => (
                <div
                  key={i}
                  className="text-[10px] font-[family-name:var(--font-pixel)] leading-relaxed break-all"
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