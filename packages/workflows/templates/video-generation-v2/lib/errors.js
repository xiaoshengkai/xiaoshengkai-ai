export class WorkflowError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "WorkflowError";
    this.type = options.type || "UNKNOWN";
    this.retryable = options.retryable !== false;
    this.suggestion = options.suggestion || null;
  }
}

export function throwStepError(message, options = {}) {
  throw new WorkflowError(message, options);
}

export const ERRORS = {
  SCRIPT_INVALID_JSON: (msg) => new WorkflowError(`script 不是合法 JSON：${msg}`, {
    type: "VALIDATION", retryable: false, suggestion: "重新生成 script 或手动修复 JSON 格式"
  }),
  SCRIPT_VALIDATION_FAILED: (err) => new WorkflowError(`script 校验失败：${err}`, {
    type: "VALIDATION", retryable: false, suggestion: "检查场景数、hook/outro 位置、字段完整性"
  }),
  PREVIEW_NO_SCENES: () => new WorkflowError("script 中没有场景", {
    type: "PREVIEW", retryable: false, suggestion: "确认 script.json 包含 scenes 数组且非空"
  }),
  CONCAT_NO_CLIPS: () => new WorkflowError("没有可用的视频片段，请先完成渲染", {
    type: "RENDER", retryable: false, suggestion: "检查 render 步骤是否成功生成场景 mp4"
  }),
  TTS_PARTIAL_FAILED: (failed, total) => new WorkflowError(`TTS 部分失败: ${failed}/${total} 个场景失败（继续执行）`, {
    type: "API", retryable: true, suggestion: "失败的场景将无音频，可重试 TTS 步骤"
  }),
  BGM_FAILED: (msg) => new WorkflowError(`BGM 生成失败: ${msg}`, {
    type: "API", retryable: true, suggestion: "视频将无背景音乐，可重试 BGM 步骤"
  }),
  RENDER_FAILED: (scene, msg) => new WorkflowError(`场景 ${scene} 渲染失败：${msg}`, {
    type: "RENDER", retryable: false, suggestion: "检查模板 HTML 是否完整，或重试"
  }),
  SFX_LIBRARY_EMPTY: () => new WorkflowError("SFX 库为空，跳过", {
    type: "SFX", retryable: true, suggestion: "运行 sfx-downloader.js 下载音效"
  }),
};