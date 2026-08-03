"use client";

import { BASE } from "@/lib/api-path";
import { useEffect, useState, useCallback } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Template {
  id: string; label: string; description: string;
  params: { name: string; label: string; type: string; required?: boolean; default?: string; options?: string[]; placeholder?: string }[];
  steps: { name: string }[];
}

interface Execution {
  executionId: string; title: string; template: string; templateLabel: string; status: string;
  totalSteps: number; completedSteps: number; startedAt: string; completedAt: string | null;
  failedStep: string | null; failedError: string | null;
}

export default function WorkflowPage() {
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);

  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/executions`);
      if (res.ok) setExecutions(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/templates`);
      if (res.ok) setTemplates((await res.json()).templates);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchExecutions(); fetchTemplates();
    const timer = setInterval(fetchExecutions, 5000);
    return () => clearInterval(timer);
  }, [fetchExecutions, fetchTemplates]);

  const handleCreate = useCallback(async () => {
    if (!selectedTemplate) return;
    setExecuting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTemplate.id, params: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setShowCreate(false);
        toast("🟢 工作流已创建");
        window.location.href = `/workflow/execution/${data.executionId}`;
      } else {
        toast(`🔴 ${data.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setExecuting(false);
  }, [selectedTemplate, formValues]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${deleteTarget}`, { method: "DELETE" });
      if (res.ok) {
        toast("🟢 已删除");
        fetchExecutions();
      } else {
        toast("🔴 删除失败");
      }
    } catch { toast("🔴 请求失败"); }
    setDeleteTarget(null);
  }, [deleteTarget, fetchExecutions]);

  const openCreate = useCallback(() => {
    setShowCreate(true);
    setSelectedTemplate(null);
    setFormValues({});
  }, []);

  const selectTemplate = useCallback((t: Template) => {
    setSelectedTemplate(t);
    const defaults: Record<string, string> = {};
    t.params.forEach(p => { if (p.default !== undefined) defaults[p.name] = String(p.default); });
    setFormValues(defaults);
  }, []);

  const handleAiGenerate = useCallback(async () => {
    const title = formValues["title"];
    if (!title) { toast("请先填视频标题"); return; }
    setAiGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/generate-content`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (data.content) {
        setFormValues({ ...formValues, content: data.content });
        toast("🟢 内容已生成");
      } else {
        toast(`🔴 ${data.error || "生成失败"}`);
      }
    } catch { toast("🔴 请求失败"); }
    setAiGenerating(false);
  }, [formValues]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  };

  const statusPriority: Record<string, number> = { failed: 0, running: 1, pending: 2, completed: 3 };
  const sortedExecutions = [...executions].sort((a, b) => {
    const pa = statusPriority[a.status] ?? 99;
    const pb = statusPriority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">⚙️ 工作流</h2>
        <button onClick={openCreate}
          className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
          style={{ border: "2px solid #1A1A1A", background: "#6BCB77", color: "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
          <Plus className="w-3 h-3" />新建工作流
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-3xl">⚡</span>
            <p className="text-sm">暂无执行记录</p>
            <p className="text-xs text-gray-300">点击「新建工作流」开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sortedExecutions.map(exe => {
              const statusBar = exe.status === "failed" ? "#f87171"
                : exe.status === "running" ? "#fbbf24"
                : exe.status === "completed" ? "#4ade80" : "#9ca3af";
              const pct = Math.round((exe.completedSteps / exe.totalSteps) * 100);
              return (
                <div key={exe.executionId}
                  className="pixel-card bg-white rounded-lg p-3 cursor-pointer transition-transform hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_#1A1A1A]"
                  style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}
                  onClick={() => { window.location.href = `/workflow/execution/${exe.executionId}`; }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      exe.status === "completed" ? "bg-green-500" :
                      exe.status === "running" ? "bg-yellow-400 animate-pulse" :
                      exe.status === "failed" ? "bg-red-500" : "bg-gray-400"
                    }`} />
                    <span className="text-sm font-bold text-gray-800 truncate flex-1">
                      {exe.title || exe.templateLabel}
                    </span>
                    <span className={`inline-block text-xs px-1.5 py-0.5 rounded shrink-0 ${
                      exe.status === "failed" ? "bg-red-100 text-red-700" :
                      exe.status === "running" ? "bg-yellow-100 text-yellow-700" :
                      exe.status === "completed" ? "bg-green-100 text-green-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {exe.status === "completed" ? "✅ 完成" :
                       exe.status === "running" ? "🔄 执行中" :
                       exe.status === "failed" ? "❌ 失败" : "⏸️ 待执行"}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(exe.executionId); }}
                      className="text-xs text-gray-400 hover:text-red-500 cursor-pointer shrink-0">
                      删除
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mb-1">工作流名称: {exe.templateLabel}</p>
                  <p className="text-xs text-gray-500 mb-1">开始: {formatDate(exe.startedAt)}</p>
                  {exe.completedAt && (
                    <p className="text-xs text-gray-500 mb-1">完成: {formatDate(exe.completedAt)}</p>
                  )}
                  {exe.failedStep && (
                    <p className="text-xs text-red-500 mb-1 truncate" title={`${exe.failedStep}: ${exe.failedError}`}>
                      <span className="font-medium">{exe.failedStep}</span>: {exe.failedError}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-1 bg-gray-200 rounded overflow-hidden">
                      <div className="h-full rounded transition-all" style={{ width: `${pct}%`, background: statusBar }} />
                    </div>
                    <span className="text-xs text-gray-600 font-medium">{exe.completedSteps}/{exe.totalSteps}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-lg p-6 w-[480px] max-h-[80vh] overflow-auto"
            style={{ border: "3px solid #1A1A1A", boxShadow: "6px 6px 0 #1A1A1A" }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-800 mb-4">新建工作流</h3>
            {!selectedTemplate ? (
              <div className="grid grid-cols-1 gap-2">
                {templates.map(t => (
                  <div key={t.id} onClick={() => selectTemplate(t)}
                    className="p-3 rounded border-2 border-gray-200 cursor-pointer transition-all hover:border-blue-400 hover:shadow-sm"
                    title={t.description}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-gray-800">{t.label}</span>
                      <span className="text-xs text-gray-400">{t.steps.length} 步</span>
                    </div>
                    <div className="text-xs text-gray-500">{t.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-bold text-gray-800 mb-2">{selectedTemplate.label}</div>
                {selectedTemplate.params.map(p => (
                  <div key={p.name}>
                    <label className="text-xs text-gray-500 block mb-1">
                      {p.label} {p.required && <span className="text-red-400">*</span>}
                    </label>
                    {p.type === "select" ? (
                      <select value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded bg-white">
                        {p.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : p.type === "textarea" ? (
                      <div>
                        {p.name === "content" && (
                          <div className="flex gap-2">
                            <textarea
                              value={formValues[p.name] || ""}
                              onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                              placeholder={p.placeholder || ""}
                              rows={4}
                              className="flex-1 px-2 py-1 text-xs border-2 border-gray-300 rounded resize-none"
                            />
                            <button
                              onClick={handleAiGenerate}
                              disabled={aiGenerating}
                              className="pixel-btn shrink-0 px-2 py-1 text-xs font-bold cursor-pointer self-start"
                              style={{ border: "2px solid #1A1A1A", background: aiGenerating ? "#e2e8f0" : "#5B8DEF", color: aiGenerating ? "#94a3b8" : "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}
                            >
                              {aiGenerating ? "生成中..." : "✨ AI 智能生成"}
                            </button>
                          </div>
                        )}
                        {p.name !== "content" && (
                          <textarea
                            value={formValues[p.name] || ""}
                            onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                            placeholder={p.placeholder || ""}
                            rows={4}
                            className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded resize-none"
                          />
                        )}
                      </div>
                    ) : (
                      <input type={p.type === "number" ? "number" : "text"}
                        value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        placeholder={p.placeholder || ""}
                        className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded" />
                    )}
                  </div>
                ))}
                <div className="flex gap-2 mt-4 justify-end">
                  <button onClick={() => setShowCreate(false)} className="pixel-btn px-3 py-1 text-xs font-bold cursor-pointer"
                    style={{ border: "2px solid #1A1A1A", background: "transparent", color: "#1A1A1A", boxShadow: "2px 2px 0 #1A1A1A" }}>
                    取消
                  </button>
                  <button onClick={handleCreate} disabled={executing}
                    className="pixel-btn px-3 py-1 text-xs font-bold cursor-pointer"
                    style={{ border: "2px solid #1A1A1A", background: executing ? "#e2e8f0" : "#5B8DEF", color: executing ? "#94a3b8" : "#fff", boxShadow: "2px 2px 0 #1A1A1A" }}>
                    <Play className="w-3 h-3 inline mr-1" />{executing ? "创建中..." : "执行"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>确定要删除这条执行记录吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}