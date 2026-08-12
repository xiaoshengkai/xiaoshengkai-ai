/**
 * 集中类型定义 — 消除散落的 `any`
 *
 * 这些类型来自 AI SDK v6 的 UIMessage 形状，
 * 但我们自己定义以避免依赖未导出的内部类型。
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number };
  outputTokenDetails?: { textTokens?: number; reasoningTokens?: number };
}

export interface MessageMetadata {
  usage?: TokenUsage;
  provider?: string;
  model?: string;
  modelTier?: string;
  classifyUsage?: TokenUsage;
  retrievedChunks?: { content: string; source: string }[];
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface FilePart {
  type: 'file';
  mediaType: string;
  data: string;
  name?: string;
}

export type MessagePart = TextPart | FilePart | { type: string; [key: string]: unknown };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  metadata?: MessageMetadata;
}

export interface NoteImage {
  index: number;
  type: 'cover' | 'illustration';
  prompt: string;
  url: string | null;
  status: 'pending' | 'done' | 'failed';
}

export interface NoteData {
  taskId: string;
  status: 'generating' | 'ready' | 'failed' | 'partial';
  title: string;
  content: string[];
  tags: string[];
  images: NoteImage[];
}

export interface UploadResult {
  path: string;
  name: string;
  modality: 'image' | 'video';
}

export interface AttachedFile {
  path: string;
  name: string;
  modality: 'image' | 'video';
}