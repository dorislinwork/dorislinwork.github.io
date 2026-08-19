/* ============================================================
   doris-lin.com 內容匯出器 v4
   ------------------------------------------------------------
   v3 的錯：Cargo 一頁有多個 .page_content，第一個是固定頁首
   （.pinned 包住的那個），我用單數 querySelector 所以每頁都只
   抓到頁首的 logo 和導覽，難怪 54 頁只有 1 個媒體。

   v4 修正：
   ・排除 .pinned 裡的東西，只取真正的內容區
   ・一頁可以有多個內容區，全部依文件順序收集
   ・額外抓首頁的縮圖網格（href + 標題 + 縮圖）
   ・額外抓頁首的 logo 與導覽連結，存成 pin
   ・記下每張圖的 hash 與檔名 —— Cargo 網址可以自訂寬度與品質，
     有 hash 之後想要多大的圖都能自己組
   ・沿用 v3 的續跑機制（換了 localStorage 的 key，會重新開始）

   用法：Chrome 開 https://doris-lin.com/ → F12 → Console → 貼上 → Enter

   指令：__cargoStatus()  __cargoSave()  __cargoStop()  __cargoReset()
   ============================================================ */

(async () => {
  const KEY = 'cargoExportV4';
  const PAGE_TIMEOUT = 20000;
  const SETTLE_MAX = 9000;
  const TICK = 350;
  const STABLE_TICKS = 2;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 進度儲存 ---------- */
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const store = load();
  store.pages = store.pages || {};
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { console.warn('localStorage 滿了，資料仍在記憶體，請執行 __cargoSave()'); }
  };

  /* ---------- 頁面清單 ---------- */
  if (!store.list) {
    const paths = new Set(['/index']);
    document.querySelectorAll('a[href]').forEach((a) => {
      try {
        const u = new URL(a.getAttribute('href'), location.origin);
        if (u.origin !== location.origin) return;
        let p = decodeURIComponent(u.pathname).replace(/\/$/, '');
        if (!p) p = '/index';
        if (p === '/rss') return;
        paths.add(p);
      } catch (e) {}
    });
    store.list = [...paths];
    persist();
  }
  const list = store.list;

  /* ---------- 指令 ---------- */
  let stopRequested = false;

  window.__cargoStatus = () => {
    const done = Object.keys(store.pages).length;
    const left = list.filter((p) => !store.pages[p]);
    console.log(`已完成 ${done}/${list.length}`);
    if (left.length) console.log('尚未完成:', left);
    return { done, total: list.length, remaining: left };
  };

  window.__cargoSave = () => {
    const pages = list.filter((p) => store.pages[p]).map((p) => store.pages[p]);
    const media = new Set();
    pages.forEach((pg) => (pg.blocks || []).forEach((b) => b.url && media.add(b.url)));
    const payload = {
      exportedFrom: location.origin,
      exportVersion: 4,
      pageCount: pages.length,
      totalPages: list.length,
      mediaCount: media.size,
      pin: store.pin || null,
      pages,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'cargo-export-v4.json';
    document.body.appendChild(a); a.click(); a.remove();
    console.log(`已下載：${pages.length} 頁、${media.size} 個不重複媒體`);
    return payload;
  };

  window.__cargoStop = () => { stopRequested = true; console.log('這一頁跑完就停'); };
  window.__cargoReset = () => { localStorage.removeItem(KEY); console.log('進度已清除'); };

  /* ---------- 抓頁首（logo + 導覽），只需要做一次 ---------- */
  if (!store.pin) {
    const pinned = document.querySelector('.pinned_top') || document.querySelector('.pinned');
    if (pinned) {
      store.pin = {
        logo: (() => {
          const im = pinned.querySelector('img');
          if (!im) return null;
          const raw = im.currentSrc || im.getAttribute('src') || '';
          return raw ? { url: new URL(raw, location.origin).href, w: im.naturalWidth || null, h: im.naturalHeight || null } : null;
        })(),
        links: [...pinned.querySelectorAll('a[href]')].map((a) => ({
          text: a.textContent.trim(),
          href: new URL(a.getAttribute('href'), location.origin).pathname,
        })).filter((l) => l.text),
      };
      persist();
      console.log('已記下頁首:', store.pin);
    }
  }

  /* ---------- iframe ---------- */
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;top:0;left:0;width:1400px;height:900px;opacity:0.01;pointer-events:none;z-index:-1;border:0';
  document.body.appendChild(frame);

  const navigate = (src) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('load timeout')), PAGE_TIMEOUT);
    frame.onload = () => { clearTimeout(t); res(); };
    frame.onerror = () => { clearTimeout(t); rej(new Error('load error')); };
    frame.src = src;
  });

  async function settle(win, doc) {
    const t0 = Date.now();
    let last = -1, stable = 0;
    while (Date.now() - t0 < SETTLE_MAX) {
      const h = Math.min(doc.documentElement.scrollHeight, 40000);
      for (let y = 0; y <= h; y += 900) {
        win.scrollTo(0, y);
        await sleep(40);
        if (Date.now() - t0 > SETTLE_MAX) break;
      }
      win.scrollTo(0, 0);
      const imgs = [...doc.querySelectorAll('img')];
      const n = imgs.length + doc.querySelectorAll('video').length;
      const pending = imgs.filter((im) => im.src && !im.complete).length;
      if (n === last && pending === 0) { if (++stable >= STABLE_TICKS) return; }
      else { stable = 0; last = n; }
      await sleep(TICK);
    }
  }

  /* ---------- 從網址拆出 Cargo 的 hash 與檔名 ----------
     /w/700/q/75/i/<hash>/<file>  或  /t/original/i/<hash>/<file>  或  /i/<hash>/<file>
     有 hash 就能自己組任意尺寸的網址。                            */
  function parseCargoUrl(url) {
    const m = url.match(/\/i\/([0-9a-f]{32,})\/([^/?#]+)/i);
    if (!m) return {};
    return { hash: m[1], file: decodeURIComponent(m[2]) };
  }

  /* ---------- 抽出一頁的內容 ---------- */
  function extract(doc) {
    // 只要「不在 .pinned 裡」且「在某個 .page_content 內」的元素
    const inContent = (el) => !el.closest('.pinned') && !!el.closest('.page_content, [data-container="page"]');

    const nodes = [...doc.querySelectorAll('h1, h2, h3, img, video, iframe')].filter(inContent);

    const blocks = [];
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();

      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        const text = (el.getAttribute('aria-label') || el.innerText || '')
          .replace(/\s*\n+\s*/g, '\n').trim();
        if (text) blocks.push({ type: 'heading', level: tag, text });
        continue;
      }

      if (tag === 'iframe') {
        const src = el.getAttribute('src') || '';
        if (/vimeo|youtube/i.test(src)) blocks.push({ type: 'embed', url: src });
        continue;
      }

      // 縮圖網格裡的圖不算內頁媒體，另外處理
      if (el.closest('.thumbnail')) continue;

      const raw = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src');
      if (!raw || raw.startsWith('data:')) continue;
      const url = new URL(raw, location.origin).href;

      const card = el.closest('.gallery_card') || el.parentElement;
      const capEl = card && card.querySelector('.gallery_image_caption');
      const dataCaption = el.getAttribute('data-caption') || '';

      blocks.push({
        type: 'media',
        tag,
        url,
        ...parseCargoUrl(url),
        w: el.naturalWidth || el.videoWidth || Number(el.getAttribute('width')) || null,
        h: el.naturalHeight || el.videoHeight || Number(el.getAttribute('height')) || null,
        alt: el.getAttribute('alt') || '',
        caption: capEl ? capEl.textContent.trim() : '',
        dataCaption,
        eye: /#eye/i.test(dataCaption) ? dataCaption : null,
      });
    }

    // 縮圖網格（主要是首頁用）
    const thumbs = [...doc.querySelectorAll('.thumbnail')].map((t) => {
      const a = t.querySelector('a[href]') || t.closest('a[href]');
      const im = t.querySelector('img');
      const raw = im && (im.currentSrc || im.getAttribute('src'));
      return {
        href: a ? new URL(a.getAttribute('href'), location.origin).pathname : '',
        title: (t.querySelector('.thumbnail_title, .title') || {}).textContent?.trim()
          || t.innerText.trim().split('\n')[0] || '',
        url: raw ? new URL(raw, location.origin).href : '',
        ...(raw ? parseCargoUrl(new URL(raw, location.origin).href) : {}),
        w: im ? (im.naturalWidth || null) : null,
        h: im ? (im.naturalHeight || null) : null,
      };
    }).filter((t) => t.href || t.url);

    return { title: (doc.querySelector('title')?.textContent || '').trim(), blocks, thumbs };
  }

  /* ---------- 主迴圈 ---------- */
  const todo = list.filter((p) => !store.pages[p]);
  if (!todo.length) {
    console.log('%c全部完成，直接下載。', 'color:#0a0;font-size:14px');
    __cargoSave(); frame.remove(); return;
  }

  console.log(`%c共 ${list.length} 頁，已完成 ${list.length - todo.length}，這次跑 ${todo.length} 頁`,
    'font-size:14px;color:#f02');

  for (let i = 0; i < todo.length; i++) {
    if (stopRequested) { console.log('已停止，進度已保存。'); break; }
    const path = todo[i];
    try {
      await navigate(path);
      await settle(frame.contentWindow, frame.contentDocument);
      const data = extract(frame.contentDocument);

      store.pages[path] = { path, ...data };
      persist();

      const media = data.blocks.filter((b) => b.type === 'media').length;
      const eyes = data.blocks.filter((b) => b.eye).length;
      const heads = data.blocks.filter((b) => b.type === 'heading').length;
      console.log(
        `  ✓ ${String(i + 1).padStart(2)}/${todo.length}  ${path}` +
        `  — ${media} 媒體、${heads} 標題` +
        `${eyes ? `、${eyes} 個 #eye` : ''}${data.thumbs.length ? `、${data.thumbs.length} 縮圖` : ''}`
      );
    } catch (e) {
      console.warn(`  ✗ ${path} → ${e.message}（重跑會再試）`);
    }
    try { await navigate('about:blank'); } catch (e) {}
    await sleep(120);
  }

  frame.remove();
  const done = Object.keys(store.pages).length;
  console.log(`%c這一輪結束：${done}/${list.length}`, 'font-size:14px;color:#0a0');
  if (done < list.length) {
    console.log('還有沒抓完的，再貼一次這份腳本會續跑。');
    __cargoStatus();
  }
  __cargoSave();
})();
