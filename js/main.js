/**
 * main.js —— 装配层
 *
 * 把各个模块接起来：主循环的顺序、启动流程、事件绑定都在这里。
 * 想了解数据怎么流动，从这个文件开始读：输入（摄像头/演示） → 手势 → 物理 → 绘制。
 */

import { THEME, PERF } from './config.js';
import * as S from './state.js';
import {
  startBtn, demoBtn, muteBtn,
  ctx, video, veil,
  setStatus, setStatusOnce, toast, setHint, setHintHTML, hideVeil,
  setStartBtn, setPreview, showMuteBtn, showTuneBtn, setMuteIcon, paintPerf,
} from './ui.js';
import { resizeCanvas } from './viewport.js';
import { P, initParticles, remap, updateParticles, drawStars, drawNebula } from './particles.js';
import { hands, feed, updateHands, drawHand, demoPoints } from './hands.js';
import {
  snapBlast, emitSparks, updateSparks, updateBursts,
  consumeHandEvents, drawSparks, drawBursts,
} from './effects.js';
import { initAudio, resumeAudio, toggleMute, isMuted, setupMic, pollMic, hasMic } from './audio.js';
import { loadEngine, makeMapper } from './engine.js';
import { updateDraw, drawShapes, playDemoShape } from './draw.js';
import { load as loadSettings, applySettings } from './settings.js';
import { buildPanel, sync as syncPanel } from './panel.js';

let landmarker = null;
let lastVideoTime = -1;
let lastFrame = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let lastPerfPaint = 0;
let demoSnapped = false;
let demoDrew = false;

/* ---------------------- 主循环 ---------------------- */

function loop(now) {
  const raw = (now - lastFrame) / 1000;
  lastFrame = now;
  const dt = Math.min(raw, 0.05) * 60;      // 帧时间归一化到 60fps
  S.setClock(S.clock + Math.min(raw, 0.05));
  const t = S.clock;

  // --- 输入端 ---
  if (S.mode === 'live' && landmarker && video.readyState >= 2) {
    // 只在视频帧更新时推理，避免同一帧重复算
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const res = landmarker.detectForVideo(video, now);
        const map = makeMapper();
        const list = (res.landmarks || []).map(lm => lm.map(map)).slice(0, 2);
        feed(list);

        if (list.length) setStatusOnce('已锁定 · 试试握拳', 'on');
        else setStatusOnce('等待手进入画面…', 'off');
      } catch (e) {
        /* 单帧失败忽略，下一帧继续 */
      }
    }
  } else if (S.mode === 'demo') {
    const CYC = 16;
    const cyc = (t % CYC) / CYC;
    let spread = 0.95;
    if (cyc < 0.24) spread = 0.95;          // 张开：旋臂展开
    else if (cyc < 0.40) spread = 0.04;     // 握拳：塌缩
    else if (cyc < 0.68) spread = 0.95;     // 张开：星尘绕指
    else if (cyc < 0.78) spread = 0.30;     // 收手蓄力
    else spread = 0.95;                     // 响指之后

    const cx = S.CX + Math.cos(t * 0.52) * S.W * 0.22;
    const cy = S.CY + Math.sin(t * 0.78) * S.H * 0.20;
    const s = Math.min(S.W, S.H) / 900;
    feed([demoPoints(cx, cy, spread, s)]);

    // 每个周期演示一次响指
    if (cyc >= 0.78 && !demoSnapped) {
      demoSnapped = true;
      snapBlast(cx, cy);
    }
    if (cyc < 0.78) demoSnapped = false;

    // 演示一次"指尖画心"：走的是和真实手势完全相同的成形管线
    if (cyc >= 0.44 && cyc < 0.66 && !demoDrew) {
      demoDrew = true;
      playDemoShape(cx, cy - 30 * s, 120 * s);
    }
    if (cyc < 0.44 || cyc >= 0.66) demoDrew = false;
  }

  // --- 逻辑 ---
  updateHands(dt);
  consumeHandEvents(hands);      // 手势事件 → 音效 / 爆发
  updateDraw(dt, hands);         // 指尖绘形：记录笔画 → 收笔 → 粒子成形
  updateParticles(dt, hands);
  emitSparks(dt, hands);
  updateSparks(dt);
  updateBursts(dt);

  if (hasMic()) {
    pollMic(t, hands, (x, y) => snapBlast(x === null ? S.CX : x, y === null ? S.CY : y));
  }

  // --- 绘制 ---
  draw(t);

  // --- 性能面板 ---
  fpsAcc += raw;
  fpsFrames++;
  if (now - lastPerfPaint > PERF.fpsWindow) {
    paintPerf(fpsFrames / Math.max(fpsAcc, 0.001), P.length);
    fpsAcc = 0;
    fpsFrames = 0;
    lastPerfPaint = now;
  }

  requestAnimationFrame(loop);
}

/** 一帧的画面：先铺半透明底色留拖尾，再用 lighter 叠加所有发光体 */
function draw(t) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = THEME.trail;
  ctx.fillRect(0, 0, S.W, S.H);

  ctx.globalCompositeOperation = 'lighter';

  drawStars(t);
  drawNebula();
  drawShapes(t);
  drawSparks();
  drawBursts();
  for (const h of hands) drawHand(h, t);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------------------- 启动流程 ---------------------- */

async function startLive() {
  setStartBtn('正在唤醒…', true);
  setHint('首次加载识别模型，稍等一下');

  initAudio();
  showMuteBtn(true);
  showTuneBtn(true);
  setMuteIcon(isMuted());

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持摄像头');
    const vc = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };

    // 视频 + 麦克风一起要；麦克风被拒就只要视频，不影响主功能
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: true });
    } catch (e1) {
      stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false });
    }

    video.srcObject = stream;
    await video.play().catch(() => {});
    if (!video.videoWidth) {
      await new Promise(r => {
        video.onloadedmetadata = r;
        setTimeout(r, 1500);
      });
    }
    setPreview(true);

    if (stream.getAudioTracks().length) setupMic(stream);

    setStatus('正在加载识别引擎…');
    if (!landmarker) landmarker = await loadEngine();

    S.setMode('live');
    hideVeil();
    setStatus('等待手进入画面…');
    toast('把手抬到镜头前，张开五指试试');
  } catch (e) {
    console.error(e);
    setHint('摄像头开启失败：' + (e.message || e.name) + ' · 已切到演示模式');
    setStartBtn('重试', false);
    startDemo();
  }
}

function startDemo() {
  initAudio();
  showMuteBtn(true);
  showTuneBtn(true);
  setMuteIcon(isMuted());
  S.setMode('demo');
  hideVeil();
  setStatus('演示模式 · 自动手势展示');
  setPreview(false);
  toast('演示模式：没有摄像头也能看手势效果');
}

/* ---------------------- 事件绑定 ---------------------- */

startBtn.addEventListener('click', startLive);
demoBtn.addEventListener('click', startDemo);

muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMuteIcon(toggleMute());
  syncPanel();            // 面板里的「音效」开关跟着变
});

// 浏览器要求音频必须由用户手势唤醒
document.addEventListener('pointerdown', resumeAudio, { passive: true });

window.addEventListener('resize', () => {
  const { prevW, prevH } = resizeCanvas();
  remap(prevW, prevH);
});

window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const { prevW, prevH } = resizeCanvas();
    remap(prevW, prevH);
  }, 260);
});

/* ---------------------- 起飞 ---------------------- */

resizeCanvas();
initParticles();

// 读取上次保存的主题与参数，再建面板（面板的初始值从 settings 读）
loadSettings();
applySettings();
buildPanel();

requestAnimationFrame(loop);

// 兼容 file:// 直接打开：摄像头会被浏览器拦截，提前说明
if (location.protocol === 'file:') {
  setHintHTML('当前是本地文件打开，摄像头会被浏览器拦截<br>请通过 localhost 访问，或点下面的演示模式');
}

// ?demo 直接进入演示模式（也方便截图与线上预览）
if (new URLSearchParams(location.search).has('demo')) {
  veil.style.transition = 'none';
  setTimeout(startDemo, 60);
}
