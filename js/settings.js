/**
 * settings.js —— 主题预设、可调参数与本地记忆
 *
 * 数据流很简单：
 *   面板控件 → settings 对象 → applySettings() → 写入 config 里的参数对象
 *
 * config 里的字段是被其它模块「每帧读取」的（THEME.trail、FIELD.pull、GALAXY.omega…），
 * 所以写进去立刻生效，不需要重启循环。
 * 只有两件事必须额外处理：
 *   1. 密度变化要真的增删粒子（setDensity）
 *   2. 主题变化要按半径重新上色（refreshHues），否则老粒子会停在旧配色
 */

import { THEME, SCALE, FIELD, GALAXY, BURST, SNAP, FX } from './config.js';
import { P, refreshHues, setDensity } from './particles.js';
import { paintBg } from './viewport.js';
import { isMuted, setMuted } from './audio.js';
import { setMuteIcon } from './ui.js';

/* ---------------------- 主题预设 ---------------------- */

/**
 * 每个主题只描述色相与明度，其余由代码推导：
 *   bg / star / accent   → [色相, 饱和度, 明度]
 *   inner → outer        → 星尘从核心到外围的色相过渡
 *   hand / warm          → 骨架色与握拳时的偏暖色
 */
export const THEMES = [
  {
    key: 'gold', name: '金色星系',
    bg: [30, 43, 3], star: [40, 100, 90],
    inner: 47, outer: 22, hand: 43, warm: 30,
    accent: [43, 100, 78], accent2: [26, 100, 62],
  },
  {
    key: 'ice', name: '冰蓝星云',
    bg: [216, 55, 3], star: [198, 100, 92],
    inner: 196, outer: 234, hand: 192, warm: 216,
    accent: [196, 100, 80], accent2: [226, 100, 66],
  },
  {
    key: 'violet', name: '紫罗兰',
    bg: [265, 55, 4], star: [272, 100, 92],
    inner: 302, outer: 262, hand: 290, warm: 320,
    accent: [276, 100, 82], accent2: [258, 100, 68],
  },
  {
    key: 'jade', name: '翡翠',
    bg: [158, 55, 3], star: [150, 85, 90],
    inner: 140, outer: 176, hand: 150, warm: 96,
    accent: [150, 72, 78], accent2: [168, 80, 58],
  },
  {
    key: 'rose', name: '玫瑰',
    bg: [340, 58, 3], star: [345, 100, 92],
    inner: 350, outer: 318, hand: 342, warm: 12,
    accent: [342, 100, 84], accent2: [330, 100, 66],
  },
  {
    key: 'ember', name: '熔岩',
    bg: [18, 62, 3], star: [30, 100, 88],
    inner: 12, outer: 38, hand: 18, warm: 44,
    accent: [22, 100, 74], accent2: [4, 92, 56],
  },
];

/* ---------------------- 取值与换算 ---------------------- */

/** HSL → [r,g,b]，只用于把预设变成 canvas / CSS 能直接吃的颜色 */
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

const rgbStr = ([r, g, b], a) =>
  a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

/* ---------------------- 状态 ---------------------- */

/** 爆发冲量的基准值：滑块是倍率，不要直接改 config 里的原始值 */
const BASE = { burst: BURST.power, snap: SNAP.power };

const KEY = 'stardust:settings:v1';

const DEFAULTS = {
  theme: 'gold',
  custom: null,        // 随机配色时存这里
  density: 0,          // 0 = 跟随屏幕尺寸自动
  trail: 0.168,        // 拖尾透明度：越小残影越长
  starBright: 1,
  pull: 2.05,
  swirl: 1.05,
  omega: 0.30,
  power: 1,
  fx: { sparks: true, skeleton: true, stars: true, sound: true, draw: true, autoShape: true },
};

/** 当前设置（面板读写的就是这个对象） */
export const settings = JSON.parse(JSON.stringify(DEFAULTS));

/** 取当前生效的调色板：预设 or 随机生成的那套 */
export function palette() {
  if (settings.theme === 'custom' && settings.custom) return settings.custom;
  return THEMES.find(t => t.key === settings.theme) || THEMES[0];
}

/* ---------------------- 应用 ---------------------- */

/** 把配色同步到 CSS 变量，让界面文字 / 按钮 / 光点跟着主题走 */
function paintCss(p) {
  const st = document.documentElement.style;
  const accent = hsl2rgb(...p.accent);
  const text = hsl2rgb(p.accent[0], 82, 93);

  st.setProperty('--accent', rgbStr(accent));
  st.setProperty('--accent-rgb', accent.join(','));
  st.setProperty('--accent2', rgbStr(hsl2rgb(...p.accent2)));
  st.setProperty('--text', rgbStr(text));
  st.setProperty('--text-soft', rgbStr(text, 0.66));
  st.setProperty('--bg-rgb', hsl2rgb(...p.bg).join(','));
}

/** 把 settings 写进各模块的参数对象，然后处理需要重建的部分 */
export function applySettings() {
  const p = palette();
  const bg = hsl2rgb(...p.bg);

  THEME.bgFill = rgbStr(bg);
  THEME.trail = rgbStr(bg, settings.trail);
  THEME.star = rgbStr(hsl2rgb(...p.star));
  THEME.starBright = settings.starBright;
  THEME.innerHue = p.inner;
  THEME.outerHue = p.outer;
  THEME.handHue = p.hand;
  THEME.warmHue = p.warm;
  THEME.ring = `hsla(${p.hand},100%,78%,1)`;

  FIELD.pull = settings.pull;
  FIELD.pullRange = settings.pull + 0.8;   // 差值固定 0.8：保证张手时一定是斥力
  FIELD.swirlRange = settings.swirl;
  GALAXY.omega = settings.omega;
  BURST.power = BASE.burst * settings.power;
  SNAP.power = BASE.snap * settings.power;

  FX.sparks = !!settings.fx.sparks;
  FX.skeleton = !!settings.fx.skeleton;
  FX.stars = !!settings.fx.stars;
  FX.draw = !!settings.fx.draw;
  FX.autoShape = !!settings.fx.autoShape;

  // 密度：先写 config，再让粒子数组对齐
  const want = settings.density > 0 ? Math.round(settings.density) : 0;
  SCALE.nebula.fixed = want;
  if (want && want !== P.length) setDensity(want);

  paintCss(p);
  refreshHues();
  paintBg();                    // 立刻清掉旧底色，不然要等好几秒拖尾才换完

  setMuted(!settings.fx.sound);
  setMuteIcon(isMuted());
}

/* ---------------------- 修改与持久化 ---------------------- */

let saveTimer = 0;

/** 防抖保存：拖滑块时不要每帧写 localStorage */
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch (e) {
      /* 隐私模式下写不进去，忽略即可 */
    }
  }, 220);
}

/** 读取上次保存的设置（首次访问时什么都不做） */
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return;

    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'fx' || k === 'custom') continue;
      if (typeof s[k] === 'number' || typeof s[k] === 'string') settings[k] = s[k];
    }
    if (s.fx && typeof s.fx === 'object') Object.assign(settings.fx, s.fx);
    if (s.custom && typeof s.custom === 'object') settings.custom = s.custom;

    if (settings.theme !== 'custom' && !THEMES.some(t => t.key === settings.theme)) {
      settings.theme = 'gold';
    }
  } catch (e) {
    /* 数据坏了就当没有，别让设置拖垮启动 */
  }
}

export function setTheme(key) {
  settings.theme = key;
  applySettings();
  save();
}

/** 随机一套配色：基色随机，核心→外围拉 20~60 度，保证层次 */
export function randomTheme() {
  const h = Math.random() * 360;
  const spread = 20 + Math.random() * 40;

  settings.custom = {
    key: 'custom',
    name: '随机',
    bg: [h, 40 + Math.random() * 25, 2.5 + Math.random() * 2],
    star: [h, 70 + Math.random() * 30, 88 + Math.random() * 6],
    inner: Math.round(h),
    outer: Math.round((h - spread + 360) % 360),
    hand: Math.round(h),
    warm: Math.round((h + 20) % 360),
    accent: [Math.round(h), 95, 78],
    accent2: [Math.round((h + 25) % 360), 95, 60],
  };
  settings.theme = 'custom';
  applySettings();
  save();
}

/** 恢复默认：清掉本地记录后重载，最干净 */
export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) { /* ignore */ }
  location.reload();
}
