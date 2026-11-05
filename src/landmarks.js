// 核心王国的布景(启动装配时撒一次,确定性:每次开局同一片风景):
//  · 群系地标:按群系撒 Blender 地标(露头/台地/玄武柱/冰岩/垂柳/枯树/倒木…),远离道路建筑(压平蒙版≈1 处才放大件)
//  · 树林:按群系权重种树(林海成片、雪原松林、平原丘陵零星)
//  · 路边:城外大路每 ~34 米一盏路灯(左右交替),路口立路牌
// 全部实例化合批(flora.buildNatureInstances),碰撞圆进全局碰撞网格。没有 Blender 资产时什么也不做。
import { colliders, world } from './core/state.js';
import { BIG_PROP, LANDMARKS } from './wilderness.js';
import { NATURE_SPEC, buildNatureInstances, hasNature, specCols } from './flora.js';
import { biomeWeights, dominantBiome, groundH, groundNormalY, maskAt, mountainH, smooth, vegAllowed } from './terrain.js';
import { scene } from './gfx/core.js';
import { waterProx } from './waterbodies.js';

export function scatterCoreLandmarks() {
  if (!hasNature()) return;
  let seed = 0x2f6b9e1d;
  const rng = () => { // mulberry32:确定性,每次开局同一片风景
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list = [];
  const CELL = 22;
  // 每格每种地标的出现率 = 配方期望 × 群系密度:没有树林撑场面的荒漠/灰烬/沼泽/龙骨/雪原多撒几倍
  // (台地、玄武柱、焦木、垂柳、冰岩……),核心区的这些地方不再是一片空地上孤零零一两件
  const DENS = { desert: 0.16, ash: 0.17, swamp: 0.12, rock: 0.12, snow: 0.1, hills: 0.07, forest: 0.05, plains: 0.045 };
  for (let gx = -460; gx < 460; gx += CELL) {
    for (let gz = -460; gz < 460; gz += CELL) {
      const x = gx + rng() * CELL, z = gz + rng() * CELL;
      const biome = dominantBiome(x, z);
      const recipe = LANDMARKS[biome];
      // 北境群山的山体另有布景(脊线岩峰 + 林线以下的雪松):雪原配方的冰岩/岩峰/倒木不往陡坡上撒(撒上去像飘着)
      if (!recipe || mountainH(x, z) > 6) continue;
      for (const [name, expect] of recipe) {
        if (rng() >= expect * (DENS[biome] || 0.045)) continue;
        const big = BIG_PROP[name];
        if (maskAt(x, z) < (big ? 0.8 : 0.45) || !vegAllowed(x, z)) break;
        const spec = NATURE_SPEC[name];
        const sc = (big ? 0.8 + rng() * 0.5 : 1) * (0.85 + rng() * 0.35);
        let h = groundH(x, z);
        const rr = Math.max(0.6, spec.r * sc);
        for (let k = 0; k < 4; k++) h = Math.min(h, groundH(x + Math.cos(k * 1.57) * rr, z + Math.sin(k * 1.57) * rr));
        const yaw = rng() * Math.PI * 2;
        list.push({ name, x, y: h - spec.sink * sc, z, yaw, s: sc });
        for (const c of specCols(spec, sc, yaw)) colliders.circles.push({ x: x + c.dx, z: z + c.dz, r: c.r });
        break; // 一格至多一件
      }
    }
  }
  // 树林:按群系权重种树(林海成片、雪原松林、平原丘陵零星),全部实例化
  {
    const wts = new Float32Array(8);
    const TREE_CELL = 11;
    for (let gx = -455; gx < 455; gx += TREE_CELL) {
      for (let gz = -455; gz < 455; gz += TREE_CELL) {
        const x = gx + rng() * TREE_CELL, z = gz + rng() * TREE_CELL;
        biomeWeights(x, z, wts);
        // 每格种树概率:林海 0.85、雪原(松)0.45、丘陵 0.1、平原 0.06
        const mh0 = mountainH(x, z);
        const belt = smooth(1, 6, mh0) * (1 - smooth(16, 24, mh0)); // 山脚林带:林线以下的雪松林更密
        const pForest = wts[1] * 0.85, pSnow = wts[3] * (0.45 + 0.4 * belt), pOpen = wts[7] * 0.1 + wts[0] * 0.06;
        const roll = rng();
        if (roll > pForest + pSnow + pOpen) continue;
        if (maskAt(x, z) < 0.4 || !vegAllowed(x, z)) continue;
        if (Math.abs(x) < 82 && Math.abs(z) < 68) continue; // 城里不种
        // 林线:北境群山上 25m 以上、坡度超过 30° 不长树,越往上越稀(从城里望北不再是满山漂着的松树)
        if (mh0 > 25 || (mh0 > 1 && (groundNormalY(x, z) < 0.866 || rng() < smooth(12, 25, mh0) * 0.9))) continue;
        const name = roll < pForest ? (rng() < 0.62 ? 'Tree_oak' : rng() < 0.5 ? 'Tree_birch' : 'Tree_pine')
          : roll < pForest + pSnow ? 'Tree_pine' : (rng() < 0.6 ? 'Tree_oak' : 'Tree_birch');
        if (!NATURE_SPEC[name]) continue;
        const sc = 1.0 + rng() * 0.45;
        list.push({ name, x, y: groundH(x, z) - 0.12 * sc, z, yaw: rng() * Math.PI * 2, s: sc });
        colliders.circles.push({ x, z, r: 0.45 * sc });
      }
    }
  }
  // 北境群山的山脊与峰顶:雪顶岩峰(实例化)。只长在真正的脊线(比四周高出 3m 以上,约占高山区的一成多)和峰顶上,
  // 沿脊成串、越高越大、埋得更深——从王都望去是山脊上的岩齿,不是满坡撒着的灰色碎片
  {
    const CRAG = 15;
    for (let gx = -455; gx < 455; gx += CRAG) {
      for (let gz = -470; gz < -170; gz += CRAG) {
        const x = gx + rng() * CRAG, z = gz + rng() * CRAG;
        const mh = mountainH(x, z);
        if (mh < 28 || maskAt(x, z) < 0.9) continue;
        const h = groundH(x, z);
        const ridgeK = h - (groundH(x + 12, z) + groundH(x - 12, z) + groundH(x, z + 12) + groundH(x, z - 12)) / 4; // 高出四周 = 山脊/峰
        const ny = groundNormalY(x, z);
        const p = ridgeK > 6 ? 0.6 : ridgeK > 3 && ny < 0.84 ? 0.3 : 0;
        if (rng() > p) continue;
        const name = rng() < 0.5 ? 'Crag1' : 'Crag2';
        if (!NATURE_SPEC[name]) continue;
        const sc = (1.0 + rng() * 0.8) * (0.9 + smooth(30, 90, mh) * 0.8);
        let hm = h;
        for (let k = 0; k < 4; k++) hm = Math.min(hm, groundH(x + Math.cos(k * 1.57) * 2.2 * sc, z + Math.sin(k * 1.57) * 2.2 * sc));
        const yaw = rng() * Math.PI * 2;
        list.push({ name, x, y: hm - 1.0 * sc, z, yaw, s: sc });
        for (const c of specCols(NATURE_SPEC[name], sc, yaw)) colliders.circles.push({ x: x + c.dx, z: z + c.dz, r: c.r });
      }
    }
  }
  // 城里的绿意:院子与墙根零星的橡树、白桦和灌木丛(避开房屋、街巷、菜园、广场、城堡与两条主街)——
  // 从城墙上、从高处看,城里不再是房子之间一片片空草地
  {
    const rects = world.features.filter((f) => f.type === 'road' || f.type === 'field');
    const inRect = (x, z, pad) => rects.some((f) => {
      const dx = x - f.x, dz = z - f.z, c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
      return Math.abs(dx * s + dz * c) < f.h / 2 + pad && Math.abs(dx * c - dz * s) < f.w / 2 + pad;
    });
    const clear = (x, z, r) => !colliders.boxes.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) &&
      !colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);
    let trees = 0, bushes = 0;
    for (let k = 0; k < 900 && (trees < 14 || bushes < 16); k++) {
      const x = -65 + rng() * 130, z = -51 + rng() * 103;
      const bush = trees >= 14 || rng() < 0.5;
      if (bush ? bushes >= 16 : trees >= 14) continue;
      if (Math.hypot(x, z - 5) < 18 || (z < -20 && Math.abs(x) < 36)) continue; // 广场、城堡
      if (Math.abs(x) < 7 || Math.abs(z) < 6) continue; // 南北、东西两条主街
      if (inRect(x, z, bush ? 1.4 : 2.6) || !clear(x, z, bush ? 1.3 : 2.8)) continue;
      const name = bush ? (rng() < 0.5 ? 'Bush1' : 'Bush2') : rng() < 0.6 ? 'Tree_oak' : 'Tree_birch';
      const spec = NATURE_SPEC[name];
      if (!spec) continue;
      const sc = bush ? 0.6 + rng() * 0.35 : 0.78 + rng() * 0.3;
      list.push({ name, x, y: groundH(x, z) - spec.sink * sc, z, yaw: rng() * Math.PI * 2, s: sc });
      colliders.circles.push({ x, z, r: bush ? 0.5 * sc : 0.45 * sc });
      if (bush) bushes++; else trees++;
    }
  }
  // 雾语沼泽:水塘边与泥滩上的垂柳林,间着泡死的枯树与倒木——远看是一片垂着柳丝的湿林,不是长满高草的田
  {
    const roads = world.features.filter((f) => f.type === 'road');
    const onRoad = (x, z, pad) => roads.some((f) => {
      const dx = x - f.x, dz = z - f.z, c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
      return Math.abs(dx * s + dz * c) < f.h / 2 + pad && Math.abs(dx * c - dz * s) < f.w / 2 + pad;
    });
    const want = { Willow: 24, DeadTree1: 7, DeadTree2: 7, Log: 6 };
    const got = { Willow: 0, DeadTree1: 0, DeadTree2: 0, Log: 0 };
    const kinds = Object.keys(want);
    for (let k = 0; k < 700; k++) {
      const x = -290 + (rng() - 0.5) * 170, z = 240 + (rng() - 0.5) * 170;
      const name = kinds[Math.floor(rng() * kinds.length)];
      if (got[name] >= want[name] || !NATURE_SPEC[name]) continue;
      if (Math.hypot(x + 290, z - 240) > 82 || dominantBiome(x, z) !== 'swamp') continue;
      const wp = waterProx(x, z);
      if (wp > -1.5 || (name === 'Willow' && wp < -16 && rng() < 0.6)) continue; // 不进水;柳树爱挨着水塘
      if (Math.hypot(x + 296, z - 232) < 9 || maskAt(x, z) < 0.45 || !vegAllowed(x, z) || onRoad(x, z, 2.2)) continue;
      if (colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.6)) continue;
      const spec = NATURE_SPEC[name];
      const sc = name === 'Willow' ? 0.85 + rng() * 0.45 : 0.8 + rng() * 0.4;
      const yaw = rng() * Math.PI * 2;
      list.push({ name, x, y: groundH(x, z) - spec.sink * sc, z, yaw, s: sc });
      for (const c of specCols(spec, sc, yaw)) colliders.circles.push({ x: x + c.dx, z: z + c.dz, r: c.r });
      got[name]++;
    }
  }
  // 道路两旁的生活痕迹:城外大路每 ~34 米一盏路灯(左右交替),路口立路牌
  const roadside = (name, x, z, yaw) => {
    const spec = NATURE_SPEC[name];
    list.push({ name, x, y: groundH(x, z) - spec.sink, z, yaw, s: 1 });
    for (const c of specCols(spec, 1, yaw)) colliders.circles.push({ x: x + c.dx, z: z + c.dz, r: c.r });
  };
  let side = 1;
  for (const f of world.features) {
    if (f.type !== 'road' || f.h < 40) continue;
    const dirX = Math.sin(f.rot || 0), dirZ = Math.cos(f.rot || 0); // 道路走向(feat 的 rot 为 atan2(dx,dz))
    const nX = dirZ, nZ = -dirX;
    const n = Math.floor(f.h / 34);
    for (let i = 0; i <= n; i++) {
      const t = -f.h / 2 + (i + 0.5) * (f.h / (n + 1));
      side = -side;
      const x = f.x + dirX * t + nX * side * (f.w / 2 + 1.3), z = f.z + dirZ * t + nZ * side * (f.w / 2 + 1.3);
      if (Math.abs(x) < 84 && Math.abs(z) < 70) continue; // 城里有火把
      if (Math.max(Math.abs(x), Math.abs(z)) > 460) continue;
      roadside('LanternPost', x, z, Math.atan2(side * nZ, -side * nX)); // 灯臂伸向路面
    }
    // 路牌立在路的一端
    const ex = f.x + dirX * f.h / 2 + nX * (f.w / 2 + 1.6), ez = f.z + dirZ * f.h / 2 + nZ * (f.w / 2 + 1.6);
    if (!(Math.abs(ex) < 84 && Math.abs(ez) < 70) && Math.max(Math.abs(ex), Math.abs(ez)) < 460) {
      roadside('Signpost', ex, ez, (f.rot || 0) + Math.PI / 2);
    }
  }
  world.landmarks = buildNatureInstances(list);
  scene.add(world.landmarks);
  colliders.dirty = true;
  console.info('核心地标', list.length, '件');
}
