# tech-video

script.json 驱动的逐场景视频生成管线，基于 11 套 HyperFrames 模板。

## 架构

```
7 步管线:
script → validate → tts-scenes → bgm → sfx-pick → render → concat

分组:
准备: script + validate
素材: tts-scenes + bgm + sfx-pick
渲染: render
合成: concat
```

## 核心设计

- **AI/代码分离**：LLM 生成 script.json（内容），代码确定性渲染（生产）
- **逐场景渲染**：每场景独立 TTS → 独立 MP4 → ffmpeg 拼接
- **幂等缓存**：所有产物基于文件存在性缓存，改 script 后手动删文件重跑
- **单场景失败不阻断**：render 某场景失败，其他继续

## 模板

11 套 HyperFrames 模板，位于 `lib/templates/`：

| 模板 | 类型 | 说明 |
|------|------|------|
| frame-liquid-bg-hero | hook | 极光液动背景 + 渐变标题 |
| frame-bold-poster | body | 1970s 海报风格 |
| frame-vignelli | body | 暗色 + 红色大字 |
| frame-pentagram-stat | body | 霓虹数据统计 |
| frame-build-minimal | body | 一字一字揭示 |
| frame-creative-voltage | body | 电光蓝创意 |
| frame-glitch-title | body | 赛博朋克标题 |
| frame-aicoding-list | body | 列表展示 |
| frame-aicoding-comparison | body | 对比展示 |
| frame-logo-outro | outro | 品牌结尾 |
| frame-statement-outro | outro | 声明结尾 |

详见 `lib/templates/catalog.json`。

## 缓存策略

所有产物按文件存在性缓存（`existsSync()`）。重跑时：
- TTS 文件存在 → 跳过
- 渲染 clip 存在 → 跳过
- 删除文件 → 强制重跑

## SFX 音效

SFX 库不受 git 版本管理（参考越南项目做法）。目录已建好，mp3 文件需手动下载。

3 层语义匹配（中文关键词）：
1. 显式指定（script.json 里 `scene.sfx.name`）
2. 语义匹配（从 narration 中识别关键词）
3. 模板默认（按场景类型兜底）

首次使用需运行 SFX 下载器：
```bash
node packages/workflows/templates/tech-video/lib/sfx-downloader.js
```

下载完成后 `lib/sfx/{transition,emphasis,...}/` 下会有 mp3 文件。没有 SFX 不影响 pipeline 运行，只是视频没有音效。

## 字幕

- 硬字幕：烧录进视频画面（底部居中，白色 + 黑色描边）
- 软字幕：同时输出 video.srt

## 测试

```bash
npm run test:video-v2
```

## 独立原则

v2 自包含，不 import 老 video-generation 的任何代码。不依赖其他 workflow template。