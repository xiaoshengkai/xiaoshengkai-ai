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

export interface RetrievedChunkMeta {
  content: string;
  source: string;
}

export interface MessageMetadata {
  usage?: TokenUsage;
  provider?: string;
  model?: string;
  modelTier?: string;
  classifyUsage?: TokenUsage;
  retrievedChunks?: RetrievedChunkMeta[];
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

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface ToolPart {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

export type MessagePart = TextPart | FilePart | ReasoningPart | ToolPart | { type: string; [key: string]: unknown };

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  metadata?: MessageMetadata;
}

export interface NoteImage {
  url: string;
  description?: string;
}

export interface NoteData {
  id?: string;
  title: string;
  cover?: string;
  content: string;
  illustrations?: NoteImage[];
  tags?: string[];
  topic?: string;
  status?: string;
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