import { analyzeStroke, radialProfile } from '../js/shape.js';

const line = (x1, y1, x2, y2, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: x1 + (x2 - x1) * i / n,
    y: y1 + (y2 - y1) * i / n,
  }));

const jitter = (pts, n) => pts.map(p => ({ x: p.x + (Math.random() - 0.5) * n, y: p.y + (Math.random() - 0.5) * n }));
const cat = (...arrs) => arrs.flat();
const ring = fn => Array.from({ length: 81 }, (_, i) => fn(i / 80 * Math.PI * 2));

// 十顶点五角星：外/内半径交替，每个顶点间隔 36°
const starPolygon = (cx, cy, R, inner = 0.42) => ring(t => {
  const k = Math.round(t / (Math.PI * 2) * 10) % 10;
  const r = k % 2 ? inner : 1;
  return { x: cx + Math.cos(t - Math.PI / 2) * r * R, y: cy + Math.sin(t - Math.PI / 2) * r * R };
});

// 一笔画五角星：5 条对角线，绕两圈
const starScribble = (cx, cy, R) => {
  const v = Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
  const order = [0, 2, 4, 1, 3, 0];
  const out = [];
  for (let i = 0; i < order.length - 1; i++) {
    out.push(...line(v[order[i]].x, v[order[i]].y, v[order[i + 1]].x, v[order[i + 1]].y, 16));
  }
  return out.map(p => ({ x: p.x + cx, y: p.y + cy }));
};

const cases = {
  // ---- 汉字：一笔内画完或连笔写，都不该被规整 ----
  '一': line(200, 300, 400, 300),
  '十': cat(line(300, 200, 300, 400), line(200, 300, 400, 300)),
  '人': cat(line(240, 200, 300, 400), line(300, 400, 380, 210).reverse()),
  '之': cat(line(250, 220, 350, 220), line(350, 220, 260, 340), line(260, 340, 370, 360)),
  '心': cat([{ x: 220, y: 330 }], line(220, 330, 280, 290), line(280, 290, 320, 350), line(320, 350, 380, 300)),
  '女': cat([{ x: 300, y: 200 }], line(300, 200, 240, 270), line(240, 270, 370, 265), line(370, 265, 230, 300), line(230, 300, 370, 390)),
  '五': cat(line(240, 220, 360, 220), line(360, 220, 300, 300), line(300, 300, 240, 330), line(240, 330, 360, 330), line(360, 330, 240, 420), line(240, 420, 370, 420)),
  '王': cat(line(240, 220, 360, 220), line(360, 220, 300, 320), line(300, 320, 240, 320), line(240, 320, 360, 320), line(360, 320, 240, 420), line(240, 420, 370, 420)),
  '小': cat(line(300, 220, 300, 360), line(300, 360, 300, 300), line(300, 300, 240, 380)),
  '乙': cat(line(250, 200, 360, 200), line(360, 200, 250, 360), line(250, 360, 370, 360)),
  '弓': cat(line(240, 220, 360, 220), line(360, 220, 260, 300), line(260, 300, 370, 300), line(370, 300, 240, 390), line(240, 390, 370, 390)),
  '永': cat([{ x: 300, y: 200 }], line(300, 200, 300, 240), line(300, 240, 230, 260), line(230, 260, 300, 300), line(300, 300, 260, 380), line(300, 260, 350, 300), line(350, 300, 380, 340)),

  // ---- 图形：必须认对 ----
  'CIRCLE': ring(t => ({ x: 350 + Math.cos(t) * 130, y: 300 + Math.sin(t) * 130 })),
  'HEART': ring(t => ({ x: 320 + 16 * Math.sin(t) ** 3 * 8, y: 300 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 8 })),
  'STAR照模板画': starPolygon(320, 300, 140),
  'STAR一笔画': starScribble(320, 300, 140),
  'TRIANGLE': ring(t => {
    const seg = Math.floor(t / (Math.PI * 2 / 3)) % 3;
    const f = (t % (Math.PI * 2 / 3)) / (Math.PI * 2 / 3);
    const P = [[0, -1], [0.95, 0.85], [-0.95, 0.85], [0, -1]];
    return { x: 320 + (P[seg][0] + (P[seg + 1][0] - P[seg][0]) * f) * 140, y: 300 + (P[seg][1] + (P[seg + 1][1] - P[seg][1]) * f) * 140 };
  }),
  'SQUARE': ring(t => {
    const f = t / (Math.PI * 2) * 4;
    const seg = Math.floor(f) % 4;
    const u = f - Math.floor(f);
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    return { x: 320 + (P[seg][0] + (P[seg + 1][0] - P[seg][0]) * u) * 130, y: 300 + (P[seg][1] + (P[seg + 1][1] - P[seg][1]) * u) * 130 };
  }),
};

// 汉字必须"不是星形"，也尽量别被规整；图形必须精确命中
const EXPECT = {
  'CIRCLE': 'circle', 'HEART': 'heart', 'STAR照模板画': 'star', 'STAR一笔画': 'star',
  'TRIANGLE': 'triangle', 'SQUARE': 'square',
};

const JIT = [0, 8, 16];
let fail = 0;

for (const [name, base] of Object.entries(cases)) {
  const isShape = name in EXPECT;
  const row = [];
  for (const j of JIT) {
    const pts = j ? jitter(base, j) : base;
    const v = analyzeStroke(pts);
    const got = v.hit ? v.hit.name : 'free';
    const prof = radialProfile(pts);
    const want = isShape ? EXPECT[name] : null;
    const ok = isShape ? got === want : got === 'free';
    // 汉字被认成方形（口字旁那种真闭合的）算可接受，认成星/心/圆算 bug
    const soft = !isShape && got === 'square';
    if (!ok && !soft) fail++;
    row.push(`${ok ? ' ' : soft ? '~' : '✗'}${got}(a${(v.area ?? 0).toFixed(2)}/pk${prof.peaks}/r${prof.ratio.toFixed(2)})`);
  }
  console.log(`${name.padEnd(12)} ${isShape ? 'want=' + EXPECT[name] : 'want=free   '}  ` + row.join('  '));
}

console.log(fail ? `\n${fail} 项不符合预期` : '\n全部通过');
