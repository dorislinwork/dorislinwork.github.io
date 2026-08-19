/* ==========================================================================
   找 ffmpeg / ffprobe
   --------------------------------------------------------------------------
   winget 裝的 ffmpeg 需要重開終端機才會進 PATH，所以先試 PATH，
   找不到就去翻 winget 的安裝目錄。add-project.mjs 與 convert-gifs.mjs 共用。
   ========================================================================== */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function locate(exeName) {
  // 1. PATH
  try {
    execFileSync(exeName, ['-version'], { stdio: 'ignore' });
    return exeName;
  } catch (e) { /* 繼續找 */ }

  // 2. winget 的安裝位置
  const base = join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages');
  if (!existsSync(base)) return null;

  const target = exeName.toLowerCase() + '.exe';
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase() === target) return p;
    }
  }
  return null;
}

let cachedFfmpeg;
let cachedFfprobe;

export function findFfmpeg() {
  if (cachedFfmpeg === undefined) cachedFfmpeg = locate('ffmpeg');
  return cachedFfmpeg;
}

export function findFfprobe() {
  if (cachedFfprobe === undefined) cachedFfprobe = locate('ffprobe');
  return cachedFfprobe;
}

/** 沒找到就印出安裝指示並結束，避免後面噴一堆看不懂的錯誤 */
export function requireFfmpeg() {
  const ffmpeg = findFfmpeg();
  const ffprobe = findFfprobe();
  if (!ffmpeg || !ffprobe) {
    console.error('找不到 ffmpeg／ffprobe。請先在 PowerShell 執行：\n');
    console.error('    winget install Gyan.FFmpeg\n');
    console.error('裝完不需要重開終端機，這些腳本會自己找到它。');
    process.exit(1);
  }
  return { ffmpeg, ffprobe };
}

/** 讀出圖片或影片的實際像素尺寸 */
export function probeSize(ffprobe, file) {
  try {
    const out = execFileSync(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      file,
    ], { encoding: 'utf8' }).trim();
    const [w, h] = out.split(',').map(Number);
    return (w && h) ? { w, h } : null;
  } catch (e) {
    return null;
  }
}
