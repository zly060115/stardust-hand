/**
 * audio.js —— 纯合成音效
 *
 * 没有任何音频文件：底噪是三个振荡器，撞击声是滤波后的白噪声，
 * 混响是程序生成的脉冲响应。首次加载的体积为零。
 */

import { MIC } from './config.js';
import { setStatus } from './ui.js';

const AC_CLASS = window.AudioContext || window.webkitAudioContext;

let ac = null;
let master = null;
let revSend = null;
let noiseBuf = null;
let muted = false;

let micAnalyser = null;
let micData = null;
let micBase = 0.0008;
let micCool = 0;

export const isMuted = () => muted;
export const hasAudio = () => !!ac;
export const hasMic = () => !!micAnalyser;

/** 程序化混响脉冲：白噪声按指数衰减，听起来像有空间的房间 */
function makeIR(context, dur, decay) {
  const rate = context.sampleRate;
  const len = Math.floor(rate * dur);
  const buf = context.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
    }
  }
  return buf;
}

export function initAudio() {
  if (ac || !AC_CLASS) return;
  try {
    ac = new AC_CLASS();

    master = ac.createGain();
    master.gain.value = 0.0001;          // 从静音淡入，避免开场"砰"一声
    master.connect(ac.destination);

    // 混响
    const conv = ac.createConvolver();
    conv.buffer = makeIR(ac, 2.4, 2.8);
    revSend = ac.createGain();
    revSend.gain.value = 0.40;
    revSend.connect(conv);
    conv.connect(master);

    // 环境底噪：低频 drone + 极慢呼吸
    const droneGain = ac.createGain();
    droneGain.gain.value = 0.05;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    droneGain.connect(lp);
    lp.connect(master);

    [[55, 'sine', 0.62], [82.5, 'sine', 0.34], [110.3, 'triangle', 0.16]].forEach(([f, type, g]) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ac.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(droneGain);
      o.start();
    });

    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 0.026;
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);
    lfo.start();

    // 复用的白噪声源
    noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 1.5), ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    master.gain.exponentialRampToValueAtTime(0.85, ac.currentTime + 4);
  } catch (e) {
    console.warn('音频初始化失败，静音运行', e);
    ac = null;
    master = null;
  }
}

/** 浏览器要求音频必须由用户手势唤醒 */
export function resumeAudio() {
  if (ac && ac.state === 'suspended') ac.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master && ac) {
    master.gain.setTargetAtTime(muted ? 0.00008 : 0.85, ac.currentTime, 0.2);
  }
  return muted;
}

/* ---------- 两个基础发声单元 ---------- */

function noiseHit(t0, dur, type, f0, f1, vol, q = 1) {
  if (!ac) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  g.connect(revSend);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function toneHit(t0, dur, f0, f1, vol, type = 'sine') {
  if (!ac) return;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  g.connect(revSend);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/* ---------- 对外音效 ---------- */

export const sfx = {
  /** 捏合：掌心超新星 */
  burst() {
    if (!ac || muted) return;
    const t0 = ac.currentTime + 0.01;
    toneHit(t0, 1.05, 185, 32, 0.40);
    noiseHit(t0, 0.55, 'lowpass', 1900, 180, 0.28);
    toneHit(t0, 0.16, 900, 300, 0.09, 'triangle');
  },

  /** 响指：全场炸开 */
  snap() {
    if (!ac || muted) return;
    const t0 = ac.currentTime + 0.005;
    noiseHit(t0, 0.085, 'highpass', 3800, 7200, 0.30);   // 那声"啪"
    noiseHit(t0, 0.55, 'bandpass', 1500, 200, 0.22, 0.8);
    toneHit(t0 + 0.012, 1.5, 128, 24, 0.32);            // 下坠轰鸣
    toneHit(t0, 0.11, 1600, 420, 0.07, 'square');
  },

  /** 张开手掌：上扬 */
  open() {
    if (!ac || muted) return;
    const t0 = ac.currentTime;
    toneHit(t0, 0.5, 320, 900, 0.05);
    noiseHit(t0, 0.45, 'bandpass', 800, 3400, 0.045, 1.6);
  },

  /** 握拳：下沉 */
  close() {
    if (!ac || muted) return;
    const t0 = ac.currentTime;
    toneHit(t0, 0.62, 440, 88, 0.068);
  },
};

/* ---------- 麦克风：补上"听"的能力 ---------- */

/** 识别引擎看不到声音，响指靠这一层来听 */
export function setupMic(stream) {
  if (!ac) return;
  try {
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = MIC.fftSize;
    an.smoothingTimeConstant = 0.15;
    src.connect(an);              // 只分析，不接扬声器，避免啸叫
    micAnalyser = an;
    micData = new Float32Array(an.frequencyBinCount);
    setStatus('麦克风已接入 · 试试打个响指');
  } catch (e) {
    micAnalyser = null;
  }
}

/**
 * 每帧检查一次麦克风能量。
 * @param {number} now 当前时间（秒）
 * @param {Array} hands 手部状态，用来决定爆发中心
 * @param {Function} onSnap 命中时回调 (x, y)
 */
export function pollMic(now, hands, onSnap) {
  if (!micAnalyser) return;
  micAnalyser.getFloatFrequencyData(micData);

  // 响指的能量集中在 2.6k–7.2kHz 的极短瞬态里
  const binHz = ac.sampleRate / micAnalyser.fftSize;
  const lo = Math.floor(MIC.bandLo / binHz);
  const hi = Math.min(micData.length - 1, Math.floor(MIC.bandHi / binHz));
  let e = 0;
  for (let i = lo; i <= hi; i++) {
    const v = Math.pow(10, micData[i] / 20);
    e += v * v;
  }
  e = Math.sqrt(e);

  // 自适应基线：安静时快速回落，持续噪声时慢慢抬高
  if (e < micBase) micBase = micBase * 0.88 + e * 0.12;
  else micBase = micBase * 0.995 + e * 0.005;

  if (e > micBase * MIC.thresh && e > MIC.floor && now - micCool > MIC.cooldown) {
    micCool = now;
    const h = hands.find(x => x.visible > 0.25);
    onSnap(h ? h.x : null, h ? h.y : null);
  }
}
