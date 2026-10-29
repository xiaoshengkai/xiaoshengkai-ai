/** person-research 研究预算与限额（V1 常量，效果数据积累后再调优） */
export const CONFIG = {
  DISCOVERY_MAX_QUERIES: 8,
  RESEARCH_MAX_QUERIES: 5,
  SCRAPE_PER_ROUND: 5,
  RESEARCH_SCRAPE_PER_ROUND: 4,
  DOMAIN_SCRAPE_CAP: 2,
  CONTENT_TRUNCATE: 4000,
  SEARCH_TIMEOUT_MS: 30000,
  SCRAPE_TIMEOUT_MS: 60000,
  SEARCH_CONCURRENCY: 4,
  QUOTE_MAX: 120,
  PROMPT_SOURCES_MAX: 10,
  // ── V1.1 相关性漏斗 ──
  RELEVANCE_DIRECT: 6,        // ≥6 直接保留（evidence）
  RELEVANCE_BOUNDARY: 3,      // 3~5 边界 → LLM 批量复核；<3 丢弃（深挖降为 lead）
  LLM_REVIEW_BATCH_MAX: 10,   // 每阶段边界复核上限
  BOUNDARY_SCRAPE_MAX: 5,     // 边界复核前限量抓正文
  EXPANSION_MAX_QUERIES: 5,   // 受控扩搜查询上限
  MAX_PERSISTED_DISCOVERY: 20,// 首搜+扩搜合计持久化上限
  MAX_PERSISTED_ROUND: 12,    // 研究轮 evidence 持久化上限
  MAX_PERSISTED_DEEP: 20,     // 深挖轮 lead_only 持久化上限
  BUSINESS_LEADS_MAX: 8,      // 商业轮聚合站 lead 持久化上限
};
