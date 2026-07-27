// 植被与岩石库:程序化"手工感"素材,替代原先的单球树/裸锥松
// 关键做法:
//  - 几何体在模块加载时生成一小池顶点扰动过的变体,全场共享(userData.shared,卸载区块时不释放)
//  - 树干带弯曲与根部张开,树冠由多个压扁的碎球簇成,自带明暗层次
//  - 材质按颜色缓存共享,数千棵树只占几十个材质
import * as THREE from 'three';
import { nordicColor } from './entities.js';

// ---- 可复现随机(素材池用固定种子,形状稳定) ----
function makeRng(seed) {
  let s = (seed % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---- 共享材质缓存 ----
const matCache = new Map();
export function sharedMat(hex, opts = {}) {
  const key = hex + '|' + (opts.roughness ?? 0.95) + '|' + (opts.flatShading ? 1 : 0);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: nordicColor(hex), roughness: opts.roughness ?? 0.95, metalness: 0,
      flatShading: opts.flatShading ?? false,
    });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

// ---- 几何体工具 ----
function jitter(geo, amt, rng, flattenY = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + (rng() - 0.5) * amt,
      (p.getY(i) + (rng() - 0.5) * amt) * flattenY,
      p.getZ(i) + (rng() - 0.5) * amt);
  }
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return geo;
}
// 弯曲 + 收腰的树干:顶点沿高度做二次曲线偏移
function bentTrunk(rng, h = 2.2, r0 = 0.34, r1 = 0.16) {
  const geo = new THREE.CylinderGeometry(r1, r0, h, 7, 4);
  const p = geo.attributes.position;
  const bendX = (rng() - 0.5) * 0.5, bendZ = (rng() - 0.5) * 0.5;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h; // 0 底 → 1 顶
    p.setX(i, p.getX(i) + bendX * t * t + (rng() - 0.5) * 0.03);
    p.setZ(i, p.getZ(i) + bendZ * t * t + (rng() - 0.5) * 0.03);
  }
  geo.computeVertexNormals();
  geo.userData.shared = true;
  return geo;
}

// ---- 素材池(模块加载时一次性生成) ----
const poolRng = makeRng(777001);
const CANOPY = []; // 压扁碎球(树冠件):扰动要克制,才是"团簇"而不是"碎纸"
for (let i = 0; i < 7; i++) {
  CANOPY.push(jitter(new THREE.IcosahedronGeometry(1, 1), 0.2, poolRng, 0.85));
}
const TRUNKS = [];
for (let i = 0; i < 5; i++) TRUNKS.push(bentTrunk(poolRng));
const PINE_TIERS = []; // 松塔层
for (let i = 0; i < 6; i++) {
  PINE_TIERS.push(jitter(new THREE.ConeGeometry(1, 1, 9), 0.12, poolRng));
}
const ROCKS = [];
for (let i = 0; i < 6; i++) {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.36, poolRng);
  // 底部压平,坐得住地
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) if (p.getY(k) < -0.55) p.setY(k, -0.55);
  g.computeVertexNormals();
  ROCKS.push(g);
}
const ROOTG = jitter(new THREE.ConeGeometry(0.16, 0.5, 5), 0.03, poolRng); // 根瘤
// 枯枝/仙人掌部件池(单位尺寸,实例用 scale 变化;绝不在 build 时新建几何体)
const BRANCHES = [];
for (let i = 0; i < 4; i++) BRANCHES.push(jitter(new THREE.CylinderGeometry(0.03, 0.09, 1, 5), 0.015, poolRng));
const CACTUS_BODY = jitter(new THREE.CylinderGeometry(0.28, 0.34, 1, 8), 0.008, poolRng);
const CACTUS_CAP = (() => {
  const g = new THREE.SphereGeometry(0.29, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  g.userData.shared = true;
  return g;
})();
const CACTUS_ELBOW = (() => {
  const g = new THREE.CylinderGeometry(0.14, 0.14, 0.5, 7);
  g.userData.shared = true;
  return g;
})();
const CACTUS_ARM = (() => {
  const g = new THREE.CylinderGeometry(0.14, 0.15, 1, 7);
  g.userData.shared = true;
  return g;
})();
const FLOWERG = (() => {
  const g = new THREE.SphereGeometry(0.12, 6, 4);
  g.userData.shared = true;
  return g;
})();
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
// 色阶量化到 1/16,材质缓存有界(不会因随机浮点无限增殖)
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(Math.round(f * 16) / 16).getHex();

// ---- 阔叶树:弯干 + 根部张开 + 3~5 个碎球树冠(下暗上亮) ----
// ---- Blender 资产工厂:写实树模板(GLB 解析后注入;克隆共享几何/材质,零额外显存) ----
const TREE_MODELS = { oak: null, pine: null, birch: null };
export function setTreeModel(kind, group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.geometry.userData.shared = true; // 区块卸载时不 dispose 共享资源
      if (o.material) o.material.userData.shared = true;
    }
  });
  TREE_MODELS[kind] = group;
}
// 建筑模板(house 等)与岩石几何池注入
const BUILDING_MODELS = {};
export function setBuildingModel(kind, group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      o.geometry.userData.shared = true;
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.userData.shared = true; });
    }
  });
  BUILDING_MODELS[kind] = group;
}
export function getBuildingModel(kind) { return BUILDING_MODELS[kind] || null; }
export function setRockGeos(geos) {
  if (!geos.length) return;
  ROCKS.length = 0;
  for (const g of geos) {
    g.userData.shared = true;
    ROCKS.push(g);
  }
}

function cloneTreeModel(kind, rng, scale = 1) {
  const tpl = TREE_MODELS[kind];
  if (!tpl) return null;
  const g = tpl.clone();
  const s = scale * (0.85 + rng() * 0.4);
  g.scale.set(s, s, s);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

export function buildTree(rng, opts = {}) {
  // 有 Blender 写实模型就用它(桦木三成概率换换口味);没有则回退程序化积木树
  if (!opts.leaf && !opts.bark) {
    const real = cloneTreeModel(rng() < 0.3 ? 'birch' : 'oak', rng, 1.15);
    if (real) return { group: real, r: 0.5 };
  }
  const g = new THREE.Group();
  const leaf = opts.leaf ?? 0x4a9153;
  const bark = opts.bark ?? 0x6b4a2f;
  const trunk = new THREE.Mesh(pick(rng, TRUNKS), sharedMat(bark));
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  g.add(trunk);
  // 根部张开:3~4 个斜插的小锥
  for (let i = 0, n = 3 + Math.floor(rng() * 2); i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const root = new THREE.Mesh(ROOTG, sharedMat(shade(bark, 0.85)));
    root.position.set(Math.cos(a) * 0.3, 0.18, Math.sin(a) * 0.3);
    root.rotation.z = Math.cos(a) * 0.7;
    root.rotation.x = -Math.sin(a) * 0.7;
    g.add(root);
  }
  // 树冠:主球在顶,卫星球环绕略低,底部球更暗(自阴影感)
  const blobs = 3 + Math.floor(rng() * 3);
  const baseY = 2.35 + rng() * 0.3;
  for (let i = 0; i < blobs; i++) {
    const main = i === 0;
    const s = main ? 1.35 + rng() * 0.35 : 0.7 + rng() * 0.5;
    const a = rng() * Math.PI * 2;
    const rr = main ? 0 : 0.75 + rng() * 0.55;
    const y = main ? baseY + 0.45 : baseY - 0.15 + rng() * 0.5;
    const f = main ? 1.06 : 0.78 + rng() * 0.22; // 上亮下暗
    const blob = new THREE.Mesh(pick(rng, CANOPY), sharedMat(shade(leaf, f)));
    blob.scale.setScalar(s);
    blob.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
    blob.rotation.y = rng() * 6.28;
    blob.castShadow = main; // 只有主冠投影,阴影通道省一半
    g.add(blob);
  }
  return { group: g, r: 0.55 };
}

// ---- 针叶松:4 层扰动松塔,层间错位微倾,可加积雪 ----
export function buildPine(rng, opts = {}) {
  if (!opts.leaf && !opts.snow) {
    const real = cloneTreeModel('pine', rng, 1.2);
    if (real) return { group: real, r: 0.45 };
  }
  const g = new THREE.Group();
  const leaf = opts.leaf ?? 0x2d6b3f;
  const snow = !!opts.snow;
  const trunk = new THREE.Mesh(pick(rng, TRUNKS), sharedMat(opts.bark ?? 0x5a4632));
  trunk.scale.set(0.75, 0.8, 0.75);
  trunk.position.y = 0.9;
  trunk.castShadow = true;
  g.add(trunk);
  const tiers = 3 + Math.floor(rng() * 2);
  let y = 1.5;
  for (let i = 0; i < tiers; i++) {
    const w = 1.65 - i * (1.15 / tiers);
    const h = 1.35 - i * 0.12;
    const dx = (rng() - 0.5) * 0.22, dz = (rng() - 0.5) * 0.22;
    const tier = new THREE.Mesh(pick(rng, PINE_TIERS), sharedMat(shade(leaf, 0.82 + i * 0.12)));
    tier.scale.set(w, h, w);
    tier.position.set(dx, y + h * 0.4, dz);
    tier.castShadow = i < 2;
    g.add(tier);
    if (snow) {
      const cap = new THREE.Mesh(pick(rng, PINE_TIERS), sharedMat(0xe8eef4, { roughness: 0.85 }));
      cap.scale.set(w * 0.92, h * 0.3, w * 0.92);
      cap.position.set(dx, y + h * 0.78, dz);
      g.add(cap);
    }
    y += h * 0.62;
  }
  return { group: g, r: 0.5 };
}

// ---- 枯树/焦木:弯干 + 2~4 根扭曲枯枝 ----
export function buildDeadTree(rng, opts = {}) {
  const g = new THREE.Group();
  const bark = opts.bark ?? 0x4a4038;
  const trunk = new THREE.Mesh(pick(rng, TRUNKS), sharedMat(bark, { roughness: 1 }));
  trunk.scale.set(0.8, 1.15, 0.8);
  trunk.position.y = 1.25;
  trunk.rotation.z = (rng() - 0.5) * 0.16;
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) {
    const br = new THREE.Mesh(pick(rng, BRANCHES), sharedMat(shade(bark, 0.9), { roughness: 1 }));
    br.scale.y = 0.9 + rng() * 0.7;
    const a = rng() * Math.PI * 2;
    br.position.set(Math.cos(a) * 0.18, 1.5 + rng() * 0.9, Math.sin(a) * 0.18);
    br.rotation.z = Math.cos(a) * (0.7 + rng() * 0.5);
    br.rotation.x = -Math.sin(a) * (0.7 + rng() * 0.5);
    g.add(br);
  }
  return { group: g, r: 0.4 };
}

// ---- 仙人掌:圆顶主柱 + 1~2 条手臂 + 偶尔开花 ----
export function buildCactus(rng, opts = {}) {
  const g = new THREE.Group();
  const green = opts.leaf ?? 0x3f8a4f;
  const h = 1.8 + rng() * 1.2;
  const body = new THREE.Mesh(CACTUS_BODY, sharedMat(green, { roughness: 0.9 }));
  body.scale.y = h;
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  const cap = new THREE.Mesh(CACTUS_CAP, sharedMat(green, { roughness: 0.9 }));
  cap.position.y = h;
  g.add(cap);
  for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) {
    const side = rng() < 0.5 ? 1 : -1;
    const ay = h * (0.35 + rng() * 0.3);
    const elbow = new THREE.Mesh(CACTUS_ELBOW, sharedMat(shade(green, 0.92), { roughness: 0.9 }));
    elbow.rotation.z = Math.PI / 2;
    elbow.position.set(side * 0.42, ay, (rng() - 0.5) * 0.2);
    g.add(elbow);
    const armH = 0.7 + rng() * 0.6;
    const arm = new THREE.Mesh(CACTUS_ARM, sharedMat(shade(green, 1.04), { roughness: 0.9 }));
    arm.scale.y = armH;
    arm.position.set(side * 0.62, ay + armH / 2, elbow.position.z);
    arm.castShadow = true;
    g.add(arm);
  }
  if (rng() < 0.35) {
    const flower = new THREE.Mesh(FLOWERG, sharedMat(0xe86a8a, { roughness: 0.6 }));
    flower.position.y = h + 0.26;
    g.add(flower);
  }
  return { group: g, r: 0.45 };
}

// ---- 岩石:1~3 块簇生 + 偶尔顶部长苔 ----
export function buildRock(rng, opts = {}) {
  const g = new THREE.Group();
  const base = opts.color ?? 0x77726c;
  const n = 1 + Math.floor(rng() * 3);
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const s = (i === 0 ? 0.7 : 0.35) + rng() * (i === 0 ? 0.8 : 0.4);
    const rock = new THREE.Mesh(pick(rng, ROCKS), sharedMat(shade(base, 0.85 + rng() * 0.3), { flatShading: true }));
    rock.scale.set(s, s * (0.75 + rng() * 0.4), s);
    const a = rng() * Math.PI * 2;
    const rr = i === 0 ? 0 : 0.5 + rng() * 0.4;
    rock.position.set(Math.cos(a) * rr, s * 0.45, Math.sin(a) * rr);
    rock.rotation.y = rng() * 6.28;
    rock.castShadow = i === 0;
    g.add(rock);
    maxR = Math.max(maxR, s * 0.9 + rr * 0.5);
    if (i === 0 && rng() < 0.4 && !opts.noMoss) {
      const moss = new THREE.Mesh(pick(rng, CANOPY), sharedMat(opts.moss ?? 0x3f6b3a));
      moss.scale.set(s * 0.7, s * 0.22, s * 0.7);
      moss.position.set(0, s * 0.82, 0);
      g.add(moss);
    }
  }
  return { group: g, r: Math.max(0.6, maxR * 0.8) };
}

// ---- 灌木:两三个矮碎球 ----
export function buildBush(rng, opts = {}) {
  const g = new THREE.Group();
  const leaf = opts.leaf ?? 0x4a8a4f;
  for (let i = 0, n = 2 + Math.floor(rng() * 2); i < n; i++) {
    const s = 0.4 + rng() * 0.35;
    const b = new THREE.Mesh(pick(rng, CANOPY), sharedMat(shade(leaf, 0.85 + rng() * 0.3)));
    b.scale.setScalar(s);
    b.position.set((rng() - 0.5) * 0.7, s * 0.6, (rng() - 0.5) * 0.7);
    b.castShadow = i === 0;
    g.add(b);
  }
  return { group: g, r: 0.4 };
}
