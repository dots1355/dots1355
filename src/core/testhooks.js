// 测试/诊断句柄 window.__gtm:tests/run.mjs 用它驱动固定步长模拟(step)、摆场景、读状态。
// 只在启动装配的最后安装一次;这里只取引用、不持有状态。step(n, dt) 与主循环共用同一个 tick。
import { resolveCollisions } from '../entities.js';
import {
  STYLE_PRESETS, applyStyle, bloom, camera, cycleStyle, gradePass, renderer, scene, styleKey,
} from '../gfx/core.js';
import { snapScene, unsnapScene } from '../gfx/snap.js';
import { LORE } from '../story.js';
import { achUnlocked, stats } from '../systems/achievements.js';
import {
  BOAT_ISLE, BOAT_PIER, CHORE_POS, DGN, FISH_SPOT_ISLE, choreBoard, choreProgress, enterDungeon,
  exitDungeon, fishing, inDungeon, loreRead, loreStones, nearestSpot, openJournal, prayAltar,
  proclaimText, queueDream, refreshProclaim, rowTo, sideQuest, startTrial, takeRelic, togglePhoto,
  trialRT, wildSpots,
} from '../systems/activities.js';
import { bandits, guards, horses, villagers, wolves } from '../systems/actors.js';
import { attackDown, attackUp, heavyAttack, tryAttack } from '../systems/attack.js';
import {
  applySeason, calendar, composeLetter, newDay, seasonDay, seasonIdx, sleepToMorning, todaySpecial,
} from '../systems/calendar.js';
import { cam } from '../systems/camera.js';
import {
  applyDamage, banditSlain, combatCalmT, dangerFX, faceNearestFoe, flinch, foeName, frightenBandits,
  killWolf, lockFoe, lockMark, slayBandit, telegraphFlash, toggleLock, trailFX,
} from '../systems/combat.js';
import { DIRECTOR_EVENTS, director } from '../systems/director.js';
import { awakenDragon, damageDragon, dragonRT, telegraphArea } from '../systems/dragon.js';
import {
  arenaHost, arenaRT, bountyRT, startArenaWave, streetEvent, takeBounty, trySpawnStreetEvent,
} from '../systems/events.js';
import {
  EVO, evolveLegends, evolveTactics, growCorpus, legendText, mutateLegend, seedLegend,
} from '../systems/evo.js';
import { chickens, deers, frostfang, mushrooms, respawnMushrooms, revengeT } from '../systems/fauna.js';
import { WEAPONS, cycleWeapon, openShop, refreshShop } from '../systems/gear.js';
import { HOME, fireflyMesh, homeInteract, homeRT, refreshTrophies } from '../systems/home.js';
import { keys } from '../systems/input.js';
import { computePrompt, interactionRules, promptText, tryInteract } from '../systems/interact.js';
import { crime, downGuard, lawlessT, wanted } from '../systems/law.js';
import {
  DRAGON_SKULL, SKILL_DEFS, SPELLS, castBigFire, castSpell, cycleSpell, doShout, dragonAim, explodeAt,
  frostPatches, frostSlow, learnShout, learnSpell, shout, skillXp, sneakFactor, spellDown, spellUp,
  spendSta, toggleSneak,
} from '../systems/magic.js';
import { hireMerc, mercs, payMercs } from '../systems/mercs.js';
import {
  MIND, MIND_WISHES, MIRROR_POS, archetype, chronicle, consolidate, habitFactor, idle, mindFavorite,
  mindMakeWish, mindReport, mindSave, mindTick, mirrorTalk, moodWord, remember, updateWorkspace,
  workspace, wsReport,
} from '../systems/mind.js';
import { armPress, armRT, armWrestle, funnyNPCs, namedNPCs, steward, tellStory } from '../systems/npcs.js';
import { crestsFound } from '../systems/pickups.js';
import { damagePlayer, doRoll, recomputeMaxHp, tryRob } from '../systems/player.js';
import { arrows } from '../systems/projectiles.js';
import { prologue, skipPrologue, startPrologue } from '../systems/prologue.js';
import { beacon, completeMission, missions, quest, questRT, talkQuestGiver } from '../systems/quests.js';
import { clock } from '../systems/sky.js';
import { updateVendetta, vendetta, vendettaLetter, vendettaRead } from '../systems/vendetta.js';
import { WARLORD_TAUNTS, spawnWarband, updateWarband, warband } from '../systems/warband.js';
import { setWeather, weather } from '../systems/weather.js';
import { groundH } from '../terrain.js';
import { advanceDialog, dialog, witchFortune } from '../ui/dialog.js';
import { callout, flashing, registerKill, whiteHot } from '../ui/feedback.js';
import { toastQueue } from '../ui/toast.js';
import { CORE } from '../wilderness.js';
import { frame } from './frame.js';
import { seed } from './rng.js';
import { loadGame, saveBlocked, saveGame } from './save.js';
import { colliders, player, world } from './state.js';
import { pendingTimers, simNow } from './timers.js';

export function installTestHooks({ tick, systems, worldTops }) {
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
  systems: () => systems.map((s) => s.name), // 主循环系统表(按执行顺序)
  frameNo: () => frame.n,
  interactionRules, // E 键交互规则表(按优先级)
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
  attackDown, attackUp, callout, flinch, telegraphArea, dragonAim, seedRng: seed, applyDamage,
  worldTops: () => worldTops,
  getPrompt: () => { computePrompt(); return promptText; },
  groundH,
  };
}
