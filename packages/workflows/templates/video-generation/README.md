# video-generation

AI 自由生成短视频，script.json 驱动 + 4 步管线。

## 架构

```
4 步管线:
script（含校验）→ tts（可选）→ bgm → render
```

## 核心设计

- **AI 自由生成**：不限制场景类型，AI 根据风格指南自由创作 HTML
- **script.json 驱动**：统一的 JSON 结构，Zod 校验 + 重试
- **纯画面渲染**：HyperFrames 渲染纯画面，ffmpeg 单独混合音频
- **风格可选**：用户可选 Neo-Brutalist/奶油风/极简黑白，不选则 AI 决定

## 模板

- `templates/animation.html`：GSAP 动画骨架
- `templates/styles/`：3 个风格指南（neo-brutalist.md / cream.md / bw.md）

## 与 tech-video 的区别

| 维度 | tech-video | video-generation |
|------|-----------|-----------------|
| 模板 | 11 套固定 HTML/CSS | 无固定模板，AI 自由生成 |
| 约束 | templateId + inputs | 风格指南 + 4 层校验 |
| 灵活性 | 低 | 高 |
| 适用场景 | 科技/数码类 | 通用（生活/美食/旅行） |