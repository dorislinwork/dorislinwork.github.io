/* 檢查所有 HTML 檔案裡的本機 href/src 是否都指向存在的檔案 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, posix } from 'node:path';

const ROOT = process.argv[2];
const problems = [];
const seenIds = new Map();

const SKIP_DIRS = new Set(['_archive-v1', 'dev', 'node_modules', '.git', 'src', 'content']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith('.html')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const anchorsByFile = new Map();

// 先蒐集每個檔案有哪些 id
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  anchorsByFile.set(relative(ROOT, f).replace(/\\/g, '/'), ids);
}

for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  const html = readFileSync(f, 'utf8');

  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|tel:)/.test(url)) continue;

    if (url.startsWith('#')) {
      const id = url.slice(1);
      if (id && !anchorsByFile.get(rel).has(id)) {
        problems.push(`${rel}: 錨點 ${url} 在本頁找不到對應 id`);
      }
      continue;
    }

    const [pathPart, hash] = url.split('#');
    if (!pathPart) continue;

    // 絕對路徑（/ 開頭）以站台根目錄為基準
    const target = pathPart.startsWith('/')
      ? join(ROOT, pathPart)
      : resolve(dirname(f), pathPart);

    if (!existsSync(target)) {
      problems.push(`${rel}: 找不到檔案 -> ${url}`);
      continue;
    }
    if (hash) {
      const tRel = relative(ROOT, target).replace(/\\/g, '/');
      const ids = anchorsByFile.get(tRel);
      if (ids && !ids.has(hash)) {
        problems.push(`${rel}: ${pathPart} 裡找不到錨點 #${hash}`);
      }
    }
  }

  // 檢查 img 是否都有 alt / width / height
  // 在 aspect-ratio 已固定版面的容器裡（縮圖框、影片框），
  // 缺 width/height 不會造成版面跳動，所以不算問題。
  const framedRanges = [...html.matchAll(/<div class="(?:thumbnail-frame|embed)">[\s\S]*?<\/div>/g)]
    .map((m) => [m.index, m.index + m[0].length]);
  const inFrame = (idx) => framedRanges.some(([a, b]) => idx >= a && idx <= b);

  for (const m of html.matchAll(/<img\s[^>]*>/g)) {
    const tag = m[0];
    if (!/\salt="/.test(tag)) problems.push(`${rel}: <img> 缺少 alt -> ${tag.slice(0, 70)}…`);
    if ((!/\swidth="/.test(tag) || !/\sheight="/.test(tag)) && !inFrame(m.index)) {
      problems.push(`${rel}: <img> 缺少 width/height -> ${tag.slice(0, 70)}…`);
    }
  }

  // 每頁應有唯一 h1
  const h1s = [...html.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) problems.push(`${rel}: h1 數量為 ${h1s}（應為 1）`);
}

// CSS 裡引用的變數是否都有定義
const css = readFileSync(join(ROOT, 'assets/css/site.css'), 'utf8');
const defined = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
// 只檢查沒寫 fallback 的用法；var(--x, 0ms) 這種即使未定義也安全
const used = new Set([...css.matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]));
for (const v of used) if (!defined.has(v)) problems.push(`site.css: 用到未定義的變數 ${v}`);

console.log(`檢查了 ${files.length} 個 HTML 檔案`);
if (problems.length === 0) {
  console.log('✓ 全部通過：連結、圖片屬性、標題結構、CSS 變數都沒問題');
} else {
  console.log(`\n✗ 發現 ${problems.length} 個問題：`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exitCode = 1;
}
