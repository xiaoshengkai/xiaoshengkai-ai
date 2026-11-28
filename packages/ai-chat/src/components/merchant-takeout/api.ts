"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * 商户外卖模拟器统一 API 请求：显式同源携带 Cookie，
 * 遇 401（登录态失效）自动跳登录页并带 next 回跳，避免把 "unauthorized: 未登录" 当业务错误展示。
 */
export function useMerchantApi() {
  const router = useRouter();
  return useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const res = await fetch(url, { ...init, credentials: "same-origin" });
      if (res.status === 401) {
        const next = window.location.pathname + window.location.search;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }
      return res;
    },
    [router],
  );
}
