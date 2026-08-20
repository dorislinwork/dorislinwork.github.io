/* ==========================================================================
   一個指令上線
   --------------------------------------------------------------------------
   用法：  publish.cmd "更新說明"
          publish.cmd                （不給訊息會用日期當訊息）
          node tools/publish.mjs "更新說明"

   順序：產生網站 → 檢查 → commit → push
   任何一步失敗就停下來，不會把壞掉的版本推上線。
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const msgArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const MESSAGE = msgArg || `Update site ${stamp}`;

/** 跑一個指令，輸出直接接到終端機 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: false,
  });
  if (r.error) return { code: 1, out: '', err: String(r.error.message) };
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function fail(step, detail) {
  console.error('');
  console.error('─'.repeat(58));
  console.error(`  ${step} 失敗，沒有推上線。`);
  if (detail) console.error(`  ${detail}`);
  console.error('  線上的版本沒有被動到。');
  console.error('─'.repeat(58));
  process.exit(1);
}

/* ---- 1. 產生網站 ---- */
console.log('\n[1/4] 產生網站');
if (run('node', ['build.mjs']).code !== 0) fail('產生網站');

/* ---- 2. 檢查 ---- */
console.log('[2/4] 檢查連結與標記');
if (run('node', ['tools/check.mjs', '.']).code !== 0) {
  fail('檢查', '上面列出的問題要先修掉。');
}

/* ---- 3. commit ---- */
console.log('\n[3/4] 記錄變更');
if (run('git', ['add', '-A'], { capture: true }).code !== 0) fail('git add');

// 有沒有東西要 commit
const staged = run('git', ['diff', '--cached', '--quiet'], { capture: true });

if (staged.code !== 0) {
  const changed = run('git', ['diff', '--cached', '--name-only'], { capture: true });
  const files = changed.out.split('\n').filter(Boolean);
  console.log(`      ${files.length} 個檔案有變動`);
  files.slice(0, 8).forEach((f) => console.log(`        ${f}`));
  if (files.length > 8) console.log(`        …還有 ${files.length - 8} 個`);

  const commit = run('git', ['commit', '-m', MESSAGE], { capture: true });
  if (commit.code !== 0) fail('git commit', (commit.err || commit.out).trim().split('\n')[0]);
  console.log(`      已記錄：${MESSAGE}`);
} else {
  /* 沒有新變更，但可能有之前用 git commit 存好、還沒推上去的 commit。
     這裡如果直接結束，那些 commit 會永遠留在本機，而畫面上寫的是
     「不需要上線」—— 看起來像已經上線了，其實線上還是舊的。踩過這個坑。 */
  const rev = run('git', ['rev-list', '--count', '@{u}..HEAD'], { capture: true });
  const ahead = rev.code === 0 ? (Number(rev.out.trim()) || 0) : null;

  if (ahead === 0) {
    console.log('      沒有任何變更，也沒有待上線的 commit。');
    process.exit(0);
  }
  if (ahead === null) {
    console.log('      沒有新變更。查不到遠端狀態，還是試著推一次。');
  } else {
    console.log(`      沒有新變更，但有 ${ahead} 個已存好、還沒上線的 commit。`);
  }
}

/* ---- 4. push ---- */
console.log('\n[4/4] 推上 GitHub');
const push = run('git', ['push'], { capture: true });
if (push.code !== 0) {
  // git push 的正常訊息也走 stderr，所以要看有沒有真的像錯誤
  const detail = (push.err || push.out).trim().split('\n').filter(Boolean).pop() || '';
  fail('git push', detail.slice(0, 120));
}

console.log('');
console.log('═'.repeat(58));
console.log('  完成。約一分鐘後生效：');
console.log('  https://dorislinwork.github.io');
console.log('═'.repeat(58));
console.log('');
