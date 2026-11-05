// 植被系统:围绕玩家流式散布的实例化草木(纯视觉,不参与碰撞)
//
// 13 类程序化几何(草丛/高草/野花/蕨/芦苇/干草簇/雪草/碎石/林下灌木/蘑菇/龙舌兰/枯灌木/冰晶),每类一个 InstancedMesh,
// 一次绘制。按 16 米格子确定性生成(同一位置永远长同样的草),按群系权重挑类型与密度,
// 避开道路/建筑/水面(terrain.vegAllowed)与陡坡;顶点着色器做风吹摆动与远处渐隐。
// 中远景另有一圈"草片"(宽矮的大草簇,32 米格,近处草淡出的地方淡入),远处原野不再只剩光秃的地皮。
// 草叶受光:透光(逆光时叶片发亮)+ 包裹光 + 最低环境光——低角度阳光下不发黑、不发褐(光照由 sky.js 每帧给)。
import * as THREE from 'three';
import { groundH, groundNormalY, biomeWeights, vegAllowed, BIOME } from './terrain.js';
import { waterProx } from './waterbodies.js';

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
  GEO.shrub = makeGeo((api) => { // 林下灌木:一蓬外翻的宽叶 + 中间直立的嫩叶,半人高
    for (let i = 0; i < 9; i++) {
      blade(api, (i / 9) * Math.PI * 2 + r() * 0.5, 0.62 + r() * 0.3, 0.3, 0.9 + r() * 0.4, 3, 0.42, 0.95, 0.1 + r() * 0.1);
    }
    for (let i = 0; i < 5; i++) blade(api, (i / 5) * Math.PI * 2 + r(), 0.85 + r() * 0.3, 0.22, 0.45, 3, 0.5, 1.05, 0.04);
  });
  GEO.mushroom = makeGeo((api) => { // 蘑菇:三朵一簇,白茎(不染色)+ 伞盖(染实例色)
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2, d = k ? 0.08 + r() * 0.1 : 0, h = 0.09 + r() * 0.08, R = 0.05 + h * 0.45;
      const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
      for (let q = 0; q < 2; q++) { // 十字茎
        const ca = q ? 0 : 0.012, sa = q ? 0.012 : 0;
        const s0 = api.v(ox - ca, 0, oz - sa, 0, 1, 0, 0.86, 0.82, 0.74, 0, 0);
        const s1 = api.v(ox + ca, 0, oz + sa, 0, 1, 0, 0.86, 0.82, 0.74, 0, 0);
        const s2 = api.v(ox + ca, h, oz + sa, 0, 1, 0, 0.9, 0.86, 0.78, 0.4, 0);
        const s3 = api.v(ox - ca, h, oz - sa, 0, 1, 0, 0.9, 0.86, 0.78, 0.4, 0);
        api.tri(s0, s1, s2); api.tri(s0, s2, s3);
      }
      const top = api.v(ox, h + R * 0.55, oz, 0, 1, 0, 1, 1, 1, 0.5);
      const ring = [];
      for (let j = 0; j < 7; j++) {
        const b = (j / 7) * Math.PI * 2;
        ring.push(api.v(ox + Math.cos(b) * R, h - 0.01, oz + Math.sin(b) * R, Math.cos(b) * 0.5, 0.8, Math.sin(b) * 0.5, 0.8, 0.8, 0.8, 0.45));
      }
      for (let j = 0; j < 7; j++) api.tri(top, ring[(j + 1) % 7], ring[j]);
    }
  });
  GEO.succulent = makeGeo((api) => { // 荒漠龙舌兰:一圈肥厚的尖叶向外摊开
    for (let i = 0; i < 9; i++) {
      blade(api, (i / 9) * Math.PI * 2 + r() * 0.3, 0.32 + r() * 0.18, 0.14, 0.7 + r() * 0.5, 2, 0.6, 1.0, 0.12);
    }
    for (let i = 0; i < 4; i++) blade(api, (i / 4) * Math.PI * 2 + 0.4, 0.42, 0.1, 0.2, 2, 0.7, 1.05, 0.02);
  });
  GEO.deadbush = makeGeo((api) => { // 枯灌木 / 风滚草:一团四散的细枝
    for (let i = 0; i < 16; i++) {
      blade(api, r() * Math.PI * 2, 0.35 + r() * 0.3, 0.03, 0.4 + r() * 1.0, 2, 0.7, 1.0, 0.2 + r() * 0.4);
    }
  });
  GEO.icecrystal = makeGeo((api) => { // 冰晶:几根斜插出地面的三棱冰锥
    for (let k = 0; k < 5; k++) {
      const a = r() * Math.PI * 2, d = k ? 0.08 + r() * 0.12 : 0, h = 0.35 + r() * 0.45, w = 0.05 + r() * 0.03;
      const lx = Math.cos(a) * 0.35 * h, lz = Math.sin(a) * 0.35 * h; // 向外斜
      const ox = Math.cos(a) * d, oz = Math.sin(a) * d;
      const tip = api.v(ox + lx, h, oz + lz, Math.cos(a), 0.6, Math.sin(a), 1, 1, 1, 1);
      const base = [];
      for (let j = 0; j < 3; j++) {
        const b = a + (j / 3) * Math.PI * 2;
        base.push(api.v(ox + Math.cos(b) * w, -0.02, oz + Math.sin(b) * w, Math.cos(b), 0.3, Math.sin(b), 0.7, 0.72, 0.78, 0));
      }
      for (let j = 0; j < 3; j++) api.tri(base[j], base[(j + 1) % 3], tip);
    }
  });
  GEO.patch = makeGeo((api) => { // 中远景草片:宽而矮的一大簇(远看是一块有起伏的草皮)
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.5;
      blade(api, a, 0.5 + r() * 0.3, 0.2, 0.7 + r() * 0.5, 1, 0.55, 1.0, 0.35 + r() * 0.3);
    }
  });
  // ---- 作物(农田/菜园,见 buildCropMesh):麦丛 / 卷心菜 / 葱韭 ----
  GEO.wheat = makeGeo((api) => { // 麦:细直茎 + 顶端饱满的纺锤形麦穗(六棱、带芒,微微低头;穗不随实例色,保持金黄)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r() * 0.5, h = 0.78 + r() * 0.22;
      blade(api, a, h, 0.03, 0.12 + r() * 0.1, 2, 0.55, 0.95, 0.03);
      const ox = Math.cos(a) * (0.03 + 0.17 * h * 0.5), oz = Math.sin(a) * (0.03 + 0.17 * h * 0.5);
      const nod = 0.05 + r() * 0.04; // 穗头朝外垂一点
      const tx = Math.cos(a) * nod, tz = Math.sin(a) * nod;
      const y0 = h * 0.8, ym = h * 0.92, y1 = h * 1.06, R = 0.024 + r() * 0.006;
      const ring = (y, k, rad, sh) => {
        const out = [];
        for (let j = 0; j < 6; j++) {
          const b = (j / 6) * Math.PI * 2;
          const nx = Math.cos(b), nz = Math.sin(b);
          out.push(api.v(ox + tx * k + nx * rad, y, oz + tz * k + nz * rad, nx, 0.4, nz, 0.86 * sh, 0.7 * sh, 0.36 * sh, 0.85 + 0.15 * k, 0));
        }
        return out;
      };
      const A = ring(y0, 0, R * 0.55, 0.85), B = ring(ym, 0.55, R, 1.0);
      const tip = api.v(ox + tx, y1, oz + tz, 0, 1, 0, 0.95, 0.82, 0.48, 1, 0);
      for (let j = 0; j < 6; j++) {
        const j2 = (j + 1) % 6;
        api.tri(A[j], B[j], B[j2]); api.tri(A[j], B[j2], A[j2]);
        api.tri(B[j], tip, B[j2]);
      }
      // 两根麦芒
      for (const s2 of [-1, 1]) {
        const b0 = api.v(ox + tx - 0.004 * s2, y1 - 0.02, oz + tz, 0, 1, 0, 0.9, 0.8, 0.5, 1, 0);
        const b1 = api.v(ox + tx + 0.004 * s2, y1 - 0.02, oz + tz, 0, 1, 0, 0.9, 0.8, 0.5, 1, 0);
        const b2 = api.v(ox + tx * 1.6 + 0.02 * s2, y1 + 0.07, oz + tz * 1.6, 0, 1, 0, 0.92, 0.84, 0.56, 1, 0);
        api.tri(b0, b1, b2);
      }
    }
  });
  GEO.cabbage = makeGeo((api) => { // 卷心菜:一圈外翻宽叶 + 中心叶球
    for (let i = 0; i < 7; i++) blade(api, (i / 7) * Math.PI * 2 + r() * 0.3, 0.26 + r() * 0.06, 0.26, 1.35, 2, 0.55, 1.0, 0.05);
    for (let i = 0; i < 4; i++) blade(api, (i / 4) * Math.PI * 2 + 0.4, 0.2, 0.2, 0.55, 2, 0.75, 1.1, 0.0);
  });
  GEO.greens = makeGeo((api) => { // 葱韭:一把直立细叶
    for (let i = 0; i < 6; i++) blade(api, (i / 6) * Math.PI * 2 + r() * 0.6, 0.32 + r() * 0.14, 0.045, 0.18, 2, 0.5, 1.0, 0.02);
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
  [BIOME.plains]: { n: 120, mix: [['grass', 64], ['tall', 22], ['flower', 10], ['pebble', 2], ['shrub', 2]] },
  [BIOME.hills]: { n: 120, mix: [['grass', 62], ['tall', 24], ['flower', 9], ['pebble', 3], ['shrub', 2]] },
  [BIOME.forest]: { n: 130, mix: [['grass', 26], ['fern', 40], ['shrub', 16], ['mushroom', 5], ['flower', 4], ['pebble', 3], ['tall', 6]] },
  [BIOME.desert]: { n: 26, mix: [['dry', 50], ['pebble', 24], ['succulent', 14], ['deadbush', 12]] },
  [BIOME.snow]: { n: 30, mix: [['snowtuft', 55], ['pebble', 30], ['icecrystal', 15]] },
  [BIOME.swamp]: { n: 110, mix: [['reed', 46], ['grass', 30], ['fern', 10], ['shrub', 6], ['mushroom', 3], ['tall', 5]] },
  [BIOME.ash]: { n: 30, mix: [['dry', 40], ['pebble', 40], ['deadbush', 20]] },
  [BIOME.rock]: { n: 50, mix: [['pebble', 35], ['dry', 22], ['grass', 37], ['succulent', 6]] },
};
const COLOR = {
  grass: { [BIOME.plains]: [0.19, 0.27, 0.46, 0.25, 0.37], [BIOME.hills]: [0.2, 0.28, 0.44, 0.25, 0.38],
    [BIOME.forest]: [0.22, 0.29, 0.42, 0.24, 0.36], [BIOME.swamp]: [0.17, 0.23, 0.32, 0.22, 0.32],
    [BIOME.rock]: [0.13, 0.19, 0.24, 0.36, 0.48] },
  tall: { def: [0.15, 0.23, 0.42, 0.28, 0.4], [BIOME.forest]: [0.19, 0.25, 0.36, 0.3, 0.42] },
  shrub: { def: [0.24, 0.31, 0.38, 0.2, 0.3], [BIOME.swamp]: [0.2, 0.26, 0.3, 0.18, 0.26],
    [BIOME.plains]: [0.2, 0.27, 0.36, 0.24, 0.32] },
  mushroom: { def: [0.0, 0.08, 0.55, 0.38, 0.62] },
  succulent: { def: [0.36, 0.44, 0.24, 0.32, 0.44] },
  deadbush: { def: [0.07, 0.1, 0.28, 0.3, 0.42], [BIOME.ash]: [0.05, 0.08, 0.1, 0.12, 0.2] },
  icecrystal: { def: [0.52, 0.57, 0.4, 0.74, 0.88] },
  fern: { def: [0.25, 0.31, 0.45, 0.22, 0.34], [BIOME.swamp]: [0.2, 0.26, 0.35, 0.2, 0.3] },
  reed: { def: [0.12, 0.16, 0.32, 0.32, 0.44] },
  dry: { def: [0.08, 0.11, 0.38, 0.45, 0.6], [BIOME.ash]: [0.06, 0.08, 0.08, 0.16, 0.24],
    [BIOME.rock]: [0.09, 0.12, 0.2, 0.42, 0.52] },
  snowtuft: { def: [0.55, 0.6, 0.1, 0.72, 0.86] },
  pebble: { def: [0.08, 0.1, 0.06, 0.42, 0.58], [BIOME.desert]: [0.08, 0.1, 0.32, 0.55, 0.68],
    [BIOME.ash]: [0.05, 0.08, 0.06, 0.18, 0.28], [BIOME.snow]: [0.58, 0.6, 0.06, 0.5, 0.62] },
};
const FLOWER_COLS = [0xf2d95c, 0xf4f1e6, 0xb48fd8, 0x7aa4e0, 0xd9584a, 0xf0a046];
const CAP = { grass: 7000, tall: 3800, fern: 3000, reed: 3200, dry: 1800, snowtuft: 1400, flower: 1500, pebble: 2000,
  shrub: 1600, mushroom: 700, succulent: 900, deadbush: 900, icecrystal: 700 };
const TYPES = Object.keys(CAP);

// ---------------- 材质:风摆 + 远处渐隐(中远景草片另有近处淡入)+ 季节色 + 草叶受光 ----------------
const uniforms = {
  uTime: { value: 0 }, uWind: { value: 1 }, uCenter: { value: new THREE.Vector2() },
  uRadius: { value: 64 }, uInner: { value: 0 }, uSeason: { value: new THREE.Color(1, 1, 1) }, uFrost: { value: 0 },
  // 受光(sky.js 每帧经 setVegetationLight 写):太阳方向(世界)、透光色(含强度)、最低环境光
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(0, 0, 0) },
  uAmbMin: { value: new THREE.Color(0.08, 0.09, 0.08) },
};
function makeMaterial(u = uniforms) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.userData.vegUniforms = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.vegUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aH;
        attribute float aTint;
        uniform float uTime, uWind, uRadius, uInner;
        uniform vec2 uCenter;
        varying float vVegH;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(color.xyz, color.xyz * instanceColor.xyz, aTint);
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vVegH = aH;
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float ph = uTime * 1.6 + ip.x * 0.13 + ip.y * 0.09;
        float sway = (sin(ph) * 0.65 + sin(ph * 2.7 + ip.x * 0.5) * 0.25) * uWind;
        float hh = aH * aH;
        transformed.x += sway * hh * 0.22;
        transformed.z += sway * hh * 0.11;
        float dc = distance(ip, uCenter);
        float fade = 1.0 - smoothstep(uRadius * 0.72, uRadius, dc);
        if (uInner > 0.0) fade *= smoothstep(uInner * 0.78, uInner, dc); // 中远景草片:近处让给细草
        transformed *= fade;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal); // 草叶不分正反面:一律按朝上的法线受光,避免背面发黑`)
      .replace('#include <common>', `#include <common>
        uniform vec3 uSeason, uSunDir, uSunCol, uAmbMin;
        uniform float uFrost;
        varying float vVegH;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= uSeason;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.87, 0.93), uFrost);`)
      .replace('#include <opaque_fragment>', `
        {
          // 草叶是竖着的薄片:法线按朝上算(不分正反面),低角度的阳光其实照在叶片侧面——补上这份侧光,
          // 黄昏的草是金色而不是褐色尖刺;逆光时叶尖透光发亮;再给一层最低环境光
          vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float back = pow(clamp(dot(-normalize(vViewPosition), sunV), 0.0, 1.0), 2.5);
          float side = (1.0 - clamp(uSunDir.y, 0.0, 1.0)) * 0.9;
          float tipK = 0.35 + 0.65 * vVegH;
          outgoingLight += diffuseColor.rgb * uSunCol * (0.12 + side + 0.5 * back) * tipK;
          outgoingLight = max(outgoingLight, diffuseColor.rgb * uAmbMin);
        }
        #include <opaque_fragment>`);
  };
  return m;
}
// 草叶受光(sky.js 每帧调用):sunDir 世界方向(指向太阳),sunCol 已含强度,amb 最低环境光(线性色)
export function setVegetationLight(sunDir, sunCol, amb) {
  uniforms.uSunDir.value.copy(sunDir);
  uniforms.uSunCol.value.copy(sunCol);
  uniforms.uAmbMin.value.copy(amb);
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
    let type = pickWeighted(rng, rec.mix);
    const wp = waterProx(x, z); // 水边:芦苇成片(湖岸/河岸/塘边),越靠水越密
    if (wp > -3.2 && b !== BIOME.snow && b !== BIOME.desert && rng() < 0.85 - (wp < -1.6 ? 0.35 : 0)) type = 'reed';
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
  // 中远景草片:同一着色器(程序共用),另一套半径——近处淡入、远处淡出
  farMesh = new THREE.InstancedMesh(GEO.patch, makeMaterial(farU), FAR_CAP);
  farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  farMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  farMesh.count = 0;
  farMesh.frustumCulled = false;
  farMesh.receiveShadow = true;
  farMesh.castShadow = false;
  farMesh.userData.noSnap = true;
  scene.add(farMesh);
}

// 画质档位:0.35~1.3(影响密度与半径)
export function setVegetationDensity(d) {
  density = d;
  uniforms.uRadius.value = 40 + 30 * Math.min(1, d);
  farU.uRadius.value = 95 + 65 * Math.min(1, d);
  farU.uInner.value = uniforms.uRadius.value * 0.88;
  cellCache.clear();
  farCache.clear();
  lastX = 1e9;
  farLastX = 1e9;
}
export function getVegetationDensity() { return density; }
export function setVegetationSeason(seasonIdx) {
  const T = [[1, 1.02, 0.96], [0.96, 1, 0.88], [1.18, 0.96, 0.66], [1.02, 1.06, 1.14]];
  uniforms.uSeason.value.setRGB(...T[seasonIdx] || T[0]);
  uniforms.uFrost.value = seasonIdx === 3 ? 0.45 : 0;
}

// 窗口跟着玩家走:每走 8m 重排一次。新进窗口的格子要现生成(每格上百株,逐株查地形/群系/坡度),
// 一帧最多花 GEN_MS 毫秒生成,没生成完的下一帧接着来;全部就绪才一次性重填实例缓冲。
// 传送、骑马疾驰、改画质时不再一帧生成几十格(实测那一帧 6~14ms),草晚一两帧铺满(远处本来就渐隐)
const GEN_MS = 1.2;
let want = null; // 待铺的窗口 { x, z, density, cells }
export function updateVegetation(dt, px, pz, windK = 1) {
  if (!meshes) return;
  uniforms.uTime.value += dt;
  uniforms.uWind.value += (windK - uniforms.uWind.value) * Math.min(1, dt * 0.8);
  uniforms.uCenter.value.set(px, pz);
  if (Math.hypot(px - farLastX, pz - farLastZ) >= 16) updateFar(px, pz); // 中远景草片:每走 16m 重铺
  if (want && (want.density !== density || Math.hypot(px - want.x, pz - want.z) >= 8)) want = null;
  if (!want) {
    if (Math.hypot(px - lastX, pz - lastZ) < 8) return;
    want = { x: px, z: pz, density, cells: windowCells(px, pz) };
  }
  const t0 = performance.now();
  for (const [, cx, cz] of want.cells) {
    const key = cx * 100003 + cz;
    if (cellCache.has(key)) continue;
    if (performance.now() - t0 > GEN_MS) return; // 余下的格子下一帧再生成
    cellCache.set(key, genCell(cx, cz));
  }
  lastX = want.x; lastZ = want.z;
  fillCells(want.cells);
  want = null;
}
// 由近到远收集窗口里的格子:装不下时丢最远的
function windowCells(px, pz) {
  const R = uniforms.uRadius.value;
  const pcx = Math.floor(px / CELL), pcz = Math.floor(pz / CELL);
  const rc = Math.ceil(R / CELL) + 1;
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
  return cells;
}
function fillCells(cells) {
  const fill = {};
  for (const t of TYPES) fill[t] = 0;
  const keep = new Set();
  for (const [, cx, cz] of cells) {
    const key = cx * 100003 + cz;
    keep.add(key);
    const c = cellCache.get(key);
    if (!c) continue;
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

// ---------------- 中远景草片:32 米格,宽矮大草簇,近处细草淡出的地方淡入 ----------------
const FAR_CELL = 32, FAR_CAP = 6000;
// 每格期望簇数(按群系);荒漠/焦土/雪原只零星几簇
const FAR_N = [60, 34, 4, 8, 40, 3, 22, 60]; // 顺序同 terrain.BIOME_KEYS:平原 森林 荒漠 雪原 沼泽 焦土 碎石 丘陵
const farU = { ...uniforms, uRadius: { value: 140 }, uInner: { value: 52 } };
let farMesh = null;
let farLastX = 1e9, farLastZ = 1e9;
const farCache = new Map();
function genFarCell(cx, cz) {
  const rng = rngOf(cellSeed(cx + 7919, cz - 4721));
  const x0 = cx * FAR_CELL, z0 = cz * FAR_CELL;
  const w0 = biomeWeights(x0 + FAR_CELL / 2, z0 + FAR_CELL / 2, _bw);
  let expect = 0;
  for (let b = 0; b < 8; b++) expect += w0[b] * FAR_N[b];
  const count = Math.round(expect * Math.min(1, 0.45 + density * 0.55));
  const m = [], c = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + rng() * FAR_CELL, z = z0 + rng() * FAR_CELL;
    if (!vegAllowed(x, z) || waterProx(x, z) > -2.5 || groundNormalY(x, z) < 0.86) continue;
    const w = biomeWeights(x, z, _bw);
    let r = rng(), b = 0;
    for (; b < 7; b++) { r -= w[b]; if (r <= 0) break; }
    const sc = 1.5 + rng() * 1.3;
    _e.set(0, rng() * Math.PI * 2, 0);
    _q.setFromEuler(_e);
    _s.set(sc, sc * (0.6 + rng() * 0.4), sc);
    _p.set(x, groundH(x, z) - 0.04, z);
    _m4.compose(_p, _q, _s);
    m.push(..._m4.elements);
    const tbl = b === BIOME.snow ? COLOR.snowtuft : (b === BIOME.desert || b === BIOME.ash) ? COLOR.dry : COLOR.grass;
    const [h0, h1, sat, l0, l1] = tbl[b] || tbl.def || tbl[BIOME.plains];
    _col.setHSL(h0 + (h1 - h0) * rng(), sat, (l0 + (l1 - l0) * rng()) * 0.92);
    c.push(_col.r, _col.g, _col.b);
  }
  return { m: new Float32Array(m), c: new Float32Array(c), n: c.length / 3 };
}
function updateFar(px, pz) {
  farLastX = px; farLastZ = pz;
  farU.uCenter.value.set(px, pz);
  const R = farU.uRadius.value, inner = farU.uInner.value * 0.7;
  const pcx = Math.floor(px / FAR_CELL), pcz = Math.floor(pz / FAR_CELL);
  const rc = Math.ceil(R / FAR_CELL) + 1;
  const cells = [];
  for (let dz = -rc; dz <= rc; dz++) {
    for (let dx = -rc; dx <= rc; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const ccx = (cx + 0.5) * FAR_CELL - px, ccz = (cz + 0.5) * FAR_CELL - pz;
      const d = Math.hypot(ccx, ccz);
      if (d > R + FAR_CELL || d < inner - FAR_CELL) continue; // 近处那圈本来就淡掉了,不占名额
      cells.push([d, cx, cz]);
    }
  }
  cells.sort((a, b) => a[0] - b[0]);
  let fill = 0;
  const keep = new Set();
  for (const [, cx, cz] of cells) {
    const key = cx * 100003 + cz;
    keep.add(key);
    let c = farCache.get(key);
    if (!c) { c = genFarCell(cx, cz); farCache.set(key, c); }
    const k = Math.min(FAR_CAP - fill, c.n);
    if (k <= 0) continue;
    farMesh.instanceMatrix.array.set(k === c.n ? c.m : c.m.subarray(0, k * 16), fill * 16);
    farMesh.instanceColor.array.set(k === c.n ? c.c : c.c.subarray(0, k * 3), fill * 3);
    fill += k;
  }
  farMesh.count = fill;
  farMesh.instanceMatrix.needsUpdate = true;
  farMesh.instanceColor.needsUpdate = true;
  if (farCache.size > keep.size * 2 + 64) {
    for (const k of farCache.keys()) if (!keep.has(k)) farCache.delete(k);
  }
}

// ---------------- 作物:农田/菜园的静态实例化(一块地一次绘制,风摆与草同一套着色器,不随距离渐隐) ----------------
let cropMat = null;
const CROP_COL = { wheat: [0.11, 0.14, 0.52, 0.3, 0.42], cabbage: [0.27, 0.33, 0.32, 0.36, 0.48], greens: [0.22, 0.28, 0.42, 0.3, 0.42] };
// rows: [{ x, z, yaw, s }],坐标为世界 XZ(高度由贴地统一处理:农田/菜园都在平整区)
export function buildCropMesh(kind, list, cx = 0, cz = 0) {
  if (!GEO.wheat) buildGeometries();
  if (!cropMat) cropMat = makeMaterial({ ...uniforms, uRadius: { value: 1e6 } });
  const im = new THREE.InstancedMesh(GEO[kind] || GEO.greens, cropMat, Math.max(1, list.length));
  const rng = rngOf(list.length * 7919 + Math.round(cx * 13 + cz * 7));
  const [h0, h1, sat, l0, l1] = CROP_COL[kind] || CROP_COL.greens;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    _e.set((rng() - 0.5) * 0.12, p.yaw ?? rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
    _q.setFromEuler(_e);
    const sc = p.s ?? 0.85 + rng() * 0.3;
    _s.set(sc, sc * (0.85 + rng() * 0.3), sc);
    _p.set(p.x - cx, 0, p.z - cz);
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(i, _m4);
    _col.setHSL(h0 + (h1 - h0) * rng(), sat, l0 + (l1 - l0) * rng());
    im.setColorAt(i, _col);
  }
  im.count = list.length;
  im.position.set(cx, 0, cz);
  im.castShadow = false;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}
