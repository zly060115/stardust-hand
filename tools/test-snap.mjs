/**
 * tools/test-snap.mjs —— 响指判定回归测试
 *
 * 跑的是一条纯逻辑：js/snap.js 的 detectSnap()。不需要相机，也不需要浏览器。
 *   node tools/test-snap.mjs
 *
 * 用例覆盖两类真实痛点：
 *   A. 写字（食指在扫、拇指跟着手走）不能判成响指 —— 包括关键点抖动的情况
 *   B. 真响指（拇指压中指再弹开）必须命中，且只命中那一下
 */

import { GESTURE } from '../js/config.js';
import { detectSnap, pushSample } from '../js/snap.js';

const FPS = 30;
const DT = 1 / FPS;

/* ---------------- 旧的判据，用来对照 ---------------- */
function legacySnap(hist, now) {
  const cur = hist[hist.length - 1];
  if (cur.r <= GESTURE.snapApart) return false;
  return hist.some(s => s.r < GESTURE.snapNear && now - s.t < 0.15);
}

/* ---------------- 采样工具 ---------------- */

function mk(t, r, tx, ty, ix, iy) {
  return { t, r, tx, ty, ix, iy };
}

/**
 * 跑一段模拟，返回 {新判据命中次数, 旧判据命中次数, 首次命中帧}
 * @param {Array} frames 每帧 {r, tx, ty, ix, iy}
 */
function run(frames, useLegacy = false) {
  const hist = [];
  let hits = 0;
  let legacyHits = 0;
  let firstHit = -1;
  for (let i = 0; i < frames.length; i++) {
    const now = i * DT;
    const f = frames[i];
    pushSample(hist, mk(now, f.r, f.tx, f.ty, f.ix, f.iy), 24);
    if (detectSnap(hist, now, GESTURE)) {
      hits++;
      if (firstHit < 0) firstHit = i;
    }
    if (legacySnap(hist, now)) legacyHits++;
  }
  return { hits, legacyHits, firstHit };
}

/** 确定性伪随机，保证每次跑结果一样 */
let seed = 20261020;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const jit = (k) => (rnd() * 2 - 1) * k;

/* ---------------- 用例 ---------------- */

/** ① 写字：食指尖在掌内画字形，拇指跟着手走（掌内位移很小） */
function writeFrames(n = 300, noise = 0.02) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    // 横竖撇捺那种折线：食指尖在掌内来回扫
    const ix = 0.55 * Math.sin(t * 4.2) + 0.25 * Math.sin(t * 9.1);
    const iy = 0.40 * Math.cos(t * 3.4) + jit(noise);
    // 拇指蜷在掌心附近，只跟着手整体动，掌内坐标几乎不变
    const tx = -0.52 + jit(noise);
    const ty = 0.06 + jit(noise);
    // 拇指-中指距离：写字时两者都在掌心附近，数值在 0.5 上下（会抖）
    const r = 0.52 + jit(0.06 + noise * 2);
    out.push(mk(0, r, tx, ty, ix, iy));
  }
  return out;
}

/** ② 写字 + 关键点抖动：折叠的手指被遮挡，MediaPipe 偶尔会跳到离谱的位置 */
function writeJitterFrames(n = 300, amp = 0.18) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const ix = 0.55 * Math.sin(t * 4.2);
    const iy = 0.40 * Math.cos(t * 3.4);
    // 每帧独立抖动，模拟遮挡导致的跳点
    const tx = -0.52 + jit(amp);
    const ty = 0.06 + jit(amp);
    const r = 0.55 + jit(0.42);
    out.push(mk(0, r, tx, ty, ix, iy));
  }
  return out;
}

/** ③ 真响指：贴合 6 帧 → 2 帧弹开，拇指掌内位移大、食指尖基本不动 */
function snapFrames() {
  const out = [];
  const press = 6;
  for (let i = 0; i < press; i++) {
    out.push(mk(0, 0.30 + jit(0.02), -0.34, 0.02, 0.62, -0.30));
  }
  // 弹开：两帧到位
  out.push(mk(0, 0.62, -0.62, 0.16, 0.64, -0.30));
  out.push(mk(0, 0.96, -0.95, 0.30, 0.65, -0.29));
  // 保持弹开的姿势
  for (let i = 0; i < 6; i++) out.push(mk(0, 0.98, -0.97, 0.31, 0.65, -0.29));
  return out;
}

/** ④ 单帧抖动：只有一帧贴合的假象（关键点乱跳） */
function glitchFrames() {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(mk(0, 0.70, -0.80, 0.20, 0.60, -0.30));
  out.push(mk(0, 0.22, -0.30, 0.00, 0.60, -0.30));   // 单帧跌到贴合
  out.push(mk(0, 0.98, -0.95, 0.30, 0.61, -0.30));
  for (let i = 0; i < 6; i++) out.push(mk(0, 0.98, -0.95, 0.30, 0.61, -0.30));
  return out;
}

/** ⑤ 慢慢张开手指：贴合并未"弹开"，只是缓缓分开 */
function slowOpenFrames() {
  const out = [];
  for (let i = 0; i < 20; i++) {
    const k = i / 19;
    out.push(mk(0, 0.30 + 0.68 * k, -0.34 - 0.60 * k, 0.02 + 0.28 * k, 0.62, -0.30));
  }
  for (let i = 0; i < 6; i++) out.push(mk(0, 0.98, -0.94, 0.30, 0.62, -0.30));
  return out;
}

/** ⑥ 静态握拳 / 保持姿势：什么都不该发生 */
function staticFrames() {
  return Array.from({ length: 60 }, () => mk(0, 0.55, -0.6, 0.1, 0.4, -0.2));
}

/** ⑦ 抓取：拇指食指捏合（捏合有自己的特效，不该再触发响指） */
function pinchFrames() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    // 拇指和食指靠拢，中指没参与
    out.push(mk(0, 0.75 + 0.20 * k, -0.20 + 0.05 * k, 0.0, -0.15 - 0.05 * k, 0.0));
  }
  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    out.push(mk(0, 0.95 - 0.60 * k, -0.15 + 0.15 * k, 0.0, -0.20 + 0.35 * k, 0.0));
  }
  return out;
}

/* ---------------- 跑 ---------------- */

const cases = [
  { name: '写字（干净轨迹）', frames: writeFrames(), want: false },
  { name: '写字 + 关键点抖动', frames: writeJitterFrames(), want: false },
  { name: '单帧抖动（假贴合）', frames: glitchFrames(), want: false },
  { name: '慢慢张开五指', frames: slowOpenFrames(), want: false },
  { name: '静态保持姿势', frames: staticFrames(), want: false },
  { name: '拇指食指捏合', frames: pinchFrames(), want: false },
  { name: '真响指', frames: snapFrames(), want: true },
];

let fail = 0;
console.log('响指判定回归测试\n');

for (const c of cases) {
  const r = run(c.frames);
  const ok = c.want ? r.hits > 0 : r.hits === 0;
  if (!ok) fail++;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(
    `${tag}  ${c.name.padEnd(16, ' ')} 新判据 ${String(r.hits).padStart(2)} 次 / 旧判据 ${String(r.legacyHits).padStart(3)} 次` +
    (c.want && r.hits ? ` · 第 ${r.firstHit} 帧命中` : '')
  );
}

// 真响指的时序要求：必须落在弹开之后的那 1~3 帧内，不能提前也不能太晚
const snap = run(snapFrames());
const flickFrame = 7;   // 第 8 帧是"弹开到位"
if (snap.hits > 0) {
  const late = snap.firstHit - flickFrame;
  const ok = late >= 0 && late <= 3;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  响指时序            弹开后第 ${late} 帧命中（要求 0~3）`);
}

console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项未通过'}`);
process.exit(fail === 0 ? 0 : 1);
