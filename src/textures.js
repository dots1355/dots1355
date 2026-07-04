// 程序化 PBR 贴图生成:颜色贴图 + 由高度场推导的法线贴图,零外部资源
// 支持 AI 素材覆盖:把 AI 生成的无缝贴图放进 assets/ai/<名字>.jpg|png,
// 游戏启动时自动加载并替换对应的程序化贴图(法线贴图由图像亮度自动推导)。
import * as THREE from 'three';

const AI_NAMES = ['grass', 'dirt', 'stone', 'roof', 'plaster', 'wood', 'cobble'];
const aiImages = {};

export async function preloadAIAssets() {
  await Promise.all(AI_NAMES.map(async (n) => {
    for (const ext of ['jpg', 'png', 'webp']) {
      try {
        const res = await fetch(`./assets/ai/${n}.${ext}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        aiImages[n] = await createImageBitmap(blob);
        return;
      } catch { /* 不存在则回退程序化贴图 */ }
    }
  }));
  return Object.keys(aiImages);
}

// 用 AI 图像构建贴图对:颜色图 + 亮度推导的法线图
function texFromImage(img, repeat, normalStrength = 2) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  heightBuf = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    heightBuf[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  const map = new THREE.CanvasTexture(c);
  const normalMap = new THREE.CanvasTexture(normalFrom(size, normalStrength));
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  heightBuf = null;
  return { map, normalMap };
}

// 简易值噪声(带插值,多八度)
function makeNoise(seed = 1) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const grid = [];
  const N = 64;
  for (let i = 0; i < N * N; i++) grid.push(rand());
  const at = (x, y) => grid[((y % N) + N) % N * N + (((x % N) + N) % N)];
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  return (x, y, octaves = 4) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) { v += noise2(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    return v;
  };
}

function canvasOf(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b, h] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      heightBuf[y * size + x] = h;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

let heightBuf = null;

// 由高度场生成法线贴图
function normalFrom(size, strength = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => heightBuf[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = inv * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function texPair(size, repeat, fn, normalStrength = 2) {
  heightBuf = new Float32Array(size * size);
  const map = new THREE.CanvasTexture(canvasOf(size, fn));
  const normalMap = new THREE.CanvasTexture(normalFrom(size, normalStrength));
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  heightBuf = null;
  return { map, normalMap };
}

const mix = (a, b, t) => a + (b - a) * t;

export function makeTextures() {
  const T = {};
  const n1 = makeNoise(7), n2 = makeNoise(23), n3 = makeNoise(51);

  // 草地:多色斑驳 + 细碎高频
  T.grass = texPair(512, 90, (u, v) => {
    const big = n1(u * 8, v * 8, 3);
    const fine = n2(u * 60, v * 60, 3);
    const patch = n3(u * 4, v * 4, 2);
    let r = mix(72, 110, big) + fine * 26 - 13;
    let g = mix(130, 168, big) + fine * 30 - 15;
    let b = mix(52, 78, big) + fine * 18 - 9;
    if (patch > 0.62) { r += 22; g += 12; b -= 6; }       // 枯草斑
    if (patch < 0.34) { r -= 12; g -= 6; }                 // 深绿斑
    return [r, g, b, fine * 0.6 + big * 0.4];
  }, 1.2);

  // 土路
  T.dirt = texPair(512, 6, (u, v) => {
    const base = n1(u * 10, v * 10, 4);
    const fine = n2(u * 70, v * 70, 3);
    const rut = Math.abs(Math.sin(u * Math.PI * 2)) ** 0.5; // 车辙
    let r = mix(150, 122, rut * 0.4) + base * 30 + fine * 18 - 24;
    let g = mix(126, 100, rut * 0.4) + base * 26 + fine * 15 - 20;
    let b = mix(96, 74, rut * 0.4) + base * 20 + fine * 12 - 16;
    return [r, g, b, base * 0.5 + fine * 0.5];
  }, 1.6);

  // 石墙:砖缝
  T.stone = texPair(512, 1, (u, v, x, y) => {
    const row = Math.floor(v * 12);
    const off = (row % 2) * 0.5;
    const bu = ((u * 6 + off) % 1), bv = (v * 12) % 1;
    const edge = Math.min(bu, 1 - bu, bv * 2, (1 - bv) * 2);
    const mortar = edge < 0.07 ? 1 : 0;
    const grain = n2((u + row * 0.13) * 40, v * 40, 3);
    const tone = n1(Math.floor((u * 6 + off)) * 0.9, row * 0.7, 1);
    let base = mix(138, 176, tone) + grain * 24 - 12;
    if (mortar) base = 96 + grain * 14;
    return [base, base * 0.97, base * 0.9, mortar ? 0.1 : 0.5 + grain * 0.5];
  }, 2.4);

  // 屋瓦:横向叠瓦
  T.roof = texPair(256, 1, (u, v) => {
    const rowN = 8;
    const row = Math.floor(v * rowN);
    const off = (row % 2) * 0.25;
    const tu = ((u * 8 + off) % 1);
    const tv = (v * rowN) % 1;
    const curve = Math.sin(tu * Math.PI) * 0.5 + 0.5;
    const lip = tv > 0.82 ? 0.35 : 1;
    const grain = n3((u + row * 0.31) * 30, v * 30, 2);
    const tone = n1(Math.floor(u * 8 + off) * 1.3, row * 1.1, 1);
    const r = (150 + tone * 46 + grain * 20 - 10) * lip * mix(0.82, 1, curve);
    return [r, r * 0.42, r * 0.3, curve * lip];
  }, 2.2);

  // 灰泥墙面
  T.plaster = texPair(256, 1, (u, v) => {
    const g = n2(u * 24, v * 24, 4);
    const stain = n1(u * 5, v * 5, 2);
    let base = 226 + g * 20 - 10 - Math.max(0, stain - 0.6) * 60;
    return [base, base * 0.955, base * 0.885, g];
  }, 0.9);

  // 木纹
  T.wood = texPair(256, 1, (u, v) => {
    const ring = Math.sin((u * 3 + n1(u * 4, v * 2, 3) * 1.6) * Math.PI * 7) * 0.5 + 0.5;
    const g = n2(u * 12, v * 60, 3);
    const r = mix(96, 138, ring) + g * 18 - 9;
    return [r, r * 0.68, r * 0.46, ring * 0.6 + g * 0.4];
  }, 1.4);

  // 鹅卵石街道:抖动网格 + 圆润高度场
  const cobbleHash = (x, y) => n3(x * 0.937 + 11.3, y * 0.883 + 7.7, 1);
  T.cobble = texPair(512, 1, (u, v) => {
    const N = 9;
    let best = 9, tone = 0.5;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = Math.floor(u * N) + dx, cy = Math.floor(v * N) + dy;
        const wx = ((cx % N) + N) % N, wy = ((cy % N) + N) % N; // 无缝平铺
        const jx = cobbleHash(wx, wy) - 0.5, jy = cobbleHash(wy + 31, wx + 17) - 0.5;
        const px = (cx + 0.5 + jx * 0.7) / N, py = (cy + 0.5 + jy * 0.7) / N;
        const d = Math.hypot((u - px) * N, (v - py) * N);
        if (d < best) { best = d; tone = cobbleHash(wx + 53, wy + 91); }
      }
    }
    const stone = Math.max(0, Math.min(1, (0.52 - best) / 0.14));
    const grain = n2(u * 50, v * 50, 3);
    let base = mix(128, 168, tone) + grain * 26 - 13;
    base = mix(88 + grain * 14, base, stone);   // 石缝暗色
    const warm = 0.5 + tone * 0.5;
    const h = Math.max(0, 1 - best * 1.7) * stone;
    return [base * (0.94 + warm * 0.1), base * 0.95, base * (0.99 - warm * 0.08), h * 0.85 + grain * 0.15];
  }, 2.0);

  // 水面波纹法线(供动画偏移)
  T.waterNormal = texPair(256, 4, (u, v) => {
    const w = n1(u * 10, v * 10, 4) * 0.6 + n2(u * 22, v * 22, 3) * 0.4;
    return [128, 128, 255, w];
  }, 3).normalMap;

  // AI 素材覆盖(若 assets/ai/ 下存在对应图片)
  const aiParams = {
    grass: [90, 1.2], dirt: [6, 1.6], stone: [1, 2.4], roof: [1, 2.2],
    plaster: [1, 0.9], wood: [1, 1.4], cobble: [1, 2.0],
  };
  for (const n of Object.keys(aiImages)) {
    const [r, ns] = aiParams[n];
    T[n] = texFromImage(aiImages[n], r, ns);
  }

  return T;
}
