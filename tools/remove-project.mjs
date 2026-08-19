/* ==========================================================================
   移除一個作品
   --------------------------------------------------------------------------
   用法：  node tools/remove-project.mjs <slug>
          node tools/remove-project.mjs <slug> --keep-media   只從清單移除，媒體留著
          node tools/remove-project.mjs <slug> --dry          只顯示會刪什麼

   會做三件事：
     1. 從 content/projects.json 移除那一筆
     2. 刪掉 assets/media/<slug>/ 整個資料夾
     3. 刪掉 work/<slug>.html（下次 build 也會自動清，這裡先刪乾淨）

   incoming/<slug>/ 的原始檔不會動，那是你的備份。

   只是想暫時下架的話不要用這支，改在 projects.json 那一筆加 "draft": true
   就好，資料會留著。
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const DRY = argv.includes('--dry');
const KEEP_MEDIA = argv.includes('--keep-media');

if (!slug) {
  console.error('用法：node tools/remove-project.mjs <slug> [--keep-media] [--dry]');
  process.exit(1);
}

const jsonPath = join(ROOT, 'content/projects.json');
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const idx = data.projects.findIndex((p) => p.slug === slug);

if (idx === -1) {
  console.error(`content/projects.json 裡沒有 slug 為「${slug}」的作品。`);
  console.error('目前有的 slug：');
  data.projects.forEach((p) => console.error('  ' + p.slug));
  process.exit(1);
}

const entry = data.projects[idx];
const mediaDir = join(ROOT, 'assets/media', slug);
const pagePath = join(ROOT, 'work', `${slug}.html`);

/* 統計要刪掉的媒體 */
let mediaFiles = [];
let mediaBytes = 0;
if (existsSync(mediaDir)) {
  mediaFiles = readdirSync(mediaDir);
  for (const f of mediaFiles) {
    try { mediaBytes += statSync(join(mediaDir, f)).size; } catch (e) { /* 忽略 */ }
  }
}

console.log(`作品：${entry.title}（${slug}）`);
console.log(`  blocks    ${(entry.blocks || []).length} 個`);
console.log(`  媒體      ${mediaFiles.length} 個檔案，${(mediaBytes / 1048576).toFixed(1)} MB`
  + (KEEP_MEDIA ? '（--keep-media，保留）' : ''));
console.log(`  頁面      ${existsSync(pagePath) ? 'work/' + slug + '.html' : '（尚未產生）'}`);

/* 有沒有其他頁面還連到它 */
const referrers = [];
const workDir = join(ROOT, 'work');
if (existsSync(workDir)) {
  for (const f of readdirSync(workDir)) {
    if (!f.endsWith('.html') || f === `${slug}.html`) continue;
    const html = readFileSync(join(workDir, f), 'utf8');
    if (html.includes(`${slug}.html`)) referrers.push(`work/${f}`);
  }
}
if (referrers.length) {
  console.log(`  被連結    ${referrers.join(', ')}`);
  console.log(`            （build 會重算「下一個專案」的連結，不用手動改）`);
}

if (DRY) {
  console.log('\n（--dry，沒有刪除任何東西）');
  process.exit(0);
}

/* 動手刪 */
data.projects.splice(idx, 1);
writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
try {
  JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('寫出的 JSON 壞了，請用 git checkout content/projects.json 還原');
  process.exit(1);
}

if (!KEEP_MEDIA && existsSync(mediaDir)) rmSync(mediaDir, { recursive: true, force: true });
if (existsSync(pagePath)) rmSync(pagePath, { force: true });

console.log(`\n已移除。剩下 ${data.projects.length} 個作品。`);
if (existsSync(join(ROOT, 'incoming', slug))) {
  console.log(`incoming/${slug}/ 的原始檔沒有動，要的話自己刪。`);
}
console.log('\n下一步：node build.mjs（或 publish.cmd "移除作品 XXX"）');
