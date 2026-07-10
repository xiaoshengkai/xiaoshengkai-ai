# Mermaid 状态图示例

```
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#E8EAF6',
  'primaryTextColor': '#283593',
  'primaryBorderColor': '#5C6BC0',
  'lineColor': '#37474F',
  'fontSize': '14px'
}}}%%
stateDiagram-v2
    direction LR

    [*] --> 待扫描 : 读取 projects.json

    state 待扫描 {
        [*] --> 排队中
        排队中 --> 扫描中 : 开始处理项目
    }

    待扫描 --> 扫描中 : 遍历文件树

    state 扫描中 {
        [*] --> 遍历仓库
        遍历仓库 --> 筛选文件 : .jsx .tsx .js .ts
        筛选文件 --> 多线程匹配 : ThreadPoolExecutor
        多线程匹配 --> 汇总结果 : 10 workers 并发
    }

    扫描中 --> 干净 : 未匹配到 XSS 模式
    扫描中 --> 发现漏洞 : 匹配成功

    干净 --> [*]

    发现漏洞 --> 判断模式 : 检查 dry_run

    判断模式 --> 仅报告 : dry_run = true
    判断模式 --> 准备修复 : dry_run = false

    仅报告 --> [*]

    state 准备修复 {
        [*] --> 清理旧分支
        清理旧分支 --> 清理旧MR
        清理旧MR --> 创建修复分支
        创建修复分支 --> 获取文件内容
    }

    准备修复 --> 执行修复 : 文件就绪

    state 执行修复 {
        [*] --> 正则匹配
        正则匹配 --> textContent替换 : innerHTML静态
        正则匹配 --> sanitize包裹 : 动态内容
        textContent替换 --> 补充import
        sanitize包裹 --> 补充import
        补充import --> 检查依赖
        检查依赖 --> 添加xss-guard : 依赖缺失
        检查依赖 --> 代码就绪 : 依赖已存在
        添加xss-guard --> 代码就绪
    }

    执行修复 --> 已修复 : 代码变更完成
    执行修复 --> 跳过 : 幂等检测无变更

    跳过 --> [*]

    已修复 --> 提交中

    state 提交中 {
        [*] --> 批量commit
        批量commit --> 创建MR
        创建MR --> 生成报告
    }

    提交中 --> 完成

    完成 --> [*]

    %% ===== 异常路径 =====
    扫描中 --> 失败 : 网络/权限错误
    准备修复 --> 失败 : 分支创建失败
    执行修复 --> 失败 : 修复脚本异常
    提交中 --> 失败 : GitLab API 异常

    失败 --> [*]

    %% ===== 配色 =====
    style 待扫描 fill:#FFF8E1,stroke:#FFB300
    style 扫描中 fill:#E3F2FD,stroke:#1E88E5
    style 发现漏洞 fill:#FFEBEE,stroke:#E53935
    style 判断模式 fill:#F3E5F5,stroke:#8E24AA
    style 干净 fill:#E8F5E9,stroke:#43A047
    style 仅报告 fill:#FFF3E0,stroke:#FB8C00
    style 准备修复 fill:#EDE7F6,stroke:#7E57C2
    style 执行修复 fill:#E0F2F1,stroke:#00897B
    style 已修复 fill:#C8E6C9,stroke:#388E3C
    style 跳过 fill:#ECEFF1,stroke:#90A4AE
    style 提交中 fill:#E8EAF6,stroke:#5C6BC0
    style 完成 fill:#A5D6A7,stroke:#2E7D32
    style 失败 fill:#EF9A9A,stroke:#C62828
```

### 配色规则

| 状态 | 背景色 | 边框色 | 说明 |
|---|---|---|---|
| 待扫描 | `#FFF8E1` 浅黄 | `#FFB300` 暖金 | 初始/等待 |
| 扫描中 | `#E3F2FD` 浅蓝 | `#1E88E5` 蓝 | 检测阶段 |
| 发现漏洞 | `#FFEBEE` 浅红 | `#E53935` 红 | 发现问题 |
| 判断模式 | `#F3E5F5` 浅紫 | `#8E24AA` 紫 | 决策分支 |
| 干净 | `#E8F5E9` 浅绿 | `#43A047` 绿 | 正常退出 |
| 准备修复 | `#EDE7F6` 浅紫 | `#7E57C2` 紫 | 准备阶段 |
| 执行修复 | `#E0F2F1` 浅青 | `#00897B` 青 | 处理阶段 |
| 已修复 | `#C8E6C9` 浅绿 | `#388E3C` 绿 | 修复成功 |
| 提交中 | `#E8EAF6` 浅蓝紫 | `#5C6BC0` 蓝紫 | Git 操作 |
| 完成 | `#A5D6A7` 绿 | `#2E7D32` 深绿 | 终点 |
| 失败 | `#EF9A9A` 浅红 | `#C62828` 红 | 异常路径 |

### 通用规则

- 用 `stateDiagram-v2` 版本
- 复合状态用 `state 状态名 { ... }` 嵌套
- 状态名用中文，`style 状态名 fill:xxx` 配合色
- 初始状态 `[*]`，最终状态 `[*]`
- 异常路径统一用红色系