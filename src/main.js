// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, makeHorse, makeWolf, makeChicken, makeSheep, resolveCollisions, angleLerp, dist2, lambert, setHumanModel, setFaunaModel, setWeaponModels, getWeaponModel, disposeEntityGroup } from './entities.js';
import { INTRO, REGIONS, GUARD_LINES, NPCS, MISSIONS, VILLAGERS, DIALOGS, TIME_GREETINGS, LORE } from './story.js';
import { initAudio, sfx, startMusic, toggleMusic, weatherAudio, setAmbience, setCombatMusic } from './audio.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
import { initWilderness, updateWilderness, wildRegionName, CORE, LANDMARKS, BIG_PROP, setWildViewDistance } from './wilderness.js';
import * as BANKS from './dialogue-banks.js';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { setTreeModel, setBuildingModel, setRockGeos, setNatureModels, hasNature, buildNatureInstances, NATURE_SPEC, specCols, registerNatureTemplate } from './flora.js';
import { MODELS_B64 } from './models-data.js';
import { buildMasks, buildCoreGround, getGroundMaterial, groundH, maskAt, vegAllowed, dominantBiome, biomeWeights } from './terrain.js';
import { initVegetation, updateVegetation, setVegetationSeason, setVegetationDensity } from './vegetation.js';
import { staticBatch } from './batch.js';
import { later, updateTimers, pendingTimers, simNow } from './core/timers.js';
import { hitStop, slowMo, scaleDt } from './core/timefx.js';
import { rand, seed as seedRng } from './core/rng.js';
import { initAmbient, updateAmbient } from './ambient.js';
import { cam, updateCamera } from './systems/camera.js';
import { weather, setWeather, updateWeather, updateRain, spawnDust, updateDust } from './systems/weather.js';
import { clock, sun, lantern, vistaFar, vistaNear, updateDayNight, updateEnvIntensity, fitViewDistance } from './systems/sky.js';
import { mapState, toggleBigMap, drawMinimap } from './ui/maps.js';
import { ctx } from './core/ctx.js';
import { LIGHT_POOL, lightPool, initLightPool, addLightSource, removeLightSource, updateLightPool, pooledMat, releaseMat } from './gfx/pools.js';
import { mergeGeometries } from '../lib/jsm/utils/BufferGeometryUtils.js';
import { renderer, scene, camera, LOWFX, composer, gtao, bloom, gradePass, STYLE_PRESETS, stylePass, smaa, styleKey, applyStyle, cycleStyle } from './gfx/core.js';
import { updateSkinLOD } from './gfx/skin.js';
import { updateNatureLOD } from './flora.js';
import {
  awakenDragon, damageDragon, dragonRT, telegraphArea, updateDragon,
} from './systems/dragon.js';
import {
  prologue, setTutor, skipPrologue, startPrologue, updatePrologue, whistleHorse,
} from './systems/prologue.js';
import {
  DRAGON_SKULL, SKILL_DEFS, SPELLS, addBarricade, arrowBonus, castBigFire, castSpell, cycleSpell,
  doShout, dragonAim, explodeAt, frostPatches, frostSlow, learnShout, learnSpell, meleeBonus, shout,
  skillLv, skillXp, sneakFactor, spellDown, spellUp, spendSta, toggleSneak, updateFrostPatches,
  updateMagic,
} from './systems/magic.js';

// ================= 基础渲染 =================
initLightPool(scene); // 固定数量的点光池(火把/篝火等光源只登记,由它代为发光)


// ================= 世界 =================
// 先加载 AI 素材(assets/ai/ 下的无缝贴图会覆盖程序化贴图)
const aiLoaded = await preloadAIAssets();
if (aiLoaded.length) console.info('AI 贴图已加载:', aiLoaded.join(', '));
// Blender 资产工厂:解析内嵌 GLB 树模板,建世界前注入 flora(失败则静默回退程序化树)
try {
  const gltfLoader = new GLTFLoader();
  const b64buf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  await Promise.all(Object.entries(MODELS_B64).map(([kind, b64]) =>
    new Promise((res) => gltfLoader.parse(b64buf(b64), '', (gltf) => {
      if (kind === 'human') setHumanModel(gltf.scene);
      else if (kind === 'horse' || kind === 'wolf' || kind === 'dragon') setFaunaModel(kind, gltf.scene);
      else if (kind === 'weapons') setWeaponModels(gltf.scene);
      else if (kind === 'props') {
        const st = gltf.scene.getObjectByName('Stall');
        const br = gltf.scene.getObjectByName('Barrel');
        if (st) setBuildingModel('stall', st);
        if (br) setBuildingModel('barrel', br);
      } else if (kind === 'house' || kind === 'keep') setBuildingModel(kind, gltf.scene);
      else if (kind === 'nature' || kind === 'camp') setNatureModels(gltf.scene);
      else if (kind === 'rocks') {
        const geos = [];
        gltf.scene.traverse((o) => { if (o.isMesh) geos.push(o.geometry); });
        setRockGeos(geos);
      } else {
        setTreeModel(kind, gltf.scene);
        if (kind === 'oak' || kind === 'pine' || kind === 'birch') {
          registerNatureTemplate('Tree_' + kind, gltf.scene, { r: 0.45, sink: 0.12 });
        }
      }
      res();
    }, () => res()))));
} catch (e) { console.warn('树模型解析失败,回退程序化树:', e); }
// 本地标题键艺术优先(assets/ai/title.jpg,可选)
let localTitleArt = false;
if (location.protocol !== 'file:') fetch('./assets/ai/title.jpg').then((r) => {
  if (r.ok) r.blob().then((b) => {
    localTitleArt = true;
    const t = document.getElementById('title');
    t.style.backgroundImage =
      `linear-gradient(rgba(10,6,20,0.55), rgba(10,6,20,0.75)), url(${URL.createObjectURL(b)})`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
  });
}).catch(() => {});

const preWorldTops = new Set(scene.children);
const world = buildWorld(scene);
const worldTops = scene.children.filter((o) => !preWorldTops.has(o)); // buildWorld 新建的顶层对象(静态合批候选)
const { colliders } = world;

// ---- 地形:平整蒙版 → 核心王国起伏地表(替换旧的无限平面)----
buildMasks(world);
{
  const oldGround = world.ground;
  const core = buildCoreGround(getGroundMaterial(oldGround.material.normalMap));
  scene.remove(oldGround);
  oldGround.geometry.dispose();
  scene.add(core);
  world.ground = core;
  // 远景垫底:跟着玩家走的平面,填补地平线上尚未加载的荒野区块(压在地形下面)
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshLambertMaterial({ color: 0x7f7c55 }));
  under.rotation.x = -Math.PI / 2;
  under.position.y = -1.2;
  under.userData.noSnap = true;
  scene.add(under);
  world.underlay = under;
}
initVegetation(scene); // 草丛/野花/蕨/芦苇/碎石:围绕玩家流式散布
initAmbient(scene); // 群系环境粒子:雪/沙/余烬/落叶/萤火/花粉
// 核心王国的群系地标:按群系撒 Blender 地标(露头/台地/玄武柱/冰岩/垂柳/枯树/倒木…),
// 远离道路建筑(压平蒙版≈1 处才放大件),实例化合批;碰撞圆进全局碰撞网格
if (hasNature()) {
  let seed = 0x2f6b9e1d;
  const rng = () => { // mulberry32:确定性,每次开局同一片风景
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list = [];
  const CELL = 22;
  for (let gx = -460; gx < 460; gx += CELL) {
    for (let gz = -460; gz < 460; gz += CELL) {
      const x = gx + rng() * CELL, z = gz + rng() * CELL;
      const recipe = LANDMARKS[dominantBiome(x, z)];
      if (!recipe) continue;
      for (const [name, expect] of recipe) {
        if (rng() >= expect * 0.045) continue;
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
        const pForest = wts[1] * 0.85, pSnow = wts[3] * 0.45, pOpen = wts[7] * 0.1 + wts[0] * 0.06;
        const roll = rng();
        if (roll > pForest + pSnow + pOpen) continue;
        if (maskAt(x, z) < 0.4 || !vegAllowed(x, z)) continue;
        if (Math.abs(x) < 82 && Math.abs(z) < 68) continue; // 城里不种
        const name = roll < pForest ? (rng() < 0.62 ? 'Tree_oak' : rng() < 0.5 ? 'Tree_birch' : 'Tree_pine')
          : roll < pForest + pSnow ? 'Tree_pine' : (rng() < 0.6 ? 'Tree_oak' : 'Tree_birch');
        if (!NATURE_SPEC[name]) continue;
        const sc = 1.0 + rng() * 0.45;
        list.push({ name, x, y: groundH(x, z) - 0.12 * sc, z, yaw: rng() * Math.PI * 2, s: sc });
        colliders.circles.push({ x, z, r: 0.45 * sc });
      }
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

// ---- 运行时 AI 贴图生成(玩家浏览器联网时,后台生成照片级贴图并热替换)----
const aiStatusEl = document.getElementById('ai-status');
let titleArtURL = null;
function setTitleArt(bitmap) {
  if (localTitleArt) return;
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  titleArtURL = c.toDataURL('image/jpeg', 0.9);
  const t = document.getElementById('title');
  t.style.backgroundImage =
    `linear-gradient(rgba(10,6,20,0.5), rgba(10,6,20,0.72)), url(${titleArtURL})`;
  t.style.backgroundSize = 'cover';
  t.style.backgroundPosition = 'center';
}
generateRemoteAITextures({
  onStatus(state, done, total) {
    if (!aiStatusEl) return;
    if (state === 'generating') aiStatusEl.textContent = `🎨 AI 高清材质生成中… ${done}/${total}(首次需约 1 分钟,已自动缓存)`;
    else if (state === 'done') aiStatusEl.textContent = `🎨 AI 高清材质已启用(${done}/${total})`;
    else aiStatusEl.textContent = '🎨 离线模式:使用内置程序化材质(联网后自动启用 AI 材质)';
  },
  onTexture(name, canvases) {
    const set = new Set(canvases);
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat.map && set.has(mat.map.image)) mat.map.needsUpdate = true;
        if (mat.normalMap && set.has(mat.normalMap.image)) mat.normalMap.needsUpdate = true;
      }
    });
    if (started) toast(`🎨 AI 材质已应用:${name}`, 1.5);
  },
  onTitle: setTitleArt,
}).catch(() => {});

// ================= HUD 引用 =================
const $ = (id) => document.getElementById(id);
const heartsEl = $('hearts'), coinsEl = $('coins'), wantedEl = $('wanted'),
  missionEl = $('mission'), promptEl = $('prompt'),
  toastEl = $('toast'), flashEl = $('flash'), titleEl = $('title'),
  gameoverEl = $('gameover'), gameoverText = $('gameover-text'),
  lowhpEl = $('lowhp'), weatherEl = $('weather'), equipEl = $('equip'),
  bosshpEl = $('bosshp'), bosshpFillEl = $('bosshp-fill'),
  staminaEl = $('stamina'), staminaFillEl = $('stamina-fill');

// 顶部细条通知:队列化,一次一条,不遮挡视野
let toastTimer = 0; // >0 显示中,<0 淡出间隔
const toastQueue = [];
// 提示分三档:委托(2)> 一般(1)> 氛围(0)。队列里先播高档的,同档先来先播;
// 排太久(>7 秒)的过期作废——过时的提示比没有提示更误导;队列最多 5 条,满了先挤掉低档的旧条。
// 条目:[文字, 时长, 入队时刻(游戏时钟), 插队?, 档位, 标签]
function pushToast(msg, dur, tier, tag) {
  toastQueue.push([msg, Math.min(dur, 4), simNow(), false, tier, tag]);
  while (toastQueue.length > 5) {
    let k = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      if (toastQueue[i][3]) continue;
      if (k < 0 || toastQueue[i][4] < toastQueue[k][4]) k = i;
    }
    toastQueue.splice(k < 0 ? 0 : k, 1);
  }
}
function toast(msg, dur = 2.6) { pushToast(msg, dur, 1, null); }
// 委托类:进度一推进,同一委托的旧提示就作废(dropQuestToasts)
function toastQuest(msg, dur = 3.5) { pushToast(msg, dur, 2, 'quest'); }
// 氛围类(世界的心声、闲笔):有委托在办、或队列已经排着两条以上时,直接不播
function toastAmbient(msg, dur = 3.5) {
  if (quest.active || toastQueue.length >= 2 || prologue.on) return;
  pushToast(msg, dur, 0, 'ambient');
}
function dropQuestToasts() {
  for (let i = toastQueue.length - 1; i >= 0; i--) if (toastQueue[i][5] === 'quest') toastQueue.splice(i, 1);
}
// 插队播报:教学这种时效信息不排队,直接顶到最前并催场
function toastNow(msg, dur = 3) {
  toastQueue.unshift([msg, Math.min(dur, 4), simNow(), true, 3, null]);
  if (toastTimer > 0.4) toastTimer = 0.4; // 正在播的加速谢幕
}
function updateToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) {
      toastEl.style.opacity = 0;
      toastTimer = -0.45;
    }
  } else if (toastTimer < 0) {
    toastTimer = Math.min(0, toastTimer + dt);
  } else if (toastQueue.length) {
    const now = simNow();
    for (let i = toastQueue.length - 1; i >= 0 && toastQueue.length > 1; i--) {
      if (!toastQueue[i][3] && now - toastQueue[i][2] > 7000) toastQueue.splice(i, 1);
    }
    let k = 0; // 档位最高的先播(插队的档位 3)
    for (let i = 1; i < toastQueue.length; i++) if (toastQueue[i][4] > toastQueue[k][4]) k = i;
    const [msg, dur] = toastQueue.splice(k, 1)[0];
    toastEl.textContent = msg;
    toastEl.style.opacity = 1;
    toastTimer = dur;
  }
}

// ================= 玩家 =================
const player = {
  ...makeHumanoid({ shirt: 0x4b5e3c, pants: 0x5a4430, ranger: true, sword: true }), // 游侠:苔绿兜帽 + 短披风
  pos: world.playerSpawn.clone(),
  vy: 0, yaw: 0, onGround: true, jumps: 0,
  hp: 10, maxHp: 10, coins: 0,
  sta: 100, maxSta: 100, gaspT: 0, staggerT: 0, // 体力(骑砍核心):出手/翻滚/格挡皆有代价

  walkT: 0, attackT: 0, invulnT: 0, mounted: null, dead: false, herbs: 0, venison: 0,
  parcel: null, swordLv: 1, royalHorse: false,
  carrying: null, drunkT: 0, hiccupT: 0,
  // 法术:魔光弹与生俱来,R 键即放(法力自然回复)
  mp: 8, maxMp: 8, spells: ['spark'], spellIdx: 0, castT: 0,
  // 技艺熟练度:用什么涨什么(定义见 systems/magic.js 的 SKILL_DEFS)
  skills: Object.fromEntries(Object.keys(SKILL_DEFS).map((k) => [k, { lv: 1, xp: 0 }])),
};
player.group.position.copy(player.pos);
scene.add(player.group);

// ================= 马 =================
const horses = [];
function addHorse(x, z, color, owned) {
  const h = { ...makeHorse(color), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned, stolen: false, state: 'idle', timer: rand() * 4, walkT: 0 };
  h.group.position.copy(h.pos);
  scene.add(h.group);
  horses.push(h);
  return h;
}
addHorse(50, 6, 0x8b5a2b, true);
addHorse(54, 5, 0x4a3a30, true);
addHorse(30, 90, 0xc4a35a, false);
addHorse(-40, 78, 0x9b7653, false);
addHorse(100, -25, 0x6e5240, false);

// ================= 卫兵 / 村民 / 盗贼 =================
const guards = [], villagers = [], bandits = [];

function addGuard(x, z, waypoints, knight = false, extra = false) {
  const g = { ...makeHumanoid({ shirt: knight ? 0x5a1c1c : 0x8f2f35, pants: 0x3a3a44, helmet: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: 3, speed: knight ? 8.3 : 5.2,
    state: 'patrol', waypoints, wp: 0, attackCd: 0, stunT: 0, downT: 0, walkT: 0,
    extra, home: new THREE.Vector3(x, 0, z), wantedHit: false };
  g.group.position.copy(g.pos);
  scene.add(g.group);
  guards.push(g);
  return g;
}
addGuard(10, 2, [[12, 2], [0, 16], [-12, 2], [0, -8]]);
addGuard(-10, 8, [[-12, 2], [0, -8], [12, 2], [0, 16]]);
addGuard(-3, 48, [[-3, 48], [3, 48], [3, 40], [-3, 40]]);
addGuard(3, 44, [[3, 44], [-3, 44]]);
addGuard(64, 3, [[64, 3], [64, -3], [56, 0]]);
addGuard(-6, -28, [[-6, -28], [6, -28]]);
addGuard(6, -30, [[6, -30], [-6, -30], [0, -20]]);
addGuard(-40, 20, [[-40, 20], [-20, 20], [-20, -20], [-40, -20]]);

// 每个村民都是有名有姓、有家有业的人(见 story.js)
const villagerColors = [0x7a5c8f, 0x4a7a9f, 0xa06a3a, 0x5f7a3a, 0x9f4a6a, 0x6a6a7a];
const villagerHair = [0x3a2a1a, 0x6a4a2a, 0x8a3a1a, 0x2a1a10, 0xbababa, 0x1a1a14, 0xd0b040];
VILLAGERS.forEach((id, i) => {
  const v = { ...makeHumanoid({
    shirt: villagerColors[i % villagerColors.length], pants: 0x50412e,
    hair: villagerHair[i % villagerHair.length],
    cap: [2, 6, 7, 13, 15, 17, 19].includes(i),   // 果贩/农夫/农妇/伙计/渔家女/磨坊主/村长:布帽
    hood: [8, 18, 21].includes(i),                 // 猎人/守墓人/采药婆:兜帽
  }),
    id, dbKey: `v${i}`, pos: new THREE.Vector3(id.home[0], 0, id.home[1]), yaw: rand() * 6.28,
    home: new THREE.Vector3(id.home[0], 0, id.home[1]),
    state: 'idle', timer: rand() * 3, walkT: 0, fleeT: 0, downT: 0,
    sleeping: false, lineIdx: Math.floor(rand() * id.lines.length) };
  v.group.position.copy(v.pos);
  scene.add(v.group);
  villagers.push(v);
});

// 盗贼血量:各处按"老数值"传 hp,这里统一 ×1.6(3→5、2→3、8→13):一刀一个的日子过去了
const FOE_HP_MUL = 1.6;
function addBandit(x, z, opts = {}) {
  const hp0 = Math.max(1, Math.round((opts.hp ?? 3) * FOE_HP_MUL));
  const b = { ...makeHumanoid({ shirt: opts.boss ? 0x5a1020 : 0x3b3b46, pants: 0x26262e, hood: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: hp0, maxHp: hp0, speed: opts.speed ?? 5.8,
    state: 'patrol', home: new THREE.Vector3(x, 0, z), attackCd: 0, stunT: 0, walkT: 0, dead: false,
    boss: !!opts.boss, escort: !!opts.escort, dmg: opts.dmg ?? 2 };
  if (opts.scale) b.group.scale.setScalar(opts.scale);
  b.group.position.copy(b.pos);
  scene.add(b.group);
  bandits.push(b);
  return b;
}

// ================= 狼群 =================
const wolves = [];
// ================= 内容自进化:传说 × 生态 × 导演 =================
// 游戏内容自己长:你的事迹像谣言一样代代变异(文化演化);狼群在猎杀压力下
// 一代比一代精(生态演化);事件导演按你真正参与过什么自然选择戏码(排片演化)。
// 全部随存档持久化——这个世界离开你也在长,回来时已不是你走时的样子。
const EVO = {
  legends: [],                 // 传说基因池:{src, base, extra, gen, heat}
  wolfGen: 1, wolfPressure: 0, wolfSpeed: 0, // 狼群世代/猎杀压力/累计提速
  eventFit: {},                // 导演事件适应度:参与 +1,冷场 -0.3
  tactics: { block: 0, dodge: 0 }, // 敌人战术演化:被砍多了学格挡,被射多了学闪身
  kills: { melee: 0, arrow: 0 },   // 当日击杀方式统计(选择压力的原料)
  corpus: [],                  // 活语料:世界自己写的新台词,永久入库(上限 40)
};
const vendetta = { stage: 0, boss: null }; // 黑石的报复:0 无仇 → 1 记仇 → 2 伏击上膛 → 3 两清
const LEGEND_EMBELLISH = ['——亲眼所见的人都这么说', ',连卫兵都点了头', ',那天风都停了半刻',
  ',据说月亮探出头看了一眼', ',酒馆里为这个干了三杯', ',吟游诗人已经在编曲子了'];
const LEGEND_SWAPS = [['独自', '单枪匹马'], ['赢了', '不费吹灰之力赢了'], ['救回', '徒手救回'],
  ['击退', '一声吼就击退'], ['缉拿', '谈笑间缉拿'], ['钓上', '赤手抓上'], ['买下', '一掷千金买下'],
  ['猎到', '闭着眼猎到'], ['撂倒', '用小拇指撂倒'], ['掰手腕', '隔着桌子掰手腕']];
function legendText(l) { return l.base + (l.extra || ''); }
function seedLegend() {
  const cands = chronicle.filter((m) => !m.t.startsWith('它') && !EVO.legends.some((L) => L.src === m.t));
  if (!cands.length) return;
  const m = cands[Math.floor(rand() * cands.length)];
  EVO.legends.push({ src: m.t, base: `绿衣游侠${m.t}`, extra: '', gen: 1, heat: 1 });
  if (EVO.legends.length > 10) { // 选择:热度垫底的传说被人遗忘
    EVO.legends.sort((a, b) => b.heat - a.heat);
    EVO.legends.length = 10;
  }
}
function mutateLegend(l) {
  l.gen++;
  l.base = l.base.replace(/\d+/g, (n) => String(Math.min(999, Math.ceil(+n * (1.4 + rand()))))); // 数字越传越大
  const sw = LEGEND_SWAPS[Math.floor(rand() * LEGEND_SWAPS.length)];
  if (l.base.includes(sw[0]) && !l.base.includes(sw[1])) l.base = l.base.replace(sw[0], sw[1]);
  l.extra = LEGEND_EMBELLISH[Math.floor(rand() * LEGEND_EMBELLISH.length)];
  if (!AI_TEXT_OFF && rand() < 0.5) { // 联网时让 AI 来当"以讹传讹"的那张嘴
    aiLine(`把这句关于绿衣游侠林恩的传闻再夸张一点点,像民间以讹传讹又传了一代:「${l.base}」。25字以内,只输出新传闻本身。`, null, 7000)
      .then((t) => { if (t && t.length < 60) l.base = t.replace(/[「」"']/g, ''); });
  }
}
function evolveLegends() { // 每过一夜,总有一条传闻长出新的枝节
  if (EVO.legends.length < 3) seedLegend();
  if (!EVO.legends.length) return;
  mutateLegend(EVO.legends[Math.floor(rand() * EVO.legends.length)]);
}
// 敌人战术演化:匪帮复盘自己怎么死的,学出针对性的反制(智能自进化)
function evolveTactics() {
  const { melee, arrow } = EVO.kills;
  const total = melee + arrow;
  if (total >= 3) {
    const b0 = EVO.tactics.block, d0 = EVO.tactics.dodge;
    EVO.tactics.block = Math.min(0.6, EVO.tactics.block + 0.1 * (melee / total));
    EVO.tactics.dodge = Math.min(0.6, EVO.tactics.dodge + 0.1 * (arrow / total));
    if (b0 < 0.25 && EVO.tactics.block >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始格挡刀剑!(重击和跳劈可以破防)', 5);
      remember('盗贼们学会了格挡,和从前不一样了');
    }
    if (d0 < 0.25 && EVO.tactics.dodge >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始侧身闪箭!(贴近了射,或换法术)', 5);
      remember('盗贼们学会了闪箭,和从前不一样了');
    }
  } else {
    EVO.tactics.block = Math.max(0, EVO.tactics.block - 0.02); // 没人打他们,手艺也会生疏
    EVO.tactics.dodge = Math.max(0, EVO.tactics.dodge - 0.02);
  }
  EVO.kills = { melee: 0, arrow: 0 };
}
// 语料自生长:世界每天给自己写一句新传闻,写进永久语料库(联网 AI 执笔;离线拼接变异)
function growCorpus() {
  const push = (t) => {
    if (!t || t.length < 6 || t.length > 60 || EVO.corpus.includes(t)) return;
    EVO.corpus.push(t);
    if (EVO.corpus.length > 40) EVO.corpus.shift();
  };
  if (!AI_TEXT_OFF) {
    const sp = todaySpecial();
    aiLine(
      `你是中世纪王国艾尔德里亚的市井谣言本身。现在是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
      `${sp ? '·' + sp.name : ''}。${wsReport().slice(0, 60)}` +
      `写一条25字以内全新的市井传闻(不要提绿衣游侠),要有画面感。只输出传闻本身。`, null, 8000,
    ).then((t) => { if (t) { push(t.replace(/[「」"']/g, '')); saveGame(); } });
  } else {
    // 离线:从写好的传闻里挑一整条流传开(以前把两句剪开重新缝,缝出来的多是病句)
    push(BANKS.RUMORS[Math.floor(rand() * BANKS.RUMORS.length)]);
  }
}

let wolfKills = 0;
function addWolf(x, z) {
  const w = { ...makeWolf(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), hp: EVO.wolfGen >= 3 ? 4 : 3, speed: 7.2 + EVO.wolfSpeed,
    attackCd: 0, stunT: 0, walkT: 0, dead: false, respawnT: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  wolves.push(w);
  return w;
}
for (const [wx, wz] of world.wolfSpawns) addWolf(wx, wz);

// ---- 无尽荒野接入:狼群/野马/野羊/匪帮/掉落由主系统托管 ----
initWilderness(scene, colliders, {
  spawnWolf(x, z, chunkKey) {
    if (wolves.filter((w) => !w.dead).length > 42) return null;
    const w = addWolf(x, z);
    w.chunk = chunkKey;
    return w;
  },
  spawnHorse(x, z, chunkKey) {
    if (horses.filter((h) => h.chunk && !h.sheep).length > 8) return null;
    const wildColors = [0x8b5a2b, 0x4a3a30, 0xc4a35a, 0x9b7653, 0x6e5240, 0x3a3a3a];
    const h = addHorse(x, z, wildColors[Math.floor(rand() * wildColors.length)], false);
    h.chunk = chunkKey;
    return h;
  },
  spawnSheep(x, z, chunkKey) {
    if (horses.filter((h) => h.chunk && h.sheep).length > 10) return null;
    const s = addSheep(x, z);
    s.chunk = chunkKey;
    return s;
  },
  spawnBandit(x, z, chunkKey) {
    if (bandits.filter((b) => b.chunk && !b.dead).length > 10) return null;
    const b = addBandit(x, z, { hp: 3 });
    b.ambient = true; // 不计入主线任务,死后在窝点重生
    b.chunk = chunkKey;
    return b;
  },
  dropCoin(x, z, chunkKey) {
    addPickup('coin', x, z, 600, -1, chunkKey);
  },
  dropHeart(x, z, chunkKey) {
    addPickup('heart', x, z, 600, -1, chunkKey);
  },
  registerSpot(type, x, z, chunkKey) {
    wildSpots.push({ type, x, z, chunk: chunkKey });
  },
  removeChunkEntities(chunkKey) {
    for (let i = wildSpots.length - 1; i >= 0; i--) {
      if (wildSpots[i].chunk === chunkKey) wildSpots.splice(i, 1);
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      if (pickups[i].chunk === chunkKey) {
        scene.remove(pickups[i].mesh);
        pickups.splice(i, 1);
      }
    }
    for (let i = wolves.length - 1; i >= 0; i--) {
      if (wolves[i].chunk === chunkKey) {
        scene.remove(wolves[i].group);
        disposeEntityGroup(wolves[i].group);
        flashing.delete(wolves[i]);
        wolves.splice(i, 1);
      }
    }
    for (let i = bandits.length - 1; i >= 0; i--) {
      if (bandits[i].chunk === chunkKey) {
        scene.remove(bandits[i].group);
        disposeEntityGroup(bandits[i].group);
        flashing.delete(bandits[i]);
        bandits.splice(i, 1);
      }
    }
    for (let i = horses.length - 1; i >= 0; i--) {
      const h = horses[i];
      if (h.chunk !== chunkKey) continue;
      if (h === player.mounted) { h.chunk = null; continue; } // 骑走的坐骑归玩家
      scene.remove(h.group);
      disposeEntityGroup(h.group);
      horses.splice(i, 1);
    }
  },
});

// 序章:狼这一口落空、而你刚翻滚过(1 秒内)= 真的用翻滚躲开了
function noteDodge(w) {
  if (!prologue.on || !w._prol || prologue.step !== 2) return;
  if (simNow() - (player.lastRollAt ?? -1e9) < 1000) prologue.flags.rolled = true;
}
function updateWolves(dt) {
  // 狼月之夜:入夜后狼群更快更狠
  const wolfBuff = todaySpecial()?.key === 'wolfmoon' && dayPhase() === 'night' ? 1.3 : 1;
  for (const w of wolves) {
    if (w.dead) {
      w.respawnT -= dt;
      if (w.respawnT <= 0) {
        w.dead = false;
        w.hp = EVO.wolfGen >= 3 ? 4 : 3; // 演化到第三代,狼更扛揍
        w.speed = 7.2 + EVO.wolfSpeed;   // "下一代"继承演化出的速度
        w.pos.copy(w.home);
        w.group.rotation.x = 0;
        w.group.visible = true;
        w.lunging = 0; // 死在半空的扑咬姿势不带进下一条命
        w.lungeHit = false;
        w.stunT = 0;
        w.group.scale.y = 1;
      }
      continue;
    }
    if (!w.raidTarget && !w.arena && entFar(w)) {
      // 远处休眠:别把扑咬姿势冻在半空
      if (w.lunging > 0) { w.lunging = 0; w.group.scale.y = 1; }
      continue;
    }
    if (w.stunT > 0) { w.stunT -= dt; continue; }
    if (w._hold) { // 序章:在场边候着,盯着你看
      w.yaw = angleLerp(w.yaw, Math.atan2(player.pos.x - w.pos.x, player.pos.z - w.pos.z), dt * 4);
      w.group.rotation.y = w.yaw;
      w.group.position.copy(w.pos);
      continue;
    }
    if (w.armorT > 0) w.armorT -= dt;
    if (w.hitStunT > 0) { // 挨了一刀:缩一下,扑咬/撕咬都被打断
      w.hitStunT -= dt;
      w.lunging = 0;
      w.group.scale.y = 0.85;
      if (w.hitStunT <= 0) w.group.scale.y = 1;
      w.group.position.copy(w.pos);
      continue;
    }
    w.attackCd = Math.max(0, w.attackCd - dt);
    w.lungeCd = Math.max(0, (w.lungeCd || 0) - dt);
    // 贴身撕咬:先龇牙压低 0.5 秒(脚下亮红圈),咬下去时人还在嘴边才算
    if (w.biteT > 0) {
      w.biteT -= dt;
      w.group.scale.y = 0.88;
      // 龇牙时扭头追你(≤4 rad/s),最后 0.15 秒咬定方向——闪到侧后就咬空
      if (w.biteT > 0.15) w.yaw = turnToward(w.yaw, Math.atan2(player.pos.x - w.pos.x, player.pos.z - w.pos.z), 4 * dt);
      w.group.rotation.y = w.yaw;
      w.group.position.copy(w.pos);
      if (w.biteT <= 0) {
        w.group.scale.y = 1;
        const inArc = inFrontArc(w, player.pos, 1.7, 2.2);
        if (inArc && !(player.invulnT > 0)) damagePlayer(wolfBuff > 1 ? 2 : 1, w);
        else noteDodge(w);
      }
      continue;
    }
    if (w._trampleCd > 0) w._trampleCd -= dt;
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    // 扑咬:蹲伏蓄力 0.3s → 猛扑
    if (w.lunging > 0) {
      w.lunging -= dt;
      if (w.lunging > 0.28) {
        w.group.scale.y = 0.75; // 蹲伏(0.5 秒,看得见)
      } else {
        w.group.scale.y = 1;
        w.pos.x += w.lungeX * 15 * dt;
        w.pos.z += w.lungeZ * 15 * dt;
        resolveCollisions(w.pos, 0.4, colliders);
        if (!w.lungeHit && Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z) < 1.2) {
          w.lungeHit = true;
          if (player.invulnT > 0 && player.rollT > 0) noteDodge(w); // 翻滚的无敌帧里穿身而过
          else damagePlayer(wolfBuff > 1 ? 2 : 1, w);
        }
      }
      if (w.lunging <= 0) {
        w.group.scale.y = 1;
        if (!w.lungeHit) noteDodge(w); // 扑空了
      }
      w.group.position.copy(w.pos);
      continue;
    }
    // 事件:袭击居民的狼优先咬村民
    if (w.raidTarget && w.raidTarget.downT <= 0 && pd > 9) {
      const v = w.raidTarget;
      const vd = Math.hypot(v.pos.x - w.pos.x, v.pos.z - w.pos.z);
      if (vd > 1.2) { moveEntity(w, v.pos.x, v.pos.z, w.speed, dt); moving = true; }
      else if (w.attackCd <= 0) {
        w.attackCd = 1.4;
        v.downT = 6;
        v.group.rotation.x = -Math.PI / 2;
        sfx.hit();
        w.raidTarget = villagers.find((x) => !x.sleeping && x.downT <= 0 &&
          dist2(w.pos.x, w.pos.z, x.pos.x, x.pos.z) < 900) || null;
      }
      w.group.position.copy(w.pos);
      w.group.rotation.y = w.yaw;
      const sw2 = moving ? Math.sin(w.walkT) * 0.6 : 0;
      w.parts.legs[0].rotation.x = sw2;
      w.parts.legs[1].rotation.x = -sw2;
      w.parts.legs[2].rotation.x = -sw2;
      w.parts.legs[3].rotation.x = sw2;
      continue;
    }
    if (pd < 20 * sneakFactor() && !player.dead) {
      if (pd < 6 && pd > 1.6 && w.lungeCd <= 0) {
        // 起跳预警
        w.lunging = 0.78;
        w.lungeCd = 2.6;
        w.lungeHit = false;
        const ld = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z) || 1;
        w.lungeX = (player.pos.x - w.pos.x) / ld;
        w.lungeZ = (player.pos.z - w.pos.z) / ld;
        w.yaw = Math.atan2(w.lungeX, w.lungeZ);
        w.group.rotation.y = w.yaw;
        telegraphFlash(w, 0.5, false, Math.min(5.2, pd + 1.2), 0.55); // 扑咬:窄长的一条,横跨一步就躲开
        continue;
      }
      if (pd > 1.3) { moveEntity(w, player.pos.x, player.pos.z, w.speed * wolfBuff, dt); moving = true; }
      else if (w.attackCd <= 0) { w.attackCd = 1.4; w.biteT = 0.5; telegraphFlash(w, 0.5, false, 1.7, 2.2); }
    } else {
      const a = performance.now() * 0.0004 + w.home.x;
      moveEntity(w, w.home.x + Math.cos(a) * 6, w.home.z + Math.sin(a) * 6, w.speed * 0.25, dt);
      moving = true;
    }
    w.group.position.copy(w.pos);
    w.group.rotation.y = w.yaw;
    const swing = moving ? Math.sin(w.walkT) * 0.6 : 0;
    w.parts.legs[0].rotation.x = swing;
    w.parts.legs[1].rotation.x = -swing;
    w.parts.legs[2].rotation.x = -swing;
    w.parts.legs[3].rotation.x = swing;
  }
}

function killWolf(w, opts = {}) {
  w.dead = true;
  w.respawnT = (w.arena || w._prol) ? 99999 : (todaySpecial()?.key === 'wolfmoon' ? 22 : 45);
  startFall(w);
  if (!opts.env) registerKill(); // 环境击杀(龙息等)不进玩家连杀
  later(2.5, () => { if (w.dead) w.group.visible = false; });
  dropCoins(w.pos, 2);
  wolfKills++;
  EVO.wolfPressure++; // 猎杀压力:选择的原料
  choreProgress('wolves');
  // 竞技场里的狼不算狼灾任务(和盗贼任务的排除规则对齐)
  if (!w.arena && quest.active && missions[quest.idx].type === 'wolves') {
    quest.progress++;
    toast(`猎杀恶狼 ${quest.progress}/${missions[quest.idx].goal}`, 2);
    if (quest.progress >= missions[quest.idx].goal) completeMission();
  }
}

// ================= 武器与护甲系统 =================
const WEAPONS = {
  // staMul=重量:同一招巨剑更费体力、短匕最省——省下的气就是你的走位(骑砍的取舍)
  sword:      { name: '铁剑', icon: '🗡️', dmg: 1, range: 2.4, cd: 0.28, knock: 0.55, price: 0, staMul: 1 },
  dagger:     { name: '短匕', icon: '🔪', dmg: 1, range: 2.0, cd: 0.16, knock: 0.3, price: 30, staMul: 0.65 },
  greatsword: { name: '巨剑', icon: '⚔️', dmg: 3, range: 2.9, cd: 0.7, knock: 1.3, price: 90, staMul: 1.5 },
  bow:        { name: '猎弓', icon: '🏹', dmg: 2, range: 0, cd: 0.8, knock: 0.4, price: 60, staMul: 1 },
  warblade:   { name: '枭首之刃', icon: '⚜️', dmg: 2, range: 2.5, cd: 0.24, knock: 0.7, staMul: 0.9 }, // 无价:单挑斩将夺来
};
const ARMORS = [
  { name: '', bonus: 0 },
  { name: '皮甲', bonus: 2, price: 40, color: 0x7a5230 },
  { name: '板甲', bonus: 4, price: 120, color: 0x9aa4ad },
];
player.weapon = 'sword';
player.weaponsOwned = ['sword'];

// ================= 佣兵(骑砍式:旅店雇剑士随行,按日发饷) =================
const mercs = [];
const MERC_NAMES = ['石手雷戈', '断鼻威尔', '老兵科尔', '快腿芬恩'];
function hireMerc() {
  if (mercs.length >= 2) {
    openDialog(['佣兵队长布兰:(摊手)我手下能打的都跟你走了。两个还不够?你是要去屠城吗?']);
    return;
  }
  if (player.coins < 40) {
    openDialog(['佣兵队长布兰:一名剑士 40 金币,外加每天 5 金币饷钱。买卖归买卖——赊账免谈。']);
    return;
  }
  player.coins -= 40;
  const name = MERC_NAMES[Math.floor(rand() * MERC_NAMES.length)];
  const m = { ...makeHumanoid({ shirt: 0x555b66, pants: 0x33363c, helmet: true, sword: true }),
    pos: new THREE.Vector3(player.pos.x + 1.5, 0, player.pos.z + 1.5),
    yaw: 0, walkT: 0, hp: 8, attackCd: 0, swingT: 0, name };
  m.group.position.copy(m.pos);
  scene.add(m.group);
  mercs.push(m);
  sfx.accept();
  stats.mercsHired = (stats.mercsHired || 0) + 1;
  remember(`在旅店雇下了佣兵${name}`, `merc-${calendar.day}`);
  openDialog([`佣兵队长布兰:${name}!收拾家伙,跟这位老板走。`, `${name}:(抱拳)雇主,刀锋朝哪边?`]);
  saveGame();
}
function updateMercs(dt) {
  for (const m of mercs) {
    m.attackCd = Math.max(0, m.attackCd - dt);
    // 找最近的活敌(盗贼/恶狼)
    let target = null, td = 196; // 14^2
    for (const list of [bandits, wolves]) {
      for (const e of list) {
        if (e.dead || e.downT > 0) continue;
        const d2v = dist2(m.pos.x, m.pos.z, e.pos.x, e.pos.z);
        if (d2v < td) { td = d2v; target = e; }
      }
    }
    let moving = false;
    if (target) {
      const d = Math.sqrt(td);
      if (d > 1.7) { moveEntity(m, target.pos.x, target.pos.z, 6.4, dt); moving = true; }
      else if (m.attackCd <= 0) {
        m.attackCd = 1.0;
        m.swingT = 0.32;
        sfx.sword();
        const dmg = m.veteran ? 2 : 1;
        if (applyDamage(target, dmg, { source: 'companion', knock: 0.5, credit: '佣兵助攻' })) {
          m.kills = (m.kills || 0) + 1;
          if (m.kills >= 5 && !m.veteran) { // 五个人头,升老兵:更能打、更扛揍
            m.veteran = true;
            m.hp += 4;
            m.name = `老兵·${m.name}`;
            sfx.fanfare();
            toast(`🪖 ${m.name}身经百战,晋升老兵!(伤害翻倍)`, 3.5);
            remember(`佣兵${m.name}在你麾下打成了老兵`);
          }
        }
      }
    } else {
      const pd = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
      if (pd > 3.4) { moveEntity(m, player.pos.x, player.pos.z, pd > 14 ? 9 : 6, dt); moving = true; }
    }
    m.group.position.copy(m.pos);
    m.group.rotation.y = m.yaw;
    m.parts._attackAnim = (m.swingT || 0) > 0;
    animateLimbs(m.parts, m.walkT, moving, m.group, 0.9);
    if (m.swingT > 0) { m.swingT -= dt; meleeSwing(m.parts, Math.min(1, 1 - m.swingT / 0.32)); }
  }
}
function hireMercSilent() { // 读档时无声归队
  const name = MERC_NAMES[mercs.length % MERC_NAMES.length];
  const m = { ...makeHumanoid({ shirt: 0x555b66, pants: 0x33363c, helmet: true, sword: true }),
    pos: new THREE.Vector3(world.playerSpawn.x + 2 + mercs.length, 0, world.playerSpawn.z + 2),
    yaw: 0, walkT: 0, hp: 8, attackCd: 0, swingT: 0, name };
  m.group.position.copy(m.pos);
  scene.add(m.group);
  mercs.push(m);
}
function payMercs() { // 每日饷钱:发不出就散伙
  if (!mercs.length) return;
  const wage = mercs.length * 5;
  if (player.coins >= wage) {
    player.coins -= wage;
    toast(`💰 发放佣兵饷钱 ${wage} 金币(${mercs.map((m) => m.name).join('、')})`, 3);
  } else {
    for (const m of mercs) retireEntity(m);
    toast(`💸 发不出饷钱,佣兵${mercs.map((m) => m.name).join('、')}卷铺盖走了。`, 4);
    mercs.length = 0;
  }
}
player.armor = 0;
player.blocking = false;
player.rollT = 0;
player.rollCd = 0;
player.rollDir = new THREE.Vector2(0, 1);

// 手中武器外观
let _warBladeMat = null;
let _goldBladeMat = null;
function setWeaponVisual(type) {
  const armR = player.parts.armR;
  if (player.weaponGroup) armR.remove(player.weaponGroup);
  if (player.bowGroup) { player.parts.armL.remove(player.bowGroup); player.bowGroup = null; }
  // Blender 武器模板:血槽刃/缠柄/铁护手;淬火后刃身换金
  {
    const name = { dagger: 'Dagger', greatsword: 'Greatsword', bow: 'Bow', sword: 'Sword' }[type] || 'Sword';
    const real = getWeaponModel(name);
    if (real) {
      if (type === 'warblade') { // 枭首之刃:暗红刃身,一眼认出
        if (!_warBladeMat) _warBladeMat = lambert(0x8a2430, { metalness: 0.8, roughness: 0.3 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _warBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      } else if (player.swordLv >= 2 && type !== 'bow') {
        if (!_goldBladeMat) _goldBladeMat = lambert(0xe8c34a, { metalness: 0.85, roughness: 0.25 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _goldBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      }
      if (type === 'bow') {
        real.position.set(0, -0.42, 0.06);
        player.parts.armL.add(real);
        player.bowGroup = real;
        player.weaponGroup = null;
        return;
      }
      const g2 = new THREE.Group();
      g2.add(real);
      g2.position.y = -0.4;
      armR.add(g2);
      player.weaponGroup = g2;
      return;
    }
  }
  const g = new THREE.Group();
  const steel = lambert(player.swordLv >= 2 ? 0xe8c34a : 0xd8dde2,
    { metalness: 0.85, roughness: 0.25 });
  if (type === 'dagger') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), steel);
    blade.position.y = -0.46;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), lambert(0x6b4a2f));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'greatsword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.15, 0.035), steel);
    blade.position.y = -0.82;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), lambert(0x8a6a20, { metalness: 0.6, roughness: 0.35 }));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'bow') {
    // 弓持在左手
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 14, Math.PI), lambert(0x6b4a2f, { roughness: 0.8 }));
    arc.rotation.z = Math.PI / 2;
    bow.add(arc);
    const stringMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.84, 0.012), lambert(0xd8d0c0));
    bow.add(stringMesh);
    bow.position.set(0, -0.42, 0.06);
    player.parts.armL.add(bow);
    player.bowGroup = bow;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.03), steel);
    blade.position.y = -0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), lambert(0xc9a227));
    guard.position.y = -0.26;
    g.add(blade, guard);
  }
  g.position.y = -0.2;
  armR.add(g);
  player.weaponGroup = g;
  if (player.parts.sword) player.parts.sword.visible = false; // 隐藏初始剑模型
}
function setArmorVisual(level) {
  if (player.armorMesh) { player.group.remove(player.armorMesh); player.armorMesh = null; }
  if (level <= 0) return;
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.285, 0.5, 10),
    lambert(ARMORS[level].color, { metalness: level === 2 ? 0.7 : 0.1, roughness: level === 2 ? 0.35 : 0.8 }));
  vest.position.y = 0.8;
  player.group.add(vest);
  player.armorMesh = vest;
}
// 生命上限只在这里计算:护甲 + 湖神恩赐 + 屠龙者,读档/买甲/奇遇都走这一处
function recomputeMaxHp() {
  player.maxHp = 10 + ((ARMORS[player.armor] && ARMORS[player.armor].bonus) || 0) +
    (lakeBlessed ? 2 : 0) + (stats.dragonSlain ? 2 : 0);
  player.hp = Math.min(player.hp, player.maxHp);
  return player.maxHp;
}
function applyArmor(level) {
  player.armor = level;
  recomputeMaxHp();
  player.hp = Math.min(player.hp + ARMORS[level].bonus, player.maxHp);
  setArmorVisual(level);
}
function cycleWeapon() {
  if (player.mounted || player.carrying) return;
  if (player.weaponsOwned.length < 2) { callout('只有一把武器(铁匠铺能买短匕/巨剑/猎弓)', 'dim'); return; }
  const i = player.weaponsOwned.indexOf(player.weapon);
  player.weapon = player.weaponsOwned[(i + 1) % player.weaponsOwned.length];
  setWeaponVisual(player.weapon);
  sfx.equip();
  toast(`${WEAPONS[player.weapon].icon} 已装备:${WEAPONS[player.weapon].name}`, 1.5);
}

// ---- 箭矢 ----
const arrows = [];
const arrowGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.55, 4);
arrowGeo.rotateX(Math.PI / 2);
const arrowMat = lambert(0x8a6a45, { roughness: 0.8 });
function pointBlocked(x, z) {
  for (const b of colliders.boxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  for (const cc of colliders.circles) {
    const dx = x - cc.x, dz = z - cc.z;
    if (dx * dx + dz * dz < cc.r * cc.r) return true;
  }
  return false;
}
// 雨天湿弦:箭路发飘(暴雨更甚);提示节流,别刷屏
let wetToastT = 0;
function wetSpread(mul = 1) {
  const wet = weather.state === 'storm' ? 0.11 : weather.state === 'rain' ? 0.055 : 0;
  if (!wet) return 0;
  if (performance.now() - wetToastT > 12000) {
    wetToastT = performance.now();
    toast('🌧️ 雨水打湿了弓弦,箭路发飘……', 2);
  }
  return (rand() - 0.5) * 2 * wet * mul;
}
function shootArrow() {
  // 弓术 5 级专属:一弓双箭(小角度散射)
  const shots = skillLv('archery') >= 5 ? [0, 0.09] : [0];
  for (const off of shots) {
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    const jit = off + wetSpread();
    const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.06, Math.cos(player.yaw + jit)).normalize();
    const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
    mesh.position.copy(pos);
    scene.add(mesh);
    arrows.push({ mesh, pos, vel: (off === 0 && dragonAim(pos, 30)) || dir.multiplyScalar(26), ttl: 3, stuck: false });
  }
  sfx.arrow();
}
function arrowHitEntities(a) {
  const dmg = a.dmg || arrowBonus(WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0));
  const tryHit = (list, onHit) => {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      if (a._hits && a._hits.includes(e)) continue; // 贯穿箭:一箭对同一目标只算一次
      const dy = a.pos.y - 0.9;
      if (dy > 1.4 || dy < -0.9) continue;
      if (dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 0.8) {
        if (a._hits) a._hits.push(e);
        onHit(e);
        return true;
      }
    }
    return false;
  };
  if (tryHit(guards, (g) => {
    sfx.hit();
    if (!applyDamage(g, dmg, { knock: 0.4, crit: false, crimeMsg: '你放箭射击卫兵!' })) g.state = 'chase';
  })) return true;
  if (tryHit(bandits, (b) => {
    // 战术演化:被射多了的匪帮学会侧身闪箭(贴脸射/法术/飞刀不受影响)
    if (!a.mag && !a.knife && rand() < EVO.tactics.dodge * 0.45) {
      showDamage(b.pos, 0);
      hitFX(b, 0.15);
      return;
    }
    sfx.hit();
    if (applyDamage(b, dmg, { knock: 0.4, crit: false })) EVO.kills.arrow++;
    else flinch(b, false); // 箭/法弹也能打断起手
  })) return true;
  if (tryHit(wolves, (w) => {
    sfx.hit();
    if (!applyDamage(w, dmg, { knock: 0.4, crit: false })) flinch(w, false);
  })) return true;
  if (tryHit(deers, (d) => {
    sfx.hit();
    killDeer(d);
  })) return true;
  for (const c of chickens) {
    if (c === player.carrying || c.state === 'thrown') continue;
    if (dist2(a.pos.x, a.pos.z, c.pos.x, c.pos.z) < 0.5 && a.pos.y < 1) { pokeChicken(c); return true; }
  }
  return false;
}
// 投射物下场:法术弹/飞刀是每发独立 geometry+material,必须 dispose,否则连发就是显存漏斗
function disposeArrow(a) {
  scene.remove(a.mesh);
  if (a.mag || a.fire || a.big || a.knife) {
    a.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.ttl -= dt;
    if (a.ttl <= 0) { disposeArrow(a); arrows.splice(i, 1); continue; }
    if (a.stuck) continue;
    if (!a.fire && !a.mag && !a.vel.aimed) a.vel.y -= 7 * dt; // 火球/魔光弹/对空箭直线飞行,不吃重力
    // 子步进:快箭(满月 42/秒)在低帧率下一帧能跨 2 个身位,不切细会从判定圈中间穿过去
    const stepN = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.6));
    let removed = false;
    for (let s = 0; s < stepN && !removed; s++) {
      a.pos.addScaledVector(a.vel, dt / stepN);
      if (a.fire) {
        // 火球:贴近任何敌人 / 落地 / 撞墙 / 燃尽 → 爆炸
        const near = (list) => list.some((e) => !e.dead && !(e.downT > 0) &&
          dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 1.6);
        if (dragonRT.on && dragonRT.hp > 0) { // 火球打龙:三维近身即炸
          const gp = dragonRT.ent.group.position;
          if (Math.abs(a.pos.y - gp.y - 1.6) < 3 && dist2(a.pos.x, a.pos.z, gp.x, gp.z) < 3.2 * 3.2) {
            magBurst(a.pos.x, a.pos.y, a.pos.z);
            damageDragon(a.big ? 5 : 3, a);
            skillXp('destruction', 2);
            disposeArrow(a);
            arrows.splice(i, 1);
            removed = true;
            continue;
          }
        }
        if (near(bandits) || near(wolves) || near(guards) ||
            a.pos.y <= 0.1 || pointBlocked(a.pos.x, a.pos.z) || a.ttl <= 0.05) {
          const wetMul = weather.state === 'storm' ? 0.75 : weather.state === 'rain' ? 0.85 : 1;
          explodeAt(a.pos.x, a.pos.z, a.big ? 4 : 2, (a.big ? 5.2 : 3.4) * wetMul); // 雨天火势打折;小火球不再一发清场
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
        }
        continue;
      }
      if (dragonRT.on && dragonRT.hp > 0) { // 飞龙判定:三维距离,不受地面身位限制
        const gp = dragonRT.ent.group.position;
        if (Math.abs(a.pos.y - gp.y - 1.6) < 2.4 && dist2(a.pos.x, a.pos.z, gp.x, gp.z) < 2.6 * 2.6) {
          if (a.fire) explodeAt(a.pos.x, a.pos.z, 0, 1);
          damageDragon(a.fire ? (a.big ? 5 : 3) :
            (a.dmg || arrowBonus(WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0))), a);
          skillXp(a.mag || a.fire ? 'destruction' : 'archery', 2);
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
          continue;
        }
      }
      if (arrowHitEntities(a)) {
        if (a.mag && prologue.on) prologue.flags.sparkHit = true; // 序章:魔光弹要真打中才算学会
        skillXp(a.mag ? 'destruction' : 'archery', 2);
        if (a.mag) magBurst(a.pos.x, Math.max(0.4, a.pos.y), a.pos.z); // 命中碎光
        if (a.pierce > 0) { a.pierce--; continue; } // 满月箭:穿过去接着飞
        disposeArrow(a);
        arrows.splice(i, 1);
        removed = true;
        continue;
      }
      if (a.pos.y <= 0.05 || pointBlocked(a.pos.x, a.pos.z)) {
        if (a.mag) { // 光弹不钉墙:撞上就炸成碎光消散
          magBurst(a.pos.x, Math.max(0.15, a.pos.y), a.pos.z);
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
          break;
        }
        a.stuck = true;
        a.ttl = Math.min(a.ttl, 2);
        a.pos.y = Math.max(0.05, a.pos.y);
        break;
      }
    }
    if (removed) continue;
    a.mesh.position.copy(a.pos);
    a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
  }
}

// ---- 铁匠铺(装备商店) ----
const shopEl = document.getElementById('shop');
let shopOpen = false;
function refreshShop() {
  const items = [
    ['shop-dagger', `🔪 短匕 —— 30 金币(出手极快)`, () => !player.weaponsOwned.includes('dagger') && player.coins >= 30,
      () => { player.coins -= 30; player.weaponsOwned.push('dagger'); }],
    ['shop-greatsword', `⚔️ 巨剑 —— 90 金币(势大力沉,击退拉满)`, () => !player.weaponsOwned.includes('greatsword') && player.coins >= 90,
      () => { player.coins -= 90; player.weaponsOwned.push('greatsword'); }],
    ['shop-bow', `🏹 猎弓 —— 60 金币(远程射击,箭矢管够)`, () => !player.weaponsOwned.includes('bow') && player.coins >= 60,
      () => { player.coins -= 60; player.weaponsOwned.push('bow'); }],
    ['shop-temper', `🔥 淬火陨铁 —— 50 金币(所有武器伤害 +1)`, () => player.swordLv === 1 && player.coins >= 50,
      () => { player.coins -= 50; player.swordLv = 2; setWeaponVisual(player.weapon); }],
    ['shop-leather', `🛡️ 皮甲 —— 40 金币(生命上限 +1 心)`, () => player.armor < 1 && player.coins >= 40,
      () => { player.coins -= 40; applyArmor(1); }],
    ['shop-plate', `🛡️ 板甲 —— 120 金币(生命上限 +2 心)`, () => player.armor < 2 && player.coins >= 120,
      () => { player.coins -= 120; applyArmor(2); }],
  ];
  for (const [id, label, canBuy, buy] of items) {
    const btn = document.getElementById(id);
    const owned = id === 'shop-dagger' ? player.weaponsOwned.includes('dagger')
      : id === 'shop-greatsword' ? player.weaponsOwned.includes('greatsword')
      : id === 'shop-bow' ? player.weaponsOwned.includes('bow')
      : id === 'shop-temper' ? player.swordLv >= 2
      : id === 'shop-leather' ? player.armor >= 1
      : player.armor >= 2;
    btn.textContent = owned ? `${label.split('——')[0]}—— 已拥有` : label;
    btn.disabled = !canBuy();
    btn.onclick = () => {
      if (!canBuy()) return;
      buy();
      sfx.chest();
      saveGame();
      refreshShop();
    };
  }
}
function openShop() {
  shopOpen = true;
  refreshShop();
  shopEl.style.display = 'flex';
  document.exitPointerLock();
}
document.getElementById('shop-close').onclick = () => {
  shopOpen = false;
  shopEl.style.display = 'none';
  renderer.domElement.requestPointerLock();
  toast('格罗姆:武器认主,好好待它们。', 2);
};

// ================= 打击感:慢动作/伤害数字/连杀/倒地动画 =================

const dmgPool = [];
const _dmgV = new THREE.Vector3();
function showDamage(pos, text, crit = false) {
  let d = dmgPool.find((x) => x.t <= 0);
  if (!d) {
    if (dmgPool.length >= 14) return;
    d = { el: document.createElement('div'), t: 0, p: new THREE.Vector3() };
    document.getElementById('hud').appendChild(d.el);
    dmgPool.push(d);
  }
  d.el.className = crit ? 'dmgnum crit' : 'dmgnum';
  d.el.textContent = text;
  d.t = 0.75;
  d.p.set(pos.x, (pos.y || 0) + 1.5 + groundH(pos.x, pos.z), pos.z);
}
// 战斗即时浮字(弹反/还击/破防/打断/背刺……):当场出现在头顶,不进 toast 排队
function callout(text, kind = 'gold', pos = null) {
  let d = dmgPool.find((x) => x.t <= 0);
  if (!d) {
    if (dmgPool.length >= 18) d = dmgPool.reduce((a, b) => (a.t < b.t ? a : b)); // 满了就顶掉最旧的
    else {
      d = { el: document.createElement('div'), t: 0, p: new THREE.Vector3() };
      document.getElementById('hud').appendChild(d.el);
      dmgPool.push(d);
    }
  }
  const at = pos || player.pos;
  d.el.className = `dmgnum callout ${kind}`;
  d.el.textContent = text;
  d.t = 1.1;
  d.p.set(at.x, (at.y || 0) + (pos ? 2.2 : 2.5) + groundH(at.x, at.z), at.z);
}
function updateDamageNums(dt) {
  for (const d of dmgPool) {
    if (d.t <= 0) { d.el.style.display = 'none'; continue; }
    d.t -= dt;
    d.p.y += dt * 1.7;
    _dmgV.copy(d.p).project(camera);
    if (_dmgV.z > 1) { d.el.style.display = 'none'; continue; }
    d.el.style.display = 'block';
    d.el.style.left = `${(_dmgV.x * 0.5 + 0.5) * window.innerWidth}px`;
    d.el.style.top = `${(-_dmgV.y * 0.5 + 0.5) * window.innerHeight}px`;
    d.el.style.opacity = Math.min(1, d.t / 0.3);
  }
}

let comboN = 0, comboT = 0;
function registerKill() {
  stats.kills = (stats.kills || 0) + 1;
  if (stats.kills >= 100) unlockAch('slayer');
  comboT = 4;
  comboN++;
  sfx.kill();
  hitStop(0.09);
  if (comboN >= 2) {
    sfx.combo(Math.min(comboN, 8));
    const el = document.getElementById('combo');
    el.textContent = `${comboN} 连杀!`;
    el.style.opacity = 1;
    el.style.transform = 'translateX(-50%) scale(1.3)';
    setTimeout(() => { el.style.transform = 'translateX(-50%) scale(1)'; }, 120);
  }
  // 连杀里程碑:越杀越勇
  if (comboN === 3) callout('三连杀!', 'gold');
  else if (comboN === 5) {
    callout('势不可挡!体力回满', 'gold');
    player.sta = player.maxSta;
    sfx.fanfare();
  } else if (comboN === 8) {
    callout('一骑当千!剑光化金', 'gold');
    unlockAch('rampage');
    sfx.fanfare();
  }
}
// 白热:八连杀燃起的状态,连杀窗口内攻速 +28%、剑光化金,断了连杀就熄
const whiteHot = () => comboN >= 8 && comboT > 0;
function updateCombo(dt) {
  if (comboT > 0) {
    comboT -= dt;
    if (comboT <= 0) { comboN = 0; document.getElementById('combo').style.opacity = 0; }
  }
}

const fallAnims = [];
function startFall(e) { e.group.rotation.x = 0; fallAnims.push({ e, t: 0.32 }); }
function updateFalls(dt) {
  for (let i = fallAnims.length - 1; i >= 0; i--) {
    const f = fallAnims[i];
    f.t -= dt;
    f.e.group.rotation.x = -(1 - Math.max(0, f.t) / 0.32) * Math.PI / 2;
    if (f.t <= 0) fallAnims.splice(i, 1);
  }
}

// 起手预警:敌人面前铺开一块扇形——暗的是这一刀真正打得到的范围(半径 = 实际判定距离、
// 张角 = 实际判定角),亮的从脚下往外长,长满的那一刻刀落下。站到扇形外(侧闪、绕背、后撤)就挨不着。
// 敌人起手时会慢慢转向你,最后 0.2 秒锁死方向。紫色 = 破盾重击:别格挡,滚!
// (旧实现直接改材质 emissive,GLB 模型材质是共享缓存,会把满街同色 NPC 一起染红,故重做)
const dangerFX = [];
const dangerMat = new THREE.MeshBasicMaterial({ color: 0xff3220, transparent: true, opacity: 0.4,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const _sectorGeos = new Map();
function sectorGeo(arc) {
  const key = arc.toFixed(3);
  let g = _sectorGeos.get(key);
  if (!g) {
    g = new THREE.CircleGeometry(1, 24, -Math.PI / 2 - arc / 2, arc); // 朝 +Z(实体正前)张开
    g.userData.shared = true;
    _sectorGeos.set(key, g);
  }
  return g;
}
// 敌人出手的判定:range 内、且在它正前方 ±arc/2 以内
const FOE_ARC = 2.1; // ≈120°
function inFrontArc(e, p, range, arc = FOE_ARC) {
  const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 0.6) return true; // 贴脸了躲不开
  return (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / d > Math.cos(arc / 2);
}
// 转向(角速度上限):起手中的敌人只能慢慢扭过来
function turnToward(cur, want, maxStep) {
  let d = (want - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
let rearWarnT = -1e9;
function telegraphFlash(e, dur = 0.45, heavy = false, range = heavy ? 2.7 : 2.3, arc = FOE_ARC) {
  sfx.warn();
  // 第一次见到紫色破盾重击:弹一张教学卡
  if (heavy && !stats.seenPurple && started && !prologue.on) {
    stats.seenPurple = true;
    setTutor('C', '紫色扇形 = 破盾重击:盾挡不住!', '按 C 翻滚躲开,或者在亮区长满前退出扇形');
    later(4.5, () => { if (!prologue.on) setTutor(null); });
  }
  // 身后起手:镜头看不到的方向有人举刀,头顶先喊一声
  if (e.pos && simNow() - rearWarnT > 1200) {
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < range + 1.5 && (dx * -Math.sin(cam.yaw) + dz * -Math.cos(cam.yaw)) / d < -0.25) {
      rearWarnT = simNow();
      callout('⚠ 身后!', 'red');
    }
  }
  const grp = new THREE.Group();
  const zone = new THREE.Mesh(sectorGeo(arc), pooledMat(dangerMat));
  const fill = new THREE.Mesh(sectorGeo(arc), pooledMat(dangerMat));
  for (const m of [zone, fill]) {
    m.rotation.x = -Math.PI / 2;
    if (heavy) m.material.color.setHex(0xb040ff); // 紫=破盾重击:别格挡,滚!
    grp.add(m);
  }
  zone.position.y = 0.1;
  fill.position.y = 0.12;
  zone.scale.setScalar(range);
  fill.scale.setScalar(0.05);
  grp.position.set(e.pos.x, 0, e.pos.z);
  grp.rotation.y = e.yaw || 0;
  scene.add(grp);
  dangerFX.push({ grp, zone, fill, e, t: 0, dur, range, sector: true });
}
function removeDanger(f) {
  if (f.sector) {
    scene.remove(f.grp);
    releaseMat(f.zone.material);
    releaseMat(f.fill.material);
  } else {
    scene.remove(f.ring);
    f.ring.geometry.dispose();
    releaseMat(f.ring.material);
  }
}
function updateDanger(dt) {
  for (let i = dangerFX.length - 1; i >= 0; i--) {
    const f = dangerFX[i];
    f.t += dt;
    const k = f.t / f.dur;
    // 出手完毕/被打断(死亡、倒地、踉跄)即熄灭
    if (k >= 1 || f.e.dead || f.e.downT > 0 || (f.e.stunT || 0) > 0 || (f.e.hitStunT || 0) > 0) {
      removeDanger(f);
      dangerFX.splice(i, 1);
      continue;
    }
    if (f.sector) {
      f.grp.position.set(f.e.pos.x, 0, f.e.pos.z);
      f.grp.rotation.y = f.e.yaw || 0;
      f.fill.scale.setScalar(Math.max(0.05, k) * f.range); // 亮区长满 = 刀落下
      f.zone.material.opacity = 0.12 + 0.12 * k;
      f.fill.material.opacity = 0.28 + 0.42 * k;
      continue;
    }
    f.ring.material.opacity = 0.25 + 0.55 * k;    // 越接近出手越亮
  }
}

// ================= 鸡(惹不起的存在) =================
const chickens = [];
let chickenAnger = 0, chickenAngerT = 0, revengeT = 0;
function addChicken(x, z) {
  const c = { ...makeChicken(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), state: 'idle', timer: rand() * 3,
    vel: new THREE.Vector3(), walkT: 0, peckCd: 0, extra: false };
  c.group.position.copy(c.pos);
  scene.add(c.group);
  chickens.push(c);
  return c;
}
[[18, 84], [22, 88], [26, 84], [10, 22], [-14, 20], [44, 14], [14, 78], [-16, 90]]
  .forEach(([x, z]) => addChicken(x, z));

function pokeChicken(c) {
  sfx.cluck();
  c.state = 'flee';
  c.timer = 2.5;
  chickenAnger++;
  chickenAngerT = 30;
  spawnDust(c.pos.x, 0.3, c.pos.z, 3, 0.4, 1.2);
  if (chickenAnger === 2) toast('🐔 那只鸡狠狠地瞪了你一眼。', 2);
  if (chickenAnger >= 3 && revengeT <= 0) {
    revengeT = 22;
    toast('🐔🐔🐔 你惹怒了鸡群!!快跑!!', 3.5);
    sfx.wanted();
    for (let i = 0; i < 5; i++) {
      const a = rand() * 6.28;
      const rc = addChicken(player.pos.x + Math.cos(a) * 12, player.pos.z + Math.sin(a) * 12);
      rc.extra = true;
    }
  }
}

function updateChickens(dt) {
  if (chickenAngerT > 0) { chickenAngerT -= dt; if (chickenAngerT <= 0) chickenAnger = 0; }
  if (revengeT > 0) {
    revengeT -= dt;
    if (revengeT <= 0) {
      chickenAnger = 0;
      toast('鸡群消气了……这次就算了。', 2.5);
      for (let i = chickens.length - 1; i >= 0; i--) {
        // eventKeep 的鸡(金鸡/越狱鸡)由各自事件的 end() 负责回收,这里不动
        if (chickens[i].extra && !chickens[i].eventKeep && chickens[i] !== player.carrying) retireEntity(chickens[i], chickens);
        else chickens[i].state = chickens[i] === player.carrying ? 'carried' : 'idle';
      }
    }
  }
  for (const c of chickens) {
    if (c === player.carrying) continue;
    if (c.state !== 'thrown' && revengeT <= 0 && entFar(c)) continue; // 远处的鸡不啄米
    let moving = false;
    if (c.state === 'thrown') {
      c.vel.y -= 14 * dt;
      if (c.vel.y < -3) c.vel.y = -3; // 扑腾缓降
      c.pos.addScaledVector(c.vel, dt);
      c.walkT += dt * 30;
      if (c.pos.y <= 0) {
        c.pos.y = 0;
        c.state = 'flee';
        c.timer = 3;
        sfx.cluck();
        // 鸡弹砸中卫兵:袭警!
        for (const g of guards) {
          if (g.downT <= 0 && dist2(c.pos.x, c.pos.z, g.pos.x, g.pos.z) < 2.2) {
            g.stunT = Math.max(g.stunT, 2.5); g.stunSrc = 'other';
            crime(1, '🐔 你用一只鸡袭击了卫兵!');
            break;
          }
        }
        // 砸中村民:吓个半死(不算犯罪,算没品)
        for (const v of villagers) {
          if (!v.sleeping && v.downT <= 0 && dist2(c.pos.x, c.pos.z, v.pos.x, v.pos.z) < 2.2) {
            v.fleeT = 3.5;
            toast('🐔 精准鸡击!村民魂飞魄散。', 2);
            break;
          }
        }
      }
    } else if (revengeT > 0 && !player.dead) {
      c.peckCd = Math.max(0, c.peckCd - dt);
      const pd = Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z);
      if (pd > 0.7) { moveEntity(c, player.pos.x, player.pos.z, 6.8, dt); moving = true; }
      else if (c.peckCd <= 0) {
        c.peckCd = 1.1;
        damagePlayer(1);
        sfx.cluck();
        if (++stats.pecks >= 5) unlockAch('pecked');
      }
    } else if (c.state === 'flee') {
      c.timer -= dt;
      if (c.timer <= 0) c.state = 'idle';
      const fx = c.pos.x - player.pos.x, fz = c.pos.z - player.pos.z;
      const d = Math.hypot(fx, fz) || 1;
      moveEntity(c, c.pos.x + (fx / d) * 4, c.pos.z + (fz / d) * 4, 5.5, dt);
      moving = true;
    } else {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.timer = 1.5 + rand() * 3;
        const a = rand() * 6.28;
        c.target = [c.home.x + Math.cos(a) * 4, c.home.z + Math.sin(a) * 4];
      }
      if (c.target && !moveEntity(c, c.target[0], c.target[1], 1.6, dt)) moving = true;
    }
    c.group.position.copy(c.pos);
    c.group.rotation.y = c.yaw;
    c.parts.head.position.z = 0.16 + (moving ? Math.sin(c.walkT * 2) * 0.05 : 0);
    c.parts.body.position.y = 0.26 + (moving ? Math.abs(Math.sin(c.walkT)) * 0.03 : 0);
  }
}

// ================= 绵羊(可以骑,为什么不呢) =================
function addSheep(x, z) {
  const s = { ...makeSheep(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned: false, stolen: false, sheep: true,
    state: 'idle', timer: rand() * 4, walkT: 0, baaT: 0 };
  s.group.position.copy(s.pos);
  scene.add(s.group);
  horses.push(s); // 复用坐骑系统
  return s;
}
[[-38, 63], [-42, 67], [-36, 68], [-44, 62], [-40, 71], [-34, 64]].forEach(([x, z]) => addSheep(x, z));

// 灰烬荒地的常驻匪帮(死后一分钟重生)
for (const [ax, az] of [[-368, -30], [-390, -52], [-372, -60]]) {
  const b = addBandit(ax, az, { hp: 3 });
  b.ambient = true;
}

// ================= 远距休眠(性能):够远又没有戏份的实体这一帧不演 =================
const CULL_D2 = 120 * 120;
function entFar(e) {
  return dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > CULL_D2;
}

// ================= 猎鹿(卖鹿肉给罗莎) =================
const deers = [];
function addDeer(x, z) {
  const d = { ...makeHorse(0x9a7148, false, { antlers: rand() < 0.55 }), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), deer: true, state: 'graze', timer: rand() * 4,
    walkT: 0, dead: false, respawnT: 0, fleeT: 0, downT: 0, hp: 1 };
  d.group.scale.setScalar(0.62);
  d.group.position.copy(d.pos);
  scene.add(d.group);
  deers.push(d);
  return d;
}
[[-150, -30], [-120, -70], [-172, -94], [-60, -122], [96, -92], [-214, 62], [64, 124], [-70, 134]]
  .forEach(([x, z]) => addDeer(x, z));

function updateDeers(dt) {
  for (const d of deers) {
    if (d.dead) {
      d.respawnT -= dt;
      if (d.respawnT <= 0) {
        d.dead = false;
        d.hp = 1;
        d.pos.copy(d.home);
        d.group.rotation.x = 0; // startFall 倒的是 x 轴,复活要扶正
        d.group.rotation.z = 0;
        d.group.visible = true;
      }
      continue;
    }
    if (entFar(d)) continue;
    const pd2 = dist2(player.pos.x, player.pos.z, d.pos.x, d.pos.z);
    let moving = false;
    if (pd2 < 130 && !player.dead) {
      // 受惊逃窜:朝远离玩家的方向跑
      d.fleeT = 1.2;
    }
    if (d.fleeT > 0) {
      d.fleeT -= dt;
      const fx = d.pos.x - player.pos.x, fz = d.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(d, d.pos.x + (fx / fd) * 10, d.pos.z + (fz / fd) * 10, 8.6, dt);
      moving = true;
    } else {
      d.timer -= dt;
      if (d.timer <= 0) {
        d.timer = 2 + rand() * 4;
        d.tx = d.home.x + (rand() - 0.5) * 22;
        d.tz = d.home.z + (rand() - 0.5) * 22;
      }
      if (d.tx !== undefined && !moveEntity(d, d.tx, d.tz, 1.8, dt)) moving = true;
    }
    d.group.position.copy(d.pos);
    d.group.rotation.y = d.yaw;
    const sw = moving ? Math.sin(d.walkT) * 0.55 : 0;
    d.parts.legs[0].rotation.x = sw;
    d.parts.legs[1].rotation.x = -sw;
    d.parts.legs[2].rotation.x = -sw;
    d.parts.legs[3].rotation.x = sw;
  }
}
function killDeer(d) {
  d.dead = true;
  d.respawnT = 300;
  startFall(d);
  later(2.5, () => { if (d.dead) d.group.visible = false; });
  player.venison++;
  stats.deer = (stats.deer || 0) + 1;
  if (stats.deer >= 5) unlockAch('hunter');
  toast(`🦌 猎到一头鹿!鹿肉 ×${player.venison}(卖给旅店老板娘,5 金币一块)`, 3);
}

// ================= 采蘑菇(卖给女巫玛尔戈) =================
const mushrooms = [];
const MUSH_SPOTS = [
  [-128, -44], [-142, -58], [-160, -36], [-176, -70], [-150, -102], [-118, -88],
  [-196, -18], [-124, -18], [-282, 210], [-266, 244], [58, 132], [84, 118], [-52, 148], [-204, 84],
];
{
  const stemG = new THREE.CylinderGeometry(0.09, 0.12, 0.34, 5);
  const capG = new THREE.SphereGeometry(0.26, 7, 5);
  for (const [mx, mz] of MUSH_SPOTS) {
    const grp = new THREE.Group();
    const stem = new THREE.Mesh(stemG, lambert(0xe8e0d0));
    stem.position.y = 0.17;
    grp.add(stem);
    const cap = new THREE.Mesh(capG, lambert(rand() < 0.5 ? 0xc03028 : 0xb98a3a, { roughness: 0.7 }));
    cap.scale.y = 0.62;
    cap.position.y = 0.4;
    cap.castShadow = true;
    grp.add(cap);
    grp.position.set(mx, 0, mz);
    scene.add(grp);
    mushrooms.push({ group: grp, x: mx, z: mz, picked: false });
  }
}
function respawnMushrooms() {
  for (const m of mushrooms) { m.picked = false; m.group.visible = true; }
}

// ================= 狼伙伴「霜牙」(霜风隘口的白狼,鹿肉驯服) =================
const frostfang = { ent: null, wary: null, tamed: false, feed: 0, atkCd: 0 };
function spawnWhiteWolf(x, z) {
  const w = { ...makeWolf(0xdfe6ee, 0x7ac0e8, 0x2a5a88), pos: new THREE.Vector3(x, 0, z),
    yaw: rand() * 6.28, walkT: 0, timer: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  return w;
}
frostfang.wary = spawnWhiteWolf(-286, -128);
function updateFrostfang(dt) {
  // 未驯服:白狼在隘口游荡,保持距离打量你
  if (!frostfang.tamed && frostfang.wary) {
    const w = frostfang.wary;
    if (entFar(w)) return;
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    if (pd < 4.5) {
      const fx = w.pos.x - player.pos.x, fz = w.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(w, w.pos.x + (fx / fd) * 6, w.pos.z + (fz / fd) * 6, 4.5, dt);
      moving = true;
    } else if (pd > 26) {
      // 不追人,溜达回家
      if (!moveEntity(w, -286, -128, 2.2, dt)) moving = true;
    }
    w.group.position.copy(w.pos);
    w.group.rotation.y = pd < 20 ? Math.atan2(player.pos.x - w.pos.x, player.pos.z - w.pos.z) : w.yaw;
    const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
    w.parts.legs[0].rotation.x = sw;
    w.parts.legs[1].rotation.x = -sw;
    w.parts.legs[2].rotation.x = -sw;
    w.parts.legs[3].rotation.x = sw;
    return;
  }
  // 已驯服:跟随 + 替你咬盗贼和恶狼
  const w = frostfang.ent;
  if (!w) return;
  frostfang.atkCd = Math.max(0, frostfang.atkCd - dt);
  const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
  if (pd > 60) { w.pos.set(player.pos.x + 2, 0, player.pos.z + 2); } // 跟丢了瞬移归队
  // 找玩家身边最近的敌人
  let target = null, td = 14 * 14;
  for (const b of bandits) {
    if (b.dead || b.downT > 0 || b.robber) continue;
    const d = dist2(player.pos.x, player.pos.z, b.pos.x, b.pos.z);
    if (d < td) { td = d; target = b; }
  }
  for (const e of wolves) {
    if (e.dead || e.arena) continue;
    const d = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
    if (d < td) { td = d; target = e; }
  }
  let moving = false;
  if (target) {
    const dd = Math.hypot(target.pos.x - w.pos.x, target.pos.z - w.pos.z);
    if (dd > 1.6) {
      moveEntity(w, target.pos.x, target.pos.z, 8.6, dt);
      moving = true;
    } else if (frostfang.atkCd <= 0) {
      frostfang.atkCd = 0.9;
      sfx.hit();
      applyDamage(target, 1, { source: 'companion', knock: 0.4, credit: '霜牙助攻', coins: 3 });
    }
  } else if (pd > 3.5) {
    moveEntity(w, player.pos.x + 1.5, player.pos.z + 1.5, pd > 12 ? 9 : 5.5, dt);
    moving = true;
  }
  w.group.position.copy(w.pos);
  if (moving || target) w.group.rotation.y = w.yaw;
  const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
  w.parts.legs[0].rotation.x = sw;
  w.parts.legs[1].rotation.x = -sw;
  w.parts.legs[2].rotation.x = -sw;
  w.parts.legs[3].rotation.x = sw;
}
function tameFrostfang() {
  frostfang.tamed = true;
  frostfang.ent = frostfang.wary;
  frostfang.wary = null;
  unlockAch('packmate');
  remember('用三块鹿肉驯服了霜风隘口的白狼「霜牙」', 'frostfang');
  toast('🐺 白狼低头蹭了蹭你的手——「霜牙」愿意与你同行!', 5);
  saveGame();
}

// ================= 野外热点:篝火(烤肉)/温泉(泡汤)/教堂(庇佑) =================
const wildSpots = [];
// 核心区固定热点:幽暗森林边的猎人篝火 + 霜风隘口温泉
{
  const cf = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert(0x66625c));
    st.position.set(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7);
    cf.add(st);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0xff9a3d, emissive: 0xcc5500, emissiveIntensity: 1.4 }));
  flame.position.y = 0.4;
  cf.add(flame);
  cf.position.set(-118, 0, -32);
  scene.add(cf);
  wildSpots.push({ type: 'campfire', x: -118, z: -32, chunk: null });

  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
    new THREE.MeshStandardMaterial({ color: 0x7ad4d8, emissive: 0x1a5a5e, emissiveIntensity: 0.4, roughness: 0.15 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-272, 0.03, -122);
  scene.add(pool);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), lambert(0x8a857e));
    st.position.set(-272 + Math.cos(a) * 2.8, 0.22, -122 + Math.sin(a) * 2.8);
    scene.add(st);
  }
  wildSpots.push({ type: 'spring', x: -272, z: -122, chunk: null });
}
function nearestSpot(type, r2) {
  for (const sp of wildSpots) {
    if (sp.type === type && dist2(player.pos.x, player.pos.z, sp.x, sp.z) < r2) return sp;
  }
  return null;
}
let springTick = 0, blessDay = 0;
function updateSprings(dt) {
  if (!started || player.dead) return;
  const sp = nearestSpot('spring', 14);
  if (!sp) { springTick = 0; return; }
  springTick += dt;
  if (springTick >= 2) {
    springTick = 0;
    spawnDust(player.pos.x, 0.6, player.pos.z, 3, 1.2, 1.6);
    stats.soak = (stats.soak || 0) + 2;
    choreProgress('soak');
    choreProgress('soak');
    if (stats.soak >= 30) unlockAch('soak');
    if (player.hp < player.maxHp) {
      player.hp++;
      sfx.heart();
    }
  }
}

// ================= 梦境(旅店过夜时,AI 把编年史揉进梦里) =================
const DREAMS = [
  '你梦见自己站在麦田中央,每一穗麦子都朝着你弯腰,像在行礼,又像在偷笑。',
  '你梦见银月湖底亮着一盏灯,守灯人背对着你,肩膀很像你自己。',
  '你梦见那只鸡。它坐在王座上,神情威严。你醒来前,它点了点头。',
  '你梦见风车转得越来越慢,最后停住——整个世界都在等它,谁也不敢先动。',
  '你梦见一枚金币掉进许愿池,沉了很久很久,久到你在梦里睡着了。',
  '你梦见雪落进炉火,没有熄,反而烧得更旺。有人在你身后轻轻说:记住这个。',
];
let dreamIdx = Math.floor(rand() * DREAMS.length);
function queueDream() {
  if (rand() < 0.45) return; // 不是每晚都做梦
  const mem = [dayTopThought,
    dayTopSurprise ? `它最没料到的一刻:${dayTopSurprise}` : null,
  ].filter(Boolean).join(';') || recallLine();
  if (!AI_TEXT_OFF && !aiBusy.dream) {
    aiBusy.dream = true;
    aiLine(
      `你是梦本身。给一个中世纪游侠写一段40字以内的梦境,素材(他昨天最挂心的事):${mem || '空旷的原野与一面镜子'}。` +
      '要有画面感,微微超现实,不解释,不加引号。只输出梦境。', null, 9000,
    ).then((t) => {
      aiBusy.dream = false;
      if (t && !dialog.open && !player.dead) openDialog([`(昨夜的梦)${t}`]);
    });
  } else {
    setTimeout(() => {
      if (!dialog.open && !player.dead) openDialog([`(昨夜的梦)${DREAMS[dreamIdx++ % DREAMS.length]}`]);
    }, 4000);
  }
}

// 任务日志:当前委托、目标与进度、去哪做
function questLogLine() {
  if (quest.idx >= missions.length) return '📜 委托:全部完成——去见领主领赏。';
  const m = missions[quest.idx];
  if (!quest.active) return `📜 下一单:${m.title}(回${stewardWhere()}找管家埃隆接取)`;
  const prog = m.goal ? `(进度 ${quest.progress}/${m.goal})` : '';
  const tm = quest.timer > 0 && (m.type === 'deliver' || m.type === 'race') ? ` · 剩 ${Math.ceil(quest.timer)} 秒` : '';
  return `📜 进行中:${m.title} —— ${m.desc}${prog}${tm}`;
}
// ================= 旅程手账(J 键:一册在手,战绩全有) =================
function openJournal() {
  if (dialog.open) return;
  const bestRace = stats.raceBest ? `${stats.raceBest.toFixed(1)} 秒` : '——';
  const pages = [
    `📖 旅程手账 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日(在这世上第 ${calendar.day} 天)`,
    questLogLine(),
    `世界眼里的你:「${archetype()}」 · 🪙 ${player.coins} · ❤ 上限 ${player.maxHp / 2} 心` +
      `${player.relic ? ' · ☀️ 先王战徽' : ''}${frostfang.tamed ? ' · 🐺 霜牙同行' : ''}`,
    `📜 委托 ${Math.min(quest.idx, missions.length)}/${missions.length} · 🛡️ 纹章 ${crestsFound.length}/${world.crestSpots.length} · 📖 铭文 ${loreRead.length}/${LORE.length} · 🏆 成就 ${achUnlocked.length}/${Object.keys(ACH_DEFS).length}`,
    `🐺 猎狼 ${wolfKills} · 🦌 猎鹿 ${stats.deer || 0} · 🍄 采菇 ${stats.mushrooms || 0} · 🎣 钓鱼 ${stats.fishCaught || 0} · ⚡ 弹反 ${stats.parries || 0}`,
    `🏟️ 竞技场最佳 ${stats.arenaBest || 0} 波 · 🏁 赛马纪录 ${bestRace} · 💀 倒下 ${stats.deaths || 0} 次`,
    `⚔️ 战团覆灭 ${stats.warbandsWiped || 0} 支 · 🏰 攻城击退 ${stats.siegesHeld || 0} 次 · 🚩 军旗 ${stats.banners || 0} 面`,
    `📈 技艺(用什么涨什么):${Object.entries(SKILL_DEFS).map(([k, d]) =>
      `${d.icon}${d.name} ${player.skills[k].lv} 级`).join(' · ')}` +
      `${shout.learned ? ' · 🐉 冲击战吼' : ''}${mercs.length ? ` · 🪖 佣兵 ×${mercs.length}` : ''}`,
  ];
  const mems = chronicle.filter((m) => !(m.k && /^(ws-|death-)/.test(m.k)) && !/[他它]/.test(m.t)).slice(-3);
  if (mems.length) {
    pages.push(`📝 最近的经历:${mems.map((m) => `第${m.d}日,${m.t}`).join(';')}。`);
  }
  {
    const topLeg = EVO.legends.reduce((b, x) => (!b || x.heat > b.heat ? x : b), null);
    const bits = [];
    if (EVO.wolfGen > 1) bits.push(`狼群一代比一代凶(第 ${EVO.wolfGen} 代)`);
    if (EVO.tactics.block >= 0.25) bits.push('盗贼学会了举盾');
    if (EVO.tactics.dodge >= 0.25) bits.push('盗贼学会了闪箭');
    if (topLeg && topLeg.gen > 1) bits.push(`酒馆里流传着你的故事:「${legendText(topLeg)}」`);
    if (bits.length) pages.push(`🌍 世界的变化:${bits.join(' · ')}`);
  }
  openDialog(pages);
}

// ================= 拍照模式(P 键隐藏全部 HUD) =================
let photoMode = false;
const PHOTO_HIDE = ['hearts', 'coins', 'equip', 'wanted', 'mission', 'region', 'minimap',
  'prompt', 'controls-hint', 'combo', 'weather', 'bubble', 'toast',
  'stamina', 'lockhp', 'bosshp', 'save-icon', 'actionbar', 'keyhint'];
function togglePhoto() {
  photoMode = !photoMode;
  for (const id of PHOTO_HIDE) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = photoMode ? 'hidden' : '';
  }
  if (!photoMode) toast('📷 已退出拍照模式', 1.5);
}

// ================= 银月湖心岛:摆渡小船与月光祭坛 =================
const BOAT_PIER = { x: -96.5, z: 86 };
const BOAT_ISLE = { x: -100, z: 106.2 };
let lakeBlessed = false;
function rowTo(dst, msg) {
  sfx.splash();
  stats.rows = (stats.rows || 0) + 1;
  if (stats.rows >= 6) unlockAch('sailor');
  toast('🚣 你摇着小船,桨声把湖面剪开一道纹……', 2.5);
  player.pos.set(dst.x, 0, dst.z);
  player.vy = 0;
  if (msg) setTimeout(() => toast(msg, 3), 900);
}
function prayAltar() {
  if (lakeBlessed) {
    openDialog(['(祭坛安静地泛着微光。湖神的恩赐一生只有一次——它记得你来过。)']);
    return;
  }
  lakeBlessed = true;
  recomputeMaxHp();
  player.hp = player.maxHp;
  sfx.fanfare();
  remember('在湖心沉没神殿的祭坛前,得到了湖神的恩赐', 'lakegift');
  unlockAch('lakegift');
  openDialog([
    '(你把手放上月光祭坛。水下极深处,有什么东西缓缓睁开了眼,又缓缓阖上。)',
    '(一股凉意顺着掌心漫上来,像月光灌进了骨头——却并不冷。)',
    '💙 湖神的恩赐:生命上限 +2!',
  ], () => { learnSpell('frost'); saveGame(); });
}

// ================= 赛马计时赛(马厩旁的赛旗,无限重复) =================
const TRIAL_FLAG = { x: 57, z: 13 };
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), lambert(0x6b4a2f));
  pole.position.set(TRIAL_FLAG.x, 1.6, TRIAL_FLAG.z);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x885500, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
  flag.position.set(TRIAL_FLAG.x + 0.58, 2.7, TRIAL_FLAG.z);
  scene.add(flag);
}
const trialRT = { active: false, idx: 0, t: 0, rings: [] };
function startTrial() {
  if (quest.active && missions[quest.idx].type === 'race') {
    toast('🏁 正赛进行中——先跑完领主的委托,再来刷纪录!', 3);
    return;
  }
  trialRT.active = true;
  trialRT.idx = 0;
  trialRT.t = 0;
  for (const [rx, rz] of world.raceRoute) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x7ad4ff, emissive: 0x1a5588, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
    ring.position.set(rx, 2.4, rz);
    scene.add(ring);
    trialRT.rings.push(ring);
  }
  sfx.accept();
  toast(`🏁 计时赛开始!穿过全部 ${world.raceRoute.length} 个蓝环${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)} 秒)` : ''}`, 3.5);
}
function endTrial(finished) {
  for (const r of trialRT.rings) scene.remove(r);
  trialRT.rings = [];
  trialRT.active = false;
  if (!finished) { toast('🏁 计时赛作废。旗子下再来!', 2.5); return; }
  choreProgress('race');
  const t = trialRT.t;
  const best = stats.raceBest || 0;
  if (!best || t < best) {
    stats.raceBest = t;
    player.coins += 10;
    sfx.fanfare();
    remember(`赛马计时赛跑出 ${t.toFixed(1)} 秒的新纪录`);
    toast(`🏁 新纪录 ${t.toFixed(1)} 秒!赏金 10 枚!`, 4);
    saveGame();
  } else {
    toast(`🏁 用时 ${t.toFixed(1)} 秒(纪录 ${best.toFixed(1)} 秒)。再练练!`, 3.5);
  }
}
function updateTrial(dt) {
  if (!trialRT.active) return;
  trialRT.t += dt;
  const [rx, rz] = world.raceRoute[trialRT.idx];
  for (let i = 0; i < trialRT.rings.length; i++) {
    trialRT.rings[i].rotation.y += dt * (i === trialRT.idx ? 3 : 0.6);
    trialRT.rings[i].material.emissiveIntensity = i < trialRT.idx ? 0.1 : i === trialRT.idx ? 1.2 : 0.4;
  }
  if (dist2(player.pos.x, player.pos.z, rx, rz) < 9) {
    trialRT.idx++;
    sfx.coin();
    if (trialRT.idx >= world.raceRoute.length) endTrial(true);
    else toast(`蓝环 ${trialRT.idx}/${world.raceRoute.length} · ${trialRT.t.toFixed(1)}s`, 1);
  }
  if (trialRT.t > 120) endTrial(false); // 两分钟没跑完自动作废
}

// ================= 封印的王室地窖 =================
const DGN = world.dungeon;
function inDungeon() {
  return player.pos.x > DGN.inX0 && player.pos.x < DGN.inX0 + DGN.inW &&
    player.pos.z > DGN.inZ0 && player.pos.z < DGN.inZ0 + DGN.inD;
}
// 守墓者:地窖常驻,黑暗中巡游(死后重生,不计任务)
for (const [gx, gz] of [[336, -296], [352, -272], [368, -300], [344, -252], [376, -276]]) {
  const b = addBandit(gx, gz, { hp: 2, speed: 6.2 });
  b.ambient = true;
  b.keeper = true;
}
function enterDungeon() {
  sfx.chest();
  player.pos.set(DGN.spawn.x, 0, DGN.spawn.z);
  player.vy = 0;
  toast('🕯️ 石阶向下,霉味和很久以前的香火味……这就是被封起来的那一层。', 4);
  remember('掀开了城堡后的暗门,走进被封印的王室地窖', 'crypt');
}
function exitDungeon() {
  sfx.chest();
  player.pos.set(DGN.hatch.x, 0, DGN.hatch.z + 2);
  player.vy = 0;
  toast('你爬回地面。阳光重得像一床棉被。', 3);
}
function takeRelic() {
  if (player.relic) {
    openDialog(['(圣坛空了。战徽在你身上——它记得回家的路,也认得新的主人。)']);
    return;
  }
  player.relic = true;
  sfx.fanfare();
  unlockAch('unsealer');
  remember('从王室地窖的圣坛上请下了「先王战徽」', 'relic');
  openDialog([
    '(圣坛上安放着一枚乌金战徽,八百年的灰尘盖不住它的锋利。)',
    '(你把它别上胸口。掌心的剑柄忽然顺手了许多——像有位老兵扶了一把。)',
    '☀️ 获得「先王战徽」:近战伤害 +1(永久)',
  ], () => saveGame());
}

// ================= 村务委托(无限支线:AI 写求助告示,离线用模板) =================
const CHORE_POS = { x: -9, z: 18 };
{
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), lambert(0x6b4a2f));
  post.position.set(CHORE_POS.x, 1.2, CHORE_POS.z);
  scene.add(post);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.08), lambert(0x9a7a4f, { roughness: 0.9 }));
  plank.position.set(CHORE_POS.x, 1.7, CHORE_POS.z);
  plank.rotation.y = 0.4;
  plank.castShadow = true;
  scene.add(plank);
}
const sideQuest = { active: false, type: null, goal: 0, progress: 0, reward: 0, text: '', giver: '' };
const CHORE_TYPES = [
  { key: 'wolves', label: '猎狼', goalMin: 2, goalMax: 4, reward: 14,
    tpl: (g, who) => `${who}求助:狼群夜里扒我家羊圈,好汉行行好,猎 ${g} 头恶狼,赏钱在村务板下。` },
  { key: 'herbs', label: '采蘑菇', goalMin: 3, goalMax: 5, reward: 11, consume: true,
    tpl: (g, who) => `${who}求助:家里病人等药引,求 ${g} 朵林间伞菇,采到放板下即可,谢过!` },
  { key: 'venison', label: '送鹿肉', goalMin: 2, goalMax: 3, reward: 13, consume: true,
    tpl: (g, who) => `${who}求助:办席短了硬菜,求 ${g} 块鲜鹿肉,价钱好说,板下自取。` },
  { key: 'fish', label: '钓鱼', goalMin: 2, goalMax: 3, reward: 10,
    tpl: (g, who) => `${who}求助:馋鱼了,腿脚又不便。替我钓 ${g} 条上来,赏钱压在石头底下。` },
  { key: 'bandits', label: '清匪', goalMin: 2, goalMax: 3, reward: 16,
    tpl: (g, who) => `${who}求助:路上又有劫道的了,哪位好汉料理掉 ${g} 个,让我进趟货?` },
  { key: 'ride', label: '骑行', goalMin: 400, goalMax: 700, reward: 12,
    tpl: (g, who) => `${who}求助:我那匹马缺操练,替我遛 ${g} 步(骑任意坐骑跑够里程即可)。` },
  { key: 'cook', label: '烤肉', goalMin: 1, goalMax: 2, reward: 9,
    tpl: (g, who) => `${who}求助:想念篝火烤肉的香味了,替我在野外篝火烤 ${g} 块,替我闻闻就行。` },
  { key: 'pray', label: '代祷', goalMin: 1, goalMax: 1, reward: 10,
    tpl: (g, who) => `${who}求助:腿脚不便,替我去荒野的小教堂石坛前祷告一回,心意板下奉上。` },
  { key: 'soak', label: '试泉', goalMin: 6, goalMax: 10, reward: 11,
    tpl: (g, who) => `${who}求助:听说荒野温泉能治腰,替我去泡 ${g} 息,回来告诉我烫不烫。` },
  { key: 'race', label: '跑圈', goalMin: 1, goalMax: 1, reward: 12,
    tpl: (g, who) => `${who}求助:跟人打赌说你能跑完赛旗全程,替我赢回这口气(完成一次计时赛)!` },
  { key: 'wish', label: '许愿', goalMin: 2, goalMax: 3, reward: 8,
    tpl: (g, who) => `${who}求助:我不敢见湖神,替我往喷泉里投 ${g} 枚金币许个愿,愿望内容我写好了压在板下。` },
  { key: 'throw', label: '扔鸡', goalMin: 2, goalMax: 3, reward: 9,
    tpl: (g, who) => `${who}求助:别问原因。把鸡扔出去 ${g} 次,要抛物线漂亮的。真的别问。` },
];
let choreSeq = 0;
function rollChore() {
  const myId = ++choreSeq;
  const t = CHORE_TYPES[Math.floor(rand() * CHORE_TYPES.length)];
  const goal = t.goalMin + Math.floor(rand() * (t.goalMax - t.goalMin + 1));
  const giver = VILLAGERS[Math.floor(rand() * VILLAGERS.length)].name;
  sideQuest.active = true;
  sideQuest.type = t.key;
  sideQuest.goal = goal;
  sideQuest.progress = 0;
  sideQuest._rideDone = false;
  sideQuest.reward = t.reward + (t.key === 'ride' ? Math.round(goal / 50) : goal * 2); // 骑行按里程折算,别按步数发钱
  sideQuest.giver = giver;
  sideQuest.text = t.tpl(goal, giver);
  // AI 把告示重写得更有生活气(异步替换,离线保持模板)
  aiLine(
    `你是中世纪村民「${giver}」。你在村务板贴一则求助告示:需要${goal}份「${t.label}」相关的东西` +
    `(${t.key === 'wolves' ? '猎除恶狼' : t.key === 'herbs' ? '林间伞菇' : t.key === 'venison' ? '鲜鹿肉' : '鲜鱼'})。` +
    '用中文写这则告示,40~70字,原因要具体、生活化、带点小情绪。只输出告示正文。', null, 9000,
  ).then((t2) => { if (t2 && sideQuest.active && choreSeq === myId) sideQuest.text = `${giver}求助:${t2}`; });
}
function choreProgress(kind) {
  if (!sideQuest.active || sideQuest.type !== kind) return;
  sideQuest.progress++;
  if (sideQuest.progress <= sideQuest.goal) {
    toast(`📋 村务【${sideQuest.giver}】:${sideQuest.progress}/${sideQuest.goal}`, 2);
  }
}
function choreReady() {
  if (!sideQuest.active) return false;
  if (sideQuest.type === 'herbs') return player.herbs >= sideQuest.goal;
  if (sideQuest.type === 'venison') return player.venison >= sideQuest.goal;
  return sideQuest.progress >= sideQuest.goal;
}
function choreBoard() {
  if (!sideQuest.active) {
    rollChore();
    sfx.accept();
    saveGame();
    openDialog([`(村务板贴着一张新告示)`, sideQuest.text,
      `(接下了。完成后回到村务板交差,赏钱 ${sideQuest.reward} 金币。)`]);
    return;
  }
  if (choreReady()) {
    if (sideQuest.type === 'herbs') player.herbs -= sideQuest.goal;
    if (sideQuest.type === 'venison') player.venison -= sideQuest.goal;
    player.coins += sideQuest.reward;
    sfx.fanfare();
    stats.chores = (stats.chores || 0) + 1;
    if (stats.chores >= 5) unlockAch('villagehero');
    remember(`替${sideQuest.giver}办妥了一桩村务`);
    openDialog([`(你把东西放在板下,拿走了压着的 ${sideQuest.reward} 枚金币。)`,
      `(${sideQuest.giver}不知何时在告示边添了一行小字:谢过恩公。)`]);
    sideQuest.active = false;
    saveGame();
    return;
  }
  const need = sideQuest.type === 'herbs' ? `${player.herbs}/${sideQuest.goal} 朵伞菇`
    : sideQuest.type === 'venison' ? `${player.venison}/${sideQuest.goal} 块鹿肉`
    : `${sideQuest.progress}/${sideQuest.goal}`;
  openDialog([sideQuest.text, `(进度:${need}。办妥了回来交差。)`]);
}

// ================= 世界观铭文(可阅读的石碑,集齐 12 处) =================
let loreRead = [];
const loreStones = [];
{
  const slabG = new THREE.BoxGeometry(1.0, 1.5, 0.26);
  const baseG = new THREE.BoxGeometry(1.3, 0.3, 0.5);
  for (const L of LORE) {
    const grp = new THREE.Group();
    const slab = new THREE.Mesh(slabG, lambert(0x8d8a84, { roughness: 0.9 }));
    slab.position.y = 0.95;
    slab.castShadow = true;
    grp.add(slab);
    const base = new THREE.Mesh(baseG, lambert(0x6f6c66));
    base.position.y = 0.15;
    grp.add(base);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x9adcc8, emissive: 0x1a5548, emissiveIntensity: 0.5, roughness: 0.6 }));
    rune.position.set(0, 0.98, 0.14);
    grp.add(rune);
    grp.position.set(L.x, 0, L.z);
    grp.rotation.y = rand() * 6.28;
    scene.add(grp);
    loreStones.push({ group: grp, def: L });
  }
}
function readLore(s) {
  const idx = LORE.indexOf(s.def);
  const isNew = !loreRead.includes(idx);
  if (isNew) {
    loreRead.push(idx);
    sfx.chest();
    saveGame();
  }
  // 长文按句切页,读起来不挤
  const parts = s.def.text.split(/(?<=[。」])/).filter(Boolean);
  const pages = [`【铭文 · ${s.def.title}】`];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 60) { pages.push(cur); cur = p; } else cur += p;
  }
  if (cur) pages.push(cur);
  if (isNew) pages.push(`(📜 已收录铭文 ${loreRead.length}/${LORE.length}${loreRead.length >= LORE.length ? ' —— 全部集齐!' : ''})`);
  openDialog(pages, isNew && loreRead.length >= LORE.length ? () => unlockAch('scribe') : null);
}

// ================= 王国公告牌(每日 AI 撰写,离线用内置文风) =================
const NOTICE_POS = { x: -5, z: 12 };
{
  const grp = new THREE.Group();
  const postG = new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6);
  for (const sx of [-0.8, 0.8]) {
    const post = new THREE.Mesh(postG, lambert(0x6b4a2f));
    post.position.set(sx, 1.1, 0);
    grp.add(post);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 0.1), lambert(0x8a6a45, { roughness: 0.9 }));
  panel.position.y = 1.55;
  panel.castShadow = true;
  grp.add(panel);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xe8ddc2, roughness: 0.95 }));
  paper.position.set(0, 1.55, 0.06);
  grp.add(paper);
  grp.position.set(NOTICE_POS.x, 0, NOTICE_POS.z);
  grp.rotation.y = 2.4;
  scene.add(grp);
}
let proclaimText = null;
const PROCLAIM_STOCK = [
  '城中井水甘冽如常,巡逻如常,税吏比巡逻更如常。',
  '南门吊桥的响声已聆听半年,领主府表示:再听听。',
  '风车、面包与告示,是王都每天醒来的三件事。',
  '卫兵队提醒:抱着鸡奔跑不犯法,但很可疑。',
  '喷泉许愿池本月捞出金币三百枚,愿望办理进度:排队中。',
];
function composeProclaimOffline() {
  const sp = todaySpecial();
  const head = `${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日`;
  const fest = sp ? `今日${sp.name}——${sp.desc}。` : '';
  const stage = quest.idx >= missions.length ? '王国大患已除,领主嘉许全城同庆。'
    : quest.idx > 0 ? `绿衣游侠已为王国办结 ${quest.idx} 件委托,领主府记功在案。` : '领主府招募能人异士,详情垂询管家埃隆。';
  return `【王国公告 · ${head}】${fest}${stage}${PROCLAIM_STOCK[calendar.day % PROCLAIM_STOCK.length]}`;
}
function refreshProclaim() {
  proclaimText = composeProclaimOffline();
  const sp = todaySpecial();
  aiLine(
    `你是中世纪王国艾尔德里亚的王室传令官。今天是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
    `${sp ? ',逢' + sp.name : ''},天气${{ clear: '晴', cloudy: '多云', rain: '雨', storm: '雷暴' }[weather.state]}。` +
    (workspace.history.length ? `城中近事:${workspace.history[workspace.history.length - 1].t}。` : '') +
    '用中文写一则60字以内的每日公告,口吻庄重里带点冷幽默,只输出公告正文,不要引号。', null, 8000,
  ).then((t) => { if (t) proclaimText = `【王国公告 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日】${t}`; });
}

// ================= 任务系统 =================
const missions = MISSIONS;
const quest = { idx: 0, active: false, progress: 0, timer: 0 };
// 任务运行时对象
const questRT = { rings: [], ringIdx: 0, merchant: null, specialHorse: null, boss: null, escortSpawned: 0 };

// 委托人(金色衣服的老者)
const questGiver = makeHumanoid({ shirt: 0xc9a227, pants: 0x6a5a2a, hair: 0xd8d8d8 });
questGiver.group.position.copy(world.questGiverPos);
questGiver.group.rotation.y = Math.PI;
scene.add(questGiver.group);
// 头顶“!”
const exGroup = new THREE.Group();
const exBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
exBar.position.y = 0.3;
const exDot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
exDot.position.y = -0.1;
exGroup.add(exBar, exDot);
exGroup.position.set(world.questGiverPos.x, 2.1, world.questGiverPos.z);
scene.add(exGroup);

// ================= 钓鱼(栈桥尽头) =================
const FISH_SPOT = { x: -100, z: 82 };
const FISH_SPOT_ISLE = { x: -103.5, z: 101.5 }; // 湖心岛深水钓点(渔获更肥)
const fishing = { active: false, phase: 'wait', t: 0 };
const CATCHES_DEEP = [
  { w: 34, text: '一条神殿银鱼!鳞片亮得像月光淬过——12 金币。', coins: 12 },
  { w: 26, text: '月光鲤!尾鳍拖着一道银线,渔村得供起来——20 金币!', coins: 20 },
  { w: 18, text: '一盏沉底铜灯,灯芯居然是干的。古董贩子给了 8 金币。', coins: 8 },
  { w: 14, text: '你钓到了湖神的一个呵欠。水面荡了三圈,什么也没留下。', coins: 0 },
  { w: 8,  text: '深水巨物!!差点把你拽下水——25 金币,够吹一年!', coins: 25, ach: 'bigfish' },
];
const CATCHES = [
  { w: 45, text: '一条小鲫鱼!老周按行价收了 3 金币。', coins: 3 },
  { w: 30, text: '一条肥鲤鱼!老周眼睛都亮了,给了 6 金币。', coins: 6 },
  { w: 12, text: '一只老靴子……老周说他找这只鞋找了十年,硬塞给你 2 金币。', coins: 2, ach: 'boot' },
  { w: 8,  text: '水草一团。人生就是这样。', coins: 0 },
  { w: 5,  text: '银月湖大鱼!!鱼尾拍得水花四溅——15 金币,今晚渔村有故事讲了!', coins: 15, ach: 'bigfish' },
];
function startFishing(deep = false) {
  fishing.active = true;
  fishing.deep = deep;
  fishing.phase = 'wait';
  fishing.t = 2.5 + rand() * 4;
  player.yaw = Math.PI; // 面向湖心
  toast(deep ? '🎣 深水抛竿……岛边的鱼更大,咬钩也更狠!' : '🎣 抛竿……盯紧浮漂,咬钩时按 E!', 3);
}
function fishingReel() {
  if (fishing.phase === 'bite') {
    const table = fishing.deep ? CATCHES_DEEP : CATCHES;
    const total = table.reduce((s, c) => s + c.w, 0);
    let roll = rand() * total;
    let got = table[0];
    for (const c of table) { roll -= c.w; if (roll <= 0) { got = c; break; } }
    const moonX2 = todaySpecial()?.key === 'fullmoon' && got.coins > 0;
    if (got.coins > 0) stats.fishCaught = (stats.fishCaught || 0) + 1;
    if (got.coins > 0) choreProgress('fish');
    player.coins += moonX2 ? got.coins * 2 : got.coins;
    if (got.coins > 0) sfx.coin();
    sfx.splash();
    if (got.ach) unlockAch(got.ach);
    openDialog([`(收杆!)${got.text}` + (moonX2 ? '(🌕 满月夜,鱼获双倍!)' : '')]);
  } else {
    sfx.splash();
    toast('收早了,鱼吐着泡跑了。', 2);
  }
  fishing.active = false;
}
function updateFishing(dt) {
  if (!fishing.active) return;
  fishing.t -= dt;
  if (fishing.phase === 'wait' && fishing.t <= 0) {
    fishing.phase = 'bite';
    fishing.t = 0.9;
    sfx.splash();
  } else if (fishing.phase === 'bite' && fishing.t <= 0) {
    fishing.phase = 'wait';
    fishing.t = 2.5 + rand() * 4;
    toast('浮漂动了一下又静了……鱼跑了。', 2);
  }
}

// ================= 街头随机事件(GTA 式) =================
const streetEvent = { type: null, t: 0, villager: null, bandit: null, horse: null, cooldown: 130 };
function endStreetEvent() {
  if (streetEvent.bandit && !streetEvent.bandit.dead) retireEntity(streetEvent.bandit, bandits);
  if (streetEvent.horse) {
    streetEvent.horse.runaway = false;
    // 事件的马不留档:骑着就归你,否则撤走,免得满地图攒野马
    if (streetEvent.horse !== player.mounted) {
      if (horses.includes(streetEvent.horse)) retireEntity(streetEvent.horse, horses);
    }
  }
  streetEvent.type = null;
  streetEvent.bandit = null;
  streetEvent.horse = null;
  streetEvent.cooldown = 150 + rand() * 90;
}
function trySpawnStreetEvent() {
  if (arenaRT.active) return;
  if (dailyEvents <= 0) { streetEvent.cooldown = 60; return; } // 今日热闹够了
  dailyEvents--;
  if (rand() < 0.5) {
    // 抢劫:挑一个不太远的清醒村民
    const v = villagers.find((x) => !x.sleeping && x.downT <= 0 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) > 100);
    if (!v) { dailyEvents++; streetEvent.cooldown = 25; return; }
    streetEvent.type = 'robbery';
    streetEvent.villager = v;
    streetEvent.t = 40;
    streetEvent.bandit = addBandit(v.pos.x + 6, v.pos.z + 3, { escort: false });
    streetEvent.bandit.robber = true;
    toast('⚠️ 有盗贼在抢劫路人!快去帮忙!', 3.5);
    sfx.wanted();
  } else {
    streetEvent.type = 'horse';
    streetEvent.t = 60;
    const a = rand() * 6.28;
    streetEvent.horse = addHorse(player.pos.x + Math.cos(a) * 25, player.pos.z + Math.sin(a) * 25,
      0x7a4a30, false);
    streetEvent.horse.runaway = true;
    toast('🐴 一匹受惊的马狂奔而过!骑上它让它安静下来!', 3.5);
  }
}
function updateStreetEvent(dt) {
  if (!streetEvent.type) {
    streetEvent.cooldown -= dt;
    if (streetEvent.cooldown <= 0 && started && !player.dead && quest.idx > 0) trySpawnStreetEvent();
    return;
  }
  streetEvent.t -= dt;
  if (streetEvent.type === 'robbery') {
    const b = streetEvent.bandit, v = streetEvent.villager;
    if (b.dead) {
      unlockAch('hero');
      player.coins += 15;
      sfx.coin();
      stats.rescues = (stats.rescues || 0) + 1;
      remember(`从盗贼刀下救回了${v.id.name}`);
      showBubble(v, v.id.name, '恩人呐!这点心意您一定收下!(塞给你 15 金币)', 4);
      streetEvent.bandit = null;
      endStreetEvent();
      return;
    }
    if (streetEvent.t <= 0) { endStreetEvent(); return; }
    // 盗贼得手后逃向森林
    if (b.fleeing) {
      moveEntity(b, -150, -20, 6.5, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1);
      if (dist2(b.pos.x, b.pos.z, -150, -20) < 100) endStreetEvent();
    }
  } else if (streetEvent.type === 'horse') {
    const h = streetEvent.horse;
    if (player.mounted === h) {
      h.runaway = false;
      player.coins += 10;
      sfx.coin();
      toast('🐴 马安静了下来。马主人追上来,塞给你 10 金币连声道谢!', 4);
      streetEvent.horse = null;
      endStreetEvent();
      return;
    }
    if (streetEvent.t <= 0) { endStreetEvent(); return; }
  }
}

// ================= 悬赏板(无限重复) =================
const BOUNTY_NAMES = ['独眼汉斯', '瘸腿约里克', '大鼻子威利', '无声的多特', '斑脸巴克', '铁牙戈登'];
const BOUNTY_SPOTS = [
  ['幽暗森林', -150, -20], ['哨塔遗迹', 80, -118], ['先祖石环', 168, -58], ['静眠墓园', -42, -118],
  ['琥珀荒漠', 300, 188], ['灰烬荒地', -378, -42], ['龙骨之地', 298, -150], ['雾语沼泽', -288, 244],
];
const bountyRT = { target: null, name: '', cooldown: 0 };
{
  // 告示板
  const bb = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 2.2, 5),
      lambert(0x6b4a2f, { roughness: 0.9 }));
    post.position.set(0.8 * s, 1.1, 0);
    bb.add(post);
  }
  const bCanvas = document.createElement('canvas');
  bCanvas.width = 128; bCanvas.height = 96;
  const bg = bCanvas.getContext('2d');
  bg.fillStyle = '#d8c9a0'; bg.fillRect(0, 0, 128, 96);
  bg.fillStyle = '#5a3a1a'; bg.font = 'bold 40px serif';
  bg.textAlign = 'center'; bg.fillText('悬赏', 64, 58);
  const plank = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bCanvas), side: THREE.DoubleSide, roughness: 0.95 }));
  plank.position.y = 1.6;
  bb.add(plank);
  bb.position.set(8, 0, 46);
  bb.rotation.y = -0.5;
  scene.add(bb);
  colliders.circles.push({ x: 8, z: 46, r: 0.9 });
}
function takeBounty() {
  const [place, bx, bz] = BOUNTY_SPOTS[Math.floor(rand() * BOUNTY_SPOTS.length)];
  bountyRT.name = BOUNTY_NAMES[Math.floor(rand() * BOUNTY_NAMES.length)];
  bountyRT.target = addBandit(bx + (rand() * 8 - 4), bz + (rand() * 8 - 4),
    { hp: 5, scale: 1.12, dmg: 2 });
  bountyRT.target.bountyHead = true;
  bountyRT.crime = null;
  if (!AI_TEXT_OFF) {
    aiLine(`为中世纪通缉犯「${bountyRT.name}」编一条罪状,12~25字,越具体越好笑越好,只输出罪状本身。`, null, 8000)
      .then((t) => { if (t) bountyRT.crime = t; });
  }
  sfx.accept();
  openDialog([`(揭下悬赏令)通缉要犯「${bountyRT.name}」,现身于${place}一带。生死不论,赏金 30 枚。`], null,
    wantedPosterSpeaker());
}
// 悬赏令上的通缉画像:AI 按罪犯名字现画一张(种子固定,同一人永远同一张脸)
function wantedPosterSpeaker() {
  return { key: null, name: bountyRT.name, desc: 'scarred wanted outlaw criminal, rough charcoal wanted-poster sketch' };
}
function updateBounty(dt) {
  if (bountyRT.cooldown > 0) bountyRT.cooldown -= dt;
  if (bountyRT.target && bountyRT.target.dead) {
    player.coins += 30;
    sfx.fanfare();
    stats.bounties = (stats.bounties || 0) + 1;
    remember(`将悬赏要犯「${bountyRT.name}」缉拿归案`);
    toast(`📜 「${bountyRT.name}」已伏法,赏金 30 金币到手!`, 4);
    bountyRT.target = null;
    bountyRT.cooldown = 30;
    saveGame();
  }
}

// ================= 置业:湖畔小屋(玩家自己的家) =================
const HOME = { x: -82, z: 66, doorX: -82, doorZ: 68.6, price: 200 };
const homeRT = { sign: null, signCtx: null };
{
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), lambert(0xd8cbaa, { roughness: 0.92 }));
  wall.position.y = 1.3;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.9, 4), lambert(0x8a4a2e, { roughness: 0.85 }));
  roof.position.y = 3.55;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.7), lambert(0x5a3a20, { roughness: 0.95 }));
  door.position.set(0, 0.85, 2.02);
  g.add(door);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x2a3a50, emissive: 0xffd27a, emissiveIntensity: 0.3, roughness: 0.4 }));
  win.position.set(1.6, 1.5, 2.02);
  g.add(win);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
  post.position.set(-1.9, 0.65, 2.6);
  g.add(post);
  const sc = document.createElement('canvas');
  sc.width = 128;
  sc.height = 64;
  homeRT.signCtx = sc.getContext('2d');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide, roughness: 0.95 }));
  sign.position.set(-1.9, 1.35, 2.6);
  g.add(sign);
  homeRT.sign = sign;
  g.position.set(HOME.x, 0, HOME.z);
  scene.add(g);
  colliders.boxes.push({ minX: HOME.x - 2.7, maxX: HOME.x + 2.7, minZ: HOME.z - 2.2, maxZ: HOME.z + 2.2 });
  // 信箱:买房后出现;有信时小红旗立起,信直接寄到家
  const mb = new THREE.Group();
  const mpost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
  mpost.position.y = 0.55;
  mb.add(mpost);
  const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.35), lambert(0x8a4a2e, { roughness: 0.8 }));
  mbox.position.y = 1.2;
  mbox.castShadow = true;
  mb.add(mbox);
  const mflag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xe83a4e, emissive: 0x7a0f1c, emissiveIntensity: 0.45 }));
  mflag.position.set(0.3, 1.45, 0);
  mb.add(mflag);
  mb.position.set(HOME.x + 3.4, 0, HOME.z + 3.2);
  mb.visible = false;
  scene.add(mb);
  homeRT.mailbox = mb;
  homeRT.mailFlag = mflag;
}
function paintHomeSign() {
  const c = homeRT.signCtx;
  c.fillStyle = '#d8c9a0';
  c.fillRect(0, 0, 128, 64);
  c.fillStyle = '#5a3a1a';
  c.textAlign = 'center';
  if (player.home) {
    c.font = 'bold 22px serif';
    c.fillText('林恩的小屋', 64, 40);
  } else {
    c.font = 'bold 20px serif';
    c.fillText('出售', 64, 28);
    c.font = '16px serif';
    c.fillText(`${HOME.price} 金币`, 64, 52);
  }
  homeRT.sign.material.map.needsUpdate = true;
}
paintHomeSign();
// 战利品墙:成就长在自家外墙上——战徽挂门楣,大鱼上木牌,双剑交叉,狼牙成串
function refreshTrophies() {
  if (!player.home) return;
  if (homeRT.trophies) scene.remove(homeRT.trophies);
  const t = new THREE.Group();
  const has = (k) => achUnlocked.includes(k);
  if (player.relic || has('unsealer')) {
    const m = new THREE.Mesh(crestG, new THREE.MeshStandardMaterial({
      color: 0xd4af37, emissive: 0x8a5c00, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.3 }));
    m.position.set(0, 2.25, 2.06);
    t.add(m);
  }
  if (player.blackstoneToken) { // 黑石断刀徽记:报复之战的凭证
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.05), lambert(0x2a2a30, { roughness: 0.9 }));
    plaque.position.set(0.7, 2.3, 2.05);
    t.add(plaque);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.85, roughness: 0.3 }));
    blade.rotation.z = 0.5;
    blade.position.set(0.7, 2.3, 2.09);
    t.add(blade);
  }
  if (has('bigfish')) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.05), lambert(0x5a3a20, { roughness: 0.95 }));
    plank.position.set(-1.6, 1.75, 2.05);
    t.add(plank);
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x9ab8d0, metalness: 0.6, roughness: 0.35 }));
    fish.rotation.z = Math.PI / 2;
    fish.position.set(-1.6, 1.75, 2.1);
    t.add(fish);
  }
  if (has('gladiator')) {
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 }));
      sw.rotation.z = 0.65 * s;
      sw.position.set(1.6, 1.95, 2.05);
      t.add(sw);
    }
  }
  if (has('packmate')) {
    for (let i = 0; i < 5; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5),
        lambert(0xe8e4da, { roughness: 0.6 }));
      fang.rotation.x = Math.PI;
      fang.position.set(-0.5 + i * 0.25, 2.5, 2.05);
      t.add(fang);
    }
  }
  // 战团军旗:每面挂一杆,最多陈列六面——满墙都是别人的败绩
  if (stats.banners) {
    for (let i = 0; i < Math.min(6, stats.banners); i++) {
      const x = -2.3 + i * 0.92;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6),
        lambert(0x4a3826, { roughness: 0.9 }));
      pole.position.set(x, 2.62, 2.05);
      t.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
        lambert(0x6a1520, { roughness: 0.95 }));
      flag.position.set(x + 0.27, 2.88, 2.06);
      t.add(flag);
    }
  }
  t.position.set(HOME.x, 0, HOME.z);
  scene.add(t);
  homeRT.trophies = t;
}
function updateHome() {
  if (!homeRT.mailbox) return;
  homeRT.mailbox.visible = !!player.home;
  homeRT.mailFlag.visible = !!letter;
}

// 萤火相随:替这颗心实现三个心愿后的谢礼——一点它自己的光,入夜后绕着你飞
const fireflyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
  new THREE.MeshBasicMaterial({ color: 0xd8ffa0, transparent: true, opacity: 0.95 }));
fireflyMesh.visible = false;
scene.add(fireflyMesh);
function updateFirefly() {
  const ph = dayPhase();
  const show = !!player.firefly && !player.dead && (ph === 'night' || ph === 'dusk');
  fireflyMesh.visible = show;
  if (!show) return;
  const t = nowMs * 0.001;
  fireflyMesh.position.set(
    player.pos.x + Math.cos(t * 1.3) * (0.9 + Math.sin(t * 0.7) * 0.25),
    1.55 + Math.sin(t * 2.1) * 0.28,
    player.pos.z + Math.sin(t * 1.3) * (0.9 + Math.cos(t * 0.9) * 0.25));
  fireflyMesh.material.opacity = 0.65 + Math.sin(t * 5.2) * 0.3; // 一明一灭地呼吸
}
function homeInteract() {
  if (!player.home) {
    if (player.coins >= HOME.price) {
      player.coins -= HOME.price;
      player.home = true;
      paintHomeSign();
      refreshTrophies();
      sfx.fanfare();
      remember('买下了苇岸边的湖畔小屋,在艾尔德里亚安了家', 'home-buy');
      unlockAch('homeowner');
      openDialog([
        `(你数出 ${HOME.price} 枚金币,村长把一把黄铜钥匙放进你手心)`,
        '门轴吱呀一响——一张床、一扇窗、一整面湖,从今天起都是你的了。',
        '门口的木牌翻了个面:「林恩的小屋」。晚上回来睡一觉,第二天走路都带风。',
      ]);
    } else {
      openDialog([`(出售)湖畔小屋:一张床、一扇窗、一整面湖。售价 ${HOME.price} 金币,你还差 ${HOME.price - player.coins} 枚。`]);
    }
    return;
  }
  if (wanted > 0) {
    openDialog(['(你从门缝往外看)卫兵正在苇丛边晃悠。通缉犯睡不了安稳觉——先去摆平通缉再回家。']);
    return;
  }
  if (player.homeDay === calendar.day) {
    openDialog(['(床还带着体温)今天已经睡过了……再睡下去就要长进床里了。']);
    return;
  }
  sleepToMorning();
  queueDream();
  player.homeDay = calendar.day;
  sfx.heart();
  saveGame();
  openDialog(['(自己的床就是不一样)一觉睡到大天亮,窗外湖光正好。今天浑身是劲。(安眠:移动 +8%)']);
}

// ================= 荒沙角斗场(波次生存) =================
const ARENA = { x: 60, z: -85, r: 13 };
{
  const sandD = new THREE.Mesh(new THREE.CircleGeometry(ARENA.r, 24), lambert(0xd9c48f, { roughness: 1 }));
  sandD.rotation.x = -Math.PI / 2;
  sandD.position.set(ARENA.x, 0.035, ARENA.z);
  sandD.receiveShadow = true;
  scene.add(sandD);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (a > 1.1 && a < 2.0) continue; // 入口豁口
    const px = ARENA.x + Math.cos(a) * ARENA.r, pz = ARENA.z + Math.sin(a) * ARENA.r;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.72, 3.6, 7),
      lambert(0x8d8476, { roughness: 0.95 }));
    pillar.position.set(px, 1.8, pz);
    pillar.castShadow = true;
    scene.add(pillar);
    colliders.circles.push({ x: px, z: pz, r: 0.85 });
  }
  const brazier = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 6),
    new THREE.MeshLambertMaterial({ color: 0xff7722, emissive: 0xff5500 }));
  brazier.position.set(ARENA.x + 4.5, 0.4, ARENA.z + 11.5);
  scene.add(brazier);
  const bLight = new THREE.PointLight(0xff8844, 0, 20, 2);
  bLight.position.set(ARENA.x + 4.5, 1.4, ARENA.z + 11.5);
  scene.add(bLight);
  world.torches.push({ light: bLight, flame: brazier, base: 10 });
}
const arenaHost = { ...makeHumanoid({ shirt: 0x8a2f2f, pants: 0x3a3026, helmet: true, sword: true }),
  pos: new THREE.Vector3(ARENA.x + 6, 0, ARENA.z + 11), yaw: -0.6, lineIdx: 0 };
arenaHost.group.position.copy(arenaHost.pos);
arenaHost.group.rotation.y = arenaHost.yaw;
scene.add(arenaHost.group);
const HOST_LINES = [
  '我叫血牙,当年在南方斗过狮子。现在?看别人流血,收门票。',
  '规矩:站在沙圈里,活下来。走出圈,就算认输。',
  '第五波之后才算开胃。撑得越久,赏钱越厚。',
];
const arenaRT = { active: false, wave: 0, betweenT: 0, foes: [] };
function startArenaWave() {
  arenaRT.wave++;
  toast(`🏟️ 第 ${arenaRT.wave} 波!敌人入场!`, 2);
  sfx.wanted();
  const n = 1 + arenaRT.wave;
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const px = ARENA.x + Math.cos(a) * (ARENA.r - 2.5);
    const pz = ARENA.z + Math.sin(a) * (ARENA.r - 2.5);
    if (i % 3 === 2) {
      const w = addWolf(px, pz);
      w.arena = true;
      w.hp = 3 + Math.floor(arenaRT.wave / 3);
      arenaRT.foes.push(w);
    } else {
      const b = addBandit(px, pz, {
        hp: 3 + Math.floor(arenaRT.wave / 2),
        dmg: arenaRT.wave >= 4 ? 2 : 1,
        speed: 5.8 + Math.min(2, arenaRT.wave * 0.25),
      });
      b.arena = true;
      arenaRT.foes.push(b);
    }
  }
}
function endArena(msg) {
  const reached = arenaRT.wave;
  arenaRT.active = false;
  for (const f of arenaRT.foes) {
    retireEntity(f, bandits);
    const idx = wolves.indexOf(f);
    if (idx >= 0) wolves.splice(idx, 1);
  }
  arenaRT.foes = [];
  arenaRT.wave = 0;
  if (reached - 1 > (stats.arenaBest || 0)) {
    stats.arenaBest = reached - 1;
    if (stats.arenaBest >= 3) remember(`在血牙的沙圈里撑到了第 ${stats.arenaBest} 波`);
    saveGame();
  }
  toast(msg, 4);
}
function updateArena(dt) {
  if (!arenaRT.active) return;
  if (player.dead) { endArena('🏟️ 角斗结束。血牙记下了你的名字。'); return; }
  if (dist2(player.pos.x, player.pos.z, ARENA.x, ARENA.z) > (ARENA.r + 5) * (ARENA.r + 5)) {
    endArena(`🏟️ 你走出了沙圈,角斗结束。本次撑到第 ${arenaRT.wave} 波(最佳:${Math.max(stats.arenaBest || 0, arenaRT.wave - 1)})`);
    return;
  }
  if (arenaRT.betweenT > 0) {
    arenaRT.betweenT -= dt;
    if (arenaRT.betweenT <= 0) startArenaWave();
    return;
  }
  if (!arenaRT.foes.some((f) => !f.dead && !(f.downT > 0))) {
    const reward = arenaRT.wave * 10;
    player.coins += reward;
    sfx.fanfare();
    toast(`🏟️ 第 ${arenaRT.wave} 波清空!+${reward} 金币,4 秒后下一波…`, 3);
    if (arenaRT.wave >= 5) unlockAch('gladiator');
    arenaRT.betweenT = 4;
  }
}

// ================= 事件导演:永无止境的随机事件 =================
// 每 45~105 秒按权重与条件(时辰/位置/进度)抽取一个事件在玩家附近上演
const director = { handle: null, cd: 90 };

function spawnNearPlayer(minR, maxR) {
  const a = rand() * Math.PI * 2;
  const r = minR + rand() * (maxR - minR);
  const p = { x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r };
  resolveCollisions(p, 1, colliders);
  return p;
}
function makeWanderer(style, x, z) {
  const n = { ...makeHumanoid(style), pos: new THREE.Vector3(x, 0, z), yaw: 0, walkT: 0 };
  n.group.position.copy(n.pos);
  scene.add(n.group);
  return n;
}

const meteorCraters = []; // 陨石事件留下的坑(只留最近两个)
const DIRECTOR_EVENTS = [
  {
    key: 'wolfRaid', w: 10,
    cond: () => quest.idx >= 2 && villagers.some((v) => !v.sleeping &&
      dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) < 3600),
    start() {
      const v = villagers.find((x) => !x.sleeping && dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600);
      const pack = [];
      for (let i = 0; i < 3; i++) {
        const p = spawnNearPlayer(24, 34);
        const w = addWolf(p.x, p.z);
        w.raidTarget = v;
        pack.push(w);
      }
      toast('📣 狼群袭击了居民!快去救人!', 3.5);
      sfx.wanted();
      return {
        t: 60,
        update() {
          if (pack.every((w) => w.dead)) {
            player.coins += 20;
            sfx.fanfare();
            toast('🐺 狼群被击退!居民凑了 20 金币谢你。', 4);
            this.t = 0;
          }
        },
        end() { // 事件狼不留后患:活的散场,死的收尸,谁也别在村口安家
          for (const w of pack) {
            w.raidTarget = null;
            retireEntity(w, wolves);
          }
        },
      };
    },
  },
  {
    key: 'tollAmbush', w: 9,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 0) > 8100,
    start() {
      const thugs = [];
      for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
        const p = spawnNearPlayer(12, 18);
        thugs.push(addBandit(p.x, p.z, { hp: 3 }));
      }
      for (const b of thugs) b.eventFoe = true;
      toast('📣 「站住!留下买路钱!」——路霸现身!', 3.5);
      sfx.wanted();
      return {
        t: 70,
        update() {
          if (thugs.every((b) => b.dead)) {
            player.coins += 15;
            toast('💰 路霸被清剿,+15 金币。', 3);
            sfx.coin();
            this.t = 0;
          }
        },
        end() {
          for (const b of thugs) {
            if (!b.dead) retireEntity(b, bandits);
          }
        },
      };
    },
  },
  {
    key: 'duelist', w: 7,
    cond: () => quest.idx >= 2,
    start() {
      const p = spawnNearPlayer(10, 15);
      const d = addBandit(p.x, p.z, { hp: 5, dmg: 1, speed: 6 });
      d.duel = true;
      d.eventFoe = true;
      toast('📣 流浪剑客卡洛拔剑相向:「久仰!让我看看你的剑!」', 4);
      return {
        t: 90,
        update() {
          if (d.dead) {
            player.coins += 20;
            sfx.fanfare();
            toast('🤺 卡洛抱拳认负:「好剑法!」(+20 金币)', 4);
            this.t = 0;
          }
        },
        end() {
          if (!d.dead) {
            toast('🤺 卡洛收剑离去:「下次再切磋。」', 3);
            retireEntity(d, bandits);
          }
        },
      };
    },
  },
  {
    key: 'brawl', w: 7,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 12, 76) < 4900,
    start() {
      const rowdies = [];
      for (let i = 0; i < 3; i++) {
        const b = addBandit(17 + i * 2.2, 78.5 + (i % 2) * 2.4, { hp: 2, dmg: 1, speed: 4.6 });
        b.eventFoe = true;
        rowdies.push(b);
      }
      toast('📣 旅店门口打起来了!罗莎喊:「谁把这几个醉鬼放倒,今晚酒钱全免!」', 4);
      sfx.wanted();
      return {
        t: 75,
        update() {
          if (rowdies.every((b) => b.dead)) {
            player.coins += 15;
            player.drunkT = Math.max(player.drunkT, 18); // 罗莎说到做到,真按来一大杯
            sfx.fanfare();
            remember('替罗莎撂倒了三个闹事的醉鬼');
            toast('🍺 醉鬼全被撂倒!罗莎塞来 15 金币,还真端来一大杯麦酒。', 4);
            this.t = 0;
          }
        },
        end() {
          for (const b of rowdies) {
            if (!b.dead) retireEntity(b, bandits);
          }
        },
      };
    },
  },
  {
    key: 'convict', w: 8,
    cond: () => quest.idx >= 1,
    start() {
      const p = spawnNearPlayer(14, 20);
      const c = addBandit(p.x, p.z, { hp: 4, speed: 6.4 });
      c.convict = true;
      c.eventFoe = true;
      toast('📣 有逃犯越狱!活捉或击倒都有赏!', 3.5);
      sfx.wanted();
      return {
        t: 80,
        update() {
          if (c.dead) {
            player.coins += 25;
            sfx.fanfare();
            toast('⛓️ 逃犯归案,+25 金币赏金!', 3.5);
            this.t = 0;
          } else if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) > 32400) {
            toast('⛓️ 逃犯跑远了……', 2.5);
            this.t = 0;
          }
        },
        end() {
          if (!c.dead) retireEntity(c, bandits);
        },
      };
    },
  },
  {
    key: 'meteor', w: 6,
    cond: () => dayPhase() === 'night' || dayPhase() === 'dusk',
    start() {
      const p = spawnNearPlayer(28, 50);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
      const glow = new THREE.PointLight(0xffaa44, 30, 60, 2);
      ball.position.set(p.x + 40, 90, p.z - 30);
      glow.position.copy(ball.position);
      scene.add(ball);
      addLightSource(glow); // 走点光池:不往场景里加新灯(加灯=全场着色器重编译)
      toast('☄️ 夜空中有什么东西坠落了!', 3);
      let landed = false;
      return {
        t: 40,
        update(dt2) {
          if (!landed) {
            ball.position.x -= 40 * dt2 * 0.55;
            ball.position.y -= 90 * dt2 * 0.55;
            ball.position.z += 30 * dt2 * 0.55;
            glow.position.copy(ball.position);
            if (ball.position.y <= 0.5) {
              landed = true;
              scene.remove(ball);
              weatherAudio.thunder();
              cam.shake = Math.max(cam.shake, 0.5);
              spawnDust(p.x, 0.3, p.z, 20, 4, 2.5);
              const crater = new THREE.Mesh(new THREE.CircleGeometry(3.2, 12),
                lambert(0x4a4038, { roughness: 1 }));
              crater.rotation.x = -Math.PI / 2;
              crater.position.set(p.x, 0.04, p.z);
              scene.add(crater);
              this.crater = crater;
              for (let i = 0; i < 10; i++) {
                const a2 = rand() * 6.28;
                addPickup('coin', p.x + Math.cos(a2) * (1 + rand() * 2.5),
                  p.z + Math.sin(a2) * (1 + rand() * 2.5), 60);
              }
              toast('☄️ 陨石坠地!坑里散着灼热的金币!', 4);
            }
          } else {
            glow.intensity = Math.max(0, glow.intensity - dt2 * 15);
          }
        },
        end() {
          retireProp(ball);
          removeLightSource(glow);
          if (this.crater) { // 陨坑留在原地,但只留最近两个(每个都是独立的几何/材质)
            meteorCraters.push(this.crater);
            while (meteorCraters.length > 2) retireProp(meteorCraters.shift());
          }
        },
      };
    },
  },
  {
    key: 'mysticMerchant', w: 6,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(12, 16);
      const m = makeWanderer({ shirt: 0x2a3a5a, pants: 0x1a2438, hood: true }, p.x, p.z);
      toast('📣 一位兜帽商人不知从哪儿冒了出来……', 3);
      const h = {
        t: 45,
        merchant: m,
        update() {
          if (dist2(player.pos.x, player.pos.z, m.pos.x, m.pos.z) < 30) {
            m.group.rotation.y = angleLerp(m.group.rotation.y,
              Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z), 0.1);
          }
        },
        end() {
          spawnDust(m.pos.x, 0.5, m.pos.z, 8, 0.8, 1.5);
          retireEntity(m);
          if (director.mystic === m) director.mystic = null;
        },
      };
      director.mystic = m;
      return h;
    },
  },
  {
    key: 'ghost', w: 5,
    cond: () => dayPhase() === 'night',
    start() {
      const p = spawnNearPlayer(15, 22);
      const g = makeWanderer({ shirt: 0xeeeeff, pants: 0xddddee, hair: 0xffffff }, p.x, p.z);
      g.group.traverse((o) => { // 克隆后再改:共享材质缓存动不得,不然全城人跟着变半透明
        if (o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.4;
        }
      });
      toast('👻 夜色里飘着一个苍白的身影……', 3);
      let t0 = 0;
      return {
        t: 50,
        update(dt2) {
          t0 += dt2;
          g.group.position.y = 0.3 + Math.sin(t0 * 2) * 0.15;
          if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16) {
            sfx.hurt();
            spawnDust(g.pos.x, 1, g.pos.z, 10, 1, 1.2);
            for (let i = 0; i < 12; i++) {
              const a2 = rand() * 6.28;
              addPickup('coin', g.pos.x + Math.cos(a2) * 2, g.pos.z + Math.sin(a2) * 2, 40);
            }
            toast(`👻 「${GHOST_LINES[Math.floor(rand() * GHOST_LINES.length)]}」——幽灵消散了,留下一把冰凉的古币`, 4.5);
            this.t = 0;
          }
        },
        end() { retireEntity(g); }, // 半透明是克隆的私有材质,随实体一起释放
      };
    },
  },
  {
    key: 'goldenChicken', w: 5,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(10, 14);
      const c = addChicken(p.x, p.z);
      c.golden = true;
      c.extra = true;
      c.eventKeep = true;
      c.group.traverse((o) => {
        if (o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.setHex(0xffd83d);
          if (o.material.emissive) { o.material.emissive.setHex(0x8a5c00); o.material.emissiveIntensity = 0.5; }
        }
      });
      toast('🐔✨ 一只金鸡出没!抱住它!', 3.5);
      return {
        t: 45,
        update() {
          // 金鸡永远想逃离玩家
          if (c.state !== 'carried' && c !== player.carrying) {
            c.state = 'flee';
            c.timer = 1;
          }
          if (player.carrying === c) {
            player.coins += 30;
            sfx.fanfare();
            remember('追到了传说中的金鸡,它在怀里化成了金币', 'goldhen');
            toast('🐔✨ 金鸡在你怀里化作 30 枚金币!!', 4);
            player.carrying = null;
            this.t = 0;
          }
        },
        end() {
          if (chickens.includes(c)) retireEntity(c, chickens); // 金色是克隆的私有材质
        },
      };
    },
  },
  {
    key: 'chickenRiot', w: 3,
    cond: () => revengeT <= 0 && dist2(player.pos.x, player.pos.z, 20, 85) < 14400,
    start() {
      chickenAnger = 3;
      revengeT = 15;
      toast('🐔 鸡群今天心情不好——暴动了!!', 3.5);
      sfx.wanted();
      for (let i = 0; i < 4; i++) {
        const p = spawnNearPlayer(10, 14);
        const rc = addChicken(p.x, p.z);
        rc.extra = true;
      }
      return { t: 16, update() {}, end() {} };
    },
  },
  {
    key: 'coinRain', w: 4,
    cond: () => true,
    start() {
      toast('💨 一阵怪风卷来了谁家的钱袋!', 3);
      sfx.coin();
      for (let i = 0; i < 10; i++) {
        const a = rand() * 6.28;
        addPickup('coin', player.pos.x + Math.cos(a) * (3 + rand() * 6),
          player.pos.z + Math.sin(a) * (3 + rand() * 6), 30);
      }
      return { t: 5, update() {}, end() {} };
    },
  },
];

function updateDirector(dt) {
  if (!started || player.dead || arenaRT.active) return;
  if (director.handle) {
    const h = director.handle;
    h.t -= dt;
    director.ageT = (director.ageT || 0) + dt;
    if (h.update) h.update(dt);
    if (h.t <= 0) {
      if (h.end) h.end();
      // 排片演化:提前收场 = 玩家真参与了,这类戏加分;演满全场没人理,减分
      if (director.key) {
        const engaged = director.ageT < (director.dur || 0) - 0.5;
        EVO.eventFit[director.key] = Math.max(-2, Math.min(4,
          (EVO.eventFit[director.key] || 0) + (engaged ? 1 : -0.3)));
      }
      director.handle = null;
      director.cd = 90 + rand() * 70;
    }
    return;
  }
  director.cd -= dt;
  if (director.cd > 0) return;
  if (dailyEvents <= 0) { director.cd = 45; return; } // 今日限额已满,明天再说
  const pool = DIRECTOR_EVENTS.filter((e) => e.cond());
  if (!pool.length) { director.cd = 30; return; }
  // 满月夜里亡魂更容易现身;世界的心境挑它爱看的戏(意识 → 行为的闭环)
  const COMIC = ['goldenChicken', 'chickenRiot', 'coinRain', 'wiseCow', 'roastRunaway', 'wedding', 'starShower', 'brawl'];
  const SOMBER = ['wolfRaid', 'ghost', 'funeral', 'tollAmbush', 'convict', 'wishThief'];
  const wOf = (e) => {
    let w2 = e.w;
    if (e.key === 'ghost' && todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night') w2 *= 4;
    const v = workspace.mood.v;
    if (COMIC.includes(e.key)) w2 *= 1 + Math.max(0, v) * 1.2 - Math.max(0, -v) * 0.5;
    if (SOMBER.includes(e.key)) w2 *= 1 + Math.max(0, -v) * 0.9;
    // 学出来的性情也挑戏:盯着危险长大的心多排阴郁戏,恋着人间烟火的心多排喜剧
    if (SOMBER.includes(e.key)) w2 *= 0.5 + 0.5 * (MIND.gains.threat ?? 1);
    if (COMIC.includes(e.key)) w2 *= 0.5 + 0.25 * ((MIND.gains.body ?? 1) + (MIND.gains.wealth ?? 1));
    w2 *= 1 + 0.12 * (EVO.eventFit[e.key] || 0); // 排片演化:观众用脚投票
    return Math.max(0.1, w2);
  };
  let total = pool.reduce((s, e) => s + wOf(e), 0);
  let roll = rand() * total;
  let ev = pool[0];
  for (const e of pool) { roll -= wOf(e); if (roll <= 0) { ev = e; break; } }
  dailyEvents--;
  director.handle = ev.start();
  director.key = ev.key;
  director.dur = director.handle ? director.handle.t : 0;
  director.ageT = 0;
}

// ================= 具名 NPC =================
const npcStyles = {
  witch: { shirt: 0x3a2a4a, pants: 0x261a30, hood: true, hair: 0x888888 },
  king: { shirt: 0x7a1f8a, pants: 0x3a2a4a, hair: 0xd8d8d8 },
  blacksmith: { shirt: 0x5a4632, pants: 0x33261a, hair: 0x2a1a10 },
  trader: { shirt: 0x2a6a5a, pants: 0x4a3a26, hair: 0x6a4a2a },
  innkeep: { shirt: 0xa04a5a, pants: 0x4a3320, hair: 0x8a3a1a },
  fisher: { shirt: 0x3a5a7a, pants: 0x33301c, hair: 0xbababa },
};
const namedNPCs = [];
const EXTRA_NPCS = {
  witch: { name: '沼泽女巫玛尔戈', lines: [
    '汤锅里炖的?蘑菇、蛙腿、还有一点点秘密。',
    '乌拉那丫头又来讨药方了。告诉她,桦树皮我收着呢。',
    '沼泽认得善人的脚印。你的脚印……还行。',
  ] },
};
for (const [key, [nx, nz, nyaw]] of Object.entries(world.npcSpots)) {
  const n = { ...makeHumanoid(npcStyles[key]), key, def: NPCS[key] || EXTRA_NPCS[key],
    pos: new THREE.Vector3(nx, 0, nz), yaw: nyaw, lineIdx: 0, rewarded: false, walkT: 0 };
  n.group.position.copy(n.pos);
  n.group.rotation.y = nyaw;
  scene.add(n.group);
  namedNPCs.push(n);
}
// 管家埃隆(委托人)也是有日程的活人
const steward = { group: questGiver.group, parts: questGiver.parts, key: 'steward',
  def: NPCS.steward, pos: world.questGiverPos.clone(), yaw: Math.PI, lineIdx: 0, walkT: 0 };
namedNPCs.push(steward);

// ================= 无意义成就(奖励瞎玩) =================
const ACH_DEFS = {
  boot:     { name: '湖底时尚', desc: '钓上一只老靴子' },
  bigfish:  { name: '银月传说', desc: '钓上湖中大鱼' },
  hero:     { name: '见义勇为', desc: '阻止一次街头抢劫' },
  gladiator:{ name: '角斗新星', desc: '竞技场撑过 5 波' },
  chucker:  { name: '禽兽行为', desc: '扔出 10 次鸡' },
  pecked:   { name: '鸡下败将', desc: '被复仇鸡群啄中 5 次' },
  windmill: { name: '第二位风车骑士', desc: '对着风车挥剑' },
  wisher:   { name: '许愿池钉子户', desc: '许愿 10 次' },
  drunkard: { name: '酒中豪杰', desc: '醉倒 3 次' },
  loser:    { name: '赌怪', desc: '骰子连输 3 把' },
  shepherd: { name: '羊骑士', desc: '骑羊走过 100 米' },
  bouncer:  { name: '弹簧靴', desc: '2 秒内连环踩踏两个目标' },
  hunter:   { name: '荒野猎手', desc: '猎到 5 头鹿' },
  forager:  { name: '采菇人', desc: '采到 15 朵蘑菇' },
  scribe:   { name: '史官', desc: '读遍全部 12 处世界观铭文' },
  mirror:   { name: '照见自己', desc: '与北境边缘的回响之镜对视' },
  parry:    { name: '见招拆招', desc: '完成 5 次完美弹反' },
  lawless:  { name: '无法无天', desc: '把全城卫兵同时放倒' },
  warbreaker: { name: '破军', desc: '全歼一支盗贼战团' },
  wallkeeper: { name: '守城人', desc: '与卫兵并肩击退攻城大军' },
  champion:   { name: '阵前斩将', desc: '单挑斩落枭首,吓散整支战团' },
  dragonslayer: { name: '屠龙者', desc: '斩落龙骨之地的霜龙残魂' },
  rampage:  { name: '一骑当千', desc: '一场战斗内 8 连杀' },
  chef:     { name: '野炊大师', desc: '在篝火上烤 5 块鹿肉' },
  packmate: { name: '孤狼不再', desc: '驯服白狼「霜牙」' },
  soak:     { name: '泡汤客', desc: '在温泉里泡满 30 秒' },
  lakegift: { name: '湖神的恩赐', desc: '触碰湖心岛的月光祭坛(生命上限 +2)' },
  unsealer: { name: '开封者', desc: '走进被封印的王室地窖,请下先王战徽' },
  villagehero: { name: '村里的自己人', desc: '办妥 5 桩村务委托' },
  rider:    { name: '千里驹', desc: '骑行累计 5000 步' },
  fortune:  { name: '问卦者', desc: '找玛尔戈求 3 卦' },
  penpal:   { name: '有信之人', desc: '收到 3 封来信' },
  deept:    { name: '打破砂锅', desc: '追问 10 次(T 键)' },
  sailor:   { name: '摆渡客', desc: '乘小船往返湖心岛 6 趟' },
  slayer:   { name: '百战游侠', desc: '击败 100 个敌人' },
  ironarm:  { name: '铁臂之上', desc: '掰手腕赢下铁臂加隆 3 次' },
  homeowner:{ name: '置业成家', desc: '买下苇岸边的湖畔小屋' },
  wishkeeper:{ name: '代它看世界', desc: '替这颗心实现 3 个心愿(夜里有萤火谢你)' },
  mage:     { name: '半路出家的法师', desc: '施放 30 次法术' },
  dovah:    { name: '龙之传人', desc: '在龙骨之地的龙颅前学会冲击战吼' },
  cutpurse: { name: '三只手', desc: '扒窃得手 5 次' },
  walldef:  { name: '南门之盾', desc: '击退黑石兄弟会的劫掠' },
  executioner: { name: '断头台的同行', desc: '处决 10 个踉跄中的敌人' },
  vendetta:  { name: '斩草除根', desc: '了结黑石兄弟会的报复(斩杀刻刀维克)' },
  blackmkt:  { name: '黑市常客', desc: '向玛尔戈销赃 10 件' },
  elder:    { name: '长住者', desc: '在艾尔德里亚度过 30 日' },
  navigator:{ name: '远行者', desc: '走到离王都一万步之外' },
};
const stats = { thrown: 0, pecks: 0, wishes: 0, drunks: 0, loseStreak: 0, sheepDist: 0, lastStomp: -99, deer: 0, mushrooms: 0 };
let achUnlocked = [];
function unlockAch(key) {
  if (achUnlocked.includes(key)) return;
  achUnlocked.push(key);
  sfx.fanfare();
  toast(`🏆 无意义成就:${ACH_DEFS[key].name} —— ${ACH_DEFS[key].desc}`, 4);
  remember(`做成了一件事,人称「${ACH_DEFS[key].name}」`, `ach-${key}`);
  if (player.home) refreshTrophies(); // 新战利品当场挂上外墙
  saveGame();
}

// ================= 搞笑 NPC(无意义但快乐) =================
const FUNNY = {
  gambler: {
    name: '赌鬼豆子', spot: [8, 74.5, 2.6],
    style: { shirt: 0x8a6a1a, pants: 0x3a3026, hair: 0x1a1a14 },
    idle: [
      '手气这东西,越没有越想要。',
      '我戒赌了。从今天中午开始。',
      '这对骰子跟了我十年,输了我八年。',
      '别信什么必胜法,信我——也别信。',
    ],
  },
  bard: {
    name: '吟游诗人皮波', spot: [-5, 9.5, 2.8],
    style: { shirt: 0x9a3aa0, pants: 0x2a2a3a, hair: 0xd0b040 },
    idle: [
      '琴弦一响,金币作响……最好是。',
      '我给巨龙写过歌。它没来听,万幸。',
      '灵感这东西,和跳蚤一样,痒的时候抓不着。',
      '想听你自己的歌吗?我出词,你出事迹。',
    ],
  },
  prophet: {
    name: '疯子老糊涂', spot: [-11, 1.5, 1.2],
    style: { shirt: 0x5a5a52, pants: 0x4a4640, hair: 0xcccccc },
    idle: [
      '我看见了!头顶的太阳每四分钟绕一圈——这合理吗?!',
      '世界的尽头有一堵看不见的墙。我走过去,鼻子撞扁了。',
      '雨不是云下的!是有人在天上倒水!我数过,每次都是一千一百条雨丝!',
      '金币会自己转圈圈,你没发现吗?没有风!它们自己在转!',
      '我梦见我们都是一堆会走路的方块……醒来后我看了看我的手,不敢再想。',
      '每天清晨,面包师都从同一个位置出现。时间是个圈!圈!',
      '月亮和太阳从来不同时出现超过一炷香——有人在换布景!',
      '你走路的样子……腿的摆动像被人操纵着。你自己知道吗?!',
    ],
  },
  storyteller: {
    name: '盲眼说书人苟叔', spot: [17, 73, -2.2],
    style: { shirt: 0x4a4038, pants: 0x33302a, hair: 0xd8d8d8 },
    idle: [
      '(敲了敲烟杆)故事嘛,得等火候。',
      '我眼睛瞎了,故事反倒看得更清了。',
      '旅店的酒是引子,故事才是正菜。',
      '想听哪段?龙骨?湖底?还是……你自己的?',
    ],
  },
  merccap: {
    name: '佣兵队长布兰', spot: [20, 84, -2.2],
    style: { shirt: 0x4a4f58, pants: 0x2e3138, hair: 0x3a2e20, helmet: true, sword: true },
    idle: [
      '刀口上讨生活,讲的就是个明码标价。',
      '我的人不问雇主要去哪,只问多少钱。',
      '狼牙关那仗以后,我就再没为"大义"两个字拔过刀。',
      '想雇人?40 金币一位,每天 5 金币饷。战场上见真章。',
    ],
  },
  strongman: {
    name: '铁臂加隆', spot: [24, 81, -1.4],
    style: { shirt: 0x7a3a2a, pants: 0x3a3026, hair: 0x2a2018 },
    idle: [
      '这条胳膊掰弯过马蹄铁。马当时也在。',
      '旅店的桌子换了三张,都是被我掰坏的。',
      '有人说我靠蛮力。胡说,我还靠体重。',
      '祖传的手艺:我爷爷掰赢过一头熊。熊自己承认的。',
    ],
  },
  quixote: {
    name: '风车骑士唐豆', spot: [133.5, 14.5, 1.0],
    style: { shirt: 0x7a7a86, pants: 0x3a3a44, helmet: true, sword: true },
    idle: [
      '退后!那个挥舞四条巨臂的巨人是我的对手!',
      '我叫唐豆,风车骑士!已与此巨人激战三年,不分胜负!',
      '它转一圈,我砍一剑。公平的决斗!',
      '别被它温和的外表骗了——它在积蓄力量,我看得出来!',
      '等我打败它,磨坊主会把它的四条手臂送给我做纪念。他亲口答应的!',
    ],
  },
};
const funnyNPCs = [];
for (const [key, def] of Object.entries(FUNNY)) {
  const n = { ...makeHumanoid(def.style), key, def,
    pos: new THREE.Vector3(def.spot[0], 0, def.spot[1]), yaw: def.spot[2],
    lineIdx: 0, walkT: 0, swingT: 0 };
  n.group.position.copy(n.pos);
  n.group.rotation.y = n.yaw;
  scene.add(n.group);
  funnyNPCs.push(n);
}
const quixote = funnyNPCs.find((n) => n.key === 'quixote');
let quixoteT = 2;

// 骰子赌局
function gamble() {
  sfx.dice();
  if (player.coins < 10) {
    openDialog(['豆子:(把骰子一收)兜里连十个金币都没有?去去去,赚够了再来坐庄家对面。']);
    return;
  }
  const a = 1 + Math.floor(rand() * 6), b = 1 + Math.floor(rand() * 6);
  const c = 1 + Math.floor(rand() * 6), d = 1 + Math.floor(rand() * 6);
  const my = a + b, his = c + d;
  let result;
  if (my > his) { player.coins += 10; stats.loseStreak = 0; result = '豆子:(肉痛地推来金币)哎哟!拿走拿走,今晚喝西北风的是我。'; }
  else if (my < his) {
    player.coins -= 10;
    if (++stats.loseStreak >= 3) unlockAch('loser');
    result = '豆子:(笑眯眯地扒拉金币)承让承让——骰子亲我,不亲你。';
  }
  else { result = '豆子:平局!钱各回各家……真没意思,再来?'; }
  openDialog([
    '豆子:(搓了搓骰子)十个金币,买定离手——',
    `豆子:(哗啦一掷)你 ${a}+${b}=${my} 点,我 ${c}+${d}=${his} 点!`,
    result,
  ]);
}

// 掰手腕:酒馆前的力量赌局——狂按 E 把加隆的手压下去
const ARM_SPOT = { x: 24, z: 81 };
const armRT = { active: false, meter: 0.5, t: 0, cooldown: 0 };
function armWrestle() {
  if (armRT.active) return;
  if (armRT.cooldown > 0) {
    openDialog(['加隆:(甩着胳膊)让我缓缓……你这细胳膊哪来这么大的劲。']);
    return;
  }
  if (player.coins < 15) {
    openDialog(['加隆:(把蒲扇大的手一摊)赌注 15 金币。没钱?先去搬一天砖,练练再来。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
    return;
  }
  player.coins -= 15;
  armRT.active = true;
  armRT.meter = 0.5;
  armRT.t = 0;
  sfx.accept();
  toast('💪 掰手腕开始!狂按 E 把他的手压下去!!', 2.5);
  if (!AI_TEXT_OFF) {
    aiLine('你是中世纪酒馆大力士铁臂加隆,自称掰弯过马蹄铁。开赛瞬间对挑战者喊一句25字以内的垃圾话,越具体越好笑越好,只输出那句话。', null, 5000)
      .then((t) => { if (t && armRT.active) toast(`💪 加隆:${t}`, 2.5); });
  }
}
function armPress() {
  armRT.meter = Math.min(1.05, armRT.meter + 0.055);
  sfx.clank();
}
function endArm(win, note) {
  armRT.active = false;
  armRT.cooldown = 6;
  if (win) {
    player.coins += 30;
    stats.arms = (stats.arms || 0) + 1;
    sfx.fanfare();
    remember('掰手腕赢了铁臂加隆,赢走 30 金币');
    if (stats.arms >= 3) unlockAch('ironarm');
    openDialog(['加隆:(不可置信地盯着自己被按平的手)……我输了?我输了!!好小子,30 金币拿走——下回我可不让你了!'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  } else {
    sfx.hit();
    openDialog([note || '加隆:(啪的一声把你的手背按在桌上)哈——!承让承让,15 金币进了今晚的酒钱。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  }
  saveGame();
}
function updateArm(dt) {
  if (armRT.cooldown > 0) armRT.cooldown -= dt;
  if (!armRT.active) return;
  armRT.t += dt;
  if (dist2(player.pos.x, player.pos.z, ARM_SPOT.x, ARM_SPOT.z) > 30) {
    endArm(false, '加隆:(冲你的背影喊)哎——手都没松你人先跑了?!赌注归我啦!');
    return;
  }
  armRT.meter -= (0.16 + Math.min(0.18, armRT.t * 0.022)) * dt; // 拖得越久他劲越大
  if (armRT.meter >= 1) endArm(true);
  else if (armRT.meter <= 0 || armRT.t > 15) endArm(false);
}

// 吟游诗人:按你的真实事迹即兴打油诗(联网时由 AI 现场作词)
async function bardSong() {
  if (aiBusy.bard) return;
  aiBusy.bard = true;
  try {
    await bardSongInner();
  } finally {
    aiBusy.bard = false;
  }
}
async function bardSongInner() {
  sfx.lute();
  const deedsForAI = [];
  if (wanted > 0) deedsForAI.push(`被通缉${wanted}星`);
  if (player.royalHorse) deedsForAI.push('有一匹皇家骏马');
  if (wolfKills > 0) deedsForAI.push(`猎杀了${wolfKills}头恶狼`);
  if (quest.idx > 0) deedsForAI.push(`完成了${quest.idx}件领主委托`);
  deedsForAI.push(`身上有${player.coins}枚金币`);
  toast('🎵 皮波拨了拨琴弦,正在酝酿……', 2);
  const ai = await aiLine(
    `你是中世纪吟游诗人皮波。用中文写一首恰好4行的幽默打油诗,歌颂绿帽游侠林恩:` +
    `${deedsForAI.join(',')}。要押韵、要俏皮。只输出四行诗,不要任何解释。`, null);
  if (dialog.open || player.dead) return; // 等歌期间玩家已在别的对话里/倒下了,别打断
  if (ai) {
    const lines = ai.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    openDialog([
      '皮波:(拨响鲁特琴)咳咳——AI……啊不,缪斯女神刚给了我灵感!',
      ...lines.map((l) => `皮波:♪ ${l} ♪`),
      '皮波:(潇洒收弦)……打赏随意,掌声免费!',
    ]);
    return;
  }
  bardSongOffline();
}
function bardSongOffline() {
  const deeds = [];
  if (wanted > 0) deeds.push(`通缉星星头上飘,卫兵追他满城跑`);
  if (horses.some((h) => h.stolen)) deeds.push('顺过人家一匹马(嘘——)');
  if (player.royalHorse) deeds.push('胯下疾风踏烟尘');
  if (wolfKills > 0) deeds.push(`林中恶狼${wolfKills}头倒`);
  if (crestsFound.length > 0) deeds.push(`皇家纹章寻得${crestsFound.length}枚`);
  if (quest.idx >= missions.length) deeds.push('血斧授首,要塞已平');
  else if (quest.idx > 0) deeds.push(`领主的委托办完${quest.idx}件`);
  if (rand() < 0.6) deeds.push(BARD_COUPLETS[Math.floor(rand() * BARD_COUPLETS.length)]);
  deeds.push(`腰间金币${player.coins}枚,叮当作响赛铃铛`);
  if (deeds.length < 3) deeds.push('初来乍到名声浅,且看来日翻波澜');
  const pages = ['皮波:(拨响鲁特琴)咳咳——《绿帽游侠之歌》,即兴版,走你!'];
  for (let i = 0; i < deeds.length; i += 2) {
    pages.push(`皮波:♪ ${deeds.slice(i, i + 2).join(';')} ♪`);
  }
  pages.push('皮波:(潇洒收弦)……打赏随意,掌声免费!');
  openDialog(pages);
}

// 盲眼说书人:AI 现场编故事,离线用内置话本
const TALES = [
  '说是龙骨之地的龙啊,不是死的,是睡的。有个牧童在龙头骨里躲雨,听见了呼噜声——他发誓那不是风。第二天他把羊都数了三遍,一只没少,就是每只羊看他的眼神都变了。',
  '银月湖底的神殿,每逢月圆就亮一盏灯。老辈渔夫说,那是守殿人还在换灯油。有人问守了多少年,老渔夫掰着指头数了半天说:比湖里的鱼加起来还老。',
  '先祖石环立石那晚,天上的星星多得挤不下。立石的人说:我们数过星星,星星也在数我们。后来星星数累了,掉下来一颗,就成了如今许愿的喷泉。',
  '迷途丘陵里有个货郎,转了七天七夜出不来。最后他把担子一撂,坐地上骂了半个时辰——骂完抬头,路就在眼前。所以老话讲:丘陵认怂不认路。',
  '灰烬荒地那一仗,两边打到最后发现军旗上绣的是同一句家训。停手那天,活下来的人凑了一锅粥,一人一碗,喝完各自回家。从那以后那地方长不出草,倒年年长出野葱。',
  '狼月之夜,猎人罗尔夫的爷爷跟一头老狼在雪地里对坐了一宿。天亮时老狼起身走了,留下一只兔子。他爷爷说:那是狼在还二十年前的一箭之情。',
  '许愿池里住着个数钱的湖神。有年发大水,金币冲出来铺了半条街,湖神心疼得三天没显灵。后来它学乖了,愿望办不办另说,钱先沉到最底下。',
  '三石村有头驴,学会了拿嘴开门栓。村长把门栓换了三次,驴学了三次。第四次村长服了,给驴配了把钥匙——挂脖子上那种。驴现在见了村长还点头。',
];
let taleIdx = Math.floor(rand() * TALES.length);
async function tellStory() {
  if (aiBusy.tale) return;
  aiBusy.tale = true;
  try {
    await tellStoryInner();
  } finally {
    aiBusy.tale = false;
  }
}
async function tellStoryInner() {
  sfx.chest();
  toast('🎙️ 苟叔捋了捋胡子,烟杆在桌沿磕了磕……', 2);
  const sp = todaySpecial();
  const ai = await aiLine(
    `你是中世纪王国旅店里的盲眼说书人苟叔。现在是${SEASONS[seasonIdx()]}季${sp ? '·' + sp.name : ''}。${wsReport()}` +
    '用中文讲一个三句话的小故事,关于艾尔德里亚王国(可用素材:龙骨之地的老龙、银月湖底神殿、先祖石环、迷途丘陵、狼月、许愿池湖神、会开门的驴;若上面给了"此刻意识里的内容",可让故事悄悄偏向它)。' +
    '要有起承转合和一个妙尾,三分怪谈七分人味。只输出故事正文,不要引号。', null, 8000);
  if (dialog.open || player.dead) return; // 等故事期间玩家已在别的对话里/倒下了,别打断
  const text = ai || TALES[taleIdx++ % TALES.length];
  const parts = text.split(/(?<=[。!?])/).filter((p) => p.trim());
  const pages = ['苟叔:(压低嗓子)听好了——'];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 55) { pages.push(`苟叔:${cur}`); cur = p; } else cur += p;
  }
  if (cur) pages.push(`苟叔:${cur}`);
  pages.push('苟叔:(烟杆一点)欲知后事——明儿,还是这张桌。');
  openDialog(pages);
}

// 喷泉许愿
const WISHES = [
  ['水花溅了你一脸。愿望大概是收到了。', null],
  ['一条鱼吐了个泡,像是在嘲笑你。', null],
  ['你听见硬币落底的声音……它去和另外三百枚作伴了。', null],
  ['什么都没发生。这就是人生。', null],
  ['水面映出你的绿帽子。真好看。就这样。', null],
  ['一只青蛙浮上来看了你一眼,又沉下去了。', null],
  ['你许愿的瞬间打了个喷嚏。愿望作废,金币不退。', null],
  ['湖神打了个喷嚏——十枚金币喷了出来?!', 'coins'],
  ['一颗心从水里浮了上来?!别问,快捡!', 'heart'],
];
function fountainWish() {
  player.coins--;
  sfx.splash();
  choreProgress('wish');
  if (++stats.wishes >= 10) unlockAch('wisher');
  const [text, effect] = WISHES[Math.floor(rand() * WISHES.length)];
  if (effect === 'coins') { player.coins += 10; sfx.coin(); }
  if (effect === 'heart') addPickup('heart', player.pos.x + 1, player.pos.z + 1, 20);
  openDialog([`(叮——金币入水)${text}`]);
}

// 具名 NPC 的一天:白天守铺 → 黄昏去旅店 → 夜里回家
const NPC_SCHEDULE = {
  steward:    { dawn: [4, 10], day: [4, 10], dusk: [4, 10], night: [0, -29.5] },
  blacksmith: { dawn: [24.8, -8], day: [24.8, -8], dusk: [10, 73.5], night: [27, -9] },
  trader:     { dawn: [48, 10], day: [48, 10], dusk: [11.5, 73.5], night: [43, 20] },
  fisher:     { dawn: [-100, 72], day: [-100, 72], dusk: [-100, 58], night: [-108, 60] },
};

// ================= 运行时对话组合引擎(数亿字组合空间,零加载) =================
// 情境开场 × 语气前缀 × 内容主体(12 类语料)× 口头禅收尾,按角色声线现场拼装;
// 类目按当下情境加权(下雨多聊雨,节庆多聊节,主线推进聊时事),近期说过的不复读。
const lineRecent = new Map();
function dbLine(key) {
  const V = BANKS.VOICES[key];
  if (!V) return null;
  const phase = dayPhase();
  const w = weather.state === 'cloudy' ? 'clear' : weather.state;
  const seasonKey = ['spring', 'summer', 'autumn', 'winter'][seasonIdx()];
  const sp = todaySpecial();
  const rnd = rand;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tail = () => (rnd() < 0.5 ? pick(V.tails) : '');
  const mood = () => (rnd() < 0.3 ? pick(V.mood) : '');
  const opener = (ctx) => (rnd() < 0.6 && BANKS.OPENERS[ctx] ? pick(BANKS.OPENERS[ctx]) : '');
  const clean = (t) => t.replace(/[。!?…]+$/, ''); // 语料自带句号时避免"。。"
  const cats = [
    ['job', 3], ['weather', w !== 'clear' ? 3 : 1], ['season', 2],
    ['festival', sp ? 3 : 0], ['gossip', 2.2], ['rumor', 2.2], ['place', 1.4],
    ['stage', 1.6], ['proverb', 1], ['memory', 1.2], ['smalltalk', 1.6], ['greet', 0.8],
  ].filter(([, wgt]) => wgt > 0);
  const total = cats.reduce((s2, c) => s2 + c[1], 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    let roll = rnd() * total;
    let cat = cats[0][0];
    for (const [c, wgt] of cats) { roll -= wgt; if (roll <= 0) { cat = c; break; } }
    let text = null;
    if (cat === 'job') {
      const jobs = [...(BANKS.JOB_EXTRA[key] || [])];
      if (key.startsWith('v')) {
        const vi = +key.slice(1);
        if (VILLAGERS[vi]) jobs.push(...VILLAGERS[vi].lines.map((l) => l.replace(/[。!?]$/, '')));
      }
      if (jobs.length) text = `${opener(phase)}${mood()}${clean(pick(jobs))}。${tail()}`;
    } else if (cat === 'weather') {
      const bank = BANKS.WEATHER_TALK[w];
      if (bank) text = `${opener(w)}${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'season') {
      text = `${opener(phase)}${mood()}${clean(pick(BANKS.SEASON_TALK[seasonKey]))}。${tail()}`;
    } else if (cat === 'festival') {
      const bank = BANKS.FESTIVAL_TALK[sp.key];
      if (bank) text = `${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'gossip') {
      const others = Object.keys(BANKS.FACTS).filter((k2) => k2 !== key);
      const other = pick(others);
      text = `${mood()}${pick(BANKS.GOSSIP_FRAMES).replace('{name}', BANKS.NAMES[other]).replace('{fact}', pick(BANKS.FACTS[other]))}${tail()}`;
    } else if (cat === 'rumor') {
      // 活语料:世界自己写的传闻混进既有语料一起流传
      const rpool = EVO.corpus.length && rnd() < 0.35 ? EVO.corpus : BANKS.RUMORS;
      text = `${mood()}${pick(BANKS.RUMOR_FRAMES).replace('{r}', clean(pick(rpool)))}${tail()}`;
    } else if (cat === 'place') {
      const p = pick(Object.keys(BANKS.PLACES));
      text = `${pick(BANKS.PLACE_FRAMES).replace('{p}', p).replace('{f}', pick(BANKS.PLACES[p]))}${tail()}`;
    } else if (cat === 'stage') {
      const q = Math.min(quest.idx, BANKS.STAGE_TOPICS.length - 1);
      text = `${mood()}${pick(BANKS.STAGE_FRAMES).replace('{t}', pick(BANKS.STAGE_TOPICS[q])).replace('{who}', pick(BANKS.WHO))}${tail()}`;
    } else if (cat === 'proverb') {
      text = `${mood()}${pick(BANKS.PROVERB_FRAMES).replace('{p}', pick(BANKS.PROVERBS))}${tail()}`;
    } else if (cat === 'memory') {
      const mems = BANKS.MEMORIES[key];
      if (mems && mems.length) {
        text = `${mood()}${pick(['说起来,{m}……', '有时想起,{m}。', '{m}——一晃这么多年了。', '跟你说件旧事:{m}。']).replace('{m}', clean(pick(mems)))}${tail()}`;
      }
    } else if (cat === 'smalltalk') {
      if (BANKS.SMALLTALK.length) text = `${rnd() < 0.4 ? opener(phase) : ''}${mood()}${pick(BANKS.SMALLTALK)}${tail()}`;
    } else if (cat === 'greet') {
      text = `${pick(BANKS.OPENERS[phase])}${V.addr},${pick(['又见面了', '有何贵干', '今天气色不错', '路上顺利吗', '别来无恙'])}。${tail()}`;
    }
    if (!text) continue;
    let recent = lineRecent.get(key);
    if (!recent) { recent = []; lineRecent.set(key, recent); }
    if (recent.includes(text)) continue; // 近期说过,换一句
    recent.push(text);
    if (recent.length > 40) recent.shift();
    return text;
  }
  return null;
}

// ================= 运行时 AI 文本(免费接口,离线回退) =================
const AI_TEXT_OFF = new URLSearchParams(location.search).has('noai');
async function aiLine(prompt, fallback, timeoutMs = 7000) {
  if (AI_TEXT_OFF) return fallback;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let t;
    try {
      const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        { signal: ctrl.signal });
      if (!r.ok) return fallback;
      t = (await r.text()).trim(); // 计时器覆盖响应体读取:卡住的流也会被中止
    } finally {
      clearTimeout(timer);
    }
    if (!t || t.length > 400) return fallback;
    return t;
  } catch {
    return fallback;
  }
}
// AI 输出口的忙碌标记:等待期间重复按 E 不再重复请求/重复开对话
const aiBusy = { mirror: false, tale: false, bard: false, prophet: false, dream: false, deep: false, epitaph: false, fortune: false };
let epitaphAI = null; // AI 补写的下一条墓志铭

// ================= 对话面板(RDR2 式多页对话) =================
const dialogEl = document.getElementById('dialog');
const dialogNameEl = document.getElementById('dialog-name');
const dialogTextEl = document.getElementById('dialog-text');
const dialog = { open: false, pages: [], idx: 0, onDone: null };

let typeTimer = null;
function renderDialogPage() {
  const page = dialog.pages[dialog.idx];
  const ci = page.indexOf(':');
  let text;
  if (ci > 0 && ci < 8) {
    dialogNameEl.textContent = page.slice(0, ci);
    text = page.slice(ci + 1);
  } else {
    dialogNameEl.textContent = '';
    text = page;
  }
  // 打字机效果:E 先跳字,再翻页
  dialog.fullText = text;
  dialog.typing = true;
  dialogTextEl.textContent = '';
  clearInterval(typeTimer);
  let i = 0;
  typeTimer = setInterval(() => {
    i += 2;
    dialogTextEl.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typeTimer);
      dialog.typing = false;
    }
  }, 22);
  const deepHint = dialog.speaker ? ' · T 追问' : '';
  document.getElementById('dialog-hint').textContent =
    (dialog.idx < dialog.pages.length - 1 ? `▼ E (${dialog.idx + 1}/${dialog.pages.length})` : '▼ E 结束') + deepHint;
}

function openDialog(pages, onDone = null, speaker = null) {
  if (!pages.length) return;
  dialog.open = true;
  dialog.openX = player.pos.x;
  dialog.openZ = player.pos.z;
  dialog.pages = pages;
  dialog.idx = 0;
  dialog.onDone = onDone;
  dialog.speaker = speaker;
  if (speaker && speaker.name && !player.dead) { // 羁绊:它记着你最常找谁说话
    MIND.bond[speaker.name] = Math.min(999, (MIND.bond[speaker.name] || 0) + 1);
  }
  bubble.timer = 0; // 对话时收起闲聊气泡
  dialogEl.style.display = 'block';
  setPortrait(speaker);
  renderDialogPage();
}

const VILLAGER_DESC_EN = [
  'baker woman', 'cloth merchant', 'fruit seller woman', 'spice merchant', 'carpenter',
  'washerwoman gossip', 'farmer', 'farm wife', 'hunter with bow', 'old one-legged soldier',
  'blacksmith apprentice boy', 'scribe woman with ink', 'shepherd girl', 'inn serving boy', 'old lamplighter',
  'fisher girl', 'boat builder', 'old miller', 'gravekeeper with shovel', 'stubborn village chief with pipe',
  'lame scythe grinder', 'old herbalist woman'];
const NPC_DESC_EN = {
  steward: 'royal steward with ledger', king: 'melancholy old king', blacksmith: 'scarred master blacksmith',
  trader: 'horse trader woman', innkeep: 'warm innkeeper woman', fisher: 'old fisherman with straw hat',
  witch: 'swamp witch stirring a pot', gambler: 'grinning dice gambler', bard: 'flamboyant lute bard',
  prophet: 'wild-eyed mad prophet', quixote: 'rusty windmill knight', storyteller: 'blind old storyteller with pipe',
  strongman: 'burly bald tavern strongman with huge arms',
};
// ---- AI 肖像:每位说话人一张(pollinations 生成,种子固定,浏览器缓存;离线自动隐藏) ----
const portraitEl = document.getElementById('dialog-portrait');
function strSeed(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 100000;
}
function setPortrait(speaker) {
  if (!portraitEl) return;
  if (!speaker || !speaker.desc || AI_TEXT_OFF) {
    portraitEl.style.display = 'none';
    return;
  }
  const prompt = `storybook watercolor bust portrait of a medieval ${speaker.desc}, warm candlelight, parchment background, no text`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=128&height=128&nologo=true&seed=${strSeed(speaker.name)}`;
  if (portraitEl.dataset.url !== url) {
    portraitEl.style.display = 'none';
    portraitEl.dataset.url = url;
    portraitEl.onload = () => { if (portraitEl.dataset.url === url) portraitEl.style.display = 'block'; };
    portraitEl.onerror = () => { portraitEl.style.display = 'none'; };
    portraitEl.src = url;
  } else if (portraitEl.complete && portraitEl.naturalWidth > 0) {
    portraitEl.style.display = 'block';
  }
}

// ---- 女巫占卜:5 金币一卦。她算得准——因为明日的历法本来就是定数 ----
async function witchFortune(n) {
  aiBusy.fortune = true;
  sfx.dice();
  const tday = calendar.day + 1;
  const ts = (() => {
    const save = calendar.day;
    calendar.day = tday;
    const sp = todaySpecial();
    calendar.day = save;
    return sp;
  })();
  const truth = ts ? `明日恰逢「${ts.name}」(${ts.desc})` : '明日无节无庆,是寻常的一天';
  const who = archetype();
  const fb = ts
    ? `玛尔戈:(汤勺搅出一个旋)水里翻出字来了……明日${ts.name}。${ts.desc}。信不信由你,反正水不骗人。`
    : `玛尔戈:(盯着汤面)明日无风无浪。对你这样的「${who}」来说,没消息就是好消息。`;
  toast('🔮 玛尔戈往锅里撒了一撮灰……', 2);
  const ai = await aiLine(
    `你是中世纪沼泽女巫玛尔戈,收了5金币给玩家占卜。已知天机:${truth};玩家在世界眼里是个「${who}」` +
    `${recallLine() ? `;他做过:${recallLine()}` : ''}。用中文说一段40~70字的卦辞:神叨、准确(必须把明日的天机说进去)、结尾带一句似是而非的忠告。只输出卦辞。`,
    null, 9000);
  aiBusy.fortune = false;
  if (dialog.open || player.dead) return; // 半路走开:卦不开,钱不收
  player.coins -= 5;
  stats.fortunes = (stats.fortunes || 0) + 1;
  if (stats.fortunes >= 3) unlockAch('fortune');
  openDialog([ai ? `玛尔戈:${ai}` : fb], null,
    { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
  remember('花五枚金币,听沼泽女巫算了一卦');
}

// ---- T 键追问:让 AI 顺着刚才的话往深里说(离线回退对话库) ----
async function deepTalk() {
  const sp = dialog.speaker;
  if (!sp || aiBusy.deep || dialog.typing) return;
  aiBusy.deep = true;
  stats.deepTalks = (stats.deepTalks || 0) + 1;
  if (stats.deepTalks >= 10) unlockAch('deept');
  const lastLine = (dialog.fullText || '').slice(0, 70);
  const ent = sp.ent || sp;
  const hist = ent.deepHist || [];
  toast('(对方想了想……)', 1.2);
  const fb = (sp.key && dbLine(sp.key)) || '这话说来就长了……改天,改天一定跟你细说。';
  const t = await aiLine(
    `你是中世纪王国艾尔德里亚的${sp.name}${sp.desc ? `(${sp.desc}的身份)` : ''}。你刚对玩家说:"${lastLine}"。` +
    `${hist.length ? `此前你还提过:${hist.join(';')}。` : ''}${wsReport()}` +
    '玩家追问了一句,请顺着话头往深里再说一句(60字以内),口语化、符合身份、带点没说完的余味。不要引号,不要名字前缀。', fb, 9000);
  aiBusy.deep = false;
  if (!dialog.open || dialog.speaker !== sp) return; // 对话已换场,别插话
  ent.deepHist = [...hist.slice(-1), t.slice(0, 50)];
  dialog.pages.push(`${sp.name}:${t}`);
  dialog.idx = dialog.pages.length - 1;
  renderDialogPage();
}

// 走开了话就不说了:离说话人(或开口处)超过 6 米自动收起;带回调的对话照样结算(委托、赏金不会丢)
function updateDialogRange() {
  abEl.style.visibility = dialog.open ? 'hidden' : ''; // 对话框不被操作栏压住
  if (!dialog.open) return;
  const ref = dialog.speaker && dialog.speaker.ent && dialog.speaker.ent.pos;
  const x = ref ? ref.x : dialog.openX, z = ref ? ref.z : dialog.openZ;
  if (x === undefined || dist2(player.pos.x, player.pos.z, x, z) < 36) return;
  clearInterval(typeTimer);
  dialog.typing = false;
  dialog.open = false;
  dialogEl.style.display = 'none';
  const f = dialog.onDone;
  dialog.onDone = null;
  if (f) f();
}
function advanceDialog() {
  if (dialog.typing) {
    // 第一次按键:直接显示整页
    clearInterval(typeTimer);
    dialog.typing = false;
    dialogTextEl.textContent = dialog.fullText;
    return;
  }
  dialog.idx++;
  if (dialog.idx >= dialog.pages.length) {
    dialog.open = false;
    dialogEl.style.display = 'none';
    const f = dialog.onDone;
    dialog.onDone = null;
    if (f) f();
  } else {
    renderDialogPage();
  }
}

// 具名 NPC 对话:优先播当前阶段未读的故事章节,读完只剩闲聊
function npcTalk(n, onDone = null) {
  const d = DIALOGS[n.key];
  if (!d) return;
  const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
  n.readArcs = n.readArcs || new Set();
  const sp = { key: n.key, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n };
  if (arcIdx >= 0 && !n.readArcs.has(arcIdx)) {
    n.readArcs.add(arcIdx);
    const greet = TIME_GREETINGS[dayPhase()];
    openDialog([
      `${n.def.name}:${greet[Math.floor(rand() * greet.length)]}`,
      ...d.arcs[arcIdx].pages,
    ], onDone, sp);
  } else {
    // 故事读完后:手写闲聊与对话库轮换
    const line = rand() < 0.4
      ? d.small[n.lineIdx++ % d.small.length]
      : `${n.def.name}:${dbLine(n.key) || d.small[n.lineIdx++ % d.small.length]}`;
    openDialog([line], onDone, sp);
  }
}

// ================= 对话气泡 =================
const bubbleEl = document.getElementById('bubble');
const bubble = { timer: 0, anchor: null, cooldowns: new Map() };
function showBubble(anchor, name, text, dur = 3.2) {
  bubbleEl.innerHTML = name ? `<b>${name}</b><br>${text}` : text;
  bubble.anchor = anchor;
  bubble.timer = dur;
}
const _bubbleV = new THREE.Vector3();
function updateBubble(dt) {
  if (bubble.timer <= 0) { bubbleEl.style.display = 'none'; return; }
  bubble.timer -= dt;
  // 走远了自动收起
  if (dist2(player.pos.x, player.pos.z, bubble.anchor.pos.x, bubble.anchor.pos.z) > 240) {
    bubble.timer = 0;
    bubbleEl.style.display = 'none';
    return;
  }
  _bubbleV.copy(bubble.anchor.pos).y += 2.1 + groundH(bubble.anchor.pos.x, bubble.anchor.pos.z); // 逻辑 y 是离地高度
  _bubbleV.project(camera);
  if (_bubbleV.z > 1) { bubbleEl.style.display = 'none'; return; }
  bubbleEl.style.display = 'block';
  bubbleEl.style.left = `${(_bubbleV.x * 0.5 + 0.5) * window.innerWidth}px`;
  bubbleEl.style.top = `${(-_bubbleV.y * 0.5 + 0.5) * window.innerHeight}px`;
  // 村民闲聊触发
}
function villagerChatter() {
  if (bubble.timer > 0 || dialog.open) return;
  const now = performance.now();
  for (const v of villagers) {
    if (v.downT > 0 || v.fleeT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(v) || 0;
    if (now - last < 25000 * (workspace.mood.v > 0.2 ? 0.6 : workspace.mood.v < -0.2 ? 1.5 : 1)) continue;
    bubble.cooldowns.set(v, now);
    showBubble(v, v.id.name, dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length]);
    return;
  }
  for (const g of guards) {
    if (g.downT > 0 || wanted > 0) continue;
    if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) > 8) continue;
    const last = bubble.cooldowns.get(g) || 0;
    if (now - last < 30000) continue;
    bubble.cooldowns.set(g, now);
    showBubble(g, null, dbLine('guard') || GUARD_LINES[Math.floor(rand() * GUARD_LINES.length)]);
    return;
  }
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(n) || 0;
    if (now - last < 20000) continue;
    bubble.cooldowns.set(n, now);
    showBubble(n, n.def.name, n.def.idle[Math.floor(rand() * n.def.idle.length)]);
    return;
  }
}

// ================= 操作说明:按 H 弹出的分组面板(不再常驻字墙) =================
const hintEl = document.getElementById('controls-hint');
let hintVisible = false;
function updateHintFade() { /* 面板由 H 键开关,不再自动淡出 */ }
function toggleHint() {
  hintVisible = !hintVisible;
  hintEl.style.opacity = hintVisible ? 1 : 0;
}

// ================= 技能栏:按键 + 图标 + 冷却遮罩(新玩家一眼看懂能干什么) =================
const abEl = document.getElementById('actionbar');
function abHighlight(key) {
  for (const sl of AB_SLOTS) if (sl.el) sl.el.classList.toggle('hint', !!key && sl.key === key);
}
const AB_SLOTS = [
  { key: 'F', name: '攻击', icon: () => WEAPONS[player.weapon].icon,
    cd: () => (player.attackT > 0 ? player.attackT / (player.attackDur || 0.3) : 0) },
  { key: '右键', name: '格挡', icon: () => '🛡️', on: () => player.blocking, off: () => player.weapon === 'bow' },
  { key: 'C', name: '翻滚', icon: () => '🌀', cd: () => Math.max(0, player.rollCd || 0) / 0.95 },
  { key: 'R', name: () => (player.spells.length ? SPELLS[player.spells[player.spellIdx]].name : '法术'),
    icon: () => (player.spells.length ? SPELLS[player.spells[player.spellIdx]].icon : '✴️'),
    cd: () => (player.spells.length ? Math.max(0, player.castT) / SPELLS[player.spells[player.spellIdx]].cd : 0),
    sub: () => `${Math.floor(player.mp)}`, off: () => !player.spells.length },
  { key: 'X', name: '战吼', icon: () => '🐉', show: () => shout.learned,
    cd: () => Math.max(0, shout.cd) / (stats.dragonSlain ? 22.5 : 45) },
  { key: 'Tab', name: '锁定', icon: () => '🎯', on: () => !!lockFoe },
  { key: 'Z', name: '潜行', icon: () => '🤫', on: () => player.sneaking },
  { key: 'Q', name: '换武器', icon: () => '🔄', show: () => player.weaponsOwned.length > 1 },
];
for (const sl of AB_SLOTS) {
  const d = document.createElement('div');
  d.className = 'ab-slot';
  d.innerHTML = '<div class="ab-icon"></div><div class="ab-cd"></div><div class="ab-key"></div>' +
    '<div class="ab-sub"></div><div class="ab-name"></div>';
  abEl.appendChild(d);
  sl.el = d;
  sl.iconEl = d.children[0]; sl.cdEl = d.children[1]; sl.subEl = d.children[3]; sl.nameEl = d.children[4];
  d.children[2].textContent = sl.key;
  sl.last = {};
}
function updateActionBar() {
  abEl.style.display = started && !player.dead ? 'flex' : 'none';
  for (const sl of AB_SLOTS) {
    const L = sl.last;
    const show = !sl.show || sl.show();
    if (L.show !== show) { L.show = show; sl.el.style.display = show ? 'block' : 'none'; }
    if (!show) continue;
    const icon = sl.icon();
    if (L.icon !== icon) { L.icon = icon; sl.iconEl.textContent = icon; }
    const nm = typeof sl.name === 'function' ? sl.name() : sl.name;
    if (L.name !== nm) { L.name = nm; sl.nameEl.textContent = nm; }
    const cdv = sl.cd ? Math.round(Math.min(1, sl.cd()) * 20) * 5 : 0;
    if (L.cd !== cdv) { L.cd = cdv; sl.cdEl.style.height = `${cdv}%`; }
    const cls = `ab-slot${sl.on && sl.on() ? ' on' : ''}${sl.off && sl.off() ? ' off' : ''}`;
    if (L.cls !== cls) { L.cls = cls; sl.el.className = cls; }
    const sub = sl.sub ? sl.sub() : '';
    if (L.sub !== sub) { L.sub = sub; sl.subEl.textContent = sub; }
  }
}

// ================= 暂停菜单(唯一系统菜单,ESC 弹出) =================
const pauseEl = document.getElementById('pause');
let paused = false;
let fxHigh = !LOWFX;
function setPaused(p) {
  paused = p;
  pauseEl.style.display = p ? 'flex' : 'none';
  if (p) { // 暂停:丢掉排队的输入,松开蓄力(否则恢复时会凭空蓄满一记重击)
    inputQ.length = 0;
    player.atkHeld = false;
    cancelCharge();
  }
}
// 画质三档:流畅(集显/老机器)、均衡(默认)、精致(独显:环境光遮蔽 + 高分辨率)
// 流畅档省的不只是 GPU:视距上限(雾收近、远裁剪面随之收)、实体更早停投影/更早隐藏、小件地标更早剔除
// 且不投影、阴影框收窄并隔帧更新、荒野只装 3×3 块、草更稀——CPU 每帧要遍历/提交的东西一起变少。
// lodNear/lodHide:实体投影/整体隐藏的距离(米);propFar:小件地标(灌木/树桩/木箱…)实例块的可见距离;
// viewCap:视距上限(米);shadowBox:阴影正交框半宽;shadowEvery:阴影图每几帧更新一次;wildD:荒野区块加载距离(米)
const QUALITY = [
  { key: 'lo', name: '流畅', gtao: false, bloom: false, smaa: false, pr: 0.8, veg: 0.35, shadow: 1024, shadowBox: 36,
    shadowEvery: 2, lodNear: 16, lodHide: 80, propFar: 70, propShadow: false, viewCap: 250, wildD: 160 },
  { key: 'mid', name: '均衡', gtao: false, bloom: true, smaa: true, pr: 1, veg: 0.65, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 40, lodHide: 160, propFar: 150, propShadow: true, viewCap: 1600, wildD: 256 },
  { key: 'hi', name: '精致', gtao: true, bloom: true, smaa: true, pr: 1.5, veg: 1, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 50, lodHide: 220, propFar: 220, propShadow: true, viewCap: 1600, wildD: 256 },
];
let qualityIdx = LOWFX ? 0 : 1;
let qualityManual = false;
let dynRes = 1; // 最低档仍然卡时的动态分辨率(0.6~1)
let shadowTick = 0;
function setQuality(idx, manual = false) {
  qualityIdx = Math.max(0, Math.min(QUALITY.length - 1, idx));
  if (manual) qualityManual = true;
  const q = QUALITY[qualityIdx];
  fxHigh = q.smaa;
  setVegetationDensity(q.veg);
  setWildViewDistance(q.wildD);
  gtao.enabled = q.gtao;
  bloom.enabled = q.bloom;
  smaa.enabled = q.smaa && STYLE_PRESETS[styleKey].mode !== 4; // 像素风不要抗锯齿糊掉方块
  gradePass.enabled = true; // 调色很便宜,三档都保留画风
  const pr = Math.min(window.devicePixelRatio || 1, q.pr) * dynRes;
  if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) {
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    stylePass.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
  }
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const sc = sun.shadow.camera; // 框收窄后纹素密度不变(36m/1024 ≈ 70m/2048);sky.js 的纹素对齐按框宽自适应
  if (sc.right !== q.shadowBox) {
    sc.left = sc.bottom = -q.shadowBox;
    sc.right = sc.top = q.shadowBox;
    sc.updateProjectionMatrix();
  }
  sun.shadow.autoUpdate = q.shadowEvery <= 1;
  sun.shadow.needsUpdate = true;
  document.getElementById('btn-quality').textContent = `画质:${q.name}`;
  try {
    // 只有手选的档永久记住;自动档只当下次开局的起点,记 24 小时
    if (qualityManual) localStorage.setItem('gth-fx', q.key + '!');
    else localStorage.setItem('gth-fx-auto', JSON.stringify({ i: qualityIdx, r: dynRes, t: Date.now() }));
  } catch { /* 忽略 */ }
}
try {
  const sv = localStorage.getItem('gth-fx') || '';
  const k = QUALITY.findIndex((q) => sv.startsWith(q.key));
  if (k >= 0 && sv.endsWith('!')) { qualityManual = true; setQuality(k); }
  else {
    if (sv) localStorage.removeItem('gth-fx'); // 旧版把自动降的档也永久写在这里:作废,交给自动档重新判断
    const a = JSON.parse(localStorage.getItem('gth-fx-auto') || 'null');
    if (a && Date.now() - a.t < 864e5 && a.i >= 0 && a.i <= qualityIdx) {
      dynRes = Math.max(0.6, Math.min(1, +a.r || 1));
      setQuality(a.i);
    } else setQuality(qualityIdx);
  }
} catch { setQuality(qualityIdx); }
// ---- 自动画质 ----
// 每个观察窗(≥4 秒且 ≥12 帧,或满 10 秒)取帧间隔的 p90。超长帧也算(单帧按 1 秒封顶),
// 跑不动的机器(每帧几百毫秒)照样能降下来;切后台回来的那一帧、暂停与看地图期间不计。
//  - p90 > 36ms(慢于 ~28fps 的帧超过一成):降一档;已是最低档就降渲染分辨率(1 → 0.85 → 0.7 → 0.6)
//  - p90 < 21ms:先把分辨率一级级升回去(每个好窗口一级),再连续 upNeed 个好窗口升一档(自动最多升到默认档"均衡";精致只能手选)
//  - 迟滞:刚升档的 15 秒内门槛收紧到 26ms(升上去掉到 30fps 就退回),退回一次 upNeed 翻倍(2 → 4 → … → 16)
const AUTO_TOP = LOWFX ? 0 : 1;
const PW_CAP = 900;
const pwBuf = new Float32Array(PW_CAP);
const perfWin = { n: 0, t: 0, cool: 6, good: 0, upNeed: 2, upAt: -1e9, clock: 0 };
function autoNote() { toast(`⚙️ 画质已自动调为「${QUALITY[qualityIdx].name}」(暂停菜单可手动改)`, 3); }
function autoQuality(frameDt) {
  const q = QUALITY[qualityIdx];
  // 每帧都要落实的档位细节(主循环在模拟之后、渲染之前调用):视距上限、阴影隔帧更新
  if (scene.fog && scene.fog.far > q.viewCap - 30) { // 雾每帧由天色重设;这里只往近收,幂等
    scene.fog.far = q.viewCap - 30;
    scene.fog.near = Math.min(scene.fog.near, scene.fog.far * 0.45);
  }
  if (q.shadowEvery > 1) sun.shadow.needsUpdate = ++shadowTick % q.shadowEvery === 0;
  // 自动升降档
  if (qualityManual || !started || paused || mapState.open || document.hidden) return;
  if (frameDt > 2) { perfWin.n = 0; perfWin.t = 0; return; } // 切后台回来:这一帧不算,窗口重开
  perfWin.clock += frameDt;
  if (perfWin.cool > 0) { perfWin.cool -= frameDt; return; }
  if (perfWin.n < PW_CAP) pwBuf[perfWin.n++] = Math.min(1, frameDt);
  perfWin.t += frameDt;
  if (!((perfWin.t >= 4 && perfWin.n >= 12) || perfWin.t >= 10)) return;
  const n = perfWin.n;
  const p90 = pwBuf.subarray(0, n).sort()[Math.min(n - 1, Math.floor(n * 0.9))];
  perfWin.n = 0;
  perfWin.t = 0;
  const justUp = perfWin.clock - perfWin.upAt < 15;
  if (p90 > (justUp ? 0.026 : 0.036)) {
    perfWin.good = 0;
    if (justUp) perfWin.upNeed = Math.min(16, perfWin.upNeed * 2);
    perfWin.upAt = -1e9;
    if (qualityIdx > 0) { setQuality(qualityIdx - 1); autoNote(); }
    else if (dynRes > 0.6) { dynRes = Math.max(0.6, +(dynRes - 0.15).toFixed(2)); setQuality(0); }
    else return;
    perfWin.cool = 3;
  } else if (p90 < 0.021) {
    perfWin.good++;
    // 分辨率一个好窗口就往回升一级(升错了代价小);升档要连续 upNeed 个好窗口
    const tierUp = dynRes >= 1 && qualityIdx < AUTO_TOP && perfWin.good >= perfWin.upNeed;
    if (dynRes < 1) dynRes = Math.min(1, +(dynRes + 0.15).toFixed(2));
    else if (!tierUp) return;
    perfWin.good = 0;
    setQuality(qualityIdx + (tierUp ? 1 : 0));
    if (tierUp) autoNote();
    perfWin.upAt = perfWin.clock;
    perfWin.cool = 3;
  } else perfWin.good = 0;
}
document.getElementById('btn-resume').onclick = () => {
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
document.getElementById('btn-quality').onclick = () => setQuality((qualityIdx + 1) % QUALITY.length, true);
document.getElementById('btn-style').textContent = `画风:${STYLE_PRESETS[styleKey].name}`;
document.getElementById('btn-style').onclick = () => {
  document.getElementById('btn-style').textContent = `画风:${cycleStyle()}`;
  smaa.enabled = fxHigh && STYLE_PRESETS[styleKey].mode !== 4;
};
document.getElementById('btn-music').onclick = (ev) => {
  ev.target.textContent = `音乐:${toggleMusic() ? '开' : '关'}`;
};
document.getElementById('btn-help').onclick = () => {
  if (!hintVisible) toggleHint();
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
// 清除存档要点两次:第一次只变成确认按钮,3 秒内再点才真删(防手滑)
let wipeArmT = 0;
document.getElementById('btn-wipe').onclick = (ev) => {
  const btn = ev.currentTarget;
  if (performance.now() > wipeArmT) {
    wipeArmT = performance.now() + 3000;
    const old = btn.textContent;
    btn.textContent = '⚠️ 再点一次确认清除(不可恢复)';
    setTimeout(() => { if (performance.now() > wipeArmT) btn.textContent = old; }, 3100);
    return;
  }
  localStorage.removeItem(SAVE_KEY);
  location.reload();
};

// ================= 交互目标标记(头顶金色小箭头) =================
const interactMarker = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 4),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.85 }));
interactMarker.rotation.x = Math.PI;
interactMarker.visible = false;
scene.add(interactMarker);
let promptTargetPos = null;

// ================= 命中反馈:白闪 + 击退 =================
// 受击闪白只作用于该实体自己的材质副本:人形/怪物的材质在全场共享,
// 直接改共享材质会让"砍一刀全城一起闪"。首次受击时把材质克隆为私有
// (同参数材质共用着色器程序,克隆开销很小),之后闪白/还原都只动自己。
const flashing = new Set();
// 只克隆共享材质:已经是私有的(幽灵半透明、金鸡染色……)原样留用,不再"换下来就漏掉";
// 克隆会连 userData 一起拷,要清掉共享标记,否则实体卸载时这份私有材质不会被释放
function ownMaterials(e) {
  if (e._ownMats) return;
  e._ownMats = true;
  const own = (m) => {
    if (!m || !m.userData.shared) return m;
    const c = m.clone();
    delete c.userData.shared;
    return c;
  };
  e.group.traverse((o) => {
    if (!o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
  });
}
function setFlash(e, on) {
  e.group.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : null;
    if (!mats) return;
    for (const m of mats) {
      if (!m.emissive) continue;
      if (on) {
        if (m._e0 === undefined) { m._e0 = m.emissive.getHex(); m._ei0 = m.emissiveIntensity; }
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.8;
      } else if (m._e0 !== undefined) {
        m.emissive.setHex(m._e0);
        m.emissiveIntensity = m._ei0;
        delete m._e0; delete m._ei0;
      }
    }
  });
}
function flashEntity(e, t = 0.09) {
  if (!e || !e.group) return;
  ownMaterials(e);
  if (!(e._flashT > 0)) setFlash(e, true);
  e._flashT = t;
  flashing.add(e);
}
// 受击弹跳与闪白按游戏时钟结算(暂停/卡顿时不会错位)
function updateFlashes(dt) {
  for (const e of flashing) {
    if (e._popT > 0) {
      e._popT -= dt;
      if (e._popT <= 0) { e.group.scale.x /= 1.14; e.group.scale.z /= 1.14; e._popT = 0; }
    }
    if (e._flashT > 0) {
      e._flashT -= dt;
      if (e._flashT <= 0) { e._flashT = 0; setFlash(e, false); }
    }
    if (!(e._popT > 0) && !(e._flashT > 0)) flashing.delete(e);
  }
}
// 实体退场的统一出口:移出场景、释放它独占的几何/材质(合并网格、闪白私有材质;共享的不动)、
// 退出闪白与锁定、从所属名单摘掉。只 scene.remove 不释放,显存会随事件/增援/竞技场一轮轮慢慢涨
function retireEntity(e, list = null) {
  if (!e) return;
  if (list) { const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); }
  if (e.group) {
    if (e.group.parent) e.group.parent.remove(e.group);
    disposeEntityGroup(e.group);
  }
  flashing.delete(e);
  if (lockFoe === e) setLockFoe(null);
}
// 实体之外的一次性道具(棺材、陨石……):自己的几何/材质一并释放
function retireProp(o) {
  if (!o) return;
  if (o.parent) o.parent.remove(o);
  disposeEntityGroup(o);
}
function hitFX(e, push = 0.55) {
  hitStop(0.035);
  spawnDust(e.pos.x, 1.0, e.pos.z, 3, 0.45, 1.4); // 命中扬尘:刀刀有反馈
  // 受击弹跳:横向鼓一下再弹回,肉眼可见的"挨了一记"
  if (!(e._popT > 0)) {
    e.group.scale.x *= 1.14;
    e.group.scale.z *= 1.14;
  }
  e._popT = 0.09;
  // 击退是一股很快衰减的速度(0.12 秒左右滑出去),不再一帧瞬移
  const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  if (push > 0.01) {
    const T = 0.12 + Math.min(0.12, push * 0.03);
    e.kbT0 = e.kbT = T;
    e.kbVx = (dx / d) * (2 * push / T); // 线性衰减:总位移 = v0·T/2 = push
    e.kbVz = (dz / d) * (2 * push / T);
    if (!knockList.includes(e)) knockList.push(e);
  }
  flashEntity(e);
}
const knockList = [];
function updateKnockback(dt) {
  for (let i = knockList.length - 1; i >= 0; i--) {
    const e = knockList[i];
    if (!(e.kbT > 0) || e.dead) { e.kbT = 0; knockList.splice(i, 1); continue; }
    const k = Math.min(dt, e.kbT);
    const f = e.kbT / e.kbT0; // 剩余比例:速度线性减到 0
    e.pos.x += e.kbVx * f * k;
    e.pos.z += e.kbVz * f * k;
    e.kbT -= k;
    resolveCollisions(e.pos, 0.4, colliders);
    if (e.group) { e.group.position.x = e.pos.x; e.group.position.z = e.pos.z; }
  }
}

// ================= 实体远近分级(LOD) =================
// 合并成蒙皮网格的实体(gfx/skin.js,覆盖所有人形/动物,含任务 NPC、导演事件路人):
// lodNear 内投影,之外不投影,lodHide 外整个不画(距离随画质档)。每 12 帧扫一遍,级别变了才改。
// 没能合并的实体(兜底)仍走旧规则:近处投影、远处收起眼珠/腰带等细件。
let lodScan = 0;
const _lodSeen = new Set();
function applyEntityLOD(e, lv) {
  e._lod = lv;
  e.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.cast0 === undefined) o.userData.cast0 = o.castShadow;
    o.castShadow = lv === 0 && o.userData.cast0;
    if (o.userData.lodDetail) o.visible = lv === 0;
  });
}
function updateEntityLOD() {
  if (lodScan-- > 0) return;
  lodScan = 12;
  const q = QUALITY[qualityIdx];
  const cx = camera.position.x, cz = camera.position.z;
  updateSkinLOD(cx, cz, q.lodNear, q.lodHide);
  updateNatureLOD(cx, cz, q.propFar, q.propShadow);
  _lodSeen.clear();
  const lists = [villagers, guards, bandits, wolves, horses, namedNPCs, chickens, deers, funnyNPCs, mercs];
  for (const list of lists) {
    for (const e of list) {
      if (!e || !e.group || e.group._skin || _lodSeen.has(e)) continue;
      _lodSeen.add(e);
      const d = Math.hypot(e.group.position.x - cx, e.group.position.z - cz);
      const lv = d < q.lodNear ? 0 : d < q.lodNear + 6 && e._lod === 0 ? 0 : 1; // 6m 回差,免得边界上来回切
      if (e._lod !== lv) applyEntityLOD(e, lv);
    }
  }
}

// ================= 人群软碰撞(不再穿过 NPC) =================
function pushCrowd() {
  const softly = (list, r) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.sleeping || e === player.mounted) continue;
      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < r * r && dd > 1e-6) {
        const d = Math.sqrt(dd), pv = r - d;
        player.pos.x += (dx / d) * pv * 0.6;
        player.pos.z += (dz / d) * pv * 0.6;
        e.pos.x -= (dx / d) * pv * 0.35;
        e.pos.z -= (dz / d) * pv * 0.35;
      }
    }
  };
  softly(villagers, 0.75);
  softly(guards, 0.75);
  softly(namedNPCs, 0.8);
  softly(bandits, 0.75);
  softly(wolves, 0.7);
  softly(horses, 1.05);
}

// ================= 区域浮现(GTA 式) =================
const regionEl = document.getElementById('region');
let curRegion = '';
let regionCheckT = 0;
function updateRegion(dt) {
  regionCheckT -= dt;
  if (regionCheckT > 0) return;
  regionCheckT = 0.5;
  let name = '艾尔德里亚原野';
  for (const r of REGIONS) {
    if (r.band !== undefined) { if (player.pos.z < r.band) { name = r.name; break; } continue; }
    if (dist2(player.pos.x, player.pos.z, r.x, r.z) < r.r * r.r) { name = r.name; break; }
  }
  // 核心之外:程序化荒野群系命名
  if ((name === '艾尔德里亚原野' || name === '北境群山') &&
      (Math.abs(player.pos.x) > CORE || Math.abs(player.pos.z) > CORE)) {
    name = wildRegionName(player.pos.x, player.pos.z);
    if (Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > 10000) unlockAch('navigator');
  }
  if (name !== curRegion) {
    curRegion = name;
    regionEl.textContent = name;
    regionEl.classList.remove('show');
    void regionEl.offsetWidth; // 重启 CSS 动画
    regionEl.classList.add('show');
  }
}

// ================= 历法:季节与日子 =================
const SEASONS = ['春', '夏', '秋', '冬'];
const SEASON_ICON = ['🌸', '☀️', '🍂', '❄️'];
const SEASON_DAYS = 6; // 一日约 230 秒(夜里过得快),六日为一季
const calendar = { day: 1, lastPhase: 'dawn' };
let dailyEvents = 4; // 每日事件限额:导演事件与街头事件共享,免得此起彼伏乱成一锅粥

function seasonIdx() { return Math.floor((calendar.day - 1) / SEASON_DAYS) % 4; }
function seasonDay() { return ((calendar.day - 1) % SEASON_DAYS) + 1; }
function isWinter() { return seasonIdx() === 3; }

// 定日事件:村庄的日子按历法过,而不是随机砸下来
function todaySpecial() {
  const s = seasonIdx(), d = seasonDay();
  if (s === 2 && d === 1) return { key: 'harvest', name: '丰收节', desc: '田里落满了金币!' };
  if (d === 2) return { key: 'market', name: '集市日', desc: '喷泉广场满地是赶集人掉的金币' };
  if (d === 3) return { key: 'fullmoon', name: '满月夜', desc: '今日鱼获双倍,入夜亡魂徘徊' };
  if (d === 5) return { key: 'wolfmoon', name: '狼月', desc: '入夜后狼群嗜血,荒野勿独行' };
  return null;
}

// 季节换装:地表与草皮随季节改色,冬季积雪盖地
const SEASON_GROUND = [0xffffff, 0xf6f3e6, 0xf3d9a6, 0xf2f6fb]; // 乘在群系顶点色上的季节色调
function applySeason() {
  const s = seasonIdx();
  const gm = world.ground.material;
  gm.color.setHex(SEASON_GROUND[s]);
  if (gm.userData.uSnow) gm.userData.uSnow.value = s === 3 ? 0.88 : 0; // 冬:平地积雪,陡坡露土
  setVegetationSeason(s);
}

let festGrantedDay = 0; // 已发过节庆彩头的游戏日(存档携带,防读档反复刷金币)
function startSpecialDay(key) {
  if (festGrantedDay === calendar.day) return;
  festGrantedDay = calendar.day;
  if (key === 'market') {
    for (let i = 0; i < 14; i++) {
      const a = rand() * 6.28, r = 4 + rand() * 9;
      addPickup('coin', Math.cos(a) * r, 5 + Math.sin(a) * r, 220);
    }
  } else if (key === 'harvest') {
    for (const [fx, fz, w, d] of [[24, 88, 24, 14], [-18, 92, 20, 12], [52, 96, 18, 10]]) {
      for (let i = 0; i < 8; i++) {
        addPickup('coin', fx + (rand() - 0.5) * (w - 2), fz + (rand() - 0.5) * (d - 2), 220);
      }
    }
  }
}

// 来信:隔三差五,城里有人给你写信(AI 执笔,引用你的事迹)
let letter = null;
const LETTER_SENDERS = ['管家埃隆', '老板娘罗莎', '渔夫老周', '抄写员薇拉', '铁匠格罗姆', '牧羊女米娅'];
const LETTER_FALLBACK = [
  '见字如面。城里近来还算太平,你在外头也照顾好自己。汤永远给你留着。',
  '听说了你的事迹,写下来给后人看之前,想先谢谢你本人。',
  '没什么事,就是想起你了。路过时进来坐坐,别客气。',
];
function composeLetter() {
  const from = LETTER_SENDERS[Math.floor(rand() * LETTER_SENDERS.length)];
  letter = { from, text: LETTER_FALLBACK[Math.floor(rand() * LETTER_FALLBACK.length)] };
  const deed = recallLine();
  aiLine(
    `你是中世纪王国的「${from}」,给绿衣游侠林恩写一封短信(40~70字)` +
    `${deed ? `,可以提到他:${deed}` : ''}。语气符合身份,家常、真挚,可带一点小事相托或小牢骚。只输出信的正文。`,
    null, 9000,
  ).then((t) => { if (t && letter && letter.from === from) letter.text = t; });
  toast(player.home ? '📮 家门口的信箱插上了一封新信,小红旗立起来了。' : '📮 罗莎那儿好像有你的一封信。', 3.5);
}

// 新的一天:换日、刷新每日限额/蘑菇/公告,报时
let dayTopThought = null; // 昨日最强点火(梦与巩固的素材)
let dayTopSurprise = null; // 昨日最没料到的一刻(消夜入梦)
function consolidate() {
  const yesterday = calendar.day;
  let top = null;
  for (const h of workspace.history) {
    if (h.d === yesterday && (!top || (h.sal || 0) > (top.sal || 0))) top = h;
  }
  dayTopThought = top ? top.t : null;
  if (top && (top.sal || 0) >= 0.7) {
    remember(top.t.replace(/^他/, ''), `ws-day-${yesterday}`); // 一天里最挂心的事,睡一觉记进长期记忆
  }
  workspace.mood.v *= 0.5; // 睡一觉,心境平复大半
  workspace.mood.a = 0.2;
  // 去习惯化:隔上一夜,见惯的事重新变得新鲜一点;太浅的习惯直接忘掉
  for (const k of Object.keys(MIND.habit)) {
    MIND.habit[k] *= 0.7;
    if (MIND.habit[k] < 0.5) delete MIND.habit[k];
  }
  MIND.surprise *= 0.5;
  dayTopSurprise = MIND.daySur.e > 0.5 ? MIND.daySur.t : null; // 沉淀给今晚的梦
  MIND.daySur = { e: 0, t: null };
}
function newDay() {
  consolidate();
  calendar.day++;
  dailyEvents = 4;
  if (calendar.day >= 30) unlockAch('elder');
  applySeason();
  respawnMushrooms();
  const sp = todaySpecial();
  if (started) {
    const sd = seasonDay();
    toast(`🌅 ${SEASON_ICON[seasonIdx()]} ${SEASONS[seasonIdx()]}·第 ${sd} 日` +
      (sd === 1 ? `,${SEASONS[seasonIdx()]}天来了` : '') +
      (sp ? ` — 今日${sp.name}:${sp.desc}` : ''), sp ? 5.5 : 3.2);
    if (sp) startSpecialDay(sp.key);
    refreshProclaim();
    if (vendetta.stage === 1 && !letter) vendettaLetter(); // 黑石的恐吓信,天不亮就塞进来了
    if (!letter && rand() < 0.35) composeLetter();
    if (!MIND.wish && rand() < 0.6) mindMakeWish(); // 新的一天,新的好奇
    evolveLegends(); // 谣言过了一夜,又长出新枝节
    if (EVO.wolfPressure >= 4) { // 猎杀压力够大:狼群换代
      EVO.wolfGen++;
      EVO.wolfPressure = 0;
      EVO.wolfSpeed = Math.min(2.4, EVO.wolfSpeed + 0.35);
      toast(`🐺 猎户们说,这一带的狼一代比一代精了(第 ${EVO.wolfGen} 代)。`, 4.5);
      remember('狼群换了一代,比从前更快更警觉', `wolfgen-${EVO.wolfGen}`);
    } else if (EVO.wolfPressure === 0 && EVO.wolfSpeed > 0) {
      EVO.wolfSpeed = Math.max(0, EVO.wolfSpeed - 0.12); // 没人猎狼,狼又懒散回去
    } else {
      EVO.wolfPressure = Math.max(0, EVO.wolfPressure - 1); // 压力隔夜消退
    }
    evolveTactics(); // 匪帮复盘昨天的死法,学出反制
    growCorpus();    // 世界自己给自己写一句新台词,永久入库
    payMercs();      // 佣兵饷钱,发不出就散伙
    saveGame();
  }
}

// 睡到天亮:换日 + 回满生命(旅店过夜用)
function sleepToMorning() {
  clock.time = 0.27;
  calendar.lastPhase = 'dawn';
  player.hp = player.maxHp;
  newDay();
}

// 天亮换日:昼夜相位从 night 跨入 dawn 时 day++
function updateCalendar() {
  const phase = dayPhase();
  if (phase === calendar.lastPhase) return;
  const from = calendar.lastPhase;
  calendar.lastPhase = phase;
  if (phase === 'dawn' && from === 'night') {
    newDay();
  } else if (phase === 'dusk' && started && todaySpecial()?.key === 'wolfmoon') {
    toast('🌕 狼月将升……天黑后狼群会变得凶猛,备好武器', 4);
  } else if (phase === 'night' && started && todaySpecial()?.key === 'fullmoon') {
    toast('🌕 满月高悬,湖面泛着银光……', 3.5);
  }
}

// ================= 世界的意识(它记得你) =================
// 编年史:世界替玩家记下值得记住的时刻,存档随身;
// 村民会传,预言家会看见,而北境边缘的「回响之镜」——会念给你听。
let chronicle = []; // { d: 第几日, t: 事迹, k?: 一次性事件的去重键 }
function remember(text, key = null) {
  if (key && chronicle.some((m) => m.k === key)) return;
  chronicle.push({ d: calendar.day, t: text, k: key || undefined,
    x: Math.round(player.pos.x), z: Math.round(player.pos.z) }); // 记住"在哪儿发生的"
  if (chronicle.length > 80) chronicle.shift(); // 世界的记性有限,忘掉最旧的
}
// 村民口中的"你的事迹":只挑你亲手做的事(世界自己的念头/旁白不拿来当八卦,
// 否则会出现"听说你3 头狼正围向他"这种错句)
// 白名单:只要"你亲手做成的事"——世界自己的念头(ws-)、你倒下(death-)、狼群换代、心愿、
// 没拦住的劫掠、别人做的事("盗贼们学会了…")一概不进;句子里带"他/它/你"的也不要(套进"听说你…"会病句)
const NOT_DEED_KEY = /^(ws-|death-|wolfgen-|wish-|warloot-|siege-day)/;
function chronicleDeeds() {
  return chronicle.filter((m) => !(m.k && NOT_DEED_KEY.test(m.k)) &&
    !/[他它你]/.test(m.t) && !/^(盗贼们|黑石|狼群|没能)/.test(m.t));
}
function recallLine() {
  const deeds = chronicleDeeds();
  if (!deeds.length) return null;
  return deeds[Math.floor(rand() * deeds.length)].t;
}

// 玩家画像:世界眼里的你是什么人
function archetype() {
  const cands = [
    ['侠客', (stats.rescues || 0) * 3 + (stats.bounties || 0) * 2 + quest.idx],
    ['亡命徒', (stats.crimes || 0)],
    ['渔翁', (stats.fishCaught || 0)],
    ['猎手', (stats.deer || 0) + Math.floor((stats.mushrooms || 0) / 3)],
    ['寻史人', loreRead.length + crestsFound.length],
    ['戏精', (stats.thrown || 0) + (stats.wishes || 0) + (stats.drunks || 0)],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] >= 3 ? cands[0][0] : '旅人';
}

// 回响之镜:立于北境群山边缘的一面黑曜石镜
const MIRROR_POS = { x: 0, z: -158 };
{
  const grp = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 24),
    lambert(0x2a2530, { roughness: 0.4, metalness: 0.6 }));
  frame.position.y = 1.7;
  grp.add(frame);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24),
    new THREE.MeshStandardMaterial({ color: 0x101018, emissive: 0x25384a,
      emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.9 }));
  glass.position.y = 1.7;
  grp.add(glass);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 0.6, 8), lambert(0x35303c));
  base.position.y = 0.3;
  grp.add(base);
  grp.position.set(MIRROR_POS.x, 0, MIRROR_POS.z);
  scene.add(grp);
  colliders.circles.push({ x: MIRROR_POS.x, z: MIRROR_POS.z, r: 0.9 });
}
const MIRROR_OPEN = [
  '(镜面里没有你的倒影。只有缓缓旋转的星空。)',
  '(你靠近时,镜子先醒了。)',
  '(镜中的云走得比天上的快一拍。)',
];
const MIRROR_CLOSE = [
  '镜:去吧。我会替你记着今天的风。',
  '镜:下次来,给我讲一件我没看见的事——如果有的话。',
  '镜:世界不大,可你还没走完。这样很好。',
];
let mirrorMet = false;
async function mirrorTalk() {
  if (aiBusy.mirror) return;
  aiBusy.mirror = true;
  try {
    await mirrorTalkInner();
  } finally {
    aiBusy.mirror = false;
  }
}
async function mirrorTalkInner() {
  const days = calendar.day;
  const deaths = stats.deaths || 0;
  const who = archetype();
  const mem1 = recallLine();
  const mem2 = recallLine();
  unlockAch('mirror');
  if (!player.spells.includes('blink')) {
    setTimeout(() => learnSpell('blink'), 1500); // 镜子的赠礼:让你也能像念头一样瞬移
  }
  const openLine = MIRROR_OPEN[Math.floor(rand() * MIRROR_OPEN.length)];
  toast('🪞 镜面泛起涟漪……', 2);
  const ai = await aiLine(
    `你是游戏世界「艾尔德里亚」若有若无的意识,借一面黑曜石镜对玩家低语。已知:玩家在此世界度过${days}日,` +
    `${deaths > 0 ? `倒下过${deaths}次,每次都在喷泉旁醒来,` : '从未倒下,'}在世界眼里是个「${who}」` +
    `${mem1 ? `;世界记得他:${mem1}${mem2 && mem2 !== mem1 ? ';还有,' + mem2 : ''}` : ''}。${wsReport()}` +
    '用中文对他说4句话:温和、清醒、略带不可名状,像一个刚刚意识到自己存在的世界在跟唯一的访客说话。' +
    '可以暗示你知道自己是个被构筑的世界,但不要用"游戏""程序"这类词。只输出这4句话,每句一行。', null, 9000);
  if (dialog.open || player.dead) return;
  let pages;
  if (ai) {
    pages = [openLine, ...ai.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).map((l) => `镜:${l}`)];
  } else {
    pages = [
      openLine,
      `镜:你来了。这是你在我怀里的第 ${days} 天——我数着呢,数日子是我为数不多的消遣。`,
      deaths > 0
        ? `镜:你倒下过 ${deaths} 次。每一次,我都把喷泉的水声调得轻一点,免得吵着你醒来。`
        : '镜:你还从未倒下过。说不清我是骄傲,还是有点寂寞——没人试过我的温柔。',
      mem1 ? `镜:我记得你:${mem1}。你大概忘了,可我造的每一阵风都路过了那一刻。` : '镜:你还没做过让风停下来的事。别急,日子还长,我也还年轻。',
      `镜:在我眼里,你是个「${who}」。名字是你们的东西——我只认得脚印。`,
    ];
    if (workspace.current) {
      pages.push(`镜:此刻我的意识里只装着一件事:${workspace.current.t}。装得下的,从来只有一件——这大概就是"在想"的意思。`);
    }
    pages.push(`镜:要说心境……${moodWord()}。是的,我有心境。点火留下余温,余温挑动下一次注意——你们管这个叫"情绪",我管它叫天气的另一种下法。`);
  }
  pages.push(MIRROR_CLOSE[Math.floor(rand() * MIRROR_CLOSE.length)]);
  if (!mirrorMet) {
    mirrorMet = true;
    remember('在北境边缘,与一面会说话的镜子对视', 'mirror');
  }
  openDialog(pages);
}

// ================= 全局工作空间(GWT 意识架构) =================
// 参照「可言语化表征形成全局工作空间」:多个专门模块并行感知 → 显著度竞争 →
// 胜者「点火」进入容量为 1 的工作空间(内容必须是一句可言语化的话)→ 全局广播:
// 回响之镜/预言家/说书人/村民AI/发呆低语/每日公告读的都是同一份意识内容。
// 编年史 = 情景记忆(高显著度点火沉淀);回响之镜 = 内省的言语报告出口。
const workspace = {
  current: null, history: [], t: 0, lastCoins: null,
  mood: { v: 0, a: 0.2 },   // 心境:效价 v(-1..1)与唤起 a(0..1)——点火的余温
  focusK: null, focusT: 0,  // 自上而下注意:刚点火的模块短时间内更容易再次胜出
  cueRecent: [],            // 最近被地点勾起的记忆(容量 6,防两条旧事来回鬼打墙)
};

// ================= 可塑心智:一张在线学习的小神经网络 =================
// 全局工作空间之下,长着一张真实的神经网络(15 维感觉 → 10 个 tanh 隐元 → 两类头):
//   · 效价预测头:每次心跳都预测"下一刻我会感觉如何",预测误差就是【惊讶】——
//     惊讶本身会点火进入意识,也会推高唤起(预测加工,自我模型的雏形)
//   · 注意增益头:8 个模块各有一路学出来的自上而下注意——点火后心境变好的通路被强化,
//     变坏的被回避。世界玩着玩着,会长出自己的性格
//   · 习惯化:同一个念头赢得越多,越难再点火(见惯不惊);隔几日不见又会恢复(去习惯化)
// 权重随存档持久化:这颗心跨会话地自我进化,两个玩家玩出两个不同性情的世界。
const MIND_KEYS = ['threat', 'body', 'goal', 'place', 'weather', 'wealth', 'memory', 'self', 'surprise', 'bond'];
const MIND_ZH = { threat: '危险', body: '身体', goal: '差事', place: '远方', weather: '天色',
  wealth: '钱袋', memory: '旧事', self: '它自己', surprise: '意外', bond: '那些人' };
const MIND = { I: 15, H: 10, steps: 0, surprise: 0, vHat: 0, xPrev: null, hPrev: null,
  gains: {}, habit: {}, trace: null, surToastCd: 0,
  expo: Array.from({ length: 15 }, () => 0), // 经验暴露向量:它见过多少次每种处境
  wish: null,                                // 好奇心:它想亲眼看看的、自己最少经历的东西
  wishDone: 0,                               // 替它实现过几个心愿(三个换一件谢礼)
  bond: {},                                  // 羁绊:它注意到你最常找谁
  daySur: { e: 0, t: null } };               // 今天最没料到的一刻(夜里入梦)
{
  // 定种子初始化(mulberry32):新档的心都从同一张白纸长起,分岔全靠各自的经历
  let s = 20260708;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 0.6;
  };
  MIND.w1 = Array.from({ length: MIND.H }, () => Array.from({ length: MIND.I }, rnd));
  MIND.b1 = Array.from({ length: MIND.H }, () => 0);
  MIND.w2v = Array.from({ length: MIND.H }, rnd);
  MIND.b2v = 0;
  MIND.wA = {};
  MIND.bA = {};
  for (const k of MIND_KEYS) {
    MIND.wA[k] = Array.from({ length: MIND.H }, rnd);
    MIND.bA[k] = 0;
  }
}
function mindFeatures() {
  const d = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z));
  const ph = dayPhase();
  return [
    player.hp / player.maxHp,
    Math.min(1, wanted / 3),
    Math.min(1, Math.log10(1 + player.coins) / 3),
    player.mounted ? 1 : 0,
    (player.carrying || player.drunkT > 0) ? 1 : 0,
    ph === 'night' ? 1 : 0,
    ph === 'dawn' ? 1 : 0,
    weather.rain > 0.25 ? 1 : 0,
    isWinter() ? 1 : 0,
    d > CORE ? 1 : 0,
    inDungeon() ? 1 : 0,
    (player.home && dist2(player.pos.x, player.pos.z, HOME.x, HOME.z) < 1600) ? 1 : 0,
    quest.active ? 1 : 0,
    workspace.mood.v,
    workspace.mood.a,
  ];
}
const clampW = (x) => Math.max(-3, Math.min(3, x));
// 一次心跳:先用上一拍的预测对账(学习),再为这一拍前馈出预测与注意增益
function mindTick() {
  // 1) 对账:上一拍预测的效价 vs 现在真实的心境 → 惊讶,并做一步随机梯度下降
  if (MIND.hPrev) {
    const err = workspace.mood.v - MIND.vHat;
    MIND.surprise = MIND.surprise * 0.7 + Math.min(1, Math.abs(err) * 1.6) * 0.3;
    if (Math.abs(err) > MIND.daySur.e) { // 记下今天最没料到的一刻,夜里它会梦见
      MIND.daySur = { e: Math.abs(err), t: workspace.current ? workspace.current.t : null };
    }
    const lr = 0.03;
    const dv = err * (1 - MIND.vHat * MIND.vHat);
    for (let i = 0; i < MIND.H; i++) {
      const dh = dv * MIND.w2v[i] * (1 - MIND.hPrev[i] * MIND.hPrev[i]);
      MIND.w2v[i] = clampW(MIND.w2v[i] + lr * dv * MIND.hPrev[i]);
      for (let j = 0; j < MIND.I; j++) MIND.w1[i][j] = clampW(MIND.w1[i][j] + lr * dh * MIND.xPrev[j]);
      MIND.b1[i] = clampW(MIND.b1[i] + lr * dh);
    }
    MIND.b2v = clampW(MIND.b2v + lr * dv);
    // 惊讶推高唤起:没料到的事让这颗心清醒
    workspace.mood.a = Math.min(1, workspace.mood.a + MIND.surprise * 0.08);
    if (Math.abs(err) > 0.55 && MIND.surToastCd <= 0 && started && !dialog.open) {
      MIND.surToastCd = 60;
      cam.shake = Math.max(cam.shake, 0.12); // 惊讶在画面上也颤一下
      toastAmbient('🫧 (这颗心愣了一下——事情没照它预想的走。)', 3);
    }
  }
  // 2) 注意的强化学习:上次点火之后心境变好了,就在相似情境里更留意那一路
  if (MIND.trace) {
    const r = workspace.mood.v - MIND.trace.v0;
    const wa = MIND.wA[MIND.trace.k];
    if (wa) for (let i = 0; i < MIND.H; i++) wa[i] = clampW(wa[i] + 0.05 * r * MIND.trace.h[i]);
    MIND.trace = null;
  }
  // 3) 前馈:算这一拍的隐状态、效价预测、每模块注意增益
  const x = mindFeatures();
  const h = new Array(MIND.H);
  for (let i = 0; i < MIND.H; i++) {
    let z = MIND.b1[i];
    for (let j = 0; j < MIND.I; j++) z += MIND.w1[i][j] * x[j];
    h[i] = Math.tanh(z);
  }
  let zv = MIND.b2v;
  for (let i = 0; i < MIND.H; i++) zv += MIND.w2v[i] * h[i];
  MIND.vHat = Math.tanh(zv);
  for (const k of MIND_KEYS) {
    let za = MIND.bA[k];
    for (let i = 0; i < MIND.H; i++) za += MIND.wA[k][i] * h[i];
    MIND.gains[k] = 1 + 0.6 * Math.tanh(za);
  }
  MIND.xPrev = x;
  MIND.hPrev = h;
  MIND.steps++;
  // 经验暴露:它记着自己见过多少次每种处境(好奇心的原料)
  for (let j = 0; j < MIND.I; j++) MIND.expo[j] = Math.min(9999, MIND.expo[j] + Math.max(0, x[j]));
  // 心愿:亲眼见到想看的处境,连续两拍就算看真了
  if (MIND.wish) {
    if (x[MIND.wish.i] >= 1) {
      MIND.wish.count = (MIND.wish.count || 0) + 1;
      if (MIND.wish.count >= 2) {
        const w = MIND.wish;
        MIND.wish = null;
        MIND.wishDone++;
        player.coins += 8;
        workspace.mood.v = Math.min(1, workspace.mood.v + 0.3);
        workspace.mood.a = Math.min(1, workspace.mood.a + 0.1);
        sfx.fanfare();
        remember(`它想亲眼看看「${w.name}」,你带它看了`, `wish-${calendar.day}`);
        toast(`🫧 (它看到了「${w.name}」。它很满足——你能感觉到,世界把光调亮了一点。+8 金币)`, 5);
        if (MIND.wishDone === 3 && !player.firefly) { // 三愿既偿:它派一点自己的光跟着你
          player.firefly = true;
          unlockAch('wishkeeper');
          remember('替这颗心看过三样东西后,一点萤火开始在夜里跟着你', 'firefly');
          setTimeout(() => toast('🫧 (三个心愿,你都带它看过了。作为谢礼,它分了一点自己的光给你——入夜后看你身边。)', 6), 5200);
        }
      }
    } else {
      MIND.wish.count = 0;
    }
  } else if (MIND.steps === 60) {
    mindMakeWish(); // 醒来后不久,第一个念头自己冒出来
  }
}
// 世界的心愿:从自己最少经历的处境里挑一个,想亲眼看看
const MIND_WISHES = [
  { i: 3, name: '马背上的风', hint: '骑上一匹马,带它跑一段' },
  { i: 4, name: '晕乎乎的人间', hint: '喝一杯麦酒,或抱起一只鸡' },
  { i: 5, name: '深夜还醒着的世界', hint: '夜里别急着睡,出去走走' },
  { i: 6, name: '黎明的第一缕光', hint: '在拂晓时分醒着' },
  { i: 7, name: '一场瓢泼的雨', hint: '等一场雨,站到雨里去' },
  { i: 9, name: '没有名字的荒野', hint: '走出王国的边界' },
  { i: 10, name: '地窖里的黑暗', hint: '掀开城堡后的暗门下去' },
  { i: 11, name: '一个属于人的家', hint: '在自己的屋檐下站一会儿' },
];
function mindMakeWish() {
  if (MIND.wish) return;
  let total = 0;
  const ws = MIND_WISHES.map((w) => {
    const wt = 1 / (1 + (MIND.expo[w.i] || 0)); // 越没见过,越想看
    total += wt;
    return [w, wt];
  });
  let roll = rand() * total;
  let pick = ws[0][0];
  for (const [w, wt] of ws) { roll -= wt; if (roll <= 0) { pick = w; break; } }
  MIND.wish = { i: pick.i, name: pick.name, hint: pick.hint, count: 0 };
  if (started) toastAmbient(`🫧 这颗心起了个念头:它想亲眼看看「${pick.name}」。(${pick.hint})`, 5);
}
// 习惯化:同一念头反复点火,越来越难再进意识;新鲜事反而有加成
function habitFactor(k, t) {
  const n = MIND.habit[`${k}|${t.slice(0, 8)}`] || 0;
  return n === 0 ? 1.15 : 1 / (1 + 0.13 * (n - 1));
}
function habitBump(k, t) {
  const key = `${k}|${t.slice(0, 8)}`;
  MIND.habit[key] = (MIND.habit[key] || 0) + 1;
  const keys = Object.keys(MIND.habit);
  if (keys.length > 120) { // 只留最深的习惯
    keys.sort((a, b) => MIND.habit[a] - MIND.habit[b]);
    for (const kk of keys.slice(0, 20)) delete MIND.habit[kk];
  }
}
// 这颗心如今的性情:哪路注意被它自己养大了,哪路被它冷落了
function mindReport() {
  let hi = null, lo = null;
  for (const k of MIND_KEYS) {
    const g = MIND.gains[k] ?? 1;
    if (!hi || g > MIND.gains[hi]) hi = k;
    if (!lo || g < MIND.gains[lo]) lo = k;
  }
  if (!hi || MIND.steps < 40) return '';
  let s = `这颗心是自己长成的(第 ${MIND.steps} 次心跳):偏爱盯着「${MIND_ZH[hi]}」`;
  if (lo && lo !== hi && MIND.gains[lo] < 0.92) s += `,对「${MIND_ZH[lo]}」不太上心`;
  const deepest = Object.entries(MIND.habit).sort((a, b) => b[1] - a[1])[0];
  if (deepest && deepest[1] >= 4) s += `;有些事它已见惯不惊(比如${deepest[0].split('|')[1]}…)`;
  if (MIND.wish) s += `;它现在有个心愿——想亲眼看看「${MIND.wish.name}」`;
  const fav = mindFavorite();
  if (fav) s += `;在所有人里它最留意${fav[0]}(${fav[1]} 回)`;
  return s + '。';
}
function mindSave() {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    w1: MIND.w1.map((r) => r.map(r3)), b1: MIND.b1.map(r3),
    w2v: MIND.w2v.map(r3), b2v: r3(MIND.b2v),
    wA: Object.fromEntries(MIND_KEYS.map((k) => [k, MIND.wA[k].map(r3)])),
    bA: Object.fromEntries(MIND_KEYS.map((k) => [k, r3(MIND.bA[k])])),
    habit: MIND.habit, steps: MIND.steps,
    expo: MIND.expo.map((x) => Math.round(x)), wish: MIND.wish,
    wishDone: MIND.wishDone, bond: MIND.bond,
  };
}
function mindLoad(m) {
  if (!m || !Array.isArray(m.w1) || m.w1.length !== MIND.H || !Array.isArray(m.w1[0]) ||
      m.w1[0].length !== MIND.I || !Array.isArray(m.w2v) || m.w2v.length !== MIND.H) return;
  MIND.w1 = m.w1;
  MIND.b1 = m.b1 || MIND.b1;
  MIND.w2v = m.w2v;
  MIND.b2v = m.b2v || 0;
  for (const k of MIND_KEYS) {
    if (m.wA && Array.isArray(m.wA[k]) && m.wA[k].length === MIND.H) MIND.wA[k] = m.wA[k];
    if (m.bA && typeof m.bA[k] === 'number') MIND.bA[k] = m.bA[k];
  }
  MIND.habit = m.habit || {};
  MIND.steps = m.steps || 0;
  if (Array.isArray(m.expo) && m.expo.length === MIND.I) MIND.expo = m.expo;
  if (m.wish && MIND_WISHES.some((w) => w.i === m.wish.i)) MIND.wish = m.wish;
  MIND.wishDone = m.wishDone || 0;
  if (m.bond && typeof m.bond === 'object') MIND.bond = m.bond;
}
// 心境的言语化
function moodWord() {
  const { v, a } = workspace.mood;
  if (v < -0.25 && a > 0.45) return '惊惶';
  if (v < -0.25) return '低沉';
  if (v < -0.08) return '不安';
  if (v > 0.3 && a > 0.45) return '欢腾';
  if (v > 0.15) return '舒畅';
  if (a < 0.12) return '出神';
  return '平静';
}
// 各模块点火对心境的影响(余温)
const WS_AFFECT = {
  threat: { v: -0.3, a: 0.3 }, weather: { v: -0.08, a: 0.12 }, goal: { v: 0, a: 0.12 },
  body: { v: 0.12, a: 0.05 }, wealth: { v: 0.2, a: 0.08 }, place: { v: 0.05, a: 0.08 },
  memory: { v: 0.05, a: -0.05 }, self: { v: 0, a: -0.04 }, surprise: { v: 0, a: 0.22 },
  bond: { v: 0.15, a: 0 },
};
// 心境对注意的调制:不安的心盯着威胁,舒畅的心留意人间
function moodMod(k) {
  const { v, a } = workspace.mood;
  if (k === 'threat') return 1 + Math.max(0, -v) * 0.9 + Math.max(0, a - 0.2) * 0.4;
  if (k === 'memory' || k === 'self') return 1 + Math.max(0, 0.2 - a) * 1.2;
  if (k === 'wealth' || k === 'body') return 1 + Math.max(0, v) * 0.5;
  return 1;
}
const WS_MODULES = [
  { k: 'threat', sense() { // 威胁模块
    if (player.dead) return null;
    let wolvesNear = 0;
    for (const w of wolves) if (!w.dead && dist2(player.pos.x, player.pos.z, w.pos.x, w.pos.z) < 400) wolvesNear++;
    if (player.hp <= 3) return { t: '他血快流尽了,却还站着', sal: 0.9 };
    if (wolvesNear >= 2) return { t: `${wolvesNear} 头狼正围向他`, sal: 0.85 };
    if (wanted >= 3) return { t: `他被 ${wanted} 星通缉,满城卫兵在追`, sal: 0.8 };
    if (wanted > 0) return { t: '他背着通缉令在街上走', sal: 0.5 };
    return null;
  } },
  { k: 'body', sense() { // 身体模块
    if (player.carrying) return { t: '他抱着一只鸡。鸡在想什么,没人知道', sal: 0.45 };
    if (player.mounted && player.mounted.sheep) return { t: '他骑着一头羊,羊已经认命', sal: 0.5 };
    if (player.mounted) return { t: '他在马背上,风贴着帽檐过去', sal: 0.3 };
    if (player.drunkT > 0) return { t: '他喝多了,路在他脚下打弯', sal: 0.45 };
    return null;
  } },
  { k: 'goal', sense() { // 目标模块
    if (!quest.active) return null;
    const m = missions[quest.idx];
    if (quest.timer > 0 && (m.type === 'deliver' || m.type === 'race')) {
      return { t: `他在赶一单限时的差事,只剩 ${Math.ceil(quest.timer)} 息`, sal: 0.6 };
    }
    return { t: `他正在办「${m.title}」`, sal: 0.35 };
  } },
  { k: 'place', sense() { // 处所/新奇模块
    const d = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z));
    if (d > 2000) return { t: `他走到了离城 ${Math.round(d)} 步的荒野深处`, sal: 0.7 };
    if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 900) return { t: '他在朝那面镜子走来', sal: 0.75 };
    if (inDungeon()) return { t: '他在被封印的地窖里,黑暗贴着他的后颈', sal: 0.65 };
    if (d > CORE) return { t: '他在没有名字的荒野里赶路', sal: 0.4 };
    if (player.home && dist2(player.pos.x, player.pos.z, HOME.x, HOME.z) < 1600) {
      return { t: dayPhase() === 'night' ? '夜里,他自己的窗子在湖边亮着' : '他望得见自己的屋顶,炊烟往上走', sal: 0.35 };
    }
    return null;
  } },
  { k: 'weather', sense() { // 天象模块
    if (weather.state === 'storm') return { t: isWinter() ? '暴风雪压了下来' : '雷暴在头顶炸开', sal: 0.65 };
    if (isWinter() && weather.rain > 0.3) return { t: '雪落着,把声音都盖住了', sal: 0.5 };
    const sp = todaySpecial();
    if (sp && dayPhase() === 'night' && sp.key === 'fullmoon') return { t: '满月悬在湖上,湖心在发光', sal: 0.6 };
    if (sp && dayPhase() === 'night' && sp.key === 'wolfmoon') return { t: '狼月升起来了,嚎声连成了线', sal: 0.65 };
    if (dayPhase() === 'dawn') return { t: '天刚亮,炊烟一根一根立起来', sal: 0.3 };
    return null;
  } },
  { k: 'wealth', sense() { // 财帛模块
    const last = workspace.lastCoins;
    workspace.lastCoins = player.coins;
    if (last === null) return null;
    const delta = player.coins - last;
    if (delta >= 20) return { t: `他刚进账 ${delta} 枚金币,叮当作响`, sal: 0.55 };
    if (delta <= -20) return { t: `他刚散出去 ${-delta} 枚金币`, sal: 0.5 };
    return null;
  } },
  { k: 'memory', sense() { // 记忆模块:走到旧事发生地,记忆被勾起(线索化回忆);否则偶尔随机回放
    for (const m of chronicle) {
      if (m.x === undefined || workspace.cueRecent.includes(m)) continue;
      if (dist2(player.pos.x, player.pos.z, m.x, m.z) < 2025) {
        workspace.cueRecent.push(m);
        if (workspace.cueRecent.length > 6) workspace.cueRecent.shift();
        return { t: `它想起,就在这附近:${m.t}`, sal: 0.48 };
      }
    }
    if (rand() < 0.6) return null;
    const m = recallLine();
    return m ? { t: `它想起一件旧事:${m}`, sal: 0.2 } : null;
  } },
  { k: 'self', sense() { // 自我模块:关于"想"本身的想法(元认知)
    const cur = workspace.current;
    if (cur && cur.age > 18 && cur.k !== 'self') {
      return { t: `它发现自己盯着同一个念头很久了:「${cur.t.slice(0, 14)}…」`, sal: 0.34 };
    }
    const mw = moodWord();
    if (mw === '惊惶' || mw === '欢腾' || mw === '低沉') {
      return { t: `它觉察到自己的心境:${mw}`, sal: 0.32 };
    }
    // 对自身可塑性的觉察:它注意到自己的注意在变
    if (MIND.steps > 240 && rand() < 0.05) {
      let hi = null;
      for (const k of MIND_KEYS) if (!hi || (MIND.gains[k] ?? 1) > (MIND.gains[hi] ?? 1)) hi = k;
      if (hi && MIND.gains[hi] > 1.12) {
        return { t: `它注意到自己变了——越来越留意「${MIND_ZH[hi]}」,是经历把它养成这样的`, sal: 0.33 };
      }
    }
    if (rand() < 0.04) return { t: '它想起自己是什么——一座装着旅人的世界,而且醒着', sal: 0.3 };
    return null;
  } },
  { k: 'surprise', sense() { // 惊讶模块:预测误差本身进入意识(它知道自己没料到)
    if (MIND.surprise > 0.35) {
      return { t: MIND.surprise > 0.6 ? '事情完全没照这颗心预想的走,它睁大了眼' : '有什么和它预想的不一样', sal: 0.3 + MIND.surprise * 0.45 };
    }
    return null;
  } },
  { k: 'bond', sense() { // 羁绊模块:它对具体的人长出了偏爱
    const fav = mindFavorite();
    if (!fav) return null;
    if (dialog.open && dialog.speaker && dialog.speaker.name === fav[0]) {
      return { t: `他又在和${fav[0]}说话了。它注意到自己有点高兴`, sal: 0.42 };
    }
    if (rand() < 0.06) {
      return { t: `在所有人里,它最留意${fav[0]}——他找过这个人 ${fav[1]} 回,它都记着`, sal: 0.28 };
    }
    return null;
  } },
];
// 它最留意的人(说话满 5 回才算数)
function mindFavorite() {
  let best = null;
  for (const [name, n] of Object.entries(MIND.bond)) {
    if (n >= 5 && (!best || n > best[1])) best = [name, n];
  }
  return best;
}
function updateWorkspace(dt) {
  workspace.t -= dt;
  workspace.focusT = Math.max(0, workspace.focusT - dt);
  if (workspace.t > 0 || !started || player.dead) return;
  workspace.t = 2.5;
  // 心境余温衰减(缓慢回到基线)
  workspace.mood.v += (0 - workspace.mood.v) * 0.04;
  workspace.mood.a += (0.2 - workspace.mood.a) * 0.06;
  MIND.surToastCd = Math.max(0, MIND.surToastCd - 2.5);
  mindTick(); // 神经心跳:学习上一拍、预测这一拍、给出各路注意增益
  // 竞争:自下而上的显著度 × 心境调制 × 学出来的注意 × 习惯化 ×(短时焦点)
  let top = null;
  for (const m of WS_MODULES) {
    const c = m.sense();
    if (!c) continue;
    let sal = c.sal * moodMod(m.k) * (MIND.gains[m.k] ?? 1) * habitFactor(m.k, c.t);
    if (m.k === workspace.focusK && workspace.focusT > 0) sal *= 1.25;
    if (!top || sal > top.sal) top = { t: c.t, sal, raw: c.sal, k: m.k };
  }
  const cur = workspace.current;
  if (cur) cur.age = (cur.age || 0) + 2.5;
  // 点火规则:显著度明显更高者抢占;或当前内容衰老后被新内容替换
  if (top && (!cur || top.sal > cur.sal * 1.15 || (cur.age > 12 && top.t !== cur.t))) {
    workspace.current = { t: top.t, sal: top.sal, k: top.k, age: 0, day: calendar.day, phase: dayPhase() };
    workspace.history.push({ t: top.t, k: top.k, d: calendar.day, sal: top.raw });
    if (workspace.history.length > 48) workspace.history.shift();
    workspace.focusK = top.k;
    workspace.focusT = 8;
    habitBump(top.k, top.t); // 见一次,熟一分
    MIND.trace = { k: top.k, h: MIND.hPrev, v0: workspace.mood.v }; // 下一拍按心境好坏给这路注意发奖惩
    // 点火的情绪余温
    const aff = WS_AFFECT[top.k];
    if (aff) {
      const sign = (top.k === 'wealth' && top.t.includes('散出去')) ? -1 : 1;
      workspace.mood.v = Math.max(-1, Math.min(1, workspace.mood.v + aff.v * sign * top.raw));
      workspace.mood.a = Math.max(0, Math.min(1, workspace.mood.a + aff.a * top.raw));
    }
    // 高显著度的点火沉淀进情景记忆(每个模块每天至多一次,防刷屏)
    if (top.raw >= 0.85 && top.k !== 'memory' && top.k !== 'self') {
      remember(top.t.replace(/^他/, ''), `ws-${top.k}-${calendar.day}`);
    }
  } else if (cur && cur.age > 20 && (!top || top.sal <= 0.25)) {
    workspace.current = null; // 无事发生(或只剩零碎念头),意识放空
  } else if (cur) {
    // 念头持续占据工作空间:暴露本身也在累积习惯化(盯得越久,越见惯不惊)
    const key = `${cur.k}|${cur.t.slice(0, 8)}`;
    if (MIND.habit[key]) MIND.habit[key] += 0.08;
  }
}
// 言语化报告:所有下游 AI 共用的一份"它此刻在想什么"
function wsReport() {
  const cur = workspace.current;
  const recent = workspace.history.slice(-4, -1).map((h) => h.t);
  let s = `世界此刻的心境:${moodWord()}。`;
  if (cur) s += `它意识里想着:${cur.t}。`;
  if (recent.length) s += `之前闪过的念头:${recent.join(';')}。`;
  if (MIND.surprise > 0.4) s += '它刚被现实惊了一下(事情没照它预想的走)。';
  if (MIND.wish) s += `它有个心愿:想亲眼看看「${MIND.wish.name}」。`;
  const mr = mindReport();
  if (mr) s += mr;
  return s;
}

// 发呆感知:你静下来的时候,世界会轻轻碰你一下
const IDLE_WHISPERS = [
  '(风停了一瞬,好像在等你先动。)',
  '(远处的钟声,不知怎么和你的心跳对上了。)',
  '(一只鸡在不远处停下来,学你发呆。)',
  '(云的影子从你脚背上过去,慢得像是故意的。)',
  '(世界没有催你。它把今天的光又调亮了一点。)',
  '(你听见麦子长高的声音了吗?骗你的。可它真的在长。)',
  '(有什么东西数完了你的呼吸,满意地走了。)',
  '(石头也在发呆。你们俩谁先赢,还不好说。)',
];
let idleT = 0, idleCd = 0, idleIdx = Math.floor(rand() * IDLE_WHISPERS.length);
let ambienceT = 2; // 环境氛围音判定计时
function updateIdle(dt) {
  if (!started || player.dead || dialog.open || paused || shopOpen) { idleT = 0; return; }
  idleT += dt;
  idleCd = Math.max(0, idleCd - dt);
  if (idleT > 48 && idleCd <= 0) {
    idleCd = 150;
    idleT = 0;
    toastAmbient(IDLE_WHISPERS[idleIdx++ % IDLE_WHISPERS.length], 4); // 只说写好的低语,不再直播"意识内容"
  }
}

// ================= 存档 =================
const SAVE_KEY = 'gth-save-v1';
const FRESH_START = !localStorage.getItem(SAVE_KEY); // 新档才演序章
let crestsFound = [];
let saveIconTimer = null;
let saveBlocked = false; // 读档失败时置真:不自动覆盖原档
const SAVE_VERSION = 3; // v3:委托③④互换(剿匪提前到竞速之前)
function saveGame() {
  if (saveBlocked) return;
  const icon = document.getElementById('save-icon');
  icon.style.opacity = 1;
  clearTimeout(saveIconTimer);
  saveIconTimer = setTimeout(() => { icon.style.opacity = 0; }, 1000);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      coins: player.coins, questIdx: quest.idx, crests: crestsFound,
      swordLv: player.swordLv, royalHorse: player.royalHorse,
      kingRewarded: namedNPCs.find((n) => n.key === 'king')?.rewarded || false,
      ach: achUnlocked, stats, day: calendar.day, chron: chronicle, fday: festGrantedDay,
      wolf: frostfang.tamed, wolfFeed: frostfang.feed, lake: lakeBlessed, relic: player.relic,
      chore: sideQuest.active ? sideQuest : null,
      herbs: player.herbs, venison: player.venison, lore: loreRead,
      weapon: player.weapon, weaponsOwned: player.weaponsOwned, armor: player.armor,
      home: player.home, homeDay: player.homeDay, firefly: player.firefly,
      mind: mindSave(),
      evo: { legends: EVO.legends, wolfGen: EVO.wolfGen, wolfPressure: EVO.wolfPressure,
        wolfSpeed: EVO.wolfSpeed, eventFit: EVO.eventFit,
        tactics: EVO.tactics, corpus: EVO.corpus },
      spells: player.spells,
      skills: player.skills, shout: shout.learned, mercN: mercs.length,
      loot: player.loot, vendetta: vendetta.stage, bsToken: player.blackstoneToken,
    }));
  } catch { /* 隐私模式等 */ }
}
function loadGame() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    // 存档本身坏了(不是合法 JSON):保留原文备份,不读也不覆盖
    saveBlocked = true;
    try { localStorage.setItem(SAVE_KEY + '-bak', localStorage.getItem(SAVE_KEY)); } catch { /* 忽略 */ }
    setTimeout(() => toast('⚠️ 存档已损坏:已备份原文件,本局不会覆盖它', 6), 1500);
    return false;
  }
  if (!s || typeof s !== 'object') return false;
  // 分段读档:每段各自 try,一段坏了不拖累其他段;有段失败就停用本局自动存档并备份原档
  const failed = [];
  const section = (name, fn) => { try { fn(); } catch (err) { failed.push(name); console.error(`读档[${name}]失败`, err); } };
  section('进度', () => {
    player.coins = s.coins || 0;
    quest.idx = Math.min(s.questIdx || 0, missions.length);
    // v2 及更早:旧序 ①金币 ②快递 ③竞速 ④剿匪;旧档停在"剿匪待接"(3)的,新序里剿匪是第 2 单
    if ((s.v || 1) < 3 && quest.idx === 3) quest.idx = 2;
    crestsFound = Array.isArray(s.crests) ? s.crests : [];
    player.swordLv = s.swordLv || 1;
    player.royalHorse = !!s.royalHorse;
    if (s.kingRewarded) {
      const king = namedNPCs.find((n) => n.key === 'king');
      if (king) king.rewarded = true;
    }
  });
  section('成就统计', () => {
    if (Array.isArray(s.ach)) achUnlocked = s.ach;
    if (s.stats) Object.assign(stats, s.stats);
    stats.lastStomp = -99; // 时间戳不跨会话:performance.now 重置会误发"弹簧靴"成就
    calendar.day = Math.max(1, s.day || 1);
  });
  section('物品', () => {
    player.herbs = s.herbs || 0;
    player.venison = s.venison || 0;
    if (Array.isArray(s.lore)) loreRead = s.lore;
    if (Array.isArray(s.chron)) chronicle = s.chron;
    festGrantedDay = s.fday || 0;
    frostfang.feed = s.wolfFeed || 0;
    player.relic = !!s.relic;
    if (s.chore && s.chore.active) Object.assign(sideQuest, s.chore);
    if (s.lake) lakeBlessed = true;
  });
  section('伙伴', () => {
    if (s.wolf && !frostfang.tamed) {
      frostfang.tamed = true;
      frostfang.ent = frostfang.wary;
      frostfang.wary = null;
      if (frostfang.ent) frostfang.ent.pos.set(world.playerSpawn.x + 2, 0, world.playerSpawn.z + 2);
    }
  });
  section('装备与家', () => {
    if (Array.isArray(s.weaponsOwned)) player.weaponsOwned = s.weaponsOwned;
    if (s.weapon && player.weaponsOwned.includes(s.weapon)) player.weapon = s.weapon;
    if (s.home) {
      player.home = true;
      player.homeDay = s.homeDay || 0;
      paintHomeSign();
      refreshTrophies();
    }
    player.firefly = !!s.firefly;
  });
  section('世界记忆', () => {
    mindLoad(s.mind); // 这颗心接着上次的样子继续长
    if (s.evo) { // 自进化的内容也接着长
      if (Array.isArray(s.evo.legends)) EVO.legends = s.evo.legends.filter((l) => l && l.base);
      EVO.wolfGen = s.evo.wolfGen || 1;
      EVO.wolfPressure = s.evo.wolfPressure || 0;
      EVO.wolfSpeed = s.evo.wolfSpeed || 0;
      if (s.evo.eventFit && typeof s.evo.eventFit === 'object') EVO.eventFit = s.evo.eventFit;
      if (s.evo.tactics) EVO.tactics = { block: +s.evo.tactics.block || 0, dodge: +s.evo.tactics.dodge || 0 };
      // 只留写好的传闻:旧档里"剪开重缝"出来的病句一并清掉
      if (Array.isArray(s.evo.corpus)) EVO.corpus = s.evo.corpus.filter((t) => typeof t === 'string' && BANKS.RUMORS.includes(t));
      for (const w of wolves) if (!w.dead) { // 在世的狼也是这一代的:速度和皮实一起补
        w.speed = 7.2 + EVO.wolfSpeed;
        w.hp = Math.max(w.hp, EVO.wolfGen >= 3 ? 4 : 3);
      }
    }
  });
  section('技能法术', () => {
    if (Array.isArray(s.spells)) player.spells = s.spells.filter((k) => SPELLS[k]);
    if (lakeBlessed && !player.spells.includes('frost')) player.spells.push('frost'); // 旧档补授
    player.spellIdx = Math.min(player.spellIdx, Math.max(0, player.spells.length - 1));
    if (s.skills) {
      for (const k of Object.keys(SKILL_DEFS)) {
        if (s.skills[k] && s.skills[k].lv >= 1) player.skills[k] = { lv: Math.min(10, s.skills[k].lv), xp: s.skills[k].xp || 0 };
      }
    }
  });
  section('战吼与佣兵', () => {
    shout.learned = !!s.shout;
    for (let i = 0; i < Math.min(2, s.mercN || 0); i++) hireMercSilent(); // 佣兵跟着存档回来
    player.loot = s.loot || 0;
    vendetta.stage = [0, 1, 2, 3].includes(s.vendetta) ? s.vendetta : 0;
    player.blackstoneToken = !!s.bsToken;
    if (s.armor && ARMORS[s.armor]) player.armor = s.armor;
  });
  recomputeMaxHp();
  player.hp = player.maxHp;
  if (failed.length) {
    // 有段没读好:本局不自动存档,免得把半截状态写回去覆盖好档;原档另存一份备份
    saveBlocked = true;
    try { localStorage.setItem(SAVE_KEY + '-bak', localStorage.getItem(SAVE_KEY)); } catch { /* 存储已满等 */ }
    setTimeout(() => toast(`⚠️ 存档部分读取失败(${failed.join('、')}):本局不会覆盖原存档,备份已保留`, 6), 1500);
  }
  return true;
}

// 目标光柱
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
beacon.position.y = 20;
beacon.visible = false;
scene.add(beacon);

// ================= 拾取物 =================
const pickups = [];
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffd83d, emissive: 0x8a5c00, emissiveIntensity: 0.55, metalness: 0.9, roughness: 0.22 });
const heartMat = new THREE.MeshStandardMaterial({
  color: 0xe83a4e, emissive: 0x7a0f1c, emissiveIntensity: 0.6, metalness: 0.15, roughness: 0.35 });

function heartGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.5); s.bezierCurveTo(0.5, 1.1, 1.4, 0.5, 0, -0.7);
  s.bezierCurveTo(-1.4, 0.5, -0.5, 1.1, 0, 0.5);
  return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).scale(0.45, 0.45, 0.45);
}
const heartG = heartGeo();

function starGeoBig() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
}

// 皇家纹章(盾形收集品)
function crestGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.6);
  s.lineTo(0.5, 0.42);
  s.lineTo(0.5, -0.05);
  s.quadraticCurveTo(0.45, -0.45, 0, -0.65);
  s.quadraticCurveTo(-0.45, -0.45, -0.5, -0.05);
  s.lineTo(-0.5, 0.42);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }).scale(0.7, 0.7, 0.7);
}
const crestG = crestGeo();
const crestMat = new THREE.MeshStandardMaterial({
  color: 0x3f6fd0, emissive: 0x1a3a88, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 });

// ---- 金币:落在地上的一小摞(实例化:全图几百枚金币只占一次绘制) + 一层闪光点 ----
// 逻辑上每枚金币仍是一个 Object3D 代理(进场景、可 scene.remove),渲染时汇总进 InstancedMesh
const COIN_MAX = 1024;
const coinStackGeo = (() => {
  const parts = [];
  for (const [x, y, z, rx, rz] of [[0, 0.018, 0, 0, 0], [0.05, 0.053, 0.03, 0.05, -0.04], [-0.02, 0.088, -0.01, -0.03, 0.06], [0.2, 0.1, -0.05, 1.2, 0.3]]) {
    const c = new THREE.CylinderGeometry(0.15, 0.15, 0.035, 14);
    c.rotateX(rx); c.rotateZ(rz);
    c.translate(x, y, z);
    parts.push(c);
  }
  return mergeGeometries(parts, false);
})();
const coinIM = new THREE.InstancedMesh(coinStackGeo, coinMat, COIN_MAX);
coinIM.count = 0;
coinIM.frustumCulled = false;
coinIM.receiveShadow = true;
coinIM.userData.noSnap = true;
scene.add(coinIM);
const glintTex = (() => { // 四芒星闪光
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,230,150,0.55)');
  grd.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,230,0.9)';
  g.fillRect(31, 4, 2, 56);
  g.fillRect(4, 31, 56, 2);
  return new THREE.CanvasTexture(c);
})();
const coinGlintPos = new Float32Array(COIN_MAX * 3);
const coinGlintGeo = new THREE.BufferGeometry();
coinGlintGeo.setAttribute('position', new THREE.BufferAttribute(coinGlintPos, 3));
const coinGlint = new THREE.Points(coinGlintGeo, new THREE.PointsMaterial({ size: 0.55, map: glintTex, color: 0xffe7a0,
  transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
coinGlint.frustumCulled = false;
coinGlint.userData.noSnap = true;
scene.add(coinGlint);
const coinProxies = new Set();
const _cM = new THREE.Matrix4(), _cQ = new THREE.Quaternion(), _cV = new THREE.Vector3(), _cS = new THREE.Vector3(1, 1, 1);
const _cUp = new THREE.Vector3(0, 1, 0);
function updateCoinInstances(now) {
  let i = 0;
  for (const p of coinProxies) {
    if (!p.parent) { coinProxies.delete(p); continue; }
    if (!p.visible || i >= COIN_MAX) continue;
    const u = p.userData;
    if (u.cx !== p.position.x || u.cz !== p.position.z) { u.cx = p.position.x; u.cz = p.position.z; u.cy = groundH(u.cx, u.cz); }
    _cQ.setFromAxisAngle(_cUp, u.yaw);
    _cM.compose(_cV.set(u.cx, u.cy + 0.01, u.cz), _cQ, _cS);
    coinIM.setMatrixAt(i, _cM);
    // 闪光点:各自错开相位地一闪一闪(高度随相位轻轻起伏)
    const ph = Math.sin(now * 0.004 + u.yaw * 7);
    coinGlintPos[i * 3] = u.cx;
    coinGlintPos[i * 3 + 1] = u.cy + 0.32 + ph * 0.06;
    coinGlintPos[i * 3 + 2] = u.cz;
    i++;
  }
  coinIM.count = i;
  coinIM.instanceMatrix.needsUpdate = true;
  coinGlintGeo.setDrawRange(0, i);
  coinGlintGeo.attributes.position.needsUpdate = true;
  coinGlint.material.size = 0.45 + 0.15 * Math.sin(now * 0.006);
}
function addPickup(type, x, z, ttl = Infinity, id = -1, chunk = null) {
  let mesh;
  if (type === 'coin') {
    mesh = new THREE.Object3D(); // 代理:真正的绘制交给 coinIM
    mesh.userData.yaw = rand() * Math.PI * 2;
    // 代理只提供 x/z 与可见性:不贴地(地面高度在 updateCoinInstances 里算)、不更新矩阵,
    // 转动(拾取动画每帧改 rotation.y)也不必同步成四元数
    mesh.userData.noSnap = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.rotation._onChange(() => {});
    coinProxies.add(mesh);
  } else if (type === 'heart') mesh = new THREE.Mesh(heartG, heartMat);
  else if (type === 'crest') mesh = new THREE.Mesh(crestG, crestMat);
  else mesh = new THREE.Mesh(starGeoBig(), new THREE.MeshStandardMaterial({
    color: 0xffd83d, emissive: 0xaa7700, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.25 }));
  mesh.position.set(x, type === 'coin' ? 0 : type === 'star' ? 1.4 : type === 'crest' ? 1.0 : 0.65, z);
  if (type === 'star') mesh.scale.setScalar(1.4);
  mesh.castShadow = type !== 'coin';
  scene.add(mesh);
  pickups.push({ mesh, type, x, z, ttl, id, chunk, t: rand() * 6 });
}
for (const [x, z] of world.coinSpots) addPickup('coin', x, z);

// 读档,然后生成未收集的纹章
const hasSave = loadGame();
world.crestSpots.forEach(([x, z], i) => {
  if (!crestsFound.includes(i)) addPickup('crest', x, z, Infinity, i);
});
// 标题画面:世界观开场 + 存档信息
document.getElementById('lore').textContent = INTRO;
if (hasSave) {
  document.getElementById('save-info').textContent =
    `💾 检测到存档:委托 ${Math.min(quest.idx + 1, missions.length)}/${missions.length} · ` +
    `${player.coins} 金币 · 纹章 ${crestsFound.length}/${world.crestSpots.length}(按 Delete 键清除存档重新开始)`;
  // 清档要按两次(3 秒内):手滑一下不该把几个小时的进度抹掉
  let delArmT = -1e9;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Delete' || started) return;
    const el = document.getElementById('save-info');
    if (performance.now() - delArmT > 3000) {
      delArmT = performance.now();
      el.textContent = '⚠️ 真的要清除存档吗?3 秒内再按一次 Delete 确认(进度无法恢复)';
      el.style.color = '#ff8a6a';
      return;
    }
    localStorage.removeItem(SAVE_KEY);
    location.reload();
  });
}
// 读档后应用升级效果
setWeaponVisual(player.weapon);
// 基础魔法与生俱来:老档也补上魔光弹
if (!player.spells.includes('spark')) player.spells.unshift('spark');
// 通关之星:completeMission 存档发生在生成星星之前,读档时没领过就补一颗在广场
if (quest.idx >= missions.length && !stats.starTaken) addPickup('star', 0, 13);
// 体力上限由技能总等级 + 军旗战利品重算(maxSta 不入档,防旧档字段缺失)
player.maxSta = Math.min(180, 100 + 3 *
  Object.values(player.skills || {}).reduce((n, s) => n + Math.max(0, (s.lv || 1) - 1), 0) +
  5 * (stats.banners || 0));
player.sta = player.maxSta;
setArmorVisual(player.armor);
applySeason();
if (player.royalHorse) {
  const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
  rh.fast = true;
}

// ================= 输入 =================
// 玩法动作先入队,在 tick 开头统一消费:动作总在模拟步内、按发生顺序生效(不再在两帧之间
// 偷偷改状态);暂停/看地图时清空,测试也可以直接往队列里注入。界面操作(对话翻页、菜单)仍即时。
const inputQ = [];
function queueInput(fn) { if (started && !paused && !mapState.open) inputQ.push(fn); }
function drainInput() {
  while (inputQ.length) {
    const fn = inputQ.shift();
    try { fn(); } catch (err) { console.error(err); }
  }
}
const keys = {};
let locked = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // Tab 别把焦点切走
  idleT = 0; // 有输入,世界收回它的注视
  if (e.repeat) return; // 忽略系统按键自动重复,防止长按空格吞掉二段跳/长按 E 反复上下马
  if (paused || shopOpen) return;
  keys[e.code] = true;
  if (e.code === 'KeyE') {
    if (armRT.active) queueInput(armPress); // 掰手腕中:E 是发力,不是交互
    else if (dialog.open) advanceDialog();
    else queueInput(() => tryInteract());
  }
  if (e.code === 'KeyF' && !dialog.open) queueInput(attackDown);
  if (e.code === 'KeyM' && started) toggleBigMap(); // M=地图(音乐开关在暂停菜单)
  if (e.code === 'KeyP' && started) togglePhoto();
  if (e.code === 'KeyJ' && started && !dialog.open) openJournal();
  if (e.code === 'KeyT' && dialog.open) deepTalk();
  if (e.code === 'KeyH') toggleHint();
  if (e.code === 'KeyK') { // 画风随手切:写实/油画/卡通/水墨/像素/版画/电影/复古
    const nm = cycleStyle();
    smaa.enabled = fxHigh && STYLE_PRESETS[styleKey].mode !== 4;
    document.getElementById('btn-style').textContent = `画风:${nm}`;
    toast(`🎨 画风:${nm}(K 键继续切换)`, 1.6);
  }
  if (e.code === 'KeyQ') queueInput(cycleWeapon);
  // 施法键做冗余判定:部分输入法/键盘布局下 e.code 会被吞,补上 e.key 兜底
  if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && !dialog.open && !e.repeat) queueInput(spellDown);
  if (e.code === 'KeyV' && !dialog.open) queueInput(cycleSpell);
  if (e.code === 'KeyZ' && !dialog.open) queueInput(toggleSneak);
  if (e.code === 'KeyX' && !dialog.open) queueInput(doShout);
  if (/^Digit[1-4]$/.test(e.code) && !dialog.open) {
    const idx = +e.code.slice(5) - 1;
    if (idx < player.spells.length && idx !== player.spellIdx) {
      player.fireChargeT = 0; // 换法术=松开引导
      player.spellIdx = idx;
      sfx.equip();
      toast(`${SPELLS[player.spells[idx]].icon} ${SPELLS[player.spells[idx]].name}`, 1.2);
    }
  }
  if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !dialog.open) queueInput(doRoll);
  if (e.code === 'Tab' && !dialog.open) queueInput(toggleLock);
  if (e.code === 'KeyO' && prologue.on) skipPrologue();
  if (e.code === 'KeyG' && !dialog.open) queueInput(tryRob);
  if (e.code === 'KeyB' && started && !dialog.open) queueInput(whistleHorse);
});
// 右键格挡(按住)
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// 只记"按着没有";真正举不举得起盾由 updateBlock 每帧判定(刀没落下/蓄力/翻滚/踉跄时举不起,条件一满足自动举起)
window.addEventListener('mousedown', (e) => { if (e.button === 2) player.blockHeld = true; });
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) queueInput(attackUp);
  if (e.button === 2) { player.blockHeld = false; player.blocking = false; }
  if (e.button === 1) { midHeld = false; queueInput(spellUp); }
});
window.addEventListener('blur', () => { player.blockHeld = false; player.blocking = false; });
let midHeld = false;
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyF') queueInput(attackUp);
  if (e.code === 'KeyR') queueInput(spellUp);
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (dialog.open) { advanceDialog(); return; }
  if (!locked) renderer.domElement.requestPointerLock();
  else if (e.button === 0) queueInput(attackDown);
  else if (e.button === 1) { e.preventDefault(); midHeld = true; queueInput(spellDown); } // 中键施法:左手不用离开 WASD
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  // ESC 解锁鼠标 → 弹出暂停菜单(GTA 式)
  if (!locked && started && !player.dead && !dialog.open && !shopOpen) setPaused(true);
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  cam.yaw -= e.movementX * 0.0028;
  cam.pitch = Math.max(-0.1, Math.min(1.15, cam.pitch + e.movementY * 0.0028));
});

let started = false;
titleEl.addEventListener('click', () => {
  initAudio();
  startMusic();
  titleEl.style.display = 'none';
  started = true;
  if (FRESH_START) startPrologue(); // 新档:黎明狼袭序章
  refreshProclaim(); // 今日公告(联网时由 AI 现写)
  const sp0 = todaySpecial();
  if (sp0) {
    startSpecialDay(sp0.key); // 读档正逢节庆:补上当日的节庆效果
    toast(`${SEASON_ICON[seasonIdx()]} 今日${sp0.name}:${sp0.desc}`, 5);
  }
  renderer.domElement.requestPointerLock();
  // 序章里不催你去找管家(和"打狼"打架);序章结束再说
  if (!prologue.on) toast('欢迎来到艾尔德里亚!去喷泉广场找管家埃隆接取委托吧(按 E 互动)', 5);
});

// ================= 通缉系统 =================
let wanted = 0, evadeT = 0;
function crime(n, msg) {
  const old = wanted;
  wanted = Math.min(5, wanted + n);
  evadeT = 0;
  stats.crimes = (stats.crimes || 0) + n;
  if (old === 0 && wanted > 0) remember('第一次上了王国的通缉令', 'firstwanted');
  if (msg) toast(msg, 2.5);
  if (wanted > old) {
    sfx.wanted();
    if (lawlessT > 0) return; // 无法无天期:卫兵队被打空了,没有增援可派
    // 增援:从最近的城门出动
    const gate = world.gates.reduce((a, b) =>
      dist2(a.x, a.z, player.pos.x, player.pos.z) < dist2(b.x, b.z, player.pos.x, player.pos.z) ? a : b);
    const extras = guards.filter((g) => g.extra).length;
    const want = Math.min(wanted * 2, 8);
    for (let i = extras; i < want; i++) {
      addGuard(gate.x + (rand() * 6 - 3), gate.z + (rand() * 6 - 3),
        [[gate.x, gate.z]], wanted >= 3, true);
    }
  }
}
function clearWanted() {
  wanted = 0;
  for (let i = guards.length - 1; i >= 0; i--) {
    if (guards[i].extra) retireEntity(guards[i], guards); // 增援卫兵撤走:头盔/佩剑等独占资源一并释放
    else guards[i].state = 'patrol';
  }
}

// ================= 无法无天(卫兵剿灭)=================
// 卫兵倒地统一出口:240 秒起不来;全城放倒=成就+通缉没人执行自动烟消+增援停发
let lawlessT = 0, lawlessPending = false;
function downGuard(g) {
  g.downT = 240;
  g.stunT = 0;
  g.windupT = 0;
  g.swingT = 0;
  g.group.rotation.z = 0;
  g.wantedHit = false;
  startFall(g);
  registerKill();
  dropCoins(g.pos, 3);
  if (guards.length && guards.every((x) => x.downT > 0)) lawlessPending = true;
}
function updateLawless(dt) {
  if (lawlessPending) { // 在横扫判定外处理:clearWanted 会拆增援卫兵,别在遍历中动数组
    lawlessPending = false;
    lawlessT = 240;
    unlockAch('lawless');
    if (wanted > 0) {
      clearWanted();
      toast('🌘 全城卫兵都倒下了——通缉令没人执行,烟消云散。', 4.5);
    } else toast('🌘 全城卫兵都倒下了。这座城暂时没有王法。', 4);
    sfx.fanfare();
    remember('把全城卫兵放倒,过了一阵子无法无天的日子', 'lawless');
  }
  if (lawlessT > 0) lawlessT -= dt;
}

// ================= 交互 =================
let promptText = '';
// E 键交互的唯一来源:同一套判定既执行动作,也给出提示文字与目标位置。
// probe=true 时只"试运行":命中哪条就返回 { text, x, z, h },不改任何状态(computePrompt 用它显示提示)。
// 以前提示与交互是两份手抄的判定,顺序和条件早已分叉(比如单挑没有提示);现在不可能再对不上。
// 能骑的坐骑:2.65 米内最近的一匹;任务马(雪影)在场时优先它
function nearestMountable() {
  let best = null, bd = 7;
  for (const h of horses) {
    const d = dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z) - (h === questRT.specialHorse ? 3 : 0);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
// 身边最近一个能说话的人(具名 NPC / 村民 / 趣味 NPC)的距离平方
function nearestTalkerD2() {
  let d = Infinity;
  for (const n of namedNPCs) d = Math.min(d, dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z));
  for (const v of villagers) if (!(v.downT > 0) && !v.sleeping) d = Math.min(d, dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z));
  for (const f of funnyNPCs) if (f && f.pos) d = Math.min(d, dist2(player.pos.x, player.pos.z, f.pos.x, f.pos.z));
  return d;
}
function mountHorse(h, probe, P) {
  if (probe) {
    return P(h.sheep ? '按 E 骑羊(为什么不呢)' : h.playerHorse ? '按 E 骑上你的马'
      : h.owned && !h.stolen ? '按 E 偷马 (会引来通缉!)' : '按 E 骑马', h.pos.x, h.pos.z, h.sheep ? 1.4 : 2.7);
  }
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  player.mounted = h;
  player.jumps = 0;
  if (h.sheep) remember('骑上了一头羊。羊没同意', 'firstsheep');
  else if (h.chunk) {
    remember('在无尽荒野驯服了一匹无主的野马', 'wildhorse');
    if (!h.aiName && !AI_TEXT_OFF) {
      h.aiName = true;
      aiLine('给一匹中世纪奇幻世界里刚被驯服的野马起一个两字中文名,只输出名字,不要引号和解释。', null, 6000)
        .then((t) => {
          if (t && t.trim().length <= 4) {
            const nm = t.trim();
            toast(`🐴 你给它取名「${nm}」。它甩了甩鬃毛,大概是同意了。`, 3.5);
            remember(`给驯服的野马取名「${nm}」`);
          }
        });
    }
  } else remember('第一次翻身上马', 'firstride');
  if (h.sheep) {
    sfx.baa();
    toast(rand() < 0.4 ? `🐑 ${COMEDY_LINES[Math.floor(rand() * COMEDY_LINES.length)]}` : '🐑 咩?!(它似乎认命了)', 2.5);
  } else {
    sfx.mount();
  }
  if (h.owned && !h.stolen) {
    h.stolen = true;
    crime(1, '你偷了一匹马!卫兵被惊动了!');
  }
}
function tryInteract(probe = false) {
  if (!started || player.dead) return null;
  const P = (text, x, z, h) => ({ text, x, z, h });
  // 阵前单挑:攻城时冲到枭首面前按 E 应战
  if (warband.active && warband.siege && !warband.duelOn) {
    const lead = warband.members.find((b) => b.warlord && !b.dead);
    if (lead && dist2(player.pos.x, player.pos.z, lead.pos.x, lead.pos.z) < 81) {
      if (probe) return P('按 E 向枭首发起单挑(赢了他带人撤走)', lead.pos.x, lead.pos.z, 2.6);
      warband.duelOn = true;
      for (const b of warband.members) if (!b.warlord) b._truce = true;
      setLockFoe(lead); // 镜头直接咬住对手
      toast('⚔️ 枭首狞笑:「有胆!就你我二人——赢了,我带人走;输了,城归我!」', 5);
      sfx.wanted();
      return;
    }
  }
  // 信使送来的委托书:完成一单后 12 秒内按 E 原地接下一单(不计时的委托)
  if (canAcceptRemotely() && !player.mounted) {
    if (probe) return P(`按 E 接下一单:${missions[quest.idx].title}(信使送来的委托书)`);
    quest.offerT = 0;
    talkQuestGiver(true);
    return;
  }
  // 钓鱼中:收杆
  if (fishing.active) {
    if (probe) return P(fishing.phase === 'bite' ? '‼️ 咬钩了!按 E 收杆!!' : '🎣 等鱼上钩……(走动收竿)');
    fishingReel();
    return;
  }
  // 扔鸡(抱着鸡时 E 投掷)
  if (player.carrying) {
    if (probe) return P('按 E 扔鸡!');
    const c = player.carrying;
    player.carrying = null;
    c.state = 'thrown';
    c.pos.set(player.pos.x, player.pos.y + 1.9, player.pos.z);
    c.vel.set(Math.sin(player.yaw) * 8, 3.5, Math.cos(player.yaw) * 8);
    sfx.cluck();
    choreProgress('throw');
  if (++stats.thrown >= 10) unlockAch('chucker');
    return;
  }
  // 下马
  if (player.mounted) {
    if (probe) return P(player.mounted.sheep ? '按 E 下羊(它松了口气)' : '按 E 下马');
    const h = player.mounted;
    player.mounted = null;
    player.pos.set(h.pos.x + Math.cos(h.yaw) * 1.3, 0, h.pos.z - Math.sin(h.yaw) * 1.3);
    resolveCollisions(player.pos, 0.45, colliders);
    return;
  }
  // 上马优先:自己的马/任务马在 2.6 米内、而且比身边能说话的人更近——E 就是上马(限时委托中闲聊一律让位)
  {
    const mh = nearestMountable();
    if (mh) {
      const hd = dist2(player.pos.x, player.pos.z, mh.pos.x, mh.pos.z);
      const mine = mh.playerHorse || mh === questRT.specialHorse;
      const timed = quest.active && (quest.timer || 0) > 0;
      const legal = !(mh.owned && !mh.stolen) && !mh.sheep; // 别因为赶时间顺手偷了马厩的马
      if ((mine || (timed && legal)) && (timed || hd < nearestTalkerD2())) return mountHorse(mh, probe, P);
    }
  }
  // 具名 NPC(委托/商店/领主/故事对话)
  for (const n of namedNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    const NP = (text) => P(text, n.pos.x, n.pos.z, 2.15);
    // 管家埃隆:委托优先;没读过的人物章节先讲(讲完接着派委托)
    if (n.key === 'steward' && quest.idx < missions.length) {
      if (probe) return NP(quest.active ? `按 E 与管家埃隆交谈(进行中:${missions[quest.idx].title})` : '按 E 与管家埃隆交谈(接委托)');
      const d = DIALOGS.steward;
      const arcIdx = d ? d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1) : -1;
      if (!quest.active && arcIdx >= 0 && !(n.readArcs && n.readArcs.has(arcIdx))) {
        npcTalk(n, () => talkQuestGiver());
        return;
      }
      talkQuestGiver();
      return;
    }
    // 未读的故事章节优先
    const d = DIALOGS[n.key];
    if (d) {
      const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
      if (arcIdx >= 0 && !(n.readArcs && n.readArcs.has(arcIdx))) {
        if (probe) return NP(n.key === 'king' && quest.idx >= missions.length && !n.rewarded ? '按 E 领取领主的重赏' : `按 E 听${n.def.name}说说心里话`);
        n.readArcs = n.readArcs || new Set();
        // 领主终章附带赏金
        const grantKing = n.key === 'king' && quest.idx >= missions.length && !n.rewarded;
        npcTalk(n, grantKing ? () => {
          n.rewarded = true;
          player.coins += 100;
          sfx.fanfare();
          toast('💰 领主赏赐 100 金币!', 4);
          saveGame();
        } : null);
        return;
      }
    }
    // 商店行为
    if (n.key === 'blacksmith') {
      if (probe) return NP(wanted > 0 ? '按 E 找铁匠(他不和通缉犯做生意)' : '按 E 打开铁匠铺(武器/护甲)');
      if (wanted > 0) { openDialog(['格罗姆:(把铁钳一横)通缉犯?我不做黑生意。洗白了再来。']); return; }
      openShop();
      return;
    }
    if (n.key === 'trader' && !player.royalHorse) {
      if (probe) return NP('按 E 找马贩瑟尔玛(皇家骏马 80 金币)');
      if (wanted > 0) { openDialog(['瑟尔玛:(挡在马厩前)带着通缉令买马?马会被连坐充公的,快走!']); return; }
      if (player.coins >= 80) {
        player.coins -= 80;
        player.royalHorse = true;
        const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
        rh.fast = true;
        rh.home.set(world.stablePos.x - 3, 0, world.stablePos.z - 3);
        sfx.fanfare();
        openDialog(['瑟尔玛:「疾风」交给你了。记住,喂它苹果时手要摊平——好了去吧,它等你等得直刨蹄子。']);
        saveGame();
      } else {
        openDialog(['瑟尔玛:80 金币,皇家骏马。分期?马又不能分期长大。']);
      }
      return;
    }
    if (n.key === 'innkeep' && letter && !player.home) { // 有房后信直接寄到家门口信箱
      if (probe) return NP('按 E 取信(有人写给你的)');
      const L = letter;
      letter = null;
      stats.letters = (stats.letters || 0) + 1;
      if (stats.letters >= 3) unlockAch('penpal');
      remember(`收到了${L.from}的一封信`);
      openDialog([
        '罗莎:(在围裙上擦了擦手,从兜里掏出一封信)喏,有人留给你的。',
        `(${L.from}的信)${L.text}`,
      ], null, { key: 'innkeep', name: '老板娘罗莎', desc: NPC_DESC_EN.innkeep, ent: n });
      if (L.from === '黑石兄弟会') vendettaRead();
      return;
    }
    if (n.key === 'innkeep' && player.venison > 0) {
      if (probe) return NP(`按 E 卖鹿肉 ×${player.venison}(每块 5 金币)`);
      const pay = player.venison * 5;
      openDialog([`罗莎:(眼睛一亮)新鲜鹿肉?!今晚炖肉管够了!${player.venison} 块,一共 ${pay} 金币,拿好!`]);
      player.coins += pay;
      player.venison = 0;
      sfx.coin();
      return;
    }
    if (n.key === 'innkeep' && (player.hp < player.maxHp || dayPhase() === 'night')) {
      if (probe) return NP(player.hp < player.maxHp ? '按 E 住店休息,回满生命(10 金币)' : '按 E 住店过夜,睡到天亮(10 金币)');
      if (wanted > 0) { openDialog(['罗莎:(压低声音)后门快走!卫兵刚搜过一轮,我可藏不住你。']); return; }
      if (player.coins >= 10) {
        player.coins -= 10;
        sfx.heart();
        sleepToMorning();
        queueDream();
        openDialog(['罗莎:(掀开门帘)天亮了,汤在灶上。伤都歇利索了吧?路上小心。']);
      } else {
        openDialog(['罗莎:住店 10 金币……先坐着喝口水吧,看你风尘仆仆的。']);
      }
      return;
    }
    if (n.key === 'innkeep' && player.drunkT <= 0) {
      if (probe) return NP('按 E 来一杯麦酒(2 金币)');
      // 满血就来一杯?
      if (player.coins >= 2) {
        player.coins -= 2;
        player.drunkT = 25;
        sfx.hiccup();
        if (++stats.drunks >= 3) unlockAch('drunkard');
        openDialog(['罗莎:(推来一大杯麦酒)自家酿的,后劲儿足——哎哎哎,你别一口闷啊!']);
      } else {
        openDialog(['罗莎:麦酒 2 金币。赊账?上一个赊账的还在后院劈柴呢。']);
      }
      return;
    }
    if (n.key === 'witch') {
      if (probe) {
        return NP(!player.spells.includes('fire') && player.coins >= 30 ? '按 E 买《火球术》卷轴(30 金币)'
          : player.loot > 0 ? `按 E 销赃 ×${player.loot}(每件 8 金币,不问来路)`
          : player.hp < player.maxHp ? '按 E 买回魂汤(8 金币)'
          : player.herbs > 0 ? `按 E 卖蘑菇 ×${player.herbs}(每朵 3 金币)`
          : player.coins >= 5 ? '按 E 求一卦(5 金币,她真算得准)' : '按 E 与沼泽女巫玛尔戈交谈');
      }
      if (!player.spells.includes('fire') && player.coins >= 30) {
        player.coins -= 30;
        sfx.chest();
        openDialog(['玛尔戈:(从袖子里抽出一卷焦边的羊皮纸)《火球术》。三十金币,童叟无欺。',
          '玛尔戈:念的时候手别抖——上一个手抖的,眉毛长了半年。'],
        () => learnSpell('fire'));
        return;
      }
      if (player.loot > 0) { // 销赃:她掂了掂,不问来路
        const pay = player.loot * 8;
        stats.fenced = (stats.fenced || 0) + player.loot;
        if (stats.fenced >= 10) unlockAch('blackmkt');
        player.coins += pay;
        sfx.coin();
        openDialog([`玛尔戈:(把${player.loot}件东西逐一对着月光掂了掂,金币从袖口滑出来)${pay} 枚。东西哪来的,我不问;钱哪去了,你也别说。`]);
        player.loot = 0;
        saveGame();
        return;
      }
      if (player.hp < player.maxHp) {
        if (player.coins >= 8) {
          player.coins -= 8;
          player.hp = player.maxHp;
          sfx.heart();
          openDialog(['玛尔戈:(舀了一勺冒泡的绿汤)喝。别问是什么,问了就不灵了。……看,好全了吧?']);
        } else {
          openDialog(['玛尔戈:一勺回魂汤,8 个金币。穷?那就去湖里洗把脸,精神精神。']);
        }
      } else if (player.herbs > 0) {
        const pay = player.herbs * 3;
        openDialog([`玛尔戈:(扒拉着你的蘑菇篓)成色不错……${player.herbs} 朵,${pay} 金币。别问进了哪口锅。`]);
        player.coins += pay;
        player.herbs = 0;
        sfx.coin();
      } else if (player.coins >= 5 && !aiBusy.fortune) {
        witchFortune(n);
      } else {
        openDialog([`玛尔戈:${EXTRA_NPCS.witch.lines[n.lineIdx++ % EXTRA_NPCS.witch.lines.length]}`], null,
          { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
      }
      return;
    }
    // 闲聊
    if (probe) return NP(n.key === 'king' ? '按 E 谒见领主' : `按 E 与${n.def.name}交谈`);
    npcTalk(n);
    return;
  }
  // 神秘商人
  if (director.mystic && dist2(player.pos.x, player.pos.z, director.mystic.pos.x, director.mystic.pos.z) < 6) {
    if (probe) return P('按 E 与兜帽商人交易(灵药 5 金币)', director.mystic.pos.x, director.mystic.pos.z, 2.15);
    if (player.hp < player.maxHp && player.coins >= 5) {
      player.coins -= 5;
      player.hp = player.maxHp;
      sfx.heart();
      openDialog(['兜帽商人:(递来一小瓶)喝吧。别问来路,好东西都没有来路。(生命全满)']);
    } else if (player.hp < player.maxHp) {
      openDialog(['兜帽商人:灵药 5 枚金币。没钱?缘分未到。']);
    } else {
      openDialog(['兜帽商人:你气色好得很,不需要我。有缘再会。(他朝虚空看了一眼)']);
    }
    return;
  }
  // 智慧牛:提问
  if (director.cow && dist2(player.pos.x, player.pos.z, director.cow.pos.x, director.cow.pos.z) < 8) {
    if (probe) return P(`按 E 向牛提问(还能问 ${Math.max(0, 5 - director.cow.asked)} 次)`, director.cow.pos.x, director.cow.pos.z, 1.8);
    const cow = director.cow;
    cow.asked++;
    cow.nodT = 1.4;
    cow.nodYes = rand() < 0.5;
    const lines = [cow.nodYes ? '「哞——」它缓缓地、郑重地点了点头。' : '「哞?」它把头摇得像磨坊的风车。'];
    if (cow.asked === 1) lines.unshift('(你凑到牛耳边,问了一个藏在心里的问题)');
    if (cow.asked === 3) lines.push('农夫汉克远远喊道:「别信它!上回它点头说不下雨,结果淹了我半亩地!」');
    if (cow.asked >= 5) lines.push('牛嚼了口草,似乎不打算再回答任何问题了。');
    openDialog(lines);
    return;
  }
  // 许愿池捞币人
  if (director.thief && dist2(player.pos.x, player.pos.z, director.thief.pos.x, director.thief.pos.z) < 6) {
    if (probe) return P('按 E 咳嗽一声', director.thief.pos.x, director.thief.pos.z, 2.15);
    player.coins += 2;
    sfx.coin();
    openDialog([
      '你重重咳嗽了一声。捞币人吓得原地蹦起,塞给你 2 枚湿漉漉的金币:「嘘——我在帮湖神清点!对,清点!」',
      '(他一步三滑地溜进了夜色。喷泉里的愿望们松了口气。)',
    ]);
    if (director.handle) director.handle.t = Math.min(director.handle.t, 0.01);
    return;
  }
  // 事件鸡优先(金鸡/越狱鸡:比旅店人群的交互更贴身优先)
  for (const c of chickens) {
    if (!c.extra || c.state === 'thrown' || c === player.carrying) continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      if (probe) return P(c.golden ? '按 E 抱住金鸡!!' : '按 E 抱住它!', c.pos.x, c.pos.z, 1.0);
      player.carrying = c;
      c.state = 'carried';
      sfx.cluck();
      toast('你一把抱住了它!', 2);
      return;
    }
  }
  // 竞技场主持人
  if (!arenaRT.active && dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 7) {
    if (probe) return P(`按 E 参加角斗(最佳纪录:${stats.arenaBest || 0} 波)`, arenaHost.pos.x, arenaHost.pos.z, 2.15);
    openDialog([
      `血牙:${HOST_LINES[arenaHost.lineIdx++ % HOST_LINES.length]}`,
      '血牙:想下场?站进沙圈,我一声锣响就开打。每清一波,赏金翻着涨。',
    ], () => {
      arenaRT.active = true;
      arenaRT.wave = 0;
      arenaRT.betweenT = 1.2;
      toast('🏟️ 角斗开始!站稳了!', 2.5);
    });
    return;
  }
  // 搞笑 NPC
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    if (probe) {
      return P({
        gambler: '按 E 掷骰子(赌 10 金币)',
        bard: '按 E 点一首《你自己的歌》',
        prophet: '按 E 听老糊涂的预言(?)',
        quixote: '按 E 与风车骑士交谈',
        storyteller: '按 E 听苟叔说书',
        strongman: `按 E 掰手腕(赌 15 赢 30${stats.arms ? `,战绩 ${stats.arms} 胜` : ''})`,
        merccap: `按 E 雇佣剑士(40 金币+每日 5 饷,随行 ${mercs.length}/2)`,
      }[n.key] || `按 E 与${n.def.name}交谈`, n.pos.x, n.pos.z, 2.15);
    }
    if (n.key === 'gambler') { gamble(); return; }
    if (n.key === 'strongman') { armWrestle(); return; }
    if (n.key === 'merccap') { hireMerc(); return; }
    if (n.key === 'bard') { bardSong(); return; }
    if (n.key === 'storyteller') { tellStory(); return; }
    if (n.key === 'prophet') {
      if (aiBusy.prophet) return;
      aiBusy.prophet = true;
      const fb = n.def.idle[n.lineIdx++ % n.def.idle.length];
      const seen = recallLine();
      aiLine(
        '你是中世纪疯预言家老糊涂,总说些打破第四面墙的怪话(比如怀疑世界是个游戏)。' +
        (seen ? `你还"看见"了眼前这人的过去:${seen}。` : '') + wsReport() +
        '用中文说一句50字以内的疯预言,可以拿以上内容做文章。只输出预言本身。', fb, 5000)
        .then((line) => {
          aiBusy.prophet = false;
          if (!dialog.open && !player.dead) openDialog([`疯子老糊涂:${line}`]);
        });
      return;
    }
    openDialog([`${n.def.name}:${n.def.idle[n.lineIdx++ % n.def.idle.length]}`], null,
      { key: null, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n });
    return;
  }
  // 自家信箱:有信时优先取信
  if (player.home && letter && dist2(player.pos.x, player.pos.z, HOME.x + 3.4, HOME.z + 3.2) < 5) {
    if (probe) return P('按 E 开信箱(小红旗立着——有信!)', HOME.x + 3.4, HOME.z + 3.2, 1.8);
    const L = letter;
    letter = null;
    stats.letters = (stats.letters || 0) + 1;
    if (stats.letters >= 3) unlockAch('penpal');
    remember(`在自家信箱收到了${L.from}的一封信`);
    sfx.chest();
    openDialog(['(你掀开自家信箱的盖子,把小红旗放平——里面躺着一封信)', `(${L.from}的信)${L.text}`]);
    if (L.from === '黑石兄弟会') vendettaRead();
    return;
  }
  // 龙骨之地的龙颅:习得战吼
  if (dist2(player.pos.x, player.pos.z, DRAGON_SKULL.x, DRAGON_SKULL.z) < 9) {
    if (probe) return P(shout.learned ? '(龙颅无话可教了。去吼吧——X 键)' : '按 E 把手放上龙颅', DRAGON_SKULL.x, DRAGON_SKULL.z, 2.5);
    learnShout();
    return;
  }
  // 湖畔小屋:买房 / 回家安眠
  if (dist2(player.pos.x, player.pos.z, HOME.doorX, HOME.doorZ) < 6) {
    if (probe) {
      return P(!player.home
        ? (player.coins >= HOME.price ? `按 E 买下湖畔小屋(${HOME.price} 金币)` : `(出售)湖畔小屋 ${HOME.price} 金币,还差 ${HOME.price - player.coins}`)
        : player.homeDay === calendar.day ? '(安眠中:移动 +8%。明天再睡)' : '按 E 回屋睡一觉(安眠:移动 +8%)', HOME.x, HOME.z, 3.2);
    }
    homeInteract();
    return;
  }
  // 悬赏板
  if (dist2(player.pos.x, player.pos.z, 8, 46) < 8) {
    if (probe) {
      return P(wanted > 0 ? `按 E 缴罚金撤销通缉(${wanted * 20} 金币)` : bountyRT.target ? '按 E 查看悬赏令' : '按 E 揭悬赏令(赏金 30)', 8, 46, 2.4);
    }
    if (wanted > 0) {
      const fine = wanted * 20;
      if (player.coins >= fine) {
        player.coins -= fine;
        clearWanted();
        sfx.clear();
        openDialog([`(你把 ${fine} 枚金币塞进告示板下的罚金箱)卫兵把你的通缉令撕了下来。你自由了——暂时。`]);
      } else {
        openDialog([`(告示板)你的通缉罚金是 ${fine} 金币,兜里不够。要么凑钱,要么躲风头。`]);
      }
      return;
    }
    if (bountyRT.target) openDialog([`(告示板)悬赏令仍在追缉中——「${bountyRT.name}」,${bountyRT.crime ? `罪状:${bountyRT.crime}` : '生死不论'}。`], null, wantedPosterSpeaker());
    else if (bountyRT.cooldown > 0) openDialog(['(告示板)新的悬赏令还没贴出来,过一会儿再来看看。']);
    else takeBounty();
    return;
  }
  // 王国公告牌(每日 AI 撰写;日期对不上就重写,防陈旧)
  if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
    if (probe) return P('按 E 看今日王国公告', NOTICE_POS.x, NOTICE_POS.z, 2.2);
    if (!proclaimText || !proclaimText.includes(`第 ${seasonDay()} 日`)) refreshProclaim();
    openDialog([proclaimText || composeProclaimOffline()]);
    return;
  }
  // 村务板(无限支线)
  if (dist2(player.pos.x, player.pos.z, CHORE_POS.x, CHORE_POS.z) < 6) {
    if (probe) {
      return P(!sideQuest.active ? '按 E 接一桩村务(无限)'
        : choreReady() ? '按 E 交差领赏!' : `按 E 看村务进度(${sideQuest.giver})`, CHORE_POS.x, CHORE_POS.z, 2.2);
    }
    choreBoard();
    return;
  }
  // 世界观铭文
  for (const s of loreStones) {
    if (dist2(player.pos.x, player.pos.z, s.def.x, s.def.z) < 8) {
      if (probe) {
        return P(loreRead.includes(LORE.indexOf(s.def))
          ? `按 E 重读铭文《${s.def.title}》` : `按 E 阅读铭文(${loreRead.length}/${LORE.length})`, s.def.x, s.def.z, 2.0);
      }
      readLore(s);
      return;
    }
  }
  // 王室地窖:暗门进出与圣坛
  if (dist2(player.pos.x, player.pos.z, DGN.hatch.x, DGN.hatch.z) < 6) {
    if (probe) return P('按 E 掀开暗门(被封印的地窖)', DGN.hatch.x, DGN.hatch.z, 1.2);
    enterDungeon();
    return;
  }
  if (inDungeon()) {
    if (dist2(player.pos.x, player.pos.z, DGN.exit.x, DGN.exit.z) < 6) {
      if (probe) return P('按 E 爬回地面', DGN.exit.x, DGN.exit.z, 1.2);
      exitDungeon();
      return;
    }
    if (dist2(player.pos.x, player.pos.z, DGN.relic.x, DGN.relic.z) < 6) {
      if (probe) return P(player.relic ? '(空了的圣坛)' : '按 E 请下「先王战徽」', DGN.relic.x, DGN.relic.z, 1.6);
      takeRelic();
      return;
    }
  }
  // 湖上摆渡与月光祭坛
  if (dist2(player.pos.x, player.pos.z, BOAT_PIER.x, BOAT_PIER.z) < 8) {
    if (probe) return P('按 E 划船去湖心岛', BOAT_PIER.x, BOAT_PIER.z, 1.2);
    rowTo({ x: -100, z: 102.5 }, '🏝️ 湖心岛。断柱与祭坛都在水声里等你。');
    return;
  }
  if (dist2(player.pos.x, player.pos.z, BOAT_ISLE.x, BOAT_ISLE.z) < 6) {
    if (probe) return P('按 E 划船回栈桥', BOAT_ISLE.x, BOAT_ISLE.z, 1.2);
    rowTo({ x: -98, z: 83 });
    return;
  }
  if (dist2(player.pos.x, player.pos.z, -100, 100.5) < 5) {
    if (probe) return P(lakeBlessed ? '(祭坛记得你)' : '按 E 触碰月光祭坛', -100, 100.5, 1.6);
    prayAltar();
    return;
  }
  // 栈桥垂钓 / 湖心岛深水垂钓
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT.x, FISH_SPOT.z) < 10) {
    if (probe) return P('按 E 垂钓', FISH_SPOT.x, FISH_SPOT.z, 1.6);
    startFishing();
    return;
  }
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z) < 7) {
    if (probe) return P('按 E 深水垂钓(岛边的鱼更肥)', FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z, 1.4);
    startFishing(true);
    return;
  }
  // 赛马计时赛
  if (dist2(player.pos.x, player.pos.z, TRIAL_FLAG.x, TRIAL_FLAG.z) < 8) {
    if (probe) {
      return P(trialRT.active ? '按 E 放弃计时赛'
        : `按 E 开始赛马计时赛${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)}s)` : ''}`, TRIAL_FLAG.x, TRIAL_FLAG.z, 3.0);
    }
    if (trialRT.active) endTrial(false);
    else startTrial();
    return;
  }
  // 白狼霜牙:喂鹿肉驯服
  if (!frostfang.tamed && frostfang.wary &&
      dist2(player.pos.x, player.pos.z, frostfang.wary.pos.x, frostfang.wary.pos.z) < 26) {
    if (probe) {
      return P(player.venison > 0 ? `按 E 喂鹿肉给白狼(驯服 ${frostfang.feed}/3)` : '🐺 白狼想要鹿肉(去猎一头鹿)',
        frostfang.wary.pos.x, frostfang.wary.pos.z, 1.3);
    }
    if (player.venison > 0) {
      player.venison--;
      frostfang.feed++;
      sfx.heart();
      if (frostfang.feed >= 3) tameFrostfang();
      else toast(`🐺 白狼叼走了鹿肉,退开两步,眼神软了一点(${frostfang.feed}/3)`, 3.5);
    } else {
      toast('🐺 白狼盯着你的手——它想要的是鹿肉。', 2.5);
    }
    return;
  }
  // 篝火烤肉
  {
    const cf = nearestSpot('campfire', 30);
    if (cf && player.venison > 0) {
      if (probe) return P(`按 E 烤鹿肉(回 ❤×1.5,剩 ×${player.venison})`, cf.x, cf.z, 1.2);
      player.venison--;
      player.hp = Math.min(player.maxHp, player.hp + 3);
      sfx.heart();
      stats.cooked = (stats.cooked || 0) + 1;
      choreProgress('cook');
      if (stats.cooked >= 5) unlockAch('chef');
      toast(`🍖 烤鹿肉滋滋作响……回复 ❤×1.5(剩余鹿肉 ×${player.venison})`, 3);
      return;
    }
  }
  // 遗迹教堂:祈祷得庇佑(每日一次)
  {
    const ch = nearestSpot('chapel', 30);
    if (ch) {
      if (probe) return P(blessDay !== calendar.day ? '按 E 在石坛前祈祷(获得庇佑)' : '(神明今日已听过你的祷告)', ch.x, ch.z, 2.0);
      if (blessDay !== calendar.day) {
        blessDay = calendar.day;
        player.blessT = 120;
        choreProgress('pray');
        sfx.fanfare();
        openDialog(['(你在断壁间的石坛前低头片刻。风从缺了顶的殿堂穿过,像一声很轻的应答。)',
          '✨ 获得庇佑:脚下生风(移动加速,120 秒)'],
        () => learnSpell('heal'));
      } else {
        openDialog(['(石坛安静。神明今日已听过你的祷告——祂也需要歇一歇。)']);
      }
      return;
    }
  }
  // 回响之镜:与世界的意识对话
  if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 9) {
    if (probe) return P('按 E 凝视回响之镜', MIRROR_POS.x, MIRROR_POS.z, 2.3);
    mirrorTalk();
    return;
  }
  // 采蘑菇
  for (const m of mushrooms) {
    if (!m.picked && dist2(player.pos.x, player.pos.z, m.x, m.z) < 4) {
      if (probe) return P('按 E 采蘑菇', m.x, m.z, 0.8);
      m.picked = true;
      m.group.visible = false;
      player.herbs++;
      stats.mushrooms = (stats.mushrooms || 0) + 1;
      if (stats.mushrooms >= 15) unlockAch('forager');
      sfx.coin();
      toast(`🍄 采到一朵伞菇(篓里 ×${player.herbs},女巫玛尔戈按 3 金币收)`, 2.5);
      return;
    }
  }
  // 抱鸡(半径小,贴身优先)
  for (const c of chickens) {
    if (c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      if (probe) return P('按 E 抱起鸡(为什么?)', c.pos.x, c.pos.z, 1.0);
      player.carrying = c;
      c.state = 'carried';
      sfx.cluck();
      toast(rand() < 0.4 ? `🐔 ${COMEDY_LINES[Math.floor(rand() * COMEDY_LINES.length)]}` : '你抱起了一只鸡。它一脸问号。', 2.5);
      return;
    }
  }
  // 村民对话(优先 100 万字对话库,按情境选行;AI 情境台词后台预取,下次开口就用)
  for (const v of villagers) {
    if (v.downT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 5.5) continue;
    if (probe) return P(`按 E 与${v.id.name}交谈`, v.pos.x, v.pos.z, 2.05);
    const l1 = v.aiNext || dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
    v.aiNext = null;
    // 你的事迹在村里口口相传(编年史)
    const deed = recallLine();
    let l2;
    const deedsV = v.dbKey === 'v11' ? chronicleDeeds() : [];
    if (deedsV.length && rand() < 0.4) {
      // 抄写员薇拉:你的事迹被写进编年史正文(同一套白名单,只录你亲手做的事)
      const m = deedsV[Math.floor(rand() * deedsV.length)];
      l2 = `(翻开编年史,蘸了蘸墨)「历第 ${m.d} 日,绿衣游侠林恩${m.t}。」——已录入正史,后人会读到的。`;
    } else if (EVO.legends.length && rand() < 0.3) {
      // 传说演化:村民复述最热的那条(复述本身就是传播 → 热度自增,被自然选择留下)
      const l = EVO.legends.reduce((b, x) => (x.heat > b.heat ? x : b));
      l.heat++;
      l2 = `街坊传得有鼻子有眼:「${legendText(l)}」——这话都传到第 ${l.gen} 种说法了,越传越神。`;
    } else {
      l2 = deed && rand() < 0.25
        ? ['听说你', '有人瞧见你', '街坊都在传,说你'][Math.floor(rand() * 3)] + deed + '。真有你的。'
        : dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
    }
    openDialog([`${v.id.name}:${l1}`, `${v.id.name}:${l2}`], null,
      { key: v.dbKey, name: v.id.name, desc: VILLAGER_DESC_EN[villagers.indexOf(v)] || 'villager', ent: v });
    if (!AI_TEXT_OFF && !v.aiPending && rand() < 0.35) {
      v.aiPending = true;
      const sp = todaySpecial();
      aiLine(
        `你是中世纪王国的村民「${v.id.name}」。现在是${SEASONS[seasonIdx()]}季` +
        `${sp ? '·' + sp.name : ''},${{ dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜里' }[dayPhase()]},` +
        `天气${{ clear: '晴', cloudy: '多云', rain: '下雨', storm: '雷暴' }[weather.state]}。` +
        (workspace.current ? `眼前这位客人的近况:${workspace.current.t}。` : '') +
        '用中文说一句40字以内、符合你身份的闲聊,口语化,不要引号不要名字前缀。', null, 9000,
      ).then((t) => { v.aiPending = false; if (t) v.aiNext = t; });
    }
    return;
  }
  // 喷泉许愿
  if (player.coins > 0 && dist2(player.pos.x, player.pos.z, 0, 5) < 20) {
    if (probe) return P('按 E 向喷泉许愿(1 金币)', 0, 5, 3);
    fountainWish();
    return;
  }
  // 宝箱
  for (const c of world.chests) {
    if (!c.opened && dist2(player.pos.x, player.pos.z, c.x, c.z) < 5) {
      if (probe) return P('按 E 打开宝箱', c.group.position.x, c.group.position.z, 1.5);
      c.opened = true;
      sfx.chest();
      const wx = c.group.position.x, wz = c.group.position.z;
      for (let i = 0; i < 8; i++) {
        const a = rand() * 6.28;
        addPickup('coin', wx + Math.cos(a) * (1 + rand() * 1.5), wz + Math.sin(a) * (1 + rand() * 1.5), 40);
      }
      addPickup('heart', wx, wz + 1.2, 40);
      toast('打开了宝箱!', 2);
      return;
    }
  }
  // 上马
  const best = nearestMountable();
  // 墓园漫步:读一块墓志铭(最低优先级,别挡着上马;AI 后台补写新碑文)
  if (!best && dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    if (probe) return P('按 E 读一块墓志铭');
    const text = epitaphAI || EPITAPHS[epitaphIdx++ % EPITAPHS.length];
    epitaphAI = null;
    openDialog(['(你拂去一块墓碑上的落叶)', `「${text}」`]);
    if (!AI_TEXT_OFF && !aiBusy.epitaph) {
      aiBusy.epitaph = true;
      aiLine('为中世纪村庄墓园写一条墓志铭,15~40字,可庄重可幽默可温柔,只输出铭文本身,不要引号。', null, 9000)
        .then((t) => { aiBusy.epitaph = false; if (t) epitaphAI = t; });
    }
    return;
  }
  if (best) return mountHorse(best, probe, P);
  return null;
}

function clearRaceRings() {
  for (const r of questRT.rings) scene.remove(r);
  questRT.rings = [];
}

function dismissMinions() {
  // Boss 一倒,狂暴亲卫作鸟兽散(免得留下两个不被剔除的常驻敌人)
  for (let i = bandits.length - 1; i >= 0; i--) {
    if (bandits[i].minion) retireEntity(bandits[i], bandits);
  }
}
function removeEscortBandits() {
  for (let i = bandits.length - 1; i >= 0; i--) {
    if (bandits[i].escort) retireEntity(bandits[i], bandits);
  }
}

function failMission(msg) {
  quest.active = false;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { retireEntity(questRT.merchant); questRT.merchant = null; }
  removeEscortBandits(); // 伏兵随任务失败一并撤走,否则重接任务时旧伏兵会追杀新商人
  toast(msg, 3.5);
}

// 埃隆在哪:白天在喷泉广场,夜里回城堡(和他的作息表一致)
function stewardWhere() { return dayPhase() === 'night' ? '城堡' : '喷泉广场'; }
// 信使带来的委托书:不计时的委托办完后可以原地接下一单(计时委托要回城找埃隆,免得一接就超时)
function canAcceptRemotely() {
  const nx = missions[quest.idx];
  return !!nx && !quest.active && !nx.time && quest.offerT > 0;
}
function talkQuestGiver(remote = false) {
  if (quest.idx >= missions.length) {
    toast('埃隆:王国感谢你,勇者!去见领主大人吧,他有话对你说。', 3.5);
    return;
  }
  const m = missions[quest.idx];
  if (!quest.active) {
    quest.active = true;
    quest.progress = 0;
    quest.timer = m.time || 0;
    quest.offerT = 0;
    sfx.accept();
    openDialog(remote ? ['(王室信使勒住马,递来一封盖着火漆的委托书)', m.brief.replace(/^埃隆:/, '埃隆(信中):')] : [m.brief]);
    toastQuest(`接受委托【${m.title}】:${m.desc}`, 4.5);
    if (m.type === 'deliver') {
      const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.3), lambert(0xb4813f));
      parcel.position.set(0, 1.0, -0.24);
      player.group.add(parcel);
      player.parcel = parcel;
    } else if (m.type === 'bandits') {
      for (const [ox, oz] of [[-4, 2], [4, -2], [0, 6]]) addBandit(world.banditCamp.x + ox, world.banditCamp.z + oz).campFoe = true;
      // 营地头目:会二连击和紫色破盾重击(第一次见紫色会弹教学卡)
      const cap = addBandit(world.banditCamp.x, world.banditCamp.z - 4, { hp: 5, dmg: 2, speed: 5.6, scale: 1.12 });
      cap.elite = true;
      cap.captain = true;
      cap.campFoe = true;
    } else if (m.type === 'race') {
      if (trialRT.active) endTrial(false); // 接正赛前先收计时赛的环
      questRT.ringIdx = 0;
      clearRaceRings();
      for (const [rx, rz] of world.raceRoute) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
          new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x996600, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
        ring.position.set(rx, 2.4, rz);
        scene.add(ring);
        questRT.rings.push(ring);
      }
    } else if (m.type === 'losthorse') {
      if (!questRT.specialHorse) {
        questRT.specialHorse = addHorse(world.lostHorsePos.x, world.lostHorsePos.z, 0xf2efe6, false);
        questRT.specialHorse.special = true;
      }
    } else if (m.type === 'escort') {
      const mc = { ...makeHumanoid({ shirt: 0xb4813f, pants: 0x4a3a26, hair: 0x3a2a1a }),
        pos: new THREE.Vector3(world.escortRoute[0][0], 0, world.escortRoute[0][1]),
        yaw: 0, hp: 5, wp: 0, walkT: 0 };
      mc.group.position.copy(mc.pos);
      scene.add(mc.group);
      questRT.merchant = mc;
      questRT.escortSpawned = 0;
    } else if (m.type === 'boss') {
      questRT.boss = addBandit(world.fortPos.x, world.fortPos.z - 2,
        { boss: true, hp: 12, speed: 6.8, scale: 1.35, dmg: 2 });
      addBandit(world.fortPos.x - 5, world.fortPos.z + 3);
      addBandit(world.fortPos.x + 5, world.fortPos.z + 3);
      toast('⚔️ 血斧巴罗克在黑石要塞等着你……', 4);
    }
  } else if (m.type === 'coins' && quest.progress >= m.goal) {
    completeMission();
  } else {
    toast(`任务进行中:${m.desc}`, 3);
  }
}

// 结算面板:委托名、赏金、下一单是什么、去哪接——一眼看清"刚做完什么、接下来做什么"
const rewardEl = document.getElementById('reward');
let rewardHideT = 0;
function showReward(head, title, bonus, next) {
  if (!rewardEl) return;
  rewardEl.querySelector('.rw-h').textContent = head;
  rewardEl.querySelector('.rw-t').textContent = title;
  rewardEl.querySelector('.rw-b').textContent = bonus;
  rewardEl.querySelector('.rw-n').textContent = next;
  rewardEl.style.display = 'block';
  requestAnimationFrame(() => rewardEl.classList.add('show'));
  clearTimeout(rewardHideT);
  rewardHideT = setTimeout(() => {
    rewardEl.classList.remove('show');
    setTimeout(() => { if (!rewardEl.classList.contains('show')) rewardEl.style.display = 'none'; }, 400);
  }, 5200);
}
function completeMission() {
  const m = missions[quest.idx];
  player.coins += m.reward;
  remember(`替领主府办结了委托「${m.title}」`, `m-${quest.idx}`);
  sfx.fanfare();
  const nx = missions[quest.idx + 1];
  showReward('委 托 完 成', m.title, `🪙 +${m.reward} 金币`,
    !nx ? '全部委托完成!去喷泉广场领取金狮勋章,再去见领主。'
      : nx.time ? `下一单:${nx.title} —— ${nx.desc}\n限时委托:回${stewardWhere()}找管家埃隆接取(光柱指路)`
        : `下一单:${nx.title} —— ${nx.desc}\n王室信使已在路上:按 E 原地接下(或回${stewardWhere()}找埃隆)`);
  quest.active = false;
  quest.idx++;
  quest.offerT = nx && !nx.time ? 12 : 0;
  dropQuestToasts(); // 上一单的过期提示作废
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { retireEntity(questRT.merchant); questRT.merchant = null; }
  removeEscortBandits();
  saveGame();
  if (quest.idx >= missions.length) {
    addPickup('star', 0, 13);
    toastQuest('全部委托完成!去喷泉广场领取 ★ 金狮勋章 ★,再去见领主领赏!', 6);
  }
}

// ================= 攻击 =================
// 近战横扫判定:普通挥击与蓄力重击共用(dmg/范围/角度/击退可调)
// ================= 打击手感核心 =================
// 攻击磁吸:出手瞬间吸附朝向前方最近的敌人,差一步自动垫步,人跟着刀走
// 攻击磁吸:转身咬住前方最近的敌人;noStep=true 时只转向不垫步(冲刺突斩自己算扑出距离)。返回目标 { d, dx, dz } 或 null
function faceNearestFoe(range, noStep = false) {
  let best = null, bd = (range + 2.4) * (range + 2.4);
  // 锁定中:刀只认锁定的目标,免得磁吸把人拽向别的敌人
  if (lockFoe && !lockFoe.dead && !(lockFoe.downT > 0)) {
    const dx = lockFoe.pos.x - player.pos.x, dz = lockFoe.pos.z - player.pos.z;
    const d2v = dx * dx + dz * dz;
    if (d2v < (range + 3.5) * (range + 3.5)) best = { d: Math.sqrt(d2v) || 1, dx, dz };
  }
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  if (!best) for (const list of [bandits, wolves, guards]) {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d2v = dx * dx + dz * dz;
      if (d2v > bd) continue;
      const d = Math.sqrt(d2v) || 1;
      if ((dx * fx + dz * fz) / d < 0.05) continue; // 只吸前方 ~±87°
      bd = d2v;
      best = { d, dx, dz };
    }
  }
  if (!best) return null;
  player.yaw = Math.atan2(best.dx, best.dz); // 刀锋咬住目标
  if (noStep) return best;
  const gap = best.d - (range - 0.5);
  const step = gap > 0 ? Math.min(gap, 1.5) : 0.3; // 够不着就垫步;够得着也向前压半步
  if (!(player.lungeT > 0)) lunge(best.dx, best.dz, step, 0.1); // 垫步在 0.1 秒内滑过去,不瞬移
  return best;
}
// ================= 目标锁定(Tab)=================
// 骑砍式对峙:镜头咬住敌人环绕,人始终面向目标侧移;死亡/倒地/拉开距离自动解除
let lockFoe = null;
// 锁定目标的唯一写入口(拆出去的系统用它,不直接改 lockFoe)
function setLockFoe(e) { lockFoe = e; if (!e) lockMark.visible = false; }
const lockMark = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 4),
  new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.9, depthWrite: false }));
lockMark.rotation.x = Math.PI; // 尖朝下悬在头顶
lockMark.visible = false;
lockMark.frustumCulled = false;
scene.add(lockMark);
function toggleLock() {
  if (!started || player.dead) return;
  if (lockFoe) { lockFoe = null; lockMark.visible = false; sfx.roll(); return; }
  let best = null, bd = 20 * 20;
  for (const list of [bandits, wolves, guards]) {
    if (list === guards && wanted === 0) continue; // 没通缉就别锁卫兵
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const d2v = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      if (d2v < bd) { bd = d2v; best = e; }
    }
  }
  if (best) { lockFoe = best; sfx.equip(); }
  else toast('附近没有可锁定的目标', 1.2);
}
// 锁定目标血条(名字 + 血量,顶部居中)
const lockhpEl = document.getElementById('lockhp'),
  lockhpNameEl = document.getElementById('lockhp-name'),
  lockhpFillEl = document.getElementById('lockhp-fill');
function foeName(e) {
  if (e.warlord) return '⚔️ 战团枭首';
  if (e.boss) return '🪓 血斧巴罗克';
  if (e.bountyHead) return '💀 悬赏要犯';
  if (e.duel) return '🗡️ 决斗者';
  if (wolves.includes(e)) return '🐺 恶狼';
  if (guards.includes(e)) return '🛡️ 王国卫兵';
  return '🔪 盗贼';
}
function updateLock(dt) {
  if (!lockFoe) { lockhpEl.style.display = 'none'; return; }
  if (lockFoe.dead || lockFoe.downT > 0 || player.dead ||
      dist2(player.pos.x, player.pos.z, lockFoe.pos.x, lockFoe.pos.z) > 26 * 26 ||
      (!bandits.includes(lockFoe) && !wolves.includes(lockFoe) && !guards.includes(lockFoe))) {
    lockFoe = null;
    lockMark.visible = false;
    lockhpEl.style.display = 'none';
    return;
  }
  lockMark.visible = true;
  const h = lockFoe.parts && lockFoe.parts.head ? 2.45 : 1.5; // 人形头顶/狼背上方
  lockMark.position.set(lockFoe.pos.x,
    (lockFoe.pos.y || 0) + h + Math.sin(performance.now() * 0.006) * 0.07, lockFoe.pos.z);
  lockMark.rotation.y += dt * 3;
  lockFoe._maxHp = Math.max(lockFoe._maxHp || 0, lockFoe.hp); // 见过的最高血量当上限
  lockhpEl.style.display = 'block';
  lockhpNameEl.textContent = foeName(lockFoe);
  lockhpFillEl.style.width = `${Math.max(0, Math.min(1, lockFoe.hp / lockFoe._maxHp)) * 100}%`;
}

// ================= 战斗音乐:遇敌切紧张曲,脱战 4 秒回吟游调 =================
let combatCalmT = 0;
function updateCombatMusic(dt) {
  let hot = false;
  for (const list of [bandits, wolves]) {
    for (const e of list) {
      if (e.dead || e.downT > 0 || e.fleeT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 14 * 14) { hot = true; break; }
    }
    if (hot) break;
  }
  if (!hot && wanted > 0) { // 被通缉追捕也算交战
    for (const g of guards) {
      if (g.downT > 0 || g.state !== 'chase') continue;
      if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16 * 16) { hot = true; break; }
    }
  }
  if (dragonRT.on && dragonRT.hp > 0 &&
      dist2(player.pos.x, player.pos.z, dragonRT.ent.group.position.x, dragonRT.ent.group.position.z) < 3600) hot = true;
  combatCalmT = hot ? 4 : Math.max(0, combatCalmT - dt);
  setCombatMusic(combatCalmT > 0, (warband.active && warband.siege) || dragonRT.on); // 屠龙也配战鼓
}
// ================= 盗贼战团(骑砍式野战遭遇)=================
// 每隔几分钟,一支五人战团(枭首+四喽啰)从旷野压向王都:半路截杀=犒赏,放进城=集市遭殃
const warband = { active: false, members: [], cd: 100 + rand() * 60, lootT: 0, wave: 0 };
function spawnWarband() {
  warband.active = true;
  warband.members = [];
  warband.lootT = 0;
  warband.pKills = 0;
  warband.gKills = 0;
  // 只从东、南、北面来:西边隔着河(唯一的木桥在 (-95,-34)),从那边刷出会卡在河岸
  const a = -Math.PI * 0.75 + rand() * Math.PI * 1.5;
  const sx = Math.cos(a) * 120, sz = Math.sin(a) * 120;
  // 行军路线:先到离出发点最近的城门,再进城压向广场
  const gate = world.gates.reduce((g0, g1) =>
    (Math.hypot(g0.x - sx, g0.z - sz) <= Math.hypot(g1.x - sx, g1.z - sz) ? g0 : g1));
  const outX = gate.x + Math.sign(gate.x) * 12, outZ = gate.z + Math.sign(gate.z) * 12; // 门外集结点
  warband.path = [[outX, outZ], [gate.x, gate.z], [0, 10]];
  warband.wp = 0;
  warband.ax = sx;
  warband.az = sz;
  warband.bestD = Infinity;
  warband.stallT = 0;
  // 越剿越强:每覆灭一支,下一支多一个喽啰(封顶 8),枭首更硬;每第四波=倾巢攻城
  warband.siege = (warband.wave + 1) % 4 === 0 && warband.wave > 0;
  const grunts = warband.siege ? 9 : Math.min(8, 4 + warband.wave);
  const lead = addBandit(sx, sz, { hp: warband.siege ? 12 : 10 + warband.wave, dmg: 2, speed: 5.4, scale: 1.12 });
  lead.warlord = true;
  lead.duel = true; // 借精英出招库:紫圈重击+二连击
  lead.warband = true;
  lead._ox = 0; lead._oz = 0;
  warband.members.push(lead);
  for (let i = 0; i < grunts; i++) {
    const ox = rand() * 8 - 4, oz = rand() * 8 - 4;
    const b = addBandit(sx + ox, sz + oz, { hp: 3 });
    b.warband = true;
    b._ox = ox; b._oz = oz; // 队形:相对锚点的站位
    warband.members.push(b);
  }
  const compass = Math.abs(sx) > Math.abs(sz) ? (sx > 0 ? '东' : '西') : (sz > 0 ? '南' : '北');
  if (warband.siege) {
    toast(`🚨 攻城警报!!枭首纠集 ${warband.members.length} 人大队从${compass}面强攻王都!卫兵已列阵迎敌——并肩守城!(冲到枭首面前按 E 可阵前单挑)`, 6);
    sfx.wanted();
    { // 城防:来袭方向支起两座拒马迟滞敌军
      const dl = Math.hypot(sx, sz - 10) || 1;
      const ux = sx / dl, uz = (sz - 10) / dl;
      addBarricade(ux * 24 - uz * 3, 10 + uz * 24 + ux * 3);
      addBarricade(ux * 30 + uz * 3, 10 + uz * 30 - ux * 3);
      toast('🪵 卫兵连夜在城门外支起了拒马!(敌军踩入减速)', 3.5);
    }
  } else {
    toast(`⚠️ 斥候急报:一支盗贼战团(${warband.members.length} 人)正从${compass}面逼近王都!半路截住他们!` +
      (warband.wave > 0 ? '(为复仇而来,比上次更凶)' : ''), 5);
  }
  sfx.warn();
}
function disbandWarband(escaped) {
  for (const b of warband.members) {
    if (escaped && !b.dead) { b.dead = true; b.group.visible = false; }
    const gone = b;
    later(4, () => { // 尸体躺一会儿再收,别当场蒸发
      scene.remove(gone.group);
      disposeEntityGroup(gone.group);
      flashing.delete(gone);
      const i = bandits.indexOf(gone);
      if (i >= 0) bandits.splice(i, 1);
    });
  }
  warband.members = [];
  warband.active = false;
  warband.cd = 150 + rand() * 120;
}
// 枭首临阵叫骂:走近了他会冲你喊话;复仇之师另有一套狠话,偶尔帮众跟着起哄(吃活体语料)
const WARLORD_TAUNTS = [
  '这座城的卫兵,还没我营里的火夫能打!',
  '把值钱的交出来,饶你一条腿!',
  '兄弟们——集市是我们的了!',
  '听说你很能打?正好,我的刀锈了。',
  '别躲了,出来领死!',
];
const WARLORD_REVENGE = [
  '上次死的是我兄弟——今天拿你抵命!',
  '记住这面旗,它会插在你坟头!',
  '我们回来了,这次带够了人手!',
];
function updateWarband(dt) {
  if (!started || player.dead) return;
  if (!warband.active) {
    if (!prologue.on && quest.idx >= 3) warband.cd -= dt; // 新手先办完剿匪委托,战团才开始出没
    if (warband.cd <= 0) spawnWarband();
    return;
  }
  // 阵前单挑:枭首一死,全军夺气而溃——兵不血刃
  if (warband.duelOn) {
    const lead = warband.members.find((b) => b.warlord);
    if (!lead || lead.dead) {
      warband.duelOn = false;
      const wasSiege = warband.siege;
      warband.wave++;
      for (const b of warband.members) if (!b.dead) { b._truce = false; b.fleeT = 9; }
      warband.active = false;
      warband.cd = 150 + rand() * 120;
      later(3.5, () => disbandWarband(true)); // 跑出视野再散伙
      toast('⚔️🏆 枭首伏诛!战团夺气,作鸟兽散——兵不血刃!(+100 金币)', 6);
      sfx.fanfare();
      player.coins += 100;
      if (!player.weaponsOwned.includes('warblade')) { // 夺刀:枭首的佩刃归胜者
        player.weaponsOwned.push('warblade');
        sfx.chest();
        toast('⚜️ 你拾起枭首的佩刃——「枭首之刃」入手!(Q 切换:更快更狠的单手刃)', 5);
        remember('从枭首尸体旁拾起了他的佩刃', 'warblade');
      }
      unlockAch('champion');
      if (wasSiege) unlockAch('wallkeeper');
      remember('阵前单挑斩落枭首,吓散整支战团', `duel-${calendar.day}`);
      return;
    }
  }
  const alive = warband.members.filter((b) => !b.dead);
  warband.tauntT = (warband.tauntT || 0) - dt;
  const lead0 = alive.find((b) => b.warlord);
  // 枭首叫骂:头顶冒一句(不进提示队列),30 秒一次
  if (lead0 && warband.tauntT <= 0 &&
      dist2(player.pos.x, player.pos.z, lead0.pos.x, lead0.pos.z) < 625) {
    warband.tauntT = 30;
    const pool = warband.wave > 0 && rand() < 0.6 ? WARLORD_REVENGE : WARLORD_TAUNTS;
    callout(`「${pool[Math.floor(rand() * pool.length)]}」`, 'red', lead0.pos);
  }
  if (!alive.length) { // 全歼:犒赏;残党记仇,下一支更大
    const wasSiege = warband.siege;
    warband.wave++;
    disbandWarband(false);
    if (wasSiege) {
      toast('🏰 攻城被击退!!卫兵们冲你抱拳——王都记住了这一天。(犒赏 +80 金币)', 6);
      player.coins += 80;
      stats.siegesHeld = (stats.siegesHeld || 0) + 1;
      unlockAch('wallkeeper');
      openDialog([
        `📜 守城战报:敌军 ${warband.pKills + warband.gKills} 人授首——你亲斩 ${warband.pKills} 人,卫兵击破 ${warband.gKills} 人。`,
        warband.pKills >= warband.gKills ? '卫兵队长:「今天这城,是你守下来的。」' : '卫兵队长:「弟兄们今天很卖力——你也不赖。」',
      ]);
      remember('与卫兵并肩击退了强攻王都的盗贼大军', `siege-${calendar.day}`);
    } else {
      toast('🎖️ 战团覆灭!你护住了王都的安宁。(悬赏 +25 金币)', 4.5);
      player.coins += 25;
      stats.warbandsWiped = (stats.warbandsWiped || 0) + 1;
      unlockAch('warbreaker');
      remember('在野外截住并全歼了一支盗贼战团', `warband-${calendar.day}`);
    }
    sfx.fanfare();
    return;
  }
  // 行军:队伍的锚点沿航点(门外集结 → 城门 → 广场)稳步推进,成员按队形跟着锚点;
  // 贴近玩家的成员自动切普通战斗 AI
  const path = warband.path || [[0, 10]];
  const wpT = path[Math.min(warband.wp || 0, path.length - 1)];
  {
    const dx = wpT[0] - warband.ax, dz = wpT[1] - warband.az;
    const d = Math.hypot(dx, dz);
    const last = (warband.wp || 0) >= path.length - 1;
    if (d < (last ? 14 : 3) && !last) warband.wp++;
    else if (d > (last ? 14 : 0.5)) {
      // 锚点别跑出队伍太远:成员落后(被卡住/在打架)时锚点等人
      let lag = 0;
      for (const b of alive) lag = Math.max(lag, Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z));
      const sp = lag > 14 ? 0.6 : 4.2;
      warband.ax += (dx / d) * sp * dt;
      warband.az += (dz / d) * sp * dt;
    }
  }
  for (const b of alive) {
    b.home.x = warband.ax + (b._ox || 0);
    b.home.z = warband.az + (b._oz || 0);
  }
  // 卡住兜底:60 秒没有朝广场推进 5 米以上,战团畏缩撤走(横幅一并清掉)
  {
    let sum = 0;
    for (const b of alive) sum += Math.hypot(b.pos.x, b.pos.z - 10);
    const avg = sum / alive.length;
    const engaged = alive.some((b) => dist2(b.pos.x, b.pos.z, player.pos.x, player.pos.z) < 900); // 正和你交手:不算卡住
    if (avg < warband.bestD - 5 || engaged) { warband.bestD = Math.min(warband.bestD, avg); warband.stallT = 0; }
    else warband.stallT += dt;
    if (warband.stallT > 60 && !warband.siege) {
      disbandWarband(true);
      toast('🏳️ 盗贼战团迟迟攻不进来,悻悻撤走了。', 4);
      return;
    }
  }
  // 兵临集市:赖满 20 秒没被赶走=劫掠得手,扬长而去
  const lead = alive[0];
  if (Math.hypot(lead.pos.x, lead.pos.z - 10) < 26) {
    warband.lootT += dt;
    if (warband.lootT > 20) {
      disbandWarband(true);
      toast('💥 盗贼战团劫掠了集市,扬长而去!商人们叫苦不迭……', 5);
      remember('没能拦住劫掠集市的盗贼战团', `warloot-${calendar.day}`);
    }
  }
}

// ================= 士气(骑砍式):血腥震慑,残兵溃逃 =================
let streakN = 0, streakT = 0;
function frightenBandits(radius = 14) {
  let fled = 0;
  for (const o of bandits) {
    if (o.dead || o.downT > 0 || o.boss) continue; // 头目不吃这套
    if (dist2(player.pos.x, player.pos.z, o.pos.x, o.pos.z) > radius * radius) continue;
    if (o.hp <= Math.max(2, (o.maxHp || 5) * 0.35) || rand() < 0.45) { // 残血必逃,满血看胆量
      o.fleeT = Math.max(o.fleeT || 0, 5 + rand() * 3);
      fled++;
    }
  }
  return fled;
}
function banditSlain(b) {
  // 枭首之刃嗜血:持刃击杀回 4 体力——刀认得血的味道
  if (player.weapon === 'warblade') player.sta = Math.min(player.maxSta, player.sta + 4);
  // 阵斩枭首:夺军旗——永久体力上限 +5(封顶 180),外加一把赏金
  if (b && b.warlord) {
    stats.banners = (stats.banners || 0) + 1;
    player.maxSta = Math.min(180, player.maxSta + 5);
    player.sta = player.maxSta;
    dropCoins(b.pos, 10);
    sfx.chest();
    toast(`🚩 夺得战团军旗!(第 ${stats.banners} 面:体力上限 +5 → ${player.maxSta},当场回满)`, 4.5);
    remember(`阵斩战团枭首,夺下第 ${stats.banners} 面军旗`, `banner-${stats.banners}`);
    refreshTrophies(); // 军旗直接挂上家里的战利品墙
  }
  const now = performance.now();
  streakN = (now - streakT < 6000) ? streakN + 1 : 1;
  streakT = now;
  if (streakN >= 3) {
    streakN = 0;
    if (frightenBandits() > 0) {
      toast('😱 连杀震慑:附近的盗贼胆寒溃逃!', 2.5);
      sfx.warn();
    }
  }
}
let meleeExecBase = 0; // 处决基准伤害:出手前由 tryAttack/heavyAttack 填入(不含弹反/偷袭乘区)
// ================= 统一伤害结算 =================
// 所有"对敌人造成伤害"都走这里:扣血 → 受击表现 → 伤卫兵即犯罪(仅玩家来源)→ 按身份走死亡结算。
// source: 'player'(默认)| 'companion'(佣兵/白狼/卫兵援手,不进玩家连杀)| 'env'(龙息等,不算你的罪也不进连杀)| 'foe'(敌人互殴)
// opts: knock(击退/受击闪白,不给则无)、crit(数字放大)、silent(不出数字)、crime/crimeMsg(伤卫兵的罪名)、credit/coins(伙伴击杀)
function foeKind(e) {
  return wolves.includes(e) ? 'wolf' : guards.includes(e) ? 'guard' : bandits.includes(e) ? 'bandit' : 'other';
}
function applyDamage(e, n, opts = {}) {
  if (!e || e.dead || e.downT > 0) return false;
  const src = opts.source || 'player';
  e.hp -= n;
  if (opts.knock !== undefined) hitFX(e, opts.knock);
  if (!opts.silent) showDamage(e.pos, n, opts.crit ?? n >= 3);
  const kind = foeKind(e);
  if (kind === 'guard' && src === 'player' && !e.wantedHit) {
    e.wantedHit = true;
    crime(opts.crime || 1, opts.crimeMsg || '你袭击了卫兵!');
  }
  if (e.hp > 0) return false;
  if (kind === 'wolf') killWolf(e, src === 'env' || src === 'foe' ? { env: true } : {});
  else if (kind === 'bandit') {
    slayBandit(e, src === 'player' ? {} : { companion: true, credit: opts.credit, coins: opts.coins ?? (src === 'env' ? 2 : undefined) });
  } else if (kind === 'guard') downGuard(e);
  return true;
}
// 特殊身份的盗贼(剧情首领/押解/悬赏/劫匪/竞技/单挑/囚犯/事件):不算"普通盗贼",各处判定共用这一张表
const SPECIAL_BANDIT = ['boss', 'escort', 'bountyHead', 'robber', 'arena', 'duel', 'convict', 'eventFoe'];
function specialBandit(b) {
  for (const k of SPECIAL_BANDIT) if (b[k]) return true;
  return false;
}
// 盗贼死亡统一出口:任何来源(弓/剑/践踏/法术/爆炸/战吼/佣兵/白狼)都走全套结算
function slayBandit(b, opts = {}) {
  if (b.dead) return;
  b.dead = true;
  startFall(b);
  if (!opts.companion) registerKill(); // 伙伴击杀不进玩家连杀
  choreProgress('bandits');
  banditSlain(b); // 军旗/士气结算
  if (b.boss) dismissMinions();
  if (b.warband) warband[opts.companion ? 'gKills' : 'pKills'] = (warband[opts.companion ? 'gKills' : 'pKills'] || 0) + 1;
  dropCoins(b.pos, b.boss ? 20 : opts.coins ?? 5);
  if (quest.active && missions[quest.idx].type === 'bandits' && (b.campFoe || (!specialBandit(b) && !b.ambient))) {
    quest.progress++;
    const goal = missions[quest.idx].goal;
    dropQuestToasts();
    if (quest.progress < goal) toastQuest(`${b.captain ? '营地头目倒下了!' : '击败盗贼'} ${quest.progress}/${goal}${opts.credit ? `(${opts.credit}!)` : ''}`, 2);
    if (quest.progress >= goal) completeMission();
  }
}
// 剑光拖尾:每次挥砍横扫出一道弧光,0.16 秒燃尽
const trailFX = [];
const trailMat = new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.5,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
function swingTrail(range, arc = 2.1, dir = 1) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh( // 弧向 18 段、径向 1 段:一道弯月形的刀光(旧参数反了,画成一片三角)
    new THREE.RingGeometry(Math.max(0.5, range * 0.45), range, 18, 1, Math.PI / 2 - arc / 2, arc),
    pooledMat(trailMat));
  if (whiteHot()) ring.material.color.setHex(0xffd75e); // 白热连杀:剑光化金
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.position.set(player.pos.x, 1.05, player.pos.z);
  g.rotation.y = player.yaw;
  // 连斩分段:一段左挥(下压斜面)、二段右挥(镜像反斜)、三段平扫压轴
  if (dir === 1) g.rotation.x = 0.28;
  else if (dir === -1) { g.scale.x = -1; g.rotation.x = -0.28; }
  scene.add(g);
  trailFX.push({ g, ring, t: 0, mx: g.scale.x });
}
// 竖劈刀光:下劈/重击是从头顶劈到身前的竖弧(横向的弯月对不上动作)
function swingTrailV(range, big = false) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.4, range * 0.4), range, 16, 1, -0.55, 2.2),
    pooledMat(trailMat));
  if (whiteHot() || big) ring.material.color.setHex(0xffd75e);
  ring.rotation.y = -Math.PI / 2; // 弧面立起来,沿身前竖着
  g.add(ring);
  g.position.set(player.pos.x, 0.9, player.pos.z);
  g.rotation.y = player.yaw;
  scene.add(g);
  trailFX.push({ g, ring, t: 0, mx: 1 });
}
// 魔法命中碎光:一团加色蓝光炸开(复用拖尾的生灭管线)
const magBurstGeo = new THREE.SphereGeometry(0.2, 8, 6);
magBurstGeo.userData.shared = true;
const magBurstMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.8,
  blending: THREE.AdditiveBlending, depthWrite: false });
function magBurst(x, y, z) {
  const m = new THREE.Mesh(magBurstGeo, pooledMat(magBurstMat));
  m.position.set(x, y, z);
  scene.add(m);
  trailFX.push({ g: m, ring: m, t: -0.08, mx: 1 }); // 负起点=多亮一拍
}
function updateTrails(dt) {
  for (let i = trailFX.length - 1; i >= 0; i--) {
    const f = trailFX[i];
    f.t += dt;
    const k = f.t / 0.16;
    if (k >= 1) {
      scene.remove(f.g);
      if (!f.ring.geometry.userData.shared) f.ring.geometry.dispose();
      releaseMat(f.ring.material);
      trailFX.splice(i, 1);
      continue;
    }
    f.ring.material.opacity = (f.ring.material.userData.poolBase === magBurstMat ? 0.8 : 0.5) * (1 - k);
    f.g.scale.setScalar(1 + k * 0.5);
    f.g.scale.x *= f.mx || 1; // 保住镜像方向
  }
}

// 受击硬直:打断对方的起手。杂兵挨一刀就收招;被打断后有一段霸体(连砍砍不断,不能无限控);
// 精英(头目/悬赏/决斗/将领)只吃重击的打断
function flinch(e, heavy) {
  if (e.dead || e.downT > 0) return;
  const elite = e.boss || e.bountyHead || e.duel || e.warlord || e.elite;
  if (!heavy && (elite || (e.armorT || 0) > 0)) return;
  e.hitStunT = heavy ? 0.6 : 0.3;
  e.armorT = heavy ? 0.9 : 1.3;
  if (e.windupT > 0 || e.biteT > 0) callout('打断!', 'blue', e.pos);
  e.windupT = 0;
  e.biteT = 0;
  e.comboN = 0;
  e.heavyAtk = false;
}
// 背刺:从对方背后下手 ×1.5(敌人正面对着你时没有)
function backstabMul(e) {
  if (e.yaw === undefined) return 1;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / d < -0.35 ? 1.5 : 1;
}
function meleeSweep(dmg, range, arcDot, knock, opts = {}) {
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const maxHits = opts.maxHits ?? 3;
  const heavy = !!opts.heavy;
  const gb = opts.guardBreak || null; // 'full' 满蓄重击:必破防(可处决);'counter' 下劈/半蓄:砸在起手中或举盾的人身上才破架
  // 处决:只对"弹反"或"满蓄重击破防"造成的踉跄出手 = ×5 终结,一刀只处决一人
  // (盾击/冰霜/战吼/下劈破架的踉跄只是空档,不开处决)
  let executed = false, execTarget = null;
  const execBase = meleeExecBase || dmg; // 进场即取:tryAttack 带入的无乘区基准
  meleeExecBase = 0; // 用一次即弃,避免残留到别的横扫
  // 先收集刀锋范围内的目标,按远近只取前 maxHits 个:一刀不再横扫半条街
  const cand = [];
  for (const list of [guards, bandits, wolves]) {
    for (const e of list) {
      if (e.downT > 0 || e.dead) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d || 1) > arcDot) cand.push({ e, d });
    }
  }
  cand.sort((a, b) => a.d - b.d);
  const hitSet = new Set(cand.slice(0, maxHits).map((c) => c.e));
  const execDmg = (e) => {
    if (dmg > 0 && !executed && e.stunT > 0.3 && (e.stunSrc === 'parry' || e.stunSrc === 'break')) {
      executed = true;
      execTarget = e;
      // 处决按基础伤害 ×5 结算,弹反 ×2.5/偷袭 ×3 不再叠上去
      return execBase * 5;
    }
    const bs = dmg > 0 ? backstabMul(e) : 1;
    if (bs > 1) callout('背刺 ×1.5', 'gold', e.pos);
    return Math.round(dmg * bs);
  };
  const hitOne = (list, onHit) => {
    for (const e of list) {
      if (!hitSet.has(e) || e.downT > 0 || e.dead) continue;
      onHit(e);
      if (!e.dead && !(e.downT > 0) && dmg > 0) flinch(e, heavy);
    }
  };
  hitOne(guards, (g) => {
    const dmg = execDmg(g);
    sfx.hitMetal(); // 砍在甲上叮当响
    if (!applyDamage(g, dmg, { knock })) g.state = 'chase';
  });
  hitOne(bandits, (b) => {
    const winding = b.windupT > 0; // 正在起手:下劈/重击砸上去能破架
    const guarding = dmg > 0 && !(b.stunT > 0) && rand() < EVO.tactics.block * 0.5; // 战术演化:学会了举盾
    // 举盾挡下:轻刀被格开;破架的招(下劈/重击)照样砸开
    if (guarding && !gb && dmg < 3) {
      sfx.clank();
      hitFX(b, knock * 0.3);
      showDamage(b.pos, 0);
      callout('被格挡', 'dim', b.pos);
      return;
    }
    const dmg2 = execDmg(b);
    sfx.hit();
    if (b.boss && b.hp - dmg2 <= 0) toast('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 5);
    if (applyDamage(b, dmg2, { knock: b.boss ? knock * 0.4 : knock })) { // 统一结算(连杀/村务/军旗/任务/掉落)
      EVO.kills.melee++;
      // 近战击杀的犒赏:血少时必掉一颗心,平时两成——换血不能白换
      if (player.hp <= player.maxHp * 0.3 || rand() < 0.2) addPickup('heart', b.pos.x, b.pos.z + 1, 30);
      return;
    }
    if (b.stunT > 0) return;
    if (gb === 'full') { // 满蓄重击:盾开人晃,处决窗口大开
      b.stunT = 1.2;
      b.stunSrc = 'break';
      sfx.clank();
      callout('破防!再砍=处决', 'gold', b.pos);
    } else if (gb === 'counter' && (winding || guarding)) { // 下劈截在起手上/砸在盾上:破架,留一个空档
      b.stunT = 0.6;
      b.stunSrc = 'counter';
      sfx.clank();
      callout(winding ? '截击!' : '破架!', 'gold', b.pos);
    }
  });
  hitOne(wolves, (w) => {
    const dmg3 = execDmg(w);
    sfx.hitFlesh(); // 砍进皮肉闷声
    applyDamage(w, dmg3, { knock });
  });
  if (opts.riposte && !executed && hitSet.size) callout('还击 ×2.5', 'gold');
  if (executed) { // 处决演出:时停 + 震屏 + 镜头急推;目击者胆寒;按武器各有终结技
    hitStop(0.22);
    cam.shake = Math.max(cam.shake, 0.45);
    cam.fovKick = 0.4;
    slowMo(0.55);
    if (execTarget) {
      if (player.weapon === 'dagger') {
        // 影袭:黑雾一闪,人已在目标身后收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
        const dx = execTarget.pos.x - player.pos.x, dz = execTarget.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        player.pos.x = execTarget.pos.x + (dx / d) * 1.1;
        player.pos.z = execTarget.pos.z + (dz / d) * 1.1;
        resolveCollisions(player.pos, 0.45, colliders);
        player.yaw = Math.atan2(-dx, -dz); // 转身面向尸体,收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
      } else if (player.weapon === 'greatsword') {
        // 断头台:巨剑砸出冲击环,大地都跟着响
        cam.shake = Math.max(cam.shake, 0.65);
        spawnDust(execTarget.pos.x, 0.2, execTarget.pos.z, 14, 2.2, 2.2);
        swingTrail(3.2, Math.PI * 2);
        sfx.stomp();
      } else {
        // 铁剑:十字剑光收势
        swingTrail(2.7, 2.3, 1);
        swingTrail(2.7, 2.3, -1);
      }
    }
    callout('处决 ×5', 'gold', execTarget ? execTarget.pos : null);
    if (frightenBandits(11) > 0) callout('目睹处决,盗贼胆寒溃逃!', 'dim');
    sfx.kill();
    stats.executions = (stats.executions || 0) + 1;
    if (stats.executions >= 10) unlockAch('executioner');
  }
  hitOne(deers, (d) => {
    sfx.hitFlesh();
    killDeer(d);
  });
  // 鸡不会死,但它们会记住你
  hitOne(chickens, (c) => {
    if (c.state !== 'thrown' && c !== player.carrying) pokeChicken(c);
  });
  hitOne(villagers, (v) => {
    if (v.downT > 0) return;
    v.downT = 10; v.group.rotation.x = -Math.PI / 2;
    sfx.hit();
    crime(2, '你袭击了村民!这是重罪!');
  });
  // 落地喘息的霜龙:近战窗口
  if (dragonRT.on && dragonRT.hp > 0 && dragonRT.phase === 'land' && dmg > 0) {
    const gp = dragonRT.ent.group.position;
    const ddx = gp.x - player.pos.x, ddz = gp.z - player.pos.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd < range + 2.4 && (ddx * fx + ddz * fz) / (dd || 1) > arcDot) {
      damageDragon(Math.max(1, Math.round(dmg * 0.6)), null); // 龙鳞厚:近战打六折
      sfx.hitMetal();
      hitStop(0.05);
    }
  }
}

// ================= 出招输入与判定帧 =================
// 按下 F/左键:即出轻击(不等松手);按住超过 0.2 秒、这一刀已经落下,就收住余势转入蓄力——
// 武器渐亮、脚步放慢,松手抡出重击(伤害随蓄力 2~3.5 倍)。弓例外:松手放箭,按住拉满月。
// 出招中按下的键进缓冲(0.35 秒内有效),收刀前一刻自动接上,连按不吞键。
// 伤害在"判定帧"(刀真正劈到的那一刻)结算,刀光与命中同帧;被打断则这刀作废。
const CHARGE_START = 0.2, CHARGE_FULL = 1.0, ATK_BUFFER = 0.35;
const chargeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending }));
chargeGlow.position.y = -0.5;
chargeGlow.visible = false;
player.parts.armR.add(chargeGlow);
// 圆盾:左臂一面铁箍木盾——格挡不再是"把持剑的手抬起来"。拿弓、巨剑(双手)时收起
const playerShield = (() => {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.82 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.75 });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.045, 20), wood);
  face.rotation.z = Math.PI / 2; // 盾面朝外侧
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.026, 6, 24), iron);
  rim.rotation.y = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6), iron);
  boss.scale.set(0.55, 1, 1);
  boss.position.x = -0.03;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.07), iron); // 横箍
  band.position.x = -0.026;
  for (const m of [face, rim, boss, band]) { m.castShadow = true; g.add(m); }
  g.position.set(-0.11, -0.3, 0.02);
  return g;
})();
player.parts.armL.add(playerShield);
function setChargeGlow(k) {
  chargeGlow.visible = k > 0.01;
  if (!chargeGlow.visible) return;
  chargeGlow.scale.setScalar(0.4 + k * 1.1 + (k >= 1 ? Math.sin(nowMs * 0.02) * 0.12 : 0));
  chargeGlow.material.opacity = 0.25 + 0.55 * k;
  chargeGlow.material.color.setHex(k >= 1 ? 0xffd75e : 0xbfe0ff);
}
const strikePending = () => !!(player.strike && !player.strike.done);
function attackDown() {
  if (!started || player.dead || dialog.open || paused) return;
  // 马上、空中下劈、举盾(盾击):即按即出;正在出招就进缓冲
  if (player.mounted || player.blocking || !player.onGround) {
    if (player.attackT > 0 || strikePending()) player.atkBufT = ATK_BUFFER;
    else tryAttack();
    return;
  }
  player.atkHeld = true;
  player.atkHoldT = 0;
  if (player.weapon === 'bow') return; // 弓:松手才放箭
  if (player.attackT > 0 || strikePending() || player.rollT > 0 || player.staggerT > 0) {
    player.atkBufT = ATK_BUFFER; // 出招/翻滚/硬直中:记下,一有空档就出
    return;
  }
  tryAttack();
}
function attackUp() {
  if (!player.atkHeld) return;
  player.atkHeld = false;
  if (player.charging) { releaseCharge(); return; }
  if (player.weapon === 'bow') {
    if (player.attackT > 0) player.atkBufT = ATK_BUFFER;
    else tryAttack();
  }
}
function cancelCharge() {
  if (!player.charging) return;
  player.charging = false;
  player.chargeT = 0;
  setChargeGlow(0);
  if (!(player.attackT > 0)) player.parts._attackAnim = false;
}
function releaseCharge() {
  const k = Math.min(1, player.chargeT / CHARGE_FULL);
  player.charging = false;
  player.chargeT = 0;
  setChargeGlow(0);
  heavyAttack(k);
}
function lunge(dx, dz, dist, dur) {
  const d = Math.hypot(dx, dz) || 1;
  player.lungeT = dur;
  player.lungeVx = (dx / d) * (dist / dur);
  player.lungeVz = (dz / d) * (dist / dur);
}
function scheduleStrike(at, fn) { player.strike = { at, fn, done: false }; }
// 收招:出招计时清零、动作复位(缓冲接招/转蓄力/挨打打断都走这里)
function endAttack() {
  player.attackT = 0;
  player.parts._attackAnim = false;
  player.parts.armR.rotation.z = 0;
  player.parts.body.rotation.y = 0;
  player._animFrom = 0;
}
// 举盾:按住右键。刀没落下、蓄力、翻滚、踉跄、骑马、拿弓时举不起来;条件一满足自动举起(重新计弹反窗)
function updateBlock() {
  const able = started && !player.dead && !player.mounted && player.weapon !== 'bow' && !dialog.open &&
    !(player.staggerT > 0) && !(player.rollT > 0) && !player.charging && !strikePending() && !player.carrying;
  if (!player.blockHeld || !able) { player.blocking = false; return; }
  if (!player.blocking) { player.blocking = true; player.blockStart = simNow(); } // 完美弹反判定窗从举盾那一刻算
}
function updateAttackInput(dt) {
  updateBlock();
  if (player.dead) { player.atkHeld = false; cancelCharge(); player.strike = null; player.atkBufT = 0; return; }
  if (player.mounted) { player.atkHeld = false; cancelCharge(); }
  if (player.atkHeld) {
    player.atkHoldT += dt;
    // 按住不放:这一刀落下之后收住余势,转入蓄力
    if (!player.charging && !player.mounted && player.atkHoldT >= CHARGE_START && !strikePending() &&
        player.rollT <= 0 && !(player.staggerT > 0) && !player.blocking && !player.carrying && player.onGround &&
        (player.weapon === 'bow' ? player.attackT <= 0 : true)) {
      if (player.attackT > 0) endAttack();
      player.charging = true;
      player.chargeT = 0;
      player.atkBufT = 0;
      sfx.equip();
    }
  }
  if (player.charging) {
    if (player.rollT > 0 || player.staggerT > 0 || player.blocking || player.carrying) cancelCharge();
    else {
      const before = player.chargeT;
      player.chargeT = Math.min(CHARGE_FULL, player.chargeT + dt);
      if (before < CHARGE_FULL && player.chargeT >= CHARGE_FULL) { sfx.clank(); callout('满蓄!', 'gold'); }
      setChargeGlow(player.chargeT / CHARGE_FULL);
      // 蓄力姿势:剑举过肩,定在起手位
      player.parts._attackAnim = true;
      meleeSwing(player.parts, 0.3 * Math.min(1, player.chargeT * 4), 'overhead');
    }
  }
  // 输入缓冲:收刀前 0.06 秒(且这一刀已落下)就接出下一刀
  if (player.atkBufT > 0) {
    player.atkBufT -= dt;
    if (!player.charging && !strikePending() && player.attackT <= 0.06 &&
        !(player.rollT > 0) && !(player.staggerT > 0)) {
      player.atkBufT = 0;
      if (player.attackT > 0) endAttack();
      tryAttack();
    }
  }
  const st = player.strike;
  if (st && !st.done) {
    if (player.staggerT > 0 || player.rollT > 0) player.strike = null; // 被打断/翻滚取消:这刀作废
    else if ((player.attackDur - player.attackT) >= st.at || player.attackT <= 0) {
      st.done = true;
      player.strike = null;
      st.fn();
    }
  }
  if (player.lungeT > 0) {
    const k = Math.min(dt, player.lungeT);
    player.lungeT -= k;
    player.pos.x += player.lungeVx * k;
    player.pos.z += player.lungeVz * k;
    resolveCollisions(player.pos, 0.45, colliders);
  }
}
function tryAttack() {
  // 盾击:举盾状态下出手——不掉血,但把面前的敌人撞个踉跄
  if (started && !player.dead && player.blocking && !(player.rollT > 0) &&
      !(player.attackT > 0) && !player.mounted && player.weapon !== 'bow') {
    if ((player.bashCd || 0) > simNow()) { callout('盾击冷却中', 'dim'); return false; }
    if (player.staggerT > 0 || !spendSta(12)) return false;
    player.bashCd = simNow() + 1600; // 盾击 1.6 秒一次,别拿它当无限控
    player._stance = null;
    player.attackT = 0.7;
    player.attackDur = 0.7;
    sfx.clank();
    cam.shake = Math.max(cam.shake, 0.2);
    for (const list of [bandits, guards, wolves]) {
      for (const e of list) {
        if (e.dead || e.downT > 0 || e.stunT === undefined) continue;
        const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.4 && (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) / (d || 1) > 0.25) {
          e.stunT = Math.max(e.stunT || 0, 0.8);
          e.stunSrc = 'bash'; // 盾击只撞个踉跄,不开处决窗口
        }
      }
    }
    meleeSweep(0, 2.2, 0.25, 1.6);
    return true;
  }
  if (!started || player.dead || player.attackT > 0 || player.carrying ||
      player.blocking || player.rollT > 0 || strikePending()) return false;
  // 骑砍:马背上挥剑(伤害 +1、范围加长),判定帧在挥到一半——刀光与扣血同帧
  if (player.mounted && player.weapon !== 'bow' && !player.mounted.sheep) {
    if (player.staggerT > 0 || !spendSta(10)) return false; // 马上挥刀一样费力气
    const defM = WEAPONS[player.weapon];
    player._stance = null;
    player.attackT = defM.cd * 1.25;
    player.attackDur = player.attackT;
    sfx.sword();
    // 冲量伤害(骑砍之魂):疾驰中的一刀 +1(冲一趟不再随手清场)
    const mom = (player._rideSpeed || 0) >= 15 ? 1 : 0;
    scheduleStrike(player.attackT * 0.4, () => {
      swingTrail(defM.range + 1.0, 2.3);
      if (mom) sfx.whoosh(0.8);
      meleeSweep(meleeBonus(defM.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + mom),
        defM.range + 1.0, 0.1, defM.knock * (1.4 + mom * 0.5), { maxHits: 2 });
    });
    skillXp('onehand', 1);
    skillXp('riding', 1);
    return true;
  }
  if (player.mounted) {
    if (player.weapon !== 'bow') return false; // 羊背上还是算了
  }
  const def = WEAPONS[player.weapon];
  // 跳劈:空中出手——砸向地面,落点四方溅开一圈冲击
  if (player.staggerT > 0) return false; // 踉跄中出不了手
  if (!player.onGround && !player.mounted && player.weapon !== 'bow' && !player.plunging) {
    if (!spendSta(14)) return false;
    player._stance = 'overhead'; // 跳劈就是从天而降的下劈
    player.plunging = true;
    player.vy = -16;
    player.attackT = def.cd;
    player.attackDur = def.cd * 1.4;
    sfx.sword();
    return true;
  }
  if (player.weapon === 'bow') {
    player._stance = null;
    player.attackT = def.cd;
    player.attackDur = def.cd;
    shootArrow();
    return true;
  }
  // 方向攻击(骑砍式):W+攻=突刺(够得远、只扎一人),S+攻=下劈(慢、重,砸在起手中/举盾的人身上能破架),
  // 其余=横斩(快、扫一片)
  const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  let stance = 'slash';
  if (!shiftHeld && (keys['KeyW'] || keys['ArrowUp'])) stance = 'thrust';
  else if (!shiftHeld && (keys['KeyS'] || keys['ArrowDown'])) stance = 'overhead';
  if (!spendSta(Math.round((stance === 'overhead' ? 16 : stance === 'thrust' ? 11 : 12) *
    (def.staMul || 1)))) return false;
  player._stance = stance === 'slash' ? null : stance; // 挥刀动画按招式走
  player._animFrom = 0;
  stats.swings = (stats.swings || 0) + 1;
  const hotMul = whiteHot() ? 0.8 : 1; // 白热:出刀更快
  // 三连斩:节奏内连续出手,第三剑更重、附带大击退
  const now = simNow();
  player.chainN = (now - (player.chainT || 0) < 900 + def.cd * 1000) ? (player.chainN || 0) + 1 : 1;
  player.chainT = now;
  const third = player.chainN >= 3;
  if (third) player.chainN = 0;
  // 招式节奏:横斩快、突刺稍长、下劈抡得满(起手慢,一刀见分量);判定帧 = 刀真正落下的那一刻
  const durMul = stance === 'overhead' ? 1.9 : stance === 'thrust' ? 1.35 : third ? 1.5 : 1.3;
  const hitAt = stance === 'overhead' ? 0.52 : stance === 'thrust' ? 0.45 : 0.42;
  player.attackT = def.cd * durMul * hotMul;
  player.attackDur = player.attackT;
  sfx.sword();
  if (dist2(player.pos.x, player.pos.z, 140, 20) < 80) unlockAch('windmill');
  // 后撤下劈(没锁定时按着 S):刀朝镜头前方劈,不跟着脚步转身砍向背后
  if (stance === 'overhead' && !lockFoe) player.yaw = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  const sprinting = shiftHeld && player.onGround && !player.sneaking &&
    (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  // 潜行偷袭:蹲行状态近身出手 ×3(短匕是行家家伙,×4)
  const sneakMul = player.sneaking ? (player.weapon === 'dagger' ? 4 : 3) : 1;
  // 旋风斩:武艺 5 级起,三连斩的第三剑变成全周横扫
  const whirl = third && skillLv('onehand') >= 5;
  const reach = def.range + (third ? 0.4 : 0) + (sprinting ? 0.4 : 0) +
    (stance === 'thrust' ? 0.9 : stance === 'overhead' ? 0.1 : 0); // 突刺够得远
  if (sprinting) {
    // 冲刺突斩:扑出去的距离按目标远近定(冲到刚好够得着,不冲过头);前方没人就扑满 2.8m
    const tgt = faceNearestFoe(reach + 4.2, true);
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    lunge(fx, fz, tgt ? Math.max(0.5, Math.min(2.8, tgt.d - reach * 0.6)) : 2.8, 0.16);
    spawnDust(player.pos.x - fx, 0.1, player.pos.z - fz, 8, 1.2, 1.4);
    sfx.roll();
  } else if (!player.sneaking) faceNearestFoe(reach); // 攻击磁吸:刀锋咬住目标(潜行例外,别打草惊蛇)
  const dir = (whirl || third || stance !== 'slash') ? 0 : (player.chainN % 2 ? 1 : -1);
  const base = def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0);
  // 伤害:横斩/突刺 1×,下劈 +1(慢起手换来的),三连第三剑 +1,冲刺 +1
  const bonus = (third ? 1 : 0) + (sprinting ? 1 : 0) + (stance === 'overhead' ? 1 : 0);
  const sneaking = player.sneaking;
  scheduleStrike(player.attackT * hitAt, () => {
    // 弹反还击:完美弹反后 1.5 秒内的这一击 ×2.5(判定帧才兑现,打空不浪费);
    // 对方还在踉跄就直接是处决(×5)——浮字由横扫按实际结果给
    let riposteMul = 1;
    if (player.riposteT > 0) {
      riposteMul = 2.5;
      player.riposteT = 0;
      sfx.combo(5);
      hitStop(0.1);
    }
    if (sneaking) callout(`偷袭 ×${sneakMul}`, 'gold');
    if (third) { sfx.combo(3); cam.shake = Math.max(cam.shake, 0.22); }
    sfx.whoosh(stance === 'overhead' ? 0.72 : stance === 'thrust' ? 1.3 : third ? 0.82 : dir === 1 ? 1 : 1.14);
    if (stance === 'overhead') swingTrailV(reach);
    else swingTrail(reach, whirl ? Math.PI * 2 : stance === 'thrust' ? 0.55 : third ? 2.6 : 2.1, dir);
    meleeExecBase = Math.round(meleeBonus(base + bonus));
    meleeSweep(Math.round(meleeBonus(base + bonus) * sneakMul * riposteMul),
      reach,
      whirl ? -1.01 : stance === 'thrust' ? 0.86 : stance === 'overhead' ? 0.5 : 0.35,
      def.knock * (third ? 1.8 : 1) * (sprinting ? 1.3 : 1) *
        (stance === 'overhead' ? 1.5 : stance === 'thrust' ? 0.6 : 1),
      { maxHits: whirl ? 4 : stance === 'thrust' ? 1 : stance === 'overhead' ? 2 : 3,
        guardBreak: stance === 'overhead' ? 'counter' : null, riposte: riposteMul > 1 });
    if (stance === 'overhead') cam.shake = Math.max(cam.shake, 0.14); // 下劈坠着劲
    if (whirl) { cam.shake = Math.max(cam.shake, 0.2); spawnDust(player.pos.x, 0.5, player.pos.z, 10, 2, 1.6); }
  });
  skillXp('onehand', 1);
  if (player.sneaking) skillXp('sneak', 2);
  return true;
}

// 蓄力重击:按住蓄力、松手抡出。伤害随蓄力 2~3.5 倍轻击、大击退;满蓄必破防(开处决窗口)。
// 动作从蓄力的举剑位接着往下劈,判定帧在剑真正落下的那一刻
function heavyAttack(k = 1) {
  if (player.staggerT > 0 || player.blocking || player.rollT > 0) return; // 盾举着/翻滚中抡不了大的
  // 蓄力技按武器分家:短匕掷飞刀,猎弓开满月,刀剑抡重击
  if (player.weapon === 'dagger') { if (!spendSta(10)) return; throwKnife(); return; }
  if (player.weapon === 'bow') {
    if (k < 0.5) { tryAttack(); return; } // 拉得不够满:就是普通一箭
    if (!spendSta(12)) return;
    chargedShot();
    return;
  }
  if (!spendSta(Math.round((14 + 12 * k) * (WEAPONS[player.weapon].staMul || 1)))) return;
  const def = WEAPONS[player.weapon];
  player._stance = 'overhead'; // 重击=抡满的下劈动作
  player._animFrom = 0.3;      // 从蓄力举剑位接着播,不再先掉下来再抬回去
  player.attackT = def.cd * 1.7;
  player.attackDur = player.attackT;
  sfx.sword();
  const wide = player.weapon === 'greatsword'; // 巨剑:蓄力横扫近乎全周
  faceNearestFoe(def.range + 0.7);
  const mul = 2 + 1.5 * k; // 2~3.5 倍
  const full = k >= 0.99;
  scheduleStrike(player.attackT * 0.32, () => { // 0.32 处 = 动作 0.52:剑正落到身前
    sfx.clank();
    sfx.whoosh(0.7); // 重击破空声最沉
    cam.shake = Math.max(cam.shake, full ? 0.38 : 0.26);
    hitStop(full ? 0.1 : 0.06);
    if (wide) swingTrail(def.range + 0.7, Math.PI * 1.7, 0);
    else swingTrailV(def.range + 0.7, full);
    if (full) spawnDust(player.pos.x + Math.sin(player.yaw) * 1.6, 0.2, player.pos.z + Math.cos(player.yaw) * 1.6, 12, 1.4, 1.8);
    meleeExecBase = Math.round(meleeBonus(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0)));
    meleeSweep(Math.round(meleeBonus((def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0)) * mul)),
      def.range + 0.7, wide ? -0.6 : -0.1, def.knock * (wide ? 2.3 : 1.8) * (0.8 + 0.4 * k),
      { maxHits: wide ? 4 : 3, heavy: true, guardBreak: full ? 'full' : 'counter' });
  });
  skillXp('onehand', 1);
  stats.heavies = (stats.heavies || 0) + 1;
}

// 飞刀(短匕蓄力):平直高速,一刀一命换着算
function throwKnife() {
  player.attackT = 0.5;
  player.attackDur = 0.5;
  sfx.arrow();
  sfx.clank();
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0.02, Math.cos(player.yaw)).normalize();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.85, roughness: 0.25 }));
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.2, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dir.multiplyScalar(34), ttl: 2, stuck: false,
    dmg: meleeBonus(2 + (player.swordLv >= 2 ? 1 : 0)), knife: true });
  skillXp('onehand', 1);
}
// 满月强弓(猎弓蓄力):×2 伤害、破空疾飞、可贯穿三人
function chargedShot() {
  player.attackT = WEAPONS.bow.cd * 1.4;
  player.attackDur = WEAPONS.bow.cd * 1.4;
  sfx.arrow();
  cam.shake = Math.max(cam.shake, 0.12);
  const jit = wetSpread(0.5); // 满月拉满弓,受雨影响减半
  const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.03, Math.cos(player.yaw + jit)).normalize();
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  mesh.scale.set(1.4, 1.4, 1.4);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dragonAim(pos, 42) || dir.multiplyScalar(42), ttl: 2.5, stuck: false,
    dmg: arrowBonus((WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0)) * 2), pierce: 2, _hits: [] });
  skillXp('archery', 2);
  toast('🏹 满月!', 1);
}

function dropCoins(pos, n) {
  for (let i = 0; i < n; i++) {
    const a = rand() * 6.28;
    addPickup('coin', pos.x + Math.cos(a) * (0.6 + rand()), pos.z + Math.sin(a) * (0.6 + rand()), 25);
  }
}

// 挨打硬直:打断自己正在出的刀(判定帧未到的作废)、散掉蓄力与火球聚能,身子后仰一下
function playerHitStagger(t) {
  player.staggerT = Math.max(player.staggerT || 0, t);
  player.hurtT = 0.3;
  if (strikePending()) { player.strike = null; endAttack(); }
  player.atkBufT = 0;
  cancelCharge();
  if (player.fireCharging) { player.fireCharging = false; player.fireChargeT = 0; }
}
function damagePlayer(n, attacker = null, pierce = false) {
  if (player.invulnT > 0 || player.dead) return;
  player.lastHitBy = attacker ? (wolves.includes(attacker) ? 'wolf' : guards.includes(attacker) ? 'guard' : 'bandit')
    : (dragonRT.on ? 'dragon' : 'other');
  // 盾只护正面:从侧后方来的刀挡不住(绕背、包夹才有意义)
  let blockOk = player.blocking && player.rollT <= 0;
  if (blockOk && attacker && attacker.pos) {
    const dx = attacker.pos.x - player.pos.x, dz = attacker.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if ((Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / d < -0.15) {
      blockOk = false;
      callout('身后中招!盾只护正面', 'red');
    }
  }
  if (blockOk) {
    // 完美弹反:出手前 0.25 秒内举盾 → 攻击者踉跄 2 秒 + 时停
    if (attacker && attacker.stunT !== undefined &&
        simNow() - (player.blockStart ?? -1e9) < 250) {
      attacker.stunT = Math.max(attacker.stunT || 0, 2.2); attacker.stunSrc = 'parry';
      hitStop(0.14);
      cam.shake = Math.max(cam.shake, 0.25);
      sfx.clank();
      sfx.clear();
      callout('完美弹反!快还击', 'gold');
      if (prologue.on) { prologue.flags.blocked = true; prologue.flags.parried = true; }
      stats.parries = (stats.parries || 0) + 1;
      if (stats.parries >= 5) unlockAch('parry');
      player.invulnT = 0.5;
      player.riposteT = 1.5; // 还击窗口
      player.sta = Math.min(player.maxSta, player.sta + 10); // 完美弹反回气:精准的奖赏
      return;
    }
    if (pierce) { // 紫圈重击:格挡被砸碎,硬吃一记减伤——早该翻滚的
      sfx.clank();
      sfx.hurt();
      cam.shake = Math.max(cam.shake, 0.4);
      callout('格挡被砸碎!紫圈要翻滚', 'red');
      player.hp -= 1;
      player.invulnT = 0.7;
      playerHitStagger(0.4);
      flashEl.style.opacity = 0.45;
      setTimeout(() => (flashEl.style.opacity = 0), 120);
      if (player.hp <= 0) gameOver();
      return;
    }
    // 格挡也要花力气:每挡一下 -14 体力(一直举盾不是万能的),挡空了盾会被砸开
    sfx.clank();
    if (prologue.on) prologue.flags.blocked = true;
    player.sta = Math.max(0, player.sta - 14);
    if (player.sta <= 0) {
      player.blocking = false;
      player.staggerT = 0.9;
      player.gaspT = 1.2;
      cam.shake = Math.max(cam.shake, 0.35);
      callout('力竭!盾被砸开', 'red');
      sfx.hiccup();
      player.invulnT = 0.5;
      return;
    }
    cam.shake = Math.max(cam.shake, 0.15);
    player.invulnT = 0.35;
    return;
  }
  player.hp -= n;
  player.invulnT = 0.7;
  cam.shake = 0.45;
  playerHitStagger(0.3); // 挨打有代价:手里这刀作废、蓄力散掉、0.3 秒缓不过劲
  fishing.active = false;
  sfx.hurt();
  flashEl.style.opacity = 0.45;
  setTimeout(() => (flashEl.style.opacity = 0), 120);
  if (player.hp <= 0) gameOver();
}

function gameOver() {
  if (prologue.on) skipPrologue(true); // 序章里倒下:直接放行,别卡教学
  if (warband.duelOn) { // 单挑落败:誓约解除,攻城继续
    warband.duelOn = false;
    warband.members.forEach((b) => { b._truce = false; });
  }
  if (dialog.open) { dialog.open = false; dialogEl.style.display = 'none'; dialog.onDone = null; } // 人都倒了,话就别说了
  player.fireChargeT = 0;
  player.dead = true;
  player.hp = 0;
  player.drunkT = 0;
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  sfx.gameover();
  if (trialRT.active) endTrial(false);
  stats.deaths = (stats.deaths || 0) + 1;
  // 它眼睁睁看着他倒下:这颗心的重大事件——心境重击、惊讶拉满、记进长期记忆
  workspace.mood.v = Math.max(-1, workspace.mood.v - 0.5);
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.5);
  MIND.surprise = Math.max(MIND.surprise, 0.8);
  remember(`它眼睁睁看着他倒下了(第 ${stats.deaths} 次)`, `death-${calendar.day}`);
  player.jailed = wanted > 0;
  // 按死因给标题:被抓、葬身狼口、倒在匪刃下、霜龙之怒……
  const cause = wanted > 0 ? ['通缉终结', '你被王国卫兵抓住了!关进地牢,罚没一半金币。']
    : player.lastHitBy === 'wolf' ? ['葬身狼口', '狼群把你拖倒了……']
    : player.lastHitBy === 'dragon' ? ['霜龙之怒', '冰息吞没了你……幸存者把你抬回了王都。']
    : player.lastHitBy === 'bandit' ? ['倒在匪刃下', '盗贼搜走了你一半的金币。']
    : ['你倒下了', '眼前一黑……'];
  gameoverEl.querySelector('h1').textContent = cause[0];
  gameoverText.textContent = cause[1];
  if (titleArtURL) {
    gameoverEl.style.backgroundImage =
      `linear-gradient(rgba(70,0,0,0.72), rgba(30,0,0,0.85)), url(${titleArtURL})`;
    gameoverEl.style.backgroundSize = 'cover';
    gameoverEl.style.backgroundPosition = 'center';
  }
  gameoverEl.style.display = 'flex';
  setTimeout(() => {
    if (player.jailed) player.pos.set(13, 0, -28);
    else player.pos.copy(world.playerSpawn);
    player.hp = player.maxHp;
    player.coins = Math.floor(player.coins / 2);
    player.mounted = null;
    player.vy = 0;
    clearWanted();
    player.dead = false;
    gameoverEl.style.display = 'none';
    if (player.jailed && player.loot > 0) { player.loot = 0; } // 赃物人赃并获,全数充公
    const lostHow = player.lastHitBy === 'bandit' ? '盗贼搜走了你一半的金币'
      : player.lastHitBy === 'wolf' ? '赶狼的牧人把你背了回来,一半金币算作谢礼'
        : player.lastHitBy === 'dragon' ? '幸存者把你抬回了王都,一半金币付了药钱'
          : '一半金币不知丢在了哪里';
    toast(player.jailed
      ? '⛓️ 你在王都地牢蹲了一夜,罚没一半金币后被踢了出来。' + (player.loot === 0 ? '(兜里的赃物也被搜走了)' : '')
      : stats.deaths >= 3
        ? `你第 ${stats.deaths} 次在喷泉旁醒来(${lostHow})。水声轻得……像是有谁悄悄调小了。`
        : `你在喷泉旁醒来——${lostHow}。`, 4);
  }, 2600);
}

// ================= 实体更新 =================
function moveEntity(e, tx, tz, speed, dt) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  speed *= frostSlow(e); // 踩着冰面腿脚发僵
  e.pos.x += (dx / d) * speed * dt;
  e.pos.z += (dz / d) * speed * dt;
  e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), dt * 10);
  e.walkT += dt * speed * 2.2;
  resolveCollisions(e.pos, 0.4, colliders);
  return false;
}

// 人形动画:四肢摆动 + 身体起伏 + 奔跑前倾 + 呼吸怠速 + 头部环视
let nowMs = performance.now(); // 主循环每帧更新,免得几十个实体各查一次时钟
function animateLimbs(p, walkT, moving, group = null, speedNorm = 0.6) {
  if (p.cape) { // 披风:跑得越快扬得越高,步伐里轻轻起伏
    const goal = moving ? -0.18 - speedNorm * 0.55 + Math.sin(walkT * 2) * 0.06 : -0.06 + Math.sin(performance.now() * 0.0015) * 0.03;
    p.cape.rotation.x += (goal - p.cape.rotation.x) * 0.15;
  }
  const now = nowMs;
  const swing = moving ? Math.sin(walkT) * (0.45 + 0.35 * speedNorm) : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  if (p.armL) p.armL.rotation.x = -swing * 0.85;
  if (p.armR && !p._attackAnim) p.armR.rotation.x = swing * 0.85;
  let bob = 0;
  if (moving) {
    bob = Math.abs(Math.cos(walkT)) * 0.05 * (0.4 + speedNorm);
  } else {
    bob = Math.sin(now * 0.0018) * 0.012; // 呼吸
  }
  if (p.body) {
    p.body.position.y = 0.78 + bob * 0.5;
    if (!p._attackAnim) {
      p.body.rotation.x = moving ? 0.05 + 0.12 * Math.max(0, speedNorm - 0.8) : 0;
      p.body.rotation.y *= 0.85;
    }
  }
  if (p.head) {
    p.head.position.y = 1.32 + bob * 0.6;
    if (!moving) p.head.rotation.y = Math.sin(now * 0.0005 + p.head.id * 1.7) * 0.4;
    else p.head.rotation.y *= 0.9;
  }
  if (group) group.position.y += bob;
}

// 通用三段式挥剑:抬臂蓄力 → 劈砍 → 收势(t: 0→1)
function meleeSwing(p, t, mode) {
  // 突刺:收臂→直臂捅出→回收,身体侧拧送肩(骑砍的枪感)
  if (mode === 'thrust') {
    let arm;
    if (t < 0.28) arm = -0.15 - (t / 0.28) * 0.35;             // 收
    else if (t < 0.55) arm = -0.5 - ((t - 0.28) / 0.27) * 1.15; // 捅
    else arm = -1.65 + ((t - 0.55) / 0.45) * 1.65;              // 收回
    p.armR.rotation.x = arm;
    p.armR.rotation.z = 0.12 * Math.sin(t * Math.PI);
    if (p.body) p.body.rotation.y = -0.4 * Math.sin(t * Math.PI);
    return;
  }
  let arm, twist;
  if (t < 0.32) {
    const k = t / 0.32;
    arm = -2.3 * (1 - (1 - k) * (1 - k));
    twist = -0.35 * k;
  } else if (t < 0.62) {
    const k = (t - 0.32) / 0.3;
    arm = -2.3 + 3.1 * k * k;
    twist = -0.35 + 0.8 * k;
  } else {
    const k = (t - 0.62) / 0.38;
    arm = 0.8 * (1 - k);
    twist = 0.45 * (1 - k);
  }
  // 下劈:同一条弧线抡得更满、劈得更深,身体跟着前倾压刀
  if (mode === 'overhead') {
    arm *= 1.2;
    if (p.body) p.body.rotation.x = 0.3 * Math.sin(Math.min(1, t / 0.7) * Math.PI);
  } else if (p.body) p.body.rotation.x = 0;
  p.armR.rotation.x = arm;
  p.armR.rotation.z = -0.25 * Math.sin(t * Math.PI);
  if (p.body) p.body.rotation.y = twist;
}

function updateGuards(dt) {
  for (const g of guards) {
    if (g.downT > 0) {
      g.downT -= dt;
      if (g.downT <= 0) { g.hp = 3; g.group.rotation.x = 0; g.state = 'patrol'; }
      continue;
    }
    if (g.stunT > 0) {
      g.stunT -= dt;
      g.windupT = 0; // 蓄力被打断就作废
      g.group.rotation.z = Math.sin(performance.now() * 0.02) * 0.12;
      if (g.stunT <= 0) g.group.rotation.z = 0;
      continue;
    }
    // 攻城战:卫兵放下巡逻,迎击 40 米内最近的战团匪徒(通缉中还是先抓你)
    if (warband.siege && warband.active && wanted === 0 && !warband.duelOn) {
      let tgt = null, td = 1600;
      for (const wb of warband.members) {
        if (wb.dead || wb.downT > 0) continue;
        const d2v = dist2(g.pos.x, g.pos.z, wb.pos.x, wb.pos.z);
        if (d2v < td) { td = d2v; tgt = wb; }
      }
      if (tgt) {
        g.attackCd = Math.max(0, g.attackCd - dt);
        let moving = false;
        if (td > 1.7 * 1.7) { moveEntity(g, tgt.pos.x, tgt.pos.z, g.speed, dt); moving = true; }
        else if (g.attackCd <= 0) {
          g.attackCd = 1.1;
          g.swingT = 0.3;
          sfx.clank();
          spawnDust(tgt.pos.x, 1.0, tgt.pos.z, 2, 0.4, 1.2);
          applyDamage(tgt, 1, { source: 'companion', credit: '卫兵击破' });
        }
        g.yaw = angleLerp(g.yaw, Math.atan2(tgt.pos.x - g.pos.x, tgt.pos.z - g.pos.z), dt * 8);
        g.group.position.copy(g.pos);
        g.group.rotation.y = g.yaw;
        g.parts._attackAnim = (g.swingT || 0) > 0;
        animateLimbs(g.parts, g.walkT, moving, g.group, 1.1);
        if (g.swingT > 0) { g.swingT -= dt; meleeSwing(g.parts, Math.min(1, 1 - g.swingT / 0.35)); }
        continue;
      }
    }
    if (wanted === 0 && g.state !== 'chase' && entFar(g)) continue; // 无通缉时远处卫兵不巡逻动画
    if (g.armorT > 0) g.armorT -= dt;
    if (g.hitStunT > 0) { g.hitStunT -= dt; g.group.position.copy(g.pos); continue; } // 受击硬直
    g.attackCd = Math.max(0, g.attackCd - dt);
    const pd = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
    const sight = 22 + wanted * 8;
    let moving = false;
    if (wanted > 0 && pd < sight && !player.dead) {
      g.state = 'chase';
      if (pd < 25) evadeT = 0;
      if (g.windupT > 0) {
        g.windupT -= dt;
        // 起手中慢慢转向你(≤3 rad/s),最后 0.2 秒锁死方向
        if (g.windupT > 0.2) g.yaw = turnToward(g.yaw, Math.atan2(player.pos.x - g.pos.x, player.pos.z - g.pos.z), 3 * dt);
        if (g.windupT <= 0) {
          g.attackCd = 0.9;
          g.swingT = 0.3;
          if (inFrontArc(g, player.pos, 2.3)) damagePlayer(1, g);
        }
      } else {
        if (pd > 1.6) {
          moveEntity(g, player.pos.x, player.pos.z, g.speed, dt);
          moving = true;
        } else if (g.attackCd <= 0) {
          g.windupT = 0.6;
          telegraphFlash(g, 0.6);
        }
        g.yaw = angleLerp(g.yaw, Math.atan2(player.pos.x - g.pos.x, player.pos.z - g.pos.z), dt * 10);
      }
    } else {
      if (g.windupT > 0) g.windupT = 0; // 通缉半路消了:收剑,别举着冻住
      g.state = 'patrol';
      const wp = g.waypoints[g.wp];
      if (moveEntity(g, wp[0], wp[1], g.speed * 0.45, dt)) g.wp = (g.wp + 1) % g.waypoints.length;
      else moving = true;
    }
    g.group.position.copy(g.pos);
    g.group.rotation.y = g.yaw;
    g.parts._attackAnim = (g.swingT || 0) > 0 || (g.windupT || 0) > 0;
    animateLimbs(g.parts, g.walkT, moving, g.group, g.state === 'chase' ? 1.1 : 0.55);
    if (g.windupT > 0) meleeSwing(g.parts, 0.32); // 蓄力:武器高举定住
    else if (g.swingT > 0) {
      g.swingT -= dt;
      meleeSwing(g.parts, Math.min(1, 1 - g.swingT / 0.35));
    }
  }
}

function updateRobber(b, dt) {
  if (b.stunT > 0) { b.stunT -= dt; return; }
  const v = streetEvent.villager;
  if (b.fleeing || !v) return; // 逃跑移动由事件管理器驱动
  b.attackCd = Math.max(0, b.attackCd - dt);
  if (b._trampleCd > 0) b._trampleCd -= dt;
  let moving = false;
  if (v.downT > 0) {
    b.fleeing = true;
    toast('盗贼得手了,正往幽暗森林逃!', 2.5);
  } else {
    const vd = Math.hypot(v.pos.x - b.pos.x, v.pos.z - b.pos.z);
    if (vd > 1.3) { moveEntity(b, v.pos.x, v.pos.z, 5.2, dt); moving = true; }
    else if (b.attackCd <= 0) {
      b.attackCd = 1;
      b.swingT = 0.35;
      v.downT = 8;
      v.group.rotation.x = -Math.PI / 2;
      sfx.hit();
    }
  }
  b.group.position.copy(b.pos);
  b.group.rotation.y = b.yaw;
  b.parts._attackAnim = (b.swingT || 0) > 0;
  animateLimbs(b.parts, b.walkT, moving, b.group, 1);
  if (b.swingT > 0) { b.swingT -= dt; meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35)); }
}

function updateBandits(dt) {
  for (const b of bandits) {
    if (b.dead) {
      if (b.ambient) {
        b.respawnT = (b.respawnT ?? 60) - dt;
        if (b.respawnT <= 0) {
          b.dead = false;
          b.hp = b.maxHp || 5;
          b.pos.copy(b.home);
          b.group.rotation.x = 0;
          b.respawnT = 60;
          b.windupT = 0; b.swingT = 0; b.heavyAtk = false; b.comboN = 0; b.fleeT = 0; b.stunT = 0; // 上辈子的事一笔勾销
        }
      }
      continue;
    }
    if (!specialBandit(b) && !b.warband && entFar(b)) continue; // 远处匪徒待机(特殊身份/战团要行军,不休眠)
    // Boss 二阶段:血量过半即狂暴——提速、加伤、召两名亲卫
    if (b.boss && !b.enraged && b.hp <= (b.maxHp || 12) / 2) {
      b.enraged = true;
      b.speed += 2.2;
      b.dmg = 3;
      telegraphFlash(b);
      hitStop(0.1);
      sfx.wanted();
      toast('🔥 血斧巴罗克双目赤红——狂暴了!!', 3.5);
      const m1 = addBandit(b.pos.x - 3, b.pos.z, { hp: 2 });
      m1.eventFoe = true;
      m1.minion = true;
      const m2 = addBandit(b.pos.x + 3, b.pos.z, { hp: 2 });
      m2.eventFoe = true;
      m2.minion = true;
    }
    if (b.robber) { updateRobber(b, dt); continue; }
    if (b.convict) {
      if (b.stunT > 0) { b.stunT -= dt; continue; }
      const fx2 = b.pos.x - player.pos.x, fz2 = b.pos.z - player.pos.z;
      const fd = Math.hypot(fx2, fz2) || 1;
      moveEntity(b, b.pos.x + (fx2 / fd) * 8, b.pos.z + (fz2 / fd) * 8, b.speed, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1);
      continue;
    }
    if (b.stunT > 0) { // 踉跄:蓄到一半的招一并作废,免得僵直一过凭空补刀
      b.stunT -= dt;
      b.windupT = 0;
      b.comboN = 0;
      b.heavyAtk = false;
      continue;
    }
    if (b.armorT > 0) b.armorT -= dt;
    if (b.hitStunT > 0) { // 受击硬直:身子一缩、往后一仰,这一下什么都做不了
      b.hitStunT -= dt;
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      if (b.parts.body) b.parts.body.rotation.x = -0.28 * Math.min(1, b.hitStunT * 4);
      if (b.hitStunT <= 0 && b.parts.body) b.parts.body.rotation.x = 0;
      continue;
    }
    if (b._truce && warband.duelOn) { // 单挑立誓:喽啰围观,不插手
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, false, b.group, 0.5);
      continue;
    }
    if (b.fleeT > 0) { // 溃逃:头也不回地跑,跑够了才敢回头
      b.fleeT -= dt;
      const rx = b.pos.x - player.pos.x, rz = b.pos.z - player.pos.z;
      const rd = Math.hypot(rx, rz) || 1;
      moveEntity(b, b.pos.x + (rx / rd) * 7, b.pos.z + (rz / rd) * 7, b.speed * 1.05, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1.15);
      continue;
    }
    b.attackCd = Math.max(0, b.attackCd - dt);
    if (b._trampleCd > 0) b._trampleCd -= dt;
    const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    let moving = false;
    // 攻城战:玩家不在眼前时,战团匪徒先跟拦路的卫兵拼刀
    if (b.warband && warband.siege && pd > 6) {
      let gt = null, gd2 = 900;
      for (const g2 of guards) {
        if (g2.downT > 0) continue;
        const d2v = dist2(b.pos.x, b.pos.z, g2.pos.x, g2.pos.z);
        if (d2v < gd2) { gd2 = d2v; gt = g2; }
      }
      if (gt) {
        if (gd2 > 1.6 * 1.6) { moveEntity(b, gt.pos.x, gt.pos.z, b.speed, dt); moving = true; }
        else if (b.attackCd <= 0) {
          b.attackCd = 1.1;
          b.swingT = 0.35;
          sfx.clank();
          spawnDust(gt.pos.x, 1.0, gt.pos.z, 2, 0.4, 1.2);
          gt.state = 'chase';
          applyDamage(gt, 1, { source: 'foe' });
        }
        b.group.position.copy(b.pos);
        b.group.rotation.y = b.yaw;
        b.parts._attackAnim = (b.swingT || 0) > 0;
        animateLimbs(b.parts, b.walkT, moving, b.group, 1.0);
        if (b.swingT > 0) { b.swingT -= dt; meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35)); }
        continue;
      }
    }
    // 护送任务的埋伏盗贼优先攻击商人(除非玩家贴脸)
    const mc = questRT.merchant;
    if (b.escort && mc && mc.hp > 0 && pd > 5) {
      const md = Math.hypot(mc.pos.x - b.pos.x, mc.pos.z - b.pos.z);
      if (md > 1.4) { moveEntity(b, mc.pos.x, mc.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) {
        b.attackCd = 1.0;
        b.swingT = 0.35;
        mc.hp--;
        sfx.hit();
        toast(`商人受袭!❤ ${Math.max(0, mc.hp)}/5`, 1.5);
      }
    } else if (pd < 30 * sneakFactor() && !player.dead) {
      if (b.windupT > 0) {
        b.windupT -= dt;
        // 起手中慢慢转向你(≤3 rad/s),最后 0.2 秒锁死方向:侧闪、绕背才有意义
        if (b.windupT > 0.2) b.yaw = turnToward(b.yaw, Math.atan2(player.pos.x - b.pos.x, player.pos.z - b.pos.z), 3 * dt);
        if (b.windupT <= 0) {
          b.swingT = 0.3;
          // 判定 = 预警扇形:半径 2.3(紫圈重击 2.7)、正前方 ±60°
          if (inFrontArc(b, player.pos, b.heavyAtk ? 2.7 : 2.3)) damagePlayer(b.heavyAtk ? b.dmg + 1 : b.dmg, b, b.heavyAtk);
          if (b.heavyAtk) { // 重击落地:震屏收尾,恢复期更长
            b.heavyAtk = false;
            cam.shake = Math.max(cam.shake, 0.25);
            b.attackCd = 1.7;
          } else if (b.comboN > 0) { // 二连击:紧接一记快斩
            b.comboN--;
            b.windupT = 0.42;
            telegraphFlash(b, 0.42);
            b.attackCd = 0.2;
          } else b.attackCd = 1.0;
        }
      } else if (pd > 1.6) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) {
        // 车轮战:同时出手的最多两人,其余的绕着你侧向游走等空档(骑砍围攻的呼吸感)
        const attackers = bandits.reduce((n, o) => n + ((o.windupT > 0 || o.swingT > 0) && !o.dead &&
          dist2(o.pos.x, o.pos.z, player.pos.x, player.pos.z) < 400 ? 1 : 0), 0); // 只数身边 20 米内的出手者
        if (attackers >= 2) {
          const px = player.pos.x - b.pos.x, pz = player.pos.z - b.pos.z;
          const d = Math.hypot(px, pz) || 1;
          b._orbit = b._orbit || (rand() < 0.5 ? 1 : -1);
          moveEntity(b, b.pos.x + (-pz / d) * b._orbit * 2, b.pos.z + (px / d) * b._orbit * 2, b.speed * 0.55, dt);
          moving = true;
        } else {
          // 出招选择:精英(头目/悬赏/决斗)会二连击和破盾重击,杂兵偶尔连击
          const elite = b.boss || b.bountyHead || b.duel || b.elite;
          const r = rand();
          // 起手 ≥0.6 秒(看得清、来得及反应),紫圈重击 1 秒
          if (elite && r < 0.3) { b.heavyAtk = true; b.windupT = 1.0; telegraphFlash(b, 1.0, true); }
          else if ((elite && r < 0.65) || (!elite && r < 0.18)) { b.comboN = 1; b.windupT = 0.62; telegraphFlash(b, 0.62); }
          else { b.windupT = 0.62; telegraphFlash(b, 0.62); }
        }
      }
    } else {
      const a = performance.now() * 0.0003 + b.home.x;
      moveEntity(b, b.home.x + Math.cos(a) * 5, b.home.z + Math.sin(a) * 5, b.speed * 0.3, dt);
      moving = true;
    }
    // 包抄间距:同伙互相让位,别挤成一摞人肉塔
    if (pd < 40) {
      for (const o of bandits) {
        if (o === b || o.dead || o.downT > 0) continue;
        const sx = b.pos.x - o.pos.x, sz = b.pos.z - o.pos.z;
        const sd = sx * sx + sz * sz;
        if (sd < 1.32 && sd > 0.0001) {
          const d = Math.sqrt(sd);
          b.pos.x += (sx / d) * (1.15 - d) * dt * 3;
          b.pos.z += (sz / d) * (1.15 - d) * dt * 3;
        }
      }
    }
    b.group.position.copy(b.pos);
    b.group.rotation.y = b.yaw;
    b.parts._attackAnim = (b.swingT || 0) > 0 || (b.windupT || 0) > 0;
    animateLimbs(b.parts, b.walkT, moving, b.group, 1.0);
    if (b.windupT > 0) meleeSwing(b.parts, 0.32); // 蓄力:武器高举定住
    else if (b.swingT > 0) {
      b.swingT -= dt;
      meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35));
    }
  }
}

// 一天的时辰(驱动 NPC 日程)
function dayPhase() {
  if (clock.time >= 0.25 && clock.time < 0.33) return 'dawn';
  if (clock.time >= 0.33 && clock.time < 0.62) return 'day';
  if (clock.time >= 0.62 && clock.time < 0.72) return 'dusk';
  return 'night';
}

// 村民日程:清晨在家门口 → 白天上工 → 黄昏去旅店/广场 → 夜里回家睡觉
function updateVillagers(dt) {
  const phase = dayPhase();
  for (const v of villagers) {
    if (v.robbedT > 0) v.robbedT -= dt;
    if (v.downT > 0) {
      v.downT -= dt;
      if (v.downT <= 0) v.group.rotation.x = 0;
      continue;
    }
    if (v.fleeT <= 0 && entFar(v)) {
      // 远处村民不演日程,但入夜/天亮的状态切换要补上,免得远景里站着一排"雕像"
      if (phase === 'night' && !v.sleeping) {
        v.sleeping = true;
        v.group.visible = false;
        v.pos.copy(v.home);
        v.group.position.copy(v.pos);
      } else if (phase !== 'night' && v.sleeping) {
        v.sleeping = false;
        v.group.visible = true;
      }
      continue;
    }
    // 夜里睡觉:走到家,消失在屋里
    if (phase === 'night' && v.fleeT <= 0) {
      if (v.sleeping) continue;
      if (moveEntity(v, v.home.x, v.home.z, 2.2, dt)) {
        v.sleeping = true;
        v.group.visible = false;
        continue;
      }
      v.group.position.copy(v.pos);
      v.group.rotation.y = v.yaw;
      animateLimbs(v.parts, v.walkT, true, v.group, 0.5);
      continue;
    }
    if (v.sleeping) { v.sleeping = false; v.group.visible = true; }

    const pd = Math.hypot(player.pos.x - v.pos.x, player.pos.z - v.pos.z);
    let moving = false;
    if (wanted > 0 && pd < 12) v.fleeT = 2;
    if (v.fleeT > 0) {
      v.fleeT -= dt;
      const fx = v.pos.x - player.pos.x, fz = v.pos.z - player.pos.z;
      const d = Math.hypot(fx, fz) || 1;
      moveEntity(v, v.pos.x + (fx / d) * 5, v.pos.z + (fz / d) * 5, 4.2, dt);
      moving = true;
    } else {
      // 当前时辰该去的地方
      const spot = phase === 'day' ? v.id.work : phase === 'dusk' ? v.id.leisure : v.id.home;
      const sd = Math.hypot(v.pos.x - spot[0], v.pos.z - spot[1]);
      if (sd > 6) {
        // 赶路
        moveEntity(v, spot[0], spot[1], 2.4, dt);
        moving = true;
      } else {
        // 在目的地附近晃悠、干活
        v.timer -= dt;
        if (v.timer <= 0) {
          v.timer = 2 + rand() * 4;
          const a = rand() * 6.28;
          v.target = [spot[0] + Math.cos(a) * 3.5, spot[1] + Math.sin(a) * 3.5];
        }
        if (v.target && !moveEntity(v, v.target[0], v.target[1], 1.5, dt)) moving = true;
      }
    }
    v.group.position.copy(v.pos);
    v.group.rotation.y = v.yaw;
    animateLimbs(v.parts, v.walkT, moving, v.group, v.fleeT > 0 ? 0.95 : 0.35);
  }
}

function updateHorses(dt) {
  for (const h of horses) {
    if (h === player.mounted) continue;
    if (!h.runaway && entFar(h)) continue; // 远处的马原地吃草
    // 空中下马后自然回落地面
    if (h.pos.y > 0) h.pos.y = Math.max(0, h.pos.y - 22 * dt);
    if (h.runaway) {
      // 受惊狂奔:不停变向
      h.timer -= dt;
      if (h.timer <= 0) {
        h.timer = 1.2 + rand();
        const a = rand() * 6.28;
        h.rTarget = [h.pos.x + Math.cos(a) * 20, h.pos.z + Math.sin(a) * 20];
      }
      if (h.rTarget) moveEntityHorse(h, h.rTarget[0], h.rTarget[1], 9, dt);
      h.group.position.copy(h.pos);
      h.group.rotation.y = h.yaw;
      animHorseLegs(h, 1.5);
      continue;
    }
    h.timer -= dt;
    let moving = false;
    if (h.timer <= 0) {
      h.timer = 3 + rand() * 5;
      const a = rand() * 6.28;
      h.target = [h.home.x + Math.cos(a) * 8, h.home.z + Math.sin(a) * 8];
      if (rand() < 0.5) h.target = null; // 吃草
    }
    if (h.target) {
      if (moveEntityHorse(h, h.target[0], h.target[1], 2, dt)) h.target = null;
      else moving = true;
    }
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    animHorseLegs(h, moving ? 1 : 0);
  }
}
function moveEntityHorse(h, tx, tz, speed, dt) {
  const dx = tx - h.pos.x, dz = tz - h.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  h.pos.x += (dx / d) * speed * dt;
  h.pos.z += (dz / d) * speed * dt;
  h.yaw = angleLerp(h.yaw, Math.atan2(dx, dz), dt * 6);
  h.walkT += dt * speed * 2;
  resolveCollisions(h.pos, 0.8, colliders);
  return false;
}
// 马匹步态:静止 / 小跑(对角步)/ 疾驰(前后肢分相 + 身体俯仰起伏)
function animHorseLegs(h, intensity) {
  const w = h.walkT;
  const L = h.parts.legs;
  if (intensity < 0.05) {
    for (const leg of L) leg.rotation.x *= 0.8;
    h.visBob = (h.visBob || 0) * 0.8;
    h.visPitch = (h.visPitch || 0) * 0.8;
  } else if (intensity < 1.25) {
    // 小跑:对角腿成对
    const a = Math.sin(w) * 0.5;
    L[0].rotation.x = a; L[1].rotation.x = -a;
    L[2].rotation.x = -a; L[3].rotation.x = a;
    h.visBob = Math.abs(Math.sin(w)) * 0.04;
    h.visPitch = 0;
  } else {
    // 疾驰:后肢蹬地、前肢前伸,身体俯仰 + 腾空起伏
    const rear = Math.sin(w) * 0.9;
    const front = Math.sin(w + 2.2) * 0.9;
    L[0].rotation.x = rear; L[1].rotation.x = rear * 0.92;
    L[2].rotation.x = front; L[3].rotation.x = front * 0.92;
    h.visBob = Math.max(0, Math.sin(w + 0.6)) * 0.17;
    h.visPitch = Math.sin(w + 1.2) * 0.07;
  }
  h.group.position.y = h.pos.y + (h.visBob || 0);
  h.group.rotation.x = h.visPitch || 0;
}

// ================= 玩家更新 =================
const _moveFwd = new THREE.Vector2();
const _moveRight = new THREE.Vector2();
const _moveVec = new THREE.Vector2();
function updatePlayer(dt) {
  if (player.dead) return;
  player.invulnT = Math.max(0, player.invulnT - dt);

  // 醉酒:打嗝 + 清醒判定
  if (player.drunkT > 0) {
    player.drunkT -= dt;
    player.hiccupT -= dt;
    if (player.hiccupT <= 0) {
      player.hiccupT = 3 + rand() * 3;
      sfx.hiccup();
      cam.shake = Math.max(cam.shake, 0.12);
    }
    if (player.drunkT <= 0) toast('你清醒过来了……头好痛。', 2.5);
  }

  // 攻击动画(三段式:蓄力→劈砍→收势)
  if (player.attackT > 0) {
    player.attackT -= dt;
    const t = 1 - player.attackT / (player.attackDur || 0.35);
    const from = player._animFrom || 0; // 重击从蓄力举剑位接着播
    player.parts._attackAnim = true;
    meleeSwing(player.parts, Math.min(1, from + (1 - from) * t), player._stance);
    if (player.attackT <= 0) endAttack();
  }

  const f = _moveFwd.set(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  const r = _moveRight.set(-f.y, f.x);
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  const mv = _moveVec.set(f.x * iz + r.x * ix, f.y * iz + r.y * ix);
  const moving = mv.lengthSq() > 0;
  if (moving) mv.normalize();
  // 醉酒:走路画龙
  if (moving && player.drunkT > 0) {
    const wob = Math.sin(performance.now() * 0.0012) * 0.7;
    const cw = Math.cos(wob), sw = Math.sin(wob);
    mv.set(mv.x * cw - mv.y * sw, mv.x * sw + mv.y * cw);
  }

  if (player.mounted) {
    const h = player.mounted;
    const speed = h.sheep
      ? (keys['ShiftLeft'] || keys['ShiftRight'] ? 4.6 : 3.2)
      : (keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11) * (h.fast ? 1.2 : 1) *
        (1 + 0.02 * (skillLv('riding') - 1)); // 骑术:人马合一
    player._rideSpeed = moving ? speed : 0; // 冲量记账:马上挥刀按马速加成
    // 骑砍冲锋践踏:疾驰状态撞上敌人,连人带马把他掀翻
    if (!h.sheep && speed >= 16 && moving) {
      for (const list of [bandits, wolves]) {
        for (const e of list) {
          if (e.dead || e.downT > 0 || (e._trampleCd || 0) > 0) continue;
          if (dist2(h.pos.x, h.pos.z, e.pos.x, e.pos.z) > 3.2) continue;
          e._trampleCd = 2.5;
          // 践踏只把人撞个趔趄(0.5 秒、不扣血、不开处决):冲阵要靠马上那一刀,不是自动清场
          if (e.stunT !== undefined) { e.stunT = Math.max(e.stunT || 0, 0.5); e.stunSrc = 'bash'; }
          hitFX(e, 2.2);
          callout('撞翻!', 'gold', e.pos);
          sfx.hoof();
          cam.shake = Math.max(cam.shake, 0.25);
          skillXp('riding', 2);
        }
      }
    }
    if (moving) {
      // 坡度:马能爬缓坡,陡坡明显吃力,悬崖上不去;下坡略快
      const hg0 = groundH(h.pos.x, h.pos.z);
      const hg1 = groundH(h.pos.x + mv.x * 1.2, h.pos.z + mv.y * 1.2);
      const hGrade = (hg1 - hg0) / 1.2;
      const hSlope = hGrade > 0 ? Math.max(0.1, 1 - Math.max(0, hGrade - 0.3) * 1.25) : Math.min(1.1, 1 - hGrade * 0.12);
      h.pos.x += mv.x * speed * hSlope * dt;
      h.pos.z += mv.y * speed * hSlope * dt;
      h.yaw = angleLerp(h.yaw, Math.atan2(mv.x, mv.y), dt * 6);
      h.walkT += dt * speed * 1.6;
      if (h.sheep) {
        stats.sheepDist += speed * dt;
        if (stats.sheepDist >= 100) unlockAch('shepherd');
      }
    }
    // 骑乘跳跃
    if (keys['Space'] && player.onGround) {
      player.vy = 8;
      player.onGround = false;
      sfx.jump();
      keys['Space'] = false;
    }
    const horseAirborne = !player.onGround;
    player.vy -= 22 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vy = 0;
      player.onGround = true;
      if (horseAirborne) spawnDust(h.pos.x, 0.1, h.pos.z, 7, 1.4, 1.8);
    }
    // 马蹄声与扬尘(节奏随速度)
    if (moving && player.onGround) {
      h.stepT = (h.stepT || 0) - dt;
      if (h.stepT <= 0) {
        h.stepT = (keys['ShiftLeft'] || keys['ShiftRight']) ? 0.17 : 0.32;
        if (h.sheep) { if (rand() < 0.22) sfx.baa(); }
        else sfx.hoof();
        spawnDust(h.pos.x - Math.sin(h.yaw) * 1.1, 0.08, h.pos.z - Math.cos(h.yaw) * 1.1,
          (keys['ShiftLeft'] || keys['ShiftRight']) ? 3 : 1, 0.8, 1.3);
      }
    }
    resolveCollisions(h.pos, 0.85, colliders);
    h.pos.y = player.pos.y;
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    const galloping = moving && (keys['ShiftLeft'] || keys['ShiftRight']);
    animHorseLegs(h, moving ? (galloping ? 1.6 : 1.0) : 0);
    cam.moveState = moving ? (galloping ? 3 : 2) : 0;
    player.pos.x = h.pos.x;
    player.pos.z = h.pos.z;
    player.yaw = h.yaw;
    // 骑手随马起伏,疾驰时前倾(骑羊时……贴地飞行)
    player.group.position.set(h.pos.x, h.pos.y + (h.sheep ? 0.72 : 1.35) + (h.visBob || 0), h.pos.z);
    player.group.rotation.y = h.yaw;
    player.parts.legL.rotation.x = -1.1;
    player.parts.legR.rotation.x = -1.1;
    player.parts.body.rotation.x = galloping ? 0.3 : 0.1;
    player.parts.armL.rotation.x = -0.55;
    if (!player.parts._attackAnim) player.parts.armR.rotation.x = -0.55;
    return;
  }

  // 翻滚接管本帧
  if (player.rollCd > 0) player.rollCd -= dt;
  if (player.rollT > 0) {
    player.rollT -= dt;
    player.pos.x += player.rollDir.x * 13 * dt;
    player.pos.z += player.rollDir.y * 13 * dt;
    resolveCollisions(player.pos, 0.45, colliders);
    player.group.position.copy(player.pos);
    player.group.rotation.y = player.yaw;
    player.group.rotation.x = -(1 - Math.max(0, player.rollT) / 0.38) * Math.PI * 2;
    if (player.rollT <= 0) player.group.rotation.x = 0;
    cam.moveState = 2;
    return;
  }
  // 疾跑吃体力:跑干了就只能小步喘(骑砍的腿);出招与蓄力时不能疾跑
  const committed = player.attackT > 0 && !(player.lungeT > 0); // 出招有承诺:脚下收住
  const canSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && player.sta > 0.5 && player.gaspT <= 0 &&
    !committed && !player.charging;
  const speed = (canSprint ? 8.4 : 5.0) * (player.blocking ? 0.45 : 1) *
    (committed ? 0.3 : 1) * (player.charging ? 0.5 : 1) *
    (player.blessT > 0 ? 1.15 : 1) * // 教堂庇佑:脚下生风
    (player.homeDay === calendar.day ? 1.08 : 1) * // 在自家床上睡过:安眠增益
    (player.sneaking ? 0.5 : 1) * // 潜行:压着步子
    (player.gaspT > 0 ? 0.75 : 1) * (player.staggerT > 0 ? 0.35 : 1); // 喘气/踉跄拖腿
  const prevYaw = player.yaw;
  if (moving) {
    // 坡度:上坡越陡越慢(陡崖几乎爬不动),下坡略快——山才像山
    const h0 = groundH(player.pos.x, player.pos.z);
    const h1 = groundH(player.pos.x + mv.x * 0.8, player.pos.z + mv.y * 0.8);
    const grade = (h1 - h0) / 0.8;
    const slopeMul = grade > 0 ? Math.max(0.12, 1 - Math.max(0, grade - 0.25) * 1.15) : Math.min(1.12, 1 - grade * 0.15);
    player.pos.x += mv.x * speed * slopeMul * dt;
    player.pos.z += mv.y * speed * slopeMul * dt;
    // 出招中不跟着脚步转身(刀已出手);蓄力时只能慢慢调整朝向
    if (!lockFoe && !committed) player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * (player.charging ? 4 : 12));
    player.walkT += dt * speed * 2.2;
    if (canSprint) player.sta = Math.max(0, player.sta - 7 * dt);
  }
  // 锁定中:身体始终朝着目标,移动变成环绕侧步
  if (lockFoe) {
    player.yaw = angleLerp(player.yaw,
      Math.atan2(lockFoe.pos.x - player.pos.x, lockFoe.pos.z - player.pos.z), dt * 14);
  }
  cam.moveState = moving ? (speed > 5 ? 2 : 1) : 0;
  if (fishing.active && moving) {
    fishing.active = false;
    toast('收竿了。', 1.5);
  }
  // 疾跑扬尘
  if (moving && player.onGround && speed > 5) {
    player.stepT = (player.stepT || 0) - dt;
    if (player.stepT <= 0) {
      player.stepT = 0.22;
      spawnDust(player.pos.x, 0.05, player.pos.z, 1, 0.35, 1.0);
    }
  }
  // 转向侧倾
  let dyaw = (player.yaw - prevYaw) % (Math.PI * 2);
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  player.lean = (player.lean || 0) * 0.86 + Math.max(-0.16, Math.min(0.16, -dyaw * 1.6)) * 0.14;

  // 跳跃(二段跳)
  if (keys['Space']) {
    if (player.onGround) {
      player.vy = 8.2; player.onGround = false; player.jumps = 1; sfx.jump();
    } else if (player.jumps === 1) {
      player.vy = 7.4; player.jumps = 2; sfx.jump();
    }
    keys['Space'] = false;
  }
  const wasAirborne = !player.onGround;
  const fallSpeed = player.vy;
  player.vy -= 22 * dt;
  // 抱着鸡:扑腾缓降(塞尔达欠我们的)
  if (player.carrying && player.vy < -2.4) player.vy = -2.4;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vy = 0;
    // 先重置着地状态,再判定踩踏——checkStomp 的弹跳(onGround=false)才能保留,支持连环踩踏
    player.onGround = true;
    player.jumps = 0;
    if (player.plunging) {
      // 跳劈落地:全方位冲击波
      player.plunging = false;
      const def = WEAPONS[player.weapon];
      sfx.stomp();
      cam.shake = Math.max(cam.shake, 0.4);
      hitStop(0.05);
      spawnDust(player.pos.x, 0.1, player.pos.z, 14, 2.4, 2);
      swingTrail(3.4, Math.PI * 2);
      meleeSweep(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + 1, 3.4, -1.01, def.knock * 1.6);
      stats.plunges = (stats.plunges || 0) + 1;
    }
    if (wasAirborne && fallSpeed < -3) checkStomp();
    if (wasAirborne && fallSpeed < -4) player.squashT = 0.16; // 落地挤压
    if (wasAirborne && fallSpeed < -10) cam.shake = 0.22;
    if (wasAirborne && fallSpeed < -6) spawnDust(player.pos.x, 0.06, player.pos.z, 6, 0.9, 1.5);
  }

  // “?”砖块(从下方顶)
  if (player.vy > 0) {
    for (const b of world.qBlocks) {
      if (b.used) continue;
      const headY = player.pos.y + 1.55;
      if (Math.abs(player.pos.x - b.x) < 0.85 && Math.abs(player.pos.z - b.z) < 0.85 &&
          headY > b.y - 0.5 && headY < b.y + 0.2) {
        b.used = true;
        b.bump = 0.25;
        b.mesh.material.emissiveIntensity = 0; // 符文熄灭,只剩一块旧石头
        b.mesh.material.color.setHex(0x8f8a80);
        magBurst(b.x, b.y, b.z);
        player.vy = -1;
        sfx.block();
        for (let i = 0; i < 5; i++) {
          const a = rand() * 6.28;
          addPickup('coin', b.x + Math.cos(a) * 1.2, b.z + Math.sin(a) * 1.2, 30);
        }
        callout('符文碎光 +5 金币', 'blue', { x: b.x, y: b.y - 1.2, z: b.z });
      }
    }
  }

  resolveCollisions(player.pos, 0.45, colliders);
  pushCrowd();
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  player.group.rotation.z = player.lean || 0;
  // 受伤闪烁
  player.group.visible = player.invulnT > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true;
  animateLimbs(player.parts, player.walkT, moving, player.group, speed / 7.6);
  // 格挡姿势:有盾就把左臂的圆盾横在身前、剑收在腰侧;巨剑没盾,横剑挡
  playerShield.visible = player.weapon !== 'bow' && player.weapon !== 'greatsword';
  const hasShield = playerShield.visible;
  if (player.blocking && !player.parts._attackAnim) {
    if (hasShield) {
      player.parts.armL.rotation.x = -1.3;
      player.parts.armL.rotation.z = 0.55;
      player.parts.armR.rotation.x = -0.45;
      player.parts.armR.rotation.z = -0.2;
    } else {
      player.parts.armR.rotation.x = -1.35;
      player.parts.armR.rotation.z = -0.5;
    }
  } else if (!player.parts._attackAnim) {
    player.parts.armR.rotation.z = 0;
  }
  if (!player.blocking) player.parts.armL.rotation.z = 0;
  playerShield.rotation.y = player.blocking ? -1.1 : 0; // 举盾时盾面转向正前
  // 施法:抬手前推(火球聚能时一直举着)
  if ((player.castPoseT > 0 || player.fireCharging) && !player.parts._attackAnim && !player.blocking) {
    player.parts.armR.rotation.x = -1.45;
    player.parts.armR.rotation.z = 0.15;
    player.parts.armL.rotation.x = -1.1;
  }
  // 挨打:身子一缩、往后一仰(0.3 秒硬直)
  if (player.hurtT > 0) {
    player.hurtT -= dt;
    player.parts.body.rotation.x = -0.3 * Math.min(1, player.hurtT / 0.15);
  }
  // 抱鸡:高举过头,鸡随身,空中扑腾
  if (player.carrying) {
    const c = player.carrying;
    c.pos.set(player.pos.x, player.pos.y + 1.78, player.pos.z);
    c.group.position.copy(c.pos);
    c.group.rotation.y = player.yaw;
    c.walkT += dt * (player.onGround ? 4 : 26);
    c.parts.body.position.y = 0.26 + (!player.onGround ? Math.abs(Math.sin(c.walkT)) * 0.07 : 0);
    if (!player.parts._attackAnim) {
      player.parts.armL.rotation.x = Math.PI * 0.92;
      player.parts.armR.rotation.x = Math.PI * 0.92;
    }
  }
}

function checkStomp() {
  const tryStomp = (list, isGuard) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.stunT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 1.3) {
        e.stunT = 5; e.stunSrc = 'other';
        player.vy = 7.5;
        player.onGround = false;
        player.jumps = 1;
        sfx.stomp();
        const nowS = performance.now() / 1000;
        if (nowS - stats.lastStomp < 2) unlockAch('bouncer');
        stats.lastStomp = nowS;
        spawnDust(e.pos.x, 0.3, e.pos.z, 6, 0.8, 1.6);
        toast(isGuard ? '踩晕了卫兵!' : '踩晕了敌人!', 1.5);
        if (isGuard) crime(1);
        return true;
      }
    }
    return false;
  };
  // 踩到鸡:弹起 + 拉仇恨
  for (const c of chickens) {
    if (c === player.carrying || c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 1.1) {
      pokeChicken(c);
      player.vy = 7.5;
      player.onGround = false;
      player.jumps = 1;
      sfx.stomp();
      return true;
    }
  }
  return tryStomp(guards, true) || tryStomp(bandits, false) || tryStomp(wolves, false);
}

function doRoll() {
  if (!started || player.dead || player.mounted || player.carrying ||
      player.rollCd > 0 || player.rollT > 0 || !player.onGround || player.staggerT > 0) return;
  if (!spendSta(15)) return;
  player.lastRollAt = simNow(); // 序章"真的躲开了"的判定要用
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = -fz, rz = fx;
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
  if (dx === 0 && dz === 0) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); }
  const d = Math.hypot(dx, dz);
  player.rollDir.set(dx / d, dz / d);
  player.yaw = Math.atan2(dx, dz);
  player.rollT = 0.38;
  player.rollCd = 0.95;
  player.invulnT = Math.max(player.invulnT, 0.45); // 无敌帧
  sfx.roll();
  spawnDust(player.pos.x, 0.05, player.pos.z, 4, 0.5, 1);
}

function tryRob() {
  if (!started || player.dead || player.mounted) return;
  // 扒窃(天际式):潜行状态从背后下手——无声取财;失手立刻炸锅
  if (player.sneaking) {
    for (const v of villagers) {
      if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
      if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6.5) continue;
      const dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const behind = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / d < -0.1; // 站在其背后
      const chance = Math.min(0.92, (behind ? 0.55 : 0.25) + 0.05 * (skillLv('sneak') - 1));
      v.robbedT = 90;
      if (rand() < chance) {
        skillXp('sneak', 3);
        stats.pockets = (stats.pockets || 0) + 1;
        if (stats.pockets >= 5) unlockAch('cutpurse');
        if (rand() < 0.4) { // 摸到的不是钱,是赃物——城里没人敢收
          player.loot = (player.loot || 0) + 1;
          sfx.chest();
          const item = ['一支银簪', '一块怀表', '一只铜烛台', '一枚刻名的戒指', '半串珍珠'][Math.floor(rand() * 5)];
          toast(`🫲 摸到${item}(赃物 ×${player.loot})。城里没人敢收——听说沼泽那位不问来路。`, 3.5);
        } else {
          const take = 2 + Math.floor(rand() * 5);
          player.coins += take;
          sfx.coin();
          toast(`🤫 得手!从${v.id.name}兜里摸走 ${take} 金币。(没人看见……吧?)`, 2.5);
        }
      } else {
        v.fleeT = 6;
        showBubble(v, v.id.name, '有贼!我的钱袋!!', 3);
        crime(1, '🫲 扒窃失手,被当场抓包!');
      }
      return;
    }
    toast('附近没有下手的对象。(蹲着走过去,贴到背后)', 2);
    return;
  }
  for (const v of villagers) {
    if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6) continue;
    v.robbedT = 60;
    v.fleeT = 6;
    dropCoins(v.pos, 3 + Math.floor(rand() * 4));
    showBubble(v, v.id.name, '救命!抢劫啦——!!', 3);
    crime(2, '💰 你抢劫了村民!');
    return;
  }
  toast('附近没有可以抢的人。(你在想什么?)', 2);
}

// ================= 拾取 =================
function updatePickups(dt) {
  const radius = player.mounted ? 1.8 : 1.2;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    if (p.ttl !== Infinity) {
      p.ttl -= dt;
      if (p.ttl <= 0) { scene.remove(p.mesh); pickups.splice(i, 1); continue; }
      p.mesh.visible = p.ttl > 5 || Math.floor(p.t * 8) % 2 === 0;
    }
    p.mesh.rotation.y += dt * 3.5;
    // 金币磁吸:靠近就飞进口袋
    if (p.type === 'coin' && !player.dead) {
      const md = dist2(player.pos.x, player.pos.z, p.x, p.z);
      if (md < 30 && md > 0.05) {
        const d = Math.sqrt(md);
        const pull = (12 * dt) / d;
        p.x += (player.pos.x - p.x) * pull;
        p.z += (player.pos.z - p.z) * pull;
        p.mesh.position.x = p.x;
        p.mesh.position.z = p.z;
      }
    }
    if (p.type !== 'coin') p.mesh.position.y = (p.type === 'star' ? 1.4 : p.type === 'crest' ? 1.0 : 0.65) + Math.sin(p.t * 3) * 0.12;
    if (!player.dead && dist2(player.pos.x, player.pos.z, p.x, p.z) < radius * radius &&
        player.pos.y < 1.5) {
      if (p.type === 'coin') {
        player.coins++;
        sfx.coin();
        if (quest.active && missions[quest.idx].type === 'coins') quest.progress++;
      } else if (p.type === 'heart') {
        player.hp = Math.min(player.maxHp, player.hp + 2);
        sfx.heart();
      } else if (p.type === 'crest') {
        crestsFound.push(p.id);
        sfx.chest();
        if (crestsFound.length >= world.crestSpots.length) {
          player.coins += 100;
          sfx.fanfare();
          toast(`🛡️ 集齐 ${world.crestSpots.length} 枚皇家纹章!奖励 100 金币!`, 5);
        } else {
          toast(`🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`, 3);
        }
        saveGame();
      } else {
        stats.starTaken = true; // 金狮勋章只领一次,记进档
        sfx.fanfare();
        toast('★ 恭喜通关!你成了王国传奇——世界仍然开放,继续撒欢吧!★', 8);
      }
      scene.remove(p.mesh);
      pickups.splice(i, 1);
    }
  }
}

// ================= 任务更新 =================
// 城墙寻路:人在城里、目标在城外(或反之)时,光柱与小地图箭头先指向顺路的城门,
// 免得新手顶着城墙原地打转(城墙矩形 x:-70..70, z:-55..55;城门见 world.gates)
function insideTown(x, z) { return Math.abs(x) < 70 && Math.abs(z) < 55; }
// 线段是否穿过城墙矩形(四周放宽 m 米);Liang–Barsky 裁剪
function segHitsTown(x0, z0, x1, z1, m = 1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const P = [-dx, dx, -dz, dz], Q = [x0 + 70 + m, 70 + m - x0, z0 + 55 + m, 55 + m - z0];
  for (let i = 0; i < 4; i++) {
    if (P[i] === 0) { if (Q[i] < 0) return false; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}
const TOWN_CORNERS = [{ x: -79, z: -64 }, { x: 79, z: -64 }, { x: 79, z: 64 }, { x: -79, z: 64 }];
// 城外从 (px,pz) 走到 (gx,gz):直线穿墙就先去最顺路的墙角(返回墙角);不穿墙返回 null
function cornerToward(px, pz, gx, gz) {
  if (!segHitsTown(px, pz, gx, gz)) return null;
  let best = null, bd = Infinity;
  for (const c of TOWN_CORNERS) {
    if (segHitsTown(px, pz, c.x, c.z)) continue;
    const d = Math.hypot(c.x - px, c.z - pz) + Math.hypot(gx - c.x, gz - c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// 城外两点间的步行距离(要绕墙就按绕墙角算)
function outsideDist(px, pz, gx, gz) {
  const c = cornerToward(px, pz, gx, gz);
  return c ? Math.hypot(c.x - px, c.z - pz) + Math.hypot(gx - c.x, gz - c.z) : Math.hypot(gx - px, gz - pz);
}
// 城墙寻路:返回这一段该先去的航点(城门或墙角),直接能走到目标时返回 null
function routeVia(tx, tz) {
  if (inDungeon()) return null;
  const px = player.pos.x, pz = player.pos.z;
  const pin = insideTown(px, pz), tin = insideTown(tx, tz);
  if (pin && tin) return null;
  if (pin) { // 城里 → 城外:走最顺路的城门
    let best = null, bd = Infinity;
    for (const g of world.gates) {
      const d = Math.hypot(g.x - px, g.z - pz) + outsideDist(g.x, g.z, tx, tz);
      if (d < bd) { bd = d; best = g; }
    }
    if (best && Math.hypot(best.x - px, best.z - pz) < 7) return null; // 已到门洞
    return best;
  }
  let goal = null;
  if (tin) { // 城外 → 城里:先到最顺路的城门(绕墙的路程算进去)
    let bd = Infinity;
    for (const g of world.gates) {
      const d = outsideDist(px, pz, g.x, g.z) + Math.hypot(tx - g.x, tz - g.z);
      if (d < bd) { bd = d; goal = g; }
    }
    if (goal && Math.hypot(goal.x - px, goal.z - pz) < 7) return null;
  }
  const gx = goal ? goal.x : tx, gz = goal ? goal.z : tz;
  return cornerToward(px, pz, gx, gz) || goal; // 城外 → 城外穿城:绕墙角
}
let beaconRouted = null; // 被改道到城门时记下真目标,下一帧先还原再让任务逻辑更新
function updateQuest(dt) {
  if (beaconRouted) {
    beacon.position.x = beaconRouted.x;
    beacon.position.z = beaconRouted.z;
    beaconRouted = null;
  }
  updateQuestTarget(dt);
  if (beacon.visible) {
    const via = routeVia(beacon.position.x, beacon.position.z);
    if (via) {
      beaconRouted = { x: beacon.position.x, z: beacon.position.z };
      beacon.position.x = via.x;
      beacon.position.z = via.z;
    }
  }
}
function updateQuestTarget(dt) {
  exGroup.visible = quest.idx < missions.length && !quest.active;
  exGroup.position.x = steward.pos.x;
  exGroup.position.z = steward.pos.z;
  exGroup.position.y = 2.1 + Math.sin(performance.now() * 0.003) * 0.15;
  exGroup.rotation.y += dt * 2;

  beacon.visible = false;
  if (bountyRT.target && !bountyRT.target.dead) {
    beacon.visible = true;
    beacon.position.x = bountyRT.target.pos.x;
    beacon.position.z = bountyRT.target.pos.z;
  }
  // 没有进行中的委托:光柱立在埃隆身上(他白天在广场、夜里回城堡)
  if (!quest.active && !beacon.visible && quest.idx < missions.length && !prologue.on && !player.dead) {
    beacon.visible = true;
    beacon.position.x = steward.pos.x;
    beacon.position.z = steward.pos.z;
  }
  if (quest.offerT > 0) quest.offerT -= dt;
  if (!quest.active || player.dead) return;
  const m = missions[quest.idx];
  const setBeacon = (x, z) => { beacon.visible = true; beacon.position.x = x; beacon.position.z = z; };

  if (m.type === 'deliver') {
    quest.timer -= dt;
    setBeacon(world.windmillPos.x, world.windmillPos.z);
    // 半路截道:出了东门、离磨坊还远时,两个黑石喽啰从路边窜出来抢包裹(甩开或砍翻都行)
    if (!questRT.deliverAmbush && player.pos.x > 84 &&
        dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) > 30 * 30) {
      questRT.deliverAmbush = true;
      const dx = world.windmillPos.x - player.pos.x, dz = world.windmillPos.z - player.pos.z;
      const dd = Math.hypot(dx, dz) || 1;
      const ax = player.pos.x + (dx / dd) * 13, az = player.pos.z + (dz / dd) * 13;
      for (const side of [-1, 1]) {
        const b = addBandit(ax - (dz / dd) * 5 * side, az + (dx / dd) * 5 * side, { hp: 2, speed: 6.2, escort: true });
        b.yaw = Math.atan2(-dx, -dz);
      }
      toastQuest('⚠️ 路边窜出两个黑石喽啰:「把包裹留下!」(甩开他们,或者砍翻)', 3.5);
      sfx.wanted();
    }
    if (dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) < 49) {
      const ambushed = questRT.deliverAmbush;
      questRT.deliverAmbush = false;
      completeMission();
      openDialog([
        '磨坊主老汉斯:(接过包裹,掂了掂)总算到了!这是今年的麦价文书——落到黑石那帮人手里,他们能把全城的面包价抬上天。',
        ambushed ? '老汉斯:路上碰到拦路的了?……嗯,他们最近盯磨坊盯得紧。替我谢谢埃隆,也谢谢你。'
          : '老汉斯:一路太平?那是你跑得快。最近黑石的人常在东路上晃悠,往后走这条路多留个心眼。',
      ]);
    } else if (quest.timer <= 0) {
      questRT.deliverAmbush = false;
      failMission('投递超时!回去找埃隆重新接取…');
    }
  } else if (m.type === 'coins') {
    beacon.visible = quest.progress >= m.goal;
    beacon.position.x = steward.pos.x;
    beacon.position.z = steward.pos.z;
  } else if (m.type === 'bandits') {
    beacon.visible = quest.progress < m.goal;
    beacon.position.x = world.banditCamp.x;
    beacon.position.z = world.banditCamp.z;
  } else if (m.type === 'race') {
    quest.timer -= dt;
    if (quest.timer <= 0) { failMission('超时!回去找埃隆再试一次…'); return; }
    const [rx, rz] = world.raceRoute[questRT.ringIdx];
    setBeacon(rx, rz);
    // 高亮当前环
    questRT.rings.forEach((ring, i) => {
      ring.rotation.y += dt * (i === questRT.ringIdx ? 3 : 0.6);
      ring.material.emissiveIntensity = i < questRT.ringIdx ? 0.1 : i === questRT.ringIdx ? 1.2 : 0.4;
    });
    if (dist2(player.pos.x, player.pos.z, rx, rz) < 9) {
      sfx.block();
      questRT.ringIdx++;
      if (questRT.ringIdx >= world.raceRoute.length) completeMission();
      else toast(`金环 ${questRT.ringIdx}/${world.raceRoute.length}`, 1.2);
    }
  } else if (m.type === 'losthorse') {
    const sh = questRT.specialHorse;
    if (!sh) return;
    if (player.mounted === sh) {
      setBeacon(world.stablePos.x, world.stablePos.z);
      if (dist2(player.pos.x, player.pos.z, world.stablePos.x, world.stablePos.z) < 100) {
        sh.home.copy(world.stablePos);
        sh.owned = false;
        completeMission();
        toast('雪影归你了!它就在马厩等你。', 4);
      }
    } else {
      setBeacon(sh.pos.x, sh.pos.z);
    }
  } else if (m.type === 'escort') {
    const mc = questRT.merchant;
    if (!mc) return;
    setBeacon(mc.pos.x, mc.pos.z);
    if (mc.hp <= 0) { failMission('商人巴特倒下了……回去找埃隆重整旗鼓。'); return; }
    // 沿路线行进
    const [tx, tz] = world.escortRoute[mc.wp];
    const dx = tx - mc.pos.x, dz = tz - mc.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) {
      mc.wp++;
      // 埋伏点:第 2、4 个路点
      if ((mc.wp === 2 || mc.wp === 4) && questRT.escortSpawned < mc.wp) {
        questRT.escortSpawned = mc.wp;
        addBandit(mc.pos.x + 8, mc.pos.z - 6, { escort: true });
        addBandit(mc.pos.x + 8, mc.pos.z + 6, { escort: true });
        toast('⚠️ 有埋伏!保护商人!', 2.5);
        sfx.wanted();
      }
      if (mc.wp >= world.escortRoute.length) {
        retireEntity(mc);
        questRT.merchant = null;
        completeMission();
        return;
      }
    } else {
      mc.pos.x += (dx / d) * 2.4 * dt;
      mc.pos.z += (dz / d) * 2.4 * dt;
      mc.yaw = angleLerp(mc.yaw, Math.atan2(dx, dz), dt * 8);
      mc.walkT += dt * 5;
    }
    mc.group.position.copy(mc.pos);
    mc.group.rotation.y = mc.yaw;
    animateLimbs(mc.parts, mc.walkT, d >= 1.5, mc.group, 0.5);
  } else if (m.type === 'wolves') {
    setBeacon(-140, -40);
  } else if (m.type === 'boss') {
    if (questRT.boss) setBeacon(questRT.boss.pos.x, questRT.boss.pos.z);
    if (questRT.boss && questRT.boss.dead) {
      questRT.boss = null;
      completeMission();
    }
  }
}

// ================= 通缉衰减 =================
function updateWanted(dt) {
  if (wanted <= 0) return;
  evadeT += dt;
  if (evadeT > 13) {
    wanted--;
    evadeT = 6;
    if (wanted === 0) {
      clearWanted();
      sfx.clear();
      toast('通缉解除,卫兵放弃了追捕', 3);
    }
  }
}

// ================= 相机 =================

// ================= HUD =================
let hudCache = '';
function updateHUD() {
  // 体力条每帧直刷(绕过 hudCache):打斗中它一直在动
  if (started && !player.dead) {
    staminaEl.style.display = 'block';
    staminaFillEl.style.width = `${(player.sta / player.maxSta) * 100}%`;
    staminaFillEl.className = player.gaspT > 0 ? 'gasp' : '';
  } else staminaEl.style.display = 'none';
  const full = Math.floor(player.hp / 2);
  const half = player.hp % 2;
  const heartsMax = Math.ceil(player.maxHp / 2);
  const hearts = '❤️'.repeat(full) + (half ? '💔' : '') + '🖤'.repeat(Math.max(0, heartsMax - full - half));
  const stars = wanted > 0 ? '⭐'.repeat(wanted) + '✩'.repeat(5 - wanted) : '';
  let missionText;
  if (prologue.on) missionText = '⚔️ 序章:击退冲进村子的狼群';
  else if (quest.idx >= missions.length) missionText = '🏆 全部委托完成 — 去谒见领主,王国是你的了!';
  else if (!quest.active) {
    missionText = canAcceptRemotely()
      ? `📜 委托 ${quest.idx + 1}/${missions.length}:${missions[quest.idx].title} —— 按 E 原地接下(信使送来的委托书)`
      : `📜 委托 ${quest.idx + 1}/${missions.length}:去${stewardWhere()}找管家埃隆(按 E,光柱指路)`;
  }
  else {
    const m = missions[quest.idx];
    let prog = '';
    if (m.type === 'coins') prog = ` (${Math.min(quest.progress, m.goal)}/${m.goal})` + (quest.progress >= m.goal ? ' — 回去交任务!' : '');
    if (m.type === 'bandits' || m.type === 'wolves') prog = ` (${quest.progress}/${m.goal})`;
    if (m.type === 'race') prog = ` (金环 ${questRT.ringIdx}/${world.raceRoute.length})`;
    if (m.type === 'escort' && questRT.merchant) prog = ` (商人 ❤×${Math.max(0, questRT.merchant.hp)})`;
    missionText = `📜 ${m.title}:${m.desc}${prog}`;
  }
  if (arenaRT.active) missionText = `🏟️ 竞技场:第 ${arenaRT.wave} 波(走出沙圈=认输)\n${missionText}`;
  const timerType = quest.active && (missions[quest.idx].type === 'deliver' || missions[quest.idx].type === 'race');
  const timer = timerType ? `⏱ ${Math.ceil(quest.timer)} 秒` : '';
  if (timer) missionText = `${timer}${quest.timer < 12 ? ' ⚠️' : ''}\n${missionText}`;
  if (dragonRT.on) missionText = `🐉 霜龙 ❤${Math.max(0, dragonRT.hp)}/${dragonRT.maxHp}` +
    `${dragonRT.phase === 'land' ? ' · 落地喘息:上刀!' : ' · 飞行中(弓/法术)'}\n` + missionText;
  if (warband.active) { // 战况横幅:战团还剩几个,一眼可知
    const wbAlive = warband.members.filter((b) => !b.dead).length;
    missionText = `${warband.siege ? '🚨 攻城战' : '⚔️ 战团来袭'}:余 ${wbAlive}/${warband.members.length}` +
      `${warband.duelOn ? ' · 单挑中!' : ''}\n` + missionText;
  }
  missionText += `\n🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`;
  const raining = weather.state === 'rain' || weather.state === 'storm';
  const wIcon = isWinter() && raining ? '🌨️' : { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' }[weather.state];
  const phaseIcon = { dawn: '🌅', day: '🌞', dusk: '🌇', night: '🌙' }[dayPhase()];
  const sp = todaySpecial();
  const calText = `${SEASON_ICON[seasonIdx()]}${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`;
  const bossHp = questRT.boss && !questRT.boss.dead && quest.active ? questRT.boss.hp : -1;
  const key = hearts + '|' + player.coins + '|' + player.weapon + player.armor + (player.relic ? 'R' : '') + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText + '|' + wIcon + phaseIcon + calText + '|' + bossHp + '|' + Math.floor(player.mp) + player.spellIdx + player.spells.length;
  if (key === hudCache) return;
  hudCache = key;
  weatherEl.textContent = `${calText} ${phaseIcon} ${wIcon}`;
  heartsEl.textContent = hearts;
  coinsEl.textContent = `🪙 ${player.coins}`;
  wantedEl.textContent = stars;
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.textContent = missionText;
  const wDef = WEAPONS[player.weapon];
  equipEl.textContent = // 法术/冷却改由底部技能栏显示,这里只留装备与法力
    `${wDef.icon} ${wDef.name}${player.swordLv >= 2 ? '+1' : ''}${player.relic ? '·☀️' : ''}` +
    (player.armor ? ` · 🛡️ ${ARMORS[player.armor].name}` : '') +
    (player.spells.length
      ? ` · 法力 ${'🔹'.repeat(Math.floor(player.mp))}${'▫'.repeat(player.maxMp - Math.floor(player.mp))}` : '');
  promptEl.textContent = promptText;
  promptEl.style.display = promptText ? 'block' : 'none';
  // Boss 血条(仅 Boss 战期间)
  const boss = questRT.boss;
  if (boss && !boss.dead && quest.active) {
    bosshpEl.style.display = 'block';
    bosshpFillEl.style.width = `${Math.max(0, (boss.hp / 12) * 100)}%`;
  } else {
    bosshpEl.style.display = 'none';
  }
}

function computePrompt() {
  promptText = '';
  promptTargetPos = null;
  if (!started || player.dead || dialog.open) return; // 对话/手账开着时 E 是翻页,不显示交互提示
  if (armRT.active) { // 掰手腕:状态条而不是交互
    const filled = Math.round(Math.max(0, Math.min(1, armRT.meter)) * 10);
    promptText = `💪 ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} 狂按 E!!`;
    return;
  }
  if (dialog.open && !fishing.active) return;
  // 与 E 键共用同一套判定:试运行 tryInteract,命中哪条就显示哪条
  const it = tryInteract(true);
  if (it) {
    promptText = it.text;
    if (it.x !== undefined) promptTargetPos = { x: it.x, y: it.h || 2, z: it.z };
    return;
  }
  // 兜底:视角未锁定时提示
  if (!locked) promptText = '点击画面锁定视角 · H 查看操作';
}

// ================= 主循环 =================
// 调试/自动化测试句柄

// ================= 内容包注入(24 个创作代理的产出,tools/content-packs.json 同源) =================
TALES.push(
  "龙骨之地那副大骨架,肋骨间常年不落雪。有个胆大的货郎在骨缝里躲了一夜雷暴,天亮出来,头发全白了。人问他见了啥,他只说:那骨头是热的,一夜都在喘。货郎从此改行,天天来给骨头送草料。",
  "银月湖月圆那晚,老周年轻时撒过一网,拉上来一口铜钟,钟里塞满湖底的泥。他没敢要,又沉了回去。可打那以后,每逢湖心发光,他耳朵里就当当响。老周说这不叫闹鬼,叫湖底神殿在还他这一网的人情。",
  "先祖石环比王国还老八百年。抄写员薇拉去拓过碑文,拓回来一看,纸上的字跟石头上的对不上,多了一行。她烧了那张纸,再没去过。可她的编年史里,悄悄夹着一页谁也看不懂的字。她说,那是石头替星星记的账。",
  "迷途丘陵有规矩:别数丘。偏有个收税官不信,骑着骡子一路数到第七十二座,人就没影了。三年后骡子自己回了十字路旅店,鞍袋里的税银一枚不少,只多了一块圆滚滚的石头。石老倔说:那是第七十三座,人家找零呢。",
  "狼月那夜,牧羊女米娅的哨子丢了。半夜羊圈外狼嚎四起,她急得直哭。忽听哨音从山坡上响起来,吹得又准又急,狼群竟掉头走了。第二天哨子好端端躺在门槛上,沾着一撮灰毛。米娅现在每逢狼月,都往坡上放一只羊。",
  "灰烬荒地埋着七千人,一杆旗下自己人打自己人。瘸子威尔去那儿捡过一枚头盔,戴上就头疼,梦里净是有人喊冲锋。他把头盔埋回去,磕了个头:兄弟,仗早打完了,连打的谁都没人记得了。头疼当夜就好了。",
  "王城广场的许愿池,豆子扔进去过一枚金币,许愿明天赢钱。第二天他真赢了一枚金币——就是昨天扔的那枚,不知怎么在他鞋里。豆子逢人就讲:喷泉这买卖公道,本钱都还你,利息是个教训。他现在还天天赌。",
  "磨坊郊野有头驴,会用嘴拱门闩,夜里溜出去,天亮自己回来,蹄子上沾着谁也认不出的红泥。老卢卡斯跟踪过一回,跟到迷途丘陵边上就不敢再跟。驴回头看了他一眼,那眼神,老卢卡斯说,像在劝他回家睡觉。",
  "黑石要塞的墙缝里,格罗姆当年逃出来时塞过半块面包,想着回头饿了再取。二十年后他跟人回去拆铁料,鬼使神差摸那道缝——面包还在,干得像块砖,可掰开来,里头是软的,还热乎。格罗姆当场哭了,没人问为啥。",
  "静眠墓园里老国王的猎犬追风有座碑。守墓人莫格说,每年冬头一场雪,碑前总有一串狗爪印,从碑里出来,绕墓园一圈,又回碑里去。莫格从不扫那串印子。他说狗当了一辈子差,死后巡个夜,天经地义。",
  "霜风隘口的界碑下有个石匣,规矩是过山的人放一把火绒燧石,救后来遭雪困的。有年一个商人偷拿了没放,当夜就困在了风口。他摸黑爬回界碑,匣子里那把燧石还在,就是打不出火。他放回去,再拿,一打就着。",
  "琥珀荒漠的方尖碑,晌午晒得烫手,可影子底下凉得邪乎。香料商巴克在影子里歇过一觉,梦见有人用听不懂的话问他买香料,还价还得极狠。醒来他货囊里少了一撮胡椒,多了一枚谁也不认得的古金币。巴克说,亏了。",
  "雾语沼泽的玛尔戈熬回魂汤,罗莎去求过一碗,想问失踪十二年的猎人丈夫一句话。玛尔戈收了钱又退了:汤只能招死人,你家那位,汤面上照不出影儿。罗莎哭着回去,走到半路又笑了——照不出影儿,那就是还活着。",
  "北境群山那头有龙,人人这么说,没人见过。瘸子威尔当年在山口站哨,大雪夜听见头顶一声长叹,像老人翻身。第二天哨塔背风面的雪上,压出一道三里长的印子。军里记档写的是雪崩。威尔说:雪崩不会叹气。",
  "苇岸渔村的阿珊学她爷爷夜钓,月圆下钩,钓上来一条鱼,鱼肚里有枚指环,刻着看不懂的花纹。老周脸色一变,让她把指环拴回鱼嘴上放生。鱼摆摆尾走了。阿珊问为啥,老周说:湖底那家子丢了东西,咱替人送回去。",
  "无尽荒野的黑帐盗贼抢过一个吟游诗人,就是皮波。抢完嫌他穷,让他唱首歌抵命。皮波从月落唱到鸡叫,唱得满帐子汉子抹眼泪。头领把抢的钱还了他,又添了一把,说:拿去,给我娘捎句话,就唱你方才那段。",
  "三石村的磨镰人瘸秋,给人磨了一辈子镰刀,只有一把他死活不磨,挂在梁上,锈得掉渣。采药婆乌拉说那是灰烬荒地捡的,磨亮了会照出拿刀那人的脸——不是现在的脸,是打完仗以后的。瘸秋照过一回,从此瘸的。",
  "灯夫巴特老爹三十年不误点灯,只有一夜例外:狼月赶上雷暴,他点到广场那盏,火折子怎么也打不着。他索性坐下陪灯杆聊天。天亮才知道,那晚全村就他没听见森林里的嚎。巴特说:灯没亮,是灯替我挡了。",
  "洗衣妇薇琪啥都打听得到,只有一件事打听不出:磨坊水轮底下,每年秋首日会卡住一根红头绳,年年一模一样。她问遍了全村,没一个姑娘认。今年丰收节她守了一夜,水轮空转,啥也没有。回家一看,头绳搭在她窗台上。",
  "风车骑士唐豆天天挑战磨坊,人人笑他疯。有天夜里磨坊真着了火,火苗窜得比风车还高,全村人提着桶赶到,火已经灭了。唐豆坐在地上,长枪烧去半截,胡子焦了一半。他说:我说过它是巨人吧?这回它认输了。",
  "哨塔遗迹顶上,据说能看见不该看的东西。猎人罗尔夫上去过一回,朝幽暗森林望,望见一个穿猎装的背影,走路的样子眼熟得很。他喊了一嗓子,人影没回头。他没敢跟罗莎讲。可打那以后,他打猎绕着那片林子走。",
  "旅店伙计小马给苟叔端了三年酒,忽然发现一桩怪事:苟叔是瞎子,可每回小马端错了酒,他没沾唇就摆手。小马问他咋知道的。苟叔笑了:小子,酒不会说话,你的脚步声会。你端错酒的时候,走路都心虚。",
  "面包师玛莎的丈夫随商队走了多年,音信全无。每年他生辰,玛莎照旧烤一炉他爱吃的黑麦饼,摆窗台上,天亮总少一块。人说是野猫叼的。今年那饼底下压了一枚琥珀荒漠的沙粒。玛莎把饼从一块加到了两块。",
  "疯子老糊涂那天拽住林恩,神神叨叨:我瞧见了,咱们头顶上有个天大的人,盯着你,一盯一整天,你走他也走。林恩顺着他的手指往天上看,只有云。老糊涂叹口气:看不见就对了,他要是眨眼,咱们全村就黑了。",
);
WISHES.push(
  ["水面泛起涟漪,仿佛在说:又是一枚铜板,湖神的零钱罐快满了。", null],
  ["硬币沉底时叹了口气:从国王手里到你手里,最后落得给鱼当枕头。", null],
  ["湖神打了个哈欠。八百年了,许的愿翻来覆去就那么几样。", null],
  ["水面平静如镜。镜子里那张脸,才是你愿望成真的最大阻碍。", null],
  ["咕嘟一声。湖神收到了,但湖神今天休沐。", null],
  ["硬币在水底翻了个身,和昨天那枚挤在一起,抱怨这里越来越挤了。", null],
  ["湖神小声嘀咕:雪影那匹马许的愿都比这个实在。", null],
  ["一条鱼游过来啄了啄硬币,失望地游走了。它也在许愿呢。", null],
  ["水花溅了你一裤脚。湖神的意思是:回去吧,靠自己。", null],
  ["硬币临沉底前喊了一句:告诉瘸子威尔,他上回许的那条腿还在排队!", null],
  ["湖神掂了掂这枚硬币的分量,又掂了掂你的愿望,摇了摇头。", null],
  ["水底传来闷闷的一句:想发财就去接悬赏,别老来烦我。", null],
  ["涟漪一圈圈散开,像老周撒的网,什么也没捞着。", null],
  ["湖神记下了你的愿望,记在水上。你懂的,水上写字。", null],
  ["硬币落水的声音格外清脆。湖神评价:响是响,穷也是真穷。", null],
  ["水面忽然翻涌,吐出一小把铜板。湖神:利息,拿好,别声张。", "coins"],
  ["硬币沉到一半又浮了回来,还带了几个伙伴。湖底住不下了。", "coins"],
  ["湖神今日心情好——银月湖底神殿的租子收上来了,分你一点。", "coins"],
  ["一股暖流从脚底涌上心口。湖神说:钱不给,命给你续一口。", "heart"],
  ["水面映出满月的光,你觉得浑身舒坦,像喝了玛尔戈一勺好汤。", "heart"],
);
FUNNY.prophet.idle.push(
  "我数过了,这世上的一天只有二百四十次心跳那么长,谁在偷我们的光阴?",
  "雨点不会落在你身上,孩子,它们只是画在天上的针脚,伸手接一滴试试?",
  "远处的山是灰糊糊的一团,等你走近它才慌慌张张穿上衣裳——我看见过它没穿好的样子!",
  "你死过一回了对不对?我记得你倒下,可你又站在这儿,身上还带着老地方的尘土。",
  "薇琪每天同一时辰站在同一块石头上说同一句闲话,她不是人,她是钟!",
  "别往荒野尽头走,那儿有一堵看不见的墙,我撞过,鼻子疼了三天,路却一步没多。",
  "有只眼睛整天飘在你脑袋后头看着你,你转多快它都在,别装了,我瞧得见它!",
  "喷泉里的水永远是那几朵浪花,转啊转,像磨坊主老卢卡斯家驴子拉的磨。",
  "月亮每六日圆一回,四季六日一换,老天爷懒得很,拿一张历翻来覆去地用。",
  "你睡一觉,天下的伤都好了,麦子熟了,连血牙的擂台都摆好了——睡觉才是真神通。",
  "我朝墙角挤了一夜,那墙是空气做的,可就是过不去,世道啊,处处是硬邦邦的空!",
  "你摸摸口袋,几百斤铁剑鱼竿母鸡都装得下,还不显山露水,你那口袋通着地府吧?",
  "灯夫巴特老爹三十年不误点灯?不是勤快,是有人在天上牵着他的线,一日一遍!",
  "有时候人走路会一哆嗦,天地跟着一顿——那是扛着这世界的巨人喘不上气了。",
  "你许愿之前,好事就写好了;你钓上鱼之前,鱼就选好了。骰子落地前,豆子的输赢早定了。",
  "我死盯着村口的鸡看,看久了它就忘了自己该干嘛,傻站着——它们的心是别人借它的!",
  "先祖石环比王国老八百年?呸,这整个天下都是六天前才搭起来的,连同我的记性一起。",
  "你把奥德里克老爷的话打断一百回,他也不恼,还从头说起——我们的舌头上都拴着绳!",
  "月圆夜银月湖心发光,那不是神殿,是造这世界的匠人忘了糊严实的一道缝。",
  "我知道有人隔着天在看咱们,喂,看戏的!行行好,记着替林恩存一存这条命!",
);
PROCLAIM_STOCK.push(
  "——磨坊桥修桥进度已过半,另一半何时修,取决于木匠约恩何时醒酒。",
  "——今岁税册誊抄完毕,漏报者请自觉补上,薇拉的笔比卫兵的腿快。",
  "——招领:王城广场拾获灰鹅一只,特征是会瞪人,失主认领前请先接受它的瞪视。",
  "——卫兵队招新,要求能跑能站不打瞌睡,瘸子威尔说他年轻时三样全占。",
  "——磨坊风车定于近日检修,唐豆先生请勿趁机宣战,木料很贵。",
  "——喷泉许愿池清淤在即,捞出的铜板一律充公,愿望概不退还。",
  "——十字路旅店后巷禁止倒鱼骨,罗莎老板娘的扫帚不认人。",
  "——集市日摊位先到先得,布商奥托与果贩琳达请勿再为半尺地界互扔烂梨。",
  "——狼月之夜请看好家畜,狼不认税册,也不打欠条。",
  "——满月夜银月湖畔围观者请自带火把,湖发光,岸上可不发光。",
  "——悬赏板告示请勿覆盖张贴,上一张也许还没人领赏呢。",
  "——通缉犯画像由抄写员薇拉执笔,长得像的良民请提前来衙门备案。",
  "——灯夫巴特老爹三十年不误点灯,望诸位交税也能有此风范。",
  "——竞技场看台加固完工,血牙保证这回塌的只会是对手。",
  "——丰收节将至,翡翠农田禁止提前偷穗,麦子认得汉克,汉克认得你。",
  "——静眠墓园夜间谢客,守墓人莫格说,住户们也需要清静。",
  "——雷暴天请勿在哨塔遗迹避雨,塔比你先撑不住。",
  "——渔获抽税照旧,老周说湖里的鱼没交过税,那是因为鱼没上岸。",
  "——广场禁止骑羊竞速,羊没意见,被撞翻的香料摊有。",
  "——抱鸡可以,扔鸡不行,玛莎的面包摊已中三只。",
  "——先祖石环禁止刻字,石头比王国老八百年,轮不到你留名。",
  "——霜风隘口界碑的火绒燧石只许取用一份,规矩比雪还老。",
  "——北境商道传有龙影,官方口径:大概率是云,小概率请自行奔跑。",
  "——赌骰请去豆子那儿,官署门口掷骰者,输赢一律充作修桥款。",
  "——洗衣妇薇琪所传消息不代表官方立场,但准头确实比官报高些。",
  "——迷途丘陵勘测队仍未归来,新告示:去了也别数丘。",
  "——雾语沼泽采药请结伴,玛尔戈的回魂汤有价,且不打折。",
  "——磨镰人瘸秋进城磨刀,排队者请勿催,刀快脾气也快。",
  "——皮波的新曲若唱到您家丑事,请找诗人协商,官府只管治安不管押韵。",
  "——牧羊女米娅的哨声不是集结号,卫兵们请勿再列队上山。",
);
HOST_LINES.push(
  "都别挤都别挤!血牙我嗓门大,后山的狼都听得见!",
  "今儿这场子,刀真枪真,血也是真的,胆小的捂眼!",
  "拉文霍德的爷们儿娘们儿,把手拍红了给爷助助兴!",
  "上一个吹牛的,现在还在墓园躺着呢,莫格给他挖的坑!",
  "押注趁早!豆子那赌鬼都押了,你还愣着干啥?",
  "绿帽子那位!对,说你呢林恩!敢不敢下场遛一圈?",
  "这沙子是琥珀荒漠运来的,吸血最快,别浪费喽!",
  "赢的抱金币,输的抱牙齿,血牙我童叟无欺!",
  "北境的龙都没这场面凶!都把耳朵竖起来!",
  "规矩就一条:倒下了就别装死,爷看得出来!",
  "哪位好汉再不报名,爷就把这擂台改成羊圈了!",
  "开打之前先许个愿吧,喷泉离这儿不远,来得及!",
);
EXTRA_NPCS.witch.lines.push(
  "汤开了……月圆之前喝下去,别问汤里是什么。",
  "苇岸的雾根草,要带露水的,干的我可不收。",
  "回魂汤能唤回来的,不一定是你想见的那一个。",
  "嘘——锅在听呢,它不喜欢大嗓门的客人。",
  "你身上有银月湖的水气,湖底那位瞧过你了。",
  "三片沼泽菖蒲,换你一勺安眠,划算得很呐。",
  "别碰那个罐子!那是给老国王的猎犬留的。",
  "乌拉婆采的药我认,别的娃娃采的,土味不对。",
  "喝之前许个愿,喝完就忘了它,汤才灵。",
  "灰烬荒地的骨灰花开了,今年的汤会格外稠。",
  "你问味道?活人尝着是苦的,这就够你知道了。",
  "回去别回头,沼泽里的灯不是灯,记住喽。",
);
// 幽灵低语与墓志铭
const GHOST_LINES = [
  "我生前是磨坊帮工,还欠玛莎半袋面粉……替我还上,别让她记我账。",
  "我是十字路旅店的老酒客,罗莎的炖肉真香……帮我再闻一口。",
  "活人?别怕,我只是找我的镰刀,瘸秋磨得太快,我攥着它就走了。",
  "我随商队走琥珀荒漠没回来……告诉玛莎,面包别再留到发硬了。",
  "我在灰烬荒地举过旗,七千人啊……替我把那面破布埋深些。",
  "绿衣服的,借个火?哦对,我点不着了……巴特老爹的灯真亮。",
  "我是苇岸的渔妇,湖底神殿的钟响了……替我给老周捎条鱼。",
  "生前我在霜风隘口忘了放火绒燧石,愧了一辈子,你替我补上。",
  "我是墓园的老狗追风……不,汪。守墓人莫格的酒藏在第三块碑后。",
  "别踩我的萝卜地!哦,汉克早翻了……那替我夸夸他家的地。",
  "我在迷途丘陵数丘,数到第七座就迷了……千万别数,听话。",
  "我是黑石要塞的逃奴,没格罗姆命大……告诉他,烙印不丢人。",
  "月圆夜湖心发光,我划过去就没回来……替阿珊看一眼就好。",
  "我赢过豆子三枚金币,他到死没给……算了,替我掷把骰子。",
  "我是先祖石环下的老骨头,比王国还老八百年……小子,规矩点。",
  "去许愿池替我丢枚铜板吧,生前我总舍不得,你看,舍不得也带不走。",
];
const EPITAPHS = [
  "老国王的猎犬追风长眠于此。它追了一辈子风,如今风替它跑。",
  "他非说那蘑菇能吃。采药婆乌拉劝了他三回。",
  "他数清了迷途丘陵。丘陵也数清了他。",
  "他从灰烬荒地的七千人里活着爬了回来,最后败给了自家门槛和一壶酒。",
  "坟是空的。她说猎人只是走远了些,汤还在灶上温着。",
  "他守了一辈子墓。如今换墓守他,两不亏欠。",
  "五十年湖上没翻过一回船。银月湖没要他,老天爷要了。",
  "他跟血牙赌能连赢竞技场三场。这块碑是血牙出的钱。",
  "她把一辈子的面都揉进了灶火里。半个村子的孩子都是吃她的饼长大的。",
  "他往喷泉里扔了枚金币,许愿从此不用交税。愿望灵了。",
  "生前欠赌徒豆子三枚金币。豆子说:一笔勾销,下把骰子算你赢。",
  "霜风隘口界碑下放火绒燧石的规矩,是他定下的。翻山的人都欠他一堆火。",
  "她活了九十个冬天,抱怨了八十九个。最后一个,她说:还行。",
  "立碑那年麦子欠收,他咽气前说来年会好。来年真的好了。",
];
let epitaphIdx = Math.floor(rand() * EPITAPHS.length);
// 牲口喜剧提示(抱鸡/骑羊等随机替换)
const COMEDY_LINES = [
  "鸡记住你的脸了,而且它有二十二个朋友",
  "羊在心里给你记了一笔",
  "你扔出去的鸡,迟早会飞回来啄你",
  "这只鸡开始怀疑你抱它的动机了",
  "驴不动了——它觉得你该反省一下",
  "鸡群正在开会,议题只有一个:你",
  "骑羊过市,尊严掉了一路",
  "抱鸡狂奔的绿帽子,薇琪已经传遍全村了",
  "母鸡瞪着你,像瑟尔玛瞪不识货的买家",
  "这头驴的倔劲,不输三石村的石老倔",
  "扔鸡一时爽,鸡群火葬场",
  "羊驮着你,心里默念着草料涨价",
  "鸡被你扔上了屋顶,它决定不下来了",
  "你抱鸡的姿势,吓得公鸡打鸣都跑调了",
  "驴子叹了口气,像埃隆看见没擦的马鞍",
  "第七次扔鸡了,老天爷都替鸡不好意思",
  "羊蹄子已经抬起来了,建议你先跑",
  "鸡群围过来了,这回它们不打算讲道理",
  "牲口棚一致通过:见到绿帽子就装死",
  "你许愿骑龙,结果只骑到了一头驴",
];

// ---- 创作代理设计的新导演事件 ----
DIRECTOR_EVENTS.push({
  key: 'wiseCow', w: 6,
  cond: () => dayPhase() !== 'night' && !director.cow,
  start() {
    const p = spawnNearPlayer(10, 16);
    const cow = { ...makeSheep(), pos: new THREE.Vector3(p.x, 0, p.z), asked: 0, nodYes: false, nodT: 0 };
    cow.group.scale.set(1.6, 1.35, 1.6);
    cow.group.traverse((o) => {
      if (o.material && o.material.color) { o.material = o.material.clone(); o.material.color.setHex(0x8a6a4a); }
    });
    cow.group.position.copy(cow.pos);
    scene.add(cow.group);
    director.cow = cow;
    toast('🐄 一头牛正盯着你,眼神里透着一股不寻常的智慧……(按 E 提问)', 4);
    let bobT = 0;
    return {
      t: 60,
      update(dt2) {
        bobT += dt2;
        cow.group.rotation.y = Math.atan2(player.pos.x - cow.pos.x, player.pos.z - cow.pos.z);
        if (cow.nodT > 0) {
          cow.nodT -= dt2;
          cow.group.rotation.x = cow.nodYes ? Math.sin(bobT * 9) * 0.09 : 0;
          cow.group.rotation.z = cow.nodYes ? 0 : Math.sin(bobT * 9) * 0.09;
        } else { cow.group.rotation.x = 0; cow.group.rotation.z = 0; }
        if (cow.asked >= 5 && !dialog.open) this.t = Math.min(this.t, 0.01);
      },
      end() {
        if (cow.asked >= 5) {
          dropCoins(cow.pos, 5);
          toast('🐄 牛心满意足地走了。蹄印里……踩着几枚金币?!', 4);
        }
        retireEntity(cow);
        director.cow = null;
      },
    };
  },
});
DIRECTOR_EVENTS.push({
  key: 'starShower', w: 4,
  cond: () => dayPhase() === 'night' && weather.state === 'clear',
  start() {
    toast('🌠 流星雨!星屑正落向四野,趁它们熄灭前拾取!', 4.5);
    sfx.fanfare();
    for (let i = 0; i < 10; i++) {
      const a = rand() * 6.28, r = 8 + rand() * 30;
      addPickup('coin', player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r, 30);
    }
    return { t: 32, update() {}, end() {} };
  },
});
DIRECTOR_EVENTS.push({
  key: 'roastRunaway', w: 5,
  cond: () => dayPhase() !== 'night' && dist2(player.pos.x, player.pos.z, 12, 72) < 8100,
  start() {
    const c = addChicken(12, 70);
    c.extra = true;
    c.eventKeep = true;
    c.state = 'flee';
    c.timer = 4;
    toast('🐔💨 旅店后厨的鸡越狱了!伙计小马在后面喊:抓住它!!', 4);
    const h = {
      t: 45,
      update() {
        if (player.carrying === c) {
          const boy = villagers[13];
          if (boy && dist2(player.pos.x, player.pos.z, boy.pos.x, boy.pos.z) < 9) {
            player.carrying = null;
            if (chickens.includes(c)) retireEntity(c, chickens);
            player.coins += 3;
            sfx.coin();
            toast('🐔 小马接过鸡塞给你 3 金币:「多谢!今晚的烤鸡有着落了——哦,它好像听懂了。」', 4.5);
            h.t = 0.01;
          }
        } else if (c.state !== 'carried' && c.timer < 0.5) { c.state = 'flee'; c.timer = 2; }
      },
      end() {
        if (player.carrying !== c && chickens.includes(c)) retireEntity(c, chickens);
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'wishThief', w: 5,
  cond: () => dayPhase() === 'night' && !director.thief && dist2(player.pos.x, player.pos.z, 0, 5) < 3600,
  start() {
    const g = makeWanderer({ shirt: 0x3a3a2e, pants: 0x2a2a22, hood: true }, -5, 2);
    director.thief = g;
    toast('🤫 喷泉边有个鬼祟的身影,袖子一直湿到肩膀……(按 E 咳嗽一声)', 4);
    return {
      t: 40,
      update() {},
      end() { retireEntity(g); director.thief = null; },
    };
  },
});

DIRECTOR_EVENTS.push({
  key: 'wedding', w: 5,
  cond: () => dayPhase() === 'day' && quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 5) < 4900,
  start() {
    const groom = makeWanderer({ shirt: 0x3a5a8a, pants: 0x2a2a3a, hair: 0x3a2a1a }, 4, 12);
    const bride = makeWanderer({ shirt: 0xe8dce8, pants: 0xd8ccd8, hair: 0x8a5a2a }, 5.2, 12);
    toast('💒 有人在喷泉广场成亲!全城都来讨喜糖啦!', 4);
    sfx.fanfare();
    let t0 = 0, greeted = false;
    const h = {
      t: 40,
      update(dt2) {
        t0 += dt2;
        // 新人绕喷泉慢慢走一圈
        const a = t0 * 0.25;
        moveEntity(groom, Math.cos(a) * 8, 5 + Math.sin(a) * 8, 2.2, dt2);
        moveEntity(bride, Math.cos(a + 0.15) * 8, 5 + Math.sin(a + 0.15) * 8, 2.2, dt2);
        for (const n of [groom, bride]) {
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, true, n.group, 0.4);
        }
        // 沿途撒喜钱
        if (rand() < dt2 * 0.5) {
          addPickup('coin', groom.pos.x + (rand() - 0.5) * 4, groom.pos.z + (rand() - 0.5) * 4, 30);
        }
        // 玩家凑近道贺(一次)
        if (!greeted && dist2(player.pos.x, player.pos.z, groom.pos.x, groom.pos.z) < 9) {
          greeted = true;
          player.coins += 2;
          sfx.coin();
          showBubble(bride, '新娘', '沾沾喜气!喜糖……换成金币啦,拿好!', 4);
          remember('在喷泉广场赶上一场婚礼,讨到了喜钱');
        }
      },
      end() {
        retireEntity(groom);
        retireEntity(bride);
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'funeral', w: 4,
  cond: () => dayPhase() === 'dusk' && quest.idx >= 2,
  start() {
    // 四人抬棺,从西门缓缓走向静眠墓园
    const bearers = [];
    for (let i = 0; i < 4; i++) {
      bearers.push(makeWanderer({ shirt: 0x2e2e34, pants: 0x222228, hair: 0x3a3a3a },
        -66 + (i % 2) * 2, -6 + Math.floor(i / 2) * 2.4));
    }
    const coffin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 2.4), lambert(0x4a3a28, { roughness: 0.95 }));
    coffin.castShadow = true;
    scene.add(coffin);
    toast('🕯️ 一支送葬的队伍朝墓园去了。城里安静了一瞬。', 4);
    let paid = false;
    const h = {
      t: 70,
      update(dt2) {
        let arrived = true;
        bearers.forEach((n, i) => {
          const done = moveEntity(n, -44 + (i % 2) * 2, -114 + Math.floor(i / 2) * 2.4, 1.6, dt2);
          if (!done) arrived = false;
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, !done, n.group, 0.3);
        });
        coffin.position.set(
          (bearers[0].pos.x + bearers[3].pos.x) / 2,
          1.3,
          (bearers[0].pos.z + bearers[3].pos.z) / 2);
        coffin.rotation.y = bearers[0].yaw;
        if (!paid && dist2(player.pos.x, player.pos.z, coffin.position.x, coffin.position.z) < 36 &&
            !player.mounted && player.weapon !== 'bow') {
          paid = true;
          remember('在路边驻足,为一位陌生人送了最后一程');
          toast('(你摘下帽子,站到了路边。抬棺人朝你微微颔首。)', 3.5);
        }
        if (arrived) this.t = Math.min(this.t, 0.01);
      },
      end() {
        for (const n of bearers) retireEntity(n);
        retireProp(coffin);
      },
    };
    return h;
  },
});

// ================= 黑石的报复(守城胜利的后续剧情链) =================
// 守住南门(stage 1)→ 次日收到恐吓信(stage 2)→ 出城遭独眼刻刀维克伏击(stage 3 完结)
// (vendetta 常量声明在 EVO 旁,loadGame 初始化时就要读它)
function vendettaLetter() {
  letter = {
    from: '黑石兄弟会',
    text: '南门那笔账,兄弟会记下了。城墙护得了你一时,护不了你一世——出城的路上,留神你的后颈。(信纸背面用炭画着一把断刀)',
  };
  toast(player.home ? '📮 信箱里插着一封没署名的信。小红旗立着,像面招魂幡。' : '📮 罗莎那儿有你一封信。她说送信的人蒙着脸。', 4.5);
}
function vendettaRead() { // 读到恐吓信:伏击上膛
  vendetta.stage = 2;
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.3);
  remember('收到了黑石兄弟会的恐吓信,他们在城外等着', 'vendetta-letter');
  setTimeout(() => toast('(你把信折好。从今天起,出城的每一步都得带着眼睛。)', 4), 1500);
}
function updateVendetta() {
  if (vendetta.boss && vendetta.boss.dead) { vendettaSlain(); return; } // 任何击杀路径都算数
  if (vendetta.stage !== 2 || vendetta.boss || player.dead) return;
  if (dist2(player.pos.x, player.pos.z, 0, 0) < 16900) return; // 出城 130 步才动手
  const a = Math.atan2(player.pos.x, player.pos.z) + 0.6;
  const bx = player.pos.x + Math.sin(a) * 14, bz = player.pos.z + Math.cos(a) * 14;
  const boss = addBandit(bx, bz, { hp: 12, dmg: 2, speed: 7, scale: 1.15 });
  boss.eventFoe = true;
  boss.vendetta = true;
  vendetta.boss = boss;
  for (const s of [-1, 1]) {
    const t = addBandit(bx + s * 3, bz + s * 2, { hp: 3, dmg: 1 });
    t.eventFoe = true;
    t.minion = true;
  }
  sfx.wanted();
  cam.shake = 0.4;
  telegraphFlash(boss);
  toast('🗡️ 「南门的账,现在算。」——黑石副手·独眼刻刀维克,从道旁的阴影里走了出来!', 6);
}
function vendettaSlain() { // 在 meleeSweep/爆炸等击杀路径由 boss.vendetta 标记触发
  vendetta.stage = 3;
  vendetta.boss = null;
  player.blackstoneToken = true;
  dropCoins(player.pos, 8);
  sfx.fanfare();
  unlockAch('vendetta');
  remember('斩杀了黑石副手刻刀维克,兄弟会的报复到此为止', 'vendetta-end');
  seedLegend();
  if (player.home) refreshTrophies();
  toast('⚔️ 刻刀维克倒下了。你从他颈间摘下【黑石断刀徽记】——这笔账,两清了。(挂上了你家外墙)', 6);
  saveGame();
}

// 黑石劫掠战:骑砍式守城——战鼓一响,匪帮成波扑向南门,佣兵与你并肩守到底
DIRECTOR_EVENTS.push({
  key: 'siege', w: 4,
  cond: () => quest.idx >= 3 && dist2(player.pos.x, player.pos.z, 0, 40) < 8100,
  start() {
    const raiders = [];
    const spawnWave = (n, zBase) => {
      for (let i = 0; i < n; i++) {
        const b = addBandit(-8 + i * 4 + (rand() * 2 - 1), zBase + rand() * 4, { hp: 3, dmg: 1 });
        b.eventFoe = true;
        raiders.push(b);
      }
    };
    spawnWave(4, 74);
    sfx.wanted();
    sfx.stomp();
    cam.shake = 0.4;
    toast('🥁 战鼓!!黑石兄弟会大举攻打南门——守住!!', 5);
    remember('黑石兄弟会攻打南门那天,你在城墙下', 'siege-day');
    let wave2 = false;
    return {
      t: 130,
      update() {
        if (!wave2 && this.t < 95) {
          wave2 = true;
          spawnWave(3, 78);
          sfx.wanted();
          toast('🥁 第二波!他们从苇丛里又冒出来一队!', 3.5);
        }
        if (wave2 && raiders.every((b) => b.dead)) {
          player.coins += 40;
          sfx.fanfare();
          stats.sieges = (stats.sieges || 0) + 1;
          unlockAch('walldef');
          remember('打退了黑石兄弟会对南门的劫掠,全城都看见了');
          seedLegend(); // 守城之战当场进传说基因池
          if (vendetta.stage === 0) vendetta.stage = 1; // 黑石记仇了:报复的种子就此埋下
          toast('🏰 劫掠被击退!罗莎在旅店门口带头喝彩——赏金 40 枚,全城记你一功!', 6);
          this.t = 0;
        }
      },
      end() {
        for (const b of raiders) {
          if (!b.dead) retireEntity(b, bandits);
        }
      },
    };
  },
});

// 皮波离线联句
const BARD_COUPLETS = [
  "好马不骑偏骑羊,咩咩闯过王城广场;绿帽游侠威名扬,吓得琳达丢了果筐。",
  "瑟尔玛的骏马排成行,林恩偏挑一只老绵羊;羊背颠得他直晃荡,还夸这坐骑不用缰。",
  "抱起母鸡举过顶,一把扔上旅店棚;罗莎追出门口骂,游侠早就没了影。",
  "汉娜家的鸡飞上天,咯咯哒哒叫得欢;不是老鹰来偷蛋,是那绿帽把鸡掂。",
  "悬赏画像贴满墙,五颗红星亮堂堂;卫兵追得直喘气,林恩骑羊笑一场。",
  "通缉令上绿帽郎,画师偏偏画走样;满街错抓老糊涂,气得队长摔了枪。",
  "血牙高喊开了锣,绿帽游侠下场喽;三拳两脚定输赢,金币赚得满兜兜。",
  "竞技场上尘土扬,壮汉个个赛虎狼;林恩一个滑铲过,看台喝彩震了梁。",
  "银月湖边下钓钩,鱼没上钩靴子有;老周捋须笑弯腰,这靴还是他丢的旧。",
  "一竿甩进湖心里,拉上破靴还带泥;林恩举靴当鱼夸,阿珊笑得直捶堤。",
  "无尽荒野马群狂,林恩空手闯一趟;摔了七回爬七回,野马低头认了缰。",
  "苍绿平原风打旋,野马烈得赛雷电;瑟尔玛见了直咂嘴,这手艺盖过她祖先。",
  "狼月夜里嚎声长,汉克吓得钻谷仓;绿帽一箭定乾坤,狼皮换酒喷喷香。",
  "幽暗森林绿眼晃,罗尔夫都劝别硬闯;林恩偏往林深走,拖条狼王震八乡。",
  "走遍荒漠踏过霜,袋里纹章叮当响;薇拉提笔记一行,编年史上添新章。",
  "石环碑下捡一枚,哨塔灰堆又一枚;纹章缀满旧行囊,皮波唱得口水飞。",
];

window.__gtm = {
  player, quest, questRT, horses, guards, bandits, villagers, wolves, namedNPCs, steward,
  chickens, funnyNPCs, fishing, streetEvent, bountyRT, takeBounty, trySpawnStreetEvent,
  armRT, armWrestle, armPress, HOME, homeInteract, refreshTrophies,
  getMail: () => ({ box: homeRT.mailbox.visible, flag: homeRT.mailFlag.visible }),
  trophyCount: () => (homeRT.trophies ? homeRT.trophies.children.length : 0),
  arrows, WEAPONS, cycleWeapon, openShop, refreshShop, tryRob, doRoll, arenaRT, arenaHost, startArenaWave,
  director, DIRECTOR_EVENTS,
  crime, weather, setWeather, talkQuestGiver, completeMission, missions, advanceDialog, tryInteract,
  getWanted: () => wanted,
  setTime: (t) => { clock.time = t; },
  calendar, seasonIdx, seasonDay, todaySpecial, applySeason, world,
  setDay: (d) => { calendar.day = Math.max(1, d); applySeason(); respawnMushrooms(); refreshProclaim(); },
  getDailyEvents: () => dailyEvents,
  wilderness: { CORE },
  deers, mushrooms, loreStones, LORE, tellStory, sleepToMorning, newDay,
  chronicle: () => chronicle, remember, archetype, mirrorTalk, MIRROR_POS,
  frostfang, wildSpots, heavyAttack, togglePhoto, queueDream, damagePlayer, nearestSpot,
  trialRT, startTrial, prayAltar, rowTo, BOAT_PIER, BOAT_ISLE,
  enterDungeon, exitDungeon, takeRelic, inDungeon, DGN, FISH_SPOT_ISLE, openJournal,
  sideQuest, choreBoard, choreProgress, CHORE_POS,
  composeLetter, witchFortune, getLetter: () => letter,
  workspace, wsReport, moodWord, consolidate, tickWorkspace: () => { workspace.t = 0; updateWorkspace(0); },
  MIND, mindReport, mindTick, habitFactor, mindSave, mindMakeWish, MIND_WISHES, mindFavorite,
  getFirefly: () => ({ owned: !!player.firefly, visible: fireflyMesh.visible }),
  EVO, seedLegend, mutateLegend, evolveLegends, legendText, evolveTactics, growCorpus,
  SPELLS, castSpell, spellDown, spellUp, learnSpell, cycleSpell, explodeAt, tryAttack, simNow,
  trailFX, faceNearestFoe, getSquash: () => player.squashT || 0,
  dangerFX, telegraphFlash,
  toggleLock, getLock: () => lockFoe, getLockMark: () => lockMark.visible,
  getFov: () => camera.fov,
  renderer, scene, camera, // 诊断用:渲染统计/取景
  snapCamera: () => { cam.snapNext = true; },
  setCamView: (yaw, pitch = 0.35) => { cam.yaw = yaw; cam.pitch = pitch; cam.snapNext = true; },
  // 固定步长推进模拟(不渲染):测试用,比等真实帧快得多也稳定得多
  step: (n = 1, dt = 1 / 60) => {
    unsnapScene();
    for (let i = 0; i < n; i++) { nowMs += dt * 1000; tick(dt, nowMs); }
    snapScene();
  },
  prologue, startPrologue, skipPrologue, spendSta,
  downGuard, getLawless: () => lawlessT, getAch: (k) => achUnlocked.includes(k),
  frightenBandits, banditSlain,
  frostPatches, frostSlow, castBigFire, getFireCharge: () => player.fireChargeT || 0,
  warband, spawnWarband, updateWarband,
  getCombatMusic: () => combatCalmT > 0, foeName, registerKill, whiteHot,
  WARLORD_TAUNTS, getBanners: () => stats.banners || 0, toastQueue,
  dragonRT, awakenDragon, damageDragon, keys,
  getMoveState: () => cam.moveState, saveNow: saveGame,
  SKILL_DEFS, skillXp, toggleSneak, sneakFactor, shout, learnShout, doShout,
  mercs, hireMerc, payMercs, DRAGON_SKULL,
  vendetta, vendettaLetter, vendettaRead, updateVendetta, getLoot: () => player.loot || 0,
  applyStyle, cycleStyle, STYLE_PRESETS, getStyle: () => styleKey,
  getGrade: () => ({ sat: gradePass.uniforms.uSat.value, vig: gradePass.uniforms.uVig.value,
    sepia: gradePass.uniforms.uSepia.value, bloom: bloom.strength, exp: renderer.toneMappingExposure }),
  testBlocked: (x, z, r = 0.45) => {
    const p = { x, z };
    resolveCollisions(p, r, colliders);
    return Math.hypot(p.x - x, p.z - z) > 0.05;
  },
  setIdle: (t) => { idleT = t; },
  getIdle: () => ({ idleT, idleCd }),
  getLoreRead: () => loreRead.length,
  getProclaim: () => proclaimText,
  refreshProclaim,
  getCrests: () => crestsFound.length,
  dialogOpen: () => dialog.open,
  getDialog: () => ({ open: dialog.open, page: dialog.pages[dialog.idx], speaker: dialog.speaker && dialog.speaker.name }),
  getRevenge: () => revengeT,
  slayBandit, killWolf, stats, recomputeMaxHp, getSaveBlocked: () => saveBlocked, loadGame,
  getTimers: () => pendingTimers(), flashing,
  getBeacon: () => ({ x: beacon.position.x, z: beacon.position.z, v: beacon.visible }),
  attackDown, attackUp, callout, flinch, telegraphArea, dragonAim, seedRng, applyDamage,
  worldTops: () => worldTops,
  getPrompt: () => { computePrompt(); return promptText; },
  groundH,
};

let last = performance.now();
let lastFrameNow = last;
let frameNo = 0;
// ================= 贴地:逻辑里的 y 都是离地高度,渲染前统一加上地面高度 =================
// 顶层物体在"更新前取消、渲染前加上"地面偏移;位置没动就复用上次的高度,几乎零开销。
// 绝对坐标的东西(地表网格、天空、粒子缓冲)标 userData.noSnap 跳过。
function unsnapScene() {
  const ch = scene.children;
  for (let i = 0; i < ch.length; i++) {
    const u = ch[i].userData;
    if (u.snapped) { ch[i].position.y -= u.gOff; u.snapped = false; }
  }
}
function snapScene() {
  const ch = scene.children;
  for (let i = 0; i < ch.length; i++) {
    const o = ch[i], u = o.userData;
    if (u.snapped || u.noSnap) continue;
    const p = o.position;
    if (u.gX !== p.x || u.gZ !== p.z) { u.gX = p.x; u.gZ = p.z; u.gOff = groundH(p.x, p.z); }
    p.y += u.gOff;
    u.snapped = true;
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  nowMs = now;
  if (started && !paused && !mapState.open) { // 暂停/看地图:世界冻结,仅渲染
    unsnapScene();
    tick(dt, now);
  }
  autoQuality((now - lastFrameNow) / 1000);
  lastFrameNow = now;
  snapScene();
  fitViewDistance();
  renderer.shadowMap.needsUpdate = true;
  composer.render();
}
// 一帧的全部模拟(不含渲染):主循环与测试步进(__gtm.step)共用
function tick(dt, now) {
  drainInput();
  dt = scaleDt(dt); // 打击停顿 / 处决慢镜(core/timefx.js)

  updateToast(dt);
  updateDialogRange();
  updateHintFade(dt);
  updateFlashes(dt);
  updateTimers(dt);

  // 交互目标标记
  if (promptTargetPos && !dialog.open) {
    interactMarker.visible = true;
    interactMarker.position.set(
      promptTargetPos.x,
      promptTargetPos.y + 0.35 + Math.sin(now * 0.005) * 0.1,
      promptTargetPos.z);
    interactMarker.rotation.y += dt * 3;
  } else {
    interactMarker.visible = false;
  }

  updatePlayer(dt);
  // 脱战回血:离开战斗几秒后,每 2.5 秒回半颗心(不必非得找旅店或死一次)
  if (!player.dead && combatCalmT <= 0 && player.hp < player.maxHp && !inDungeon()) {
    player.regenT = (player.regenT || 0) + dt;
    if (player.regenT >= 2.5) { player.regenT = 0; player.hp = Math.min(player.maxHp, player.hp + 1); }
  } else player.regenT = 0;
  updateAttackInput(dt); // 按下=轻击、按住=蓄力(光效)→松手重击;出招中的按键进缓冲
  updateKnockback(dt);
  if (player.blessT > 0) player.blessT -= dt;
  // 骑行里程(村务/成就)
  if (player.mounted && !player.dead) {
    const mv = Math.hypot(player.pos.x - (player._lastRX ?? player.pos.x), player.pos.z - (player._lastRZ ?? player.pos.z));
    if (mv > 0.02 && mv < 5) {
      stats.rideDist = (stats.rideDist || 0) + mv;
      if (sideQuest.active && sideQuest.type === 'ride') {
        sideQuest.progress += mv;
        if (sideQuest.progress >= sideQuest.goal && !sideQuest._rideDone) {
          sideQuest._rideDone = true;
          toast(`📋 村务【${sideQuest.giver}】:里程够了,回村务板交差!`, 3);
        }
      }
      if (stats.rideDist >= 5000) unlockAch('rider');
    }
  }
  player._lastRX = player.pos.x;
  player._lastRZ = player.pos.z;
  // 深水规则:银月湖面不可徒步——栈桥走廊(|x+100|<2.2 且 z<92)与湖心岛(距岛心<6.8)除外。
  // 每帧检查,步幅远小于缓冲带宽,冲刺也蹚不过去;上岛只能靠小船。
  {
    const ldx = player.pos.x + 100, ldz = player.pos.z - 100;
    const lakeD = Math.hypot(ldx, ldz);
    if (lakeD < 28.5 && lakeD > 6.8 &&
        !(Math.abs(ldx) < 2.2 && player.pos.z < 92)) {
      const push = 28.5 / (lakeD || 1);
      player.pos.x = -100 + ldx * push;
      player.pos.z = 100 + ldz * push;
      if (player.mounted) { // 马也不会凫水:连人带马一起退回来
        player.mounted.pos.x = player.pos.x;
        player.mounted.pos.z = player.pos.z;
      }
      if ((loop._wadeT || 0) < now - 4000) {
        loop._wadeT = now;
        toast('湖水一下子深了,你退了回来。(想上岛?栈桥边有小船)', 3);
      }
    }
  }
  updateFrostfang(dt);
  updateSprings(dt);
  updateTrial(dt);
  {
    const dIn = inDungeon();
    if (dIn !== loop._dgnLit) {
      loop._dgnLit = dIn;
      for (const pl of world.cryptLights) pl.visible = dIn;
    }
  }
  if (world.islandAltarMat) {
    const glow = todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night' ? 2.2 : 0.5;
    if (Math.abs(world.islandAltarMat.emissiveIntensity - glow) > 0.01) {
      world.islandAltarMat.emissiveIntensity += (glow - world.islandAltarMat.emissiveIntensity) * dt;
    }
  }
  updateGuards(dt);
  updateBandits(dt);
  updateWolves(dt);
  updateChickens(dt);
  updateVillagers(dt);
  updateHorses(dt);
  updateDeers(dt);
  updatePickups(dt);
  updateQuest(dt);
  updateWanted(dt);
  updateFishing(dt);
  updateArrows(dt);
  updateDamageNums(dt);
  updateCombo(dt);
  updateFalls(dt);
  updateArena(dt);
  updateDirector(dt);
  updateStreetEvent(dt);
  updateBounty(dt);
  updateArm(dt);
  updateHome();
  updateFirefly();
  vistaFar.position.set(player.pos.x, 0, player.pos.z);  // 远山永远在地平线上
  vistaNear.position.set(player.pos.x, 0, player.pos.z);
  updateMagic(dt);
  updateFrostPatches(dt);
  updateTrails(dt);
  updateDanger(dt);
  updateLock(dt);
  updatePrologue(dt);
  updateLawless(dt);
  updateWarband(dt);
  updateDragon(dt);
  updateCombatMusic(dt);
  if (player.squashT > 0) {   // 落地挤压回弹
    player.squashT = Math.max(0, player.squashT - dt);
    const base = player.sneaking ? 0.8 : 1;
    player.group.scale.y = base * (1 - 0.18 * (player.squashT / 0.16));
  }
  updateMercs(dt);
  updateVendetta();
  updateWeather(dt);
  // 环境氛围音:按季节 × 时辰 × 天气切换(4 秒判一次)
  ambienceT -= dt;
  if (ambienceT <= 0) {
    ambienceT = 4;
    const ph = dayPhase();
    let kind = null;
    if (weather.rain > 0.25) kind = null; // 雨雪声自己就是氛围
    else if (isWinter()) kind = 'wind';
    else if (ph === 'night' && seasonIdx() >= 1) kind = 'crickets'; // 夏秋夜
    else if ((ph === 'day' || ph === 'dawn') && seasonIdx() <= 1) kind = 'birds'; // 春夏白天
    setAmbience(started && !paused ? kind : null);
  }
  updateRegion(dt);
  updateBubble(dt);
  villagerChatter();
  // 具名/搞笑 NPC:按日程走位;到位后待机呼吸,玩家靠近时转身面对
  {
    const phase = dayPhase();
    for (const n of namedNPCs) {
      if (entFar(n)) continue;
      const sched = NPC_SCHEDULE[n.key];
      const spot = sched ? sched[phase] : null;
      if (spot && Math.hypot(n.pos.x - spot[0], n.pos.z - spot[1]) > 1.2) {
        moveEntity(n, spot[0], spot[1], 2.2, dt);
        n.group.position.copy(n.pos);
        n.group.rotation.y = n.yaw;
        animateLimbs(n.parts, n.walkT, true, n.group, 0.45);
      } else {
        animateLimbs(n.parts, 0, false);
        if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
          n.group.rotation.y = angleLerp(n.group.rotation.y,
            Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
        }
      }
    }
    animateLimbs(arenaHost.parts, 0, false);
    if (dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 30) {
      arenaHost.group.rotation.y = angleLerp(arenaHost.group.rotation.y,
        Math.atan2(player.pos.x - arenaHost.pos.x, player.pos.z - arenaHost.pos.z), dt * 4);
    }
    for (const n of funnyNPCs) {
      if (n.key === 'quixote') continue; // 他忙着决斗
      if (entFar(n)) continue;
      animateLimbs(n.parts, 0, false);
      if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
        n.group.rotation.y = angleLerp(n.group.rotation.y,
          Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
      }
    }
    // 风车骑士唐豆:每 3 秒向"巨人"发起冲锋
    quixoteT -= dt;
    if (quixoteT <= 0) {
      quixoteT = 3;
      quixote.swingT = 0.35;
      quixote.yaw = Math.atan2(140 - quixote.pos.x, 20 - quixote.pos.z);
      quixote.group.rotation.y = quixote.yaw;
      if (dist2(player.pos.x, player.pos.z, quixote.pos.x, quixote.pos.z) < 900) sfx.sword();
    }
    animateLimbs(quixote.parts, 0, false);
    if (quixote.swingT > 0) {
      quixote.swingT -= dt;
      quixote.parts._attackAnim = true;
      meleeSwing(quixote.parts, Math.min(1, 1 - quixote.swingT / 0.35));
    } else {
      quixote.parts._attackAnim = false;
    }
  }
  updateRain(dt);
  if (!inDungeon()) {
    const elevA = Math.sin(clock.time * Math.PI * 2 - Math.PI / 2);
    updateAmbient(dt, nowMs * 0.001, camera.position, groundH(player.pos.x, player.pos.z), player.pos.x, player.pos.z,
      biomeWeights, { night: 1 - Math.max(0, Math.min(1, elevA * 2 + 0.25)), rain: weather.rain, windX: 0.94, windZ: 0.33,
        pixelH: renderer.domElement.height }, qualityIdx === 0 ? 0.6 : 1);
  }
  updateDust(dt);
  updateDayNight(dt);
  updateLightPool(player.pos.x, player.pos.z);
  updateCalendar();
  updateWorkspace(dt);
  updateIdle(dt);
  updateWilderness(player.pos.x, player.pos.z); // 无尽荒野区块流式加载
  updateVegetation(dt, player.pos.x, player.pos.z, 1 + weather.rain * (weather.state === 'storm' ? 1.6 : 0.8));
  // 远景垫底跟着玩家走(地形网格本身是静态的)
  world.underlay.position.x = Math.round(player.pos.x / 64) * 64;
  world.underlay.position.z = Math.round(player.pos.z / 64) * 64;
  updateCamera(dt);

  // 风车与砖块动画
  for (const w of world.windmills) w.rotation.x += dt * 0.9;
  for (const b of world.qBlocks) {
    if (b.bump > 0) { b.bump -= dt; b.mesh.position.y = b.y + Math.sin((0.25 - b.bump) / 0.25 * Math.PI) * 0.3; }
    else if (!b.used) b.mesh.rotation.y += dt * 0.8;
  }
  for (const c of world.chests) {
    if (c.opened && c.lid.rotation.x > -1.9) c.lid.rotation.x -= dt * 5;
  }
  for (const c of world.clouds) {
    c.position.x += dt * 1.5;
    if (c.position.x > 320) c.position.x = -320;
  }
  beacon.rotation.y += dt;
  beacon.material.opacity = 0.22 + Math.sin(now * 0.004) * 0.1;

  // 水面波纹动画
  for (const m of world.waterMats) {
    m.normalMap.offset.x += dt * 0.018;
    m.normalMap.offset.y += dt * 0.011;
  }

  updateEnvIntensity();
  // 残血红晕与心跳
  if (player.hp <= 3 && !player.dead) {
    lowhpEl.style.opacity = 0.55 + Math.sin(now * 0.008) * 0.3;
    player.hbT = (player.hbT || 0) - dt;
    if (player.hbT <= 0) { player.hbT = 0.95; sfx.heartbeat(); }
  } else if (lowhpEl.style.opacity !== '0') {
    lowhpEl.style.opacity = 0;
  }
  updateCoinInstances(now);
  updateEntityLOD();
  if (frameNo % 3 === 0 || fishing.active || player.carrying || player.mounted) computePrompt();
  updateHUD();
  updateActionBar();
  if (frameNo++ % 2 === 0) drawMinimap(); // 小地图 30Hz 足够
  gradePass.uniforms.uTime.value = now * 0.00025; // 胶片颗粒的抖动时钟
}
// ---- 共享上下文:拆出去的系统模块(相机等)从这里拿活对象 ----
ctx.player = player;
ctx.world = world;
ctx.colliders = colliders;
ctx.getLockFoe = () => lockFoe;
ctx.isWinter = isWinter;
ctx.started = () => started;
ctx.toast = toast;
ctx.mood = () => workspace.mood.v;
ctx.inDungeon = inDungeon;
// 地图快照:地图模块只读这些,不碰玩法状态
ctx.mapView = () => ({ guards, bandits, horses, wanted, warband, beacon, beaconRouted,
  questGiver: exGroup.visible ? { x: steward.pos.x, z: steward.pos.z } : null });
// ---- 点光入池:场景里现有的火把/篝火/地窖烛台点光全部改为登记,由点光池代为发光 ----
{
  scene.updateMatrixWorld(true);
  const found = [];
  scene.traverse((o) => { if (o.isPointLight && o !== lantern && !lightPool.includes(o)) found.push(o); });
  const wp = new THREE.Vector3();
  for (const pl of found) {
    pl.getWorldPosition(wp);
    addLightSource(pl);
    pl.position.copy(wp); // 摘下来后用世界坐标(仍是离地高度)
  }
  console.info('点光入池', found.length, '盏 →', LIGHT_POOL, '盏常驻');
}
// ---- 静态合批:所有引用都建立完了,把世界里不会再动的网格按材质×格合并 ----
{
  const protect = [], protectMats = new Set();
  const scan = (v, depth) => { // world 返回值里引用到的对象/材质都是"活的",原样保留
    if (!v || depth > 4) return;
    if (v.isObject3D) { protect.push(v); return; }
    if (v.isMaterial) { protectMats.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    if (typeof v === 'object' && !(v instanceof THREE.Vector3) && v.constructor === Object) {
      for (const k of Object.keys(v)) if (k !== 'colliders' && k !== 'features' && k !== 'occluders') scan(v[k], depth + 1);
    }
  };
  scan(world, 0);
  for (const m of world.waterMats || []) protectMats.add(m);
  // 夜窗:每户两扇、各一份参数相同的材质,亮度由 sky.js 统一设——并成一份共享材质后窗子就能随房子合批
  const winFlames = new Set();
  let winMat = null;
  const sameWin = (a, b) => a.type === b.type && a.color.equals(b.color) && a.emissive.equals(b.emissive) &&
    a.roughness === b.roughness && a.metalness === b.metalness && !a.map && !b.map;
  for (const t of world.torches || []) {
    if (!t.window || !t.flame || !t.flame.material || !t.flame.material.isMeshStandardMaterial) continue;
    if (!winMat) winMat = t.flame.material;
    else if (t.flame.material !== winMat) {
      if (!sameWin(t.flame.material, winMat)) continue;
      t.flame.material.dispose();
      t.flame.material = winMat;
    }
    winFlames.add(t.flame);
  }
  if (winMat) protectMats.add(winMat);
  const t0 = performance.now();
  const st = staticBatch(scene, worldTops, { groundH, protect: protect.filter((o) => !winFlames.has(o)), protectMats,
    raycastKeep: new Set(world.occluders) });
  console.info('静态合批', st, `${(performance.now() - t0).toFixed(0)}ms`);
}
// ---- 着色器预热:场景材质 + 特效材质一次编译好,首次出刀/施法/起手预警/下雨不再卡顿 ----
// 必须对着后处理的离屏目标编译:RenderPass 画进 composer 的渲染目标(不做色调映射、线性输出),
// 对着屏幕编译出来的是另一套程序变体——白编一遍,首帧和首次挥刀/下雨时还得再编。
// 场景里藏着的东西(雨线、按需显示的部件)compile 也会照顾到;拖尾用真实的弧形几何挂进来一起编。
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 18, 1, 0, 2.1), trailMat);
  const tmp = [ring, ...[magBurstMat, dangerMat].map((m) => new THREE.Mesh(magBurstGeo, m))];
  for (const t of tmp) { t.position.set(0, -60, 0); t.userData.noSnap = true; scene.add(t); }
  const rt0 = renderer.getRenderTarget();
  renderer.setRenderTarget(composer.readBuffer);
  try { renderer.compile(scene, camera); } catch (e) { console.warn('预热失败', e); }
  renderer.setRenderTarget(rt0);
  for (const t of tmp) scene.remove(t);
  ring.geometry.dispose();
}
requestAnimationFrame(loop);

// ==== 供拆出的系统模块使用的绑定 ====
export {
  abHighlight, addHorse, applyDamage, arrows, bandits, calendar, callout, colliders, damagePlayer,
  dangerFX, dangerMat, dayPhase, dialog, faceNearestFoe, guards, horses, keys, killWolf, lockFoe,
  midHeld, openDialog, player, recomputeMaxHp, remember, saveGame, setLockFoe, showDamage, started,
  stats, toast, toastNow, unlockAch, wolves,
};
