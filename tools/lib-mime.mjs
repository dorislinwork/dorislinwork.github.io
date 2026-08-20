/* ==========================================================================
   副檔名 → Content-Type
   --------------------------------------------------------------------------
   serve.mjs（預覽）與 admin.mjs（後台）共用一份。

   分開放的原因：影片型別曾經只在 serve.mjs 補過一次。少了 video/mp4 的話
   <video> 不會播，本機看起來像是 20 支縮圖全壞了（線上沒這問題，GitHub Pages
   自己認得副檔名）。兩支伺服器各留一份表就會再犯一次，所以抽出來。
   ========================================================================== */

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  // 影片一定要給對的型別，否則 <video> 不播
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
};

/** 查不到就回 octet-stream。傳進來的可以是副檔名或整個檔名。 */
export function typeFor(nameOrExt) {
  const i = String(nameOrExt).lastIndexOf('.');
  const ext = (i === -1 ? nameOrExt : String(nameOrExt).slice(i)).toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
}
