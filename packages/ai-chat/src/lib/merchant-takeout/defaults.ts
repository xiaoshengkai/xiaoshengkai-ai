import { randomUUID } from "node:crypto";
import type { MerchantStore } from "./types";

/**
 * 创建空店铺默认对象：id 用 crypto.randomUUID()，status 默认 simulation，各子模型置空。
 * 仅模拟中状态第一版完整实现，筹备/试营业/经营中仅保留字段。
 */
export function createEmptyStore(name: string): MerchantStore {
  const now = Date.now();
  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "simulation",
    profile: {
      name,
      stage: "first-time",
      category: "",
      tags: [],
      city: "",
      availableCapital: 0,
      workingCapital: 0,
      targetNetProfit: 0,
      experience: "",
      riskNotes: "",
    },
    locations: [],
    costs: {
      oneTime: {
        renovation: 0,
        equipment: 0,
        franchiseFee: 0,
        transferFee: 0,
        agencyFee: 0,
        license: 0,
        initialInventory: 0,
        openingPromotion: 0,
        refundableDeposit: 0,
      },
      monthlyFixed: {
        rent: 0,
        labor: 0,
        utilities: 0,
        property: 0,
        network: 0,
        garbage: 0,
        other: 0,
      },
    },
    staffing: { base: [], tiers: [] },
    products: [],
    baskets: [],
    platformRules: {
      platform: "taobao-flash",
      confirmed: false,
      source: {},
    },
    activities: {
      fullReduction: [],
      merchantShare: 0,
      stackOrder: [],
    },
    scenarios: [],
    snapshots: [],
  };
}
