/**
 * effects.js —— 爆发、响指冲击、指尖火星
 *
 * 这些是"后果"层：手势模块只报告发生了什么，这里负责把冲击波施加到粒子上、
 * 播放对应音效、并在画面上画出光环与火星。
 */

import { THEME, BURST, SNAP, SPARK, FX, D3 } from './config.js';
import { clock } from './state.js';
import { P, TIPS, rand } from './particles.js';
import { sprites, hueIndex } from './render.js';
import { ctx, toast } from './ui.js';
import { sfx } from './audio.js';

/** 正在扩散的爆发环 */
export const bursts = [];
let snapCool = 0;

/** 拇指食指捏合：掌心局部超新星 */
export function burst(x, y) {
  bursts.push({ x, y, life: 1, big: false });

  for (const p of P) {
    const dx = p.x - x;
    const dy = p.y - y;
    const dz = D3.enabled ? p.z : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1;
    if (d > BURST.radius) continue;
    const k = Math.pow(1 - d / BURST.radius, BURST.falloff) * BURST.power;
    p.vx += dx / d * k;
    p.vy += dy / d * k;
    // 冲击是球面的：z 上也要炸开，不然只看到一圈平面涟漪
    if (D3.enabled) p.vz += (dz / d * k) * 0.8 + rand(-0.6, 0.6) * k * 0.03;
    p.boost = Math.max(p.boost, BURST.boost);
  }

  sfx.burst();
}

/** 打响指：整片星空向外轰开 */
export function snapBlast(x, y) {
  if (clock - snapCool < SNAP.cooldown) return;
  snapCool = clock;

  bursts.push({ x, y, life: 1, big: true });

  for (const p of P) {
    const dx = p.x - x;
    const dy = p.y - y;
    const dz = D3.enabled ? p.z : 0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1;
    const k = SNAP.power + SNAP.powerK / (d + SNAP.powerR);
    p.vx += dx / d * k;
    p.vy += dy / d * k;
    // z 方向的散开幅度刻意放大：整个星空会"厚"起来，比纯 2D 震撼得多
    if (D3.enabled) p.vz += dz / d * k * 1.7 + rand(-1, 1) * k * 0.22;
    p.boost = 1;
  }

  sfx.snap();
  toast('✦  响指');
}

/* ---------------------- 指尖火星 ---------------------- */

const sparks = [];

/** 每个指尖沿手指方向持续迸出火星，张开度越高越密集 */
export function emitSparks(dt, hands) {
  if (!FX.sparks) return;
  for (const h of hands) {
    if (!h.pts || h.visible < 0.05) continue;

    const open = Math.max(0, h.spread - SPARK.openGate) / (1 - SPARK.openGate);
    if (open <= 0.02) continue;

    for (let f = 0; f < TIPS.length; f++) {
      const tip = h.pts[TIPS[f]];
      const base = h.pts[f === 0 ? 3 : TIPS[f] - 2];
      let dx = tip.x - base.x;
      let dy = tip.y - base.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;

      const n = SPARK.rate * dt * open * h.visible;
      let count = Math.floor(n);
      if (Math.random() < n - count) count++;

      while (count-- > 0 && sparks.length < SPARK.max) {
        const sp = SPARK.speedMin + Math.random() * SPARK.speedRange;
        sparks.push({
          x: tip.x + rand(-3.5, 3.5),
          y: tip.y + rand(-3.5, 3.5),
          vx: dx * sp + rand(-1.0, 1.0),
          vy: dy * sp + rand(-1.0, 1.0),
          life: 1,
          dec: rand(SPARK.decayMin, SPARK.decayMax),
          size: rand(1.1, 2.7),
          hue: h.strength > 1.2 ? THEME.warmHue : THEME.handHue,   // 握拳时火星偏暖
        });
      }
    }
  }
}

export function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.968;
    s.vy *= 0.968;
    s.life -= s.dec * dt;
    if (s.life <= 0) sparks.splice(i, 1);
  }
}

/** 爆发环寿命衰减 */
export function updateBursts(dt) {
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt * (b.big ? 0.0085 : 0.012);
    if (b.life <= 0) bursts.splice(i, 1);
  }
}

/**
 * 消费手势层抛出的事件。
 * 手势模块只做识别，不知道音效和特效的存在；这里把两者接起来。
 */
export function consumeHandEvents(hands) {
  for (const h of hands) {
    if (h.evPinch) {
      burst(h.evPinch.x, h.evPinch.y);
      h.evPinch = null;
    }
    if (h.evSnap) {
      snapBlast(h.evSnap.x, h.evSnap.y);
      h.evSnap = null;
    }
    if (h.evOpen) {
      sfx.open();
      h.evOpen = false;
    }
    if (h.evClose) {
      sfx.close();
      h.evClose = false;
    }
  }
}

/* ---------------------- 绘制 ---------------------- */

export function drawSparks() {
  for (let i = 0; i < sparks.length; i++) {
    const s = sparks[i];
    const r = s.size * (0.6 + s.life * 0.9);
    ctx.globalAlpha = s.life * s.life * 0.95;
    ctx.drawImage(sprites[hueIndex(s.hue)], s.x - r * 3, s.y - r * 3, r * 6, r * 6);
  }
}

export function drawBursts() {
  for (const b of bursts) {
    const k = 1 - b.life;
    const rad = b.big ? 40 + k * 1100 : 30 + k * 620;
    ctx.globalAlpha = b.life * b.life * (b.big ? 0.42 : 0.55);
    ctx.strokeStyle = THEME.ring;
    ctx.lineWidth = (b.big ? 1.6 : 1) + b.life * 3;
    ctx.beginPath();
    ctx.arc(b.x, b.y, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
}
