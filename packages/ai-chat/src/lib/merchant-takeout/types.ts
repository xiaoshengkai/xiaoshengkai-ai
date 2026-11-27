/**
 * 外卖开店模拟器 — 领域模型
 * 一个数字店铺 = 一个 MerchantStore，各子模型对应数据流中的每一步（创建→品类→选址→成本→商品→购物篮→规则→活动→销量→沙盘→报告→快照）。
 * 第一版仅淘宝闪购平台，不做多平台 union 抽象；所有字段取自设计文档已确认项，不预铺未描述字段。
 */

export type StoreStatus = "simulation" | "preparing" | "trial" | "running" | "closed";

/** 开店阶段，对应三类用户入口：第一次准备开店 / 线下转外卖 / 已经营外卖店 */
export type StoreStage = "first-time" | "offline-to-takeout" | "already-running";

/** 店铺基本信息 + 品类初筛 */
export interface StoreProfile {
  name: string; // 店铺名称
  stage: StoreStage; // 开店阶段
  category: string; // 主营品类
  tags: string[]; // 辅助标签
  city: string; // 城市
  availableCapital: number; // 可投入资金
  workingCapital: number; // 周转金
  targetNetProfit: number; // 目标净利润
  experience: string; // 经营经验
  riskNotes: string; // 风险提示
}

/** 单个候选地址的成本明细（年租金/押金/转让费/水电燃气/面积楼层等） */
export interface LocationCosts {
  annualRent: number; // 年租金（元）
  deposit: number; // 押金（元）
  depositRefundable: boolean; // 押金是否可回收
  transferFee: number; // 转让费（元）
  propertyFee: number; // 月物业费（元）
  agencyFee: number; // 中介费（元）
  renovation: number; // 装修预计费用（元）
  waterPrice: number; // 水费单价（元/吨）
  waterUsage: number; // 预计月用水量（吨）
  electricityPrice: number; // 电费单价（元/度）
  electricityUsage: number; // 预计月用电量（度）
  gasPrice: number; // 燃气单价（元/立方米）
  gasUsage: number; // 预计月用气量（立方米）
  area: number; // 面积（㎡）
  floor: string; // 楼层
  pickupConvenience: string; // 骑手取餐便利说明
  conditions: string; // 排烟/消防/用电/餐饮经营条件
}

/** 候选选址（地图搜索 + 点选 + 配送半径 + 周边 POI） */
export interface StoreLocation {
  id: string;
  name: string; // 候选名称
  address: string; // 地址
  lng: number; // 经度
  lat: number; // 纬度
  deliveryRadius: number; // 配送半径（km）
  poi: string[]; // 周边 POI
  competitors: string; // 周边竞店说明
  selected: boolean; // 是否已选定
  costs: LocationCosts; // 该候选地址的成本明细
}

/** 一次性投入（进启动资金/现金流/回本周期，不摊入月利润） */
export interface OneTimeCosts {
  renovation: number; // 装修
  equipment: number; // 设备
  franchiseFee: number; // 加盟费
  transferFee: number; // 转让费
  agencyFee: number; // 中介费
  license: number; // 证照
  initialInventory: number; // 首批原料
  openingPromotion: number; // 开业推广
  refundableDeposit: number; // 押金（可回收）
}

/** 月固定成本（用于月经营利润和保本单量） */
export interface MonthlyFixedCosts {
  rent: number; // 房租
  labor: number; // 人工
  utilities: number; // 水电气
  property: number; // 物业
  network: number; // 网络
  garbage: number; // 垃圾处理
  other: number; // 其他
}

export interface StoreCosts {
  oneTime: OneTimeCosts;
  monthlyFixed: MonthlyFixedCosts;
}

/** 阶梯用工：基础人员 + 按月订单量触发增员档位 */
export interface StaffMember {
  role: string; // 岗位
  count: number; // 人数
  monthlySalary: number; // 月工资（每人）
}

export interface StaffingTier {
  minMonthlyOrders: number; // 触发月订单量
  members: StaffMember[]; // 该档位累计目标人员结构
}

export interface StoreStaffing {
  base: StaffMember[]; // 基础人员（无论销量都需要的岗位，含老板合理工资）
  tiers: StaffingTier[]; // 增员档位
}

/** 商品/套餐（不做原料配方，直接填单份食材总成本 + 损耗率 + 包装） */
export interface StoreProduct {
  id: string;
  name: string;
  price: number; // 售价
  ingredientCost: number; // 单份食材总成本
  lossRate: number; // 损耗率（0~1）
  packagingCost: number; // 包装成本
  packagingFee: number; // 包装收费
}

/** 典型购物篮（商品组合 + 订单占比，占比合计 100%） */
export interface BasketItem {
  productId: string;
  quantity: number;
}

export interface StoreBasket {
  id: string;
  name: string;
  items: BasketItem[];
  orderShare: number; // 订单占比（%）
}

/** 平台规则来源元数据（AI 检索默认值，最终以商家后台确认为准） */
export interface RuleSource {
  sourceUrl?: string; // 来源链接
  publishedAt?: string; // 发布时间
  fetchedAt?: number; // 抓取时间
  region?: string; // 适用地区
  confidence?: string; // 可信度
  conflictNote?: string; // 冲突说明
}

/** 扣点基数勾选：哪些收入项计入平台扣点 */
export interface CommissionBase {
  includeProduct: boolean; // 商品售价
  includePackagingFee: boolean; // 包装费
  includeDeliveryFee: boolean; // 配送费
}

/** 平台规则（第一版仅淘宝闪购）；找不到可靠来源的字段保持空白，确认后才生成正式报告 */
export interface PlatformRules {
  platform: "taobao-flash"; // 第一版仅淘宝闪购
  commissionRate?: number; // 平台扣点（比例 0~1）
  fixedServiceFee?: number; // 平台固定服务费（元/单）
  merchantDeliveryFee?: number; // 商家承担配送费（元/单）
  customerDeliveryFee?: number; // 向顾客收取的配送费（元/单）
  commissionBase: CommissionBase; // 扣点基数勾选
  discountBeforeCommission: boolean; // 优惠是否在扣点前扣除
  confirmed: boolean; // 是否已在商家后台确认
  source: RuleSource; // 规则来源元数据
}

/** 活动：折扣 / 满减 / 红包（MVP 三类），merchantShare 为商家承担比例（0~1） */
export type StoreActivity =
  | { id: string; type: "discount"; rate: number; merchantShare: number } // rate：折扣率 0~1
  | { id: string; type: "fullReduction"; threshold: number; reduction: number; merchantShare: number } // 满 threshold 减 reduction
  | { id: string; type: "redPacket"; amount: number; merchantShare: number }; // 红包金额（元）

/** 活动方案：活动列表 + 按 stackOrder 中的活动 id 顺序叠加 */
export interface StoreActivities {
  list: StoreActivity[];
  stackOrder: string[]; // 叠加顺序（活动 id）
}

/** 计税基数：商品营业收入 / 平台结算收入 / 税前利润 / 自定义金额 */
export type TaxBaseKind = "productRevenue" | "platformSettlement" | "preTaxProfit" | "custom";

/** 订单损失测算参数 */
export interface StoreLoss {
  orderLossRate: number; // 订单损失率（0~1）
  lossAmountPerOrder: number; // 单笔平均损失金额（元）
  confirmed: boolean; // 是否已确认（含 0 值场景）
}

/** 税费测算参数 */
export interface StoreTax {
  rate: number; // 综合税费比例（0~1）
  base: TaxBaseKind; // 计税基数
  customBase?: number; // 自定义计税基数（元）
  confirmed: boolean; // 是否已确认（含 0 值场景）
}

/** 销量与推广：单阶段输入（第 1~3 月 + 稳定期） */
export interface SalesPhase {
  monthIndex: number; // 1/2/3，稳定期=4
  naturalOrders: number; // 自然订单量
  promotionBudget: number; // 推广预算（元）
  promotionOrders: number; // 推广新增订单量
  activities?: StoreActivities; // 本阶段活动覆盖，缺省沿用全局 store.activities
  naturalOrdersReference?: string; // AI 参考区间展示用，非计算
}

/** 敏感性扫描配置：围绕稳定期总订单量做上下限 + 步长推演 */
export interface SweepConfig {
  minOrders: number;
  maxOrders: number;
  step: number;
}

/** 经营沙盘：某经营阶段逐档推演结果（第 1~3 月 + 稳定期） */
export interface StoreScenario {
  id: string;
  label: string; // 阶段名（第1月/第2月/第3月/稳定期）
  monthIndex: number; // 1/2/3，稳定期=4
  naturalOrders: number; // 自然订单量
  promotionOrders: number; // 推广新增订单量
  totalOrders: number; // 总订单量
  avgContributionProfit: number; // 平均单笔贡献利润
  monthlyNetProfit: number; // 月税后净利润
  breakevenOrders: number; // 保本月单量
  tax: number; // 预计税费
}

/** AI 分析报告中的单条风险（标题 + 依据 + 影响，均基于确定性测算，不输出伪概率） */
export interface AiReportRisk {
  title: string;
  evidence: string;
  impact: string;
}

/** AI 分析报告中的单条调整建议（动作 + 依据 + 预期影响） */
export interface AiReportRecommendation {
  action: string;
  evidence: string;
  expectedImpact: string;
}

/** AI 分析报告（可行性等级 + 摘要 + 成立条件 + 风险 + 调整建议） */
export interface AiReport {
  feasibility: "较可行" | "谨慎考虑" | "风险较高" | "信息不足";
  summary: string;
  conditions: string[];
  risks: AiReportRisk[];
  recommendations: AiReportRecommendation[];
}

/** 方案快照（生成报告时的完整输入 + 沙盘计算结果 + AI 分析，不可变，用于前后比较） */
export interface StoreSnapshot {
  id: string;
  storeId: string;
  createdAt: number;
  label: string;
  input: MerchantStore; // 完整输入快照
  scenarios: StoreScenario[]; // 经营沙盘计算结果
  report?: AiReport; // AI 分析（Task 9 填）
}

export interface MerchantStore {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: StoreStatus;
  profile: StoreProfile;
  locations: StoreLocation[];
  costs: StoreCosts;
  staffing: StoreStaffing;
  products: StoreProduct[];
  baskets: StoreBasket[];
  platformRules: PlatformRules;
  activities: StoreActivities;
  loss: StoreLoss;
  tax: StoreTax;
  sales: SalesPhase[];
  sweep: SweepConfig;
  scenarios: StoreScenario[];
}
