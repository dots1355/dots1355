// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import {
  makeHumanoid, resolveCollisions, angleLerp, dist2, setHumanModel, setFaunaModel, setWeaponModels,
  disposeEntityGroup,
} from './entities.js';
import { INTRO, REGIONS, DIALOGS, LORE } from './story.js';
import { initAudio, sfx, startMusic, toggleMusic, setCombatMusic } from './audio.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
import { updateWilderness, wildRegionName, CORE, LANDMARKS, BIG_PROP, setWildViewDistance } from './wilderness.js';
import * as BANKS from './dialogue-banks.js';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { setTreeModel, setBuildingModel, setRockGeos, setNatureModels, hasNature, buildNatureInstances, NATURE_SPEC, specCols, registerNatureTemplate } from './flora.js';
import { MODELS_B64 } from './models-data.js';
import { buildMasks, buildCoreGround, getGroundMaterial, groundH, maskAt, vegAllowed, dominantBiome, biomeWeights } from './terrain.js';
import { initVegetation, updateVegetation, setVegetationDensity } from './vegetation.js';
import { staticBatch, registerSmallProps, updatePropLOD } from './batch.js';
import { later, updateTimers, pendingTimers, simNow } from './core/timers.js';
import { hitStop, slowMo, scaleDt } from './core/timefx.js';
import { rand, seed as seedRng } from './core/rng.js';
import { initAmbient, updateAmbient } from './ambient.js';
import { cam, updateCamera } from './systems/camera.js';
import { weather, setWeather, updateWeather, updateRain, spawnDust, updateDust } from './systems/weather.js';
import { clock, sun, lantern, vistaFar, vistaNear, updateDayNight, updateEnvIntensity, fitViewDistance } from './systems/sky.js';
import { mapState, toggleBigMap, drawMinimap } from './ui/maps.js';
import { iconHTML, heartsHTML, weatherHTML, manaHTML, svgIcon, richText, wantedHTML } from './ui/hud.js';
import { facetKind } from './gfx/facet.js';
import { ctx } from './core/ctx.js';
import { frame } from './core/frame.js';
import { world, colliders, player, started, bindWorld, bindPlayer, markStarted } from './core/state.js';
import { EPITAPHS, COMEDY_LINES } from './content-packs.js';
import {
  LIGHT_POOL, lightPool, initLightPool, addLightSource, updateLightPool, pooledMat, releaseMat,
} from './gfx/pools.js';
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
import { dropQuestToasts, toast, toastQuest, toastQueue, updateToast } from './ui/toast.js';
import {
  AI_TEXT_OFF, aiBusy, aiLine,
} from './core/aitext.js';
import { achUnlocked, stats, unlockAch } from './systems/achievements.js';
import {
  SEASONS, SEASON_ICON, applySeason, calendar, composeLetter, dayPhase, isWinter, newDay, seasonDay,
  seasonIdx, sleepToMorning, startSpecialDay, todaySpecial, updateAmbience, updateCalendar,
} from './systems/calendar.js';
import {
  MIND, MIND_WISHES, MIRROR_POS, archetype, chronicle, chronicleDeeds, consolidate, habitFactor,
  idle, initMirror, mindFavorite, mindLoad, mindMakeWish, mindReport, mindSave, mindTick,
  mirrorTalk, moodWord, recallLine, remember, updateIdle, updateWorkspace, workspace, wsReport,
} from './systems/mind.js';
import {
  addBandit, addGuard, addHorse, animHorseLegs, animateLimbs, bandits, entFar, guards, horses,
  initActors, meleeSwing, moveEntity, moveEntityHorse, retireEntity, villagers, wolves,
} from './systems/actors.js';
import {
  EVO, evolveLegends, evolveTactics, growCorpus, legendText, mutateLegend, seedLegend,
} from './systems/evo.js';
import {
  ARMORS, WEAPONS, cycleWeapon, openShop, recomputeMaxHp, refreshShop, setArmorVisual, setWeaponVisual,
  shopOpen,
} from './systems/gear.js';
import {
  hireMerc, hireMercSilent, mercs, payMercs, updateMercs,
} from './systems/mercs.js';
import {
  arrowGeo, arrowMat, arrows, shootArrow, updateArrows, wetSpread,
} from './systems/projectiles.js';
import {
  callout, flashing, hitFX, registerKill, showDamage, startFall, updateCombo, updateDamageNums,
  updateFalls, updateFlashes, updateKnockback, updateLowHp, whiteHot,
} from './ui/feedback.js';
import {
  chickens, deers, frostfang, initFauna, killDeer, mushrooms, pokeChicken, respawnMushrooms,
  revengeT, tameFrostfang, updateChickens, updateDeers, updateFrostfang,
} from './systems/fauna.js';
import {
  BOAT_ISLE, BOAT_PIER, CHORE_POS, DGN, FISH_SPOT, FISH_SPOT_ISLE, NOTICE_POS, TRIAL_FLAG,
  blessedToday, choreBoard, choreProgress, choreReady, composeProclaimOffline, endTrial, enterDungeon,
  exitDungeon, fishing, fishingReel, inDungeon, initActivities, lakeBlessed, loreRead, loreStones,
  nearestSpot, openJournal, prayAltar, prayAtChapel, proclaimText, queueDream, readLore,
  refreshProclaim, rowTo, setLakeBlessed, sideQuest, startFishing, startTrial, takeRelic, togglePhoto,
  trialRT, updateAltarGlow, updateCryptLights, updateFishing, updateRideMileage, updateSprings,
  updateTrial, wildSpots,
} from './systems/activities.js';
import {
  updateVendetta, vendetta, vendettaLetter, vendettaRead,
} from './systems/vendetta.js';
import {
  beacon, beaconRouted, canAcceptRemotely, completeMission, dismissMinions, exGroup, initQuests,
  missions, quest, questRT, stewardWhere, talkQuestGiver, updateQuest,
} from './systems/quests.js';
import {
  HOME, fireflyMesh, homeInteract, homeRT, initHome, paintHomeSign, refreshTrophies, updateFirefly,
  updateHome,
} from './systems/home.js';
import {
  HOST_LINES, arenaHost, arenaRT, bountyRT, initEvents, startArenaWave, streetEvent, takeBounty,
  trySpawnStreetEvent, updateArena, updateBounty, updateStreetEvent, wantedPosterSpeaker,
} from './systems/events.js';
import {
  DIRECTOR_EVENTS, director, updateDirector,
} from './systems/director.js';
import {
  EXTRA_NPCS, armPress, armRT, armWrestle, bardSong, fountainWish, funnyNPCs, gamble, initNPCs,
  namedNPCs, steward, tellStory, updateArm, updateNPCs,
} from './systems/npcs.js';
import {
  NPC_DESC_EN, VILLAGER_DESC_EN, advanceDialog, dbLine, deepTalk, dialog, dismissDialog, npcTalk,
  openDialog, showBubble, updateBubble, updateDialogRange, villagerChatter, witchFortune,
} from './ui/dialog.js';

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
      facetKind(kind, gltf.scene); // 环境静物统一刻面(gfx/facet.js);角色与生物保持光滑
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
bindWorld(buildWorld(scene)); // world / colliders 登记进 core/state.js,系统模块从那里读
const worldTops = scene.children.filter((o) => !preWorldTops.has(o)); // buildWorld 新建的顶层对象(静态合批候选)

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
    if (state === 'generating') aiStatusEl.textContent = `AI 高清材质生成中… ${done}/${total}(首次需约 1 分钟,已自动缓存)`;
    else if (state === 'done') aiStatusEl.textContent = `AI 高清材质已启用(${done}/${total})`;
    else aiStatusEl.textContent = '离线模式:使用内置程序化材质(联网后自动启用 AI 材质)';
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
  flashEl = $('flash'), titleEl = $('title'),
  gameoverEl = $('gameover'), gameoverText = $('gameover-text'),
  weatherEl = $('weather'), equipEl = $('equip'),
  bosshpEl = $('bosshp'), bosshpFillEl = $('bosshp-fill'),
  staminaEl = $('stamina'), staminaFillEl = $('stamina-fill');

// ================= 玩家 =================
bindPlayer({
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
  // 装备(systems/gear.js):手中武器、已拥有的武器、护甲档
  weapon: 'sword', weaponsOwned: ['sword'], armor: 0,
  // 格挡与翻滚(systems/attack.js、systems/player.js)
  blocking: false, rollT: 0, rollCd: 0, rollDir: new THREE.Vector2(0, 1),
});
player.group.position.copy(player.pos);
scene.add(player.group);


initActors();








initFauna();

initActivities();

initQuests();


initEvents();
initHome(); // 湖畔小屋(原本在悬赏板与角斗场之间建;互不依赖)



initNPCs();
// @@NPCS_END@@
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
    if (L.icon !== icon) { L.icon = icon; sl.iconEl.innerHTML = iconHTML(icon); }
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
// lodNear/lodHide:实体投影/整体隐藏的距离(米);halfD:实体隔帧更新的距离;propFar:小件(灌木/树桩/木箱、碑、牌…)
// 的可见距离;bigFar:树林/岩石实例块的可见距离;viewCap:视距上限(米);shadowBox:阴影正交框半宽;
// shadowEvery:阴影图每几帧更新一次;wildD:荒野区块加载距离(米)
const QUALITY = [
  { key: 'lo', name: '流畅', gtao: false, bloom: false, smaa: false, pr: 0.8, veg: 0.3, shadow: 1024, shadowBox: 30,
    shadowEvery: 2, lodNear: 14, lodHide: 56, halfD: 14, propFar: 40, bigFar: 140, propShadow: false, viewCap: 250, wildD: 160 },
  { key: 'mid', name: '均衡', gtao: false, bloom: true, smaa: true, pr: 1, veg: 0.65, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 40, lodHide: 160, halfD: 30, propFar: 150, bigFar: Infinity, propShadow: true, viewCap: 1600, wildD: 256 },
  { key: 'hi', name: '精致', gtao: true, bloom: true, smaa: true, pr: 1.5, veg: 1, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 50, lodHide: 220, halfD: 40, propFar: 220, bigFar: Infinity, propShadow: true, viewCap: 1600, wildD: 256 },
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
  const sc = sun.shadow.camera; // 框收窄后纹素密度不降(30m/1024 比 70m/2048 还密);sky.js 的纹素对齐按框宽自适应
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
  updateSkinLOD(cx, cz, q.lodNear, q.lodHide, q.halfD);
  updateNatureLOD(cx, cz, q.propFar, q.propShadow, q.bigFar);
  updatePropLOD(cx, cz, q.propFar);
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

initMirror(); // 回响之镜立进场景(启动装配:原位调用,保持建场顺序)

// ================= 存档 =================
const SAVE_KEY = 'gth-save-v1';
const FRESH_START = !localStorage.getItem(SAVE_KEY); // 新档才演序章
const crestsFound = [];
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
      ach: achUnlocked, stats, day: calendar.day, chron: chronicle, fday: calendar.festGrantedDay,
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
    crestsFound.splice(0, Infinity, ...(Array.isArray(s.crests) ? s.crests : []));
    player.swordLv = s.swordLv || 1;
    player.royalHorse = !!s.royalHorse;
    if (s.kingRewarded) {
      const king = namedNPCs.find((n) => n.key === 'king');
      if (king) king.rewarded = true;
    }
  });
  section('成就统计', () => {
    if (Array.isArray(s.ach)) achUnlocked.splice(0, Infinity, ...s.ach);
    if (s.stats) Object.assign(stats, s.stats);
    stats.lastStomp = -99; // 时间戳不跨会话:performance.now 重置会误发"弹簧靴"成就
    calendar.day = Math.max(1, s.day || 1);
  });
  section('物品', () => {
    player.herbs = s.herbs || 0;
    player.venison = s.venison || 0;
    if (Array.isArray(s.lore)) loreRead.splice(0, Infinity, ...s.lore);
    if (Array.isArray(s.chron)) chronicle.splice(0, Infinity, ...s.chron);
    calendar.festGrantedDay = s.fday || 0;
    frostfang.feed = s.wolfFeed || 0;
    player.relic = !!s.relic;
    if (s.chore && s.chore.active) Object.assign(sideQuest, s.chore);
    if (s.lake) setLakeBlessed(true);
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
  idle.t = 0; // 有输入,世界收回它的注视
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

titleEl.addEventListener('click', () => {
  initAudio();
  startMusic();
  titleEl.style.display = 'none';
  markStarted();
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
function resetEvade() { evadeT = 0; } // 卫兵看见你了:脱逃计时归零
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
    if (n.key === 'innkeep' && calendar.letter && !player.home) { // 有房后信直接寄到家门口信箱
      if (probe) return NP('按 E 取信(有人写给你的)');
      const L = calendar.letter;
      calendar.letter = null;
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
  if (player.home && calendar.letter && dist2(player.pos.x, player.pos.z, HOME.x + 3.4, HOME.z + 3.2) < 5) {
    if (probe) return P('按 E 开信箱(小红旗立着——有信!)', HOME.x + 3.4, HOME.z + 3.2, 1.8);
    const L = calendar.letter;
    calendar.letter = null;
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
    rowTo({ x: -99.4, z: 83 }); // 落在栈桥桥面上(桥面宽 2.2m,两侧是水)
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
      if (probe) return P(!blessedToday() ? '按 E 在石坛前祈祷(获得庇佑)' : '(神明今日已听过你的祷告)', ch.x, ch.z, 2.0);
      prayAtChapel();
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
    readEpitaph();
    return;
  }
  if (best) return mountHorse(best, probe, P);
  return null;
}






// ================= 攻击 =================
// 近战横扫判定:普通挥击与蓄力重击共用(dmg/范围/角度/击退可调)
// ================= 打击手感核心 =================
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
let wolfKills = 0;
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
// 符文立石:刀锋判定帧劈中身前的立石(与砍人同一刀长与扇面),符文碎光化作金币
function strikeRuneStones(range, arcDot) {
  const b = world.runeStrike(player.pos.x, player.pos.z, player.yaw, range, arcDot);
  if (!b) return;
  magBurst(b.x, b.y, b.z);
  sfx.block();
  cam.shake = Math.max(cam.shake, 0.15);
  for (let i = 0; i < 5; i++) {
    const a = rand() * 6.28;
    addPickup('coin', b.x + Math.cos(a) * 1.4, b.z + Math.sin(a) * 1.4, 30);
  }
  callout('符文碎光 +5 金币', 'blue', { x: b.x, y: b.y + 1.2, z: b.z });
}
function meleeSweep(dmg, range, arcDot, knock, opts = {}) {
  if (dmg > 0) strikeRuneStones(range, arcDot);
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
  chargeGlow.scale.setScalar(0.4 + k * 1.1 + (k >= 1 ? Math.sin(frame.now * 0.02) * 0.12 : 0));
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
  dismissDialog(); // 人都倒了,话就别说了
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
      if (pd < 25) resetEvade();
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
  weatherEl.innerHTML = weatherHTML(seasonIdx(), `${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`,
    dayPhase(), weather.state, isWinter() && raining);
  heartsEl.innerHTML = heartsHTML(full, half, heartsMax - full - half);
  coinsEl.innerHTML = `${svgIcon('coin')}<span>${player.coins}</span>`;
  wantedEl.innerHTML = wantedHTML(wanted);
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.innerHTML = richText(missionText);
  const wDef = WEAPONS[player.weapon];
  equipEl.innerHTML = // 法术/冷却改由底部技能栏显示,这里只留装备与法力(统一 SVG 图标)
    `${iconHTML(wDef.icon, 'ico-s')}<span>${wDef.name}${player.swordLv >= 2 ? '+1' : ''}</span>${player.relic ? svgIcon('relic', 'ico-s') : ''}` +
    (player.armor ? `<span class="eq-sep">·</span>${svgIcon('armor', 'ico-s')}<span>${ARMORS[player.armor].name}</span>` : '') +
    (player.spells.length
      ? `<span class="eq-sep">·</span><span>法力</span>${manaHTML(Math.floor(player.mp), player.maxMp)}` : '');
  promptEl.innerHTML = richText(promptText);
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
// 墓园墓志铭:按序轮读,AI 在后台补写下一条
let epitaphIdx = Math.floor(rand() * EPITAPHS.length);
let epitaphAI = null; // AI 补写的下一条墓志铭
function readEpitaph() {
  const text = epitaphAI || EPITAPHS[epitaphIdx++ % EPITAPHS.length];
  epitaphAI = null;
  openDialog(['(你拂去一块墓碑上的落叶)', `「${text}」`]);
  if (!AI_TEXT_OFF && !aiBusy.epitaph) {
    aiBusy.epitaph = true;
    aiLine('为中世纪村庄墓园写一条墓志铭,15~40字,可庄重可幽默可温柔,只输出铭文本身,不要引号。', null, 9000)
      .then((t) => { aiBusy.epitaph = false; if (t) epitaphAI = t; });
  }
}






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
  getDailyEvents: () => calendar.dailyEvents,
  wilderness: { CORE },
  deers, mushrooms, loreStones, LORE, tellStory, sleepToMorning, newDay,
  chronicle: () => chronicle, remember, archetype, mirrorTalk, MIRROR_POS,
  frostfang, wildSpots, heavyAttack, togglePhoto, queueDream, damagePlayer, nearestSpot,
  trialRT, startTrial, prayAltar, rowTo, BOAT_PIER, BOAT_ISLE,
  enterDungeon, exitDungeon, takeRelic, inDungeon, DGN, FISH_SPOT_ISLE, openJournal,
  sideQuest, choreBoard, choreProgress, CHORE_POS,
  composeLetter, witchFortune, getLetter: () => calendar.letter,
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
    for (let i = 0; i < n; i++) { frame.now += dt * 1000; tick(dt, frame.now); }
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
  setIdle: (t) => { idle.t = t; },
  getIdle: () => ({ idleT: idle.t, idleCd: idle.cd }),
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
  frame.now = now;
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
  updateRideMileage();
  // 深水规则:银月湖面不可徒步——栈桥走廊(|x+100|<1.3 即桥面宽,且 z<92)与湖心岛(距岛心<6.8)除外。
  // 每帧检查,步幅远小于缓冲带宽,冲刺也蹚不过去;上岛只能靠小船。
  {
    const ldx = player.pos.x + 100, ldz = player.pos.z - 100;
    const lakeD = Math.hypot(ldx, ldz);
    if (lakeD < 28.5 && lakeD > 6.8 &&
        !(Math.abs(ldx) < 1.3 && player.pos.z < 92)) {
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
  updateCryptLights();
  updateAltarGlow(dt);
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
  updateAmbience(dt);
  updateRegion(dt);
  updateBubble(dt);
  villagerChatter();
  updateNPCs(dt);
  updateRain(dt);
  if (!inDungeon()) {
    const elevA = Math.sin(clock.time * Math.PI * 2 - Math.PI / 2);
    updateAmbient(dt, frame.now * 0.001, camera.position, groundH(player.pos.x, player.pos.z), player.pos.x, player.pos.z,
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

  // 风车与符文立石动画
  for (const w of world.windmills) w.rotation.x += dt * 0.9;
  world.animRunes(dt); // 符文立石:符文呼吸 / 劈中时一晃
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
  updateLowHp(dt, now);
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
  questGiver: exGroup.visible ? { x: steward.pos.x, z: steward.pos.z } : null, wildSpots });
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
  // 没并进去的小件(开局就有的碑、牌、蘑菇、火把头……)交给远景剔除(按画质档的 propFar);
  // 委托人头顶的"!"是远远找人用的,不剔
  console.info('小件远景剔除', registerSmallProps(scene.children.filter((o) => !preWorldTops.has(o) && o !== exGroup)));
}
// ---- 着色器预热:场景材质 + 特效材质一次编译好,首次出刀/施法/起手预警/下雨不再卡顿 ----
// 必须对着后处理的离屏目标编译:RenderPass 画进 composer 的渲染目标(不做色调映射、线性输出),
// 对着屏幕编译出来的是另一套程序变体——白编一遍,首帧和首次挥刀/下雨时还得再编。
// 场景里藏着的东西(雨线、按需显示的部件)compile 也会照顾到;拖尾用真实的弧形几何挂进来一起编。
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 18, 1, 0, 2.1), trailMat);
  // 法弹/火球的不透明内核是每发新建、命中即销毁的 MeshBasicMaterial:场上没有别的同类材质时,
  // 程序跟着最后一个用户一起被释放,下一发又得重编。预热编一份且永不 dispose,程序就一直在缓存里
  const boltCore = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const tmp = [ring, ...[magBurstMat, dangerMat, boltCore].map((m) => new THREE.Mesh(magBurstGeo, m))];
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
  abEl, abHighlight, addPickup, applyDamage, crestG, crestsFound, crime, damagePlayer, dangerFX,
  dangerMat, dropCoins, faceNearestFoe, flinch, keys, killWolf, lockFoe, magBurst, midHeld, paused,
  pickups, saveGame, setLockFoe, telegraphFlash, wanted, wolfKills,
};
