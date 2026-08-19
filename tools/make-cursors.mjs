/* 產生自訂游標圖檔（PNG），輸出到 assets/img/。
 *
 *   node tools/make-cursors.mjs         照 site.json 的 cursors 設定產生
 *   node tools/make-cursors.mjs --dry   只顯示會產生什麼
 *
 * 顏色、大小、圓點半徑都在 content/site.json 的 cursors 裡改，改完重跑這支。
 *
 * 為什麼是 PNG 而不是 SVG：
 *   CSS 的 cursor 可以吃 SVG data URI，但 Safari 對 SVG 游標的支援一直不可靠
 *   （會直接回退成系統游標）。PNG 每個瀏覽器都吃。
 *
 * 為什麼要自己組 PNG：
 *   這個 repo 不裝任何套件。PNG 其實只是「zlib 壓縮的像素列 + 幾個帶 CRC 的區塊」，
 *   node 內建的 zlib 就夠了，所以自己寫比引進圖形庫合理。
 *
 * 為什麼圓點外面要加一圈白邊：
 *   首頁滑過縮圖時整張圖會被作品自己的顏色蓋住（深藍、深紅都有），純色圓點在那些
 *   底色上會看不見。白邊讓游標在任何底色上都有輪廓。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const cfg = site.cursors || {};

const SIZE = Number(cfg.size) || 32;
const DOT = Number(cfg.dotRadius) || 9;      // 圓點半徑（像素）
const RING = Number(cfg.ringWidth) || 1.5;   // 白邊寬度（像素）

/* ------------------------------------------------------------------ PNG ---- */

/* CRC-32（PNG 每個區塊結尾都要）。查表版本，跑 32×32 綽綽有餘。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba 是 width*height*4 的 Buffer */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // 每通道 8 bit
  ihdr[9] = 6;    // 色彩型別 6 = RGBA
  ihdr[10] = 0;   // 壓縮方式（只有 0）
  ihdr[11] = 0;   // 濾波方式（只有 0）
  ihdr[12] = 0;   // 非交錯

  // 每一列前面要加一個濾波器位元組，這裡一律用 0（不濾波）
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (width * 4 + 1);
    raw[at] = 0;
    rgba.copy(raw, at + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- 畫圓 ---- */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`顏色格式不對：${hex}（要像 #ff5b90）`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 畫一個實心圓加白邊。用 4×4 超取樣算每個像素被覆蓋多少，邊緣才不會有鋸齒。
 */
function drawDot(size, hex) {
  const [r, g, b] = hexToRgb(hex);
  const out = Buffer.alloc(size * size * 4);        // 預設全透明
  const c = size / 2;                               // 圓心
  const SS = 4;                                     // 每軸取樣數

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inDot = 0, inRing = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const d = Math.hypot(px - c, py - c);
          if (d <= DOT) inDot++;
          else if (d <= DOT + RING) inRing++;
        }
      }
      const total = SS * SS;
      const aDot = inDot / total;
      const aRing = inRing / total;
      if (!aDot && !aRing) continue;

      // 圓點疊在白邊上面。兩者都是不透明色，所以直接依覆蓋率混色，
      // 最後的 alpha 是兩者覆蓋率相加（不會超過 1，因為兩個區域不重疊）。
      const alpha = Math.min(1, aDot + aRing);
      const w = aDot + aRing;
      const i = (y * size + x) * 4;
      out[i]     = Math.round((r * aDot + 255 * aRing) / w);
      out[i + 1] = Math.round((g * aDot + 255 * aRing) / w);
      out[i + 2] = Math.round((b * aDot + 255 * aRing) / w);
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 主流程 ---- */

const colors = cfg.colors || {};
const targets = [
  { key: 'default', color: colors.default || '#ff5b90', label: '一般（粉紅）' },
  { key: 'link', color: colors.link || '#8a8a8a', label: '可點擊（灰）' },
];

if (!existsSync(join(ROOT, 'assets/img'))) mkdirSync(join(ROOT, 'assets/img'), { recursive: true });

console.log(`游標圖 ${SIZE}×${SIZE}px，圓點半徑 ${DOT}px，白邊 ${RING}px`);
console.log(`熱點（實際指到的那一點）在正中央 ${SIZE / 2} ${SIZE / 2}\n`);

for (const t of targets) {
  const png = encodePng(SIZE, SIZE, drawDot(SIZE, t.color));
  const rel = `assets/img/cursor-${t.key}.png`;
  if (!DRY) writeFileSync(join(ROOT, rel), png);
  console.log(`  ${t.color}  ${String(png.length).padStart(4)} bytes  ${rel}   ${t.label}`);
}

console.log(DRY ? '\n--dry：沒有寫檔' : '\n完成。跑 node build.mjs 讓頁面套用。');
