/**
 * POST /api/auth/login — 单密码登录（无用户名）
 * body: { password }
 * 防爆破：同 IP 连错 5 次锁 10 分钟（shared/auth.js 内存计数）
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthConfigured, verifyPassword, signToken,
  checkThrottle, recordFailure, resetThrottle, clientIp,
} from "@app/shared/auth.js";

const COOKIE = "ai_session";
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS) || 30;

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const locked = checkThrottle(ip);
  if (locked) {
    return NextResponse.json(
      { ok: false, error: `失败次数过多，请 ${Math.ceil(locked / 60)} 分钟后再试` },
      { status: 429 },
    );
  }

  if (!isAuthConfigured()) {
    return NextResponse.json(
      { ok: false, error: "auth_not_configured: 服务端未配置 AUTH_PASSWORD（根 .env）" },
      { status: 503 },
    );
  }

  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!password || !verifyPassword(password)) {
    recordFailure(ip);
    const remain = checkThrottle(ip);
    return NextResponse.json(
      { ok: false, error: remain ? `密码错误次数过多，已锁定 ${Math.ceil(remain / 60)} 分钟` : "密码错误" },
      { status: 401 },
    );
  }

  resetThrottle(ip);
  const token = signToken(process.env.AUTH_SECRET || "");
  const res = NextResponse.json({ ok: true });
  // Secure 自动探测：裸 IP HTTP 部署降级（否则浏览器拒发 Cookie），funnel/nginx TLS 下经 x-forwarded-proto 恢复
  const secure = (req.headers.get("x-forwarded-proto") || req.nextUrl.protocol) === "https";
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return res;
}
