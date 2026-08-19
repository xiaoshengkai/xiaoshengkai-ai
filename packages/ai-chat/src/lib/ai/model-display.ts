interface ModelDisplay {
  label: string;
  color: string;
}

const DISPLAY: Record<string, (model: string) => ModelDisplay> = {
  minimax: () => ({ label: "🎨 M3", color: "var(--yellow)" }),
  deepseek: (m) => ({
    label: m.includes("flash") ? "⚡ flash" : "🚀 pro",
    color: m.includes("flash") ? "var(--blue)" : "var(--purple)",
  }),
  glm: () => ({ label: "🌟 GLM", color: "var(--lime)" }),
  qwen: () => ({ label: "🌊 Qwen", color: "var(--orange)" }),
};

export function getModelDisplay(provider: string, model: string): ModelDisplay {
  return DISPLAY[provider]?.(model) ?? { label: model, color: "var(--purple)" };
}