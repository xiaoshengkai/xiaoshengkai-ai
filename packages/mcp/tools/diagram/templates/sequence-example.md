# Mermaid 时序图示例

```
sequenceDiagram
    autonumber
    participant U as 开发者
    participant CLI as batch_fix.py
    participant API as GitLab API
    participant Fix as 修复引擎
    participant Git as Git操作

    U->>CLI: 执行 python batch_fix.py
    CLI->>CLI: 读取 projects.json

    loop 每个项目
        CLI->>API: 获取文件树
        API-->>CLI: 返回文件列表
        CLI->>CLI: 筛选前端文件(.jsx/.tsx/.js/.ts)
        CLI->>API: 获取文件内容
        API-->>CLI: 返回文件内容
        CLI->>CLI: 正则匹配 XSS 特征

        alt 发现漏洞
            CLI->>API: 清理旧分支和 MR
            API-->>CLI: 清理完成
            CLI->>API: 创建 fix/xss-all 分支
            API-->>CLI: 分支创建成功
            CLI->>Fix: 调用 xss_fix.js 修复代码
            activate Fix
            Fix->>Fix: Babel AST 解析
            Fix->>Fix: 应用修复规则
            Fix->>Fix: 补充 sanitize import
            Fix-->>CLI: 返回修复后代码
            deactivate Fix
            CLI->>API: 批量提交修复文件
            API-->>CLI: 提交成功
            CLI->>API: 创建 Merge Request
            API-->>CLI: MR 创建成功
        else 无漏洞
            CLI->>CLI: 跳过该项目
        end
    end

    CLI->>CLI: 生成控制台表格
    CLI->>CLI: 输出 Markdown 报告
    CLI-->>U: 完成

    %%{init: {'theme':'base', 'themeVariables': {'primaryColor':'#f9f','primaryTextColor':'#333','lineColor':'#333','actorBkg':'#ccf','actorBorder':'#333','signalColor':'#333','signalTextColor':'#333','labelBoxBkgColor':'#ccf','labelBoxBorderColor':'#333','noteBkgColor':'#fff','noteBorderColor':'#333'}}}%%
```

### 配色规则

- 主题: `base`，自定义 `themeVariables`
- 参与者背景: `#ccf`（柔和紫）
- 连线色: `#333`（深灰）
- 激活框: 默认与参与者同色
- 备注框: 白底黑边