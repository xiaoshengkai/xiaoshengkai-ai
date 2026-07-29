"use client";

import { BASE } from "@/lib/api-path";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Play, ChevronRight, ArrowLeft, Trash2, RefreshCw, SkipForward } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ExecutionStep {
  id: string; name: string; type: string; previewType?: string; previewField?: string;
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
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<string | null>(null);
  const [nextLoading, setNextLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);

  const fetchExecution = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}`);
      if (res.ok) {
        const data = await res.json();
        setExecution(data);
        if (!activeStepId) {
          const running = data.steps.find((s: ExecutionStep) => s.status === "running");
          const failed = data.steps.find((s: ExecutionStep) => s.status === "failed");
          const pending = data.steps.find((s: ExecutionStep) => s.status === "pending");
          setActiveStepId(running?.id || failed?.id || pending?.id || data.steps[data.steps.length - 1].id);
        }
      }
    } catch { /* ignore */ }
  }, [id, activeStepId]);

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
      if (data.ok) fetchExecution();
      else toast(`🔴 ${data.error}`);
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

  const handleRetry = useCallback(async (stepId: string) => {
    setRetrying(stepId);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      const data = await res.json();
      if (data.ok) { toast("🟢 已重新执行"); fetchExecution(); }
      else toast(`🔴 ${data.error}`);
    } catch { toast("🔴 请求失败"); }
    setRetrying(null);
  }, [id, fetchExecution]);

  const handleSkip = useCallback(async (stepId: string) => {
    setSkipping(stepId);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/skip`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId }),
      });
      const data = await res.json();
      if (data.ok) { toast("🟢 已跳过"); fetchExecution(); }
      else toast(`🔴 ${data.error}`);
    } catch { toast("🔴 请求失败"); }
    setSkipping(null);
  }, [id, fetchExecution]);

  const handleDelete = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}`, { method: "DELETE" });
      if (res.ok) window.location.href = "/workflow";
      else toast("🔴 删除失败");
    } catch { toast("🔴 请求失败"); }
  }, [id]);

  if (!execution) return null;

  const completed = execution.steps.filter(s => s.status === "completed").length;
  const activeStep = execution.steps.find(s => s.id === activeStepId) || execution.steps[0];
  const isDone = execution.status === "completed" || execution.status === "failed";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 shrink-0">
        <a href="/workflow" className="text-gray-400 hover:text-gray-600"><ArrowLeft className="w-4 h-4" /></a>
        <div className="flex items-center gap-2 flex-1">
          <h2 className="text-sm font-bold text-gray-800">{execution.template}</h2>
          <span className={`text-xs px-2 py-0.5 rounded ${
            execution.status === "completed" ? "bg-green-100 text-green-700" :
            execution.status === "running" ? "bg-yellow-100 text-yellow-700" :
            execution.status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
          }`}>
            {execution.status === "completed" ? "完成" : execution.status === "running" ? "执行中" : execution.status === "failed" ? "失败" : "待执行"}
          </span>
        </div>
        <button onClick={() => setShowDelete(true)}
          className="pixel-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold cursor-pointer"
          style={{ border: "2px solid #1A1A1A", background: "transparent", color: "#FF6B6B", boxShadow: "2px 2px 0 #1A1A1A" }}>
          <Trash2 className="w-3 h-3" />删除
        </button>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[280px_1fr]">
        <div className="overflow-auto border-r border-gray-200 p-3 space-y-1.5">
          {execution.steps.map((step, i) => {
            const isActive = step.id === activeStepId;
            const done = step.status === "completed";
            const fail = step.status === "failed";
            const run = step.status === "running";
            const skipped = step.status === "skipped";
            const pending = step.status === "pending";
            return (
              <div key={step.id}
                onClick={() => setActiveStepId(step.id)}
                className={`p-2 rounded-lg cursor-pointer transition-all ${
                  isActive ? "ring-2 ring-blue-400 bg-blue-50" : "hover:bg-gray-50"
                }`}
                style={{ border: isActive ? "2px solid #60A5FA" : "2px solid transparent" }}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    done ? "bg-green-500 text-white" : run ? "bg-yellow-400 text-white" :
                    fail ? "bg-red-500 text-white" : skipped ? "bg-gray-400 text-white" : "bg-gray-300 text-gray-600"
                  }`}>
                    {done ? "✓" : fail ? "✗" : skipped ? "−" : i + 1}
                  </span>
                  <span className="text-xs font-bold text-gray-700 flex-1 truncate">{step.name}</span>
                  <div className="flex gap-1 shrink-0">
                    {pending && (
                      <button onClick={(e) => { e.stopPropagation(); handleSkip(step.id); }}
                        disabled={skipping === step.id} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                        title="跳过">{skipping === step.id ? "..." : "跳过"}</button>
                    )}
                    {(done || fail) && (
                      <button onClick={(e) => { e.stopPropagation(); handleRetry(step.id); }}
                        disabled={retrying === step.id} className="text-xs text-gray-400 hover:text-blue-500 cursor-pointer"
                        title="重新执行"><RefreshCw className="w-3 h-3" /></button>
                    )}
                  </div>
                </div>
                {fail && step.error && (
                  <p className="text-xs text-red-500 mt-1 truncate ml-7">{step.error}</p>
                )}
              </div>
            );
          })}
          <p className="text-xs text-gray-500 text-center pt-2">{completed}/{execution.steps.length} 步完成</p>
        </div>

        <div className="overflow-auto p-4">
          <PreviewPanel step={activeStep} executionId={execution.executionId} />
        </div>
      </div>

      {!isDone && (
        <div className="flex gap-2 px-4 py-3 border-t border-gray-200 shrink-0">
          <button onClick={handleNext} disabled={nextLoading}
            className="pixel-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid #1A1A1A", background: nextLoading ? "#e2e8f0" : "#5B8DEF", color: nextLoading ? "#94a3b8" : "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
            <ChevronRight className="w-3 h-3" />{nextLoading ? "执行中..." : "下一步"}
          </button>
          <button onClick={handleAuto} disabled={autoLoading}
            className="pixel-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid #1A1A1A", background: autoLoading ? "#e2e8f0" : "#6BCB77", color: autoLoading ? "#94a3b8" : "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
            <Play className="w-3 h-3" />{autoLoading ? "执行中..." : "自动执行"}
          </button>
        </div>
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除这条执行记录吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviewPanel({ step, executionId }: { step: ExecutionStep; executionId: string }) {
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;

  if (step.status === "pending") {
    return <EmptyState icon="⏸️" text="等待执行..." />;
  }
  if (step.status === "running") {
    return <EmptyState icon="🔄" text="正在执行..." animate />;
  }
  if (step.status === "skipped") {
    return <EmptyState icon="⏭️" text="已跳过" />;
  }
  if (step.status === "failed") {
    return (
      <div className="space-y-3">
        <div className="p-3 rounded-lg border-2 border-red-200 bg-red-50"
          style={{ borderColor: "#FCA5A5", boxShadow: "2px 2px 0 #FCA5A5" }}>
          <p className="text-xs font-bold text-red-600 mb-1">错误信息</p>
          <pre className="text-xs text-red-700 whitespace-pre-wrap break-words">{step.error || "未知错误"}</pre>
        </div>
      </div>
    );
  }

  const pt = step.previewType || "text";
  const pf = step.previewField || "output";
  const value = getOutputValue(step.output, pf);
  const fileTypes = ["audio", "video", "iframe"];

  return (
    <div className="space-y-3">
      <div className="pixel-card p-3" style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#fff" }}>
        <h3 className="text-xs font-bold text-gray-800 mb-2">{step.name}</h3>
        <PreviewContent type={pt} value={value} src={fileTypes.includes(pt) ? `${fileBase}/${value}` : undefined} />
      </div>
    </div>
  );
}

function getOutputValue(output: string | null, field: string): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  try {
    const obj = typeof output === "object" ? output : JSON.parse(output);
    if (field === "output") return typeof obj === "string" ? obj : JSON.stringify(obj);
    const val = (obj as Record<string, unknown>)[field];
    if (val) return val as string;
    return (obj as Record<string, unknown>).output as string || JSON.stringify(obj);
  } catch {
    return output;
  }
}

function EmptyState({ icon, text, animate }: { icon: string; text: string; animate?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
      <span className={`text-2xl ${animate ? "animate-pulse" : ""}`}>{icon}</span>
      <p className="text-xs">{text}</p>
    </div>
  );
}

function PreviewContent({ type, value, src }: { type: string; value?: string | null; src?: string }) {
  if (type === "code" || type === "json" || type === "text") {
    if (!value) return <p className="text-xs text-gray-400">暂无输出</p>;
  }
  if (type === "audio" || type === "video" || type === "iframe") {
    if (!src || !value) return <p className="text-xs text-gray-400">文件未生成</p>;
  }

  switch (type) {
    case "code":
      return (
        <pre className="text-xs text-gray-700 bg-gray-50 p-3 rounded border border-gray-200 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono"
          style={{ border: "2px solid #E5E7EB" }}>
          {typeof value === "string" ? (value.length > 5000 ? value.slice(0, 5000) + "\n\n...（内容过长，已截断）" : value) : JSON.stringify(value, null, 2)}
        </pre>
      );

    case "iframe":
      return (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden bg-white" style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
            <iframe src={src} className="w-full h-[50vh] border-0" title="预览" sandbox="allow-scripts allow-same-origin" />
          </div>
          <a href={src} target="_blank" rel="noopener noreferrer"
            className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid #1A1A1A", background: "#6BCB77", color: "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
            新窗口打开
          </a>
        </div>
      );

    case "video":
      return (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden bg-black" style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
            <video controls className="w-full max-h-[50vh]" src={src} playsInline>
              <p className="text-xs text-gray-400 p-3">您的浏览器不支持视频播放</p>
            </video>
          </div>
          <a href={src} target="_blank" rel="noopener noreferrer"
            className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid #1A1A1A", background: "#6BCB77", color: "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
            下载视频
          </a>
        </div>
      );

    case "audio":
      return (
        <div className="rounded-lg p-3 bg-gray-50" style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}>
          <p className="text-xs text-gray-500 mb-2">🎵 音频播放</p>
          <audio controls className="w-full" src={src} preload="metadata">
            <p className="text-xs text-gray-400">您的浏览器不支持音频播放</p>
          </audio>
        </div>
      );

    case "json":
      return (
        <pre className="text-xs text-gray-700 bg-gray-50 p-3 rounded border border-gray-200 max-h-[60vh] overflow-auto font-mono"
          style={{ border: "2px solid #E5E7EB" }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      );

    default:
      return (
        <p className="text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
          {typeof value === "string" ? value : JSON.stringify(value)}
        </p>
      );
  }
}