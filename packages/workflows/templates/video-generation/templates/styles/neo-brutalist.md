# Neo-Brutalist 风格指南

## 颜色
- 底色 Cream #EFE9D9，主色 Ink #0F0F0F
- 强调 Green #1F8A4C / Pink #F06CA8 / Orange #E85A1F / Yellow #F5C518

## 字体（从本地字体库选取，所有字体已注入 @font-face，无需外部引用）
- 标题 Archivo 900 全大写 0.92lh
- 正文 Be Vietnam Pro 500 左对齐
- 标签 Space Mono 700 等宽
- 中文用 Noto Sans SC 700（标题）/ 400（正文）
- 兜底：'Noto Sans SC', sans-serif
- 可用本地字体：Archivo(500/700/900), Alfa Slab One(400), Be Vietnam Pro(500/600/700/800/900), Inter(200-900), Inter Tight(400-900), Lora(400-700 italic), Space Mono(400/700), Noto Sans SC(400/500/700/900)

## 布局
- 4px 硬边框，硬偏移阴影(1.25cqw)
- 无圆角(除 pill)，无渐变，无模糊
- 1080×1920 竖屏

## 动画
- 转场: 双层 wipe(水平彩色 0.5s + 纵向黑色 0.24s)
- 进入: back.out(1.7)/elastic.out(1,0.5)/stagger 0.1s
- 每帧 2-3 个强调色，绿色底仅结束帧

## HTML 约束
- 内联样式用 style 属性，不用 class 样式
- 禁止 `<script>`、jQuery、远程样式表、@import
- 禁止 `<link rel="stylesheet" href="https://">`
- 禁止 `@import url(...)`
- SVG 图表使用实际 hex 色值，不使用 CSS 变量