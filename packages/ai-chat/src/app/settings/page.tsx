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
    anthropicBaseURL?: string;
    apiKey: string;
    models: Record<string, string>;
  };
}

interface Selection {
  [module: string]: { provider: string; model: string };
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "智谱 GLM",
};

export default function SettingsPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirtyProv, setDirtyProv] = useState(false);
  const [dirtySel, setDirtySel] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings/providers`).then((r) => r.json()),
      fetch(`${BASE}/api/settings/selection`).then((r) => r.json()),
    ]).then(([p, s]) => {
      setProviders(p);
      setSelection(s);
    });
  }, []);

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
        <p className="text-xs text-gray-400 font-[family-name:var(--font-pixel)]">加载中...</p>
      </div>
    );
  }

  const hasChanges = dirtyProv || dirtySel;

  return (
    <div className="min-h-screen bg-white p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 font-[family-name:var(--font-pixel)]">⚙️ 系统设置</h1>
          <p className="text-xs mt-0.5 font-[family-name:var(--font-pixel)] flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border-2 border-[#1A1A1A] bg-white"
              style={{ boxShadow: "2px 2px 0 #e5e7eb" }}>
              <span className="text-base">💬</span>
              <span className="text-gray-700">6 个 AI 模块</span>
            </span>
            <span className="text-gray-400 font-bold">×</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border-2 border-[#1A1A1A] bg-white"
              style={{ boxShadow: "2px 2px 0 #e5e7eb" }}>
              <span className="text-base">⚙️</span>
              <span className="text-gray-700">3 个 Provider</span>
            </span>
            <span className="text-gray-400 font-bold">·</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border-2 border-[#1A1A1A] bg-white"
              style={{ boxShadow: "2px 2px 0 #e5e7eb" }}>
              <span className="text-base">⚡</span>
              <span className="text-gray-700">实时生效</span>
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="px-3 py-1.5 text-xs font-bold cursor-pointer border-2 border-[#1A1A1A] bg-white"
            style={{ boxShadow: "2px 2px 0 #1A1A1A" }}
          >
            返回聊天
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-3 py-1.5 text-xs font-bold cursor-pointer border-2 border-[#1A1A1A]"
            style={{
              background: hasChanges && !saving ? "#9B59B6" : "#e2e8f0",
              color: hasChanges && !saving ? "#fff" : "#94a3b8",
              boxShadow: "2px 2px 0 #1A1A1A",
            }}
          >
            {saving ? "保存中..." : hasChanges ? "保存更改" : "已保存"}
          </button>
        </div>
      </div>

      {/* 重启提示 */}
      <div
        className="p-3 border-2 border-yellow-500 bg-yellow-50 text-xs font-[family-name:var(--font-pixel)]"
        style={{ boxShadow: "2px 2px 0 #1A1A1A" }}
      >
        <p className="font-bold text-yellow-700">⚠️ 注意</p>
        <p className="text-yellow-600 mt-1">
          修改配置后，聊天模型、图片生成、向量检索 立即生效，无需重启。
        </p>
        <p className="text-yellow-600 mt-0.5">
          MCP 进程和定时任务需重启以应用新配置。工作流 CLI 每次自动创建新进程，无需重启。
        </p>
        <button
          onClick={async () => {
            try {
              const r = await fetch(`${BASE}/api/settings/restart-services`, { method: "POST" });
              const d = await r.json();
              if (d.ok) toast("🟢 已通知 MCP 重建, 定时任务已终止");
              else toast(`🔴 ${d.error || "重启失败"}`);
            } catch { toast("🔴 重启请求失败"); }
          }}
          className="mt-2 px-3 py-1 text-xs font-bold cursor-pointer border-2 border-yellow-600 bg-yellow-100"
          style={{ boxShadow: "2px 2px 0 #1A1A1A" }}
        >
          重启 MCP / 定时任务
        </button>
      </div>

      {/* 模型选择 */}
      <div>
        <h2 className="text-sm font-bold text-gray-800 mb-3 font-[family-name:var(--font-pixel)]">📌 模块模型选择</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <ModuleSelector module="chat" current={selection.chat} onChange={handleSelectionChange} />
          <ModuleSelector module="media" current={selection.media} onChange={handleSelectionChange} />
          <ModuleSelector module="vector" current={selection.vector} onChange={handleSelectionChange} />
          <ModuleSelector module="workflow" current={selection.workflow} onChange={handleSelectionChange} />
          <ModuleSelector module="tts" current={selection.tts || { provider: "minimax", model: "speech-2.8-hd" }} onChange={handleSelectionChange} />
          <ModuleSelector module="bgm" current={selection.bgm || { provider: "minimax", model: "music-2.6" }} onChange={handleSelectionChange} />
        </div>
      </div>

      {/* 模块配置 */}
      <div>
        <h2 className="text-sm font-bold text-gray-800 mb-3 font-[family-name:var(--font-pixel)]">🔑 模块配置</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {Object.entries(providers).map(([id, config]) => (
            <ProviderConfigCard
              key={id}
              id={id}
              label={PROVIDER_LABELS[id] || id}
              config={config}
              onChange={handleProviderChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}