import { z } from "zod";
import { schemaToType } from "./schema-to-ts.js";
import { egressFetch } from "@app/shared/egress.js";

const DEFAULT_TIMEOUT_MS = 15000;
const USAGE = "请提供有效的 YApi 接口页链接，示例：https://yapi.cai-inc.com/project/3222/interface/api/243396";

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/\*\//g, "*\\/");
}

function isRequired(v) {
  return v === true || String(v) === "1";
}

// 从详情页 URL 解析 origin / id / project_id；url 查询串里若带 token 也一并取出兜底
function parseUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = u.pathname.match(/\/interface\/api\/(?:cat_\d+\/)?(\d+)/);
  if (!m) return null;
  return {
    origin: u.origin,
    id: m[1],
    projectId: (u.pathname.match(/\/project\/(\d+)\//) || [])[1] || null,
    tokenFromUrl: u.searchParams.get("token") || null,
  };
}

async function fetchInterface(origin, id, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const api = `${origin}/api/interface/get?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
    const res = await egressFetch(api, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function fieldsToProps(fields, { allRequired = false, form = false } = {}) {
  const properties = {};
  const required = [];
  for (const f of fields || []) {
    if (!f || !f.name) continue;
    let type = "string";
    if (form) {
      if (f.type === "file") type = "file";
      else if (f.type === "number") type = "number";
      else if (f.type === "boolean") type = "boolean";
    }
    properties[f.name] = { type, description: f.desc || undefined };
    if (allRequired || isRequired(f.required)) required.push(f.name);
  }
  return { properties, required };
}

function buildBodySchema(data) {
  if (data.req_body_is_json_schema && data.req_body_other) {
    const s = safeParse(data.req_body_other);
    if (s) return s;
  }
  if (Array.isArray(data.req_body_form) && data.req_body_form.length > 0) {
    const { properties, required } = fieldsToProps(data.req_body_form, { form: true });
    return { type: "object", properties, required };
  }
  return null;
}

function buildRequestSchema(data) {
  const properties = {};
  const required = [];
  const add = (key, fields, opts) => {
    const { properties: p, required: r } = fieldsToProps(fields, opts);
    if (Object.keys(p).length === 0) return;
    properties[key] = { type: "object", properties: p, required: r };
    required.push(key);
  };
  add("query", data.req_query);
  add("path", data.req_params, { allRequired: true });
  add("headers", data.req_headers);
  const body = buildBodySchema(data);
  if (body) {
    properties.body = body;
    required.push("body");
  }
  return { type: "object", properties, required };
}

function pascalName(path) {
  const segs = String(path || "")
    .split("?")[0]
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && !/^[:{]/.test(s) && !/^\d+$/.test(s));
  const last = segs[segs.length - 1] || "Api";
  const name = last
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return name || "Api";
}

function buildTs(data) {
  const name = pascalName(data.path);
  const reqSchema = buildRequestSchema(data);
  const hasReq = Object.keys(reqSchema.properties).length > 0;

  const lines = [];
  lines.push(`/** ${esc(data.title) || name} */`);
  lines.push(`/** ${esc(data.method)} ${esc(data.path)} */`);
  lines.push(hasReq ? `export interface ${name}Request ${schemaToType(reqSchema)}` : `export interface ${name}Request {}`);

  if (data.res_body_is_json_schema && data.res_body) {
    const s = safeParse(data.res_body);
    lines.push(s ? `export interface ${name}Response ${schemaToType(s)}` : `export type ${name}Response = string`);
  } else if (data.res_body) {
    lines.push(`// 原始响应（非 JSON Schema）`);
    lines.push(`export type ${name}Response = string`);
  } else {
    lines.push(`export interface ${name}Response {}`);
  }

  return lines.join("\n\n");
}

export function register(server) {
  server.tool(
    "yapiApi",
    "根据 YApi 接口页链接获取接口定义。传入详情页 URL（如 https://yapi.cai-inc.com/project/3222/interface/api/243396）和项目 token，返回原始 JSON 或 TS 类型定义（请求+响应）。",
    {
      url: z.string().min(1).describe("YApi 接口详情页链接"),
      token: z.string().optional().describe("YApi 项目 token（项目设置中获取）；URL 查询串带 token 时可省略"),
      format: z.enum(["json", "ts"]).optional().describe("输出格式：json 原始数据 / ts 类型定义，默认 json"),
    },
    async ({ url, token, format }) => {
      const parsed = parseUrl(url);
      if (!parsed) {
        return toolResult({ ok: false, error: `无法从链接解析接口 id。${USAGE}` });
      }
      const tk = token || parsed.tokenFromUrl;
      if (!tk) {
        return toolResult({ ok: false, error: "缺少项目 token，请在 YApi 项目设置中获取 token 后作为 token 参数传入" });
      }

      console.log(`[yapi:yapiApi] id=${parsed.id} origin=${parsed.origin} format=${format || "json"}`);

      let body;
      try {
        body = await fetchInterface(parsed.origin, parsed.id, tk);
      } catch (err) {
        const msg = err.name === "AbortError" ? `请求超时（${DEFAULT_TIMEOUT_MS}ms）` : err.message;
        return toolResult({ ok: false, error: `请求 YApi 失败: ${msg}` });
      }

      if (body.errcode !== 0) {
        if (body.errcode === 40011) return toolResult({ ok: false, error: "token 无效或缺失，请检查项目 token" });
        if (body.errcode === 402) return toolResult({ ok: false, error: `接口不存在或 id 非法（id=${parsed.id}）` });
        return toolResult({ ok: false, error: `YApi 返回错误: ${body.errmsg || body.errcode}` });
      }

      const data = body.data;
      if ((format || "json") === "json") {
        return toolResult({ ok: true, data });
      }

      return toolResult({
        ok: true,
        meta: { id: data._id, title: data.title, method: data.method, path: data.path, projectId: data.project_id },
        ts: buildTs(data),
      });
    },
  );
}
