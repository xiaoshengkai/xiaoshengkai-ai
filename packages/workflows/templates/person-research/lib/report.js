/**
 * 报告生成（步骤 3，每轮研究后重跑）：候选+主张+来源 → LLM 生成 Markdown 报告
 * → 引用校验（无效 [S#] 剔除并重试）→ 手机号兜底脱敏 → 版本化落盘。
 * 无主张时走模板分支（不调 LLM）。
 */
import { callLLM } from "@app/shared/llm/index.js";
import { redactPhone } from "./privacy.js";
import { getResearch, writeReport, loadClaims, loadSources, loadRounds, loadBusiness } from "./store.js";
import { buildReportPrompt, validateReportCitations } from "./prompts.js";

const REPORT_MAX_ATTEMPTS = 3;

function emptyReport(name, candidates, rounds) {
  return `# 研究报告：${name}

## 现状

暂无可核查的公开信息主张。

- 候选人物：${candidates.length} 个
- 研究轮次：${rounds.length} 轮

## 下一步建议

- 补充城市 / 学校 / 公司 / 职业等身份线索后继续研究
- 提供已知链接或公开账号作为强身份锚点
`;
}

export async function generateReport(name, executionDir) {
  const research = getResearch(executionDir);
  if (!research) throw new Error("research 未初始化（先跑 discovery）");

  const claims = loadClaims(executionDir);
  const activeClaims = claims.filter(c => c.status !== "rejected");
  const rejectedClaims = claims.filter(c => c.status === "rejected");
  const candidates = research.candidates || [];
  const sources = loadSources(executionDir);
  const rounds = loadRounds(executionDir);
  const business = loadBusiness(executionDir);

  let md;
  if (activeClaims.length === 0 && business.length === 0) {
    md = emptyReport(name, candidates, rounds);
  } else {
    md = await generateReportWithLLM(name, candidates, activeClaims, business, sources, rounds, rejectedClaims);
  }

  md = redactPhone(md);
  const version = writeReport(executionDir, md);
  console.log(`[person-research] 报告 v${version} 已生成（主张 ${activeClaims.length}${rejectedClaims.length > 0 ? `，已排除 ${rejectedClaims.length}` : ""} / 候选 ${candidates.length} / 来源 ${sources.length}）`);
  return {
    version,
    path: "report/current.md",
    claims: activeClaims.length,
    candidates: candidates.length,
    sources: sources.length,
  };
}

async function generateReportWithLLM(name, candidates, claims, business, sources, rounds, rejectedClaims) {
  let cleaned = null;
  let lastErr = "";
  for (let attempt = 0; attempt < REPORT_MAX_ATTEMPTS; attempt++) {
    const { system, user } = buildReportPrompt(name, candidates, claims, business, sources, rounds, rejectedClaims);
    const finalUser = lastErr ? `${user}\n\n上一版问题（${lastErr}），请修正后重新输出。` : user;
    const { text } = await callLLM({ system, user: finalUser });
    const result = validateReportCitations(text, sources);
    if (result.invalidCount === 0) return result.md;
    lastErr = `存在 ${result.invalidCount} 个无效引用 [S#]（引用了不存在的来源编号）`;
    console.warn(`[person-research] 报告第 ${attempt + 1} 版: ${lastErr}`);
    cleaned = result.md;
  }
  console.warn("[person-research] 报告引用校验连续未通过，使用剔除无效引用后的版本兜底");
  return cleaned;
}
