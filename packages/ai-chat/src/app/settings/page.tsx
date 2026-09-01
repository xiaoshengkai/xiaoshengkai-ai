"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import ModuleSelector from "@/components/settings/module-selector";
import ProviderConfigCard from "@/components/settings/provider-config";

interface Providers {
  [key: string]: {
    enabled: boolean;
    baseURL: string;
    apiKey: string;
    models: Record<string, string>;
  };
}

interface Selection {
  [module: string]: { provider: string; model: string };
}

interface ProviderStatus {
  available: boolean | null;
  balanceText?: string;
  note?: string;
  error?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "智谱 GLM",
  qwen: "通义千问",
  volcengine: "火山引擎 Doubao",
};

export default function SettingsPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirtyProv, setDirtyProv] = useState(false);
  const [dirtySel, setDirtySel] = useState(false);
  const [status, setStatus] = useState<Record<string, ProviderStatus> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings/providers`).then((r) => r.json()),
      fetch(`${BASE}/api/settings/selection`).then((r) => r.json()),
    ]).then(([p, s]) => {
      setProviders(p);
      setSelection(s);
    });
  }, []);

  const loadBalance = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`${BASE}/api/settings/balance`);
      const data = await r.json();
      const map: Record<string, ProviderStatus> = {};
      for (const p of data.providers || []) map[p.id] = p;
      setStatus(map);
    } catch {
      setStatus({});
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const handleProviderChange = useCallback((id: string, config: unknown) => {
    setProviders((prev) => (prev ? { ...prev, [id]: config as Providers[string] } : prev));
    setDirtyProv(true);
  }, []);

  const handleSelectionChange = useCallback((module: string, provider: string, model: string) => {
    setSelection((prev) => (prev ? { ...prev, [module]: { provider, model } } : prev));
    setDirtySel(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (dirtyProv && providers) {
        const r = await fetch(`${BASE}/api/settings/providers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(providers),
        });
        if (!r.ok) throw new Error("providers save failed");
        setDirtyProv(false);
      }
      if (dirtySel && selection) {
        const r = await fetch(`${BASE}/api/settings/selection`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        });
        if (!r.ok) throw new Error("selection save failed");
        setDirtySel(false);
      }
      toast("🟢 设置已保存");
    } catch (e) {
      toast(`🔴 保存失败: ${e instanceof Error ? e.message : "未知错误"}`);
    }
    setSaving(false);
  }, [dirtyProv, dirtySel, providers, selection]);

  if (!providers || !selection) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <p className="text-xs text-muted-foreground font-mono">加载中...</p>
      </div>
    );
  }

  const hasChanges = dirtyProv || dirtySel;

  return (
    <div data-theme="pink" className="flex flex-col h-full">
      {/* 头部：与其他页面统一 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-border shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-foreground font-heading">系统设置</h2>
          <span className="text-xs text-muted-foreground font-mono hidden md:inline">
            7 模块 · 4 Provider · 实时生效</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
          >
            返回聊天
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`brutal-btn px-3 py-1.5 text-xs font-bold ${hasChanges && !saving ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
          >
            {saving ? "保存中..." : hasChanges ? "保存更改" : "已保存"}
          </button>
        </div>
      </div>

      {/* 主体（可滚动） */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

      {/* 生效提示：所有配置均 fresh-read，保存即生效（2026-08-20 移除重启机制） */}
      <div className="brutal bg-yellow-soft p-3 text-xs font-mono">
        <p className="text-foreground/70">
          所有配置（聊天/图片/向量/MCP/工作流/定时任务）保存后立即生效，无需重启。
        </p>
      </div>

      {/* 模型配置 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground font-heading">🔑 模型配置</h2>
          <button
            onClick={loadBalance}
            disabled={refreshing}
            className="brutal-btn px-2 py-1 text-xs font-bold bg-muted text-foreground disabled:opacity-50"
          >
            {refreshing ? "查询中..." : "刷新余量"}
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {Object.entries(providers).map(([id, config]) => (
            <ProviderConfigCard
              key={id}
              id={id}
              label={PROVIDER_LABELS[id] || id}
              config={config}
              onChange={handleProviderChange}
              status={status?.[id]}
            />
          ))}
        </div>
      </div>

      {/* 模型选择 */}
      <div>
        <h2 className="text-sm font-bold text-foreground mb-3 font-heading">📌 模块模型选择</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <ModuleSelector module="chat" current={selection.chat} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="media" current={selection.media} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="vision" current={selection.vision || { provider: "minimax", model: "MiniMax-M3" }} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="vector" current={selection.vector} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="workflow" current={selection.workflow} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="tts" current={selection.tts || { provider: "minimax", model: "speech-2.8-hd" }} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="music" current={selection.music || { provider: "qwen", model: "fun-music-v1" }} onChange={handleSelectionChange} statusByProvider={status} />
        </div>
      </div>
      </div>
    </div>
  );
}