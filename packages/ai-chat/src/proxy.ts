/**
 * 全局鉴权卡口（Next 16 proxy，middleware 继任者，Node runtime）
 * ============================================================================
 * 所有页面 + API 路由经过此处：
 *   - 放行：/login、/api/auth/*（登录/登出/改密自带密码验证）、字体豁免路径、_next 静态资源
 *   - 有效 ai_session Cookie → 放行；否则页面 307→/login、API 401
 *   - AUTH_PASSWORD 未配置：生产 fail-closed（全拒），dev 放行
 * 字体豁免：MCP document 工具用 Chrome 渲染 PDF 时经 /api/uploads 取 CJK 字体，
 * Chrome 字体加载带不了 Cookie；该字体是开源 Noto，无泄漏风险。
 */
import { NextResponse, type NextRequest } from "next/server";
import { isAuthConfigured, verifyToken } from "@app/shared/auth.js";

const COOKIE = "ai_session";
const FONT_PATH = "/api/uploads/NotoSansCJKsc-Regular.otf";
// 与 next.config.ts basePath 同源逻辑
const BASE_PATH = process.env.NODE_ENV === "production" ? "/ai" : "";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl; // 不含 basePath

  if (pathname === "/login" || pathname.startsWith("/api/auth/") || pathname === FONT_PATH) {
    return NextResponse.next();
  }

  // 浏览器直接导航（Accept 含 text/html，如 dashboard/推送/下载链接）→ 未登录跳登录页，而不是甩一坨 JSON
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  // JSON 错误显式带 charset=utf-8，否则 Safari 在中文环境按 GBK 猜解 → 乱码
  const jsonErr = (error: string, status: number) =>
    NextResponse.json({ ok: false, error }, { status, headers: { "content-type": "application/json; charset=utf-8" } });

  const configured = isAuthConfigured();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      // fail-closed：密钥未配置不放行任何请求（login 接口会给出明确错误）
      if (pathname.startsWith("/api/") && !wantsHtml) {
        return jsonErr("auth_not_configured: 服务端未配置 AUTH_PASSWORD/AUTH_SECRET", 503);
      }
      return NextResponse.redirect(new URL(`${BASE_PATH}/login`, request.url));
    }
    return NextResponse.next(); // dev 未配置密码 → 不启用登录
  }

  const token = request.cookies.get(COOKIE)?.value;
  if (token && verifyToken(token, process.env.AUTH_SECRET || "")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/") && !wantsHtml) {
    return jsonErr("unauthorized: 未登录", 401);
  }
  return NextResponse.redirect(new URL(`${BASE_PATH}/login`, request.url));
}

export const config = {
  // 除静态资源外全部经过卡口（basePath 由 Next 自动前缀）
  // '/' 单独一条：basePath 根（/ai 裸路径）只有 isRoot matcher 能覆盖，
  // 否则 /ai 被静态缓存直出、绕过鉴权（Next 16 实测行为）
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
