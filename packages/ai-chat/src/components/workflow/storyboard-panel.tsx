"use client";

/**
 * video-generation 分镜表确认面板（storyboard 步骤 awaiting_input 停靠时渲染）：
 * 拍列表 + 悬念/比喻摘要 + 反馈重生成 / 确认放行（POST storyboard-confirm → auto，person-research 同款）。
 */
import { BASE } from "@/lib/utils/utils";
import { useState } from "react";
import { toast } from "sonner";

export interface StoryboardPanelProps {
  executionId: string;
  output: string | null;
  onRefresh: () => void;
}

interface Beat {
  id: string;
  role: string;
  narration: string;
  presentAction: string;
  onScreen: string;
  sceneType: string;
  durationSec?: number;
  note?: string;
  takeaway?: string;
}

interface Storyboard {
  thesis?: string;
  coreMetaphor?: string;
  instrument?: string;
  suspensePlan?: string;
  reversals?: number | string;
  beats: Beat[];
}

const ROLE_LABELS: Record<string, string> = {
  hook: "钩子", title: "主题", story: "故事", model: "机制",
  reveal: "揭晓", landing: "落点", outro: "结尾",
};

const ROLE_COLORS: Record<string, string> = {
  hook: "#e94560", title: "#f5a623", story: "#3d5afe", model: "#9c27b0",
  reveal: "#e94560", landing: "#00a86b", outro: "#f5a623",
};

function parseStoryboard(output: string | null): Storyboard | null {
  if (!output) return null;
  try {
    const obj = typeof output === "string" ? JSON.parse(output) : output;
    const sb = typeof obj?.storyboard === "string" ? JSON.parse(obj.storyboard) : obj?.storyboard;
    if (Array.isArray(sb?.beats)) return sb;
    return null;
  } catch {
    return null;
  }
}

export default function StoryboardPanel({ executionId, output, onRefresh }: StoryboardPanelProps) {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const storyboard = parseStoryboard(output);

  if (!storyboard) {
    return (
      <div className="brutal bg-card p-4" style={{ border: "3px solid var(--border)", boxShadow: "4px 4px 0 var(--border)" }}>
        <p className="text-sm font-bold">分镜表数据解析失败</p>
        <p className="text-xs text-muted-foreground mt-1">可点「确认分镜」跳过确认直接推进。</p>
        <ConfirmButton executionId={executionId} onRefresh={onRefresh} />
      </div>
    );
  }

  const totalSec = storyboard.beats.reduce((s, b) => s + (b.durationSec || 3), 0);

  const submit = async (mode: "confirm" | "revise") => {
    if (mode === "revise" && !feedback.trim()) {
      toast("🔴 请先填写反馈");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/workflows/execution/${executionId}/storyboard-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: mode === "revise" ? feedback.trim() : "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast(`🔴 ${data.error || "操作失败"}`);
        return;
      }
      await fetch(`${BASE}/api/workflows/execution/${executionId}/auto`, { method: "POST" }).catch(() => {});
      toast(mode === "revise" ? "分镜表重生成中..." : "已确认，继续生成场景...");
      onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pb-4">
      <div className="brutal bg-card p-3" style={{ border: "3px solid var(--border)", boxShadow: "4px 4px 0 var(--border)" }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-extrabold">分镜表 · 等待确认</h2>
          <span className="text-xs text-muted-foreground">{storyboard.beats.length} 拍 / 约 {Math.round(totalSec)} 秒</span>
        </div>
        {storyboard.thesis && (
          <p className="text-xs mb-1"><span className="font-bold">论点：</span>{storyboard.thesis}</p>
        )}
        {storyboard.coreMetaphor && (
          <p className="text-xs mb-1"><span className="font-bold">核心比喻：</span>{storyboard.coreMetaphor}</p>
        )}
        {storyboard.instrument && (
          <p className="text-xs mb-1"><span className="font-bold">常驻读数：</span>{storyboard.instrument}</p>
        )}
        {storyboard.suspensePlan && (
          <p className="text-xs mb-1"><span className="font-bold">悬念设计：</span>{storyboard.suspensePlan}</p>
        )}
        {storyboard.reversals != null && (
          <p className="text-xs"><span className="font-bold">反转层数：</span>{String(storyboard.reversals)} 层</p>
        )}
      </div>

      <div className="space-y-1.5">
        {storyboard.beats.map((b, i) => (
          <div key={b.id || i} className="brutal bg-card p-2.5" style={{ border: "2px solid var(--border)", boxShadow: "3px 3px 0 var(--border)" }}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-extrabold">#{i + 1}</span>
              <span className="text-xs px-1.5 py-0.5 font-bold text-white"
                style={{ background: ROLE_COLORS[b.role] || "var(--muted-foreground)" }}>
                {ROLE_LABELS[b.role] || b.role}
              </span>
              <span className="text-xs px-1.5 py-0.5 border-2 border-border bg-muted font-bold">{b.presentAction}</span>
              <span className="text-xs px-1.5 py-0.5 border-2 border-border bg-blue-soft font-bold">{b.sceneType}</span>
              <span className="text-xs text-muted-foreground ml-auto">{b.durationSec != null ? `${b.durationSec}s` : ""}</span>
            </div>
            <p className="text-sm font-bold leading-snug">{b.narration}</p>
            {b.onScreen && <p className="text-xs text-muted-foreground mt-1">屏上：{b.onScreen}</p>}
            {b.note && <p className="text-xs text-muted-foreground">小字：{b.note}</p>}
            {b.takeaway && <p className="text-xs text-muted-foreground/70">明白：{b.takeaway}</p>}
          </div>
        ))}
      </div>

      <div className="brutal bg-card p-3 sticky bottom-0" style={{ border: "3px solid var(--border)", boxShadow: "4px 4px 0 var(--border)" }}>
        <label className="text-xs font-bold block mb-1.5">修改意见（可选，留空则直接确认）</label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="例如：悬念再往后埋两拍；第二拍旁白改成提问；核心比喻换成抽奖箱"
          className="w-full h-20 px-3 py-2 text-sm border-2 border-[var(--border)] rounded-none resize-none focus:outline-none bg-card"
          style={{ boxShadow: "2px 2px 0 var(--muted)" }}
          disabled={submitting}
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => submit("confirm")}
            disabled={submitting}
            className="brutal-btn px-4 py-1.5 text-xs font-bold cursor-pointer text-white"
            style={{ border: "2px solid var(--border)", background: submitting ? "var(--muted)" : "var(--blue)", boxShadow: "2px 2px 0 var(--border)" }}
          >
            {submitting ? "提交中..." : "✓ 确认分镜，继续生成"}
          </button>
          <button
            onClick={() => submit("revise")}
            disabled={submitting}
            className="brutal-btn px-4 py-1.5 text-xs font-bold cursor-pointer"
            style={{ border: "2px solid var(--border)", background: submitting ? "var(--muted)" : "var(--primary)", color: "var(--primary-foreground)", boxShadow: "2px 2px 0 var(--border)" }}
          >
            按反馈重新生成
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmButton({ executionId, onRefresh }: { executionId: string; onRefresh: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setSubmitting(true);
    try {
      await fetch(`${BASE}/api/workflows/execution/${executionId}/storyboard-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: "" }),
      });
      await fetch(`${BASE}/api/workflows/execution/${executionId}/auto`, { method: "POST" }).catch(() => {});
      onRefresh();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <button onClick={submit} disabled={submitting}
      className="brutal-btn mt-3 px-4 py-1.5 text-xs font-bold cursor-pointer text-white"
      style={{ border: "2px solid var(--border)", background: "var(--blue)", boxShadow: "2px 2px 0 var(--border)" }}>
      {submitting ? "提交中..." : "✓ 确认分镜，继续生成"}
    </button>
  );
}
