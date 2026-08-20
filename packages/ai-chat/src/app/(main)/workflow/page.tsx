"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const router = useRouter();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [bgmUploading, setBgmUploading] = useState(false);

  const formValuesRef = useRef(formValues);
  useEffect(() => { formValuesRef.current = formValues; }, [formValues]);

  const handleBgmUpload = useCallback(async (file: File) => {
    setBgmUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/workflows/upload`, {
        method: "POST", body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setFormValues({ ...formValues, bgm_file: data.tempPath });
        toast("🟢 BGM 已上传");
      } else {
        toast(`🔴 ${data.error || "上传失败"}`);
      }
    } catch { toast("🔴 上传失败"); }
    setBgmUploading(false);
  }, [formValues]);

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

  const hasRunning = executions.some((e) => e.status === "running");

  useEffect(() => {
    fetchExecutions(); fetchTemplates();
    // ponytail: 无 running 执行时不轮询，状态变化由用户操作触发 fetch
    if (!hasRunning) return;
    const timer = setInterval(fetchExecutions, 5000);
    return () => clearInterval(timer);
  }, [fetchExecutions, fetchTemplates, hasRunning]);

  const handleCreate = useCallback(async () => {
    if (!selectedTemplate) return;
    setExecuting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTemplate.id, params: formValuesRef.current }),
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
  }, [selectedTemplate]);

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
    const title = formValuesRef.current["title"];
    const requirement = formValuesRef.current["contentRequirement"] || "";
    if (!title) { toast("请先填视频标题"); return; }
    setAiGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/generate-content`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, requirement }),
      });
      const data = await res.json();
      if (data.content) {
        setFormValues({ ...formValuesRef.current, content: data.content });
        toast("🟢 内容已生成");
      } else {
        toast(`🔴 ${data.error || "生成失败"}`);
      }
    } catch { toast("🔴 请求失败"); }
    setAiGenerating(false);
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  };

  const statusPriority: Record<string, number> = { failed: 0, running: 1, completed_with_warnings: 1.5, pending: 2, completed: 3 };
  const sortedExecutions = [...executions].sort((a, b) => {
    const pa = statusPriority[a.status] ?? 99;
    const pb = statusPriority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-border">
        <h2 className="text-lg font-bold text-foreground font-heading">工作流</h2>
        <div className="flex gap-2">
          <button onClick={() => router.push("/")}
            className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground">
            返回聊天
          </button>
          <button onClick={openCreate}
            className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-primary text-primary-foreground">
            <Plus className="w-3 h-3" />新建工作流
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">⚡</span>
            <p className="text-sm">暂无执行记录</p>
            <p className="text-xs text-muted-foreground/60">点击「新建工作流」开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sortedExecutions.map(exe => {
              const statusBar = exe.status === "failed" ? "var(--destructive)"
                : exe.status === "running" ? "var(--yellow)"
                : exe.status === "completed_with_warnings" ? "var(--yellow)"
                : exe.status === "completed" ? "var(--blue)" : "var(--muted-foreground)";
              const pct = Math.round((exe.completedSteps / exe.totalSteps) * 100);
              return (
                <div key={exe.executionId}
                  className="brutal-btn bg-card p-3 cursor-pointer"
                  onClick={() => { window.location.href = `/workflow/execution/${exe.executionId}`; }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      exe.status === "completed" ? "bg-lime" :
                      exe.status === "completed_with_warnings" ? "bg-yellow" :
                      exe.status === "running" ? "bg-yellow animate-pulse" :
                      exe.status === "failed" ? "bg-destructive" : "bg-muted-foreground"
                    }`} />
                    <span className="text-sm font-bold text-foreground truncate">
                      {exe.title || exe.templateLabel}
                    </span>
                    <span className={`inline-block text-xs px-1.5 py-0.5 shrink-0 ${
                      exe.status === "failed" ? "bg-destructive text-white" :
                      exe.status === "running" ? "bg-yellow text-foreground" :
                      exe.status === "completed_with_warnings" ? "bg-yellow text-foreground" :
                      exe.status === "completed" ? "text-foreground" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {exe.status === "completed" ? "✅ 完成" :
                       exe.status === "completed_with_warnings" ? "⚠️ 完成(有警告)" :
                       exe.status === "running" ? "🔄 执行中" :
                       exe.status === "failed" ? "❌ 失败" : "⏸️ 待执行"}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(exe.executionId); }}
                      className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold cursor-pointer shrink-0">
                      删除
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mb-1">工作流名称: {exe.templateLabel}</p>
                  <p className="text-xs text-muted-foreground mb-1">开始: {formatDate(exe.startedAt)}</p>
                  {exe.completedAt && (
                    <p className="text-xs text-muted-foreground mb-1">完成: {formatDate(exe.completedAt)}</p>
                  )}
                  {exe.failedStep && (
                    <p className="text-xs text-destructive mb-1 truncate" title={`${exe.failedStep}: ${exe.failedError}`}>
                      <span className="font-medium">{exe.failedStep}</span>: {exe.failedError}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex-1 h-2 border-2 border-border bg-muted overflow-hidden">
                      <div className="h-full transition-all" style={{ width: `${pct}%`, background: statusBar }} />
                    </div>
                    <span className="text-xs text-muted-foreground font-medium">{exe.completedSteps}/{exe.totalSteps}</span>
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
          <div className="brutal bg-card p-6 w-[480px] max-h-[80vh] overflow-auto"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-4">新建工作流</h3>
            {!selectedTemplate ? (
              <div className="grid grid-cols-1 gap-2">
                {templates.map(t => (
                  <div key={t.id} onClick={() => selectTemplate(t)}
                    className="p-3 border-2 border-border cursor-pointer hover:bg-muted"
                    title={t.description}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-foreground">{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.steps.length} 步</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-bold text-foreground mb-2">{selectedTemplate.label}</div>
                {selectedTemplate.params.filter(p => {
                    if (p.name === "voice_id" && formValues["enable_tts"] === "no") return false;
                    if (p.name === "bgm_volume" && formValues["enable_bgm"] === "no") return false;
                    if (p.name === "bgm_file" && formValues["enable_bgm"] === "no") return false;
                    return true;
                  }).map(p => (
                  <div key={p.name}>
                    <label className="text-xs text-muted-foreground block mb-1">
                      {p.label} {p.required && <span className="text-destructive">*</span>}
                    </label>
                    {p.type === "select" ? (
                      <select value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        className="w-full px-2 py-1 text-xs border-2 border-border bg-card">
                        {p.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : p.name === "bgm_file" ? (
                      <div className="flex gap-2 items-center">
                        <input type="text" value={formValues[p.name] || ""} readOnly
                          placeholder="未选择文件"
                          className="flex-1 px-2 py-1 text-xs border-2 border-border bg-muted" />
                        <label
                          className={`brutal-btn shrink-0 px-2 py-1 text-xs font-bold ${bgmUploading ? "bg-muted text-muted-foreground" : "bg-orange text-white"}`}
                        >
                          <Upload className="w-3 h-3 inline mr-1" />
                          {bgmUploading ? "上传中..." : "上传"}
                          <input type="file" accept="audio/mp3,audio/wav,audio/m4a" className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) handleBgmUpload(file);
                            }} />
                        </label>
                      </div>
                    ) : p.type === "textarea" ? (
                      <div>
                        {p.name === "content" && (
                          <div className="flex gap-2">
                            <textarea
                              value={formValues[p.name] || ""}
                              onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                              placeholder={p.placeholder || ""}
                              rows={4}
                              className="flex-1 px-2 py-1 text-xs border-2 border-border resize-none"
                            />
                            <button
                              onClick={handleAiGenerate}
                              disabled={aiGenerating}
                              className={`brutal-btn shrink-0 px-2 py-1 text-xs font-bold self-start ${aiGenerating ? "bg-muted text-muted-foreground" : "bg-blue text-white"}`}
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
                            className="w-full px-2 py-1 text-xs border-2 border-border resize-none"
                          />
                        )}
                      </div>
                    ) : (
                      <input type={p.type === "number" ? "number" : "text"}
                        value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        placeholder={p.placeholder || ""}
                        className="w-full px-2 py-1 text-xs border-2 border-border" />
                    )}
                  </div>
                ))}
                <div className="flex gap-2 mt-4 justify-end">
                  <button onClick={() => setShowCreate(false)} className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground">
                    取消
                  </button>
                  <button onClick={handleCreate} disabled={executing}
                    className={`brutal-btn px-3 py-1 text-xs font-bold ${executing ? "bg-muted text-muted-foreground" : "bg-blue text-white"}`}>
                    <Play className="w-3 h-3 inline mr-1" />{executing ? "创建中..." : "执行"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="确认删除"
        description="确定要删除这条执行记录吗？此操作不可撤销。"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}