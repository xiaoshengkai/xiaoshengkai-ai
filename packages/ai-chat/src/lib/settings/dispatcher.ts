import { readProviders, readSelection } from "./store";
import type { Module } from "./types";

export interface ProviderConfig {
  protocol: "openai" | "anthropic";
  /** ponytail: provider 名称（2026-08-19），用于传给 AI SDK 的 name 字段 */
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** ponytail: workflow module 可选 — 后台轻量任务 model */
  flashModel?: string;
}

export function getProviderConfig(module: Module): ProviderConfig {
  const sel = readSelection();
  const providers = readProviders();
  const entry = sel[module];
  if (!entry) throw new Error(`No selection for module "${module}"`);
  const p = providers[entry.provider];
  if (!p) throw new Error(`Provider "${entry.provider}" not configured`);

  // chat: if provider has anthropicBaseURL, use Anthropic protocol
  if (module === "chat" && p.anthropicBaseURL) {
    return { protocol: "anthropic", provider: entry.provider, baseURL: p.anthropicBaseURL, apiKey: p.apiKey, model: entry.model };
  }

  // other: OpenAI compatible, baseURL first
  return {
    protocol: "openai",
    provider: entry.provider,
    baseURL: p.baseURL || "",
    apiKey: p.apiKey,
    model: entry.model,
    flashModel: entry.flashModel,
  };
}