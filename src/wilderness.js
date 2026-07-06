// 无尽荒野:核心王国(±500)之外的 100000×100000 世界由区块程序化生成
// 128×128 一块,随玩家加载/卸载;同一坐标永远生成同样的内容(坐标哈希做种子)
import * as THREE from 'three';
import { lambert } from './entities.js';

export const CHUNK = 128;
export const VIEW_R = 2;          // 加载半径(区块数)
export const CORE = 470;          // 核心手工区域半径(此范围内不生成)
export const WORLD_LIMIT = 50000; // 世界半径 → 总幅面 100000×100000

const chunks = new Map();
let scene = null;
let colliders = null;
let hooks = null;
const pending = [];

export function initWilderness(s, c, h) {
  scene = s;
  colliders = c;
  hooks = h; // { spawnWolf(x,z,chunkKey), removeChunkWolves(chunkKey), dropCoin(x,z) }
}

// ---- 确定性随机 ----
function hashChunk(cx, cz) {
  let h = (cx * 374761393 + cz * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
function makeRng(seed) {
  let s = (seed % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---- 生物群系(低频值噪声) ----
const P = new Uint8Array(512);
{
  const rng = makeRng(97531);
  for (let i = 0; i < 512; i++) P[i] = Math.floor(rng() * 256);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const at = (a, b) => P[(P[(a & 255)] + (b & 255)) & 511] / 255;
  const a = at(xi, zi), b = at(xi + 1, zi), c = at(xi, zi + 1), d = at(xi + 1, zi + 1);
  return a + (b - a) * s(xf) + (c - a) * s(zf) + (a - b - c + d) * s(xf) * s(zf);
}
export function biomeAt(x, z) {
  const v = vnoise(x * 0.0011 + 37.7, z * 0.0011 - 11.3);
  if (v < 0.36) return 'plains';
  if (v < 0.6) return 'forest';
  if (v < 0.78) return 'desert';
  return 'snow';
}
const BIOME_NAMES = { plains: '苍绿平原', forest: '茂密林海', desert: '金色瀚海', snow: '白霜旷野' };
export function wildRegionName(x, z) {
  const dir = Math.abs(x) > Math.abs(z) ? (x > 0 ? '东境' : '西境') : (z > 0 ? '南境' : '北境');
  return `${dir}·${BIOME_NAMES[biomeAt(x, z)]}`;
}

// ---- 植被/道具 ----
function addTree(g, rng, x, z, biome, cols) {
  const grp = new THREE.Group();
  if (biome === 'desert') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 2 + rng(), 6),
      lambert(0x3f8a4f, { roughness: 0.9 }));
    trunk.position.y = 1.1;
    trunk.castShadow = true;
    grp.add(trunk);
  } else if (biome === 'snow') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 5), lambert(0x5a4632));
    trunk.position.y = 0.7;
    grp.add(trunk);
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.4, 1.4, 7),
        lambert(k === 0 ? 0x2d6b3f : 0xdfe8ee, { roughness: 0.95 }));
      c.position.y = 1.6 + k * 0.95;
      c.castShadow = true;
      grp.add(c);
    }
  } else {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 1.4, 5), lambert(0x6b4a2f));
    trunk.position.y = 0.7;
    grp.add(trunk);
    if (rng() < 0.5) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), lambert(0x3f8a4f, { roughness: 0.95 }));
      s.position.y = 2.3;
      s.castShadow = true;
      grp.add(s);
    } else {
      for (let k = 0; k < 2; k++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.5, 1.6, 7), lambert(0x2d6b3f, { roughness: 0.95 }));
        c.position.y = 1.7 + k * 1.1;
        c.castShadow = true;
        grp.add(c);
      }
    }
  }
  grp.position.set(x, 0, z);
  g.add(grp);
  const col = { x, z, r: 0.55 };
  colliders.circles.push(col);
  cols.push(col);
}

function addRock(g, rng, x, z, cols) {
  const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 + rng() * 1.1, 0),
    lambert(0x77726c, { roughness: 0.95 }));
  rock.position.set(x, 0.4, z);
  rock.rotation.y = rng() * 3;
  rock.castShadow = true;
  g.add(rock);
  const col = { x, z, r: 0.8 };
  colliders.circles.push(col);
  cols.push(col);
}

// ---- 区块生成 ----
function genChunk(cx, cz) {
  const key = `${cx},${cz}`;
  const seed = hashChunk(cx, cz);
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const cols = [];
  const baseX = cx * CHUNK, baseZ = cz * CHUNK;
  const centerX = baseX + CHUNK / 2, centerZ = baseZ + CHUNK / 2;
  const biome = biomeAt(centerX, centerZ);

  // 地表色盘(非草地群系铺一块色斑)
  if (biome === 'desert' || biome === 'snow') {
    const d = new THREE.Mesh(new THREE.CircleGeometry(CHUNK * 0.72, 10),
      lambert(biome === 'desert' ? 0xd9c48f : 0xe8edf2, { roughness: 1 }));
    d.rotation.x = -Math.PI / 2;
    d.position.set(centerX, 0.012 + (((cx * 7 + cz * 13) % 5) * 0.0008), centerZ);
    d.receiveShadow = true;
    g.add(d);
  }

  // 植被密度按群系
  const treeN = biome === 'forest' ? 10 + Math.floor(rng() * 6)
    : biome === 'plains' ? 2 + Math.floor(rng() * 3)
    : 3 + Math.floor(rng() * 3);
  for (let i = 0; i < treeN; i++) {
    addTree(g, rng, baseX + rng() * CHUNK, baseZ + rng() * CHUNK, biome, cols);
  }
  const rockN = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < rockN; i++) {
    addRock(g, rng, baseX + rng() * CHUNK, baseZ + rng() * CHUNK, cols);
  }

  // 兴趣点(约 1/4 区块):废弃营地 / 无名石碑 / 狼群
  const wolves = [];
  const roll = rng();
  if (roll < 0.09) {
    // 废弃营地:篝火圈 + 金币
    const px = centerX + (rng() - 0.5) * 40, pz = centerZ + (rng() - 0.5) * 40;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), lambert(0x66625c));
      st.position.set(px + Math.cos(a) * 0.8, 0.15, pz + Math.sin(a) * 0.8);
      g.add(st);
    }
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 5), lambert(0x6a5540, { roughness: 1 }));
    tent.position.set(px + 3, 1, pz + 1);
    tent.castShadow = true;
    g.add(tent);
    for (let i = 0; i < 5; i++) hooks.dropCoin(px + (rng() - 0.5) * 5, pz + (rng() - 0.5) * 5);
  } else if (roll < 0.16) {
    // 无名石碑 + 金币环
    const px = centerX, pz = centerZ;
    const st = new THREE.Mesh(new THREE.BoxGeometry(1, 2.6 + rng(), 0.7), lambert(0x8a857e, { roughness: 0.95 }));
    st.position.set(px, 1.3, pz);
    st.rotation.y = rng() * 3;
    st.castShadow = true;
    g.add(st);
    const col = { x: px, z: pz, r: 0.9 };
    colliders.circles.push(col);
    cols.push(col);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hooks.dropCoin(px + Math.cos(a) * 2.5, pz + Math.sin(a) * 2.5);
    }
  } else if (roll < 0.24 && biome !== 'desert') {
    // 狼群窝
    const px = centerX + (rng() - 0.5) * 50, pz = centerZ + (rng() - 0.5) * 50;
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const w = hooks.spawnWolf(px + (rng() - 0.5) * 8, pz + (rng() - 0.5) * 8, key);
      if (w) wolves.push(w);
    }
  }

  scene.add(g);
  chunks.set(key, { group: g, cols, wolves, key });
}

function unloadChunk(key) {
  const c = chunks.get(key);
  if (!c) return;
  scene.remove(c.group);
  c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const col of c.cols) {
    const i = colliders.circles.indexOf(col);
    if (i >= 0) colliders.circles.splice(i, 1);
  }
  hooks.removeChunkWolves(key);
  chunks.delete(key);
}

// 每帧调用:围绕玩家维护区块窗口(每帧最多生成 1 块)
export function updateWilderness(px, pz) {
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  // 卸载远处
  for (const key of [...chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > VIEW_R + 1 || Math.abs(cz - pcz) > VIEW_R + 1) unloadChunk(key);
  }
  // 加载附近(每帧一块)
  for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
    for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const centerX = cx * CHUNK + CHUNK / 2, centerZ = cz * CHUNK + CHUNK / 2;
      // 核心手工区不生成;世界边界外不生成
      if (Math.abs(centerX) < CORE && Math.abs(centerZ) < CORE) continue;
      if (Math.abs(centerX) > WORLD_LIMIT || Math.abs(centerZ) > WORLD_LIMIT) continue;
      const key = `${cx},${cz}`;
      if (!chunks.has(key)) {
        genChunk(cx, cz);
        return; // 每帧最多一块,避免卡顿
      }
    }
  }
}
