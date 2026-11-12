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

/** 搜索后端：auto=DeepSeek 优先→Firecrawl→SearXNG；deepseek/firecrawl=强制单一主搜（仍兜底） */
export type SearchProvider = 'auto' | 'deepseek' | 'firecrawl';

export interface SearchSettings {
  provider: SearchProvider;
}

/** 访问控制：需要登录的博客路径前缀（proxy.cjs 强制执行；App 侧 /ai 仍由 proxy.ts 硬编码） */
export interface AuthPathsConfig {
  protected: string[];
}