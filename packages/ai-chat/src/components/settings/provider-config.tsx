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
  chat: "bg-blue-50 text-blue-700 border-blue-300",
  text: "bg-blue-50 text-blue-700 border-blue-300",
  image: "bg-green-50 text-green-700 border-green-300",
  embedding: "bg-purple-50 text-purple-700 border-purple-300",
  tts: "bg-orange-50 text-orange-700 border-orange-300",
  bgm: "bg-pink-50 text-pink-700 border-pink-300",
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
      className="pixel-card p-3" style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A", background: "#fff" }}>
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <h3 className="text-xs font-bold text-gray-800 inline">{label} {local.enabled ? "✓" : "✗"}</h3>
        <span className="text-xs text-gray-400 ml-2">{open ? "点击收起" : "点击展开"}</span>
      </summary>

      <div className="mt-3 space-y-2 text-xs font-[family-name:var(--font-pixel)]">
        <div>
          <label className="text-gray-500 block mb-0.5">BASE_URL</label>
          <input
            type="text"
            value={local.baseURL}
            onChange={(e) => update({ baseURL: e.target.value })}
            className="w-full px-2 py-1 border-2 border-[#1A1A1A] bg-white text-xs focus:outline-none focus:border-[#9B59B6]"
            style={{ boxShadow: "1px 1px 0 #e5e7eb" }}
          />
        </div>

        {local.anthropicBaseURL !== undefined && (
          <div>
            <label className="text-gray-500 block mb-0.5">Anthropic BASE_URL (聊天)</label>
            <input
              type="text"
              value={local.anthropicBaseURL}
              onChange={(e) => update({ anthropicBaseURL: e.target.value })}
              className="w-full px-2 py-1 border-2 border-[#1A1A1A] bg-white text-xs focus:outline-none focus:border-[#9B59B6]"
              style={{ boxShadow: "1px 1px 0 #e5e7eb" }}
            />
          </div>
        )}

        <div>
          <label className="text-gray-500 block mb-0.5">API_KEY</label>
          <div className="flex gap-1">
            <input
              type={showKey ? "text" : "password"}
              value={local.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              className="flex-1 px-2 py-1 border-2 border-[#1A1A1A] bg-white text-xs focus:outline-none focus:border-[#9B59B6]"
              style={{ boxShadow: "1px 1px 0 #e5e7eb" }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="px-2 py-1 border-2 border-[#1A1A1A] bg-gray-50 text-xs cursor-pointer hover:bg-gray-100"
              style={{ boxShadow: "1px 1px 0 #e5e7eb" }}
            >
              {showKey ? "🙈" : "👁️"}
            </button>
          </div>
          <p className="text-gray-400 mt-0.5 text-[10px]">
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
            <div key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 border text-xs ${MODEL_TYPE_COLORS[key] || "bg-gray-50 text-gray-500 border-gray-300"}`}
              style={{ boxShadow: "1px 1px 0 #e5e7eb" }}>
              <span className="opacity-70">{getModelLabel(key)}</span>
              <span className="font-bold">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}