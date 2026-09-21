/** POST /api/auth/logout — 清 Cookie（改密后的旧会话由 token 密码指纹自动失效） */
import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ai_session", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
