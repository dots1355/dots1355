// 无尽荒野:核心王国(±500)之外的 1000000×1000000 世界由区块程序化生成
// 128×128 一块,随玩家加载/卸载;同一坐标永远生成同样的内容(坐标哈希做种子)
import * as THREE from 'three';
import { lambert } from './entities.js';
import { buildTree, buildPine, buildDeadTree, buildCactus, buildRock, buildBush, natureProp } from './flora.js';
import { dominantBiome, groundH, buildGroundMesh, getGroundMaterial } from './terrain.js';

export const CHUNK = 128;
export const VIEW_R = 2;          // 加载半径(区块数)
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
// 放一件地标;avoid(x,z) 返回 true 则跳过。返回是否放成
export function placeLandmark(parent, rng, name, x, z, cols, colList, yaw = null) {
  const big = BIG_PROP[name];
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
    colList.push(col);
    if (cols) cols.push(col);
  }
  return true;
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

  // 地表:按地形烘焙的一块起伏网格(群系配色已在顶点色里)
  g.add(buildGroundMesh(baseX, baseZ, CHUNK, getGroundMaterial()));

  // 植被密度按群系
  const treeN = biome === 'forest' ? 12 + Math.floor(rng() * 8)
    : biome === 'plains' || biome === 'hills' ? 3 + Math.floor(rng() * 4)
    : biome === 'swamp' ? 5 + Math.floor(rng() * 4)
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
  const prop = (name, x, z, yaw = null) => placeLandmark(g, rng, name, x, z, cols, colliders.circles, yaw);
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
    tentAt(px - 1.6, pz - 1.2, 0x3a3a42);
    campfire(px + 2.5, pz + 1);
    prop('Banner', px - 4.2, pz + 1.5); // 匪帮的血色旗:远远就知道这里有人
    prop('Crates', px + 1.2, pz - 3.6);
    for (let i = 0, n = 2; i < n; i++) {
      const b = hooks.spawnBandit(px + (rng() - 0.5) * 6, pz + (rng() - 0.5) * 6, key);
      if (b) spawned.push(b);
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
      const col = { x: wx, z: wz, r: 1.1 };
      colliders.circles.push(col);
      cols.push(col);
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
    if (prop('Cart', px, pz)) {
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
    const col = { x: px, z: pz, r: 1.2 };
    colliders.circles.push(col);
    cols.push(col);
    }
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
      placeLandmark(g, rng, name, x, z, cols, colliders.circles);
    }
  }

  for (const o of g.children) {
    if (!o.userData.isGround) o.position.y += groundH(o.position.x, o.position.z);
  }
  g.userData.noSnap = true;
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

// 地图用:已加载区块里的兴趣点(营地/匪窝/断塔/遗迹/大地标),按区块缓存;只读,不碰构建流程
const MARK_OF = { Campfire: 'camp', Tent: 'camp', TentDark: 'bandit', Banner: 'bandit', BrokenTower: 'tower',
  Ruin: 'ruin', Shrine: 'ruin', Mesa: 'rock', Spires: 'rock', IceRock: 'rock', Cart: 'camp' };
const _marks = new WeakMap();
export function wildMarks() {
  const out = [];
  for (const c of chunks.values()) {
    let m = _marks.get(c.group);
    if (!m) {
      m = [];
      const seen = new Set();
      for (const o of c.group.children) {
        const kind = o.userData.isProp && o.children[0] ? MARK_OF[o.children[0].name] : null;
        if (!kind) continue;
        const key = kind + Math.round(o.position.x / 6) + ',' + Math.round(o.position.z / 6);
        if (seen.has(key)) continue; // 同一处营地的帐篷/篝火/旗只标一次
        seen.add(key);
        m.push({ kind, x: o.position.x, z: o.position.z });
      }
      _marks.set(c.group, m);
    }
    for (const k of m) out.push(k);
  }
  return out;
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
