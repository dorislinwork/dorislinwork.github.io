/* ==========================================================================
   產生 favicon
   --------------------------------------------------------------------------
   用法：  node tools/set-favicon.mjs <來源圖>
           node tools/set-favicon.mjs D:\website\favicon.png

   產出：  favicon.ico                     16 + 32 + 48，放在網站根目錄
           assets/img/favicon-32.png       瀏覽器分頁
           assets/img/apple-touch-icon.png 180×180，iOS 加到主畫面用

   來源建議用正方形、去背的 PNG。2026-08-22 用的是 D:\website\favicon.png
   （2000×2000，粉紅毛球角色，圓形去背）。

   三件不顯而易見的事：

   1. **ICO 是自己組的**，因為 repo 不裝套件。格式很簡單：6 bytes 檔頭 +
      每張 16 bytes 的目錄項 + 影像資料。Vista 之後允許直接塞 PNG（不必用
      舊的 BMP 格式），所以就是「把幾張 PNG 黏起來再補一份索引」。
      目錄項裡的寬高用 1 byte 存，256 要寫成 0 —— 這裡最大只到 48，用不到。

   2. **apple-touch-icon 一定要去背壓平。** iOS 不支援透明，會自己補成黑色，
      去背的圖在主畫面上會變成黑底。所以那一張先合成到白底（跟站上的背景一致）。
      瀏覽器分頁用的那些則保留透明，這樣淺色與深色主題都好看。

   3. **縮圖用 lanczos。** 預設的 bicubic 在這種細毛材質上會糊成一團，
      臉的輪廓在 32px 下就沒了。
   ========================================================================== */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, findFfprobe } from './lib-ffmpeg.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];

if (!src) {
  console.error('用法：node tools/set-favicon.mjs <來源圖>');
  process.exit(1);
}
if (!existsSync(src)) {
  console.error(`找不到來源檔：${src}`);
  process.exit(1);
}

const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe();
if (!ffmpeg || !ffprobe) {
  console.error('找不到 ffmpeg／ffprobe。');
  process.exit(1);
}

const imgDir = join(ROOT, 'assets/img');
mkdirSync(imgDir, { recursive: true });

const size = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', src],
  { encoding: 'utf8' }).trim();
console.log(`\n來源：${src}　${size}`);
if (!/^(\d+)x\1$/.test(size)) {
  console.log('  ⚠ 來源不是正方形，縮出來會被拉伸。建議先裁成正方形。');
}

/** 縮成某個尺寸的 PNG，保留透明 */
function png(px, out) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', out]);
  return readFileSync(out);
}

/* ---- 分頁圖示（保留透明） ---- */
const p32 = join(imgDir, 'favicon-32.png');
png(32, p32);
console.log(`  ✓ assets/img/favicon-32.png　${readFileSync(p32).length} bytes`);

/* ---- iOS 主畫面（壓白底，理由見檔頭） ---- */
const apple = join(imgDir, 'apple-touch-icon.png');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=white:s=180x180',
  '-i', src,
  '-filter_complex', '[1:v]scale=180:180:flags=lanczos[fg];[0:v][fg]overlay=0:0:format=auto',
  '-frames:v', '1', apple]);
console.log(`  ✓ assets/img/apple-touch-icon.png　${readFileSync(apple).length} bytes（已壓白底）`);

/* ---- favicon.ico（16 / 32 / 48） ---- */
const tmp = [];
const parts = [16, 32, 48].map((px) => {
  const t = join(imgDir, `_ico-${px}.png`);
  tmp.push(t);
  return { px, data: png(px, t) };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // 1 = icon
header.writeUInt16LE(parts.length, 4);

const dir = Buffer.alloc(16 * parts.length);
let offset = header.length + dir.length;
parts.forEach((p, i) => {
  const o = i * 16;
  dir.writeUInt8(p.px, o);             // 寬（256 要寫 0，這裡用不到）
  dir.writeUInt8(p.px, o + 1);         // 高
  dir.writeUInt8(0, o + 2);            // 調色盤數（0 = 不用）
  dir.writeUInt8(0, o + 3);            // reserved
  dir.writeUInt16LE(1, o + 4);         // planes
  dir.writeUInt16LE(32, o + 6);        // 每像素位元
  dir.writeUInt32LE(p.data.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += p.data.length;
});

const ico = Buffer.concat([header, dir, ...parts.map((p) => p.data)]);
writeFileSync(join(ROOT, 'favicon.ico'), ico);
tmp.forEach((t) => { try { unlinkSync(t); } catch { /* 已經不在了 */ } });
console.log(`  ✓ favicon.ico　${ico.length} bytes（16 + 32 + 48）`);

console.log('\n完成。<head> 的標籤由 build.mjs 產生，不用手動加。');
console.log('跑 node build.mjs 之後重新整理瀏覽器 —— 分頁圖示的快取很頑固，');
console.log('沒換的話用無痕視窗看，或對分頁按重新整理時多按幾次。\n');
