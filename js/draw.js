/**
 * draw.js —— 指尖绘形
 *
 * 思路分三段：
 *   1. 记录：食指单指伸出时，把指尖轨迹抽稀成一串点（live）
 *   2. 识别：抬手后用一串点做闭合判断 + 形状匹配，命中就把笔迹换成标准形状曲线
 *   3. 成形：沿目标曲线撒一圈粒子，让它们从原来笔画的位置飞过去聚拢
 *
 * 形状匹配用的是最朴素的办法：把两条曲线都归一化到单位框，算平均最近距离。
 * 没有神经网络、没有第三方库，5 个模板比较 64 个点，一次不到 0.1ms。
 * 认不出来也没关系——手绘的轨迹本身就会被粒子保留下来，只是不规整而已。
 */

import { THEME, FX, DRAW } from './config.js';
import { clock } from './state.js';
import { sprites, hueIndex } from './render.js';
import { ctx } from './ui.js';
import { sfx } from './audio.js';

const rand = (a, b) => a + Math.random() * (b - a);
const len2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------------------- 几何工具 ---------------------- */

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len2(pts[i - 1], pts[i]);
  return L;
}

/** 按弧长等距重采样：把任意密度的笔画变成固定点数，方便比较与撒粒子 */
function resample(pts, n) {
  if (pts.length < 2) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const total = pathLength(pts);
  if (total <= 0) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const step = total / (n - 1);
  const out = [{ ...pts[0] }];
  let prev = pts[0];
  let i = 1;
  let acc = 0;                       // 从 prev 出发已走过的长度

  while (i < pts.length && out.length < n) {
    const cur = pts[i];
    const seg = len2(prev, cur);
    if (acc + seg >= step) {
      const t = (step - acc) / seg;
      const p = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(p);
      prev = p;
      acc = 0;
    } else {
      acc += seg;
      prev = cur;
      i++;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out;
}

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { x: minX, y: minY, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** 平移到原点、按最长边缩放到单位长度、中心放到 (0.5,0.5) */
function normalize(pts) {
  const b = bounds(pts);
  const m = Math.max(b.w, b.h) || 1;
  return pts.map(p => ({
    x: (p.x - b.cx) / m + 0.5,
    y: (p.y - b.cy) / m + 0.5,
  }));
}

/** A 上每个点到 B 的最近距离的平均值 */
function meanDist(A, B) {
  let sum = 0;
  for (const a of A) {
    let best = Infinity;
    for (const b of B) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / A.length;
}

/* ---------------------- 形状模板 ---------------------- */

function buildTemplates() {
  const raw = {};

  // 心形：经典参数曲线，y 轴翻成屏幕坐标（向下为正）
  const heart = [];
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    heart.push({ x, y: -y });
  }
  raw.heart = heart;

  const circle = [];
  for (let i = 0; i < 90; i++) {
    const t = (i / 90) * Math.PI * 2;
    circle.push({ x: Math.cos(t), y: Math.sin(t) });
  }
  raw.circle = circle;

  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    star.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  raw.star = star;

  raw.triangle = [{ x: 0, y: -1 }, { x: 0.95, y: 0.85 }, { x: -0.95, y: 0.85 }];
  raw.square = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];

  const out = {};
  for (const k in raw) out[k] = normalize(resample(raw[k], 64));
  return out;
}

const TEMPLATES = buildTemplates();

/** 把模板按用户笔迹的包围盒放回屏幕坐标（保持比例，不拉伸） */
function placeTemplate(name, userPts) {
  const b = bounds(userPts);
  const m = Math.max(b.w, b.h) || 1;
  return TEMPLATES[name].map(p => ({
    x: b.cx + (p.x - 0.5) * m,
    y: b.cy + (p.y - 0.5) * m,
  }));
}

/** 认形状：返回 { name, pts } 或 null */
export function matchShape(pts) {
  const A = normalize(resample(pts, 64));
  let best = null;
  let bestScore = Infinity;

  for (const name in TEMPLATES) {
    const err = (meanDist(A, TEMPLATES[name]) + meanDist(TEMPLATES[name], A)) * 0.5;
    // 心形给一点点偏好：它是这个作品的主角，平手时选它
    const score = err * (name === 'heart' ? 0.93 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (bestScore > DRAW.matchError) return null;
  return { name: best, pts: placeTemplate(best, pts) };
}

/* ---------------------- 状态 ---------------------- */

/**
 * 已落笔的内容，按"纸"分组。
 * 写一个字要好几笔，所以停笔 6 秒内的新笔画会叠在同一张纸上，
 * 一起淡出；超过间隔或纸写满了才换新纸。最多留 3 张。
 */
const sheets = [];
/** 当前这一笔 */
let live = null;
/** 手离开画面后等一小会儿再收笔，避免单帧丢失把一笔截断 */
let lostTime = 0;

export const SHAPE_NAMES = { heart: '心形', circle: '圆形', star: '星形', triangle: '三角', square: '方形' };
export const shapeCount = () => sheets.length;
export const isDrawing = () => !!live;

/* ---------------------- 笔迹 ---------------------- */

function beginStroke(x, y) {
  live = { pts: [{ x, y }], born: clock };
  lostTime = 0;
}

function addPoint(x, y) {
  if (!live) return;
  const last = live.pts[live.pts.length - 1];
  const d = Math.hypot(x - last.x, y - last.y);
  if (d < DRAW.sampleDist) return;

  // 突然跳很远（多半是关键点抖了一下），另起一笔更合理
  if (d > 160) {
    commitStroke();
    beginStroke(x, y);
    return;
  }

  live.pts.push({ x, y });
  if (live.pts.length > DRAW.maxPoints) commitStroke();
}

function commitStroke() {
  const stroke = live;
  live = null;
  lostTime = 0;
  if (!stroke || stroke.pts.length < DRAW.minPoints) return;

  const pts = stroke.pts;
  const total = pathLength(pts);
  if (total < DRAW.minLength) return;

  const closed = len2(pts[0], pts[pts.length - 1]) / total < DRAW.closeRatio;

  let target = pts;
  let name = null;
  if (FX.autoShape && closed) {
    const hit = matchShape(pts);
    if (hit) {
      target = hit.pts;
      name = hit.name;
    }
  }

  spawnShape(pts, target, name);
  if (name) sfx.shape();
}

/* ---------------------- 成形 ---------------------- */

/** 沿目标曲线撒粒子；出发点取在手绘笔迹上，于是有"飞过去聚拢"的观感 */
function spawnShape(from, target, name) {
  const tgt = resample(target, DRAW.perShape);
  const src = resample(from, 26);
  const parts = [];

  for (let i = 0; i < tgt.length; i++) {
    const s = src[i % src.length];
    parts.push({
      x: s.x + rand(-16, 16),
      y: s.y + rand(-16, 16),
      tx: tgt[i].x,
      ty: tgt[i].y,
      vx: rand(-0.6, 0.6),
      vy: rand(-0.6, 0.6),
      d: Math.random() * 0.45,          // 错峰出发，避免整体平移
      size: rand(1.5, 3.4),
      ph: Math.random() * 6.28,
      sp: rand(0.8, 2.2),
      hue: THEME.handHue + rand(-14, 14),
    });
  }

  const now = clock;
  let sheet = sheets[sheets.length - 1];
  const stale = !sheet || now - sheet.touched > DRAW.sheetGap;
  const full = sheet && sheet.parts.length + parts.length > DRAW.sheetParts;

  if (stale || full) {
    sheet = { parts: [], born: now, touched: now, strokes: 0 };
    sheets.push(sheet);
    while (sheets.length > DRAW.maxSheets) sheets.shift();
  }

  sheet.parts.push(...parts);
  sheet.strokes++;
  sheet.touched = now;                  // 每落一笔就续命，写字时不会写到一半就淡掉
  return name;
}

function updateSheets(dt) {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const sh = sheets[i];
    const age = clock - sh.touched;

    for (const p of sh.parts) {
      if (age < p.d) continue;
      // 成形阶段收得很紧，成形后只留一点点漂移，看起来像悬浮的星尘
      const k = age < DRAW.morphTime ? 0.26 : 0.045;
      p.vx += (p.tx - p.x) * k * dt;
      p.vy += (p.ty - p.y) * k * dt;
      const damp = Math.pow(0.84, dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    if (age > DRAW.life) sheets.splice(i, 1);
  }
}

/* ---------------------- 每帧推进 ---------------------- */

/**
 * @param {number} dt 帧时间（60fps 归一）
 * @param {Array} hands 手部状态数组，读 drawing / pts
 */
export function updateDraw(dt, hands) {
  if (FX.draw) {
    const h = hands.find(x => x.drawing && x.visible > 0.35 && x.pts);
    if (h) {
      lostTime = 0;
      const tip = h.pts[8];            // 食指尖
      if (live) addPoint(tip.x, tip.y);
      else beginStroke(tip.x, tip.y);
    } else if (live) {
      lostTime += dt / 60;
      if (lostTime > 0.18) commitStroke();
    }
  } else if (live) {
    live = null;                       // 关掉功能时直接丢弃未完成的笔画
  }

  updateSheets(dt);
}

/* ---------------------- 绘制 ---------------------- */

function trace(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawLive(t) {
  if (!live || live.pts.length < 2) return;
  const pts = live.pts;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = `hsla(${THEME.handHue},100%,74%,0.13)`;
  ctx.lineWidth = 7;
  trace(pts);

  ctx.strokeStyle = `hsla(${THEME.handHue},100%,86%,0.72)`;
  ctx.lineWidth = 1.6;
  trace(pts);

  // 笔尖光斑
  const tip = pts[pts.length - 1];
  const r = 24 + Math.sin(t * 6) * 3;
  const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
  g.addColorStop(0, `hsla(${THEME.handHue},100%,94%,0.6)`);
  g.addColorStop(0.5, `hsla(${THEME.handHue},100%,78%,0.18)`);
  g.addColorStop(1, `hsla(${THEME.handHue},100%,68%,0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawShapes(t) {
  drawLive(t);

  for (const sh of sheets) {
    const age = clock - sh.touched;
    const fadeIn = Math.min(1, age * 3.2);
    const fadeOut = Math.min(1, Math.max(0, (DRAW.life - age) / 3));
    const alpha = fadeIn * fadeOut;

    for (const p of sh.parts) {
      // 每个粒子自己的呼吸，整体才不像一条死线
      const breathe = 0.62 + 0.38 * Math.sin(t * p.sp + p.ph);
      const r = p.size * 5.4 * (0.9 + breathe * 0.2);
      ctx.globalAlpha = alpha * breathe * 0.9;
      ctx.drawImage(sprites[hueIndex(p.hue)], p.x - r, p.y - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

/* ---------------------- 演示用 ---------------------- */

/** 演示模式：模拟"用手指画心"，走同一条成形管线 */
export function playDemoShape(cx, cy, r) {
  const pts = [];
  for (let i = 0; i <= 90; i++) {
    const t = (i / 90) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push({ x: cx + (x / 16) * r + rand(-4, 4), y: cy - (y / 17) * r + rand(-4, 4) });
  }
  spawnShape(pts, placeTemplate('heart', pts), 'heart');
  sfx.shape();
}

export function clearShapes() {
  sheets.length = 0;
  live = null;
}
