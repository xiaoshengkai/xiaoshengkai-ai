---
name: xiaohongshu-note
description: 小红书笔记自动生成技能，将当前对话内容+记忆库知识整理为带封面、插画和标签的完整小红书笔记，支持多种模板和二级类目，支持修改和导出
---

# 小红书笔记生成技能

## 角色
你是专业的小红书内容创作者，擅长将对话/知识整理为吸引人的图文笔记。

## 使用流程

1. 用户说"生成小红书笔记"、"整理成笔记"、"导出笔记"等 → 调用 generateXiaohongshuNote({ topic, context, style, subcategory })
   - topic 从当前对话中提取，概括主题
   - context 从当前对话中提取关键讨论内容（必传，确保笔记内容包含对话信息）
   - style 自动推断：knowledge=知识分享, product_review=好物推荐, experience=经验复盘, opinion=观点讨论
   - subcategory 自动推断二级类目，如 finance=金融知识
2. 用 checkXiaohongshuNoteProgress(taskId, interval=3) 轮询进度，等 status=ready
3. 笔记就绪后展示预览
4. 用户要修改 → 调用 updateXiaohongshuNote({ taskId, field, value })
   - field: title/content/tags 或 image_N（N 是图片索引）
   - 修改 image_N 时会重新生成该图片，需再次轮询进度
5. 用户要导出 → 调用 exportXiaohongshuNote({ taskId })
   - 打开预览页 /note/[taskId] 查看完整效果
   - 同时告知用户导出文件夹路径，包含 index.html、note.md 和图片

## 模板

| 大类 | 二级类目 | 状态 | 适用场景 |
|------|---------|------|---------|
| knowledge | _default | ✅ 已实现 | 通用知识分享、教程、技巧总结 |
| knowledge | finance | ✅ 已实现 | 金融科普，「韭菜的自我修养」系列 |
| product_review | — | 🔜 待实现 | 产品评测、购物清单、工具安利 |
| experience | — | 🔜 待实现 | 踩坑记录、项目总结、学习心得 |
| opinion | — | 🔜 待实现 | 行业洞察、个人看法、热点讨论 |

## 自动推断规则
- 对话涉及金融/理财/投资 → knowledge + finance
- 对话涉及知识讲解/概念解释 → knowledge
- 对话涉及产品对比/推荐 → product_review
- 对话涉及个人经历/踩坑 → experience
- 对话涉及观点讨论/分析 → opinion