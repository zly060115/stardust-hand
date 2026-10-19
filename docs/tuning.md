# 二次开发说明

代码按职责拆成 11 个 ES Module（共约 1400 行），浏览器原生加载。
没有构建步骤、没有 npm 依赖，改完按 `Ctrl + F5` 强制刷新就生效。

> 定位代码时**优先用函数名 / 参数名搜索**，这份文档告诉你"该去哪个文件搜什么"。

---

## 一、模块地图

| 文件 | 行数 | 职责 | 想改什么来这里 |
|---|---|---|---|
| `js/config.js` | 125 | **主题配色 + 全部可调参数** | 配色、手感、密度、阈值——90% 的调整只动这个文件 |
| `js/state.js` | 36 | 运行时共享状态（live binding） | 一般不用动；加全局状态放这里 |
| `js/render.js` | 37 | 光斑贴图预渲染（52 档色相） | 粒子发光质感、渐变分布 |
| `js/viewport.js` | 36 | 画布尺寸 / DPR | 高分屏性能问题 |
| `js/particles.js` | 222 | 星云粒子：生成、力场物理、绘制 | 粒子数量、分布、物理手感 |
| `js/hands.js` | 248 | 手势解析、骨架绘制、演示假手 | 手势判定阈值、骨架样式 |
| `js/effects.js` | 168 | 爆发、响指冲击、指尖火星 | 冲击波力度、火星样式 |
| `js/audio.js` | 240 | Web Audio 合成音效 + 麦克风检测 | 音色、响指听音阈值 |
| `js/engine.js` | 66 | MediaPipe 加载 + 坐标映射 | 换模型、识别精度、手数上限 |
| `js/ui.js` | 78 | DOM 引用与界面反馈 | 状态栏、toast、按钮行为 |
| `js/main.js` | 230 | 装配：主循环、启动、事件 | demo 编排、启动流程 |

依赖方向（无环）：

```
config ─→ state ─→ render / ui ─→ particles / hands ─→ effects ─→ main
                                        ↑                │
                                     audio ──────────────┘
```

关键设计：**手势层只报告，不执行**。`hands.js` 在识别到手势时只设置事件标志
（`h.evPinch` / `h.evSnap` / `h.evOpen` / `h.evClose`），
由 `effects.consumeHandEvents()` 统一消费、播放音效、施加冲量。
所以改音效不会碰识别，加特效不会碰物理。

---

## 二、最常调的参数（全部在 `js/config.js`）

**手感（`FIELD`）**
```js
pull: 2.05,        // 握拳时的吸引强度。想更"抓得住"→ 调大（如 2.6）
pullRange: 2.85,   // 张开时的排斥量。想推开更猛 → 调大（如 3.8）
swirlRange: 1.05,  // 张手时的旋涡强度。想转得更疯 → 调大（如 1.8）
```

**粒子密度（`SCALE`）**
```js
nebula: { max: 2600, min: 1200, areaDiv: 760 },
```
`max` 调小更流畅，调大更密。`areaDiv` 越小，大屏给得越多。

**拖尾长短（`THEME.trail`）**
```js
trail: 'rgba(10,7,4,0.168)',
```
`0.168` 调小（如 0.08）→ 拖尾更长更梦幻；调大（如 0.4）→ 干净利落。

**速度上限（`MOTION`）**
```js
maxV: 13,       // 常规速度，调大更狂野
boostV: 44,     // 响指/爆发期间额外放开的上限
```

**配色（`THEME`）**
```js
innerHue: 47,   // 星系核心色相（47 = 金黄）
outerHue: 22,   // 外围色相（22 = 橙红）
```
换成蓝紫星系：`innerHue: 210, outerHue: 290`；
青绿星系：`innerHue: 160, outerHue: 200`（同时把 `SPARK.hue` 里的 44 也顺手改掉更协调）。

---

## 三、想加新功能，钩子在哪

**① 加一种新手势**
1. `hands.js` 的 `feed()` 里算出手势数值，设一个事件标志 `h.evXxx`
2. `effects.js` 的 `consumeHandEvents()` 里消费它（触发音效/特效）
3. 如果要影响力场，在 `particles.js` 的 `updateParticles()` 里用 `h.xxx`

例：比 V 手势 = 食指中指伸直 + 无名指小指拇指弯曲。`feed()` 里已有每根手指的伸展判定，拼一下就行。

**② 加一层新粒子**
参照 `particles.js` 里 `P` / `stars` 的写法建数组，物理放 `update*`，绘制放 `draw*`，在 `main.js` 的 `draw()` 里加一行调用。指尖火星（`effects.js` 的 `sparks`）是最简单的参考样本。

**③ 加音效**
`audio.js` 里已有 `noiseHit` / `toneHit` 两个现成发声单元，`sfx` 对象里加一个方法，两三行就是一个新音效。

**④ 双手互动**
`hands[0]`、`hands[1]` 都有完整状态。比如两手距离近时让中间生成闪电——在 `effects.js` 加一层绘制，读两只手的 `h.x / h.y`。

**⑤ 换识别目标**
`engine.js` 的 `loadEngine()` 改 `modelAssetPath`。MediaPipe 还有姿态（Pose）、人脸（Face）模型，接口几乎一样，换成全身 33 点就能做"整个人站在星空里"。

---

## 四、改完怎么生效

- 本地服务器的黑窗口不用关
- 改完代码，浏览器 `Ctrl + F5` 强制刷新
- ES Module 有缓存，普通刷新（F5）有时不够，**建议习惯用 Ctrl + F5**

## 五、注意

浏览器对摄像头有硬性限制：**必须通过 `http://127.0.0.1:xxxx` 或 https 访问**。
所以本地永远用「双击启动.bat」进，别直接双击 index.html。
