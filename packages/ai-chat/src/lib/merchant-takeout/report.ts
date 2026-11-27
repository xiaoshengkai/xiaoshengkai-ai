/**
 * 外卖开店模拟器 — AI 经营报告
 * 本文件拆成纯函数（buildReportContext / parseReportJson / reportReadinessErrors）与
 * 副作用函数（generateReport）。纯函数不读环境、不调 AI，供测试直接 import；
 * generateReport 在函数体内动态 import 模型与 SDK，保持模块级无服务端依赖。
 */

import { z } from "zod";
import type { AiReport, AiReportRisk, AiReportRecommendation, MerchantStore } from "./types";
import { calculateSimulation, buildPhases, getReportReadiness } from "./calculate";

const fmt = (n: number) =>
  `${(Number.isFinite(n) ? n : 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
const fmtSigned = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}`;

/** 薄封装：报告就绪度（返回缺失项数组，空数组 = 可生成报告） */
export function reportReadinessErrors(store: MerchantStore): string[] {
  return getReportReadiness(store);
}

/**
 * 用确定性测算结果拼装中文提示词上下文（纯函数，不调 AI）。
 * 只喂确定数字，明确要求模型不得重算、不得杜撰成功率。
 */
export function buildReportContext(store: MerchantStore): string {
  const sim = calculateSimulation(store, buildPhases(store));
  const p = store.profile;

  const lines: string[] = [];
  lines.push(`【店铺画像】品类=${p.category || "未填写"}，阶段=${p.stage}，城市=${p.city || "未填写"}`);
  lines.push(`可投入资金=¥${fmt(p.availableCapital)}，预留周转金=¥${fmt(p.workingCapital)}，目标月净利润=¥${fmt(p.targetNetProfit)}`);
  lines.push(`经营经验=${p.experience || "未填写"}，风险提示=${p.riskNotes || "未填写"}`);

  lines.push(`【一次性投入总额】¥${fmt(sim.totalOneTimeCosts)}（押金可回收不计入）`);

  const fixed = store.costs.monthlyFixed;
  const fixedSum = fixed.rent + fixed.utilities + fixed.property + fixed.network + fixed.garbage + fixed.other;
  lines.push(`【月固定成本】合计 ¥${fmt(fixedSum)}（房租 ¥${fmt(fixed.rent)}、水电气 ¥${fmt(fixed.utilities)}、物业 ¥${fmt(fixed.property)}、网络 ¥${fmt(fixed.network)}、垃圾 ¥${fmt(fixed.garbage)}、其他 ¥${fmt(fixed.other)}）`);
  const baseStaff = store.staffing.base.reduce((s, m) => s + m.count * m.monthlySalary, 0);
  lines.push(`【阶梯人工】基础人工 ¥${fmt(baseStaff)}/月，增员档位：${store.staffing.tiers.length === 0 ? "无" : store.staffing.tiers.map((t) => `≥${t.minMonthlyOrders}单 加 ¥${fmt(t.members.reduce((s, m) => s + m.count * m.monthlySalary, 0))}`).join("；")}`);

  const avg = sim.months[0]?.result.avgContribution ?? 0;
  lines.push(`【平均单笔贡献利润】¥${fmt(avg)}/单`);

  lines.push(`【各阶段推演】（第1/2/3月 + 稳定期）`);
  sim.months.forEach((m, i) => {
    const r = m.result;
    lines.push(
      `${m.label}：订单量=${fmt(r.totalOrders)}，营业额=¥${fmt(r.grossRevenue)}，结算收入=¥${fmt(r.settlementRevenue)}，` +
        `税后净利润=¥${fmtSigned(r.netProfit)}，净利润率=${fmt(r.netProfitMargin * 100)}%，保本单量=${r.breakevenOrders === null ? "无法保本" : fmt(r.breakevenOrders)}，` +
        `活动订单增量=${r.activityIncrementalOrders === null ? "无活动" : fmt(r.activityIncrementalOrders)}，现金余额=¥${fmt(sim.cumulativeCash[i])}`,
    );
  });

  lines.push(`【成本明细（稳定期）】食材=¥${fmt(sim.months[sim.months.length - 1]?.result.foodCost ?? 0)}，包装=¥${fmt(sim.months[sim.months.length - 1]?.result.packagingCost ?? 0)}，损耗=¥${fmt(sim.months[sim.months.length - 1]?.result.lossCost ?? 0)}，平台扣点=¥${fmt(sim.months[sim.months.length - 1]?.result.commissionCost ?? 0)}，商家优惠=¥${fmt(sim.months[sim.months.length - 1]?.result.merchantDiscountCost ?? 0)}，订单损失=¥${fmt(sim.months[sim.months.length - 1]?.result.orderLossCost ?? 0)}`);

  lines.push(`【现金流最低点】¥${fmt(sim.minCash)}`);
  lines.push(`【回本周期】${sim.paybackMonths === null ? "四个阶段内未回本" : `第 ${sim.paybackMonths} 个月回本`}`);

  return lines.join("\n");
}

const riskSchema = z.object({
  title: z.string(),
  evidence: z.string(),
  impact: z.string(),
});
const recommendationSchema = z.object({
  action: z.string(),
  evidence: z.string(),
  expectedImpact: z.string(),
});
const reportSchema = z.object({
  feasibility: z.enum(["较可行", "谨慎考虑", "风险较高", "信息不足"]),
  summary: z.string(),
  conditions: z.array(z.string()),
  risks: z.array(riskSchema),
  recommendations: z.array(recommendationSchema),
});

/**
 * 防御性解析模型返回的 JSON：剥掉代码围栏/前缀噪声，再 JSON.parse + Zod 校验归一化。
 * 失败返回 null（路由据此降级）。
 */
export function parseReportJson(text: string): AiReport | null {
  try {
    const trimmed = text.trim();
    let jsonText = trimmed;
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      jsonText = fence[1].trim();
    } else {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start !== -1 && end > start) jsonText = trimmed.slice(start, end + 1);
    }

    const parsed = JSON.parse(jsonText);
    const result = reportSchema.parse(parsed);

    return {
      feasibility: result.feasibility,
      summary: result.summary,
      conditions: result.conditions.map(String),
      risks: result.risks.map((r) => ({ title: r.title, evidence: r.evidence, impact: r.impact })),
      recommendations: result.recommendations.map((r) => ({
        action: r.action,
        evidence: r.evidence,
        expectedImpact: r.expectedImpact,
      })),
    };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `你是一名资深餐饮经营分析助手。你的任务是根据用户提供的确定性财务测算数据，输出一份外卖开店经营可行性报告。

必须遵守：
1. 不得重新计算任何数字，只能使用给定数据。
2. 不得编造开店成功率或任何概率数字。
3. 每条风险与每条建议都必须直接引用给定数据作为依据（evidence 字段）。
4. 只输出一个 JSON 对象，不要输出任何解释文字、Markdown 代码块或前后缀。

JSON 结构（严格按此 schema）：
{
  "feasibility": "较可行" | "谨慎考虑" | "风险较高" | "信息不足",
  "summary": "一段 2~4 句的中文摘要，概括财务表现与主要结论",
  "conditions": ["关键成立条件1", "条件2", ...],
  "risks": [{ "title": "风险标题", "evidence": "引用给定数据的依据", "impact": "可能造成的影响" }, ...],
  "recommendations": [{ "action": "具体调整动作", "evidence": "引用给定数据的依据", "expectedImpact": "预期影响" }, ...]
}`;

/** 调用 AI 生成经营报告（动态 import 模型与 SDK，避免模块级服务端依赖） */
export async function generateReport(store: MerchantStore): Promise<AiReport> {
  const context = buildReportContext(store);

  const [{ getWorkflowModel }, { generateText }] = await Promise.all([
    import("@/lib/core/workflow-model"),
    import("ai"),
  ]);

  const { text } = await generateText({
    model: getWorkflowModel("pro"),
    system: SYSTEM_PROMPT,
    prompt: `以下是你必须基于其分析、且不得修改的经营测算数据：\n\n${context}\n\n请输出经营可行性报告 JSON。`,
  });

  const report = parseReportJson(text);
  if (!report) {
    throw new Error("AI 返回内容无法解析为报告");
  }
  return report;
}
