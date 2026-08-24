# ai-chat

小盛开AI 主应用（Next.js 16，组合根）：流式对话 + RAG 检索 + 多模态 + 设置系统。对 workflows/tasks 只保留 catch-all 挂载点，能力逻辑在各自包内。

- 设计规范（UI 风格 / API 约定 / 环境变量 / 部署）：[DESIGN.md](../../DESIGN.md)
- 代码结构（lib/ 子系统划分、能力注册）：[ARCHITECTURE.md](../../ARCHITECTURE.md)

## 本地开发

```bash
npm install                # 根目录统一安装
uv tool install chromadb   # 一次性（Chroma 向量库）
cp ../../.env.example ../../.env   # 填 API Key
npm run dev                # http://localhost:3000
```

## 包内脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` / `build` / `lint` | 开发 / 生产构建 / ESLint |
| `npx tsx scripts/generate-embeddings.ts --reset` | 知识库迁移（JSON → Chroma，一次性） |
| `npx tsx scripts/verify-migration.ts` | 迁移一致性校验 |
