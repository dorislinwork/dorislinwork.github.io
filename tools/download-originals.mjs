/* ==========================================================================
   把 Cargo 上的原始高解析檔全部抓下來備份
   --------------------------------------------------------------------------
   用法：  node tools/download-originals.mjs "D:\website\cargo-originals"
          node tools/download-originals.mjs <資料夾> --dry     只列清單不下載

   為什麼需要這支：
   assets/media/ 裡的是**上線用的壓縮版**（縮到 1600px、轉成 WebP／MP4，共 14MB）。
   原始檔還在 Cargo 上，合計約 326MB。哪天要重新輸出、印刷、或改尺寸就需要原檔。

   ⚠ 輸出目錄請放在 repo 外面。放進 portfolio/ 會被 git 追蹤、推上 GitHub，
   而且 GitHub Pages 會把它們公開，repo 也會從 14MB 變成 340MB。

   原始檔的網址是 freight.cargo.site/t/original/i/<hash>/<檔名>，hash 存在
   projects.json 每個 media 區塊裡（當初刻意保留的，就是為了這種情況）。

   可以重複執行：已經下載且大小相符的檔案會跳過，所以中斷了再跑一次就好。
   ========================================================================== */

import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './lib-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const OUT = argv.find((a) => !a.startsWith('--'));
const DRY = argv.includes('--dry');
const CONCURRENCY = 4;

if (!OUT) {
  console.error('用法：node tools/download-originals.mjs <輸出資料夾> [--dry]');
  console.error('例如：node tools/download-originals.mjs "D:\\website\\cargo-originals"');
  process.exit(1);
}
if (OUT.replace(/\\/g, '/').startsWith(ROOT.replace(/\\/g, '/'))) {
  console.error('輸出目錄不能在 repo 裡面 —— 會被 git 追蹤並公開到 GitHub Pages。');
  console.error('請改成 repo 外面的路徑，例如 D:\\website\\cargo-originals');
  process.exit(1);
}

const UA = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  referer: 'https://doris-lin.com/',
};

/* ------------------------------------------------------------- 清單 ---- */

/* 一個檔案可能同時是縮圖與內文圖，用 hash+檔名去重。
   同一個 hash 也可能被多件作品用到（例如 Grandma-s-kitchen 與它的 copy），
   那種情況下放在第一件作品的資料夾，並在清單裡記下其他引用者。

   ⚠ 存檔用的檔名要用 localFile（有填的話），不能用 file。同一件作品裡可能有
   不同的圖共用同一個檔名（Cargo 用 hash 定址所以允許），兩個並行下載寫到同一個
   路徑會互相踩：一個把 .part 改名走、另一個 stat 不到就失敗。2026-08-21 第一次
   跑就撞到，Dancing-Christmas-Tree 的三張 _00000.png 只存下一張。 */
const data = readJson(join(ROOT, 'content/projects.json'));
const items = new Map();

const add = (m, slug, role) => {
  if (!m || !m.hash || !m.file) return;
  const key = m.hash + '|' + m.file;
  if (items.has(key)) {
    const it = items.get(key);
    if (!it.usedBy.includes(slug)) it.usedBy.push(slug);
    return;
  }
  items.set(key, {
    hash: m.hash,
    file: m.file,                    // Cargo 網址要用的原始檔名，不能動
    saveAs: m.localFile || m.file,   // 存到硬碟用的名字
    slug,
    role,
    w: m.w || null, h: m.h || null, usedBy: [slug],
  });
};

for (const p of data.projects) {
  add(p.thumb, p.slug, 'thumb');
  for (const b of (p.blocks || [])) if (b.type === 'media') add(b, p.slug, 'block');
}

const list = [...items.values()];
console.log(`要下載 ${list.length} 個原始檔`);
console.log(`輸出到 ${OUT}\n`);

/* --------------------------------------------------------- 先量大小 ---- */

const url = (it) => `https://freight.cargo.site/t/original/i/${it.hash}/${encodeURIComponent(it.file)}`;

async function head(it) {
  try {
    const r = await fetch(url(it), { headers: UA, method: 'HEAD' });
    return r.ok ? Number(r.headers.get('content-length')) || 0 : 0;
  } catch { return 0; }
}

let i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < list.length) {
    const it = list[i++];
    it.bytes = await head(it);
  }
}));

const totalBytes = list.reduce((n, it) => n + (it.bytes || 0), 0);
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`合計 ${mb(totalBytes)} MB`);
const noSize = list.filter((it) => !it.bytes);
if (noSize.length) console.log(`⚠ ${noSize.length} 個量不到大小，還是會試著下載`);

if (DRY) {
  console.log('\n--dry：以下是會下載的清單\n');
  for (const it of list) {
    console.log(`  ${it.slug}/${it.saveAs}`.padEnd(64) + (it.bytes ? mb(it.bytes) + ' MB' : '?'));
  }
  process.exit(0);
}

/* ----------------------------------------------------------- 下載 ---- */

let done = 0, skipped = 0, failed = 0, gotBytes = 0;
const fails = [];

async function grab(it) {
  const dir = join(OUT, it.slug);
  const dest = join(dir, it.saveAs);
  await mkdir(dir, { recursive: true });

  // 已經有而且大小相符就跳過，讓這支可以重複執行
  try {
    const s = await stat(dest);
    if (it.bytes && s.size === it.bytes) { skipped++; return; }
  } catch { /* 還沒下載過 */ }

  const tmp = dest + '.part';
  try {
    const r = await fetch(url(it), { headers: UA });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    const s = await stat(tmp);
    if (it.bytes && s.size !== it.bytes) {
      throw new Error(`大小不符：拿到 ${s.size}、預期 ${it.bytes}`);
    }
    await rename(tmp, dest);
    done++;
    gotBytes += s.size;
    console.log(`  ✓ ${(it.slug + '/' + it.saveAs).slice(0, 58).padEnd(60)} ${mb(s.size)} MB`);
  } catch (e) {
    failed++;
    fails.push(`${it.slug}/${it.saveAs}：${e.message}`);
    console.log(`  ✗ ${(it.slug + '/' + it.saveAs).slice(0, 58).padEnd(60)} ${e.message}`);
    try { await unlink(tmp); } catch { /* 沒建起來 */ }
  }
}

let j = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (j < list.length) await grab(list[j++]);
}));

/* --------------------------------------------------------- 清單檔 ---- */

/* 一份對照清單，之後看得出每個檔案屬於哪件作品、原始尺寸多少。
   放在輸出目錄裡，跟檔案本身一起備份。 */
const manifest = {
  匯出時間說明: '由 tools/download-originals.mjs 產生',
  來源: 'https://doris-lin.com（Cargo）的原始檔，freight.cargo.site/t/original/',
  說明: 'assets/media/ 裡的是上線用的壓縮版（1600px、WebP／MP4）。這裡是原始檔。',
  檔案數: list.length,
  合計位元組: totalBytes,
  檔案: list.map((it) => ({
    作品: it.slug,
    檔名: it.saveAs,
    Cargo原檔名: it.file !== it.saveAs ? it.file : undefined,
    用途: it.role === 'thumb' ? '首頁縮圖' : '內頁圖片',
    原始尺寸: it.w && it.h ? `${it.w}×${it.h}` : null,
    位元組: it.bytes || null,
    也用在: it.usedBy.length > 1 ? it.usedBy : undefined,
    hash: it.hash,
  })),
};
await writeFile(join(OUT, '_清單.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('');
console.log('═'.repeat(60));
console.log(`  下載 ${done} 個（${mb(gotBytes)} MB）、跳過 ${skipped} 個、失敗 ${failed} 個`);
console.log(`  清單：${join(OUT, '_清單.json')}`);
if (fails.length) {
  console.log('\n  失敗的檔案（再跑一次這支就會只重試這些）：');
  fails.slice(0, 20).forEach((f) => console.log('    ' + f));
}
console.log('═'.repeat(60));
