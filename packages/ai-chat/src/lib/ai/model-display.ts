interface ModelDisplay {
  label: string;
  color: string;
}

const DISPLAY: Record<string, (model: string) => ModelDisplay> = {
  minimax: () => ({ label: "🎨 M3", color: "var(--pixel-yellow)" }),
  deepseek: (m) => ({
    label: m.includes("flash") ? "⚡ flash" : "🚀 pro",
    color: m.includes("flash") ? "var(--pixel-blue)" : "var(--pixel-purple)",
  }),
  glm: () => ({ label: "🌟 GLM", color: "var(--pixel-green)" }),
};

export function getModelDisplay(provider: string, model: string): ModelDisplay {
  return DISPLAY[provider]?.(model) ?? { label: model, color: "var(--pixel-purple)" };
}