# 极简黑白 风格指南

## 颜色
- 纯白底色 #FFFFFF，纯黑文字 #000000，对比度 ≥ 15:1
- 灰色 (#999 ~ #CCC) 仅用于 1px 分割线/边框/几何点缀，禁止灰色文字

## 字体（从本地字体库选取，所有字体已注入 @font-face，无需外部引用）
- 标题 Lora 700 italic（衬线斜体，杂志感）
- 正文 Inter 300/400（细无衬线）
- 中文用 Noto Sans SC 400
- 兜底：'Noto Sans SC', sans-serif
- 可用本地字体：Archivo(500/700/900), Alfa Slab One(400), Be Vietnam Pro(500/600/700/800/900), Inter(200-900), Inter Tight(400-900), Lora(400-700 italic), Space Mono(400/700), Noto Sans SC(400/500/700/900)

## 布局
- 杂志式非对称排版：左对齐或右对齐，绝不居中
- 留白 ≥ 40%，单屏文字 ≤ 3 行
- 1080×1920 竖屏

## 动画
- 动效：仅淡入淡出 + 上下微位移(≤30px)，ease-in-out 0.6-0.8s
- 无弹跳/旋转
- 转场：淡入淡出 0.5s，无彩色 wipe

## 装饰
- 1px 黑色细线 + 几何图形（圆形/方形边框）
- 无图标/emoji/渐变/阴影

## HTML 约束
- 内联样式用 style 属性，不用 class 样式
- 禁止 `<script>`、jQuery、远程样式表、@import
- 禁止 `<link rel="stylesheet" href="https://">`
- 禁止 `@import url(...)`