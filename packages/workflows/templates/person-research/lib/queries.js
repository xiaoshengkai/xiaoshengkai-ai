/**
 * 查询规划（V1 纯静态模板）：候选发现轮与定向研究轮共用语义——
 * 高区分度线索（手机号/学校/公司/城市）优先，保证预算截断时先砍泛查询。
 */
import { CONFIG } from "./config.js";

export function buildDiscoveryQueries({ name, phone, city, school, company, focus }) {
  const queries = [];
  const push = (query, category, reason) => {
    if (query && !queries.some(q => q.query === query)) {
      queries.push({ query, category, reason });
    }
  };

  push(`"${name}"`, "general", "name-exact");
  if (phone) push(`"${phone}"`, "general", "phone-match");
  if (school) push(`${name} ${school}`, "general", "clue-school");
  if (company) push(`${name} ${company}`, "general", "clue-company");
  if (city) push(`${name} ${city}`, "general", "clue-city");
  push(`${name} 新闻`, "news", "news");
  push(`${name} 采访`, "general", "interview");
  push(`${name} 任职 简历`, "general", "career");
  if (focus) push(`${name} ${focus}`, "general", "focus");

  return queries.slice(0, CONFIG.DISCOVERY_MAX_QUERIES);
}

/**
 * 商业关系固定查询集：多短查询并行（不塞 OR 布尔符，聚合引擎解析差），
 * 覆盖股东/任职/投资语义 + 工商聚合站 site: 定向。
 */
export function buildBusinessQueries(name) {
  return [
    `${name} 股东`,
    `${name} 持股`,
    `${name} 法定代表人`,
    `${name} 董事`,
    `${name} 监事`,
    `${name} 对外投资`,
    `${name} site:aiqicha.baidu.com`,
    `${name} site:qcc.com`,
    `${name} site:tianyancha.com`,
    `${name} site:gsxt.gov.cn`,
  ].map(query => ({ query, category: "general", reason: "business" }));
}

/**
 * 受控扩搜查询（V1.1）：首搜有效来源 ≤2 时换引擎（SearXNG）重查一次。
 * 精确名换引擎重查 + 线索组合变体；不生成泛查询。
 */
export function buildExpansionQueries({ name, school, company, city, focus }) {
  const out = [];
  const push = q => { if (q && !out.includes(q)) out.push(q); };

  push(`"${name}"`);
  if (school) push(`${name} ${school}`);
  if (company) push(`${name} ${company}`);
  if (city) push(`${name} ${city}`);
  if (focus) push(`${name} ${focus}`);

  return out.slice(0, CONFIG.EXPANSION_MAX_QUERIES)
    .map(query => ({ query, category: "general", reason: "expansion" }));
}

export function researchQueryBudget() {
  return CONFIG.RESEARCH_MAX_QUERIES;
}
