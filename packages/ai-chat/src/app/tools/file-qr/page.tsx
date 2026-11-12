"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  ArrowLeft,
  Plus,
  Upload,
  Copy,
  Trash2,
  ExternalLink,
  Loader2,
  QrCode,
  Link as LinkIcon,
  FileImage,
  FileText,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface MediaItem {
  token: string;
  kind: "video" | "image" | "pdf" | "url";
  title: string;
  mime?: string;
  size?: number;
  targetUrl?: string;
  createdAt: number;
}

const KIND_META: Record<string, { label: string; emoji: string; accent: string }> = {
  video: { label: "视频", emoji: "🎬", accent: "bg-blue-soft" },
  image: { label: "图片", emoji: "🖼️", accent: "bg-pink-soft" },
  pdf: { label: "PDF", emoji: "📄", accent: "bg-orange-soft" },
  url: { label: "链接", emoji: "🔗", accent: "bg-yellow-soft" },
};

const ACCEPT = ".mp4,.mov,.webm,.avi,.mkv,.png,.jpg,.jpeg,.gif,.webp,.pdf";

const publicUrl = (item: MediaItem) =>
  item.kind === "url" ? item.targetUrl || "" : `${window.location.origin}/m/${item.token}`;

const fmtSize = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false });

export default function FileQrTool() {
  const router = useRouter();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [qrLoading, setQrLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 新建弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [urlText, setUrlText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tools/file-qr`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openModal = () => {
    setModalOpen(true);
    setTab("file");
    setFile(null);
    setTitle("");
    setUrlText("");
  };

  const closeModal = () => {
    setModalOpen(false);
    setBusy(false);
  };

  const handleCreate = async () => {
    if (tab === "file") {
      if (!file) return;
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("title", title);
        const res = await fetch(`${BASE}/api/tools/file-qr`, { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast("🟢 生成成功");
          closeModal();
          if (fileInputRef.current) fileInputRef.current.value = "";
          fetchItems();
        } else {
          toast(`🔴 ${data.error || "生成失败"}`);
        }
      } catch {
        toast("🔴 请求失败");
      } finally {
        setBusy(false);
      }
    } else {
      if (!urlText.trim()) {
        toast("请填写链接");
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(`${BASE}/api/tools/file-qr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: urlText, title }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast("🟢 生成成功");
          closeModal();
          fetchItems();
        } else {
          toast(`🔴 ${data.error || "生成失败"}`);
        }
      } catch {
        toast("🔴 请求失败");
      } finally {
        setBusy(false);
      }
    }
  };

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const token = deleteTarget;
    setDeleteTarget(null);
    try {
      const res = await fetch(`${BASE}/api/tools/file-qr`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("🟢 已删除");
        fetchItems();
      } else {
        toast("🔴 删除失败");
      }
    } catch {
      toast("🔴 请求失败");
    }
  }, [deleteTarget, fetchItems]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      toast("复制失败");
    }
  };

  const toggleQr = async (item: MediaItem) => {
    if (qrMap[item.token]) {
      setQrMap((prev) => {
        const next = { ...prev };
        delete next[item.token];
        return next;
      });
      return;
    }
    setQrLoading(item.token);
    try {
      const d = await QRCode.toDataURL(publicUrl(item), { width: 256, margin: 2 });
      setQrMap((prev) => ({ ...prev, [item.token]: d }));
    } catch {
      toast("二维码生成失败");
    } finally {
      setQrLoading(null);
    }
  };

  const downloadQr = (dataUrl: string, token: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `qr-${token.slice(0, 8)}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-border">
        <button
          onClick={() => router.push("/tools")}
          className="text-muted-foreground/70 hover:text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-foreground font-heading">文件转二维码</h2>
          <p className="text-xs text-muted-foreground">上传文件或粘贴链接，生成可分享的公开二维码</p>
        </div>
        <button
          onClick={openModal}
          className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary text-primary-foreground"
        >
          <Plus className="w-3.5 h-3.5" /> 新建二维码
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-4xl">🔳</span>
            <p className="text-sm">还没有二维码</p>
            <p className="text-xs text-muted-foreground/60">点右上角「新建二维码」开始</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const meta = KIND_META[item.kind] || { label: item.kind, emoji: "📦", accent: "bg-muted" };
              const url = publicUrl(item);
              const displayTitle = item.title || (item.kind === "url" ? url : item.token.slice(0, 10) + "…");
              return (
                <div key={item.token} className="brutal bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 shrink-0 border-2 border-border flex items-center justify-center text-base ${meta.accent}`}>
                        {meta.emoji}
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-black text-foreground truncate block">{displayTitle}</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`brutal-chip px-1.5 py-0 text-[10px] ${meta.accent}`}>{meta.label}</span>
                          {item.size !== undefined && (
                            <span className="text-[10px] text-muted-foreground/70 font-mono">{fmtSize(item.size)}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground/70 font-mono">{fmtTime(item.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => copy(url)}
                        className="brutal-sm bg-card text-foreground px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> 复制
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brutal-sm bg-card text-foreground px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> 打开
                      </a>
                      <button
                        onClick={() => toggleQr(item)}
                        className="brutal-sm bg-card text-foreground px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <QrCode className="w-3 h-3" />
                        {qrLoading === item.token ? "…" : qrMap[item.token] ? "收起" : "二维码"}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(item.token)}
                        className="brutal-sm bg-destructive text-white px-2 py-0.5 text-xs font-bold inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> 删除
                      </button>
                    </div>
                  </div>
                  {qrMap[item.token] && (
                    <div className="flex items-center gap-2 mt-3 pl-12">
                      <img src={qrMap[item.token]} alt="二维码" className="w-20 h-20 border-2 border-border" />
                      <button
                        onClick={() => downloadQr(qrMap[item.token], item.token)}
                        className="brutal-btn px-2 py-1 text-xs font-bold bg-primary text-primary-foreground"
                      >
                        下载二维码
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeModal}>
          <div
            className="brutal bg-card w-[480px] max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
              <h3 className="text-sm font-bold text-foreground font-heading">新建二维码</h3>
              <button onClick={closeModal} className="text-muted-foreground/70 hover:text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* tab 切换 */}
            <div className="flex gap-2 p-3 border-b-2 border-border">
              <button
                onClick={() => setTab("file")}
                className={`brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold ${
                  tab === "file" ? "bg-blue text-white" : "bg-card text-muted-foreground"
                }`}
              >
                <Upload className="w-3.5 h-3.5" /> 上传文件
              </button>
              <button
                onClick={() => setTab("url")}
                className={`brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold ${
                  tab === "url" ? "bg-blue text-white" : "bg-card text-muted-foreground"
                }`}
              >
                <LinkIcon className="w-3.5 h-3.5" /> 粘贴链接
              </button>
            </div>

            <div className="p-4 space-y-3">
              {tab === "file" ? (
                <>
                  <div className="flex gap-2 items-center">
                    <label
                      className={`brutal-btn inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold shrink-0 ${
                        file ? "bg-lime text-white" : "bg-card text-foreground"
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {file ? "已选择" : "选择文件"}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">
                      {file ? file.name : "未选择文件"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    🖼️ 图片 png/jpg/jpeg/gif/webp（≤20M）· 🎬 视频 mp4/mov/webm/avi/mkv（≤200M）· 📄 PDF（≤50M）
                  </p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border"
                  />
                  <p className="text-[10px] text-muted-foreground">二维码直接编码该链接，扫码即跳转</p>
                </>
              )}

              <div>
                <label className="text-xs text-muted-foreground block mb-1">标题（可选）</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="便于列表里识别"
                  className="w-full px-2 py-1.5 text-sm border-2 border-border"
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button onClick={closeModal} className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground">
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={busy || (tab === "file" ? !file : !urlText.trim())}
                  className={`brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold ${
                    busy || (tab === "file" ? !file : !urlText.trim())
                      ? "bg-muted text-muted-foreground"
                      : "bg-blue text-white"
                  }`}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中…
                    </>
                  ) : (
                    <>
                      <QrCode className="w-3.5 h-3.5" /> 生成二维码
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="删除二维码"
        description="删除后链接立即失效，确定删除？此操作不可撤销。"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
