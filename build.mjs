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

const site = read('content/site.json');

// projects.json 可以是純陣列，也可以是 { _說明, projects: [...] }
const rawProjects = read('content/projects.json');
const projects = (Array.isArray(rawProjects) ? rawProjects : rawProjects.projects || [])
  .filter((p) => p && p.slug && !p.draft);

/* ---------------------------------------------------------------- 工具 ---- */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** site.json 裡以 _ 開頭的鍵是給人看的說明，輸出時要忽略 */
const isNote = (k) => k.startsWith('_');

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
const localName = (file) => file.replace(/\.[^.]+$/, '') + (isGifFile(file) ? '.mp4' : '.webp');
const posterName = (file) => file.replace(/\.[^.]+$/, '') + '.webp';

/** 本機的 GIF 已轉成 MP4，所以在 local 模式下 GIF 也算影片 */
const isVideo = (m) => m.tag === 'video'
  || VIDEO_EXT.test(m.file || m.src || '')
  || (MEDIA_SOURCE === 'local' && isGifFile(m.file));

function mediaUrl(m, slug, width, base) {
  if (!m) return '';
  if (MEDIA_SOURCE === 'local') {
    if (!m.file) return base + (m.url || '');
    return `${base}assets/media/${slug}/${encodeURIComponent(localName(m.file))}`;
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
  return `${base}assets/media/${slug}/${encodeURIComponent(posterName(m.file))}`;
}

/* ------------------------------------------------------- 主題變數注入 ---- */

function themeVars() {
  const t = site.theme || {};
  const g = site.grid || {};
  const f = site.fonts || {};
  const c = site.cursors || {};

  const ty = site.type || {};

  const lines = [
    `--bg: ${t.bg || '#fff'};`,
    `--ink: ${t.ink || 'rgba(0,0,0,.75)'};`,
    `--ink-strong: ${t.inkStrong || '#000'};`,
    `--accent: ${t.accent || '#f02'};`,
    `--accent-hover: ${t.accentHover || '#ff5b90'};`,
    `--accent-active: ${t.accentActive || '#252525'};`,
    `--caption-color: ${t.caption || 'rgba(0,0,0,.3)'};`,
    `--caption-size: ${t.captionSize || '1.4rem'};`,
    `--font-display: ${f.display || 'sans-serif'};`,
    `--font-body: ${f.body || 'sans-serif'};`,
    `--font-caption: ${f.caption || f.body || 'sans-serif'};`,
    // 字級：舊站是固定值，首頁大標拉出來可調
    `--hero-size: ${ty.heroSize || 'clamp(2.6rem, 4.5vw, 5.2rem)'};`,
    `--title-size: ${ty.titleSize || '2.2rem'};`,
    `--body-size: ${ty.bodySize || '1.4rem'};`,
    `--body-lh: ${ty.bodyLineHeight || '1.2'};`,
    `--heading-weight: ${ty.headingWeight || '700'};`,
    `--grid-cols: ${g.columns ?? 10};`,
    `--grid-cols-tablet: ${g.columnsTablet ?? 5};`,
    `--grid-cols-mobile: ${g.columnsMobile ?? 2};`,
    `--grid-gutter: ${g.gutter || '1.5rem'};`,
    `--pad: 3.5rem;`,
  ];

  let css = `:root{${lines.join('')}}`;

  // 自訂游標：只有填了路徑才輸出，避免指向不存在的檔案
  if (c.page) css += `html{cursor:url("${c.page}"),auto}`;
  if (c.image) css += `.case-media img,.thumbnail-frame img{cursor:url("${c.image}"),auto}`;

  return css;
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

  const navLinks = (site.nav || [])
    .filter((n) => !isNote(n.label || ''))
    .map((n) => {
      const href = base + n.href;
      const cur = n.href === o.current ? ' aria-current="page"' : '';
      return `<a href="${esc(href)}"${cur}>${esc(n.label)}</a>`;
    })
    .join('\n        ');

  const mail = site.email || {};

  return `<!DOCTYPE html>
<html lang="${esc(site.lang || 'en')}">
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

<style>${themeVars()}</style>
<link rel="stylesheet" href="${base}assets/css/site.css">
<link rel="stylesheet" href="${base}assets/css/effects.css">
</head>

<body>
<a class="skip" href="#main">Skip to content</a>

<header class="nav">
  <a class="nav-brand" href="${base}index.html">${esc(site.name)}</a>
  <nav class="nav-links" aria-label="Main">
        ${navLinks}
  </nav>
</header>

<main id="main">
${o.body}
</main>

<footer class="footer">
  <p>© <span id="year">${new Date().getFullYear()}</span> ${esc(site.name)}</p>
  <p><a class="wiggle-text mailto" data-user="${esc(mail.user)}" data-domain="${esc(mail.domain)}" href="#">${esc(mail.user)}@${esc(mail.domain)}</a></p>
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
function renderBlock(b, i, slug, base) {
  if (b.type === 'heading') {
    const tag = b.level === 'h1' ? 'h2' : 'h3';   // 內頁只有作品名是 h1
    return `      <${tag} class="case-section">${esc(b.text)}</${tag}>`;
  }

  if (b.type === 'text') {
    return `      <p>${esc(b.text)}</p>`;
  }

  if (b.type === 'embed') {
    if (b.provider === 'vimeo' && b.id) {
      const params = [
        'badge=0', 'autopause=0', 'player_id=0', 'app_id=58479',
        'title=0', 'byline=0', 'portrait=0', 'dnt=1',
        b.autoplay ? 'autoplay=1&muted=1' : '',
        b.loop ? 'loop=1' : '',
      ].filter(Boolean).join('&');
      return `      <div class="embed">
        <iframe src="https://player.vimeo.com/video/${esc(b.id)}?${params}"
          title="${esc(b.title || 'Vimeo video')}" loading="lazy"
          allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
      </div>`;
    }
    return `      <div class="embed"><iframe src="${esc(b.url)}" title="Embedded video" loading="lazy" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`;
  }

  if (b.type !== 'media') return '';

  const width = MEDIA.fullWidth || 1600;
  const src = mediaUrl(b, slug, width, base);
  const dim = `${b.w ? ` width="${esc(b.w)}"` : ''}${b.h ? ` height="${esc(b.h)}"` : ''}`;

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
    el = `<video src="${esc(src)}"${dim}${eye} autoplay muted loop playsinline`
      + `${poster ? ` poster="${esc(poster)}"` : ''} preload="metadata"></video>`;
  } else {
    // 同時給兩種寬度讓瀏覽器挑，手機不用載大圖
    const srcset = (MEDIA_SOURCE === 'cargo' && b.hash && b.file)
      ? ` srcset="${esc(mediaUrl(b, slug, Math.round(width / 2), base))} ${Math.round(width / 2)}w, ${esc(src)} ${width}w" sizes="(max-width: 700px) 100vw, ${width}px"`
      : '';
    el = `<img src="${esc(src)}"${srcset} alt="${esc(b.alt || b.caption || '')}"${dim}${eye}`
      + `${i === 0 ? '' : ' loading="lazy"'} decoding="async">`;
  }

  if (!b.caption) return `      ${el}`;
  return `      <figure>
        ${el}
        <figcaption class="caption">${esc(b.caption)}</figcaption>
      </figure>`;
}

/* ------------------------------------------------------------ 首頁 ---- */

function renderIndex() {
  const h = site.hero || {};

  const tw = MEDIA.thumbWidth || 800;

  // hideFromGrid 的作品仍會有自己的頁面，只是不出現在首頁網格（例如 Reel 在導覽列）
  const thumbs = projects.filter((p) => !p.hideFromGrid).map((p, i) => {
    const t = p.thumb || (p.blocks || []).find((b) => b.type === 'media') || null;
    let inner = '';

    if (t) {
      const src = mediaUrl(t, p.slug, tw, '');
      const dim = `${t.w ? ` width="${esc(t.w)}"` : ''}${t.h ? ` height="${esc(t.h)}"` : ''}`;
      if (isVideo(t)) {
        // poster 讓影片還沒載入時先顯示第一幀，網格不會出現空格
        const poster = posterUrl(t, p.slug, '');
        inner = `<video src="${esc(src)}"${dim} autoplay muted loop playsinline`
          + `${poster ? ` poster="${esc(poster)}"` : ''} preload="${i < 10 ? 'auto' : 'none'}"></video>`;
      } else {
        // 縮圖只要一半寬度就夠，10 欄網格單格很小
        const half = mediaUrl(t, p.slug, Math.round(tw / 2), '');
        const srcset = (MEDIA_SOURCE === 'cargo' && t.hash)
          ? ` srcset="${esc(half)} ${Math.round(tw / 2)}w, ${esc(src)} ${tw}w" sizes="(max-width: 620px) 50vw, 12vw"`
          : '';
        inner = `<img src="${esc(src)}"${srcset} alt="${esc(p.title)}"${dim}`
          + `${i < 10 ? '' : ' loading="lazy"'} decoding="async">`;
      }
    }

    return `    <a class="thumbnail" href="work/${esc(p.slug)}.html">
      <div class="thumbnail-frame">${inner}</div>
${(site.grid || {}).showTitles !== false ? `      <div class="thumbnail-title">${esc(p.title)}</div>\n` : ''}    </a>`;
  }).join('\n');

  const body = `  <section class="hero" data-stagger-scope>
    <h1 class="display-xl">${esc(h.headline || site.name)}</h1>
${h.sub ? `    <p class="display-l" data-split>${esc(h.sub)}</p>\n` : ''}  </section>

  <section class="thumbnails" aria-label="Selected work">
${thumbs}
  </section>`;

  return layout({
    title: site.name,
    desc: site.description,
    body,
    base: '',
    current: 'index.html',
    ogImage: projects[0] && projects[0].thumb ? mediaUrl(projects[0].thumb, projects[0].slug, 1200, '') : null,
  });
}

/* -------------------------------------------------------- 作品內頁 ---- */

function renderProject(p, prev, next) {
  const base = '../';

  // blocks 為主；舊格式的 media/text 也還支援
  const blocks = (p.blocks && p.blocks.length)
    ? p.blocks
    : [
      ...(p.media || []).map((m) => ({ type: 'media', ...m })),
      ...(p.text || []).map((t) => ({ type: 'text', text: t })),
    ];

  const rendered = blocks
    .map((b, i) => renderBlock(b, i, p.slug, base))
    .filter(Boolean)
    .join('\n');

  const metaBits = [];
  if (p.role) metaBits.push(esc(p.role));
  if (p.year) metaBits.push(esc(p.year));
  if (p.client) metaBits.push(esc(p.client));
  (p.tags || []).forEach((t) => metaBits.push(esc(t)));

  const body = `  <article class="case">
    <header class="case-head" data-stagger-scope>
      <h1 class="display-l">${esc(p.title)}</h1>
${metaBits.length ? `      <p class="case-meta caption">${metaBits.join(' | ')}</p>\n` : ''}    </header>

    <div class="case-body">
${rendered || '      <!-- 這一頁還沒有內容 -->'}
    </div>

    <nav class="case-nav" aria-label="More work">
      <a href="${base}index.html">← All work</a>
      ${next ? `<a href="${esc(next.slug)}.html">${esc(next.title)} →</a>` : ''}
    </nav>
  </article>`;

  return layout({
    title: `${p.title} — ${site.name}`,
    desc: p.summary || `${p.title} — ${site.description}`,
    body,
    base,
    current: null,
    ogImage: p.thumb ? mediaUrl(p.thumb, p.slug, 1200, '') : null,
  });
}

/* ------------------------------------------------------ Information ---- */

function renderInformation() {
  const info = site.information || {};
  const mail = site.email || {};

  const paras = (info.body || []).map((t) => `      <p>${esc(t)}</p>`).join('\n');

  const blocks = (info.sections || []).map((s) => `    <div class="info-block">
      <h2>${esc(s.heading)}</h2>
      <ul class="info-list">
${(s.items || []).map((it) => `        <li>${esc(it)}</li>`).join('\n')}
      </ul>
    </div>`).join('\n');

  const clients = (info.clients || []).length ? `    <div class="info-block">
      <h2>${esc(info.clientsHeading || "✸ Brands I've Designed & Animated For")}</h2>
      <ul class="info-list">
${info.clients.map((c) => `        <li>${esc(c)}</li>`).join('\n')}
      </ul>
    </div>` : '';

  const social = (site.social || []).map((s) =>
    `        <li><a class="link-accent wiggle-text" href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`
  ).join('\n');

  const body = `  <section class="info" data-stagger-scope>
    <h1 class="display-l">${esc(info.heading || 'Information')}</h1>

    <div class="info-body body-text stagger-item">
${paras}
    </div>

${clients}
${blocks}

    <div class="info-block">
      <h2>${esc(info.contactLabel || 'Contact')}</h2>
      <p style="margin-top:1.2rem"><a class="contact-mail mailto" data-user="${esc(mail.user)}" data-domain="${esc(mail.domain)}" href="#">${esc(mail.user)}@${esc(mail.domain)}</a></p>
      <ul class="info-list" style="margin-top:2rem">
${social}
      </ul>
    </div>
  </section>`;

  return layout({
    title: `Information — ${site.name}`,
    desc: (info.body || [])[0] || site.description,
    body,
    base: '',
    current: 'information.html',
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
if (empty.length) {
  console.log(`\n⚠ 完全沒有內容的作品（${empty.length}）：${empty.map((p) => p.slug).join(', ')}`);
}
if (MEDIA_SOURCE === 'cargo') {
  console.log(`\n⚠ 圖片目前直接連 Cargo CDN。停用 Cargo 帳號後圖會全部失效，`);
  console.log(`  記得跑 download-media.mjs 把圖抓到本機，再把 site.json 的 media.source 改成 "local"。`);
}
console.log('');
