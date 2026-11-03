// 植被系统:围绕玩家流式散布的实例化草木(纯视觉,不参与碰撞)
//
// 8 类程序化几何(草丛/高草/野花/蕨/芦苇/干草簇/雪草/碎石),每类一个 InstancedMesh,
// 一次绘制。按 16 米格子确定性生成(同一位置永远长同样的草),按群系权重挑类型与密度,
// 避开道路/建筑/水面(terrain.vegAllowed)与陡坡;顶点着色器做风吹摆动与远处渐隐。
import * as THREE from 'three';
import { groundH, groundNormalY, biomeWeights, vegAllowed, BIOME } from './terrain.js';

const CELL = 16;

// ---------------- 程序化几何 ----------------
// 每个顶点带 aH(0 根 → 1 梢,决定风摆幅度与明暗渐变)与 aTint(1=随实例色,0=保持本色,用于花茎)
function makeGeo(build) {
  const P = [], N = [], C = [], H = [], T = [], I = [];
  const api = {
    v(x, y, z, nx, ny, nz, r, g, b, h, tint = 1) {
      P.push(x, y, z); N.push(nx, ny, nz); C.push(r, g, b); H.push(h); T.push(tint);
      return P.length / 3 - 1;
    },
    tri(a, b, c) { I.push(a, b, c); },
  };
  build(api);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(T, 1));
  g.setIndex(I);
  return g;
}
// 一片弯曲叶片:从根部沿方向 a 外倾,宽度渐尖;法线偏向上方(草地读起来像一片而不是一根根)
function blade(api, a, h, w, bend, segs, base = 0.5, tip = 1.0, lean = 0) {
  const dx = Math.cos(a), dz = Math.sin(a);
  const px = -dz, pz = dx;
  let prevL = -1, prevR = -1;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const r = (lean + bend * t * t) * h;
    const y = h * t * (1 - 0.25 * bend * t);
    const half = w * (1 - t * 0.92) * 0.5;
    const cx = dx * r, cz = dz * r;
    const shade = base + (tip - base) * t;
    const nx = dx * 0.35, ny = 1, nz = dz * 0.35;
    const L = api.v(cx - px * half, y, cz - pz * half, nx, ny, nz, shade, shade, shade, t);
    const R = api.v(cx + px * half, y, cz + pz * half, nx, ny, nz, shade, shade, shade, t);
    if (prevL >= 0) { api.tri(prevL, prevR, R); api.tri(prevL, R, L); }
    prevL = L; prevR = R;
  }
}
function rngOf(seed) {
  let s = (seed % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const GEO = {};
function buildGeometries() {
  const r = rngOf(9127);
  GEO.grass = makeGeo((api) => { // tussock 草丛:14 片细叶拢成一蓬,外圈外翻、内圈直立
    for (let i = 0; i < 14; i++) {
      const inner = i % 2 === 0;
      blade(api, (i / 14) * Math.PI * 2 + r() * 0.4, (inner ? 0.62 : 0.46) + r() * 0.24, 0.055,
        inner ? 0.25 + r() * 0.2 : 0.55 + r() * 0.3, 2, 0.5, 1.05, inner ? 0.02 : 0.06);
    }
  });
  GEO.tall = makeGeo((api) => { // 高草:细长直立,风里最活
    for (let i = 0; i < 7; i++) blade(api, (i / 7) * Math.PI * 2 + r(), 0.8 + r() * 0.45, 0.06, 0.25 + r() * 0.2, 3, 0.5, 1.05, 0.04);
  });
  GEO.fern = makeGeo((api) => { // 蕨:6 片宽羽叶,大幅外弯
    for (let i = 0; i < 6; i++) blade(api, (i / 6) * Math.PI * 2 + r() * 0.3, 0.55 + r() * 0.2, 0.24, 1.15, 3, 0.4, 0.95, 0.08);
  });
  GEO.reed = makeGeo((api) => { // 芦苇:直立长茎 + 香蒲穗
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, h = 1.3 + r() * 0.7;
      blade(api, a, h, 0.05, 0.12, 3, 0.55, 1.0, 0.08 + r() * 0.06);
      const ox = Math.cos(a) * (0.08 + 0.12) * h, oz = Math.sin(a) * (0.08 + 0.12) * h;
      const y0 = h * 0.82, y1 = h * 0.97, w2 = 0.045;
      const b = api.v(ox - w2, y0, oz, 0, 1, 0, 0.42, 0.3, 0.2, 0.9, 0);
      const c = api.v(ox + w2, y0, oz, 0, 1, 0, 0.42, 0.3, 0.2, 0.9, 0);
      const d = api.v(ox + w2, y1, oz, 0, 1, 0, 0.36, 0.25, 0.17, 1, 0);
      const e = api.v(ox - w2, y1, oz, 0, 1, 0, 0.36, 0.25, 0.17, 1, 0);
      api.tri(b, c, d); api.tri(b, d, e);
    }
  });
  GEO.dry = makeGeo((api) => { // 干草簇:短硬尖叶
    for (let i = 0; i < 8; i++) blade(api, (i / 8) * Math.PI * 2 + r() * 0.6, 0.28 + r() * 0.2, 0.06, 0.8, 1, 0.55, 1.0, 0.02);
  });
  GEO.snowtuft = makeGeo((api) => { // 雪草:稀疏挂霜
    for (let i = 0; i < 6; i++) blade(api, (i / 6) * Math.PI * 2 + r(), 0.3 + r() * 0.2, 0.06, 0.5, 2, 0.6, 1.0, 0.02);
  });
  GEO.flower = makeGeo((api) => { // 野花:绿茎(不染色)+ 十字花冠(染实例色)
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2, h = 0.32 + r() * 0.22;
      const ox = Math.cos(a) * 0.12, oz = Math.sin(a) * 0.12;
      const s0 = api.v(ox - 0.012, 0, oz, 0, 1, 0, 0.25, 0.45, 0.2, 0, 0);
      const s1 = api.v(ox + 0.012, 0, oz, 0, 1, 0, 0.25, 0.45, 0.2, 0, 0);
      const s2 = api.v(ox + 0.012, h, oz, 0, 1, 0, 0.3, 0.5, 0.22, 1, 0);
      const s3 = api.v(ox - 0.012, h, oz, 0, 1, 0, 0.3, 0.5, 0.22, 1, 0);
      api.tri(s0, s1, s2); api.tri(s0, s2, s3);
      const R = 0.075;
      for (let q = 0; q < 2; q++) {
        const ca = q === 0 ? 1 : 0, sa = q === 0 ? 0 : 1;
        const p0 = api.v(ox - R * ca, h, oz - R * sa, 0, 1, 0, 1, 1, 1, 1);
        const p1 = api.v(ox + R * ca, h, oz + R * sa, 0, 1, 0, 1, 1, 1, 1);
        const p2 = api.v(ox + R * ca * 0.2, h + 0.05, oz + R * sa * 0.2, 0, 1, 0, 1, 1, 1, 1);
        const p3 = api.v(ox - R * sa, h + 0.01, oz + R * ca, 0, 1, 0, 1, 1, 1, 1);
        api.tri(p0, p1, p2); api.tri(p0, p3, p1);
      }
    }
  });
  GEO.pebble = (() => { // 碎石:压扁的二十面体,带一点不规则
    const ico = new THREE.IcosahedronGeometry(0.22, 0);
    const pos = ico.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) * 0.55 + 0.06);
      pos.setX(i, pos.getX(i) * (0.85 + ((i * 37) % 7) / 20));
    }
    ico.computeVertexNormals();
    const n = pos.count;
    // 底暗顶亮:碎石"坐"在地上而不是浮着的白片
    const cols = [];
    for (let i = 0; i < n; i++) { const k = 0.38 + Math.max(0, pos.getY(i)) * 2.2; cols.push(k, k, k); }
    ico.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    ico.setAttribute('aH', new THREE.Float32BufferAttribute(new Array(n).fill(0), 1));
    ico.setAttribute('aTint', new THREE.Float32BufferAttribute(new Array(n).fill(1), 1));
    return ico;
  })();
}

// ---------------- 群系配方 ----------------
// 每格(256 ㎡)的期望株数;颜色用 HSL 区间 [h0,h1, s, l0,l1]
const RECIPE = {
  [BIOME.plains]: { n: 120, mix: [['grass', 62], ['tall', 26], ['flower', 9], ['pebble', 3]] },
  [BIOME.hills]: { n: 120, mix: [['grass', 55], ['tall', 33], ['flower', 8], ['pebble', 4]] },
  [BIOME.forest]: { n: 100, mix: [['grass', 30], ['fern', 52], ['flower', 6], ['pebble', 4], ['tall', 8]] },
  [BIOME.desert]: { n: 20, mix: [['dry', 70], ['pebble', 30]] },
  [BIOME.snow]: { n: 26, mix: [['snowtuft', 65], ['pebble', 35]] },
  [BIOME.swamp]: { n: 110, mix: [['reed', 48], ['grass', 34], ['fern', 12], ['tall', 6]] },
  [BIOME.ash]: { n: 30, mix: [['dry', 55], ['pebble', 45]] },
  [BIOME.rock]: { n: 50, mix: [['pebble', 35], ['dry', 25], ['grass', 40]] },
};
const COLOR = {
  grass: { [BIOME.plains]: [0.11, 0.17, 0.36, 0.34, 0.5], [BIOME.hills]: [0.15, 0.22, 0.38, 0.33, 0.47],
    [BIOME.forest]: [0.2, 0.27, 0.4, 0.26, 0.38], [BIOME.swamp]: [0.16, 0.22, 0.32, 0.22, 0.32],
    [BIOME.rock]: [0.12, 0.17, 0.22, 0.38, 0.5] },
  tall: { def: [0.1, 0.15, 0.4, 0.45, 0.6], [BIOME.forest]: [0.18, 0.24, 0.35, 0.34, 0.46] },
  fern: { def: [0.25, 0.31, 0.45, 0.22, 0.34], [BIOME.swamp]: [0.2, 0.26, 0.35, 0.2, 0.3] },
  reed: { def: [0.12, 0.16, 0.32, 0.32, 0.44] },
  dry: { def: [0.08, 0.11, 0.38, 0.45, 0.6], [BIOME.ash]: [0.06, 0.08, 0.08, 0.16, 0.24],
    [BIOME.rock]: [0.09, 0.12, 0.2, 0.42, 0.52] },
  snowtuft: { def: [0.55, 0.6, 0.1, 0.72, 0.86] },
  pebble: { def: [0.08, 0.1, 0.06, 0.42, 0.58], [BIOME.desert]: [0.08, 0.1, 0.32, 0.55, 0.68],
    [BIOME.ash]: [0.05, 0.08, 0.06, 0.18, 0.28], [BIOME.snow]: [0.58, 0.6, 0.06, 0.5, 0.62] },
};
const FLOWER_COLS = [0xf2d95c, 0xf4f1e6, 0xb48fd8, 0x7aa4e0, 0xd9584a, 0xf0a046];
const CAP = { grass: 7000, tall: 3800, fern: 3000, reed: 3200, dry: 1800, snowtuft: 1400, flower: 1500, pebble: 2000 };
const TYPES = Object.keys(CAP);

// ---------------- 材质:风摆 + 远处渐隐 + 季节色 ----------------
const uniforms = {
  uTime: { value: 0 }, uWind: { value: 1 }, uCenter: { value: new THREE.Vector2() },
  uRadius: { value: 64 }, uSeason: { value: new THREE.Color(1, 1, 1) }, uFrost: { value: 0 },
};
function makeMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aH;
        attribute float aTint;
        uniform float uTime, uWind, uRadius;
        uniform vec2 uCenter;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aTint);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float ph = uTime * 1.6 + ip.x * 0.13 + ip.y * 0.09;
        float sway = (sin(ph) * 0.65 + sin(ph * 2.7 + ip.x * 0.5) * 0.25) * uWind;
        float hh = aH * aH;
        transformed.x += sway * hh * 0.22;
        transformed.z += sway * hh * 0.11;
        float fade = 1.0 - smoothstep(uRadius * 0.72, uRadius, distance(ip, uCenter));
        transformed *= fade;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal); // 草叶不分正反面:一律按朝上的法线受光,避免背面发黑`)
      .replace('#include <common>', `#include <common>
        uniform vec3 uSeason;
        uniform float uFrost;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= uSeason;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.87, 0.93), uFrost);`);
  };
  return m;
}

// ---------------- 散布 ----------------
let meshes = null;
let scene = null;
let density = 1;
let lastX = 1e9, lastZ = 1e9;
const cellCache = new Map(); // key → { [type]: { m: Float32Array, c: Float32Array, n } }
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _col = new THREE.Color();
const _bw = new Float32Array(8);

function cellSeed(cx, cz) {
  let h = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function pickWeighted(rng, mix) {
  let tot = 0;
  for (const [, w] of mix) tot += w;
  let r = rng() * tot;
  for (const [t, w] of mix) { r -= w; if (r <= 0) return t; }
  return mix[mix.length - 1][0];
}
function genCell(cx, cz) {
  const rng = rngOf(cellSeed(cx, cz));
  const out = {};
  for (const t of TYPES) out[t] = { m: [], c: [] };
  const x0 = cx * CELL, z0 = cz * CELL;
  const w0 = biomeWeights(x0 + CELL / 2, z0 + CELL / 2, _bw);
  let expect = 0;
  for (let b = 0; b < 8; b++) if (w0[b] > 0) expect += w0[b] * (RECIPE[b] ? RECIPE[b].n : 60);
  const count = Math.round(expect * density);
  for (let i = 0; i < count; i++) {
    const x = x0 + rng() * CELL, z = z0 + rng() * CELL;
    if (!vegAllowed(x, z)) continue;
    const w = biomeWeights(x, z, _bw);
    let r = rng(), b = 0;
    for (; b < 7; b++) { r -= w[b]; if (r <= 0) break; }
    const rec = RECIPE[b] || RECIPE[BIOME.plains];
    const type = pickWeighted(rng, rec.mix);
    const ny = groundNormalY(x, z);
    if (type !== 'pebble' && ny < 0.82) continue; // 陡坡不长草
    const y = groundH(x, z);
    const sc = type === 'pebble' ? 0.4 + rng() * rng() * 1.4 : 0.7 + rng() * 0.6; // 碎石多小少大
    _e.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15);
    _q.setFromEuler(_e);
    _s.set(sc, sc * (type === 'pebble' ? 0.7 + rng() * 0.6 : 0.8 + rng() * 0.5), sc);
    _p.set(x, y - 0.02, z);
    _m4.compose(_p, _q, _s);
    out[type].m.push(..._m4.elements);
    if (type === 'flower') {
      _col.setHex(FLOWER_COLS[Math.floor(rng() * FLOWER_COLS.length)]);
    } else {
      const tbl = COLOR[type];
      const [h0, h1, s, l0, l1] = tbl[b] || tbl.def || tbl[BIOME.plains];
      _col.setHSL(h0 + (h1 - h0) * rng(), s, l0 + (l1 - l0) * rng());
    }
    out[type].c.push(_col.r, _col.g, _col.b);
  }
  for (const t of TYPES) {
    out[t].n = out[t].c.length / 3;
    out[t].m = new Float32Array(out[t].m);
    out[t].c = new Float32Array(out[t].c);
  }
  return out;
}

export function initVegetation(sc) {
  scene = sc;
  buildGeometries();
  const mat = makeMaterial();
  meshes = {};
  for (const t of TYPES) {
    const im = new THREE.InstancedMesh(GEO[t], mat, CAP[t]);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.setColorAt(0, new THREE.Color(1, 1, 1)); // 建出 instanceColor 缓冲
    im.count = 0;
    im.frustumCulled = false;   // 实例跟着玩家流动,包围球不可信
    im.receiveShadow = true;
    im.castShadow = false;
    im.userData.noSnap = true;  // 矩阵里已是绝对高度
    scene.add(im);
    meshes[t] = im;
  }
}

// 画质档位:0.35~1.3(影响密度与半径)
export function setVegetationDensity(d) {
  density = d;
  uniforms.uRadius.value = 40 + 30 * Math.min(1, d);
  cellCache.clear();
  lastX = 1e9;
}
export function setVegetationSeason(seasonIdx) {
  const T = [[1, 1.02, 0.96], [0.96, 1, 0.88], [1.18, 0.96, 0.66], [1.02, 1.06, 1.14]];
  uniforms.uSeason.value.setRGB(...T[seasonIdx] || T[0]);
  uniforms.uFrost.value = seasonIdx === 3 ? 0.45 : 0;
}

export function updateVegetation(dt, px, pz, windK = 1) {
  if (!meshes) return;
  uniforms.uTime.value += dt;
  uniforms.uWind.value += (windK - uniforms.uWind.value) * Math.min(1, dt * 0.8);
  uniforms.uCenter.value.set(px, pz);
  if (Math.hypot(px - lastX, pz - lastZ) < 8) return;
  lastX = px; lastZ = pz;
  const R = uniforms.uRadius.value;
  const pcx = Math.floor(px / CELL), pcz = Math.floor(pz / CELL);
  const rc = Math.ceil(R / CELL) + 1;
  // 由近到远收集格子:装不下时丢最远的
  const cells = [];
  for (let dz = -rc; dz <= rc; dz++) {
    for (let dx = -rc; dx <= rc; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const ccx = (cx + 0.5) * CELL - px, ccz = (cz + 0.5) * CELL - pz;
      const d2 = ccx * ccx + ccz * ccz;
      if (d2 > (R + CELL) * (R + CELL)) continue;
      cells.push([d2, cx, cz]);
    }
  }
  cells.sort((a, b) => a[0] - b[0]);
  const fill = {};
  for (const t of TYPES) fill[t] = 0;
  const keep = new Set();
  for (const [, cx, cz] of cells) {
    const key = cx * 100003 + cz;
    keep.add(key);
    let c = cellCache.get(key);
    if (!c) { c = genCell(cx, cz); cellCache.set(key, c); }
    for (const t of TYPES) {
      const src = c[t];
      if (!src.n) continue;
      const im = meshes[t];
      const room = CAP[t] - fill[t];
      const k = Math.min(room, src.n);
      if (k <= 0) continue;
      im.instanceMatrix.array.set(k === src.n ? src.m : src.m.subarray(0, k * 16), fill[t] * 16);
      im.instanceColor.array.set(k === src.n ? src.c : src.c.subarray(0, k * 3), fill[t] * 3);
      fill[t] += k;
    }
  }
  for (const t of TYPES) {
    const im = meshes[t];
    im.count = fill[t];
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
  }
  // 缓存只留在视野附近的格子
  if (cellCache.size > keep.size * 2 + 64) {
    for (const k of cellCache.keys()) if (!keep.has(k)) cellCache.delete(k);
  }
}
