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

/* --projects <repo 相對路徑> 與 --only <slug>：跟 build.mjs 同名同義，
   給後台的「預覽這一頁」用。它把還沒儲存的草稿寫成暫存清單，先重量那一件的
   封面亮度、再產生預覽頁，所以預覽出來的導覽列黑白是真的 —— 封面構圖一調，
   導覽列該不該轉白字就跟著變了，不重量的話預覽會騙人。

   路徑必須是 repo 相對的：join(ROOT, 絕對路徑) 在 Windows 上會接出壞路徑。 */
const argOf = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? null : process.argv[i + 1];
};
const ONLY = argOf('only');

// 跟其他工具一樣以 repo 根目錄為基準，從任何目錄呼叫都能跑
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, argOf('projects') || 'content/projects.json');
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

/** projects.json 的 coverPosition（"50% 12%"）→ [0.5, 0.12]。規則同 build.mjs 的 coverPos()。 */
function coverPos(p) {
  const m = /^(\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(String(p.coverPosition || '').trim());
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5];
}

/**
 * 導覽列後面那一塊，換算成「圖片的哪個範圍」（0~1 的比例）。
 *
 * 每件作品現在可以自己調封面構圖（projects.json 的 coverPosition 與 coverScale，
 * 在後台是拖曳與滑桿），所以不能再假設居中裁切：她把構圖往下拖，看得到的就是
 * 圖片下半部，量中段會量到根本沒顯示出來的地方。
 *
 * @param pos   [x, y] 都是 0~1，對應 object-position 的百分比，預設 [0.5, 0.5]
 * @param scale 放大倍率，1 = 剛好填滿
 */
function coverTopBand(imgRatio, pos = [0.5, 0.5], scale = 1) {
  const z = Math.max(1, scale);
  // 圖比框更寬 → 整個高度都看得到、左右被裁；更高 → 反之。放大再各縮 1/z。
  const visW = Math.min(1, COVER_BOX_RATIO / imgRatio) / z;
  const visH = Math.min(1, imgRatio / COVER_BOX_RATIO) / z;
  return {
    // 剩下的空間由 object-position 決定往哪邊靠
    x: (1 - visW) * pos[0],
    y: (1 - visH) * pos[1],
    w: visW,
    h: Math.max(0.05, visH * NAV_FRACTION),
  };
}

/** 量一塊區域的平均相對亮度（0 = 全黑，1 = 全白） */
function bandLuminance(file, band) {
  const { x, y, w, h } = band;
  try {
    const buf = execFileSync(ff, ['-v', 'quiet', '-i', file, '-frames:v', '1',
      '-vf', `crop=iw*${w.toFixed(4)}:ih*${h.toFixed(4)}:iw*${x.toFixed(4)}:ih*${y.toFixed(4)}`
        + ',scale=1:1',
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
  if (ONLY && p.slug !== ONLY) continue;
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
    /* 量的是**封面**那張，不是首頁縮圖 —— 作品可以指定 cover 用別的圖，
       兩者不同時量縮圖等於量錯圖。cardColor 相反，它是首頁滑過的顏色，
       本來就該跟著縮圖，所以上下兩段各自取自己的檔案。 */
    const cv = p.cover && p.cover.file ? p.cover : t;
    const cvPoster = join(ROOT, `assets/media/${p.slug}/${posterName(cv.file)}`);
    const cvMedia = join(ROOT, `assets/media/${p.slug}/${localName(cv.file)}`);
    const cvFile = isVid(cv.file) && existsSync(cvPoster) ? cvPoster : cvMedia;

    const ratio = (cv.w && cv.h) ? cv.w / cv.h : 1;
    const pos = coverPos(p);
    const band = coverTopBand(ratio, pos, Number(p.coverScale) || 1);
    const lum = existsSync(cvFile) ? bandLuminance(cvFile, band) : null;
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
