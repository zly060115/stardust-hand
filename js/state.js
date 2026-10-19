/**
 * state.js —— 运行时共享状态
 *
 * 这里导出的 let 变量用的是 ES Module 的 live binding：
 * 只有本文件能改，其他模块 import 后读到的永远是最新值。
 * 这样粒子、手势、音效模块都能直接读实时状态，不需要层层传参，也不会互相 import 成环。
 */

/** 视口（逻辑像素，不受 DPR 影响） */
export let W = 1;
export let H = 1;
export let CX = 0;
export let CY = 0;
export let DPR = 1;

/** 启动至今的秒数，同时当作动画时间轴 */
export let clock = 0;

/** 运行模式：idle 未启动 / live 摄像头 / demo 演示 */
export let mode = 'idle';

export function setViewport(w, h, dpr) {
  W = w;
  H = h;
  DPR = dpr;
  CX = w / 2;
  CY = h / 2;
}

export function setClock(v) {
  clock = v;
}

export function setMode(m) {
  mode = m;
}
