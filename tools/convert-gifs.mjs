/* ==========================================================================
   把動畫 GIF 轉成 MP4
   --------------------------------------------------------------------------
   用法：  node tools/convert-gifs.mjs
          node tools/convert-gifs.mjs --width 1000
          node tools/convert-gifs.mjs --dry

   為什麼要轉：Cargo 對動畫 GIF 完全不處理（要 WebP 也是回原檔、不支援 MP4），
   20 個縮圖 GIF 加起來 96MB，佔全站媒體的 91%。轉成 H.264 MP4 通常能省 95%
   以上，用 <video autoplay muted loop playsinline> 播放，視覺上與 GIF 無異。

   每個 GIF 會產生兩個檔案：
     <名稱>.mp4    動畫本體
     <名稱>.webp   第一幀，當 <video> 的 poster（影片還沒載入時先顯示）

   需要 ffmpeg。winget 裝的話不用改 PATH，這支腳本會自己找。
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const data = JSON.parse(readFileSync(join(ROOT, 'content/projects.json'), 'utf8'));
const projects = data.projects || data;

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const wIdx = args.indexOf('--width');
const WIDTH = wIdx > -1 ? Number(args[wIdx + 1]) : 800;
const CRF = 26;          // 越小畫質越好、檔案越大。26 對縮圖來說夠了
const HOST = 'https://freight.cargo.site';

/* ---- 找 ffmpeg：PATH 找不到就翻 winget 的安裝位置 ---- */
function findFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch (e) { /* 繼續找 */ }

  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages');
  if (!existsSync(base)) return null;

  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase() === 'ffmpeg.exe') return p;
    }
  }
  return null;
}

const FFMPEG = findFfmpeg();
if (!FFMPEG) {
  console.error('找不到 ffmpeg。請先執行：winget install Gyan.FFmpeg');
  process.exit(1);
}
console.log(`ffmpeg: ${FFMPEG}\n`);

/* ---- 收集所有動畫 GIF ---- */
const isGif = (f) => /\.gif$/i.test(f || '');
const jobs = [];
const seen = new Set();

const add = (m, slug) => {
  if (!m || !m.hash || !m.file || !isGif(m.file)) return;
  const key = `${slug}/${m.file}`;
  if (seen.has(key)) return;
  seen.add(key);
  const stem = m.file.replace(/\.[^.]+$/, '');
  jobs.push({
    slug,
    file: m.file,
    url: `${HOST}/t/original/i/${m.hash}/${encodeURIComponent(m.file)}`,
    mp4: join(ROOT, 'assets/media', slug, `${stem}.mp4`),
    poster: join(ROOT, 'assets/media', slug, `${stem}.webp`),
  });
};

for (const p of projects) {
  for (const b of p.blocks || []) if (b.type === 'media') add(b, p.slug);
  add(p.thumb, p.slug);
}

console.log(`找到 ${jobs.length} 個動畫 GIF，輸出寬度 ${WIDTH}px、CRF ${CRF}`);

if (DRY) {
  jobs.forEach((j) => console.log(`  ${j.slug}/${j.file}`));
  process.exit(0);
}

/* ---- 下載 → 轉檔 ---- */
const tmp = join(tmpdir(), 'cargo-gifs');
mkdirSync(tmp, { recursive: true });

let srcBytes = 0, outBytes = 0, done = 0;
const failed = [];

for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  const label = `${String(i + 1).padStart(2)}/${jobs.length}`;

  if (existsSync(j.mp4) && existsSync(j.poster)) {
    console.log(`  – ${label}  ${j.slug}/${j.file}  已存在，跳過`);
    continue;
  }

  try {
    // 下載原始 GIF 到暫存
    const res = await fetch(j.url);
    if (!res.ok) throw new Error(`下載失敗 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const srcPath = join(tmp, `${i}.gif`);
    writeFileSync(srcPath, buf);
    srcBytes += buf.length;

    mkdirSync(dirname(j.mp4), { recursive: true });

    // GIF → MP4
    // scale 後強制長寬為偶數，否則 yuv420p 會拒絕編碼
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', srcPath,
      '-vf', `scale='min(${WIDTH},iw)':-2:flags=lanczos`,
      '-c:v', 'libx264', '-crf', String(CRF), '-preset', 'slow',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      j.mp4,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    // 第一幀 → WebP poster
    execFileSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', srcPath,
      '-frames:v', '1',
      '-vf', `scale='min(${WIDTH},iw)':-2:flags=lanczos`,
      '-quality', '80',
      j.poster,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const mp4Size = statSync(j.mp4).size;
    const posterSize = statSync(j.poster).size;
    outBytes += mp4Size + posterSize;
    done++;

    const pct = ((1 - (mp4Size + posterSize) / buf.length) * 100).toFixed(0);
    console.log(
      `  ✓ ${label}  ${j.slug}/${j.file}` +
      `  ${(buf.length / 1048576).toFixed(1)} MB → ${(mp4Size / 1024).toFixed(0)} KB` +
      ` + ${(posterSize / 1024).toFixed(0)} KB poster  (省 ${pct}%)`
    );
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).trim().split('\n')[0];
    console.warn(`  ✗ ${label}  ${j.slug}/${j.file} → ${msg.slice(0, 90)}`);
    failed.push(j);
  }
}

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`\n轉換 ${done}/${jobs.length} 個`);
if (srcBytes) {
  console.log(`原始 GIF 合計 ${mb(srcBytes)} → 輸出合計 ${mb(outBytes)}`);
  console.log(`共節省 ${mb(srcBytes - outBytes)}（${((1 - outBytes / srcBytes) * 100).toFixed(1)}%）`);
}
if (failed.length) {
  console.log(`\n失敗 ${failed.length} 個，再跑一次會只重試這些：`);
  failed.forEach((j) => console.log(`  ${j.slug}/${j.file}`));
} else if (done) {
  console.log('\n下一步：node build.mjs（build 會自動把 GIF 縮圖改成 <video>）');
}
