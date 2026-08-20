import fs from "node:fs";
import path from "node:path";
import { preprocessChat } from "@/lib/core/preprocess-fetch";
import { ATTACHMENT_REGEX, assertMediaDataSize } from "./attachment";
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
  const counts = { image: 0, video: 0 };
  const total = messages.length;
  const content: OpenAIPart[] = [];
  const seen = new Set<string>();

  messages.forEach((message, index) => {
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
        counts[modality]++;
        continue;
      }
      if (part.type !== "text") continue;

      const text = (part as TextPart).text || "";
      for (const source of text.match(ATTACHMENT_REGEX) || []) {
        const attachment = parseAttachment(source);
        if (!attachment || attachment.modality === "unknown" || !modalities.has(attachment.modality)) continue;
        if (!isWithinHistoryDepth(index, total, attachment.modality)) continue;
        const url = attachment.localPath
          ? localData(attachment.modality, attachment.filename)
          : attachment.source;
        if (seen.has(url)) continue;
        content.push(mediaPart(attachment.modality, url));
        seen.add(url);
        counts[attachment.modality]++;
      }
    }
  });

  for (const modality of modalities) {
    if (counts[modality] === 0) {
      throw new Error(`未能读取${modality === "image" ? "图片" : "视频"}附件`);
    }
  }

  // ponytail: 只发媒体、单条 user 消息 — 带历史 assistant 轮会让 preprocess 模型续写对话而非描述图片
  const description = await preprocessChat([{ role: "user", content }], {
    modelName: "",
    systemPrompt: "请客观描述图片和视频的核心内容，不要做多余事情。用 1-2 句话总结。",
  });
  console.log(`[preprocess] 描述 len=${description.length}`);
  return description;
}
