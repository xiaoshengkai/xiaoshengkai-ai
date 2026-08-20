import { readProviders, readSelection } from "./store";
import type { Module } from "./types";

export interface ProviderConfig {
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
  if (p.enabled === false) throw new Error(`Provider "${entry.provider}" is disabled`);

  return {
    provider: entry.provider,
    baseURL: p.baseURL || "",
    apiKey: p.apiKey,
    model: entry.model,
    flashModel: entry.flashModel,
  };
}