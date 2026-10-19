/**
 * engine.js —— MediaPipe 手部识别引擎
 *
 * 识别库本身走 CDN（约 1.5MB），模型文件 hand_landmarker.task 放在仓库里，
 * clone 下来就能离线运行，不依赖外网模型仓库。
 */

import { W, H } from './state.js';
import { video } from './ui.js';

const CDN_BASES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',
  'https://unpkg.com/@mediapipe/tasks-vision@0.10.14',
];

/**
 * 加载并创建 HandLandmarker。GPU 优先，失败自动回退 CPU。
 * @returns {Promise<any>}
 */
export async function loadEngine() {
  let vision = null;
  let base = null;

  for (const b of CDN_BASES) {
    try {
      vision = await import(`${b}/vision_bundle.mjs`);
      base = b;
      break;
    } catch (e) {
      /* 换下一个 CDN */
    }
  }
  if (!vision) throw new Error('识别引擎加载失败');

  const fileset = await vision.FilesetResolver.forVisionTasks(`${base}/wasm`);
  const opts = {
    baseOptions: { modelAssetPath: 'hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.5,
  };

  try {
    return await vision.HandLandmarker.createFromOptions(fileset, opts);
  } catch (e) {
    opts.baseOptions.delegate = 'CPU';
    return await vision.HandLandmarker.createFromOptions(fileset, opts);
  }
}

/**
 * 视频坐标 → 屏幕坐标的映射函数（object-fit: cover 的效果）。
 * 归一化坐标经过镜像，所以用 (1 - p.x)。
 */
export function makeMapper() {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s;
  const dh = vh * s;
  const ox = (W - dw) / 2;
  const oy = (H - dh) / 2;
  return (p) => ({ x: ox + (1 - p.x) * dw, y: oy + p.y * dh });
}
