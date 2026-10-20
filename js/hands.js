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
 */

import { THEME, GESTURE, FIELD, FX } from './config.js';
import { clock, mode } from './state.js';
import { ctx } from './ui.js';

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
    midHis: [],                     // 拇指-中指距离历史，用于识别响指
    snapCool: 0,
    gestState: -1,                  // 1 张开 / 0 握拳 / -1 过渡
    gestCool: 0,

    drawRaw: false,                 // 本帧是否"食指单指伸出"
    drawW: 0,                       // 平滑后的绘形意向 0~1
    drawing: false,                 // 稳定判定结果（防抖）

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

    // 绘形姿势：食指伸出、其余三指收起、且没有在捏合
    h.drawRaw = ext[0] && !ext[1] && !ext[2] && !ext[3] && !pinching;

    // 响指（视觉兜底）：拇指与中指先贴近，再在极短时间里弹开。
    // 麦克风那条线更准，两条线都会触发 snapBlast。
    if (mode !== 'demo') {
      const midRatio = dist(pts[4], pts[12]) / palmW;
      h.midHis.push({ t: clock, r: midRatio });
      if (h.midHis.length > 12) h.midHis.shift();

      if (midRatio > GESTURE.snapApart && clock - h.snapCool > GESTURE.snapCooldown) {
        const wasNear = h.midHis.some(s => s.r < GESTURE.snapNear && clock - s.t < GESTURE.snapWindow);
        const midStraight = dist(pts[12], wrist) > dist(pts[10], wrist) * GESTURE.extendRatio;
        const indexApart = pinchRatio > 0.5;   // 排除"拇指食指捏合"误判
        if (wasNear && midStraight && indexApart) {
          h.snapCool = clock;
          h.evSnap = { x: px, y: py };
        }
      }
    }
  });

  if (ptsList.length === 0) {
    for (const h of hands) {
      h.pts = null;
      h.wasPinch = false;
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

    // 绘形姿势做防抖：识别结果会抖，单帧抖动不该把一笔断成两笔
    h.drawW += ((h.drawRaw ? 1 : 0) - h.drawW) * Math.min(1, 0.30 * dt);
    h.drawing = h.drawW > 0.6;

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

/** 画一只手的骨架与掌心光晕 */
export function drawHand(h, t) {
  const v = h.visible;
  if (v < 0.02 || !h.pts) return;

  const warm = h.strength > 1.2;     // 握拳时偏暖橙
  const hue = warm ? THEME.warmHue : THEME.handHue;
  const pulse = 0.5 + 0.5 * Math.sin(t * (warm ? 6.5 : 2.4));

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

  // 骨架：外发光层 + 内核层（同一路径连画两次，省一次构建）
  const pts = h.pts;
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';

  ctx.strokeStyle = `hsla(${hue},100%,68%,${0.10 * v})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (const [a, b] of BONES) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();

  ctx.strokeStyle = `hsla(${hue},100%,78%,${0.44 * v})`;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 关节与指尖
  ctx.fillStyle = `hsla(${hue},100%,92%,${0.75 * v})`;
  for (let i = 0; i < pts.length; i++) {
    const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
    const rr = isTip ? 2.4 + pulse * 1.1 : 1.1;
    ctx.globalAlpha = (isTip ? 0.95 : 0.45) * v;
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, rr, 0, Math.PI * 2);
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
