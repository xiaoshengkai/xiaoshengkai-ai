"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Gauge,
  Clock,
  RefreshCw,
  Server,
  Database,
  Box,
} from "lucide-react";

interface ServerStatus {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  node: string;
  uptime: number;
  loadavg: number[];
  cpu: { model: string; cores: number; usage: number; perCore: number[] };
  memory: { total: number; free: number; used: number; usage: number };
  disk: {
    total: number; free: number; used: number; usage: number;
    inodeTotal: number; inodeFree: number; inodeUsage: number;
  } | null;
  swap: { total: number; free: number; used: number; usage: number } | null;
  nodeRss: number;
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

function Bar({ pct, className = "" }: { pct: number; className?: string }) {
  return (
    <div className={`border-2 border-border bg-muted overflow-hidden ${className}`}>
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
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border shrink-0">
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
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {!data ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">📡</span>
            <p className="text-sm">加载中...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 md:min-h-full">
            {/* 核心资源：3 张大卡 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:flex-1">
              {/* CPU */}
              <div className="brutal bg-card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 shrink-0 border-2 border-border bg-blue-soft flex items-center justify-center">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-foreground">CPU</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate" title={data.cpu.model}>
                        {data.cpu.model}
                      </div>
                    </div>
                  </div>
                  <span className="text-4xl font-black text-foreground">{data.cpu.usage}%</span>
                </div>
                <div className="mt-3">
                  <Bar pct={data.cpu.usage} className="h-3" />
                </div>
                <div className="mt-auto pt-4">
                  <div className="flex items-end gap-1.5 h-16">
                    {data.cpu.perCore.map((v, i) => (
                      <div key={i} className="flex-1 h-full border-2 border-border bg-muted relative overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 right-0 transition-all duration-500"
                          style={{ height: `${Math.max(0, Math.min(100, v))}%`, background: usageColor(v) }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-1.5 text-center">
                    {data.cpu.cores} 核占用
                  </div>
                </div>
              </div>

              {/* 内存 */}
              <div className="brutal bg-card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 shrink-0 border-2 border-border bg-pink-soft flex items-center justify-center">
                      <MemoryStick className="w-5 h-5" />
                    </div>
                    <div className="text-sm font-bold text-foreground">内存</div>
                  </div>
                  <span className="text-4xl font-black text-foreground">{data.memory.usage}%</span>
                </div>
                <div className="mt-3">
                  <Bar pct={data.memory.usage} className="h-3" />
                </div>
                <div className="mt-auto pt-4 text-xs font-mono text-muted-foreground">
                  已用 {fmtBytes(data.memory.used)} / {fmtBytes(data.memory.total)}
                </div>
              </div>

              {/* 磁盘 */}
              <div className="brutal bg-card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 shrink-0 border-2 border-border bg-orange-soft flex items-center justify-center">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div className="text-sm font-bold text-foreground">磁盘</div>
                  </div>
                  <span className="text-4xl font-black text-foreground">{data.disk ? `${data.disk.usage}%` : "—"}</span>
                </div>
                {data.disk ? (
                  <>
                    <div className="mt-3">
                      <Bar pct={data.disk.usage} className="h-3" />
                    </div>
                    <div className="mt-auto pt-4 text-xs font-mono text-muted-foreground">
                      {fmtBytes(data.disk.used)} / {fmtBytes(data.disk.total)} · inode {data.disk.inodeUsage}%
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground mt-3">无法读取磁盘信息</div>
                )}
              </div>
            </div>

            {/* 次要指标：5 张小卡 */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {/* 网络 */}
              <div className="brutal bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 shrink-0 border-2 border-border bg-purple-soft flex items-center justify-center">
                    <Network className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-foreground">网络</span>
                </div>
                {data.net ? (
                  <div className="mt-auto space-y-1 font-mono">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">↓ 下行</span>
                      <span className="text-base font-black text-foreground">{fmtRate(data.net.rx)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">↑ 上行</span>
                      <span className="text-base font-black text-foreground">{fmtRate(data.net.tx)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-auto">不支持</div>
                )}
              </div>

              {/* 负载 */}
              <div className="brutal bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 shrink-0 border-2 border-border bg-yellow-soft flex items-center justify-center">
                    <Gauge className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-foreground">负载</span>
                </div>
                <div className="mt-auto">
                  <div className="text-xl font-black text-foreground">{data.loadavg[0].toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    5 分 {data.loadavg[1].toFixed(2)} · 15 分 {data.loadavg[2].toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 运行时长 */}
              <div className="brutal bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 shrink-0 border-2 border-border bg-lime-soft flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-foreground">运行时长</span>
                </div>
                <div className="mt-auto">
                  <div className="text-xl font-black text-foreground">{fmtUptime(data.uptime)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">更新 {updatedAt}</div>
                </div>
              </div>

              {/* Swap */}
              <div className="brutal bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 shrink-0 border-2 border-border bg-muted flex items-center justify-center">
                    <Database className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-foreground">Swap</span>
                </div>
                {data.swap ? (
                  <div className="mt-auto">
                    <div className="text-xl font-black text-foreground">{data.swap.usage}%</div>
                    <Bar pct={data.swap.usage} className="h-2 mt-1" />
                    <div className="text-[10px] text-muted-foreground font-mono mt-1">
                      {fmtBytes(data.swap.used)} / {fmtBytes(data.swap.total)}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground mt-auto">无 Swap</div>
                )}
              </div>

              {/* Node 内存 */}
              <div className="brutal bg-card p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 shrink-0 border-2 border-border bg-muted flex items-center justify-center">
                    <Box className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-foreground">Node 内存</span>
                </div>
                <div className="mt-auto">
                  <div className="text-xl font-black text-foreground">{fmtBytes(data.nodeRss)}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">进程 RSS</div>
                </div>
              </div>
            </div>

            {/* 系统信息 */}
            <div className="brutal bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 border-2 border-border bg-muted flex items-center justify-center">
                  <Server className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-foreground">系统信息</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[11px]">
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
