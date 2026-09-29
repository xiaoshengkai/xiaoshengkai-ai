import fs from "node:fs";
import path from "node:path";
import { callMultimodalLLM } from "@app/shared/llm/index.js";
import { ATTACHMENT_REGEX, IMAGE_MISSING_NOTE, assertMediaDataSize, downloadRemoteImage } from "./attachment";
import { parseAttachment } from "./modality-detector";
import { DEFAULT_CONFIG, isWithinHistoryDepth } from "./multimodal-config";
import { extToMime } from "./mime";
import type { FilePart, Message, TextPart } from "../utils/types";

const ROOT_DIR = path.resolve(process.cwd(), "..", "..");

const VISION_SYSTEM = "你是图片内容的忠实提取器。请尽可能完整地还原画面信息：\n1. 转写所有可见文字（原样、不缩写、不省略）；\n2. 若含表格、图表、列表，逐项给出结构、行列标题及其中所有数字、单位、数据；\n3. 描述主体对象、场景、布局、配色等视觉信息；\n4. 不要只做概括总结，不要遗漏细节，也不要编造图中不存在的内容。";

/** 内联到消息占位符位置的描述包装（等同附件本身，约束模型不得声称看不到） */
export function wrapDescription(text: string): string {
  return `[图片内容（视觉模型提取，等同原图，请据此回答，不要声称看不到图片）:\n${text}]`;
}

function localData(filename: string): string {
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

async function describeImage(dataUrl: string): Promise<string | null> {
  try {
    const { text } = await callMultimodalLLM({
      system: VISION_SYSTEM,
      user: "请完整还原图片信息",
      images: [dataUrl],
      format: null,
    });
    console.log(`[preprocess] 描述 len=${text.length}`);
    return text ? wrapDescription(text) : null;
  } catch (e) {
    console.warn(`[preprocess] vision 调用失败: ${(e as Error).message}`);
    return null;
  }
}

interface Item {
  /** 消息中的占位来源：marker/URL 原文，或 file part 的 data */
  key: string;
  /** 需要独立 vision 调用的 dataUrl；null 表示降级或复用 alias */
  dataUrl: string | null;
  alias?: string;
}

/**
 * 将历史深度内的图片逐图交给 vision 模型描述（纯文本 chat provider 用）。
 * 返回 占位来源 → 内联文本（描述包装 / 降级注记），由 pipeline 原位替换。
 * ponytail: 逐图并行单调用 — 描述与占位符 1:1 绑定，长历史/多图不再靠模型自行对齐；
 * 本地缺失/远程下载失败/vision 失败一律降级注记，不阻断对话（上传文件可能被运维清理）。
 */
export async function preprocessAttachmentsDescriptions(messages: Message[]): Promise<Map<string, string>> {
  const total = messages.length;
  const items: Item[] = [];
  const seen = new Map<string, string>();

  for (let index = 0; index < messages.length; index++) {
    if (!isWithinHistoryDepth(index, total, "image")) continue;
    for (const part of messages[index].parts || []) {
      if (part.type === "file") {
        const file = part as FilePart;
        if (!file.mediaType?.startsWith("image/")) continue;
        assertMediaDataSize(file.data, "image");
        if (!seen.has(file.data)) {
          seen.set(file.data, file.data);
          items.push({ key: file.data, dataUrl: file.data });
        }
        continue;
      }
      if (part.type !== "text") continue;

      for (const source of (part as TextPart).text?.match(ATTACHMENT_REGEX) || []) {
        const attachment = parseAttachment(source);
        if (!attachment || attachment.modality !== "image") continue;

        let dataUrl: string | null = null;
        if (attachment.localPath) {
          try {
            dataUrl = localData(attachment.filename);
          } catch (e) {
            console.warn(`[preprocess] 本地图片不可读: ${(e as Error).message}`);
          }
        } else {
          try {
            const local = await downloadRemoteImage(attachment.source);
            if (local) dataUrl = localData(local);
          } catch (e) {
            console.warn(`[preprocess] 远程图片下载异常: ${(e as Error).message}`);
          }
          if (!dataUrl) console.warn(`[preprocess] 忽略不可下载的远程图片: ${attachment.source.slice(0, 100)}`);
        }
        if (!dataUrl) {
          items.push({ key: source, dataUrl: null });
          continue;
        }
        const first = seen.get(dataUrl);
        if (first) {
          items.push({ key: source, dataUrl: null, alias: first });
        } else {
          seen.set(dataUrl, source);
          items.push({ key: source, dataUrl });
        }
      }
    }
  }

  const unique = items.filter((it) => it.dataUrl);
  const results = await Promise.all(unique.map((it) => describeImage(it.dataUrl!)));
  const byKey = new Map<string, string>();
  unique.forEach((it, i) => byKey.set(it.key, results[i] ?? IMAGE_MISSING_NOTE));

  const out = new Map<string, string>();
  for (const it of items) {
    if (it.dataUrl) out.set(it.key, byKey.get(it.key) ?? IMAGE_MISSING_NOTE);
    else if (it.alias) out.set(it.key, byKey.get(it.alias) ?? IMAGE_MISSING_NOTE);
    else out.set(it.key, IMAGE_MISSING_NOTE);
  }
  return out;
}
