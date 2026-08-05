export class WorkflowError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "WorkflowError";
    this.type = options.type || "UNKNOWN";
    this.retryable = options.retryable !== false;
    this.suggestion = options.suggestion || null;
  }
}

export const ERRORS = {
  SCRIPT_VALIDATION_FAILED: (err) => new WorkflowError(`script 校验失败：${err}`, {
    type: "VALIDATION", retryable: false, suggestion: "检查场景数、HTML 结构、字段完整性"
  }),
  BGM_FAILED: (msg) => new WorkflowError(`BGM 生成失败: ${msg}`, {
    type: "API", retryable: true, suggestion: "视频将无背景音乐，可重试 BGM 步骤"
  }),
};