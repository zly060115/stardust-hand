/**
 * render.js —— 光点画笔
 *
 * 每个粒子如果都用径向渐变画，2000 个粒子会直接拖垮帧率。
 * 这里预生成 52 张不同色相的 64×64 光斑贴图，绘制时只做 drawImage + globalAlpha。
 */

import { SPRITE } from './config.js';

function makeSprite(hue) {
  const s = SPRITE.size;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.10, `hsla(${hue},98%,86%,0.96)`);
  grd.addColorStop(0.26, `hsla(${hue},96%,68%,0.52)`);
  grd.addColorStop(0.52, `hsla(${hue},95%,58%,0.15)`);
  grd.addColorStop(0.78, `hsla(${hue},95%,54%,0.035)`);
  grd.addColorStop(1.00, `hsla(${hue},95%,50%,0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return c;
}

/** 预渲染好的光斑贴图，索引即色相档位 */
export const sprites = [];
for (let i = 0; i < SPRITE.steps; i++) {
  sprites.push(makeSprite(SPRITE.hueMin + i * SPRITE.hueStep));
}

/** 色相 → 贴图下标（超出范围会夹到两端） */
export function hueIndex(hue) {
  const i = Math.round((hue - SPRITE.hueMin) / SPRITE.hueStep);
  return i < 0 ? 0 : (i >= SPRITE.steps ? SPRITE.steps - 1 : i);
}
