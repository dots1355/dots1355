// 中世纪开放世界构建:城墙王国、城堡主堡、村庄、集市、风车、农田、森林、湖泊、盗贼营地
import * as THREE from 'three';
import { lambert } from './entities.js';

export function buildWorld(scene) {
  const colliders = { circles: [], boxes: [] };
  const features = [];   // 小地图静态要素
  const windmills = [];  // 需要动画的风车叶片
  const torches = [];    // 火把(夜间点亮)
  const chests = [];     // 宝箱
  const qBlocks = [];    // “?”砖块
  const coinSpots = [];  // 金币初始点位
  const clouds = [];

  const feat = (type, x, z, w, h, rot = 0) => features.push({ type, x, z, w, h, rot });
  const circle = (x, z, r) => colliders.circles.push({ x, z, r });
  const box = (cx, cz, w, d) =>
    colliders.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // ---- 地面与道路 ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), lambert(0x74b354));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function road(x1, z1, x2, z2, w = 4) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), lambert(0xcdb891));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dx, dz);
    m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
    feat('road', (x1 + x2) / 2, (z1 + z2) / 2, w, len, Math.atan2(dx, dz));
  }
  road(0, 58, 0, 8);      // 南门→广场
  road(0, 2, 0, -30);     // 广场→城堡
  road(8, 0, 68, 0);      // 广场→东门
  road(72, 0, 138, 18);   // 东门→风车
  road(0, 58, 0, 78);     // 南门外
  road(0, 78, 20, 92);    // →农田
  road(-8, 0, -66, 0);    // 广场→西侧
  road(-70, 0, -125, -52, 3); // →盗贼营地方向(野径)

  // ---- 城墙(矩形 x:-70..70, z:-55..55,南门/东门开口)----
  const wallMat = lambert(0x9d9486);
  function wallRun(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const horizontal = Math.abs(dx) > Math.abs(dz);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : 1.8, 5.5, horizontal ? 1.8 : len), wallMat);
    m.position.set((x1 + x2) / 2, 2.75, (z1 + z2) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    // 垛口
    const n = Math.floor(len / 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bx = x1 + dx * t, bz = z1 + dz * t;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 1.2 : 2.1, 0.9, horizontal ? 2.1 : 1.2), wallMat);
      merlon.position.set(bx, 5.9, bz);
      merlon.castShadow = true;
      scene.add(merlon);
    }
    if (horizontal) { box((x1 + x2) / 2, z1, len, 1.8); feat('wall', (x1 + x2) / 2, z1, len, 1.8); }
    else { box(x1, (z1 + z2) / 2, 1.8, len); feat('wall', x1, (z1 + z2) / 2, 1.8, len); }
  }
  wallRun(-70, -55, 70, -55);            // 北
  wallRun(-70, 55, -4.5, 55);            // 南(西段)
  wallRun(4.5, 55, 70, 55);              // 南(东段)
  wallRun(-70, -55, -70, 55);            // 西
  wallRun(70, -55, 70, -4.5);            // 东(北段)
  wallRun(70, 4.5, 70, 55);              // 东(南段)

  function tower(x, z, r = 4, h = 9) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 8), wallMat);
    t.position.set(x, h / 2, z);
    t.castShadow = true;
    scene.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 1.1, 8), lambert(0x30425f));
    roof.position.set(x, h + r * 0.55, z);
    roof.castShadow = true;
    scene.add(roof);
    circle(x, z, r + 0.3);
    feat('tower', x, z, r * 2, r * 2);
    return t;
  }
  tower(-70, -55); tower(70, -55); tower(-70, 55); tower(70, 55);
  tower(-6, 55, 2.2, 7.5); tower(6, 55, 2.2, 7.5);   // 南门楼
  tower(70, -6, 2.2, 7.5); tower(70, 6, 2.2, 7.5);   // 东门楼

  // ---- 城堡主堡 ----
  const keep = new THREE.Mesh(new THREE.BoxGeometry(22, 13, 14), lambert(0xb0a89a));
  keep.position.set(0, 6.5, -40);
  keep.castShadow = keep.receiveShadow = true;
  scene.add(keep);
  box(0, -40, 22, 14);
  feat('keep', 0, -40, 22, 14);
  for (const [tx, tz] of [[-11, -33], [11, -33], [-11, -47], [11, -47]]) tower(tx, tz, 3, 16);
  // 大门
  const door = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.5), lambert(0x4a3220));
  door.position.set(0, 3, -32.8);
  scene.add(door);
  // 旗帜
  for (const s of [-1, 1]) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 3.2),
      new THREE.MeshLambertMaterial({ color: 0xb02030, side: THREE.DoubleSide }));
    banner.position.set(5 * s, 9, -32.85);
    scene.add(banner);
  }
  // 主堡顶旗杆
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4), lambert(0x555555));
  pole.position.set(0, 15, -40);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.1),
    new THREE.MeshLambertMaterial({ color: 0xe6b422, side: THREE.DoubleSide }));
  flag.position.set(1, 16.4, -40);
  scene.add(flag);

  // ---- 喷泉广场 ----
  const fBase = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.6, 12), lambert(0xb7b2a6));
  fBase.position.set(0, 0.3, 5);
  fBase.castShadow = true;
  scene.add(fBase);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.15, 12), lambert(0x4aa6d8));
  water.position.set(0, 0.62, 5);
  scene.add(water);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.6, 8), lambert(0xb7b2a6));
  col.position.set(0, 1.2, 5);
  scene.add(col);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), lambert(0x4aa6d8));
  orb.position.set(0, 2.1, 5);
  scene.add(orb);
  circle(0, 5, 3.4);
  feat('plaza', 0, 5, 7, 7);

  // ---- 民居 ----
  const roofColors = [0xa33b2c, 0x8a5a33, 0x7d3b2d, 0x9c4a3b];
  let houseIdx = 0;
  function house(x, z, rotDeg = 0, w = 6, d = 5, h = 3.2) {
    const rot = (rotDeg * Math.PI) / 180;
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(0xf0e6d2));
    walls.position.y = h / 2;
    walls.castShadow = walls.receiveShadow = true;
    g.add(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.SQRT1_2 * Math.max(w, d) * 1.15, h * 0.75, 4),
      lambert(roofColors[houseIdx++ % roofColors.length]));
    roof.scale.set(w >= d ? 1 : d / w, 1, w >= d ? d / w : 1);
    roof.position.y = h + h * 0.37;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.15), lambert(0x5a3d24));
    dr.position.set(0, 0.95, d / 2 + 0.02);
    g.add(dr);
    // 木梁装饰
    for (const bx of [-w / 2 + 0.4, w / 2 - 0.4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), lambert(0x6b4a2f));
      beam.position.set(bx, h / 2, d / 2 + 0.05);
      g.add(beam);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
    const swap = rotDeg % 180 !== 0;
    box(x, z, (swap ? d : w) + 0.4, (swap ? w : d) + 0.4);
    feat('house', x, z, swap ? d : w, swap ? w : d);
    return g;
  }
  const housePlan = [
    [-25, 25, 0], [-36, 6, 90], [-25, -15, 0], [-42, -32, 0],
    [25, 25, 0], [36, 8, 90], [28, -12, 0], [44, -30, 0],
    [-15, 40, 0], [18, 40, 0], [-52, 30, 90], [52, 35, 0],
    [-52, -10, 90], [20, -30, 0], [-30, 42, 0], [45, 20, 90],
  ];
  for (const [x, z, r] of housePlan) house(x, z, r);

  // ---- 集市摊位 ----
  function stall(x, z, canopyColor) {
    const g = new THREE.Group();
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.1), lambert(0x8a6a45));
    counter.position.y = 0.5;
    counter.castShadow = true;
    g.add(counter);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5), lambert(0x6b4a2f));
      p.position.set(1.15 * s, 1.2, -0.45);
      g.add(p);
    }
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.9),
      new THREE.MeshLambertMaterial({ color: canopyColor, side: THREE.DoubleSide }));
    canopy.position.set(0, 2.35, 0.1);
    canopy.rotation.x = -0.5;
    canopy.castShadow = true;
    g.add(canopy);
    g.position.set(x, 0, z);
    g.lookAt(0, 0, 5);
    scene.add(g);
    circle(x, z, 1.4);
    feat('stall', x, z, 2.5, 1.5);
  }
  stall(11, 13, 0xc0392b); stall(15, 7, 0x2980b9);
  stall(-11, 13, 0xe6b422); stall(-15, 7, 0x27ae60);

  // ---- 马厩 ----
  const stable = new THREE.Group();
  const sBack = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 0.4), lambert(0x7a5a3a));
  sBack.position.set(0, 1.5, -2);
  sBack.castShadow = true;
  stable.add(sBack);
  for (const sx of [-4.2, 0, 4.2]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), lambert(0x6b4a2f));
    p.position.set(sx, 1.7, 2);
    stable.add(p);
  }
  const sRoof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 5.5), lambert(0x8a5a33));
  sRoof.position.set(0, 3.5, 0);
  sRoof.rotation.x = 0.12;
  sRoof.castShadow = true;
  stable.add(sRoof);
  stable.position.set(52, 0, 12);
  scene.add(stable);
  box(52, 10, 9, 0.6);
  feat('house', 52, 12, 10, 5);

  // ---- 树 ----
  function tree(x, z, pine = false) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, pine ? 1.6 : 1.3, 6), lambert(0x6b4a2f));
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    g.add(trunk);
    if (pine) {
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * 0.4, 1.6, 7), lambert(0x2d6b3f));
        c.position.y = 1.8 + i * 1.05;
        c.castShadow = true;
        g.add(c);
      }
    } else {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.5, 7, 5), lambert(0x3f8a4f));
      s.position.y = 2.3;
      s.castShadow = true;
      g.add(s);
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(1.0, 6, 5), lambert(0x357a44));
      s2.position.set(0.8, 1.9, 0.4);
      g.add(s2);
    }
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * Math.PI * 2;
    scene.add(g);
    circle(x, z, 0.6);
    feat('tree', x, z, 1.5, 1.5);
  }
  // 西部森林
  for (let i = 0; i < 55; i++) {
    const x = -220 + Math.random() * 125;
    const z = -120 + Math.random() * 160;
    if (Math.hypot(x + 100, z - 100) < 40) continue;             // 避开湖
    if (Math.hypot(x + 130, z + 60) < 14) continue;              // 避开营地
    if (x > -78 && z > -60 && z < 60) continue;                  // 避开城墙口
    tree(x, z, Math.random() < 0.55);
  }
  // 北部森林
  for (let i = 0; i < 28; i++) {
    tree(-60 + Math.random() * 200, -170 + Math.random() * 75, Math.random() < 0.5);
  }
  // 零散树
  const scatter = [[20, 68], [-25, 72], [40, 62], [90, 35], [110, -10], [60, 80], [-40, 65], [15, 110], [-10, 95]];
  for (const [x, z] of scatter) tree(x, z, false);
  // 城内景观树
  for (const [x, z] of [[-8, 30], [8, 30], [-45, 45], [45, -45], [-20, -40]]) tree(x, z, false);

  // ---- 湖泊 ----
  const sand = new THREE.Mesh(new THREE.CircleGeometry(33, 24), lambert(0xd9c98f));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-100, 0.02, 100);
  scene.add(sand);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(30, 24), lambert(0x3f8fc4));
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(-100, 0.04, 100);
  scene.add(lake);
  circle(-100, 100, 29);
  feat('water', -100, 100, 60, 60);

  // ---- 农田 ----
  function field(x, z, w, d) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert(0x9a7444));
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.02, z);
    f.receiveShadow = true;
    scene.add(f);
    const rows = Math.floor(d / 2);
    for (let i = 0; i < rows; i++) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w - 1, 0.25, 0.5), lambert(0x7ba03f));
      r.position.set(x, 0.15, z - d / 2 + 1 + i * 2);
      scene.add(r);
    }
    feat('field', x, z, w, d);
  }
  field(24, 88, 24, 14);
  field(-18, 92, 20, 12);
  field(52, 96, 18, 10);

  // ---- 风车磨坊(投递任务目标)----
  const windmillPos = new THREE.Vector3(140, 0, 20);
  {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.6, 10, 8), lambert(0xe8dcc0));
    t.position.set(140, 5, 20);
    t.castShadow = true;
    scene.add(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2.6, 8), lambert(0x8a5a33));
    roof.position.set(140, 11.2, 20);
    roof.castShadow = true;
    scene.add(roof);
    const hub = new THREE.Group();
    hub.position.set(140 - 3.1, 8.5, 20);
    for (let i = 0; i < 4; i++) {
      const bladePivot = new THREE.Group();
      bladePivot.rotation.x = (i * Math.PI) / 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.2, 1.1), lambert(0xd9cdae));
      blade.position.y = 3.4;
      blade.castShadow = true;
      bladePivot.add(blade);
      hub.add(bladePivot);
    }
    scene.add(hub);
    windmills.push(hub);
    circle(140, 20, 4);
    feat('windmill', 140, 20, 7, 7);
  }

  // ---- 盗贼营地 ----
  const banditCamp = new THREE.Vector3(-130, 0, -60);
  {
    for (const [dx, dz] of [[-4, -3], [5, -1], [0, 5]]) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 6), lambert(0x5d4a33));
      tent.position.set(-130 + dx, 1.6, -60 + dz);
      tent.castShadow = true;
      scene.add(tent);
      circle(-130 + dx, -60 + dz, 2.2);
      feat('tent', -130 + dx, -60 + dz, 4, 4);
    }
    // 篝火
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 6),
      new THREE.MeshLambertMaterial({ color: 0xff7722, emissive: 0xff5500 }));
    fire.position.set(-130, 0.5, -60);
    scene.add(fire);
    const fireLight = new THREE.PointLight(0xff8844, 0, 22, 2);
    fireLight.position.set(-130, 1.5, -60);
    scene.add(fireLight);
    torches.push({ light: fireLight, flame: fire, base: 12 });
  }

  // ---- 火把(带光源的 6 个)----
  function torch(x, z, withLight = true) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.3, 5), lambert(0x5a4028));
    pole.position.set(x, 1.15, z);
    scene.add(pole);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5),
      new THREE.MeshLambertMaterial({ color: 0xffaa33, emissive: 0xff6600 }));
    flame.position.set(x, 2.45, z);
    scene.add(flame);
    let light = null;
    if (withLight) {
      light = new THREE.PointLight(0xff9944, 0, 20, 2);
      light.position.set(x, 2.6, z);
      scene.add(light);
    }
    torches.push({ light, flame, base: 9 });
  }
  torch(8, 13); torch(-8, -3);          // 广场
  torch(-5.5, 51.5); torch(67, 5.5);    // 城门
  torch(6, -31.5);                      // 城堡门
  torch(-8, 13, false); torch(8, -3, false); torch(5.5, 51.5, false); torch(67, -5.5, false);

  // ---- 宝箱 ----
  function chest(x, z, rotDeg = 0) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.75), lambert(0x7a4a22));
    base.position.y = 0.3;
    base.castShadow = true;
    g.add(base);
    const lid = new THREE.Group();
    lid.position.set(0, 0.6, -0.375);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.75), lambert(0x8a5a2c));
    lidMesh.position.set(0, 0.14, 0.375);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.06), lambert(0xe6b422));
    clasp.position.set(0, 0.1, 0.755);
    lid.add(clasp);
    g.add(lid);
    g.position.set(x, 0, z);
    g.rotation.y = (rotDeg * Math.PI) / 180;
    scene.add(g);
    circle(x, z, 0.7);
    chests.push({ group: g, lid, x, z, opened: false });
  }
  chest(0, -50);        // 城堡后
  chest(-135, -48, 140); // 盗贼营地旁
  chest(-78, 82, 90);   // 湖边
  chest(30, 96);        // 农田
  chest(56, 15, 180);   // 马厩
  chest(-66, 50, 45);   // 城墙角

  // ---- “?”砖块 ----
  const qTex = makeQuestionTexture();
  function qblock(x, z, y = 2.6) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: qTex }));
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
    qBlocks.push({ mesh: m, x, z, y, used: false, bump: 0 });
  }
  qblock(6, 22); qblock(-20, 0); qblock(30, 32, 2.8); qblock(0, 70); qblock(95, 6); qblock(-60, 20);

  // ---- 金币点位 ----
  function coinLine(x1, z1, x2, z2, gap = 4.5) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.floor(len / gap));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      coinSpots.push([x1 + (x2 - x1) * t, z1 + (z2 - z1) * t]);
    }
  }
  coinLine(0, 52, 0, 14);
  coinLine(10, 0, 64, 0);
  coinLine(74, 1, 134, 17);
  coinLine(0, 60, 0, 76);
  coinLine(2, 80, 18, 90);
  coinLine(-10, 0, -62, 0);
  coinLine(-75, -5, -120, -48, 6);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    coinSpots.push([Math.cos(a) * 8, 5 + Math.sin(a) * 8]);
  }
  coinSpots.push([-90, 70], [-85, 75], [-80, 80], [140, 30], [143, 25], [52, 90], [-30, -70], [-20, -75]);

  // ---- 云 ----
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const n = 2 + Math.floor(Math.random() * 2);
    for (let j = 0; j < n; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 3, 7, 5),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      s.position.set(j * 5 - n * 2, Math.random() * 1.5, Math.random() * 3);
      c.add(s);
    }
    c.position.set(-300 + Math.random() * 600, 62 + Math.random() * 22, -280 + Math.random() * 560);
    scene.add(c);
    clouds.push(c);
  }

  // 世界边界
  box(0, -330, 700, 40); box(0, 330, 700, 40);
  box(-330, 0, 40, 700); box(330, 0, 40, 700);

  return {
    colliders, features, windmills, torches, chests, qBlocks, coinSpots, clouds,
    windmillPos, banditCamp,
    questGiverPos: new THREE.Vector3(4, 0, 10),
    playerSpawn: new THREE.Vector3(0, 0, 20),
    gates: [new THREE.Vector3(0, 0, 55), new THREE.Vector3(70, 0, 0)],
    stablePos: new THREE.Vector3(52, 0, 8),
  };
}

function makeQuestionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e6a817';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#c78a0a';
  g.fillRect(0, 0, 64, 5); g.fillRect(0, 59, 64, 5);
  g.fillRect(0, 0, 5, 64); g.fillRect(59, 0, 5, 64);
  g.fillStyle = '#fff';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('?', 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
