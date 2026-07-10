# Mermaid 流程图示例

```
graph TD
    S([开始]) --> C{选择修复模式}

    C -->|单项目| Single[单项目修复<br/>python entry.py]
    C -->|批量| Batch[批量修复<br/>python batch_fix.py<br/>读取 projects.json]

    Single --> Scan
    Batch --> Scan

    Scan[扫描阶段<br/>1. GitLab API 获取文件树<br/>2. 筛选前端文件<br/>3. 正则匹配 XSS 特征] --> HasVuln{发现漏洞?}

    HasVuln -->|无漏洞| Output
    HasVuln -->|有漏洞| DryRun{是否为<br/>dry-run?}
    DryRun -->|是| Output
    DryRun -->|否| Fix

    subgraph FixPhase [修复策略]
        direction TB
        P1[优先级: textContent > sanitize > DOM API] --> P2[dangerouslySetInnerHTML<br/>转 sanitize]
        P2 --> P3[innerHTML 静态文本<br/>转 textContent]
        P3 --> P4[innerHTML 动态变量<br/>转 sanitize]
        P4 --> P5[insertAdjacentHTML<br/>转 sanitize]
        P5 --> P6[Node.js AST<br/>自动修复代码]
    end

    Fix --> FixPhase

    P6 --> GitPhase

    subgraph GitPhase [Git 自动化]
        direction TB
        G1[清理已有分支和 MR] --> G2[创建分支 fix/xss-all]
        G2 --> G3[一次性提交所有修复文件]
        G3 --> G4[更新 package.json<br/>添加 @zcy/xss-guard]
        G4 --> G5[创建 Merge Request]
    end

    GitPhase --> Output

    Output[输出结果<br/>1. 控制台输出表格<br/>2. 自动生成 Markdown 报告<br/>3. 支持 dry-run 模式] --> E([结束])

    style S fill:#4B5563,stroke:#333,stroke-width:2px,color:#fff
    style E fill:#4B5563,stroke:#333,stroke-width:2px,color:#fff
    style C fill:#2B4C7E,stroke:#333,stroke-width:2px,color:#fff
    style Single fill:#2B4C7E,stroke:#333,stroke-width:2px,color:#fff
    style Batch fill:#2B4C7E,stroke:#333,stroke-width:2px,color:#fff
    style Scan fill:#D38A4A,stroke:#333,stroke-width:2px,color:#fff
    style HasVuln fill:#D38A4A,stroke:#333,stroke-width:2px,color:#fff
    style DryRun fill:#D38A4A,stroke:#333,stroke-width:2px,color:#fff
    style Fix fill:#4A7C59,stroke:#333,stroke-width:2px,color:#fff
    style P1 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style P2 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style P3 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style P4 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style P5 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style P6 fill:#4A7C59,stroke:#333,stroke-width:2px,color:#fff
    style G1 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style G2 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style G3 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style G4 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style G5 fill:#374151,stroke:#333,stroke-width:2px,color:#fff
    style Output fill:#A84848,stroke:#333,stroke-width:2px,color:#fff
```

### 配色规则

| 节点类型 | 色值 | 适用场景 |
|---|---|---|
| 起点/终点 | `#4B5563`（石板灰） | 开始/结束节点 |
| 决策/入口 | `#2B4C7E`（深蓝） | 菱形决策、模式选择 |
| 通用步骤 | `#374151`（深灰） | 普通流程节点 |
| 技术/修复 | `#4A7C59`（深绿） | 技术处理、修复引擎 |
| 异常/警告 | `#A84848`（暗红） | 错误、异常路径 |
| 扫描/检测 | `#D38A4A`（暖橙） | 扫描、检测阶段 |

### 通用规则

- 深色底统一配白色文字 `color:#fff`
- 边框统一 `stroke:#333,stroke-width:2px`
- 标签用 `\n` 换行，单行 ≤15 字
- 子流程用 `subgraph` 包裹
- 每层 4-6 个节点，避免过度拥挤