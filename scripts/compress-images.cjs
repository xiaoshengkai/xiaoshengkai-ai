const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..', 'site');

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else {
      const ext = path.extname(entry).toLowerCase();
      if (['.png', '.jpg', '.jpeg'].includes(ext)) results.push(full);
    }
  }
  return results;
}

async function compress(imgPath) {
  const ext = path.extname(imgPath).toLowerCase();
  const isJpg = ['.jpg', '.jpeg'].includes(ext);
  const maxWidth = isJpg ? 1920 : 1200;
  const quality = isJpg ? 80 : 85;
  const tmpFile = imgPath + '.tmp';
  const before = fs.statSync(imgPath).size;

  const pipeline = sharp(imgPath)
    .rotate()
    .resize(maxWidth, maxWidth, { fit: 'inside', withoutEnlargement: true });

  const outExt = isJpg ? ext : '.jpg';
  const outPath = imgPath.replace(ext, outExt);

  await pipeline.jpeg({ quality }).toFile(tmpFile);
  const after = fs.statSync(tmpFile).size;

  // 如果压缩后更大，保持原文件
  if (after >= before) {
    fs.unlinkSync(tmpFile);
    console.log(`${path.basename(imgPath)}: ${(before/1024).toFixed(0)}KB → 跳过(已最优)`);
    return;
  }

  fs.renameSync(tmpFile, outPath);
  if (!isJpg) fs.unlinkSync(imgPath);

  console.log(`${path.basename(imgPath)}: ${(before/1024).toFixed(0)}KB → ${(after/1024).toFixed(0)}KB ${outExt}`);
}

async function main() {
  const images = walk(SITE_DIR);
  console.log(`找到 ${images.length} 张图片\n`);

  for (const img of images) {
    await compress(img);
  }

  // 更新 HTML 中 .png → .jpg
  console.log('\n更新 HTML 引用...');
  const htmlFiles = walk(SITE_DIR).filter(f => f.endsWith('.html'));
  let updated = 0;
  for (const html of htmlFiles) {
    let content = fs.readFileSync(html, 'utf-8');
    const before = content;
    content = content.replace(/\.png/g, '.jpg');
    if (content !== before) {
      fs.writeFileSync(html, content);
      updated++;
    }
  }
  console.log(`已更新 ${updated} 个 HTML 文件`);
}

main().catch(console.error);