/* ==========================================================================
   把舊站 /Mirror 那一頁匯出
   --------------------------------------------------------------------------
   為什麼要在瀏覽器裡跑：

   /Mirror 是舊站唯一沒有被匯出的頁面。它是「未列出頁面」——
   不在首頁縮圖清單、不在 /rss、也不在首頁 payload 的頁面集合裡（都查過了，
   Mirror 這個字在首頁 payload 出現 0 次）。Cargo 的 API 端點全部 404。

   而且 Cargo 的圖片是 JS 事後注入的，單純 fetch 只拿到頁面骨架。
   所以只有「在瀏覽器裡真的把那一頁載起來、等圖片載完再讀 DOM」這條路。

   ── 怎麼用 ────────────────────────────────────────────
   1. 用 Chrome 開 https://doris-lin.com/Mirror
   2. 等頁面完全載完（圖片都出現、捲到最底再捲回來）
   3. 按 F12 開開發者工具 → Console
   4. 把這整個檔案的內容貼進去、按 Enter
   5. 它會印出結果，並自動下載一個 mirror-export.json

   把那個 json 給我，我就能把這一頁補進 projects.json 並抓齊原始檔。
   ========================================================================== */

(function () {
  'use strict';

  /* Cargo 一頁會有多個 .page_content，第一個是被 .pinned 包住的固定頁首 ——
     單數 querySelector 會抓到頁首而不是內容。這個判斷式跟 v4 匯出腳本一致。 */
  function contentRoots() {
    return [...document.querySelectorAll('.page_content, [data-container="page"]')]
      .filter((el) => !el.closest('.pinned'));
  }

  /* 圖片網址裡的 hash 與檔名：
     freight.cargo.site/w/<寬>/q/<品質>/i/<hash>/<檔名> */
  function parseCargoUrl(src) {
    const m = String(src || '').match(/\/i\/([0-9a-f]{64})\/([^?#]*)/);
    return m ? { hash: m[1], file: decodeURIComponent(m[2]) } : null;
  }

  const roots = contentRoots();
  const blocks = [];
  const seen = new Set();

  for (const root of roots) {
    // 照 DOM 順序走，文字與圖片的先後才會對
    const nodes = root.querySelectorAll('h1, h2, h3, p, img, video, iframe');
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();

      if (/^h[123]$/.test(tag)) {
        // aria-label 優先：逐字浮現效果會把文字拆成一堆 span，textContent 會黏在一起
        const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'heading', level: tag, text });
        continue;
      }

      if (tag === 'p') {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) blocks.push({ type: 'text', text });
        continue;
      }

      if (tag === 'iframe') {
        const src = el.src || '';
        const vimeo = src.match(/player\.vimeo\.com\/video\/(\d+)/);
        if (vimeo) blocks.push({ type: 'embed', provider: 'vimeo', id: vimeo[1] });
        continue;
      }

      // img / video
      const src = el.currentSrc || el.src || '';
      const info = parseCargoUrl(src);
      if (!info) continue;
      if (seen.has(info.hash)) continue;   // 同一張圖有時會有多個尺寸的節點
      seen.add(info.hash);
      blocks.push({
        type: 'media',
        tag,
        hash: info.hash,
        file: info.file,
        w: el.naturalWidth || el.videoWidth || null,
        h: el.naturalHeight || el.videoHeight || null,
        loaded: tag === 'img' ? !!el.complete : true,
        src,
      });
    }
  }

  const result = {
    path: location.pathname,
    title: document.title,
    description: (document.querySelector('meta[name="description"]') || {}).content || '',
    ogImage: (document.querySelector('meta[property="og:image"]') || {}).content || '',
    blocks,
    匯出時間: new Date().toISOString(),
  };

  console.log('=== /Mirror 匯出結果 ===');
  console.log('標題：', result.title);
  console.log('敘述：', result.description);
  console.log('區塊：', blocks.length, '個');
  console.table(blocks.map((b) => ({
    型別: b.type,
    內容: b.type === 'media' ? b.file : (b.text || b.id || '').slice(0, 60),
    尺寸: b.w ? b.w + '×' + b.h : '',
    載入完成: b.loaded === undefined ? '' : b.loaded,
  })));

  const notLoaded = blocks.filter((b) => b.type === 'media' && b.loaded === false);
  if (notLoaded.length) {
    console.warn('⚠ 有 ' + notLoaded.length + ' 張圖還沒載完，尺寸可能是 0。');
    console.warn('  請捲到頁面最底、等圖都出現，再重跑一次這段。');
  }

  // 自動下載
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mirror-export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('已下載 mirror-export.json（通常在「下載」資料夾）');

  return result;
})();
