// 城外寻路航点图(纯几何,不认识玩法):王都城墙(只有南门、东门能过)、银月河(只有木桥能过)、
// 银月湖(深水不可徒步)是王国核心的三处大障碍。
// 节点 = 4 个城角 + 每座城门的门外/门内点 + 木桥两端 + 河源北侧 + 湖岸一圈;节点之间按线段可见性连边
// (第一次查询时算一次),每次查询把起点、终点临时接进图里跑 Dijkstra,取第一跳。
// 可见性:线段离城墙/门楼塔/角楼/湖/河段的净距 ≥ 余量;端点本来就贴着障碍时(贴墙、站在河边),
// 只要求线段别比端点更靠近它——于是"贴着墙往外走"可行,"穿墙/过河"永远不行。门洞、桥面不算障碍。
// 对外:navNext(px, pz, gx, gz, prev) → 这一段该先去的航点 {x, z, id};直走就能到返回 null。
//      navPath(px, pz, gx, gz) → 整条折线 [{x, z}…](含起终点;测试/调试用);NAV_BRIDGE 木桥位置(地图画图标)。
// 布局与 world.js(城墙 x:-70..70, z:-55..55、门楼塔、角楼)、waterbodies.js(RIVER、LAKE、木桥)一致。
import { LAKE, RIVER } from '../waterbodies.js';

export const NAV_BRIDGE = { x: -95, z: -34 }; // 木桥(桥面沿 X 横跨银月河)
const WALL_HALF = 0.9; // 城墙碰撞盒厚 1.8
// 城墙(门洞处断开,断口两端是门楼塔):[x1, z1, x2, z2]
const WALLS = [
  [-70, -55, 70, -55], [-70, 55, -6, 55], [6, 55, 70, 55],
  [-70, -55, -70, 55], [70, -55, 70, -6], [70, 6, 70, 55],
];
// 圆形障碍:角楼(半径 4 + 碰撞余量 0.3)、门楼塔(2.2 + 0.3)、银月湖(深水圈 28.5 外再留 2 米浅滩)
const CIRCLES = [
  { x: -70, z: -55, r: 4.3 }, { x: 70, z: -55, r: 4.3 }, { x: 70, z: 55, r: 4.3 }, { x: -70, z: 55, r: 4.3 },
  { x: -6, z: 55, r: 2.5 }, { x: 6, z: 55, r: 2.5 }, { x: 70, z: -6, r: 2.5 }, { x: 70, z: 6, r: 2.5 },
  { x: LAKE.x, z: LAKE.z, r: 30.5 },
];
// 航点:城角离角楼 12 米;门外/门内点在门洞中线上离墙 7 米;桥头在桥面两端外 1~2 米
const NODES = [
  { id: 'NW', x: -79, z: -64 }, { id: 'NE', x: 79, z: -64 }, { id: 'SE', x: 79, z: 64 }, { id: 'SW', x: -79, z: 64 },
  { id: 'S-out', x: 0, z: 62 }, { id: 'S-in', x: 0, z: 48 }, { id: 'E-out', x: 77, z: 0 }, { id: 'E-in', x: 63, z: 0 },
  { id: 'bridge-E', x: NAV_BRIDGE.x + 7, z: NAV_BRIDGE.z }, { id: 'bridge-W', x: NAV_BRIDGE.x - 8, z: NAV_BRIDGE.z },
  { id: 'river-N', x: -93, z: -234 },
];
for (let i = 0; i < 8; i++) { // 湖岸一圈(离湖心 42 米)
  const a = (i / 8) * Math.PI * 2;
  NODES.push({ id: `lake-${i}`, x: LAKE.x + Math.cos(a) * 42, z: LAKE.z + Math.sin(a) * 42 });
}
const PAD_STATIC = 1.0; // 航点之间的边:离障碍至少 1 米
const PAD_QUERY = 0.35; // 接起点/终点的边:人能挤过去就行
const EPS = 0.05;

// ---------------- 几何 ----------------
const len = (x, z) => Math.sqrt(x * x + z * z);
function ptSegD(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
  return len(px - (ax + ex * t), pz - (az + ez * t));
}
function cross(ax, az, bx, bz, cx, cz) { return (bx - ax) * (cz - az) - (bz - az) * (cx - ax); }
function segSegD(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz);
  const d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSegD(ax, az, cx, cz, dx, dz), ptSegD(bx, bz, cx, cz, dx, dz),
    ptSegD(cx, cz, ax, az, bx, bz), ptSegD(dx, dz, ax, az, bx, bz));
}

// 障碍表(第一次用到时建):城墙段(半厚)、圆(半径)、河段(该处半宽)统一成"线段 + 膨胀半径",
// 圆就是退化成一个点的线段。木桥前后 z∈(-40,-28) 是桥面与浅滩,能走,不算障碍
let OBS = null, RIVER_BOX = null;
function obstacles() {
  if (OBS) return OBS;
  OBS = [];
  const add = (ax, az, bx, bz, r, river = false) => OBS.push({ ax, az, bx, bz, r, river,
    x0: Math.min(ax, bx) - r, x1: Math.max(ax, bx) + r, z0: Math.min(az, bz) - r, z1: Math.max(az, bz) + r });
  for (const [x1, z1, x2, z2] of WALLS) add(x1, z1, x2, z2, WALL_HALF);
  for (const c of CIRCLES) add(c.x, c.z, c.x, c.z, c.r);
  const open = (p) => p.z > -40 && p.z < -28;
  RIVER_BOX = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    if (open(a) || open(b)) continue;
    add(a.x, a.z, b.x, b.z, Math.max(a.w, b.w) / 2, true);
    const o = OBS[OBS.length - 1];
    RIVER_BOX.x0 = Math.min(RIVER_BOX.x0, o.x0); RIVER_BOX.x1 = Math.max(RIVER_BOX.x1, o.x1);
    RIVER_BOX.z0 = Math.min(RIVER_BOX.z0, o.z0); RIVER_BOX.z1 = Math.max(RIVER_BOX.z1, o.z1);
  }
  return OBS;
}
// 点到每处障碍的净距(负 = 在障碍里)
function clearances(x, z) {
  const O = obstacles();
  const c = new Float64Array(O.length);
  for (let k = 0; k < O.length; k++) { const o = O[k]; c[k] = ptSegD(x, z, o.ax, o.az, o.bx, o.bz) - o.r; }
  return c;
}

// 线段 A→B 是否走得通(cA/cB:两端点的净距表)。每处障碍的放行线 = min(余量, 端点本身的净距 − ε):
// 端点贴着障碍时,线段只要不比端点更靠近它就行(从墙根、河边往外走可以;穿过去不行——穿过去净距是负的)
function segClear(ax, az, bx, bz, cA, cB, pad) {
  const O = obstacles();
  const sx0 = Math.min(ax, bx) - pad, sx1 = Math.max(ax, bx) + pad, sz0 = Math.min(az, bz) - pad, sz1 = Math.max(az, bz) + pad;
  const nearRiver = !(RIVER_BOX.x1 < sx0 || RIVER_BOX.x0 > sx1 || RIVER_BOX.z1 < sz0 || RIVER_BOX.z0 > sz1);
  for (let k = 0; k < O.length; k++) {
    const o = O[k];
    if (o.river && !nearRiver) break; // 河段排在最后:整条河都够不着就不用逐段看
    if (o.x1 < sx0 || o.x0 > sx1 || o.z1 < sz0 || o.z0 > sz1) continue; // 包围盒都碰不到
    const thr = Math.min(pad, cA[k] - EPS, cB[k] - EPS);
    const d = o.ax === o.bx && o.az === o.bz ? ptSegD(o.ax, o.az, ax, az, bx, bz) : segSegD(ax, az, bx, bz, o.ax, o.az, o.bx, o.bz);
    if (d - o.r < thr) return false;
  }
  return true;
}

// 航点之间的静态边与航点的净距表(第一次查询时算一次)
let edges = null, nodeClr = null;
function staticEdges() {
  if (edges) return edges;
  const n = NODES.length;
  nodeClr = NODES.map((a) => clearances(a.x, a.z));
  edges = Array.from({ length: n }, () => new Float64Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = NODES[i], b = NODES[j];
      if (segClear(a.x, a.z, b.x, b.z, nodeClr[i], nodeClr[j], PAD_STATIC)) edges[i][j] = edges[j][i] = len(a.x - b.x, a.z - b.z);
    }
  }
  return edges;
}

// 起点 S(下标 n)、终点 G(n+1)临时接进图里;返回节点下标序列(不含 S、含 G),走不通返回 null。
// prevId:上一次给出的第一跳——接着走它的边打 92 折(防止两条差不多长的路之间来回跳)
function solve(px, pz, gx, gz, prevId, pad) {
  const E = staticEdges();
  const n = NODES.length, S = n, G = n + 1;
  const cS = clearances(px, pz), cG = clearances(gx, gz);
  const pt = (i) => (i === S ? { x: px, z: pz, c: cS } : i === G ? { x: gx, z: gz, c: cG } : { x: NODES[i].x, z: NODES[i].z, c: nodeClr[i] });
  const w = (i, j) => {
    if (i < n && j < n) return E[i][j];
    const a = pt(i), b = pt(j);
    if (!segClear(a.x, a.z, b.x, b.z, a.c, b.c, pad)) return Infinity;
    const d = len(a.x - b.x, a.z - b.z);
    return i === S && j < n && NODES[j].id === prevId ? d * 0.92 : d;
  };
  const dist = new Float64Array(n + 2).fill(Infinity), from = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
  dist[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === G) break;
    done[u] = 1;
    for (let v = 0; v < n + 2; v++) {
      if (done[v] || v === S) continue;
      const d = dist[u] + w(u, v);
      if (d < dist[v]) { dist[v] = d; from[v] = u; }
    }
  }
  if (dist[G] === Infinity) return null;
  const seq = [];
  for (let v = G; v !== S; v = from[v]) seq.unshift(v);
  return seq;
}
function route(px, pz, gx, gz, prevId) {
  // 端点卡进障碍余量里(挤在门洞边、桥头浅滩)时放宽一档再试;仍不通就直指目标
  return solve(px, pz, gx, gz, prevId, PAD_QUERY) || solve(px, pz, gx, gz, prevId, -0.5);
}

// 小缓存:光柱、战团各查各的,同一位置(半米格)重复查询直接复用
const memo = new Map();
export function navNext(px, pz, gx, gz, prev = null) {
  if (len(gx - px, gz - pz) < 1) return null;
  const prevId = prev && prev.id ? prev.id : null;
  const key = `${Math.round(px * 2)},${Math.round(pz * 2)},${Math.round(gx * 2)},${Math.round(gz * 2)},${prevId}`;
  if (memo.has(key)) return memo.get(key);
  const seq = route(px, pz, gx, gz, prevId);
  let hop = null;
  if (seq && seq.length > 1) {
    let k = 0;
    // 已经站到第一跳上了(2.5 米内):直接给下一跳,别让光柱立在脚下
    if (len(NODES[seq[0]].x - px, NODES[seq[0]].z - pz) < 2.5 && seq.length > 2) k = 1;
    if (seq[k] < NODES.length) hop = NODES[seq[k]];
  }
  if (memo.size > 16) memo.delete(memo.keys().next().value);
  memo.set(key, hop);
  return hop;
}
export function navPath(px, pz, gx, gz) {
  const seq = route(px, pz, gx, gz, null);
  const pts = [{ x: px, z: pz }];
  if (!seq) { pts.push({ x: gx, z: gz }); return pts; }
  for (const v of seq) pts.push(v < NODES.length ? { x: NODES[v].x, z: NODES[v].z, id: NODES[v].id } : { x: gx, z: gz });
  return pts;
}
