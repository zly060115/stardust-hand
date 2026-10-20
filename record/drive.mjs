/**
 * record/drive.mjs —— 逐帧导出宣传片画面
 *
 * 用 CDP 驱动无头 Edge：每调一次 page 的 __frame()，就把 canvas 的某一帧存成 JPEG。
 * 时间由页面内部固定步长推进，所以导出是确定性的，不受渲染速度影响。
 *
 * 用法：
 *   node record/drive.mjs <输出目录> [--max-frames N] [--fast 时间点]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'http://127.0.0.1:8799/record/stage.html';
const W = 1920, H = 1080;

const args = process.argv.slice(2);
const outDir = args[0] || path.join(process.cwd(), 'frames');
const maxArg = args.indexOf('--max-frames');
const MAX = maxArg > -1 ? parseInt(args[maxArg + 1], 10) : Infinity;
const fastArg = args.indexOf('--fast');
const FAST = fastArg > -1 ? args[fastArg + 1] : '';   // 逗号分隔的多个时间点

fs.mkdirSync(outDir, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-rec-'));
const proc = spawn(EDGE, [
  '--headless=new',
  '--no-sandbox',
  '--no-proxy-server',
  `--window-size=${W},${H}`,
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--disable-extensions',
  '--remote-debugging-port=9222',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/list');
      const list = await r.json();
      if (list.length) return list;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('浏览器调试端口没起来');
}

const list = await targets();
const page = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: PAGE });

// 等页面模块加载完成
let ready = false;
for (let i = 0; i < 150; i++) {
  await sleep(200);
  try {
    ready = await evaluate('!!window.__ready');
    if (ready) break;
  } catch { /* 导航中 */ }
}
if (!ready) throw new Error('页面没有就绪（检查 stage.html 的模块报错）');

const meta = JSON.parse(await evaluate('JSON.stringify(window.__meta())'));
console.log(`画布 ${meta.w}×${meta.h} · 逻辑 ${meta.ww}×${meta.hh} · 计划 ${meta.frames} 帧`);

if (FAST) {
  const points = FAST.split(',').map(Number);
  for (const t of points) {
    await evaluate(`window.__fastTo(${t})`);
    const shot = await evaluate('window.__peek()');
    const name = `peek_${String(t).replace('.', '_')}.jpg`;
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.split(',')[1], 'base64'));
    console.log(`  ${name} @ ${t}s`);
  }
  ws.close(); proc.kill();
  process.exit(0);
}

const total = Math.min(meta.frames, MAX);
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const url = await evaluate('window.__frame()');
  const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  fs.writeFileSync(path.join(outDir, `f_${String(i + 1).padStart(4, '0')}.jpg`), buf);
  if (i % 30 === 0 || i === total - 1) {
    const el = (Date.now() - t0) / 1000;
    const fps = (i + 1) / Math.max(el, 0.001);
    const eta = (total - i - 1) / Math.max(fps, 0.001);
    console.log(`  ${i + 1}/${total}  ${fps.toFixed(1)} 帧/秒  剩余 ${eta.toFixed(0)}s`);
  }
}

console.log(`完成：${total} 帧 → ${outDir}`);
ws.close();
proc.kill();
process.exit(0);
