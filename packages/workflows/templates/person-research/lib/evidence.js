/**
 * 证据归并（纯函数）：updates 合并来源并按独立域名数升级状态；
 * conflicts 生成 conflicting 主张并与原主张双向引用。
 * 同域名多来源不算独立来源（转载/同站）。
 */
function independentDomainCount(claim, sourceMap) {
  const domains = new Set(
    claim.sourceIds.map(id => sourceMap.get(id)?.domain).filter(Boolean),
  );
  return domains.size;
}

export function applyExtract(existingClaims, extract, sourceMap, { newClaimIds, conflictClaimIds, candidateId, observedAt }) {
  const claims = existingClaims.map(c => ({
    ...c,
    sourceIds: [...c.sourceIds],
    conflicts: [...(c.conflicts || [])],
  }));

  for (const u of extract.updates) {
    const claim = claims.find(c => c.id === u.claimId);
    if (!claim) continue;
    claim.sourceIds = [...new Set([...claim.sourceIds, ...u.addSourceIds])];
    if (claim.status === "single_source" && independentDomainCount(claim, sourceMap) >= 2) {
      claim.status = "supported";
    }
  }

  const newClaims = extract.newClaims.map((cl, i) => ({
    id: newClaimIds[i],
    claim: cl.claim,
    quote: cl.quote,
    sourceIds: cl.sourceIds,
    candidateId,
    publishedAt: cl.publishedAt || null,
    observedAt,
    status: "single_source",
    conflicts: [],
  }));

  const conflictClaims = extract.conflicts.map((cf, i) => {
    const id = conflictClaimIds[i];
    for (const origId of cf.claimIds) {
      const orig = claims.find(c => c.id === origId);
      if (orig && !orig.conflicts.includes(id)) orig.conflicts.push(id);
    }
    return {
      id,
      claim: cf.claim,
      quote: cf.note,
      sourceIds: cf.sourceIds,
      candidateId,
      publishedAt: null,
      observedAt,
      status: "conflicting",
      conflicts: [...cf.claimIds],
    };
  });

  return {
    claims: [...claims, ...newClaims, ...conflictClaims],
    newClaimIds: [...newClaimIds, ...conflictClaimIds],
  };
}

// ─── 用户断言应用（更正/补充，纯函数） ────────────────────────────

/** 否定既有主张（rejected + 理由）+ 追加 user_provided 补充主张（无公开来源，quote=用户原话） */
export function applyCorrection(existingClaims, correction, { newClaimIds, candidateId, observedAt }) {
  const claims = existingClaims.map(c => {
    const neg = correction.negate.find(n => n.claimId === c.id);
    if (!neg) return c;
    return { ...c, status: "rejected", rejectedReason: neg.reason || "用户指出有误" };
  });

  const newClaims = correction.facts.map((f, i) => ({
    id: newClaimIds[i],
    claim: f.fact,
    quote: f.quote || f.fact,
    sourceIds: [],
    candidateId,
    publishedAt: null,
    observedAt,
    status: "user_provided",
    conflicts: [],
  }));

  return {
    claims: [...claims, ...newClaims],
    newClaimIds: [...newClaimIds],
  };
}

// ─── 整人排除（候选级连坐） ────────────────────────────────────────

/**
 * 整人排除：候选 rejected + identitySummary 清空（严禁残留错误身份），
 * 主张连坐——目标候选名下 + 未归属（candidateId 空）的全部主张作废；
 * 保留 user_provided（用户补充的正确线索）与其他存活候选名下主张。
 */
export function applyCandidateRejection(claims, candidates, { candidateId, reason }) {
  const target = candidates.find(c => c.id === candidateId);
  if (!target) return { claims, candidates, ok: false };

  const surviving = new Set(
    candidates.filter(c => c.id !== candidateId && c.status !== "rejected").map(c => c.id),
  );

  const nextCandidates = candidates.map(c => c.id === candidateId
    ? { ...c, status: "rejected", identitySummary: null, rejectedReason: reason }
    : c);

  const nextClaims = claims.map(cl => {
    if (cl.status === "rejected" || cl.status === "user_provided") return cl;
    if (cl.candidateId && surviving.has(cl.candidateId)) return cl;
    return { ...cl, status: "rejected", rejectedReason: `候选整体排除：${reason}` };
  });

  return { claims: nextClaims, candidates: nextCandidates, ok: true };
}

/** 重新识别轮的新候选重编号（避开既有 a-N 编号防冲突），返回 { candidates, idMap } */
export function reIdCandidates(existingCandidates, incoming) {
  const base = Math.max(0, ...existingCandidates.map(c => parseInt(String(c.id).replace(/\D/g, ""), 10) || 0));
  const idMap = new Map(incoming.map((c, i) => [c.id, `a${base + i + 1}`]));
  const candidates = incoming.map(c => ({ ...c, id: idMap.get(c.id), status: "unconfirmed" }));
  return { candidates, idMap };
}

// ─── 商业关系归并（纯函数） ────────────────────────────────────────

function relationKey(r) {
  return `${r.companyName}|${r.relation}`;
}

/** 同公司同角色合并（来源并集 + 补齐缺失字段），不同角色分开保留 */
export function mergeBusinessRelations(existing, incoming) {
  const merged = existing.map(r => ({ ...r, sourceIds: [...r.sourceIds] }));
  for (const inc of incoming) {
    const found = merged.find(r => relationKey(r) === relationKey(inc));
    if (found) {
      found.sourceIds = [...new Set([...found.sourceIds, ...inc.sourceIds])];
      for (const k of ["shareholding", "position", "companyStatus", "since", "until", "quote"]) {
        if (!found[k] && inc[k]) found[k] = inc[k];
      }
    } else {
      merged.push({ ...inc, sourceIds: [...inc.sourceIds] });
    }
  }
  return merged;
}

/** 独立域名 ≥2 升 supported（同域名多来源不算，转载/同站）；unverified 不动（角色未知，多来源也只是匹配页变多） */
export function recomputeBusinessStatus(relations, sourceMap) {
  return relations.map(r => {
    if (r.status === "unverified") return r;
    const domains = new Set(r.sourceIds.map(id => sourceMap.get(id)?.domain).filter(Boolean));
    return { ...r, status: domains.size >= 2 ? "supported" : "single_source" };
  });
}

// ─── 聚合站公司名与规则化关联 ─────────────────────────────────────

const COMPANY_SUFFIX_RE = /(公司|企业|集团|工厂|中心|研究院|事务所|合作社)$/;

/** 聚合站页面 title → 公司名（清 [PDF] 前缀/站点名后缀/（有限合伙）） */
export function companyNameFromTitle(title) {
  const n = String(title || "")
    .replace(/^\[PDF\]\s*/, "")
    .split(/ [-·|—]/)[0]
    .replace(/[（(]有限合伙[)）]/, "")
    .trim();
  return COMPANY_SUFFIX_RE.test(n) && n.length >= 4 && n.length <= 40 ? n : null;
}

/**
 * 规则化关联：人名商业查询（foundBy reason=business）全文匹配的聚合站公司页
 * → association/unverified（不依赖 LLM；摘要层看不到小股东，但"查到了这家公司"本身是值得呈现的线索）
 */
export function collectAggregatorAssociations(sources, aggrRe) {
  const out = [];
  const seen = new Set();
  for (const s of sources) {
    if (!aggrRe.test(s.domain || "")) continue;
    if (!(s.foundBy || []).some(f => f?.reason === "business")) continue;
    const companyName = companyNameFromTitle(s.title);
    if (!companyName || seen.has(companyName)) continue;
    seen.add(companyName);
    out.push({
      companyName,
      relation: "association",
      sourceIds: [s.id],
      quote: String(s.title || "").trim().slice(0, 120),
      shareholding: null, position: null, companyStatus: null, since: null, until: null,
      status: "unverified",
      note: "人名商业查询的全文匹配页；摘要层未见其股东/高管角色，建议人工到聚合平台核实全部股东名单",
    });
  }
  return out;
}
