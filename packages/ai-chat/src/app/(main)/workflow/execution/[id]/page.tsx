"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Play, ChevronRight, ArrowLeft, RefreshCw, Download, ChevronDown, ChevronUp, Edit3, History } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogContent, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Root, Portal, Backdrop, Popup, Header, Title, Close } from "@/components/ui/drawer";
import { ImageViewerProvider, useImageViewer } from "@/components/ui/image-viewer";

interface ExecutionStep {
  id: string; name: string; type: string; previewType?: string; previewField?: string;
  status: string; output: string | null; error: string | null; elapsed?: string;
  progress?: string;
}

interface Execution {
  executionId: string; template: string; status: string;
  startedAt: string; completedAt: string | null;
  steps: ExecutionStep[];
  tweakCount?: number;
  tweakLimit?: number;
  currentScriptVersion?: number;
  scriptHistory?: { version: number; at: string; feedback: string; videoFile: string | null }[];
  tweakTask?: { status: string; startedAt: string; completedAt: string | null; version: number | null; error: string | null };
}

const V2_GROUPS = [
  { label: "准备", stepIds: ["script", "validate"] },
  { label: "素材", stepIds: ["tts-scenes", "bgm", "sfx-pick"] },
  { label: "渲染", stepIds: ["render"] },
  { label: "合成", stepIds: ["concat"] },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function clientLog(executionId: string, level: string, message: string) {
  console.log(`[${executionId}] [${level}] ${message}`);
  fetch(`${BASE}/api/client-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ executionId, level, message }),
  }).catch(() => {});
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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showScriptPanel, setShowScriptPanel] = useState(false);
  const [locked, setLocked] = useState(false);
  const [showTweak, setShowTweak] = useState(false);
  const [tweakFeedback, setTweakFeedback] = useState("");
  const [tweakImages, setTweakImages] = useState<{ id: string; url: string; path: string | null; isUploading: boolean }[]>([]);
  const [tweaking, setTweaking] = useState(false);
  const [switchingVersion, setSwitchingVersion] = useState<number | null>(null);
  const [scriptJsonTab, setScriptJsonTab] = useState<"script" | "state">("script");
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; tweak?: boolean }[]>([]);
  const [tweakPages, setTweakPages] = useState<number[]>([]);

  const fetchExecution = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}`);
      if (res.ok) {
        const data = await res.json();
        const renderStatus = data.steps?.find((s: ExecutionStep) => s.id === "render")?.status;
        clientLog(id, "INFO", `fetchExecution: executionStatus=${data.status} renderStatus=${renderStatus} currentScriptVersion=${data.currentScriptVersion} tweakCount=${data.tweakCount}`);
        setExecution(data);
        if (!activeStepId) {
          const running = data.steps.find((s: ExecutionStep) => s.status === "running");
          const failed = data.steps.find((s: ExecutionStep) => s.status === "failed");
          const pending = data.steps.find((s: ExecutionStep) => s.status === "pending");
          setActiveStepId(running?.id || failed?.id || pending?.id || data.steps[data.steps.length - 1].id);
        } else if (!locked) {
          const running = data.steps.find((s: ExecutionStep) => s.status === "running");
          if (running) setActiveStepId(running.id);
        }
      }
    } catch { /* ignore */ }
  }, [id, activeStepId, locked]);

  const anyStepRunning = execution?.steps?.some((s: ExecutionStep) => s.status === "running") === true;
  const isTerminalStatus = execution?.status === "completed" || execution?.status === "completed_with_warnings" || execution?.status === "failed";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/workflows/templates`);
        if (res.ok) setTemplates(((await res.json()).templates || []) as { id: string; tweak?: boolean }[]);
      } catch { /* ignore */ }
    })();
  }, []);

  const supportsTweak = templates.find(t => t.id === execution?.template)?.tweak === true;
  const isComic = execution?.template === "comic-generation";
  const comicPages: { page: number }[] = (() => {
    try {
      const g = execution?.steps?.find(s => s.id === "generate-pages");
      if (!g?.output) return [];
      const out = typeof g.output === "string" ? JSON.parse(g.output) : g.output;
      return (out?.pages || []) as { page: number }[];
    } catch { return []; }
  })();

  useEffect(() => {
    clientLog(id, "INFO", `useEffect run: executionStatus=${execution?.status}`);
    fetchExecution();
    if (isTerminalStatus && !retrying) {
      clientLog(id, "INFO", `useEffect skip polling: status=${execution?.status}`);
      return;
    }
    if (execution?.tweakTask?.status === "running") {
      clientLog(id, "INFO", `useEffect skip polling: tweakTask running`);
      return;
    }
    // ponytail: 无 running step 且无阻塞中的 next/auto/retry 请求时不轮询
    // （next/auto/retry 的 POST 在服务端阻塞执行，期间客户端看不到 running step，靠 loading 态维持轮询）
    if (!anyStepRunning && !autoLoading && !nextLoading && !retrying) {
      return;
    }
    clientLog(id, "INFO", `useEffect start polling: status=${execution?.status}`);
    const timer = setInterval(fetchExecution, 2000);
    return () => clearInterval(timer);
  }, [fetchExecution, execution?.status, execution?.tweakTask?.status, anyStepRunning, isTerminalStatus, autoLoading, nextLoading, retrying, id]);

  useEffect(() => {
    if (isTerminalStatus) {
      setLocked(false);
    }
  }, [isTerminalStatus]);

  // 当 tweakTask 状态变化时轮询（仅支持 tweak 的模板）
  useEffect(() => {
    if (!supportsTweak) return;
    if (execution?.tweakTask?.status === "running") {
      const timer = setInterval(fetchExecution, 2000);
      return () => clearInterval(timer);
    }
  }, [supportsTweak, execution?.tweakTask?.status, fetchExecution]);

  useEffect(() => {
    if (!supportsTweak) return;
    if (execution?.tweakTask?.status === "done") {
      toast(`🟢 微调完成`);
      fetchExecution();
    } else if (execution?.tweakTask?.status === "failed") {
      toast(`🔴 微调失败: ${execution.tweakTask.error}`);
      fetchExecution();
    }
  }, [supportsTweak, execution?.tweakTask?.status, fetchExecution]);

  const handleNext = useCallback(async () => {
    setNextLoading(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/next`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        fetchExecution();
        const nextIdx = (data.stepIndex ?? -1) + 1;
        const steps = execution?.steps || [];
        const target = steps[nextIdx];
        if (target && (target.status === "pending" || target.status === "running")) {
          setActiveStepId(target.id);
        }
      } else {
        toast(`🔴 ${data.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setNextLoading(false);
  }, [id, fetchExecution, execution]);

  const handleAuto = useCallback(async () => {
    setAutoLoading(true);
    try {
      await fetch(`${BASE}/api/workflows/execution/${id}/auto`, { method: "POST" });
      toast("🟢 自动执行已启动");
      fetchExecution();
    } catch { toast("🔴 请求失败"); }
    setAutoLoading(false);
  }, [id, fetchExecution]);

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

  const uploadImage = useCallback(async (file: File) => {
    const id_ = Math.random().toString(36).slice(2, 9);
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setTweakImages(prev => [...prev, { id: id_, url: dataUrl, path: null, isUploading: true }]);
    try {
      const res = await fetch(`${BASE}/api/upload`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: dataUrl, name: file.name, mimeType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "upload failed");
      setTweakImages(prev => prev.map(i => i.id === id_ ? { ...i, path: data.path, isUploading: false } : i));
      return data.path;
    } catch (e) {
      setTweakImages(prev => prev.filter(i => i.id !== id_));
      toast("🔴 图片上传失败");
      return null;
    }
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    const remaining = 4 - tweakImages.length;
    for (const f of files.slice(0, remaining)) {
      await uploadImage(f);
    }
    if (files.length > remaining) toast("🟡 最多 4 张图片");
  }, [tweakImages.length, uploadImage]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 4 - tweakImages.length;
    for (const f of files.slice(0, remaining)) {
      await uploadImage(f);
    }
    if (files.length > remaining) toast("🟡 最多 4 张图片");
    e.target.value = "";
  }, [tweakImages.length, uploadImage]);

  const removeImage = useCallback((id: string) => {
    setTweakImages(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleTweak = useCallback(async () => {
    if (!tweakFeedback.trim()) { toast("🔴 请输入反馈"); return; }
    if (isComic && tweakPages.length !== 1) { toast("🔴 请选择要重生成的一页"); return; }
    const uploading = tweakImages.filter(i => i.isUploading);
    if (uploading.length > 0) { toast("🔴 图片上传中，请稍候"); return; }
    clientLog(id, "INFO", `handleTweak start: feedback="${tweakFeedback}" images=${tweakImages.length}`);
    setTweaking(true);
    setTweakFeedback("");
    setTweakImages([]);
    setShowTweak(false);

    try {
      const imagePaths = tweakImages.map(i => i.path).filter(Boolean);
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/tweak`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: tweakFeedback, imagePaths, pages: isComic ? tweakPages : undefined }),
      });
      const data = await res.json();
      clientLog(id, "INFO", `handleTweak response: ok=${data.ok} status=${data.status}`);
      if (data.ok) {
        toast(`🟢 微调已提交，正在生成中...`);
        fetchExecution();
      } else {
        toast(`🔴 ${data.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setTweaking(false);
  }, [id, tweakFeedback, tweakImages, fetchExecution, isComic, tweakPages]);

  const openTweakForPage = useCallback((page: number) => {
    setTweakPages([page]);
    setShowTweak(true);
  }, []);

  const handleSwitchVersion = useCallback(async (version: number) => {
    setSwitchingVersion(version);
    try {
      console.log("[handleSwitchVersion] start, version=", version);
      const res = await fetch(`${BASE}/api/workflows/execution/${id}/switch-version`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await res.json();
      console.log("[handleSwitchVersion] API response:", data);
      if (data.ok) {
        toast(`🟢 已切换到 v${version}`);
        console.log("[handleSwitchVersion] calling fetchExecution");
        fetchExecution();
        setShowTweak(false);
      } else {
        toast(`🔴 ${data.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setSwitchingVersion(null);
  }, [id, fetchExecution]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  if (!execution) return null;

  const completed = execution.steps.filter(s => s.status === "completed" || s.status === "skipped").length;
  const warnings = execution.steps.filter(s => s.status === "warning").length;
  const activeStep = execution.steps.find(s => s.id === activeStepId) || execution.steps[0];
  const isDone = execution.status === "completed" || execution.status === "completed_with_warnings" || execution.status === "failed";
  const isRunning = execution.status === "running";
  const isTweakRunning = execution.tweakTask?.status === "running";
  const isV2 = execution.template === "tech-video";

  // 解析场景信息
  let sceneList: { id: string; type: string; templateId: string; narration: string }[] = [];
  const scriptStep = execution.steps.find(s => s.id === "script");
  if (scriptStep?.output) {
    try {
      const out = typeof scriptStep.output === "string" ? JSON.parse(scriptStep.output) : scriptStep.output;
      if (out.script) {
        const s = typeof out.script === "string" ? JSON.parse(out.script) : out.script;
        if (s.scenes) sceneList = s.scenes;
      }
    } catch { /* ignore */ }
  }

  return (
    <ImageViewerProvider>
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b-[3px] border-border shrink-0">
        <a href={`/workflow/type/${execution.template}`} className="text-muted-foreground/70 hover:text-muted-foreground"><ArrowLeft className="w-4 h-4" /></a>
        <div className="flex items-center gap-2 flex-1">
          <h2 className="text-sm font-bold text-foreground">{execution.template}</h2>
          {isV2 && sceneList.length > 0 && (
            <span className="text-xs text-muted-foreground/70">{sceneList.length} 场景</span>
          )}
        </div>
        {isV2 && sceneList.length > 0 && (
          <button onClick={() => setShowScriptPanel(true)}
            className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-yellow text-foreground">
            📋 脚本
          </button>
        )}
        {isDone && supportsTweak && (
          <button onClick={() => { setShowTweak(true); if (isComic) setTweakPages([]); }}
            disabled={isTweakRunning}
            className={`brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold ${isTweakRunning ? "bg-muted text-muted-foreground" : "bg-purple text-white"}`}>
            <Edit3 className="w-3 h-3" /> 微调
            {execution.tweakCount !== undefined && execution.tweakLimit !== undefined ? (
              <span className="text-white/70 ml-0.5">{execution.tweakCount}/{execution.tweakLimit}</span>
            ) : null}
          </button>
        )}
        {isDone && execution.scriptHistory && execution.scriptHistory.length > 0 && (
          <button onClick={() => setShowHistoryPanel(true)}
            className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-yellow text-foreground">
            <History className="w-3 h-3" /> 历史
          </button>
        )}
        <button onClick={() => setShowDelete(true)}
          className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-destructive text-white">
          删除
        </button>
      </div>

      {isV2 && sceneList.length > 0 && (
        <Root open={showScriptPanel} onOpenChange={setShowScriptPanel} swipeDirection="left">
          <Popup className="right-0 top-0 bottom-0 w-[40%] max-w-none rounded-none flex flex-col p-0 gap-0">
            <Header className="border-b px-4 py-3 shrink-0">
              <Title>脚本 ({sceneList.length} 场景)</Title>
              <Close>关闭</Close>
            </Header>
            <div className="flex-1 overflow-auto p-4">
              <SceneListPanel scenes={sceneList} executionId={execution.executionId} />
            </div>
          </Popup>
        </Root>
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[280px_1fr]">
        <div className="overflow-auto border-r border-border p-3 space-y-1.5">
          {isV2 ? renderV2Steps() : renderDefaultSteps()}
          <p className="text-xs text-muted-foreground text-center pt-2">{completed}/{execution.steps.length} 步完成{warnings > 0 ? ` · ${warnings} 警告` : ""}</p>
        </div>

        <div className="overflow-auto p-4">
          {(() => {
            // 优先级1：script step → JSON tabs
            if (activeStep.id === "script" && activeStep.output) {
              if (activeStep.status === "running") {
                return <LoadingState text="正在修改脚本..." />;
              }
              return (
                <div>
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setScriptJsonTab("script")}
                      className={`brutal-sm px-3 py-1 text-xs font-bold ${
                        scriptJsonTab === "script"
                          ? "bg-yellow-soft text-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      script.json
                    </button>
                    <button
                      onClick={() => setScriptJsonTab("state")}
                      className={`brutal-sm px-3 py-1 text-xs font-bold ${
                        scriptJsonTab === "state"
                          ? "bg-blue-soft text-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      state.json
                    </button>
                  </div>
                  <pre className="text-xs bg-yellow-soft p-4 border-[3px] border-border shadow-md overflow-auto max-h-[70vh] whitespace-pre-wrap">
                    {scriptJsonTab === "script"
                      ? (() => {
                          try {
                            const out = typeof activeStep.output === "string" ? JSON.parse(activeStep.output) : activeStep.output;
                            const s = typeof out.script === "string" ? JSON.parse(out.script) : out.script;
                            return JSON.stringify(s, null, 2);
                          } catch { return String(activeStep.output); }
                        })()
                      : JSON.stringify(execution, null, 2)}
                  </pre>
                </div>
              );
            }

            // 优先级2：render manifest → RenderManifestPreview
            if (activeStep.id === "render" && activeStep.output && typeof activeStep.output === "object" && (activeStep.output as Record<string, unknown>).manifest) {
              return (
                <RenderManifestPreview
                  executionId={execution.executionId}
                  manifest={(activeStep.output as Record<string, unknown>).manifest as { sceneId: string; templateId: string; actualDuration: number; alignmentDiff: number; warning: string | null }[]}
                  sceneList={sceneList}
                />
              );
            }

            // 兜底：PreviewPanel
            return <PreviewPanel step={activeStep} executionId={execution.executionId} currentScriptVersion={execution.currentScriptVersion} imageVersion={`${execution.tweakCount ?? 0}-${execution.completedAt ?? ""}`} onRetry={() => handleRetry(activeStep.id)} retrying={retrying === activeStep.id} onTweakPage={openTweakForPage} />;
          })()}
          {activeStep.id === "concat" && (
            <DownloadPanel executionId={execution.executionId} />
          )}
        </div>
      </div>

      {!isDone && !isTweakRunning && (
        <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
          <button onClick={handleNext} disabled={nextLoading || isRunning}
            className="brutal-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid var(--border)", background: nextLoading || isRunning ? "var(--muted)" : "var(--blue)", color: nextLoading || isRunning ? "var(--muted-foreground)" : "#fff", boxShadow: "2px 2px 0 var(--border)" }}>
            <ChevronRight className="w-3 h-3" />{nextLoading || isRunning ? "执行中..." : "下一步"}
          </button>
          <button onClick={handleAuto} disabled={autoLoading || isRunning}
            className="brutal-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid var(--border)", background: autoLoading || isRunning ? "var(--muted)" : "var(--primary)", color: autoLoading || isRunning ? "var(--muted-foreground)" : "var(--primary-foreground)", boxShadow: "2px 2px 0 var(--border)" }}>
            <Play className="w-3 h-3" />{autoLoading || isRunning ? "执行中..." : "自动执行"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="确认删除"
        description="确定要删除这条执行记录吗？此操作不可撤销。"
        onConfirm={handleDelete}
      />

      <AlertDialog open={showTweak} onOpenChange={setShowTweak}>
        <AlertDialogContent className="max-w-lg rounded-none border-2 border-[var(--border)]"
          style={{ boxShadow: "4px 4px 0 var(--border)", background: "#fff" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold text-lg text-foreground">
              {isComic ? "微调漫画" : "微调脚本"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="py-2 space-y-3">
            {isComic && comicPages.length > 0 && (
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">重生成哪一页？（单选）</label>
                <div className="flex gap-2 flex-wrap">
                  {comicPages.map(p => (
                    <label key={p.page} className="inline-flex items-center gap-1 text-xs border-2 border-border px-2 py-1 cursor-pointer">
                      <input type="radio" name="tweak-page" checked={tweakPages.includes(p.page)}
                        onChange={() => setTweakPages([p.page])} />
                      第 {p.page} 页
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-foreground block mb-1.5">
                你想调整哪里？
              </label>
              <textarea
                value={tweakFeedback}
                onChange={(e) => setTweakFeedback(e.target.value)}
                onPaste={handlePaste}
                placeholder="例如：第3帧太快了&#10;把背景换成蓝色&#10;标题字号加大"
                className="w-full h-28 px-3 py-2 text-sm border-2 border-[var(--border)] rounded-none resize-none focus:outline-none focus:border-[var(--purple)] bg-card"
                style={{ boxShadow: "2px 2px 0 var(--muted)" }}
                disabled={tweaking || (execution.tweakCount !== undefined && execution.tweakLimit !== undefined && execution.tweakCount >= execution.tweakLimit)}
              />
              {tweakImages.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {tweakImages.map(img => (
                    <div key={img.id} className="relative w-16 h-16 border-2 border-border"
                      style={{ boxShadow: "1px 1px 0 var(--muted)" }}>
                      <img src={img.url} alt="参考图" className="w-full h-full object-cover" />
                      {img.isUploading && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="text-white text-xs">上传中</span></div>}
                      <button onClick={() => removeImage(img.id)} disabled={img.isUploading}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-white text-xs flex items-center justify-center cursor-pointer"
                        style={{ border: "1px solid var(--border)", boxShadow: "1px 1px 0 var(--border)" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <label className="text-xs text-muted-foreground/70 cursor-pointer underline hover:text-muted-foreground">
                  <input type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" disabled={tweakImages.length >= 4} />
                  上传图片
                </label>
                <span className="text-xs text-muted-foreground/70">或 Ctrl+V 粘贴截图</span>
                <span className="text-xs text-muted-foreground/50 ml-auto">{tweakImages.length}/4</span>
              </div>
            </div>
          </div>
          <AlertDialogFooter className="gap-2">
            <button
              onClick={() => setShowTweak(false)}
              disabled={tweaking}
              className="px-4 py-1.5 text-xs font-bold cursor-pointer"
              style={{
                border: "2px solid var(--border)",
                background: "#fff",
                color: "#374151",
                boxShadow: "2px 2px 0 var(--border)"
              }}
            >
              取消
            </button>
            <button
              onClick={handleTweak}
              disabled={tweaking || !tweakFeedback.trim() || (execution.tweakCount !== undefined && execution.tweakLimit !== undefined && execution.tweakCount >= execution.tweakLimit)}
              className="px-4 py-1.5 text-xs font-bold cursor-pointer"
              style={{
                border: "2px solid var(--border)",
                background: tweaking ? "var(--muted)" : "var(--purple)",
                color: tweaking ? "var(--muted-foreground)" : "#fff",
                boxShadow: "2px 2px 0 var(--border)"
              }}
            >
              {tweaking ? "微调中..." : "确认微调"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {execution.scriptHistory && execution.scriptHistory.length > 0 && (
        <Root open={showHistoryPanel} onOpenChange={setShowHistoryPanel} swipeDirection="left">
          <Popup className="right-0 top-0 bottom-0 w-[40%] max-w-none rounded-none flex flex-col p-0 gap-0">
            <Header className="border-b px-4 py-3 shrink-0">
              <Title>历史版本 ({execution.scriptHistory.length})</Title>
              <Close>关闭</Close>
            </Header>
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {execution.scriptHistory.slice().reverse().map((h) => (
                <div
                  key={h.version}
                  className={`brutal-sm p-3 text-xs ${
                    h.version === execution.currentScriptVersion ? "bg-yellow-soft border-primary" : "bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-foreground">v{h.version}</span>
                    <span className="text-muted-foreground/70">{formatDateTime(h.at)}</span>
                    {h.version === execution.currentScriptVersion && (
                      <span className="text-xs text-[#7D3C98] font-bold">当前</span>
                    )}
                  </div>
                  <div className="text-muted-foreground mb-2">{h.feedback}</div>
                  <div className="flex items-center gap-2">
                    {h.version !== execution.currentScriptVersion && (
                      <button
                        onClick={() => handleSwitchVersion(h.version)}
                        disabled={switchingVersion === h.version}
                        className="brutal-btn px-2 py-0.5 text-xs cursor-pointer"
                        style={{ border: "1px solid var(--purple)", background: "transparent", color: "var(--purple)" }}
                      >
                        {switchingVersion === h.version ? "切换中..." : "切换到此版本"}
                      </button>
                    )}
                    {h.videoFile ? (
                      <a
                        href={`${BASE}/api/workflows/execution/${execution.executionId}/file/${h.videoFile}`}
                        target="_blank"
                        className="brutal-btn px-2 py-0.5 text-xs cursor-pointer"
                        style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)" }}
                      >
                        <Download className="w-3 h-3 inline mr-1" />下载
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">尚未渲染</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Popup>
        </Root>
      )}
    </div>
    </ImageViewerProvider>
  );

  function renderV2Steps() {
    return V2_GROUPS.map(group => {
      const groupSteps = execution!.steps.filter(s => group.stepIds.includes(s.id));
      if (groupSteps.length === 0) return null;
      const isCollapsed = collapsedGroups.has(group.label);
      const allDone = groupSteps.every(s => s.status === "completed" || s.status === "skipped");
      const hasFail = groupSteps.some(s => s.status === "failed");
      const hasRunning = groupSteps.some(s => s.status === "running");

      return (
        <div key={group.label}>
          <div
            onClick={() => toggleGroup(group.label)}
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-muted rounded"
          >
            <span className={`w-2 h-2 rounded-full ${
              hasRunning ? "bg-yellow animate-pulse" : hasFail ? "bg-destructive" : allDone ? "bg-lime" : "bg-muted-foreground"
            }`} />
            <span className="text-xs font-bold text-muted-foreground">{group.label}</span>
            <span className="text-xs text-muted-foreground/70">{groupSteps.filter(s => s.status === "completed").length}/{groupSteps.length}</span>
            <span className="flex-1" />
            {isCollapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground/70" /> : <ChevronUp className="w-3 h-3 text-muted-foreground/70" />}
          </div>
          {!isCollapsed && groupSteps.map((step, i) => renderStepItem(step, i))}
        </div>
      );
    });
  }

  function renderDefaultSteps() {
    return execution!.steps.map((step, i) => renderStepItem(step, i));
  }

  function renderStepItem(step: ExecutionStep, i: number) {
    const isActive = step.id === activeStepId;
    const done = step.status === "completed";
    const fail = step.status === "failed";
    const warn = step.status === "warning";
    const run = step.status === "running";
    const skipped = step.status === "skipped";
    const pending = step.status === "pending";
    return (
      <div key={step.id}
        onClick={() => { setActiveStepId(step.id); setLocked(true); }}
        className={`p-2 rounded-lg cursor-pointer transition-all ${
          isActive ? "ring-2 ring-primary bg-yellow-soft" : "hover:bg-muted"
        }`}
        style={{ border: isActive ? "2px solid var(--primary)" : "2px solid transparent" }}
      >
        <div className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 relative ${
            done ? "bg-blue text-white" : warn ? "bg-orange-500 text-white" : run ? "bg-yellow text-white" :
            fail ? "bg-destructive text-white" : skipped ? "bg-muted-foreground text-white" : "bg-muted-foreground text-muted-foreground"
          }`}>
            {run && <span className="absolute inset-0 rounded-full bg-yellow animate-ping opacity-75" />}
            <span className="relative z-10">{done ? "✓" : fail ? "✗" : warn ? "⚠" : skipped ? "−" : i + 1}</span>
          </span>
          <span className="text-xs font-bold text-foreground flex-1 truncate">{step.name}</span>
          {step.elapsed && (
            <span className="text-xs text-muted-foreground/70 shrink-0">{step.elapsed}s</span>
          )}
          <div className="flex gap-1 shrink-0">
            {pending && (
              <button onClick={(e) => { e.stopPropagation(); handleSkip(step.id); }}
                disabled={skipping === step.id} className="text-xs text-muted-foreground/70 hover:text-muted-foreground cursor-pointer"
                title="跳过">{skipping === step.id ? "..." : "跳过"}</button>
            )}
            {(done || fail || warn || run) && (
              <button onClick={(e) => { e.stopPropagation(); handleRetry(step.id); }}
                disabled={retrying === step.id} className="text-xs text-muted-foreground/70 hover:text-blue cursor-pointer"
                title="重新执行"><RefreshCw className="w-3 h-3" /></button>
            )}
          </div>
        </div>
        {(fail || warn) && step.error && (
          <p className={`text-xs mt-1 truncate ml-7 ${fail ? "text-red-500" : "text-orange-500"}`}>{step.error}</p>
        )}
      </div>
    );
  }
}

function RenderManifestPreview({ executionId, manifest, sceneList }: { executionId: string; manifest: { sceneId: string; templateId: string; actualDuration: number; alignmentDiff: number; warning: string | null }[]; sceneList: { id: string; narration: string }[] }) {
  const [activeScene, setActiveScene] = useState(manifest[0]?.sceneId || "");
  const scene = manifest.find((s: { sceneId: string }) => s.sceneId === activeScene);
  const sceneInfo = sceneList.find((s: { id: string }) => s.id === activeScene);
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {manifest.map((s: { sceneId: string; actualDuration: number }) => (
          <button
            key={s.sceneId}
            onClick={() => setActiveScene(s.sceneId)}
            className="shrink-0 px-2.5 py-1 text-xs rounded cursor-pointer font-bold transition-colors"
            style={{
              border: "2px solid var(--border)",
              background: s.sceneId === activeScene ? "var(--blue)" : "#fff",
              color: s.sceneId === activeScene ? "#fff" : "#374151",
              boxShadow: s.sceneId === activeScene ? "2px 2px 0 var(--border)" : "none",
            }}
          >
            {s.sceneId}
            <span className="ml-1 opacity-70" style={{ fontSize: "10px" }}>
              {s.actualDuration.toFixed(1)}s
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center">
        <div className="rounded-[24px] border-[6px] border-gray-800 bg-black p-1 shadow-xl" style={{ width: "200px" }}>
          <div className="rounded-[18px] overflow-hidden bg-white" style={{ aspectRatio: "9/16" }}>
            <video
              src={`${fileBase}/clips/scene-${activeScene}.mp4`}
              controls
              preload="none"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      </div>

      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground/70">模板:</span>
          <span className="text-foreground font-bold">{scene?.templateId}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground/70">时长:</span>
          <span className="text-foreground">{scene?.actualDuration.toFixed(1)}s</span>
          {scene?.warning ? (
            <span className="text-yellow-600 font-bold">⚠ {scene.warning}</span>
          ) : (
            <span className="text-green-600">✓ 对齐</span>
          )}
        </div>
        {sceneInfo?.narration && (
          <div className="text-muted-foreground italic">📝 {sceneInfo.narration}</div>
        )}
      </div>
    </div>
  );
}

function SceneListPanel({ scenes, executionId }: { scenes: { id: string; type: string; templateId: string; narration: string }[]; executionId: string }) {
  if (scenes.length === 0) return null;
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold text-muted-foreground mb-2">📋 场景列表</h3>
      <div className="space-y-1">
        {scenes.map((scene, i) => (
          <div key={scene.id} className="flex items-center gap-2 p-2 bg-muted rounded border border-border">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              scene.type === "hook" ? "bg-yellow text-foreground" :
              scene.type === "outro" ? "bg-orange text-foreground" : "bg-muted-foreground text-white"
            }`}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-foreground truncate">{scene.id}</span>
                <span className="text-xs text-muted-foreground/70">{scene.templateId}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{scene.narration}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DownloadPanel({ executionId }: { executionId: string }) {
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-bold text-muted-foreground mb-2">📦 下载</h3>
      <div className="flex flex-wrap gap-2">
        <a href={`${fileBase}/video.mp4`} download
          className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
          style={{ border: "2px solid var(--border)", background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "2px 2px 0 var(--border)" }}>
          <Download className="w-3 h-3" />video.mp4
        </a>
        <a href={`${fileBase}/video.srt`} download
          className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
          style={{ border: "2px solid var(--border)", background: "var(--blue)", color: "#fff", boxShadow: "2px 2px 0 var(--border)" }}>
          <Download className="w-3 h-3" />video.srt
        </a>
        <a href={`${fileBase}/voice-final.mp3`} download
          className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
          style={{ border: "2px solid var(--border)", background: "var(--orange)", color: "#fff", boxShadow: "2px 2px 0 var(--border)" }}>
          <Download className="w-3 h-3" />voice.mp3
        </a>
      </div>
    </div>
  );
}

function PreviewPanel({ step, executionId, currentScriptVersion, imageVersion, onRetry, retrying, onTweakPage }: { step: ExecutionStep; executionId: string; currentScriptVersion?: number; imageVersion?: string; onRetry: () => void; retrying: boolean; onTweakPage?: (page: number) => void }) {
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;
  const version = currentScriptVersion ?? 0;

  if (step.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full border-2 border-dashed border-border flex items-center justify-center">
          <span className="text-xl">⏸️</span>
        </div>
        <p className="text-sm text-muted-foreground font-medium">等待执行</p>
        <p className="text-xs text-muted-foreground/70">点击「下一步」开始执行</p>
      </div>
    );
  }

  if (step.status === "running") {
    return <LoadingState text={step.progress ? `正在执行... ${step.progress}` : "正在执行..."} />;
  }

  if (step.status === "skipped") {
    const skippedReason = (step as { skippedReason?: string }).skippedReason;
    const skippedAt = (step as { skippedAt?: string }).skippedAt;
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="brutal bg-yellow-soft p-8 max-w-lg w-full text-center relative">
          {/* 右上 sticker（demo 风格，倾斜 -12°） */}
          <div className="absolute -top-3 -right-3 brutal w-12 h-12 bg-purple text-white flex items-center justify-center text-xl font-bold rotate-12">
            ⏭
          </div>

          {/* 大图标 + 标题 */}
          <div className="flex items-center gap-4 justify-center mb-6">
            <div className="brutal w-16 h-16 bg-card flex items-center justify-center text-4xl">
              ⏭️
            </div>
            <div className="text-left">
              <h3 className="text-xl font-bold font-heading text-foreground">此步骤已跳过</h3>
              <p className="text-sm text-muted-foreground font-mono">SKIPPED</p>
            </div>
          </div>

          {/* 步骤信息卡（仅当后端有数据时显示） */}
          {skippedReason || skippedAt ? (
            <div className="brutal-sm bg-card p-3 mb-4 text-left text-xs space-y-1">
              {skippedReason && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">跳过原因</span>
                  <span className="text-foreground font-bold text-right">{skippedReason}</span>
                </div>
              )}
              {skippedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">跳过时间</span>
                  <span className="text-foreground font-mono">{skippedAt}</span>
                </div>
              )}
            </div>
          ) : null}

          {/* 影响说明 */}
          <div className="brutal-sm bg-purple-soft p-3 mb-5 text-left text-xs">
            <div className="font-bold text-foreground mb-1">⚠ 跳过此步骤可能影响</div>
            <div className="text-muted-foreground">
              后续步骤如依赖此输出，可能无法正常执行。建议在最终结果中检查完整性。
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 justify-center">
            <button
              onClick={onRetry}
              disabled={retrying}
              className="brutal-btn bg-primary text-primary-foreground px-4 py-2 text-sm font-bold"
            >
              {retrying ? "重做中..." : "🔄 重新执行"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step.status === "failed") {
    return (
      <div className="p-4 rounded-lg" style={{ border: "3px solid var(--pink)", boxShadow: "4px 4px 0 var(--pink)", background: "var(--pink-soft)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-destructive text-white flex items-center justify-center text-xs font-bold">✗</span>
          <span className="text-sm font-bold text-red-700">执行失败</span>
        </div>
        <pre className="text-xs text-red-600 whitespace-pre-wrap break-words bg-red-100/50 p-2 rounded">{step.error || "未知错误"}</pre>
        <div className="flex items-center gap-2 mt-3">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          <p className="text-xs text-red-400">点击左侧「重做」按钮重新执行</p>
        </div>
      </div>
    );
  }

  if (step.status === "warning") {
    return (
      <div className="p-4 rounded-lg" style={{ border: "3px solid var(--orange)", boxShadow: "4px 4px 0 var(--orange)", background: "var(--orange-soft)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-orange text-white flex items-center justify-center text-xs font-bold">⚠</span>
          <span className="text-sm font-bold text-foreground">执行警告（失败但可重试）</span>
        </div>
        <pre className="text-xs whitespace-pre-wrap break-words p-2 rounded" style={{ background: "rgba(255,140,0,0.12)", color: "var(--foreground)" }}>{step.error || "未知错误"}</pre>
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 brutal-btn bg-orange text-white px-4 py-1.5 text-xs font-bold"
        >
          {retrying ? "重做中..." : "🔄 重新执行"}
        </button>
      </div>
    );
  }

  const pt = step.previewType || "text";
  const pf = step.previewField || "output";
  const value = getOutputValue(step.output, pf, pt);
  const fileTypes = ["audio", "video", "iframe"];

  return (
    <div className="space-y-3">
      <div className="brutal bg-card p-3" style={{ border: "3px solid var(--border)", boxShadow: "4px 4px 0 var(--border)" }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-5 h-5 rounded-full bg-blue text-white flex items-center justify-center text-xs font-bold">✓</span>
          <h3 className="text-xs font-bold text-foreground">{step.name}</h3>
          <span className="text-xs text-foreground px-1.5 py-0.5">✅ 完成</span>
        </div>
        {pt === "images" ? (
          <ImagesGallery output={step.output} executionId={executionId} v={imageVersion} onTweakPage={onTweakPage} />
        ) : (
          <PreviewContent type={pt} value={value} src={fileTypes.includes(pt) ? `${fileBase}/${value}?v=${version}` : undefined} executionId={executionId} onRetry={onRetry} retrying={retrying} />
        )}
      </div>
    </div>
  );
}

function getOutputValue(output: string | null, field: string, previewType?: string): string | null {
  if (!output) return null;
  if (typeof output === "string") {
    try {
      const obj = JSON.parse(output);
      if (obj[field]) return normalizePath(obj[field], previewType);
      if (obj.output) return normalizePath(obj.output, previewType);
    } catch { /* plain string */ }
    return output.includes("/") ? output.split("/").pop() || output : output;
  }
  try {
    const obj = typeof output === "object" ? output : JSON.parse(output);
    if (field === "output") return typeof obj === "string" ? obj : JSON.stringify(obj);
    const val = (obj as Record<string, unknown>)[field];
    if (val) {
      return normalizePath(String(val), previewType);
    }
    if ((obj as Record<string, unknown>).output) {
      const o = (obj as Record<string, unknown>).output as string;
      if (previewType && ["video", "audio", "iframe"].includes(previewType) && !o.includes("/")) return null;
      return o;
    }
    return JSON.stringify(obj);
  } catch {
    return output;
  }
}

function normalizePath(value: string, previewType?: string): string {
  const m = value.match(/\/data\/workflows\/[^/]+\/(.+)$/);
  if (m) {
    const rel = m[1];
    if (previewType && ["video", "audio"].includes(previewType)) {
      return rel.includes("/") ? rel.split("/").pop() || rel : rel;
    }
    return rel;
  }
  if (previewType && ["video", "audio"].includes(previewType) && value.includes("/")) {
    return value.split("/").pop() || value;
  }
  return value;
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 border-[3px] border-border rounded-full" />
        <div className="absolute inset-0 border-[3px] border-primary rounded-full border-t-transparent animate-spin" />
      </div>
      <p className="text-sm text-muted-foreground font-medium">{text}</p>
      <div className="w-40 h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full w-1/2 bg-primary rounded-full animate-[slide_1.5s_ease-in-out_infinite]" />
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>
    </div>
  );
}

function ImagesGallery({ output, executionId, v, onTweakPage }: { output: string | null; executionId: string; v?: string; onTweakPage?: (page: number) => void }) {
  const fileBase = `${BASE}/api/workflows/execution/${executionId}/file`;
  const { register, open } = useImageViewer();
  const [exporting, setExporting] = useState(false);

  let pages: { page: number; file: string; dialogue?: string; error?: string }[] = [];
  try {
    const out = typeof output === "string" ? JSON.parse(output) : output;
    if (out && Array.isArray(out.pages)) pages = out.pages;
  } catch { /* ignore */ }

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${executionId}/export`, { method: "POST" });
      const data = await res.json();
      if (data.ok) toast(`🟢 已导出到 ${data.exportDir}`);
      else toast(`🔴 ${data.error || "导出失败"}`);
    } catch { toast("🔴 请求失败"); }
    setExporting(false);
  }, [executionId]);

  if (pages.length === 0) return <p className="text-xs text-muted-foreground/70">暂无图片</p>;

  return (
    <div className="flex flex-col items-center">
      <div className="flex flex-col w-full max-w-md">
        {pages.map(p => {
          if (p.error) {
            return (
              <div key={p.page} className="relative">
                <div className="w-full aspect-[2/3] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border bg-muted p-4"
                  style={{ boxShadow: "2px 2px 0 var(--muted)" }}>
                  <span className="text-2xl">🖼️</span>
                  <p className="text-xs font-bold text-muted-foreground">第 {p.page} 页生成失败</p>
                  <p className="text-[10px] text-muted-foreground/70 text-center break-words max-h-16 overflow-hidden">{p.error}</p>
                  {onTweakPage && (
                    <button onClick={() => onTweakPage(p.page)}
                      className="brutal-btn px-3 py-1 text-xs font-bold bg-purple text-white mt-1">
                      微调这页
                    </button>
                  )}
                </div>
                <span className="absolute top-1 left-1 px-1.5 py-0.5 text-xs font-bold bg-black/60 text-white">{p.page}</span>
              </div>
            );
          }
          const src = `${fileBase}/${p.file}${v ? `?v=${v}` : ""}`;
          const idx = register(src);
          return (
            <div key={p.page} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`第 ${p.page} 页`} loading="lazy"
                className="w-full block cursor-zoom-in"
                onClick={() => open(idx)} />
              <span className="absolute top-1 left-1 px-1.5 py-0.5 text-xs font-bold bg-black/60 text-white">{p.page}</span>
            </div>
          );
        })}
      </div>
      <button onClick={handleExport} disabled={exporting}
        className={`brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold mt-4 ${exporting ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
        <Download className="w-3 h-3" />{exporting ? "导出中..." : "导出到 Downloads"}
      </button>
    </div>
  );
}

function PreviewContent({ type, value, src, executionId, onRetry, retrying }: { type: string; value?: string | null; src?: string; executionId: string; onRetry: () => void; retrying: boolean }) {
  if (type === "code" || type === "json" || type === "text") {
    if (!value) return <p className="text-xs text-muted-foreground/70">暂无输出</p>;
  }
  if (type === "audio" || type === "video" || type === "iframe") {
    if (!src || !value) return <p className="text-xs text-muted-foreground/70">文件未生成</p>;
  }

  switch (type) {
    case "code":
      return (
        <pre className="text-xs text-foreground bg-muted p-3 rounded border border-border max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-mono"
          style={{ border: "2px solid var(--muted)" }}>
          {typeof value === "string" ? (value.length > 5000 ? value.slice(0, 5000) + "\n\n...（内容过长，已截断）" : value) : JSON.stringify(value, null, 2)}
        </pre>
      );

    case "iframe":
      return (
        <div className="flex flex-col items-center">
          <div className="rounded-[24px] border-[6px] border-gray-800 bg-black p-1 shadow-xl" style={{ width: "320px" }}>
            <div className="w-16 h-4 bg-gray-800 rounded-full mx-auto mb-1" />
            <div className="rounded-[18px] overflow-hidden bg-white" style={{ aspectRatio: "9/16" }}>
              <iframe src={src} className="w-full h-full border-0" title="预览" sandbox="allow-scripts allow-same-origin" />
            </div>
            <div className="w-20 h-1 bg-gray-600 rounded-full mx-auto mt-2" />
          </div>
          <a href={src} target="_blank" rel="noopener noreferrer"
            className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer mt-3"
            style={{ border: "2px solid var(--border)", background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "2px 2px 0 var(--border)" }}>
            新窗口打开
          </a>
        </div>
      );

    case "video":
      return (
        <div className="flex flex-col items-center">
          <div className="rounded-[24px] border-[6px] border-gray-800 bg-black p-1 shadow-xl" style={{ width: "320px" }}>
            <div className="w-16 h-4 bg-gray-800 rounded-full mx-auto mb-1" />
            <div className="rounded-[18px] overflow-hidden bg-black" style={{ aspectRatio: "9/16" }}>
              <video controls className="w-full h-full object-contain" src={src} playsInline
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  clientLog(executionId, "VIDEO", `loadedMetadata: duration=${v.duration} videoWidth=${v.videoWidth} videoHeight=${v.videoHeight} readyState=${v.readyState}`);
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (Math.floor(v.currentTime) % 15 === 0 && v.currentTime > 0) {
                    clientLog(executionId, "VIDEO", `timeUpdate: currentTime=${v.currentTime.toFixed(1)} paused=${v.paused}`);
                  }
                }}
                onSeeked={(e) => {
                  clientLog(executionId, "VIDEO", `seeked: currentTime=${e.currentTarget.currentTime.toFixed(1)}`);
                }}
                onClick={(e) => {
                  clientLog(executionId, "VIDEO", `click: target=${(e.target as HTMLElement).tagName} offsetX=${e.nativeEvent.offsetX} offsetY=${e.nativeEvent.offsetY}`);
                }}
                onMouseDown={(e) => {
                  clientLog(executionId, "VIDEO", `mousedown: target=${(e.target as HTMLElement).tagName} offsetX=${e.nativeEvent.offsetX} offsetY=${e.nativeEvent.offsetY}`);
                }}
                onError={(e) => {
                  const v = e.currentTarget;
                  const err = (v as any).error;
                  clientLog(executionId, "VIDEO", `error: code=${err?.code} message=${err?.message}`);
                }}
              />
            </div>
            <div className="w-20 h-1 bg-gray-600 rounded-full mx-auto mt-2" />
          </div>
          <a href={src} target="_blank" rel="noopener noreferrer" download
            className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer mt-3"
            style={{ border: "2px solid var(--border)", background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "2px 2px 0 var(--border)" }}>
            <Download className="w-3 h-3" />下载视频
          </a>
        </div>
      );

    case "audio":
      return (
        <div className="flex flex-col items-center">
          <div className="rounded-[24px] border-[6px] border-gray-800 bg-black p-1 shadow-xl" style={{ width: "260px" }}>
            <div className="w-16 h-4 bg-gray-800 rounded-full mx-auto mb-1" />
            <div className="rounded-[18px] bg-muted p-6" style={{ aspectRatio: "9/16" }}>
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <p className="text-xs text-muted-foreground">🎵 音频播放</p>
                <audio controls className="w-full" src={src} preload="metadata" />
              </div>
            </div>
            <div className="w-20 h-1 bg-gray-600 rounded-full mx-auto mt-2" />
          </div>
        </div>
      );

    case "json":
      let jsonValue = value;
      if (typeof value === "string") {
        try { jsonValue = JSON.parse(value); } catch {}
      }
      return (
        <pre className="text-xs text-foreground bg-muted p-3 rounded border border-border max-h-[60vh] overflow-auto font-mono"
          style={{ border: "2px solid var(--muted)" }}>
          {typeof jsonValue === "string" ? jsonValue : JSON.stringify(jsonValue, null, 2)}
        </pre>
      );

    default:
      return (
        <p className="text-xs text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {typeof value === "string" ? value : JSON.stringify(value)}
        </p>
      );
  }
}