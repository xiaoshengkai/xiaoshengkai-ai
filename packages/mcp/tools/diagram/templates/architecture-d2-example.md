# D2 架构图示例

```
direction: down

user: {
  label: "用户层"
  entry: "entry.py" { shape: page }
  batch: "batch_fix.py" { shape: page }
  scan: "batch_scan.py" { shape: page }
}

core: {
  label: "核心层"
  agent: "GitAgent (core.py)" {
    shape: hexagon
    style.fill: "#4A7C59"
  }
}

gitlab: {
  label: "GitLab API 层"
  branch: "创建分支" { shape: rectangle }
  file: "获取/更新文件" { shape: rectangle }
  mr: "创建 MR" { shape: rectangle }
}

output: {
  label: "输出层"
  report: "Markdown 报告" { shape: document }
  table: "控制台表格" { shape: document }
}

user.entry -> core.agent
user.batch -> core.agent
user.scan -> core.agent
core.agent -> gitlab.branch
core.agent -> gitlab.file
gitlab.file -> core.agent
core.agent -> gitlab.mr
core.agent -> output.report
core.agent -> output.table
```

### 配色规则

- 容器层用浅色背景区分，不设边框色
- 核心节点用深绿 `#4A7C59` 突出
- API 层用常规矩形
- 输出层用 `shape: document` 文档形状