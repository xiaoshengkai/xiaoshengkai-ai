"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { Cpu, MemoryStick, HardDrive, Network, Gauge, Clock, RefreshCw, Server } from "lucide-react";

interface ServerStatus {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  node: string;
  uptime: number;
  loadavg: number[];
  cpu: { model: string; cores: number; usage: number };
  memory: { total: number; free: number; used: number; usage: number };
  disk: {
    total: number; free: number; used: number; usage: number;
    inodeTotal: number; inodeFree: number; inodeUsage: number;
  } | null;
  net: { rx: number; tx: number } | null;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 4) return (n / 1024 ** 4).toFixed(1) + "TB";
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + "GB";
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + "MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + "KB";
  return Math.round(n) + "B";
}

const fmtRate = (n: number) => `${fmtBytes(n)}/s`;

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

function usageColor(pct: number): string {
  if (pct >= 85) return "var(--destructive)";
  if (pct >= 60) return "var(--yellow)";
  return "var(--lime)";
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="flex-1 h-2 border-2 border-border bg-muted overflow-hidden">
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: usageColor(pct) }}
      />
    </div>
  );
}

export default function ServerStatusTool() {
  const router = useRouter();
  const [data, setData] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tools/server-status`);
      if (res.ok) {
        setData(await res.json());
        setUpdatedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 5000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground font-heading">服务器状态</h2>
          <p className="text-xs text-muted-foreground">实时监控 CPU / 内存 / 磁盘 / 负载 / 网络</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/tools")}
            className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
          >
            返回
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue text-white disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 overflow-auto p-4">
        {!data ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">📡</span>
            <p className="text-sm">加载中...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* CPU */}
            <div className="brutal bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" /> CPU
                </span>
                <span className="text-sm font-black text-foreground">{data.cpu.usage}%</span>
              </div>
              <Bar pct={data.cpu.usage} />
              <div className="text-[10px] text-muted-foreground mt-2 font-mono truncate" title={data.cpu.model}>
                {data.cpu.model}
              </div>
              <div className="text-[10px] text-muted-foreground/70 font-mono">{data.cpu.cores} 核</div>
            </div>

            {/* 内存 */}
            <div className="brutal bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5">
                  <MemoryStick className="w-3.5 h-3.5" /> 内存
                </span>
                <span className="text-sm font-black text-foreground">{data.memory.usage}%</span>
              </div>
              <Bar pct={data.memory.usage} />
              <div className="text-[10px] text-muted-foreground mt-2 font-mono">
                {fmtBytes(data.memory.used)} / {fmtBytes(data.memory.total)}
              </div>
            </div>

            {/* 磁盘 */}
            <div className="brutal bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" /> 磁盘
                </span>
                {data.disk && <span className="text-sm font-black text-foreground">{data.disk.usage}%</span>}
              </div>
              {data.disk ? (
                <>
                  <Bar pct={data.disk.usage} />
                  <div className="text-[10px] text-muted-foreground mt-2 font-mono">
                    {fmtBytes(data.disk.used)} / {fmtBytes(data.disk.total)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 font-mono">inode {data.disk.inodeUsage}%</div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">无法读取磁盘信息</div>
              )}
            </div>

            {/* 网络 */}
            <div className="brutal bg-card p-4">
              <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5 mb-2">
                <Network className="w-3.5 h-3.5" /> 网络
              </span>
              {data.net ? (
                <div className="space-y-1 font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-6">↓</span>
                    <span className="text-foreground font-bold">{fmtRate(data.net.rx)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-6">↑</span>
                    <span className="text-foreground font-bold">{fmtRate(data.net.tx)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">当前系统不支持</div>
              )}
            </div>

            {/* 负载 */}
            <div className="brutal bg-card p-4">
              <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5 mb-2">
                <Gauge className="w-3.5 h-3.5" /> 负载
              </span>
              <div className="flex items-end gap-3 font-mono">
                {data.loadavg.map((v, i) => (
                  <div key={i}>
                    <div className="text-lg font-black text-foreground">{v.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground">{["1 分钟", "5 分钟", "15 分钟"][i]}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 运行时长 + 系统信息 */}
            <div className="brutal bg-card p-4">
              <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5 mb-2">
                <Clock className="w-3.5 h-3.5" /> 运行时长
              </span>
              <div className="text-lg font-black text-foreground">{fmtUptime(data.uptime)}</div>
              <div className="text-[10px] text-muted-foreground/70 font-mono mt-1">
                上次更新 {updatedAt}
              </div>
            </div>

            {/* 系统信息 */}
            <div className="brutal bg-card p-4 md:col-span-2 xl:col-span-3">
              <span className="text-xs font-bold text-foreground inline-flex items-center gap-1.5 mb-2">
                <Server className="w-3.5 h-3.5" /> 系统信息
              </span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
                <div>
                  <div className="text-muted-foreground">主机名</div>
                  <div className="text-foreground truncate">{data.hostname}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">系统</div>
                  <div className="text-foreground">{data.platform} {data.release}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">架构</div>
                  <div className="text-foreground">{data.arch}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Node</div>
                  <div className="text-foreground">{data.node}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
