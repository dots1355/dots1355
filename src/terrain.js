// 地形系统:高度场 + 群系权重 + 植被许可 + 地表网格
//
// 约定(全项目):游戏逻辑里所有 y 都是"离地高度"——人物 pos.y=0 就是站在地上。
// 真实地面高度 groundH(x,z) 只在渲染前由 gfx/snap.js 的贴地 pass(snapScene)统一加到顶层物体上,
// 所以战斗、AI、碰撞这些 2D 逻辑完全不用知道地形的存在。
//
// 高度是确定性解析函数(整数哈希值噪声,跨会话稳定);核心王国用距离场蒙版
// 把城镇/道路/水域/建筑压平,向外平滑过渡成丘陵。地表网格在 CPU 上一次烘焙
// (核心 ±512 米一块,荒野每个区块一块),运行时不做任何噪声计算。
import * as THREE from 'three';
import { waterBasin, waterProx } from './waterbodies.js';
import { NOISE_GLSL, PUDDLE_GLSL, PUDDLE_COLOR, PUDDLE_ROUGH, PUDDLE_NORMAL, PUDDLE_EMISSIVE, SURFACE_UNIFORMS_GLSL,
  bindSurfaceUniforms } from './gfx/surface.js';

// ---------------- 整数哈希值噪声 ----------------
function hash2(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { // 0..1
  return vnoise(x, z) * 0.55 + vnoise(x * 2.07 + 17.1, z * 2.07 - 9.4) * 0.3 +
    vnoise(x * 4.13 - 31.7, z * 4.13 + 5.3) * 0.15;
}
const ridge = (x, z) => 1 - Math.abs(2 * vnoise(x, z) - 1);
export function smooth(a, b, t) {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

// ---------------- 群系 ----------------
export const BIOME = { plains: 0, forest: 1, desert: 2, snow: 3, swamp: 4, ash: 5, rock: 6, hills: 7 };
export const BIOME_KEYS = ['plains', 'forest', 'desert', 'snow', 'swamp', 'ash', 'rock', 'hills'];
const NB = 8;
// 核心王国的手绘区域(与 story.REGIONS 对齐):[x, z, 半径, 群系]
const CORE_BLOBS = [
  [-150, -20, 88, BIOME.forest],  // 幽暗森林
  [300, 190, 104, BIOME.desert],  // 琥珀荒漠
  [-290, 240, 92, BIOME.swamp],   // 雾语沼泽
  [-380, -40, 88, BIOME.ash],     // 灰烬荒地
  [300, -140, 74, BIOME.rock],    // 龙骨之地
  [380, 60, 84, BIOME.hills],     // 迷途丘陵
  [-260, -150, 72, BIOME.snow],   // 霜风隘口
];
const _w = new Float32Array(NB);
export function biomeWeights(x, z, out = _w) {
  out.fill(0);
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const wildK = smooth(470, 540, edge); // 0=核心手绘区,1=程序化荒野
  if (wildK < 1) {
    const k = 1 - wildK;
    let sum = 0;
    for (const [bx, bz, r, b] of CORE_BLOBS) {
      const dx = x - bx, dz = z - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const w = 1 - smooth(r * 0.55, r, Math.sqrt(d2));
      out[b] += w * k;
      sum += w;
    }
    const north = smooth(-150, -205, z); // 北境群山:越往北越积雪
    if (north > 0) { out[BIOME.snow] += north * k; sum += north; }
    out[BIOME.plains] += Math.max(0, 1 - sum) * k;
  }
  if (wildK > 0) {
    const v = vnoise(x * 0.0011 + 37.7, z * 0.0011 - 11.3);
    const fP = 1 - smooth(0.34, 0.4, v);
    const fF = smooth(0.34, 0.4, v) * (1 - smooth(0.58, 0.64, v));
    const fD = smooth(0.58, 0.64, v) * (1 - smooth(0.76, 0.82, v));
    const fS = smooth(0.76, 0.82, v);
    const wet = smooth(0.72, 0.8, vnoise(x * 0.0042 + 5.1, z * 0.0042 - 3.3)); // 湿地斑块
    const hilly = smooth(0.6, 0.72, vnoise(x * 0.0031 - 8.2, z * 0.0031 + 2.9)); // 丘陵带
    const ashy = smooth(0.74, 0.82, vnoise(x * 0.0019 + 41.0, z * 0.0019 + 13.0)); // 焦土带
    out[BIOME.plains] += fP * (1 - wet) * (1 - hilly) * wildK;
    out[BIOME.hills] += fP * (1 - wet) * hilly * wildK;
    out[BIOME.forest] += fF * (1 - wet) * wildK;
    out[BIOME.swamp] += wet * (fP + fF) * wildK;
    out[BIOME.desert] += fD * (1 - ashy) * wildK;
    out[BIOME.ash] += fD * ashy * wildK;
    out[BIOME.snow] += fS * wildK;
  }
  let s = 0;
  for (let i = 0; i < NB; i++) s += out[i];
  if (s > 0) for (let i = 0; i < NB; i++) out[i] /= s;
  return out;
}
export function dominantBiome(x, z) {
  const w = biomeWeights(x, z);
  let best = 0;
  for (let i = 1; i < NB; i++) if (w[i] > w[best]) best = i;
  return BIOME_KEYS[best];
}

// ---------------- 高度 ----------------
function biomeH(b, x, z) {
  switch (b) {
    case 0: // 平原:缓坡草甸
      return Math.max(0, 5.4 * (fbm(x / 130, z / 130) - 0.28)) + 0.5 * vnoise(x / 26, z / 26);
    case 1: // 林地:起伏更大
      return Math.max(0, 8.5 * (fbm(x / 105 + 3.3, z / 105) - 0.25)) + 0.4 * vnoise(x / 19, z / 19);
    case 2: { // 荒漠:斜向长沙丘 + 低频漫坡
      const t = (x * 0.8 + z * 0.6) / 17 + 2.6 * vnoise(x / 70, z / 70);
      const d = 1 - Math.abs(Math.sin(t));
      return 3.8 * d * d * (0.55 + 0.45 * vnoise(x / 45, z / 45)) + 2.6 * fbm(x / 170, z / 170);
    }
    case 3: { // 雪原:高耸雪丘
      const f = Math.max(0, fbm(x / 125 - 7.1, z / 125) - 0.22);
      return 16 * Math.pow(f, 1.25) + 0.8 * vnoise(x / 22, z / 22);
    }
    case 4: // 沼泽:几乎平坦,只有泥坑起伏
      return 0.55 * vnoise(x / 24, z / 24);
    case 5: { // 灰烬荒地:嶙峋脊线
      const r = ridge(x / 75 + 11, z / 75);
      return 8 * r * r * r + 1.2 * vnoise(x / 18, z / 18);
    }
    case 6: { // 龙骨之地:碎石岗
      const r = ridge(x / 60 - 5, z / 60 + 2);
      return 6.8 * r * r + 1.8 * fbm(x / 40, z / 40);
    }
    case 7: { // 丘陵:更高更陡的连绵丘脊(起伏 15m 以上,坡面成片)
      const r = ridge(x / 48 + 2.3, z / 48 - 1.1);
      return Math.max(0, 34 * (fbm(x / 62 + 1.7, z / 62 - 4.2) - 0.3)) + 7 * r * r + 0.6 * vnoise(x / 24, z / 24);
    }
  }
  return 0;
}
// 北境山脉:王国北面(z < -175 起)隆起的雪山带,脊状噪声劈出山脊与沟谷,峰高 55~120m;
// 到无尽荒野交界处收住(荒野另有自己的地形)。陡坡露岩、高处积雪由地表配色自动处理。
export function mountainH(x, z) {
  const north = smooth(-175, -265, z);
  if (north <= 0) return 0;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const fade = 1 - smooth(440, 505, edge);
  if (fade <= 0) return 0;
  const r1 = ridge(x / 150 + 3.1, z / 150 - 1.7), r2 = ridge(x / 64 - 2.2, z / 64 + 5.3);
  const peaks = 55 + 65 * vnoise(x / 260 + 9.1, z / 260 - 4.4);
  return north * fade * peaks * (0.58 * r1 * r1 + 0.3 * r2 * r2 + 0.12) + north * fade * 4 * vnoise(x / 18, z / 18);
}
const _wh = new Float32Array(NB);
export function terrainH(x, z) {
  const m = maskAt(x, z);
  if (m <= 0) return -waterBasin(x, z);
  const w = biomeWeights(x, z, _wh);
  let h = 0;
  for (let i = 0; i < NB; i++) if (w[i] > 0.002) h += w[i] * biomeH(i, x, z);
  return (h + mountainH(x, z)) * m - waterBasin(x, z); // 湖/河/水塘挖成盆地(水位 0)
}

// ---------------- 核心区平整蒙版(距离场) ----------------
const MN = 512, MS = 2, MO = 512;  // 512×512 格,每格 2 米,覆盖 [-512, 512]
const VN = 1024, VS = 1;           // 植被许可:1 米精度
let MASK = null;  // Float32Array 0..1:0=必须平整,1=自由起伏
let VEG = null;   // Uint8Array 0/1:是否允许长草
const RAMP = 30;  // 平整区向外过渡成丘陵的距离(米)

export function maskAt(x, z) { // 0 = 贴着道路/建筑/兴趣点(压平),1 = 远离一切(自然起伏)
  if (!MASK) return 1;
  const fx = (x + MO) / MS - 0.5, fz = (z + MO) / MS - 0.5;
  if (fx < 0 || fz < 0 || fx >= MN - 1 || fz >= MN - 1) return 1;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i = iz * MN + ix;
  const a = MASK[i], b = MASK[i + 1], c = MASK[i + MN], d = MASK[i + MN + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
export function vegAllowed(x, z) {
  if (!VEG) return true;
  const ix = Math.floor((x + MO) / VS), iz = Math.floor((z + MO) / VS);
  if (ix < 0 || iz < 0 || ix >= VN || iz >= VN) return true;
  return VEG[iz * VN + ix] === 1;
}

function stampRect(arr, N, S, cx, cz, w, d, rot, val) {
  // 旋转矩形(minimap 要素约定:rot 为绕 Y 的朝向,h 沿朝向)
  const c = Math.cos(rot), s = Math.sin(rot);
  const hx = w / 2, hz = d / 2;
  const R = Math.hypot(hx, hz);
  const x0 = Math.max(0, Math.floor((cx - R + MO) / S)), x1 = Math.min(N - 1, Math.ceil((cx + R + MO) / S));
  const z0 = Math.max(0, Math.floor((cz - R + MO) / S)), z1 = Math.min(N - 1, Math.ceil((cz + R + MO) / S));
  for (let iz = z0; iz <= z1; iz++) {
    const pz = (iz + 0.5) * S - MO - cz;
    for (let ix = x0; ix <= x1; ix++) {
      const px = (ix + 0.5) * S - MO - cx;
      const lx = px * c - pz * s, lz = px * s + pz * c;
      if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) arr[iz * N + ix] = val;
    }
  }
}
function stampCircle(arr, N, S, cx, cz, r, val) {
  const x0 = Math.max(0, Math.floor((cx - r + MO) / S)), x1 = Math.min(N - 1, Math.ceil((cx + r + MO) / S));
  const z0 = Math.max(0, Math.floor((cz - r + MO) / S)), z1 = Math.min(N - 1, Math.ceil((cz + r + MO) / S));
  for (let iz = z0; iz <= z1; iz++) {
    const pz = (iz + 0.5) * S - MO - cz;
    for (let ix = x0; ix <= x1; ix++) {
      const px = (ix + 0.5) * S - MO - cx;
      if (px * px + pz * pz <= r * r) arr[iz * N + ix] = val;
    }
  }
}
function stampBox(arr, N, S, minX, maxX, minZ, maxZ, val) {
  stampRect(arr, N, S, (minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, 0, val);
}

// 平整/禁草的手工区域(没有碰撞体却散落小道具的地点)
const FLAT_SPOTS = [
  [0, 0, 0, 78, 64],          // 王都城墙内(矩形:半宽 78、半深 64)
  [1, 170, -60, 15], [1, -40, -120, 20], [1, 10, 300, 34], [1, -100, 55, 22],
  [1, 12, 72, 16], [1, -170, -90, 32], [1, 80, -120, 14], [1, 140, 20, 16],
  [1, -100, 100, 46],         // 银月湖与湖心岛
  [1, 298, -152, 16],         // 龙颅
  [0, 352, -280, 46, 46],     // 封印地窖迷宫
];

export function buildMasks(world) {
  const zone = new Uint8Array(MN * MN);
  VEG = new Uint8Array(VN * VN).fill(1);
  for (const f of world.features) {
    const rot = f.rot || 0;
    if (f.type === 'road') {
      stampRect(zone, MN, MS, f.x, f.z, f.w + 4, f.h + 4, rot, 1);
      stampRect(VEG, VN, VS, f.x, f.z, f.w + 0.8, f.h + 0.8, rot, 0);
    } else if (['wall', 'tower', 'keep', 'house', 'stall', 'tent', 'windmill', 'plaza', 'field', 'water'].includes(f.type)) {
      stampRect(zone, MN, MS, f.x, f.z, f.w + 6, f.h + 6, rot, 1);
      if (f.shape) continue; // 有真实轮廓的水体:下面按岸线精确禁草(岸边留给芦苇)
      const m = f.type === 'water' ? 1.2 : 0.6;
      stampRect(VEG, VN, VS, f.x, f.z, f.w + m, f.h + m, rot, 0);
    }
  }
  for (const b of world.colliders.boxes) {
    if (Math.abs(b.minX) > 2000 || Math.abs(b.maxX) > 2000) continue; // 世界边界墙
    stampBox(zone, MN, MS, b.minX - 3, b.maxX + 3, b.minZ - 3, b.maxZ + 3, 1);
    stampBox(VEG, VN, VS, b.minX - 0.4, b.maxX + 0.4, b.minZ - 0.4, b.maxZ + 0.4, 0);
  }
  for (const c of world.colliders.circles) {
    if (c.r < 1.5 || c.r >= 20) continue; // 树木随地形起伏;大山体本身就是山
    stampCircle(zone, MN, MS, c.x, c.z, c.r + 3, 1);
    stampCircle(VEG, VN, VS, c.x, c.z, c.r + 0.3, 0);
  }
  for (const s of FLAT_SPOTS) {
    if (s[0] === 0) stampRect(zone, MN, MS, s[1], s[2], s[3] * 2, s[4] * 2, 0, 1);
    else stampCircle(zone, MN, MS, s[1], s[2], s[3], 1);
  }
  for (const f of world.features) { // 水体:岸线以内(含 0.3m 湿边)不长草
    if (!f.shape) continue;
    const R = Math.hypot(f.w, f.h) / 2 + 2;
    const x0 = Math.max(0, Math.floor((f.x - R + MO) / VS)), x1 = Math.min(VN - 1, Math.ceil((f.x + R + MO) / VS));
    const z0 = Math.max(0, Math.floor((f.z - R + MO) / VS)), z1 = Math.min(VN - 1, Math.ceil((f.z + R + MO) / VS));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        if (waterProx((ix + 0.5) * VS - MO, (iz + 0.5) * VS - MO) > -0.3) VEG[iz * VN + ix] = 0;
      }
    }
  }
  stampCircle(VEG, VN, VS, 0, 5, 13.5, 0);                 // 喷泉广场
  stampRect(VEG, VN, VS, 352, -280, 96, 96, 0, 0);         // 地窖迷宫

  // 两遍 chamfer 距离变换(单位:格)
  const INF = 1e9;
  const dist = new Float32Array(MN * MN);
  for (let i = 0; i < MN * MN; i++) dist[i] = zone[i] ? 0 : INF;
  const D1 = 1, D2 = Math.SQRT2;
  for (let z = 0; z < MN; z++) {
    for (let x = 0; x < MN; x++) {
      const i = z * MN + x;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + D1);
      if (z > 0) {
        v = Math.min(v, dist[i - MN] + D1);
        if (x > 0) v = Math.min(v, dist[i - MN - 1] + D2);
        if (x < MN - 1) v = Math.min(v, dist[i - MN + 1] + D2);
      }
      dist[i] = v;
    }
  }
  for (let z = MN - 1; z >= 0; z--) {
    for (let x = MN - 1; x >= 0; x--) {
      const i = z * MN + x;
      let v = dist[i];
      if (x < MN - 1) v = Math.min(v, dist[i + 1] + D1);
      if (z < MN - 1) {
        v = Math.min(v, dist[i + MN] + D1);
        if (x < MN - 1) v = Math.min(v, dist[i + MN + 1] + D2);
        if (x > 0) v = Math.min(v, dist[i + MN - 1] + D2);
      }
      dist[i] = v;
    }
  }
  MASK = new Float32Array(MN * MN);
  for (let i = 0; i < MN * MN; i++) MASK[i] = smooth(0, RAMP, dist[i] * MS);
  // 蒙版边缘(核心区外沿)强制为 1,与荒野无缝
  for (let i = 0; i < MN; i++) {
    MASK[i] = MASK[(MN - 1) * MN + i] = MASK[i * MN] = MASK[i * MN + MN - 1] = 1;
  }
  cache.clear();
}

// ---------------- 网格采样(与地表三角剖分一致) ----------------
export const GRID = 4; // 地表网格间距(米)
const cache = new Map();
function cornerH(ix, iz) {
  const key = ix * 1000003 + iz;
  let h = cache.get(key);
  if (h === undefined) {
    h = terrainH(ix * GRID, iz * GRID);
    if (cache.size > 80000) cache.clear();
    cache.set(key, h);
  }
  return h;
}
// 任意点的地面高度:与渲染出来的三角面严格一致(脚不陷、不悬)
export function groundH(x, z) {
  const fx = x / GRID, fz = z / GRID;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const h00 = cornerH(ix, iz), h11 = cornerH(ix + 1, iz + 1);
  if (tx >= tz) {
    const h10 = cornerH(ix + 1, iz);
    return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  }
  const h01 = cornerH(ix, iz + 1);
  return h00 + (h01 - h00) * tz + (h11 - h01) * tx;
}
// 地面法线 y 分量(坡度判断:1=平地)
export function groundNormalY(x, z) {
  const e = GRID;
  const dx = (groundH(x + e, z) - groundH(x - e, z)) / (2 * e);
  const dz = (groundH(x, z + e) - groundH(x, z - e)) / (2 * e);
  return 1 / Math.sqrt(1 + dx * dx + dz * dz);
}

// ---------------- 地表配色 ----------------
const lin = (hex) => new THREE.Color(hex); // ColorManagement 下 setHex 自动转线性
const BIOME_COL = [
  [lin(0x969858), lin(0x7c8a4b)], // 平原:金橄榄 ↔ 青橄榄草(比旧的卡其多一分绿,远看不发灰)
  [lin(0x56633a), lin(0x4a5233)], // 林地:苔绿 ↔ 腐叶褐
  [lin(0xd8b67c), lin(0xc49a62)], // 荒漠:亮沙 ↔ 赭沙
  [lin(0xe8eef4), lin(0xc9d4de)], // 雪原:新雪 ↔ 阴影雪
  [lin(0x4f5236), lin(0x3e4430)], // 沼泽:泥橄榄 ↔ 黑泥
  [lin(0x5c544c), lin(0x3f3935)], // 灰烬:灰褐 ↔ 焦黑
  [lin(0x8b857b), lin(0x6f6a62)], // 龙骨:碎石灰 ↔ 暗岩
  [lin(0x899a52), lin(0x6e8747)], // 丘陵:更绿的草坡
];
const ROCK_COL = lin(0x77726a), SNOWCAP = lin(0xf1f5f9);
// 地图配色(小地图/大地图):按群系权重混合的 sRGB 颜色 + 高度明暗;按 16m 格缓存
const _mapCache = new Map();
const _mw = new Float32Array(NB);
const MAP_RGB = [
  [0x8c, 0x92, 0x58], [0x4e, 0x63, 0x3a], [0xd4, 0xb2, 0x78], [0xe4, 0xea, 0xf0],
  [0x4c, 0x52, 0x38], [0x5a, 0x53, 0x4c], [0x88, 0x83, 0x79], [0x76, 0x8c, 0x4e],
];
export function mapColor(x, z) {
  const ix = Math.floor(x / 16), iz = Math.floor(z / 16);
  const key = ix * 100003 + iz;
  let c = _mapCache.get(key);
  if (c) return c;
  const cx = ix * 16 + 8, cz = iz * 16 + 8;
  biomeWeights(cx, cz, _mw);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < NB; i++) { r += MAP_RGB[i][0] * _mw[i]; g += MAP_RGB[i][1] * _mw[i]; b += MAP_RGB[i][2] * _mw[i]; }
  const h = terrainH(cx, cz);
  const shade = Math.max(0.72, Math.min(1.22, 1 + h * 0.018)); // 高处亮、低处暗:一眼看出山丘洼地
  r *= shade; g *= shade; b *= shade;
  const mh = mountainH(cx, cz); // 群山:岩灰到雪白
  if (mh > 6) {
    const t = smooth(6, 30, mh) * 0.7, s = smooth(34, 60, mh);
    r += (132 - r) * t; g += (126 - g) * t; b += (118 - b) * t;
    r += (236 - r) * s; g += (240 - g) * s; b += (246 - b) * s;
  }
  c = `rgb(${Math.min(255, r) | 0},${Math.min(255, g) | 0},${Math.min(255, b) | 0})`;
  if (_mapCache.size > 60000) _mapCache.clear();
  _mapCache.set(key, c);
  return c;
}
const _c = new THREE.Color(), _c2 = new THREE.Color();
function groundColor(x, z, ny, h, out) {
  const w = biomeWeights(x, z, _wc);
  const patch = vnoise(x / 13 + 3.1, z / 13 - 7.7); // 斑驳色块
  const fine = vnoise(x / 3.7, z / 3.7);
  out.setRGB(0, 0, 0);
  for (let i = 0; i < NB; i++) {
    if (w[i] < 0.002) continue;
    const [a, b] = BIOME_COL[i];
    _c.copy(a).lerp(b, patch);
    out.r += _c.r * w[i]; out.g += _c.g * w[i]; out.b += _c.b * w[i];
  }
  // 陡坡露岩;雪原高处积雪更厚
  const steep = smooth(0.94, 0.8, ny);
  if (steep > 0) out.lerp(ROCK_COL, steep * 0.85);
  if (w[BIOME.snow] > 0.3) out.lerp(SNOWCAP, smooth(6, 12, h) * w[BIOME.snow] * (1 - steep));
  // 北境群山:山腰裸岩、山顶积雪(按山体自身高度,不看群系)
  const mh = mountainH(x, z);
  if (mh > 6) {
    out.lerp(ROCK_COL, smooth(6, 26, mh) * 0.55);
    out.lerp(SNOWCAP, smooth(36, 58, mh) * (1 - steep * 0.55));
  }
  // 水边:水下是泥滩(越深越暗),岸上两三米是潮湿的深色泥土
  const wp = waterProx(x, z);
  if (wp > -3.5) {
    if (h < 0) out.lerp(MUD_COL, Math.min(1, 0.55 + -h * 0.5));
    else out.lerp(BANK_COL, smooth(-3.5, 0.2, wp) * 0.55);
  }
  const k = 0.9 + fine * 0.2;
  out.r *= k; out.g *= k; out.b *= k;
  return out;
}
const MUD_COL = lin(0x3d3a2c), BANK_COL = lin(0x5a5338);
const _wc = new Float32Array(NB);

// ---------------- 地表材质(共享) ----------------
let groundMat = null;
function makeDetailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d6d6d6';
  g.fillRect(0, 0, 256, 256);
  // 细碎的颗粒与短草茎:中性灰,只提供明暗细节,颜色交给顶点色
  // 每个笔触在贴图四边"环绕"重画一遍:贴图严格无缝,地面上看不到 7m 一条的接缝
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const l = 150 + Math.random() * 105;
    g.fillStyle = `rgba(${l},${l},${l},${0.25 + Math.random() * 0.35})`;
    const dot = Math.random() < 0.55;
    const w = 1 + Math.random() * 2, h = dot ? 1 + Math.random() * 2 : 3 + Math.random() * 5, rot = Math.random() * Math.PI;
    for (const ox of [0, -256, 256]) {
      for (const oy of [0, -256, 256]) {
        const px = x + ox, py = y + oy;
        if (px < -10 || px > 266 || py < -10 || py > 266) continue;
        if (dot) g.fillRect(px, py, w, h);
        else { g.save(); g.translate(px, py); g.rotate(rot); g.fillRect(0, 0, 1, h); g.restore(); }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export function getGroundMaterial(normalMap) {
  if (groundMat) return groundMat;
  groundMat = new THREE.MeshStandardMaterial({
    map: makeDetailTexture(), vertexColors: true, roughness: 0.96, metalness: 0,
  });
  if (normalMap) {
    groundMat.normalMap = normalMap;
    groundMat.normalScale = new THREE.Vector2(0.45, 0.45);
  }
  groundMat.userData.wettable = true;
  groundMat.userData.baseRough = 0.96;
  groundMat.userData.shared = true;
  // 冬季积雪:平地先白,陡坡露土
  groundMat.userData.uSnow = { value: 0 };
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = groundMat.userData.uSnow;
    bindSurfaceUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSfW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSfW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow;
        ${SURFACE_UNIFORMS_GLSL}
        varying vec3 vSfW;
        ${NOISE_GLSL}
        ${PUDDLE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float snowK = uSnow * smoothstep(0.82, 0.96, normalize(vNormal).y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snowK);
        // 雨天:泥土整体压暗,平地上积出水洼(见 gfx/surface.js;积雪处不积水)
        diffuseColor.rgb *= 1.0 - 0.24 * uWet;
        ${PUDDLE_COLOR}
        sfPud *= 1.0 - snowK;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, uWet * 0.7);
        ${PUDDLE_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${PUDDLE_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${PUDDLE_EMISSIVE}`);
  };
  return groundMat;
}

// ---------------- 地表网格烘焙 ----------------
// 覆盖 [x0, x0+size] × [z0, z0+size],GRID 米一格;UV 走世界坐标,区块之间纹理无缝
export function buildGroundMesh(x0, z0, size, material) {
  const n = Math.round(size / GRID);
  const V = n + 1;
  const pos = new Float32Array(V * V * 3);
  const nor = new Float32Array(V * V * 3);
  const col = new Float32Array(V * V * 3);
  const uv = new Float32Array(V * V * 2);
  const ix0 = Math.round(x0 / GRID), iz0 = Math.round(z0 / GRID);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const gx = ix0 + i, gz = iz0 + j;
      const x = gx * GRID, z = gz * GRID;
      const h = cornerH(gx, gz);
      const k = j * V + i;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const dx = (cornerH(gx + 1, gz) - cornerH(gx - 1, gz)) / (2 * GRID);
      const dz = (cornerH(gx, gz + 1) - cornerH(gx, gz - 1)) / (2 * GRID);
      const inv = 1 / Math.sqrt(1 + dx * dx + dz * dz);
      nor[k * 3] = -dx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -dz * inv;
      groundColor(x, z, inv, h, _c2);
      col[k * 3] = _c2.r; col[k * 3 + 1] = _c2.g; col[k * 3 + 2] = _c2.b;
      uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1; // a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)
      idx[p++] = a; idx[p++] = d; idx[p++] = b; // 与 groundH 的 tx>=tz 三角一致
      idx[p++] = a; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.userData.noSnap = true;
  mesh.userData.isGround = true;
  return mesh;
}

// 核心王国地表:±512 米一整块
export function buildCoreGround(material) {
  return buildGroundMesh(-512, -512, 1024, material);
}
