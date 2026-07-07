// 中世纪开放世界构建:城墙王国、城堡主堡、村庄、集市、风车、农田、森林、湖泊、盗贼营地
import * as THREE from 'three';
import { buildTree, buildPine, buildDeadTree, buildCactus, buildRock, buildBush } from './flora.js';
import { lambert } from './entities.js';
import { makeTextures } from './textures.js';

export function buildWorld(scene) {
  const colliders = { circles: [], boxes: [] };
  const features = [];   // 小地图静态要素
  const windmills = [];  // 需要动画的风车叶片
  const torches = [];    // 火把(夜间点亮)
  const chests = [];     // 宝箱
  const qBlocks = [];    // “?”砖块
  const coinSpots = [];  // 金币初始点位
  const clouds = [];
  const waterMats = [];  // 水面材质(法线动画)
  const occluders = []; // 相机防穿墙用的大型遮挡体

  const TX = makeTextures();
  // 带独立 repeat 的 PBR 贴图材质
  function texMat(pair, rx, ry, extra = {}) {
    const map = pair.map.clone();
    map.needsUpdate = true;
    map.repeat.set(rx, ry);
    const normalMap = pair.normalMap.clone();
    normalMap.needsUpdate = true;
    normalMap.repeat.set(rx, ry);
    const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9, metalness: 0.02, ...extra });
    m.userData.wettable = true;           // 下雨时变湿润反光
    m.userData.baseRough = m.roughness;
    return m;
  }
  const woodMat = texMat(TX.wood, 1, 1, { roughness: 0.85 });
  const plasterMat = texMat(TX.plaster, 2, 1, { roughness: 0.95 });
  const roofMats = [0xa33b2c, 0x8a5a33, 0x7d3b2d, 0x9c4a3b].map((c) =>
    texMat(TX.roof, 3, 1.6, { color: c, roughness: 0.85 }));
  const dirtFieldMat = texMat(TX.dirt, 3, 2);

  const feat = (type, x, z, w, h, rot = 0) => features.push({ type, x, z, w, h, rot });
  const circle = (x, z, r) => colliders.circles.push({ x, z, r });
  const box = (cx, cz, w, d) =>
    colliders.boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // ---- 地面与道路 ----
  const groundMat = new THREE.MeshStandardMaterial({
    map: TX.grass.map, normalMap: TX.grass.normalMap, roughness: 0.95, metalness: 0 });
  groundMat.userData.wettable = true;
  groundMat.userData.baseRough = 0.95;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function road(x1, z1, x2, z2, w = 4, cobbled = false) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len),
      cobbled ? texMat(TX.cobble, w / 3.2, len / 3.2, { roughness: 0.85 }) : texMat(TX.dirt, w / 4, len / 9));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dx, dz);
    m.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
    feat('road', (x1 + x2) / 2, (z1 + z2) / 2, w, len, Math.atan2(dx, dz));
  }
  road(0, 58, 0, 8, 4.5, true);    // 南门→广场(城内鹅卵石)
  road(0, 2, 0, -30, 4.5, true);   // 广场→城堡
  road(8, 0, 68, 0, 4.5, true);    // 广场→东门
  road(-8, 0, -66, 0, 4, true);    // 广场→西侧
  road(72, 0, 138, 18);            // 东门→风车(城外土路)
  road(0, 58, 0, 78);              // 南门外
  road(0, 78, 20, 92);             // →农田
  road(-70, 0, -125, -52, 3);      // →盗贼营地方向(野径)

  // 广场鹅卵石铺装
  const plazaPave = new THREE.Mesh(new THREE.CircleGeometry(13, 28),
    texMat(TX.cobble, 8, 8, { roughness: 0.85 }));
  plazaPave.rotation.x = -Math.PI / 2;
  plazaPave.position.set(0, 0.015, 5);
  plazaPave.receiveShadow = true;
  scene.add(plazaPave);

  // ---- 城墙(矩形 x:-70..70, z:-55..55,南门/东门开口)----
  const wallMat = texMat(TX.stone, 1.2, 1.2, { roughness: 0.92 });
  function wallRun(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const horizontal = Math.abs(dx) > Math.abs(dz);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : 1.8, 5.5, horizontal ? 1.8 : len),
      texMat(TX.stone, len / 9, 1));
    m.position.set((x1 + x2) / 2, 2.75, (z1 + z2) / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    occluders.push(m);
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

  const towerMat = texMat(TX.stone, 4, 2, { roughness: 0.92 });
  function tower(x, z, r = 4, h = 9) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 12), towerMat);
    t.position.set(x, h / 2, z);
    t.castShadow = true;
    scene.add(t);
    occluders.push(t);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 1.1, 12),
      lambert(0x30425f, { roughness: 0.55, metalness: 0.25 }));
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
  const keep = new THREE.Mesh(new THREE.BoxGeometry(22, 13, 14), texMat(TX.stone, 2.6, 2.4));
  keep.position.set(0, 6.5, -40);
  keep.castShadow = keep.receiveShadow = true;
  scene.add(keep);
  occluders.push(keep);
  box(0, -40, 22, 14);
  feat('keep', 0, -40, 22, 14);
  for (const [tx, tz] of [[-11, -33], [11, -33], [-11, -47], [11, -47]]) tower(tx, tz, 3, 16);
  // 大门
  const door = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.5), woodMat);
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
  const fountainWater = new THREE.MeshStandardMaterial({
    color: 0x3f9fd8, roughness: 0.08, metalness: 0,
    normalMap: TX.waterNormal, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  waterMats.push(fountainWater);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.15, 16), fountainWater);
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
  let houseIdx = 0;
  function house(x, z, rotDeg = 0, w = 6, d = 5, h = 3.2) {
    const rot = (rotDeg * Math.PI) / 180;
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plasterMat);
    walls.position.y = h / 2;
    walls.castShadow = walls.receiveShadow = true;
    g.add(walls);
    occluders.push(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.SQRT1_2 * Math.max(w, d) * 1.15, h * 0.75, 4),
      roofMats[houseIdx++ % roofMats.length]);
    roof.scale.set(w >= d ? 1 : d / w, 1, w >= d ? d / w : 1);
    roof.position.y = h + h * 0.37;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.15), woodMat);
    dr.position.set(0, 0.95, d / 2 + 0.02);
    g.add(dr);
    // 窗户(暖光内景,夜间发光)
    for (const wx of [-w / 4, w / 4]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x3a2d1a, emissive: 0xffb84d, emissiveIntensity: 0 }));
      win.position.set(wx, h * 0.62, d / 2 + 0.04);
      g.add(win);
      torches.push({ light: null, flame: win, base: 0, window: true });
    }
    // 木梁装饰
    for (const bx of [-w / 2 + 0.4, w / 2 - 0.4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), woodMat);
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
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 1.1), woodMat);
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

  // ---- 树(顶点扰动的有机树冠)----
  function jitterGeo(geo, amt) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i,
        p.getX(i) + (Math.random() - 0.5) * amt,
        p.getY(i) + (Math.random() - 0.5) * amt,
        p.getZ(i) + (Math.random() - 0.5) * amt);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function tree(x, z, pine = false) {
    const scale = 0.85 + Math.random() * 0.5;
    const built = pine ? buildPine(Math.random) : (Math.random() < 0.12 ? buildBush(Math.random) : buildTree(Math.random));
    const g = built.group;
    g.scale.setScalar(scale);
    g.position.set(x, 0, z);
    g.rotation.y = Math.random() * Math.PI * 2;
    scene.add(g);
    circle(x, z, built.r * scale);
    feat('tree', x, z, 1.5, 1.5);
  }
  // 西部森林
  for (let i = 0; i < 75; i++) {
    const x = -235 + Math.random() * 140;
    const z = -140 + Math.random() * 180;
    if (Math.hypot(x + 100, z - 100) < 40) continue;             // 避开湖
    if (Math.hypot(x + 130, z + 60) < 14) continue;              // 避开营地
    if (Math.hypot(x + 170, z + 90) < 22) continue;              // 避开要塞
    if (Math.abs(x + 95) < 7 && z < 72) continue;                // 避开河道
    if (x > -78 && z > -60 && z < 60) continue;                  // 避开城墙口
    tree(x, z, Math.random() < 0.55);
  }
  // 北部森林
  for (let i = 0; i < 34; i++) {
    const x = -60 + Math.random() * 220;
    const z = -160 + Math.random() * 65;
    if (Math.hypot(x - 80, z + 120) < 20) continue;              // 避开遗迹
    if (Math.hypot(x + 40, z + 120) < 20) continue;              // 避开墓园
    tree(x, z, Math.random() < 0.5);
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
  const lakeNormal = TX.waterNormal.clone();
  lakeNormal.needsUpdate = true;
  const lakeMat = new THREE.MeshStandardMaterial({
    color: 0x2f7fb8, roughness: 0.06, metalness: 0,
    normalMap: lakeNormal, normalScale: new THREE.Vector2(0.5, 0.5),
  });
  waterMats.push(lakeMat);
  const lake = new THREE.Mesh(new THREE.CircleGeometry(30, 32), lakeMat);
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(-100, 0.04, 100);
  scene.add(lake);
  circle(-100, 100, 29);
  feat('water', -100, 100, 60, 60);

  // ---- 农田 ----
  function field(x, z, w, d) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dirtFieldMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.045, z); // 高于道路平面,避免 z-fighting
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

  // ---- 场景道具:木桶 / 板条箱 / 干草卷 / 栅栏 / 手推车 ----
  function barrel(x, z) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 1.0, 10), woodMat);
    body.position.y = 0.5;
    body.castShadow = true;
    g.add(body);
    for (const y of [0.25, 0.75]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.07, 10),
        lambert(0x3a3a40, { roughness: 0.5, metalness: 0.6 }));
      band.position.y = y;
      g.add(band);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    circle(x, z, 0.5);
  }
  [[13, 15.5], [14.2, 14.5], [50, 14.5], [48.5, 15], [4, -30.5], [-13, 11],
   [-128, -55], [-126.5, -56.5], [142.5, 16.5]].forEach(([x, z]) => barrel(x, z));

  function crate(x, z, s = 1) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9 * s, 0.9 * s, 0.9 * s), woodMat);
    c.position.set(x, 0.45 * s, z);
    c.rotation.y = Math.random() * 1.5;
    c.castShadow = true;
    scene.add(c);
    circle(x, z, 0.6 * s);
  }
  crate(-14.5, 12.5); crate(-13.5, 11.2, 0.7); crate(55, 13.5); crate(16.5, 6);
  crate(139, 24, 1.1); crate(-132, -63);

  function hay(x, z) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12),
      lambert(0xd0a848, { roughness: 1 }));
    h.rotation.z = Math.PI / 2;
    h.rotation.y = Math.random() * 3;
    h.position.set(x, 0.85, z);
    h.castShadow = true;
    scene.add(h);
    circle(x, z, 1.0);
  }
  hay(30, 84); hay(-14, 88); hay(48, 99); hay(20, 95);

  function fence(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.floor(len / 2.2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 5), woodMat);
      p.position.set(x1 + dx * t, 0.55, z1 + dz * t);
      p.castShadow = true;
      scene.add(p);
    }
    for (const y of [0.45, 0.85]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, len), woodMat);
      rail.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
      rail.rotation.y = Math.atan2(dx, dz);
      rail.castShadow = true;
      scene.add(rail);
    }
  }
  fence(11, 81, 37, 81); fence(37, 81, 37, 95);      // 农田围栏
  fence(-29, 86, -29, 98); fence(-29, 86, -7, 86);
  fence(46, 6, 46, 14); fence(46, 14, 58, 14);       // 马厩围栏

  function cart(x, z, rotDeg) {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 2.4), woodMat);
    bed.position.y = 0.75;
    bed.castShadow = true;
    g.add(bed);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 2.4), woodMat);
      side.position.set(0.75 * s, 1.05, 0);
      g.add(side);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 12), woodMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(0.85 * s, 0.55, 0.3);
      wheel.castShadow = true;
      g.add(wheel);
    }
    for (const s of [-1, 1]) {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 1.6), woodMat);
      shaft.position.set(0.4 * s, 0.7, -1.8);
      shaft.rotation.x = -0.25;
      g.add(shaft);
    }
    g.position.set(x, 0, z);
    g.rotation.y = (rotDeg * Math.PI) / 180;
    scene.add(g);
    circle(x, z, 1.3);
  }
  cart(18, 16, 40); cart(56, 5, 100); cart(24, 82, -30);

  // ================= 王国扩张区 =================

  // ---- 银月河(自湖泊向北)与木桥 ----
  {
    const riverMat = lakeMat; // 与湖共用材质(法线动画同步)
    const river = new THREE.Mesh(new THREE.PlaneGeometry(7, 300), riverMat);
    river.rotation.x = -Math.PI / 2;
    river.position.set(-95, 0.035, -78); // z 从 72 到 -228
    scene.add(river);
    feat('water', -95, -78, 7, 300);
    // 河岸碰撞(桥处留口 z -40..-28)
    box(-95, 22, 7, 100);    // z 72..-28
    box(-95, -134, 7, 188);  // z -40..-228
    // 木桥(位于去营地的野径上)
    const bridge = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.18, 5), woodMat);
    deck.position.y = 0.22;
    deck.castShadow = deck.receiveShadow = true;
    bridge.add(deck);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 0.1), woodMat);
      rail.position.set(0, 0.95, 2.3 * s);
      bridge.add(rail);
      for (const px of [-5, -2.5, 0, 2.5, 5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 5), woodMat);
        post.position.set(px, 0.6, 2.3 * s);
        bridge.add(post);
      }
    }
    bridge.position.set(-95, 0, -34);
    scene.add(bridge);
    feat('road', -95, -34, 12, 5);
  }

  // ---- 北境群山(雪顶) ----
  const rockMat = lambert(0x6e6a72, { roughness: 0.95 });
  const snowMat = lambert(0xf2f4f8, { roughness: 0.85 });
  for (const [mx, mz, mr, mh] of [
    [-220, -220, 55, 85], [-140, -235, 48, 70], [-60, -215, 42, 60], [20, -230, 55, 90],
    [100, -215, 45, 65], [180, -235, 55, 80], [255, -215, 45, 62], [-290, -200, 50, 70], [300, -230, 55, 75],
  ]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(mr, mh, 7), rockMat);
    m.position.set(mx, mh / 2 - 2, mz);
    m.rotation.y = Math.random();
    m.castShadow = true;
    scene.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(mr * 0.34, mh * 0.3, 7), snowMat);
    cap.position.set(mx, mh - 2 - mh * 0.14, mz);
    cap.rotation.y = m.rotation.y;
    scene.add(cap);
    circle(mx, mz, mr * 0.72);
    feat('tower', mx, mz, mr, mr);
  }

  // ---- 苇岸渔村 ----
  house(-110, 58, 90, 5, 4, 2.6);
  house(-88, 54, 0, 5, 4, 2.6);
  {
    // 栈桥伸入湖中
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 15), woodMat);
    pier.position.set(-100, 0.3, 78);
    pier.castShadow = true;
    scene.add(pier);
    for (const pz of [72, 77, 82]) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.2, 5), woodMat);
        post.position.set(-100 + s, 0.1, pz);
        scene.add(post);
      }
    }
    // 小船
    const boat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 3.2), woodMat);
    boat.position.set(-94, 0.25, 86);
    boat.rotation.y = 0.5;
    scene.add(boat);
    // 芦苇
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 31 + Math.random() * 3.5;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.4 + Math.random(), 4),
        lambert(0x7a9a4a, { roughness: 1 }));
      reed.position.set(-100 + Math.cos(a) * rr, 0.7, 100 + Math.sin(a) * rr);
      scene.add(reed);
    }
    feat('house', -100, 78, 3, 15);
  }

  // ---- 十字路旅店 ----
  house(12, 72, 0, 8, 6, 3.6);
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 3.2, 6), woodMat);
    pole.position.set(17, 1.6, 75.5);
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), woodMat);
    arm.position.set(16.4, 2.9, 75.5);
    scene.add(arm);
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 128; signCanvas.height = 64;
    const sg = signCanvas.getContext('2d');
    sg.fillStyle = '#6b4a2f'; sg.fillRect(0, 0, 128, 64);
    sg.fillStyle = '#f5e9cf'; sg.font = 'bold 30px serif';
    sg.textAlign = 'center'; sg.fillText('旅店', 64, 42);
    const signTex = new THREE.CanvasTexture(signCanvas);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55),
      new THREE.MeshStandardMaterial({ map: signTex, side: THREE.DoubleSide, roughness: 0.9 }));
    sign.position.set(16, 2.35, 75.5);
    scene.add(sign);
    // 长凳
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 0.5), woodMat);
    bench.position.set(9, 0.45, 75.6);
    scene.add(bench);
  }

  // ---- 哨塔遗迹 ----
  {
    const ruin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.9, 7, 10, 1, false), towerMat);
    ruin.position.set(80, 3.5, -120);
    ruin.rotation.z = 0.06;
    ruin.castShadow = true;
    scene.add(ruin);
    // 断口碎石
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const rk = buildRock(Math.random);
      rk.group.scale.setScalar(0.7);
      rk.group.position.set(80 + Math.cos(a) * (4.5 + Math.random() * 3), 0, -120 + Math.sin(a) * (4.5 + Math.random() * 3));
      scene.add(rk.group);
    }
    circle(80, -120, 4.2);
    feat('tower', 80, -120, 7, 7);
  }

  // ---- 静眠墓园 ----
  {
    for (let i = 0; i < 9; i++) {
      const gx = -48 + (i % 3) * 7 + Math.random() * 2;
      const gz = -127 + Math.floor(i / 3) * 6 + Math.random() * 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1 + Math.random() * 0.4, 0.18), towerMat);
      stone.position.set(gx, 0.55, gz);
      stone.rotation.y = (Math.random() - 0.5) * 0.4;
      stone.rotation.z = (Math.random() - 0.5) * 0.12;
      stone.castShadow = true;
      scene.add(stone);
    }
    // 枯树
    const dead = buildDeadTree(Math.random);
    dead.group.scale.setScalar(1.4);
    dead.group.position.set(-34, 0, -112);
    scene.add(dead.group);
    circle(-34, -112, 0.5);
    feat('tent', -40, -120, 18, 14);
  }

  // ---- 先祖石环 ----
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = 170 + Math.cos(a) * 8, sz = -60 + Math.sin(a) * 8;
    const menhir = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3 + Math.random(), 0.9), rockMat);
    menhir.position.set(sx, 1.5, sz);
    menhir.rotation.y = a;
    menhir.rotation.z = (Math.random() - 0.5) * 0.15;
    menhir.castShadow = true;
    scene.add(menhir);
    circle(sx, sz, 0.9);
  }
  feat('tower', 170, -60, 18, 18);

  // ---- 黑石要塞(盗贼老巢) ----
  const fortPos = new THREE.Vector3(-170, 0, -90);
  {
    // 木栅栏圆环(南侧留门)
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      if (a > Math.PI * 0.38 && a < Math.PI * 0.62) continue; // 南门缺口
      const px = -170 + Math.cos(a) * 14, pz = -90 + Math.sin(a) * 14;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 4.4 + (i % 3) * 0.3, 6), woodMat);
      log.position.set(px, 2.2, pz);
      log.castShadow = true;
      scene.add(log);
      circle(px, pz, 0.6);
    }
    // 头目大帐
    const bigTent = new THREE.Mesh(new THREE.ConeGeometry(4, 5, 7), lambert(0x3a3a42, { roughness: 1 }));
    bigTent.position.set(-170, 2.5, -96);
    bigTent.castShadow = true;
    scene.add(bigTent);
    circle(-170, -96, 3.6);
    // 黑石旗
    const fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 6, 5), woodMat);
    fpole.position.set(-165, 3, -84);
    scene.add(fpole);
    const fflag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1),
      new THREE.MeshStandardMaterial({ color: 0x1a1a20, side: THREE.DoubleSide, roughness: 1 }));
    fflag.position.set(-164, 5.4, -84);
    scene.add(fflag);
    const fire2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 6),
      new THREE.MeshLambertMaterial({ color: 0xff7722, emissive: 0xff5500 }));
    fire2.position.set(-168, 0.5, -86);
    scene.add(fire2);
    const fireLight2 = new THREE.PointLight(0xff8844, 0, 24, 2);
    fireLight2.position.set(-168, 1.6, -86);
    scene.add(fireLight2);
    torches.push({ light: fireLight2, flame: fire2, base: 13 });
    feat('tent', -170, -90, 28, 28);
  }

  // ---- 路边木哨塔 ----
  {
    const wt = new THREE.Group();
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 4.6, 5), woodMat);
      leg.position.set(lx, 2.3, lz);
      leg.rotation.z = -lx * 0.08;
      leg.rotation.x = lz * 0.08;
      wt.add(leg);
    }
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(3, 0.16, 3), woodMat);
    deck2.position.y = 4.6;
    wt.add(deck2);
    const roof2 = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), lambert(0x8a5a33, { roughness: 0.9 }));
    roof2.position.y = 6;
    roof2.rotation.y = Math.PI / 4;
    wt.add(roof2);
    wt.position.set(100, 0, 10);
    wt.traverse((o) => { o.castShadow = true; });
    scene.add(wt);
    box(100, 10, 2.6, 2.6);
    feat('tower', 100, 10, 3, 3);
  }

  // ---- 铁匠铺(炉与铁砧,在民居旁) ----
  {
    const forge = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.1, 8), towerMat);
    forge.position.set(24, 0.55, -6.5);
    scene.add(forge);
    const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.2, 8),
      new THREE.MeshLambertMaterial({ color: 0xff6622, emissive: 0xdd3300 }));
    ember.position.set(24, 1.15, -6.5);
    scene.add(ember);
    torches.push({ light: null, flame: ember, base: 0 });
    const anvilBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.6, 6), woodMat);
    anvilBase.position.set(25.6, 0.3, -7.5);
    scene.add(anvilBase);
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.3),
      lambert(0x3a3a42, { roughness: 0.35, metalness: 0.8 }));
    anvil.position.set(25.6, 0.72, -7.5);
    scene.add(anvil);
    circle(24, -6.5, 1.2);
  }

  // ---- 新增道路 ----
  road(140, 26, 168, -46, 3);   // 磨坊→石环
  road(76, 4, 80, -110, 3);     // 东门外→哨塔遗迹
  road(-95, -36, -150, -78, 3); // 桥→要塞方向
  road(-70, 4, -95, 40, 3);     // 西路→渔村方向
  road(-97, 42, -100, 52, 3);

  // ---- 新区金币 ----
  coinLine(78, 0, 80, -104, 7);
  coinLine(142, 24, 166, -42, 7);
  coinLine(-95, -40, -148, -76, 7);
  coinSpots.push([-100, 60], [-104, 66], [170, -52], [80, -112], [-40, -114], [12, 66], [100, 14]);

  // ---- 新区宝箱 ----
  chest(-166, -94, 200);  // 要塞内
  chest(-104, 60, 90);    // 渔村

  // ================= 外环八区 =================
  const zoneDisc = (x, z, r, color, type) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(r, 26), lambert(color, { roughness: 1 }));
    d.rotation.x = -Math.PI / 2;
    d.position.set(x, 0.018, z);
    d.receiveShadow = true;
    scene.add(d);
    feat(type, x, z, r * 2, r * 2);
  };

  // ---- 三石村(南境小村) ----
  house(4, 294, 0, 5, 4, 2.8);
  house(16, 294, 0, 5, 4, 2.8);
  house(-3, 294, 90, 5, 4, 2.8);
  {
    // 村中三块立石与水井
    for (const [sx, sz] of [[8, 302], [12, 303], [10, 306]]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2 + Math.random(), 0.9), rockMat);
      st.position.set(sx, 1.1, sz);
      st.castShadow = true;
      scene.add(st);
      circle(sx, sz, 0.8);
    }
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.9, 10), towerMat);
    well.position.set(4, 0.45, 304);
    scene.add(well);
    circle(4, 304, 1.2);
  }
  field(24, 306, 18, 10);
  field(-14, 308, 14, 10);
  road(0, 78, 8, 292, 3.4);
  coinLine(2, 110, 9, 288, 9);
  chest(20, 300, -90);
  torch(10, 300);

  // ---- 琥珀荒漠(东南) ----
  zoneDisc(300, 190, 92, 0xd9c48f, 'sand');
  function cactus(x, z) {
    const built = buildCactus(Math.random);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = Math.random() * 6.28;
    scene.add(built.group);
    circle(x, z, built.r);
    feat('cactus', x, z, 1, 1);
  }
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.28, rr = 15 + Math.random() * 70;
    cactus(300 + Math.cos(a) * rr, 190 + Math.sin(a) * rr);
  }
  {
    // 沙漠方尖碑
    const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, 9, 4), rockMat);
    ob.position.set(312, 4.5, 178);
    ob.rotation.y = 0.4;
    ob.castShadow = true;
    scene.add(ob);
    circle(312, 178, 1.6);
    feat('tower', 312, 178, 3, 3);
  }
  road(140, 30, 285, 165, 3.4);
  coinLine(150, 40, 280, 160, 10);
  chest(314, 181, 200);

  // ---- 雾语沼泽(西南) ----
  zoneDisc(-290, 240, 78, 0x4a5a3e, 'swamp');
  for (const [px, pz, pr] of [[-310, 225, 12], [-275, 255, 10], [-295, 270, 9], [-265, 225, 8]]) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(pr, 14), lambert(0x2a3a30, { roughness: 0.2 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(px, 0.03, pz);
    scene.add(pool);
    circle(px, pz, pr - 1);
    feat('water', px, pz, pr * 2, pr * 2);
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * 6.28, rr = 12 + Math.random() * 62;
    const dx = -290 + Math.cos(a) * rr, dz = 240 + Math.sin(a) * rr;
    const dead = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 3 + Math.random() * 1.5, 5),
      lambert(0x3a352c, { roughness: 1 }));
    dead.position.set(dx, 1.6, dz);
    dead.rotation.z = (Math.random() - 0.5) * 0.3;
    dead.castShadow = true;
    scene.add(dead);
    circle(dx, dz, 0.4);
    feat('tree', dx, dz, 1, 1);
  }
  // 女巫小屋
  house(-296, 232, 45, 5, 4, 2.6);
  torch(-293, 236);
  road(-118, 128, -280, 228, 3);
  coinLine(-130, 140, -275, 225, 10);
  chest(-300, 228, 130);

  // ---- 灰烬荒地(极西) ----
  zoneDisc(-380, -40, 74, 0x57524c, 'ash');
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.28, rr = 10 + Math.random() * 60;
    const bx = -380 + Math.cos(a) * rr, bz = -40 + Math.sin(a) * rr;
    const burnt = buildDeadTree(Math.random, { bark: 0x211d1a });
    burnt.group.scale.setScalar(0.8 + Math.random() * 0.5);
    burnt.group.position.set(bx, 0, bz);
    burnt.group.rotation.y = Math.random() * 6.28;
    scene.add(burnt.group);
    circle(bx, bz, 0.35);
    feat('tree', bx, bz, 1, 1);
  }
  // 古战场:插地断剑与白骨
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * 6.28, rr = Math.random() * 22;
    const sx = -372 + Math.cos(a) * rr, sz = -52 + Math.sin(a) * rr;
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.3, 0.03),
      lambert(0x8a8f96, { metalness: 0.7, roughness: 0.5 }));
    bl.position.set(sx, 0.6, sz);
    bl.rotation.z = (Math.random() - 0.5) * 0.7;
    bl.rotation.y = Math.random() * 3;
    scene.add(bl);
    const bone = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), lambert(0xe4ded0, { roughness: 0.9 }));
    bone.position.set(sx + 0.5, 0.15, sz + 0.3);
    scene.add(bone);
  }
  feat('bone', -372, -52, 30, 30);
  road(-215, -42, -352, -40, 3);
  coinLine(-225, -42, -350, -40, 10);
  chest(-388, -48, 60);

  // ---- 龙骨之地(东北) ----
  for (let i = 0; i < 7; i++) {
    const rz = -160 + i * 9;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(7 - Math.abs(i - 3) * 0.9, 0.32, 6, 12, Math.PI),
      lambert(0xe8e2d4, { roughness: 0.85 }));
    rib.position.set(300, 0.2, rz);
    rib.rotation.y = Math.PI / 2;
    rib.castShadow = true;
    scene.add(rib);
    circle(300 - (7 - Math.abs(i - 3) * 0.9), rz, 0.7);
    circle(300 + (7 - Math.abs(i - 3) * 0.9), rz, 0.7);
  }
  {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), lambert(0xe8e2d4, { roughness: 0.85 }));
    skull.scale.set(1, 0.85, 1.2);
    skull.position.set(300, 2.2, -178);
    skull.castShadow = true;
    scene.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1, 3), lambert(0xd8d2c4, { roughness: 0.9 }));
    jaw.position.set(300, 0.5, -180);
    scene.add(jaw);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0x111111 }));
      eye.position.set(300 + 1.2 * s, 2.6, -175.5);
      scene.add(eye);
    }
    circle(300, -178, 3.8);
    feat('bone', 300, -155, 16, 40);
  }
  road(182, -66, 292, -132, 3);
  coinLine(190, -70, 290, -130, 10);
  chest(295, -172, 40);

  // ---- 迷途丘陵(极东) ----
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * 6.28, rr = 18 + (i % 3) * 20;
    const dx = 380 + Math.cos(a) * rr, dz = 60 + Math.sin(a) * rr;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(9 + (i % 4) * 3, 10, 8),
      lambert(0x4f8a4a, { roughness: 1 }));
    dome.scale.y = 0.32;
    dome.position.set(dx, 0, dz);
    dome.receiveShadow = dome.castShadow = true;
    scene.add(dome);
    circle(dx, dz, (9 + (i % 4) * 3) * 0.8);
    feat('dome', dx, dz, 18, 18);
  }
  road(155, 26, 355, 56, 3);
  coinLine(165, 30, 350, 55, 10);
  chest(380, 60, 0);

  // ---- 霜风隘口(西北) ----
  zoneDisc(-260, -150, 58, 0xe8edf2, 'snow');
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * 6.28, rr = 10 + Math.random() * 45;
    const sx = -260 + Math.cos(a) * rr, sz = -150 + Math.sin(a) * rr;
    const g2 = buildPine(Math.random, { snow: true }).group;
    g2.scale.setScalar(0.9 + Math.random() * 0.4);
    g2.position.set(sx, 0, sz);
    g2.rotation.y = Math.random() * 6.28;
    scene.add(g2);
    circle(sx, sz, 0.55);
    feat('tree', sx, sz, 1.5, 1.5);
  }
  {
    const ice = new THREE.Mesh(new THREE.CircleGeometry(11, 16),
      lambert(0xcfe6f2, { roughness: 0.1, metalness: 0.1 }));
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(-248, 0.03, -138);
    scene.add(ice);
    feat('water', -248, -138, 22, 22);
  }
  chest(-268, -160, 20);
  coinLine(-215, -95, -255, -140, 9);

  // ---- 实例化草丛(纯视觉,不参与碰撞)----
  {
    // 三丛尖叶交叉,读作草而不是方块
    const bladeGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -0.26, 0, 0, 0.26, 0, 0, 0, 0.8, 0,
      -0.13, 0, -0.22, 0.13, 0, 0.22, 0, 0.7, 0,
      -0.13, 0, 0.22, 0.13, 0, -0.22, 0, 0.75, 0,
    ]);
    bladeGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    bladeGeo.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    bladeGeo.computeVertexNormals();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    const COUNT = 4000;
    const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, COUNT);
    grass.receiveShadow = true;
    const blockedRects = [
      [0, 33, 8, 55], [38, 0, 62, 8], [105, 9, 70, 9], [0, 67, 8, 20], [10, 85, 26, 18],
      [24, 88, 26, 16], [-18, 92, 22, 14], [52, 96, 20, 12], [0, -40, 26, 18], [-38, 0, 62, 8],
    ];
    const isBlocked = (x, z) => {
      if (Math.hypot(x, z - 5) < 13) return true;                    // 广场
      if (Math.hypot(x + 100, z - 100) < 35) return true;            // 湖
      if (Math.abs(x + 95) < 6 && z < 72 && z > -228) return true;   // 河
      if (Math.hypot(x + 170, z + 90) < 16) return true;             // 要塞
      if (z < -165) return true;                                     // 群山
      if (Math.hypot(x - 300, z - 190) < 94) return true;            // 荒漠
      if (Math.hypot(x + 290, z - 240) < 80) return true;            // 沼泽
      if (Math.hypot(x + 380, z + 40) < 76) return true;             // 灰烬
      if (Math.hypot(x + 260, z + 150) < 60) return true;            // 霜原
      for (const [cx, cz, w, d] of blockedRects) {
        if (Math.abs(x - cx) < w / 2 + 1 && Math.abs(z - cz) < d / 2 + 1) return true;
      }
      return false;
    };
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < COUNT * 6) {
      const x = (Math.random() - 0.5) * 480;
      const z = (Math.random() - 0.5) * 480;
      if (isBlocked(x, z)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const s = 0.7 + Math.random() * 0.9;
      dummy.scale.set(s, s * (0.8 + Math.random() * 0.6), s);
      dummy.updateMatrix();
      grass.setMatrixAt(placed, dummy.matrix);
      c.setHSL(0.25 + Math.random() * 0.06, 0.48, 0.4 + Math.random() * 0.16);
      grass.setColorAt(placed, c);
      placed++;
    }
    grass.count = placed;
    scene.add(grass);
    var grassMesh = grass; // 供季节换色
  }

  // 世界边界:±50000,总幅面 100000×100000(核心之外由荒野系统程序化生成)
  box(0, -50020, 100100, 40); box(0, 50020, 100100, 40);
  box(-50020, 0, 40, 100100); box(50020, 0, 40, 100100);

  return {
    ground, grassMesh,
    colliders, features, windmills, torches, chests, qBlocks, coinSpots, clouds, waterMats, occluders,
    windmillPos, banditCamp, fortPos,
    questGiverPos: new THREE.Vector3(4, 0, 10),
    playerSpawn: new THREE.Vector3(0, 0, 20),
    gates: [new THREE.Vector3(0, 0, 55), new THREE.Vector3(70, 0, 0)],
    stablePos: new THREE.Vector3(52, 0, 8),
    // 具名 NPC 站位
    npcSpots: {
      king: [0, -30.6, 0],
      blacksmith: [24.8, -8, -0.6],
      trader: [48, 10, 0.8],
      innkeep: [13.5, 76.5, 3.1],
      fisher: [-100, 70, 3.1],
      witch: [-294, 234.5, 0.8],
    },
    // 皇家纹章(收集品)
    crestSpots: [
      [0, -52.5], [-40, -121], [170, -60], [80, -114], [-100, 84],
      [146, 24], [-135, 100], [-190, -30], [-166, -86], [8, 78],
      [312, 175], [-297, 229], [-388, -44], [300, -182], [382, 63], [-250, -140],
    ],
    // 竞速赛道(顺序穿环)
    raceRoute: [[0, 66], [28, 78], [48, 96], [24, 106], [-12, 94], [0, 70]],
    // 狼出没点
    wolfSpawns: [[-140, -10], [-170, -40], [-120, -110], [-60, -148], [-190, 20], [-80, -80], [-300, 250], [-260, -130], [310, -130], [-360, -20]],
    lostHorsePos: new THREE.Vector3(-150, 0, 8),
    escortRoute: [[10, 1], [40, 0], [66, 0], [74, 2], [100, 9], [134, 17]],
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
