/**
 * 多模态 Provider 注册表 + 配置
 *
 * 扩展方式：新增 provider/model 只需加配置项，业务代码零改动
 * 配置优先级：环境变量 > JSON 文件 > 代码默认值
 *
 * 视频处理说明（M3）：
 *   M3 直接接受 video_url content type，无需预抽帧。M3 自己按 fps 采样。
 *   所以 strategy = 'direct' 表示"直传 video_url"而非抽帧。
 */

export type Modality = 'image' | 'video';
export type Strategy = 'direct' | 'none';

export interface ProviderCapabilities {
  provider: string;
  /** 支持图片直传（image_url）的模型列表 */
  imageModels: string[];
  /** 支持视频直传（video_url）的模型列表 */
  videoModels: string[];
  /** 默认视频采样 fps（0.2-5，默认 1）*/
  videoFps?: number;
  description?: string;
}

/**
 * 代码默认注册表 — 后续接 Qwen/Claude/Gemini 直接加
 */
export const DEFAULT_MULTIMODAL_REGISTRY: Record<string, ProviderCapabilities> = {
  minimax: {
    provider: 'minimax',
    imageModels: ['MiniMax-M3'],
    videoModels: [],  // TODO: @ai-sdk/anthropic 不支持 video，等 provider 升级后恢复
    videoFps: 1,
    description: 'MiniMax M3 多模态（图片直传，视频 preprocess）',
  },
  qwen: {
    provider: 'qwen',
    imageModels: ['qwen3.8-max', 'qwen-vl-max'],
    videoModels: ['qwen3.8-max'],
    videoFps: 1,
    description: '通义千问 3.8-Max 多模态（image_url + video_url）',
  },
};

/**
 * 运行时配置（可被 JSON 文件覆盖）
 */
export interface MultimodalConfig {
  /** 图片历史深度：'all' 或数字 */
  imageHistoryDepth: number | 'all';
  /** 视频历史深度（视频 base64 巨大，默认 1） */
  videoHistoryDepth: number;
  /** 单文件大小上限（字节）—M3 限制：图片 10MB，视频 50MB */
  maxFileSize: number;
  /** 缺失文件时的策略 */
  missingFileStrategy: 'error' | 'ignore' | 'preprocess';
}

export const DEFAULT_CONFIG: MultimodalConfig = {
  imageHistoryDepth: 'all',
  videoHistoryDepth: 1,
  maxFileSize: 50 * 1024 * 1024,  // 50MB（M3 base64 视频上限）
  missingFileStrategy: 'error',
};

/**
 * 历史深度读取（env 覆盖）
 */
export function readHistoryDepth(modality: Modality): number | 'all' {
  const envKey = modality === 'image' ? 'MULTIMODAL_IMAGE_DEPTH' : 'MULTIMODAL_VIDEO_DEPTH';
  const raw = process.env[envKey];
  if (!raw) {
    return modality === 'image' ? DEFAULT_CONFIG.imageHistoryDepth : DEFAULT_CONFIG.videoHistoryDepth;
  }
  if (raw === '*' || raw === 'all') return 'all';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * 判定 provider/model 对某个模态的处理策略
 */
export function getModalityStrategy(
  provider: string,
  model: string,
  modality: Modality,
  registry: Record<string, ProviderCapabilities> = DEFAULT_MULTIMODAL_REGISTRY
): Strategy {
  const cfg = registry[provider];
  if (!cfg) return 'none';
  const models = modality === 'image' ? cfg.imageModels : cfg.videoModels;
  if (models.length === 0) return 'none';
  return models.includes(model) ? 'direct' : 'none';
}