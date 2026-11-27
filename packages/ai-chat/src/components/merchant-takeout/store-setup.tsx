"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE } from "@/lib/utils/utils";
import { toast } from "sonner";
import { X, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import type { MerchantStore, StoreStage } from "@/lib/merchant-takeout/types";
import { CATEGORIES, STAGE_LABELS } from "./meta";

interface StoreSetupProps {
  open: boolean;
  onClose: () => void;
}

const STAGES: StoreStage[] = ["first-time", "offline-to-takeout", "already-running"];

function Toggle({
  options,
  value,
  onChange,
}: {
  options: { value: boolean; label: string }[];
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`brutal-btn px-3 py-1.5 text-xs font-bold ${
            value === o.value ? "bg-blue text-white" : "bg-card text-muted-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground block mb-1">{label}（元）</label>
      <input
        id={id}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-full px-2 py-1.5 text-sm font-mono border-2 border-border"
      />
    </div>
  );
}

export default function StoreSetup({ open, onClose }: StoreSetupProps) {
  const router = useRouter();
  const fieldId = useId();
  const [step, setStep] = useState<1 | 2>(1);
  const [stage, setStage] = useState<StoreStage>("first-time");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [city, setCity] = useState("");
  const [selfOperated, setSelfOperated] = useState(true);
  const [availableCapital, setAvailableCapital] = useState("");
  const [workingCapital, setWorkingCapital] = useState("");
  const [targetNetProfit, setTargetNetProfit] = useState("");
  const [experience, setExperience] = useState("");
  const [fullTime, setFullTime] = useState(true);
  const [hasSupply, setHasSupply] = useState(false);
  const [hasProduct, setHasProduct] = useState(false);
  const [hasStore, setHasStore] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const canNext = name.trim().length > 0;

  const close = () => {
    setStep(1);
    setStage("first-time");
    setName("");
    setCategory("");
    setTagsText("");
    setCity("");
    setSelfOperated(true);
    setAvailableCapital("");
    setWorkingCapital("");
    setTargetNetProfit("");
    setExperience("");
    setFullTime(true);
    setHasSupply(false);
    setHasProduct(false);
    setHasStore(false);
    setBusy(false);
    onClose();
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/tools/merchant-takeout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "创建失败");
      const store = data.store as MerchantStore;

      const tags: string[] = [];
      for (const t of tagsText.split(/[,，、\s]+/)) if (t.trim()) tags.push(t.trim());
      tags.push(selfOperated ? "自营" : "加盟");
      tags.push(fullTime ? "全职" : "兼职");
      if (hasSupply) tags.push("已有供应链");
      if (hasProduct) tags.push("已有产品");
      if (hasStore) tags.push("已有门店");

      const profile: MerchantStore["profile"] = {
        ...store.profile,
        stage,
        name: name.trim(),
        category,
        tags,
        city: city.trim(),
        availableCapital: Number(availableCapital) || 0,
        workingCapital: Number(workingCapital) || 0,
        targetNetProfit: Number(targetNetProfit) || 0,
        experience: experience.trim(),
      };

      const putRes = await fetch(`${BASE}/api/tools/merchant-takeout?id=${store.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const putData = await putRes.json();
      if (!putRes.ok || !putData.ok) throw new Error(putData.error || "保存失败");

      toast("🟢 店铺创建成功");
      router.push(`/tools/merchant-takeout/${store.id}`);
    } catch (e) {
      toast(`🔴 ${e instanceof Error ? e.message : "创建失败"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={close}>
      <div
        className="brutal bg-card w-[560px] max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
          <h3 className="text-sm font-bold text-foreground font-heading">创建模拟店铺</h3>
          <div className="flex items-center gap-2">
            <span className="brutal-chip px-2 py-0.5 text-[10px] bg-yellow-soft">步骤 {step}/2</span>
            <button onClick={close} className="text-muted-foreground/70 hover:text-muted-foreground" aria-label="关闭">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {step === 1 ? (
            <>
              <div>
                <div className="text-xs text-muted-foreground block mb-1.5">开店阶段</div>
                <div className="grid grid-cols-3 gap-2">
                  {STAGES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStage(s)}
                      className={`brutal-btn px-2 py-2 text-xs font-bold ${
                        stage === s ? "bg-blue text-white" : "bg-card text-muted-foreground"
                      }`}
                    >
                      {STAGE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor={`${fieldId}-name`} className="text-xs text-muted-foreground block mb-1">店铺名称 *</label>
                <input
                  id={`${fieldId}-name`}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：老王家常菜"
                  className="w-full px-2 py-1.5 text-sm border-2 border-border"
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground block mb-1.5">主营品类</div>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`brutal-chip px-2 py-1 text-[11px] ${
                        category === c ? "bg-yellow-soft" : "bg-card"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor={`${fieldId}-tags`} className="text-xs text-muted-foreground block mb-1">辅助标签（逗号分隔）</label>
                <input
                  id={`${fieldId}-tags`}
                  type="text"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="例如：现炒、川湘口味"
                  className="w-full px-2 py-1.5 text-sm border-2 border-border"
                />
              </div>

              <div>
                <label htmlFor={`${fieldId}-city`} className="text-xs text-muted-foreground block mb-1">城市</label>
                <input
                  id={`${fieldId}-city`}
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="例如：杭州"
                  className="w-full px-2 py-1.5 text-sm border-2 border-border"
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground block mb-1.5">经营方式</div>
                <Toggle
                  options={[
                    { value: true, label: "自营" },
                    { value: false, label: "加盟" },
                  ]}
                  value={selfOperated}
                  onChange={setSelfOperated}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <MoneyInput label="可投入资金" value={availableCapital} onChange={setAvailableCapital} />
                <MoneyInput label="预留周转金" value={workingCapital} onChange={setWorkingCapital} />
                <MoneyInput label="目标月净利润" value={targetNetProfit} onChange={setTargetNetProfit} />
              </div>

              <div>
                <label htmlFor={`${fieldId}-experience`} className="text-xs text-muted-foreground block mb-1">经营经验</label>
                <input
                  id={`${fieldId}-experience`}
                  type="text"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="例如：3 年餐饮经验，无外卖经验"
                  className="w-full px-2 py-1.5 text-sm border-2 border-border"
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground block mb-1.5">投入方式</div>
                <Toggle
                  options={[
                    { value: true, label: "全职" },
                    { value: false, label: "兼职" },
                  ]}
                  value={fullTime}
                  onChange={setFullTime}
                />
              </div>

              <div>
                <div className="text-xs text-muted-foreground block mb-1.5">已有资源</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: hasSupply, label: "供应链", set: setHasSupply },
                    { value: hasProduct, label: "产品", set: setHasProduct },
                    { value: hasStore, label: "门店", set: setHasStore },
                  ].map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => r.set(!r.value)}
                      className={`brutal-btn px-3 py-1.5 text-xs font-bold ${
                        r.value ? "bg-lime text-white" : "bg-card text-muted-foreground"
                      }`}
                    >
                      {r.value ? "✓ " : ""}{r.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-1">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-card text-foreground"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> 上一步
              </button>
            )}
            {step === 1 ? (
              <button
                onClick={() => setStep(2)}
                disabled={!canNext}
                className={`brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold ${
                  canNext ? "bg-blue text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                下一步 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="brutal-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-primary text-primary-foreground"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> 创建中…
                  </>
                ) : (
                  "创建店铺"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
