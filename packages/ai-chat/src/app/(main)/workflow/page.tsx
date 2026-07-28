"use client";

import { BASE } from "@/lib/api-path";
import { useEffect, useState, useCallback } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";

interface Template {
  id: string;
  name: string;
  label: string;
  description: string;
  params: TemplateParam[];
  steps: TemplateStep[];
}

interface TemplateParam {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

interface TemplateStep {
  id: string;
  name: string;
  type: string;
}

interface Execution {
  executionId: string;
  template: string;
  status: string;
  steps: ExecutionStep[];
  error?: string;
}

interface ExecutionStep {
  id: string;
  name: string;
  status: string;
  output: string | null;
  error: string | null;
}

export default function WorkflowPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [execution, setExecution] = useState<Execution | null>(null);
  const [executing, setExecuting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/workflows/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
  }, [fetchTemplates]);

  const pollExecution = useCallback(async (executionId: string) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/workflows/execution/${executionId}`);
        if (res.ok) {
          const data = await res.json();
          setExecution(data);
          if (data.status === "completed" || data.status === "failed") {
            clearInterval(timer);
            setExecuting(false);
            if (data.status === "completed") toast("🟢 工作流执行完成");
            else toast(`🔴 执行失败: ${data.error || data.steps.find((s: ExecutionStep) => s.status === "failed")?.error}`);
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    return timer;
  }, []);

  const handleExecute = useCallback(async () => {
    if (!selectedTemplate) return;
    setExecuting(true);
    setExecution(null);

    try {
      const res = await fetch(`${BASE}/api/workflows/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTemplate.id, params: formValues }),
      });
      const data = await res.json();
      if (data.ok) {
        pollExecution(data.executionId);
      } else {
        toast(`🔴 启动失败: ${data.error}`);
        setExecuting(false);
      }
    } catch {
      toast("🔴 请求失败");
      setExecuting(false);
    }
  }, [selectedTemplate, formValues, pollExecution]);

  const selectTemplate = useCallback((t: Template) => {
    setSelectedTemplate(t);
    setExecution(null);
    const defaults: Record<string, string> = {};
    t.params.forEach(p => {
      if (p.default !== undefined) defaults[p.name] = String(p.default);
    });
    setFormValues(defaults);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-bold text-gray-800">⚙️ 工作流</h2>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!selectedTemplate ? (
          <>
            <p className="text-sm text-gray-500 mb-4">选择一个模板，快速创建你的工作流</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map(t => (
                <div
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className="pixel-card bg-white rounded-lg p-4 cursor-pointer"
                  style={{
                    border: "3px solid #1A1A1A",
                    boxShadow: "4px 4px 0 #1A1A1A",
                  }}
                >
                  <h3 className="text-sm font-bold text-gray-800 mb-2">{t.label}</h3>
                  <p className="text-xs text-gray-500 mb-3">{t.description}</p>
                  <p className="text-xs text-gray-400">
                    {t.steps.length} 步 · {t.steps.map(s => s.name).join(" → ")}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="max-w-2xl">
            <button
              onClick={() => { setSelectedTemplate(null); setExecution(null); setExecuting(false); }}
              className="text-xs text-gray-400 hover:text-gray-600 mb-4"
            >
              ← 返回模板列表
            </button>

            <div
              className="pixel-card bg-white rounded-lg p-4 mb-4"
              style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}
            >
              <h3 className="text-sm font-bold text-gray-800 mb-3">{selectedTemplate.label}</h3>
              <div className="space-y-3">
                {selectedTemplate.params.map(p => (
                  <div key={p.name}>
                    <label className="text-xs text-gray-500 block mb-1">
                      {p.label} {p.required && <span className="text-red-400">*</span>}
                    </label>
                    {p.type === "select" ? (
                      <select
                        value={formValues[p.name] || ""}
                        onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded bg-white"
                      >
                        {p.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={p.type === "number" ? "number" : "text"}
                        value={formValues[p.name] || ""}
                        onChange={e => setFormValues({ ...formValues, [p.name]: e.target.value })}
                        className="w-full px-2 py-1 text-xs border-2 border-gray-300 rounded"
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={handleExecute}
                disabled={executing}
                className="pixel-btn inline-flex items-center gap-1 px-4 py-1.5 text-xs font-bold cursor-pointer mt-4"
                style={{
                  border: "2px solid #1A1A1A",
                  background: executing ? "#e2e8f0" : "#5B8DEF",
                  color: executing ? "#94a3b8" : "#fff",
                  boxShadow: "2px 2px 0 #1A1A1A",
                }}
              >
                <Play className="w-3 h-3" />
                {executing ? "执行中..." : "执行"}
              </button>
            </div>

            {execution && (
              <div
                className="pixel-card bg-white rounded-lg p-4"
                style={{ border: "3px solid #1A1A1A", boxShadow: "4px 4px 0 #1A1A1A" }}
              >
                <h3 className="text-sm font-bold text-gray-800 mb-3">执行进度</h3>
                <div className="space-y-2">
                  {execution.steps.map((step, i) => (
                    <div key={step.id} className="flex items-start gap-3 p-2 rounded bg-gray-50">
                      <span className="text-xs font-mono text-gray-400 mt-0.5">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-700">{step.name}</span>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                            step.status === "completed" ? "bg-green-400" :
                            step.status === "running" ? "bg-yellow-400 animate-pulse" :
                            step.status === "failed" ? "bg-red-400" : "bg-gray-300"
                          }`} />
                          <span className="text-xs text-gray-400">{step.status}</span>
                        </div>
                        {step.output && step.status === "completed" && (
                          <details className="mt-1">
                            <summary className="text-xs text-gray-400 cursor-pointer">查看输出</summary>
                            <pre className="text-xs text-gray-600 mt-1 p-2 bg-gray-100 rounded overflow-auto max-h-32">
                              {typeof step.output === "string" ? step.output : JSON.stringify(step.output, null, 2)}
                            </pre>
                          </details>
                        )}
                        {step.error && (
                          <p className="text-xs text-red-500 mt-1">{step.error}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}