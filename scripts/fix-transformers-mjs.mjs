/**
 * postinstall 修复：@huggingface/transformers 缺少 .mjs 文件
 *
 * 已知 npm 包 bug（3.5.1 和 3.8.1 版本）：
 * package.json exports 声明了 .mjs 入口，但 dist/ 只包含 .cjs 文件
 * 导致 Next.js prod build 和 chroma-core 加载失败
 *
 * 修复方式：创建 .mjs 包装器，从 .cjs 重新导出
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transformersDir = path.resolve(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'dist');

if (!fs.existsSync(transformersDir)) {
  console.log('[postinstall] @huggingface/transformers not found, skipping');
  process.exit(0);
}

const files = [
  { cjs: 'transformers.node.cjs', mjs: 'transformers.node.mjs' },
  { cjs: 'transformers.node.min.cjs', mjs: 'transformers.node.min.mjs' },
];

let fixed = 0;
for (const { cjs, mjs } of files) {
  const cjsPath = path.join(transformersDir, cjs);
  const mjsPath = path.join(transformersDir, mjs);

  if (!fs.existsSync(cjsPath)) continue;

  // 只创建不存在或比 .cjs 旧的 .mjs
  const cjsStat = fs.statSync(cjsPath);
  if (fs.existsSync(mjsPath)) {
    const mjsStat = fs.statSync(mjsPath);
    if (mjsStat.mtimeMs >= cjsStat.mtimeMs) continue;
  }

  const wrapper = `import transformers from './${cjs}';\n` +
    `export const { pipeline, env, AutoTokenizer, AutoModel, AutoProcessor, RawImage } = transformers;\n` +
    `export default transformers;\n`;

  fs.writeFileSync(mjsPath, wrapper);
  console.log(`[postinstall] created ${mjs}`);
  fixed++;
}

if (fixed > 0) {
  console.log(`[postinstall] fixed ${fixed} @huggingface/transformers .mjs file(s)`);
}