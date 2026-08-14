export interface ProviderEntry {
  enabled: boolean;
  baseURL: string;
  anthropicBaseURL?: string;
  apiKey: string;
  models: {
    chat?: string;
    text?: string;
    image?: string;
    embedding?: string;
    tts?: string;
    bgm?: string;
  };
}

export interface SelectionEntry {
  provider: string;
  model: string;
}

export type Module = 'chat' | 'media' | 'vector' | 'workflow' | 'tts' | 'bgm';

export type Providers = Record<string, ProviderEntry>;
export type Selection = Record<Module, SelectionEntry>;