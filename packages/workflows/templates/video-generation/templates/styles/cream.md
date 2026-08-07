# 奶油风 风格指南

## 颜色
- 暖奶油白 #FFF8F2，珊瑚红 #FF6B6B，薄荷绿 #4ECDC4
- 蜂蜜黄 #FFD93D，薰衣草紫 #A29BFE，珊瑚粉 #FDAA9B，深蓝 #2C3E50

## 字体（从本地字体库选取，所有字体已注入 @font-face，无需外部引用）
- 标题 Alfa Slab One 400（圆润衬线，奶油感）
- 正文 Be Vietnam Pro 500
- 中文用 Noto Sans SC 500（标题）/ 400（正文）
- 兜底：'Noto Sans SC', sans-serif
- 可用本地字体：Archivo(500/700/900), Alfa Slab One(400), Be Vietnam Pro(500/600/700/800/900), Inter(200-900), Inter Tight(400-900), Lora(400-700 italic), Space Mono(400/700), Noto Sans SC(400/500/700/900)

## 布局
- 12-20px 全圆角，柔和 rgba 阴影，虚线装饰
- 1080×1920 竖屏

## 动画
- 转场: 双层 wipe(水平彩色 0.5s + 纵向奶油 0.24s)
- 进入: back.out(1.7)/elastic.out(1,0.5)/stagger 0.1s

## HTML 约束
- 内联样式用 style 属性，不用 class 样式
- 禁止 `<script>`、jQuery、远程样式表、@import
- 禁止 `<link rel="stylesheet" href="https://">`
- 禁止 `@import url(...)`