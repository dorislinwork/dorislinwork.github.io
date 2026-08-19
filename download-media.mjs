/* ==========================================================================
   把 Cargo 上的圖片抓到本機
   --------------------------------------------------------------------------
   用法：  node download-media.mjs
          node download-media.mjs --width 2000     指定寬度
          node download-media.mjs --dry            只列出要抓什麼，不真的下載

   抓完之後把 content/site.json 的 media.source 改成 "local"，
   再跑一次 node build.mjs，網站就完全不依賴 Cargo 了。

   ＊這支腳本需要網路。如果在 Claude Code 裡跑不動（環境沒有對外連線），
     請自己開一個 PowerShell 視窗，cd 到這個資料夾再執行。
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(ROOT, 'content/projects.json'), 'utf8'));
const projects = data.projects || data;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const wIdx = args.indexOf('--width');
const WIDTH = wIdx > -1 ? Number(args[wIdx + 1]) : (site.media?.fullWidth || 1600);
const QUALITY = site.media?.quality || 82;
const HOST = 'https://freight.cargo.site';

/* 收集所有要抓的檔案：內頁圖 + 首頁縮圖（縮圖若跟內頁圖同一張就不重複抓） */
const jobs = [];
const seen = new Set();

const add = (m, slug, width) => {
  if (!m || !m.hash || !m.file) return;
  const key = `${slug}/${m.file}`;
  if (seen.has(key)) return;
  seen.add(key);
  jobs.push({
    slug,
    file: m.file,
    url: `${HOST}/w/${width}/q/${QUALITY}/i/${m.hash}/${encodeURIComponent(m.file)}`,
    dest: join(ROOT, 'assets/media', slug, m.file),
  });
};

for (const p of projects) {
  for (const b of p.blocks || []) if (b.type === 'media') add(b, p.slug, WIDTH);
  add(p.thumb, p.slug, WIDTH);
}

console.log(`共 ${jobs.length} 個檔案，寬度 ${WIDTH}px、品質 ${QUALITY}`);

const already = jobs.filter((j) => existsSync(j.dest));
const todo = jobs.filter((j) => !existsSync(j.dest));
if (already.length) console.log(`已存在 ${already.length} 個，跳過`);
console.log(`要下載 ${todo.length} 個\n`);

if (DRY) {
  todo.slice(0, 20).forEach((j) => console.log(`  ${j.slug}/${j.file}`));
  if (todo.length > 20) console.log(`  …還有 ${todo.length - 20} 個`);
  process.exit(0);
}

/* 下載，失敗重試兩次 */
let ok = 0, failed = [];
let bytes = 0;

for (let i = 0; i < todo.length; i++) {
  const j = todo[i];
  let lastErr = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(j.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(j.dest), { recursive: true });
      writeFileSync(j.dest, buf);
      bytes += buf.length;
      ok++;
      const kb = (buf.length / 1024).toFixed(0);
      console.log(`  ✓ ${String(i + 1).padStart(3)}/${todo.length}  ${j.slug}/${j.file}  (${kb} KB)`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }

  if (lastErr) {
    console.warn(`  ✗ ${j.slug}/${j.file} → ${lastErr.message}`);
    failed.push(j);
  }
}

console.log(`\n完成 ${ok}/${todo.length}，共 ${(bytes / 1024 / 1024).toFixed(1)} MB`);

if (failed.length) {
  console.log(`\n失敗 ${failed.length} 個，再跑一次會只重試這些：`);
  failed.slice(0, 10).forEach((j) => console.log(`  ${j.slug}/${j.file}`));
} else if (ok > 0) {
  console.log('\n下一步：把 content/site.json 的 media.source 改成 "local"，再跑 node build.mjs');
}

/* 統計目前 assets/media 的總大小，方便判斷會不會撞到 GitHub Pages 的限制 */
try {
  let total = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else total += statSync(p).size;
    }
  };
  const mediaDir = join(ROOT, 'assets/media');
  if (existsSync(mediaDir)) {
    walk(mediaDir);
    console.log(`assets/media 目前總大小：${(total / 1024 / 1024).toFixed(1)} MB`);
  }
} catch (e) { /* 統計失敗不影響下載結果 */ }
