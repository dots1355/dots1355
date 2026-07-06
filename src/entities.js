// 角色与马匹的低多边形卡通模型构建器 + 通用碰撞/数学工具
import * as THREE from 'three';

// 名字沿用 lambert,实际已升级为 PBR 标准材质
export function lambert(c, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0.04, ...opts });
}

// ---- 人形角色(面朝 +Z)----
export function makeHumanoid(opts = {}) {
  const {
    skin = 0xf1c27d, shirt = 0x2f8f4e, pants = 0x4a3320,
    hair = 0x3a2a1a, helmet = false, cap = false, hood = false, sword = false,
  } = opts;
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
    // 绿色尖顶帽(致敬某位林克)
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
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.03), lambert(0xd8dde2));
    blade.position.y = -0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), lambert(0xc9a227));
    guard.position.y = -0.26;
    swordGroup.add(blade, guard);
    swordGroup.position.y = -0.2;
    parts.armR.add(swordGroup);
    parts.sword = swordGroup;
  }

  return { group: g, parts };
}

// ---- 马(面朝 +Z)----
export function makeHorse(color = 0x8b5a2b, saddled = true) {
  const g = new THREE.Group();
  const parts = { legs: [] };
  const dark = new THREE.Color(color).multiplyScalar(0.7).getHex();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.05, 6, 12), lambert(color, { roughness: 0.7 }));
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.92);
  body.position.y = 1.08;
  body.castShadow = true;
  g.add(body);

  const legGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.8, 7);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.24 * sx, 0.85, 0.62 * sz);
    const leg = new THREE.Mesh(legGeo, lambert(dark));
    leg.position.y = -0.4;
    leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    parts.legs.push(pivot);
  }

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.32), lambert(color));
  neck.position.set(0, 1.5, 0.75);
  neck.rotation.x = 0.45;
  neck.castShadow = true;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.55), lambert(color));
  head.position.set(0, 1.85, 1.05);
  head.castShadow = true;
  g.add(head);

  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), lambert(dark));
    ear.position.set(0.09 * s, 2.05, 0.9);
    g.add(ear);
  }

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.34), lambert(0x2e2018));
  mane.position.set(0, 1.68, 0.62);
  mane.rotation.x = 0.45;
  g.add(mane);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), lambert(0x2e2018));
  tail.position.set(0, 1.1, -0.92);
  tail.rotation.x = -0.5;
  g.add(tail);

  if (saddled) {
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.55), lambert(0x7a1f1f));
    saddle.position.y = 1.44;
    g.add(saddle);
  }

  return { group: g, parts };
}

// ---- 狼(面朝 +Z)----
export function makeWolf() {
  const g = new THREE.Group();
  const parts = { legs: [] };
  const fur = lambert(0x5a5a62, { roughness: 0.95 });
  const dark = lambert(0x3c3c44, { roughness: 0.95 });

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
      new THREE.MeshStandardMaterial({ color: 0xff3322, emissive: 0xaa1100, emissiveIntensity: 1.2 }));
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
export function resolveCollisions(p, r, colliders) {
  for (const c of colliders.circles) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d2 = dx * dx + dz * dz;
    const rr = r + c.r;
    if (d2 < rr * rr && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
  for (const b of colliders.boxes) {
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
