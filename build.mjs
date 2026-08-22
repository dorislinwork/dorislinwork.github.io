/* ==========================================================================
   作品集產生器
   --------------------------------------------------------------------------
   用法：  node build.mjs
   沒有任何套件依賴，不需要 npm install。

   讀：  content/site.json     全站設定（名字、顏色、字體、hero 文字…）
         content/projects.json 作品清單
         src/css/*.css         樣式
         src/js/*.js           腳本

   寫：  index.html            首頁（hero + 縮圖網格）
         information.html      關於頁
         work/<slug>.html      每個作品一頁
         404.html  sitemap.xml  robots.txt  .nojekyll
         assets/css/  assets/js/

   新增作品 = 在 projects.json 加一筆，然後重跑這支腳本。
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/* 參數（都是給後台的「預覽」用的，平常直接跑 node build.mjs 不用給）：
     --projects <路徑>   改讀別的作品清單，而不是 content/projects.json
     --site <路徑>       改讀別的全站設定，而不是 content/site.json
     --only <slug>       只產生那一件作品的頁面到 work/_preview.html，其他都不動
     --preview-info      只產生 Information 頁到 _preview-info.html，其他都不動

   後台會把「還沒儲存」的草稿寫成暫存檔，再用這些參數產生預覽頁，
   所以使用者不必先按儲存才能看結果 —— 順序本來就該是「先看，滿意了再存」。

   路徑都要用 repo 相對的：read() 會把它跟 ROOT 相接，
   給絕對路徑在 Windows 上會接出 C:\repo\C:\temp\... 這種壞路徑。 */
const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : argv[i + 1];
};
const PROJECTS_FILE = argOf('projects') || 'content/projects.json';
const SITE_FILE = argOf('site') || 'content/site.json';
const ONLY = argOf('only');
const PREVIEW_INFO = argv.includes('--preview-info');

const site = read(SITE_FILE);

// projects.json 可以是純陣列，也可以是 { _說明, projects: [...] }
const rawProjects = read(PROJECTS_FILE);
const projects = (Array.isArray(rawProjects) ? rawProjects : rawProjects.projects || [])
  .filter((p) => p && p.slug && !p.draft);

/* ---------------------------------------------------------------- 工具 ---- */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** site.json 裡以 _ 開頭的鍵是給人看的說明，輸出時要忽略 */
const isNote = (k) => k.startsWith('_');

/**
 * 社群連結的網址補上 https://。
 *
 * 2026-08-21 使用者在後台加 LinkedIn 時填了 `linkedin.com/in/dorislin1226`，
 * 沒有 https://。瀏覽器會把它當成**相對路徑**，所以每一頁都指向
 * /work/linkedin.com/in/… 這種不存在的位置 —— check.mjs 在 55 頁全部報錯、
 * 發布被擋下來。從貼網址的人的角度看，那個值長得完全正常。
 *
 * 所以在這裡補，而不是要求她記得打。社群連結**一定**是外部網址，
 * 不可能是站內路徑，所以這個補法沒有猜錯的空間。
 * （nav 不套用：那裡的 index.html、work/Reel.html 本來就是相對路徑。）
 */
/**
 * "#rrggbb" → 相對亮度 0..1（WCAG 的算法，跟 set-card-colors.mjs 同一套）。
 * 用來決定板塊上的文字該用黑還是白 —— 她挑了深色板塊，文字就得自動翻白，
 * 不然要她自己記得「深底配白字」等於把問題丟回給她。認不得的值回 null。
 */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 區塊的板塊底色。只認 #rrggbb，其他一律當沒設（避免把任意字串塞進 style）。 */
const blockBg = (b) => (/^#[0-9a-f]{6}$/i.test(String(b.bg || '').trim())
  ? String(b.bg).trim().toLowerCase()
  : '');

const externalUrl = (href) => {
  const v = String(href || '').trim();
  if (!v) return v;
  // 已經有協定（https:、mailto:、tel:…）或是明確的絕對／協定相對路徑就不動
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('/')) return v;
  return 'https://' + v;
};

/**
 * 一段文字 → 一個 <p>，區塊內的換行轉成 <br>。
 *
 * HTML 會把原始碼裡的換行折成空格，所以在後台按 Enter 分行的話，不轉的話
 * 畫面上會全部黏成一大段 —— 使用者 2026-08-21 就是這樣分行的，然後發現沒生效。
 * 想要獨立段落（段距更大）就用兩個 text 區塊。
 *
 * 抽成函式是因為內頁文字有兩條路徑：內文區塊走 renderBlock()，資訊列的敘述
 * 走 renderProject()。第一次只改了前者，資訊列還是黏成一段。
 */
const paragraph = (text, place) =>
  `<p${place ? ` style="${place}"` : ''}>${esc(text).replace(/\r?\n/g, '<br>')}</p>`;

/* 內頁圖片區是 12 欄網格。每個區塊可以在 projects.json 指定放在哪幾欄：
     "col": 2, "span": 5     從第 2 欄開始、佔 5 欄
   一個機制涵蓋三種需求：
     span 12          滿版
     span 6 + span 6  兩塊並排（連續兩個區塊會自己落在同一列）
     col 2 span 5 / col 7 span 5   左右錯落（參考 filippomartinelli.com 的做法）

   沒有指定的區塊維持原本行為（佔滿一整列，再依比例置中收窄），
   所以這個功能是純新增，不動到現有的 51 個作品頁。
   後台的區塊編輯器有下拉可以選，不必手寫。 */
function blockPlacement(b) {
  const box = blockBox(b);
  return box ? `grid-column:${box.col} / span ${box.span}` : '';
}

/** 區塊要佔哪幾欄。沒指定或值不合法就回 null（代表佔滿一整列）。 */
function blockBox(b) {
  const col = Number(b.col);
  const span = Number(b.span);
  if (!Number.isFinite(span) || span < 1 || span > 12) return null;
  const start = Number.isFinite(col) && col >= 1 && col <= 12 ? col : 1;
  return { col: start, span: Math.min(span, 13 - start) };
}

/**
 * 算出每個區塊該放在第幾列。
 *
 * 為什麼要自己算，不交給 CSS 自動排版：網格的自動排版是一個「只會前進的游標」，
 * 所以順序會決定結果 —— 先放「第 7 欄起」再放「第 1 欄起」的話，第二塊會被推到
 * 下一列，而使用者的意圖是並排。手寫列號又太脆弱（插一張圖就要全部重編）。
 *
 * 這裡的規則：照順序走，只要要佔的欄位跟這一列已經被佔的不重疊就留在同一列，
 * 重疊才換到下一列。所以任何不重疊的組合都會並排，跟先後順序無關。
 * 區塊加上 "newRow": true 可以強制斷開（明明放得下也另起一列）。
 * 沒指定欄位的區塊佔滿整列，自然把那一列封住。
 */
function assignRows(blocks) {
  let row = 0;
  let taken = new Array(13).fill(false);   // 1..12，索引 0 不用

  return blocks.map((b) => {
    const box = blockBox(b);
    const cols = box
      ? Array.from({ length: box.span }, (_, k) => box.col + k)
      : Array.from({ length: 12 }, (_, k) => k + 1);

    const clash = cols.some((c) => taken[c]);
    if (row === 0 || clash || b.newRow === true) {
      row += 1;
      taken = new Array(13).fill(false);
    }
    cols.forEach((c) => { taken[c] = true; });
    return row;
  });
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const isGifFile = (f) => /\.gif$/i.test(f || '');

/* ------------------------------------------------------- 媒體網址組裝 ----
   Cargo 的圖片網址是參數化的：
     freight.cargo.site/w/<寬度>/q/<品質>/i/<hash>/<檔名>
   所以只要有 hash 就能要任何尺寸，不必抓原始大檔。

   site.json 的 media.source：
     "cargo" → 直接指向 Cargo CDN，馬上可用，但依賴 Cargo 帳號還在
     "local" → 指向 assets/media/<slug>/<檔名>，需要先跑 download-media.mjs
   -------------------------------------------------------------------- */
const MEDIA = site.media || {};
const MEDIA_SOURCE = MEDIA.source || 'cargo';
const CARGO_HOST = 'https://freight.cargo.site';

/* 本機檔名規則，對應 download-media.mjs 與 tools/convert-gifs.mjs 的產出：
     靜態圖  x.png  → x.webp
     動畫    x.gif  → x.mp4（另有 x.webp 當 poster） */
/* GIF 與影片來源都會被轉成 MP4（見 tools/lib-media.mjs 的 outputNames()）。
   這裡原本只判斷 GIF，所以來源是 .mp4／.mov／.webm 時會算出 .webp、指到不存在的檔案。
   目前的資料剛好沒有影片來源，所以還沒出事，但 add-project.mjs 支援丟影片進來。
   兩邊的規則必須一致，2026-08-21 對過一次。 */
const isMovingFile = (f) => isGifFile(f) || VIDEO_EXT.test(f || '');
const localName = (file) => file.replace(/\.[^.]+$/, '') + (isMovingFile(file) ? '.mp4' : '.webp');
const posterName = (file) => file.replace(/\.[^.]+$/, '') + '.webp';

/* 本機檔名。平常就是 file，但同一件作品裡可能有**不同的圖用同一個檔名** ——
   Cargo 用 hash 定址，所以它允許這種事（Dancing-Christmas-Tree 有三張不同的圖
   都叫 _00000.png）。只用檔名存的話它們會互相蓋掉，頁面上會看到同一張重複三次，
   另外兩張根本沒下載。2026-08-21 發現線上真的是這樣。

   所以衝突的區塊要在 projects.json 補一個 localFile（例如 _00000-707ab261.png）。
   Cargo 的網址仍然用原本的 file（實測換檔名會 404，它要求完全相符），
   只有存在本機的名字不同。下面 checkLocalNameCollisions() 會在 build 時檢查，
   漏填的話會警告，不會再默默壞掉。 */
const sourceName = (m) => m.localFile || m.file;

/** 本機的 GIF 已轉成 MP4，所以在 local 模式下 GIF 也算影片 */
const isVideo = (m) => m.tag === 'video'
  || VIDEO_EXT.test(m.file || m.src || '')
  || (MEDIA_SOURCE === 'local' && isGifFile(m.file));

function mediaUrl(m, slug, width, base) {
  if (!m) return '';
  if (MEDIA_SOURCE === 'local') {
    if (!m.file) return base + (m.url || '');
    return `${base}assets/media/${slug}/${encodeURIComponent(localName(sourceName(m)))}`;
  }
  if (m.hash && m.file) {
    const q = MEDIA.quality || 82;
    // 靜態圖一定要加 f/webp，不然 Cargo 直接回原檔、w 與 q 都無效
    // （實測同一張 PNG：原樣 3010 KB、轉 WebP 125 KB）。
    // 動畫 GIF 例外，Cargo 完全不處理。
    const fmt = isGifFile(m.file) ? '' : 'f/webp/';
    return `${CARGO_HOST}/w/${width}/q/${q}/${fmt}i/${m.hash}/${encodeURIComponent(m.file)}`;
  }
  return m.url || '';
}

/** <video> 的 poster（第一幀）。只有 local 模式才有 */
function posterUrl(m, slug, base) {
  if (MEDIA_SOURCE !== 'local' || !m || !m.file) return '';
  return `${base}assets/media/${slug}/${encodeURIComponent(posterName(sourceName(m)))}`;
}

/* ------------------------------------------------------- 主題變數注入 ---- */

/** "631 / 348" → 1.8132。給 calc() 用，因為 calc 不能拿分數寫法去除。 */
function ratioNum(ratio) {
  const [a, b] = String(ratio || '631 / 348').split('/').map((s) => Number(s.trim()));
  const n = a / (b || 1);
  return Number.isFinite(n) && n > 0 ? +n.toFixed(4) : 1.8132;
}

/* header.navAlign 的可用值 → flex 的對齊值。
   只認這三個，填別的就退回 bottom，不會產生壞的 CSS。 */
const NAV_ALIGN = { top: 'flex-start', bottom: 'flex-end', center: 'center' };

/* 首頁大標的對齊 → 區塊要往哪邊靠（margin 的左右值）。
   只認這三個，填別的就退回 left。 */
const HERO_ALIGN = { left: '0 auto 0 0', center: '0 auto', right: '0 0 0 auto' };

function themeVars(base) {
  const t = site.theme || {};
  const g = site.grid || {};
  const f = site.fonts || {};
  const c = site.cursors || {};

  const ty = site.type || {};
  const cs = site.case || {};
  const inf = site.information || {};
  const hr = site.hero || {};
  const wg = (site.effects || {}).wiggle || {};

  const lines = [
    `--bg: ${t.bg || '#fff'};`,
    `--ink: ${t.ink || 'rgba(0,0,0,.75)'};`,
    `--ink-strong: ${t.inkStrong || '#000'};`,
    `--accent: ${t.accent || '#f02'};`,
    `--accent-hover: ${t.accentHover || '#ff5b90'};`,
    `--accent-active: ${t.accentActive || '#252525'};`,
    `--link: ${t.link || '#252525'};`,
    `--nav-current: ${t.navCurrent || '#252525'};`,
    `--nav-current-weight: ${t.navCurrentWeight || '700'};`,
    `--caption-color: ${t.caption || 'rgba(0,0,0,.3)'};`,
    `--caption-size: ${t.captionSize || '1.4rem'};`,
    `--font-display: ${f.display || 'sans-serif'};`,
    `--font-body: ${f.body || 'sans-serif'};`,
    `--font-caption: ${f.caption || f.body || 'sans-serif'};`,
    // 字級：舊站是固定值，首頁大標拉出來可調
    /* 首頁大標的排版。都在 site.json 的 hero 那一組，因為那本來就是首頁的東西。
       size 沒填的話退回舊的 type.heroSize，所以既有設定不會失效。

       對齊要同時處理兩件事：文字本身的 text-align，以及整個區塊往哪邊靠。
       只設 text-align 的話，區塊仍然被 max-width 綁在左邊，「置中」看起來
       只是「在左半邊置中」。所以另外算一組 margin。 */
    `--hero-size: ${hr.size || ty.heroSize || 'clamp(2.6rem, 4.5vw, 5.2rem)'};`,
    `--hero-sub-size: ${hr.subSize || ty.titleSize || '2.2rem'};`,
    `--hero-weight: ${hr.weight || ty.headingWeight || '700'};`,
    `--hero-style: ${hr.style === 'italic' ? 'italic' : 'normal'};`,
    `--hero-lh: ${hr.lineHeight || '1.1'};`,
    `--hero-ls: ${hr.letterSpacing || '0'};`,
    `--hero-gap: ${hr.lineGap || '1.2rem'};`,
    `--hero-max: ${hr.maxWidth || '90rem'};`,
    `--hero-align: ${HERO_ALIGN[hr.align] ? hr.align : 'left'};`,
    `--hero-margin: ${HERO_ALIGN[hr.align] || HERO_ALIGN.left};`,
    `--title-size: ${ty.titleSize || '2.2rem'};`,
    `--body-size: ${ty.bodySize || '1.4rem'};`,
    `--body-lh: ${ty.bodyLineHeight || '1.2'};`,
    `--body-weight: ${ty.bodyWeight || '400'};`,
    `--heading-weight: ${ty.headingWeight || '700'};`,
    // 網格：12 欄，每件作品預設佔 4 欄 = 一行三格。
    // 個別作品可以在 projects.json 用 span / spanTablet / spanMobile 蓋掉。
    `--grid-cols: ${g.columns ?? 12};`,
    `--span: ${g.span ?? 4};`,
    `--span-t: ${g.spanTablet ?? 6};`,
    `--span-m: ${g.spanMobile ?? 12};`,
    `--grid-gutter: ${g.gutter || '2.4rem'};`,
    // 縮圖比例。--card-ratio-num 是同一個值的數值版，直式高卡的 calc() 要用
    // （calc 沒辦法拿 "631 / 348" 這種寫法去做除法）。
    `--card-ratio: ${g.ratio || '631 / 348'};`,
    `--card-ratio-num: ${ratioNum(g.ratio)};`,
    `--max: ${g.maxWidth || '160rem'};`,
    `--logo-width: ${(site.logo || {}).displayWidth || '398px'};`,
    `--pad: ${g.pad || '4rem'};`,
    // 作品內頁的封面。--cover-h 是 fallback，JS 算完會在 .case-cover 上覆寫成
    // 「視窗高 - 資訊列高」。min/max 是那個計算值的夾制範圍。
    `--cover-h: ${cs.coverHeight || '70vh'};`,
    `--cover-h-min: ${cs.coverMinHeight || '45vh'};`,
    `--cover-h-max: ${cs.coverMaxHeight || '92vh'};`,
    `--blurb-lines: ${cs.blurbLines ?? 4};`,
    /* 資訊列的版型（2026-08-21 參考 therocketpanda.com 的作品內頁）：
       左邊一段大字敘述當主角，右邊單一直排的欄位、每格左邊一條細線。 */
    `--blurb-size: ${cs.blurbSize || '1.6rem'};`,
    `--blurb-measure: ${cs.blurbMeasure || '75ch'};`,
    `--blurb-lh: ${cs.blurbLineHeight || '1.4'};`,
    `--info-span: ${cs.blurbSpan ?? 8};`,
    `--facts-col: ${cs.factsCol ?? 10};`,
    `--facts-gap: ${cs.factsGap || '6.4rem'};`,
    /* 細線關掉的時候塗成透明，而不是不畫 border —— 不然左邊少了 1px，
       整欄文字會跟著位移，開關看起來像是版面在跳。 */
    `--facts-rule: ${cs.factsRule === false
      ? 'transparent'
      : (cs.factsRuleColor || 'rgba(0,0,0,.16)')};`,
    `--info-pad: ${cs.infoSpacing || '10rem'};`,
    /* Information 頁的兩欄版面（2026-08-21 參考 bb-hlw.com/info）。
       都放在 site.json 的 information 裡，因為那一組本來就是這一頁的東西。 */
    `--info-photo-span: ${inf.photoSpan ?? 5};`,
    /* 文字從第幾欄開始。中間要空幾欄比「文字佔幾欄」好懂，也不會兩個值互相打架。
       算在這裡而不是寫成 CSS 的 calc() —— grid-column 的線號不吃 calc()。
       1920 螢幕上留 1 欄 = 間距 153px、文字欄剛好 748px，幾乎正好是參考站的
       750px 上限，所以 textMax 幾乎不必生效。 */
    `--info-text-col: ${Number(inf.photoSpan ?? 5) + Number(inf.gapCols ?? 1) + 1};`,
    `--info-photo-ratio: ${inf.photoRatio || '1 / 1'};`,
    `--info-text-max: ${inf.textMax || '75rem'};`,
    `--info-title-size: ${inf.titleSize || '2.6rem'};`,
    `--info-heading-size: ${inf.headingSize || '2rem'};`,
    `--info-contact-size: ${inf.contactSize || '2.6rem'};`,
    /* 內頁的圓角與間距（參考 filippomartinelli.com）。
       --cover-radius 是「捲到底時」的值，捲動前是 0；實際套用的是
       --cover-radius-now，由 site.js 依捲動進度算出來。 */
    `--media-radius: ${cs.mediaRadius || '0'};`,
    `--cover-radius: ${cs.coverRadius || '0'};`,
    /* coverInset 填 "grid" 的話，縮到跟內容欄（也就是下面的 Vimeo 影片）完全一樣寬。
       那個寬度是 min(maxWidth, 視窗寬) - 2×pad，所以每一側要縮的量是
       (視窗寬 - 內容欄寬) / 2 = (視窗寬 - min(maxWidth, 視窗寬)) / 2 + pad。
       用 CSS 的 min() 算而不是 JS 算，這樣改視窗大小會自己跟上、不必等 resize 事件。 */
    `--cover-inset: ${cs.coverInset === 'grid'
      ? 'calc((var(--vw, 100vw) - min(var(--max, 160rem), var(--vw, 100vw))) / 2 + var(--pad, 4rem))'
      : (cs.coverInset || '0')};`,
    `--gallery-gap: ${cs.gallerySpacing || '2.4rem'};`,
    // 文字區塊有底色時，色塊的內距（上下 / 左右）
    `--panel-pad: ${cs.panelPadding || '3.2rem'};`,
    `--panel-pad-x: ${cs.panelPaddingX || cs.panelPadding || '3.2rem'};`,
    // 導覽列右邊那組連結：對齊哪一邊、字級、字重、往上抬多少（site.json 的 header）
    `--nav-align: ${NAV_ALIGN[(site.header || {}).navAlign] || 'flex-end'};`,
    `--nav-size: ${(site.header || {}).navSize || '1.5rem'};`,
    `--nav-weight: ${(site.header || {}).navWeight || '400'};`,
    `--nav-lift: ${(site.header || {}).navLift || '0'};`,
    /* 逐字跳動（.wiggle-text）。時間刻意注入成純數字，CSS 用 calc(… * 1ms)、
       effects.js 直接 parseFloat —— 同一個來源，兩邊不會不同步。 */
    `--wiggle-distance: ${wg.distance || '8px'};`,
    `--wiggle-tilt: ${wg.tilt || '8deg'};`,
    `--wiggle-ms: ${wg.durationMs ?? 500};`,
    `--wiggle-step: ${wg.stepMs ?? 35};`,
    `--wiggle-ease: ${wg.easing || 'cubic-bezier(0.34, 1.56, 0.64, 1)'};`,
  ];

  /* 自訂游標：一般狀態粉紅圓點，可點擊的東西變灰。
     這裡只注入變數，實際的 cursor 規則寫在 src/css/site.css ——
     因為 site.css 是後載入的，重置區那條 `button { cursor: pointer }` 會蓋掉
     寫在這裡的同特異度規則。變數放這邊、規則放那邊，順序才對。

     圖檔由 tools/make-cursors.mjs 產生。檔案不存在就不輸出變數，site.css 的
     var() fallback 會接手（auto / pointer），不會留下指向不存在檔案的宣告。
     熱點放在圖的正中央，所以實際指到的位置就是圓點中心。
     變數值本身也帶 auto / pointer 當第二層 fallback，圖載不到時行為跟一般網站一樣。 */
  /* 跟隨式游標。--cursor-follow-size 存在與否就是 site.js 判斷「有沒有開」的依據，
     所以關掉時整組都不要輸出。放大倍率在這裡算好（放大後直徑 ÷ 原直徑），
     CSS 才能用單純的 transform: scale() 做動畫 —— 動 width/height 會很卡。 */
  const fl = c.follow || {};
  if (c.enabled !== false && fl.enabled !== false) {
    const px = (v, d) => (parseFloat(v) || d);
    const base = px(fl.size, 16);
    const grow = px(fl.growTo, 72);
    lines.push(`--cursor-follow-size: ${base}px;`);
    lines.push(`--cursor-follow-color: ${fl.color || t.accentHover || '#ff5b90'};`);
    lines.push(`--cursor-grow: ${+(grow / base).toFixed(3)};`);
    lines.push(`--cursor-label-size: ${grow}px;`);
    lines.push(`--cursor-label-color: ${fl.labelColor || '#fff'};`);
    lines.push(`--cursor-ease: ${Number(fl.ease) > 0 ? Number(fl.ease) : 0.26};`);
    lines.push(`--cursor-blend: ${fl.blendMode || 'normal'};`);
  }

  if (c.enabled !== false) {
    const size = Number(c.size) || 32;
    const hot = `${size / 2} ${size / 2}`;
    const has = (key) => existsSync(join(ROOT, `assets/img/cursor-${key}.png`));
    if (has('default')) {
      lines.push(`--cursor-default: url("${base}assets/img/cursor-default.png") ${hot}, auto;`);
    }
    if (has('link')) {
      lines.push(`--cursor-link: url("${base}assets/img/cursor-link.png") ${hot}, pointer;`);
    }
  }

  return `:root{${lines.join('')}}`;
}

/* ------------------------------------------------------------ 版面殼 ---- */

/**
 * @param {object} o
 * @param {string} o.title     <title> 內容
 * @param {string} o.desc      meta description
 * @param {string} o.body      主要內容 HTML
 * @param {string} o.base      回到站台根目錄的相對前綴（'' 或 '../'）
 * @param {string} o.current   目前所在的 nav href，用來標 aria-current
 * @param {string} o.ogImage   分享圖路徑
 */
function layout(o) {
  const base = o.base || '';
  const f = site.fonts || {};
  const gf = f.googleFonts
    ? `\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${f.googleFonts}&display=swap">`
    : '';
  const tk = f.typekitKit
    ? `\n<link rel="stylesheet" href="https://use.typekit.net/${f.typekitKit}.css">`
    : '';

  // 導覽連結。舊站四個連結都套 wiggle-text（滑過逐字跳動），這裡沿用。
  const navLinks = (site.nav || [])
    .filter((n) => n && n.label && !isNote(n.label))
    .map((n) => {
      const href = n.external ? n.href : base + n.href;
      const cur = !n.external && n.href === o.current ? ' aria-current="page"' : '';
      const ext = n.external ? ' target="_blank" rel="noopener"' : '';
      return `<a class="wiggle-text" href="${esc(href)}"${cur}${ext}>${esc(n.label)}</a>`;
    })
    .join('\n        ');

  /* 品牌區：有設定 logo 就用動態 logo，否則退回文字。

     logo.image 是動畫 WebP（現在的做法）—— 無損、保留透明，用一個 <img> 就好，
     不需要另一張 poster。logo.video 是舊的 MP4 做法，還留著是為了往回相容：
     MP4 沒有 alpha 而且 H.264 會在白色區域產生雜訊，換 logo 請用
     tools/set-logo.mjs，它輸出的是 WebP。

     img 的 alt 刻意留空 —— 外層 <a> 已經有 aria-label，兩個都填讀屏軟體會唸兩次。 */
  const logo = site.logo || {};
  const logoLink = (inner) => `<a class="nav-brand nav-brand-logo" href="${esc(base + (logo.href || 'index.html'))}" aria-label="${esc(logo.alt || site.name)}">
    ${inner}
  </a>`;
  const dim = `${logo.w ? ` width="${esc(logo.w)}"` : ''}${logo.h ? ` height="${esc(logo.h)}"` : ''}`;

  let brand;
  if (logo.image) {
    brand = logoLink(`<img src="${esc(base + logo.image)}"${dim} alt="" fetchpriority="high" decoding="async">`);
  } else if (logo.video) {
    brand = logoLink(`<video src="${esc(base + logo.video)}"${dim}`
      + `${logo.poster ? ` poster="${esc(base + logo.poster)}"` : ''} autoplay muted loop playsinline preload="auto"></video>`);
  } else {
    brand = `<a class="nav-brand" href="${esc(base)}index.html">${esc(site.name)}</a>`;
  }

  const mail = site.email || {};

  /* 頁尾的平台連結（Behance、Vimeo…）。跟 Information 頁聯絡區塊讀的是
     site.json 同一份 social，加一個平台兩邊一起出現，不會漏掉一邊。

     Information 頁自己傳 hideFooterSocial —— 它的聯絡區塊就在頁尾正上方，
     同一組連結不該在幾百像素內出現兩次。 */
  const footerSocial = ((site.footer || {}).showSocial === false || o.hideFooterSocial)
    ? ''
    : (site.social || [])
      .filter((s) => s && s.label && s.href && !isNote(s.label))
      .map((s) => `    <li><a class="wiggle-text" href="${esc(externalUrl(s.href))}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`)
      .join('\n');

  /* 全站標題的出現方式。放在 <html> 上是為了不必在每一種頁面的 h1 上各加一次
     （首頁大標、作品名、Information 標題是三段不同的產生程式碼）。
     個別元素上的 data-reveal 會蓋掉這個值。 */
  const revealDefault = ['line', 'none', 'letter'].includes((site.effects || {}).reveal)
    ? site.effects.reveal
    : 'letter';

  /* data-page 讓 CSS 分辨頁面種類，不必為每種頁面各寫一次規則。
     現在用在兩件事：作品內頁的導覽列改成 fixed（封面才能頂到最上面），
     以及「除了首頁以外導覽列不要白底」。

     data-header-solid 來自 site.json 的 header.solidOnScroll：
       index-only  只有首頁捲動後加白底（現在的設定）
       always      每一頁捲動後都加白底
       never       永遠透明 */
  const page = o.page || 'other';
  const solidRaw = (site.header || {}).solidOnScroll;
  const solid = ['index-only', 'always', 'never'].includes(solidRaw) ? solidRaw : 'index-only';

  /* data-cover-dark：這一頁的封面在導覽列後面那塊偏暗，導覽列連結要改白字。
     由 tools/set-card-colors.mjs 量出來寫進 projects.json 的 coverTopDark。
     實際套用還要等 site.js 確認導覽列真的還壓在封面上（.is-over-cover）——
     捲過封面之後下面是白底，白字會消失。 */
  const coverDark = o.coverDark ? ' data-cover-dark="true"' : '';

  /* data-cover：這一頁真的有封面。導覽列只有在有封面時才改成 fixed（脫離流排），
     封面才能頂到視窗最上緣。沒有封面的作品頁（例如 Reel 沒有縮圖）如果也脫離流排，
     第一個元素就會從 y=0 開始、直接被導覽列疊住。 */
  const hasCover = o.hasCover ? ' data-cover="true"' : '';

  /* 內頁圖片之間那些文字段落要靠左還是置中（site.json 的 case.galleryTextAlign）。
     用屬性而不是 CSS 變數，因為置中要同時改 text-align、max-width 與左右 margin
     三件事，寫成一條規則比三個變數清楚。 */
  const galleryText = (site.case || {}).galleryTextAlign === 'center' ? ' data-gallery-text="center"' : '';

  return `<!DOCTYPE html>
<html lang="${esc(site.lang || 'en')}" data-reveal-default="${revealDefault}" data-page="${esc(page)}" data-header-solid="${solid}"${coverDark}${hasCover}${galleryText}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc || site.description)}">
<meta name="author" content="${esc(site.name)}">

<meta property="og:type" content="website">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc || site.description)}">${o.ogImage ? `
<meta property="og:image" content="${esc(/^https?:/.test(o.ogImage) ? o.ogImage : site.url + '/' + o.ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">

<meta name="theme-color" content="${esc((site.theme || {}).bg || '#fff')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${gf}${tk}

<style>${themeVars(base)}</style>
<link rel="stylesheet" href="${base}assets/css/site.css">
<link rel="stylesheet" href="${base}assets/css/effects.css">
</head>

<body>
<a class="skip" href="#main">Skip to content</a>

<header class="nav" data-hide-on-scroll="${(site.header || {}).hideOnScroll === false ? 'false' : 'true'}">
  ${brand}
  <nav class="nav-links" aria-label="Main">
        ${navLinks}
  </nav>
</header>

<main id="main">
${o.body}
</main>

<footer class="footer">
  <p>© <span id="year">${new Date().getFullYear()}</span> ${esc(site.name)}</p>
${footerSocial ? `  <ul class="footer-social">\n${footerSocial}\n  </ul>\n` : ''}  <p><a class="wiggle-text mailto" data-user="${esc(mail.user)}" data-domain="${esc(mail.domain)}" href="#">${esc(mail.user)}@${esc(mail.domain)}</a></p>
</footer>

<script src="${base}assets/js/effects.js" defer></script>
<script src="${base}assets/js/site.js" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------ 媒體 ---- */

/**
 * 把一個 block 轉成 HTML。
 * block 的四種型別：
 *   heading  小標題（例如 Styleframe / Storyboard / Credit）
 *   text     段落
 *   media    圖片
 *   embed    Vimeo 嵌入
 */
function renderBlock(b, i, slug, base, row) {
  /* 列號由 assignRows() 統一算好傳進來，所有區塊都輸出 grid-row —— 全部明寫
     才不會有一半靠自動排版、一半靠明寫而互相打亂。 */
  const rowStyle = row ? `grid-row:${row}` : '';
  const withRow = (s) => [s, rowStyle].filter(Boolean).join(';');
  /* 每一種區塊都要帶 style —— 只要有一種漏掉，那一種就會退回 CSS 的自動排版，
     跟其他明寫列號的區塊混在一起就會錯位或留下空洞。
     2026-08-21 第一版漏了 heading 與 embed，影片就是這樣跑掉的。 */
  const placeStyle = withRow(blockPlacement(b));
  const styleAttr = placeStyle ? ` style="${placeStyle}"` : '';

  if (b.type === 'heading') {
    const tag = b.level === 'h1' ? 'h2' : 'h3';   // 內頁只有作品名是 h1
    return `      <${tag} class="case-section"${styleAttr}>${esc(b.text)}</${tag}>`;
  }

  /* 文字區塊可以有自己的板塊底色（projects.json 的 bg，後台有色票）。

     有底色時要多包一層 div：底色、內距、圓角都在那一層，段落本身維持原樣。
     這也表示 .case-gallery > p 這條直接子選擇器選不到被包起來的段落，
     所以 CSS 另外有一組 .text-panel p —— 兩邊的行寬與行高要一致，
     改一邊就要改另一邊。

     文字顏色是量出來的，不是另一個要她填的欄位：底色暗就翻白字。
     門檻 0.45 比 0.5 略低，因為白字在中間灰上比黑字更容易讀。 */
  if (b.type === 'text') {
    const bg = blockBg(b);
    if (!bg) return `      ${paragraph(b.text, withRow(blockPlacement(b)))}`;
    const lum = luminance(bg);
    const ink = lum !== null && lum < 0.45 ? ';color:#fff' : '';
    const style = withRow(`${blockPlacement(b)};background:${bg}${ink}`.replace(/^;/, ''));
    return `      <div class="text-panel" style="${style}">${paragraph(b.text)}</div>`;
  }

  if (b.type === 'embed') {
    if (b.provider === 'vimeo' && b.id) {
      const params = [
        'badge=0', 'autopause=0', 'player_id=0', 'app_id=58479',
        'title=0', 'byline=0', 'portrait=0', 'dnt=1',
        b.autoplay ? 'autoplay=1&muted=1' : '',
        b.loop ? 'loop=1' : '',
      ].filter(Boolean).join('&');
      return `      <div class="embed"${styleAttr}>
        <iframe src="https://player.vimeo.com/video/${esc(b.id)}?${params}"
          title="${esc(b.title || 'Vimeo video')}" loading="lazy"
          allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
      </div>`;
    }
    return `      <div class="embed"${styleAttr}><iframe src="${esc(b.url)}" title="Embedded video" loading="lazy" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`;
  }

  if (b.type !== 'media') return '';

  const width = MEDIA.fullWidth || 1600;
  const src = mediaUrl(b, slug, width, base);
  const dim = `${b.w ? ` width="${esc(b.w)}"` : ''}${b.h ? ` height="${esc(b.h)}"` : ''}`;

  /* 這張圖在內頁佔多寬，算成一個百分比直接餵給 CSS 的 max-width。

     預設是自動的：比 case.wideRatio（16:9）窄的圖會收窄、左右留白，
     算法讓所有媒體的高度一致 —— 就是一張 16:9 滿寬時的高度。
     正方形 56%、3:4 直式 42%、4:3 是 75%、16:9 及更寬 100%。

     每張圖都可以在 projects.json 那個 block 加 "width" 蓋掉：
       "width": "full"   滿版
       "width": "70%"    自己指定
     沒有尺寸資料的舊區塊就滿版（算不出比例）。

     這裡直接算成百分比而不是在 CSS 裡 calc，是因為個別覆寫進來之後
     CSS 那邊會變成三種情況混在一起，算好一個值最單純。 */
  function mediaMaxWidth() {
    const w = String(b.width || '').trim().toLowerCase();
    if (w === 'full') return '100%';
    if (/^\d+(\.\d+)?%$/.test(w)) return w;
    if (!b.w || !b.h) return '100%';
    const wide = ratioNum((site.case || {}).wideRatio || '16 / 9');
    return `${Math.min(100, (b.w / b.h) / wide * 100).toFixed(1)}%`;
  }
  const ratioStyle = ` style="${withRow(blockPlacement(b) || `--media-max:${mediaMaxWidth()}`)}"`;

  // #eye：跟著滑鼠轉
  let eye = '';
  if (b.eye) {
    eye = ' data-eye';
    if (b.eye.rollspeed != null) eye += ` data-rollspeed="${esc(b.eye.rollspeed)}"`;
    if (b.eye.range != null) eye += ` data-range="${esc(b.eye.range)}"`;
    if (b.eye.rotation != null) eye += ` data-rotation="${esc(b.eye.rotation)}"`;
  }

  let el;
  if (isVideo(b)) {
    const poster = posterUrl(b, slug, base);
    el = `<video src="${esc(src)}"${dim}${ratioStyle}${eye} autoplay muted loop playsinline`
      + `${poster ? ` poster="${esc(poster)}"` : ''} preload="metadata"></video>`;
  } else {
    // 同時給兩種寬度讓瀏覽器挑，手機不用載大圖
    const srcset = (MEDIA_SOURCE === 'cargo' && b.hash && b.file)
      ? ` srcset="${esc(mediaUrl(b, slug, Math.round(width / 2), base))} ${Math.round(width / 2)}w, ${esc(src)} ${width}w" sizes="(max-width: 700px) 100vw, ${width}px"`
      : '';
    el = `<img src="${esc(src)}"${srcset} alt="${esc(b.alt || b.caption || '')}"${dim}${ratioStyle}${eye}`
      + `${i === 0 ? '' : ' loading="lazy"'} decoding="async">`;
  }

  if (!b.caption) return `      ${el}`;

  /* 有圖說時寬度上限要掛在 figure 上，圖說才會跟收窄後的圖片左邊對齊。
     所以 --r 從元素身上移到 figure，元素自己填滿 figure 就好，不能再收一次。 */
  return `      <figure${ratioStyle}>
        ${el.replace(ratioStyle, '')}
        <figcaption class="caption">${esc(b.caption)}</figcaption>
      </figure>`;
}

/* 首頁網格的統計，產生後印出來看。renderIndex() 會填。 */
let INDEX_STATS = null;

/* ------------------------------------------------------ 直式高卡的位置 ---- */

/* 首頁有一部分縮圖是「直式高卡」（grid-row: span 2），版面才不會是死板的方格。
   哪幾件當高卡不能隨便挑：高卡佔兩列，位置沒排好就會在網格中間留下永久空洞
   （CSS 自動排版的游標只會前進，被跳過的格子填不回來）。
   所以這裡邊排邊模擬，並且優先讓「原本就是直式」的作品當高卡 —— 那樣它不必被
   裁成橫式，是同一套素材下最省裁切的分配。 */
function pickTallCards(ratios, cols, opts) {
  const { portraitMax = 0.95, minGap = 4 } = opts || {};
  const n = ratios.length;

  const grid = [];
  const at = (r, c) => (grid[r] ? grid[r][c] : undefined);
  const put = (r, c) => { (grid[r] ||= [])[c] = 1; };

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

  const tall = new Set();
  const perCol = new Array(cols).fill(0);
  const perRow = new Map();
  let cur = 0;
  let lastTall = -99;

  for (let i = 0; i < n; i++) {
    const portrait = (ratios[i] || 1) < portraitMax;
    let asTall = false;
    // 尾巴不放高卡，最後一列才容易填滿
    if ((portrait || i - lastTall > minGap) && i < n - cols) {
      const t = spot(cur, 2);
      const balanced = perCol[t.c] <= Math.min(...perCol) + (portrait ? 1 : 0);
      // 一列最多 cols-1 張高卡：整列都是高卡會變成一整條直式帶狀，失去交錯的節奏
      const cap = cols - 1;
      const rowOk = (perRow.get(t.r) || 0) < cap && (perRow.get(t.r + 1) || 0) < cap;
      if (!holeBefore(t.p) && balanced && rowOk) asTall = true;
    }
    const h = asTall ? 2 : 1;
    const s = spot(cur, h);
    for (let k = 0; k < h; k++) put(s.r + k, s.c);
    cur = s.p;
    if (asTall) {
      tall.add(i); perCol[s.c]++; lastTall = i;
      perRow.set(s.r, (perRow.get(s.r) || 0) + 1);
      perRow.set(s.r + 1, (perRow.get(s.r + 1) || 0) + 1);
    }
  }

  // 最後一列如果缺格，逐張把尾端的高卡改回普通卡直到填滿。
  // 每移掉一張整個排版都會變，所以每次都要重新模擬，不能只算一次。
  let res = gridHoles(tall, n, cols);
  while (res.holes && tall.size) {
    tall.delete(Math.max(...tall));
    res = gridHoles(tall, n, cols);
  }
  return tall;
}

/** 重跑一次自動排版，回報空格。產生後用來自我檢查，不影響輸出。 */
function gridHoles(tall, n, cols) {
  const grid = [];
  const at = (r, c) => (grid[r] ? grid[r][c] : undefined);
  const put = (r, c) => { (grid[r] ||= [])[c] = 1; };
  let cur = 0, maxRow = 0;
  for (let i = 0; i < n; i++) {
    const h = tall.has(i) ? 2 : 1;
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
  let holes = 0;
  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c < cols; c++) if (at(r, c) === undefined) holes++;
  }
  return { holes, rows: maxRow + 1 };
}

/* ------------------------------------------------------------ 首頁 ---- */

function renderIndex() {
  const h = site.hero || {};

  const tw = MEDIA.thumbWidth || 800;

  const g = site.grid || {};
  const cols = g.columns ?? 12;
  const showTitles = g.showTitles !== false;

  // hideFromGrid 的作品仍會有自己的頁面，只是不出現在首頁網格（例如 Reel 在導覽列）
  const shown = projects.filter((p) => !p.hideFromGrid);

  /* 直式高卡。比例取自 projects.json 的 thumb w/h（tools/set-card-colors.mjs 會補齊），
     所以 build 不需要動到 ffmpeg，維持零依賴。 */
  const tallCfg = g.tall || {};
  const ratios = shown.map((p) => {
    const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media');
    return t && t.w && t.h ? t.w / t.h : 1;
  });
  const tall = tallCfg.enabled === false
    ? new Set()
    : pickTallCards(ratios, Math.max(1, Math.floor(cols / (g.span ?? 4))), tallCfg);

  const thumbs = shown.map((p, i) => {
    const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media') || null;
    const isTall = tall.has(i);
    let inner = '';

    if (t) {
      const src = mediaUrl(t, p.slug, tw, '');
      if (isVideo(t)) {
        // poster 讓影片還沒載入時先顯示第一幀，網格不會出現空格。
        // 只播畫面內的影片是 site.js 做的（首頁有 20 支自動循環影片）。
        const poster = posterUrl(t, p.slug, '');
        inner = `<video src="${esc(src)}" autoplay muted loop playsinline`
          + `${poster ? ` poster="${esc(poster)}"` : ''} preload="${i < 6 ? 'auto' : 'none'}"></video>`;
      } else {
        // 一行三格，單格約佔視窗三分之一寬
        const half = mediaUrl(t, p.slug, Math.round(tw / 2), '');
        const srcset = (MEDIA_SOURCE === 'cargo' && t.hash)
          ? ` srcset="${esc(half)} ${Math.round(tw / 2)}w, ${esc(src)} ${tw}w" sizes="(max-width: 620px) 100vw, 33vw"`
          : '';
        inner = `<img src="${esc(src)}"${srcset} alt="${esc(p.title)}"`
          + `${i < 6 ? '' : ' loading="lazy"'} decoding="async">`;
      }
    }

    /* 可變欄寬。預設由 :root 的 --span 決定（一行三格 = 4 欄），
       個別作品想放大就在 projects.json 加 span / spanTablet / spanMobile。 */
    const styleBits = [];
    const span = Number(p.span) > 0 ? Math.min(Number(p.span), cols) : 0;
    if (span) styleBits.push(`--span:${span}`);
    if (Number(p.spanTablet) > 0) styleBits.push(`--span-t:${Math.min(Number(p.spanTablet), cols)}`);
    if (Number(p.spanMobile) > 0) styleBits.push(`--span-m:${Math.min(Number(p.spanMobile), cols)}`);
    if (p.ratio) {
      // 個別比例也要給數值版，否則這張如果是高卡，撐高度的 calc 會用到全站預設值
      styleBits.push(`--card-ratio:${p.ratio}`);
      styleBits.push(`--card-ratio-num:${ratioNum(p.ratio)}`);
    }
    // hover 色塊的顏色。tools/set-card-colors.mjs 從縮圖取平均色寫進 projects.json，
    // 不喜歡就直接改那裡的 cardColor。
    if (p.cardColor) styleBits.push(`--card-color:${p.cardColor}`);
    const style = styleBits.length ? ` style="${esc(styleBits.join(';'))}"` : '';

    const meta = [p.year, p.type].filter(Boolean).join(' · ');
    const info = !showTitles ? '' : `
      <div class="thumbnail-info${p.cardColorDark ? ' is-dark' : ''}" aria-hidden="true">
        <span class="thumbnail-name">${esc(p.title)}</span>
${meta ? `        <span class="thumbnail-meta">${esc(meta)}</span>\n` : ''}      </div>
      <div class="thumbnail-mobile-info">
        <span class="thumbnail-name">${esc(p.title)}</span>
${meta ? `        <span class="thumbnail-meta">${esc(meta)}</span>\n` : ''}      </div>`;

    return `    <a class="thumbnail${isTall ? ' thumbnail--tall' : ''}" href="work/${esc(p.slug)}.html"${style}>
      <div class="thumbnail-frame">${inner}</div>
      <div class="thumbnail-overlay" aria-hidden="true"></div>${info}
    </a>`;
  }).join('\n');

  // 自我檢查：排版不該有空洞。有的話在 build 輸出警告，不要靜靜地產生壞版面。
  const perRowCols = Math.max(1, Math.floor(cols / (g.span ?? 4)));
  const { holes, rows } = gridHoles(tall, shown.length, perRowCols);
  if (holes) {
    console.log(`  ⚠ 首頁網格有 ${holes} 個空格（${perRowCols} 欄、${rows} 列）`);
  }
  INDEX_STATS = { count: shown.length, tall: tall.size, rows, holes, perRowCols };

  /* 首頁大標怎麼出現。預設跟著 effects.reveal（全站），hero.reveal 有填才蓋掉：
       letter  逐字浮現（舊站的效果）
       line    整行一起出現，副標接著整行出現
       none    不做動畫

     副標在三種模式下用不同的做法：逐字模式它自己也逐字浮現（data-split）；
     整行模式改成 .stagger-item，這樣它會在大標那一行之後接上；不做動畫
     時就是一段普通文字，什麼 class 都不加。所以這裡一定要知道最終是哪個模式，
     不能只靠 <html> 上的預設值。 */
  const revealDefault = ['line', 'none', 'letter'].includes((site.effects || {}).reveal)
    ? site.effects.reveal
    : 'letter';
  const heroMode = ['line', 'none', 'letter'].includes(h.reveal) ? h.reveal : revealDefault;
  const heroAttr = ` data-reveal="${heroMode}"`;
  const subClass = heroMode === 'line' ? 'display-l stagger-item' : 'display-l';
  const subAttr = heroMode === 'letter' ? ' data-split' : '';

  const body = `  <section class="hero" data-stagger-scope>
    <h1 class="display-xl"${heroAttr}>${esc(h.headline || site.name)}</h1>
${h.sub ? `    <p class="${subClass}"${subAttr}>${esc(h.sub)}</p>\n` : ''}  </section>

  <section class="thumbnails" aria-label="Selected work">
${thumbs}
  </section>`;

  return layout({
    title: site.name,
    desc: site.description,
    body,
    base: '',
    current: 'index.html',
    page: 'index',
    ogImage: projects[0] && projects[0].thumb ? mediaUrl(projects[0].thumb, projects[0].slug, 1200, '') : null,
  });
}

/* -------------------------------------------------------- 作品內頁 ---- */

/** 封面媒體。跟內文的媒體差在兩點：不 lazy load（在第一屏），而且會被裁切填滿。 */
/* 封面圖在封面框裡的位置與縮放（projects.json 每一筆的 coverPosition / coverScale）。

   封面是 object-fit: cover 裁切的，所以「看得到哪一塊」由 object-position 決定 ——
   預設 50% 50%（居中），直式素材因此只看得到中段。coverScale 再往上放大，
   例如 1.4 就是放大到 140%、可以把主體推滿畫面。

   縮放用 transform: scale 而不是動 object-fit：scale 1 的時候剛好等於原本的
   cover 行為，往上加只會裁更多，不會出現填不滿的空邊。小於 1 會露出空邊，
   所以後台的滑桿下限就是 1。 */
const COVER_POS_DEFAULT = '50% 50%';

/** "50% 50%" 這種兩個百分比的字串才算有效，其他一律當沒設。 */
function coverPos(p) {
  const raw = String(p.coverPosition || '').trim();
  return /^\d+(\.\d+)?% \d+(\.\d+)?%$/.test(raw) ? raw : COVER_POS_DEFAULT;
}

/** 1 ~ 3 之間才算有效放大。小於 1 會露出空邊，所以不接受。 */
function coverScale(p) {
  const n = Number(p.coverScale);
  return Number.isFinite(n) && n > 1 ? Math.min(n, 3) : 1;
}

function coverMediaStyle(p) {
  const pos = coverPos(p);
  const scale = coverScale(p);
  const bits = [];
  if (pos !== COVER_POS_DEFAULT) bits.push(`object-position:${pos}`);
  if (scale > 1) {
    bits.push(`transform:scale(${scale})`);
    // 縮放的基準點跟著構圖點走，理由見 site.css 的 .case-cover > * 註解
    if (pos !== COVER_POS_DEFAULT) bits.push(`transform-origin:${pos}`);
  }
  return bits.length ? ` style="${bits.join(';')}"` : '';
}

function renderCover(m, slug, base, style = '') {
  const src = mediaUrl(m, slug, MEDIA.fullWidth || 1600, base);
  const dim = `${m.w ? ` width="${esc(m.w)}"` : ''}${m.h ? ` height="${esc(m.h)}"` : ''}`;
  if (isVideo(m)) {
    const poster = posterUrl(m, slug, base);
    return `<video src="${esc(src)}"${dim}${style} autoplay muted loop playsinline`
      + `${poster ? ` poster="${esc(poster)}"` : ''} preload="auto"></video>`;
  }
  return `<img src="${esc(src)}"${dim}${style} alt="" fetchpriority="high" decoding="async">`;
}

function renderProject(p, prev, next) {
  const base = '../';
  const cs = site.case || {};
  const L = cs.labels || {};

  // blocks 為主；舊格式的 media/text 也還支援。
  // 下面會從頭部拿掉幾個區塊，所以複製一份再動。
  const blocks = ((p.blocks && p.blocks.length)
    ? p.blocks
    : [
      ...(p.media || []).map((m) => ({ type: 'media', ...m })),
      ...(p.text || []).map((t) => ({ type: 'text', text: t })),
    ]).slice();

  /* 封面預設就用首頁那張縮圖 —— 每件作品都有（包含只嵌 Vimeo、沒有圖片區塊的
     那 18 件），而且 GIF 縮圖已經轉成 MP4，會自動循環播放，跟 Bito 首頁一樣是動的。
     想指定別的圖就在 projects.json 那一筆加 "cover"，格式跟 thumb 相同。 */
  const cover = p.cover || (cs.coverFromThumb === false ? null : p.thumb);

  /* 前導敘述搬進資訊列（Bito 的 .info 就是標題加一段敘述）。
     只吃最前面連續的 text 區塊 —— 碰到圖片、影片或小標就停，
     因為那些是內文的一部分，不是作品簡介。 */
  const blurb = [];
  while (blocks.length && blocks[0].type === 'text') blurb.push(blocks.shift().text);

  /* 封面用的檔案如果也排在內文裡，預設把內文那張拿掉，不然同一張圖會出現兩次
     （52 件裡有 23 件是這種情況）。

     單獨某一件想讓封面那張**也**在內文出現一次，就加 "coverInBody": true，
     後台的封面區有勾選框。

     2026-08-21 改成「在內文的任何位置都算」。原本只比對內文的第一張圖，所以
     封面挑到第二張以後的圖時就不會去重，同一份資料會因為圖的位置不同得到兩種
     行為 —— 後台現在可以自由挑封面，這種不一致只會越來越常撞到。改的當下正好
     有 3 件是這種狀況（happiness-awaits、Afternoon-Tea-Time、Nodding-Off），
     都補上了 coverInBody，所以那 3 頁的輸出完全沒變。 */
  if (cover && cover.file && cs.dedupeCover !== false && p.coverInBody !== true) {
    const i = blocks.findIndex((b) => b.type === 'media' && b.file === cover.file);
    if (i !== -1) blocks.splice(i, 1);
  }

  /* 列號要在這裡一次算完 —— 它取決於「前面的區塊佔掉了哪些欄」，
     所以是整份清單的性質，不是單一區塊能決定的。要在去重之後才算，
     不然被拿掉的那張圖會佔掉一個列號、後面全部往下移一列。 */
  const rows = assignRows(blocks);

  const gallery = blocks
    .map((b, i) => renderBlock(b, i, p.slug, base, rows[i]))
    .filter(Boolean)
    .join('\n');

  /* 資訊列右半邊。空的欄位不會產生，所以順序只影響「有填的那幾格」怎麼排。

     type 與 year 留在最前面，現有資料的顯示順序完全沒變。role 與 agency 是
     2026-08-21 新增的（參考 therocketpanda.com 的 Year／Role／Agency）——
     排在 year 後面，所以只填這三格的作品讀起來就跟參考圖一樣。

     ⚠ type 這個欄位以前叫 role，同一天改名的。它存的是「作品類型」
     （Personal work、Graduation project），顯示的標籤一直是 Type；
     現在真正的 role 是「你在這件作品裡做什麼」（Motion Design 這種）。 */
  const facts = [];
  if (p.type) facts.push([L.type || 'Type', p.type]);
  if (p.year) facts.push([L.year || 'Year', p.year]);
  if (p.role) facts.push([L.role || 'Role', p.role]);
  if (p.agency) facts.push([L.agency || 'Agency', p.agency]);
  if (p.client) facts.push([L.client || 'Client', p.client]);
  if ((p.tags || []).length) facts.push([L.tags || 'Tags', p.tags.join(', ')]);

  // blurbLines 設 0 就不收合，連按鈕都不產生
  const clamp = Number(cs.blurbLines ?? 4) > 0;

  const out = ['  <article class="case">'];

  if (cover) {
    // data-fill 給 site.js 看：要不要把高度算成「視窗高 - 資訊列高」
    out.push(`    <div class="case-cover" data-fill="${cs.fillFirstScreen === false ? 'false' : 'true'}">`);
    out.push('      ' + renderCover(cover, p.slug, base, coverMediaStyle(p)));
    out.push('    </div>');
  }

  /* 沒有敘述的作品（52 件裡有 21 件）標成 data-lean，CSS 會把整段收緊。
     大字敘述的版型靠大量留白撐起來，但左邊只有一個標題的時候，同樣的留白
     就只是一片空白，右邊兩個欄位還被拉開快 250px。 */
  out.push(`    <div class="case-info" data-stagger-scope${blurb.length ? '' : ' data-lean'}>`);
  out.push('      <div class="case-name">');
  out.push(`        <h1 class="case-title">${esc(p.title)}</h1>`);
  if (blurb.length) {
    out.push(`        <div class="case-blurb"${clamp ? ' data-clamp' : ''}>`);
    blurb.forEach((t) => out.push(`          ${paragraph(t)}`));
    out.push('        </div>');
    if (clamp) {
      out.push('        <button class="case-more" type="button" hidden'
        + ` data-more="${esc(L.more || 'More')}" data-less="${esc(L.less || 'Less')}">${esc(L.more || 'More')}</button>`);
    }
  }
  out.push('      </div>');

  if (facts.length) {
    out.push('      <dl class="case-facts">');
    facts.forEach(([k, v]) => out.push(
      `        <div class="case-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
    ));
    out.push('      </dl>');
  }
  out.push('    </div>');

  if (gallery) {
    out.push('    <div class="case-gallery">');
    out.push(gallery);
    out.push('    </div>');
  }

  out.push('    <nav class="case-nav" aria-label="More work">');
  out.push(`      <a href="${base}index.html">← All work</a>`);
  if (next) out.push(`      <a href="${esc(next.slug)}.html">${esc(next.title)} →</a>`);
  out.push('    </nav>');
  out.push('  </article>');

  const body = out.join('\n');

  return layout({
    title: `${p.title} — ${site.name}`,
    desc: p.summary || `${p.title} — ${site.description}`,
    body,
    base,
    current: null,
    page: 'work',
    coverDark: !!(cover && p.coverTopDark),
    hasCover: !!cover,
    ogImage: p.thumb ? mediaUrl(p.thumb, p.slug, 1200, '') : null,
  });
}

/* ------------------------------------------------------ Information ---- */

function renderInformation() {
  const info = site.information || {};
  const mail = site.email || {};

  const paras = (info.body || []).map((t) => `        <p>${esc(t)}</p>`).join('\n');

  const blocks = (info.sections || []).map((s) => `      <div class="info-block">
        <h2>${esc(s.heading)}</h2>
        <ul class="info-list">
${(s.items || []).map((it) => `          <li>${esc(it)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n');

  const clients = (info.clients || []).length ? `      <div class="info-block">
        <h2>${esc(info.clientsHeading || "✸ Brands I've Designed & Animated For")}</h2>
        <ul class="info-list">
${info.clients.map((c) => `          <li>${esc(c)}</li>`).join('\n')}
        </ul>
      </div>` : '';

  const social = (site.social || []).map((s) =>
    `          <li><a class="link-accent wiggle-text" href="${esc(externalUrl(s.href))}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`
  ).join('\n');

  /* 左邊的照片。沒設 information.image 就整個不產生，版面自動變回單欄
     —— 這樣「還沒挑好照片」不會留下一個空框。 */
  const photo = info.image ? `    <div class="info-photo">
      <img src="${esc(info.image)}" alt="${esc(info.imageAlt || '')}"
        width="${esc(info.imageW || 1200)}" height="${esc(info.imageH || 1200)}"
        fetchpriority="high" decoding="async">
    </div>` : '';

  const body = `  <section class="info" data-stagger-scope>
    <div class="info-grid${photo ? '' : ' is-single'}">
${photo}
      <div class="info-main">
        <h1 class="info-title">${esc(info.heading || 'Information')}</h1>

        <div class="info-body body-text stagger-item">
${paras}
        </div>

${clients}
${blocks}

        <div class="info-block">
          <h2>${esc(info.contactLabel || 'Contact')}</h2>
          <p><a class="contact-mail mailto" data-user="${esc(mail.user)}" data-domain="${esc(mail.domain)}" href="#">${esc(mail.user)}@${esc(mail.domain)}</a></p>
          <ul class="info-list info-social">
${social}
          </ul>
        </div>
      </div>
    </div>
  </section>`;

  return layout({
    title: `Information — ${site.name}`,
    desc: (info.body || [])[0] || site.description,
    body,
    base: '',
    current: 'information.html',
    page: 'info',
    // 上面的聯絡區塊已經列了同一組連結，頁尾不要再來一次
    hideFooterSocial: true,
  });
}

/* ------------------------------------------------------------- 404 ---- */

function render404() {
  return layout({
    title: `Not found — ${site.name}`,
    desc: 'Page not found.',
    body: `  <section class="info">
    <h1 class="display-l">This page doesn't exist.</h1>
    <p style="margin-top:2rem"><a class="link-accent" href="/">← Back to work</a></p>
  </section>`,
    base: '',
    current: null,
    page: '404',
  });
}

/* ------------------------------------------------------------ 產出 ---- */

const written = [];
const out = (rel, content) => {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  written.push(rel);
};

/* --only：只做那一頁的預覽就結束。
   刻意不走下面的流程 —— 那裡會先把 work/ 裡所有 html 刪掉再全部重產，
   預覽不該動到任何正式頁面。也不產生首頁、sitemap、不複製 assets。 */
if (ONLY) {
  const i = projects.findIndex((p) => p.slug === ONLY);
  if (i === -1) {
    console.error(`找不到作品「${ONLY}」。可能是被設為草稿（draft）—— 草稿不會產生頁面。`);
    process.exit(1);
  }
  out('work/_preview.html', renderProject(projects[i], projects[i - 1] || null, projects[i + 1] || null));
  console.log(`✓ 預覽：work/_preview.html　${projects[i].title}`);
  process.exit(0);
}

/* Information 頁的預覽。跟上面的 --only 一樣要放在下面那段「清掉舊作品頁」之前，
   不然按一次預覽就會把 work/ 裡的頁面全部刪掉再只補一頁回去。 */
if (PREVIEW_INFO) {
  out('_preview-info.html', renderInformation());
  console.log('✓ 預覽：_preview-info.html');
  process.exit(0);
}

// 先清掉上一次產生的作品頁，這樣 projects.json 刪掉的作品不會留下孤兒檔
const workDir = join(ROOT, 'work');
if (existsSync(workDir)) {
  for (const f of readdirSync(workDir)) {
    if (f.endsWith('.html')) rmSync(join(workDir, f));
  }
}

out('index.html', renderIndex());
out('information.html', renderInformation());
out('404.html', render404());

projects.forEach((p, i) => {
  out(`work/${p.slug}.html`, renderProject(p, projects[i - 1] || null, projects[i + 1] || null));
});

// sitemap / robots
const urls = ['', 'information.html', ...projects.map((p) => `work/${p.slug}.html`)];
out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${site.url}/${u}</loc></url>`).join('\n')}
</urlset>
`);
out('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);
out('.nojekyll', '');

// 複製樣式與腳本
for (const [from, to] of [['src/css', 'assets/css'], ['src/js', 'assets/js']]) {
  const src = join(ROOT, from);
  if (!existsSync(src)) continue;
  mkdirSync(join(ROOT, to), { recursive: true });
  for (const f of readdirSync(src)) {
    copyFileSync(join(src, f), join(ROOT, to, f));
    written.push(`${to}/${f}`);
  }
}

/* ------------------------------------------------------------ 回報 ---- */

const tally = (fn) => projects.reduce((n, p) => n + (p.blocks || []).filter(fn).length, 0);
const images = tally((b) => b.type === 'media');
const embeds = tally((b) => b.type === 'embed');
const paras = tally((b) => b.type === 'text');
const empty = projects.filter((p) => !(p.blocks || []).length);

console.log(`\n✓ 產生完成（媒體來源：${MEDIA_SOURCE}）`);
console.log(`  ${projects.length} 個作品頁、${written.length} 個檔案`);
console.log(`  圖片 ${images}、Vimeo 嵌入 ${embeds}、文字段落 ${paras}`);
if (INDEX_STATS) {
  console.log(`  首頁 ${INDEX_STATS.count} 張縮圖、一行 ${INDEX_STATS.perRowCols} 格、`
    + `${INDEX_STATS.tall} 張直式高卡、${INDEX_STATS.rows} 列`
    + `${INDEX_STATS.holes ? `、⚠ ${INDEX_STATS.holes} 個空格` : '、無空格'}`);
}
if (empty.length) {
  console.log(`\n⚠ 完全沒有內容的作品（${empty.length}）：${empty.map((p) => p.slug).join(', ')}`);
}

/* 本機檔名撞名檢查。
   同一件作品裡不同的圖（不同 hash）可能用同一個檔名 —— Cargo 用 hash 定址所以
   允許。本機是用檔名存的，撞名的話會互相蓋掉：頁面上同一張圖重複出現，
   另外幾張根本沒下載，而且完全不會報錯。2026-08-21 在 Dancing-Christmas-Tree
   身上就是這樣（三張不同的圖都叫 _00000.png，線上只看得到一張）。
   解法是在那些區塊補 localFile。這裡負責在漏填時吼一聲。 */
{
  const collisions = [];
  for (const p of projects) {
    const byName = new Map();
    const consider = [p.thumb, ...(p.blocks || []).filter((b) => b.type === 'media')];
    for (const m of consider) {
      if (!m || !m.file || !m.hash) continue;
      const name = m.localFile || m.file;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(m.hash);
    }
    for (const [name, hashes] of byName) {
      if (hashes.size > 1) collisions.push({ slug: p.slug, name, count: hashes.size });
    }
  }
  if (collisions.length) {
    console.log(`\n⚠ 本機檔名撞名（${collisions.length} 處）—— 這些圖會互相蓋掉，頁面上會重複顯示同一張：`);
    collisions.forEach((c) => console.log(`    ${c.slug} 的 ${c.name} 有 ${c.count} 個不同的圖`));
    console.log('  修法：在 projects.json 那些 media 區塊加 "localFile"，給每一張不同的本機檔名');
    console.log('  （"file" 保持原樣不要動，Cargo 的網址需要它完全相符）');
  }
}

/* 字重有沒有真的載到。
   site.json 改了 headingWeight 卻忘記在 googleFonts 加上那個字重的話，
   瀏覽器會自己合成一個假的粗體（看起來糊、字寬也不對），而且不會有任何錯誤，
   很難發現。所以在這裡對一下。 */
{
  const gf = (site.fonts || {}).googleFonts || '';
  const loaded = new Set((gf.match(/\d{3}(?=[;&\s]|$)/g) || []));
  const wanted = [
    ['type.bodyWeight', (site.type || {}).bodyWeight || '400'],
    ['type.headingWeight', (site.type || {}).headingWeight || '700'],
    ['theme.navCurrentWeight', (site.theme || {}).navCurrentWeight || '700'],
    ['header.navWeight', (site.header || {}).navWeight || '400'],
  ];
  const missing = wanted.filter(([, w]) => /^\d{3}$/.test(w) && !loaded.has(w));
  if (gf && missing.length) {
    console.log(`\n⚠ 這些字重沒有在 fonts.googleFonts 裡載入，瀏覽器會合成假的字重：`);
    missing.forEach(([k, w]) => console.log(`    ${k} = ${w}`));
    console.log(`  已載入的是：${[...loaded].sort().join('、') || '（無）'}`);
  }
}
if (MEDIA_SOURCE === 'cargo') {
  console.log(`\n⚠ 圖片目前直接連 Cargo CDN。停用 Cargo 帳號後圖會全部失效，`);
  console.log(`  記得跑 download-media.mjs 把圖抓到本機，再把 site.json 的 media.source 改成 "local"。`);
}
console.log('');
