// 《侠盗猎马人:中世纪王国》启动装配与主循环。
// 这里只做三件事:① 按顺序装配(资源 → 世界与地形 → 玩家 → 各系统 init → 读档 → 标题与输入 → 渲染准备);
// ② 有序的系统表 SYSTEMS 与 tick(dt 缩放 + 遍历系统表);③ rAF 主循环(贴地 → 模拟 → 自动画质 → 渲染)。
// 玩法都在 systems/*、界面在 ui/*、共享根对象在 core/state.js;没有任何模块反过来导入 main.js。
import * as THREE from 'three';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { initAmbient } from './ambient.js';
import { ctx } from './core/ctx.js';
import { frame } from './core/frame.js';
import { applyProgress, loadGame } from './core/save.js';
import { bindPlayer, bindWorld, player, started, world } from './core/state.js';
import { installTestHooks } from './core/testhooks.js';
import { scaleDt } from './core/timefx.js';
import { updateTimers } from './core/timers.js';
import { setFaunaModel, setHumanModel, setWeaponModels } from './entities.js';
import {
  registerNatureTemplate, setBuildingModel, setNatureModels, setRockGeos, setTreeModel,
} from './flora.js';
import { composer, renderer, scene } from './gfx/core.js';
import { facetKind } from './gfx/facet.js';
import { initLightPool, updateLightPool } from './gfx/pools.js';
import { batchStaticWorld, poolSceneLights, warmShaders } from './gfx/prepare.js';
import { autoQuality, initQuality, trackEntityLists, updateEntityLOD } from './gfx/quality.js';
import { snapScene, unsnapScene } from './gfx/snap.js';
import { scatterCoreLandmarks } from './landmarks.js';
import { MODELS_B64 } from './models-data.js';
import {
  inDungeon, initActivities, updateAltarGlow, updateCryptLights, updateFishing, updateRideMileage,
  updateSprings, updateTrial, wildSpots,
} from './systems/activities.js';
import { bandits, guards, horses, initActors, villagers, wolves } from './systems/actors.js';
import { updateBandits, updateGuards, updateHorses, updateVillagers, updateWolves } from './systems/ai.js';
import { initAttack, updateAttackInput } from './systems/attack.js';
import { isWinter, updateAmbience, updateCalendar } from './systems/calendar.js';
import { updateCamera } from './systems/camera.js';
import {
  dangerMat, initCombat, lockFoe, magBurstGeo, magBurstMat, trailMat, updateCombatMusic, updateDanger,
  updateLock, updateTrails,
} from './systems/combat.js';
import { updateDirector } from './systems/director.js';
import { updateDragon } from './systems/dragon.js';
import { initEvents, updateArena, updateBounty, updateStreetEvent } from './systems/events.js';
import { chickens, deers, initFauna, updateChickens, updateDeers, updateFrostfang } from './systems/fauna.js';
import { initHome, updateFirefly, updateHome } from './systems/home.js';
import { drainInput, initInput } from './systems/input.js';
import { initInteract, updateInteractMarker, updatePrompt } from './systems/interact.js';
import { updateLawless, updateWanted, wanted } from './systems/law.js';
import { updateFrostPatches, updateMagic } from './systems/magic.js';
import { mercs, updateMercs } from './systems/mercs.js';
import { initMirror, updateIdle, updateWorkspace, workspace } from './systems/mind.js';
import { funnyNPCs, initNPCs, namedNPCs, steward, updateArm, updateNPCs } from './systems/npcs.js';
import { initPickups, updateCoinInstances, updatePickups } from './systems/pickups.js';
import {
  enforceDeepWater, spawnPlayer, updateBuffs, updatePlayer, updateRegen, updateSquash,
} from './systems/player.js';
import { updateArrows } from './systems/projectiles.js';
import { prologue, updatePrologue } from './systems/prologue.js';
import {
  animateBeacon, beacon, beaconRouted, exGroup, initQuests, quest, updateQuest,
} from './systems/quests.js';
import {
  animateScenery, animateWater, followUnderlay, followVista, tickFilmGrain, updateAmbientFX,
} from './systems/scenery.js';
import { fitViewDistance, lantern, updateDayNight, updateEnvIntensity } from './systems/sky.js';
import { updateVendetta } from './systems/vendetta.js';
import { updateWarband, warband } from './systems/warband.js';
import { updateDust, updateRain, updateWeather, weather } from './systems/weather.js';
import { buildCoreGround, buildMasks, getGroundMaterial } from './terrain.js';
import { generateRemoteAITextures, preloadAIAssets } from './textures.js';
import { updateBubble, updateDialogRange, villagerChatter } from './ui/dialog.js';
import {
  updateCombo, updateDamageNums, updateFalls, updateFlashes, updateKnockback, updateLowHp,
} from './ui/feedback.js';
import { updateActionBar, updateHUD, updateRegion } from './ui/hudview.js';
import { drawMinimap, mapState } from './ui/maps.js';
import { paused } from './ui/pause.js';
import { initTitle, loadLocalTitleArt, setTitleArt } from './ui/title.js';
import { setAmbientGate, toast, updateToast } from './ui/toast.js';
import { initVegetation, updateVegetation } from './vegetation.js';
import { updateWilderness } from './wilderness.js';
import { buildWorld } from './world.js';

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
scatterCoreLandmarks(); // 核心王国的群系地标、树林、路灯与路牌(src/landmarks.js)

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

// ================= 玩家与各系统(顺序 = 建场顺序;实体名单的顺序也由它决定) =================
bindPlayer(spawnPlayer(world.playerSpawn));
initActors();     // 马、卫兵、村民、狼窝,接上荒野生成钩子
initFauna();      // 鸡、羊、灰烬荒地匪帮、鹿、蘑菇、隘口白狼
initActivities(); // 篝火温泉、赛旗、地窖与守墓者、村务板、铭文石碑、公告牌
initQuests();     // 委托人埃隆、头顶的"!"、目标光柱
initEvents();     // 悬赏板、角斗场与场主血牙
initHome();       // 湖畔小屋、信箱、萤火
initNPCs();       // 具名 NPC、管家(复用委托人的身体)、搞笑 NPC
initQuality();    // 读回上次的画质档
initInteract();   // 交互目标标记
initMirror();     // 北境边缘的回响之镜
initPickups();    // 金币实例化网格、开局金币

// ================= 读档 → 标题画面 → 输入 =================
const hasSave = loadGame(); // 分段读取,坏档不覆盖(core/save.js)
applyProgress();            // 进度落到世界里:没捡的纹章、装备外观、通关之星、体力上限、季节、皇家骏马
initTitle(hasSave);         // 世界观开场、存档信息、Delete 清档(先于玩法键盘监听)、点击开局
initInput();                // 键鼠监听:玩法动作入队,tick 开头统一执行
initCombat();               // 锁定标记
initAttack();               // 蓄力光与圆盾挂上玩家手臂

// ---- 回调登记:相机/天空/天气/地图这些底层模块经 core/ctx.js 取回调(它们不依赖玩法模块) ----
ctx.getLockFoe = () => lockFoe;
ctx.isWinter = isWinter;
ctx.toast = toast;
ctx.mood = () => workspace.mood.v;
ctx.inDungeon = inDungeon;
setAmbientGate(() => quest.active || prologue.on); // 氛围提示:有委托在办、序章里时不播
trackEntityLists([villagers, guards, bandits, wolves, horses, namedNPCs, chickens, deers, funnyNPCs, mercs]); // 兜底远近分级
// 地图快照:地图模块只读这些,不碰玩法状态(小地图每两帧取一次:复用同一个对象,不分配)
const mapSnap = { guards, bandits, horses, wanted, warband, beacon, beaconRouted, questGiver: null, wildSpots };
const mapQuestGiver = { x: 0, z: 0 };
ctx.mapView = () => {
  mapSnap.wanted = wanted;
  mapSnap.beaconRouted = beaconRouted;
  mapSnap.questGiver = exGroup.visible ? mapQuestGiver : null;
  if (mapSnap.questGiver) { mapQuestGiver.x = steward.pos.x; mapQuestGiver.z = steward.pos.z; }
  return mapSnap;
};

// ================= 主循环:有序的系统表 =================
// 每帧按表的顺序调用 update(dt, now);dt 已按打击停顿/慢镜缩放,now 是帧时钟(毫秒)。
// 顺序就是语义(例如:先结算计时器、再动玩家、再动 AI;HUD 与小地图最后读状态),改顺序要当心——
// tests/run.mjs 的 systems 用例锁着这张表。
const SYSTEMS = [
  // 界面与通用计时
  { name: 'toast', update: updateToast },
  { name: 'dialogRange', update: updateDialogRange },
  { name: 'hitFlash', update: updateFlashes },
  { name: 'timers', update: updateTimers },
  { name: 'interactMarker', update: updateInteractMarker },
  // 玩家
  { name: 'player', update: updatePlayer },
  { name: 'regen', update: updateRegen },
  { name: 'attackInput', update: updateAttackInput },
  { name: 'knockback', update: updateKnockback },
  { name: 'buffs', update: updateBuffs },
  { name: 'rideMileage', update: updateRideMileage },
  { name: 'deepWater', update: (dt, now) => enforceDeepWater(now) },
  // 同伴与场所
  { name: 'frostfang', update: updateFrostfang },
  { name: 'springs', update: updateSprings },
  { name: 'timeTrial', update: updateTrial },
  { name: 'cryptLights', update: updateCryptLights },
  { name: 'altarGlow', update: updateAltarGlow },
  // 世界里的人与动物
  { name: 'guards', update: updateGuards },
  { name: 'bandits', update: updateBandits },
  { name: 'wolves', update: updateWolves },
  { name: 'chickens', update: updateChickens },
  { name: 'villagers', update: updateVillagers },
  { name: 'horses', update: updateHorses },
  { name: 'deer', update: updateDeers },
  // 委托、王法、玩法事件
  { name: 'pickups', update: updatePickups },
  { name: 'quest', update: updateQuest },
  { name: 'wanted', update: updateWanted },
  { name: 'fishing', update: updateFishing },
  { name: 'projectiles', update: updateArrows },
  { name: 'damageNumbers', update: updateDamageNums },
  { name: 'combo', update: updateCombo },
  { name: 'falls', update: updateFalls },
  { name: 'arena', update: updateArena },
  { name: 'director', update: updateDirector },
  { name: 'streetEvent', update: updateStreetEvent },
  { name: 'bounty', update: updateBounty },
  { name: 'armWrestle', update: updateArm },
  { name: 'home', update: updateHome },
  { name: 'firefly', update: updateFirefly },
  { name: 'vista', update: followVista },
  // 法术与战斗
  { name: 'magic', update: updateMagic },
  { name: 'frostPatches', update: updateFrostPatches },
  { name: 'trails', update: updateTrails },
  { name: 'telegraphs', update: updateDanger },
  { name: 'lockOn', update: updateLock },
  { name: 'prologue', update: updatePrologue },
  { name: 'lawless', update: updateLawless },
  { name: 'warband', update: updateWarband },
  { name: 'dragon', update: updateDragon },
  { name: 'combatMusic', update: updateCombatMusic },
  { name: 'squash', update: updateSquash },
  { name: 'mercs', update: updateMercs },
  { name: 'vendetta', update: updateVendetta },
  // 天气、氛围与城里的人声
  { name: 'weather', update: updateWeather },
  { name: 'ambience', update: updateAmbience },
  { name: 'region', update: updateRegion },
  { name: 'bubble', update: updateBubble },
  { name: 'chatter', update: villagerChatter },
  { name: 'npcs', update: updateNPCs },
  { name: 'rain', update: updateRain },
  { name: 'ambientFX', update: updateAmbientFX },
  { name: 'dust', update: updateDust },
  { name: 'dayNight', update: updateDayNight },
  { name: 'lightPool', update: () => updateLightPool(player.pos.x, player.pos.z) },
  { name: 'calendar', update: updateCalendar },
  { name: 'workspace', update: updateWorkspace },
  { name: 'idle', update: updateIdle },
  // 流式世界、镜头与布景
  { name: 'wilderness', update: () => updateWilderness(player.pos.x, player.pos.z) }, // 无尽荒野区块流式加载
  { name: 'vegetation', update: (dt) => updateVegetation(dt, player.pos.x, player.pos.z,
    1 + weather.rain * (weather.state === 'storm' ? 1.6 : 0.8)) },
  { name: 'underlay', update: followUnderlay },
  { name: 'camera', update: updateCamera },
  { name: 'scenery', update: animateScenery },
  { name: 'beacon', update: animateBeacon },
  { name: 'water', update: animateWater },
  { name: 'envLight', update: updateEnvIntensity },
  // 画面反馈与 HUD(读状态,不改玩法)
  { name: 'lowHp', update: updateLowHp },
  { name: 'coins', update: (dt, now) => updateCoinInstances(now) },
  { name: 'entityLOD', update: updateEntityLOD },
  { name: 'prompt', update: updatePrompt },
  { name: 'hud', update: updateHUD },
  { name: 'actionBar', update: updateActionBar },
  { name: 'minimap', update: () => { if (frame.n % 2 === 0) drawMinimap(); } }, // 小地图 30Hz 足够
  { name: 'filmGrain', update: (dt, now) => tickFilmGrain(now) },
  { name: 'frameCount', update: () => { frame.n++; } },
];

// 一帧的全部模拟(不含渲染):主循环与测试步进(__gtm.step)共用。
// 输入先入队、在这里按发生顺序生效(在 dt 缩放之前:本帧出手触发的打击停顿当帧就生效)。
function tick(dt, now) {
  drainInput();
  dt = scaleDt(dt); // 打击停顿 / 处决慢镜(core/timefx.js)
  for (let i = 0; i < SYSTEMS.length; i++) SYSTEMS[i].update(dt, now);
}

let last = performance.now();
let lastFrameNow = last;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame.now = now;
  const simulating = started && !paused && !mapState.open; // 暂停/看地图:世界冻结,仅渲染
  if (simulating) {
    unsnapScene();
    tick(dt, now);
  }
  autoQuality((now - lastFrameNow) / 1000, simulating);
  lastFrameNow = now;
  snapScene();
  fitViewDistance();
  renderer.shadowMap.needsUpdate = true;
  composer.render();
}

installTestHooks({ tick, systems: SYSTEMS, worldTops });

// ---- 渲染准备:所有系统都建好了场景,再做一次性的点光入池、静态合批与着色器预热 ----
poolSceneLights(lantern);
batchStaticWorld(world, worldTops, preWorldTops, [exGroup]); // 委托人头顶的"!"是远远找人用的,不剔
warmShaders({ trailMat, burstGeo: magBurstGeo, burstMats: [magBurstMat, dangerMat] });
requestAnimationFrame(loop);
