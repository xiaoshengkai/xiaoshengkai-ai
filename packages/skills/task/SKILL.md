---
name: task
description: 创建或修改定时任务。当用户说"创建定时任务""帮我加个定时任务""每天X点帮我做Y"时使用。
---

# 定时任务创建

## 目录结构约定

每个定时任务是一个独立目录，放在 `packages/tasks/<task-name>/` 下：

```
packages/tasks/<task-name>/
├── task.json          # 任务元信息
└── index.js           # 入口：export async function run()
```

## task.json 字段

```json
{
  "name": "任务名称（英文标识）",
  "html": "report.html"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| name | 是 | 英文标识，用于日志文件名，不可改 |
| html | 否 | 任务产出的静态 HTML 文件名，存在于任务目录下，不可改 |

`task.json` 是身份证，建了基本不改。

## 运行态配置（data/tasks/<name>.json）

```json
{
  "description": "任务描述",
  "cron": "30 9 * * *",
  "enabled": true,
  "until": null,
  "lastRun": null,
  "lastStatus": null,
  "lastError": null
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| description | 否 | 任务描述，可随时修改 |
| cron | 是 | cron 表达式，可随时修改 |
| enabled | 是 | 是否启用，可随时修改 |
| until | 否 | 结束日期（yyyy-MM-dd），超过后自动跳过 |
| lastRun | 否 | 上次运行时间（scheduler 自动填写） |
| lastStatus | 否 | 上次运行状态（scheduler 自动填写） |
| lastError | 否 | 上次错误信息（scheduler 自动填写） |

`data/tasks/<name>.json` 是运行态，全部字段可随时修改，状态由 scheduler 自动更新。

## index.js 合约

```js
import { fileURLToPath } from "node:url";

export async function run() {
  // 任务业务逻辑
  // scheduler 会自动 try/catch + 写日志
}

// 子进程调用时自动执行（API 手动触发 / 直接 node 运行）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
```

- scheduler 定时触发：`import()` → `m.run()`，不会触发底部自执行
- API 手动触发 / 终端直接运行：`child_process.execFile('node', [entryPath])`，`process.argv[1]` 匹配后自动执行

## 静态页面

如果任务需要产出 HTML 页面（报告、图表、状态页等），规范如下：

- 必须是原生 HTML/CSS/JS（允许 CDN 引用，如 Chart.js、ECharts）
- 禁止使用 React/Vue/构建工具
- 文件名在 `task.json` 的 `html` 字段声明
- 页面在 `/schedule` 页面中可点击打开
- **视觉风格必须跟随项目主体样式**：先读项目根目录 `DESIGN.md`，照它的配色、边框、阴影、圆角、字体规范来写，不要自行设计风格

## 创建步骤

1. 在 `packages/tasks/` 下创建任务目录
2. 创建 `task.json`（name，可选 html）
3. 创建 `data/tasks/<name>.json`（description + cron + enabled，可选 until）
4. 创建 `index.js` 实现 `export async function run()` + 自执行入口
5. 如有 HTML 页面，创建原生 HTML 文件
6. 告知用户重启 scheduler（`npm run tasks:start`）

## 日志

任务执行日志自动写入 `logs/tasks/tasks-YYYY-MM-DD.log`，无需任务自己处理。

## 示例

参考 `packages/tasks/tasks/precious-metals/`。