/**
 * workflows 能力挂载点：全部委托 @app/workflows 包（声明式 actions.json 驱动）
 * 详见 docs/superpowers/specs/2026-08-21-capability-registration-design.md
 */
import { handler } from "@app/workflows/http.js";

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;
