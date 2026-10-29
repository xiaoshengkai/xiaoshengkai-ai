"use client";

/**
 * person-research 研究面板（Tab 式 + Neo-Brutalism）：
 * [核心结论卡] + [Tab: 完整报告（核心，[S#] 可点） | 研究过程（候选/商业/事实/时间线/证据/轮次/来源）]
 * busy（pending/running）态 fixed 视口居中蒙层（复用 Loading 三色方块，不随滚动）；
 * 继续研究 sticky 钉底；rejected 主张从 Hero/事实/时间线排除（证据区灰显带理由）。
 */
import { BASE } from "@/lib/utils/utils";
import { useCallback, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import Loading from "@/components/ui/loading";

export interface PersonResearchPanelProps {
  executionId: string;
  status: string;
  busy: boolean;
  onRefresh: () => void;
}

interface Candidate {
  id: string;
  displayName: string;
  identitySummary?: string;
  signals?: { city?: string | null; school?: string | null; company?: string | null; occupation?: string | null };
  sourceIds: string[];
  confidence: string;
  status: string;
  reason?: string;
}

interface Claim {
  id: string;
  claim: string;
  quote: string;
  sourceIds: string[];
  status: string;
  candidateId?: string | null;
  publishedAt?: string | null;
  rejectedReason?: string | null;
}

interface BusinessRelation {
  companyName: string;
  relation: string;
  shareholding?: string | null;
  position?: string | null;
  companyStatus?: string | null;
  quote?: string;
  note?: string | null;
  sourceIds: string[];
  status: string;
}

interface Round {
  id: string;
  n: number;
  kind: string;
  business?: boolean;
  deep?: boolean;
  input?: string | null;
  queryCount?: number;
  newSourceIds?: string[];
  newClaimIds?: string[];
  filterStats?: {
    rawResults?: number;
    accepted?: number;
    persistedEvidence?: number;
    leadOnly?: number;
  };
}

interface SourceMeta {
  id: string;
  url: string;
  title: string;
  domain: string;
  domainClass: string;
  scraped: boolean;
  snippet: string;
}

interface ReportData {
  ok: boolean;
  status: string;
  name: string;
  reportMd: string | null;
  reportVersion: number;
  candidates: Candidate[];
  claims: Claim[];
  business: BusinessRelation[];
  rounds: Round[];
  sources: SourceMeta[];
}

const SUGGESTIONS = [
  "继续查教育经历",
  "继续查任职与公司关系",
  "查名下公司与股东关系",
  "深挖更多相关线索",
];

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: "高置信", cls: "bg-lime-soft" },
  medium: { label: "中置信", cls: "bg-yellow-soft" },
  low: { label: "低置信", cls: "bg-muted" },
};

const STATUS_LABEL: Record<string, string> = {
  pending: "准备发现候选…",
  running: "研究中…",
  awaiting_input: "等待你的确认或补充",
  completed: "研究完成（可继续深挖）",
  completed_with_warnings: "完成（含警告，可继续）",
  failed: "失败",
};

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-blue-soft",
  running: "bg-blue-soft",
  awaiting_input: "bg-yellow-soft",
  completed: "bg-lime-soft",
  completed_with_warnings: "bg-lime-soft",
  failed: "bg-pink-soft",
};

const CLAIM_STATUS_LABEL: Record<string, string> = {
  supported: "多来源一致",
  single_source: "单一来源",
  conflicting: "信息冲突",
  user_provided: "用户补充",
  unverified: "未核实",
  rejected: "已排除",
};

const RELATION_LABEL: Record<string, string> = {
  shareholder: "股东", history_shareholder: "历史股东", legal_representative: "法定代表人",
  director: "董事", supervisor: "监事", executive: "高管", investment: "对外投资",
  actual_controller: "实际控制人", beneficiary: "最终受益人", history_position: "历史任职",
  association: "关联（未证实）",
};

const FACT_GROUPS: { key: string; label: string; re: RegExp }[] = [
  { key: "business", label: "商业线索", re: /股东|持股|股份|法定代表人|董事|监事|高管|投资|实际控制|受益/ },
  { key: "education", label: "教育经历", re: /学校|学院|大学|专业|学习|毕业|学历|硕士|博士|本科/ },
  { key: "career", label: "职业与任职", re: /就职|任职|工作|雇主|公司|集团|职位|就职于/ },
  { key: "account", label: "公开账号", re: /Facebook|微博|GitHub|知乎|账号|主页|B站|抖音|领英|LinkedIn|推特|Twitter/i },
  { key: "event", label: "事件与活动", re: /竞赛|比赛|获奖|活动|会议|发表|演讲|出席/ },
];

function groupClaims(claims: Claim[]) {
  const groups: Record<string, Claim[]> = {};
  for (const cl of claims) {
    const g = FACT_GROUPS.find(x => x.re.test(cl.claim));
    (groups[g ? g.key : "other"] ||= []).push(cl);
  }
  return groups;
}

/** 报告 Markdown 链接组件：来源引用新标签打开 */
const mdComponents = {
  a(props: ComponentPropsWithoutRef<"a">) {
    return <a {...props} target="_blank" rel="noreferrer" />;
  },
};

/** URL 里的括号/空格转义，防 Markdown 链接语法断裂（wiki 类 URL 常见） */
function safeMarkdownUrl(u: string) {
  return u.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

/** Neo-Brutalism 章节标题：色块标记 + 粗体 */
function SectionTitle({ color = "bg-primary", children }: { color?: string; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold font-heading">
      <span className={`w-3 h-3 ${color} border-2 border-border shrink-0`} />
      {children}
    </h3>
  );
}

export default function PersonResearchPanel({ executionId, status, busy, onRefresh }: PersonResearchPanelProps) {
  const [data, setData] = useState<ReportData | null>(null);
  const [tab, setTab] = useState<"report" | "process">("report");
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${executionId}/research-report`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok) setData(json);
      }
    } catch { /* ignore */ }
  }, [executionId]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(fetchReport, 3000);
    return () => clearInterval(timer);
  }, [busy, fetchReport]);

  const runAuto = useCallback(async () => {
    await fetch(`${BASE}/api/workflows/execution/${executionId}/auto`, { method: "POST" }).catch(() => {});
    onRefresh();
    fetchReport();
  }, [executionId, onRefresh, fetchReport]);

  const handleSelect = useCallback(async (candidateId: string, action: "selected" | "rejected" | "ambiguous") => {
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${executionId}/research-select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action }),
      });
      const json = await res.json();
      if (json.ok) {
        toast(action === "selected" ? "🟢 已选定候选，开始商业关系与定向研究" : "🟡 已更新候选状态");
        if (action === "selected") await runAuto();
        else fetchReport();
      } else {
        toast(`🔴 ${json.error}`);
      }
    } catch { toast("🔴 请求失败"); }
    setSubmitting(false);
  }, [executionId, runAuto, fetchReport]);

  const handleContinue = useCallback(async () => {
    const message = input.trim();
    if (!message) { toast("🔴 请输入补充线索或研究方向"); return; }
    setSubmitting(true);
    setInput("");
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${executionId}/research-continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const json = await res.json();
      if (json.ok) {
        toast("🟢 本轮研究已启动");
        await runAuto();
      } else {
        toast(`🔴 ${json.error}`);
        setInput(message);
      }
    } catch { toast("🔴 请求失败"); setInput(message); }
    setSubmitting(false);
  }, [executionId, input, runAuto]);

  const sourceById = useMemo(() => new Map((data?.sources || []).map(s => [s.id, s])), [data]);
  const candidates = data?.candidates || [];
  const allClaims = data?.claims || [];
  const claims = useMemo(() => allClaims.filter(c => c.status !== "rejected"), [allClaims]);
  const rejectedClaims = useMemo(() => allClaims.filter(c => c.status === "rejected"), [allClaims]);
  const business = data?.business || [];
  const rounds = useMemo(() => [...(data?.rounds || [])].sort((a, b) => b.n - a.n), [data]);
  const main = candidates.find(c => c.status === "selected") || candidates[0] || null;
  const factGroups = useMemo(() => groupClaims(claims), [claims]);
  const timeline = useMemo(
    () => claims.filter(c => c.publishedAt).sort((a, b) => (a.publishedAt! < b.publishedAt! ? 1 : -1)),
    [claims],
  );
  const singleSourceCount = claims.filter(c => c.status === "single_source").length;

  /** 报告 [S#] → 来源超链接（Markdown 链接语法 + 转义），渲染层转换不动落盘文件 */
  const linkedReportMd = useMemo(() => {
    if (!data?.reportMd) return null;
    return data.reportMd.replace(/\[S(\d+)\]/g, (m, n) => {
      const s = sourceById.get(`s-${n}`);
      return s ? `[S${n}](${safeMarkdownUrl(s.url)})` : m;
    });
  }, [data?.reportMd, sourceById]);

  const loadingText = status === "pending"
    ? "正在发现候选人物…"
    : candidates.length === 0
      ? "正在检索公开信息…"
      : "定向研究中…";

  const hasContent = candidates.length > 0 || claims.length > 0 || rejectedClaims.length > 0
    || business.length > 0 || rounds.length > 0 || Boolean(data?.reportMd);

  const renderClaim = (cl: Claim) => (
    <li key={cl.id} className="flex gap-1.5 items-baseline flex-wrap">
      <span>{cl.claim}</span>
      <span className="brutal-chip px-1 py-0.5 text-[10px] shrink-0 bg-muted">
        {CLAIM_STATUS_LABEL[cl.status] || cl.status}
      </span>
      {(cl.sourceIds || []).map(sid => (
        <a key={sid} href={sourceById.get(sid)?.url || "#"} target="_blank" rel="noreferrer"
          className="brutal-chip px-1 py-0.5 text-[10px] shrink-0 hover:bg-muted">{sid}</a>
      ))}
    </li>
  );

  const continueBox = (
    <div className="brutal bg-card p-3 space-y-2 sticky bottom-0 z-10">
      <div className="flex gap-2 flex-wrap">
        {SUGGESTIONS.map(s => (
          <button key={s} disabled={busy || submitting} onClick={() => setInput(s)}
            className="brutal-btn px-2 py-1 text-xs font-bold bg-yellow-soft">{s}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleContinue(); }}
          disabled={busy || submitting}
          placeholder={busy ? "研究进行中…" : "补充线索 / 更正（如：他不是某公司的）/ 继续搜索"}
          className="flex-1 border-2 border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
        />
        <button onClick={handleContinue} disabled={busy || submitting}
          className="brutal-btn px-4 py-2 text-sm font-bold bg-purple text-white">
          {submitting ? "提交中…" : "继续研究"}
        </button>
      </div>
    </div>
  );

  // 无可展示内容：busy 给居中加载态，否则给空态说明（继续研究框保留，是唯一推进入口）
  if (!hasContent) {
    return (
      <div className="space-y-4">
        <div className="brutal bg-card p-10 flex flex-col items-center justify-center gap-4 min-h-60">
          {busy ? (
            <>
              <Loading text={loadingText} />
              <p className="text-xs text-muted-foreground font-mono">多源检索与正文抓取约需 30–60 秒，请稍候…</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {STATUS_LABEL[status] || status} · 暂无可展示的研究内容，可补充城市/学校/公司等线索后继续
            </p>
          )}
        </div>
        {continueBox}
      </div>
    );
  }

  return (
    <div className="relative space-y-4">
      {/* busy 蒙层：fixed 视口居中、不随内容滚动 */}
      {busy && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-[2px]">
          <Loading text={loadingText} />
          <p className="text-xs text-muted-foreground font-mono">多源检索与正文抓取约需 30–60 秒</p>
        </div>
      )}

      {/* 状态条（不固定，精简一行） */}
      <div className="brutal bg-card px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className={`brutal-chip px-2 py-1 text-xs ${STATUS_CHIP[status] || "bg-card"}`}>
          {busy && <span className="w-2 h-2 bg-primary animate-pulse" />}
          {STATUS_LABEL[status] || status}
        </span>
        {data?.reportVersion ? (
          <span className="brutal-chip px-2 py-1 text-xs">报告 v{data.reportVersion}</span>
        ) : null}
        <span className="text-xs text-muted-foreground font-mono">
          候选 {candidates.length} · 主张 {claims.length}{rejectedClaims.length > 0 ? `（已排除 ${rejectedClaims.length}）` : ""} · 商业 {business.length} · 来源 {data?.sources?.length ?? 0}
        </span>
        {data?.reportMd && (
          <a href={`${BASE}/api/workflows/execution/${executionId}/file/report/current.md`} target="_blank" rel="noreferrer"
            className="brutal-btn px-2 py-1 text-xs font-bold bg-yellow text-foreground">下载 .md</a>
        )}
      </div>

      {/* 核心结论卡（rejected 已排除，identitySummary 为更正后的） */}
      {main && (
        <div className="brutal bg-card p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-black font-heading">{data?.name || main.displayName}</h2>
            <span className={`brutal-chip px-1.5 py-0.5 text-xs ${(CONFIDENCE_BADGE[main.confidence] || CONFIDENCE_BADGE.low).cls}`}>
              {(CONFIDENCE_BADGE[main.confidence] || CONFIDENCE_BADGE.low).label}
            </span>
            <span className="brutal-chip px-1.5 py-0.5 text-xs bg-muted">
              {main.status === "selected" ? "已选定候选" : "身份未确认"}
            </span>
          </div>
          {main.identitySummary && <p className="text-sm mt-2">{main.identitySummary}</p>}
          {(() => {
            const sig = Object.entries(main.signals || {}).filter(([, v]) => v);
            if (sig.length === 0) return null;
            return (
              <div className="flex gap-2 flex-wrap mt-2">
                {sig.map(([k, v]) => (
                  <span key={k} className="brutal-chip px-1.5 py-0.5 text-xs bg-blue-soft">
                    {k === "city" ? "地区" : k === "school" ? "学校" : k === "company" ? "机构" : "职业"}：{v as string}
                  </span>
                ))}
              </div>
            );
          })()}
          {(singleSourceCount > 0 || candidates.length > 1 || rejectedClaims.length > 0) && (
            <p className="text-xs text-muted-foreground mt-2 border-t-2 border-dashed border-border pt-2">
              {singleSourceCount > 0 && `⚠ ${singleSourceCount} 条主张仅单一来源支持`}
              {singleSourceCount > 0 && candidates.length > 1 && "；"}
              {candidates.length > 1 && `发现 ${candidates.length} 个同名候选，注意重名风险`}
              {rejectedClaims.length > 0 && `；已按你的更正排除 ${rejectedClaims.length} 条主张`}
            </p>
          )}
        </div>
      )}

      {/* Tab 切换：完整报告（核心） | 研究过程 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("report")}
          className={`brutal-sm px-3 py-1.5 text-sm font-bold font-heading ${tab === "report" ? "bg-yellow-soft text-foreground" : "bg-muted text-muted-foreground"}`}>
          📄 完整报告
        </button>
        <button onClick={() => setTab("process")}
          className={`brutal-sm px-3 py-1.5 text-sm font-bold font-heading ${tab === "process" ? "bg-yellow-soft text-foreground" : "bg-muted text-muted-foreground"}`}>
          🔍 研究过程{rejectedClaims.length > 0 ? "（含更正）" : ""}
        </button>
      </div>

      {tab === "report" ? (
        linkedReportMd ? (
          <div className="brutal bg-card p-4 prose prose-sm max-w-none overflow-hidden">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkedReportMd}</ReactMarkdown>
          </div>
        ) : (
          <div className="brutal bg-card p-6 text-sm text-muted-foreground">尚未生成报告</div>
        )
      ) : (
        <div className="space-y-4">
          {/* 候选人物 */}
          {candidates.length > 0 && (
            <details className="brutal bg-card" open={main?.status !== "selected"}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold font-heading select-none">
                候选人物（{candidates.length}）
              </summary>
              <div className="p-3 pt-0 space-y-2">
                {candidates.map(c => {
                  const badge = CONFIDENCE_BADGE[c.confidence] || CONFIDENCE_BADGE.low;
                  return (
                    <div key={c.id} className={`border-2 border-border p-2 ${c.status === "rejected" ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-2 flex-wrap text-xs">
                        <span className="font-bold">{c.displayName}</span>
                        <span className={`brutal-chip px-1.5 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                        {c.status === "selected" && <span className="brutal-chip px-1.5 py-0.5 text-xs bg-lime-soft">已选定</span>}
                        {c.status === "rejected" && <span className="brutal-chip px-1.5 py-0.5 text-xs bg-muted">已排除</span>}
                      </div>
                      {c.reason && <p className="text-muted-foreground mt-1 text-xs">{c.reason}</p>}
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {(c.sourceIds || []).map(sid => sourceById.get(sid) ? (
                          <a key={sid} href={sourceById.get(sid)!.url} target="_blank" rel="noreferrer"
                            className="brutal-chip px-1.5 py-0.5 text-xs truncate max-w-48 hover:bg-muted">
                            {sourceById.get(sid)!.domain}
                          </a>
                        ) : null)}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button disabled={busy || submitting} onClick={() => handleSelect(c.id, "selected")}
                          className="brutal-btn px-2 py-1 text-xs font-bold bg-lime-soft">选定此人</button>
                        <button disabled={busy || submitting} onClick={() => handleSelect(c.id, "rejected")}
                          className="brutal-btn px-2 py-1 text-xs font-bold bg-card">排除</button>
                        {c.status === "rejected" && (
                          <button disabled={busy || submitting} onClick={() => handleSelect(c.id, "ambiguous")}
                            className="brutal-btn px-2 py-1 text-xs font-bold bg-yellow-soft">恢复待定</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* 商业版图（结构化） */}
          {business.length > 0 && (
            <div className="brutal bg-card p-3">
              <SectionTitle color="bg-purple">商业版图（{business.length} 项）</SectionTitle>
              <div className="space-y-2 mt-2">
                {business.map((b, i) => (
                  <div key={`${b.companyName}-${b.relation}-${i}`} className="border-2 border-border p-2 flex gap-2 flex-wrap text-xs">
                    <span className="brutal-chip px-1.5 py-0.5 shrink-0 bg-purple-soft">
                      {RELATION_LABEL[b.relation] || b.relation}
                    </span>
                    <span className="font-bold">{b.companyName}</span>
                    {b.shareholding && <span className="text-muted-foreground">持股 {b.shareholding}</span>}
                    {b.position && <span className="text-muted-foreground">职务 {b.position}</span>}
                    {b.companyStatus && <span className="text-muted-foreground">{b.companyStatus}</span>}
                    <span className={`brutal-chip px-1 py-0.5 shrink-0 ${b.status === "supported" ? "bg-lime-soft" : b.status === "unverified" ? "bg-yellow-soft" : "bg-muted"}`}>
                      {CLAIM_STATUS_LABEL[b.status] || b.status}
                    </span>
                    <div className="flex gap-1 flex-wrap w-full">
                      {(b.sourceIds || []).map(sid => (
                        <a key={sid} href={sourceById.get(sid)?.url || "#"} target="_blank" rel="noreferrer"
                          className="brutal-chip px-1 py-0.5 hover:bg-muted">{sid}</a>
                      ))}
                    </div>
                    {b.note && <p className="text-muted-foreground w-full">{b.note}</p>}
                    {b.quote && <p className="text-muted-foreground w-full">「{b.quote}」</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关键事实（rejected 已排除） */}
          {claims.length > 0 && (
            <div className="brutal bg-card p-3">
              <SectionTitle>关键事实</SectionTitle>
              <div className="grid gap-3 md:grid-cols-2 mt-2">
                {FACT_GROUPS.filter(g => (factGroups[g.key] || []).length > 0).map(g => (
                  <div key={g.key}>
                    <h4 className="text-xs font-bold text-muted-foreground mb-1 font-heading">{g.label}（{factGroups[g.key].length}）</h4>
                    <ul className="space-y-1 text-xs list-disc list-inside">{factGroups[g.key].map(renderClaim)}</ul>
                  </div>
                ))}
                {(factGroups.other || []).length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-muted-foreground mb-1 font-heading">其他线索（{factGroups.other.length}）</h4>
                    <ul className="space-y-1 text-xs list-disc list-inside">{factGroups.other.map(renderClaim)}</ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 时间线（rejected 已排除） */}
          {timeline.length > 0 && (
            <div className="brutal bg-card p-3">
              <SectionTitle color="bg-blue">时间线</SectionTitle>
              <div className="space-y-1.5 mt-2 text-xs">
                {timeline.map(cl => (
                  <div key={cl.id} className="flex gap-2 flex-wrap items-baseline">
                    <span className="font-bold shrink-0 w-24 font-mono">{cl.publishedAt}</span>
                    <span>{cl.claim}</span>
                    {(cl.sourceIds || []).slice(0, 2).map(sid => (
                      <a key={sid} href={sourceById.get(sid)?.url || "#"} target="_blank" rel="noreferrer"
                        className="brutal-chip px-1 py-0.5 shrink-0 hover:bg-muted">{sid}</a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 证据主张原文（含 rejected 灰显带理由） */}
          {allClaims.length > 0 && (
            <details className="brutal bg-card">
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold font-heading select-none">
                证据主张原文（{allClaims.length}{rejectedClaims.length > 0 ? `，含已排除 ${rejectedClaims.length}` : ""}）
              </summary>
              <div className="p-3 pt-0 space-y-2 text-xs">
                {allClaims.map(cl => {
                  const rej = cl.status === "rejected";
                  return (
                    <div key={cl.id} className={`border-2 border-border p-2 ${rej ? "opacity-50" : ""}`}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{cl.claim}</span>
                        <span className={`brutal-chip px-1.5 py-0.5 ${rej ? "bg-pink-soft" : "bg-muted"}`}>
                          {CLAIM_STATUS_LABEL[cl.status] || cl.status}
                        </span>
                        {(cl.sourceIds || []).map(sid => (
                          <a key={sid} href={sourceById.get(sid)?.url || "#"} target="_blank" rel="noreferrer"
                            className="brutal-chip px-1.5 py-0.5 hover:bg-muted">{sid}</a>
                        ))}
                      </div>
                      {cl.quote && <p className="text-muted-foreground mt-1">「{cl.quote}」</p>}
                      {rej && <p className="text-muted-foreground mt-1">✕ 已排除：{cl.rejectedReason || "用户指出有误"}</p>}
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* 研究轮次 */}
          {rounds.length > 0 && (
            <details className="brutal bg-card">
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold font-heading select-none">
                研究轮次（{rounds.length}）
              </summary>
              <div className="p-3 pt-0 space-y-1.5 text-xs">
            {rounds.map(r => (
              <div key={r.id} className="flex gap-2 flex-wrap">
                <span className="font-bold shrink-0">
                  第 {r.n} 轮（{r.business ? "商业调查" : r.deep ? "深挖" : r.kind === "discovery" ? "候选发现" : "定向研究"}）
                </span>
                {r.input && <span className="truncate">{r.input}</span>}
                <span className="text-muted-foreground ml-auto font-mono">
                  {r.filterStats?.rawResults != null
                    ? `原始 ${r.filterStats.rawResults} → 采纳 ${(r.filterStats.persistedEvidence ?? r.filterStats.accepted ?? 0)}${r.filterStats.leadOnly ? ` + 线索 ${r.filterStats.leadOnly}` : ""} · `
                    : ""}
                  查询 {r.queryCount ?? 0} · 主张变更 {r.newClaimIds?.length ?? 0}
                </span>
              </div>
            ))}
              </div>
            </details>
          )}

          {/* 来源清单 */}
          {(data?.sources?.length ?? 0) > 0 && (
            <details className="brutal bg-card">
              <summary className="cursor-pointer px-3 py-2 text-sm font-bold font-heading select-none">
                来源清单（{data?.sources?.length}）
              </summary>
              <div className="p-3 pt-0 space-y-1.5 text-xs">
                {(data?.sources || []).map(s => (
                  <div key={s.id} className="flex gap-2 items-baseline flex-wrap">
                    <span className="brutal-chip px-1 py-0.5 bg-muted">{s.id}</span>
                    <span className={`brutal-chip px-1 py-0.5 ${s.domainClass === "A" ? "bg-lime-soft" : s.domainClass === "B" ? "bg-blue-soft" : ""}`}>
                      {s.domainClass}
                    </span>
                    <a href={s.url} target="_blank" rel="noreferrer" className="truncate hover:underline flex-1 min-w-40">
                      {s.title || s.url}
                    </a>
                    <span className="text-muted-foreground">{s.scraped ? "已抓正文" : "仅摘要"}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {continueBox}
    </div>
  );
}
