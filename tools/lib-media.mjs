/* ==========================================================================
   把一個原始檔轉成網站用的格式
   --------------------------------------------------------------------------
   add-project.mjs（新增整件作品）與 admin.mjs（往既有作品補圖）共用。

   規則跟 build.mjs 的 localName() 對應，兩邊一定要一致：
     靜態圖  x.png  →  x.webp
     動畫    x.gif  →  x.mp4  ＋  x.webp（第一幀當 poster）
     影片    x.mp4  →  x.mp4  ＋  x.webp

   編碼參數放在這裡是刻意的 —— 之前散在各支腳本裡，改了一支另一支就不一致。
   projects.json 存的一律是「原始檔名」，build.mjs 自己會換副檔名。
   ========================================================================== */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { probeSize } from './lib-ffmpeg.mjs';

export const WIDTH = 1600;      // 輸出寬度上限
export const QUALITY = 82;      // WebP 品質
export const CRF = 26;          // H.264 品質（數字越小越好越大）

export const IMAGE_EXT = /\.(png|jpe?g|webp|tiff?|bmp)$/i;
export const GIF_EXT = /\.gif$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** 這個檔名是不是我們處理得了的素材 */
export const isUsable = (f) => IMAGE_EXT.test(f) || GIF_EXT.test(f) || VIDEO_EXT.test(f);

/** 依檔名排序。numeric 才會把 2.png 排在 10.png 前面。 */
export function sortNames(names) {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** 列出一個資料夾裡可用的素材，已排序 */
export function listSources(dir) {
  if (!existsSync(dir)) return [];
  return sortNames(
    readdirSync(dir)
      .filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile())
      .filter(isUsable),
  );
}

/** 轉檔後會產生的檔名（不含路徑）。build.mjs 的 localName() 是同一套規則。
 *
 * ⚠ 去掉副檔名要用正則，不能用 basename(file, extname(file))。
 * Node 把「開頭是點」的名字當成隱藏檔：extname('.gif') 回空字串、
 * basename('.gif','') 回 '.gif'，結果會產生 '.gif.mp4' 而 build.mjs 期待 '.mp4'，
 * 頁面就會指到不存在的檔案。舊站有 8 件作品的縮圖檔名正是 '.gif'
 * （Cargo 用 hash 定址，檔名可以只有副檔名），2026-08-21 在 Mirror 上踩到。 */
export function outputNames(file) {
  const stem = String(file).replace(/\.[^.]+$/, '');
  const moving = GIF_EXT.test(file) || VIDEO_EXT.test(file);
  return {
    main: moving ? `${stem}.mp4` : `${stem}.webp`,
    poster: moving ? `${stem}.webp` : null,
  };
}

/**
 * 轉一個檔案。
 * @returns {{file:string,w:number|null,h:number|null,inBytes:number,outBytes:number}}
 *          file 是「原始檔名」，直接可以放進 projects.json 的 block。
 */
export function convertOne({ ffmpeg, ffprobe, src, outDir, width = WIDTH }) {
  const file = basename(src);
  const size = probeSize(ffprobe, src) || {};
  const { main, poster } = outputNames(file);
  const dest = join(outDir, main);
  const posterPath = poster ? join(outDir, poster) : null;
  const inBytes = statSync(src).size;

  mkdirSync(outDir, { recursive: true });

  if (posterPath) {
    // 動畫與影片 → MP4 加一張第一幀
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error', '-i', src,
      '-vf', `scale='min(${width},iw)':-2:flags=lanczos`,
      '-c:v', 'libx264', '-crf', String(CRF), '-preset', 'slow',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      dest,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error', '-i', src,
      '-frames:v', '1',
      '-vf', `scale='min(${width},iw)':-2:flags=lanczos`,
      '-quality', '80', posterPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  } else {
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error', '-i', src,
      '-vf', `scale='min(${width},iw)':-1:flags=lanczos`,
      '-quality', String(QUALITY), '-compression_level', '6',
      dest,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  }

  const outBytes = statSync(dest).size
    + (posterPath && existsSync(posterPath) ? statSync(posterPath).size : 0);

  return { file, w: size.w || null, h: size.h || null, inBytes, outBytes };
}

/** ffmpeg 丟出來的錯誤通常很長，只留最後一行比較好讀 */
export function ffmpegError(e) {
  const msg = (e.stderr ? e.stderr.toString() : e.message).trim();
  return msg.split('\n').filter(Boolean).pop() || msg;
}
