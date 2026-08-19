/* 把 cargo-export-v4.json 併進 content/projects.json。
   產出依文件順序排好的 blocks（heading / text / media / embed）。 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , exportPath, projectsPath] = process.argv;
const dump = JSON.parse(readFileSync(exportPath, 'utf8'));
const current = JSON.parse(readFileSync(projectsPath, 'utf8'));

const clean = (s) => String(s || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
const flat = (s) => clean(s).replace(/\n/g, ' ');

/** 長度超過這個字數的標題，實際上是段落文字（原站用 h2 裝描述） */
const TEXT_THRESHOLD = 80;

/** "Personal work | 2025 |" → { role, year, client } */
function parseMeta(text) {
  const t = flat(text);
  if (!t.includes('|') && !t.includes('｜')) return null;
  const parts = t.split(/[|｜]/).map((s) => s.trim()).filter(Boolean);
  const out = { role: '', year: '', client: '' };
  for (const part of parts) {
    if (/^(19|20)\d{2}$/.test(part)) out.year = part;
    else if (!out.role) out.role = part;
    else if (!out.client) out.client = part;
  }
  return (out.role || out.year) ? out : null;
}

const byPath = new Map(dump.pages.map((p) => [p.path, p]));
const NON_PROJECT = new Set(['/index', '/Information']);

// 首頁縮圖：href → 縮圖資料，同時也是首頁的排列順序
const indexPage = byPath.get('/index');
const thumbByHref = new Map();
const gridOrder = [];
for (const t of (indexPage && indexPage.thumbs) || []) {
  if (!t.href) continue;
  if (!thumbByHref.has(t.href)) gridOrder.push(t.href);
  thumbByHref.set(t.href, t);
}

const oldBySlug = new Map((current.projects || []).map((p) => [p.slug, p]));

// 排序：先照首頁網格順序，其餘（例如 /Reel）接在後面
const paths = [
  ...gridOrder.filter((p) => byPath.has(p)),
  ...dump.pages.map((p) => p.path).filter((p) => !NON_PROJECT.has(p) && !gridOrder.includes(p)),
];

const projects = [];
const notes = [];

for (const path of paths) {
  const page = byPath.get(path);
  if (!page) continue;
  const slug = path.replace(/^\//, '');
  const old = oldBySlug.get(slug) || {};

  const raw = page.blocks || [];
  let title = '';
  let meta = null;
  const blocks = [];

  for (const b of raw) {
    if (b.type === 'heading') {
      const text = clean(b.text);
      if (!text) continue;

      // 第一個 h1 當標題
      if (!title && b.level === 'h1') { title = flat(text); continue; }

      // 第一個含 | 的當 role/year
      if (!meta) {
        const m = parseMeta(text);
        if (m) { meta = m; continue; }
      }

      // 長的其實是描述段落，依換行拆成多段
      if (flat(text).length > TEXT_THRESHOLD) {
        for (const para of text.split('\n').map(clean).filter(Boolean)) {
          blocks.push({ type: 'text', text: para });
        }
      } else {
        blocks.push({ type: 'heading', level: b.level, text: flat(text) });
      }
      continue;
    }

    if (b.type === 'embed') {
      const m = b.url.match(/vimeo\.com\/video\/(\d+)/);
      blocks.push({
        type: 'embed',
        provider: m ? 'vimeo' : 'other',
        id: m ? m[1] : '',
        url: b.url,
        autoplay: /autoplay=1/.test(b.url),
        loop: /loop=1/.test(b.url),
      });
      continue;
    }

    if (b.type === 'media') {
      blocks.push({
        type: 'media',
        hash: b.hash || '',
        file: b.file || '',
        url: b.url,
        w: b.w || null,
        h: b.h || null,
        alt: clean(b.alt),
        caption: clean(b.caption),
        ...(b.eye ? { eye: parseEye(b.eye) } : {}),
      });
      continue;
    }
  }

  if (!title) title = old.title || slug.replace(/-/g, ' ');

  const thumb = thumbByHref.get(path);
  const firstText = blocks.find((b) => b.type === 'text');

  const entry = {
    slug,
    title,
    year: (meta && meta.year) || old.year || '',
    role: (meta && meta.role) || old.role || '',
    client: (meta && meta.client) || old.client || '',
    tags: old.tags || [],
    summary: firstText ? firstText.text.slice(0, 155) : '',
    _summary註: 'summary 只用於 <meta description>，不會顯示在頁面上',
    thumb: thumb ? { hash: thumb.hash, file: thumb.file, w: thumb.w, h: thumb.h } : (old.thumb || null),
    blocks,
  };

  if (/-copy$/.test(slug)) {
    entry.draft = true;
    entry._註 = '網址結尾是 -copy，原站留下的重複頁，設為 draft 不產生。要保留就刪掉 draft。';
    notes.push(`${slug} → draft（重複頁）`);
  }

  projects.push(entry);
}

/** "#eye rollspeed:0.5 range:1" → { rollspeed, range } */
function parseEye(caption) {
  const out = {};
  for (const tok of String(caption).split(/\s+/)) {
    const m = tok.match(/^(rollspeed|range|rotation):(-?[\d.]+)$/);
    if (m) out[m[1]] = parseFloat(m[2]);
  }
  return out;
}

writeFileSync(projectsPath, JSON.stringify({ ...current, projects }, null, 2), 'utf8');

/* ---- 報告 ---- */
const count = (fn) => projects.reduce((n, p) => n + p.blocks.filter(fn).length, 0);
console.log(`寫入 ${projects.length} 筆作品`);
console.log(`  文字段落 ${count((b) => b.type === 'text')}`);
console.log(`  小標題   ${count((b) => b.type === 'heading')}`);
console.log(`  圖片     ${count((b) => b.type === 'media')}`);
console.log(`  嵌入影片 ${count((b) => b.type === 'embed')}`);
console.log(`  有縮圖   ${projects.filter((p) => p.thumb).length} / ${projects.length}`);
console.log(`  有年份   ${projects.filter((p) => p.year).length} / ${projects.length}`);
console.log(`  完全沒內容 ${projects.filter((p) => !p.blocks.length).length}`);
if (notes.length) console.log('\n注意:\n  ' + notes.join('\n  '));

// 匯出裡有、但沒被歸為作品的頁面
const used = new Set(projects.map((p) => '/' + p.slug));
const unused = dump.pages.map((p) => p.path).filter((p) => !used.has(p) && !NON_PROJECT.has(p));
if (unused.length) console.log('\n未歸類的頁面:', unused);
