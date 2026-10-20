/**
 * shape.js —— 闭合图形识别（纯几何，不碰 DOM，可直接用 node 跑回归测试）
 *
 * 只靠"平均最近距离"匹配是不够的：星形模板本身就是一条从外顶点折到内凹点的
 * 往返折线，而汉字笔画天生就是折线，两者在归一化空间里距离天然很小。
 * 于是加了三个前置判据，宁可认不出，也不要把字改掉：
 *
 *   1. 环绕方向  笔画必须真的绕了一圈（净转角 ≈ 2π，且转向一致）
 *                —— 挡掉「一」「十」「人」这类来回笔画和连笔字
 *   2. 扁平度    包围盒短边/长边不能太小
 *                —— 挡掉横、竖、撇、捺这类细长笔画
 *   3. 尖角数    星形必须有 5 个左右的径向峰，且外/内半径比够大
 *                —— 挡掉没有尖角的团块被认成五角星
 */

import { DRAW } from './config.js';

const len2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------------------- 基础几何 ---------------------- */

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len2(pts[i - 1], pts[i]);
  return L;
}

/** 按弧长等距重采样：把任意密度的笔画变成固定点数，方便比较 */
export function resample(pts, n) {
  if (pts.length < 2) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const total = pathLength(pts);
  if (total <= 0) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const step = total / (n - 1);
  const out = [{ ...pts[0] }];
  let prev = pts[0];
  let i = 1;
  let acc = 0;

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

/** 三点加权平滑，压掉关键点抖动，转角统计才不会被噪声淹没 */
function smooth(pts, passes = 2) {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    const out = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      out.push({
        x: (cur[i - 1].x + cur[i].x * 2 + cur[i + 1].x) / 4,
        y: (cur[i - 1].y + cur[i].y * 2 + cur[i + 1].y) / 4,
      });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

export function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX, y: minY,
    w: maxX - minX, h: maxY - minY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
  };
}

/** 平移到原点、按最长边缩放到单位长度、中心放到 (0.5,0.5) */
export function normalize(pts) {
  const b = bounds(pts);
  const m = Math.max(b.w, b.h) || 1;
  return pts.map(p => ({
    x: (p.x - b.cx) / m + 0.5,
    y: (p.y - b.cy) / m + 0.5,
  }));
}

/** A 上每个点到 B 的最近距离的平均值 */
export function meanDist(A, B) {
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

/* ---------------------- 判据 ---------------------- */

/**
 * 转角统计：total 是走过的转角绝对值之和，net 是净转角（正负抵消后的绝对值）。
 * 只作诊断参考，不参与判定 —— 手抖会让它剧烈波动。
 */
export function turnStats(pts) {
  const p = resample(smooth(pts, 2), 48);
  let total = 0;
  let net = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const a1 = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x);
    const a2 = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
    let d = a2 - a1;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    total += Math.abs(d);
    net += d;
  }
  return { total, net: Math.abs(net), oneWay: total > 0.6 ? Math.abs(net) / total : 0 };
}

/**
 * 笔画围出的有向面积 / 包围盒面积。
 * 这是判断"到底有没有绕成一圈"最稳的指标：
 * 来回折的笔画（横、竖、连笔字）面积正负抵消，趋近 0；
 * 真正闭合的图形至少占包围盒三成。手抖对它的影响几乎为零。
 */
export function areaRatio(pts) {
  const b = bounds(pts);
  const box = b.w * b.h;
  if (box < 1) return 0;

  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum / 2) / box;
}

/** 绕质心的半径轮廓：峰数（尖角数）与 外/内 半径比 */
export function radialProfile(pts) {
  const b = bounds(pts);
  const BINS = 60;
  const rmax = new Array(BINS).fill(0);

  for (const p of pts) {
    const dx = p.x - b.cx;
    const dy = p.y - b.cy;
    const r = Math.hypot(dx, dy);
    const i = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * BINS) % BINS;
    if (r > rmax[i]) rmax[i] = r;
  }

  // 空扇区用左右邻居补，避免 0 参与计算
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < BINS; i++) {
      if (rmax[i] === 0) {
        const a = rmax[(i - 1 + BINS) % BINS];
        const c = rmax[(i + 1) % BINS];
        rmax[i] = (a + c) / 2 || 0;
      }
    }
  }

  // 循环平滑，去掉箱子边界造成的伪峰
  for (let k = 0; k < 2; k++) {
    const cp = rmax.slice();
    for (let i = 0; i < BINS; i++) {
      rmax[i] = (cp[(i - 1 + BINS) % BINS] + cp[i] * 2 + cp[(i + 1) % BINS]) / 4;
    }
  }

  // 只保留"够高"的峰：抖动在轮廓上蹭出来的小包不算尖角
  const gmin = Math.min(...rmax);
  const gmax = Math.max(...rmax);
  const span = gmax - gmin || 1;

  let peaks = 0;
  const peakAngles = [];
  for (let i = 0; i < BINS; i++) {
    const a = rmax[(i - 1 + BINS) % BINS];
    const c = rmax[(i + 1) % BINS];
    if (rmax[i] > a && rmax[i] >= c && (rmax[i] - gmin) / span >= 0.5) {
      peaks++;
      peakAngles.push(i / BINS * Math.PI * 2);
    }
  }

  const mx = Math.max(...rmax);
  const mn = Math.min(...rmax.filter(v => v > 0));
  return { peaks, ratio: mx / (mn || 1), peakAngles };
}

/** 峰间距的离散系数：五角星的尖角均匀分布（间隔 ~72°），乱折的笔画不是 */
export function peakRegularity(angles) {
  if (angles.length < 3) return Infinity;
  const gaps = [];
  const sorted = angles.slice().sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    gaps.push(next - sorted[i]);
  }
  const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
  const variance = gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / (mean || 1);
}

/** 线段是否相交（不含共端点） */
function segCross(p1, p2, p3, p4) {
  const d1 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const d2 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
  const d3 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
  const d4 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 自交叉次数：一笔画五角星（走对角线）至少交叉 4 次。
 * 写字的折线哪怕再乱，也很少自己绕出这么多交叉。
 */
export function selfCrossings(pts) {
  const p = resample(smooth(pts, 2), 64);
  let n = 0;
  for (let i = 1; i < p.length - 2; i++) {
    for (let j = i + 2; j < p.length - 1; j++) {
      if (segCross(p[i - 1], p[i], p[j], p[j + 1])) n++;
    }
  }
  return n;
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
export function placeTemplate(name, userPts) {
  const b = bounds(userPts);
  const m = Math.max(b.w, b.h) || 1;
  return TEMPLATES[name].map(p => ({
    x: b.cx + (p.x - 0.5) * m,
    y: b.cy + (p.y - 0.5) * m,
  }));
}

/** 模板比对：返回 { name, pts } 或 null */
export function matchShape(pts) {
  const A = normalize(resample(pts, 64));
  const prof = radialProfile(pts);
  const cross = selfCrossings(pts);
  const starReg = peakRegularity(prof.peakAngles);

  // 每个模板的前置条件：不过就根本不参与比较，
  // 避免某个"长得什么都像一点"的模板把笔迹抢走
  const gate = {
    // 星形：尖角数量适中、分布均匀、内外半径比够大。
    // 两种画法都认：十顶点轮廓（内外半径比 ~2.4）和一笔画（自交叉 ≥ 4）。
    // 写字的折线两条都不满足 —— 它要么穿过质心（半径比爆表）又不自交叉。
    star: prof.peaks >= DRAW.starPeaks[0]
      && prof.peaks <= DRAW.starPeaks[1]
      && prof.ratio >= DRAW.starRadial
      && prof.ratio <= DRAW.starRadialMax
      && starReg <= DRAW.starRegularity
      || (prof.peaks >= 4 && cross >= 4),
    // 圆形：径向起伏必须小，方的（1.41）、尖的都不是圆
    circle: prof.ratio <= DRAW.circleRoundness,
    // 心形：轮廓不穿过质心（比率 ~2~3）。乱折的笔画离质心极近，比率会爆表
    heart: prof.ratio <= DRAW.heartRadial,
    // 方形：外接对角比 1.41 左右，太尖的是星或三角
    square: prof.ratio >= 1.2 && prof.ratio <= 1.9,
    // 三角形：2~4 个尖角
    triangle: prof.peaks >= 2 && prof.peaks <= 4,
  };

  let best = null;
  let bestScore = Infinity;

  for (const name in TEMPLATES) {
    if (gate[name] === false) continue;

    const err = (meanDist(A, TEMPLATES[name]) + meanDist(TEMPLATES[name], A)) * 0.5;
    // 心形给一点点偏好：它是这个作品的主角，平手时选它
    const score = err * (name === 'heart' ? 0.93 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (!best || bestScore > DRAW.matchError) return null;
  return { name: best, pts: placeTemplate(best, pts) };
}

/**
 * 一笔画完之后的总判断：先看像不像一个闭合图形，再决定套哪个模板。
 * 返回 { closed, hit, why }，why 只用于调试。
 */
export function analyzeStroke(pts) {
  if (pts.length < 3) return { closed: false, hit: null, why: 'short' };

  const b = bounds(pts);
  const size = Math.max(b.w, b.h);
  if (size < DRAW.minShapeSize) return { closed: false, hit: null, why: 'small' };

  // 扁平：横、竖、撇、捺都不该被规整
  if (Math.min(b.w, b.h) / size < DRAW.minAspect) {
    return { closed: false, hit: null, why: 'flat' };
  }

  const total = pathLength(pts);
  const gap = len2(pts[0], pts[pts.length - 1]) / total;
  const area = areaRatio(pts);

  // 首尾靠近，且笔画真的围出了一块面积
  const closed = gap < DRAW.closeRatio && area >= DRAW.minArea;

  return {
    closed,
    hit: closed ? matchShape(pts) : null,
    why: closed ? 'closed' : (gap >= DRAW.closeRatio ? 'gap' : 'no-area'),
    area,
  };
}

export const SHAPE_NAMES = { heart: '心形', circle: '圆形', star: '星形', triangle: '三角', square: '方形' };
