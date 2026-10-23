/**
 * hands.js —— 手势解析与骨架绘制
 *
 * 设计要点：这个模块不直接触发音效或爆发，只把"发生了什么"记在手的 ev* 字段上，
 * 由 effects.consumeHandEvents() 统一消费。这样手势层可以独立测试，也不会和特效模块互相 import 成环。
 *
 * 事件字段（消费后由消费方清空）：
 *   evPinch {x,y}  拇指食指捏合
 *   evSnap  {x,y}  打响指
 *   evOpen         张开
 *   evClose        握拳
 *
 * "响指"与"单指写字"的区分：姿势几乎一样，靠动作时序 + 拇指/食指的分工来分，
 * 判定逻辑单独放在 snap.js（纯函数、可测试），这里只负责喂样本和加互斥锁。
 */

import { THEME, GESTURE, FIELD, FX, D3 } from './config.js';
import { clock, mode, drawingNow, strokeEndClock, W, H } from './state.js';
import { ctx } from './ui.js';
import { pushSample, makeSample, detectSnap } from './snap.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 手部骨架的 21 点连接关系 */
export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // 拇指
  [0, 5], [5, 6], [6, 7], [7, 8],           // 食指
  [5, 9], [9, 10], [10, 11], [11, 12],      // 中指
  [9, 13], [13, 14], [14, 15], [15, 16],    // 无名指
  [13, 17], [17, 18], [18, 19], [19, 20],   // 小指
  [0, 17],                                  // 掌根
];

/**
 * 绘制用的"链条"：每根手指一条（腕→指尖），掌缘一条闭合弧。
 * 骨架的美丑就差在这里——按关键点直连是"医疗探针"，
 * 沿链条画平滑曲线、再让线宽渐细，才是"星尘之手"。
 */
export const CHAINS = [
  { pts: [0, 1, 2, 3, 4], taper: true },              // 拇指
  { pts: [5, 6, 7, 8], taper: true },                 // 食指
  { pts: [9, 10, 11, 12], taper: true },              // 中指
  { pts: [13, 14, 15, 16], taper: true },             // 无名指
  { pts: [17, 18, 19, 20], taper: true },             // 小指
  { pts: [0, 5, 9, 13, 17, 0], taper: false, palm: true }, // 掌缘（含腕底闭合）
];

/** 五个指尖的关键点下标 */
const TIP_IDS = [4, 8, 12, 16, 20];

export function newHand() {
  return {
    seen: false,
    visible: 0,
    x: 0, y: 0, tx: 0, ty: 0,      // 当前 / 目标位置（掌心）
    spread: 0, tSpread: 0,          // 当前 / 目标张开度 0~1
    strength: 0, swirl: 0,          // 派生的力场参数
    scale: 120,                     // 手的像素尺度
    pts: null,                      // 21 个关键点（屏幕坐标）

    wasPinch: false,
    midHis: [],                     // 拇指-中指 标度样本历史，用于识别响指
    snapCool: 0,
    snapAt: -9,                     // 上次响指的秒数（起笔锁 / 麦克风去重都看它）
    gestState: -1,                  // 1 张开 / 0 握拳 / -1 过渡
    gestCool: 0,

    drawRaw: false,                 // 本帧是否"食指单指伸出"
    drawHoldT: 0,                   // 该姿势已连续保持多久（秒）
    drawLock: false,                // 响指之后的起笔锁
    midRatio: 1,                    // 拇指-中指 标度距离（当帧）
    drawW: 0,                       // 平滑后的绘形意向 0~1
    drawing: false,                 // 稳定判定结果（防抖）

    // 3D 视角：由手掌朝向推测（-1~1），poseDist 是相对的远近
    poseYaw: 0,
    posePitch: 0,
    poseRoll: 0,
    poseDist: 1,

    evPinch: null,
    evSnap: null,
    evOpen: false,
    evClose: false,
  };
}

/** 双手，索引 0 / 1 */
export const hands = [newHand(), newHand()];

/**
 * 喂入一帧的关键点。
 * @param {Array<Array<{x:number,y:number}>>} ptsList 每只手 21 个点，已映射到屏幕坐标
 */
export function feed(ptsList) {
  for (const h of hands) {
    h.seen = false;
    h.drawRaw = false;
  }

  ptsList.forEach((pts, i) => {
    if (i > 1) return;
    const h = hands[i];
    h.seen = true;
    h.pts = pts;

    const wrist = pts[0];
    const mid = pts[9];
    const palmW = Math.max(dist(pts[5], pts[17]), 8);
    h.scale = Math.max(dist(wrist, mid), 20) * 1.35;

    // 掌心：中指根与手腕的加权中点，比单一关键点更稳
    const px = mid.x * 0.62 + wrist.x * 0.38;
    const py = mid.y * 0.62 + wrist.y * 0.38;
    h.tx = px;
    h.ty = py;

    // 伸展判定：指尖离手腕明显比中节远 → 该指伸直
    const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
    const ext = pairs.map(([tip, pip]) =>
      dist(pts[tip], wrist) > dist(pts[pip], wrist) * GESTURE.extendRatio);
    let extCount = 0;
    for (const e of ext) if (e) extCount++;
    const thumbUp = dist(pts[4], pts[17]) > dist(pts[3], pts[17]) * GESTURE.thumbRatio ? 1 : 0;

    let spread = (extCount + thumbUp * 0.9) / 4.9;
    spread = Math.max(0, Math.min(1, spread));
    h.tSpread = spread;

    // 捏合检测用原始值，避免平滑把瞬间吃掉
    const pinchRatio = dist(pts[4], pts[8]) / palmW;
    const pinching = pinchRatio < GESTURE.pinch && spread > GESTURE.pinchSpread;
    if (pinching && !h.wasPinch) h.evPinch = { x: px, y: py };
    h.wasPinch = pinching;

    // 拇指-中指距离：响指的动作就是这一对"合上 → 弹开"
    const midRatio = dist(pts[4], pts[12]) / palmW;
    h.midRatio = midRatio;

    // --- 3D 视角：手的位置当"取景器" ---
    // 掌心在画面哪边，视角就往哪边转（手往左移 = 想看左边的星空）；
    // 手掌越大 = 离镜头越近 = 星空扑面而来。
    // 不用掌面朝向了：腕部角度随手势乱变，视角会一直漂。
    h.poseYaw = Math.max(-1, Math.min(1, (px - W / 2) / (W * 0.42)));
    h.posePitch = Math.max(-1, Math.min(1, (py - H / 2) / (H * 0.42)));
    h.poseDist = Math.max(0.55, Math.min(1.9, palmW / D3.palmRef));

    // 刚刚打过响指的话，这一小段里的食指动作是"弹指"的余波，不该起笔
    h.drawLock = clock - h.snapAt < GESTURE.snapDrawLock;

    // 拇指已经贴住中指 = 在"按压"而不是在"写字"，这一帧不算
    const pressLike = midRatio < GESTURE.drawMidMin;

    // 绘形姿势：食指伸出、其余三指收起、没在捏合、不在按压、也不在响指余波里
    h.drawRaw = ext[0] && !ext[1] && !ext[2] && !ext[3]
      && !pinching && !pressLike && !h.drawLock;

    // 响指：先喂一帧标度样本，再由 snap.js 判定是不是"弹开"的那一下。
    // 落笔中 / 刚收笔的一小段时间里直接不判——写字时拇指蹭到中指太常见了。
    // （麦克风那条线更准，两条线都会触发 snapBlast）
    if (mode !== 'demo') {
      pushSample(h.midHis, makeSample(pts, palmW, midRatio, clock), 24);
      const writing = drawingNow || clock - strokeEndClock < GESTURE.strokeSnapLock;
      if (!writing && clock - h.snapCool > GESTURE.snapCooldown
          && detectSnap(h.midHis, clock, GESTURE)) {
        h.snapCool = clock;
        h.snapAt = clock;
        h.evSnap = { x: px, y: py };
      }
    }
  });

  if (ptsList.length === 0) {
    for (const h of hands) {
      h.pts = null;
      h.wasPinch = false;
      h.midHis.length = 0;      // 手离开画面，历史作废，避免回来时用过期样本判响指
      h.drawHoldT = 0;
    }
  }
}

/** 平滑手的运动，并把张开度换算成力场参数 */
export function updateHands(dt) {
  for (const h of hands) {
    h.visible += ((h.seen ? 1 : 0) - h.visible) * Math.min(1, (h.seen ? 0.28 : 0.10) * dt);
    if (h.visible < 0.001) h.visible = 0;

    if (h.seen) {
      // 位置平滑：手抖被吃掉，留下的是"有重量"的移动
      const k = Math.min(1, 0.42 * dt);
      h.x += (h.tx - h.x) * k;
      h.y += (h.ty - h.y) * k;
      h.spread += (h.tSpread - h.spread) * Math.min(1, 0.22 * dt);
    }

    // 握拳 = 强吸引 + 小漩涡；张开 = 斥力 + 强漩涡
    h.strength = FIELD.pull - FIELD.pullRange * h.spread;
    h.swirl = FIELD.swirl + FIELD.swirlRange * h.spread;

    // 绘形姿势做防抖：识别结果会抖，单帧抖动不该把一笔断成两笔。
    // 除了平滑，还要求这个姿势连续保持一小会儿才落笔——
    // 响指"按压 → 弹开"只占很短时间，撑不到 drawHold，所以笔不会先支起来。
    h.drawW += ((h.drawRaw ? 1 : 0) - h.drawW) * Math.min(1, 0.30 * dt);
    const armed = h.drawRaw && h.midRatio >= GESTURE.snapNear;
    h.drawHoldT = armed ? h.drawHoldT + dt / 60 : 0;
    h.drawing = h.drawW > 0.6 && h.drawHoldT >= GESTURE.drawHold;

    // 开合切换时给一声反馈，让手"有重量"
    const st = h.spread > GESTURE.openAt ? 1 : (h.spread < GESTURE.closeAt ? 0 : -1);
    if (st >= 0 && st !== h.gestState && clock - h.gestCool > GESTURE.stateCooldown) {
      h.gestState = st;
      h.gestCool = clock;
      if (h.visible > 0.5) {
        if (st) h.evOpen = true;
        else h.evClose = true;
      }
    }
  }
}

/** 画一只拟人化的发光手：掌面有体量、手指有血肉宽度 */
export function drawHand(h, t) {
  const v = h.visible;
  if (v < 0.02 || !h.pts) return;

  const warm = h.strength > 1.2;     // 握拳时偏暖橙
  const hue = warm ? THEME.warmHue : THEME.handHue;
  const pulse = 0.5 + 0.5 * Math.sin(t * (warm ? 6.5 : 2.4));
  const pts = h.pts;

  // 尺寸归一：手离镜头远近不同，所有宽度跟着 h.scale 缩放
  const K = Math.max(0.45, Math.min(2.2, h.scale / 150));

  // 掌心光晕（这个始终保留：没有它手就"不在场"了）
  const rad = h.scale * (0.95 + h.spread * 0.9) * (0.92 + pulse * 0.12);
  const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, rad);
  const coreA = (warm ? 0.20 : 0.12) * v;
  g.addColorStop(0, `hsla(${hue},100%,86%,${coreA})`);
  g.addColorStop(0.35, `hsla(${hue},100%,72%,${coreA * 0.42})`);
  g.addColorStop(1, `hsla(${hue},100%,58%,0)`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(h.x, h.y, rad, 0, Math.PI * 2);
  ctx.fill();

  // 骨架：面板里可以关掉，只留光晕（更像纯粹的星尘）
  if (!FX.skeleton) {
    ctx.globalAlpha = 1;
    return;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* ---------- ① 掌面填充：给手掌"体积"，不是一圈硬轮廓 ---------- */
  {
    const rim = [0, 1, 5, 9, 13, 17];               // 腕 → 拇指根 → 四指根 → 小指根
    ctx.beginPath();
    ctx.moveTo((pts[rim[0]].x + pts[rim[1]].x) / 2, (pts[rim[0]].y + pts[rim[1]].y) / 2);
    for (let i = 1; i < rim.length; i++) {
      const a = pts[rim[i]];
      const b = pts[rim[(i + 1) % rim.length]];
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    ctx.closePath();
    const pg = ctx.createRadialGradient(h.x, h.y, h.scale * 0.1, h.x, h.y, h.scale * 1.15);
    pg.addColorStop(0, `hsla(${hue},100%,76%,${0.13 * v})`);
    pg.addColorStop(0.75, `hsla(${hue},100%,66%,${0.07 * v})`);
    pg.addColorStop(1, `hsla(${hue},100%,62%,0)`);
    ctx.fillStyle = pg;
    ctx.fill();
  }

  /* ---------- ② 手指：有宽度的锥形"光肉"，指根埋进掌面 ---------- */
  const fingerBody = c => {
    const p = c.pts;
    const n = p.length;
    // 每个关节的半宽：指根最宽 → 指尖收窄，最后一段还要为圆头留余量
    const half = i => (11 - 5.5 * (i / (n - 1))) * K * 0.5;

    // 起点向掌心延伸一段，手指"长在掌里"，不会和掌面之间出现接缝
    const root = pts[p[0]];
    const dxp = h.x - root.x;
    const dyp = h.y - root.y;
    const dl = Math.hypot(dxp, dyp) || 1;
    const ext = { x: root.x + dxp / dl * h.scale * 0.16, y: root.y + dyp / dl * h.scale * 0.16 };

    // 算每段的法线（第 0 段用延伸起点）
    const px = [ext.x, ...p.slice(1).map(i => pts[i].x)];
    const py = [ext.y, ...p.slice(1).map(i => pts[i].y)];
    const nx = [], ny = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = px[i + 1] - px[i];
      const dy = py[i + 1] - py[i];
      const l = Math.hypot(dx, dy) || 1;
      nx.push(-dy / l);
      ny.push(dx / l);
    }

    ctx.beginPath();
    // 左轮廓：掌内 → 指尖
    for (let i = 0; i < n - 1; i++) {
      const hw = (half(i) + half(i + 1)) / 2;
      const x = px[i] + nx[i] * hw;
      const y = py[i] + ny[i] * hw;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    // 指尖圆头
    const tipP = { x: px[n - 1], y: py[n - 1] };
    ctx.arc(tipP.x, tipP.y, half(n - 1) * 1.15, 0, Math.PI * 2);
    // 右轮廓：指尖 → 掌内
    for (let i = n - 2; i >= 0; i--) {
      const hw = (half(i) + half(i + 1)) / 2;
      ctx.lineTo(px[i] - nx[i] * hw, py[i] - ny[i] * hw);
    }
    ctx.closePath();

    // 填充：掌内较亮 → 指尖稍暗，像光从掌心灌进手指
    const fg = ctx.createLinearGradient(ext.x, ext.y, tipP.x, tipP.y);
    fg.addColorStop(0, `hsla(${hue},100%,70%,${0.17 * v})`);
    fg.addColorStop(0.55, `hsla(${hue},100%,76%,${0.15 * v})`);
    fg.addColorStop(1, `hsla(${hue},100%,84%,${0.11 * v})`);
    ctx.fillStyle = fg;
    ctx.fill();

    // 一道极淡的边缘光，让"肉"有轮廓而不发闷
    ctx.strokeStyle = `hsla(${hue},100%,88%,${0.09 * v})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  for (const c of CHAINS.slice(0, 5)) fingerBody(c);

  // 中轴亮线：藏在"肉"里的骨头，从掌根亮到指尖
  for (const c of CHAINS.slice(0, 5)) {
    const p = c.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const k = i / (p.length - 2);
      ctx.strokeStyle = `hsla(${hue},100%,${86 + k * 8}%,${(0.46 - k * 0.10) * v})`;
      ctx.lineWidth = (1.7 * (1 - k) + 0.7 * k) * K;
      ctx.beginPath();
      ctx.moveTo(pts[p[i]].x, pts[p[i]].y);
      if (i === p.length - 2) {
        ctx.lineTo(pts[p[i + 1]].x, pts[p[i + 1]].y);
      } else {
        const a = pts[p[i + 1]];
        const b = pts[p[i + 2]];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ctx.stroke();
    }
  }

  /* ---------- ③ 指尖光斑 ---------- */
  ctx.globalCompositeOperation = 'lighter';
  for (let f = 0; f < TIP_IDS.length; f++) {
    const tip = pts[TIP_IDS[f]];
    const r = (3.2 + pulse * 1.4) * K * (1 - f * 0.06);
    const gg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r * 3);
    gg.addColorStop(0, `hsla(${hue},100%,95%,${0.85 * v})`);
    gg.addColorStop(0.4, `hsla(${hue},100%,80%,${0.30 * v})`);
    gg.addColorStop(1, `hsla(${hue},100%,70%,0)`);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  /* ---------- ④ 写字中的食指尖 = 笔尖，多给一颗亮星 ---------- */
  if (h.drawing) {
    const tip = pts[8];
    const r = (5 + pulse * 2.5) * K;
    const gg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r * 3.4);
    gg.addColorStop(0, `hsla(${THEME.handHue},100%,98%,${0.95 * v})`);
    gg.addColorStop(0.35, `hsla(${THEME.handHue},100%,86%,${0.45 * v})`);
    gg.addColorStop(1, `hsla(${THEME.handHue},100%,75%,0)`);
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

/**
 * 演示模式用的程序化手：没有摄像头也能看到完整效果。
 * 按腕、五指、拇指的顺序生成 21 个点，形状与真实关键点一致。
 */
export function demoPoints(cx, cy, spread, s) {
  const pts = new Array(21);
  pts[0] = { x: cx, y: cy + 82 * s };

  const off = 0.5 + spread * 0.5;
  const fingers = [
    { a: -0.26 * off, l: 92 },   // 食指
    { a: -0.04 * off, l: 103 },  // 中指
    { a: 0.20 * off, l: 94 },    // 无名指
    { a: 0.44 * off, l: 80 },    // 小指
  ];

  for (let k = 0; k < 4; k++) {
    const f = fingers[k];
    const dx = Math.sin(f.a);
    const dy = -Math.cos(f.a);
    const bx = cx + dx * 16 * s + (k - 1.5) * 20 * s;
    const by = cy + dy * 16 * s - 18 * s;
    const len = f.l * s * (0.30 + 0.70 * spread);   // 收拳时手指缩短
    for (let j = 0; j < 4; j++) {
      const q = 0.30 + 0.70 * (j / 3);
      pts[5 + k * 4 + j] = { x: bx + dx * len * q, y: by + dy * len * q };
    }
  }

  const th = -1.05 * off;
  const tdx = Math.sin(th);
  const tdy = -Math.cos(th);
  for (let j = 0; j < 4; j++) {
    const q = 0.42 + 0.58 * (j / 3);
    const len = 66 * s * (0.45 + 0.55 * spread);
    pts[1 + j] = { x: cx + tdx * len * q - 22 * s, y: cy + tdy * len * q + 26 * s };
  }

  return pts;
}
