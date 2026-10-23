/**
 * tilt.js —— 伪 3D 相机：旋转、投影、景深
 *
 * 星空本身一直是三维的（每个粒子有 x / y / z 和真实的 vz），
 * 只是以前把 z 丢掉、直接按 (x, y) 画。
 * 这个模块负责三件事：
 *   1. 维护相机姿态（yaw / pitch / roll），可以用鼠标拖、手势带动、或者自己慢慢漂；
 *   2. 把三维点旋转 + 透视投影到屏幕，返回缩放倍率供绘制用；
 *   3. 给出景深系数（越靠近镜头越大越亮越实，越远越小越暗越模糊）。
 *
 * 关键约束：摄像机默认要"正对屏幕"。
 * 如果一上来就斜着看，投影会把画面缩成一个椭圆，星云就铺不满屏了。
 * 所以默认 pitch ≈ 0，倾斜只发生在用户主动转头 / 拖拽的时候，
 * 而且会慢慢回正 —— 效果是"3D 质感"，不是"从斜上方看一张扁画"。
 */

import { D3 } from './config.js';
import { W, H, CX, CY } from './state.js';

/* ---------------------- 相机姿态 ---------------------- */

/** 当前（已平滑的）姿态 */
export const cam = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  dist: D3.dist,
};

/** 目标姿态：手势 / 鼠标拖拽 / 自动漂移 都写这里，再由 update 平滑追 */
const goal = { yaw: 0, pitch: 0, roll: 0, dist: D3.dist };

/** 用户手动拖拽的偏移（相对手部姿态），会缓慢衰减回 0 */
const drag = { yaw: 0, pitch: 0 };

/** 上次窗口尺寸，用于发现"视口变了" */
let lastW = 0;
let lastH = 0;

/**
 * 视口尺寸进投影的方式：全部通过 state 的 W / H / CX / CY，
 * 这样窗口一变就自动生效，不需要缓存任何尺寸。
 * 这里只负责把"尺寸变过"记下来，供调试与重排使用。
 */
function noteViewport() {
  if (W === lastW && H === lastH) return;
  lastW = W;
  lastH = H;
}

/** 屏幕一点对应的三维深度（当被投影的三维点没有 z 时用它） */
export function depthAt() {
  return 0;
}

/**
 * 设置手势带来的目标姿态。
 * 每只手都算完再平均，单只手的抖动会被摊薄。
 */
export function gesturePose(yaw, pitch, roll, dist, pull) {
  goal.yaw = yaw * D3.yawMax * pull;
  goal.pitch = pitch * D3.pitchMax * pull;
  goal.roll = roll * D3.rollMax * pull;
  goal.dist = D3.dist + (dist - 1) * D3.distRange * pull;
}

/** 鼠标 / 触摸拖拽：直接给角度增量（弧度） */
export function dragBy(dYaw, dPitch) {
  const lim = D3.dragMax;
  drag.yaw = Math.max(-lim, Math.min(lim, drag.yaw + dYaw));
  drag.pitch = Math.max(-lim, Math.min(lim, drag.pitch + dPitch));
}

/** 双击复位 */
export function resetView() {
  drag.yaw = 0;
  drag.pitch = 0;
  cam.yaw = 0;
  cam.pitch = 0;
  cam.roll = 0;
}

/**
 * 每帧推进：目标姿态 + 自动漂移 + 拖拽偏移，平滑收敛到当前姿态。
 * @param {number} dt 帧时间（60fps 归一）
 * @param {number} t  当前时间（秒）
 */
export function updateCamera(dt, t) {
  noteViewport();

  // 自动漂移：没人操作时轻轻摆动，让画面一直是活的
  const driftYaw = Math.sin(t * D3.driftSpeed) * D3.driftYaw;
  const driftPitch = Math.sin(t * D3.driftSpeed * 0.71 + 1.3) * D3.driftPitch;

  // 拖拽偏移缓慢回正（每秒衰减 40%）
  const decay = Math.pow(0.994, dt);
  drag.yaw *= decay;
  drag.pitch *= decay;

  const ty = goal.yaw + driftYaw + drag.yaw;
  const tp = goal.pitch + driftPitch + drag.pitch;
  const tr = goal.roll + driftYaw * 0.35;

  const k = Math.min(1, D3.follow * dt);
  cam.yaw += (ty - cam.yaw) * k;
  cam.pitch += (tp - cam.pitch) * k;
  cam.roll += (tr - cam.roll) * k;
  cam.dist += (goal.dist - cam.dist) * Math.min(1, D3.follow * 0.6 * dt);
}

/* ---------------------- 投影 ---------------------- */

/** 旋转矩阵（yaw → pitch → roll 依次施加），写成闭包避免每帧建对象 */
let cy = 1, sy = 0, cp = 1, sp = 0, cr = 1, sr = 0;

/** 相机参数准备好后调用一次，之后 proj 都是纯算术 */
export function prepare() {
  noteViewport();
  cy = Math.cos(-cam.yaw); sy = Math.sin(-cam.yaw);
  cp = Math.cos(-cam.pitch); sp = Math.sin(-cam.pitch);
  cr = Math.cos(-cam.roll); sr = Math.sin(-cam.roll);
}

/**
 * 三维点 → 屏幕。
 * 返回的 k 是该点的视觉缩放（透视 + 旋转后的深度），
 * 调用方用 size * k 即可，不做二次透视时也够用。
 *
 * 焦距、中心、相机距离都从 cam 直接读，不缓存到模块变量：
 * 之前缓存过一份，只要有一处漏了同步，整片星空就会被推到屏幕外。
 *
 * @param {number} x 屏幕坐标（以画面中心为原点之前的世界坐标）
 * @param {number} y
 * @param {number} z 深度，正 = 靠近镜头
 */
export function proj(x, y, z, out) {
  noteViewport();                    // 幂等：尺寸没变就立刻返回

  const px = x - CX;
  const py = y - CY;
  const pz = z;

  // yaw（绕竖轴）
  const x1 = px * cy + pz * sy;
  const z1 = -px * sy + pz * cy;

  // pitch（绕横轴）
  const y2 = py * cp + z1 * sp;
  const z2 = -py * sp + z1 * cp;

  // roll（绕视线轴）
  const x3 = x1 * cr - y2 * sr;
  const y3 = x1 * sr + y2 * cr;

  // 透视：相机在 -dist 处朝 +z 看。
  // 三个量纲要点：
  //   1. z2 是像素单位，先按 depthSpan 归一化再进分母；
  //   2. 焦距同样归一化，k 才是"倍率"而不是"像素/像素"的怪数
  //      （直接把像素焦距丢进分母会让坐标放大几百倍，整片星空飞出屏幕）；
  //   3. 基准对齐：z=0 的点必须得到 k=1，也就是 f 取 dist 本身，
  //      否则正对屏幕时画面会被整体缩放，铺不满。
  const span = D3.depthSpan;
  const dz = cam.dist + z2 / span;
  const ok = dz >= D3.near;
  const k = ok ? cam.dist / dz : 0;

  const o = out || {};
  o.x = CX + x3 * k;
  o.y = CY + y3 * k;
  o.z = z2;
  o.k = k;
  o.dz = dz;
  o.ok = ok;
  return o;
}

/**
 * 景深映射：把相机空间深度换成 0（远）~ 1（近）。
 * 用 D3.depth（星系盘厚度）的一半做归一化：
 * 盘前后的粒子正好分布到 0 和 1，越界的夹到两端。
 * @param {number} z2 旋转后的相机空间 z
 */
export function depth01(z2) {
  const half = D3.depth * 0.5;
  const t = (z2 / half + 1) / 2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 深度 → 亮度倍率（远的暗，近的亮，拉开层次） */
export function dim(d01) {
  return 0.34 + d01 * 0.66;
}

/** 深度 → 清晰度（远处轻微失焦，靠模糊贴图实现） */
export function sharp(d01) {
  return d01 > D3.blurFrom ? 1 : 0.45 + (d01 / D3.blurFrom) * 0.55;
}
