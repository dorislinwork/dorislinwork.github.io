/* 為每件作品算出首頁 hover 色塊要用的顏色，寫回 content/projects.json。
 *
 *   node tools/set-card-colors.mjs           只補還沒有顏色的
 *   node tools/set-card-colors.mjs --force   全部重算
 *   node tools/set-card-colors.mjs --dry     只顯示結果，不寫檔
 *
 * 為什麼要先算好存進 json，而不是每次 build 現算：
 *   - build.mjs 是零依賴、幾百毫秒跑完的，不該每次都去叫 ffmpeg 讀 50 個檔
 *   - 顏色是設計決定，存成資料才改得動。不喜歡某一件的顏色就直接改 json 裡的
 *     cardColor，這支工具不會再去覆蓋它（除非加 --force）
 *
 * 順便補齊 thumb 缺少的 w/h —— 首頁要用比例決定哪些作品適合放直式高卡。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFfmpeg, findFfprobe } from './lib-ffmpeg.mjs';

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

// 跟其他工具一樣以 repo 根目錄為基準，從任何目錄呼叫都能跑
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'content/projects.json');
const data = JSON.parse(readFileSync(FILE, 'utf8'));

const isGif = (f) => /\.gif$/i.test(f || '');
const localName = (f) => f.replace(/\.[^.]+$/, '') + (isGif(f) ? '.mp4' : '.webp');
const posterName = (f) => f.replace(/\.[^.]+$/, '') + '.webp';
const isVid = (f) => /\.(mp4|webm|mov|m4v|gif)$/i.test(f || '');

const ff = findFfmpeg();
const fprobe = findFfprobe();

/* ------------------------------------------------------------------ 顏色 ---- */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const ch = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + ch(0) + ch(8) + ch(4);
}

/** 把圖縮成 1×1 讀出平均色 */
function averageColor(file) {
  try {
    const buf = execFileSync(ff, ['-v', 'quiet', '-i', file, '-frames:v', '1',
      '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
    return buf.length >= 3 ? [buf[0], buf[1], buf[2]] : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------- 封面頂部是不是深色 ---- */

/* 作品內頁的封面現在頂到視窗最上緣、導覽列透明浮在上面，所以要知道
   「導覽列後面那塊是亮還是暗」，暗的話把連結改成白字。

   ⚠ 不能直接量圖片的頂端。封面是 object-fit: cover 居中裁切 ——
   直式素材在寬扁的封面框裡，看得到的是圖片的**中段**，頂端根本沒顯示出來。
   量錯位置結論會完全相反（例如上白下黑的圖會判成亮色）。

   所以先照 object-fit: cover 的規則算出「實際看得到的縱向範圍」，
   再取那個範圍的上面三分之一 —— 那才是導覽列真正壓住的地方。
   封面框的比例用 2.4 當代表值（1520×630 左右的桌機情況）。 */
const COVER_BOX_RATIO = 2.4;   // 封面框的寬高比
const NAV_FRACTION = 0.34;     // 導覽列大約佔封面高度的多少

function coverTopBand(imgRatio) {
  // 圖比框更寬 → 整個高度都看得到；圖比框更高 → 只看得到中間 imgRatio/框比例
  const visible = imgRatio >= COVER_BOX_RATIO ? 1 : imgRatio / COVER_BOX_RATIO;
  const top = (1 - visible) / 2;
  return { y: top, h: Math.max(0.05, visible * NAV_FRACTION) };
}

/** 量一塊區域的平均相對亮度（0 = 全黑，1 = 全白） */
function bandLuminance(file, y, h) {
  try {
    const buf = execFileSync(ff, ['-v', 'quiet', '-i', file, '-frames:v', '1',
      '-vf', `crop=iw:ih*${h.toFixed(4)}:0:ih*${y.toFixed(4)},scale=1:1`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
    if (buf.length < 3) return null;
    const lin = [buf[0], buf[1], buf[2]].map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  } catch {
    return null;
  }
}

/** 平均色偏灰，拉飽和度並壓進中間亮度，才適合當滿版色塊 */
function toCardColor(rgb) {
  if (!rgb) return null;
  const [h, s0, l0] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const s = Math.min(0.95, Math.max(0.55, s0 * 1.9));
  const l = Math.min(0.52, Math.max(0.34, l0));
  const hex = hslToHex(h, s, l);
  // 相對亮度決定色塊上的文字要白還是黑
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return { hex, dark: lum > 0.45 };
}

/* ------------------------------------------------------------------ 主流程 ---- */

let colored = 0, sized = 0, skipped = 0, failed = 0, toned = 0;

for (const p of data.projects) {
  const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media');
  if (!t || !t.file) { failed++; console.log(`  ✗ ${p.slug}：找不到縮圖`); continue; }

  const media = join(ROOT, `assets/media/${p.slug}/${localName(t.file)}`);
  // 影片取第一幀的 poster 來取色（直接讀 mp4 也行，但 poster 更快也更穩）
  const poster = join(ROOT, `assets/media/${p.slug}/${posterName(t.file)}`);
  const swatch = isVid(t.file) && existsSync(poster) ? poster : media;

  if (!existsSync(swatch)) { failed++; console.log(`  ✗ ${p.slug}：${swatch} 不存在`); continue; }

  // 補 thumb 的 w/h（首頁靠比例挑直式高卡）
  if (p.thumb && (!p.thumb.w || !p.thumb.h)) {
    try {
      const m = execFileSync(fprobe, ['-v', 'quiet', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', media],
        { encoding: 'utf8' }).match(/(\d+)x(\d+)/);
      if (m) { p.thumb.w = Number(m[1]); p.thumb.h = Number(m[2]); sized++; }
    } catch { /* 讀不到就算了，首頁會當成 1:1 */ }
  }

  /* 封面頂部亮度。跟 cardColor 分開判斷：這個沒有「使用者手動改過就不要覆蓋」
     的問題（它不是設計選擇，是量出來的事實），所以每次都重算。
     門檻 0.5 是中間灰；比它暗就用白字。 */
  {
    const ratio = (p.thumb && p.thumb.w && p.thumb.h) ? p.thumb.w / p.thumb.h : 1;
    const band = coverTopBand(ratio);
    const lum = bandLuminance(swatch, band.y, band.h);
    if (lum !== null) {
      if (lum < 0.5) p.coverTopDark = true;
      else delete p.coverTopDark;
      toned++;
    }
  }

  if (p.cardColor && !FORCE) { skipped++; continue; }

  const c = toCardColor(averageColor(swatch));
  if (!c) { failed++; console.log(`  ✗ ${p.slug}：取色失敗`); continue; }

  p.cardColor = c.hex;
  // 淺色底要用黑字，深色底用白字。只在需要黑字時記錄，讓 json 乾淨一點。
  if (c.dark) p.cardColorDark = true;
  else delete p.cardColorDark;
  colored++;
  console.log(`  ${c.hex}  ${c.dark ? '黑字' : '白字'}  ${p.slug}`);
}

console.log(`\n取色 ${colored} 件、補尺寸 ${sized} 件、量封面亮度 ${toned} 件、`
  + `沿用既有顏色 ${skipped} 件、失敗 ${failed} 件`);
const darkCount = data.projects.filter((p) => p.coverTopDark).length;
console.log(`封面頂部偏暗（導覽列改白字）：${darkCount} 件`);

if (DRY) {
  console.log('--dry：沒有寫檔');
} else if (colored || sized || toned) {
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`已寫入 ${FILE}`);
} else {
  console.log('沒有變更');
}
