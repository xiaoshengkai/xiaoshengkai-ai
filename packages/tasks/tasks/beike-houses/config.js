/**
 * 贝壳房源跟踪配置
 *
 * 数据源：sx.ke.com（绍兴贝壳）二手房列表页
 * - 匿名访问：列表 page1 可用；pgN 分页被 CAPTCHA 系统性拦截 → fetcher 用「自适应拆分查询」保证每查询 ≤30 条（单页装下）
 * - 筛选 URL：登录墙 → 用登录态 Cookie（data/beike-houses/cookies.json，从浏览器导出）
 *
 * 双户型轨道：
 * - 三室+ 轨道（全域）：东湖/皋埠（板全收+黑名单）、迪荡/两湖（小区白名单）
 * - 二室+ 轨道：仅迪荡·御景华庭一~五期（queries 标 rooms: 2 的查询粗筛多抓 l2）
 *
 * 同名小区坑（勿加错盘）：
 * - 御景华庭主盘 8709135256896234 = 上虞崧厦同名盘（面包屑「崧厦商圈」）
 * - 宝龙世家 87090000020529 = 诸暨同名盘（目标为越城 8709131789994978）
 */
export const config = {
  baseUrl: "https://sx.ke.com/ershoufang/",

  // 服务端粗筛默认：≥3室 × ≤100万（p1+p2 ⊇ ≤99万，边界由本地精滤兜住）
  baseFilter: { rooms: ["l3", "l4", "l5", "l6"], price: ["p1", "p2"], area: [], floor: [] },

  // 本地精滤（三室+ 轨道）
  priceMax: 99,
  minRooms: 3,

  // 二室+ 轨道：仅迪荡·御景华庭一~五期（≥2室；查询用 l2l3l4l5l6 粗筛）
  room2: { group: "didang", pattern: "^御景华庭([一二三四五]期)?(北区|南区)?$" },

  // 归属校验：详情页解析出的区县必须匹配（贝壳 c 页会聚合同名/附近小区且 resblock_id 同为被查小区）
  district: "越城区",

  groups: [
    {
      key: "donghu",
      label: "东湖",
      queries: ["donghu4"],
      exclude: ["陶然名苑", "江南景园", "名爵府"],
    },
    {
      key: "gaobu",
      label: "皋埠",
      queries: ["gaobu"],
      exclude: ["陶然名苑", "江南景园", "名爵府"],
    },
    {
      // queries 支持 string 或 { q, rooms: 2 }（二室+ 轨道查询，粗筛多抓 l2）
      // include/includePatterns = 精确小区名 + 名称模式；verify = 详情页权威归属校验（registry 缓存摊销）
      key: "didang",
      label: "迪荡",
      queries: [
        "didang",
        "c8709129468559250", // 金地·蘭悦（三室+）
        { q: "c8709129389867115", rooms: 2 }, // 御景华庭三期
        { q: "c8709129384620692", rooms: 2 }, // 御景华庭四期北区
        { q: "c8709129395110029", rooms: 2 }, // 御景华庭四期南区
        { q: "c8709129394061513", rooms: 2 }, // 御景华庭五期北区
        { q: "c8709129367848505", rooms: 2 }, // 御景华庭五期南区
        "c8709129338483729", // 星尚·悦湖苑（三室+）
      ],
      include: ["金地·蘭悦", "星尚·悦湖苑"],
      includePatterns: ["^御景华庭([一二三四五]期)?(北区|南区)?$"],
      verify: true,
    },
    {
      key: "lianghu",
      label: "两湖",
      // 三室+ 定向小区查询；include 精确名（宝龙世家双写法容错，诸暨同名盘由区县校验拦截）
      queries: [
        "c8709142672134315", // 中天观樾诚品
        "c87090000001077", // 卧龙银湖湾
        "c87090000027425", // 荣安御宾府
        "c8709131789994978", // 宝龙世家(越城区)
        "c8709134427133493", // 悦隽府
      ],
      include: ["中天观樾诚品", "卧龙银湖湾", "荣安御宾府", "宝龙世家(越城区)", "宝龙世家", "悦隽府"],
      verify: true,
    },
  ],

  // 抓取节奏（反爬礼貌）；上限需容纳列表 + 首次归属校验详情页
  requestIntervalMs: 4000,
  requestJitterMs: 2500,
  maxRequests: 220,
  pageSize: 30,

  // 数据保留
  retentionDays: 90,

  // 下架房源原因核查（详情页），每日最多核查数
  detailCheckLimit: 12,
};
