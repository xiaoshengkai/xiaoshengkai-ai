/**
 * POST /api/auth/change-password — 修改登录密码
 * body: { oldPassword, newPassword }
 * 新密码 sha256 写 data/auth.json（优先于 .env AUTH_PASSWORD）；
 * token 含密码指纹 → 改密后所有旧会话（含其他设备）立即失效，前端跳登录页。
 * 与登录共用防爆破计数（旧密码错误也计入锁定，防当口令猜测接口用）。
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthConfigured, verifyPassword, changePassword,
  checkThrottle, recordFailure, resetThrottle, clientIp,
} from "@app/shared/auth.js";

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
    return NextResponse.json({ ok: false, error: "auth_not_configured: 服务端未配置 AUTH_PASSWORD" }, { status: 503 });
  }

  const { oldPassword, newPassword } = await req.json().catch(() => ({} as Record<string, string>));
  if (!oldPassword || !verifyPassword(oldPassword)) {
    recordFailure(ip);
    return NextResponse.json({ ok: false, error: "当前密码错误" }, { status: 401 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ ok: false, error: "新密码至少 8 位" }, { status: 400 });
  }

  resetThrottle(ip);
  changePassword(newPassword);
  return NextResponse.json({ ok: true, relogin: true });
}
