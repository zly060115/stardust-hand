/**
 * particles.js —— 星云粒子与背景星
 *
 * 这里只做两件事：让粒子按物理动，把粒子画出来。
 * 手部力场从参数注入（updateParticles(dt, hands)），所以本模块不依赖手势模块。
 */

import { THEME, SCALE, GALAXY, FIELD, MOTION, FX } from './config.js';
import { W, H, CX, CY } from './state.js';
import { sprites, hueIndex } from './render.js';
import { ctx } from './ui.js';

/** 星云粒子（受手部力场影响） */
export const P = [];
/** 远景星点（几乎静止，只闪烁） */
export const stars = [];

export const rand = (a, b) => a + Math.random() * (b - a);

/** 五个指尖的关键点下标：拇指、食指、中指、无名指、小指 */
export const TIPS = [4, 8, 12, 16, 20];

/**
 * 两个色相之间的插值，走 360 度圆上的最短路径。
 * 直接用线性插值会让「350° → 10°」穿过 180°（绿色），换主题时会出现一圈荧光绿。
 */
function mixHue(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/** 按当前主题把一个粒子重新上色（半径决定核心色 → 外围色的过渡） */
function tint(p) {
  const dx = p.x - CX;
  const dy = p.y - CY;
  const r = Math.sqrt(dx * dx + dy * dy);
  const rr = Math.min(1, r / (Math.min(W, H) * 0.8));
  p.ci = hueIndex(mixHue(THEME.innerHue, THEME.outerHue, rr) + rand(-4, 4));
}

/** 换主题后调用：已有粒子立刻换到新配色，不用等它们飞出去重生 */
export function refreshHues() {
  for (const p of P) tint(p);
}

/** 重置一个粒子的位置与外观。centerBias = 落在星系核心附近 */
export function spawnNebula(p, centerBias) {
  const R = Math.min(W, H) * 0.62;
  const r = R * Math.sqrt(Math.random()) * 1.55;

  // 初始就带对数螺旋臂，和差速旋转同向，开场即星系
  const arm = Math.random() < GALAXY.armRatio;
  const a = Math.random() * Math.PI * 2 + (arm ? r * GALAXY.armTwist : 0);

  if (centerBias) {
    p.x = CX + rand(-60, 60);
    p.y = CY + rand(-60, 60);
  } else {
    p.x = CX + Math.cos(a) * r;
    p.y = CY + Math.sin(a) * r * 0.92;
  }

  p.vx = rand(-0.4, 0.4);
  p.vy = rand(-0.4, 0.4);
  p.z = Math.random();                 // 视深：越大越近越亮
  p.size = 0.6 + p.z * 2.3;
  p.spin = 1 + (1 - p.z) * 0.6;
  p.boost = 0;

  tint(p);                             // 色相随半径从核心金 → 外围橙红
}

/** 按窗口面积决定粒子数量，重新铺满整片星空 */
export function initParticles() {
  P.length = 0;
  const area = W * H;
  const fixed = SCALE.nebula.fixed | 0;
  const n = fixed > 0
    ? fixed
    : Math.round(Math.min(SCALE.nebula.max, Math.max(SCALE.nebula.min, area / SCALE.nebula.areaDiv)));
  const sn = Math.round(Math.min(SCALE.stars.max, Math.max(SCALE.stars.min, area / SCALE.stars.areaDiv)));

  for (let i = 0; i < n; i++) {
    const p = {};
    spawnNebula(p, false);
    P.push(p);
  }

  stars.length = 0;
  for (let i = 0; i < sn; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      s: Math.random() < 0.86 ? 1 : 2,
      a: rand(0.08, 0.55),
      tw: rand(0.4, 2.2),
      ph: rand(0, 6.28),
    });
  }
}

/**
 * 面板调密度：原地增删粒子，不重建整片星空。
 * 减少时从尾部裁掉，增加时补在星系外围，画面不会整块跳变。
 */
export function setDensity(n) {
  const target = Math.max(400, Math.min(6000, Math.round(n)));
  SCALE.nebula.fixed = target;

  while (P.length > target) P.pop();
  while (P.length < target) {
    const p = {};
    spawnNebula(p, false);
    P.push(p);
  }
  return target;
}

/** 窗口尺寸变化后，把已有粒子按比例挪到新位置（不重新生成，避免画面跳变） */
export function remap(prevW, prevH) {
  if (prevW <= 1 || prevH <= 1) return;
  const sx = W / prevW;
  const sy = H / prevH;
  for (const p of P) {
    p.x = CX + (p.x - prevW / 2) * sx;
    p.y = CY + (p.y - prevH / 2) * sy;
  }
  for (const s of stars) {
    s.x *= sx;
    s.y *= sy;
  }
}

/**
 * 物理积分。
 * @param {number} dt 帧时间（按 60fps 归一）
 * @param {Array} hands 手部状态数组，只读。每只手提供 x/y/visible/strength/swirl/spread/pts
 */
export function updateParticles(dt, hands) {
  // 全局阻尼：握拳时更黏（快速塌缩），张开时更滑（旋臂流动）
  let damping = MOTION.dampMin + MOTION.dampRange;
  let anyVisible = false;
  let wsum = 0;
  let ssum = 0;
  for (const h of hands) {
    if (h.visible > 0.02) {
      anyVisible = true;
      wsum += h.visible;
      ssum += h.spread * h.visible;
    }
  }
  if (anyVisible) {
    damping = MOTION.dampMin + MOTION.dampRange * (ssum / wsum);
  }
  const dmp = Math.pow(damping, dt);

  for (let i = 0; i < P.length; i++) {
    const p = P[i];

    // --- 星系基础：差速旋转，中心快外围慢 ---
    const dx0 = p.x - CX;
    const dy0 = p.y - CY;
    const r0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) + 1;
    const omega = GALAXY.omega / (1 + r0 / GALAXY.radiusScale);
    const target = omega * r0 / 60;
    p.vx += (-dy0 / r0 * target - p.vx) * GALAXY.relax * dt;
    p.vy += (dx0 / r0 * target - p.vy) * GALAXY.relax * dt;

    // --- 手部力场 ---
    for (let k = 0; k < hands.length && k < 2; k++) {
      const h = hands[k];
      const v = h.visible;
      if (v < 0.02) continue;

      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const d2 = dx * dx + dy * dy + FIELD.soften;
      const d = Math.sqrt(d2);
      const ux = dx / d;
      const uy = dy / d;

      // 径向：正强度吸引，负强度排斥
      const F = h.strength * FIELD.radialK / d2 * v;
      p.vx -= ux * F * dt;
      p.vy -= uy * F * dt;

      // 切向：旋臂
      const Sw = h.swirl * FIELD.swirlK / d2 * v;
      p.vx += -uy * Sw * dt;
      p.vy += ux * Sw * dt;

      // 掌心软核：别让所有粒子挤成一个点
      if (h.strength > 0.6 && d < FIELD.coreR) {
        const push = (FIELD.coreR - d) * FIELD.coreK * v;
        p.vx += ux * push * dt;
        p.vy += uy * push * dt;
      }

      // 指尖：张手时星尘绕着指尖流
      if (h.spread > FIELD.fingertipSpread && h.pts) {
        const tp = h.pts;
        const gain = (h.spread - FIELD.fingertipSpread) * 1.8 * v;
        for (let f = 0; f < 5; f++) {
          const pt = tp[TIPS[f]];
          const ax = p.x - pt.x;
          const ay = p.y - pt.y;
          const ad2 = ax * ax + ay * ay + FIELD.fingertipSoften;
          const ad = Math.sqrt(ad2);
          const g = gain * FIELD.fingertipGain / ad2;
          p.vx -= ax / ad * g * dt;
          p.vy -= ay / ad * g * dt;
          const s2 = gain * FIELD.fingertipSwirl / ad2;
          p.vx += -ay / ad * s2 * dt;
          p.vy += ax / ad * s2 * dt;
        }
      }
    }

    // --- 阻尼 + 积分 ---
    p.vx *= dmp;
    p.vy *= dmp;

    // 爆发瞬间临时提高速度上限，让冲击真的打得出去
    if (p.boost > 0) p.boost = Math.max(0, p.boost - MOTION.boostDecay * dt);
    const vmax = MOTION.maxV + p.boost * MOTION.boostV;

    const sp2 = p.vx * p.vx + p.vy * p.vy;
    if (sp2 > vmax * vmax) {
      const k = vmax / Math.sqrt(sp2);
      p.vx *= k;
      p.vy *= k;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // --- 越界回收 ---
    const m = 200;
    if (p.x < -m || p.x > W + m || p.y < -m || p.y > H + m) spawnNebula(p, false);
  }
}

/** 远景星点：缓慢闪烁 */
export function drawStars(t) {
  if (!FX.stars) return;
  const fill = THEME.star;
  const gain = THEME.starBright;
  ctx.fillStyle = fill;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    ctx.globalAlpha = Math.min(1, s.a * gain * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph)));
    ctx.fillRect(s.x, s.y, s.s, s.s);
  }
}

/** 星云粒子：速度越快画得越大，模拟运动模糊 */
export function drawNebula() {
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    const speed = Math.abs(p.vx) + Math.abs(p.vy);
    const sz = p.size * (1 + Math.min(speed * 0.16, 1.5)) * 6.2;
    ctx.globalAlpha = 0.135 + p.z * 0.58;
    ctx.drawImage(sprites[p.ci], p.x - sz * 0.5, p.y - sz * 0.5, sz, sz);
  }
}
