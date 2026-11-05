// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, resolveCollisions, setHumanModel, setFaunaModel, setWeaponModels } from './entities.js';
import { LORE } from './story.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
import { updateWilderness, CORE, LANDMARKS, BIG_PROP } from './wilderness.js';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { setTreeModel, setBuildingModel, setRockGeos, setNatureModels, hasNature, buildNatureInstances, NATURE_SPEC, specCols, registerNatureTemplate } from './flora.js';
import { MODELS_B64 } from './models-data.js';
import { buildMasks, buildCoreGround, getGroundMaterial, groundH, maskAt, vegAllowed, dominantBiome, biomeWeights } from './terrain.js';
import { initVegetation, updateVegetation } from './vegetation.js';
import { staticBatch, registerSmallProps } from './batch.js';
import { updateTimers, pendingTimers, simNow } from './core/timers.js';
import { scaleDt } from './core/timefx.js';
import { seed as seedRng } from './core/rng.js';
import { initAmbient, updateAmbient } from './ambient.js';
import { cam, updateCamera } from './systems/camera.js';
import { weather, setWeather, updateWeather, updateRain, updateDust } from './systems/weather.js';
import {
  clock, lantern, vistaFar, vistaNear, updateDayNight, updateEnvIntensity, fitViewDistance,
} from './systems/sky.js';
import { mapState, drawMinimap } from './ui/maps.js';
import { facetKind } from './gfx/facet.js';
import { ctx } from './core/ctx.js';
import { frame } from './core/frame.js';
import { initTitle, loadLocalTitleArt, setTitleArt } from './ui/title.js';
import { world, colliders, player, started, bindWorld, bindPlayer } from './core/state.js';
import { LIGHT_POOL, lightPool, initLightPool, addLightSource, updateLightPool } from './gfx/pools.js';
import {
  renderer, scene, camera, composer, bloom, gradePass, STYLE_PRESETS, styleKey, applyStyle,
  cycleStyle,
} from './gfx/core.js';
import {
  awakenDragon, damageDragon, dragonRT, telegraphArea, updateDragon,
} from './systems/dragon.js';
import { prologue, skipPrologue, startPrologue, updatePrologue } from './systems/prologue.js';
import {
  DRAGON_SKULL, SKILL_DEFS, SPELLS, castBigFire, castSpell, cycleSpell, doShout, dragonAim,
  explodeAt, frostPatches, frostSlow, learnShout, learnSpell, shout, skillXp, sneakFactor,
  spellDown, spellUp, spendSta, toggleSneak, updateFrostPatches, updateMagic,
} from './systems/magic.js';
import { toast, toastQueue, updateToast } from './ui/toast.js';
import { achUnlocked, stats } from './systems/achievements.js';
import {
  applySeason, calendar, composeLetter, isWinter, newDay, seasonDay, seasonIdx, sleepToMorning,
  todaySpecial, updateAmbience, updateCalendar,
} from './systems/calendar.js';
import {
  MIND, MIND_WISHES, MIRROR_POS, archetype, chronicle, consolidate, habitFactor, idle, initMirror,
  mindFavorite, mindMakeWish, mindReport, mindSave, mindTick, mirrorTalk, moodWord, remember,
  updateIdle, updateWorkspace, workspace, wsReport,
} from './systems/mind.js';
import { addHorse, bandits, guards, horses, initActors, villagers, wolves } from './systems/actors.js';
import {
  EVO, evolveLegends, evolveTactics, growCorpus, legendText, mutateLegend, seedLegend,
} from './systems/evo.js';
import { WEAPONS, cycleWeapon, openShop, refreshShop, setArmorVisual, setWeaponVisual } from './systems/gear.js';
import {
  damagePlayer, doRoll, enforceDeepWater, recomputeMaxHp, recomputeMaxSta, tryRob, updateBuffs,
  updatePlayer, updateRegen, updateSquash,
} from './systems/player.js';
import { hireMerc, mercs, payMercs, updateMercs } from './systems/mercs.js';
import { arrows, updateArrows } from './systems/projectiles.js';
import {
  callout, flashing, registerKill, updateCombo, updateDamageNums, updateFalls, updateFlashes,
  updateKnockback, updateLowHp, whiteHot,
} from './ui/feedback.js';
import {
  chickens, deers, frostfang, initFauna, mushrooms, respawnMushrooms, revengeT, updateChickens,
  updateDeers, updateFrostfang,
} from './systems/fauna.js';
import {
  BOAT_ISLE, BOAT_PIER, CHORE_POS, DGN, FISH_SPOT_ISLE, choreBoard, choreProgress, enterDungeon,
  exitDungeon, fishing, inDungeon, initActivities, loreRead, loreStones, nearestSpot, openJournal,
  prayAltar, proclaimText, queueDream, refreshProclaim, rowTo, sideQuest, startTrial, takeRelic,
  togglePhoto, trialRT, updateAltarGlow, updateCryptLights, updateFishing, updateRideMileage,
  updateSprings, updateTrial, wildSpots,
} from './systems/activities.js';
import {
  updateVendetta, vendetta, vendettaLetter, vendettaRead,
} from './systems/vendetta.js';
import {
  beacon, beaconRouted, completeMission, exGroup, initQuests, missions, quest, questRT,
  talkQuestGiver, updateQuest,
} from './systems/quests.js';
import {
  HOME, fireflyMesh, homeInteract, homeRT, initHome, refreshTrophies, updateFirefly, updateHome,
} from './systems/home.js';
import {
  arenaHost, arenaRT, bountyRT, initEvents, startArenaWave, streetEvent, takeBounty,
  trySpawnStreetEvent, updateArena, updateBounty, updateStreetEvent,
} from './systems/events.js';
import {
  DIRECTOR_EVENTS, director, updateDirector,
} from './systems/director.js';
import {
  armPress, armRT, armWrestle, funnyNPCs, initNPCs, namedNPCs, steward, tellStory, updateArm,
  updateNPCs,
} from './systems/npcs.js';
import { advanceDialog, dialog, updateBubble, updateDialogRange, villagerChatter, witchFortune } from './ui/dialog.js';
import { updateActionBar, updateHUD, updateHintFade, updateRegion } from './ui/hudview.js';
import { autoQuality, initQuality, qualityIdx, updateEntityLOD } from './gfx/quality.js';
import { paused } from './ui/pause.js';
import { loadGame, saveBlocked, saveGame } from './core/save.js';
import { addPickup, crestsFound, initPickups, updateCoinInstances, updatePickups } from './systems/pickups.js';
import { crime, downGuard, lawlessT, updateLawless, updateWanted, wanted } from './systems/law.js';
import {
  WARLORD_TAUNTS, spawnWarband, updateWarband, warband,
} from './systems/warband.js';
import {
  applyDamage, banditSlain, combatCalmT, dangerFX, dangerMat, faceNearestFoe, flinch, foeName,
  frightenBandits, initCombat, killWolf, lockFoe, lockMark, magBurstGeo, magBurstMat, slayBandit,
  telegraphFlash, toggleLock, trailFX, trailMat, updateCombatMusic, updateDanger, updateLock,
  updateTrails,
} from './systems/combat.js';
import { attackDown, attackUp, heavyAttack, initAttack, tryAttack, updateAttackInput } from './systems/attack.js';
import {
  updateBandits, updateGuards, updateHorses, updateVillagers, updateWolves,
} from './systems/ai.js';
import {
  computePrompt, initInteract, promptText, tryInteract, updateInteractMarker, updatePrompt,
} from './systems/interact.js';
import { drainInput, initInput, keys } from './systems/input.js';

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
loadLocalTitleArt(); // 本地标题键艺术优先(assets/ai/title.jpg,可选)

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



initQuality();




initInteract(); // 交互目标标记进场景(原位调用)




initMirror(); // 回响之镜立进场景(启动装配:原位调用,保持建场顺序)



initPickups();



// 读档,然后生成未收集的纹章
const hasSave = loadGame();
world.crestSpots.forEach(([x, z], i) => {
  if (!crestsFound.includes(i)) addPickup('crest', x, z, Infinity, i);
});
initTitle(hasSave); // 标题画面:世界观开场、存档信息、Delete 清档、点击开局
// 读档后应用升级效果
setWeaponVisual(player.weapon);
// 基础魔法与生俱来:老档也补上魔光弹
if (!player.spells.includes('spark')) player.spells.unshift('spark');
// 通关之星:completeMission 存档发生在生成星星之前,读档时没领过就补一颗在广场
if (quest.idx >= missions.length && !stats.starTaken) addPickup('star', 0, 13);
// 体力上限由技能总等级 + 军旗战利品重算(maxSta 不入档,防旧档字段缺失)
recomputeMaxSta();
player.sta = player.maxSta;
setArmorVisual(player.armor);
applySeason();
if (player.royalHorse) {
  const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
  rh.fast = true;
}


initInput();











// 近战横扫判定:普通挥击与蓄力重击共用(dmg/范围/角度/击退可调)

initCombat();

initAttack();








// ================= 主循环 =================
// 调试/自动化测试句柄

// ================= 内容包注入(24 个创作代理的产出,tools/content-packs.json 同源) =================






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

  updateInteractMarker(dt, now);

  updatePlayer(dt);
  updateRegen(dt);
  updateAttackInput(dt); // 按下=轻击、按住=蓄力(光效)→松手重击;出招中的按键进缓冲
  updateKnockback(dt);
  updateBuffs(dt);
  updateRideMileage();
  enforceDeepWater(now);
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
  updateSquash(dt);
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
  updatePrompt();
  updateHUD();
  updateActionBar();
  if (frame.n++ % 2 === 0) drawMinimap(); // 小地图 30Hz 足够
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

