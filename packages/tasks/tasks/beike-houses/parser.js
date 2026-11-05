/**
 * 贝壳列表页 HTML 解析（纯函数）
 * 兼容 sx.ke.com 两种列表模板（板块页新模板 / 经典模板），字段：
 * 房源ID、小区ID+名、标题、户型、面积、楼层、朝向、总价、单价、关注数、发布时间、标签
 */

const LI_RE = /<li class="clear[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
const TOTAL_RE = /共找到<span>\s*(\d+)\s*<\/span>\s*套/;
const HOUSE_ID_RE = /ershoufang\/(\d+)\.html/;
const XIAOQU_RE = /<div class="positionInfo">[\s\S]*?<a[^>]*href="[^"]*xiaoqu\/(\d+)\/?"[^>]*>([^<]+)<\/a>/;
const TITLE_RE = /<div class="title">\s*<a[^>]*title="([^"]+)"/;
const LAYOUT_RE = /(\d+)室(\d+)厅/;
const SIZE_RE = /([\d.]+)\s*平米/;
const FLOOR_LEVEL_RE = /(地下室|顶楼|低楼层|中楼层|高楼层)/;
const TOTAL_FLOORS_RE = /[（(]共(\d+)层[）)]/;
const TOTAL_PRICE_RE = /class="totalPrice[^"]*"[\s\S]{0,300}?<span[^>]*>\s*([\d.]+)\s*<\/span>/;
const UNIT_PRICE_RE = /class="unitPrice"[^>]*>[\s\S]{0,200}?([\d,]+)\s*元\/平/;
const FOLLOWS_RE = /(\d+)\s*人关注/;
const PUBLISH_RE = /\/\s*([^<>|\n]*?发布)\s*</;
const GOODHOUSE_RE = /class="goodhouse_tag[^"]*"[^>]*>\s*([^<]+?)\s*</;

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseHouseInfo(text) {
  // 形如 "中楼层(共44层) 3室2厅 | 118.19平米 | 南 北"（新模板）
  // 或   "3室1厅 | 97平米 | 南 | 其他 | 高楼层(共33层) | 板楼"（经典模板）
  const segments = text.split("|").map((s) => s.trim());
  let orientation = "";
  for (const seg of segments) {
    if (/^[东南西北\s]+$/.test(seg) && seg.trim()) {
      orientation = seg.replace(/\s+/g, "").trim();
      break;
    }
  }
  return {
    layout: LAYOUT_RE.exec(text)?.[0] || "",
    rooms: Number(LAYOUT_RE.exec(text)?.[1] || 0),
    size: Number(SIZE_RE.exec(text)?.[1] || 0),
    floorLevel: FLOOR_LEVEL_RE.exec(text)?.[1] || "",
    totalFloors: Number(TOTAL_FLOORS_RE.exec(text)?.[1] || 0),
    orientation,
  };
}

export function parseLi(liHtml) {
  const id = HOUSE_ID_RE.exec(liHtml)?.[1];
  if (!id) return null;

  const xiaoqu = XIAOQU_RE.exec(liHtml);
  const houseInfoText = stripTags(/<div class="houseInfo">([\s\S]*?)<\/div>/.exec(liHtml)?.[1] || "");
  const info = parseHouseInfo(houseInfoText);

  const tags = [];
  const goodhouse = GOODHOUSE_RE.exec(liHtml)?.[1];
  if (goodhouse) tags.push(goodhouse);
  const tagDiv = /<div class="tag">([\s\S]*?)<\/div>/.exec(liHtml)?.[1] || "";
  for (const m of tagDiv.matchAll(/<span[^>]*>\s*([^<]+?)\s*<\/span>/g)) {
    if (m[1]) tags.push(m[1]);
  }

  return {
    id,
    url: `https://sx.ke.com/ershoufang/${id}.html`,
    resblockId: xiaoqu?.[1] || "",
    community: (xiaoqu?.[2] || "").trim(),
    title: TITLE_RE.exec(liHtml)?.[1] || "",
    ...info,
    totalPrice: Number(TOTAL_PRICE_RE.exec(liHtml)?.[1] || 0),
    unitPrice: Number((UNIT_PRICE_RE.exec(liHtml)?.[1] || "0").replace(/,/g, "")),
    follows: Number(FOLLOWS_RE.exec(liHtml)?.[1] || 0),
    publishText: PUBLISH_RE.exec(liHtml)?.[1]?.trim() || "",
    tags: [...new Set(tags)],
  };
}

/**
 * 解析列表页
 * @returns {{total: number|null, houses: object[]}}
 */
export function parseListPage(html) {
  const total = TOTAL_RE.exec(html)?.[1];
  const ul = /<ul class="sellListContent"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  const houses = [];
  for (const m of ul.matchAll(LI_RE)) {
    const h = parseLi(m[1]);
    if (h) houses.push(h);
  }
  return { total: total != null ? Number(total) : null, houses };
}

/**
 * 解析房源详情页（权威归属 + 在售状态）
 *
 * 详情页 <title> 格式（实测稳定）：
 *   绍兴{区县}{商圈}{房源标题}_{真实小区名}二手房{户型}{面积}…-绍兴贝壳
 *   例：绍兴上虞区崧厦商圈崧厦御景华庭，小套顶楼复式楼，精装修_御景华庭二手房…
 *       绍兴越城区东湖自住精装…_迪東公寓二手房…
 * c 列表页会把同名/附近小区的房源混挂目标小区（resblock_id 同为被查小区），
 * 详情页的 区/小区 才是真实归属 → 用于归属校验。
 *
 * @returns {{online: boolean, totalPrice: number|null, district: string, community: string}}
 */
export function parseDetailPage(html) {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] || "";
  const district = /绍兴(越城区|上虞区|柯桥区|诸暨市|嵊州市|新昌县)/.exec(title)?.[1] || "";
  const community = (/_([^_]+?)二手房/.exec(title)?.[1] || "").trim();
  const total = /class="total"[^>]*>\s*([\d.]+)\s*</.exec(html)?.[1];
  const off = /已下架|已成交|房源不存在|找不到了/.test(html);
  // 在售判定：有总价数字且无下架标记
  if (total && !off) return { online: true, totalPrice: Number(total), district, community };
  return { online: false, totalPrice: null, district, community };
}

/** 电梯推断：国标 7 层及以上应设电梯 */
export function elevatorText(totalFloors) {
  if (!totalFloors) return "—";
  return totalFloors >= 7 ? "有" : "无";
}
