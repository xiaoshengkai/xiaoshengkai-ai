"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Upload, Copy, Trash2, ExternalLink, Loader2, QrCode } from "lucide-react";

interface MediaItem {
  token: string;
  title: string;
  mime: string;
  size: number;
  createdAt: number;
}

interface UploadResult {
  token: string;
  url: string;
  title: string;
  qrDataUrl: string;
}

const publicUrl = (token: string) => `${window.location.origin}/m/${token}`;
const fmtSize = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const fmtTime = (t: number) => new Date(t).toLocaleString("zh-CN", { hour12: false });

export default function VideoQrTool() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [qrLoading, setQrLoading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tools/video-qr`);
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

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      const res = await fetch(`${BASE}/api/tools/video-qr`, { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.ok) {
        const url = publicUrl(data.token);
        const qrDataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2 });
        setResult({ token: data.token, url, title: data.title, qrDataUrl });
        toast("🟢 生成成功");
        setFile(null);
        setTitle("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchItems();
      } else {
        toast(`🔴 ${data.error || "生成失败"}`);
      }
    } catch {
      toast("🔴 请求失败");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (token: string) => {
    if (!confirm("删除后链接立即失效，确定删除？")) return;
    try {
      const res = await fetch(`${BASE}/api/tools/video-qr`, {
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
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch {
      toast("复制失败");
    }
  };

  const toggleQr = async (token: string) => {
    if (qrMap[token]) {
      setQrMap((prev) => {
        const next = { ...prev };
        delete next[token];
        return next;
      });
      return;
    }
    setQrLoading(token);
    try {
      const d = await QRCode.toDataURL(publicUrl(token), { width: 256, margin: 2 });
      setQrMap((prev) => ({ ...prev, [token]: d }));
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
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <h2 className="text-lg font-bold text-foreground font-heading">视频转二维码</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* 上传区 */}
        <div className="brutal bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Upload className="w-4 h-4" />
            <span className="text-sm font-bold text-foreground">上传视频</span>
          </div>
          <div className="flex flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp4,.mov,.webm,.avi,.mkv,video/mp4,video/quicktime,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-xs font-mono"
            />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full px-2 py-1.5 text-sm border-2 border-border"
            />
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className={`brutal-btn inline-flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-bold ${
                !file || uploading ? "bg-muted text-muted-foreground" : "bg-blue text-white"
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 转码中（请勿关闭，约需几秒~几十秒）…
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" /> 生成二维码
                </>
              )}
            </button>
            <p className="text-[10px] text-muted-foreground">支持 mp4/mov/webm/avi/mkv，≤200MB，将自动转码为 H.264</p>
          </div>
        </div>

        {/* 结果区 */}
        {result && (
          <div className="brutal bg-card p-4 flex flex-col items-center gap-3">
            <span className="text-sm font-bold text-foreground">扫码观看</span>
            <img src={result.qrDataUrl} alt="二维码" className="w-48 h-48 border-2 border-border" />
            <div className="flex items-center gap-2 w-full max-w-md">
              <code className="flex-1 min-w-0 truncate text-xs font-mono px-2 py-1 border-2 border-border bg-muted/50">
                {result.url}
              </code>
              <button
                onClick={() => copy(result.url)}
                className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
              >
                <Copy className="w-3 h-3" /> 复制
              </button>
              <button
                onClick={() => downloadQr(result.qrDataUrl, result.token)}
                className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
              >
                下载
              </button>
            </div>
          </div>
        )}

        {/* 列表区 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <QrCode className="w-4 h-4" />
            <span className="text-sm font-bold text-foreground">已生成（{items.length}）</span>
          </div>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无记录</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.token} className="brutal bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-foreground truncate block">
                        {item.title || item.token.slice(0, 10) + "…"}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {fmtSize(item.size)} · {fmtTime(item.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => copy(publicUrl(item.token))}
                        className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
                      >
                        <Copy className="w-3 h-3" /> 复制
                      </button>
                      <a
                        href={publicUrl(item.token)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
                      >
                        <ExternalLink className="w-3 h-3" /> 打开
                      </a>
                      <button
                        onClick={() => toggleQr(item.token)}
                        className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-foreground"
                      >
                        <QrCode className="w-3 h-3" />
                        {qrLoading === item.token ? "…" : qrMap[item.token] ? "收起" : "二维码"}
                      </button>
                      <button
                        onClick={() => handleDelete(item.token)}
                        className="brutal-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold bg-card text-destructive"
                      >
                        <Trash2 className="w-3 h-3" /> 删除
                      </button>
                    </div>
                  </div>
                  {qrMap[item.token] && (
                    <div className="flex items-center gap-2 mt-2">
                      <img src={qrMap[item.token]} alt="二维码" className="w-20 h-20 border-2 border-border" />
                      <button
                        onClick={() => downloadQr(qrMap[item.token], item.token)}
                        className="brutal-btn px-2 py-1 text-xs font-bold bg-card text-foreground"
                      >
                        下载二维码
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
