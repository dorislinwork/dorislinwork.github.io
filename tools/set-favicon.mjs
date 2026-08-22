/* ==========================================================================
   產生 favicon
   --------------------------------------------------------------------------
   用法：  node tools/set-favicon.mjs <來源圖>
           node tools/set-favicon.mjs D:\website\favicon.png

   產出：  favicon.ico                     16 + 32 + 48，放在網站根目錄
           assets/img/favicon-32.png       瀏覽器分頁
           assets/img/apple-touch-icon.png 180×180，iOS 加到主畫面用

   來源用去背的 PNG 就好，不必自己裁成正方形 —— 工具會先把四周全透明的邊裁掉、
   以圖形為中心取正方形，再縮。目前用的是 D:\website\favicon-2_工作區域 1.png
   （1000×1000 的粉紅 D 字標，白眼睛與白笑臉）。

   **五官要畫得夠大夠粗。** 這是圖示唯一真正重要的事：16px 的時候細線一定會糊掉。
   工具產完會逐一報告每個尺寸還剩多少細節，直接看那份輸出就知道夠不夠。

   四件不顯而易見的事：

   0. **留白會吃掉五官。** 圖形四周每留一圈空白，五官在 32px 下就跟著縮一圈。
      實測同一張圖：不裁留白時 32px 只剩 2 個像素認得出臉，裁掉之後變 4 個、
      48px 從 7 變 13。所以自動裁是預設行為，不是選項。

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
const [srcW, srcH] = size.split('x').map(Number);
console.log(`\n來源：${src}　${size}`);

/**
 * 先把四周全透明的邊裁掉。
 *
 * 圖示只有 16–48 像素，圖形四周每留一圈空白，五官就跟著縮一圈。2026-08-22 的
 * 素材 D 只佔畫面 78%×83%、還偏左上，裁掉之後同樣是 32px，臉的像素數就從 2 變成
 * 一倍以上。留白在 2000px 的稿子上看不出來，在 32px 上是決定看不看得見的差別。
 *
 * 取樣用縮小版（快，而且不會被單一個雜訊像素影響），再映射回原尺寸。
 * 裁出來一律是**正方形**並以圖形為中心 —— 圖示的容器就是正方形，
 * 在這裡先擺正比之後補邊更準。
 */
function contentBox() {
  const N = 200;
  const buf = execFileSync(ffmpeg, ['-v', 'error', '-i', src,
    '-vf', `scale=${N}:${N}:flags=area`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 22 });

  let minX = N; let maxX = -1; let minY = N; let maxY = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (buf[(y * N + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;                       // 整張全透明，別動它

  // 映射回原尺寸，四邊各留一點餘裕免得抗鋸齒的邊被切到
  const pad = 2;
  const x0 = Math.max(0, Math.floor((minX - pad) / N * srcW));
  const x1 = Math.min(srcW, Math.ceil((maxX + 1 + pad) / N * srcW));
  const y0 = Math.max(0, Math.floor((minY - pad) / N * srcH));
  const y1 = Math.min(srcH, Math.ceil((maxY + 1 + pad) / N * srcH));

  // 以圖形為中心撐成正方形，超出邊界就往回收
  const side = Math.min(Math.max(x1 - x0, y1 - y0), Math.min(srcW, srcH));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const left = Math.round(Math.min(Math.max(cx - side / 2, 0), srcW - side));
  const top = Math.round(Math.min(Math.max(cy - side / 2, 0), srcH - side));
  return { side: Math.round(side), left, top };
}

const box = contentBox();
const trimmed = box && (box.side < Math.min(srcW, srcH) - 2 || srcW !== srcH);
if (trimmed) {
  const pct = Math.round(box.side / Math.min(srcW, srcH) * 100);
  console.log(`  圖形只佔畫面的 ${pct}%，先裁掉四周的透明邊 → ${box.side}×${box.side}`);
  console.log('  （圖示只有 16–48px，留白會讓五官跟著縮小）');
}
const square = true;   // 裁完一定是正方形

/**
 * 縮成某個尺寸的 PNG，保留透明。
 *
 * 來源不是正方形時**補透明邊，不拉伸** —— 圖示是她的作品，拉變形比留白難看。
 * force_original_aspect_ratio=decrease 先把長邊縮到目標尺寸，再用透明色補滿。
 */
/** 裁切後再縮放的 filter 前綴。沒有可裁的就空字串。 */
const cropVf = trimmed ? `crop=${box.side}:${box.side}:${box.left}:${box.top},` : '';

function png(px, out) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src,
    '-vf', `${cropVf}scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', out]);
  return readFileSync(out);
}

/**
 * 這個尺寸下還看得到臉嗎。
 *
 * 2026-08-22 換成扁平的「D」字標之後發現：16px 的時候眼睛與嘴巴會整個糊掉，
 * 只剩一塊粉紅。那不是 bug，是細節太細 —— 但一定要講出來，不然她以為壞了。
 * 判斷方式：數有沒有「明顯比底色亮」或「明顯偏黃」的像素。
 */
function facePixels(file) {
  const b = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 22 });
  let light = 0;
  let warm = 0;
  for (let i = 0; i < b.length; i += 4) {
    const [r, g, bl, a] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
    if (a < 200) continue;
    if (r > 225 && g > 225 && bl > 225) light++;
    if (r > 200 && g > 160 && bl < 150) warm++;
  }
  return light + warm;
}

/* ---- 分頁圖示（保留透明） ---- */
const p32 = join(imgDir, 'favicon-32.png');
png(32, p32);
console.log(`  ✓ assets/img/favicon-32.png　${readFileSync(p32).length} bytes`);

/* ---- iOS 主畫面（壓白底，理由見檔頭） ---- */
const apple = join(imgDir, 'apple-touch-icon.png');
const appleFit = `${cropVf}scale=180:180:flags=lanczos`;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=white:s=180x180',
  '-i', src,
  // 縮好之後置中疊上白底；非正方形時 overlay 會自己算出置中的位置
  '-filter_complex', `[1:v]${appleFit}[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2:format=auto`,
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
console.log(`  ✓ favicon.ico　${ico.length} bytes（16 + 32 + 48）`);

/* 每個尺寸下細節還剩多少 —— 在刪暫存檔之前量 */
console.log('\n各尺寸的細節（眼睛、嘴巴這類小元素還剩幾個像素）：');
let lost = [];
for (const t of tmp) {
  const px = /_ico-(\d+)\.png$/.exec(t)[1];
  const n = facePixels(t);
  console.log(`  ${String(px).padStart(2, ' ')}px　${n} 像素　${n ? '看得到' : '✗ 糊掉了'}`);
  if (!n) lost.push(px);
}
if (lost.length) {
  console.log(`\n  ⚠ ${lost.join('、')}px 的時候細節會消失，只剩整體形狀與顏色。`);
  console.log('    這不是壞掉，是細節本來就太細。現代瀏覽器在高解析螢幕上大多用 32px，');
  console.log('    所以多數情況看得到；16px 主要是舊環境與某些書籤列在用。');
  console.log('    想在最小尺寸也看得到，來源圖的五官要畫更大更粗。');
}

tmp.forEach((t) => { try { unlinkSync(t); } catch { /* 已經不在了 */ } });

console.log('\n完成。<head> 的標籤由 build.mjs 產生，不用手動加。');
console.log('跑 node build.mjs 之後重新整理瀏覽器 —— 分頁圖示的快取很頑固，');
console.log('沒換的話用無痕視窗看，或對分頁按重新整理時多按幾次。\n');
