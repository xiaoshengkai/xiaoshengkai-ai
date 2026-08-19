"use client";

import { BASE } from "@/lib/utils/utils";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, ExternalLink, Pencil } from "lucide-react";
import { toast } from "sonner";

const CRON_PRESETS = [
  { label: "选择预设", cron: "" },
  { label: "每天 09:30", cron: "30 9 * * *" },
  { label: "每天 18:00", cron: "0 18 * * *" },
  { label: "工作日 09:00", cron: "0 9 * * 1-5" },
  { label: "每小时", cron: "0 * * * *" },
  { label: "每 30 分钟", cron: "*/30 * * * *" },
  { label: "每周一 08:00", cron: "0 8 * * 1" },
  { label: "每月 1 号 09:00", cron: "0 9 1 * *" },
];

interface Task {
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  html?: string;
  until: string | null;
  running: boolean;
  lastRun: string | null;
}

export default function SchedulePage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editForm, setEditForm] = useState({ cron: "", enabled: true, until: "", description: "" });

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks);
      }
    } catch { /* ignore */ }
    setInitialized(true);
  }, []);

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(fetchTasks, 10000);
    return () => clearInterval(timer);
  }, [fetchTasks]);

  const handleRun = useCallback(async (name: string) => {
    setRunning(name);
    try {
      const res = await fetch(`${BASE}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("🟢 执行成功");
        // 通知 Chrome 扩展弹通知
        console.log("[schedule] 发送通知到扩展:", { type: "REMINDER_RUN", task: name });
        window.postMessage({ type: "REMINDER_RUN", task: name }, "*");
      } else {
        toast(`🔴 执行失败: ${data.error}`);
      }
    } catch {
      toast("🔴 请求失败");
    }
    setRunning(null);
    fetchTasks();
  }, [fetchTasks]);

  const handleEdit = useCallback((task: Task) => {
    setEditingTask(task);
    setEditForm({
      cron: task.cron,
      enabled: task.enabled,
      until: task.until || "",
      description: task.description,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingTask) return;
    try {
      const res = await fetch(`${BASE}/api/tasks`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingTask.name,
          cron: editForm.cron,
          enabled: editForm.enabled,
          until: editForm.until || null,
          description: editForm.description,
        }),
      });
      if (res.ok) {
        toast("🟢 保存成功");
        setEditingTask(null);
        fetchTasks();
      } else {
        toast("🔴 保存失败");
      }
    } catch {
      toast("🔴 请求失败");
    }
  }, [editingTask, editForm, fetchTasks]);

  const statusColor = (task: Task) => {
    return task.running ? "bg-yellow animate-pulse" : "bg-lime";
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return "--";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  };

  if (!initialized) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-[3px] border-border">
        <h2 className="text-lg font-bold text-foreground font-heading">定时任务</h2>
        <button
          onClick={() => router.push("/")}
          className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
        >
          返回聊天
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <span className="text-3xl">🕐</span>
            <p className="text-sm">暂无定时任务</p>
            <p className="text-xs text-muted-foreground/60">在对话中说&ldquo;帮我创建一个定时任务&rdquo;即可开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tasks.map(task => (
              <div
                key={task.name}
                className="brutal bg-card p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full align-middle ${statusColor(task)} ${task.running ? "animate-pulse" : ""}`} />
                    <span className="text-sm font-bold text-foreground">{task.name}</span>
                  </div>
                  {!task.enabled && (
                    <span className="text-xs px-2 py-0.5 bg-yellow-soft text-foreground border-2 border-yellow">已暂停</span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mb-2">{task.description}</p>
                <p className="text-xs text-muted-foreground/70 font-mono mb-2">Cron: {task.cron}</p>
                {task.until && (
                  <p className="text-xs text-muted-foreground/70 mb-2">截止: {task.until}</p>
                )}

                {task.lastRun && (
                  <p className="text-xs text-muted-foreground/70 mb-2">
                    上次运行: {formatTime(task.lastRun)}
                  </p>
                )}

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleRun(task.name)}
                    disabled={running === task.name}
                    className={`brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold ${running === task.name ? "bg-muted text-muted-foreground" : "bg-blue text-white"}`}
                  >
                    <Play className="w-3 h-3" />
                    {running === task.name ? "执行中..." : "立即执行"}
                  </button>
                  {task.html && (
                    <a
                      href={`${BASE}/api/tasks/${task.name}/dashboard`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-primary text-primary-foreground"
                    >
                      <ExternalLink className="w-3 h-3" />
                      页面
                    </a>
                  )}
                  <button
                    onClick={() => handleEdit(task)}
                    className="brutal-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold bg-card text-foreground"
                  >
                    <Pencil className="w-3 h-3" />
                    编辑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingTask(null)}>
          <div
            className="brutal bg-card p-6 w-96"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-foreground mb-4">编辑: {editingTask.name}</h3>
<div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cron 表达式</label>
                <input
                  type="text"
                  value={editForm.cron}
                  onChange={e => setEditForm({ ...editForm, cron: e.target.value })}
                  className="w-full px-2 py-1 text-xs font-mono border-2 border-border"
                />
                <select
                  value={editForm.cron}
                  onChange={e => { if (e.target.value) setEditForm({ ...editForm, cron: e.target.value }); }}
                  className="w-full mt-1 px-2 py-1 text-xs border-2 border-border bg-card"
                >
                  {CRON_PRESETS.map(p => (
                    <option key={p.cron} value={p.cron}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">描述</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full px-2 py-1 text-xs border-2 border-border"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">结束日期（可选）</label>
                <input
                  type="date"
                  value={editForm.until}
                  onChange={e => setEditForm({ ...editForm, until: e.target.value })}
                  className="w-full px-2 py-1 text-xs border-2 border-border"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="task-enabled"
                  checked={editForm.enabled}
                  onChange={e => setEditForm({ ...editForm, enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="task-enabled" className="text-xs text-muted-foreground">启用</label>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setEditingTask(null)}
                className="brutal-btn px-3 py-1 text-xs font-bold bg-card text-foreground"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="brutal-btn px-3 py-1 text-xs font-bold bg-blue text-white"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}