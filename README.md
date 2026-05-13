# Refined Now Playing

一个美化网易云音乐播放界面的 [BetterNCM](https://github.com/MicroCBer/BetterNCM) 插件

增加了全新的伪流体效果，降低 50% 以上的 GPU 占用。

## 已知问题

该伪流体在 C++ & CEF 编写的旧版本网易云上会比较频繁地触发内存的 GC，每次 GC 的时候 JS 主线程会短暂卡死，导致流体卡住十几毫秒。受限于老版本网易云和 BetterNCM 的架构，该问题可能无法修复。

## 安装

0. 安装 [BetterNCM](https://github.com/MicroCBer/BetterNCM) 插件
1. 在插件商店中安装

## 效果

https://github.com/user-attachments/assets/54809976-c293-4ac2-9512-95077c4681d6

___

## 说明文档

下面是关于该伪流体实现的文档。

### 一、概述

伪流体背景（PseudoFluidCover）是 RNP 插件的一种背景渲染模式。它从专辑封面提取色彩，通过 WebGL（Three.js）在 GPU 上实时生成类似等高线地形图的流动色彩效果。

**核心思路**：封面 → 色彩提取 → 1D 色板纹理 → Simplex 噪声 + FBM + 域扭曲 → 地形高度 → 色板采样 → 流体画面。

### 二、架构与数据流


```
专辑封面图片
    │
    ▼
processImageAndExtractColors()     ← 色彩提取（CPU，canvas 2D）
    │  128×128 缩略图 → HSL 三维直方图分箱
    │  → 聚类筛选 → 优先级排序 → 展开为 2048 元素色板
    ▼
_initThreeJS()                      ← 初始化 Three.js 渲染管线
    │  色板 → DataTexture（1D，2048×1）
    │  创建 ShaderMaterial + PlaneGeometry
    │  启动 requestAnimationFrame 循环
    ▼
_animate()                          ← 每帧更新（rAF）
    │  更新 u_time → 节流到目标 FPS → render()
    ▼
Fragment Shader                     ← GPU 端（GLSL）
    噪声计算 → 域扭曲 → 高度映射 → 色板查色 → 输出
```

当切歌时，`updateImage()` → `_updateColorPalette()` 只更新色板纹理数据，不重建整个渲染管线。

### 三、色彩提取算法详解

#### 3.1 缩略图采样

将封面图片绘制到 128×128 的离屏 canvas 上，读取 RGBA 像素数据。忽略 alpha < 128 的半透明像素。

#### 3.2 HSL 三维直方图分箱

将每个像素的 RGB 转为 HSL，按 21×11×11 的粒度分箱：

| 维度 | 箱数 | 步长 |
|------|------|------|
| 色相 H | 21 | 1/20 |
| 饱和度 S | 11 | 1/10 |
| 明度 L | 11 | 1/10 |

共 `21×11×11 = 2541` 个箱子。每个箱子累加像素计数和 RGB 分量和。

#### 3.3 聚类筛选

筛掉像素占比低于 `MIN_COLOR_RATIO_THRESHOLD` 的箱子。对每个有效箱子计算平均 RGB 和平均 HSL，形成一个颜色聚类。按计数值降序排列。

#### 3.4 颜色选取策略（平原 + 山丘）

选取分两阶段，总数 = `PLAIN_CONTOUR_COUNT` + `HILL_CONTOUR_COUNT`：

1. **平原色（Plain）**：直接取计数最多的前 N 个颜色，代表封面中最主要的色调
2. **山丘色（Hill）**：从剩余候选中，贪心选取与已选颜色 HSL 距离最远的颜色（带轻度"丰富度惩罚"——偏向于中间明度的颜色），确保最终色板覆盖更广的色调范围

#### 3.5 优先级排序

每个颜色计算优先级分数：

```
priority = dominance × 10 + richness × 2 - isExtreme × 1000
```

- **dominance**：像素占比（该颜色像素数 / 所有选中颜色总像素）
- **richness**：`saturation × (1 - |lightness - 0.4| × 2)`，偏好中高明度、高饱和的颜色
- **isExtreme**：明度 < 0.12 或 > 0.88 的极端颜色被大幅降权（×1000 惩罚）

#### 3.6 色板展开（Interleaving）

将排序后的颜色按占比映射到 2048 个槽位。采用**中心交替展开**策略：第 0 个颜色向右展开，第 1 个向左展开，交错进行。这样做的好处是相邻颜色在色板上不会突变，shader 中相邻高度值映射到相近颜色。

#### 3.7 色彩增强

展开后对每个颜色应用：

- **暗色提亮**：明度 < `DARK_COLOR_LIGHTNESS_THRESHOLD` 的颜色，明度 +`DARK_COLOR_LIGHTNESS_BOOST`，饱和度 +`DARK_COLOR_SATURATION_BOOST`
- **全局饱和度**：× `GLOBAL_SATURATION`（1.65 默认，即增强 65%）
- **全局明度**：× `GLOBAL_LIGHTNESS`（0.95 默认，即略微压暗）

### 四、Shader 渲染管线

#### 4.1 噪声函数

使用经典 3D Simplex 噪声（Ashima Arts 实现），通过 FBM（Fractal Brownian Motion）叠加多层噪声：

```glsl
fbm(p) = Σ 0.5^i × snoise(p × 2^i + shift)
```

`FBM_OCTAVES` 控制叠加层数（1-6），每层频率翻倍、振幅减半。

#### 4.2 域扭曲（Domain Warping）

两阶段域扭曲，产生有机的流体感：

```
q = (fbm(p + turbulence), fbm(p + offset + turbulence), 0)
r = (fbm(p' + domainWarping × q + offset₁), fbm(p' + domainWarping × q + offset₂), 0)
height = fbm(p'' + domainWarping × r)
```

- `DOMAIN_WARPING` 越大，扭曲越强，形状越碎
- `TURBULENCE_SPEED` 控制第一层扭曲的变化速度

#### 4.3 高度映射

```
h = fract(rawHeight × allColorsPresence × 0.5 + 0.5)
```

- `ALL_COLORS_PRESENCE_FACTOR`：高度循环倍数。值越大，同一画面区域出现的颜色种类越多（色板被"压缩"更多次）

#### 4.4 地形重塑

```glsl
centered = 2h - 1                    // 映射到 [-1, 1]
sCurved  = 0.5 + 0.5 × |centered|^uniformity × sign(centered)
smoothed = smoothstep(-0.1, 1.1, sCurved)
h = mix(sCurved, smoothed, smoothness)
```

- `TERRAIN_UNIFORMITY`：幂指数。>1 时中间值被压向两端（高原/深谷更分明），<1 时趋向均匀
- `CONTOUR_SMOOTHNESS`：混合原始曲线和平滑版本的权重，越高过渡越柔和

#### 4.5 抗锯齿（fwidth）

```glsl
dh = fwidth(h) × 0.5
finalColor = (sample(h) × 2 + sample(h-dh) + sample(h+dh)) / 4
```

`FWIDTH_AA` 控制是否启用。通过屏幕空间梯度多采样混合，消除等高线边缘的色彩跳变。

#### 4.6 运动拖影（Motion Trail）

每帧先绘制一个半透明黑色覆盖层衰减旧画面，再叠加新流体帧：

- `MOTION_TRAIL = 0`：无拖影，直接覆盖
- `MOTION_TRAIL → 1`：衰减层透明度 0.5→0.01，流体层 alpha 1.0→0.15，产生越来越强的帧残留效果

### 五、参数完整参考

#### 色彩选取参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `PLAIN_CONTOUR_COUNT` | 18 | 1-64 | 平原等高线数：按频率选取的主导色数量 |
| `HILL_CONTOUR_COUNT` | 32 | 1-64 | 山丘等高线数：按多样性选取的补充色数量 |
| `MIN_COLOR_RATIO_THRESHOLD` | 0.0001 | 0.0001–0.01 | 杂色过滤阈值：低于此占比的颜色箱被丢弃。越低=越多稀有颜色被保留 |
| `COLOR_MID_DISTRIBUTION_STRICTNESS` | 1.0 | 0.01–1.0 | 色彩中段分布严格度（当前未在代码中使用） |

#### 色彩增强参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `DARK_COLOR_LIGHTNESS_THRESHOLD` | 0.35 | 0–1 | 暗色判定阈值：明度低于此值触发暗色增强 |
| `DARK_COLOR_LIGHTNESS_BOOST` | 0.04 | 0–0.2 | 暗色明度提升量：防止暗色在流体中过黑 |
| `DARK_COLOR_SATURATION_BOOST` | 0.08 | 0–0.3 | 暗色饱和度提升量：让暗色更鲜活 |
| `GLOBAL_SATURATION` | 1.65 | 0.1–3.0 | 全局饱和度倍率：>1 更鲜艳，<1 更灰 |
| `GLOBAL_LIGHTNESS` | 0.95 | 0.1–2.0 | 全局明度倍率：>1 更亮，<1 更暗 |

#### 地形参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `PLAIN_AREA_RATIO` | 0.52 | 0.01–1.0 | 平原面积偏好（当前未在 shader 中使用） |
| `TERRAIN_UNIFORMITY` | 0.55 | 0.01–2.0 | 地形均匀度：幂指数重塑高度分布。越高=高原/深谷越分明，越低=过渡越平缓 |
| `CONTOUR_SMOOTHNESS` | 0.0005 | 0–0.1 | 等高线平滑度：混合 smoothstep 的程度，越高颜色过渡越柔和 |
| `ALL_COLORS_PRESENCE_FACTOR` | 10.0 | 2.0–20.0 | 全色彩呈现系数：色板在画面中循环的次数。越高=同一区域更多颜色交替 |

#### 噪声与动画参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `NOISE_SCALE` | 0.20 | 0.01–2.0 | 噪声缩放：值越小=色块越大，值越大=纹理越细碎 |
| `TURBULENCE_SPEED` | 0.00002 | 0.0000025–0.25 | 湍流速度：内层噪声变化的快慢 |
| `DOMAIN_WARPING` | 0.36 | 0.01–2.0 | 域扭曲程度：噪声坐标被自身扰动的大小。越高=形状越扭曲破碎 |
| `TERRAIN_DEFORMATION_SPEED` | 0.003 | 0.0001–0.01 | 地形变形速度：Z 轴（时间维）噪声变化的快慢 |
| `TERRAIN_TRANSLATION_SPEED` | 0.003 | 0.0001–0.01 | 地形平移速度：噪声整体漂移的快慢 |
| `TERRAIN_TRANSLATION_DIR_X` | 1.0 | -1.0–1.0 | 平移方向 X 分量（归一化前） |
| `TERRAIN_TRANSLATION_DIR_Y` | 0.5 | -1.0–1.0 | 平移方向 Y 分量（归一化前） |

#### 渲染质量参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| `FPS` | 60 | 30/45/60/90/120 | 目标帧率上限。越低 GPU 负载越小，但动画更不流畅 |
| `RENDER_SCALE` | 1.0 | 0.25–1.0 | 渲染分辨率缩放：1.0 = 原生分辨率，0.5 = 半分辨率（性能提升明显） |
| `GAUSSIAN_BLUR` | 32 | 0–90 | 高斯模糊半径（px）：通过 CSS backdrop-filter 实现。0 = 不模糊 |
| `MOTION_TRAIL` | 0.0 | 0.0–1.0 | 运动拖影强度：帧残留效果。0 = 无拖影，1 = 最强拖影 |
| `FWIDTH_AA` | 1 | 0/1 | fwidth 抗锯齿开关：1 = 启用边缘多采样抗色带 |
| `FBM_OCTAVES` | 3 | 1–6 | FBM 噪声精度（倍频程数）：每级 +5 次噪声计算。越高越细腻，GPU 开销越大 |


### 六、性能考量

目前已知的缺点为，该伪流体在 C++ & CEF 编写的旧版本网易云上会比较频繁地触发内存的 GC，每次 GC 的时候 JS 主线程会短暂卡死，导致流体卡住十几毫秒。我尝试多次修复发现可能受限于老版本网易云的架构，这一问题无法修复，因为引入了较大的 three.js 库。但我想 SPlayer 采用了更新的 Electron 架构，也许这个问题就不会存在了。

## 结语

最后，我再次衷心感谢 SPlayer 的开发者。由于该文件为自用，且本人能力有限、信心不足，恐怕难以长期维护，因此本人

