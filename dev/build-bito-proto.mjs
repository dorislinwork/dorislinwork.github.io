/* Bito 風格首頁原型產生器（實驗用，不影響正式 index.html）
 *
 *   node dev/build-bito-proto.mjs   →  dev/index-bito.html
 *
 * 版面數值全部照 bito.tv 實測：12 欄、欄距 1.5rem、左右 2.5rem、最大寬 1600px、
 * 卡片 span 6（桌機兩欄）、部分卡 grid-row: span 2 改直式、hover 色塊由上往下滑。
 * 差別是 Bito 每件作品在後台另外備了直式素材，這裡只有一套，所以直式卡是裁切的。
 *
 * 覆蓋層顏色用 ffmpeg 取每張縮圖的平均色再拉飽和度，模擬 Bito 每件作品自訂顏色的效果。
 * 想手動指定就在 projects.json 那一筆加 "cardColor": "#f02"。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findFfmpeg, findFfprobe } from '../tools/lib-ffmpeg.mjs';

const site = JSON.parse(readFileSync('content/site.json', 'utf8'));
const all = JSON.parse(readFileSync('content/projects.json', 'utf8')).projects;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isGif = (f) => /\.gif$/i.test(f || '');
const isVid = (f) => /\.(mp4|webm|mov|m4v|gif)$/i.test(f || '');
const localName = (f) => f.replace(/\.[^.]+$/, '') + (isGif(f) ? '.mp4' : '.webp');
const posterName = (f) => f.replace(/\.[^.]+$/, '') + '.webp';

/* ---------------------------------------------------------------- 顏色 ---- */

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
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

const ff = findFfmpeg();
const colorCache = {};

function averageColor(file) {
  if (file in colorCache) return colorCache[file];
  try {
    const buf = execFileSync(ff, ['-v', 'quiet', '-i', file, '-frames:v', '1',
      '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
    if (buf.length < 3) throw new Error('無畫面');
    return (colorCache[file] = [buf[0], buf[1], buf[2]]);
  } catch {
    return (colorCache[file] = null);
  }
}

/** 平均色偏灰，拉飽和度並壓進中間亮度，才適合當滿版色塊 */
function cardColor(rgb) {
  if (!rgb) return { hex: '#ff2200', dark: false, fallback: true };
  const [h, s0, l0] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const s = Math.min(0.95, Math.max(0.55, s0 * 1.9));
  const l = Math.min(0.52, Math.max(0.34, l0));
  const hex = hslToHex(h, s, l);
  // 相對亮度決定文字用白還是黑
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return { hex, dark: lum > 0.45, fallback: false };
}

/* -------------------------------------------------------------- 直式節奏 ---- */

/** 一行幾格。12 欄網格，所以 2／3／4 都整除。 */
const PER_ROW = 3;
const SPAN = 12 / PER_ROW;

/* 普通卡的比例。631/348（1.81）是 Bito 的原始值。
   這批縮圖的比例中位數是 1.000（19 張正方、10 張直式），所以 1.81 會裁掉不少，
   但使用者比對過 1:1 與 4:3 之後還是選了原始的 631/348。
   直式卡的比例不用設，它撐滿「兩列 + 一個 row-gap」自己算出來（631/348 時約 0.86）。 */
const CARD_RATIO = '631 / 348';

/** 同一個比例的數值版，給 calc() 用（calc 不能除 "631 / 348" 這種寫法） */
const CARD_RATIO_NUM = (() => {
  const [a, b] = CARD_RATIO.split('/').map((s) => Number(s.trim()));
  return +(a / (b || 1)).toFixed(4);
})();

/** 右下角的比例控制條。關掉就是乾淨的成品畫面 */
const SHOW_RATIO_BAR = true;

/** 低於這個比例算直式，會優先被分配到兩列高的直式卡 */
const PORTRAIT_MAX = 0.95;

/* 模擬 CSS grid 自動排版（非 dense），回傳空格位置。
   高卡佔兩列，位置沒排好就會在網格中間留洞，所以產生前一定要驗。 */
function simulate(tallSet, n, cols) {
  const grid = [];
  const at = (r, c) => (grid[r] ? grid[r][c] : undefined);
  const put = (r, c) => { (grid[r] ||= [])[c] = 1; };
  let cur = 0;           // 掃描游標（row * cols + col），只會前進
  let maxRow = 0;
  for (let i = 0; i < n; i++) {
    const h = tallSet.has(i) ? 2 : 1;
    let p = cur;
    for (;;) {
      const r = Math.floor(p / cols), c = p % cols;
      let free = true;
      for (let k = 0; k < h; k++) if (at(r + k, c) !== undefined) { free = false; break; }
      if (free) {
        for (let k = 0; k < h; k++) put(r + k, c);
        maxRow = Math.max(maxRow, r + h - 1);
        cur = p;
        break;
      }
      p++;
    }
  }
  const holes = [];
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c < cols; c++) if (at(r, c) === undefined) holes.push(`r${r + 1}c${c + 1}`);
  }
  return { holes, rows: maxRow + 1 };
}

/* Bito 是兩欄，直式高卡寫死在索引 [1,3,11,13,17]，節奏是「高卡、普通卡、高卡」成對。
   三欄不能照抄：固定每 5 張放一張的話，高卡會全部落在中間那欄，變成一條中央直條。

   所以改成貪婪法，邊排邊驗兩件事：
     (1) 這張當高卡會不會在網格中間留下永久空格 —— 自動排版的游標只會前進，
         被跳過的格子之後填不回來
     (2) 它會落在哪一欄 —— 落在已經比較多高卡的那欄就跳過，換下一張試，
         高卡才會在三欄之間輪替 */
function pickTallPattern(n, cols, ratios, minGap = 4) {
  const grid = [];
  const at = (r, c) => (grid[r] ? grid[r][c] : undefined);
  const put = (r, c, v) => { (grid[r] ||= [])[c] = v; };

  /** 從游標往後找第一個放得下高度 h 的位置 */
  const spot = (from, h) => {
    let p = from;
    for (;;) {
      const r = Math.floor(p / cols), c = p % cols;
      let free = true;
      for (let k = 0; k < h; k++) if (at(r + k, c) !== undefined) { free = false; break; }
      if (free) return { p, r, c };
      p++;
    }
  };

  /** 游標之前還有空格 = 永久空洞 */
  const holeBefore = (p) => {
    for (let q = 0; q < p; q++) if (at(Math.floor(q / cols), q % cols) === undefined) return true;
    return false;
  };

  const tallSet = new Set();
  const tallPerCol = new Array(cols).fill(0);
  const tallRows = new Map();     // 列 -> 該列已有幾張高卡
  let cur = 0;
  let lastTall = -99;

  for (let i = 0; i < n; i++) {
    let asTall = false;
    // 直式的圖優先當高卡 —— 這樣它不必被裁成橫式，是這批素材裡最省裁切的分配。
    // 直式的圖不受間隔限制，其餘的維持節奏。尾巴留白不放高卡，最後一列才容易填滿。
    const portrait = (ratios[i] || 1) < PORTRAIT_MAX;
    if ((portrait || i - lastTall > minGap) && i < n - cols) {
      const t = spot(cur, 2);
      const balanced = tallPerCol[t.c] <= Math.min(...tallPerCol) + (portrait ? 1 : 0);
      // 一列最多 cols-1 張高卡：整列都是高卡會變成一整條直式帶狀，失去交錯的節奏。
      // （CSS 那邊已經修好塌陷問題，所以這條純粹是為了版面節奏，不是正確性需求。）
      const cap = cols - 1;
      const rowFree = (tallRows.get(t.r) || 0) < cap && (tallRows.get(t.r + 1) || 0) < cap;
      if (!holeBefore(t.p) && balanced && rowFree) asTall = true;
    }
    const h = asTall ? 2 : 1;
    const s = spot(cur, h);
    for (let k = 0; k < h; k++) put(s.r + k, s.c, i);
    cur = s.p;
    if (asTall) {
      tallSet.add(i); tallPerCol[s.c]++; lastTall = i;
      tallRows.set(s.r, (tallRows.get(s.r) || 0) + 1);
      tallRows.set(s.r + 1, (tallRows.get(s.r + 1) || 0) + 1);
    }
  }

  // 最後一列如果缺格，逐張把尾端的高卡改回普通卡直到填滿
  let res = simulate(tallSet, n, cols);
  while (res.holes.length && tallSet.size) {
    tallSet.delete(Math.max(...tallSet));
    res = simulate(tallSet, n, cols);
  }
  return { set: tallSet, rows: res.rows, perCol: tallPerCol };
}

/* ---------------------------------------------------------------- 卡片 ---- */

const projects = all.filter((p) => !p.draft && !p.hideFromGrid);

/** 縮圖的實際長寬比。以本機檔案為準（projects.json 記的是 Cargo 原始尺寸，會不一樣） */
const fprobe = findFfprobe();
const ratios = projects.map((p) => {
  const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media');
  if (!t || !t.file) return 1;
  const f = `assets/media/${p.slug}/${localName(t.file)}`;
  if (existsSync(f)) {
    try {
      const out = execFileSync(fprobe, ['-v', 'quiet', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', f], { encoding: 'utf8' });
      const m = out.match(/(\d+)x(\d+)/);
      if (m) return Number(m[1]) / Number(m[2]);
    } catch { /* 讀不到就用 json 記的尺寸 */ }
  }
  return t.w && t.h ? t.w / t.h : 1;
});

const { set: tall, rows: gridRows, perCol } = pickTallPattern(projects.length, PER_ROW, ratios);

const items = projects.map((p, i) => {
  const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media') || null;
  const isTall = tall.has(i);
  const base = { slug: p.slug, tall: isTall, p };

  if (!t || !t.file) return { ...base, media: '', color: cardColor(null) };

  const rel = `assets/media/${p.slug}/${localName(t.file)}`;
  const posterRel = `assets/media/${p.slug}/${posterName(t.file)}`;
  const video = isVid(t.file);
  const eager = i < 6;

  const media = video
    ? `<video src="../${rel}" autoplay muted loop playsinline`
      + `${existsSync(posterRel) ? ` poster="../${posterRel}"` : ''} preload="${eager ? 'auto' : 'none'}"></video>`
    : `<img src="../${rel}" alt="${esc(p.title)}"${eager ? '' : ' loading="lazy"'} decoding="async">`;

  // 顏色：projects.json 手動指定優先，否則從第一幀取平均色
  const swatch = video ? posterRel : rel;
  const color = p.cardColor
    ? { hex: p.cardColor, dark: false, fallback: false }
    : cardColor(existsSync(swatch) ? averageColor(swatch) : null);

  return { ...base, media, color };
});

const { holes } = simulate(tall, items.length, PER_ROW);
console.log(holes.length
  ? `⚠ ${PER_ROW} 欄排版有 ${holes.length} 個空格：${holes.join(' ')}`
  : `✓ ${PER_ROW} 欄排版無空格，共 ${gridRows} 列`);

const cards = items.map((it) => {
  const { p, color } = it;
  const desc = [p.year, p.role].filter(Boolean).join(' · ');
  return `      <a class="work${it.tall ? ' row-2-image' : ''}" href="../work/${esc(p.slug)}.html"
         style="--card-color:${esc(color.hex)}">
        <div class="work-media">${it.media}</div>
        <div class="work-overlay" aria-hidden="true"></div>
        <div class="info${color.dark ? ' dark' : ''}" aria-hidden="true">
          <div class="title">${esc(p.title)}</div>
          <div class="description">${esc(desc)}</div>
        </div>
        <div class="mobile-info">
          <div class="title">${esc(p.title)}</div>
          <div class="description">${esc(desc)}</div>
        </div>
      </a>`;
}).join('\n');

/* ---------------------------------------------------------------- 頁面 ---- */

const f = site.fonts || {};
const theme = site.theme || {};
const hero = site.hero || {};

const nav = (site.nav || []).filter((n) => n && n.label && !/^_/.test(n.label)).map((n) => {
  const href = n.external ? n.href : '../' + n.href;
  const cur = n.href === 'index.html' ? ' aria-current="page"' : '';
  const ext = n.external ? ' target="_blank" rel="noopener"' : '';
  return `      <li><a href="${esc(href)}"${ext}${cur}>${esc(n.label)}</a></li>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doris Lin — Bito 版面原型</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${f.googleFonts}&display=swap">
<link rel="stylesheet" href="https://use.typekit.net/${f.typekitKit}.css">
<style>
/* ============================================================ 骨架
   數值全部照 bito.tv 實測，註解裡標出跟你現在的站不一樣的地方 */
:root {
  --ink: ${theme.ink};
  --ink-strong: ${theme.inkStrong};
  --rule: #e7e7e7;
  --grey: #707070;
  --font: ${f.body};
  --page-margin: 2.5rem;   /* Bito 2.5rem／你的站 3.5rem */
  --gutter: 1.5rem;        /* 兩邊一樣 */
  --max: 1600px;           /* 你的站目前沒有上限 */
  --ease: cubic-bezier(.89, -.01, .37, 1);   /* Bito 全站都用這一條 */
  --card-ratio: ${CARD_RATIO};   /* 普通卡比例。右下角控制條可即時切換 */
  --card-ratio-num: ${CARD_RATIO_NUM};   /* 同一個比例的數值版，直式卡的 calc() 要用 */
}
* { box-sizing: border-box; }
html { font-size: 16px; }   /* Bito 16px 基準／你的舊站是 10px */
body {
  margin: 0;
  background: #fff;
  color: var(--ink-strong);
  font-family: var(--font);
  font-size: 1rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
img, video { display: block; max-width: 100%; }

.main-container { margin: auto; max-width: var(--max); }
.grid-content {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  margin-left: var(--page-margin);
  margin-right: var(--page-margin);
  column-gap: var(--gutter);
}
@media (max-width: 834px) { .grid-content { column-gap: 1rem; } }
@media (max-width: 500px) { .grid-content { margin-left: 1.5rem; margin-right: 1.5rem; } }

/* ============================================================ 頁首
   Bito：fixed、往下捲收起、往上捲滑出並加白底 */
header.bito {
  position: fixed; top: 0; width: 100%; z-index: 20;
  display: flex; align-items: center; justify-content: space-between;
  padding: 2rem var(--page-margin);
  transform: translateY(0);
  transition: all 1s var(--ease);
}
header.bito.hidden { transform: translateY(-100%); }
header.bito.bg { background: #fff; padding-top: 1rem; padding-bottom: 1rem; }
header.bito .logo video { width: 240px; height: auto; }
header.bito .links { display: flex; gap: 1.5rem; list-style: none; margin: 0; padding: 0; }
header.bito .links a[aria-current] { font-weight: 700; }
@media (max-width: 500px) {
  header.bito { padding: 1rem 1.5rem .5rem; }
  header.bito.bg { padding-top: 1rem; padding-bottom: .5rem; }
  header.bito .logo video { width: 150px; }
  header.bito .links { gap: 1rem; }
  header.bito .links a { font-size: .875rem; }
}

/* ============================================================ 開場
   Bito 首頁沒有大標，直接就是篩選列加作品格。這裡保留你的自我介紹但縮小，
   讓作品盡量往上。想更接近 Bito 就把這段刪掉。 */
.intro { padding: 9rem var(--page-margin) 3rem; margin: auto; max-width: var(--max); }
.intro h1 { font-size: 1.75rem; font-weight: 500; line-height: 1.4; margin: 0 0 .25rem; }
.intro p { margin: 0; color: var(--grey); }
@media (max-width: 500px) { .intro { padding: 6rem 1.5rem 2rem; } .intro h1 { font-size: 1.375rem; } }

/* ============================================================ 作品格
   .work 在 12 欄裡佔 ${SPAN} 欄 → 桌機一行 ${PER_ROW} 格（Bito 是一行 2 格）。
   加 .row-2-image 變兩列高的直式卡。 */
.works { padding-bottom: 3rem; }
.works .grid-content { row-gap: var(--gutter); }
.work {
  display: block;
  grid-column: span ${SPAN} / span ${SPAN};
  overflow: hidden; position: relative;
}
.work.row-2-image { grid-row: span 2 / span 2; }

.work-media { width: 100%; overflow: hidden; }
.work:not(.row-2-image) .work-media { aspect-ratio: var(--card-ratio); }
.work-media img, .work-media video { width: 100%; height: 100%; object-fit: cover; }

/* 直式卡：圖絕對定位鋪滿整張卡，高度改由 ::before 在文件流裡撐出來。
   高度 = 兩列 + 一個 row-gap = 200% / 比例 + gutter。
   padding 的百分比是對「自身寬度」計算的，所以不必知道實際像素寬，換比例或
   縮放視窗都會自己跟上。
   為什麼不能只靠絕對定位：那樣高卡在文件流裡高度是 0，一旦某一列剛好整列
   都是高卡（例如排序最前面連續幾件都是直式），該列就會塌成一條細線。 */
.work.row-2-image::before {
  content: ''; display: block;
  padding-top: calc(200% / var(--card-ratio-num) + var(--gutter));
}
.work.row-2-image .work-media { position: absolute; inset: 0; }

/* hover：色塊整片由上往下滑，文字晚 .3s 才浮現 */
.work-overlay {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: var(--card-color);
  transform: translateY(-101%);
  transition: transform .7s var(--ease);
}
.work:hover .work-overlay, .work:focus-visible .work-overlay { transform: translateY(0); }
.info {
  position: absolute; top: 0; left: 0; padding: 1.5rem;
  opacity: 0; transition: opacity .7s; transition-delay: .3s;
  color: #fff;
}
.info.dark { color: #000; }
.work:hover .info, .work:focus-visible .info { opacity: 1; }
.info .title { font-size: 1.125rem; font-weight: 500; line-height: 1.2; margin-bottom: .25rem; }
.info .description { font-size: 1rem; line-height: 1.2; }
.work:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 2px; }

/* 手機：不用 overlay，文字放到圖片下面 */
.mobile-info { display: none; margin-top: .5rem; }
.mobile-info .title { font-size: 1rem; font-weight: 500; line-height: 1.2; }
.mobile-info .description { font-size: .875rem; line-height: 1.5; color: var(--grey); }
/* 平板：一行 2 格，直式高卡取消。三欄的咬合節奏換成兩欄就會留洞，
   Bito 在窄螢幕也是一律簡化掉直式卡。 */
@media (max-width: 834px) {
  .work { grid-column: span 6 / span 6; }
  .work.row-2-image { grid-row: span 1 / span 1; }
  .work.row-2-image::before { display: none; }
  .work.row-2-image .work-media { position: static; aspect-ratio: var(--card-ratio); }
}
@media (max-width: 500px) {
  .work { grid-column: 1 / -1; overflow: visible; }
  .work-overlay, .info { display: none; }
  .mobile-info { display: block; }
  .works .grid-content { row-gap: 2rem; }
}

/* ============================================================ 頁尾 */
footer .grid-content { border-top: 1px solid var(--rule); padding: 2rem 0; align-items: start; }
footer .col, footer .social { grid-column: span 3 / span 3; }
footer p, footer li { margin: 0; line-height: 1.5rem; }
footer ul { list-style: none; margin: 0; padding: 0; }
@media (max-width: 500px) {
  footer .grid-content { padding: 3.5rem 0 2.5rem; row-gap: 1.5rem; }
  footer .col, footer .social { grid-column: 1 / -1; }
}

@media (prefers-reduced-motion: reduce) {
  header.bito, .work-overlay, .info { transition-duration: .01ms; }
}

${!SHOW_RATIO_BAR ? '' : `
/* ============================================================ 比例控制條
   只是選比例用的工具，不是設計的一部分（SHOW_RATIO_BAR 控制要不要輸出）。 */
#ratio-bar {
  position: fixed; right: 1rem; bottom: 1rem; z-index: 50;
  display: flex; align-items: center; gap: .25rem;
  padding: .5rem; border-radius: .5rem;
  background: rgba(20, 20, 20, .92); color: #fff;
  font: 500 .8125rem/1 var(--font);
  box-shadow: 0 4px 20px rgba(0, 0, 0, .25);
}
#ratio-bar button {
  border: 0; border-radius: .3125rem; padding: .4rem .55rem;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
#ratio-bar button:hover { background: rgba(255, 255, 255, .16); }
#ratio-bar button[aria-pressed="true"] { background: #fff; color: #111; }
#ratio-bar .readout {
  padding-left: .5rem; margin-left: .25rem;
  border-left: 1px solid rgba(255, 255, 255, .25);
  opacity: .75; font-weight: 400; white-space: nowrap;
}
@media (max-width: 500px) { #ratio-bar { display: none; } }
`}
</style>
</head>
<body>

<header class="bito" id="hdr">
  <a class="logo" href="../index.html" aria-label="Doris Lin">
    <video src="../${site.logo.video}" width="${site.logo.w}" height="${site.logo.h}"
           poster="../${site.logo.poster}" autoplay muted loop playsinline preload="auto"></video>
  </a>
  <nav aria-label="Main">
    <ul class="links">
${nav}
    </ul>
  </nav>
</header>

<main>
  <section class="intro">
    <h1>${esc(hero.headline)}</h1>
    <p>${esc(hero.sub)}</p>
  </section>

  <section class="main-container works" aria-label="Selected work">
    <div class="grid-content">
${cards}
    </div>
  </section>
</main>

<footer class="main-container">
  <div class="grid-content">
    <div class="col"><p>© Doris Lin — Taipei, Taiwan</p></div>
    <div class="col"><ul><li><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></li></ul></div>
    <div class="social">
      <ul>
        <li><a href="https://www.behance.net/yihsuanlin3257" target="_blank" rel="noopener">Behance</a></li>
        <li><a href="https://vimeo.com/dorislin1226" target="_blank" rel="noopener">Vimeo</a></li>
      </ul>
    </div>
  </div>
</footer>

${!SHOW_RATIO_BAR ? '' : `<div id="ratio-bar" role="group" aria-label="縮圖比例">
  <button type="button" data-r="631 / 348">Bito 631:348</button>
  <button type="button" data-r="16 / 9">16:9</button>
  <button type="button" data-r="3 / 2">3:2</button>
  <button type="button" data-r="4 / 3">4:3</button>
  <button type="button" data-r="5 / 4">5:4</button>
  <button type="button" data-r="1 / 1">1:1</button>
  <button type="button" data-r="4 / 5">4:5</button>
  <span class="readout" id="ratio-readout"></span>
</div>

<script>
/* 比例控制條。改 --card-ratio 就會重算整個網格 ——
   直式高卡是絕對定位撐滿兩列，所以它的比例會跟著變，不必另外設。 */
(function () {
  var bar = document.getElementById('ratio-bar');
  var out = document.getElementById('ratio-readout');
  var root = document.documentElement;

  function sync() {
    var cur = getComputedStyle(root).getPropertyValue('--card-ratio').trim();
    bar.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.r.replace(/\\s/g, '') === cur.replace(/\\s/g, '')));
    });
    // 量實際尺寸：普通卡的寬高，以及高卡撐開後的比例
    var normal = document.querySelector('.work:not(.row-2-image) .work-media');
    var tall = document.querySelector('.work.row-2-image');
    if (!normal) return;
    var n = normal.getBoundingClientRect();
    var txt = Math.round(n.width) + '×' + Math.round(n.height) + 'px';
    if (tall) {
      var t = tall.getBoundingClientRect();
      txt += '　直式卡 ' + (t.width / t.height).toFixed(2) + ':1';
    }
    out.textContent = txt;
  }

  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var parts = b.dataset.r.split('/');
    root.style.setProperty('--card-ratio', b.dataset.r);
    // 直式卡的高度是用 calc 算的，要同步更新數值版，否則兩者會不一致
    root.style.setProperty('--card-ratio-num', String(+(parts[0] / parts[1]).toFixed(4)));
    sync();
  });
  window.addEventListener('resize', sync, { passive: true });
  addEventListener('load', sync);
  sync();
})();
</script>
`}
<script>

/* Bito 的頁首捲動邏輯，門檻與節流值都照原站：
   往下捲收起、往上捲滑出；捲超過 120px 且往上捲時才加白底 */
(function () {
  var hdr = document.getElementById('hdr'), last = 0, waiting = false;
  function update() {
    var t = document.documentElement.scrollTop || document.body.scrollTop;
    var up = t < last;
    hdr.classList.toggle('hidden', !(t <= 120 || up));
    hdr.classList.toggle('bg', t > 120 && up);
    last = t;
    waiting = false;
  }
  window.addEventListener('scroll', function () {
    if (!waiting) { waiting = true; setTimeout(update, 50); }
  }, { passive: true });
  update();
})();

/* Bito 首頁只有 19 件，同時播幾支影片沒差。這裡有 20 支自動播放的影片，
   全部一起解碼會讓捲動變鈍、筆電風扇狂轉，所以只播進入視野的。
   HTML 仍留 autoplay，沒有 JS 也會動。 */
(function () {
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) { if (v.paused) v.play().catch(function () {}); }
      else if (!v.paused) v.pause();
    });
  }, { rootMargin: '200px 0px' });
  document.querySelectorAll('.work-media video').forEach(function (v) { io.observe(v); });
})();
</script>
</body>
</html>
`;

writeFileSync('dev/index-bito.html', html);
const tallCount = items.filter((i) => i.tall).length;
const picked = items.filter((i) => !i.color.fallback).length;
console.log(`✓ dev/index-bito.html —— ${items.length} 張卡，一行 ${PER_ROW} 格，其中 ${tallCount} 張直式高卡`);
console.log(`  高卡分布（每欄幾張）：${perCol.join(' / ')}`);
console.log(`  覆蓋層取色成功 ${picked}／${items.length} 件`);
