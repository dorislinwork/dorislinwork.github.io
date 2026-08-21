/* ==========================================================================
   本機後台
   --------------------------------------------------------------------------
   用法：  admin.cmd                  （會自己開瀏覽器）
          node tools/admin.mjs 4321  （指定連接埠）

   在瀏覽器裡做這些事，不用碰命令列也不用手寫 JSON：
     ・新增作品：拖檔案進來 → 填標題年份 → 建立（自動轉檔、取卡片顏色）
     ・編輯作品：改標題／敘述／排序／圖說／縮圖／草稿，往既有作品補圖
     ・版面設定：site.json 的每個欄位都變成表單，說明就是 json 裡的 _說明
     ・預覽與發布：重新產生、檢查、commit、push

   設計上的三個決定：

   1. 只綁 127.0.0.1。後台可以改檔案還能 push，絕對不能讓同一個 wifi 上的
      人連進來。POST 另外檢查 Origin 與一個自訂標頭，別的網站沒辦法用一個
      隱藏表單偷偷叫這些 API（跨站表單送不出自訂標頭）。

   2. 實際工作全部交給既有的腳本跑（add-project / remove-project /
      set-card-colors / build / check / publish）。後台只是它們的介面，
      不重寫一份邏輯 —— 兩份就會不一致。轉檔規則走 lib-media.mjs。

   3. 寫 JSON 走 lib-json.mjs，它會保住原本的排版。site.json 是手排的
      （區塊之間有空行、nav 那種短物件寫成一行），用一般的 JSON.stringify
      存回去會整份沖成機器格式，那個檔案就不能再靠手改，git 記錄也會被
      沒意義的重排洗掉。每次寫入都是「暫存檔 → parse 驗證 → 換掉本尊」。
   ========================================================================== */

import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, dirname, normalize, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { TYPES, typeFor } from './lib-mime.mjs';
import { findFfmpeg, findFfprobe } from './lib-ffmpeg.mjs';
import { convertOne, listSources, isUsable, ffmpegError } from './lib-media.mjs';
import { readJson, writeJson, writeSiteJson } from './lib-json.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 4321);
const UI = join(ROOT, 'tools/admin-ui.html');

const PROJECTS = join(ROOT, 'content/projects.json');
const SITE = join(ROOT, 'content/site.json');

/* ------------------------------------------------------------- 跑腳本 ---- */

/** 跑一個 node 腳本或 git，把輸出收集起來回給前端。 */
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: false });
    let out = '';
    const take = (b) => { out += b.toString('utf8'); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => resolve({ ok: false, code: 1, log: String(e.message) }));
    child.on('close', (code) => resolve({ ok: code === 0, code, log: out.trimEnd() }));
  });
}

const node = (script, args = []) => run(process.execPath, [join(ROOT, script), ...args]);

/* ---------------------------------------------------------------- git ---- */

async function gitState() {
  const [branch, status, ahead] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', ['status', '--porcelain']),
    run('git', ['rev-list', '--count', '@{u}..HEAD']),
  ]);
  const files = status.log.split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    branch: branch.log.trim() || '(unknown)',
    changed: files.length,
    ahead: Number(ahead.log.trim()) || 0,
    sample: files.slice(0, 12),
  };
}

/* ------------------------------------------------------------ incoming ---- */

/** incoming/ 底下每個資料夾有哪些可用素材，給「新增作品」與「補圖」用 */
async function incomingState() {
  const dir = join(ROOT, 'incoming');
  const out = {};
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const files = listSources(join(dir, e.name));
    const withSize = [];
    for (const f of files) {
      const s = await stat(join(dir, e.name, f));
      withSize.push({ name: f, bytes: s.size });
    }
    out[e.name] = withSize;
  }
  return out;
}

/* --------------------------------------------------------------- 狀態 ---- */

async function state() {
  const [projects, site, incoming, git] = await Promise.all([
    readJson(PROJECTS), readJson(SITE), incomingState(), gitState(),
  ]);
  return {
    projects,
    site,
    incoming,
    git,
    ffmpeg: !!(findFfmpeg() && findFfprobe()),
    root: ROOT,
    port: PORT,
  };
}

/* ---------------------------------------------------------------- API ---- */

const SLUG_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 檔名只准是單純的檔名，不准帶路徑 —— 否則可以寫到 repo 以外的地方 */
function safeName(name) {
  const n = basename(String(name || ''));
  if (!n || n.startsWith('.') || n !== normalize(n)) return null;
  return n;
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error('body 太大');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const json = (res, code, obj) => {
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': TYPES['.json'], 'content-length': b.length });
  res.end(b);
};

async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, '');
  const q = url.searchParams;

  /* ---- 讀狀態 ---- */
  if (route === 'state' && req.method === 'GET') {
    return json(res, 200, await state());
  }

  /* ---- 上傳一個檔案到 incoming/<slug>/ ----
     刻意不用 multipart：raw body 直接寫檔，不必自己解析 multipart，
     大檔也不會整個進記憶體（streaming 到磁碟）。 */
  if (route === 'upload' && req.method === 'POST') {
    const slug = q.get('slug');
    const name = safeName(q.get('name'));
    if (!slug || !SLUG_OK.test(slug)) return json(res, 400, { error: 'slug 不合法' });
    if (!name) return json(res, 400, { error: '檔名不合法' });
    if (!isUsable(name)) return json(res, 400, { error: `不支援的檔案型別：${extname(name) || name}` });

    const dir = join(ROOT, 'incoming', slug);
    await mkdir(dir, { recursive: true });
    await pipeline(req, createWriteStream(join(dir, name)));
    const s = await stat(join(dir, name));
    return json(res, 200, { ok: true, name, bytes: s.size });
  }

  /* ---- 刪掉 incoming 裡的某個檔案（放錯了） ---- */
  if (route === 'discard' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    const slug = b.slug;
    const name = safeName(b.name);
    if (!slug || !SLUG_OK.test(slug) || !name) return json(res, 400, { error: '參數不合法' });
    try { await unlink(join(ROOT, 'incoming', slug, name)); } catch { /* 本來就沒有 */ }
    return json(res, 200, { ok: true });
  }

  /* ---- 建立作品：交給 add-project.mjs ---- */
  if (route === 'create' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    const slug = String(b.slug || '');
    if (!SLUG_OK.test(slug)) {
      return json(res, 400, { error: 'slug 只能用英數字、連字號、底線，且要以英數字開頭' });
    }
    const args = [slug];
    const push = (flag, v) => { if (v !== undefined && v !== null && v !== '') args.push(flag, String(v)); };
    push('--title', b.title);
    push('--year', b.year);
    push('--type', b.type);
    push('--role', b.role);
    push('--agency', b.agency);
    push('--client', b.client);
    push('--thumb', b.thumb);
    push('--ratio', b.ratio);
    if (b.span && Number(b.span) > 1) push('--span', b.span);
    if (Array.isArray(b.tags) && b.tags.length) push('--tags', b.tags.join(','));
    for (const t of (b.texts || [])) if (String(t).trim()) args.push('--text', String(t));
    for (const v of (b.vimeos || [])) if (String(v).trim()) args.push('--vimeo', String(v).trim());
    if (b.draft) args.push('--draft');
    if (b.hideFromGrid) args.push('--hide-from-grid');
    args.push(b.atEnd ? '--end' : '--front');

    const r = await node('tools/add-project.mjs', args);
    return json(res, r.ok ? 200 : 500, r);
  }

  /* ---- 往既有作品補圖 ----
     刻意不重跑 add-project.mjs：那支會用 incoming 資料夾重建整個 blocks，
     手動排過的順序、加過的圖說、插在中間的文字段落都會被蓋掉。
     這裡只轉檔然後把 media 區塊接在後面，其他原封不動。 */
  if (route === 'append-media' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    const slug = String(b.slug || '');
    if (!SLUG_OK.test(slug)) return json(res, 400, { error: 'slug 不合法' });

    const ffmpeg = findFfmpeg();
    const ffprobe = findFfprobe();
    if (!ffmpeg || !ffprobe) {
      return json(res, 500, { error: '找不到 ffmpeg。請先執行：winget install Gyan.FFmpeg' });
    }

    const data = readJson(PROJECTS);
    const p = data.projects.find((x) => x.slug === slug);
    if (!p) return json(res, 404, { error: `找不到作品 ${slug}` });

    const inbox = join(ROOT, 'incoming', slug);
    const outDir = join(ROOT, 'assets/media', slug);
    const names = (b.files || []).map(safeName).filter(Boolean);
    if (!names.length) return json(res, 400, { error: '沒有指定檔案' });

    const log = [];
    p.blocks = p.blocks || [];
    for (const name of names) {
      try {
        const r = convertOne({ ffmpeg, ffprobe, src: join(inbox, name), outDir });
        // 同一個檔名已經在 blocks 裡就只更新尺寸，不要重複加一塊
        const existing = p.blocks.find((x) => x.type === 'media' && x.file === r.file);
        if (existing) {
          existing.w = r.w; existing.h = r.h;
          log.push(`↻ ${name} 已存在，只更新尺寸`);
        } else {
          p.blocks.push({ type: 'media', file: r.file, w: r.w, h: r.h, alt: '', caption: '' });
          log.push(`✓ ${name} ${r.w}x${r.h}  ${(r.inBytes / 1024).toFixed(0)} KB → ${(r.outBytes / 1024).toFixed(0)} KB`);
        }
      } catch (e) {
        return json(res, 500, { error: `${name} 轉檔失敗：${ffmpegError(e).slice(0, 160)}`, log: log.join('\n') });
      }
    }

    writeJson(PROJECTS, data);
    return json(res, 200, { ok: true, log: log.join('\n') });
  }

  /* ---- 整份 projects 存回去 ----
     前端送回完整陣列（排序、欄位、blocks 都在裡面）。前端只改它認得的欄位，
     其他像 _註、cardColorDark 這種都原封帶回來，不會被吃掉。 */
  if (route === 'projects' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (!b || !Array.isArray(b.projects)) return json(res, 400, { error: '格式不對' });
    const current = readJson(PROJECTS);
    current.projects = b.projects;
    writeJson(PROJECTS, current);
    return json(res, 200, { ok: true, count: b.projects.length });
  }

  /* ---- site.json 存回去 ----
     用 writeSiteJson 而不是 writeJson：這個檔案是手排的（區塊之間有空行、
     nav 那種短物件寫成一行），一般的 JSON.stringify 會把排版沖掉，
     那個檔案就不能再靠手改了。 */
  if (route === 'site' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (!b || typeof b.site !== 'object' || Array.isArray(b.site)) {
      return json(res, 400, { error: '格式不對' });
    }
    writeSiteJson(SITE, b.site);
    return json(res, 200, { ok: true });
  }

  /* ---- 移除作品：交給 remove-project.mjs ---- */
  if (route === 'delete' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (!SLUG_OK.test(String(b.slug || ''))) return json(res, 400, { error: 'slug 不合法' });
    const r = await node('tools/remove-project.mjs', [b.slug]);
    return json(res, r.ok ? 200 : 500, r);
  }

  /* ---- 取卡片顏色 ---- */
  if (route === 'card-colors' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    const r = await node('tools/set-card-colors.mjs', b.force ? ['--force'] : []);
    return json(res, r.ok ? 200 : 500, r);
  }

  /* ---- 預覽單一作品頁（不必先儲存）----
     前端把「還沒儲存」的整份草稿送過來，寫成一個暫存清單檔，
     再用 build.mjs 的 --projects / --only 只產生那一頁到 work/_preview.html。

     為什麼不直接存檔再 build：那就變成「要先儲存才看得到」，而順序本來就該相反 ——
     先看對不對，滿意了再存。暫存檔與預覽頁都在 .gitignore 裡，不會進 repo。

     暫存檔的路徑必須是 repo 相對路徑：build.mjs 的 read() 會把它跟 ROOT 相接，
     給絕對路徑在 Windows 上會接出 C:\repo\C:\temp\... 這種壞路徑。 */
  if (route === 'preview' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (!Array.isArray(b.projects) || !SLUG_OK.test(String(b.slug || ''))) {
      return json(res, 400, { error: '參數不合法' });
    }
    const rel = 'content/_preview-projects.json';
    const current = readJson(PROJECTS);
    writeJson(join(ROOT, rel), { ...current, projects: b.projects });

    /* 先重量這一件的封面亮度。封面構圖一調，導覽列該不該轉白字就變了 ——
       不重量的話預覽出來的黑白是舊的，等於在騙人。只量一件約 0.1 秒。
       量進暫存檔而不是 content/projects.json：正式檔不能被預覽動到，
       否則後台記憶中的那份會跟磁碟上的分岔，下次儲存就把量出來的值蓋掉。 */
    const toned = await node('tools/set-card-colors.mjs',
      ['--projects', rel, '--only', b.slug]);
    const r = await node('build.mjs', ['--projects', rel, '--only', b.slug]);
    return json(res, r.ok ? 200 : 500, {
      ...r,
      log: (toned.ok ? '' : toned.log + '\n') + r.log,
      url: 'work/_preview.html',
    });
  }

  /* ---- 預覽 Information 頁（不必先儲存）----
     跟上面的作品預覽同一個做法：草稿寫成暫存檔，build.mjs 用 --site 讀它，
     --preview-info 只產生那一頁到 _preview-info.html。正式的 information.html
     不會被動到，所以看壞了也沒差。 */
  if (route === 'preview-info' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    if (!b.site || typeof b.site !== 'object') return json(res, 400, { error: '參數不合法' });
    const rel = 'content/_preview-site.json';
    writeJson(join(ROOT, rel), b.site);
    const r = await node('build.mjs', ['--site', rel, '--preview-info']);
    return json(res, r.ok ? 200 : 500, { ...r, url: '_preview-info.html' });
  }

  /* ---- 產生網站 ---- */
  if (route === 'build' && req.method === 'POST') {
    const built = await node('build.mjs');
    if (!built.ok) return json(res, 500, built);
    const checked = await node('tools/check.mjs', ['.']);
    return json(res, checked.ok ? 200 : 500, {
      ok: checked.ok,
      code: checked.code,
      log: built.log + '\n\n' + checked.log,
    });
  }

  /* ---- 發布 ---- */
  if (route === 'publish' && req.method === 'POST') {
    const b = JSON.parse((await readBody(req)).toString('utf8'));
    const msg = String(b.message || '').trim();
    const r = await node('tools/publish.mjs', msg ? [msg] : []);
    return json(res, r.ok ? 200 : 500, r);
  }

  return json(res, 404, { error: `沒有這個 API：${route}` });
}

/* ------------------------------------------------------------ 靜態檔 ---- */

async function serveStatic(res, pathname) {
  let p = pathname;
  if (p.endsWith('/')) p += 'index.html';
  const target = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const s = await stat(target);
    if (s.isDirectory()) throw new Error('dir');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': typeFor(target), 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end('<h1>404</h1><p>後台在 <a href="/admin">/admin</a></p>');
  }
}

/* -------------------------------------------------------------- 伺服器 ---- */

/* 跨站防護：別的網頁不能靠一個隱藏表單叫這些 API。
   跨站表單送不出自訂標頭，所以要求 x-admin，順便檢查 Origin。 */
function crossSite(req) {
  if (req.method === 'GET') return false;
  if (req.headers['x-admin'] !== '1') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  return ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(origin);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (crossSite(req)) {
      return json(res, 403, { error: '只接受後台自己發出的請求' });
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      const body = await readFile(UI);
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(body);
    }

    if (pathname.startsWith('/api/')) return await api(req, res, url);

    return await serveStatic(res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n連接埠 ${PORT} 已經有人在用了。`);
    console.error('多半是之前開的後台還沒關 —— 先看看瀏覽器有沒有已經開著的分頁：');
    console.error(`    http://localhost:${PORT}/admin`);
    console.error('\n真的要另外開一個就指定別的連接埠：');
    console.error('    node tools/admin.mjs 4322\n');
    process.exit(1);
  }
  throw e;
});

// 只綁 127.0.0.1。後台能改檔案還能 push，不可以讓同網段的人連進來。
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/admin`;
  console.log('');
  console.log('  後台已啟動');
  console.log(`  ${url}`);
  console.log('');
  console.log('  這個網址只有這台電腦連得到。關掉的方法：在這個視窗按 Ctrl+C。');
  console.log('');
  if (!(findFfmpeg() && findFfprobe())) {
    console.log('  ⚠ 找不到 ffmpeg，新增作品時無法轉檔。先執行：');
    console.log('      winget install Gyan.FFmpeg');
    console.log('');
  }
  // 自己把瀏覽器打開，省一步
  execFile('cmd', ['/c', 'start', '', url], () => {});
});
