---
name: blog
keywords: 博客, 发到博客, 放到博客, 发布到博客, 博客文章, 博客类目, site
description: 博客管理技能，将内容发布到开盛的博客（GitHub Pages）
---

## 博客位置

项目根目录 `site/`，结构：
- `site/index.html` — 首页
- `site/finance/` — 金融学习笔记
- `site/tech/` — AI 工程实践
- `site/life/` — 生活分享

## 添加文章

1. 在对应类目下创建目录，放入 `index.html` + `images/`
2. 更新该类目 `index.html` 列表页，插入新卡片

## 自动同步

`exportXiaohongshuNote` 导出后自动同步，只需手动 `git push` 部署。

## 博客地址

https://node.tailddce43.ts.net/blog/