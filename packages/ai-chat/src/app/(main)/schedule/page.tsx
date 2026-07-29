"use client";

import { BASE } from "@/lib/api-path";
import { useEffect, useState, useCallback } from "react";
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    return task.running ? "bg-yellow-400" : "bg-green-400";
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return "--";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  };

  if (!initialized) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">⏰ 定时任务</h2>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <span className="text-3xl">🕐</span>
            <p className="text-sm">暂无定时任务</p>
            <p className="text-xs text-gray-300">在对话中说&ldquo;帮我创建一个定时任务&rdquo;即可开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {tasks.map(task => (
              <div
                key={task.name}
                className="pixel-card bg-white rounded-lg p-4"
                style={{
                  border: "3px solid #1A1A1A",
                  boxShadow: "4px 4px 0 #1A1A1A",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full align-middle ${statusColor(task)} ${task.running ? "animate-pulse" : ""}`} />
                    <span className="text-sm font-bold text-gray-800">{task.name}</span>
                  </div>
                  {!task.enabled && (
                    <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-700">已暂停</span>
                  )}
                </div>

                <p className="text-xs text-gray-500 mb-2">{task.description}</p>
                <p className="text-xs text-gray-400 font-mono mb-2">Cron: {task.cron}</p>
                {task.until && (
                  <p className="text-xs text-gray-400 mb-2">截止: {task.until}</p>
                )}

                {task.lastRun && (
                  <p className="text-xs text-gray-400 mb-2">
                    上次运行: {formatTime(task.lastRun)}
                  </p>
                )}

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleRun(task.name)}
                    disabled={running === task.name}
                    className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
                    style={{
                      border: "2px solid #1A1A1A",
                      background: running === task.name ? "#e2e8f0" : "#5B8DEF",
                      color: running === task.name ? "#94a3b8" : "#fff",
                      boxShadow: "2px 2px 0 #1A1A1A",
                    }}
                  >
                    <Play className="w-3 h-3" />
                    {running === task.name ? "执行中..." : "立即执行"}
                  </button>
                  {task.html && (
                    <a
                      href={`${BASE}/api/tasks/${task.name}/dashboard`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
                      style={{
                        border: "2px solid #1A1A1A",
                        background: "#6BCB77",
                        color: "#fff",
                        boxShadow: "2px 2px 0 #1A1A1A",
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                      页面
                    </a>
                  )}
                  <button
                    onClick={() => handleEdit(task)}
                    className="pixel-btn inline-flex items-center gap-1 px-3 py-1 text-xs font-bold cursor-pointer"
                    style={{
                      border: "2px solid #1A1A1A",
                      background: "transparent",
                      color: "#1A1A1A",
                      boxShadow: "2px 2px 0 #1A1A1A",
                    }}
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
            className="bg-white rounded-lg p-6 w-96"
            style={{
              border: "3px solid #1A1A1A",
              boxShadow: "6px 6px 0 #1A1A1A",
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-gray-800 mb-4">编辑: {editingTask.name}</h3>
<div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Cron 表达式</label>
                <input
                  type="text"
                  value={editForm.cron}
                  onChange={e => setEditForm({ ...editForm, cron: e.target.value })}
                  className="w-full px-2 py-1 text-xs font-mono border-2 border-gray-300 rounded"
                />
                <select
                  value={editForm.cron}
                  onChange={e => { if (e.target.value) setEditForm({ ...editForm, cron: e.target.value }); }}
                  className="w-full mt-1 px-2 py-1 text-xs border-2 border-gray-300 rounded bg-white"
                >
                  {CRON_PRESETS.map(p => (
                    <option key={p.cron} value={p.cron}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">描述</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">结束日期（可选）</label>
                <input
                  type="date"
                  value={editForm.until}
                  onChange={e => setEditForm({ ...editForm, until: e.target.value })}
                  className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded"
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
                <label htmlFor="task-enabled" className="text-xs text-gray-500">启用</label>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => setEditingTask(null)}
                className="pixel-btn px-3 py-1 text-xs font-bold"
                style={{
                  border: "2px solid #1A1A1A",
                  background: "transparent",
                  color: "#1A1A1A",
                  boxShadow: "2px 2px 0 #1A1A1A",
                }}
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="pixel-btn px-3 py-1 text-xs font-bold"
                style={{
                  border: "2px solid #1A1A1A",
                  background: "#5B8DEF",
                  color: "#fff",
                  boxShadow: "2px 2px 0 #1A1A1A",
                }}
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