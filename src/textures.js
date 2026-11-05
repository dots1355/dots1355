// 程序化 PBR 贴图生成:颜色贴图 + 由高度场推导的法线贴图,零外部资源
// 支持 AI 素材覆盖:把 AI 生成的无缝贴图放进 assets/ai/<名字>.jpg|png,
// 游戏启动时自动加载并替换对应的程序化贴图(法线贴图由图像亮度自动推导)。
import * as THREE from 'three';

const AI_NAMES = ['grass', 'dirt', 'stone', 'roof', 'plaster', 'wood', 'cobble'];
const aiImages = {};

// 运行时 AI 生成:在玩家浏览器里调用 Pollinations(免费、无需密钥)生成照片级无缝贴图。
// 固定 seed 保证每次生成结果一致,并用 Cache API 本地缓存,只有首次需要联网等待。
const AI_PROMPTS = {
  grass:   'seamless tileable photorealistic dry nordic tundra grassland texture, golden brown tussock grass with grey-green moss patches, top-down view, game asset, PBR albedo, muted colors',
  dirt:    'seamless tileable photorealistic dirt road texture with wheel ruts, dry mud, top-down view, game asset, PBR albedo',
  stone:   'seamless tileable photorealistic medieval castle stone brick wall texture, weathered gray blocks, game asset, PBR albedo',
  roof:    'seamless tileable photorealistic weathered dark wooden roof shingles texture, nordic medieval, overlapping grey-brown shakes, game asset, PBR albedo',
  plaster: 'seamless tileable photorealistic weathered grey daub and timber wall texture, nordic medieval longhouse facade, muted, game asset, PBR albedo',
  wood:    'seamless tileable photorealistic weathered oak wood planks texture, medieval, game asset, PBR albedo',
  cobble:  'seamless tileable photorealistic medieval cobblestone street texture, worn round stones, top-down view, game asset, PBR albedo',
  title:   'epic cinematic nordic medieval kingdom, snow-capped jagged mountains in mist, stone keep above a timber town on golden tussock plains, lone warrior on horseback, skyrim style key art, cold desaturated palette, volumetric fog, ultra detailed',
};

function aiURL(name) {
  const size = name === 'title' ? 'width=1280&height=720' : 'width=512&height=512';
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(AI_PROMPTS[name])}?${size}&seed=7&nologo=true&model=flux`;
}

async function fetchAIImage(name, timeoutMs = 100000) {
  const url = aiURL(name);
  let cache = null;
  try { cache = await caches.open('gth-ai-v1'); } catch { /* 非安全上下文无缓存 */ }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return createImageBitmap(await hit.blob());
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('not an image');
    if (cache) { try { await cache.put(url, new Response(blob)); } catch { /* 忽略 */ } }
    return createImageBitmap(blob);
  } finally {
    clearTimeout(timer);
  }
}

// 贴图画布注册表(供热替换:AI 图像直接画进原画布,所有材质克隆共享同一画布)
const registry = {};

// 把 AI 图像写入指定贴图的颜色/法线画布;返回被更新的画布,调用方负责触发 needsUpdate
export function applyAIImage(name, bitmap) {
  const reg = registry[name];
  if (!reg) return null;
  const size = reg.color.width;
  const g = reg.color.getContext('2d');
  g.drawImage(bitmap, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size).data;
  heightBuf = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    heightBuf[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  const normalCanvas = normalFrom(size, 2);
  reg.normal.getContext('2d').drawImage(normalCanvas, 0, 0);
  heightBuf = null;
  return [reg.color, reg.normal];
}

// 后台逐个生成缺失的 AI 贴图;onTexture(name, canvases) 在每张就绪时回调
export async function generateRemoteAITextures({ onStatus, onTexture, onTitle } = {}) {
  if (new URLSearchParams(location.search).has('noai')) {
    onStatus?.('offline');
    return 0;
  }
  const todo = AI_NAMES.filter((n) => !aiImages[n]);
  todo.push('title');
  let done = 0, failed = 0;
  onStatus?.('generating', 0, todo.length);
  // 串行小队列,避免触发服务限流
  for (const name of todo) {
    try {
      const bitmap = await fetchAIImage(name);
      // 处理前让出一帧,把每张贴图的 CPU 处理分散到不同帧,避免集中卡顿
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      if (name === 'title') {
        onTitle?.(bitmap);
      } else {
        const canvases = applyAIImage(name, bitmap);
        if (canvases) onTexture?.(name, canvases);
      }
      done++;
      onStatus?.('generating', done, todo.length);
    } catch {
      failed++;
      if (failed >= 2 && done === 0) { onStatus?.('offline'); return 0; }
    }
  }
  onStatus?.(done > 0 ? 'done' : 'offline', done, todo.length);
  return done;
}

export async function preloadAIAssets() {
  if (location.protocol === 'file:') return []; // 单文件桌面版:无外部素材目录,直接走程序化贴图
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

// 铭文碑的刻字:成行的符文刻槽(底色贴图:近白底 + 深色刻槽,乘石头顶点色;发光贴图:刻槽里一线微光)
export function makeInscriptionTextures(seed = 7) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const mk = () => { const c = document.createElement('canvas'); c.width = 128; c.height = 256; return c; };
  const base = mk(), glow = mk();
  const g = base.getContext('2d'), e = glow.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) { // 石面麻点
    const l = 200 + r() * 55;
    g.fillStyle = `rgba(${l},${l},${l - 8},0.55)`;
    g.fillRect(r() * 128, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  e.fillStyle = '#000'; e.fillRect(0, 0, 128, 256);
  const strokes = [];
  // 顶上一个大徽记(圆环 + 十字),下面八行小符文(每行 4~6 个字,每字 2~3 笔)
  for (let row = 0; row < 8; row++) {
    const y0 = 92 + row * 19, n = 4 + Math.floor(r() * 3);
    for (let c = 0; c < n; c++) {
      const x0 = 24 + c * (80 / n) + r() * 4;
      const k = 2 + Math.floor(r() * 2);
      for (let j = 0; j < k; j++) {
        const xa = x0 + r() * 10, ya = y0 + r() * 12, xb = x0 + r() * 10, yb = y0 + r() * 12;
        strokes.push([xa, ya, xb, yb]);
      }
    }
  }
  const drawAll = (ctx, w, style, blur = 0) => {
    ctx.save();
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.lineCap = 'round';
    if (blur) { ctx.shadowColor = style; ctx.shadowBlur = blur; }
    ctx.beginPath(); ctx.arc(64, 48, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 20); ctx.lineTo(64, 76); ctx.moveTo(36, 48); ctx.lineTo(92, 48); ctx.stroke();
    for (const [xa, ya, xb, yb] of strokes) { ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); }
    ctx.restore();
  };
  drawAll(g, 5, 'rgba(70,64,56,0.55)');
  drawAll(g, 3, 'rgba(38,34,30,0.92)');
  drawAll(e, 3, 'rgba(255,255,255,0.3)', 5);
  drawAll(e, 1.6, '#fff');
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  const glowT = new THREE.CanvasTexture(glow);
  glowT.colorSpace = THREE.SRGBColorSpace;
  return { map, glow: glowT };
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

// 周期值噪声:格点按 freq 取模,u/v ∈ [0,1) 一张图正好一个周期——严格无缝平铺(新贴图都用它)
function makeTileNoise(seed = 1) {
  const h = (x, y) => {
    let k = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x2c1b3c6d)) >>> 0;
    k = Math.imul(k ^ (k >>> 15), 0x297a2d39) >>> 0;
    return ((k ^ (k >>> 13)) >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  const one = (u, v, f) => {
    const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const w = (a) => ((a % f) + f) % f;
    const a = h(w(xi), w(yi)), b = h(w(xi + 1), w(yi)), c = h(w(xi), w(yi + 1)), d = h(w(xi + 1), w(yi + 1));
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (u, v, f, oct = 1) => {
    let s = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) { s += one(u, v, f << o) * amp; norm += amp; amp *= 0.5; }
    return s / norm;
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
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
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
    let r = mix(118, 148, big) + fine * 22 - 11;  // Tussock 金棕草原(天际白漫谷地的底色)
    let g = mix(102, 126, big) + fine * 22 - 11;
    let b = mix(64, 80, big) + fine * 14 - 7;
    if (patch > 0.58) { r += 18; g += 8; b -= 6; }        // 更枯的金斑
    if (patch < 0.34) { r -= 26; g -= 12; b -= 4; }        // 灰绿苔斑
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

  // 屋瓦:错缝叠瓦(中性灰,颜色交给材质:陶红/青石板/木瓦各户不同)
  T.roof = texPair(256, 1, (u, v) => {
    const rowN = 8;
    const row = Math.floor(v * rowN);
    const off = (row % 2) * 0.5;
    const cu = u * 6 + off;
    const tu = cu % 1;
    const tv = (v * rowN) % 1;
    const curve = Math.sin(tu * Math.PI) * 0.5 + 0.5;
    const lip = tv > 0.88 ? 0.74 : tv > 0.7 ? mix(1, 0.84, (tv - 0.7) / 0.18) : 1; // 上一排瓦压下来的阴影(柔)
    const gap = Math.min(tu, 1 - tu) < 0.022 ? 0.88 : 1;          // 瓦缝(浅)
    const grain = n3((u + row * 0.31) * 30, v * 30, 2);
    const tone = n1(Math.floor(cu) * 1.3 + row * 0.7, row * 1.1, 1);  // 每片瓦深浅不一
    const wear = n2(u * 6, v * 6, 2);                                  // 大片风化斑
    const r = (128 + tone * 84 + grain * 26 - 13 - Math.max(0, wear - 0.5) * 80) * lip * gap * mix(0.88, 1, curve);
    return [r * 1.02, r, r * 0.95, curve * lip * gap];
  }, 2.2);

  // 灰泥墙面
  T.plaster = texPair(256, 1, (u, v) => {
    const g = n2(u * 24, v * 24, 4);
    const stain = n1(u * 5, v * 5, 2);
    let base = 226 + g * 20 - 10 - Math.max(0, stain - 0.6) * 60;
    return [base, base * 0.955, base * 0.885, g];
  }, 0.9);

  // 木纹
  T.wood = texPair(256, 1, (u, v) => { // 顺纹长条纹理 + 淡淡的年轮弧线(不再是斑马纹)
    const streak = n2(u * 22, v * 2.2, 3);
    const ring = Math.sin((u * 2 + n1(u * 3, v * 1.5, 3) * 2.2) * Math.PI * 9) * 0.5 + 0.5;
    const fine = n3(u * 90, v * 6, 2);
    const r = 104 + streak * 26 + ring * 9 + fine * 10 - 18;
    return [r, r * 0.74, r * 0.54, streak * 0.5 + fine * 0.3 + ring * 0.2];
  }, 1.1);

  // 木板墙/门板/百叶:一张 5 块横板,板缝深、每块深浅不一,顺纹细丝 + 偶见木节
  T.planks = texPair(256, 1, (u, v) => {
    const rows = 5;
    const fy = v * rows, row = Math.floor(fy), tv = fy - row;
    const tone = n1(row * 3.7, row * 1.3 + 4, 1);
    const streak = n2(u * 18 + row * 3.1, tv * 1.4 + row * 7, 3);
    const fine = n3(u * 70, (v + row * 0.13) * 9, 2);
    const knot = Math.max(0, 1 - Math.hypot((u * 3 + row * 0.37) % 1 - 0.5, (tv - 0.5) * 1.8) * 9) * (tone > 0.55 ? 1 : 0);
    const gap = tv < 0.06 ? 0.42 : tv < 0.1 ? 0.78 : 1;
    const r = (100 + tone * 34 + streak * 24 + fine * 10 - 20 - knot * 40) * gap;
    return [r, r * 0.76, r * 0.56, (0.5 + streak * 0.3 + fine * 0.2) * (gap < 1 ? 0.2 : 1) - knot * 0.2];
  }, 1.6);

  // 鹅卵石街道:错缝成排的不规则石块。加权 Voronoi 的 F2-F1 给出弯曲的深石缝,
  // 石面按到缝的距离拱起(边缘 AO),每块石头冷暖、深浅各异,缝里是黑土和一点苔
  // 一张贴图 15×18 块(3.2m 一张 → 石块约 21×18cm),行行错缝,严格无缝平铺
  const cobbleHash = (x, y) => {
    let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  T.cobble = texPair(512, 1, (u, v) => {
    const NX = 15, NY = 18;
    const fy = v * NY, row = Math.floor(fy);
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ry = row + dy;
      const wy = ((ry % NY) + NY) % NY;
      const fx = u * NX - (wy % 2) * 0.5; // 隔行错半块
      const col = Math.floor(fx);
      for (let dx = -1; dx <= 1; dx++) {
        const cx = col + dx;
        const wx = ((cx % NX) + NX) % NX;
        const px = cx + 0.5 + (cobbleHash(wx, wy) - 0.5) * 0.5;
        const py = ry + 0.5 + (cobbleHash(wy + 31, wx + 17) - 0.5) * 0.36;
        const w = 0.82 + 0.36 * cobbleHash(wx + 7, wy + 3); // 大小不一 → 石缝弯曲、石块不规则
        const d = Math.hypot((fx - px) * 0.92, (fy - py) * 1.08) * w;
        if (d < f1) { f2 = f1; f1 = d; id = wy * NX + wx; } else if (d < f2) f2 = d;
      }
    }
    const edge = f2 - f1;                                     // 到石缝的距离(0 = 缝心)
    const stone = Math.max(0, Math.min(1, (edge - 0.022) / 0.07));
    const dome = Math.sqrt(Math.max(0, Math.min(1, edge / 0.42))); // 圆拱石面
    const ao = 0.66 + 0.34 * Math.max(0, Math.min(1, edge / 0.3));
    const grain = n2(u * 60, v * 60, 3);
    const t1 = cobbleHash(id, 5), t2 = cobbleHash(id, 77);
    let r = 84 + t1 * 30 + grain * 16 - 8 + dome * 10, g = r * 0.98, b = r * 0.94;
    if (t2 > 0.62) { r += 8; g += 2; b -= 8; }             // 暖褐石
    else if (t2 < 0.28) { r -= 6; g -= 1; b += 6; }        // 冷青石
    r *= ao; g *= ao; b *= ao;
    const moss = n1(u * 9, v * 9, 2);
    const gr = 62 + grain * 12, gg = 60 + grain * 12 + moss * 7, gb = 50 + grain * 8; // 缝里黑土 + 苔
    r = mix(gr, r, stone); g = mix(gg, g, stone); b = mix(gb, b, stone);
    const h = stone * (0.3 + 0.7 * dome) + grain * 0.06;
    return [r, g, b, h];
  }, 2.6);

  // 帆布:经纬细织纹 + 拼缝 + 大片水渍与补丁色差(帐篷、风帆、面粉袋、旗)——中性浅色,颜色交给材质
  const tn = makeTileNoise(17);
  T.canvas = texPair(256, 1, (u, v) => {
    const warp = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5, weft = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5;
    const weave = (warp + weft) * 0.5;
    const stain = tn(u, v, 4, 3), fine = tn(u, v, 32, 2);
    const seam = Math.abs(((u * 2) % 1) - 0.5) > 0.488 ? 0.78 : 1;  // 每 0.5 张一道拼缝
    const patch = tn(u + 0.3, v, 3, 2) > 0.68 ? 0.9 : 1;            // 补丁:颜色深一号
    const r = (206 + weave * 20 + fine * 16 - 18 - Math.max(0, stain - 0.52) * 110) * seam * patch;
    return [r, r * 0.95, r * 0.86, (weave * 0.5 + fine * 0.3) * seam];
  }, 1.4);

  // 地衣石面(立石、石环):近白的底(乘顶点色),细碎麻点、几道裂纹、成片的黄绿地衣斑
  T.lichen = texPair(256, 1, (u, v) => {
    const pit = tn(u, v, 48, 2), blot = tn(u, v, 6, 3), crust = tn(u + 0.41, v + 0.17, 10, 3);
    const crack = Math.abs(tn(u, v + 0.5, 5, 2) - 0.5) < 0.012 ? 0.62 : 1;
    let r = (196 + pit * 52 - 26 + (blot - 0.5) * 40) * crack, g = r * 0.985, b = r * 0.95;
    const lich = Math.max(0, Math.min(1, (crust - 0.6) / 0.08));
    r = mix(r, 178, lich); g = mix(g, 182, lich); b = mix(b, 120, lich);
    return [r, g, b, (pit * 0.6 + blot * 0.4) * crack - lich * 0.1];
  }, 2.2);

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

  // 登记画布,供运行时 AI 生成热替换
  for (const n of AI_NAMES) {
    if (T[n]) registry[n] = { color: T[n].map.image, normal: T[n].normalMap.image };
  }

  return T;
}
