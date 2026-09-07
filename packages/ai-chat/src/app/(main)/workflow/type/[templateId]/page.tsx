"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Play, Plus, Upload, ImagePlus, Users, Palette, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Root, Popup, Header, Title, Close } from "@/components/ui/drawer";

interface Template {
  id: string; label: string; description: string;
  params: { name: string; label: string; type: string; required?: boolean; default?: string; options?: string[]; placeholder?: string }[];
  steps: { name: string }[];
}

interface Execution {
  executionId: string; title: string; template: string; templateLabel: string; status: string;
   totalSteps: number; completedSteps: number; runningSteps?: number; startedAt: string; completedAt: string | null;
  failedStep: string | null; failedError: string | null;
}

interface Character { id: string; name: string; description: string; createdAt: string; }
interface StyleItem { id: string; name: string; description: string; createdAt: string; }

export default function WorkflowTypePage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.templateId as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [fpUploading, setFpUploading] = useState(false);

  const [showCharacters, setShowCharacters] = useState(false);
  const [showStyles, setShowStyles] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [charDesc, setCharDesc] = useState("");
  const [charRefDataUrl, setCharRefDataUrl] = useState<string | null>(null);
  const [generatingChar, setGeneratingChar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [charName, setCharName] = useState("");
  const [savingChar, setSavingChar] = useState(false);
  const [styleName, setStyleName] = useState("");
  const [styleDesc, setStyleDesc] = useState("");
  const [creatingStyle, setCreatingStyle] = useState(false);
  const [deleteAsset, setDeleteAsset] = useState<{ type: "character" | "style"; id: string; name: string } | null>(null);

  const formValuesRef = useRef(formValues);
  useEffect(() => { formValuesRef.current = formValues; }, [formValues]);

  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/executions`);
      if (res.ok) {
        const all = await res.json();
        setExecutions(all.filter((e: Execution) => e.template === templateId));
      }
    } catch { /* ignore */ }
  }, [templateId]);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/characters`);
      if (res.ok) setCharacters((await res.json()).characters || []);
    } catch { /* ignore */ }
  }, []);

  const fetchStyles = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/styles`);
      if (res.ok) setStyles((await res.json()).styles || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/workflows/templates`);
        if (res.ok) {
          const list = ((await res.json()).templates || []) as Template[];
          const t = list.find((x) => x.id === templateId);
          if (t) {
            setTemplate(t);
            const defaults: Record<string, string> = {};
            t.params.forEach(p => { if (p.default !== undefined) defaults[p.name] = String(p.default); });
            setFormValues(defaults);
            if (t.id === "comic-generation") { fetchCharacters(); fetchStyles(); }
          } else {
            setNotFound(true);
          }
        } else {
          setNotFound(true);
        }
      } catch { setNotFound(true); }
    })();
    fetchExecutions();
  }, [templateId, fetchExecutions, fetchCharacters, fetchStyles]);

  const hasRunning = executions.some((e) => e.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(fetchExecutions, 5000);
    return () => clearInterval(timer);
  }, [fetchExecutions, hasRunning]);

  const openCreate = useCallback(() => {
    setShowCreate(true);
    if (templateId === "comic-generation") { fetchCharacters(); fetchStyles(); }
  }, [templateId, fetchCharacters, fetchStyles]);

  const handleCreate = useCallback(async () => {
    if (!template) return;
    const fv = formValuesRef.current;
    if (template.params.some(p => p.required && !fv[p.name])) {
      toast("🔴 请填写所有必填项");
      return;
    }
    setExecuting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: template.id, params: formValuesRef.current }),
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
  }, [template]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${deleteTarget}`, { method: "DELETE" });
      if (res.ok) { toast("🟢 已删除"); fetchExecutions(); }
      else toast("🔴 删除失败");
    } catch { toast("🔴 请求失败"); }
    setDeleteTarget(null);
  }, [deleteTarget, fetchExecutions]);

  const handleBgmUpload = useCallback(async (file: File) => {
    setBgmUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/workflows/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.ok) { setFormValues({ ...formValues, bgm_file: data.tempPath }); toast("🟢 BGM 已上传"); }
      else toast(`🔴 ${data.error || "上传失败"}`);
    } catch { toast("🔴 上传失败"); }
    setBgmUploading(false);
  }, [formValues]);

  const handleFloorplanUpload = useCallback(async (file: File) => {
    setFpUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${BASE}/api/workflows/floorplan-upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.ok) { setFormValues({ ...formValues, floorplan: data.tempPath }); toast("🟢 户型图已上传"); }
      else toast(`🔴 ${data.error || "上传失败"}`);
    } catch { toast("🔴 上传失败"); }
    setFpUploading(false);
  }, [formValues]);

  const handleAiGenerate = useCallback(async () => {
    const title = formValuesRef.current["title"];
    const requirement = formValuesRef.current["contentRequirement"] || "";
    if (!title) { toast("请先填标题"); return; }
    const endpoint = template?.id === "comic-generation" ? "/comic-generate-content" : "/generate-content";
    setAiGenerating(true);
    try {
      const res = await fetch(`${BASE}/api/workflows${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, requirement }),
      });
      const data = await res.json();
      if (data.content) { setFormValues({ ...formValuesRef.current, content: data.content }); toast("🟢 内容已生成"); }
      else toast(`🔴 ${data.error || "生成失败"}`);
    } catch { toast("🔴 请求失败"); }
    setAiGenerating(false);
  }, [template]);

  // ─── 角色参考图 ───────────────────────────────────────────────

  const handleCharRefUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCharRefDataUrl(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleCharPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => setCharRefDataUrl(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const handleGenerateCharacter = useCallback(async () => {
    if (!charDesc.trim()) { toast("请先填写角色描述"); return; }
    setGeneratingChar(true);
    setPreviewUrl(null);
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/characters/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: charDesc, imageUrl: charRefDataUrl }),
      });
      const data = await res.json();
      if (data.ok && data.imageUrls?.[0]) {
        setPreviewUrl(data.imageUrls[0]);
        toast("🟢 已生成，满意后填写名称保存");
      } else {
        toast(`🔴 ${data.error || "生成失败"}`);
      }
    } catch { toast("🔴 请求失败"); }
    setGeneratingChar(false);
  }, [charDesc, charRefDataUrl]);

  const handleSaveCharacter = useCallback(async () => {
    if (!previewUrl) { toast("请先生成参考图"); return; }
    if (!charName.trim()) { toast("请填写名称"); return; }
    setSavingChar(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: charName, description: charDesc, imageUrl: previewUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        setCharacters(data.characters || []);
        setPreviewUrl(null); setCharName(""); setCharDesc(""); setCharRefDataUrl(null);
        toast("🟢 参考图已保存");
      } else {
        toast(`🔴 ${data.error || "保存失败"}`);
      }
    } catch { toast("🔴 请求失败"); }
    setSavingChar(false);
  }, [previewUrl, charName, charDesc]);

  const handleDeleteCharacter = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/characters/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) { setCharacters(data.characters || []); toast("🟢 已删除"); }
      else toast(`🔴 ${data.error || "删除失败"}`);
    } catch { toast("🔴 请求失败"); }
  }, []);

  // ─── 风格 ────────────────────────────────────────────────────

  const handleCreateStyle = useCallback(async () => {
    if (!styleName.trim()) { toast("请填写风格名称"); return; }
    setCreatingStyle(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/styles`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: styleName, description: styleDesc }),
      });
      const data = await res.json();
      if (data.ok) { setStyles(data.styles || []); setStyleName(""); setStyleDesc(""); toast("🟢 风格已创建"); }
      else toast(`🔴 ${data.error || "创建失败"}`);
    } catch { toast("🔴 请求失败"); }
    setCreatingStyle(false);
  }, [styleName, styleDesc]);

  const handleDeleteStyle = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${BASE}/api/workflows/assets/styles/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) { setStyles(data.styles || []); toast("🟢 已删除"); }
      else toast(`🔴 ${data.error || "删除失败"}`);
    } catch { toast("🔴 请求失败"); }
  }, []);

  const handleDeleteAssetConfirm = useCallback(async () => {
    if (!deleteAsset) return;
    if (deleteAsset.type === "character") await handleDeleteCharacter(deleteAsset.id);
    else await handleDeleteStyle(deleteAsset.id);
    setDeleteAsset(null);
  }, [deleteAsset, handleDeleteCharacter, handleDeleteStyle]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <span className="text-3xl">❓</span>
        <p className="text-sm">模板不存在</p>
        <button onClick={() => router.push("/workflow")}
          className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground">
          返回工作流主页
        </button>
      </div>
    );
  }

  const statusPriority: Record<string, number> = { failed: 0, running: 1, completed_with_warnings: 1.5, pending: 2, completed: 3 };
  const sortedExecutions = [...executions].sort((a, b) => {
    const pa = statusPriority[a.status] ?? 99;
    const pb = statusPriority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b-[3px] border-border">
        <button onClick={() => router.push("/workflow")}
          className="text-muted-foreground/70 hover:text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-lg font-bold text-foreground font-heading flex-1">{template?.label || "..."}</h2>
        <div className="flex gap-2">
          {templateId === "comic-generation" && (
            <>
              <button onClick={() => { setShowCharacters(true); fetchCharacters(); }}
                className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-card text-foreground">
                <Users className="w-3 h-3" />角色参考图
              </button>
              <button onClick={() => { setShowStyles(true); fetchStyles(); }}
                className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-card text-foreground">
                <Palette className="w-3 h-3" />风格
              </button>
            </>
          )}
          <button onClick={openCreate}
            className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-primary text-primary-foreground">
            <Plus className="w-3 h-3" />创建工作流
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {executions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">⚡</span>
            <p className="text-sm">暂无执行记录</p>
            <p className="text-xs text-muted-foreground/60">点击「创建工作流」开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sortedExecutions.map(exe => {
              const statusBar = exe.status === "failed" ? "var(--destructive)"
                : exe.status === "running" ? "var(--yellow)"
                : exe.status === "completed_with_warnings" ? "var(--yellow)"
                : exe.status === "completed" ? "var(--blue)" : "var(--muted-foreground)";
              const pct = Math.round((exe.completedSteps / exe.totalSteps) * 100);
              const awaiting = exe.status === "running" && (exe.runningSteps || 0) === 0 && exe.completedSteps < exe.totalSteps;
              return (
                <div key={exe.executionId}
                  className="brutal-btn bg-card p-3 cursor-pointer"
                  onClick={() => { window.location.href = `/workflow/execution/${exe.executionId}`; }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      exe.status === "completed" ? "bg-lime" :
                      exe.status === "completed_with_warnings" ? "bg-yellow" :
                      exe.status === "running" ? (awaiting ? "bg-yellow" : "bg-yellow animate-pulse") :
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
                       exe.status === "running" ? (awaiting ? "⏸ 待下一步" : "🔄 执行中") :
                       exe.status === "failed" ? "❌ 失败" : "⏸️ 待执行"}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(exe.executionId); }}
                      className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold cursor-pointer shrink-0">
                      删除
                    </button>
                  </div>
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

      {/* 创建弹窗（直接当前模板表单） */}
      {showCreate && template && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="brutal bg-card p-6 w-[480px] max-h-[80vh] overflow-auto"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-4">新建 {template.label}</h3>
            <div className="space-y-3">
              {template.params.filter(p => {
                if (p.name === "voice_id" && formValues["enable_tts"] === "no") return false;
                if (p.name === "bgm_volume" && formValues["enable_bgm"] === "no") return false;
                if (p.name === "bgm_file" && formValues["enable_bgm"] === "no") return false;
                return true;
              }).map(p => (
                <div key={p.name}>
                  <label className="text-xs text-muted-foreground block mb-1">
                    {p.label} {p.required && <span className="text-destructive">*</span>}
                  </label>
                  {p.name === "characterRef" ? (
                    <div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {characters.map(c => (
                          <div key={c.id} onClick={() => setFormValues({ ...formValues, characterRef: c.id })}
                            className={`shrink-0 cursor-pointer p-1 text-center ${formValues.characterRef === c.id ? "bg-yellow-soft" : ""}`}
                            style={{ border: `2px solid ${formValues.characterRef === c.id ? "var(--primary)" : "var(--border)"}` }}>
                            <img src={`${BASE}/api/workflows/assets/characters/${c.id}.png`} alt={c.name}
                              className="w-16 h-16 object-cover" />
                            <div className="text-xs mt-1 max-w-16 truncate">{c.name}</div>
                          </div>
                        ))}
                      </div>
                      {characters.length === 0 && (
                        <div className="text-xs text-muted-foreground">暂无参考图，请先点「角色参考图」创建</div>
                      )}
                    </div>
                  ) : p.name === "styleId" ? (
                    <select value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                      className="w-full px-2 py-1 text-xs border-2 border-border bg-card">
                      <option value="">选择风格</option>
                      {styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : p.type === "select" ? (
                    <select value={formValues[p.name] || ""} onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                      className="w-full px-2 py-1 text-xs border-2 border-border bg-card">
                      {p.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : p.type === "checkbox" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(p.options || []).map(o => {
                        const cur = (formValues[p.name] || "").split(",").filter(Boolean);
                        const on = cur.includes(o);
                        return (
                          <button key={o} type="button"
                            onClick={() => setFormValues({ ...formValues, [p.name]: (on ? cur.filter(x => x !== o) : [...cur, o]).join(",") })}
                            className={`px-2 py-0.5 text-xs font-bold cursor-pointer ${on ? "bg-blue text-white" : "bg-card text-foreground"}`}
                            style={{ border: "2px solid var(--border)" }}>
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  ) : p.name === "floorplan" ? (
                    <div className="flex gap-2 items-center">
                      <input type="text" value={formValues[p.name] || ""} readOnly placeholder="未选择图片"
                        className="flex-1 px-2 py-1 text-xs border-2 border-border bg-muted" />
                      <label className={`brutal-btn shrink-0 px-2 py-1 text-xs font-bold ${fpUploading ? "bg-muted text-muted-foreground" : "bg-orange text-white"}`}>
                        <Upload className="w-3 h-3 inline mr-1" />{fpUploading ? "上传中..." : "上传"}
                        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                          onChange={e => { const file = e.target.files?.[0]; if (file) handleFloorplanUpload(file); }} />
                      </label>
                    </div>
                  ) : p.name === "bgm_file" ? (
                    <div className="flex gap-2 items-center">
                      <input type="text" value={formValues[p.name] || ""} readOnly placeholder="未选择文件"
                        className="flex-1 px-2 py-1 text-xs border-2 border-border bg-muted" />
                      <label className={`brutal-btn shrink-0 px-2 py-1 text-xs font-bold ${bgmUploading ? "bg-muted text-muted-foreground" : "bg-orange text-white"}`}>
                        <Upload className="w-3 h-3 inline mr-1" />{bgmUploading ? "上传中..." : "上传"}
                        <input type="file" accept="audio/mp3,audio/wav,audio/m4a" className="hidden"
                          onChange={e => { const file = e.target.files?.[0]; if (file) handleBgmUpload(file); }} />
                      </label>
                    </div>
                  ) : p.type === "textarea" ? (
                    <div>
                      {p.name === "content" && (template.id === "video-generation" || template.id === "comic-generation") && (
                        <div className="flex gap-2">
                          <textarea value={formValues[p.name] || ""}
                            onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                            placeholder={p.placeholder || ""} rows={4}
                            className="flex-1 px-2 py-1 text-xs border-2 border-border resize-none" />
                          <button onClick={handleAiGenerate} disabled={aiGenerating}
                            className={`brutal-btn shrink-0 px-2 py-1 text-xs font-bold self-start ${aiGenerating ? "bg-muted text-muted-foreground" : "bg-blue text-white"}`}>
                            {aiGenerating ? "生成中..." : "✨ AI 智能生成"}
                          </button>
                        </div>
                      )}
                      {(p.name !== "content" || (template.id !== "video-generation" && template.id !== "comic-generation")) && (
                        <textarea value={formValues[p.name] || ""}
                          onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                          placeholder={p.placeholder || ""} rows={4}
                          className="w-full px-2 py-1 text-xs border-2 border-border resize-none" />
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
          </div>
        </div>
      )}

      {/* 角色参考图抽屉 */}
      <Root open={showCharacters} onOpenChange={setShowCharacters} swipeDirection="left">
        <Popup className="right-0 top-0 bottom-0 w-[480px] max-w-none rounded-none flex flex-col p-0 gap-0">
          <Header className="border-b px-4 py-3 shrink-0">
            <Title>角色参考图</Title>
            <Close>关闭</Close>
          </Header>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="brutal-sm bg-card p-3">
              <div className="text-xs font-bold mb-2">生成角色参考图</div>
              <textarea value={charDesc} onChange={e => setCharDesc(e.target.value)}
                onPaste={handleCharPaste}
                placeholder="描述所有角色，如：小明，20岁男生，红色T恤短发；小红，18岁女生，蓝色连衣裙长发；关系：同学"
                rows={3} className="w-full px-2 py-1 text-xs border-2 border-border resize-none" />
              <div className="flex items-center gap-2 mt-2">
                <label className={`brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold ${charRefDataUrl ? "bg-lime text-white" : "bg-card text-foreground"}`}>
                  <Upload className="w-3 h-3" />{charRefDataUrl ? "已传参考图" : "上传参考图(可选)"}
                  <input type="file" accept="image/*" className="hidden" onChange={handleCharRefUpload} />
                </label>
                <span className="text-xs text-muted-foreground/70">或 Ctrl+V 粘贴</span>
                {charRefDataUrl && (
                  <div className="flex items-center gap-1">
                    <img src={charRefDataUrl} alt="参考图" className="w-10 h-10 object-cover border border-border" />
                    <button onClick={() => setCharRefDataUrl(null)}
                      className="text-xs text-destructive cursor-pointer">清除</button>
                  </div>
                )}
              </div>
              <button onClick={handleGenerateCharacter} disabled={generatingChar}
                className={`brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold mt-2 ${generatingChar ? "bg-muted text-muted-foreground" : "bg-blue text-white"}`}>
                <ImagePlus className="w-3 h-3" />{generatingChar ? "生成中..." : "AI 生成"}
              </button>
              {previewUrl && (
                <div className="mt-3">
                  <img src={previewUrl} alt="预览" className="w-full border-2 border-border" />
                  <div className="flex gap-2 mt-2 items-center">
                    <input value={charName} onChange={e => setCharName(e.target.value)}
                      placeholder="名称" className="flex-1 px-2 py-1 text-xs border-2 border-border" />
                    <button onClick={handleSaveCharacter} disabled={savingChar}
                      className={`brutal-btn px-3 py-1 text-xs font-bold shrink-0 ${savingChar ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
                      {savingChar ? "保存中..." : "保存"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="text-xs font-bold">已保存 ({characters.length})</div>
            {characters.map(c => (
              <div key={c.id} className="flex items-center gap-2 p-2 bg-card border-2 border-border">
                <img src={`${BASE}/api/workflows/assets/characters/${c.id}.png`} alt={c.name}
                  className="w-14 h-14 object-cover border border-border shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.description}</div>
                  <div className="text-xs text-muted-foreground/60">{formatDate(c.createdAt)}</div>
                </div>
                <button onClick={() => setDeleteAsset({ type: "character", id: c.id, name: c.name })}
                  className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold shrink-0">删除</button>
              </div>
            ))}
            {characters.length === 0 && <div className="text-xs text-muted-foreground">暂无参考图</div>}
          </div>
        </Popup>
      </Root>

      {/* 风格抽屉 */}
      <Root open={showStyles} onOpenChange={setShowStyles} swipeDirection="left">
        <Popup className="right-0 top-0 bottom-0 w-[480px] max-w-none rounded-none flex flex-col p-0 gap-0">
          <Header className="border-b px-4 py-3 shrink-0">
            <Title>风格</Title>
            <Close>关闭</Close>
          </Header>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="brutal-sm bg-card p-3">
              <div className="text-xs font-bold mb-2">创建风格</div>
              <input value={styleName} onChange={e => setStyleName(e.target.value)}
                placeholder="名称，如：黑白日式" className="w-full px-2 py-1 text-xs border-2 border-border mb-2" />
              <textarea value={styleDesc} onChange={e => setStyleDesc(e.target.value)}
                placeholder="风格描述，如：黑白日式漫画，网点阴影，粗线条，动作夸张"
                rows={3} className="w-full px-2 py-1 text-xs border-2 border-border resize-none" />
              <button onClick={handleCreateStyle} disabled={creatingStyle}
                className={`brutal-btn px-3 py-1 text-xs font-bold mt-2 ${creatingStyle ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
                {creatingStyle ? "创建中..." : "创建"}
              </button>
            </div>
            <div className="text-xs font-bold">已创建 ({styles.length})</div>
            {styles.map(s => (
              <div key={s.id} className="flex items-center gap-2 p-2 bg-card border-2 border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.description}</div>
                  <div className="text-xs text-muted-foreground/60">{formatDate(s.createdAt)}</div>
                </div>
                <button onClick={() => setDeleteAsset({ type: "style", id: s.id, name: s.name })}
                  className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold shrink-0">删除</button>
              </div>
            ))}
            {styles.length === 0 && <div className="text-xs text-muted-foreground">暂无风格</div>}
          </div>
        </Popup>
      </Root>

      {/* 资产删除确认 */}
      <ConfirmDialog
        open={!!deleteAsset}
        onOpenChange={(open) => { if (!open) setDeleteAsset(null); }}
        title="确认删除"
        description={`确定要删除「${deleteAsset?.name}」吗？此操作不可撤销。`}
        onConfirm={handleDeleteAssetConfirm}
      />

      {/* 执行删除确认 */}
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
