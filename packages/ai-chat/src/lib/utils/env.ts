/**
 * 集中 env 读取 — 避免散落各处的 process.env
 *
 * ponytail: 一次性 destructure，全部用 `||` 默认值，不做类型校验（信任边界外由 next.config.ts 守住）
 */
import { loadNetworkConfig } from "@app/shared/network.js";

// 从 config/network.json 读 chroma host+port（项目级配置，committed）
const NET_CONFIG = loadNetworkConfig();

export const env = {
  BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || '',

  MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || '',

  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',

  GLM_BASE_URL: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
  GLM_API_KEY: process.env.GLM_API_KEY || '',

  QWEN_BASE_URL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  QWEN_API_KEY: process.env.QWEN_API_KEY || '',

  CHROMA_URL: `http://${NET_CONFIG.hosts.local}:${NET_CONFIG.ports.chroma}`,
} as const;