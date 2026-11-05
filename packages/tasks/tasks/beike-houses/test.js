/**
 * 纯函数单测：parser / filter / diff
 * 运行：node --test packages/tasks/tasks/beike-houses/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseLi, parseListPage, parseDetailPage, elevatorText } from "./parser.js";
import { applyFilters, isSuspiciousShrink, normalizeName, matchExact, verifyOwnership } from "./filter.js";
import { diffSnapshots, updateRegistry } from "./diff.js";
import { config } from "./config.js";

// 真实列表页 li 片段（sx.ke.com 新模板，2026-11-05 抓取）
const FIXTURE_LI = `<li class="clear">
  <a class="img VIEWDATA CLICKDATA maidian-detail"
     href="https://sx.ke.com/ershoufang/103134383654.html" target="_blank" title="东湖镇上优质房源  中间楼层  后期费用节省"
     data-action='source_type=PC首页和列表页搜索&fb_query_id=1170663678828306432&type=&housedel_id=103134383654&resblock_id=8709129567124212&click_position=0'>
  </a>
  <div class="info clear">
    <div class="title">
      <a class="VIEWDATA CLICKDATA maidian-detail" title="东湖镇上优质房源  中间楼层  后期费用节省"
         href="https://sx.ke.com/ershoufang/103134383654.html" target="_blank">东湖镇上优质房源  中间楼层  后期费用节省</a>
      <span class="goodhouse_tag tagBlock">必看好房</span>
    </div>
    <div class="address">
      <div class="flood">
        <div class="positionInfo">
          <span class="positionIcon"></span>
          <a href="https://sx.ke.com/xiaoqu/8709129567124212/">枫华景园</a>
        </div>
      </div>
      <div class="houseInfo">
        <span class="houseIcon"></span>
        中楼层
        (共6层)
        3室2厅 | 102.74平米
        | 南
      </div>
      <div class="followInfo">
        <span class="starIcon"></span>
        9人关注
        / 2年前发布
      </div>
      <div class="tag">
        <span class="taxfree">满五年</span>
        <span class="isVrFutureHome">VR看装修</span>
      </div>
      <div class="priceInfo">
        <div class="totalPrice totalPrice2">
          <i></i>
          <span class=""> 70</span>
          <i>万</i>
        </div>
        <div class="unitPrice" data-hid="103134383654" data-price="">
          <span>6,814元/平</span>
        </div>
      </div>
  </li>`;

// 经典模板 li（首页样式，字段顺序不同）
const CLASSIC_LI = `<li class="clear">
  <div class="info clear">
    <div class="title"><a href="https://sx.lianjia.com/ershoufang/103139408585.html" target="_blank">标题A</a></div>
    <div class="address"><div class="flood"><div class="positionInfo"><span class="positionIcon"></span>
      <a href="https://sx.lianjia.com/xiaoqu/8709129572372939/" data-log_index="1" data-el="region">中海·世纪公館 </a>
    </div></div>
    <div class="houseInfo"><span class="houseIcon"></span>3室1厅 | 97平米 | 南 | 其他 | 高楼层(共33层)  | 板楼</div>
    <div class="followInfo"><span class="starIcon"></span>1人关注 / 一年前发布</div>
    <div class="tag"><span class="isVrFutureHome">VR看装修</span><span class="haskey">随时看房</span></div>
    <div class="priceInfo"><div class="totalPrice totalPrice2"><i> </i><span class="">80.2</span><i>万</i></div>
    <div class="unitPrice" data-hid="103139408585" data-rid="8709129572372939" data-price="8269"><span>8,269元/平</span></div></div>
  </div>
</li>`;

const wrapUl = (lis) =>
  `<html><body><h2 class="total fl">共找到<span> 2 </span>套绍兴二手房</h2><ul class="sellListContent" log-mod="List">${lis}</ul></body></html>`;

test("parser: 新模板 li 全字段解析", () => {
  const h = parseLi(FIXTURE_LI);
  assert.equal(h.id, "103134383654");
  assert.equal(h.resblockId, "8709129567124212");
  assert.equal(h.community, "枫华景园");
  assert.equal(h.rooms, 3);
  assert.equal(h.layout, "3室2厅");
  assert.equal(h.size, 102.74);
  assert.equal(h.floorLevel, "中楼层");
  assert.equal(h.totalFloors, 6);
  assert.equal(h.orientation, "南");
  assert.equal(h.totalPrice, 70);
  assert.equal(h.unitPrice, 6814);
  assert.equal(h.follows, 9);
  assert.equal(h.publishText, "2年前发布");
  assert.ok(h.tags.includes("必看好房"));
  assert.ok(h.tags.includes("满五年"));
  assert.equal(h.url, "https://sx.ke.com/ershoufang/103134383654.html");
});

test("parser: 经典模板 li（字段顺序不同）", () => {
  const h = parseLi(CLASSIC_LI);
  assert.equal(h.id, "103139408585");
  assert.equal(h.community, "中海·世纪公館");
  assert.equal(h.rooms, 3);
  assert.equal(h.size, 97);
  assert.equal(h.floorLevel, "高楼层");
  assert.equal(h.totalFloors, 33);
  assert.equal(h.orientation, "南");
  assert.equal(h.totalPrice, 80.2);
  assert.equal(h.unitPrice, 8269);
  assert.equal(h.publishText, "一年前发布");
  assert.equal(elevatorText(h.totalFloors), "有");
});

test("parser: parseListPage 提取 total 与房源数", () => {
  const { total, houses } = parseListPage(wrapUl(FIXTURE_LI + CLASSIC_LI));
  assert.equal(total, 2);
  assert.equal(houses.length, 2);
  const empty = parseListPage("<html><body>无结果</body></html>");
  assert.equal(empty.total, null);
  assert.deepEqual(empty.houses, []);
});

test("parser: 电梯推断（7 层界）", () => {
  assert.equal(elevatorText(6), "无");
  assert.equal(elevatorText(7), "有");
  assert.equal(elevatorText(33), "有");
  assert.equal(elevatorText(0), "—");
});

test("parser: 详情页权威归属解析 + 在售/下架判定", () => {
  // 实测详情页 title：贝壳 c 页把上虞崧厦御景华庭混挂进越城御景华庭的查询结果
  const shangyu = `<title>绍兴上虞区崧厦商圈崧厦御景华庭，小套顶楼复式楼，精装修_御景华庭二手房3室2厅74.62平米二手房出售-绍兴贝壳</title><div class="price"><span class="total">68</span>`;
  assert.deepEqual(parseDetailPage(shangyu), {
    online: true,
    totalPrice: 68,
    district: "上虞区",
    community: "御景华庭",
  });
  // 东湖的房混挂在卧龙银湖湾 c 页（同名/附近聚合）
  const donghu = `<title>绍兴越城区东湖自住精装，复式实际使用面积高，采光充足，交通便利_迪東公寓二手房3室2厅123.2平米二手房出售-绍兴贝壳</title><div class="price"><span class="total">80</span>`;
  assert.deepEqual(parseDetailPage(donghu), {
    online: true,
    totalPrice: 80,
    district: "越城区",
    community: "迪東公寓",
  });
  // 真实御景华庭四期北区（迪荡）
  const real = `<title>绍兴越城区迪荡房东诚心出售，楼层好阳光充足，精装拎包入住_御景华庭四期北区二手房3室2厅118.19平米二手房出售-绍兴贝壳</title><div class="price"><span class="total">135</span>`;
  const r = parseDetailPage(real);
  assert.equal(r.district, "越城区");
  assert.equal(r.community, "御景华庭四期北区");
  // 已下架
  const off = parseDetailPage("<html><title>绍兴越城区迪荡X_御景华庭二手房</title>房源已下架</html>");
  assert.equal(off.online, false);
  assert.equal(off.totalPrice, null);
});

const mkHouse = (over = {}) => ({
  id: "1",
  group: "didang",
  community: "御景华庭四期北区",
  layout: "3室2厅",
  rooms: 3,
  size: 100,
  totalPrice: 90,
  unitPrice: 9000,
  ...over,
});

test("filter: 价格/户型边界", () => {
  const houses = [
    mkHouse({ id: "a", totalPrice: 99, rooms: 3 }),
    mkHouse({ id: "b", totalPrice: 99.5, rooms: 3 }), // 超预算
    mkHouse({ id: "c", totalPrice: 50, rooms: 2 }), // 户型不足
    mkHouse({ id: "d", totalPrice: 30, rooms: 4 }),
  ];
  const out = applyFilters(houses, config).map((h) => h.id);
  assert.deepEqual(out, ["a", "d"]);
});

test("filter: 白名单精确匹配（防同名小区/聚合混挂）", () => {
  const didangSet = config.groups.find((g) => g.key === "didang").include;
  // 各期全名 ∈ 集合
  assert.ok(matchExact("御景华庭三期", didangSet));
  assert.ok(matchExact("御景华庭四期北区", didangSet));
  assert.ok(matchExact("金地·蘭悦", didangSet));
  assert.ok(matchExact("星尚·悦湖苑", didangSet));
  // 同名他区/无关小区 ∉ 集合（contains 时代会误放行的案例）
  assert.ok(!matchExact("崧厦御景华庭", didangSet));
  assert.ok(!matchExact("世禾新村", didangSet));
  // applyFilters 走 include 精确语义
  const ok = applyFilters(
    [mkHouse({ community: "御景华庭三期" }), mkHouse({ community: "金地·蘭悦" }), mkHouse({ community: "星尚·悦湖苑" })],
    config
  );
  assert.equal(ok.length, 3);
  const bad = applyFilters(
    [mkHouse({ community: "世禾新村" }), mkHouse({ community: "崧厦御景华庭" })],
    config
  );
  assert.equal(bad.length, 0);
});

test("filter: verifyOwnership 归属校验（区县 + 精确小区）", () => {
  const didangHouse = mkHouse({ group: "didang", community: "御景华庭" });
  // 上虞崧厦御景华庭 → 区县不符，剔除
  assert.equal(verifyOwnership(didangHouse, { district: "上虞区", community: "御景华庭" }, config), false);
  // 越城真实御景华庭 → 通过
  assert.equal(verifyOwnership(didangHouse, { district: "越城区", community: "御景华庭" }, config), true);
  // 越城但小区不在集合（迪東公寓混挂卧龙银湖湾 c 页）→ 剔除
  const lianghuHouse = mkHouse({ group: "lianghu", community: "卧龙银湖湾" });
  assert.equal(verifyOwnership(lianghuHouse, { district: "越城区", community: "迪東公寓" }, config), false);
  assert.equal(verifyOwnership(lianghuHouse, { district: "越城区", community: "卧龙银湖湾" }, config), true);
  // 黑名单组（无 include）不校验
  assert.equal(verifyOwnership(mkHouse({ group: "gaobu" }), { district: "上虞区", community: "X" }, config), true);
});

test("filter: 黑名单（陶堰街道小区）", () => {
  const out = applyFilters(
    [mkHouse({ group: "gaobu", community: "陶然名苑" }), mkHouse({ group: "gaobu", community: "滋江家园" })],
    config
  );
  assert.deepEqual(out.map((h) => h.community), ["滋江家园"]);
});

test("filter: 名称归一化", () => {
  assert.equal(normalizeName("金地·蘭悦"), "金地蘭悦");
  assert.equal(normalizeName("御景华庭（三期） "), "御景华庭三期");
});

test("filter: 完整性守卫 50% 阈值", () => {
  assert.equal(isSuspiciousShrink(49, 100), true);
  assert.equal(isSuspiciousShrink(50, 100), false);
  assert.equal(isSuspiciousShrink(0, 0), false);
  assert.equal(isSuspiciousShrink(3, 0), false);
});

test("diff: 新增/下架/涨降价", () => {
  const prev = [
    mkHouse({ id: "1", totalPrice: 90 }),
    mkHouse({ id: "2", totalPrice: 80 }),
    mkHouse({ id: "3", totalPrice: 70 }),
  ];
  const curr = [
    mkHouse({ id: "1", totalPrice: 85 }), // 降价
    mkHouse({ id: "2", totalPrice: 80 }), // 不变
    mkHouse({ id: "4", totalPrice: 60 }), // 新增
  ];
  const d = diffSnapshots(prev, curr, {});
  assert.deepEqual(d.added.map((h) => h.id), ["4"]);
  assert.deepEqual(d.removed.map((h) => h.id), ["3"]);
  assert.equal(d.changed.length, 1);
  assert.equal(d.priceDown.length, 1);
  assert.equal(d.priceDown[0].deltaTotal, -5);
  assert.equal(d.priceUp.length, 0);
});

test("diff: 重新上架识别（registry offSince）", () => {
  const registry = { "9": { firstSeen: "2026-10-01", offSince: "2026-11-01", priceHistory: [] } };
  const d = diffSnapshots([], [mkHouse({ id: "9" })], registry);
  assert.equal(d.added[0].reappeared, true);
  assert.equal(d.added[0].firstSeen, "2026-10-01");
});

test("diff: updateRegistry 记录 firstSeen 与价格历史", () => {
  const r1 = updateRegistry({}, [mkHouse({ id: "1", totalPrice: 90, community: "X" })], "2026-11-04");
  assert.equal(r1["1"].firstSeen, "2026-11-04");
  assert.equal(r1["1"].priceHistory.length, 1);
  const r2 = updateRegistry(r1, [mkHouse({ id: "1", totalPrice: 85, community: "X" })], "2026-11-05");
  assert.equal(r2["1"].priceHistory.length, 2); // 价格变了追加
  assert.equal(r2["1"].offSince, null);
  const r3 = updateRegistry(r2, [], "2026-11-06");
  assert.equal(r3["1"].offSince, "2026-11-06"); // 消失标记下架
});
