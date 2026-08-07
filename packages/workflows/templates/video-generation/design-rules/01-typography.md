# 字体规范

## 字体层级（5 级）

| 角色 | 字号 | 行高 | 字重 | 字体 | 用途 |
|------|------|------|------|------|------|
| Display | 80-100px | 1.0 | 900 | Alfa Slab One / Archivo 900 | Hook 大字标题（1-3 字） |
| H1 | 60-80px | 1.1 | 900 | Archivo 900 / Lora italic 700 | 场景标题（3-5 字） |
| H2 | 48-64px | 1.15 | 700 | Archivo 700 / Be Vietnam Pro 700 | 副标题（5-8 字） |
| Body | 28-36px | 1.4 | 400 | Be Vietnam Pro 400 / Inter 400 | 正文（8-15 字） |
| Caption | 22-26px | 1.3 | 400 | Space Mono 400 / Inter 400 | 标签/注释/日期 |

## 字重限制

- 最多 2 种字重在一个场景中：900 + 400（"黑/白"对比）
- 700 用于副标题，属于"灰"区，可用但不超过 1 处
- 500 很少用，仅当需要"微强调"时
- font-family 只写字体名（如 'Archivo'），font-weight 单独写
- ❌ 禁止：font-family:'Archivo 900' 或 font-family:'Be Vietnam Pro 400'

## 中英混排

- 中文用 Noto Sans SC
- 英文标题用 Archivo / Alfa Slab One / Lora
- 英文正文用 Be Vietnam Pro / Inter
- 中英混排时：英文用标题字体，中文用 Noto Sans SC
- 兜底：'Noto Sans SC', sans-serif

## 字间距

- 标题（Display/H1）：0px（默认）
- 副标题（H2）：0-1px
- 正文（Body）：0px
- 标签（Caption）：letter-spacing 2-4px（等宽字体）

## 行高

- Display：1.0（紧凑，大字不需要行高）
- H1：1.1
- H2：1.15
- Body：1.4（远观可读）
- Caption：1.3

## 可用字体库

- **Noto Sans SC** (400/500/700/900) — 中文正文
- **Archivo** (500/700/900) — 标题（粗体无衬线）
- **Alfa Slab One** (400) — 装饰标题（衬线感）
- **Be Vietnam Pro** (500/600/700/800/900 + italic) — 正文（多字重几何 sans）
- **Inter** (200/300/400/500/700/800/900) — 正文（标准无衬线）
- **Inter Tight** (400/500/700/800/900) — 紧凑标题
- **Lora** (400/500/600/700 italic) — 衬线斜体（杂志感）
- **Space Mono** (400/700) — 等宽（代码/标签）
- font-family 必须从以上字体中选取，统合追加 'Noto Sans SC', sans-serif 兜底