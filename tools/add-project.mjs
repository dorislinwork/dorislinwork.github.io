/* ==========================================================================
   新增（或更新）一個作品 —— 不用手寫 JSON
   --------------------------------------------------------------------------
   流程：
     1. 建資料夾 incoming\<slug>\  然後把圖片／GIF 丟進去
        （檔名隨意，會照檔名排序決定頁面上的順序，所以想控制順序就
         命名成 01、02、03…）
     2. node tools/add-project.mjs <slug> --title "標題" --year 2026
     3. node build.mjs

   這支腳本會自動：
     ・讀出每個檔案的實際像素尺寸（用 ffprobe）
     ・PNG／JPG → WebP，GIF → MP4 加一張 WebP 第一幀當 poster
     ・照檔名排序組出 blocks
     ・寫進 content/projects.json（新增或更新同名 slug）
     ・原始檔留在 incoming\ 不會被刪，那個資料夾不會進 repo

   常用參數：
     --title "標題"            顯示用標題（預設由 slug 推導）
     --year 2026
     --role "Personal work"
     --client "客戶名"
     --text "一段說明"          可重複，會依順序排在最前面
     --vimeo 1079279831        可重複，排在文字之後、圖片之前
     --thumb 02.png            指定首頁縮圖（預設用排序後第一個檔案）
     --span 2                  首頁網格佔幾欄（預設 1，放大代表作用）
     --ratio 16/9              縮圖長寬比（預設 1 正方形）
     --tags "3D,Animation"
     --width 1600              圖片輸出寬度上限
     --hide-from-grid          有頁面但不出現在首頁網格
     --draft                   先不產生頁面
     --front                   插到作品列表最前面（預設最前面）
     --end                     放到作品列表最後面
     --dry                     只顯示會做什麼，不實際寫入
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { requireFfmpeg, probeSize } from './lib-ffmpeg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------- 參數 ---- */

const argv = process.argv.slice(2);
if (!argv.length || argv[0].startsWith('--')) {
  console.error('用法：node tools/add-project.mjs <slug> [--title "標題"] [--year 2026] …');
  console.error('（完整參數看這個檔案最上面的說明）');
  process.exit(1);
}

const slug = argv[0];
const flags = { text: [], vimeo: [] };

for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = argv[i + 1];
  const takesValue = !['dry', 'draft', 'hide-from-grid', 'front', 'end'].includes(key);

  if (!takesValue) { flags[key] = true; continue; }
  if (next === undefined || next.startsWith('--')) {
    console.error(`--${key} 少了值`);
    process.exit(1);
  }
  if (key === 'text' || key === 'vimeo') flags[key].push(next);
  else flags[key] = next;
  i++;
}

const DRY = !!flags.dry;
const WIDTH = Number(flags.width) || 1600;
const QUALITY = 82;
const CRF = 26;

if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) {
  console.error(`slug「${slug}」含有不適合放進網址的字元。`);
  console.error('只用英數字、連字號、底線，例如 My-New-Work。');
  process.exit(1);
}

/* --------------------------------------------------------- 來源檔案 ---- */

const inbox = join(ROOT, 'incoming', slug);
const outDir = join(ROOT, 'assets/media', slug);

if (!existsSync(inbox)) {
  console.error(`找不到 ${join('incoming', slug)}`);
  console.error('請先建立這個資料夾，把圖片或 GIF 放進去，再執行一次。');
  process.exit(1);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|tiff?|bmp)$/i;
const GIF_EXT = /\.gif$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

const files = readdirSync(inbox)
  .filter((f) => !f.startsWith('.') && statSync(join(inbox, f)).isFile())
  .filter((f) => IMAGE_EXT.test(f) || GIF_EXT.test(f) || VIDEO_EXT.test(f))
  // localeCompare 加 numeric 才會把 2.png 排在 10.png 前面
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

if (!files.length) {
  console.error(`${join('incoming', slug)} 裡沒有可用的圖片或影片。`);
  console.error('支援 png / jpg / webp / tif / bmp / gif / mp4 / webm / mov');
  process.exit(1);
}

const { ffmpeg, ffprobe } = requireFfmpeg();

console.log(`作品：${slug}`);
console.log(`來源：${files.length} 個檔案，輸出寬度上限 ${WIDTH}px\n`);

/* ----------------------------------------------------------- 轉檔 ---- */

const media = [];
let inBytes = 0, outBytes = 0;

for (const file of files) {
  const src = join(inbox, file);
  const stem = basename(file, extname(file));
  const isGif = GIF_EXT.test(file);
  const isVid = VIDEO_EXT.test(file);
  const size = probeSize(ffprobe, src) || {};

  // GIF 與影片 → MP4（+ WebP poster）；靜態圖 → WebP
  const outName = (isGif || isVid) ? `${stem}.mp4` : `${stem}.webp`;
  const dest = join(outDir, outName);
  const poster = (isGif || isVid) ? join(outDir, `${stem}.webp`) : null;

  const srcSize = statSync(src).size;
  inBytes += srcSize;

  if (DRY) {
    console.log(`  ${file}  ${size.w || '?'}x${size.h || '?'}  →  ${outName}${poster ? ' + poster' : ''}`);
    media.push({ file, w: size.w || null, h: size.h || null });
    continue;
  }

  mkdirSync(outDir, { recursive: true });

  try {
    if (isGif || isVid) {
      execFileSync(ffmpeg, [
        '-y', '-loglevel', 'error', '-i', src,
        '-vf', `scale='min(${WIDTH},iw)':-2:flags=lanczos`,
        '-c:v', 'libx264', '-crf', String(CRF), '-preset', 'slow',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
        dest,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });

      execFileSync(ffmpeg, [
        '-y', '-loglevel', 'error', '-i', src,
        '-frames:v', '1',
        '-vf', `scale='min(${WIDTH},iw)':-2:flags=lanczos`,
        '-quality', '80', poster,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
    } else {
      execFileSync(ffmpeg, [
        '-y', '-loglevel', 'error', '-i', src,
        '-vf', `scale='min(${WIDTH},iw)':-1:flags=lanczos`,
        '-quality', String(QUALITY), '-compression_level', '6',
        dest,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).trim().split('\n').pop();
    console.error(`  ✗ ${file} 轉檔失敗：${msg.slice(0, 120)}`);
    process.exit(1);
  }

  const written = statSync(dest).size + (poster && existsSync(poster) ? statSync(poster).size : 0);
  outBytes += written;

  // 存進 projects.json 的是「原始檔名」，build 會自己換成 .webp / .mp4
  media.push({ file, w: size.w || null, h: size.h || null });

  const pct = srcSize ? ((1 - written / srcSize) * 100).toFixed(0) : '0';
  console.log(
    `  ✓ ${file.padEnd(34)} ${String(size.w || '?').padStart(5)}x${String(size.h || '?').padEnd(6)}` +
    ` ${(srcSize / 1024).toFixed(0)} KB → ${(written / 1024).toFixed(0)} KB (省 ${pct}%)`
  );
}

/* --------------------------------------------------------- 組 blocks ---- */

const blocks = [];
for (const t of flags.text) blocks.push({ type: 'text', text: t });
for (const id of flags.vimeo) {
  blocks.push({ type: 'embed', provider: 'vimeo', id: String(id), autoplay: true, loop: true });
}
for (const m of media) blocks.push({ type: 'media', file: m.file, w: m.w, h: m.h });

/* 縮圖：--thumb 指定，否則用排序後第一個 */
let thumbFile = flags.thumb;
if (thumbFile && !media.some((m) => m.file === thumbFile)) {
  console.error(`\n--thumb「${thumbFile}」不在 incoming\\${slug} 裡。可用的檔案：`);
  media.forEach((m) => console.error('  ' + m.file));
  process.exit(1);
}
if (!thumbFile) thumbFile = media[0].file;
const thumbMeta = media.find((m) => m.file === thumbFile);

const titleFromSlug = slug.replace(/-s-/g, "'s ").replace(/-t-/g, "'t ").replace(/-/g, ' ');

const entry = {
  slug,
  title: flags.title || titleFromSlug,
  year: flags.year || '',
  role: flags.role || 'Personal work',
  client: flags.client || '',
  tags: flags.tags ? flags.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
  summary: flags.text.length ? flags.text[0].slice(0, 155) : '',
  thumb: { file: thumbFile, w: thumbMeta.w, h: thumbMeta.h },
  blocks,
};
if (flags.draft) entry.draft = true;
if (flags['hide-from-grid']) entry.hideFromGrid = true;

// 首頁網格：佔幾欄、縮圖長寬比
if (flags.span && Number(flags.span) > 1) entry.span = Number(flags.span);
if (flags.ratio) entry.ratio = flags.ratio;

/* ----------------------------------------------------- 寫 projects.json ---- */

const jsonPath = join(ROOT, 'content/projects.json');
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const list = data.projects;
const existingIdx = list.findIndex((p) => p.slug === slug);

if (DRY) {
  console.log(`\n（--dry，沒有寫入任何東西）`);
  console.log(`${existingIdx > -1 ? '會更新' : '會新增'}作品「${entry.title}」`);
  console.log(`blocks：文字 ${flags.text.length}、Vimeo ${flags.vimeo.length}、媒體 ${media.length}`);
  console.log(`縮圖：${thumbFile}`);
  process.exit(0);
}

if (existingIdx > -1) {
  // 保留原本手動編輯過的欄位，只覆蓋這次有提供的
  const old = list[existingIdx];
  list[existingIdx] = {
    ...old,
    ...entry,
    title: flags.title || old.title,
    year: flags.year || old.year,
    role: flags.role || old.role,
  };
  console.log(`\n已更新既有作品：${slug}`);
} else if (flags.end) {
  list.push(entry);
  console.log(`\n已新增到列表最後：${slug}`);
} else {
  list.unshift(entry);
  console.log(`\n已新增到列表最前面：${slug}`);
}

writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

// 立刻讀回來驗證，確保沒有寫出壞掉的 JSON
try {
  JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.error('寫出的 JSON 壞了，請用 git checkout content/projects.json 還原');
  process.exit(1);
}

/* 首頁滑過縮圖時的色塊顏色是每件作品自己的，從縮圖取平均色算出來。
   新作品還沒有顏色，所以順手補上 —— 這支工具只補缺的，不會蓋掉已經設定好的。
   沒補的話這件作品的色塊會退回強調色，跟其他件不一致。 */
try {
  execFileSync(process.execPath, [join(ROOT, 'tools/set-card-colors.mjs')], { stdio: 'inherit' });
} catch {
  console.log('\n⚠ 取色失敗（不影響其他部分）。稍後可以自己跑：node tools/set-card-colors.mjs');
}

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`檔案：${mb(inBytes)} → ${mb(outBytes)}`);
console.log(`標題：${entry.title}${entry.year ? `（${entry.year}）` : ''}`);
console.log(`blocks：文字 ${flags.text.length}、Vimeo ${flags.vimeo.length}、媒體 ${media.length}`);
console.log(`縮圖：${thumbFile}`);
console.log(`\n下一步：`);
console.log(`  node build.mjs          重新產生網站`);
console.log(`  publish.cmd "訊息"      產生 + 檢查 + 上線（一次完成）`);
console.log(`\n想調整順序或加圖說，直接編輯 content/projects.json 裡的 blocks。`);
