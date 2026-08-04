import { z } from "zod";

const StepState = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  previewType: z.string().optional(),
  previewField: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
});

export const ExecutionStateSchema = z.object({
  executionId: z.string(),
  template: z.string(),
  params: z.record(z.string(), z.unknown()),
  startedAt: z.string(),
  completedAt: z.string().nullable().optional(),
  status: z.enum(["pending", "created", "running", "completed", "failed"]),
  steps: z.array(StepState),
  currentStep: z.number().default(0),
  error: z.string().nullable().optional(),
  script: z.unknown().nullable().optional(),
  scriptEdited: z.boolean().default(false).optional(),
  sceneStates: z.record(z.string(), z.object({
    type: z.string(),
    templateId: z.string(),
    narration: z.string(),
    tts: z.object({
      status: z.enum(["done", "pending", "failed"]),
      path: z.string().nullable(),
      size: z.number().default(0),
      duration: z.number().default(0),
      error: z.string().nullable(),
    }).optional(),
    sfx: z.object({
      status: z.enum(["done", "pending", "failed", "skipped"]),
      path: z.string().nullable(),
      filename: z.string().nullable(),
      category: z.string().nullable(),
      tier: z.number().nullable(),
      volume: z.number().default(0.3),
      startAt: z.number().default(0),
    }).optional(),
    render: z.object({
      status: z.enum(["done", "pending", "failed"]),
      path: z.string().nullable(),
      size: z.number().default(0),
      duration: z.number().default(0),
      targetDuration: z.number().default(0),
      alignmentDiff: z.number().default(0),
      warning: z.string().nullable(),
    }).optional(),
  })).optional(),
  manifests: z.object({
    durations: z.record(z.string(), z.number()).optional(),
    clips: z.array(z.object({
      sceneId: z.string(),
      path: z.string(),
      templateId: z.string(),
      targetDuration: z.number(),
      actualDuration: z.number(),
      alignmentDiff: z.number(),
    })).optional(),
    concat: z.object({
      steps: z.array(z.object({
        name: z.string(),
        durationSec: z.number(),
        fileSize: z.number(),
        command: z.string(),
      })).optional(),
    }).optional(),
  }).optional(),
}).passthrough();

export const ErrorSchema = z.object({
  type: z.enum(["API_ERROR", "RENDER_ERROR", "VALIDATION_ERROR", "TIMEOUT", "FFMPEG_ERROR", "UNKNOWN"]),
  sceneId: z.string().nullable().optional(),
  message: z.string(),
  suggestion: z.string().nullable().optional(),
  retryable: z.boolean().default(true),
});

export function makeError(type, message, opts = {}) {
  return {
    type,
    message,
    sceneId: opts.sceneId || null,
    suggestion: opts.suggestion || null,
    retryable: opts.retryable !== false,
  };
}

export const ERROR_SUGGESTIONS = {
  API_ERROR: "检查 API Key 和网络连接后重试",
  RENDER_ERROR: "检查 HTML 文件是否完整，可尝试重试",
  VALIDATION_ERROR: "检查 script.json 格式和字段是否完整",
  TIMEOUT: "渲染超时，可尝试减少场景复杂度后重试",
  FFMPEG_ERROR: "检查 ffmpeg 是否安装，确认音频/视频文件完整",
  UNKNOWN: "未知错误，请查看日志或重试",
};