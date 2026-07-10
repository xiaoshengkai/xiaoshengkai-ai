# Mermaid 象限图示例

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 
  'quadrant1Fill': '#FF8FA3', 
  'quadrant2Fill': '#7ECBA1', 
  'quadrant3Fill': '#7EB8DA', 
  'quadrant4Fill': '#C3AED6', 
  'quadrant1TextFill': '#333333', 
  'quadrant2TextFill': '#333333', 
  'quadrant3TextFill': '#333333', 
  'quadrant4TextFill': '#333333', 
  'quadrantPointFill': '#444444', 
  'quadrantPointTextFill': '#222222', 
  'quadrantXAxisTextFill': '#555555', 
  'quadrantYAxisTextFill': '#555555', 
  'quadrantTitleFill': '#333333' 
}}}%%
quadrantChart
    title XSS 修复项目：业务重要性 vs 修复紧急性
    x-axis "标准流程" --> "高紧急"
    y-axis "支撑服务" --> "核心业务"
    quadrant-1 "高优修复"
    quadrant-2 "排期修复"
    quadrant-3 "常规维护"
    quadrant-4 "需关注"
    "核心+紧急(3个)": [0.80, 0.80]
    "核心+标准(6个)": [0.22, 0.80]
    "支撑+紧急(1个)": [0.80, 0.22]
    "支撑+标准(4个)": [0.22, 0.22]
```

### 配色规则

| 元素 | 色值 | 说明 |
|---|---|---|
| quadrant-1（右上） | `#FF8FA3` 粉 | 高优修复 |
| quadrant-2（右下） | `#7ECBA1` 绿 | 排期修复 |
| quadrant-3（左上） | `#7EB8DA` 蓝 | 常规维护 |
| quadrant-4（左下） | `#C3AED6` 紫 | 需关注 |
| 数据点 | `#444444` 深灰 | 点颜色 |
| 文字 | `#333333` / `#555555` | 标题/坐标轴 |

### 通用规则

- 14 个 `themeVariables` 精细控制颜色
- 数据点标签带数量标注，如 `"核心+紧急(3个)"`
- x和y值在0-1之间
- 坐标轴标签描述维度含义
- 象限名用行动指向（"高优修复"/"排期修复"）