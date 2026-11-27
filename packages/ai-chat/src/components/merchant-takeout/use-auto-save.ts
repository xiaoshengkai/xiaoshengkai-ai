"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MerchantStore } from "@/lib/merchant-takeout/types";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * 自动保存：value 变化后防抖保存（默认 800ms）。
 * - 序号计数器丢弃过期响应：旧保存晚于新保存返回时不会覆盖新状态。
 * - saveNow() 立即保存（删除地址/商品等关键操作）。
 * - 卸载时若仍 dirty 则 best-effort 补一次保存。
 */
export function useAutoSave(
  value: MerchantStore,
  save: (store: MerchantStore) => Promise<void>,
  opts?: { delayMs?: number },
): { status: SaveStatus; saveNow: () => Promise<void>; error: string | null } {
  const delayMs = opts?.delayMs ?? 800;
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const valueRef = useRef(value);
  const seqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const firstRef = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  const doSave = useCallback(async (seq: number) => {
    setStatus("saving");
    try {
      await saveRef.current(valueRef.current);
      if (seq === seqRef.current) {
        dirtyRef.current = false;
        setStatus("saved");
        setError(null);
      }
    } catch (e) {
      if (seq === seqRef.current) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "保存失败");
      }
    }
  }, []);

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const seq = ++seqRef.current;
    dirtyRef.current = false;
    await doSave(seq);
  }, [doSave]);

  useEffect(() => {
    valueRef.current = value;
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    dirtyRef.current = true;
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const seq = ++seqRef.current;
      dirtyRef.current = false;
      void doSave(seq);
    }, delayMs);
  }, [value, delayMs, doSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // ponytail: best-effort 补存，失败忽略（页面已卸载无处提示）
      if (dirtyRef.current) void saveRef.current(valueRef.current);
    };
  }, []);

  return { status, saveNow, error };
}
