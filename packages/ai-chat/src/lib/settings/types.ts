export interface ProviderEntry {
  enabled: boolean;
  baseURL: string;
  apiKey: string;
  models: {
    chat?: string;
    text?: string;
    image?: string;
    embedding?: string;
    tts?: string;
    music?: string;
  };
}

export interface SelectionEntry {
  provider: string;
  model: string;
  /** ponytail: workflow module 可选 — 后台轻量任务用（默认降级到 model） */
  flashModel?: string;
}

export type Module = 'chat' | 'media' | 'vector' | 'workflow' | 'tts' | 'music' | 'vision';

export type Providers = Record<string, ProviderEntry>;
export type Selection = Record<Module, SelectionEntry>;

/** 内网出口：白名单域名走反向隧道（Mac 公司网络），其余直连 */
export interface EgressConfig {
  enabled: boolean;
  /** SOCKS 代理地址 host:port（服务器侧反向隧道入口） */
  proxy: string;
  /** 白名单：精确 host / .后缀 / CIDR */
  whitelist: string[];
}