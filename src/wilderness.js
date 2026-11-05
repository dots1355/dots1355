// 无尽荒野:核心王国(±500)之外的 1000000×1000000 世界由区块程序化生成
// 128×128 一块,随玩家加载/卸载;同一坐标永远生成同样的内容(坐标哈希做种子)
// 性能:区块生成是分帧的生成器(每帧限时,近的先建);地标实例化,程序化树石与兴趣点烘成少量顶点色网格
// (gfx/vpbr.js),整块冻结矩阵;卸载每帧至多一块;碰撞圆增量进出空间网格
import * as THREE from 'three';
import { lambert, addCircles, removeCircles } from './entities.js';
import { buildTree, buildPine, buildDeadTree, buildCactus, buildRock, buildBush, natureProp, natureSpec,
  buildNatureInstances, releaseNatureInstances, warmNatureTemplate, NIGHT_GLOW } from './flora.js';
import { dominantBiome, groundH, buildGroundMesh, getGroundMaterial, GRID } from './terrain.js';
import { plainStandard, vpbrMaterial, bakeVPBRSteps } from './gfx/vpbr.js';

export const CHUNK = 128;
// 加载距离(米):区块离玩家最近的一点在这个距离内就装,再远出 64m 才卸(回差)。
// 按距离而不是按方块窗口:保证四面都至少装到这么远,区块数却比 5×5 窗口少约两成。画质"流畅"档收到 160m
let LOAD_D = 256;
export function setWildViewDistance(m) {
  if (m === LOAD_D) return;
  LOAD_D = m;
  lastX = lastZ = 1e9; // 下一帧重排装卸清单
}
export const CORE = 470;          // 核心手工区域半径(此范围内不生成)
export const WORLD_LIMIT = 500000; // 世界半径 → 总幅面 1000000×1000000

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

// ---- 生物群系:与地形/地表配色共用 terrain.js 的同一套函数 ----
export function biomeAt(x, z) { return dominantBiome(x, z); }
const BIOME_NAMES = {
  plains: '苍绿平原', forest: '茂密林海', desert: '金色瀚海', snow: '白霜旷野',
  swamp: '迷雾湿地', ash: '焦土荒原', rock: '碎石岗', hills: '起伏丘陵',
};
export function wildRegionName(x, z) {
  const dir = Math.abs(x) > Math.abs(z) ? (x > 0 ? '东境' : '西境') : (z > 0 ? '南境' : '北境');
  return `${dir}·${BIOME_NAMES[biomeAt(x, z)] || '荒野'}`;
}

// ---- 植被/道具(flora 库:共享几何/材质,区块卸载时不释放) ----
function addTree(g, rng, x, z, biome, cols) {
  let built;
  if (biome === 'desert') {
    built = rng() < 0.15 ? buildDeadTree(rng, { bark: 0x8a6f4d }) : buildCactus(rng);
  } else if (biome === 'swamp') {
    built = rng() < 0.55 ? buildDeadTree(rng, { bark: 0x3d3a2e }) : buildBush(rng, { leaf: 0x4c5a35 });
  } else if (biome === 'ash') {
    built = buildDeadTree(rng, { bark: 0x2e2a27 });
  } else if (biome === 'rock') {
    built = rng() < 0.6 ? buildPine(rng) : buildDeadTree(rng, { bark: 0x5a5048 });
  } else if (biome === 'snow') {
    built = rng() < 0.85 ? buildPine(rng, { snow: true }) : buildDeadTree(rng, { bark: 0x5a5048 });
  } else if (biome === 'forest') { // 林海用 Blender 写实橡树/桦树/松树(与王国森林同一套模型,每棵只几次绘制)
    const roll = rng();
    built = roll < 0.6 ? buildTree(rng)
      : roll < 0.93 ? buildPine(rng)
      : buildBush(rng, { leaf: 0x3d7a47 });
  } else { // plains
    const roll = rng();
    built = roll < 0.55 ? buildTree(rng, { leaf: 0x5a9a52 })
      : roll < 0.8 ? buildBush(rng, { leaf: 0x6aa055 })
      : buildPine(rng);
  }
  const grp = built.group;
  const sc = biome === 'forest' ? 1 + rng() * 0.6 : 0.85 + rng() * 0.5; // 林海的树更高大,林冠才合得拢
  grp.scale.setScalar(sc);
  grp.rotation.y = rng() * 6.28;
  grp.position.set(x, 0, z);
  g.add(grp);
  cols.push({ x, z, r: built.r * sc });
}

function addRock(g, rng, x, z, cols) {
  const built = buildRock(rng, { noMoss: false });
  built.group.position.set(x, 0, z);
  built.group.rotation.y = rng() * 3;
  g.add(built.group);
  cols.push({ x, z, r: built.r });
}

// ---- 群系地标:每块按群系撒 Blender 地标(期望个数),让每片荒野一眼可辨 ----
export const LANDMARKS = {
  plains: [['Outcrop1', 0.35], ['Outcrop2', 0.3], ['Bush1', 0.9], ['Bush2', 0.8], ['Log', 0.25], ['Stump', 0.25]],
  forest: [['Log', 0.8], ['Stump', 0.7], ['Bush1', 1.2], ['Bush2', 1.0], ['Outcrop2', 0.35], ['DeadTree1', 0.2]],
  hills: [['Outcrop1', 0.7], ['Outcrop2', 0.6], ['Bush2', 0.6], ['Stump', 0.2]],
  desert: [['Mesa', 0.55], ['Ribcage', 0.12], ['DeadTree2', 0.35], ['Outcrop2', 0.2]],
  snow: [['IceRock', 0.8], ['DeadTree1', 0.35], ['Outcrop1', 0.3]],
  swamp: [['Willow', 1.4], ['DeadTree1', 0.6], ['DeadTree2', 0.5], ['Log', 0.5], ['Stump', 0.4], ['Bush2', 0.5]],
  ash: [['Spires', 0.9], ['DeadTree2', 0.6], ['DeadTree1', 0.4], ['Ribcage', 0.12]],
  rock: [['Outcrop1', 0.8], ['Outcrop2', 0.8], ['Spires', 0.4], ['Stump', 0.15]],
};
export const BIG_PROP = { Mesa: 1, Outcrop1: 1, Outcrop2: 1, IceRock: 1, Spires: 1 };
// 放一件地标;返回是否放成。insts 给了就只记放置参数交给实例化(随机数消耗与克隆版一致),
// 否则克隆一份真网格挂到 parent 上(需要单独摆弄的,比如翻倒的货车)
export function placeLandmark(parent, rng, name, x, z, cols, colList, yaw = null, insts = null) {
  const big = BIG_PROP[name];
  if (insts) {
    const sp = natureSpec(name, rng, big ? 0.8 + rng() * 0.5 : 1, yaw);
    if (!sp) return false;
    let y = groundH(x, z) + sp.y;
    if (big) { // 坡地:按足印最低点下沉(宁埋不浮)
      const rr = Math.max(1, (sp.cols[0] ? sp.cols[0].r : 1));
      let lo = groundH(x, z);
      for (let k = 0; k < 4; k++) lo = Math.min(lo, groundH(x + Math.cos(k * 1.57) * rr, z + Math.sin(k * 1.57) * rr));
      y = lo + sp.y;
    }
    insts.push({ name, x, y, z, yaw: sp.yaw, s: sp.s });
    for (const c of sp.cols) {
      const col = { x: x + c.dx, z: z + c.dz, r: c.r };
      if (colList) colList.push(col);
      if (cols) cols.push(col);
    }
    return true;
  }
  const built = natureProp(name, rng, big ? 0.8 + rng() * 0.5 : 1, yaw);
  if (!built) return false;
  built.group.position.set(x, 0, z);
  built.group.userData.isProp = true;
  // 坡地:按足印最低点下沉(宁埋不浮);区块末尾会再统一加上中心点地面高
  if (big) {
    const h0 = groundH(x, z), rr = Math.max(1, (built.cols[0] ? built.cols[0].r : 1));
    let lo = h0;
    for (let k = 0; k < 4; k++) lo = Math.min(lo, groundH(x + Math.cos(k * 1.57) * rr, z + Math.sin(k * 1.57) * rr));
    built.group.children[0].position.y += lo - h0;
  }
  parent.add(built.group);
  for (const c of built.cols) {
    const col = { x: x + c.dx, z: z + c.dz, r: c.r };
    if (colList) colList.push(col);
    if (cols) cols.push(col);
  }
  return true;
}

// ---- 区块生成(生成器:每个 yield 是一个可以停下来等下一帧的点) ----
function* chunkJob(cx, cz) {
  const key = `${cx},${cz}`;
  const seed = hashChunk(cx, cz);
  const rng = makeRng(seed);
  const g = new THREE.Group();
  const cols = [];
  const insts = []; // 交给实例化的地标放置
  const firstVisit = !seenChunks.has(key);
  seenChunks.add(key);
  // 战利品只在本会话首次生成时掉落;重访只重建景物与生物
  const drop = firstVisit ? (x, z) => hooks.dropCoin(x, z, key) : () => {};
  const dropH = firstVisit ? (x, z) => hooks.dropHeart(x, z, key) : () => {};
  const baseX = cx * CHUNK, baseZ = cz * CHUNK;
  const centerX = baseX + CHUNK / 2, centerZ = baseZ + CHUNK / 2;
  const biome = biomeAt(centerX, centerZ);

  // 地表:按地形烘焙的一块起伏网格(群系配色已在顶点色里)。先分几步把这块的地形高度采进缓存,
  // 建网格那一步就只剩查表和配色
  for (let iz = -1, n = CHUNK / GRID + 2; iz < n; iz++) {
    const z = baseZ + iz * GRID + 0.05;
    for (let ix = -1; ix < n; ix++) groundH(baseX + ix * GRID + 0.1, z);
    if (iz % 9 === 8) yield;
  }
  yield;
  g.add(buildGroundMesh(baseX, baseZ, CHUNK, getGroundMaterial()));
  yield;

  // 植被密度按群系
  const treeN = biome === 'forest' ? 30 + Math.floor(rng() * 12) // 茂密林海:名副其实(林下另有灌木/蕨/蘑菇,见 vegetation.js)
    : biome === 'plains' || biome === 'hills' ? 3 + Math.floor(rng() * 4)
    : biome === 'swamp' ? 5 + Math.floor(rng() * 4)
    : 3 + Math.floor(rng() * 3);
  for (let i = 0; i < treeN; i++) {
    addTree(g, rng, baseX + rng() * CHUNK, baseZ + rng() * CHUNK, biome, cols);
    if (i % 4 === 3) yield;
  }
  const rockN = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < rockN; i++) {
    addRock(g, rng, baseX + rng() * CHUNK, baseZ + rng() * CHUNK, cols);
  }
  yield;

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
    cols.push({ x, z, r: w2 * 0.7 });
  };
  // 地标默认走实例化;real=true 时克隆真网格(之后还要单独摆弄的)
  const prop = (name, x, z, yaw = null, real = false) => placeLandmark(g, rng, name, x, z, cols, null, yaw, real ? null : insts);
  const campfire = (x, z) => {
    if (prop('Campfire', x, z)) return;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), lambert(0x66625c));
      st.position.set(x + Math.cos(a) * 0.8, 0.15, z + Math.sin(a) * 0.8);
      g.add(st);
    }
  };
  const tentAt = (x, z, color = 0x6a5540) => {
    // 帐篷门朝向营地中心(篝火一侧)
    if (prop(color === 0x3a3a42 ? 'TentDark' : 'Tent', x, z, Math.atan2(z - pz, -(x - px)) + Math.PI)) return;
    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2, 5), lambert(color, { roughness: 1 }));
    tent.position.set(x, 1, z);
    tent.castShadow = true;
    g.add(tent);
  };

  if (roll < 0.07) {
    // 废弃营地:篝火 + 帐篷 + 金币
    campfire(px, pz);
    tentAt(px + 3.4, pz + 1.2);
    prop('Log', px - 2.2, pz + 0.6);
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
      yield; // 每个生物单独一步:建模加合批不算轻
    }
  } else if (roll < 0.24 && (biome === 'plains' || biome === 'forest')) {
    // 野马群:荒野中可捉的坐骑!
    for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) {
      const h = hooks.spawnHorse(px + (rng() - 0.5) * 10, pz + (rng() - 0.5) * 10, key);
      if (h) spawned.push(h);
      yield;
    }
  } else if (roll < 0.29 && biome === 'plains') {
    // 野羊群
    for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) {
      const s = hooks.spawnSheep(px + (rng() - 0.5) * 10, pz + (rng() - 0.5) * 10, key);
      if (s) spawned.push(s);
      yield;
    }
  } else if (roll < 0.34 && biome !== 'snow') {
    // 盗贼窝点:黑帐 + 守财匪 + 金币堆
    tentAt(px - 1.6, pz - 1.2, 0x3a3a42);
    campfire(px + 2.5, pz + 1);
    prop('Banner', px - 4.2, pz + 1.5); // 匪帮的血色旗:远远就知道这里有人
    prop('Crates', px + 1.2, pz - 3.6);
    for (let i = 0, n = 2; i < n; i++) {
      const b = hooks.spawnBandit(px + (rng() - 0.5) * 6, pz + (rng() - 0.5) * 6, key);
      if (b) spawned.push(b);
      yield;
    }
    for (let i = 0; i < 7; i++) drop(px + (rng() - 0.5) * 4, pz + (rng() - 0.5) * 4);
  } else if (roll < 0.38) {
    // 猎人营地(安全补给):帐篷 + 一颗心 + 可烤肉的篝火
    tentAt(px - 1.4, pz, 0x5a6a45);
    campfire(px + 2.2, pz);
    prop('Log', px + 2.4, pz + 2.6, 0); // 篝火边的坐木
    hooks.registerSpot('campfire', px + 2.2, pz, key);
    dropH(px + 1, pz + 2);
    drop(px - 1.5, pz + 1);
  } else if (roll < 0.42) {
    // 废弃哨塔:断塔 + 木箱 + 金币(有 Blender 断塔就用它:塔里能走进去,金币撒在塔内外)
    if (prop('BrokenTower', px, pz)) {
      prop('Crates', px + 4.2, pz + 1.6);
      prop('Banner', px - 3.6, pz - 2.2);
      for (let i = 0; i < 6; i++) drop(px + (rng() - 0.5) * 3, pz + (rng() - 0.5) * 3);
    } else {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 4 + rng() * 3, 8), lambert(0x8d8476, { roughness: 0.95 }));
    t.position.set(px, 2.2, pz);
    t.rotation.z = (rng() - 0.5) * 0.12;
    t.castShadow = true;
    g.add(t);
    cols.push({ x: px, z: pz, r: 2.4 });
    for (let i = 0; i < 2; i++) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), lambert(0x8a6a45, { roughness: 0.9 }));
      cr.position.set(px + 2.6 + i, 0.4, pz + 1.5 - i * 2);
      cr.rotation.y = rng() * 2;
      cr.castShadow = true;
      g.add(cr);
    }
    for (let i = 0; i < 6; i++) drop(px + (rng() - 0.5) * 6, pz + (rng() - 0.5) * 6);
    }
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
  } else if (roll < 0.585 && (biome === 'forest' || biome === 'snow')) {
    // 温泉:站进去慢慢回血
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
      new THREE.MeshStandardMaterial({ color: 0x7ad4d8, emissive: 0x1a5a5e, emissiveIntensity: 0.4, roughness: 0.15 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(px, 0.03, pz);
    g.add(pool);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), lambert(0x8a857e));
      st.position.set(px + Math.cos(a) * 2.8, 0.22, pz + Math.sin(a) * 2.8);
      g.add(st);
    }
    hooks.registerSpot('spring', px, pz, key);
  } else if (roll < 0.62) {
    // 遗迹小教堂:断墙 + 石坛,祈祷得庇佑
    const chapelYaw = rng() * Math.PI * 2;
    let chapelProps = false;
    if (prop('Ruin', px - Math.cos(chapelYaw + Math.PI / 2) * 2.8, pz + Math.sin(chapelYaw + Math.PI / 2) * 2.8, chapelYaw) &&
        prop('Ruin', px + Math.cos(chapelYaw + Math.PI / 2) * 2.8, pz - Math.sin(chapelYaw + Math.PI / 2) * 2.8, chapelYaw + Math.PI)) {
      prop('Shrine', px, pz - 1.4, Math.PI / 2);
      chapelProps = true;
    } else for (const [wx, wz, ww] of [[px - 2.4, pz, 0.5], [px + 2.4, pz, 0.5]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, 2.2 + rng(), 4.5), lambert(0x9d9486, { roughness: 0.95 }));
      wall.position.set(wx, 1.1, wz);
      wall.rotation.z = (rng() - 0.5) * 0.08;
      wall.castShadow = true;
      g.add(wall);
      cols.push({ x: wx, z: wz, r: 1.1 });
    }
    if (!chapelProps) {
      const altar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.7), lambert(0xb8b0a2, { roughness: 0.9 }));
      altar.position.set(px, 0.45, pz - 1.4);
      altar.castShadow = true;
      g.add(altar);
    }
    hooks.registerSpot('chapel', px, pz, key);
    drop(px + 1, pz + 1);
    drop(px - 1, pz + 1.5);
  } else if (roll < 0.655) {
    // 陨石坑:焦黑坑沿 + 发光晶簇 + 星屑金币
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3, 0.5, 6, 14), lambert(0x3a352f, { roughness: 1 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(px, 0.15, pz);
    g.add(rim);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1 + rng(), 5),
        new THREE.MeshStandardMaterial({ color: 0x9adce8, emissive: 0x2a6a88, emissiveIntensity: 0.9, roughness: 0.2 }));
      c.position.set(px + (rng() - 0.5) * 2.4, 0.5, pz + (rng() - 0.5) * 2.4);
      c.rotation.z = (rng() - 0.5) * 0.6;
      g.add(c);
    }
    for (let i = 0; i < 5; i++) drop(px + (rng() - 0.5) * 5, pz + (rng() - 0.5) * 5);
  } else if (roll < 0.69 && biome !== 'snow') {
    // 商队残骸:翻倒的货车 + 散落钱箱 + 一个劫道的
    if (prop('Cart', px, pz, null, true)) {
      const cart = g.children[g.children.length - 1];
      cart.children[0].rotation.z = 0.5; // 车翻在路边
      cart.children[0].position.y += 0.35;
      prop('Crates', px + 2.5, pz - 1.5);
    } else {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 1.4), lambert(0x8a6a45, { roughness: 0.95 }));
    bed.position.set(px, 0.6, pz);
    bed.rotation.z = 0.7;
    bed.castShadow = true;
    g.add(bed);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 10), lambert(0x5a4632));
    wheel.position.set(px + 1.4, 0.55, pz + 0.6);
    wheel.rotation.y = rng() * 2;
    wheel.castShadow = true;
    g.add(wheel);
    for (let i = 0; i < 2; i++) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), lambert(0x8a6a45, { roughness: 0.9 }));
      cr.position.set(px + (rng() - 0.5) * 3, 0.35, pz + (rng() - 0.5) * 3);
      cr.rotation.y = rng() * 2;
      g.add(cr);
    }
    cols.push({ x: px, z: pz, r: 1.2 });
    }
    yield;
    const b = hooks.spawnBandit(px + 4, pz + 2, key);
    if (b) spawned.push(b);
    for (let i = 0; i < 6; i++) drop(px + (rng() - 0.5) * 4, pz + (rng() - 0.5) * 4);
  }

  // 群系地标(避开兴趣点中心,免得把营地/窝点压住)
  for (const [name, expect] of LANDMARKS[biome] || []) {
    const n = Math.floor(expect + rng());
    for (let i = 0; i < n; i++) {
      const x = baseX + 6 + rng() * (CHUNK - 12), z = baseZ + 6 + rng() * (CHUNK - 12);
      if (Math.hypot(x - px, z - pz) < 14) continue;
      placeLandmark(g, rng, name, x, z, cols, null, null, insts);
    }
  }

  for (const o of g.children) {
    if (!o.userData.isGround) o.position.y += groundH(o.position.x, o.position.z);
  }
  yield;
  // 程序化树石/兴趣点:按(面向 × 投影 × 受影)烘成几块顶点色网格,原件摘掉
  g.updateMatrixWorld(true);
  const bins = new Map();
  const merged = new Set();
  g.traverse((m) => {
    if (!m.isMesh || m.userData.isGround || !m.geometry || !m.geometry.attributes.position) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (!mats.every((mt) => plainStandard(mt, { allowFlat: true }) && !NIGHT_GLOW.includes(mt))) return;
    for (let p = m; p && p !== g; p = p.parent) if (!p.visible) return;
    const k = `${mats[0].side}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    if (!bins.has(k)) bins.set(k, { side: mats[0].side, cast: m.castShadow, recv: m.receiveShadow, items: [] });
    bins.get(k).items.push({ geometry: m.geometry, material: m.material, matrix: m.matrixWorld });
    merged.add(m);
  });
  yield;
  const outs = [];
  for (const b of bins.values()) {
    const geo = yield* bakeVPBRSteps(b.items, { chunk: 3000 });
    yield;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, vpbrMaterial({ side: b.side }));
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    outs.push(mesh);
  }
  for (const m of merged) {
    m.parent.remove(m);
    if (!m.geometry.userData.shared) m.geometry.dispose();
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!mt.userData.shared) mt.dispose();
  }
  // 掏空的树/石分组摘掉
  for (let i = g.children.length - 1; i >= 0; i--) {
    const o = g.children[i];
    if (o.userData.isGround || o.isMesh) continue;
    let live = false;
    o.traverse((d) => { if (d.isMesh || d.isLight || d.isPoints) live = true; });
    if (!live) g.remove(o);
  }
  for (const m of outs) g.add(m);
  yield;
  // 实例化地标:模板第一次用到时要烘一次顶点色几何(之后全场缓存),一种模板单独一步
  let inst = null;
  if (insts.length) {
    for (const name of new Set(insts.map((p) => p.name))) if (warmNatureTemplate(name)) yield;
    inst = buildNatureInstances(insts);
    g.add(inst);
    yield;
  }
  // 整块冻结:之后每帧的矩阵更新直接跳过这棵子树
  g.userData.noSnap = true;
  g.updateMatrixWorld(true);
  g.traverse((o) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
  scene.add(g);
  addCircles(colliders, cols);
  // props:实例化地标的放置清单 [{ name, x, y, z, yaw, s }](地标不再是组里的克隆网格,地图标注等只读用途读它)
  chunks.set(key, { group: g, inst, props: insts, cols, spawned, key, cx, cz });
}

function unloadChunk(key) {
  const c = chunks.get(key);
  if (!c) return;
  scene.remove(c.group);
  if (c.inst) { releaseNatureInstances(c.inst); c.group.remove(c.inst); }
  c.group.traverse((o) => {
    // flora 库的几何/材质全场共享(userData.shared),不能释放;其余独占资源照常释放
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
  removeCircles(colliders, c.cols);
  hooks.removeChunkEntities(key);
  chunks.delete(key);
}

// 每帧调用:围绕玩家维护区块窗口。生成按时间预算分帧推进(近的先建),卸载每帧至多一块;
// 玩家没走出 24m 且窗口已齐时直接空转,零分配零扫描
let lastX = 1e9, lastZ = 1e9;
let job = null;          // 正在建的区块 { key, it }
const toLoad = [];       // 待建(近的在前)
const toUnload = [];     // 待卸
const BUDGET_MS = 1.2; // 单步最长约 2.7ms(地表网格那一步):一帧的区块活最多 ~4ms
// 玩家到区块矩形的距离(在块内为 0)
function chunkDist(cx, cz, px, pz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const dx = Math.max(x0 - px, 0, px - x0 - CHUNK), dz = Math.max(z0 - pz, 0, pz - z0 - CHUNK);
  return Math.sqrt(dx * dx + dz * dz);
}
function wanted(cx, cz, px, pz) {
  if (chunkDist(cx, cz, px, pz) > LOAD_D) return false;
  const centerX = cx * CHUNK + CHUNK / 2, centerZ = cz * CHUNK + CHUNK / 2;
  if (Math.abs(centerX) < CORE && Math.abs(centerZ) < CORE) return false; // 核心手工区不生成
  return Math.abs(centerX) <= WORLD_LIMIT && Math.abs(centerZ) <= WORLD_LIMIT; // 世界边界外不生成
}

// 地图用:已加载区块里的兴趣点(营地/匪窝/断塔/遗迹/大地标),按区块缓存;只读,不碰构建流程。
// 实例化的地标读区块的放置清单 c.props;没走实例化、单独挂在组里的(例如翻倒的货车)再扫一遍组
const MARK_OF = { Campfire: 'camp', Tent: 'camp', TentDark: 'bandit', Banner: 'bandit', BrokenTower: 'tower',
  Ruin: 'ruin', Shrine: 'ruin', Mesa: 'rock', Spires: 'rock', IceRock: 'rock', Cart: 'camp' };
// out:调用方复用的数组(先清空再填),每帧调用也不分配
const _marks = new WeakMap();
export function wildMarks(out = []) {
  out.length = 0;
  for (const c of chunks.values()) {
    let m = _marks.get(c.group);
    if (!m) {
      m = [];
      const seen = new Set();
      const add = (name, x, z) => {
        const kind = MARK_OF[name];
        if (!kind) return;
        const key = kind + Math.round(x / 6) + ',' + Math.round(z / 6);
        if (seen.has(key)) return; // 同一处营地的帐篷/篝火/旗只标一次
        seen.add(key);
        m.push({ kind, x, z });
      };
      for (const p of c.props || []) add(p.name, p.x, p.z);
      for (const o of c.group.children) if (o.userData.isProp && o.children[0]) add(o.children[0].name, o.position.x, o.position.z);
      _marks.set(c.group, m);
    }
    for (let i = 0; i < m.length; i++) out.push(m[i]);
  }
  return out;
}

export function updateWilderness(px, pz) {
  if (Math.abs(px - lastX) > 24 || Math.abs(pz - lastZ) > 24) {
    lastX = px;
    lastZ = pz;
    toUnload.length = 0;
    for (const c of chunks.values()) if (chunkDist(c.cx, c.cz, px, pz) > LOAD_D + 64) toUnload.push(c.key);
    toLoad.length = 0;
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK), R = Math.ceil(LOAD_D / CHUNK);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!wanted(cx, cz, px, pz) || chunks.has(`${cx},${cz}`) || (job && job.key === `${cx},${cz}`)) continue;
        toLoad.push({ cx, cz, d: chunkDist(cx, cz, px, pz) });
      }
    }
    toLoad.sort((a, b) => a.d - b.d);
  }
  if (!job && !toLoad.length && !toUnload.length) return;
  const t0 = performance.now();
  if (toUnload.length) unloadChunk(toUnload.shift()); // 卸载摊开:每帧至多一块
  while (performance.now() - t0 < BUDGET_MS) {
    if (!job) {
      const next = toLoad.shift();
      if (!next) break;
      const key = `${next.cx},${next.cz}`;
      if (chunks.has(key) || !wanted(next.cx, next.cz, lastX, lastZ)) continue;
      job = { key, it: chunkJob(next.cx, next.cz) };
    }
    if (job.it.next().done) {
      job = null;
      if (!toLoad.length) lastX = 1e9; // 一轮建完:按玩家现在的位置再核一遍(建的时候人可能已经走远)
    }
  }
}
// 诊断/测试:已装区块数、在建与排队情况
export function wildStats() {
  let objects = 0;
  for (const c of chunks.values()) c.group.traverse(() => { objects++; });
  return { chunks: chunks.size, building: !!job, queued: toLoad.length, unloading: toUnload.length, objects };
}
