/**
 * 任务仪表盘页面路由（免登录公开）：GET /tasks/<name> → 仪表盘 HTML
 * 旧 /api/tasks/<name>/dashboard 已删除（页面语义不应在 /api 下）；
 * handleDashboard 从 @app/tasks 直连（不经 actions.json dispatch）。
 */
import { handleDashboard } from "@app/tasks/lib/handlers.js";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return handleDashboard({ params: { name } });
}
