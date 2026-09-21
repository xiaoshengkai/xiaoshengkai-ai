"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/ui/logo";
import { BASE } from "@/lib/utils/utils";

// 背景糖果贴纸：旋转黑边硬阴影方块（md 以下隐藏，防手机端杂乱）
const STICKERS: { className: string; style: React.CSSProperties }[] = [
  { className: "bg-pink", style: { top: "12%", left: "10%", width: 56, height: 56, transform: "rotate(-8deg)" } },
  { className: "bg-blue", style: { top: "18%", right: "12%", width: 40, height: 40, transform: "rotate(10deg)" } },
  { className: "bg-lime", style: { bottom: "16%", left: "14%", width: 44, height: 44, transform: "rotate(7deg)" } },
  { className: "bg-yellow", style: { bottom: "12%", right: "10%", width: 64, height: 64, transform: "rotate(-6deg)" } },
  { className: "bg-pink-soft", style: { top: "45%", left: "5%", width: 28, height: 28, transform: "rotate(14deg)" } },
  { className: "bg-blue-soft", style: { top: "40%", right: "5%", width: 32, height: 32, transform: "rotate(-12deg)" } },
  { className: "bg-transparent", style: { top: "28%", left: "22%", width: 36, height: 36, transform: "rotate(-14deg)" } },
  { className: "bg-transparent", style: { bottom: "30%", right: "20%", width: 48, height: 48, transform: "rotate(9deg)" } },
];

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(data.error || `登录失败 (${res.status})`);
        setLoading(false);
      }
    } catch (err) {
      setError(`网络错误: ${(err as Error).message}`);
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-dvh bg-background relative overflow-hidden flex items-center justify-center p-4"
      style={{
        backgroundImage:
          "radial-gradient(color-mix(in srgb, var(--foreground) 14%, transparent) 1.5px, transparent 1.5px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* 远景 soft 色块：无边框无阴影，与黑边小贴纸形成景深 */}
      <div aria-hidden className="hidden md:block absolute -top-28 -right-28 w-96 h-96 bg-yellow-soft" style={{ transform: "rotate(12deg)" }} />
      <div aria-hidden className="hidden md:block absolute -bottom-32 -left-32 w-[28rem] h-[28rem] bg-blue-soft" style={{ transform: "rotate(-10deg)" }} />

      {STICKERS.map((s, i) => (
        <div
          key={i}
          aria-hidden
          className={`absolute hidden md:block border-2 border-border ${s.className}`}
          style={{ ...s.style, boxShadow: s.className === "bg-transparent" ? "none" : "var(--shadow-sm)" }}
        />
      ))}

      <div className="brutal bg-card w-full max-w-md p-10 relative animate-in fade-in zoom-in-95 duration-300">
        <div className="flex justify-center">
          <Logo size={16} />
        </div>
        <h1 className="text-3xl font-black tracking-widest font-heading text-foreground text-center mt-6">
          小盛开AI
        </h1>
        <p className="text-[10px] font-mono tracking-widest text-muted-foreground text-center mt-2">
          PRIVATE ACCESS ▸ 请输入登录密码
        </p>
        <div className="flex justify-center gap-1.5 mt-4">
          <span className="w-2.5 h-2.5 bg-pink" />
          <span className="w-2.5 h-2.5 bg-yellow" />
          <span className="w-2.5 h-2.5 bg-blue" />
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <span className="brutal-chip px-2 py-0.5 text-[10px] bg-yellow-soft mb-1.5 inline-block">
              PASSWORD
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoFocus
              autoComplete="current-password"
              className="w-full px-4 py-3 border-[3px] border-border bg-card text-base font-mono focus:outline-none focus:border-ring"
              style={{ boxShadow: "var(--shadow-md)" }}
            />
          </div>
          {error && (
            <div className="brutal bg-pink-soft p-2 text-xs font-mono text-foreground">{error}</div>
          )}
          <button
            type="submit"
            disabled={!password || loading}
            className={`brutal-btn w-full py-3 text-base font-black tracking-widest ${
              password && !loading ? "bg-primary text-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {loading ? "登录中..." : "登 录 ▸"}
          </button>
        </form>
      </div>
    </div>
  );
}
