import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sleep, shortId } from "../../../shared/utils.js";
import { writeTaskState, readTaskState, updateTask, getAdaptiveWait } from "../../lib/task-state.js";
import { generateImage } from "../../../shared/llm/providers/minimax.js";

const GENERATORS = {
  minimax: generateImage,
};

function getGenerator(provider) {
  const gen = GENERATORS[provider];
  if (!gen) throw new Error(`不支持的图片 provider: ${provider}`);
  return gen;
}

async function getProviderApiKey(provider) {
  if (provider === "minimax") return process.env.MINIMAX_API_KEY;
  return null;
}

const TASK_DIR = path.join(os.tmpdir(), "hf-tasks");

async function generateImageAsync(taskId, workDir, params) {
  try {
    updateTask(workDir, { status: "generating", progress: 50, message: "生成中..." });
    const { prompt, model, aspect_ratio, n, image_url } = params;
    const imageUrls = [];
    for (let i = 0; i < (n || 1); i++) {
      const url = await generateImage(prompt, { aspectRatio: aspect_ratio, model, image_url });
      imageUrls.push(url);
    }
    updateTask(workDir, {
      status: "done", progress: 100, message: "完成",
      imageUrls, count: imageUrls.length, note: "图片链接有效期 24 小时",
    });
  } catch (err) {
    const error = err.name === "AbortError" ? "图片生成超时（60s），请重试" : err.message;
    updateTask(workDir, { status: "failed", progress: 100, error });
  }
}

export function register(server) {
  server.tool(
    "generateImage",
    "根据文本描述生成图片。当前支持 MiniMax image-01 模型。返回的图片 URL 包含 OSS 签名，必须原样使用不得修改任何字符。链接有效期 24 小时。异步模式，返回 taskId 后用 checkImageProgress 查询进度。",
    {
      prompt: z.string().min(1).max(1500).describe("图片的文本描述，最长 1500 字符"),
      provider: z.string().optional().default("minimax").describe("模型提供商，默认 minimax"),
      model: z.enum(["image-01", "image-01-live"]).optional().default("image-01").describe("模型名称"),
      aspect_ratio: z.enum(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"]).optional().default("1:1").describe("宽高比"),
      n: z.number().min(1).max(9).optional().default(1).describe("生成数量，1-9"),
      prompt_optimizer: z.boolean().optional().default(true).describe("是否自动优化 prompt"),
    },
    async ({ prompt, provider, model, aspect_ratio, n, prompt_optimizer }) => {
      try {
        if (!GENERATORS[provider]) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `不支持的 provider: ${provider}` }) }] };
        }
        const apiKey = await getProviderApiKey(provider);
        if (!apiKey) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `未配置 ${provider} API_KEY` }) }] };
        }
        const taskId = shortId();
        const workDir = path.join(TASK_DIR, taskId);
        writeTaskState(workDir, { status: "started", progress: 0, message: "任务已提交" });
        generateImageAsync(taskId, workDir, { prompt, model, aspect_ratio, n, prompt_optimizer }).catch(err => {
          updateTask(workDir, { status: "failed", progress: 100, error: err.message });
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, status: "started", note: "用 checkImageProgress(taskId, interval=5) 查询进度" }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );

  server.tool(
    "generateImageFromImage",
    "根据参考图和文本描述生成新图片。支持通过 subject_reference 传入参考人物照片。返回的图片 URL 包含 OSS 签名，必须原样使用不得修改任何字符。链接有效期 24 小时。异步模式，返回 taskId 后用 checkImageProgress 查询进度。",
    {
      prompt: z.string().min(1).max(1500).describe("图片的文本描述"),
      image_url: z.string().min(1).describe("参考图片的 URL（公网可访问）"),
      provider: z.enum(["minimax"]).optional().default("minimax").describe("模型提供商"),
      model: z.enum(["image-01", "image-01-live"]).optional().default("image-01").describe("模型名称"),
      aspect_ratio: z.enum(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"]).optional().default("1:1").describe("宽高比"),
      n: z.number().min(1).max(9).optional().default(1).describe("生成数量"),
      prompt_optimizer: z.boolean().optional().default(true).describe("是否自动优化 prompt"),
    },
    async ({ prompt, image_url, provider, model, aspect_ratio, n, prompt_optimizer }) => {
      try {
        if (!GENERATORS[provider]) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `不支持的 provider: ${provider}` }) }] };
        }
        const apiKey = await getProviderApiKey(provider);
        if (!apiKey) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `未配置 ${provider} API_KEY` }) }] };
        }
        const taskId = shortId();
        const workDir = path.join(TASK_DIR, taskId);
        writeTaskState(workDir, { status: "started", progress: 0, message: "任务已提交" });
        generateImageAsync(taskId, workDir, { prompt, model, aspect_ratio, n, prompt_optimizer, image_url }).catch(err => {
          updateTask(workDir, { status: "failed", progress: 100, error: err.message });
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, status: "started", note: "用 checkImageProgress(taskId, interval=5) 查询进度" }, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }, null, 2) }] };
      }
    },
  );

  server.tool(
    "checkImageProgress",
    "查询图片生成任务进度。返回包含 progress(百分比)、status 字段。每次调用会等待后返回最新状态（等待时间由 interval 参数控制）。调用期间根据 progress 给用户正向反馈（如'图片正在生成中，已完成 X%'）。反复调用直到 status='done' 或 'failed' 后停止。status=done 时用 Markdown 图片语法展示图片。",
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
        console.log(`[image] checkImageProgress: taskId=${taskId}, interval=${interval}, count=${count}, wait=${(wait / 1000).toFixed(1)}s, status=${state.status}`);
        await sleep(wait);
        return { content: [{ type: "text", text: JSON.stringify(readTaskState(workDir), null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
    },
  );
}