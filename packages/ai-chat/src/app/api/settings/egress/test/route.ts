import { NextResponse } from "next/server";
import { egressFetch } from "@app/shared/egress.js";

/**
 * 内网出口连通性测试：经隧道（若命中白名单）请求一个目标 URL。
 * 默认探测 yapi 首页——走通说明「Mac 隧道 + 白名单 + SOCKS」整链可用。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const url = String(body.url || "https://yapi.cai-inc.com");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await egressFetch(url, { method: "GET", signal: ctrl.signal });
    return NextResponse.json({ ok: true, url, status: res.status });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      url,
      error: e instanceof Error ? e.message : "请求失败",
    });
  } finally {
    clearTimeout(timer);
  }
}
