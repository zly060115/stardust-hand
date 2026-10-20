/**
 * viewport.js —— 画布尺寸
 *
 * 只负责算尺寸、设 transform、铺底色。
 * 粒子的坐标重映射交给 particles.remap()，避免这里反过来依赖粒子模块。
 */

import { THEME, PERF } from './config.js';
import * as S from './state.js';
import { canvas, ctx } from './ui.js';

/**
 * 重置画布到窗口大小。
 * @returns {{prevW:number, prevH:number}} 变化前的尺寸，调用方据此决定是否重映射粒子
 */
export function resizeCanvas() {
  const prevW = S.W;
  const prevH = S.H;

  const dpr = Math.min(window.devicePixelRatio || 1, PERF.maxDPR);
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S.setViewport(w, h, dpr);

  paintBg();

  return { prevW, prevH };
}

/** 用当前底色整块重铺一次：换主题时把旧配色的残影一次清掉 */
export function paintBg() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.bgFill;
  ctx.fillRect(0, 0, S.W, S.H);
}
