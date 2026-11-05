// 中世纪开放世界构建:城墙王国、城堡主堡、村庄、集市、风车、农田、森林、湖泊、盗贼营地
import * as THREE from 'three';
import { rand } from './core/rng.js';
import { buildTree, buildPine, buildDeadTree, buildCactus, buildRock, buildBush, getBuildingModel } from './flora.js';
import { lambert } from './entities.js';
import { makeTextures } from './textures.js';
import { worldTint } from './gfx/surface.js';
import { facetGeometry } from './gfx/facet.js';
import { buildCropMesh } from './vegetation.js';
import { waterMesh, polarWaterGeo, riverWaterGeo } from './gfx/water.js';
import { LAKE, lakeR, RIVER, POOLS, poolR, ICE, iceR, outline, riverNear, waterBasin } from './waterbodies.js';
import { mergeGeometries } from '../lib/jsm/utils/BufferGeometryUtils.js';

export function buildWorld(scene) {
  const colliders = { circles: [], boxes: [] };
  const features = [];   // 小地图静态要素
  const windmills = [];  // 需要动画的风车叶片
  const torches = [];    // 火把(夜间点亮)
  const chests = [];     // 宝箱
  const qBlocks = [];    // 符文立石(挥刀劈开得金币)
  const coinSpots = [];  // 金币初始点位
  const clouds = [];
  const waterMats = [];  // 水面材质(法线动画)
  const occluders = []; // 相机防穿墙用的大型遮挡体

  const TX = makeTextures();
  // 带独立 repeat 的 PBR 贴图材质;世界坐标低频调色打破平铺重复(见 worldTint)
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
    m.onBeforeCompile = worldTint;
    return m;
  }
  const woodMat = texMat(TX.wood, 1, 1, { roughness: 0.85 });
  const plasterMat = texMat(TX.plaster, 2, 1, { roughness: 0.95 });
  const roofMats = [0xa33b2c, 0x8a5a33, 0x7d3b2d, 0x9c4a3b].map((c) =>
    texMat(TX.roof, 3, 1.6, { color: c, roughness: 0.85 }));
  const dirtFieldMat = texMat(TX.dirt, 3, 2, { color: 0x9a8268 }); // 翻过的深色耕土

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
    if (waterBasin(m.position.x, m.position.z) > 0.02) m.userData.noSnap = true; // 涉水的路段:贴水面,不沉到河床
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
      texMat(TX.stone, len / 4.4, 5.5 / 4.4, { color: 0xd8d2c8 }));
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
    // 底部收分基座(墙脚外扩,天际城墙的厚重感)
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? len : 2.6, 1.4, horizontal ? 2.6 : len), wallMat);
    plinth.position.set((x1 + x2) / 2, 0.7, (z1 + z2) / 2);
    plinth.receiveShadow = true;
    scene.add(plinth);
    // 外侧扶壁(每 12 步一垛)
    const bn = Math.floor(len / 12);
    for (let i = 1; i < bn; i++) {
      const t = i / bn;
      const bx = x1 + dx * t, bz = z1 + dz * t;
      const out = horizontal ? Math.sign(z1) : Math.sign(x1); // 朝城外
      const but = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 1.1 : 1.5, 4.2, horizontal ? 1.5 : 1.1), wallMat);
      but.position.set(bx + (horizontal ? 0 : out * 1.4), 2.1, bz + (horizontal ? out * 1.4 : 0));
      but.castShadow = true;
      scene.add(but);
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
  const towerMats = new Map(); // 按塔的周长/高度配平铺:石块大小与城墙一致(约 4.4m 一张贴图)
  const towerMatFor = (r, h) => {
    const key = `${r}|${h}`;
    if (!towerMats.has(key)) towerMats.set(key, texMat(TX.stone, Math.round((Math.PI * 2 * r * 1.1) / 4.4), h / 4.4, { color: 0xd8d2c8, roughness: 0.92 }));
    return towerMats.get(key);
  };
  function tower(x, z, r = 4, h = 9) {
    // 天际式平顶石塔:底部收分 + 出挑护墙 + 垛口环(尖顶是法国人的,诺德不用)
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.22, h, 12), towerMatFor(r, h));
    t.position.set(x, h / 2, z);
    t.castShadow = true;
    scene.add(t);
    occluders.push(t);
    const parapet = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.14, r * 1.06, 0.9, 12), towerMat);
    parapet.position.set(x, h + 0.45, z);
    parapet.castShadow = true;
    scene.add(parapet);
    const merlons = 8;
    for (let i = 0; i < merlons; i++) {
      const a = (i / merlons) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(r * 0.42, 0.8, 0.5), wallMat);
      m.position.set(x + Math.cos(a) * r * 1.02, h + 1.2, z + Math.sin(a) * r * 1.02);
      m.rotation.y = -a + Math.PI / 2;
      m.castShadow = true;
      scene.add(m);
    }
    circle(x, z, r + 0.3);
    feat('tower', x, z, r * 2, r * 2);
    return t;
  }
  tower(-70, -55); tower(70, -55); tower(-70, 55); tower(70, 55);
  tower(-6, 55, 2.2, 7.5); tower(6, 55, 2.2, 7.5);   // 南门楼
  tower(70, -6, 2.2, 7.5); tower(70, 6, 2.2, 7.5);   // 东门楼

  // ---- 城堡主堡(Blender 天际式灰岩要塞;无模板则回退石盒) ----
  const keepTpl = getBuildingModel('keep');
  let keep;
  if (keepTpl) {
    // 按材质拆件 + 平面投影 UV:主体大块砌石、石带/扶壁盖石深一号,箭孔与门洞是暗色内衬
    const KEEP_MATS = {
      stone: texMat(TX.stone, 1 / 4.4, 1 / 4.4, { color: 0xd8d2c8, roughness: 0.95 }),
      dstone: texMat(TX.stone, 1 / 3.2, 1 / 3.2, { color: 0xaca69c, roughness: 0.95 }),
      slit: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 1 }),
      iron: lambert(0x4a4a52, { roughness: 0.45, metalness: 0.75 }),
      roof: texMat(TX.roof, 1 / 2, 1 / 2, { color: 0x5c6470, roughness: 0.8 }),
      wood: woodMat,
    };
    keep = new THREE.Group();
    for (const p of prepParts(keepTpl.getObjectByName('Keep') || keepTpl)) {
      const m = new THREE.Mesh(p.geo, KEEP_MATS[p.slot] || KEEP_MATS.stone);
      m.castShadow = m.receiveShadow = true;
      keep.add(m);
      if (p.big) occluders.push(m);
    }
    keep.position.set(0, 0, -40);
    scene.add(keep);
    box(0, -32.3, 7.2, 1.5); // 前凸门楼
  } else {
    keep = new THREE.Mesh(new THREE.BoxGeometry(22, 13, 14), texMat(TX.stone, 2.6, 2.4));
    keep.position.set(0, 6.5, -40);
    keep.castShadow = keep.receiveShadow = true;
    scene.add(keep);
    occluders.push(keep);
  }
  box(0, -40, 22, 14);
  feat('keep', 0, -40, 22, 14);
  for (const [tx, tz] of [[-11, -33], [11, -33], [-11, -47], [11, -47]]) tower(tx, tz, 3, 16);
  if (!keepTpl) { // 大门(模板自带门楼与铁闸)
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 0.5), woodMat);
    door.position.set(0, 3, -32.8);
    scene.add(door);
  }
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
  // 两层石砌水池:外池有池沿与池底(水面低于池沿),中柱托着小水盘,水帘落回外池
  const fountainStone = texMat(TX.stone, 2.2, 0.5, { color: 0xd4cec2, roughness: 0.9 });
  const lathe = (pts, seg = 28) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const fBase = new THREE.Mesh(lathe([[0.01, 0.22], [2.58, 0.22], [2.62, 0.62], [2.78, 0.7], [3.08, 0.7], [3.22, 0.6], [3.28, 0.05], [3.1, 0]]), fountainStone);
  fBase.position.set(0, 0, 5);
  fBase.castShadow = fBase.receiveShadow = true;
  scene.add(fBase);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 1.5, 12), fountainStone);
  col.position.set(0, 0.95, 5);
  col.castShadow = true;
  scene.add(col);
  const bowl = new THREE.Mesh(lathe([[0.01, 1.42], [0.82, 1.45], [0.95, 1.62], [1.02, 1.62], [0.96, 1.52], [0.4, 1.3], [0.3, 1.25]], 20), fountainStone);
  bowl.position.set(0, 0, 5);
  bowl.castShadow = true;
  scene.add(bowl);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lambert(0xc8c2b4));
  orb.position.set(0, 1.95, 5);
  scene.add(orb);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 8), fountainStone);
  spout.position.set(0, 1.7, 5);
  scene.add(spout);
  scene.add(waterMesh(polarWaterGeo(0, 5, () => 2.6, { margin: 0, rings: 3, segs: 32, y: 0.55 }), 'fountain', { depth: 0.33, normalTex: TX.waterNormal }));
  scene.add(waterMesh(polarWaterGeo(0, 5, () => 0.84, { margin: 0, rings: 2, segs: 20, y: 1.55 }), 'fountain', { depth: 0.12 }));
  { // 水帘:小水盘边沿落回外池的一圈薄水
    const curtain = new THREE.CylinderGeometry(0.98, 1.22, 1.0, 24, 1, true).translate(0, 1.07, 5);
    scene.add(waterMesh(curtain, 'fountain', { depth: 0.25 }));
  }
  circle(0, 5, 3.4);
  feat('plaza', 0, 5, 7, 7);

  // ---- 民居 ----
  // Blender 三种户型(HouseA 平房 / HouseB 两层外挑街屋 / HouseC 前廊长屋):按材质分件、按面重算法线
  // (平直着色),再按面朝向做平面投影 UV——贴图按真实米数平铺,不随部件拉伸。材质全城共享:
  // 静态合批后一个 64m 格里一种材质只画一次。屋顶(陶红/青石板/木瓦/苔灰)与墙灰按户随机。
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x2b2924, emissive: 0xffb050, emissiveIntensity: 0, roughness: 0.22, metalness: 0.1 });
  torches.push({ light: null, flame: { material: windowMat }, base: 0, window: true }); // 全城窗户一起入夜点亮
  const tileMat = (pair, metres, extra) => texMat(pair, 1 / metres, 1 / metres, extra);
  const HOUSE_MATS = {
    plaster: [0xf2e9d6, 0xe6d6b4, 0xd8d3ca].map((c) => tileMat(TX.plaster, 2.4, { color: c, roughness: 0.95 })),
    wood: tileMat(TX.wood, 1.3, { color: 0x6a5242, roughness: 0.88 }),
    plank: tileMat(TX.planks, 1.2, { color: 0xc8a888, roughness: 0.9 }),
    stone: tileMat(TX.stone, 2.2, { color: 0xcfc9bf, roughness: 0.95 }),
    door: tileMat(TX.planks, 1.0, { color: 0x9a7656, roughness: 0.85 }),
    roof: [0xa4563e, 0x626a74, 0x84634a, 0x7c7462].map((c) => tileMat(TX.roof, 2.0, { color: c, roughness: 0.8 })),
    glass: windowMat,
  };
  const houseTpls = prepHouseTemplates(getBuildingModel('house'));
  const propRng = (() => { let s = 0x5eed1234; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
  let houseIdx = 0;
  function house(x, z, rotDeg = 0, w = 6, d = 5, h = 3.2, kind = null, props = true) {
    const rot = (rotDeg * Math.PI) / 180;
    if (houseTpls) {
      const hh = (Math.imul((Math.round(x * 7.31) * 73856093) ^ (Math.round(z * 13.7) * 19349663), 2654435761) >>> 0);
      const k = kind || ['HouseA', 'HouseB', 'HouseC'][hh % 3];
      const tpl = houseTpls[k] || houseTpls.HouseA;
      const roofM = HOUSE_MATS.roof[(hh >>> 4) % 4];
      const wallM = HOUSE_MATS.plaster[(hh >>> 9) % 3];
      const g = new THREE.Group();
      const hs = new THREE.Group();
      hs.scale.set(w / 6, h / 3.2, d / 5);
      for (const p of tpl) {
        const mat = p.slot === 'roof' ? roofM : p.slot === 'plaster' ? wallM : HOUSE_MATS[p.slot] || HOUSE_MATS.wood;
        const m = new THREE.Mesh(p.geo, mat);
        m.castShadow = m.receiveShadow = true;
        hs.add(m);
        if (p.big) occluders.push(m); // 相机防穿墙只看墙体与屋顶
      }
      g.add(hs);
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      scene.add(g);
      const swap = rotDeg % 180 !== 0;
      box(x, z, (swap ? d : w) + 0.4, (swap ? w : d) + 0.4);
      feat('house', x, z, swap ? d : w, swap ? w : d);
      if (props) doorProps(x, z, rot, w, d, hh);
      houseIdx++;
      return g;
    }
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
  // 门口道具:木桶/板条箱/长凳/柴垛/洗衣盆,按户随机,只放在正面两角(不挡门)
  const BENCH_GEO = (() => {
    const parts = [new THREE.BoxGeometry(1.5, 0.08, 0.38).translate(0, 0.46, 0)];
    for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(0.08, 0.44, 0.32).translate(s * 0.6, 0.22, 0));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  })();
  const LOGS_GEO = (() => {
    const parts = [];
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 4 - row; k++) {
        parts.push(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 7).rotateZ(Math.PI / 2)
          .translate(0, 0.11 + row * 0.19, (k - (3 - row) / 2) * 0.23).toNonIndexed());
      }
    }
    return mergeGeometries(parts);
  })();
  const TUB_GEO = new THREE.CylinderGeometry(0.42, 0.36, 0.38, 12).translate(0, 0.19, 0);
  const propWood = tileMat(TX.planks, 0.9, { color: 0xb09070, roughness: 0.9 });
  function doorProps(x, z, rot, w, d, hh) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const place = (kind, lx, lz) => {
      const [px, pz] = at(lx, lz);
      const yaw = rot + (propRng() - 0.5) * 0.5;
      if (kind === 'barrel') {
        const btpl = getBuildingModel('barrel');
        const b = btpl ? btpl.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.36, 1, 10).translate(0, 0.5, 0), propWood);
        b.position.set(px, 0, pz);
        b.rotation.y = yaw;
        scene.add(b);
        circle(px, pz, 0.45);
      } else if (kind === 'crates') {
        for (let i = 0; i < 2; i++) {
          const sz = i ? 0.62 : 0.85;
          const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), propWood);
          m.position.set(px + (i ? 0.1 : 0), sz / 2 + (i ? 0.85 : 0), pz);
          m.rotation.y = yaw + i * 0.4;
          m.castShadow = true;
          scene.add(m);
        }
        circle(px, pz, 0.6);
      } else if (kind === 'bench' || kind === 'logs' || kind === 'tub') {
        const m = new THREE.Mesh(kind === 'bench' ? BENCH_GEO : kind === 'logs' ? LOGS_GEO : TUB_GEO, kind === 'logs' ? HOUSE_MATS.plank : propWood);
        m.position.set(px, 0, pz);
        m.rotation.y = kind === 'bench' ? rot : yaw;
        m.castShadow = true;
        scene.add(m);
        circle(px, pz, kind === 'bench' ? 0.55 : 0.5);
      }
    };
    const L = ['barrel', 'crates', 'logs', null][hh % 4];
    const R = ['bench', 'tub', 'barrel', null, 'logs'][(hh >>> 2) % 5];
    const ex = w / 2 - 0.62, ez = d / 2 + 0.72;
    if (L) place(L, -ex, ez);
    if (R && R !== L) place(R, ex, ez);
  }
  // 户型:广场一圈是两层街屋,外围平房与长屋穿插
  const housePlan = [
    [-25, 25, 0, 'HouseB'], [-36, 6, 90, 'HouseA'], [-25, -15, 0, 'HouseB'], [-42, -32, 0, 'HouseC'],
    [25, 25, 0, 'HouseB'], [36, 8, 90, 'HouseB'], [28, -12, 0, 'HouseA'], [44, -30, 0, 'HouseC'],
    [-15, 40, 0, 'HouseA'], [18, 40, 0, 'HouseC'], [-52, 30, 90, 'HouseC'], [52, 35, 0, 'HouseA'],
    [-52, -10, 90, 'HouseA'], [20, -30, 0, 'HouseB'], [-30, 42, 0, 'HouseB'], [45, 20, 90, 'HouseA'],
  ];
  for (const [x, z, r, k] of housePlan) house(x, z, r, 6, 5, 3.2, k);

  // ---- 集市摊位 ----
  function stall(x, z, canopyColor) {
    // Blender 市集摊位模板(未染帆布——诺德市集不用糖果篷)
    const stpl = getBuildingModel('stall');
    if (stpl) {
      const g = stpl.clone();
      g.position.set(x, 0, z);
      g.lookAt(0, 0, 5);
      scene.add(g);
      circle(x, z, 1.4);
      feat('stall', x, z, 2.5, 1.5);
      return;
    }
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

  function tree(x, z, pine = false) {
    const scale = 0.85 + rand() * 0.5;
    const built = pine ? buildPine(rand) : (rand() < 0.12 ? buildBush(rand) : buildTree(rand));
    const g = built.group;
    g.scale.setScalar(scale);
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    circle(x, z, built.r * scale);
    feat('tree', x, z, 1.5, 1.5);
  }
  // 西部森林
  for (let i = 0; i < 75; i++) {
    const x = -235 + rand() * 140;
    const z = -140 + rand() * 180;
    if (Math.hypot(x + 100, z - 100) < 40) continue;             // 避开湖
    if (Math.hypot(x + 130, z + 60) < 14) continue;              // 避开营地
    if (Math.hypot(x + 170, z + 90) < 22) continue;              // 避开要塞
    const rv = riverNear(x, z);
    if (rv && rv.d < rv.hw + 3) continue;                          // 避开河道
    if (x > -78 && z > -60 && z < 60) continue;                  // 避开城墙口
    tree(x, z, rand() < 0.55);
  }
  // 北部森林
  for (let i = 0; i < 34; i++) {
    const x = -60 + rand() * 220;
    const z = -160 + rand() * 65;
    if (Math.hypot(x - 80, z + 120) < 20) continue;              // 避开遗迹
    if (Math.hypot(x + 40, z + 120) < 20) continue;              // 避开墓园
    tree(x, z, rand() < 0.5);
  }
  // 零散树
  const scatter = [[20, 68], [-25, 72], [40, 62], [90, 35], [110, -10], [60, 80], [-40, 65], [15, 110], [-10, 95]];
  for (const [x, z] of scatter) tree(x, z, false);
  // 城内景观树
  for (const [x, z] of [[-8, 30], [8, 30], [-45, 45], [45, -45], [-20, -40]]) tree(x, z, false);

  // ---- 银月湖:噪声岸线(29~32.5m)、地形挖成盆地、统一水着色(浅滩透底、深处暗青、岸边泡沫) ----
  scene.add(waterMesh(polarWaterGeo(LAKE.x, LAKE.z, lakeR, { r0: 4.5, rings: 24, segs: 112 }), 'lake', { depthFn: waterBasin, normalTex: TX.waterNormal }));
  // 湖水碰撞:一圈小圆(中心留空),朝栈桥方向开口——栈桥能走到头,
  // 开口再用三枚"浅滩塞"堵住,徒步下不了水,上岛只能靠小船
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    // 栈桥朝南伸进湖(方向角 -90°):±35° 内留开口
    const deg = ((a * 180 / Math.PI + 90) % 360 + 360) % 360;
    if (deg < 35 || deg > 325) continue;
    circle(-100 + Math.cos(a) * 26, 100 + Math.sin(a) * 26, 6);
  }
  // 深水不可徒步由 systems/player.js 的 enforceDeepWater 规则级判定兜底(几何环只挡 NPC/野兽)
  features.push({ type: 'water', x: LAKE.x, z: LAKE.z, w: 66, h: 66, rot: 0, shape: true, poly: outline(LAKE.x, LAKE.z, lakeR) });

  // ---- 湖心岛:沉没神殿的尖顶 ----
  let islandAltarMat = null;
  {
    const isle = new THREE.Mesh(new THREE.CircleGeometry(5.5, 18), lambert(0x8f8770, { roughness: 0.95 }));
    isle.rotation.x = -Math.PI / 2;
    isle.position.set(-100, 0.07, 100);
    isle.receiveShadow = true;
    scene.add(isle);
    // 三根断柱
    for (const [cx, cz, h] of [[-102.5, 98, 2.6], [-97.8, 98.4, 1.8], [-100.2, 103, 3.4]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 9), lambert(0xd8d2c0, { roughness: 0.9 }));
      col.position.set(cx, h / 2, cz);
      col.rotation.z = (rand() - 0.5) * 0.1;
      col.castShadow = true;
      scene.add(col);
      circle(cx, cz, 0.6);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), lambert(0xd8d2c0));
      cap.position.set(cx, h + 0.15, cz);
      cap.rotation.y = rand();
      scene.add(cap);
    }
    // 月光祭坛:满月夜会亮
    islandAltarMat = new THREE.MeshStandardMaterial({
      color: 0xcfe0e8, emissive: 0x2a5a78, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.2 });
    const altar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.0), islandAltarMat);
    altar.position.set(-100, 0.5, 100.5);
    altar.castShadow = true;
    scene.add(altar);
    circle(-100, 100.5, 0.9);
    feat('tower', -100, 100, 6, 6);
  }
  // 摆渡小船 ×2(栈桥边 / 岛边)
  function rowboat(x, z, rot) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 2.6), lambert(0x7a5a38, { roughness: 0.9 }));
    hull.position.y = 0.25;
    b.add(hull);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 2.8), lambert(0x5f4429));
    rim.position.y = 0.46;
    b.add(rim);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.4), lambert(0x9a7a4f));
    seat.position.y = 0.4;
    b.add(seat);
    b.position.set(x, -0.14, z); // 浮在水面(水位 0),不贴湖底
    b.userData.noSnap = true;
    b.rotation.y = rot;
    scene.add(b);
  }
  rowboat(-96.5, 86, 0.5);
  rowboat(-100, 106.2, 2.6);

  // ---- 农田 ----(作物成行实例化:麦/卷心菜/葱韭,一块地一次绘制,随风轻摆)
  const cropRng = (() => { let s2 = 0x1c0ffee; return () => { s2 = (s2 * 16807) % 2147483647; return (s2 - 1) / 2147483646; }; })();
  function cropRows(x, z, w, d, kind, rot = 0) {
    const gap = kind === 'wheat' ? 0.4 : kind === 'cabbage' ? 0.62 : 0.36;
    const rowGap = kind === 'wheat' ? 0.78 : 0.95;
    const c = Math.cos(rot), sn = Math.sin(rot);
    const list = [];
    for (let rz = -d / 2 + 0.55; rz <= d / 2 - 0.45; rz += rowGap) {
      for (let rx = -w / 2 + 0.45; rx <= w / 2 - 0.45; rx += gap) {
        if (cropRng() < 0.04) continue; // 缺苗
        const lx = rx + (cropRng() - 0.5) * gap * 0.5, lz = rz + (cropRng() - 0.5) * 0.16;
        list.push({ x: x + lx * c + lz * sn, z: z - lx * sn + lz * c });
      }
    }
    return buildCropMesh(kind, list, x, z);
  }
  function field(x, z, w, d, kind = 'wheat') {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dirtFieldMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.045, z); // 高于道路平面,避免 z-fighting
    f.receiveShadow = true;
    scene.add(f);
    scene.add(cropRows(x, z, w, d, kind));
    feat('field', x, z, w, d);
  }
  field(24, 88, 24, 14, 'wheat');
  field(-18, 92, 20, 12, 'cabbage');
  field(52, 96, 18, 10, 'wheat');

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
  chest(-75.6, 80, 90); // 湖边(岸上)
  chest(30, 96);        // 农田
  chest(56, 15, 180);   // 马厩
  chest(-66, 50, 45);   // 城墙角

  // ---- 符文立石:落地的古立石,正反两面刻着发光符文(挥刀劈中它,符文碎光化作金币)----
  // 本体是六棱、收分、斜顶的粗糙石板(平直着色 + 顶点色:根部青苔、顶部风化发白),脚下一圈半埋的碎石;
  // 符文沿正面平面投影:底色贴图只画刻槽(其余纯白,乘顶点色),发光贴图只画刻痕;另有一片深色泥土垫底
  const rune = makeRuneTextures();
  const RUNE_GEO = (() => {
    let sd = 4242;
    const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const parts = [];
    const body = new THREE.CylinderGeometry(0.5, 0.56, 2.15, 6, 4, false, Math.PI / 6).translate(0, 1.075, 0);
    const p = body.attributes.position;
    const bump = new Map(); // 同一位置的顶点同样扰动(棱面不裂缝)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      if (!bump.has(key)) bump.set(key, [(rr() - 0.5) * 0.08, (rr() - 0.5) * 0.06, (rr() - 0.5) * 0.05]);
      const [jx, jy, jz] = bump.get(key);
      const t = y / 2.15; // 0 底 → 1 顶:上窄下宽、前后压扁成板、斜顶
      p.setXYZ(i, x * (1 - t * 0.2) + jx, y + jy + x * 0.26 * t * t, z * 0.62 * (1 - t * 0.12) + jz);
    }
    parts.push(body.toNonIndexed());
    for (let k = 0; k < 6; k++) { // 脚下半埋的碎石(二十面体本就是非索引几何)
      const a = (k / 6) * Math.PI * 2 + rr() * 0.7, r = 0.72 + rr() * 0.3, s = 0.12 + rr() * 0.14;
      parts.push(new THREE.IcosahedronGeometry(s, 0).scale(1.2, 0.6, 1)
        .translate(Math.cos(a) * r, s * 0.15, Math.sin(a) * r * 0.8));
    }
    const g = mergeGeometries(parts.map((q) => { q.deleteAttribute('uv'); q.deleteAttribute('normal'); return q; }));
    g.computeVertexNormals();
    const P = g.attributes.position, col = new Float32Array(P.count * 3), uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), n = Math.sin(x * 9.1 + y * 5.3 + P.getZ(i) * 7.7) * 0.5 + 0.5;
      const moss = Math.max(0, 1 - y / 0.8) * (0.4 + 0.4 * n); // 根部青苔(橄榄绿,不是薄荷绿)
      const top = Math.max(0, (y - 1.6) / 0.6); // 顶部风化发白
      const base = (0.5 + 0.1 * n + 0.16 * top) * (1 - 0.22 * moss);
      const lin = (v) => Math.pow(v, 2.2); // 顶点色按线性空间进着色器:这里按 sRGB 调好再换算
      col[i * 3] = lin(base * (1 - moss * 0.3)); col[i * 3 + 1] = lin(base * (1 - moss * 0.1)); col[i * 3 + 2] = lin(base * (0.95 - moss * 0.55));
      uv[i * 2] = x / 0.78 + 0.5; uv[i * 2 + 1] = (y - 0.42) / 1.25; // 正面平面投影:刻痕只落在正反两块大面上
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  })();
  const RUNE_SOIL = new THREE.CircleGeometry(1.3, 14).rotateX(-Math.PI / 2).translate(0, 0.025, 0);
  const runeSoilMat = new THREE.MeshStandardMaterial({ color: 0x4a4032, roughness: 1, transparent: true, opacity: 0.5,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  function qblock(x, z, yaw = 0) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(RUNE_SOIL, runeSoilMat));
    // 刻面来自几何面法线(非索引 + 逐面法线),材质不开 flatShading(片元导数法线会出 NaN 像素,见 gfx/facet.js)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: rune.map, roughness: 0.95,
      metalness: 0, emissive: 0x6fd8ff, emissiveMap: rune.glow, emissiveIntensity: 1.1 });
    mat.userData.wettable = true;
    mat.userData.baseRough = 0.95;
    const body = new THREE.Mesh(RUNE_GEO, mat);
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    g.position.set(x, 0, z);
    g.rotation.set(0, yaw, (((x * 7 + z * 13) % 5) - 2) * 0.015); // 微微歪斜:立了几百年
    scene.add(g);
    circle(x, z, 0.62);
    feat('tower', x, z, 1.2, 1.2);
    qBlocks.push({ mesh: g, mat, x, z, y: 1.3, used: false, bump: 0 });
  }
  // 都立在路边草地上(不挡大街):广场南、西街、东区、南门外、东路边、西城
  qblock(6, 22, 0.3); qblock(-20, 3.8, 0); qblock(30, 32, -0.5); qblock(3.8, 70, 1.4); qblock(95, 9.6, 0.2); qblock(-60, 20, 1.2);
  // 劈中判定:由刀锋判定帧调用(systems/combat.js 的 meleeSweep,与砍人同一刀长与扇面),劈中第一块亮着的立石就熄灭并返回它
  function runeStrike(px, pz, yaw, range, arcDot) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const b of qBlocks) {
      if (b.used) continue;
      const dx = b.x - px, dz = b.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range + 0.55) continue; // 立石本身约半米粗
      if (d > 0.7 && (dx * fx + dz * fz) / d <= arcDot) continue;
      b.used = true;
      b.bump = 0.45;
      b.mat.emissiveIntensity = 0; // 符文熄灭,只剩一块刻着旧痕的石头
      b.mat.color.setHex(0xb8b2a6);
      return b;
    }
    return null;
  }
  // 立石动画:没被劈的符文缓缓呼吸;被劈中时晃一晃
  let runeT = 0;
  function animRunes(dt) {
    runeT += dt;
    for (const b of qBlocks) {
      if (b.bump > 0) {
        b.bump = Math.max(0, b.bump - dt);
        b.mesh.rotation.x = Math.sin(b.bump * 40) * b.bump * 0.12;
      } else if (!b.used) b.mat.emissiveIntensity = 0.9 + Math.sin(runeT * 1.8 + b.x) * 0.35;
    }
  }

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
    const btpl = getBuildingModel('barrel');
    if (btpl) {
      const g = btpl.clone();
      g.position.set(x, 0, z);
      g.rotation.y = rand() * Math.PI * 2;
      scene.add(g);
      circle(x, z, 0.5);
      return;
    }
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
    c.rotation.y = rand() * 1.5;
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
    h.rotation.y = rand() * 3;
    h.position.set(x, 0.85, z);
    h.castShadow = true;
    scene.add(h);
    circle(x, z, 1.0);
  }
  hay(30, 84); hay(-14, 88); hay(48, 99); hay(20, 95);

  function fence(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.floor(len / 2.2)); // 短篱笆也至少两根桩(len<2.2 时 0/0 会出 NaN)
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

  // ---- 城内:补几户人家、门前踩出的土路、屋侧菜园(墙内不再是一片空草地) ----
  house(-57, -43, 0, 6, 5, 3.2, 'HouseC');
  house(58, -43, 0, 6, 5, 3.2, 'HouseA');
  house(-60, 45, 90, 6, 5, 3.2, 'HouseA');
  house(36, 49.2, 180, 6, 5, 3.2, 'HouseB');
  // 土路:沿中线分段的条带,两侧边缘用噪声抖出不规则的踩踏边;UV 顺着路走,材质全城共享(可合批)
  const laneMat = texMat(TX.dirt, 1, 1, { color: 0xa69c8e, roughness: 0.95 });
  function lane(x1, z1, x2, z2, w = 2.0) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const n = Math.max(2, Math.ceil(len / 0.9));
    const P = [], U = [], I = [];
    const wob = (t, side) => 0.22 * Math.sin(t * 1.7 + side * 2.1 + x1) + 0.14 * Math.sin(t * 4.3 + side * 5.7 + z1);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len;
      const cx = x1 + ux * t, cz = z1 + uz * t;
      for (const side of [-1, 1]) {
        const hw = w / 2 + wob(t, side) * (i === 0 || i === n ? 0.3 : 1);
        P.push(cx + nx * hw * side, 0, cz + nz * hw * side);
        U.push((hw * side) / 4, t / 9);
      }
      if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { // 绕序朝下就翻过来
      for (let k = 0; k < I.length; k += 3) { const tmp = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = tmp; }
      g.setIndex(I);
      g.computeVertexNormals();
    }
    const m = new THREE.Mesh(g, laneMat);
    m.position.y = 0.017; // 压在石板路(0.02)之下:交汇处由石板盖住
    m.receiveShadow = true;
    scene.add(m);
    feat('road', (x1 + x2) / 2, (z1 + z2) / 2, w, len, Math.atan2(dx, dz));
  }
  for (const [x1, z1, x2, z2] of [
    [-25.5, 28.4, -2, 28.4], [2, 28.4, 25.5, 28.4],            // 广场南两户的门前路
    [-31, 45.2, -2, 45.2], [-15, 42.6, -15, 45.2],               // 南城西巷
    [2, 45.2, 52.5, 45.2], [18, 42.6, 18, 45.2], [52, 37.5, 52, 45.2],
    [-48, -10.8, -48, 30.8], [-49.3, 30, -48, 30], [-49.3, -10, -48, -10],
    [-32, 2, -32, 7.2], [-25, -12.4, -25, -2], [-42, -29.4, -42, -2], [-57, -40.4, -57, -2],
    [28, -9.4, 28, -2], [44, -27.4, 44, -2], [20, -27.4, 20, -2], [58, -40.4, 58, -2], [40, 2, 40, 8.8],
  ]) lane(x1, z1, x2, z2);
  // 菜园:翻土 + 成行的卷心菜/葱韭 + 一圈矮篱笆(朝路留个口)
  function garden(cx, cz, w, d) {
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), dirtFieldMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(cx, 0.03, cz);
    soil.receiveShadow = true;
    scene.add(soil);
    const half = Math.floor(d / 2);
    scene.add(cropRows(cx, cz - d / 4, w - 0.4, half, 'cabbage'));
    scene.add(cropRows(cx, cz + d / 4, w - 0.4, d - half, 'greens'));
    const x0 = cx - w / 2 - 0.3, x1 = cx + w / 2 + 0.3, z0 = cz - d / 2 - 0.3, z1 = cz + d / 2 + 0.3;
    fence(x0, z0, x1, z0); fence(x0, z0, x0, z1); fence(x1, z0, x1, z1);
    fence(x0, z1, cx - 0.7, z1); fence(cx + 0.7, z1, x1, z1);
    feat('field', cx, cz, w, d);
  }
  garden(-34, 23.5, 5, 6);
  garden(34, 23.5, 5, 6);
  garden(-25, -21.5, 6, 4);
  garden(35.5, -12, 4.5, 5);
  garden(44.5, 34, 4.5, 5);
  garden(-7.5, 38.5, 4, 5);

  // ================= 王国扩张区 =================

  // ---- 银月河(自湖泊向北)与木桥 ----
  {
    // 弯曲样条河道(waterbodies.RIVER):水面条带只铺到湖岸,入湖口由湖面接上
    const inLake = (q) => Math.hypot(q.x - LAKE.x, q.z - LAKE.z) < lakeR(Math.atan2(q.z - LAKE.z, q.x - LAKE.x)) - 0.5;
    const rpts = RIVER.filter((q) => !inLake(q));
    scene.add(waterMesh(riverWaterGeo(rpts), 'river', { depthFn: waterBasin, normalTex: TX.waterNormal }));
    for (let i = 0; i < rpts.length - 1; i += 3) { // 地图/压平/禁草:分段旋转矩形
      const a = rpts[i], b = rpts[Math.min(rpts.length - 1, i + 3)];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      features.push({ type: 'water', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, w: Math.max(a.w, b.w), h: len + 0.6,
        rot: Math.atan2(b.x - a.x, b.z - a.z), shape: true });
    }
    // 河岸碰撞:沿中线一串圆(桥处 z -41..-27 留口)
    for (const q of RIVER) {
      if (q.z > -41 && q.z < -27) continue;
      circle(q.x, q.z, q.w / 2 - 0.5);
    }
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
    bridge.userData.noSnap = true; // 桥面在水位之上(桥下土埂与桥面齐平),不跟着河床
    scene.add(bridge);
    feat('road', -95, -34, 12, 5);
  }

  // 北境群山已并入地形(terrain.js 的 mountainH);地图上的岩灰与雪顶由 mapColor 按山体高度着色
  const rockMat = lambert(0x6e6a72, { roughness: 0.98, flatShading: true }); // 立石/方尖碑共用

  // ---- 苇岸渔村 ----
  house(-110, 58, 90, 5, 4, 2.6, 'HouseC');
  house(-88, 54, 0, 5, 4, 2.6, 'HouseC');
  {
    // 栈桥伸入湖中
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 15), woodMat);
    pier.position.set(-100, 0.3, 78);
    pier.userData.noSnap = true; // 桥面在水位之上,不跟着湖底
    pier.castShadow = true;
    scene.add(pier);
    for (const pz of [71, 74.5, 78, 81.5, 85]) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.9, 6), woodMat);
        post.position.set(-100 + s * 1.05, -0.4 + (pz === 85 ? 0.35 : 0), pz);
        post.userData.noSnap = true;
        scene.add(post);
      }
    }
    // 小船
    const boat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 3.2), woodMat);
    boat.position.set(-94, 0.08, 86);
    boat.userData.noSnap = true;
    boat.rotation.y = 0.5;
    scene.add(boat);
    // 芦苇沿岸生长:交给 vegetation(按 waterbodies 的岸线成片长,不再是一圈棍子)
    feat('house', -100, 78, 3, 15);
  }

  // ---- 十字路旅店 ----
  house(12, 72, 0, 8, 6, 3.6, 'HouseB', false); // 旅店门口已有招牌与长凳
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
      const a = rand() * Math.PI * 2;
      const rk = buildRock(rand);
      rk.group.scale.setScalar(0.7);
      rk.group.position.set(80 + Math.cos(a) * (4.5 + rand() * 3), 0, -120 + Math.sin(a) * (4.5 + rand() * 3));
      scene.add(rk.group);
    }
    circle(80, -120, 4.2);
    feat('tower', 80, -120, 7, 7);
  }

  // ---- 静眠墓园 ----
  {
    for (let i = 0; i < 9; i++) {
      const gx = -48 + (i % 3) * 7 + rand() * 2;
      const gz = -127 + Math.floor(i / 3) * 6 + rand() * 2;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1 + rand() * 0.4, 0.18), towerMat);
      stone.position.set(gx, 0.55, gz);
      stone.rotation.y = (rand() - 0.5) * 0.4;
      stone.rotation.z = (rand() - 0.5) * 0.12;
      stone.castShadow = true;
      scene.add(stone);
    }
    // 枯树
    const dead = buildDeadTree(rand);
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
    const menhir = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3 + rand(), 0.9), rockMat);
    menhir.position.set(sx, 1.5, sz);
    menhir.rotation.y = a;
    menhir.rotation.z = (rand() - 0.5) * 0.15;
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
  // 区域底色改由地形顶点色(terrain.js 群系)负责;这里只登记小地图色块
  const zoneDisc = (x, z, r, color, type) => {
    feat(type, x, z, r * 2, r * 2);
  };

  // ---- 三石村(南境小村) ----
  house(4, 294, 0, 5, 4, 2.8, 'HouseA');
  house(16, 294, 0, 5, 4, 2.8, 'HouseC');
  house(-3, 294, 90, 5, 4, 2.8, 'HouseA');
  {
    // 村中三块立石与水井
    for (const [sx, sz] of [[8, 302], [12, 303], [10, 306]]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2 + rand(), 0.9), rockMat);
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
  field(24, 306, 18, 10, 'wheat');
  field(-14, 308, 14, 10, 'greens');
  road(0, 78, 8, 292, 3.4);
  coinLine(2, 110, 9, 288, 9);
  chest(20, 300, -90);
  torch(10, 300);

  // ---- 琥珀荒漠(东南) ----
  zoneDisc(300, 190, 92, 0xd9c48f, 'sand');
  function cactus(x, z) {
    const built = buildCactus(rand);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = rand() * 6.28;
    scene.add(built.group);
    circle(x, z, built.r);
    feat('cactus', x, z, 1, 1);
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * 6.28, rr = 15 + rand() * 70;
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
  for (const pl of POOLS) { // 不规则轮廓的浅泥塘:浮萍成片,岸边芦苇由 vegetation 长
    const R = (a) => poolR(pl, a);
    scene.add(waterMesh(polarWaterGeo(pl.x, pl.z, R, { rings: 10, segs: 56 }), 'swamp', { depthFn: waterBasin, normalTex: TX.waterNormal }));
    circle(pl.x, pl.z, pl.r * 0.72);
    features.push({ type: 'water', x: pl.x, z: pl.z, w: pl.r * 2.5, h: pl.r * 2.5, rot: 0, shape: true, poly: outline(pl.x, pl.z, R, 32) });
  }
  for (let i = 0; i < 12; i++) {
    const a = rand() * 6.28, rr = 12 + rand() * 62;
    const dx = -290 + Math.cos(a) * rr, dz = 240 + Math.sin(a) * rr;
    const dead = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 3 + rand() * 1.5, 5),
      lambert(0x3a352c, { roughness: 1 }));
    dead.position.set(dx, 1.6, dz);
    dead.rotation.z = (rand() - 0.5) * 0.3;
    dead.castShadow = true;
    scene.add(dead);
    circle(dx, dz, 0.4);
    feat('tree', dx, dz, 1, 1);
  }
  // 女巫小屋
  house(-296, 232, 45, 5, 4, 2.6, 'HouseC');
  torch(-293, 236);
  road(-118, 128, -280, 228, 3);
  coinLine(-130, 140, -275, 225, 10);
  chest(-300, 228, 130);

  // ---- 灰烬荒地(极西) ----
  zoneDisc(-380, -40, 74, 0x57524c, 'ash');
  for (let i = 0; i < 14; i++) {
    const a = rand() * 6.28, rr = 10 + rand() * 60;
    const bx = -380 + Math.cos(a) * rr, bz = -40 + Math.sin(a) * rr;
    const burnt = buildDeadTree(rand, { bark: 0x211d1a });
    burnt.group.scale.setScalar(0.8 + rand() * 0.5);
    burnt.group.position.set(bx, 0, bz);
    burnt.group.rotation.y = rand() * 6.28;
    scene.add(burnt.group);
    circle(bx, bz, 0.35);
    feat('tree', bx, bz, 1, 1);
  }
  // 古战场:插地断剑与白骨
  for (let i = 0; i < 9; i++) {
    const a = rand() * 6.28, rr = rand() * 22;
    const sx = -372 + Math.cos(a) * rr, sz = -52 + Math.sin(a) * rr;
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.3, 0.03),
      lambert(0x8a8f96, { metalness: 0.7, roughness: 0.5 }));
    bl.position.set(sx, 0.6, sz);
    bl.rotation.z = (rand() - 0.5) * 0.7;
    bl.rotation.y = rand() * 3;
    scene.add(bl);
    const bone = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), lambert(0xe4ded0, { roughness: 0.9 }));
    bone.position.set(sx + 0.5, 0.15, sz + 0.3);
    scene.add(bone);
  }
  feat('bone', -372, -52, 30, 30);
  road(-215, -42, -352, -40, 3);
  coinLine(-225, -42, -350, -40, 10);
  chest(-388, -48, 60);

  // ---- 龙骨之地(东北):风化的巨龙骸骨——刻面低多边形(与岩石/树同一画法),肋骨略带扭曲、半埋的脊椎、带角的头骨 ----
  {
    let sd = 9173;
    const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const rough = (geo, amt) => { // 同位置顶点同样扰动(不开裂),再拆成刻面
      const p = geo.attributes.position, m = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
        if (!m.has(key)) m.set(key, [(rr() - 0.5) * amt, (rr() - 0.5) * amt, (rr() - 0.5) * amt]);
        const [a, b, c] = m.get(key);
        p.setXYZ(i, p.getX(i) + a, p.getY(i) + b, p.getZ(i) + c);
      }
      return facetGeometry(geo);
    };
    const boneMat = lambert(0xdcd2bc, { roughness: 0.92 });
    const boneDark = lambert(0xbfb39a, { roughness: 0.95 });
    for (let i = 0; i < 7; i++) {
      const rz = -160 + i * 9, R = 7 - Math.abs(i - 3) * 0.9;
      const rib = new THREE.Mesh(rough(new THREE.TorusGeometry(R, 0.34, 5, 14, Math.PI), 0.1), boneMat);
      rib.position.set(300, 0.2, rz);
      rib.rotation.set(0, Math.PI / 2, (rr() - 0.5) * 0.12); // 略歪:倒下几百年了
      rib.castShadow = true;
      scene.add(rib);
      circle(300 - R, rz, 0.7);
      circle(300 + R, rz, 0.7);
    }
    // 脊椎:沿肋骨中线一串半埋的椎骨(带棘突),一直拖到尾巴
    const vert = [];
    for (let k = 0; k < 16; k++) {
      const z = -168 + k * 5.2, sc = 1 - Math.max(0, k - 9) * 0.1;
      vert.push(rough(new THREE.CylinderGeometry(0.75 * sc, 0.75 * sc, 1.1, 6), 0.08).rotateX(Math.PI / 2).translate(0, 0.35 * sc, z + 140));
      vert.push(rough(new THREE.ConeGeometry(0.28 * sc, 1.3 * sc, 4), 0.05).translate(0, 1.2 * sc, z + 140));
    }
    const spine = new THREE.Mesh(mergeGeometries(vert), boneDark);
    spine.castShadow = spine.receiveShadow = true;
    spine.position.set(300, 0, -140); // 逻辑 y 离地:贴地由 snapScene 统一处理(龙骨之地是平整区)
    scene.add(spine);
    const skull = new THREE.Mesh(rough(new THREE.SphereGeometry(3.2, 9, 7), 0.35), boneMat);
    skull.scale.set(1, 0.85, 1.2);
    skull.position.set(300, 2.2, -178);
    skull.castShadow = true;
    scene.add(skull);
    const jaw = new THREE.Mesh(rough(new THREE.BoxGeometry(4.2, 1, 3, 2, 1, 2), 0.25), boneDark);
    jaw.position.set(300, 0.5, -180);
    scene.add(jaw);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0x111111 }));
      eye.position.set(300 + 1.2 * s, 2.6, -175.5);
      scene.add(eye);
      // 一对向后弯的角
      const horn = new THREE.Mesh(rough(new THREE.ConeGeometry(0.55, 4.2, 5, 3), 0.08), boneDark);
      horn.position.set(300 + 1.9 * s, 4.4, -179.5);
      horn.rotation.set(-0.95, 0, -0.35 * s);
      horn.castShadow = true;
      scene.add(horn);
    }
    circle(300, -178, 3.8);
    feat('bone', 300, -155, 16, 40);
  }
  road(182, -66, 292, -132, 3);
  coinLine(190, -70, 290, -130, 10);
  chest(295, -172, 40);

  // ---- 迷途丘陵(极东) ----
  // 起伏由 terrain.js 的 hills 生物群系真实生成;这里只登记小地图上的丘陵轮廓
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * 6.28, rr = 18 + (i % 3) * 20;
    feat('dome', 380 + Math.cos(a) * rr, 60 + Math.sin(a) * rr, 18, 18);
  }
  road(155, 26, 355, 56, 3);
  coinLine(165, 30, 350, 55, 10);
  chest(380, 60, 0);

  // ---- 霜风隘口(西北) ----
  zoneDisc(-260, -150, 58, 0xe8edf2, 'snow');
  for (let i = 0; i < 10; i++) {
    const a = rand() * 6.28, rr = 10 + rand() * 45;
    const sx = -260 + Math.cos(a) * rr, sz = -150 + Math.sin(a) * rr;
    const g2 = buildPine(rand, { snow: true }).group;
    g2.scale.setScalar(0.9 + rand() * 0.4);
    g2.position.set(sx, 0, sz);
    g2.rotation.y = rand() * 6.28;
    scene.add(g2);
    circle(sx, sz, 0.55);
    feat('tree', sx, sz, 1.5, 1.5);
  }
  {
    scene.add(waterMesh(polarWaterGeo(ICE.x, ICE.z, iceR, { margin: 0, rings: 8, segs: 48, y: 0.035 }), 'ice', { depth: 0.6, normalTex: TX.waterNormal }));
    features.push({ type: 'water', x: ICE.x, z: ICE.z, w: 26, h: 26, rot: 0, poly: outline(ICE.x, ICE.z, iceR, 32) });
  }
  chest(-268, -160, 20);
  coinLine(-215, -95, -255, -140, 9);

  // ---- 封印的王室地窖(城堡后暗门进入;远处群山下的黑暗迷宫) ----
  // 编年史早说过:"城堡地下有一层是封起来的"。
  const DGN = { x0: 316, z0: -316, w: 72, d: 72 }; // 地窖区域(群山带内,荒野不生成)
  const cryptLights = [];
  {
    // 入口:城堡后的石阶暗门
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), lambert(0x3a3630, { roughness: 1 }));
    hatch.position.set(10, 0.15, -50);
    scene.add(hatch);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 6, 10, Math.PI), lambert(0x55504a));
    arch.position.set(10, 0.3, -51);
    scene.add(arch);
    feat('tower', 10, -50, 3, 3);

    // 地窖地面与外墙
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(DGN.w, DGN.d), lambert(0x2c2823, { roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(DGN.x0 + DGN.w / 2, 0.05, DGN.z0 + DGN.d / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    const wallMat = lambert(0x453f38, { roughness: 1 });
    const dWall = (cx, cz, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, d), wallMat);
      m.position.set(cx, 2.1, cz);
      m.castShadow = true;
      scene.add(m);
      box(cx, cz, w, d);
    };
    const X = DGN.x0, Z = DGN.z0;
    // 外圈
    dWall(X + 36, Z + 1, 72, 2);
    dWall(X + 36, Z + 71, 72, 2);
    dWall(X + 1, Z + 36, 2, 72);
    dWall(X + 71, Z + 36, 2, 72);
    // 迷宫内墙(手排:从入口(X+8,Z+8)绕到圣坛(X+60,Z+60))
    dWall(X + 20, Z + 28, 2, 36);   // 竖墙1(南端 Z+2..Z+10 留门洞)
    dWall(X + 34, Z + 48, 2, 44);   // 竖墙2(上开口)
    dWall(X + 50, Z + 26, 2, 32);   // 竖墙3(南端留门洞)
    dWall(X + 12, Z + 46, 20, 2);   // 横墙A
    dWall(X + 28, Z + 14, 14, 2);   // 横墙B
    dWall(X + 44, Z + 60, 16, 2);   // 横墙C
    dWall(X + 58, Z + 40, 12, 2);   // 横墙D(东端 X+64..X+70 留绕行口)
    dWall(X + 42, Z + 34, 14, 2);   // 横墙E
    // 石棺装饰
    for (const [sx, sz] of [[X + 12, Z + 30], [X + 28, Z + 58], [X + 44, Z + 10], [X + 58, Z + 26]]) {
      const cof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 2.6), lambert(0x5a5248, { roughness: 0.95 }));
      cof.position.set(sx, 0.45, sz);
      cof.castShadow = true;
      scene.add(cof);
      box(sx, sz, 1.4, 2.8);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.15, 2.7), lambert(0x6a6258));
      lid.position.set(sx + 0.3, 0.95, sz);
      lid.rotation.z = 0.12;
      scene.add(lid);
    }
    // 圣坛(先王战徽安放处)+ 出口石阶
    const altar2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x8a7a5a, emissive: 0x664a1a, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 }));
    altar2.position.set(X + 62, 0.55, Z + 64);
    scene.add(altar2);
    box(X + 62, Z + 64, 1.8, 1.3);
    const stair = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), lambert(0x3a3630));
    stair.position.set(X + 8, 0.15, Z + 8);
    scene.add(stair);
    // 地窖火把(自带光源,黑暗中唯一的照明)
    for (const [tx, tz] of [[X + 8, Z + 10], [X + 26, Z + 30], [X + 40, Z + 52], [X + 60, Z + 60], [X + 54, Z + 16]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 5), lambert(0x4a3a28));
      pole.position.set(tx, 0.8, tz);
      scene.add(pole);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0xffb050, emissive: 0xdd6600, emissiveIntensity: 2 }));
      flame.position.set(tx, 1.75, tz);
      scene.add(flame);
      const pl = new THREE.PointLight(0xff9a4d, 2.2, 17, 1.6);
      pl.position.set(tx, 2, tz);
      pl.visible = false; // 入窖才点亮(main 按 inDungeon 开关),免得全场景着色器常年多背 5 盏灯
      scene.add(pl);
      cryptLights.push(pl);
    }
  }

  // 草丛/野花等地表植被由 vegetation.js 围绕玩家流式散布(旧的尖刺草已退役)
  const grassMesh = null;

  // 世界边界:±500000,总幅面 1000000×1000000(核心之外由荒野系统程序化生成)
  box(0, -500020, 1000100, 40); box(0, 500020, 1000100, 40);
  box(-500020, 0, 40, 1000100); box(500020, 0, 40, 1000100);

  return {
    ground, grassMesh, islandAltarMat,
    cryptLights,
    dungeon: { hatch: { x: 10, z: -50 }, inX0: 316, inZ0: -316, inW: 72, inD: 72,
      spawn: { x: 324, z: -308 }, exit: { x: 324, z: -308 }, relic: { x: 378, z: -252 } },
    colliders, features, windmills, torches, chests, qBlocks, runeStrike, animRunes, coinSpots, clouds, waterMats, occluders,
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

// 平面投影 UV(单位:米):按面法线取水平切向 + 沿坡/竖直方向——墙面横平竖直,屋面顺坡;
// rotate=true 时 u/v 互换(横板木墙的木纹顺着板走)
function planarUV(g, rotate = false) {
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let u, v;
    const l = Math.hypot(nx, nz);
    if (l < 0.2) { u = x; v = z; } else {
      const tx = nz / l, tz = -nx / l;
      u = x * tx + z * tz;
      v = x * (ny * tz) + y * (nz * tx - nx * tz) + z * (-ny * tx);
    }
    uv[i * 2] = rotate ? v : u;
    uv[i * 2 + 1] = rotate ? u : v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Blender 建筑模板 → 按材质分件 [{ geo, slot, big }]:按面重算法线(平直着色)+ 平面投影 UV;几何全城共享
function prepParts(node) {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const parts = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(rel);
    g.computeVertexNormals(); // 非索引几何:每个三角形用自己的面法线 → 平直着色
    const slot = (o.material && o.material.name) || 'wood';
    planarUV(g, slot === 'door'); // 门板竖排,其余横排
    g.computeBoundingSphere();
    g.userData.shared = true;
    parts.push({ geo: g, slot, big: ['plaster', 'roof', 'stone', 'plank', 'dstone'].includes(slot) });
  });
  return parts;
}
// house.glb 的三种户型 → { HouseA: parts, ... }
function prepHouseTemplates(root) {
  if (!root) return null;
  const out = {};
  for (const name of ['HouseA', 'HouseB', 'HouseC']) {
    const node = root.getObjectByName(name);
    if (!node) continue;
    const parts = prepParts(node);
    if (parts.length) out[name] = parts;
  }
  return Object.keys(out).length ? out : null;
}

function makeRuneTextures() {
  // 刻槽贴图:纯白底(乘石头顶点色,不改本色)+ 深色刻槽;发光贴图:黑底 + 刻痕里的光(带一圈柔光)
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 128; return c; };
  const base = mk(), glow = mk();
  const g = base.getContext('2d'), e = glow.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) { // 石面细微的麻点
    const l = 215 + rand() * 40;
    g.fillStyle = `rgba(${l},${l},${l - 6},0.5)`;
    g.fillRect(rand() * 128, rand() * 128, 1 + rand() * 2, 1 + rand() * 2);
  }
  e.fillStyle = '#000'; e.fillRect(0, 0, 128, 128);
  const strokes = [[[64, 22], [64, 106]], [[64, 30], [92, 50]], [[92, 50], [64, 66]], [[64, 66], [94, 104]],
    [[38, 40], [54, 30]], [[38, 92], [52, 102]], [[30, 64], [44, 64]]];
  const draw = (ctx, w, style, blur = 0) => {
    ctx.save();
    ctx.strokeStyle = style; ctx.lineWidth = w; ctx.lineCap = 'round';
    if (blur) { ctx.shadowColor = style; ctx.shadowBlur = blur; }
    for (const [[x1, y1], [x2, y2]] of strokes) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.restore();
  };
  draw(g, 10, 'rgba(70,64,56,0.55)'); // 刻槽外沿
  draw(g, 6, 'rgba(40,36,32,0.9)');   // 刻槽
  draw(e, 7, 'rgba(255,255,255,0.35)', 8); // 柔光
  draw(e, 4, '#fff');
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  const glowT = new THREE.CanvasTexture(glow);
  glowT.colorSpace = THREE.SRGBColorSpace;
  return { map, glow: glowT };
}
