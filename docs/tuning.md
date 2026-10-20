# 二次开发说明

代码按职责拆成 14 个 ES Module（共约 3000 行），浏览器原生加载。
没有构建步骤、没有 npm 依赖，改完按 `Ctrl + F5` 强制刷新就生效。

> 定位代码时**优先用函数名 / 参数名搜索**，这份文档告诉你"该去哪个文件搜什么"。

---

## 一、模块地图

| 文件 | 行数 | 职责 | 想改什么来这里 |
|---|---|---|---|
| `js/config.js` | 159 | **全部可调参数** | 手感、密度、阈值、绘形参数——90% 的调整只动这个文件 |
| `js/settings.js` | 242 | 主题预设、参数状态、持久化 | 加一套配色、改面板可调项 |
| `js/panel.js` | 267 | 屏幕上的调节面板 | 面板控件、控件分组 |
| `js/state.js` | 36 | 运行时共享状态（live binding） | 一般不用动；加全局状态放这里 |
| `js/render.js` | 37 | 光斑贴图预渲染（72 档色相） | 粒子发光质感、渐变分布 |
| `js/viewport.js` | 43 | 画布尺寸 / DPR | 高分屏性能问题 |
| `js/particles.js` | 265 | 星云粒子：生成、力场物理、绘制 | 粒子数量、分布、物理手感 |
| `js/hands.js` | 268 | 手势解析、骨架绘制、演示假手 | 手势判定阈值、骨架样式 |
| `js/draw.js` | 401 | 指尖绘形：笔画记录、形状识别、粒子成形 | 画心/写字的手感、识别模板 |
| `js/effects.js` | 169 | 爆发、响指冲击、指尖火星 | 冲击波力度、火星样式 |
| `js/audio.js` | 256 | Web Audio 合成音效 + 麦克风检测 | 音色、响指听音阈值 |
| `js/engine.js` | 66 | MediaPipe 加载 + 坐标映射 | 换模型、识别精度、手数上限 |
| `js/ui.js` | 89 | DOM 引用与界面反馈 | 状态栏、toast、按钮行为 |
| `js/main.js` | 252 | 装配：主循环、启动、事件 | demo 编排、启动流程 |

依赖方向（无环）：

```
config ─→ state ─→ render / ui ─→ particles / hands / draw ─→ effects ─→ main
                                        ↑                       │
                                     audio ─────────────────────┘
                                        ↑
                              settings（把参数写回 config，被 main 调用）
                                        ↑
                                     panel（只读写 settings）
```

三个关键设计：

1. **手势层只报告，不执行**。`hands.js` 识别到手势时只设事件标志
   （`h.evPinch` / `h.evSnap` / `h.evOpen` / `h.evClose`），由
   `effects.consumeHandEvents()` 统一消费。改音效不碰识别，加特效不碰物理。
2. **参数集中在 config**，面板通过 `settings.applySettings()` 写进去；
   各模块每帧读 `THEME.trail`、`FIELD.pull` 这类字段，所以改完立刻生效。
3. **绘形层只碰自己的粒子**，和星云粒子（`P`）互不干扰。

---

## 二、界面面板

右上角 ✦ 打开。面板上的每个控件最终都落到 `settings.settings` 对象里，
存 localStorage（key `stardust:settings:v1`），下次打开自动恢复。

**加一套主题**：`settings.js` 的 `THEMES` 数组里加一项即可，色值用 HSL 三元组：

```js
{
  key: 'mint', name: '薄荷',
  bg: [160, 50, 3], star: [160, 90, 92],       // [色相, 饱和度, 明度]
  inner: 155, outer: 185, hand: 160, warm: 120, // 核心 → 外围 → 骨架 → 握拳偏暖
  accent: [160, 90, 78], accent2: [185, 80, 60] // UI 主色与渐变色
}
```

**加一个滑块**：`panel.js` 的 `RANGES` 里加 key（默认读写 `settings[key]`），
再把 key 加到 `GROUPS` 的某一组里；最后在 `settings.applySettings()` 把它写进 config。

**加一个开关**：`config.js` 的 `FX` 加字段 → `settings` 的 `DEFAULTS.fx` 加默认值 →
`applySettings()` 里同步 → `panel.js` 的 `TOGGLES` 加一行 → 在对应模块里判断 `FX.xxx`。

---

## 三、最常调的参数（全部在 `js/config.js`）

**手感（`FIELD`）**
```js
pull: 2.05,        // 握拳时的吸引强度。想更"抓得住"→ 调大（如 2.6）
pullRange: 2.85,   // 张开时的排斥量（面板会把差值固定成 0.8）
swirlRange: 1.05,  // 张手时的旋涡强度。想转得更疯 → 调大（如 1.8）
```

**粒子密度（`SCALE`）**
```js
nebula: { max: 2600, min: 1200, areaDiv: 760, fixed: 0 },
```
`max` 调小更流畅，调大更密。`fixed > 0` 时固定数量（面板拖动密度后就是这种状态）。

**拖尾长短（`THEME.trail`）** —— 面板里可调，实际值是「底色 + 透明度」：
透明度越小残影越长（0.08 很梦幻，0.34 干净利落）。

**速度上限（`MOTION`）**
```js
maxV: 13,       // 常规速度，调大更狂野
boostV: 44,     // 响指/爆发期间额外放开的上限
```

**指尖绘形（`DRAW`）**
```js
sampleDist: 7,      // 采样间距，调小笔迹更细腻（也更耗）
perShape: 380,      // 每一笔多少粒子
closeRatio: 0.20,   // 首尾多近算闭合的第一步
minArea: 0.30,      // 笔画围出的面积/包围盒面积 下限：写字的折线接近 0，不会被误认
minShapeSize: 90,   // 太小的笔画（点、短横）不做识别
minAspect: 0.24,    // 横竖撇捺这类细长笔画不识别
starPeaks: [4, 6],  // 星形需要 4~6 个显著尖峰
starRadial: 1.45,   // 星形内外半径比下限；starRadialMax: 5（超过则须一笔画自交叉 ≥ 4）
starRegularity: 0.42, // 星形尖角分布的均匀度上限
circleRoundness: 1.25, // 圆形的径向起伏上限
heartRadial: 8,     // 心形不允许轮廓穿过质心
matchError: 0.165,  // 识别误差上限，调小 = 只认很标准的形状
sheetGap: 6,        // 停笔多久内算"同一张纸"（写字要能叠笔画）
life: 20,           // 停笔后保留秒数
```

识别流程在 `shape.js`（纯几何、无 DOM，可直接 `node tools/test-shape.mjs` 跑回归测试）：
先过三道硬门槛（首尾靠近 → 围出面积 → 包围盒不扁平不细小），
再按模板各自的前置条件（尖峰数/圆度/均匀度/自交叉）筛选，最后才是模板比对。
这套门槛的目的是**宁可认不出，也不要把写的字改掉**。

---

## 四、想加新功能，钩子在哪

**① 加一种新手势**
1. `hands.js` 的 `feed()` 里算出手势数值，设一个事件标志 `h.evXxx`
2. `effects.js` 的 `consumeHandEvents()` 里消费它（触发音效/特效）
3. 如果要影响力场，在 `particles.js` 的 `updateParticles()` 里用 `h.xxx`

例：比 V 手势 = 食指中指伸直 + 其余弯曲。`feed()` 里已有每根手指的伸展判定（`ext` 数组），拼一下就行。

**② 让指尖能认更多形状**
`shape.js` 的 `buildTemplates()` 里加一条模板曲线，`SHAPE_NAMES` 加中文名，
并在 `matchShape()` 的 `gate` 里给它定一个前置条件（防误抢）。
加完务必跑 `node tools/test-shape.mjs`——里面有汉字不误判、图形必命中的回归用例。

**③ 加一层新粒子**
参照 `particles.js` 里 `P` / `stars` 的写法建数组，物理放 `update*`，绘制放 `draw*`，
在 `main.js` 的 `draw()` 里加一行调用。指尖火星（`effects.js` 的 `sparks`）是最简单的参考样本。

**④ 加音效**
`audio.js` 里已有 `noiseHit` / `toneHit` 两个现成发声单元，`sfx` 对象里加一个方法，
两三行就是一个新音效（参考 `sfx.shape` 的三声铃）。

**⑤ 双手互动**
`hands[0]`、`hands[1]` 都有完整状态。比如两手距离近时让中间生成闪电——在
`effects.js` 加一层绘制，读两只手的 `h.x / h.y`。

**⑥ 换识别目标**
`engine.js` 的 `loadEngine()` 改 `modelAssetPath`。MediaPipe 还有姿态（Pose）、
人脸（Face）模型，接口几乎一样，换成全身 33 点就能做"整个人站在星空里"。

---

## 五、改完怎么生效

- 本地服务器的黑窗口不用关
- 改完代码，浏览器 `Ctrl + F5` 强制刷新
- ES Module 有缓存，普通刷新（F5）有时不够，**建议习惯用 Ctrl + F5**
- 想恢复出厂：面板底部「恢复默认」（清 localStorage 并重载）

## 六、注意

浏览器对摄像头有硬性限制：**必须通过 `http://127.0.0.1:xxxx` 或 https 访问**。
所以本地永远用「双击启动.bat」进，别直接双击 index.html。

`file://` 下模块也会被 CORS 拦，所以本地服务器是必须的。
