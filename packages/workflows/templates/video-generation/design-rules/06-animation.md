# 动画规范

## 核心理念

**鼓励炫技，但要炫得有意义。** 动画不是装饰，是信息传递的节奏工具。

- 符合场景情绪和内容节奏的动画 = 精彩
- 无意义的旋转/晃动 = 干扰
- 每个动画都有"为什么"（强调、对比、过渡、引导视线）

## 时长表

| 场景 | 时长 | 理由 |
|------|------|------|
| 微变化（颜色、透明度） | 50-100ms | 几乎无感 |
| 元素入场（小元素） | 200ms | 短促有力 |
| 元素入场（标题、大元素） | 300-400ms | 视觉冲击 |
| 炫技入场（弹性/弹跳/旋转） | 500-700ms | 给观众看清 |
| 元素出场 | 150-200ms | 比入场快 |
| 擦除转场 | 400-540ms | 干净利落 |
| 场景总时长 | 3-6s | 短视频节奏 |

## 缓动表

| 缓动类型 | 曲线 | 用途 |
|----------|------|------|
| `power2.out` | 先快后慢 | 90% 入场 |
| `power3.out` | 更干脆的先快后慢 | 大标题、强调 |
| `power2.in` | 先慢后快 | 退场 |
| `back.out(1.7)` | 轻微过冲回弹 | 弹跳入场（Hook、重点） |
| `back.out(2)` | 明显过冲回弹 | 强烈弹跳（Peak） |
| `elastic.out(1, 0.5)` | 弹性震荡 | 戏剧性入场（慎用，1-2 次/视频） |
| ❌ 禁止 `linear` | 机械感 | 任何场景 |

## 入场预设表

AI 通过 `data-animate-in` 属性选择入场效果：

| 预设名 | 效果 | 缓动 | 时长 | 推荐场景 |
|--------|------|------|------|---------|
| `fade-up`（默认） | 淡入 + 上滑 | power2.out | 0.5s | 通用 |
| `fade-down` | 淡入 + 下滑 | power2.out | 0.5s | 数字、统计 |
| `slide-left` | 左滑入 | power3.out | 0.5s | 对比、列表 |
| `slide-right` | 右滑入 | power3.out | 0.5s | 对比、列表 |
| `scale-up` | 缩放放大 | power3.out | 0.6s | 图标、emoji |
| `scale-down` | 放大缩小 | power3.out | 0.6s | 大字标题 |
| `bounce-in` | 弹跳（back.out 2） | back.out(2) | 0.6s | **Hook、Peak** |
| `elastic-in` | 弹性震荡 | elastic.out(1,0.5) | 0.7s | **戏剧性重点（1-2次）** |
| `rotate-in` | 旋转 + 缩放 | power3.out | 0.6s | **装饰、图标** |
| `blur-in` | 模糊变清晰 | power2.out | 0.5s | 金句、大标题 |
| `pop-in` | 弹跳 + 上滑 | back.out(1.7) | 0.5s | 卡片、标签 |
| `none` | 无入场 | — | 0s | 延续上一个场景 |

## 出场预设表

AI 通过 `data-animate-out` 属性选择出场效果：

| 预设名 | 效果 | 缓动 | 时长 | 说明 |
|--------|------|------|------|------|
| `fade-up`（默认） | 淡出 + 上滑 | power2.in | 0.3s | 通用出场 |
| `fade-down` | 淡出 + 下滑 | power2.in | 0.3s | 反向 |
| `slide-left` | 左滑出 | power2.in | 0.3s | 列表 |
| `slide-right` | 右滑出 | power2.in | 0.3s | 列表 |
| `scale-down` | 缩小消失 | power2.in | 0.3s | 图标 |
| `blur-out` | 模糊消失 | power2.in | 0.3s | 金句 |
| `none` | 无出场 | — | 0s | 硬切 |

## 转场模式

AI 通过 `data-transition` 属性选择转场效果：

| 转场 | 属性值 | 时长 | 说明 |
|------|--------|------|------|
| 擦除（左到右） | `wipe` | 0.54s | 默认，有冲击力的转场 |
| 淡入淡出 | 不设置 | 0.3s | 基础转场，引擎自动处理 |
| 无转场 | `none` | 0s | 场景间硬切 |

擦除转场可搭配 `data-transition-color` 指定颜色，如 `data-transition-color="#e94560"`。

## stagger 规则

| 场景 | 间隔 | 推荐用法 |
|------|------|---------|
| 列表项 | 0.05-0.08s | 多元素依次入场 |
| 卡片 | 0.08-0.12s | 卡片/块级元素 |
| 文字行 | 0.03-0.05s | 逐行动画 |

通过 `data-animate-children` 属性启用，格式：`stagger:0.08`

## 中间强调动画

在场景中间加入强调动画，用 `window.__engine.emphasize()` 或 `jsAnimation` 实现：

```js
// 脉冲（放大再还原）
var clip = document.getElementById('clip-3');
window.__engine.emphasize(clip, { scale: 1.04, duration: 0.15, yoyo: true, repeat: 1 });
```

```js
// 抖动（强调数字）
var clip = document.getElementById('clip-3');
window.__engine.emphasize(clip, { x: 3, duration: 0.05, yoyo: true, repeat: 5 });
```

## 炫技指南

| 效果 | 何时用 | 何时不用 |
|------|--------|---------|
| 弹性 `back.out(2)` | Hook 开场、重点数据 | 普通过渡场景 |
| 弹性震荡 `elastic.out` | 全场最精彩时刻（仅 1-2 次） | 日常场景 |
| 旋转 `rotate-in` | 装饰元素、图标入场 | 文字主体 |
| 擦除转场 `wipe` | 章节切换、情绪转折 | 连续快节奏场景 |
| 脉冲强调 | 数据冲击、金句 | 静态装饰 |
| 抖动 | 数字、强调词 | 大面积文字 |
| 交错入场 `stagger` | 列表、多元素场景 | 单元素场景 |

## 基础 timeline

- 所有 clip 都有入场 + 出场动画（由 `data-animate-in` / `data-animate-out` 控制）
- AI 动画与基础叠加（additive）：通过 `window.__timelines.main` 添加
- 不破坏基础 timeline（不要 `tl.kill()`）
- 选择器：用 `#stage .clip-{id} > 子元素`

## 反模式

- ❌ 时长 > 700ms（除非弹性震荡）
- ❌ linear 缓动
- ❌ 同时 > 4 个元素入场
- ❌ 每个元素都动（要有静的区域）
- ❌ elastic.out 超过 3 次/视频（滥用就廉价）
- ❌ 无意义的旋转（装饰元素旋转要有节奏感）