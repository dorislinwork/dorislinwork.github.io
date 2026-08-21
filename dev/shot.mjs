/* 對頁面上的某個元素截圖，用來目視確認版面。

   用法（先開著後台或任何靜態伺服器）：
     node dev/shot.mjs <網址> <CSS 選擇器> <輸出檔> [視窗寬] [視窗高] [先跑的 JS]

   例：
     node dev/shot.mjs http://localhost:4321/information.html .info-grid out.png
     node dev/shot.mjs http://localhost:4321/information.html .info-grid m.png 390 844
     node dev/shot.mjs http://localhost:4321/admin "#infoForm" a.png 1500 1000 "showTab('info')"

   為什麼不用 chrome --headless --screenshot：那個只會從頁面最上面拍，要拍到下面
   就得把視窗設得很高 —— 而這個站的封面高度是 clamp(68vh, …, 92vh)，視窗一拉高
   封面就跟著變高，量到的是一個實際上不存在的版面。所以走 CDP：視窗維持真實尺寸，
   捲到元素位置，再用 clip 只拍那一塊。

   2026-08-21 靠它抓到一個純推理不會發現的 bug：Information 頁的手機堆疊規則寫在
   基礎規則前面，兩邊 specificity 一樣（都是單一 class）而媒體查詢不提高權重，
   所以 span 5 又蓋回去、手機上照片變成擠在文字旁的小方塊。

   只在開發時用，不影響網站產出。dev/ 整個資料夾 check.mjs 會跳過。 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [url, selector, out, w = '1920', h = '1080', pre = ''] = process.argv.slice(2);
if (!url || !selector || !out) {
  console.error('用法：node shot.mjs <網址> <選擇器> <輸出檔> [寬] [高]');
  process.exit(1);
}

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--window-size=${w},${h}`,
  '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + (process.env.TEMP || '.') + '/shot-profile',
  'about:blank',
], { stdio: 'ignore' });

async function version() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* 還沒起來 */ }
    await sleep(250);
  }
  throw new Error('Chrome 沒有起來');
}

const v = await version();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const n = ++id;
  pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const call = (m, p) => send(m, p, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride',
  { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });

await call('Page.navigate', { url });
await sleep(2500);   // 等字體、圖片、捲動處理跑完

// 第 6 個參數：量之前先在頁面裡跑一段 JS（例如切到某個分頁）
if (pre) { await call('Runtime.evaluate', { expression: pre }); await sleep(400); }

const rect = (await call('Runtime.evaluate', {
  expression: `(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  })()`,
  returnByValue: true,
})).result.result.value;

if (!rect) { console.error('找不到元素：' + selector); chrome.kill(); process.exit(1); }
await sleep(700);   // 捲動後的動畫（封面縮放、逐行浮現）安定下來

const shot = (await call('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
})).result.data;

writeFileSync(out, Buffer.from(shot, 'base64'));
console.log(`${out}  ${Math.round(rect.w)}×${Math.round(rect.h)}`);
ws.close();
chrome.kill();
process.exit(0);
