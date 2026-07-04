// 角色与马匹的低多边形卡通模型构建器 + 通用碰撞/数学工具
import * as THREE from 'three';

export function lambert(c) {
  return new THREE.MeshLambertMaterial({ color: c });
}

// ---- 人形角色(面朝 +Z)----
export function makeHumanoid(opts = {}) {
  const {
    skin = 0xf1c27d, shirt = 0x2f8f4e, pants = 0x4a3320,
    hair = 0x3a2a1a, helmet = false, cap = false, hood = false, sword = false,
  } = opts;
  const g = new THREE.Group();
  const parts = {};

  const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.2);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.13 * side, 0.5, 0);
    const leg = new THREE.Mesh(legGeo, lambert(pants));
    leg.position.y = -0.25;
    leg.castShadow = true;
    pivot.add(leg);
    g.add(pivot);
    parts[side === -1 ? 'legL' : 'legR'] = pivot;
  }

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.28), lambert(shirt));
  body.position.y = 0.78;
  body.castShadow = true;
  g.add(body);
  parts.body = body;

  const armGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.34 * side, 1.0, 0);
    const arm = new THREE.Mesh(armGeo, lambert(shirt));
    arm.position.y = -0.22;
    arm.castShadow = true;
    pivot.add(arm);
    g.add(pivot);
    parts[side === -1 ? 'armL' : 'armR'] = pivot;
  }

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), lambert(skin));
  head.position.y = 1.28;
  head.castShadow = true;
  g.add(head);
  parts.head = head;

  if (helmet) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.22, 8), lambert(0x9aa4ad));
    h.position.y = 0.16;
    head.add(h);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), lambert(0x9aa4ad));
    spike.position.y = 0.32;
    head.add(spike);
  } else if (cap) {
    // 绿色尖顶帽(致敬某位林克)
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 6), lambert(0x1f7a3d));
    c.position.set(0, 0.3, -0.06);
    c.rotation.x = -0.35;
    head.add(c);
  } else if (hood) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 6), lambert(0x3b3b46));
    h.position.y = 0.18;
    head.add(h);
  } else {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34), lambert(hair));
    h.position.y = 0.2;
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

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.65, 1.7), lambert(color));
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);

  const legGeo = new THREE.BoxGeometry(0.17, 0.8, 0.17);
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
