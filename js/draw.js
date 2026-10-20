/**
 * draw.js —— 指尖绘形
 *
 * 思路分三段：
 *   1. 记录：食指单指伸出时，把指尖轨迹抽稀成一串点（live）
 *   2. 识别：抬手后判断这一笔是不是闭合图形，命中就把笔迹换成标准形状曲线
 *            （判定逻辑在 shape.js：首尾靠近 + 围出面积 + 包围盒不扁平）
 *   3. 成形：沿目标曲线撒一圈粒子，让它们从原来笔画的位置飞过去聚拢
 *
 * 认不出来也没关系——手绘的轨迹本身就会被粒子保留下来，写字就是写字，
 * 不会被硬套成一个图形。
 */

import { THEME, FX, DRAW } from './config.js';
import { clock, setDrawingNow, markStrokeEnd } from './state.js';
import { sprites, hueIndex } from './render.js';
import { ctx } from './ui.js';
import { sfx } from './audio.js';
import { analyzeStroke, pathLength, resample, placeTemplate } from './shape.js';

const rand = (a, b) => a + Math.random() * (b - a);

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
/**
 * 姿势刚成立、但还没到落笔判定那几帧的指尖轨迹。
 * 正式落笔时把这段接在笔头前面，写字不会"少一截"。
 */
let pending = [];

export const SHAPE_NAMES = { heart: '心形', circle: '圆形', star: '星形', triangle: '三角', square: '方形' };
export const shapeCount = () => sheets.length;
export const isDrawing = () => !!live;

/** 撤回刚刚写下的一笔（正在画的那一笔优先丢掉） */
export function undoStroke() {
  if (live) {
    live = null;
    setDrawingNow(false);
    return 'live';
  }

  const sh = sheets[sheets.length - 1];
  if (!sh || !sh.marks || sh.marks.length < 2) {
    sheets.pop();
    return sheets.length ? 'sheet' : null;
  }

  sh.marks.pop();
  sh.parts.length = sh.marks[sh.marks.length - 1];
  sh.strokes = Math.max(0, sh.strokes - 1);
  sh.touched = clock;                   // 撤回也算一次操作，别让剩下的内容提前淡出
  return 'stroke';
}

/* ---------------------- 笔迹 ---------------------- */

function beginStroke(x, y) {
  live = { pts: [{ x, y }], born: clock };
  lostTime = 0;
  pending.length = 0;
  setDrawingNow(true);
}

/** 落笔：把姿势稳定期缓存的轨迹接在笔头前面，然后交给 addPoint 继续 */
function beginFromPending(tip) {
  const pts = [];
  for (const p of pending) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= DRAW.sampleDist) {
      pts.push({ x: p.x, y: p.y });
    }
  }
  pending.length = 0;
  // 尾巴上离笔尖太近的点丢掉，避免和第一个点重复
  while (pts.length && Math.hypot(pts[pts.length - 1].x - tip.x, pts[pts.length - 1].y - tip.y) < DRAW.sampleDist * 0.6) {
    pts.pop();
  }
  beginStroke(tip.x, tip.y);
  if (pts.length) live.pts = pts.concat(live.pts);
  while (live.pts.length > DRAW.maxPoints) live.pts.shift();
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
  setDrawingNow(false);
  markStrokeEnd(clock);              // 收笔后一小段时间内不认响指（抬手不算弹指）
  if (!stroke || stroke.pts.length < DRAW.minPoints) return;

  const pts = stroke.pts;
  const total = pathLength(pts);
  if (total < DRAW.minLength) return;

  // 闭合 + 绕行方向 + 扁平度 三重判断都过了才会套模板，写字不会被强行规整
  let target = pts;
  let name = null;
  if (FX.autoShape) {
    const verdict = analyzeStroke(pts);
    if (verdict.hit) {
      target = verdict.hit.pts;
      name = verdict.hit.name;
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
    sheet = { parts: [], born: now, touched: now, strokes: 0, marks: [0] };
    sheets.push(sheet);
    while (sheets.length > DRAW.maxSheets) sheets.shift();
  }

  sheet.parts.push(...parts);
  sheet.marks.push(sheet.parts.length);  // 记下每一笔的结束位置，撤销时按笔回退
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
 * @param {Array} hands 手部状态数组，读 drawing / drawRaw / pts
 */
export function updateDraw(dt, hands) {
  if (!FX.draw) {
    if (live) {
      live = null;
      setDrawingNow(false);          // 关掉功能时直接丢弃未完成的笔画
    }
    pending.length = 0;
    updateSheets(dt);
    return;
  }

  // drawRaw 也一起找：姿势稳定期的轨迹要先缓存起来，落笔时才能把笔头补回来
  const h = hands.find(x => x.visible > 0.35 && x.pts && (x.drawing || x.drawRaw));

  if (h) {
    const tip = h.pts[8];            // 食指尖

    if (h.drawing) {
      lostTime = 0;
      if (live) addPoint(tip.x, tip.y);
      else beginFromPending(tip);
    } else if (h.drawRaw) {
      // 还没到落笔判定：先把这几帧的指尖轨迹记下来，落笔时接在笔头前面
      const last = pending[pending.length - 1];
      if (!last || Math.hypot(tip.x - last.x, tip.y - last.y) > 2) {
        pending.push({ x: tip.x, y: tip.y, t: clock });
      }
      while (pending.length && clock - pending[0].t > DRAW.preHold) pending.shift();
    }
  } else if (live) {
    lostTime += dt / 60;
    if (lostTime > 0.18) commitStroke();
  }

  if (!h) pending.length = 0;
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
  pending.length = 0;
  setDrawingNow(false);
}
