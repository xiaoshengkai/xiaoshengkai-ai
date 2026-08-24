import fs from "node:fs";
import path from "node:path";
import { preprocessChat } from "@/lib/core/preprocess-fetch";
import { ATTACHMENT_REGEX, assertMediaDataSize, downloadRemoteImage } from "./attachment";
import { parseAttachment, type Modality } from "./modality-detector";
import { DEFAULT_CONFIG, isWithinHistoryDepth } from "./multimodal-config";
import { extToMime } from "./mime";
import type { FilePart, Message, TextPart } from "../utils/types";

const ROOT_DIR = path.resolve(process.cwd(), "..", "..");

type OpenAIPart =
  | { type: "image_url"; image_url: { url: string; detail: "default" } }
  | { type: "video_url"; video_url: { url: string; detail: "default"; fps: number } };

function mediaPart(modality: "image" | "video", url: string): OpenAIPart {
  return modality === "image"
    ? { type: "image_url", image_url: { url, detail: "default" } }
    : { type: "video_url", video_url: { url, detail: "default", fps: 1 } };
}

function localData(modality: "image" | "video", filename: string) {
  const dir = modality === "image" ? "images" : "videos";
  const filePath = path.resolve(ROOT_DIR, "data", "static", dir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`${modality === "image" ? "图片" : "视频"}文件不存在：${filename}`);
  const size = fs.statSync(filePath).size;
  const maxSize = modality === "image" ? DEFAULT_CONFIG.maxImageFileSize : DEFAULT_CONFIG.maxFileSize;
  if (size > maxSize) {
    throw new Error(`${modality === "image" ? "图片" : "视频"}过大（${(size / 1024 / 1024).toFixed(1)}MB > ${maxSize / 1024 / 1024}MB）`);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = extToMime(ext);
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

/** 将需要降级的图片/视频一次性交给 preprocess model 描述。 */
export async function preprocessAttachmentsDescription(
  messages: Message[],
  modalities: Set<"image" | "video">,
): Promise<string> {
  const total = messages.length;
  const content: OpenAIPart[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    for (const part of message.parts || []) {
      if (part.type === "file") {
        const file = part as FilePart;
        const modality = file.mediaType.startsWith("image/") ? "image"
          : file.mediaType.startsWith("video/") ? "video" : null;
        if (!modality || !modalities.has(modality) || !isWithinHistoryDepth(index, total, modality)) continue;
        assertMediaDataSize(file.data, modality);
        if (seen.has(file.data)) continue;
        content.push(mediaPart(modality, file.data));
        seen.add(file.data);
        continue;
      }
      if (part.type !== "text") continue;

      const text = (part as TextPart).text || "";
      for (const source of text.match(ATTACHMENT_REGEX) || []) {
        const attachment = parseAttachment(source);
        if (!attachment || attachment.modality === "unknown" || !modalities.has(attachment.modality)) continue;
        if (!isWithinHistoryDepth(index, total, attachment.modality)) continue;

        let url: string | null = null;
        if (attachment.localPath) {
          url = localData(attachment.modality, attachment.filename);
        } else if (attachment.modality === "image") {
          // 远程图片：先下载到本地缓存，过期/403 则跳过，避免直接交给模型 fetch 失败
          let local: string | null = null;
          try {
            local = await downloadRemoteImage(attachment.source);
          } catch (e) {
            console.warn(`[preprocess] 远程图片下载异常: ${(e as Error).message}`);
          }
          if (!local) {
            console.warn(`[preprocess] 忽略不可下载的远程图片: ${attachment.source.slice(0, 100)}`);
            continue;
          }
          url = localData("image", local);
        } else {
          // 远程视频：无本地缓存 helper，沿用原始 URL（遗留行为）
          url = attachment.source;
        }
        if (url === null || seen.has(url)) continue;
        content.push(mediaPart(attachment.modality, url));
        seen.add(url);
      }
    }
  }

  // 优雅降级：一个附件都没解析出来 → 不调 LLM，返回空描述（不阻断对话）
  if (content.length === 0) return "";

  // ponytail: 只发媒体、单条 user 消息 — 带历史 assistant 轮会让 preprocess 模型续写对话而非描述图片
  const description = await preprocessChat([{ role: "user", content }], {
    modelName: "",
    systemPrompt: "请客观描述图片和视频的核心内容，不要做多余事情。用 1-2 句话总结。",
  });
  console.log(`[preprocess] 描述 len=${description.length}`);
  return description;
}
