"use client";

import { useState } from "react";

interface ProviderConfigProps {
  id: string;
  label: string;
  config: {
    enabled: boolean;
    baseURL: string;
    anthropicBaseURL?: string;
    apiKey: string;
    models: Record<string, string>;
  };
  onChange: (id: string, config: unknown) => void;
}

const MODEL_LABELS: Record<string, string> = {
  chat: "聊天",
  text: "文本",
  image: "图片",
  embedding: "向量",
  tts: "TTS",
  bgm: "BGM",
};

const MODEL_TYPE_COLORS: Record<string, string> = {
  chat: "bg-blue-soft text-foreground border-blue",
  text: "bg-blue-soft text-foreground border-blue",
  image: "bg-lime-soft text-foreground border-lime",
  embedding: "bg-purple-soft text-foreground border-purple",
  tts: "bg-orange-soft text-foreground border-orange",
  bgm: "bg-pink-soft text-foreground border-pink",
};

function getModelLabel(key: string) {
  return MODEL_LABELS[key] || key;
}

function maskKey(key: string) {
  if (!key || key.length < 8) return key;
  return key.slice(0, 3) + "****" + key.slice(-4);
}

export default function ProviderConfigCard({ id, label, config, onChange }: ProviderConfigProps) {
  const [showKey, setShowKey] = useState(false);
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(config);

  const update = (patch: Record<string, unknown>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(id, next);
  };

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}
      className="brutal bg-card p-3">
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <h3 className="text-xs font-bold text-foreground inline">{label} {local.enabled ? "✓" : "✗"}</h3>
        <span className="text-xs text-muted-foreground ml-2">{open ? "点击收起" : "点击展开"}</span>
      </summary>

      <div className="mt-3 space-y-2 text-xs font-mono">
        <div>
          <label className="text-muted-foreground block mb-0.5">BASE_URL</label>
          <input
            type="text"
            value={local.baseURL}
            onChange={(e) => update({ baseURL: e.target.value })}
            className="w-full px-2 py-1 border-2 border-border bg-card text-xs focus:outline-none focus:border-ring"
            style={{ boxShadow: "var(--shadow-sm)" }}
          />
        </div>

        {local.anthropicBaseURL !== undefined && (
          <div>
            <label className="text-muted-foreground block mb-0.5">Anthropic BASE_URL (聊天)</label>
            <input
              type="text"
              value={local.anthropicBaseURL}
              onChange={(e) => update({ anthropicBaseURL: e.target.value })}
              className="w-full px-2 py-1 border-2 border-border bg-card text-xs focus:outline-none focus:border-ring"
              style={{ boxShadow: "var(--shadow-sm)" }}
            />
          </div>
        )}

        <div>
          <label className="text-muted-foreground block mb-0.5">API_KEY</label>
          <div className="flex gap-1">
            <input
              type={showKey ? "text" : "password"}
              value={local.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className="flex-1 px-2 py-1 border-2 border-border bg-card text-xs focus:outline-none focus:border-ring"
              style={{ boxShadow: "var(--shadow-sm)" }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="px-2 py-1 border-2 border-border bg-muted text-xs cursor-pointer hover:bg-muted"
              style={{ boxShadow: "var(--shadow-sm)" }}
            >
              {showKey ? "🙈" : "👁️"}
            </button>
          </div>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            当前: {local.apiKey ? maskKey(local.apiKey) : "未设置（将使用环境变量）"}
          </p>
        </div>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={local.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="cursor-pointer"
          />
          启用
        </label>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(local.models).map(([key, val]) => (
            <div key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs ${MODEL_TYPE_COLORS[key] || "bg-muted text-muted-foreground border-border"}`}
              style={{ boxShadow: "var(--shadow-sm)" }}>
              <span className="opacity-70">{getModelLabel(key)}</span>
              <span className="font-bold">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}