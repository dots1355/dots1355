// 水体布局(纯数据 + 解析函数,不依赖 three):银月湖 / 银月河 / 雾语沼泽水塘 / 霜风冰湖
// 同一份形状同时用于:地形挖盆地(terrain.terrainH 减去 waterBasin)、水面网格(gfx/water.js)、
// 碰撞与玩法判定(world.js)、草木避水与岸边芦苇(vegetation.js)、地图轮廓(ui/maps.js)。
// 约定:水位 0(与周围被压平的地面同高);basin>0 表示地面低于水位多少米。

const smooth = (a, b, t) => {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

// ---------------- 银月湖:噪声扰动的岸线(半径 29~32.5,深水判定圈 28.5 永远在水里) ----------------
export const LAKE = { x: -100, z: 100, isle: 8 }; // isle:湖心岛平地半径(深水规则另按 6.8 判)
export function lakeR(a) {
  return 30.75 + 1.0 * Math.sin(2 * a + 1.3) + 0.55 * Math.sin(3 * a + 0.4) + 0.25 * Math.sin(7 * a + 2.0);
}
// 栈桥走廊:桥面下垫一道土埂(顶面 0.3,桥面 0.375),两侧 4m 内是浅滩——地形网格 4m 一格,
// 这样插值出来桥面宽度内都在水面以上,玩家走在桥上而不是半身泡在水里
const PIER = { x: -100, z0: 69, z1: 87.5, top: 0.3 };
function lakeBasin(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const r = Math.hypot(dx, dz);
  if (r > 34) return 0;
  const R = lakeR(Math.atan2(dz, dx));
  let d = 0.45 * smooth(R, R - 2.5, r) + 2.6 * smooth(R - 2.5, R - 17, r);
  d *= smooth(LAKE.isle, LAKE.isle + 4, r); // 湖心岛
  const px = Math.abs(x - PIER.x);
  if (px < 9 && z > PIER.z0 - 3 && z < PIER.z1 + 4) {
    const kz = smooth(PIER.z0 - 3, PIER.z0, z) * (1 - smooth(PIER.z1, PIER.z1 + 4, z));
    const shoal = (1 - smooth(4.5, 8.5, px)) * kz;
    d = d * (1 - shoal) + Math.min(d, 0.6) * shoal;
    const k = (1 - smooth(1.3, 3.5, px)) * kz;
    d = d * (1 - k) - PIER.top * k;
  }
  return d;
}

// ---------------- 银月河:Catmull-Rom 样条(北山谷 → 桥 → 湖北岸),宽 6~9m ----------------
const RIVER_CTRL = [ // [x, z, 宽]
  [-93, -222, 6.2], [-99, -182, 6.8], [-101.5, -142, 7.4], [-93.5, -101, 7.8], [-90.5, -66, 7.6],
  [-95, -34, 7.0], [-99, -8, 7.6], [-97.5, 20, 8.2], [-93.5, 44, 7.8], [-93, 62, 7.4], [-93.5, 74, 8.6],
];
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
// 采样成折线:{ x, z, w, tx, tz }(tx,tz 为顺流单位切向:从北往南流进湖)
export const RIVER = (() => {
  const pts = [];
  const C = RIVER_CTRL;
  for (let i = 0; i < C.length - 1; i++) {
    const p0 = C[Math.max(0, i - 1)], p1 = C[i], p2 = C[i + 1], p3 = C[Math.min(C.length - 1, i + 2)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t),
        w: catmull(p0[2], p1[2], p2[2], p3[2], t) });
    }
  }
  const L = C[C.length - 1];
  pts.push({ x: L[0], z: L[1], w: L[2] });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    pts[i].tx = (b.x - a.x) / l;
    pts[i].tz = (b.z - a.z) / l;
  }
  return pts;
})();
const RIVER_BOX = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of RIVER) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x0: x0 - 12, x1: x1 + 12, z0: z0 - 12, z1: z1 + 12 };
})();
// 到河中线的距离与该处半宽(粗筛 + 逐段)
export function riverNear(x, z) {
  if (x < RIVER_BOX.x0 || x > RIVER_BOX.x1 || z < RIVER_BOX.z0 || z > RIVER_BOX.z1) return null;
  let best = 1e9, hw = 4, bi = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    if (Math.abs(z - a.z) > 14 && Math.abs(z - b.z) > 14) continue;
    const ex = b.x - a.x, ez = b.z - a.z;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best) { best = d; hw = (a.w + (b.w - a.w) * t) / 2; bi = i; }
  }
  return best < 1e8 ? { d: best, hw, i: bi } : null;
}
// 木桥(-95,-34,桥面沿 X 横跨):桥下垫一道与桥面齐平的土埂,人走在桥面上
const BRIDGE = { x: -95, z: -34, top: 0.3 };
function riverBasin(x, z) {
  const r = riverNear(x, z);
  if (!r) return 0;
  let d = 0.5 * smooth(r.hw + 0.4, r.hw - 1.2, r.d) + 1.3 * smooth(r.hw - 0.8, r.hw * 0.25, r.d);
  const bz = Math.abs(z - BRIDGE.z), bx = Math.abs(x - BRIDGE.x);
  if (bz < 9 && bx < 9) {
    const shoal = (1 - smooth(4.5, 8.5, bz)) * (1 - smooth(6, 8.5, bx));
    d = d * (1 - shoal) + Math.min(d, 0.6) * shoal;
    const k = (1 - smooth(1.6, 3.6, bz)) * (1 - smooth(6, 8, bx));
    d = d * (1 - k) - BRIDGE.top * k;
  }
  return d;
}

// ---------------- 雾语沼泽水塘 / 霜风冰湖 ----------------
const POOL_DEF = [[-313, 222, 10.5, 0.4], [-275, 255, 10, 1.7], [-295, 270, 9, 3.1], [-262, 233, 8, 4.4]]; // 避开女巫小屋与沼泽小路
export const POOLS = POOL_DEF.map(([x, z, r, ph]) => ({ x, z, r, ph }));
export function poolR(p, a) {
  return p.r * (1 + 0.16 * Math.sin(3 * a + p.ph) + 0.09 * Math.sin(5 * a + p.ph * 2.3) + 0.05 * Math.sin(9 * a - p.ph));
}
function poolBasin(x, z) {
  let d = 0;
  for (const p of POOLS) {
    const dx = x - p.x, dz = z - p.z;
    const r = Math.hypot(dx, dz);
    if (r > p.r * 1.45) continue;
    const R = poolR(p, Math.atan2(dz, dx));
    d = Math.max(d, 0.35 * smooth(R, R - 1.6, r) + 0.7 * smooth(R - 1.5, R * 0.45, r));
  }
  return d;
}
export const ICE = { x: -248, z: -138, r: 11, ph: 2.2 };
export function iceR(a) {
  return ICE.r * (1 + 0.12 * Math.sin(3 * a + ICE.ph) + 0.07 * Math.sin(4 * a + 1.1) + 0.04 * Math.sin(7 * a + 0.3));
}

// 地面低于水位多少米(>0 在水下;栈桥土埂处为负 = 垫高)
export function waterBasin(x, z) {
  if (x > -60 || x < -330) return 0;
  const lb = z > 60 && z < 140 ? lakeBasin(x, z) : 0;
  const rb = riverBasin(x, z);
  if (lb < 0 || rb < 0) return Math.min(lb, rb); // 栈桥/木桥下的土埂(垫高)优先
  let d = Math.max(lb, rb);
  if (z > 200 && z < 300) d = Math.max(d, poolBasin(x, z));
  return d;
}

// 到最近水岸的有符号距离(米):>0 在水里,<0 在岸上(只在水边几米内有意义,远处返回 -99)
export function waterProx(x, z) {
  if (x > -60 || x < -330) return -99;
  let best = -99;
  if (z > 60 && z < 140) {
    const dx = x - LAKE.x, dz = z - LAKE.z;
    const r = Math.hypot(dx, dz);
    if (r < 40) best = Math.max(best, Math.min(lakeR(Math.atan2(dz, dx)) - r, r - LAKE.isle - 0.5));
  }
  const rv = riverNear(x, z);
  if (rv) best = Math.max(best, rv.hw - rv.d);
  if (z > 200 && z < 300) {
    for (const p of POOLS) {
      const dx = x - p.x, dz = z - p.z;
      const r = Math.hypot(dx, dz);
      if (r < p.r * 1.6) best = Math.max(best, poolR(p, Math.atan2(dz, dx)) - r);
    }
  }
  return best;
}

// 多边形轮廓(地图用):n 个点
export function outline(cx, cz, radiusFn, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const R = radiusFn(a);
    pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
  }
  return pts;
}
