/* ==========================================================================
   讀寫 content/*.json 而不破壞排版
   --------------------------------------------------------------------------
   為什麼需要這支：

   content/site.json 是「給人看的」—— 區塊之間有空行、nav 那種短物件寫成一行，
   而且到處都是 _說明。直接用 JSON.stringify(obj, null, 2) 存回去會把這些全部
   沖掉，變成一大坨機器格式，那個檔案就不能再靠手改了。後台每按一次儲存就沖
   一次，git 記錄也會被沒意義的重排洗掉。

   content/projects.json 相反，它一直都是機器產生的（縮排 2、沒有空行），
   JSON.stringify 剛好一字不差，所以那個檔案用一般寫法就好。

   所以這裡有兩個寫入器：
     writeJson()      機器格式，給 projects.json
     writeSiteJson()  照 site.json 自己的風格排，給 site.json

   兩者都會沿用檔案原本的行尾（CRLF 或 LF）。不沿用的話每次存檔整個檔案的
   行尾都會被改寫一遍，雖然 git 有 autocrlf 看不出 diff，但檔案本身在磁碟上
   一直被整份重寫，很難看出到底改了什麼。
   ========================================================================== */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';

/* --------------------------------------------------------------- 行尾 ---- */

/** 這個檔案原本用什麼行尾。看不出來就用 LF。 */
export function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function applyEol(text, eol) {
  const lf = text.replace(/\r\n/g, '\n');
  return eol === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

/* --------------------------------------------------------------- 讀取 ---- */

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 連同原本的行尾一起讀回來，寫回去時才能沿用 */
export function readJsonWithEol(path) {
  const text = readFileSync(path, 'utf8');
  return { data: JSON.parse(text), eol: detectEol(text) };
}

/* --------------------------------------------------------------- 寫入 ---- */

/** 先寫暫存檔、parse 驗證、才換掉本尊。中途壞掉本尊還是完好的。 */
function atomicWrite(path, text) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, text, 'utf8');
  JSON.parse(readFileSync(tmp, 'utf8'));
  renameSync(tmp, path);
}

/** 機器格式（縮排 2 + 結尾換行）。projects.json 用這個。 */
export function writeJson(path, data) {
  let eol = '\n';
  try { eol = detectEol(readFileSync(path, 'utf8')); } catch { /* 新檔案 */ }
  atomicWrite(path, applyEol(JSON.stringify(data, null, 2) + '\n', eol));
}

/** site.json 用這個，排版跟原本手寫的一致。 */
export function writeSiteJson(path, data) {
  let eol = '\n';
  try { eol = detectEol(readFileSync(path, 'utf8')); } catch { /* 新檔案 */ }
  atomicWrite(path, applyEol(formatSite(data) + '\n', eol));
}

/* ------------------------------------------------------------- 排版器 ---- */

const INDENT = '  ';
const COMPACT_MAX = 110;   // 陣列裡的短物件擠成一行的長度上限

const isScalar = (v) => v === null || typeof v !== 'object';
const isDocKey = (k) => k.startsWith('_');

const q = (s) => JSON.stringify(s);

/** 一個值能不能擠成一行：只有純量成員、而且夠短 */
function compactIfShort(obj, pad) {
  if (Array.isArray(obj) || !Object.values(obj).every(isScalar)) return null;
  const inner = Object.entries(obj).map(([k, v]) => `${q(k)}: ${JSON.stringify(v)}`).join(', ');
  const line = `{ ${inner} }`;
  return (pad.length + line.length) <= COMPACT_MAX ? line : null;
}

/**
 * 排版規則（照 site.json 原本的樣子歸納出來的）：
 *   ・物件一律展開，除非它是「陣列的元素」而且只有純量成員又夠短
 *     → nav 與 social 那種 { "label": …, "href": … } 就會留在一行
 *   ・字串陣列一律一行一個，再短也不擠
 *   ・最外層：value 是物件或陣列的鍵前面空一行，_xxx註 這類說明鍵緊跟著
 *     它說明的欄位不空行；最外層自己的 _說明 後面空一行
 */
function render(value, depth, inArray) {
  const pad = INDENT.repeat(depth);
  const padIn = INDENT.repeat(depth + 1);

  if (isScalar(value)) return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const items = value.map((v) => padIn + render(v, depth + 1, true));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }

  const keys = Object.keys(value);
  if (!keys.length) return '{}';

  if (inArray) {
    const one = compactIfShort(value, padIn);
    if (one) return one;
  }

  const lines = [];
  keys.forEach((k, i) => {
    // 最外層才做分組空行，巢狀裡面不加，跟原本的檔案一致
    if (depth === 0 && i > 0) {
      const prev = keys[i - 1];
      const startsGroup = !isScalar(value[k]);
      const rootDocDone = prev === '_說明';
      if (startsGroup || rootDocDone) lines.push('');
    }
    lines.push(`${padIn}${q(k)}: ${render(value[k], depth + 1, false)}${i < keys.length - 1 ? ',' : ''}`);
  });

  return '{\n' + lines.join('\n') + '\n' + pad + '}';
}

/** site.json 的完整內容（不含結尾換行） */
export function formatSite(data) {
  return render(data, 0, false);
}

/** 給呼叫端自己判斷要不要警告：這個鍵是說明還是真的欄位 */
export { isDocKey };
