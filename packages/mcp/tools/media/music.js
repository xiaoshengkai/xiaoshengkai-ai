import { z } from "zod";
import path from "node:path";
import os from "node:os";
import { shortId, sleep } from "@app/shared/utils.js";
import { writeTaskState, readTaskState, updateTask, getAdaptiveWait } from "../../lib/task-state.js";
import { generateMusic } from "@app/shared/llm/index.js";

const TASK_DIR = path.join(os.tmpdir(), "hf-tasks");

async function generateMusicAsync(taskId, workDir, params) {
  try {
    updateTask(workDir, { status: "generating", progress: 50, message: "生成中..." });
    const { prompt, lyrics, gender, is_instrumental } = params;
    const { url } = await generateMusic({ prompt, lyrics, gender, isInstrumental: is_instrumental });
    updateTask(workDir, {
      status: "done", progress: 100, message: "完成",
      url, note: "音频链接有效期 24 小时，可直接分享或下载",
    });
  } catch (err) {
    const error = err.name === "AbortError" ? "音乐生成超时，请重试" : err.message;
    updateTask(workDir, { status: "failed", progress: 100, error });
  }
}

const GENDERS = ["female", "male"];

export function register(server) {
  server.tool(
    "generateMusic",
    "根据提示词或自定义歌词生成完整歌曲（含人声），也可生成纯音乐。模型为通义千问 fun-music-v1。prompt 与 lyrics 至少传一个。异步模式，返回 taskId 后用 checkMusicProgress 查询进度。status=done 时把返回的 url 分享给用户。",
    {
      prompt: z.string().max(2000).optional().describe("音乐风格/场景描述（prompt 与 lyrics 至少一个）"),
      lyrics: z.string().optional().describe("自定义歌词（可用 [verse]/[chorus] 等结构标签；与 prompt 同时传时 lyrics 优先）"),
      gender: z.enum(GENDERS).optional().describe("演唱声音性别，默认女声 female"),
      is_instrumental: z.boolean().optional().default(false).describe("是否纯音乐（true 时忽略 lyrics/gender）"),
    },
    async ({ prompt, lyrics, gender, is_instrumental }) => {
      if (!prompt && !lyrics) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "prompt 与 lyrics 至少传一个" }, null, 2) }] };
      }
      try {
        const taskId = shortId();
        const workDir = path.join(TASK_DIR, taskId);
        writeTaskState(workDir, { status: "started", progress: 0, message: "任务已提交" });
        generateMusicAsync(taskId, workDir, { prompt, lyrics, gender, is_instrumental }).catch(err => {
          updateTask(workDir, { status: "failed", progress: 100, error: err.message });
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, status: "started", note: "用 checkMusicProgress(taskId, interval=5) 查询进度" }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );

  server.tool(
    "checkMusicProgress",
    "查询音乐生成任务进度。返回包含 progress(百分比)、status 字段。每次调用会等待后返回最新状态（等待时间由 interval 参数控制）。反复调用直到 status='done' 或 'failed' 后停止。status=done 时把 url（音频下载链接）分享给用户。",
    {
      taskId: z.string().min(1).describe("任务 ID"),
      interval: z.number().optional().default(5).describe("初始查询间隔（秒），后续每次递减 10%，最低为初始值的 60%"),
    },
    async ({ taskId, interval }) => {
      const workDir = path.join(TASK_DIR, taskId);
      const state = readTaskState(workDir);
      if (!state) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "任务不存在或已过期" }) }] };

      if (state.status === "started" || state.status === "generating") {
        const count = state.checkCount || 0;
        const wait = getAdaptiveWait(interval, count);
        updateTask(workDir, { checkCount: count + 1 });
        console.log(`[music] checkMusicProgress: taskId=${taskId}, interval=${interval}, count=${count}, wait=${(wait / 1000).toFixed(1)}s, status=${state.status}`);
        await sleep(wait);
        return { content: [{ type: "text", text: JSON.stringify(readTaskState(workDir), null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    },
  );
}
