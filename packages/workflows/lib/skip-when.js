/**
 * skipWhen 条件求值（engine 与模板共用）
 * 支持：xxx_no / xxx_yes / xxx_present / xxx_set / {var} === "value" / 数组 OR
 */

export function evaluateSkipWhen(condition, params) {
  if (!condition) return false;

  if (Array.isArray(condition)) {
    return condition.some(c => evaluateSingleSkip(c, params));
  }
  return evaluateSingleSkip(condition, params);
}

function evaluateSingleSkip(expr, params) {
  expr = (expr || "").trim();
  if (!expr) return false;
  if (expr.includes("===") || expr.includes("!==")) {
    const m = expr.match(/^"?\{(\w+)\}"?\s*(===|!==)\s*"(.+)"$/);
    if (m) {
      const [, varName, op, val] = m;
      const actual = params[varName];
      return op === "===" ? actual === val : actual !== val;
    }
    return false;
  }
  if (expr.endsWith("_no")) {
    return params[expr.slice(0, -3)] === "no";
  }
  if (expr.endsWith("_yes")) {
    return params[expr.slice(0, -4)] === "yes";
  }
  if (expr.endsWith("_present") || expr.endsWith("_set")) {
    const varName = expr.replace(/_(present|set)$/, "");
    const v = params[varName];
    return v !== undefined && v !== null && v !== "";
  }
  return false;
}
