/* 極簡靜態檔案伺服器，只為了本機預覽用（不需要安裝任何套件） */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { TYPES } from './lib-mime.mjs';

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 8080);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  // 阻擋 ../ 跳出根目錄
  const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));

  try {
    const s = await stat(target);
    if (s.isDirectory()) throw new Error('dir');
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
    console.log('200', path);
  } catch {
    try {
      const body = await readFile(join(ROOT, '404.html'));
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      res.end('<h1>404</h1>');
    }
    console.log('404', path);
  }
}).listen(PORT, () => {
  console.log(`預覽伺服器啟動： http://localhost:${PORT}`);
});
