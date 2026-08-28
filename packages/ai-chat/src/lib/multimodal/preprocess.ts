import fs from "node:fs";
import path from "node:path";
import { callMultimodalLLM } from "@app/shared/llm/index.js";
import { ATTACHMENT_REGEX, assertMediaDataSize, downloadRemoteImage } from "./attachment";
import { parseAttachment } from "./modality-detector";
import { DEFAULT_CONFIG, isWithinHistoryDepth } from "./multimodal-config";
import { extToMime } from "./mime";
import type { FilePart, Message, TextPart } from "../utils/types";

const ROOT_DIR = path.resolve(process.cwd(), "..", "..");

function localData(filename: string) {
  const filePath = path.resolve(ROOT_DIR, "data", "static", "images", filename);
  if (!fs.existsSync(filePath)) throw new Error(`图片文件不存在：${filename}`);
  const size = fs.statSync(filePath).size;
  const maxSize = DEFAULT_CONFIG.maxImageFileSize;
  if (size > maxSize) {
    throw new Error(`图片过大（${(size / 1024 / 1024).toFixed(1)}MB > ${maxSize / 1024 / 1024}MB）`);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = extToMime(ext);
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

/**
 * 将需要降级的图片交给 vision 模型描述（纯文本 chat provider 用）。
 * ponytail: 复用 vision 模块（callMultimodalLLM），不再维护独立 preprocess provider。
 */
export async function preprocessAttachmentsDescription(messages: Message[]): Promise<string> {
  const total = messages.length;
  const content: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    for (const part of message.parts || []) {
      if (part.type === "file") {
        const file = part as FilePart;
        if (!file.mediaType.startsWith("image/")) continue;
        if (!isWithinHistoryDepth(index, total, "image")) continue;
        assertMediaDataSize(file.data, "image");
        if (seen.has(file.data)) continue;
        content.push(file.data);
        seen.add(file.data);
        continue;
      }
      if (part.type !== "text") continue;

      const text = (part as TextPart).text || "";
      for (const source of text.match(ATTACHMENT_REGEX) || []) {
        const attachment = parseAttachment(source);
        if (!attachment || attachment.modality !== "image") continue;
        if (!isWithinHistoryDepth(index, total, "image")) continue;

        let url: string | null = null;
        if (attachment.localPath) {
          url = localData(attachment.filename);
        } else {
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
          url = localData(local);
        }
        if (url === null || seen.has(url)) continue;
        content.push(url);
        seen.add(url);
      }
    }
  }

  // 优雅降级：一个附件都没解析出来 → 不调 LLM，返回空描述（不阻断对话）
  if (content.length === 0) return "";

  const { text } = await callMultimodalLLM({
    system: "你是图片内容的忠实提取器。请尽可能完整地还原画面信息：\n1. 转写所有可见文字（原样、不缩写、不省略）；\n2. 若含表格、图表、列表，逐项给出结构、行列标题及其中所有数字、单位、数据；\n3. 描述主体对象、场景、布局、配色等视觉信息；\n4. 不要只做概括总结，不要遗漏细节，也不要编造图中不存在的内容。",
    user: "请完整还原图片信息",
    images: content,
    format: null,
  });
  console.log(`[preprocess] 描述 len=${text.length}`);
  return text;
}
