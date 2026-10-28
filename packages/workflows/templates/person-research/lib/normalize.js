/**
 * 搜索结果归一化：URL 规范化（去追踪参/去 hash/统一大小写/去尾斜杠）
 * 与来源域名分级（A 政府/学校/组织，B 正规媒体，C 平台/聚合/未知，D 论坛/UGC）。
 */
const TRACKING_PARAM_RE = /^(utm_|spm|from|vd_source|share_|sms|mkt_)/i;

const CLASS_A_SUFFIXES = [".gov.cn", ".edu.cn", ".gov", ".edu", ".org"];
const CLASS_B_DOMAINS = [
  "people.com.cn", "xinhuanet.com", "news.cn", "chinanews.com", "thepaper.cn",
  "caixin.com", "jiemian.com", "yicai.com", "21jingji.com", "stcn.com",
  "bjnews.com.cn", "infzm.com", "guancha.cn", "cnr.cn", "cctv.com",
  "news.sina.com.cn", "news.qq.com", "163.com", "sohu.com", "ifeng.com",
  "reuters.com", "bbc.com", "nytimes.com",
];
const CLASS_C_RE = /baike|zhihu|weibo|xueqiu|36kr|tianyancha|qcc|aiqicha|liepin|linkedin|github|csdn|jianshu|douban|bilibili|douyin|kuaishou|xiaohongshu|wikipedia|wiki|mp\.weixin\.qq\.com/;
const CLASS_D_RE = /tieba|forum|bbs|\/blog\.|lofter|sayou/;

export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM_RE.test(k))
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    u.search = "";
    for (const [k, v] of params) u.searchParams.append(k, v);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(url || "");
  }
}

export function sameSource(a, b) {
  return canonicalUrl(a) === canonicalUrl(b);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function domainClass(domain) {
  const d = String(domain || "").toLowerCase();
  if (!d) return "D";
  if (CLASS_A_SUFFIXES.some(sfx => d.endsWith(sfx))) return "A";
  if (CLASS_D_RE.test(d)) return "D";
  if (CLASS_B_DOMAINS.some(b => d === b || d.endsWith(`.${b}`))) return "B";
  if (CLASS_C_RE.test(d)) return "C";
  return "C";
}
