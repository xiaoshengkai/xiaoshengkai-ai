"use client";

import { BASE } from "@/lib/api-path";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Play, ChevronRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface ExecutionStep {
  id: string; name: string; type: string;
  status: string; output: string | null; error: string | null;
}

interface Execution {
  executionId: string; template: string; status: string;
  startedAt: string; completedAt: string | null;
  steps: ExecutionStep[];
}

export default function ExecutionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [execution, setExecution] = useState<Execution | null>(null);
  const [nextLoading, setNextLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);

  const fetchExecution = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}`);
      if (res.ok) setExecution(await res.json());
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    fetchExecution();
    const timer = setInterval(fetchExecution, 2000);
    return () => clearInterval(timer);
  }, [fetchExecution]);

  const handleNext = useCallback(async () => {
    setNextLoading(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/next`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        fetchExecution();
      } else {
        toast(`🔴 ${data.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setNextLoading(false);
  }, [id, fetchExecution]);

  const handleAuto = useCallback(async () => {
    setAutoLoading(true);
    try {
      await fetch(`${BASE}/api/workflows/execution/${id}/auto`, { method: "POST" });
      toast("🟢 自动执行已启动");
    } catch { toast("🔴 请求失败"); }
    setAutoLoading(false);
  }, [id]);

  if (!execution) return null;

  const isRunning = execution.status === "running";
  const isDone = execution.status === "completed" || execution.status === "failed";
  const hasPending = execution.steps.some(s => s.status === "pending");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
        <a href="/workflow" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-4 h-4" />
        </a>
        <h2 className="text-lg font-bold text-gray-800 flex-1">{execution.template}</h2>
        <span className={`text-xs px-2 py-0.5 rounded ${
          execution.status === "completed" ? "bg-green-100 text-green-700" :
          execution.status === "running" ? "bg-yellow-100 text-yellow-700 animate-pulse" :
          execution.status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
        }`}>
          {execution.status === "completed" ? "完成" :
           execution.status === "running" ? "执行中" :
           execution.status === "failed" ? "失败" : "待执行"}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {execution.steps.map((step, i) => (
            <div key={step.id}
              className="p-3 rounded-lg"
              style={{
                border: "2px solid #1A1A1A",
                boxShadow: "2px 2px 0 #1A1A1A",
                background: step.status === "completed" ? "#f0fdf4" :
                  step.status === "running" ? "#fefce8" :
                  step.status === "failed" ? "#fef2f2" : "#fff",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">{i + 1}.</span>
                <span className="text-xs font-bold text-gray-700 flex-1">{step.name}</span>
                <span className={`inline-block w-2 h-2 rounded-full ${
                  step.status === "completed" ? "bg-green-400" :
                  step.status === "running" ? "bg-yellow-400 animate-pulse" :
                  step.status === "failed" ? "bg-red-400" : "bg-gray-300"
                }`} />
                <span className="text-xs text-gray-400">{step.status}</span>
              </div>
              {step.output && step.status === "completed" && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">查看输出</summary>
                  <pre className="text-xs text-gray-600 mt-1 p-2 bg-gray-100 rounded overflow-auto max-h-48">
                    {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
                  </pre>
                </details>
              )}
              {step.error && (
                <p className="text-xs text-red-500 mt-1">{step.error}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {!isDone && (
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={handleNext} disabled={nextLoading || !hasPending}
            className="pixel-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{
              border: "2px solid #1A1A1A",
              background: nextLoading || !hasPending ? "#e2e8f0" : "#5B8DEF",
              color: nextLoading || !hasPending ? "#94a3b8" : "#fff",
              boxShadow: "2px 2px 0 #1A1A1A",
            }}
          >
            <ChevronRight className="w-3 h-3" />
            {nextLoading ? "执行中..." : "下一步"}
          </button>
          <button onClick={handleAuto} disabled={autoLoading || !hasPending}
            className="pixel-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{
              border: "2px solid #1A1A1A",
              background: autoLoading || !hasPending ? "#e2e8f0" : "#6BCB77",
              color: autoLoading || !hasPending ? "#94a3b8" : "#fff",
              boxShadow: "2px 2px 0 #1A1A1A",
            }}
          >
            <Play className="w-3 h-3" />
            {autoLoading ? "执行中..." : "自动执行"}
          </button>
        </div>
      )}
    </div>
  );
}