/**
 * ui.js —— DOM 引用与界面反馈
 *
 * 只碰 DOM，不参与任何物理计算，所以谁都可以安全地 import 它。
 */

export const canvas = document.getElementById('sky');
export const ctx = canvas.getContext('2d', { alpha: false });
export const video = document.getElementById('cam');
export const veil = document.getElementById('veil');
export const veilHint = document.getElementById('veilHint');
export const toastEl = document.getElementById('toast');
export const previewEl = document.getElementById('preview');
export const startBtn = document.getElementById('startBtn');
export const demoBtn = document.getElementById('demoBtn');
export const muteBtn = document.getElementById('muteBtn');
const statusEl = document.getElementById('status');
const perfEl = document.getElementById('perf');

/** 左上角状态文字。dataset.s 用来避免每帧重复写 DOM */
export function setStatus(text) {
  statusEl.textContent = text;
  statusEl.dataset.s = '';
}

/** 带缓存判断的状态文字：同一状态只写一次 */
export function setStatusOnce(text, key) {
  if (statusEl.dataset.s === key) return;
  statusEl.dataset.s = key;
  statusEl.textContent = text;
}

let toastTimer = 0;

/** 顶部浮出的短提示 */
export function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}

/** 启动遮罩上的说明文字 */
export function setHint(text) {
  veilHint.textContent = text;
}

export function setHintHTML(html) {
  veilHint.innerHTML = html;
}

export function hideVeil(instant = false) {
  if (instant) veil.style.transition = 'none';
  veil.classList.add('hide');
}

export function setStartBtn(label, disabled) {
  startBtn.textContent = label;
  startBtn.disabled = disabled;
}

export function setPreview(on) {
  previewEl.classList.toggle('on', on);
}

/** 音量按钮：显示 / 隐藏 / 静音划线 */
export function showMuteBtn(show) {
  muteBtn.classList.toggle('live', show);
}

export function setMuteIcon(muted) {
  muteBtn.classList.toggle('off', muted);
}

/** 右下角 FPS 面板 */
export function paintPerf(fps, count) {
  perfEl.innerHTML = `${fps.toFixed(0)} FPS<br>${count} PARTICLES`;
}
