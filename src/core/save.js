// 存档:单一的存档格式定义处(gth-save-v1,带版本号 v,当前 v3)。
// saveGame() 把各系统的状态写成一份 JSON;loadGame() 分段读取,每段独立 try——任一段失败:本局停用自动存档
// (saveBlocked)、原档另存 gth-save-v1-bak 并提示玩家;版本迁移写在对应段里。读档发生在启动装配中途,
// 所以这里写入的各系统状态对象都必须在模块加载时就已初始化(不能是 main.js 里的局部声明)。
// FRESH_START:开局时有没有存档(新档才演序章)。
import * as BANKS from '../dialogue-banks.js';
import { achUnlocked, stats } from '../systems/achievements.js';
import { lakeBlessed, loreRead, setLakeBlessed, sideQuest } from '../systems/activities.js';
import { addHorse, wolves } from '../systems/actors.js';
import { applySeason, calendar } from '../systems/calendar.js';
import { EVO } from '../systems/evo.js';
import { frostfang } from '../systems/fauna.js';
import { ARMORS, setArmorVisual, setWeaponVisual } from '../systems/gear.js';
import { paintHomeSign, refreshTrophies } from '../systems/home.js';
import { SKILL_DEFS, SPELLS, shout } from '../systems/magic.js';
import { hireMercSilent, mercs } from '../systems/mercs.js';
import { chronicle, mindLoad, mindSave } from '../systems/mind.js';
import { namedNPCs } from '../systems/npcs.js';
import { addPickup, crestsFound } from '../systems/pickups.js';
import { recomputeMaxHp, recomputeMaxSta } from '../systems/player.js';
import { missions, quest } from '../systems/quests.js';
import { vendetta } from '../systems/vendetta.js';
import { toast } from '../ui/toast.js';
import { player, world } from './state.js';

// ================= 存档 =================
export const SAVE_KEY = 'gth-save-v1';
export const FRESH_START = !localStorage.getItem(SAVE_KEY); // 新档才演序章
let saveIconTimer = null;
export let saveBlocked = false; // 读档失败时置真:不自动覆盖原档
const SAVE_VERSION = 3; // v3:委托③④互换(剿匪提前到竞速之前)
export function saveGame() {
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
export function loadGame() {
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

// 读档(或新档)之后把进度落到世界里:没捡的纹章、手中武器与护甲的外观、补授魔光弹、通关之星、
// 体力上限(不入档,按技艺与军旗重算)、季节地表、皇家骏马。启动装配在 loadGame() 之后调用一次。
export function applyProgress() {
  world.crestSpots.forEach(([x, z], i) => {
    if (!crestsFound.includes(i)) addPickup('crest', x, z, Infinity, i);
  });
  setWeaponVisual(player.weapon);
  // 基础魔法与生俱来:老档也补上魔光弹
  if (!player.spells.includes('spark')) player.spells.unshift('spark');
  // 通关之星:completeMission 存档发生在生成星星之前,读档时没领过就补一颗在广场
  if (quest.idx >= missions.length && !stats.starTaken) addPickup('star', 0, 13);
  recomputeMaxSta();
  player.sta = player.maxSta;
  setArmorVisual(player.armor);
  applySeason();
  if (player.royalHorse) {
    const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
    rh.fast = true;
  }
}
