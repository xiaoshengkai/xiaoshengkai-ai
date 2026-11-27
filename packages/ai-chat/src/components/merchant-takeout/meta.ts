import type { StoreStage, StoreStatus } from "@/lib/merchant-takeout/types";

/** 主营品类（创建流程里硬编码的候选） */
export const CATEGORIES = [
  "快餐便当",
  "炸鸡汉堡",
  "米粉面馆",
  "麻辣烫冒菜",
  "烧烤夜宵",
  "饺子馄饨",
  "轻食沙拉",
  "奶茶饮品",
  "咖啡烘焙",
  "甜品小吃",
  "其他（自定义）",
] as const;

export const STAGE_LABELS: Record<StoreStage, string> = {
  "first-time": "第一次准备开店",
  "offline-to-takeout": "线下店转外卖",
  "already-running": "外卖店经营中",
};

export const STATUS_META: Record<StoreStatus, { label: string; accent: string }> = {
  simulation: { label: "模拟中", accent: "bg-yellow-soft" },
  preparing: { label: "筹备中", accent: "bg-blue-soft" },
  trial: { label: "试营业", accent: "bg-orange-soft" },
  running: { label: "经营中", accent: "bg-lime-soft" },
  closed: { label: "已关闭", accent: "bg-muted" },
};

/** 与 calculate.getReportReadiness 的检查项数对应，用于「资料完整度」百分比 */
export const READINESS_TOTAL = 10;
