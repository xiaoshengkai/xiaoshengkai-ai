# Mermaid 类图示例

```
%%{init: {'theme': 'base', 'themeVariables': {
  'primaryColor': '#E8EAF6',
  'primaryTextColor': '#283593',
  'primaryBorderColor': '#5C6BC0',
  'lineColor': '#546E7A',
  'fontSize': '14px'
}}}%%
classDiagram
    direction TB

    class ProjectConfig {
        +String name
        +String repo
        +String owner
        +String base_branch
        +String new_branch
    }

    class GitLabClient {
        -String token
        -String base_url
        -Dict~String,String~ headers
        +get_file(path, ref) String
        +update_file(path, content, branch, msg) bool
        +create_branch(branch, base_ref) bool
        +delete_branch(branch) bool
        +create_mr(source, target, title) String
        +close_mr(iid) bool
        +get_project_id(path) int
    }

    class GitAgent {
        -GitLabClient client
        +modify_file(path, branch, base, fix_func) Dict
        -_needs_sanitize(content) bool
        -_ensure_xss_guard_dep(branch, base) void
    }

    class BatchFixer {
        -List~ProjectConfig~ projects
        -bool dry_run
        -String xss_guard_version
        +process_project(ProjectConfig) Dict
        +fix_content(String) String
        +commit_all_at_once(id, branch, List~File~) bool
        +scan_xss_in_project(id, branch) List~String~
        +run() List~Dict~
        -cleanup_existing(id, branch) void
        -create_branch(id, branch, base) void
    }

    class BatchScanner {
        +scan_only() List~Dict~
        +run() void
    }

    class XSSFixer {
        << Node.js >>
        +fix(String) String
        -matchPatterns(content) String[]
        -replaceDangerously(String) String
        -replaceInnerHTML(String) String
        -replaceInsertHTML(String) String
        -ensureImport(String) String
    }

    class FixResult {
        << dataclass >>
        +String status
        +int fixed_count
        +int vulnerable_count
        +String mr_url
        +List~String~ vulnerable_files
    }

    %% ===== 关系 =====

    GitAgent *-- GitLabClient : "组合\n持有实例"
    BatchFixer o-- GitAgent : "聚合\n按需创建"
    BatchFixer --> ProjectConfig : "依赖"
    BatchFixer --> FixResult : "返回"
    BatchScanner --|> BatchFixer : "继承\n复用扫描能力"
    GitAgent ..> XSSFixer : "调用\nsubprocess"
    BatchFixer ..> XSSFixer : "调用\nsubprocess"

    %% ===== 配色 =====

    style ProjectConfig fill:#FFF8E1,stroke:#FFB300,stroke-width:2px,color:#E65100
    style GitLabClient fill:#E3F2FD,stroke:#1E88E5,stroke-width:2px,color:#0D47A1
    style GitAgent fill:#EDE7F6,stroke:#7E57C2,stroke-width:2px,color:#311B92
    style BatchFixer fill:#E8F5E9,stroke:#43A047,stroke-width:2px,color:#1B5E20
    style BatchScanner fill:#E0F2F1,stroke:#00897B,stroke-width:2px,color:#004D40
    style XSSFixer fill:#FFF3E0,stroke:#FB8C00,stroke-width:2px,color:#E65100
    style FixResult fill:#FCE4EC,stroke:#EC407A,stroke-width:2px,color:#880E4F
```

### 配色规则

| 类 | 背景色 | 边框色 | 说明 |
|---|---|---|---|
| 配置类 | `#FFF8E1` 浅黄 | `#FFB300` 暖金 | 配置/数据对象 |
| API 客户端 | `#E3F2FD` 浅蓝 | `#1E88E5` 蓝 | 外部通信 |
| 核心代理 | `#EDE7F6` 浅紫 | `#7E57C2` 紫 | 核心业务 |
| 修复器 | `#E8F5E9` 浅绿 | `#43A047` 绿 | 处理/修复 |
| 扫描器 | `#E0F2F1` 浅青 | `#00897B` 青 | 检测/扫描 |
| 外部引擎 | `#FFF3E0` 浅橙 | `#FB8C00` 橙 | 外部依赖 |
| 结果类 | `#FCE4EC` 浅粉 | `#EC407A` 粉 | 返回/输出 |

### 通用规则

- 每个类用不同颜色区分，形成视觉层次
- 浅色背景 + 深色文字 + 深色边框（`stroke-width:2px`）
- 关系线加标签说明（如"组合\n持有实例"）
- 全局配置用 `%%{init: {...}}%%` 统一字体和线条颜色