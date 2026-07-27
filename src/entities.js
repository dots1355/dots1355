// 角色与马匹的低多边形卡通模型构建器 + 通用碰撞/数学工具
import * as THREE from 'three';

// 名字沿用 lambert,实际已升级为 PBR 标准材质
// 北境写实调:所有过手的颜色饱和度砍半、整体沉一分——把糖果色世界拉回大地色系
const _hsl = {};
export function nordicColor(c) {
  const col = new THREE.Color(c);
  col.getHSL(_hsl);
  col.setHSL(_hsl.h, _hsl.s * 0.5, _hsl.l * 0.94);
  return col;
}
export function lambert(c, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: nordicColor(c), roughness: 0.88, metalness: 0.04, ...opts });
}

// ---- 人形角色(面朝 +Z)----
// ---- Blender 写实人体模板(GLB 解析后注入;无模板时回退积木人)----
let HUMAN_TPL = null;
export function setHumanModel(scene) {
  const f = (n) => scene.getObjectByName(n);
  const t = { torso: f('Torso'), belt: f('Belt'), head: f('Head'), nose: f('Nose'),
    eyeL: f('EyeL'), eyeR: f('EyeR'), earL: f('EarL'), earR: f('EarR'),
    leg: f('Leg'), arm: f('Arm') };
  if (t.torso && t.head && t.leg && t.arm) HUMAN_TPL = t;
}
// 染色材质缓存:同色同件全场共享,几十个 NPC 只产出一小撮材质
const humMats = new Map();
function humMat(slot, hex) {
  const key = slot + '|' + hex;
  let m = humMats.get(key);
  if (!m) {
    m = lambert(hex, { roughness: slot === 'skin' ? 0.62 : slot === 'boots' ? 0.55 : 0.9 });
    humMats.set(key, m);
  }
  return m;
}
function humClone(tpl, colors) {
  const c = tpl.clone();
  c.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const remap = (mm) => {
      const slot = mm.name;
      return colors[slot] !== undefined ? humMat(slot, colors[slot]) : mm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
  });
  return c;
}
// 帽盔/兜帽/头发/佩剑:两条构建路径共用
function applyHumanProps(g, parts, opts) {
  const { hair = 0x3a2a1a, helmet = false, cap = false, hood = false, sword = false } = opts;
  const head = parts.head;
  if (helmet) {
    const metal = lambert(0x9aa4ad, { roughness: 0.32, metalness: 0.85 });
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), metal);
    h.position.y = 0.02;
    head.add(h);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.04, 10), metal);
    brim.position.y = 0.05;
    head.add(brim);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 6), metal);
    spike.position.y = 0.28;
    head.add(spike);
  } else if (cap) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.48, 8), lambert(0x1f7a3d, { roughness: 0.9 }));
    c.position.set(0, 0.26, -0.05);
    c.rotation.x = -0.3;
    head.add(c);
  } else if (hood) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.42, 8), lambert(0x3b3b46, { roughness: 0.95 }));
    h.position.y = 0.14;
    head.add(h);
  } else {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.215, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), lambert(hair, { roughness: 0.95 }));
    h.position.y = 0.015;
    head.add(h);
  }
  if (sword) {
    const swordGroup = new THREE.Group();
    const real = getWeaponModel('Sword');
    if (real) {
      real.position.set(0, 0, 0);
      swordGroup.add(real);
      swordGroup.position.y = -0.4;
    } else {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.03), lambert(0xd8dde2));
      blade.position.y = -0.62;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), lambert(0xc9a227));
      guard.position.y = -0.26;
      swordGroup.add(blade, guard);
      swordGroup.position.y = -0.2;
    }
    parts.armR.add(swordGroup);
    parts.sword = swordGroup;
  }
}

export function makeHumanoid(opts = {}) {
  const {
    skin = 0xf1c27d, shirt = 0x2f8f4e, pants = 0x4a3320,
    hair = 0x3a2a1a, helmet = false, cap = false, hood = false, sword = false,
  } = opts;
  // Blender 写实人体路径:细分曲面部件 + 染色共享材质,枢轴与积木人逐位一致
  if (HUMAN_TPL) {
    const g = new THREE.Group();
    const parts = {};
    const colors = { skin, shirt, pants, boots: 0x2e2318 };
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.12 * side, 0.5, 0);
      pivot.add(humClone(HUMAN_TPL.leg, colors));
      g.add(pivot);
      parts[side === -1 ? 'legL' : 'legR'] = pivot;
    }
    const body = humClone(HUMAN_TPL.torso, colors);
    body.position.y = 0.78;
    g.add(body);
    parts.body = body;
    const belt = humClone(HUMAN_TPL.belt || HUMAN_TPL.torso, colors);
    if (HUMAN_TPL.belt) {
      belt.position.y = 0.78;
      g.add(belt);
    }
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.32 * side, 1.0, 0);
      pivot.add(humClone(HUMAN_TPL.arm, colors));
      g.add(pivot);
      parts[side === -1 ? 'armL' : 'armR'] = pivot;
    }
    const headG = new THREE.Group();
    for (const k of ['head', 'nose', 'eyeL', 'eyeR', 'earL', 'earR']) {
      if (HUMAN_TPL[k]) headG.add(humClone(HUMAN_TPL[k], colors));
    }
    headG.position.y = 1.32;
    g.add(headG);
    parts.head = headG;
    applyHumanProps(g, parts, opts);
    return { group: g, parts };
  }
  const g = new THREE.Group();
  const parts = {};
  const skinMat = lambert(skin, { roughness: 0.6 });
  const shirtMat = lambert(shirt, { roughness: 0.88 });

  const legGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.46, 8);
  const bootGeo = new THREE.BoxGeometry(0.2, 0.12, 0.28);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.12 * side, 0.5, 0);
    const leg = new THREE.Mesh(legGeo, lambert(pants));
    leg.position.y = -0.23;
    leg.castShadow = true;
    pivot.add(leg);
    const boot = new THREE.Mesh(bootGeo, lambert(0x2e2318, { roughness: 0.55 }));
    boot.position.set(0, -0.45, 0.03);
    boot.castShadow = true;
    pivot.add(boot);
    g.add(pivot);
    parts[side === -1 ? 'legL' : 'legR'] = pivot;
  }

  // 束腰上衣(下摆略宽)+ 腰带
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.58, 10), shirtMat);
  body.position.y = 0.78;
  body.castShadow = true;
  g.add(body);
  parts.body = body;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.25, 0.09, 10),
    lambert(0x4a3220, { roughness: 0.5 }));
  belt.position.y = 0.62;
  g.add(belt);
  // 肩部
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), shirtMat);
    sh.position.set(0.26 * side, 1.02, 0);
    g.add(sh);
  }

  const armGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.46, 8);
  const handGeo = new THREE.SphereGeometry(0.07, 8, 6);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.32 * side, 1.0, 0);
    const arm = new THREE.Mesh(armGeo, shirtMat);
    arm.position.y = -0.2;
    arm.castShadow = true;
    pivot.add(arm);
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.y = -0.45;
    pivot.add(hand);
    g.add(pivot);
    parts[side === -1 ? 'armL' : 'armR'] = pivot;
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), skinMat);
  head.scale.set(1, 1.08, 1);
  head.position.y = 1.32;
  head.castShadow = true;
  g.add(head);
  parts.head = head;
  // 眼睛
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5),
      lambert(0x1a1410, { roughness: 0.25 }));
    eye.position.set(0.075 * side, 0.03, 0.17);
    head.add(eye);
  }
  // 鼻子
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), skinMat);
  nose.position.set(0, -0.03, 0.19);
  head.add(nose);

  applyHumanProps(g, parts, opts);

  return { group: g, parts };
}

// ---- Blender 动物模板(马/狼;鹿=马+角) ----
let HORSE_TPL = null, WOLF_TPL = null;
export function setFaunaModel(kind, scene) {
  scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  if (kind === 'horse') HORSE_TPL = scene;
  else if (kind === 'wolf') WOLF_TPL = scene;
}
function tintClone(node, slots) {
  const c = node.clone();
  c.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    const remap = (mm) => (slots[mm.name] !== undefined ? humMatPublic(mm.name, slots[mm.name]) : mm);
    o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
  });
  return c;
}
function humMatPublic(slot, hex) { return humMat(slot, hex); }
// ---- Blender 武器模板(铁剑/巨剑/短匕/猎弓) ----
let WEAPONS_TPL = null;
export function setWeaponModels(scene) {
  scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  WEAPONS_TPL = scene;
}
export function getWeaponModel(name) {
  if (!WEAPONS_TPL) return null;
  const src = WEAPONS_TPL.getObjectByName(name);
  return src ? src.clone() : null;
}

// ---- 马(面朝 +Z)----
export function makeHorse(color = 0x8b5a2b, saddled = true, opts = {}) {
  // Blender 写实马:脊柱放样整体身躯,腿为模板克隆挂进原枢轴
  if (HORSE_TPL) {
    const g = new THREE.Group();
    const parts = { legs: [] };
    const darkHex = new THREE.Color(color).multiplyScalar(0.66).getHex();
    const maneHex2 = opts.antlers ? darkHex : (opts.mane ?? 0x2e2018);
    const slots = { coat: color, dark: darkHex, mane: maneHex2 };
    const body = tintClone(HORSE_TPL, slots);
    const legTpl = body.getObjectByName('HorseLeg');
    if (legTpl) legTpl.parent.remove(legTpl);
    const toRemove = [];
    body.traverse((o) => {
      if (o.name.startsWith('Antlers') && !opts.antlers) toRemove.push(o);
      if (o.name === 'Saddle' && !saddled) toRemove.push(o);
      if (o.name === 'Mane' && opts.antlers) toRemove.push(o);
      if (o.name === 'Blaze' && (opts.antlers || Math.random() >= 0.3)) toRemove.push(o);
    });
    for (const o of toRemove) o.parent && o.parent.remove(o);
    g.add(body);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.24 * sx, 0.85, 0.62 * sz);
      if (legTpl) pivot.add(tintClone(legTpl, slots));
      g.add(pivot);
      parts.legs.push(pivot);
    }
    return { group: g, parts };
  }
  const g = new THREE.Group();
  const parts = { legs: [] };
  const dark = new THREE.Color(color).multiplyScalar(0.7).getHex();
  const maneHex = opts.mane ?? 0x2e2018;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 6, 12), lambert(color, { roughness: 0.7 }));
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.92);
  body.position.y = 1.08;
  body.castShadow = true;
  g.add(body);
  // 前胸略鼓,剪影更像马
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), lambert(color, { roughness: 0.7 }));
  chest.scale.set(1, 0.9, 0.8);
  chest.position.set(0, 1.1, 0.55);
  g.add(chest);

  const legGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.8, 7);
  const hoofGeo = new THREE.CylinderGeometry(0.085, 0.095, 0.1, 7);
  const hoofMat = lambert(0x241c14);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.24 * sx, 0.85, 0.62 * sz);
    const leg = new THREE.Mesh(legGeo, lambert(dark));
    leg.position.y = -0.4;
    leg.castShadow = true;
    pivot.add(leg);
    const hoof = new THREE.Mesh(hoofGeo, hoofMat);
    hoof.position.y = -0.82;
    pivot.add(hoof);
    g.add(pivot);
    parts.legs.push(pivot);
  }

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.32), lambert(color));
  neck.position.set(0, 1.5, 0.75);
  neck.rotation.x = 0.45;
  neck.castShadow = true;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.42), lambert(color));
  head.position.set(0, 1.85, 1.0);
  head.castShadow = true;
  g.add(head);
  // 口鼻:略细一号,吻端更深色
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.24), lambert(dark));
  muzzle.position.set(0, 1.8, 1.28);
  g.add(muzzle);
  // 面斑(三成的马有一道白)
  if (Math.random() < 0.3) {
    const blaze = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.3), lambert(0xe8e2d4));
    blaze.position.set(0, 1.94, 1.1);
    blaze.rotation.x = -0.2;
    g.add(blaze);
  }

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), lambert(dark));
    ear.position.set(0.09 * s, 2.05, 0.9);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), lambert(0x14100c));
    eye.position.set(0.13 * s, 1.9, 1.1);
    g.add(eye);
  }

  if (opts.antlers) {
    // 鹿角:主干斜出 + 两根分叉
    const antMat = lambert(0xcdbA96, { roughness: 0.8 });
    for (const s of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 5), antMat);
      beam.position.set(0.12 * s, 2.2, 0.85);
      beam.rotation.z = -s * 0.5;
      beam.rotation.x = -0.25;
      g.add(beam);
      for (const [ty, tz, tr] of [[0.14, 0.02, 0.8], [0.3, -0.03, 0.45]]) {
        const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.22, 4), antMat);
        tine.position.set(0.12 * s + s * 0.09, 2.2 + ty, 0.85 + tz);
        tine.rotation.z = -s * tr;
        g.add(tine);
      }
    }
  } else {
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.34), lambert(maneHex));
    mane.position.set(0, 1.68, 0.62);
    mane.rotation.x = 0.45;
    g.add(mane);
    const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.1), lambert(maneHex));
    forelock.position.set(0, 2.02, 0.98);
    g.add(forelock);
  }

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.1, 0.62, 6), lambert(opts.antlers ? dark : maneHex));
  tail.position.set(0, 1.05, -0.95);
  tail.rotation.x = -0.55;
  g.add(tail);

  if (saddled) {
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.55), lambert(0x7a1f1f));
    saddle.position.y = 1.44;
    g.add(saddle);
    // 鞍垫与缰绳意象:一条浅色肚带
    const girth = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.1), lambert(0x9a8464));
    girth.scale.z = 1;
    girth.position.set(0, 1.15, 0);
    g.add(girth);
  }

  return { group: g, parts };
}

// ---- 狼(面朝 +Z)----
export function makeWolf(furHex = 0x5a5a62, eyeHex = 0xff3322, eyeGlow = 0xaa1100) {
  // Blender 写实狼:耸肩薄腰的兽形放样,双眼替换为发光材质
  if (WOLF_TPL) {
    const g = new THREE.Group();
    const parts = { legs: [] };
    const darkHex = new THREE.Color(furHex).multiplyScalar(0.66).getHex();
    const slots = { fur: furHex, dfur: darkHex };
    const body = tintClone(WOLF_TPL, slots);
    const legTpl = body.getObjectByName('WolfLeg');
    if (legTpl) legTpl.parent.remove(legTpl);
    body.traverse((o) => {
      if (o.isMesh && o.name.startsWith('Eye')) {
        o.material = new THREE.MeshStandardMaterial({ color: eyeHex, emissive: eyeGlow, emissiveIntensity: 1.2 });
      }
    });
    g.add(body);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.15 * sx, 0.5, 0.32 * sz);
      if (legTpl) pivot.add(tintClone(legTpl, slots));
      g.add(pivot);
      parts.legs.push(pivot);
    }
    return { group: g, parts };
  }
  const g = new THREE.Group();
  const parts = { legs: [] };
  const fur = lambert(furHex, { roughness: 0.95 });
  const dark = lambert(new THREE.Color(furHex).multiplyScalar(0.66).getHex(), { roughness: 0.95 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.7, 5, 9), fur);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);

  const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.45, 6);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.15 * sx, 0.5, 0.32 * sz);
    const leg = new THREE.Mesh(legGeo, dark);
    leg.position.y = -0.22;
    leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    parts.legs.push(pivot);
  }

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.3), fur);
  head.position.set(0, 0.78, 0.55);
  head.castShadow = true;
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.2), dark);
  snout.position.set(0, 0.72, 0.75);
  g.add(snout);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 4), dark);
    ear.position.set(0.09 * s, 0.95, 0.5);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4),
      new THREE.MeshStandardMaterial({ color: eyeHex, emissive: eyeGlow, emissiveIntensity: 1.2 }));
    eye.position.set(0.07 * s, 0.82, 0.7);
    g.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.45, 5), fur);
  tail.position.set(0, 0.72, -0.55);
  tail.rotation.x = 0.9;
  g.add(tail);

  return { group: g, parts };
}

// ---- 鸡(面朝 +Z,惹不起的存在)----
export function makeChicken() {
  const g = new THREE.Group();
  const parts = { legs: [] };
  const white = lambert(0xf2eee6, { roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), white);
  body.scale.set(1, 0.95, 1.25);
  body.position.y = 0.26;
  body.castShadow = true;
  g.add(body);
  parts.body = body;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6), white);
  head.position.set(0, 0.46, 0.16);
  g.add(head);
  parts.head = head;
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), lambert(0xe8a020));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0, 0.11);
  head.add(beak);
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.08), lambert(0xd03030));
  comb.position.set(0, 0.1, 0);
  head.add(comb);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 5), white);
  tail.rotation.x = -Math.PI / 3;
  tail.position.set(0, 0.34, -0.2);
  g.add(tail);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4), lambert(0xe8a020));
    leg.position.set(0.05 * s, 0.09, 0);
    g.add(leg);
    parts.legs.push(leg);
  }
  return { group: g, parts };
}

// ---- 绵羊(面朝 +Z,可以骑,为什么不呢)----
export function makeSheep() {
  const g = new THREE.Group();
  const parts = { legs: [] };
  const woolGeo = new THREE.IcosahedronGeometry(0.42, 1);
  {
    const p = woolGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i,
        p.getX(i) + (Math.random() - 0.5) * 0.1,
        p.getY(i) + (Math.random() - 0.5) * 0.1,
        p.getZ(i) + (Math.random() - 0.5) * 0.1);
    }
    woolGeo.computeVertexNormals();
  }
  const wool = new THREE.Mesh(woolGeo, lambert(0xf0ece2, { roughness: 1 }));
  wool.scale.set(1, 0.9, 1.3);
  wool.position.y = 0.58;
  wool.castShadow = true;
  g.add(wool);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.26), lambert(0x2e2a26));
  head.position.set(0, 0.72, 0.56);
  head.castShadow = true;
  g.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.06), lambert(0x2e2a26));
    ear.position.set(0.13 * s, 0.06, -0.02);
    ear.rotation.z = -s * 0.5;
    head.add(ear);
  }
  const legGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.4, 5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.18 * sx, 0.42, 0.3 * sz);
    const leg = new THREE.Mesh(legGeo, lambert(0x2e2a26));
    leg.position.y = -0.18;
    pivot.add(leg);
    g.add(pivot);
    parts.legs.push(pivot);
  }
  return { group: g, parts };
}

// ---- 碰撞:圆形与轴对齐盒 ----
// 圆形碰撞体走空间哈希网格:每个实体每帧只查身边 1~4 格,而不是线性扫全表。
// 荒野区块增删碰撞体后置 colliders.dirty = true(或长度变化)即自动重建。
const GRID_CELL = 16;
let _grid = null, _gridSrc = null, _gridLen = -1;
let _boxGrid = null, _bigBoxes = null, _boxSrc = null, _boxLen = -1;
const _gk = (gx, gz) => gx * 200003 + gz;

function rebuildCircleGrid(circles) {
  _grid = new Map();
  for (const c of circles) {
    const x0 = Math.floor((c.x - c.r) / GRID_CELL), x1 = Math.floor((c.x + c.r) / GRID_CELL);
    const z0 = Math.floor((c.z - c.r) / GRID_CELL), z1 = Math.floor((c.z + c.r) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = _gk(gx, gz);
        let cell = _grid.get(k);
        if (!cell) { cell = []; _grid.set(k, cell); }
        cell.push(c);
      }
    }
  }
}
function rebuildBoxGrid(boxes) {
  _boxGrid = new Map();
  _bigBoxes = [];
  for (const b of boxes) {
    const x0 = Math.floor(b.minX / GRID_CELL), x1 = Math.floor(b.maxX / GRID_CELL);
    const z0 = Math.floor(b.minZ / GRID_CELL), z1 = Math.floor(b.maxZ / GRID_CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) { _bigBoxes.push(b); continue; } // 世界边界墙等超长盒走线性
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const k = _gk(gx, gz);
        let cell = _boxGrid.get(k);
        if (!cell) { cell = []; _boxGrid.set(k, cell); }
        cell.push(b);
      }
    }
  }
}

function resolveCircle(p, r, c) {
  const dx = p.x - c.x, dz = p.z - c.z;
  const d2 = dx * dx + dz * dz;
  const rr = r + c.r;
  if (d2 < rr * rr && d2 > 1e-8) {
    const d = Math.sqrt(d2);
    p.x = c.x + (dx / d) * rr;
    p.z = c.z + (dz / d) * rr;
  }
}

export function resolveCollisions(p, r, colliders) {
  const circles = colliders.circles;
  if (circles !== _gridSrc || circles.length !== _gridLen || colliders.dirty) {
    rebuildCircleGrid(circles);
    _gridSrc = circles;
    _gridLen = circles.length;
    colliders.dirty = false;
  }
  const boxes = colliders.boxes;
  if (boxes !== _boxSrc || boxes.length !== _boxLen) {
    rebuildBoxGrid(boxes);
    _boxSrc = boxes;
    _boxLen = boxes.length;
  }
  const gx0 = Math.floor((p.x - r) / GRID_CELL), gx1 = Math.floor((p.x + r) / GRID_CELL);
  const gz0 = Math.floor((p.z - r) / GRID_CELL), gz1 = Math.floor((p.z + r) / GRID_CELL);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gz = gz0; gz <= gz1; gz++) {
      const cell = _grid.get(_gk(gx, gz));
      if (cell) for (const c of cell) resolveCircle(p, r, c);
      const bcell = _boxGrid.get(_gk(gx, gz));
      if (bcell) for (const b of bcell) resolveBox(p, r, b);
    }
  }
  for (const b of _bigBoxes) resolveBox(p, r, b);
}

function resolveBox(p, r, b) {
  {
    const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // 中心在盒内:沿最浅穿透轴推出
        const outL = p.x - b.minX + r, outR = b.maxX - p.x + r;
        const outT = p.z - b.minZ + r, outB = b.maxZ - p.z + r;
        const m = Math.min(outL, outR, outT, outB);
        if (m === outL) p.x = b.minX - r;
        else if (m === outR) p.x = b.maxX + r;
        else if (m === outT) p.z = b.minZ - r;
        else p.z = b.maxZ + r;
      }
    }
  }
}

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
