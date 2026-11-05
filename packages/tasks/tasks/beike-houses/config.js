/**
 * 贝壳房源跟踪配置
 *
 * 数据源：sx.ke.com（绍兴贝壳）二手房列表页
 * - 匿名访问：列表 page1 可用；pgN 分页被 CAPTCHA 系统性拦截 → fetcher 用「自适应拆分查询」保证每查询 ≤30 条（单页装下）
 * - 筛选 URL：登录墙 → 用登录态 Cookie（data/beike-houses/cookies.json，从浏览器导出）
 *
 * 小区白名单说明（include 为「包含匹配」关键词，容错小区全名变体）：
 * - 迪荡：金地·蘭悦 / 御景华庭（含各期） / 星尚·悦湖苑
 * - 两湖：中天观樾诚品 / 卧龙银湖湾 / 荣安御宾府
 * - 东湖/皋埠：全收，排除陶堰街道的黑名单小区
 */
export const config = {
  baseUrl: "https://sx.ke.com/ershoufang/",

  // 服务端粗筛：≥3室 × ≤100万（p1+p2 ⊇ ≤99万，边界由本地精滤兜住）
  baseFilter: { rooms: ["l3", "l4", "l5", "l6"], price: ["p1", "p2"], area: [], floor: [] },

  // 本地精滤
  priceMax: 99,
  minRooms: 3,

  // 归属校验：详情页解析出的区县必须匹配（贝壳 c 页会把上虞崧厦御景华庭等同名小区混挂进来）
  district: "越城区",

  groups: [
    {
      key: "donghu",
      label: "东湖",
      queries: ["donghu4"],
      exclude: ["陶然名苑", "江南景园"],
    },
    {
      key: "gaobu",
      label: "皋埠",
      queries: ["gaobu"],
      exclude: ["陶然名苑", "江南景园"],
    },
    {
      // include = 精确小区名集合（normalized 后全等比对；发现新期号/同名小区在日志提示后手动补录）
      // verify = 详情页权威归属校验（registry 缓存摊销，首跑全量、日常增量）
      key: "didang",
      label: "迪荡",
      queries: [
        "didang",
        "c8709129468559250", // 金地·蘭悦
        "c8709135256896234", // 御景华庭
        "c8709129389867115", // 御景华庭三期
        "c8709129384620692", // 御景华庭四期北区
        "c8709129394061513", // 御景华庭五期北区
        "c8709129338483729", // 星尚·悦湖苑
      ],
      include: [
        "金地·蘭悦",
        "御景华庭",
        "御景华庭三期",
        "御景华庭四期北区",
        "御景华庭五期北区",
        "星尚·悦湖苑",
      ],
      verify: true,
    },
    {
      key: "lianghu",
      label: "两湖",
      // 两湖板块量大（600+），小区走定向 c<id> 查询；include 精确名集合
      queries: [
        "c8709142672134315", // 中天观樾诚品
        "c87090000001077", // 卧龙银湖湾
        "c87090000027425", // 荣安御宾府
      ],
      include: ["中天观樾诚品", "卧龙银湖湾", "荣安御宾府"],
      verify: true,
    },
  ],

  // 抓取节奏（反爬礼貌）；上限需容纳列表 + 首次归属校验详情页（~63+50）
  requestIntervalMs: 4000,
  requestJitterMs: 2500,
  maxRequests: 200,
  pageSize: 30,

  // 数据保留
  retentionDays: 90,

  // 下架房源原因核查（详情页），每日最多核查数
  detailCheckLimit: 12,
};
