/**
 * 服务器状态工具 API
 * ============================================================================
 * GET → 采集 CPU / 内存 / 磁盘 / 负载 / 网络 / 系统信息。
 * 纯 Node 实现（os + fs.statfs + /proc/net/dev），零外部命令、零依赖。
 * 网络吞吐仅在 Linux 可用（/proc/net/dev），非 Linux 返回 null（前端自动隐藏）。
 */
import { NextResponse } from "next/server";
import os from "node:os";
import fs from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sampleCpu() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function sampleNet() {
  try {
    const data = fs.readFileSync("/proc/net/dev", "utf-8");
    let rx = 0;
    let tx = 0;
    for (const line of data.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1 || !line.slice(0, idx).trim()) continue;
      const fields = line.slice(idx + 1).trim().split(/\s+/).map(Number);
      if (fields.length >= 9) {
        rx += fields[0];
        tx += fields[8];
      }
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

function diskInfo() {
  try {
    const s = fs.statfsSync("/");
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - free;
    const inodeTotal = s.files;
    const inodeFree = s.ffree;
    return {
      total,
      free,
      used,
      usage: total > 0 ? Number(((used / total) * 100).toFixed(1)) : 0,
      inodeTotal,
      inodeFree,
      inodeUsage: inodeTotal > 0 ? Number((((inodeTotal - inodeFree) / inodeTotal) * 100).toFixed(1)) : 0,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const cpuA = sampleCpu();
  const netA = sampleNet();
  await sleep(800);
  const cpuB = sampleCpu();
  const netB = sampleNet();

  const cpuIdleDelta = cpuB.idle - cpuA.idle;
  const cpuTotalDelta = cpuB.total - cpuA.total;
  const cpuUsage = cpuTotalDelta > 0
    ? Math.max(0, Math.min(100, ((cpuTotalDelta - cpuIdleDelta) / cpuTotalDelta) * 100))
    : 0;

  let net = null;
  if (netA && netB) {
    net = {
      rx: Math.max(0, (netB.rx - netA.rx) / 0.8),
      tx: Math.max(0, (netB.tx - netA.tx) / 0.8),
    };
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return NextResponse.json({
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    cpu: {
      model: os.cpus()[0]?.model || "",
      cores: os.cpus().length,
      usage: Number(cpuUsage.toFixed(1)),
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usage: Number(((usedMem / totalMem) * 100).toFixed(1)),
    },
    disk: diskInfo(),
    net,
  });
}
