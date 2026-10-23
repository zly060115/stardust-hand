/**
 * panel.js —— 屏幕上的调节面板
 *
 * 只做三件事：把控件画出来、把用户的动作写回 settings、把改完的结果应用到画面。
 * 所有控制项的数值都来自 settings，所以关掉面板再打开，位置和数值都还在。
 */

import { THEMES, settings, setTheme, randomTheme, resetAll, applySettings, save, palette } from './settings.js';
import { P } from './particles.js';
import { clearShapes, undoStroke } from './draw.js';
import { tuneBtn, muteBtn, setMuteIcon, setTuneActive, toast } from './ui.js';
import { isMuted } from './audio.js';

/* ---------------------- 控件定义 ---------------------- */

const RANGES = {
  density: {
    label: '粒子密度', min: 800, max: 4200, step: 100,
    get: () => (settings.density > 0 ? settings.density : P.length),
    set: v => { settings.density = v; },
    fmt: v => Math.round(v),
  },
  trail: {
    label: '拖尾长度', min: 0.04, max: 0.34, step: 0.002,
    fmt: v => Math.round((0.34 - v) / 0.3 * 100) + '%',
  },
  starBright: { label: '背景星光', min: 0.2, max: 1.8, step: 0.05, fmt: v => v.toFixed(2) },
  pull: { label: '引力强度', min: 1.2, max: 4, step: 0.05, fmt: v => v.toFixed(2) },
  swirl: { label: '旋涡强度', min: 0.2, max: 2.4, step: 0.05, fmt: v => v.toFixed(2) },
  omega: { label: '星系转速', min: 0.05, max: 0.7, step: 0.01, fmt: v => v.toFixed(2) },
  power: { label: '爆发强度', min: 0.4, max: 2, step: 0.05, fmt: v => '×' + v.toFixed(2) },
  depth3d: {
    label: '3D 景深', min: 0.15, max: 1.6, step: 0.05,
    fmt: v => '×' + v.toFixed(2),
  },
};

const GROUPS = [
  { title: '外观', items: ['density', 'trail', 'starBright'] },
  { title: '手感', items: ['pull', 'swirl', 'omega', 'power'] },
  { title: '空间', items: ['depth3d'] },
];

const TOGGLES = [
  { key: 'depth3d', label: '3D 星河', hint: '星空有真实厚度，手一转视角跟着变；关掉回到平面' },
  { key: 'draw', label: '指尖绘形', hint: '食指单指在空中画，粒子接住形状' },
  { key: 'planets', label: '太阳系天体', hint: '银河里散布地球、月球、土星等；手移过去就能照亮它、看到名字' },
  { key: 'autoShape', label: '自动成型', hint: '闭合笔画会被认成心形 / 圆形 / 星形' },
  { key: 'sparks', label: '指尖火星', hint: '张手时指尖迸出火花' },
  { key: 'skeleton', label: '手掌骨架', hint: '关掉只留掌心光晕' },
  { key: 'stars', label: '背景星辰', hint: '远处的闪烁星点' },
  { key: 'sound', label: '音效', hint: '环境音与手势反馈' },
];

/* ---------------------- DOM 小工具 ---------------------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------------------- 构建 ---------------------- */

let panel = null;
let open = false;
const rangeRefs = new Map();     // key → { input, out }
const toggleRefs = new Map();    // key → 开关元素
let chipEls = [];

function chip(t) {
  const b = el('button', 'theme-chip');
  b.dataset.key = t.key;
  b.title = t.name;

  const dot = el('i', 'theme-dot');
  dot.style.background = t.key === 'custom'
    ? 'conic-gradient(from 20deg, #ff7a59, #ffd166, #7ee787, #6cc6ff, #b98bff, #ff7ac6, #ff7a59)'
    : `radial-gradient(circle at 34% 30%, hsl(${t.inner},100%,74%), hsl(${t.outer},92%,46%) 62%, #060606 100%)`;

  b.appendChild(dot);
  b.appendChild(el('span', null, t.name));

  b.addEventListener('click', () => {
    if (t.key === 'custom') {
      randomTheme();
      toast('随机配色');
    } else {
      setTheme(t.key);
      toast('主题：' + t.name);
    }
    sync();
  });
  return b;
}

function makeRange(key) {
  const spec = RANGES[key];
  const get = spec.get || (() => settings[key]);
  const set = spec.set || (v => { settings[key] = v; });
  const fmt = spec.fmt || (v => v.toFixed(2));

  const row = el('div', 'ctl');
  const head = el('div', 'ctl-head');
  head.appendChild(el('span', 'ctl-label', spec.label));
  const out = el('output', 'ctl-val', fmt(get()));
  head.appendChild(out);

  const input = el('input');
  input.type = 'range';
  input.min = spec.min;
  input.max = spec.max;
  input.step = spec.step;

  const paint = () => {
    const v = parseFloat(input.value);
    const pct = ((v - spec.min) / (spec.max - spec.min)) * 100;
    input.style.setProperty('--p', pct.toFixed(1) + '%');
    out.textContent = fmt(v);
  };

  input.addEventListener('input', () => {
    set(parseFloat(input.value));
    applySettings();
    save();
    paint();
  });

  row.appendChild(head);
  row.appendChild(input);
  rangeRefs.set(key, { input, out, paint, get, spec });
  return row;
}

function makeToggle(key, label, hint) {
  const row = el('label', 'sw-row');
  const text = el('div', 'sw-text');
  text.appendChild(el('b', null, label));
  text.appendChild(el('span', null, hint));

  const box = el('input');
  box.type = 'checkbox';
  box.className = 'sw-input';

  const sw = el('i', 'sw');

  row.appendChild(text);
  row.appendChild(box);
  row.appendChild(sw);

  box.addEventListener('change', () => {
    settings.fx[key] = box.checked;
    applySettings();
    save();
    sw.classList.toggle('on', box.checked);
  });

  toggleRefs.set(key, { box, sw });
  return row;
}

/** 建面板（重复调用无效） */
export function buildPanel() {
  if (panel) return panel;

  panel = el('aside', 'panel');
  panel.id = 'panel';
  panel.setAttribute('aria-hidden', 'true');

  const head = el('div', 'panel-head');
  const titles = el('div');
  titles.appendChild(el('div', 'panel-kicker', 'TUNE'));
  titles.appendChild(el('div', 'panel-title', '星象调节'));
  const close = el('button', 'panel-x', '✕');
  close.setAttribute('aria-label', '关闭面板');
  close.addEventListener('click', () => setOpen(false));
  head.appendChild(titles);
  head.appendChild(close);

  const body = el('div', 'panel-body');

  // 主题
  const themeSec = el('section', 'sec');
  themeSec.appendChild(el('div', 'sec-label', '主题'));
  const grid = el('div', 'themes');
  THEMES.forEach(t => grid.appendChild(chip(t)));
  grid.appendChild(chip({ key: 'custom', name: '随机' }));
  chipEls = Array.from(grid.children);
  themeSec.appendChild(grid);
  body.appendChild(themeSec);

  // 滑块分组
  for (const g of GROUPS) {
    const sec = el('section', 'sec');
    sec.appendChild(el('div', 'sec-label', g.title));
    g.items.forEach(k => sec.appendChild(makeRange(k)));
    body.appendChild(sec);
  }

  // 开关
  const fxSec = el('section', 'sec');
  fxSec.appendChild(el('div', 'sec-label', '特效开关'));
  TOGGLES.forEach(t => fxSec.appendChild(makeToggle(t.key, t.label, t.hint)));
  body.appendChild(fxSec);

  // 底部按钮
  const foot = el('div', 'panel-foot');
  const rand = el('button', 'mini', '随机配色');
  rand.addEventListener('click', () => { randomTheme(); sync(); toast('随机配色'); });
  const undo = el('button', 'mini', '撤回一笔');
  undo.addEventListener('click', () => {
    const r = undoStroke();
    toast(r === 'live' || r === 'stroke' ? '已撤回一笔' : r === 'sheet' ? '已撤回上一张' : '没有可撤回的笔画');
  });
  const clear = el('button', 'mini ghost', '清空涂鸦');
  clear.addEventListener('click', () => { clearShapes(); toast('已擦掉'); });
  const reset = el('button', 'mini ghost', '恢复默认');
  reset.addEventListener('click', resetAll);
  foot.appendChild(rand);
  foot.appendChild(undo);
  foot.appendChild(clear);
  foot.appendChild(reset);
  body.appendChild(foot);

  body.appendChild(el('div', 'panel-note', '设置会自动保存在这台设备上'));

  panel.appendChild(head);
  panel.appendChild(body);
  document.body.appendChild(panel);

  tuneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!open);
  });

  // 右上角音量按钮也能改静音：跟着同步开关状态
  muteBtn.addEventListener('click', () => {
    setTimeout(() => {
      settings.fx.sound = !isMuted();
      save();
      sync();
    }, 0);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  return panel;
}

/* ---------------------- 状态同步 ---------------------- */

/** 把 settings 的当前值刷到控件上（打开面板、换主题、外部改动后调用） */
export function sync() {
  for (const [, r] of rangeRefs) {
    const v = r.get();
    r.input.value = v;
    r.paint();
  }
  for (const [key, t] of toggleRefs) {
    const on = key === 'sound' ? !isMuted() : !!settings.fx[key];
    t.box.checked = on;
    t.sw.classList.toggle('on', on);
  }
  const cur = palette().key;
  for (const c of chipEls) c.classList.toggle('on', c.dataset.key === cur);
}

export function setOpen(v) {
  if (!panel) buildPanel();
  open = v;
  panel.classList.toggle('on', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  setTuneActive(open);
  if (open) sync();
}

export const isOpen = () => open;
