/**
 * snap.js —— 响指判定（纯函数，无 DOM，可直接 node 跑测试）
 *
 * 为什么单独一个文件：响指和"食指单指写字"在静态姿势上几乎一样
 * （食指伸出、其余收拢），只比几何距离必然互相误判。
 * 真正的区别在**动作**上，所以这里只做三件事：
 *
 *   1. 时序：拇指-中指必须先"贴合"（连续 ≥ 2 帧），再在很短时间内弹开；
 *   2. 分工：弹开那一下，拇指在掌内（相对中指根）位移很大，食指尖几乎不动；
 *      写字正好相反 —— 食指尖在扫，拇指跟着手走、掌内位移很小；
 *   3. 量级：弹开时拇指的标度位移必须足够（太小是抖动，不是响指）。
 *
 * 三个条件全过才算响指。时间窗、门槛都在 config.js 的 GESTURE 里。
 */

/**
 * 往历史里塞一帧。样本坐标都用"相对中指根(9) / 掌宽"的标度值，
 * 这样手在画面里平移不影响判断，拇指和食指的位移可以直接比大小。
 *
 * @param {Array} hist 历史数组（升序）
 * @param {{t:number,r:number,tx:number,ty:number,ix:number,iy:number}} s
 * @param {number} maxLen
 */
export function pushSample(hist, s, maxLen) {
  hist.push(s);
  while (hist.length > maxLen) hist.shift();
  return hist;
}

/** 从一帧关键点造一个样本（hands.js 每帧调用一次） */
export function makeSample(pts, palmW, r, now) {
  const p9 = pts[9];
  return {
    t: now,
    r,
    tx: (pts[4].x - p9.x) / palmW,   // 拇指尖
    ty: (pts[4].y - p9.y) / palmW,
    ix: (pts[8].x - p9.x) / palmW,   // 食指尖
    iy: (pts[8].y - p9.y) / palmW,
  };
}

/**
 * 判定"这一帧是不是响指弹开的那一下"。
 * @param {Array} hist 升序样本，最后一项 = 当前帧
 * @param {number} now 当前秒
 * @param {object} G GESTURE 配置
 * @returns {boolean}
 */
export function detectSnap(hist, now, G) {
  if (!hist || hist.length < 4) return false;
  const cur = hist[hist.length - 1];

  // ① 现在必须是"弹开"状态，否则根本没到判定的时刻
  if (cur.r < G.snapApart) return false;

  // 只取时间窗内的样本
  const win = [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (now - hist[i].t > G.snapWindow) break;
    win.push(hist[i]);
  }
  if (win.length < 3) return false;
  win.reverse();

  // ② 窗口内必须有"连续贴近"的一段；单帧跌落多半是关键点抖了一下
  let run = 0;
  let best = 0;
  let anchor = null;
  for (const s of win) {
    if (s.r < G.snapNear) {
      run++;
      if (run > best) {
        best = run;
        anchor = s;      // 贴合段里最靠后的一帧 = 松手瞬间的参考位置
      }
    } else {
      run = 0;
    }
  }
  if (!anchor || best < G.snapNearFrames) return false;

  // ③ 分工：拇指位移必须够大，而且明显大于食指尖的位移
  const thumbMove = Math.hypot(cur.tx - anchor.tx, cur.ty - anchor.ty);
  const indexMove = Math.hypot(cur.ix - anchor.ix, cur.iy - anchor.iy);
  if (thumbMove < G.snapFlick) return false;
  if (thumbMove < indexMove * G.snapThumbLead) return false;

  return true;
}
