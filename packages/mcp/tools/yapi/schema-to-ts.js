const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const INDENT = "  ";

function isIdent(name) {
  return IDENT_RE.test(name);
}

function propKey(name) {
  return isIdent(name) ? name : JSON.stringify(name);
}

// 收集字段备注：description（多行保留）+ enum 的 enumDesc（每值列表）
function commentLines(sub) {
  const lines = [];
  if (sub && sub.description != null) {
    for (const raw of String(sub.description).split("\n")) {
      const t = raw.trim();
      if (t) lines.push(t);
    }
  }
  if (sub && Array.isArray(sub.enum) && sub.enumDesc) {
    for (const raw of String(sub.enumDesc).split("\n")) {
      const t = raw.trim();
      if (!t) continue;
      const m = t.match(/^(.+?)\s*[:：]\s*(.*)$/);
      lines.push(m ? `- ${m[1].trim()}：${m[2].trim()}` : `- ${t}`);
    }
  }
  return lines.map((l) => l.replace(/\*\//g, "*\\/"));
}

function typeOf(schema, indent) {
  if (schema == null || typeof schema !== "object") return "unknown";

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return type
      .map((t) => typeOf({ ...schema, type: t }, indent))
      .join(" | ");
  }

  if (type === "array" || (schema.items && type !== "object")) {
    const item = schema.items ? typeOf(schema.items, indent) : "unknown";
    return `${item}[]`;
  }

  if (type === "object" || schema.properties) {
    return objectType(schema, indent);
  }

  switch (type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "file":
      return "File";
    default:
      return "unknown";
  }
}

function objectType(schema, indent) {
  const props = schema.properties;
  if (!props || typeof props !== "object" || Object.keys(props).length === 0) {
    return "Record<string, unknown>";
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const pad = INDENT.repeat(indent);
  const inner = INDENT.repeat(indent + 1);
  const lines = Object.entries(props).map(([name, sub]) => {
    const optional = required.includes(name) ? "" : "?";
    const head = `${inner}${propKey(name)}${optional}: ${typeOf(sub, indent + 1)}`;
    const c = commentLines(sub);
    if (c.length === 0) return head;
    const jsdoc = [`${inner}/**`, ...c.map((l) => `${inner} * ${l}`), `${inner} */`].join("\n");
    return `${jsdoc}\n${head}`;
  });
  return `{\n${lines.join("\n")}\n${pad}}`;
}

/**
 * YApi JSON Schema → TS 类型表达式（对象/数组自动内联展开）。
 * @param {unknown} schema YApi schema 对象
 * @param {number} [indent] 起始缩进层级
 * @returns {string} TS 类型表达式
 */
export function schemaToType(schema, indent = 0) {
  return typeOf(schema, indent);
}
