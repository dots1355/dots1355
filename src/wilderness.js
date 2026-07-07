// 无尽荒野:核心王国(±500)之外的 100000×100000 世界由区块程序化生成
// 128×128 一块,随玩家加载/卸载;同一坐标永远生成同样的内容(坐标哈希做种子)
import * as THREE from 'three';
import { lambert } from './entities.js';
import { buildTree, buildPine, buildDeadTree, buildCactus, buildRock, buildBush } from './flora.js';

export const CHUNK = 128;
export const VIEW_R = 2;          // 加载半径(区块数)
export const CORE = 470;          // 核心手工区域半径(此范围内不生成)
export const WORLD_LIMIT = 50000; // 世界半径 → 总幅面 100000×100000

const chunks = new Map();
const seenChunks = new Set(); // 本次会话已生成过的区块:重访不再重刷战利品(防反复越界刷金币/红心)
let scene = null;
let colliders = null;
let hooks = null;

export function initWilderness(s, c, h) {
  scene = s;
  colliders = c;
  hooks = h; // { spawnWolf/spawnHorse/spawnSheep/spawnBandit(x,z,chunkKey), dropCoin/dropHeart(x,z,chunkKey), removeChunkEntities(chunkKey) }
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

// ---- 植被/道具(flora 库:共享几何/材质,区块卸载时不释放) ----
function addTree(g, rng, x, z, biome, cols) {
  let built;
  if (biome === 'desert') {
    built = rng() < 0.15 ? buildDeadTree(rng, { bark: 0x8a6f4d }) : buildCactus(rng);
  } else if (biome === 'snow') {
    built = rng() < 0.85 ? buildPine(rng, { snow: true }) : buildDeadTree(rng, { bark: 0x5a5048 });
  } else if (biome === 'forest') {
    const roll = rng();
    built = roll < 0.6 ? buildTree(rng, { leaf: 0x3d7a47 })
      : roll < 0.9 ? buildPine(rng)
      : buildBush(rng, { leaf: 0x3d7a47 });
  } else { // plains
    const roll = rng();
    built = roll < 0.55 ? buildTree(rng, { leaf: 0x5a9a52 })
      : roll < 0.8 ? buildBush(rng, { leaf: 0x6aa055 })
      : buildPine(rng);
  }
  const grp = built.group;
  const sc = 0.85 + rng() * 0.5;
  grp.scale.setScalar(sc);
  grp.rotation.y = rng() * 6.28;
  grp.position.set(x, 0, z);
  g.add(grp);
  const col = { x, z, r: built.r * sc };
  colliders.circles.push(col);
  cols.push(col);
}

function addRock(g, rng, x, z, cols) {
  const built = buildRock(rng, { noMoss: false });
  built.group.position.set(x, 0, z);
  built.group.rotation.y = rng() * 3;
  g.add(built.group);
  const col = { x, z, r: built.r };
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
  const firstVisit = !seenChunks.has(key);
  seenChunks.add(key);
  // 战利品只在本会话首次生成时掉落;重访只重建景物与生物
  const drop = firstVisit ? (x, z) => hooks.dropCoin(x, z, key) : () => {};
  const dropH = firstVisit ? (x, z) => hooks.dropHeart(x, z, key) : () => {};
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

  // 兴趣点(约 45% 区块有事可看,按群系分布)
  const spawned = []; // 交给主系统托管的实体(狼/盗贼/马/羊)
  const px = centerX + (rng() - 0.5) * 50, pz = centerZ + (rng() - 0.5) * 50;
  const roll = rng();
  const stone = (x, z, h2, w2 = 1) => {
    const st = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, w2 * 0.7), lambert(0x8a857e, { roughness: 0.95 }));
    st.position.set(x, h2 / 2, z);
    st.rotation.y = rng() * 3;
    st.castShadow = true;
    g.add(st);
    const col = { x, z, r: w2 * 0.7 };
    colliders.circles.push(col);
    cols.push(col);
  };
  const campfire = (x, z) => {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), lambert(0x66625c));
      st.position.set(x + Math.cos(a) * 0.8, 0.15, z + Math.sin(a) * 0.8);
      g.add(st);
    }
  };
  const tentAt = (x, z, color = 0x6a5540) => {
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 5), lambert(color, { roughness: 1 }));
    tent.position.set(x, 1, z);
    tent.castShadow = true;
    g.add(tent);
  };

  if (roll < 0.07) {
    // 废弃营地:篝火 + 帐篷 + 金币
    campfire(px, pz);
    tentAt(px + 3, pz + 1);
    for (let i = 0; i < 5; i++) drop(px + (rng() - 0.5) * 5, pz + (rng() - 0.5) * 5);
  } else if (roll < 0.12) {
    // 无名石碑 + 金币环
    stone(px, pz, 2.6 + rng());
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      drop(px + Math.cos(a) * 2.5, pz + Math.sin(a) * 2.5);
    }
  } else if (roll < 0.18 && biome !== 'desert') {
    // 狼群窝
    for (let i = 0, n = 2 + Math.floor(rng() * 2); i < n; i++) {
      const w = hooks.spawnWolf(px + (rng() - 0.5) * 8, pz + (rng() - 0.5) * 8, key);
      if (w) spawned.push(w);
    }
  } else if (roll < 0.24 && (biome === 'plains' || biome === 'forest')) {
    // 野马群:荒野中可捉的坐骑!
    for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) {
      const h = hooks.spawnHorse(px + (rng() - 0.5) * 10, pz + (rng() - 0.5) * 10, key);
      if (h) spawned.push(h);
    }
  } else if (roll < 0.29 && biome === 'plains') {
    // 野羊群
    for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) {
      const s = hooks.spawnSheep(px + (rng() - 0.5) * 10, pz + (rng() - 0.5) * 10, key);
      if (s) spawned.push(s);
    }
  } else if (roll < 0.34 && biome !== 'snow') {
    // 盗贼窝点:黑帐 + 守财匪 + 金币堆
    tentAt(px, pz, 0x3a3a42);
    campfire(px + 2.5, pz + 1);
    for (let i = 0, n = 2; i < n; i++) {
      const b = hooks.spawnBandit(px + (rng() - 0.5) * 6, pz + (rng() - 0.5) * 6, key);
      if (b) spawned.push(b);
    }
    for (let i = 0; i < 7; i++) drop(px + (rng() - 0.5) * 4, pz + (rng() - 0.5) * 4);
  } else if (roll < 0.38) {
    // 猎人营地(安全补给):帐篷 + 一颗心
    tentAt(px, pz, 0x5a6a45);
    campfire(px + 2.2, pz);
    dropH(px + 1, pz + 2);
    drop(px - 1.5, pz + 1);
  } else if (roll < 0.42) {
    // 废弃哨塔:断塔 + 木箱 + 金币
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 4 + rng() * 3, 8), lambert(0x8d8476, { roughness: 0.95 }));
    t.position.set(px, 2.2, pz);
    t.rotation.z = (rng() - 0.5) * 0.12;
    t.castShadow = true;
    g.add(t);
    const col = { x: px, z: pz, r: 2.4 };
    colliders.circles.push(col);
    cols.push(col);
    for (let i = 0; i < 2; i++) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lambert(0x8a6a45, { roughness: 0.9 }));
      cr.position.set(px + 2.6 + i, 0.4, pz + 1.5 - i * 2);
      cr.rotation.y = rng() * 2;
      cr.castShadow = true;
      g.add(cr);
    }
    for (let i = 0; i < 6; i++) drop(px + (rng() - 0.5) * 6, pz + (rng() - 0.5) * 6);
  } else if (roll < 0.46 && biome === 'forest') {
    // 蘑菇圈:一圈红菇 + 一颗心
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.3, 5), lambert(0xe8e0d0));
      stem.position.set(px + Math.cos(a) * 2, 0.15, pz + Math.sin(a) * 2);
      g.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), lambert(0xc03028, { roughness: 0.7 }));
      cap.scale.y = 0.6;
      cap.position.set(px + Math.cos(a) * 2, 0.34, pz + Math.sin(a) * 2);
      g.add(cap);
    }
    dropH(px, pz);
  } else if (roll < 0.5) {
    // 群系水晶/仙人掌花:装饰 + 两枚金币
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 5),
      lambert(biome === 'snow' ? 0xbfe4f2 : biome === 'desert' ? 0xe8b84a : 0x9adcc8,
        { roughness: 0.25, metalness: 0.3 }));
    c.position.set(px, 0.9, pz);
    c.rotation.z = (rng() - 0.5) * 0.4;
    c.castShadow = true;
    g.add(c);
    drop(px + 1, pz);
    drop(px - 1, pz + 0.5);
  } else if (roll < 0.54) {
    // 迷你石阵
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rng();
      stone(px + Math.cos(a) * 3, pz + Math.sin(a) * 3, 1.6 + rng() * 1.2, 0.8);
    }
    for (let i = 0; i < 4; i++) drop(px + (rng() - 0.5) * 3, pz + (rng() - 0.5) * 3);
  }

  scene.add(g);
  chunks.set(key, { group: g, cols, spawned, key, cx, cz });
  colliders.dirty = true; // 通知碰撞网格重建
}

function unloadChunk(key) {
  const c = chunks.get(key);
  if (!c) return;
  scene.remove(c.group);
  c.group.traverse((o) => {
    // flora 库的几何/材质全场共享(userData.shared),不能释放;其余独占资源照常释放
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
  for (const col of c.cols) {
    const i = colliders.circles.indexOf(col);
    if (i >= 0) colliders.circles.splice(i, 1);
  }
  colliders.dirty = true;
  hooks.removeChunkEntities(key);
  chunks.delete(key);
}

// 每帧调用:围绕玩家维护区块窗口(每帧最多生成 1 块)
// 玩家没跨区块边界且窗口已齐时直接空转,零分配零扫描
let lastPcx = 1e9, lastPcz = 1e9, wildPending = true;
const _toUnload = [];
export function updateWilderness(px, pz) {
  const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
  if (pcx !== lastPcx || pcz !== lastPcz) {
    lastPcx = pcx;
    lastPcz = pcz;
    wildPending = true;
  }
  if (!wildPending) return;
  // 卸载远处
  _toUnload.length = 0;
  for (const c of chunks.values()) {
    if (Math.abs(c.cx - pcx) > VIEW_R + 1 || Math.abs(c.cz - pcz) > VIEW_R + 1) _toUnload.push(c.key);
  }
  for (const k of _toUnload) unloadChunk(k);
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
  wildPending = false; // 窗口齐了,下次跨界再扫
}
