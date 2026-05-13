import './fluid-cover.scss';
import * as THREE from 'three';

// ==========================================
// 默认配置 (与 fluid-cover-shader.html 保持一致)
// ==========================================
export const PSEUDO_FLUID_DEFAULTS = {
	PLAIN_CONTOUR_COUNT: 18,
	HILL_CONTOUR_COUNT: 18,
	MIN_COLOR_RATIO_THRESHOLD: 0.0006,
	ALL_COLORS_PRESENCE_FACTOR: 10.0,
	DARK_COLOR_LIGHTNESS_THRESHOLD: 0.35,
	DARK_COLOR_LIGHTNESS_BOOST: 0.04,
	DARK_COLOR_SATURATION_BOOST: 0.08,
	COLOR_MID_DISTRIBUTION_STRICTNESS: 1.0,
	GLOBAL_SATURATION: 1.65,
	GLOBAL_LIGHTNESS: 0.95,
	PLAIN_AREA_RATIO: 0.52,
	TERRAIN_UNIFORMITY: 0.55,
	CONTOUR_SMOOTHNESS: 0.0005,
	NOISE_SCALE: 0.20,
	TURBULENCE_SPEED: 0.00002,
	DOMAIN_WARPING: 0.36,
	TERRAIN_DEFORMATION_SPEED: 0.003,
	TERRAIN_TRANSLATION_SPEED: 0.003,
	TERRAIN_TRANSLATION_DIR_X: 1.0,
	TERRAIN_TRANSLATION_DIR_Y: 0.5,
	GAUSSIAN_BLUR: 32,
	MOTION_TRAIL: 0.0,
	FWIDTH_AA: 1,
	FBM_OCTAVES: 3,
	FPS: 60,
	RENDER_SCALE: 1.0
};

// ==========================================
// 工具函数：RGB 与 HSL 转换
// ==========================================
function rgbToHsl(r, g, b) {
	r /= 255, g /= 255, b /= 255;
	let max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h, s, l = (max + min) / 2;
	if (max == min) {
		h = s = 0;
	} else {
		let d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}
	return [h, s, l];
}

function hslToRgb(h, s, l) {
	let r, g, b;
	if (s == 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p, q, t) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		let p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}
	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function colorDistanceHSL(hsl1, hsl2) {
	const dh = Math.min(Math.abs(hsl1[0] - hsl2[0]), 1.0 - Math.abs(hsl1[0] - hsl2[0])) * 2.0;
	const ds = hsl1[1] - hsl2[1];
	const dl = hsl1[2] - hsl2[2];
	return Math.sqrt(dh * dh + ds * ds + dl * dl);
}

// ==========================================
// 核心：处理图片并提取高阶色彩
// ==========================================
function processImageAndExtractColors(imgElement, config) {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	ctx.drawImage(imgElement, 0, 0, 128, 128);
	const imgData = ctx.getImageData(0, 0, 128, 128).data;

	const H_BINS = 21, S_BINS = 11, L_BINS = 11;
	const TOTAL_BINS = H_BINS * S_BINS * L_BINS;
	const binCounts = new Uint16Array(TOTAL_BINS);
	const binR = new Float64Array(TOTAL_BINS);
	const binG = new Float64Array(TOTAL_BINS);
	const binB = new Float64Array(TOTAL_BINS);
	let totalPixels = 0;

	for (let i = 0; i < imgData.length; i += 4) {
		if (imgData[i + 3] < 128) continue;
		const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
		const [h, s, l] = rgbToHsl(r, g, b);
		const hBin = Math.round(h * 20);
		const sBin = Math.round(s * 10);
		const lBin = Math.round(l * 10);
		const idx = hBin * (S_BINS * L_BINS) + sBin * L_BINS + lBin;
		binCounts[idx]++;
		binR[idx] += r; binG[idx] += g; binB[idx] += b;
		totalPixels++;
	}

	const thresholdCount = totalPixels * config.MIN_COLOR_RATIO_THRESHOLD;
	let clusters = [];
	for (let idx = 0; idx < TOTAL_BINS; idx++) {
		const cnt = binCounts[idx];
		if (cnt < thresholdCount) continue;
		const avgR = binR[idx] / cnt, avgG = binG[idx] / cnt, avgB = binB[idx] / cnt;
		clusters.push({
			count: cnt,
			r: avgR, g: avgG, b: avgB,
			hsl: rgbToHsl(avgR, avgG, avgB)
		});
	}

	if (clusters.length === 0) {
		let maxIdx = 0, maxCnt = 0;
		for (let idx = 0; idx < TOTAL_BINS; idx++) {
			if (binCounts[idx] > maxCnt) { maxCnt = binCounts[idx]; maxIdx = idx; }
		}
		const cnt = binCounts[maxIdx];
		const avgR = binR[maxIdx] / cnt, avgG = binG[maxIdx] / cnt, avgB = binB[maxIdx] / cnt;
		clusters.push({
			count: cnt,
			r: avgR, g: avgG, b: avgB,
			hsl: rgbToHsl(avgR, avgG, avgB)
		});
	}

	clusters.sort((a, b) => b.count - a.count);

	const aCount = config.PLAIN_CONTOUR_COUNT;
	const bCount = config.HILL_CONTOUR_COUNT;
	const totalCountTarget = aCount + bCount;
	const selectedColors = [];

	for (let i = 0; i < Math.min(aCount, clusters.length); i++) {
		selectedColors.push(clusters[i]);
	}

	const remainingCount = clusters.length - aCount;
	if (remainingCount > 0) {
		const candidates = new Array(remainingCount);
		const minDists = new Float64Array(remainingCount);
		const richnessPenalties = new Float64Array(remainingCount);
		const used = new Uint8Array(remainingCount);

		for (let i = 0; i < remainingCount; i++) {
			candidates[i] = clusters[aCount + i];
			richnessPenalties[i] = Math.abs(candidates[i].hsl[2] - 0.5);
			let minD = Infinity;
			for (let j = 0; j < selectedColors.length; j++) {
				const d = colorDistanceHSL(candidates[i].hsl, selectedColors[j].hsl);
				if (d < minD) minD = d;
			}
			minDists[i] = minD;
		}

		while (selectedColors.length < totalCountTarget) {
			let bestIdx = -1;
			let maxScore = -Infinity;
			for (let i = 0; i < remainingCount; i++) {
				if (used[i]) continue;
				const score = minDists[i] - richnessPenalties[i] * 0.2;
				if (score > maxScore) {
					maxScore = score;
					bestIdx = i;
				}
			}
			if (bestIdx === -1) break;
			used[bestIdx] = 1;
			selectedColors.push(candidates[bestIdx]);
			const newHsl = candidates[bestIdx].hsl;
			for (let i = 0; i < remainingCount; i++) {
				if (used[i]) continue;
				const d = colorDistanceHSL(candidates[i].hsl, newHsl);
				if (d < minDists[i]) minDists[i] = d;
			}
		}
	}

	const totalSelectedPixels = selectedColors.reduce((sum, c) => sum + c.count, 0);
	const scoredColors = selectedColors.map(c => {
		const [h, s, l] = c.hsl;
		const dominance = c.count / totalSelectedPixels;
		const richness = s * (1.0 - Math.abs(l - 0.4) * 2.0);
		const isExtreme = (l < 0.12 || l > 0.88) ? 1 : 0;
		let priority = (dominance * 10.0) + (richness * 2.0) - (isExtreme * 1000.0);
		return { ...c, priority, dominance };
	});

	scoredColors.sort((a, b) => b.priority - a.priority);

	const MAPPING_RESOLUTION = 2048;
	const finalSortedColors = new Array(MAPPING_RESOLUTION);

	let blocks = scoredColors.map(c => {
		let width = Math.max(1, Math.round(c.dominance * MAPPING_RESOLUTION));
		let [h, s, l] = c.hsl;
		if (l < config.DARK_COLOR_LIGHTNESS_THRESHOLD) {
			l += config.DARK_COLOR_LIGHTNESS_BOOST;
			s += config.DARK_COLOR_SATURATION_BOOST;
		}
		s = Math.min(1.0, Math.max(0.0, s * config.GLOBAL_SATURATION));
		l = Math.min(1.0, Math.max(0.0, l * config.GLOBAL_LIGHTNESS));
		return { rgb: hslToRgb(h, s, l), width: width };
	});

	let currentTotalWidth = blocks.reduce((sum, b) => sum + b.width, 0);
	if (currentTotalWidth !== MAPPING_RESOLUTION && blocks.length > 0) {
		blocks[0].width += (MAPPING_RESOLUTION - currentTotalWidth);
	}

	let leftBoundary = Math.floor(MAPPING_RESOLUTION / 2);
	let rightBoundary = leftBoundary;

	for (let i = 0; i < blocks.length; i++) {
		let b = blocks[i];
		if (i % 2 === 0) {
			let start = Math.max(0, leftBoundary - b.width);
			for (let j = start; j < leftBoundary; j++) finalSortedColors[j] = b.rgb;
			leftBoundary = start;
		} else {
			let end = Math.min(MAPPING_RESOLUTION, rightBoundary + b.width);
			for (let j = rightBoundary; j < end; j++) finalSortedColors[j] = b.rgb;
			rightBoundary = end;
		}
	}

	const fallbackRgb = blocks[0].rgb;
	let lastValid = fallbackRgb;
	for (let i = 0; i < MAPPING_RESOLUTION; i++) {
		if (!finalSortedColors[i]) {
			finalSortedColors[i] = lastValid;
		} else {
			lastValid = finalSortedColors[i];
		}
	}

	return finalSortedColors;
}

// ==========================================
// PseudoFluidCover 类
// ==========================================
export class PseudoFluidCover {
	constructor(container, config = {}) {
		this.container = container;
		this.config = { ...PSEUDO_FLUID_DEFAULTS, ...config };
		this.scene = null;
		this.camera = null;
		this.renderer = null;
		this.material = null;
		this.lastTime = 0;
		this.animationId = null;
		this.isPaused = false;
		this.isDisposed = false;
		this.hiddenCanvas = null;
		this._currentUrl = '';
		this._frameAccum = 0;
		this._targetInterval = 1000 / this.config.FPS;
		// 预绑定函数引用，避免每帧创建箭头函数产生 GC 压力
		this._boundAnimate = this._animate.bind(this);
		this._boundResize = this._handleResize.bind(this);
	}

	async init(imageUrl) {
		if (this.isDisposed) return;

		this._currentUrl = imageUrl;
		this.hiddenCanvas = document.createElement('canvas');
		this.hiddenCanvas.width = 128;
		this.hiddenCanvas.height = 128;
		this.hiddenCanvas.style.display = 'none';
		this.container.appendChild(this.hiddenCanvas);

		// 通过 backdrop-filter 模糊层应用高斯模糊，避免 filter 的黑边裁剪问题
		const blurLayer = this.container.parentElement?.querySelector('.rnp-pseudo-fluid-blur-layer');
		if (blurLayer) {
			blurLayer.style.backdropFilter = `blur(${this.config.GAUSSIAN_BLUR}px)`;
		}

		const img = new Image();
		img.crossOrigin = 'Anonymous';
		img.onload = () => {
			if (this.isDisposed) return;
			const extractedColors = processImageAndExtractColors(img, this.config);
			this._initThreeJS(extractedColors);
		};
		img.onerror = () => {
			if (this.isDisposed) return;
			console.error('[PseudoFluidCover] 图片加载失败，使用默认颜色');
			const fallbackColors = Array.from({ length: 36 }, () => [
				Math.random() * 255, Math.random() * 255, Math.random() * 255
			]);
			this._initThreeJS(fallbackColors);
		};
		img.src = imageUrl;
	}

	async updateImage(imageUrl, force = false) {
		if (this.isDisposed || (!force && this._currentUrl === imageUrl)) return;
		this._currentUrl = imageUrl;

		const img = new Image();
		img.crossOrigin = 'Anonymous';
		img.onload = () => {
			if (this.isDisposed) return;
			// 将颜色提取推迟到浏览器空闲时执行，避免阻塞当前帧导致流体卡顿
			const doExtract = () => {
				if (this.isDisposed) return;
				const extractedColors = processImageAndExtractColors(img, this.config);
				this._updateColorPalette(extractedColors);
			};
			if (typeof requestIdleCallback === 'function') {
				requestIdleCallback(doExtract, { timeout: 200 });
			} else {
				setTimeout(doExtract, 0);
			}
		};
		img.onerror = () => {
			if (this.isDisposed) return;
			console.error('[PseudoFluidCover] 图片加载失败');
		};
		img.src = imageUrl;
	}

	_initThreeJS(colorsArr) {
		if (this.isDisposed) return;

		// 清除旧渲染器
		if (this.renderer) {
			this.renderer.dispose();
			const oldCanvas = this.container.querySelector('canvas:not([style*="display: none"])');
			if (oldCanvas) oldCanvas.remove();
		}

		const containerWidth = this.container.clientWidth;
		const containerHeight = this.container.clientHeight;

		this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
		this.renderer.setSize(containerWidth, containerHeight);
		this.renderer.setPixelRatio(this.config.RENDER_SCALE);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.autoClear = false;
		this.container.appendChild(this.renderer.domElement);

		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
		this.scene = new THREE.Scene();

		const colorData = new Uint8Array(colorsArr.length * 4);
		for (let i = 0; i < colorsArr.length; i++) {
			colorData[i * 4 + 0] = colorsArr[i][0];
			colorData[i * 4 + 1] = colorsArr[i][1];
			colorData[i * 4 + 2] = colorsArr[i][2];
			colorData[i * 4 + 3] = 255;
		}
		const colorTexture = new THREE.DataTexture(colorData, colorsArr.length, 1, THREE.RGBAFormat);
		colorTexture.needsUpdate = true;
		colorTexture.magFilter = THREE.LinearFilter;
		colorTexture.minFilter = THREE.LinearFilter;

		const randomSeed = Math.random() * 50.0;

		this.material = new THREE.ShaderMaterial({
			transparent: true,
			depthTest: false,
			depthWrite: false,
			uniforms: {
				u_time: { value: 0.0 },
				u_colorPalette: { value: colorTexture },
				u_allColorsPresence: { value: this.config.ALL_COLORS_PRESENCE_FACTOR },
				u_noiseScale: { value: this.config.NOISE_SCALE },
				u_turbulenceSpeed: { value: this.config.TURBULENCE_SPEED },
				u_domainWarping: { value: this.config.DOMAIN_WARPING },
				u_terrainUniformity: { value: this.config.TERRAIN_UNIFORMITY },
				u_smoothness: { value: this.config.CONTOUR_SMOOTHNESS },
				u_randomSeed: { value: randomSeed },
				u_translationSpeed: { value: this.config.TERRAIN_TRANSLATION_SPEED },
				u_translationDir: { value: new THREE.Vector2(this.config.TERRAIN_TRANSLATION_DIR_X, this.config.TERRAIN_TRANSLATION_DIR_Y).normalize() },
				u_deformationSpeed: { value: this.config.TERRAIN_DEFORMATION_SPEED },
				u_resolution: { value: new THREE.Vector2(containerWidth, containerHeight) },
				u_blendAlpha: { value: 1.0 },
				u_fwidthAA: { value: this.config.FWIDTH_AA ? 1.0 : 0.0 },
				u_fbmOctaves: { value: this.config.FBM_OCTAVES }
			},
			vertexShader: `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position, 1.0);
				}
			`,
			fragmentShader: `
				uniform float u_time;
				uniform sampler2D u_colorPalette;
				uniform float u_allColorsPresence;
				uniform float u_noiseScale;
				uniform float u_turbulenceSpeed;
				uniform float u_domainWarping;
				uniform float u_terrainUniformity;
				uniform float u_smoothness;
				uniform float u_randomSeed;
				uniform float u_translationSpeed;
				uniform vec2 u_translationDir;
				uniform float u_deformationSpeed;
				uniform vec2 u_resolution;
				uniform float u_blendAlpha;
				uniform float u_fwidthAA;
				uniform int u_fbmOctaves;

				varying vec2 vUv;

				vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
				vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
				vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
				vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

				float snoise(vec3 v) {
					const vec2  C = vec2(1.0/6.0, 1.0/3.0);
					const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
					vec3 i  = floor(v + dot(v, C.yyy));
					vec3 x0 = v - i + dot(i, C.xxx);
					vec3 g = step(x0.yzx, x0.xyz);
					vec3 l = 1.0 - g;
					vec3 i1 = min(g.xyz, l.zxy);
					vec3 i2 = max(g.xyz, l.zxy);
					vec3 x1 = x0 - i1 + C.xxx;
					vec3 x2 = x0 - i2 + C.yyy;
					vec3 x3 = x0 - D.yyy;
					i = mod289(i);
					vec4 p = permute(permute(permute(
								i.z + vec4(0.0, i1.z, i2.z, 1.0))
								+ i.y + vec4(0.0, i1.y, i2.y, 1.0))
								+ i.x + vec4(0.0, i1.x, i2.x, 1.0));
					float n_ = 0.142857142857;
					vec3  ns = n_ * D.wyz - D.xzx;
					vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
					vec4 x_ = floor(j * ns.z);
					vec4 y_ = floor(j - 7.0 * x_);
					vec4 x = x_ *ns.x + ns.yyyy;
					vec4 y = y_ *ns.x + ns.yyyy;
					vec4 h = 1.0 - abs(x) - abs(y);
					vec4 b0 = vec4(x.xy, y.xy);
					vec4 b1 = vec4(x.zw, y.zw);
					vec4 s0 = floor(b0)*2.0 + 1.0;
					vec4 s1 = floor(b1)*2.0 + 1.0;
					vec4 sh = -step(h, vec4(0.0));
					vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
					vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
					vec3 p0 = vec3(a0.xy,h.x);
					vec3 p1 = vec3(a0.zw,h.y);
					vec3 p2 = vec3(a1.xy,h.z);
					vec3 p3 = vec3(a1.zw,h.w);
					vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
					p0 *= norm.x;
					p1 *= norm.y;
					p2 *= norm.z;
					p3 *= norm.w;
					vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
					m = m * m;
					return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
				}

				float fbm(vec3 p) {
					float v = 0.0;
					float a = 0.5;
					vec3 shift = vec3(100.0);
					for (int i = 0; i < 6; ++i) {
						if (i >= u_fbmOctaves) break;
						v += a * snoise(p);
						p = p * 2.0 + shift;
						a *= 0.5;
					}
					return v;
				}

				void main() {
					vec2 st = vUv;
					st.x *= u_resolution.x / u_resolution.y;

					vec2 baseP = st * u_noiseScale + u_translationDir * (u_time * u_translationSpeed) + vec2(u_randomSeed);

					vec3 p1 = vec3(baseP, u_time * u_deformationSpeed);
					float qx = fbm(p1 + vec3(0.0, 0.0, u_time * u_turbulenceSpeed));
					float qy = fbm(p1 + vec3(5.2, 1.3, u_time * u_turbulenceSpeed));
					vec3 q = vec3(qx, qy, 0.0);

					vec3 p2 = vec3(baseP, u_time * u_deformationSpeed * 1.2);
					float rx = fbm(p2 + u_domainWarping * q + vec3(1.7, 9.2, 0.1));
					float ry = fbm(p2 + u_domainWarping * q + vec3(8.3, 2.8, 0.2));
					vec3 r = vec3(rx, ry, 0.0);

					float rawH = fbm(vec3(baseP, u_time * u_deformationSpeed * 0.8) + u_domainWarping * r);
					float h = fract(rawH * u_allColorsPresence * 0.5 + 0.5);

					float centered = 2.0 * h - 1.0;
					float sCurved = 0.5 + 0.5 * pow(abs(centered), u_terrainUniformity) * sign(centered);
					float smoothed = smoothstep(-0.1, 1.1, sCurved);
					h = mix(sCurved, smoothed, u_smoothness);

					// fwidth 抗锯齿：通过屏幕空间梯度多采样混合，消除等高线边缘色彩跳变
					vec4 finalColor;
					if (u_fwidthAA > 0.5) {
						float dh = fwidth(h) * 0.5;
						vec4 c0 = texture2D(u_colorPalette, vec2(h, 0.5));
						vec4 c1 = texture2D(u_colorPalette, vec2(h - dh, 0.5));
						vec4 c2 = texture2D(u_colorPalette, vec2(h + dh, 0.5));
						finalColor = (c0 * 2.0 + c1 + c2) * 0.25;
					} else {
						finalColor = texture2D(u_colorPalette, vec2(h, 0.5));
					}
					gl_FragColor = vec4(finalColor.rgb, u_blendAlpha);
				}
			`
		});

		const geometry = new THREE.PlaneGeometry(2, 2);
		const mesh = new THREE.Mesh(geometry, this.material);
		mesh.renderOrder = 1;
		this.scene.add(mesh);

		// 运动拖影：半透明覆盖层，每帧先画此层衰减旧画面，再画流体叠加
		this.fadeMaterial = new THREE.MeshBasicMaterial({
			color: 0x000000,
			transparent: true,
			opacity: 0.0, // 0 = 无拖影，由 MOTION_TRAIL 控制
			depthTest: false,
			depthWrite: false
		});
		const fadeGeometry = new THREE.PlaneGeometry(2, 2);
		this.fadeMesh = new THREE.Mesh(fadeGeometry, this.fadeMaterial);
		this.fadeMesh.renderOrder = 0; // 先于流体渲染
		this.scene.add(this.fadeMesh);
		this._updateTrailOpacity();

		window.addEventListener('resize', this._boundResize);

		// 用 rAF 的 timestamp 参数初始化 lastTime，避免首帧 delta 跳变
		this.lastTime = 0;
		this._frameAccum = 0;
		this.animationId = requestAnimationFrame(this._boundAnimate);
	}

	_handleResize() {
		if (this.isDisposed || !this.renderer) return;
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		this.renderer.setSize(w, h);
		this.renderer.setPixelRatio(this.config.RENDER_SCALE);
		this.material.uniforms.u_resolution.value.set(w, h);
	}

	_updateTrailOpacity() {
		if (!this.fadeMaterial || !this.material) return;
		const trail = this.config.MOTION_TRAIL;
		if (trail <= 0) {
			// 无拖影
			this.fadeMesh.visible = false;
			this.renderer.autoClear = true;
			this.material.uniforms.u_blendAlpha.value = 1.0;
		} else {
			this.fadeMesh.visible = true;
			this.renderer.autoClear = false;
			// trail 0→1：衰减层 opacity 从 0.5（快速衰减）→ 0.01（慢速衰减）
			this.fadeMaterial.opacity = 0.5 * Math.pow(0.02, trail);
			// 流体层混合 alpha：trail 越大，新帧越半透明，与旧帧混合越多
			// trail 0→1：alpha 从 1.0 → 0.15
			this.material.uniforms.u_blendAlpha.value = 1.0 - trail * 0.85;
		}
	}

	_updateColorPalette(colorsArr) {
		if (this.isDisposed || !this.material) return;
		const texture = this.material.uniforms.u_colorPalette.value;
		// 复用已有纹理对象，仅更新像素数据，避免重建纹理的 GPU 上传开销
		if (texture && texture.image && texture.image.data.length === colorsArr.length * 4) {
			const data = texture.image.data;
			for (let i = 0; i < colorsArr.length; i++) {
				data[i * 4 + 0] = colorsArr[i][0];
				data[i * 4 + 1] = colorsArr[i][1];
				data[i * 4 + 2] = colorsArr[i][2];
				data[i * 4 + 3] = 255;
			}
			texture.needsUpdate = true;
		} else {
			// 首次或尺寸变化时才创建新纹理
			const oldTexture = texture;
			const colorData = new Uint8Array(colorsArr.length * 4);
			for (let i = 0; i < colorsArr.length; i++) {
				colorData[i * 4 + 0] = colorsArr[i][0];
				colorData[i * 4 + 1] = colorsArr[i][1];
				colorData[i * 4 + 2] = colorsArr[i][2];
				colorData[i * 4 + 3] = 255;
			}
			const colorTexture = new THREE.DataTexture(colorData, colorsArr.length, 1, THREE.RGBAFormat);
			colorTexture.needsUpdate = true;
			colorTexture.magFilter = THREE.LinearFilter;
			colorTexture.minFilter = THREE.LinearFilter;
			this.material.uniforms.u_colorPalette.value = colorTexture;
			if (oldTexture && oldTexture !== colorTexture) oldTexture.dispose();
		}
		// 切歌时重置流体位置和时间
		this.material.uniforms.u_randomSeed.value = Math.random() * 50.0;
		this.material.uniforms.u_time.value = 0.0;
	}

	updateConfig(newConfig) {
		Object.assign(this.config, newConfig);
		if (this.isDisposed || !this.material) return;

		if ('FPS' in newConfig)
			this._targetInterval = 1000 / this.config.FPS;

		if ('ALL_COLORS_PRESENCE_FACTOR' in newConfig)
			this.material.uniforms.u_allColorsPresence.value = this.config.ALL_COLORS_PRESENCE_FACTOR;
		if ('NOISE_SCALE' in newConfig)
			this.material.uniforms.u_noiseScale.value = this.config.NOISE_SCALE;
		if ('TURBULENCE_SPEED' in newConfig)
			this.material.uniforms.u_turbulenceSpeed.value = this.config.TURBULENCE_SPEED;
		if ('DOMAIN_WARPING' in newConfig)
			this.material.uniforms.u_domainWarping.value = this.config.DOMAIN_WARPING;
		if ('TERRAIN_UNIFORMITY' in newConfig)
			this.material.uniforms.u_terrainUniformity.value = this.config.TERRAIN_UNIFORMITY;
		if ('CONTOUR_SMOOTHNESS' in newConfig)
			this.material.uniforms.u_smoothness.value = this.config.CONTOUR_SMOOTHNESS;
		if ('TERRAIN_TRANSLATION_SPEED' in newConfig)
			this.material.uniforms.u_translationSpeed.value = this.config.TERRAIN_TRANSLATION_SPEED;
		if ('TERRAIN_DEFORMATION_SPEED' in newConfig)
			this.material.uniforms.u_deformationSpeed.value = this.config.TERRAIN_DEFORMATION_SPEED;
		if ('TERRAIN_TRANSLATION_DIR_X' in newConfig || 'TERRAIN_TRANSLATION_DIR_Y' in newConfig)
			this.material.uniforms.u_translationDir.value.set(
				this.config.TERRAIN_TRANSLATION_DIR_X, this.config.TERRAIN_TRANSLATION_DIR_Y
			).normalize();
		if ('GAUSSIAN_BLUR' in newConfig) {
			const blurLayer = this.container.parentElement?.querySelector('.rnp-pseudo-fluid-blur-layer');
			if (blurLayer) {
				blurLayer.style.backdropFilter = `blur(${this.config.GAUSSIAN_BLUR}px)`;
			}
		}
		if ('RENDER_SCALE' in newConfig && this.renderer)
			this.renderer.setPixelRatio(this.config.RENDER_SCALE);
		if ('MOTION_TRAIL' in newConfig)
			this._updateTrailOpacity();
		if ('FWIDTH_AA' in newConfig)
			this.material.uniforms.u_fwidthAA.value = this.config.FWIDTH_AA ? 1.0 : 0.0;
		if ('FBM_OCTAVES' in newConfig)
			this.material.uniforms.u_fbmOctaves.value = this.config.FBM_OCTAVES;

		// 需要重新处理图片的参数 — 触发颜色重提取
		if ('PLAIN_CONTOUR_COUNT' in newConfig || 'HILL_CONTOUR_COUNT' in newConfig ||
			'MIN_COLOR_RATIO_THRESHOLD' in newConfig || 'DARK_COLOR_LIGHTNESS_THRESHOLD' in newConfig ||
			'DARK_COLOR_LIGHTNESS_BOOST' in newConfig || 'DARK_COLOR_SATURATION_BOOST' in newConfig ||
			'GLOBAL_SATURATION' in newConfig || 'GLOBAL_LIGHTNESS' in newConfig) {
			if (this._currentUrl) {
				this.updateImage(this._currentUrl, true);
			}
		}
	}

	_animate(timestamp) {
		if (this.isDisposed) return;
		this.animationId = requestAnimationFrame(this._boundAnimate);

		if (this.isPaused || !this.material || !this.scene || !this.camera) return;

		// 使用 rAF 自带的 timestamp 而非 performance.now()，减少系统调用
		if (this.lastTime === 0) {
			this.lastTime = timestamp;
			return;
		}
		const elapsed = Math.min(timestamp - this.lastTime, 100);
		this.lastTime = timestamp;

		// 始终以真实时间更新 u_time，保证流体运动绝对平滑（无论是否跳帧渲染）
		this.material.uniforms.u_time.value += elapsed * 0.001;

		// 帧率节流：使用整除取模方式避免 45fps 与 60Hz 不整除导致的节拍漂移
		this._frameAccum += elapsed;
		if (this._frameAccum >= this._targetInterval) {
			// 丢弃超出部分而非保留余数，防止连续补偿渲染造成的抖动
			this._frameAccum %= this._targetInterval;
			this.renderer.render(this.scene, this.camera);
		}
	}

	setPaused(paused) {
		this.isPaused = paused;
		if (!paused) {
			// 设为 0 让 _animate 用 rAF timestamp 重新校准，避免恢复时巨大 delta 跳变
			this.lastTime = 0;
			this._frameAccum = 0;
		}
	}

	dispose() {
		this.isDisposed = true;
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}
		if (this._boundResize) {
			window.removeEventListener('resize', this._boundResize);
		}
		// 立即隐藏画布，视觉上即时响应
		if (this.renderer && this.renderer.domElement) {
			this.renderer.domElement.style.display = 'none';
		}
		// 延迟释放 GPU 资源，避免同步 dispose 造成的掉帧
		const renderer = this.renderer;
		const material = this.material;
		const fadeMaterial = this.fadeMaterial;
		const scene = this.scene;
		const container = this.container;
		this.renderer = null;
		this.material = null;
		this.fadeMaterial = null;
		this.fadeMesh = null;
		this.scene = null;

		const cleanup = () => {
			if (renderer) renderer.dispose();
			if (material) material.dispose();
			if (fadeMaterial) fadeMaterial.dispose();
			if (scene) scene.clear();
			// 清空容器
			while (container.firstChild) {
				container.removeChild(container.firstChild);
			}
		};
		if (typeof requestIdleCallback === 'function') {
			requestIdleCallback(cleanup, { timeout: 500 });
		} else {
			setTimeout(cleanup, 0);
		}
	}
}
