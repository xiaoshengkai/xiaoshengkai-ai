"use client";

import { BASE } from "@/lib/utils/utils";
import { useCallback } from "react";

const MODULE_OPTIONS: Record<string, { label: string; icon: string; providers: { id: string; label: string; model?: string; multimodal?: boolean }[] }> = {
  chat: {
    label: "聊天模型",
    icon: "💬",
    providers: [
      { id: "deepseek", label: "DeepSeek", model: "deepseek-v4-pro (自动路由)", multimodal: false },
      { id: "minimax", label: "MiniMax M3", model: "MiniMax-M3", multimodal: true },
      { id: "glm", label: "GLM-5.2", model: "glm-5.2", multimodal: false },
      { id: "qwen", label: "Qwen3.8-Max", model: "qwen3.8-max", multimodal: true },
    ],
  },
  media: {
    label: "图片生成",
    icon: "🖼️",
    providers: [
      { id: "minimax", label: "MiniMax image-01", model: "image-01" },
      { id: "qwen", label: "Qwen-Image-3.0-Pro", model: "qwen-image-3.0-pro" },
    ],
  },
  vector: {
    label: "向量模型",
    icon: "📊",
    providers: [
      { id: "glm", label: "智谱 embedding-3", model: "embedding-3" },
    ],
  },
  workflow: {
    label: "MCP/工作流/定时任务",
    icon: "🔧",
    providers: [
      { id: "deepseek", label: "DeepSeek Pro (自动路由)", model: "deepseek-v4-pro", multimodal: false },
      { id: "minimax", label: "MiniMax M3", model: "MiniMax-M3", multimodal: true },
      { id: "glm", label: "GLM-5.2", model: "glm-5.2", multimodal: false },
      { id: "qwen", label: "Qwen3.8-Max", model: "qwen3.8-max", multimodal: true },
    ],
  },
  tts: {
    label: "TTS 语音合成",
    icon: "🎙️",
    providers: [
      { id: "minimax", label: "MiniMax speech-2.8-hd", model: "speech-2.8-hd" },
    ],
  },
  bgm: {
    label: "BGM 音乐生成",
    icon: "🎵",
    providers: [
      { id: "minimax", label: "MiniMax music-2.6", model: "music-2.6" },
    ],
  },
};

interface ModuleSelectorProps {
  module: string;
  current: { provider: string; model: string };
  onChange: (module: string, provider: string, model: string) => void;
  disabled?: boolean;
}

export default function ModuleSelector({ module, current, onChange, disabled }: ModuleSelectorProps) {
  const info = MODULE_OPTIONS[module];
  if (!info) return null;

  return (
    <div className="brutal bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{info.icon}</span>
        <h3 className="text-xs font-bold text-foreground">{info.label}</h3>
      </div>
      <div className="space-y-1">
        {info.providers.map((opt) => {
          const selected = current.provider === opt.id && (opt.model ? current.model === opt.model : true);
          return (
            <button
              key={`${opt.id}-${opt.model || ""}`}
              onClick={() => onChange(module, opt.id, opt.model || "")}
              disabled={disabled}
              className={`w-full text-left px-3 py-2 text-xs font-mono cursor-pointer border-2 transition-colors flex items-start gap-2
                ${selected
                  ? "bg-primary text-white border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted"}`}
              style={selected ? { boxShadow: "var(--shadow-sm)" } : {}}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{opt.label}</div>
                {opt.model && <div className="text-[10px] opacity-70 truncate mt-0.5">{opt.model}</div>}
              </div>
              {opt.multimodal && (
                <span className="shrink-0 self-start px-1.5 py-0.5 text-[10px] bg-purple-soft text-foreground border-2 border-purple font-bold">
                  多模态
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}