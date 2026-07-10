# Mermaid ER 图示例

```mermaid
erDiagram
    PROJECT {
        int id PK
        varchar name
        varchar repo_url
        varchar owner
        varchar base_branch
        varchar default_new_branch
    }
    SCAN_TASK {
        int id PK
        int project_id FK
        varchar scan_mode
        varchar status
        int total_files
        int vuln_count
        datetime started_at
        datetime finished_at
    }
    VULNERABILITY {
        int id PK
        int project_id FK
        int scan_task_id FK
        varchar file_path
        varchar pattern_type
        int line_number
        text raw_code
        varchar status
    }
    FIX_STRATEGY {
        int id PK
        varchar pattern_type
        int priority
        varchar replacement
        boolean import_required
    }
    FIX_RECORD {
        int id PK
        int vulnerability_id FK
        int strategy_id FK
        text fixed_code
        boolean needs_import
        boolean import_added
        varchar result
    }
    BRANCH {
        int id PK
        int project_id FK
        varchar name
        varchar base_branch
        varchar status
    }
    MERGE_REQUEST {
        int id PK
        int branch_id FK
        int project_id FK
        varchar title
        varchar web_url
        varchar state
        int files_changed
    }
    DEPENDENCY {
        int id PK
        int project_id FK
        int fix_record_id FK
        varchar package_name
        varchar version
        boolean was_added
    }
    REPORT {
        int id PK
        int project_id FK
        int scan_task_id FK
        varchar path
        varchar format
        int total_vuln
        int total_fixed
        datetime generated_at
    }

    PROJECT ||--o{ SCAN_TASK : "发起扫描"
    PROJECT ||--o{ VULNERABILITY : "扫描发现"
    SCAN_TASK ||--o{ VULNERABILITY : "包含漏洞"
    VULNERABILITY ||--|| FIX_RECORD : "生成修复"
    FIX_STRATEGY ||--o{ FIX_RECORD : "匹配策略"
    PROJECT ||--o{ BRANCH : "创建分支"
    BRANCH ||--|| MERGE_REQUEST : "发起MR"
    PROJECT ||--o{ MERGE_REQUEST : "项目MR"
    PROJECT ||--o{ DEPENDENCY : "依赖变更"
    FIX_RECORD ||--|| DEPENDENCY : "触发变更"
    PROJECT ||--o{ REPORT : "生成报告"
    SCAN_TASK ||--|| REPORT : "产出报告"
```

### 关系语法

| 符号 | 含义 |
|---|---|
| `||--o{` | 一对零或多 |
| `}|--||` | 一或多对一 |
| `||--||` | 一对一 |
| `}o--o{` | 零或多对零或多 |

### 通用规则

- 实体名用英文大写，属性名 snake_case
- 属性格式: `类型 属性名 KEY`（类型: int varchar text boolean datetime）
- 约束: PK(主键) FK(外键) UK(唯一)
- 关系线用双引号标注含义
- 实体间用 `--` 实线连接