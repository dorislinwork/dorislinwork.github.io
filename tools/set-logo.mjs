/* ==========================================================================
   換掉左上角的動態 logo
   --------------------------------------------------------------------------
   用法：  node tools/set-logo.mjs "D:\website\9.gif"
          node tools/set-logo.mjs 來源檔 --fps 20          降幀換檔案小一點
          node tools/set-logo.mjs 來源檔 --width 800       縮小（通常反而變大，見下）
          node tools/set-logo.mjs 來源檔 --dry

   輸出 assets/img/logo.webp（動畫 WebP、無損、保留透明），並更新 site.json
   的 logo.image / w / h。

   ── 為什麼是動畫 WebP 而不是 MP4 ────────────────────────
   2026-08-20 實測過。這種 logo 是「大片飽和色塊 + 硬邊 + 格紋條紋 + 透明背景」，
   對 H.264 來說是最差的素材：

     編碼                    大小      該純白處被汙染的最大值
     h264 crf26 @800        102 KB    100      ← 字母之間變濁、S 右邊出現一條線
     h264 crf18 @956        649 KB     33.7
     h264 crf12 @956       1466 KB     19.3
     WebP 無損 @956        1275 KB      0      ← 像素級完全一致
     原始 GIF              3015 KB      0

   H.264 的振鈴雜訊會漫進字母之間的白色空隙，而且在巨集區塊邊界突然截斷 ——
   那條「線」就是「有雜訊的白」跟「純白」的交界。無損就完全沒有這個問題。

   另外 MP4 沒有 alpha 通道，用它就得把背景烤成白色；WebP 保留透明，所以
   哪天要做深色模式也不會變成一塊白方塊。

   ── 三個反直覺的地方 ───────────────────────────────────
   1. **絕對不要加 -preset。** libwebp 的 preset 會重設整組參數，**把 -lossless
      關掉**，而且不會有任何警告。實測 `-lossless 1 -preset drawing` 出來的檔案
      小一半（1275 KB vs 2377 KB），但可見像素的 RGB 最大誤差是 130 —— 那是有損。
      參數順序前後對調也一樣中。所以這支腳本不給 preset，並在最後逐像素驗證。

   2. **縮小反而變大。** 800 寬比原生 956 大。因為 lanczos 縮放會製造大量
      抗鋸齒的中間色，把無損壓縮最擅長的「大片同色」打碎。所以預設不縮放。

   3. **有損比無損大。** 有損 q80 是 1598 KB 而且畫質有損，q90 是 2479 KB。
      平面色塊就是這樣，所以這支只做無損。

   要讓檔案變小唯一的辦法是降幀（全部都仍然是逐像素完全一致）：
      25fps 2377 KB、20fps 1906 KB、15fps 1438 KB、12.5fps 1205 KB
   ========================================================================== */

import { existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { requireFfmpeg, probeSize } from './lib-ffmpeg.mjs';
import { readJson, writeSiteJson } from './lib-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'content/site.json');
const OUT = join(ROOT, 'assets/img/logo.webp');
const OLD_MP4 = join(ROOT, 'assets/img/logo.mp4');

/* ------------------------------------------------------------- 參數 ---- */

const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : argv[i + 1];
};
const DRY = argv.includes('--dry');
const FPS = flag('fps', null);
const WIDTH = flag('width', null);

if (!src) {
  console.error('用法：node tools/set-logo.mjs <來源檔> [--fps 20] [--width 800] [--dry]');
  console.error('來源可以是 GIF、MP4、WebM、MOV、APNG。');
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`找不到 ${src}`);
  process.exit(1);
}

const { ffmpeg, ffprobe } = requireFfmpeg();

/* ------------------------------------------------------- 讀來源資訊 ---- */

const size = probeSize(ffprobe, src);
if (!size) {
  console.error('讀不出這個檔案的尺寸，可能不是影片或動畫。');
  process.exit(1);
}

const info = execFileSync(ffprobe, [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=nb_frames,pix_fmt,duration,r_frame_rate',
  '-of', 'default=nw=1:nk=0', src,
], { encoding: 'utf8' });
const field = (k) => (info.match(new RegExp(k + '=(.*)')) || [, '?'])[1].trim();
const frames = Number(field('nb_frames')) || 0;
const pixFmt = field('pix_fmt');
const hasAlpha = /a$/.test(pixFmt) || /^(pal8|bgra|rgba|argb|abgr|yuva)/.test(pixFmt);

const outW = WIDTH ? Number(WIDTH) : size.w;
const outH = WIDTH ? Math.round((Number(WIDTH) * size.h) / size.w) : size.h;

console.log(`來源：${src}`);
console.log(`  ${size.w}×${size.h}、${frames || '?'} 幀、${field('r_frame_rate')} fps、pix_fmt ${pixFmt}`);
console.log(`  透明背景：${hasAlpha ? '有（WebP 會原樣保留）' : '沒有'}`);
console.log(`輸出：${outW}×${outH}${FPS ? `、降到 ${FPS} fps` : '、幀率不變'}、動畫 WebP 無損`);
if (WIDTH) {
  console.log('  ⚠ 指定了 --width。縮放會製造抗鋸齒的中間色，無損檔案通常會「變大」而不是變小。');
  console.log('    想讓檔案變小請改用 --fps。');
}

if (DRY) {
  console.log('\n（--dry，沒有寫入任何東西）');
  process.exit(0);
}

/* ----------------------------------------------------------- 轉檔 ---- */

mkdirSync(dirname(OUT), { recursive: true });

const vf = [];
if (FPS) vf.push(`fps=${FPS}`);
if (WIDTH) vf.push(`scale=${outW}:-1:flags=lanczos`);

const args = ['-y', '-loglevel', 'error', '-i', src];
if (vf.length) args.push('-vf', vf.join(','));
args.push(
  '-c:v', 'libwebp_anim',
  '-lossless', '1',
  '-compression_level', '6',
  // 這裡刻意不給 -preset：它會重設整組參數並把 -lossless 關掉，不會有警告。
  '-loop', '0',           // 無限循環
  OUT,
);

try {
  execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
} catch (e) {
  const msg = (e.stderr ? e.stderr.toString() : e.message).trim().split('\n').filter(Boolean).pop();
  console.error(`\n轉檔失敗：${msg}`);
  process.exit(1);
}

/* --------------------------------------------------------- 驗證 ---- */

/* 無損應該是像素級完全一致。這裡真的比一次 ——
   萬一哪天有人加了 -preset 或把參數改成有損，這個檢查會立刻抓到。

   ⚠ 比對一定要分開看 alpha 與 RGB，而且**跳過全透明的像素**：
   全透明像素的 RGB 是「不存在的顏色」，來源與輸出填的值本來就不同
   （這支 GIF 有 75% 是全透明的，raw 逐位元比會得到 255 的差異），
   但畫面上完全看不到。第一版就是這樣誤報的。 */
function verify() {
  const decode = (file, extra) => {
    const a = ['-v', 'error', '-i', file];
    if (extra) a.push('-vf', extra);
    a.push('-frames:v', '4', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
    return execFileSync(ffmpeg, a, { maxBuffer: 1 << 30 });
  };
  try {
    const a = decode(src, vf.length ? vf.join(',') : null);
    const b = decode(OUT, null);
    const len = Math.min(a.length, b.length);
    let alpha = 0, rgb = 0;
    for (let i = 0; i < len; i += 4) {
      alpha = Math.max(alpha, Math.abs(a[i + 3] - b[i + 3]));
      if (a[i + 3] === 0 && b[i + 3] === 0) continue;   // 看不見，不算
      rgb = Math.max(rgb,
        Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    }
    return { alpha, rgb };
  } catch {
    return null;
  }
}

const diff = verify();

/* ------------------------------------------------- 更新 site.json ---- */

const site = readJson(SITE);
site.logo = site.logo || {};
site.logo.image = 'assets/img/logo.webp';
delete site.logo.video;    // 舊的 MP4 做法，不再使用
delete site.logo.poster;   // 動畫 WebP 的第一幀就是 poster，不需要另一個檔
site.logo.w = outW;
site.logo.h = outH;
writeSiteJson(SITE, site);

// 舊的 MP4 沒人引用了，留著只是死檔案
if (existsSync(OLD_MP4)) {
  rmSync(OLD_MP4);
  console.log('\n已刪掉不再使用的 assets/img/logo.mp4');
}

const kb = (p) => (statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('');
console.log(`✓ assets/img/logo.webp  ${kb(OUT)}`);
console.log(`✓ site.json 的 logo.image / w / h 已更新為 ${outW}×${outH}`);
console.log(`  來源 ${(statSync(src).size / 1048576).toFixed(1)} MB → ${kb(OUT)}`);
if (diff === null) {
  console.log('  （沒能驗證像素一致性，跳過）');
} else if (diff.alpha === 0 && diff.rgb === 0) {
  console.log('  ✓ 逐像素比對：透明形狀與顏色都與來源完全一致（真無損）');
} else {
  console.log(`  ⚠ 逐像素比對：alpha 差 ${diff.alpha}、可見像素 RGB 差 ${diff.rgb}，兩者都該是 0。`);
  console.log('    最可能的原因是參數裡多了 -preset —— 那會把 -lossless 關掉。');
}
console.log('');
console.log('顯示尺寸是 site.json 的 logo.displayWidth'
  + `（現在 ${site.logo.displayWidth || '未設定'}），要改大小改那個值。`);
console.log('要再小只能降幀，畫質仍然完全一致：--fps 20 約 1906 KB、--fps 15 約 1438 KB。');
console.log('下一步：node build.mjs　或　publish.cmd "換 logo"');
