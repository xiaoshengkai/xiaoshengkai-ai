/**
 * 客户端上传 helper — 合并 handlePaste + handleFileChange 的 FileReader+fetch 块
 */

import { BASE } from "@/lib/utils/utils";
import type { UploadResult } from "@/lib/utils/types"

export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const dataUrl = await readAsBase64(file);
  const res = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64: dataUrl, name: file.name, mimeType: file.type }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "上传失败" }));
    throw new Error(err.error || "上传失败");
  }
  return res.json();
}