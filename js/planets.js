/**
 * planets.js —— 银河里的太阳系
 *
 * 把地球、月球等天体直接放进星系的三维场景里：
 * 它们有真实的 (x, y, z)，跟着 tilt.js 的相机一起旋转、透视，
 * 手往哪边移视角就往哪边转——转到位就能"看见"那颗星球。
 *
 * 手掌凑近某个天体（屏幕上靠近它的投影）时，天体会亮起并显示名字与简介。
 * 贴图全部程序化生成（离屏 canvas），不加载任何图片资源。
 */

import { FX } from './config.js';
import { W, H, CX, CY, clock } from './state.js';
import { proj } from './tilt.js';
import { hands } from './hands.js';
import { sprites, hueIndex } from './render.js';

/* ---------------------- 程序化贴图 ---------------------- */

/** 画一张 2:1 的球面经度展开贴图（宽 256），绘制时横向滚动模拟自转 */
function makeTexture(paint) {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  return c;
}

const PAINTERS = {
  sun: (g, w, h) => {
    g.fillStyle = '#ffb347';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const r = 6 + Math.random() * 26;
      g.fillStyle = `hsla(${18 + Math.random() * 26},100%,${55 + Math.random() * 30}%,0.30)`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, r, 0, 7);
      g.fill();
    }
  },
  mercury: (g, w, h) => {
    g.fillStyle = '#8f8377';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const r = 1.5 + Math.random() * 7;
      g.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${55 + Math.random() * 35 | 0},${48 + Math.random() * 30 | 0},0.5)`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, r, 0, 7);
      g.fill();
    }
  },
  venus: (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#e8c98a');
    grd.addColorStop(0.5, '#d9a95f');
    grd.addColorStop(1, '#c99a52');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `hsla(38,70%,${62 + Math.random() * 20}%,0.35)`;
      g.lineWidth = 3 + Math.random() * 8;
      const y = Math.random() * h;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + 10, w * 0.7, y - 12, w, y + 4);
      g.stroke();
    }
  },
  earth: (g, w, h) => {
    g.fillStyle = '#1a5fb4';
    g.fillRect(0, 0, w, h);
    // 大陆：一串彼此粘连的绿斑
    for (let i = 0; i < 16; i++) {
      const cx0 = Math.random() * w, cy0 = Math.random() * h;
      g.fillStyle = `hsla(${96 + Math.random() * 30},45%,${30 + Math.random() * 14}%,0.92)`;
      for (let j = 0; j < 9; j++) {
        g.beginPath();
        g.arc(cx0 + (Math.random() - 0.5) * 60, cy0 + (Math.random() - 0.5) * 34,
          6 + Math.random() * 16, 0, 7);
        g.fill();
      }
    }
    // 云
    for (let i = 0; i < 22; i++) {
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h,
        12 + Math.random() * 26, 3 + Math.random() * 5, 0, 0, 7);
      g.fill();
    }
  },
  moon: (g, w, h) => {
    g.fillStyle = '#b9b4aa';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const r = 2 + Math.random() * 9;
      const x = Math.random() * w, y = Math.random() * h;
      g.fillStyle = 'rgba(90,88,82,0.5)';
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      g.fillStyle = 'rgba(230,228,220,0.45)';
      g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, 7); g.fill();
    }
    // 月海
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(70,70,72,0.42)';
      g.beginPath();
      g.ellipse(Math.random() * w, h * 0.25 + Math.random() * h * 0.4,
        14 + Math.random() * 18, 9 + Math.random() * 12, 0, 0, 7);
      g.fill();
    }
  },
  mars: (g, w, h) => {
    g.fillStyle = '#c1552b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      g.fillStyle = `hsla(${8 + Math.random() * 16},55%,${28 + Math.random() * 22}%,0.42)`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 15, 0, 7);
      g.fill();
    }
    // 极冠
    g.fillStyle = 'rgba(245,245,240,0.75)';
    g.fillRect(0, 0, w, 7);
    g.fillRect(0, h - 6, w, 6);
  },
  jupiter: (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const band = Math.sin(y * 0.22) * 0.5 + Math.sin(y * 0.07 + 1.7) * 0.5;
      g.fillStyle = `hsl(${20 + band * 14}, ${48 + band * 18}%, ${46 + band * 22}%)`;
      g.fillRect(0, y, w, 1);
    }
    // 大红斑
    g.fillStyle = 'rgba(190,66,40,0.9)';
    g.beginPath();
    g.ellipse(w * 0.68, h * 0.62, 17, 9, 0, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(230,120,90,0.6)';
    g.beginPath();
    g.ellipse(w * 0.68, h * 0.62, 11, 5.5, 0, 0, 7);
    g.fill();
  },
  saturn: (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const band = Math.sin(y * 0.18 + 0.6) * 0.5 + Math.sin(y * 0.05) * 0.5;
      g.fillStyle = `hsl(${38 + band * 8}, ${44 + band * 16}%, ${58 + band * 16}%)`;
      g.fillRect(0, y, w, 1);
    }
  },
};

/* ---------------------- 天体定义 ---------------------- */

/**
 * u / v：单位盘坐标（-1 ~ 1），由 placeOf() 按视口比例映射到屏幕。
 * 布局刻意留白：右上角是按钮区、左下角是手势提示区，都不放天体。
 * z：深度（正 = 靠近镜头）
 * r：基准半径（像素，再乘视口缩放）
 * spin：自转速度（贴图滚动）
 */
const BODIES = [
  { key: 'sun',     name: '太阳', hue: 32,  u: -0.60,  v: -0.18, z: -640, r: 40, spin: 0.010,
    info: '恒星 · 光和热的源头' },
  { key: 'mercury', name: '水星', hue: 30,  u: 0.62,   v: 0.52,  z: -180, r: 12, spin: 0.006,
    info: '离太阳最近的行星' },
  { key: 'venus',   name: '金星', hue: 40,  u: -0.20,  v: 0.68,  z: 90,   r: 17, spin: -0.004,
    info: '启明星 · 被浓云包裹' },
  { key: 'earth',   name: '地球', hue: 210, u: 0.60,   v: -0.46, z: 150,  r: 24, spin: 0.014,
    info: '我们的家 · 蔚蓝星球' },
  { key: 'moon',    name: '月球', hue: 45,  u: 0,      v: 0,     z: 0,    r: 9,  spin: 0.003,
    orbit: { parent: 'earth', rx: 76, ry: 30, rz: 30, w: 0.35 },
    info: '地球唯一的卫星' },
  { key: 'mars',    name: '火星', hue: 12,  u: -0.66,  v: 0.42,  z: 430,  r: 16, spin: 0.011,
    info: '红色星球 · 人类的下一站' },
  { key: 'jupiter', name: '木星', hue: 24,  u: 0.10,   v: -0.80, z: -430, r: 34, spin: 0.020,
    info: '气态巨行星 · 大红斑在咆哮' },
  { key: 'saturn',  name: '土星', hue: 44,  u: 0.72,   v: 0.06,  z: -760, r: 25, spin: 0.016,
    ring: true, info: '戴着光环的优雅行星' },
];

const byKey = new Map(BODIES.map(b => [b.key, b]));

/** 预生成贴图与光晕下标 */
for (const b of BODIES) {
  b.tex = makeTexture(PAINTERS[b.key]);
  b.sprite = sprites[hueIndex(b.hue)];
}

/* ---------------------- 绘制 ---------------------- */

/**
 * 画一个球：裁剪圆内滚动贴图 + 明暗球面 + 边缘亮环。
 * 光从画面左上来（与星系核心的视觉一致）。
 */
function drawSphere(b, x, y, r, t) {
  const ctx = canvasCtx;

  // 土星环（后半）：先画整环，球体盖住中段，再补前半段
  if (b.ring) drawRing(x, y, r, true);

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();

  // 自转：贴图横向滚动，宽度够滚一圈（画两份拼接）
  const tw = r * 2.6;                     // 贴图显示宽度（略大于直径，弧面拉伸感）
  const th = r * 2.6 * 0.5;
  const off = ((t * b.spin * 60) % tw + tw) % tw;
  ctx.drawImage(b.tex, x - r - off, y - th / 2, tw, th);
  ctx.drawImage(b.tex, x - r - off + tw, y - th / 2, tw, th);

  // 球面明暗：光从左上来
  const sh = ctx.createRadialGradient(x - r * 0.45, y - r * 0.5, r * 0.1, x, y, r * 1.25);
  sh.addColorStop(0, 'rgba(255,255,255,0.16)');
  sh.addColorStop(0.45, 'rgba(0,0,0,0)');
  sh.addColorStop(0.82, 'rgba(4,2,8,0.55)');
  sh.addColorStop(1, 'rgba(2,1,6,0.92)');
  ctx.fillStyle = sh;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);

  if (b.key === 'sun') {
    // 太阳不受明暗影响，反而是自发光
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.15);
    gr.addColorStop(0, 'rgba(255,220,150,0.55)');
    gr.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // 边缘薄光（大气感）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = b.key === 'earth'
    ? 'rgba(120,190,255,0.5)'
    : `hsla(${b.hue},80%,70%,0.28)`;
  ctx.lineWidth = Math.max(1, r * 0.055);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.01, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (b.ring) drawRing(x, y, r, false);
}

function drawRing(x, y, r, backHalf) {
  const ctx = canvasCtx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.42);
  const a0 = backHalf ? Math.PI : 0;
  const a1 = backHalf ? Math.PI * 2 : Math.PI;
  const rings = [
    [1.45, 1.85, 'rgba(226,204,158,0.55)'],
    [1.92, 2.18, 'rgba(196,172,128,0.34)'],
  ];
  for (const [k0, k1, col] of rings) {
    ctx.strokeStyle = col;
    ctx.lineWidth = (k1 - k0) * r;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * (k0 + k1) / 2, r * (k0 + k1) / 2 * 0.32, 0, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------- 每帧更新与绘制 ---------------------- */

let canvasCtx = null;
let hovered = null;         // 当前被手掌照亮的天体
let hoverSince = 0;

export function setCanvas(c) { canvasCtx = c; }

export function initPlanets() {
  hovered = null;
}

/**
 * 自适应布局：按视口宽高比把"单位盘"(u,v ∈ -1..1) 映射到屏幕。
 * 竖屏时按高度压缩、横屏时按宽度压缩，保证天体永远落在画面之内。
 * 直接写 fx / fy 会因为屏幕比例不同把土星挤出屏幕（实测过）。
 */
function placeOf(b, out) {
  const aspect = W / Math.max(1, H);
  const sx = Math.min(1, aspect / 1.6);     // 屏幕越窄，横向越收
  const sy = Math.min(1, 1.6 / aspect);     // 屏幕越扁，纵向越收
  out.x = CX + b.u * sx * W * 0.42;
  out.y = CY + b.v * sy * H * 0.42;
  return out;
}

const _p = { x: 0, y: 0 };

/** 更新投影位置与悬停检测 */
export function updatePlanets(t) {
  if (!FX.planets || !canvasCtx) return;
  hovered = null;

  // 找一只"探索用"的手：可见、且没在写字
  let hx = -1e9, hy = -1e9, active = false;
  for (const h of hands) {
    if (h.visible > 0.25 && !h.drawing && !h.drawRaw) {
      hx = h.x; hy = h.y; active = true;
      break;
    }
  }

  // 全局缩放：小屏（手机）上天体整体缩小，免得挤成一团
  const dim = Math.min(W, H);
  const sizeK = Math.max(0.55, Math.min(1.25, dim / 700));

  for (const b of BODIES) {
    placeOf(b, _p);
    let wx = _p.x;
    let wy = _p.y;
    let wz = b.z;

    if (b.orbit) {
      const p = byKey.get(b.orbit.parent);
      const a = t * b.orbit.w;
      wx = p._wx + Math.cos(a) * b.orbit.rx * sizeK;
      wy = p._wy + Math.sin(a) * b.orbit.ry * sizeK;
      wz = p._wz + Math.sin(a * 0.9) * b.orbit.rz * sizeK;
    }
    b._wx = wx; b._wy = wy; b._wz = wz;
    b._sizeK = sizeK;

    const pr = proj(wx, wy, wz, b._pr || (b._pr = {}));
    b._sx = pr.x; b._sy = pr.y; b._k = pr.k * sizeK;
    b._ok = pr.ok;

    if (active && pr.ok) {
      const r = Math.max(4, b.r * b._k);
      const d = Math.hypot(hx - pr.x, hy - pr.y);
      if (d < Math.max(r * 2.4, 70)) hovered = b;
    }
  }
}

/** 绘制全部天体（按深度从远到近） */
export function drawPlanets(t) {
  if (!FX.planets || !canvasCtx) return;
  const ctx = canvasCtx;
  const list = BODIES.filter(b => b._ok).sort((a, c) => a._wz - c._wz);

  for (const b of list) {
    const r = Math.max(4, b.r * b._k);
    const hot = b === hovered;

    // 外发光
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = hot ? 0.55 : 0.34;
    const g = r * (b.key === 'sun' ? 4.6 : 3.1);
    ctx.drawImage(b.sprite, b._sx - g, b._sy - g, g * 2, g * 2);
    ctx.restore();

    drawSphere(b, b._sx, b._sy, r, t);

    // 悬停高亮圈
    if (hot) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 1 + Math.sin(t * 4) * 0.06;
      ctx.strokeStyle = `hsla(${b.hue},90%,72%,0.6)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(b._sx, b._sy, r * 1.45 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 标签：只给悬停的天体 + 淡淡标出大天体
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (hovered) {
    if (hovered !== hoverSince) hoverSince = hovered;
    const b = hovered;
    const r = Math.max(4, b.r * b._k);
    const y = b._sy - r * 1.5 - 26;
    ctx.font = `${Math.max(13, r * 0.5)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(255,238,203,0.95)';
    ctx.fillText(b.name, b._sx, y);
    ctx.font = `${Math.max(10, r * 0.32)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = 'rgba(255,238,203,0.55)';
    ctx.fillText(b.info, b._sx, y + Math.max(17, r * 0.55));
  } else {
    hoverSince = null;
  }

  // 大天体的常驻淡标签（帮助"寻星"）
  for (const b of BODIES) {
    if (!b._ok || b === hovered) continue;
    const r = Math.max(4, b.r * b._k);
    if (r < 12) continue;   // 太小的天体不挂常驻标签，免得糊成一团
    ctx.font = '11px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = `hsla(${b.hue},70%,78%,${b._k > 0.95 ? 0.5 : 0.3})`;
    ctx.fillText(b.name, b._sx, b._sy - r - 16);
  }
  ctx.restore();
}

/** 调试：当前每颗天体的屏幕位置与半径（控制台可用 planets.__debug() 查看） */
export function __debug() {
  return BODIES.map(b => ({
    key: b.key, x: Math.round(b._sx), y: Math.round(b._sy),
    r: +(Math.max(4, b.r * b._k)).toFixed(1), ok: !!b._ok,
  }));
}

/** 月球轨道虚线（帮助看清地月关系） */
export function drawOrbits() {
  if (!FX.planets || !canvasCtx) return;
  const ctx = canvasCtx;
  const m = byKey.get('moon');
  if (!m || !m._ok) return;
  const p = byKey.get('earth');
  if (!p || !p._ok) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(200,220,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const o = m.orbit;
  const K = m._sizeK || 1;
  ctx.ellipse(p._sx, p._sy, o.rx * K * p._k, o.ry * K * p._k, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
