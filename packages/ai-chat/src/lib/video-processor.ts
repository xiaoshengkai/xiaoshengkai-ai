/**
 * 视频处理器
 *
 * Frame-extract 模式：[视频:uuid] → ffmpeg 抽 N 帧 → base64 → 多个 image content
 * Direct 模式：直接传视频 URL 给多模态 API（要求 provider 可访问）
 * Preprocess 模式：抽 1 帧 → M3 描述 → 文字给纯文本 provider
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateText } from 'ai';
import { minimax } from './providers';
import { extractAttachments } from './modality-detector';
import { DEFAULT_CONFIG, readHistoryDepth } from './multimodal-config';

const execFileP = promisify(execFile);
const ROOT_DIR = path.resolve(process.cwd(), '..', '..');

const VIDEO_TEMP_DIR = path.resolve(ROOT_DIR, 'data', 'static', 'videos', '.frames');

export interface VideoProcessResult {
  messages: any[];
  systemInjection?: string;
}

/**
 * 用 ffmpeg 从视频抽 N 帧
 * 均匀分布：1/N, 2/N, ..., N/N
 */
async function extractFrames(videoPath: string, count: number): Promise<string[]> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在：${path.basename(videoPath)}`);
  }
  const stat = fs.statSync(videoPath);
  if (stat.size > DEFAULT_CONFIG.maxFileSize) {
    throw new Error(`视频过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > ${DEFAULT_CONFIG.maxFileSize / 1024 / 1024}MB）`);
  }

  fs.mkdirSync(VIDEO_TEMP_DIR, { recursive: true });

  // 获取时长
  const { stdout: durationStr } = await execFileP('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const duration = Math.max(parseFloat(durationStr.trim()) || 0, 1);

  const baseName = path.basename(videoPath, path.extname(videoPath));
  const outPattern = path.join(VIDEO_TEMP_DIR, `${baseName}-%d.jpg`);

  // 抽帧：fps=count/duration，输出 N 帧
  const fps = count / duration;
  await execFileP('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vf', `fps=${fps},scale=480:-2`,
    '-vframes', String(count),
    '-q:v', '4',
    outPattern,
  ]);

  // 收集输出文件
  const outPaths: string[] = [];
  for (let i = 1; i <= count; i++) {
    const p = path.join(VIDEO_TEMP_DIR, `${baseName}-${i}.jpg`);
    if (fs.existsSync(p)) outPaths.push(p);
  }
  return outPaths;
}

/**
 * Frame-extract 模式：抽帧 → 多 image content parts
 */
export async function processVideoFrameExtract(messages: any[]): Promise<any[]> {
  const depth = readHistoryDepth('video');
  const total = messages.length;

  const result: any[] = [];
  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    const isCurrent = i === total - 1;
    const keepImage = isCurrent || depth === 'all' || (typeof depth === 'number' && depth >= total - i);

    if (!keepImage) {
      result.push(stripVideos(msg));
      continue;
    }

    const newParts: any[] = [];
    for (const part of msg.parts || []) {
      if (part?.type !== 'text') {
        newParts.push(part);
        continue;
      }
      const text = part.text || '';
      const uploadRegex = /\[视频:([^\]]+)\]/g;
      const matches = [...text.matchAll(uploadRegex)];
      if (matches.length === 0) {
        newParts.push(part);
        continue;
      }

      const cleanText = text.replace(uploadRegex, '').trim();
      const content: any[] = [];
      if (cleanText) content.push({ type: 'text', text: cleanText });

      for (const m of matches) {
        const url = m[1];
        const filename = url.split('/').pop() || '';
        const videoPath = path.resolve(ROOT_DIR, 'data', 'static', 'videos', filename);
        try {
          const framePaths = await extractFrames(videoPath, DEFAULT_CONFIG.videoFrameCount);
          for (const fp of framePaths) {
            const buffer = fs.readFileSync(fp);
            const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            content.push({ type: 'image', image: base64 });
          }
          console.log(`[video-processor] 抽帧: ${filename} → ${framePaths.length} 帧`);
        } catch (err) {
          const strategy = DEFAULT_CONFIG.missingFileStrategy;
          if (strategy === 'error') throw err;
          console.warn(`[video-processor] 跳过视频: ${(err as Error).message}`);
        }
      }
      newParts.push({ ...part, type: 'content', content });
    }
    result.push({ ...msg, parts: newParts });
  }
  return result;
}

/**
 * Direct 模式：传视频 URL（要求 provider 可访问）
 * 当前 M3/Qwen 都不可直接消费 URL，所以这个模式作为预留
 */
export async function processVideoDirect(messages: any[]): Promise<any[]> {
  // 当前实现：M3/Qwen 都不支持直传视频 URL，降级为 frame-extract
  return processVideoFrameExtract(messages);
}

/**
 * Preprocess：抽 1 帧 → M3 描述 → 文字给纯文本 provider
 */
export async function preprocessVideoDescription(messages: any[]): Promise<VideoProcessResult> {
  const attachments = extractAttachments(messages).filter((a) => a.modality === 'video');
  if (attachments.length === 0) return { messages };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const descriptions: string[] = [];
    for (const att of attachments) {
      if (!att.localPath) continue;
      const videoPath = path.resolve(ROOT_DIR, 'data', 'static', 'videos', att.filename);
      const framePaths = await extractFrames(videoPath, 1);
      if (framePaths.length === 0) continue;
      const buffer = fs.readFileSync(framePaths[0]);
      const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      const { text } = await generateText({
        model: minimax('MiniMax-M3'),
        abortSignal: controller.signal,
        maxOutputTokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请简要描述这个视频的关键内容（基于关键帧）。' },
              { type: 'image', image: base64 },
            ],
          },
        ],
      });
      descriptions.push(text);
    }
    clearTimeout(timeout);
    if (descriptions.length === 0) return { messages };
    return {
      messages: messages.map((msg) => stripVideos(msg)),
      systemInjection: descriptions.join('\n\n'),
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error('[video-preprocess] 失败:', (err as Error).message);
    return { messages };
  }
}

/**
 * 剥离消息中的视频标记
 */
export function stripVideos(msg: any): any {
  return {
    ...msg,
    parts: (msg.parts || []).map((p: any) => {
      if (p?.type !== 'text') return p;
      return {
        ...p,
        text: (p.text || '').replace(/\[视频:[^\]]+\]/g, '[视频]').replace(
          /https?:\/\/[^\s]+\.(?:mp4|webm|mov|mkv)(?:\?[^\s]*)?/gi,
          '[视频]'
        ),
      };
    }),
  };
}