/**
 * config.js —— 主题与可调参数
 *
 * 想改手感 / 配色 / 粒子密度，只动这个文件就够了。
 * 数值都有实测依据，改得太大会让物理失衡（比如把 pull 调到 10，星尘会瞬间糊成一团）。
 */

/**
 * 配色：整个作品只有一个色盘。
 * 这些字段会被 settings.applySettings() 在运行时整体改写（换主题 / 换预设），
 * 所以其它模块必须每次用到时读 THEME.xxx，不要把它解构成局部常量。
 */
export const THEME = {
  bgFill: '#0a0704',                 // 画布底色（暖黑）
  trail: 'rgba(10,7,4,0.168)',       // 拖尾：越小残影越长
  star: '#ffeecb',                   // 远景星点
  starBright: 1,                     // 星点亮度倍率（面板可调）
  innerHue: 47,                      // 星系核心：金黄
  outerHue: 22,                      // 外围：橙红
  handHue: 43,                       // 骨架 / 掌心光晕
  warmHue: 30,                       // 握拳时的暖橙
  ring: 'rgba(255,226,168,1)',       // 爆发环
};

/** 粒子规模：按屏幕面积自适应，min/max 是为了照顾低端机和大屏 */
export const SCALE = {
  // fixed > 0 时直接用固定数量（面板手动调密度后就不再随窗口自适应）
  nebula: { max: 2600, min: 1200, areaDiv: 760, fixed: 0 },
  stars: { max: 1400, min: 700, areaDiv: 1500 },
};

/** 光点贴图：预生成一组不同色相的径向渐变小图，绘制时直接 drawImage */
export const SPRITE = {
  steps: 72,
  hueMin: 0,
  hueStep: 5,     // 覆盖 0 ~ 355 度：任何主题色相都能命中一张贴图
  size: 64,
};

/**
 * 效果开关：面板上的复选框直接落到这里，各模块绘制前判断。
 * 关掉只是不画 / 不发生，不影响物理与识别。
 */
export const FX = {
  sparks: true,     // 指尖火星
  skeleton: true,   // 手掌骨架与关节点（掌心光晕始终保留）
  stars: true,      // 背景远景星
  draw: true,       // 指尖绘形
  autoShape: true,  // 画闭合图形时自动规整成标准形状
};

/** 指尖绘形：食指单指在空中画，笔画凝固成粒子形状 */
export const DRAW = {
  sampleDist: 7,        // 相邻采样点的最小间距（像素）
  maxPoints: 400,       // 一笔最多记录多少点
  minLength: 70,        // 太短的一笔直接丢掉（误触）
  minPoints: 8,
  preHold: 0.22,        // 姿势稳定后先缓存这么久的指尖轨迹，正式落笔时接上（笔头不会被裁掉）
  closeRatio: 0.20,     // 首尾距离 / 笔画长度 小于此值 → 首尾算接近
  minArea: 0.30,        // 笔画围出的面积 / 包围盒面积 下限：来回折的笔画接近 0，绕一圈的图形 ≥ 0.34
  minShapeSize: 90,     // 包围盒长边小于此值不做识别（点、短笔）
  minAspect: 0.24,      // 包围盒 短边/长边 下限，横竖撇捺这类细长笔画不识别
  starPeaks: [4, 6],    // 星形必须有 4~6 个显著尖峰（正常五角星是 5 个）
  starRadial: 1.45,     // 星形 外半径/内半径 下限，不够尖的不算星
  starRadialMax: 5,     // 十顶点轮廓星的半径比上限；超过它必须是"一笔画"（自交叉 ≥ 4）
  starRegularity: 0.42, // 星形尖角间距的离散系数上限：五角星均匀分布，乱折的笔画很散
  circleRoundness: 1.25, // 圆形 径向起伏 上限：方的（1.41）、尖的都不是圆
  heartRadial: 8,       // 心形 外/内半径比 上限：心的轮廓不穿过质心，乱折的笔画比率会到几百
  matchError: 0.165,    // 形状匹配的平均误差上限（归一化空间）
  perShape: 380,        // 每一笔的粒子数
  sheetGap: 6,          // 秒：离上一次落笔多久内算"同一张纸"（写字要能叠笔画）
  maxSheets: 3,         // 同时最多几张"纸"
  sheetParts: 4200,     // 单张纸的粒子上限，超了自动换新纸
  morphTime: 0.7,       // 聚拢成形的时长（秒）
  life: 20,             // 停笔后保留秒数，最后 3 秒淡出
};

/** 星系基础运动：差速旋转，中心快、外围慢 */
export const GALAXY = {
  omega: 0.30,       // 角速度基准
  radiusScale: 320,  // 半径衰减尺度
  relax: 0.018,      // 向目标切向速度靠拢的速率
  armRatio: 0.72,    // 初始落在螺旋臂上的粒子比例
  armTwist: 0.0042,  // 螺旋臂缠绕系数
};

/** 手部力场：这是整个作品的手感核心 */
export const FIELD = {
  pull: 2.05,          // 握拳时的径向强度（正 = 吸引）
  pullRange: 2.85,     // 张开时衰减量，pull - pullRange 为负 → 变成斥力
  swirl: 0.05,         // 握拳时的切向旋涡
  swirlRange: 1.05,    // 张开时增加的旋涡强度
  radialK: 30000,      // 径向力系数
  swirlK: 21000,       // 切向力系数
  soften: 3200,        // 距离平方软化，避免中心出现奇点
  coreR: 120,          // 掌心软核半径：防止所有粒子挤成一个点
  coreK: 0.009,
  fingertipGain: 9000, // 指尖吸引
  fingertipSwirl: 11000,
  fingertipSoften: 1100,
  fingertipSpread: 0.45, // 张开到多少才开始绕指尖流动
};

/** 阻尼与限速 */
export const MOTION = {
  dampMin: 0.905,     // 张开时的阻尼基数（越接近 1 越滑）
  dampRange: 0.080,   // 握拳时额外增加的黏滞
  maxV: 13,           // 常规速度上限
  boostV: 44,         // 爆发期间额外放开的速度上限
  boostDecay: 0.014,
};

/** 拇指食指捏合：掌心局部超新星 */
export const BURST = {
  radius: 560,    // 影响半径
  power: 30,      // 冲量强度
  falloff: 1.7,   // 衰减指数
  boost: 0.42,    // 给粒子加的速度余量
};

/** 打响指：整片星空向外轰开 */
export const SNAP = {
  power: 9,        // 基础冲量
  powerK: 11000,   // 近处额外冲量
  powerR: 160,     // 额外冲量的衰减距离
  cooldown: 0.85,  // 两次响指的最小间隔（秒）
};

/** 指尖火星 */
export const SPARK = {
  max: 560,
  rate: 1.5,          // 每个指尖每秒发射数
  speedMin: 1.1,
  speedRange: 2.8,
  decayMin: 0.017,
  decayMax: 0.042,
  openGate: 0.30,     // 张开度超过这个值才发射
};

/**
 * 手势判定阈值
 *
 * 响指和"食指单指写字"这两个动作在静态姿势上几乎重叠（都是食指伸出、其余收拢），
 * 光看几何关系永远会互相误判。所以这里靠三层区分：
 *   1. 动作时序：响指是"拇指压住中指 → 极短时间弹开"，写字没有这个瞬间；
 *   2. 运动分工：响指时拇指在掌内快速位移、食指尖基本不动；写字正好反过来；
 *   3. 互斥锁：落笔期间不认响指，响指之后一小段时间内不起笔。
 */
export const GESTURE = {
  extendRatio: 1.13,   // 指尖到手腕 > 中节到手腕 × 此值 → 该指伸直
  thumbRatio: 1.08,
  pinch: 0.42,         // 拇指-食指距离 / 掌宽 < 此值 → 捏合
  pinchSpread: 0.28,

  // --- 响指：先合后弹 ---
  snapNear: 0.38,      // 拇指-中指贴近（按下去）
  snapApart: 0.90,     // 再弹开到此值（弹出去）
  snapWindow: 0.22,    // 从贴合到弹开的时间窗口（秒），超过就不算"弹"
  snapNearFrames: 2,   // 贴合至少要连续两帧，单帧关键点抖动不算
  snapFlick: 0.40,     // 弹开时拇指标度位移下限（掌宽倍数）
  snapThumbLead: 1.35, // 拇指位移 / 食指位移 下限：写字是食指在扫，响指是拇指在弹
  snapCooldown: 1.1,

  // --- 写字：姿势要稳 ---
  drawHold: 0.20,      // 食指单指姿势要连续保持这么久才认（秒）。响指的"按压"很短，撑不到这么久
  drawMidMin: 0.30,    // 拇指基本贴住中指（按压姿势）时不算写字
  snapDrawLock: 0.5,   // 响指之后多久内不允许起笔（秒）
  strokeSnapLock: 0.45,// 收笔之后多久内不认响指（秒），抬手动作不算响指

  openAt: 0.62,        // 张开度跨过此值 → 播放"张开"音
  closeAt: 0.28,
  stateCooldown: 1.4,
};

/** 麦克风响指检测 */
export const MIC = {
  bandLo: 2600,    // 响指的能量集中在 2.6k - 7.2k
  bandHi: 7200,
  thresh: 7,       // 超过自适应基线多少倍算瞬态
  floor: 0.02,     // 绝对能量下限，防止安静时误触
  decay: 0.60,     // 峰值之后要掉到这个比例以下 → 确认是瞬态而不是持续噪声
  tailMax: 0.35,   // 峰值后最多观察这么久（秒），一直没有衰减就丢掉
  cooldown: 0.95,
  handLock: 0.45,  // 手部响指之后的静默期，两条检测线不叠加
  fftSize: 1024,
};

/** 流畅度 */
export const PERF = {
  maxDPR: 1.75,    // 高分屏限制渲染倍率，省 GPU
  fpsWindow: 500,  // 性能面板刷新间隔（毫秒）
};
