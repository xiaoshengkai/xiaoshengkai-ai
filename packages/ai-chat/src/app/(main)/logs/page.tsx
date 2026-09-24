"use client";

import { BASE } from "@/lib/utils/utils";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, ScrollText } from "lucide-react";
import { getLogColor } from "@/lib/utils/log-color";

interface LogFile {
  file: string;
  size: number;
}
interface LogGroup {
  name: string;
  files: LogFile[];
}

export default function LogsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<LogGroup[]>([]);
  const [group, setGroup] = useState("app");
  const [file, setFile] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [auto, setAuto] = useState(true);

  const loadList = useCallback(async (): Promise<LogGroup[]> => {
    try {
      const res = await fetch(`${BASE}/api/logs?list=1`);
      const data = await res.json();
      const gs: LogGroup[] = data.groups || [];
      setGroups(gs);
      return gs;
    } catch {
      return [];
    }
  }, []);

  const loadLines = useCallback(async (g: string, f: string) => {
    if (!f) { setLines([]); return; }
    try {
      const res = await fetch(`${BASE}/api/logs?group=${encodeURIComponent(g)}&file=${encodeURIComponent(f)}&tail=300`);
      const data = await res.json();
      setLines(data.lines || []);
    } catch { /* ignore */ }
  }, []);

  // 首次：拉列表 + 默认选中首个有文件的分组最新文件
  useEffect(() => {
    (async () => {
      const gs = await loadList();
      const target = gs.find((g) => g.name === "app" && g.files.length) || gs.find((g) => g.files.length);
      if (target) {
        setGroup(target.name);
        setFile(target.files[0].file);
        loadLines(target.name, target.files[0].file);
      }
    })();
  }, [loadList, loadLines]);

  // 自动刷新
  useEffect(() => {
    if (!auto || !file) return;
    const timer = setInterval(() => loadLines(group, file), 5000);
    return () => clearInterval(timer);
  }, [auto, group, file, loadLines]);

  const files = groups.find((g) => g.name === group)?.files || [];
  const downloadHref = file
    ? `${BASE}/api/logs?group=${encodeURIComponent(group)}&file=${encodeURIComponent(file)}&download=1`
    : "#";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border shrink-0">
        <h2 className="text-lg font-bold text-foreground font-heading flex items-center gap-2">
          <ScrollText className="size-5" /> 日志
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAuto((a) => !a)}
            className={`brutal-btn px-3 py-1 text-xs font-mono font-bold ${auto ? "bg-lime text-white" : "bg-card text-foreground"}`}
          >
            自动刷新 {auto ? "开" : "关"}
          </button>
          <button
            onClick={() => loadLines(group, file)}
            className="brutal-btn px-3 py-1 text-xs font-mono flex items-center gap-1 bg-card text-foreground"
          >
            <RefreshCw className="size-3" /> 刷新
          </button>
          <a
            href={downloadHref}
            className="brutal-btn px-3 py-1 text-xs font-mono flex items-center gap-1 bg-primary text-primary-foreground"
          >
            <Download className="size-3" /> 下载
          </a>
          <button
            onClick={() => router.push("/")}
            className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground"
          >
            返回聊天
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* 文件树 */}
        <div className="w-64 shrink-0 border-r-2 border-border overflow-y-auto p-3 space-y-3 bg-card">
          {groups.map((g) => (
            <div key={g.name}>
              <div className="text-[11px] font-bold font-mono mb-1 uppercase text-foreground">{g.name}</div>
              <div className="space-y-1">
                {g.files.length === 0 && <div className="text-[11px] text-muted-foreground/50 font-mono">无</div>}
                {g.files.map((f) => {
                  const active = group === g.name && file === f.file;
                  return (
                    <button
                      key={f.file}
                      onClick={() => { setGroup(g.name); setFile(f.file); loadLines(g.name, f.file); }}
                      className={`block w-full text-left brutal-btn px-2 py-1 text-[11px] font-mono truncate ${active ? "bg-yellow text-foreground" : "bg-card text-foreground"}`}
                      title={f.file}
                    >
                      {f.file} <span className="opacity-50">({(f.size / 1024).toFixed(0)}KB)</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 日志流 */}
        <div className="flex-1 min-w-0 overflow-y-auto p-3 bg-card">
          {lines.length === 0 ? (
            <p className="text-[11px] font-mono text-muted-foreground/50">暂无日志</p>
          ) : (
            <div className="space-y-0.5">
              {lines.map((line, i) => (
                <div key={i} className="text-[10px] font-mono leading-relaxed break-all" style={getLogColor(line)}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
