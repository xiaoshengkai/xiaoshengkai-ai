# Mermaid 甘特图示例

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'ganttBarColor': '#FFB5C2', 'ganttBarBkgColor': '#FFD6DE', 'ganttActiveBarColor': '#B5D8EB', 'ganttActiveBarBkgColor': '#D4ECFF', 'ganttDoneBarColor': '#C5E0C5', 'ganttDoneBarBkgColor': '#E0F0E0', 'ganttCritBarColor': '#D4A5F5', 'ganttCritBarBkgColor': '#E8D0FF', 'ganttMilestoneColor': '#FFD700', 'ganttMilestoneBkgColor': '#FFF0B3'}}}%% 
gantt
    title XSS Git Auto Fix 甘特图
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d
    
    section 单项目修复
    解析输入参数           :done, a1, 2025-01-01, 1d
    扫描XSS漏洞文件        :active, a2, 2025-01-02, 2d
    清理分支和MR           :a3, 2025-01-04, 1d
    创建fix/xss-all分支    :a4, 2025-01-05, 1d
    AST修复XSS代码         :crit, a5, 2025-01-06, 2d
    补充sanitize导入       :a6, 2025-01-06, 2d
    添加xss-guard依赖      :a7, 2025-01-06, 2d
    提交commit             :a8, 2025-01-08, 1d
    创建MergeRequest       :a9, 2025-01-09, 1d
    生成Markdown报告       :milestone, a10, 2025-01-10, 0d

    section 批量修复
    解析projects.json      :done, b1, 2025-01-01, 1d
    按负责人分组           :b2, 2025-01-02, 1d
    项目1-扫描修复MR       :active, b3, 2025-01-03, 4d
    项目2-扫描修复MR       :b4, 2025-01-04, 4d
    项目3-扫描修复MR       :b5, 2025-01-05, 4d
    项目N-扫描修复MR       :crit, b6, 2025-01-06, 4d
    汇总结果表格           :b7, 2025-01-10, 1d
    生成最终报告           :milestone, b8, 2025-01-11, 0d
```

### 配色规则

| 状态 | 色值 | 说明 |
|---|---|---|
| done | `#C5E0C5` 浅绿 | 已完成任务 |
| active | `#B5D8EB` 浅蓝 | 进行中任务 |
| crit | `#D4A5F5` 浅紫 | 关键路径 |
| milestone | `#FFD700` 金色 | 里程碑节点 |

### 通用规则

- 马卡龙柔和色系，避免高饱和度
- 任务名用空格对齐，不用 tab
- section 分组按功能划分
- milestone 持续天数为 0d