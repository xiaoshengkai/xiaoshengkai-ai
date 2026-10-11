"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import ModuleSelector from "@/components/settings/module-selector";
import ProviderConfigCard from "@/components/settings/provider-config";

interface Providers {
  [key: string]: {
    enabled: boolean;
    baseURL: string;
    apiKey: string;
    models: Record<string, string>;
  };
}

interface Selection {
  [module: string]: { provider: string; model: string };
}

interface EgressConfig {
  enabled: boolean;
  proxy: string;
  whitelist: string[];
}

interface ProviderStatus {
  available: boolean | null;
  balanceText?: string;
  note?: string;
  error?: string;
}

interface ManagedService {
  id: string;
  group: string;
  name: string;
  description: string;
  cwd: string;
  healthUrl: string;
  status: "running" | "starting" | "stopped" | "unknown";
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  glm: "智谱 GLM",
  qwen: "通义千问",
  volcengine: "火山引擎 Doubao",
};

export default function SettingsPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirtyProv, setDirtyProv] = useState(false);
  const [dirtySel, setDirtySel] = useState(false);
  const [status, setStatus] = useState<Record<string, ProviderStatus> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [services, setServices] = useState<ManagedService[]>([]);
  const [serviceErrors, setServiceErrors] = useState<string[]>([]);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [serviceAction, setServiceAction] = useState<string | null>(null);
  const [pwdForm, setPwdForm] = useState({ oldPassword: "", newPassword: "", confirm: "" });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [egress, setEgress] = useState<EgressConfig | null>(null);
  const [dirtyEgress, setDirtyEgress] = useState(false);
  const [egressTestUrl, setEgressTestUrl] = useState("https://yapi.cai-inc.com");
  const [egressTest, setEgressTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [egressTesting, setEgressTesting] = useState(false);
  const [tab, setTab] = useState<"models" | "services" | "egress" | "security">("models");

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/settings/providers`).then((r) => r.json()),
      fetch(`${BASE}/api/settings/selection`).then((r) => r.json()),
      fetch(`${BASE}/api/settings/egress`).then((r) => r.json()),
    ]).then(([p, s, e]) => {
      setProviders(p);
      setSelection(s);
      setEgress(e);
    });
  }, []);

  const loadBalance = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`${BASE}/api/settings/balance`);
      const data = await r.json();
      const map: Record<string, ProviderStatus> = {};
      for (const p of data.providers || []) map[p.id] = p;
      setStatus(map);
    } catch {
      setStatus({});
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const loadServices = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/services`);
      const data = await r.json();
      setServices(data.services || []);
      setServiceErrors(data.errors || []);
    } catch {
      setServices([]);
      setServiceErrors(["服务状态读取失败"]);
    } finally {
      setServiceLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
    const timer = setInterval(loadServices, 5000);
    return () => clearInterval(timer);
  }, [loadServices]);

  const handleServiceAction = useCallback(async (id: string, action: "start" | "restart" | "stop") => {
    const key = `${id}:${action}`;
    setServiceAction(key);
    try {
      const r = await fetch(`${BASE}/api/services/${id}/${action}`, { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "服务操作失败");
      await loadServices();
      toast("服务操作已提交");
    } catch (err) {
      toast(`服务操作失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setServiceAction(null);
    }
  }, [loadServices]);

  const handleChangePassword = useCallback(async () => {
    if (pwdForm.newPassword !== pwdForm.confirm) {
      toast("🔴 两次输入的新密码不一致");
      return;
    }
    if (pwdForm.newPassword.length < 8) {
      toast("🔴 新密码至少 8 位");
      return;
    }
    setPwdBusy(true);
    try {
      const r = await fetch(`${BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        toast("🟢 密码已修改，所有设备需重新登录");
        router.replace("/login");
        router.refresh();
      } else {
        toast(`🔴 ${data.error || `修改失败 (${r.status})`}`);
      }
    } catch (e) {
      toast(`🔴 网络错误: ${e instanceof Error ? e.message : "未知错误"}`);
    }
    setPwdBusy(false);
  }, [pwdForm, router]);

  const handleLogout = useCallback(async () => {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }, [router]);

  const handleProviderChange = useCallback((id: string, config: unknown) => {
    setProviders((prev) => (prev ? { ...prev, [id]: config as Providers[string] } : prev));
    setDirtyProv(true);
  }, []);

  const handleSelectionChange = useCallback((module: string, provider: string, model: string) => {
    setSelection((prev) => (prev ? { ...prev, [module]: { provider, model } } : prev));
    setDirtySel(true);
  }, []);

  const updateEgress = useCallback((patch: Partial<EgressConfig>) => {
    setEgress((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirtyEgress(true);
  }, []);

  const runEgressTest = useCallback(async () => {
    setEgressTesting(true);
    setEgressTest(null);
    try {
      const r = await fetch(`${BASE}/api/settings/egress/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: egressTestUrl }),
      });
      const d = await r.json();
      setEgressTest(d.ok ? { ok: true, msg: `通 ✓ status ${d.status}` } : { ok: false, msg: `失败: ${d.error}` });
    } catch (e) {
      setEgressTest({ ok: false, msg: `请求失败: ${e instanceof Error ? e.message : "未知错误"}` });
    }
    setEgressTesting(false);
  }, [egressTestUrl]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (dirtyProv && providers) {
        const r = await fetch(`${BASE}/api/settings/providers`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(providers),
        });
        if (!r.ok) throw new Error("providers save failed");
        setDirtyProv(false);
      }
      if (dirtySel && selection) {
        const r = await fetch(`${BASE}/api/settings/selection`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        });
        if (!r.ok) throw new Error("selection save failed");
        setDirtySel(false);
      }
      if (dirtyEgress && egress) {
        const r = await fetch(`${BASE}/api/settings/egress`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(egress),
        });
        if (!r.ok) throw new Error("egress save failed");
        setDirtyEgress(false);
      }
      toast("🟢 设置已保存");
    } catch (e) {
      toast(`🔴 保存失败: ${e instanceof Error ? e.message : "未知错误"}`);
    }
    setSaving(false);
  }, [dirtyProv, dirtySel, dirtyEgress, providers, selection, egress]);

  if (!providers || !selection || !egress) {
    return (
      <div className="flex items-center justify-center h-dvh">
        <p className="text-xs text-muted-foreground font-mono">加载中...</p>
      </div>
    );
  }

  const hasChanges = dirtyProv || dirtySel || dirtyEgress;

  const statusClass: Record<ManagedService["status"], string> = {
    running: "bg-lime-soft text-foreground",
    starting: "bg-yellow-soft text-foreground",
    stopped: "bg-muted text-muted-foreground",
    unknown: "bg-orange-soft text-foreground",
  };

  return (
    <div data-theme="pink" className="flex flex-col h-full">
      {/* 头部：与其他页面统一 */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-foreground font-heading">系统设置</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="brutal-btn px-3 py-1.5 text-xs font-bold bg-card text-foreground"
          >
            返回聊天
          </button>
        </div>
      </div>

      {/* 主体：左菜单 + 右内容（窄屏菜单变横向 chips 行） */}
      <div className="flex flex-1 overflow-hidden">
      <nav className="shrink-0 flex flex-row flex-wrap md:flex-col items-start md:items-stretch gap-2 p-3 border-b-2 md:border-b-0 md:border-r-2 border-border md:w-44 bg-card overflow-auto">
        {([
          { id: "models", label: "模型", dot: hasChanges },
          { id: "services", label: "服务", dot: !serviceLoading && services.some((s) => s.status !== "running") },
          { id: "egress", label: "网络出口", dot: dirtyEgress },
          { id: "security", label: "安全", dot: false },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`brutal-btn px-3 py-2 text-sm font-bold text-left flex items-center justify-between gap-2 ${
              tab === t.id ? "bg-primary text-foreground" : "bg-card text-muted-foreground"
            }`}
          >
            <span>{t.label}</span>
            {t.dot && <span aria-label="提醒" className="w-2 h-2 bg-destructive shrink-0" />}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-auto p-6 space-y-6">

      {tab === "models" && (<>
      {/* 生效提示：所有配置均 fresh-read，保存即生效（2026-08-20 移除重启机制） */}
      <div className="brutal bg-yellow-soft p-3 text-xs font-mono">
        <p className="text-foreground/70">
          所有配置（聊天/图片/向量/MCP/工作流/定时任务）保存后立即生效，无需重启。
        </p>
      </div>

      {/* 模型配置 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground font-heading">🔑 模型配置</h2>
            <span className="text-xs text-muted-foreground font-mono hidden md:inline">7 模块 · 4 Provider</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className={`brutal-btn px-2 py-1 text-xs font-bold ${hasChanges && !saving ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
            >
              {saving ? "保存中..." : hasChanges ? "保存更改" : "已保存"}
            </button>
            <button
              onClick={loadBalance}
              disabled={refreshing}
              className="brutal-btn px-2 py-1 text-xs font-bold bg-muted text-foreground disabled:opacity-50"
            >
              {refreshing ? "查询中..." : "刷新余量"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {Object.entries(providers).map(([id, config]) => (
            <ProviderConfigCard
              key={id}
              id={id}
              label={PROVIDER_LABELS[id] || id}
              config={config}
              onChange={handleProviderChange}
              status={status?.[id]}
            />
          ))}
        </div>
      </div>

      {/* 模型选择 */}
      <div>
        <h2 className="text-sm font-bold text-foreground mb-3 font-heading">📌 模块模型选择</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <ModuleSelector module="chat" current={selection.chat} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="media" current={selection.media} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="vision" current={selection.vision || { provider: "minimax", model: "MiniMax-M3" }} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="vector" current={selection.vector} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="workflow" current={selection.workflow} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="tts" current={selection.tts || { provider: "minimax", model: "speech-2.8-hd" }} onChange={handleSelectionChange} statusByProvider={status} />
          <ModuleSelector module="music" current={selection.music || { provider: "qwen", model: "fun-music-v1" }} onChange={handleSelectionChange} statusByProvider={status} />
        </div>
      </div>
      </>)}

      {tab === "services" && (
      /* 独立服务监控 */
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground font-heading">独立服务</h2>
          <button onClick={loadServices} className="brutal-btn px-2 py-1 text-xs font-bold bg-muted text-foreground">
            刷新状态
          </button>
        </div>
        {serviceErrors.length > 0 && (
          <div className="brutal bg-orange-soft p-3 text-xs font-mono mb-3">
            {serviceErrors.join("；")}
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {serviceLoading ? (
            <div className="brutal bg-card p-4 text-xs font-mono text-muted-foreground">服务状态加载中...</div>
          ) : services.map((service) => (
            <div key={service.id} className="brutal bg-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold font-heading">{service.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{service.description}</p>
                </div>
                <span className={`brutal-chip px-2 py-0.5 text-[10px] ${statusClass[service.status]}`}>{service.status}</span>
              </div>
              <div className="text-[11px] font-mono text-muted-foreground space-y-1">
                <div>{service.cwd}</div>
                <div>{service.healthUrl}</div>
              </div>
              <div className="flex gap-2">
                {(["start", "restart", "stop"] as const).map((action) => (
                  <button
                    key={action}
                    onClick={() => handleServiceAction(service.id, action)}
                    disabled={serviceAction !== null}
                    className="brutal-btn px-2 py-1 text-xs font-bold bg-card text-foreground disabled:opacity-50"
                  >
                    {serviceAction === `${service.id}:${action}` ? "执行中..." : action === "start" ? "启动" : action === "restart" ? "重启" : "关闭"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {tab === "egress" && (
      /* 内网出口 */
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground font-heading">🌐 网络出口</h2>
          <div className="flex gap-2">
            <button
              onClick={() => updateEgress({ enabled: !egress.enabled })}
              className={`brutal-btn px-2 py-1 text-xs font-bold ${egress.enabled ? "bg-lime-soft text-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {egress.enabled ? "已开启" : "已关闭"}
            </button>
            <button
              onClick={handleSave}
              disabled={!dirtyEgress || saving}
              className={`brutal-btn px-2 py-1 text-xs font-bold ${dirtyEgress && !saving ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
            >
              {saving ? "保存中..." : dirtyEgress ? "保存更改" : "已保存"}
            </button>
          </div>
        </div>

        <div className="brutal bg-yellow-soft p-3 text-xs font-mono mb-3 text-foreground/70">
          白名单内的域名经「本地电脑的反向隧道」出网，用于访问公司内网（如 yapi）；其余域名照常直连。
          依赖本地 ai-chat 的「内网出口隧道」服务在线（见「服务」页），Mac 关机/离网则失效。
        </div>

        <div className="brutal bg-card p-4 space-y-4 max-w-2xl text-xs font-mono">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={egress.enabled}
              onChange={(e) => updateEgress({ enabled: e.target.checked })}
            />
            启用内网出口（仅白名单域名改道）
          </label>

          <div>
            <label className="text-muted-foreground block mb-0.5 text-[10px]">SOCKS 代理（服务器侧隧道入口）</label>
            <input
              value={egress.proxy}
              onChange={(e) => updateEgress({ proxy: e.target.value })}
              placeholder="127.0.0.1:11080"
              className="w-full px-2 py-1 border-2 border-border bg-card focus:outline-none focus:border-ring"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-muted-foreground text-[10px]">白名单（精确 host / .后缀 / CIDR）</label>
              <button
                onClick={() => updateEgress({ whitelist: [...egress.whitelist, ""] })}
                className="brutal-btn px-2 py-0.5 text-[11px] font-bold bg-card text-foreground"
              >
                + 添加
              </button>
            </div>
            {egress.whitelist.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">（空）例：.cai-inc.com</div>
            ) : (
              <div className="space-y-1">
                {egress.whitelist.map((w, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={w}
                      placeholder=".cai-inc.com"
                      onChange={(e) => {
                        const list = [...egress.whitelist];
                        list[i] = e.target.value;
                        updateEgress({ whitelist: list });
                      }}
                      className="flex-1 px-2 py-1 border-2 border-border bg-card focus:outline-none focus:border-ring"
                    />
                    <button
                      onClick={() => updateEgress({ whitelist: egress.whitelist.filter((_, j) => j !== i) })}
                      className="brutal-btn px-2 py-1 text-[11px] font-bold bg-destructive text-white"
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t-2 border-border pt-3">
            <label className="text-muted-foreground block mb-0.5 text-[10px]">连通性测试（经隧道请求一个白名单内地址）</label>
            <div className="flex gap-2">
              <input
                value={egressTestUrl}
                onChange={(e) => setEgressTestUrl(e.target.value)}
                className="flex-1 px-2 py-1 border-2 border-border bg-card focus:outline-none focus:border-ring"
              />
              <button
                onClick={runEgressTest}
                disabled={egressTesting}
                className="brutal-btn px-3 py-1 text-xs font-bold bg-primary text-foreground disabled:opacity-50"
              >
                {egressTesting ? "测试中..." : "测试"}
              </button>
            </div>
            {egressTest && (
              <div className={`mt-1 text-[11px] ${egressTest.ok ? "text-foreground" : "text-destructive"}`}>
                {egressTest.msg}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {tab === "security" && (
      /* 密码管理 */
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground font-heading">🔐 密码管理</h2>
          <button
            onClick={handleLogout}
            className="brutal-btn px-2 py-1 text-xs font-bold bg-destructive text-white"
          >
            退出登录
          </button>
        </div>
        <div className="brutal bg-card p-4 max-w-md space-y-2 text-xs font-mono">
          <div className="text-muted-foreground text-[10px] mb-2">修改密码后所有设备（含本机）需重新登录</div>
          {([
            ["oldPassword", "当前密码"],
            ["newPassword", "新密码（≥8 位）"],
            ["confirm", "确认新密码"],
          ] as const).map(([field, label]) => (
            <div key={field}>
              <label className="text-muted-foreground block mb-0.5">{label}</label>
              <input
                type="password"
                value={pwdForm[field]}
                onChange={(e) => setPwdForm((p) => ({ ...p, [field]: e.target.value }))}
                autoComplete={field === "oldPassword" ? "current-password" : "new-password"}
                className="w-full px-2 py-1 border-2 border-border bg-card text-xs focus:outline-none focus:border-ring"
                style={{ boxShadow: "var(--shadow-sm)" }}
              />
            </div>
          ))}
          <button
            onClick={handleChangePassword}
            disabled={pwdBusy || !pwdForm.oldPassword || !pwdForm.newPassword || !pwdForm.confirm}
            className="brutal-btn px-3 py-1.5 text-xs font-bold bg-primary text-foreground disabled:opacity-40"
          >
            {pwdBusy ? "提交中..." : "修改密码"}
          </button>
        </div>
      </div>
      )}
      </div>
      </div>
    </div>
  );
}