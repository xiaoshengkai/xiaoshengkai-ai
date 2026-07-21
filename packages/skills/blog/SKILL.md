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

1. 在对应类目下创建目录（文章标题作为目录名，URL 编码处理特殊字符）
2. 放入 `index.html` + `images/`（封面图 cover.png，插画 illustration-N.png）
3. 更新该类目的 `index.html` 列表页（在 `<div class="card-grid">` 中插入新卡片）

卡片模板：
```html
<a href="URL_ENCODED_DIR/" target="_blank" class="card article-card card-blue">
  <div class="card-thumb" style="background-image:url(URL_ENCODED_DIR/images/cover.png)"></div>
  <div class="card-body">
    <p class="card-desc">文章标题</p>
    <p class="card-sub">副标题/摘要</p>
  </div>
</a>
```

## 自动同步

`exportXiaohongshuNote` 导出笔记后会自动同步到博客对应的类目，只需手动 `git push` 部署。

## 博客地址

https://xiaoshengkai.github.io/xiaoshengkai-ai/