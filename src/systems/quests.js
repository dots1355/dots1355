// 领主委托链:missions(story.js 的委托表)、进度 quest{idx,active,progress,timer}(随存档)、运行时对象 questRT。
// 委托人管家埃隆(questGiver,头顶金色「!」exGroup)接单/交差(talkQuestGiver、completeMission、failMission),领赏面板;
// 主线收尾进度 mainlineLeft / 读档欢迎语 welcomeLine。
// 每种委托的布置与推进在表 KINDS(start / tick / unfinished / after,按 m.type 查):快递的骑马追兵与磨坊主、
// 营地、内鬼的信使、竞速高环、受惊的白马、护送伏击、头狼、Boss。
// 目标光柱 beacon:updateQuest(dt) 每帧推进委托并摆光柱;隔着城墙/河/湖时经航点图(nav.js)先指下一跳(routeVia)。
// initQuests() 启动装配调用一次。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { saveGame } from '../core/save.js';
import { later } from '../core/timers.js';
import { colliders, player, world } from '../core/state.js';
import { angleLerp, dist2, lambert, makeHorse, makeHumanoid, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { MISSIONS } from '../story.js';
import { VILLAGER_DESC_EN, openDialog } from '../ui/dialog.js';
import { callout } from '../ui/feedback.js';
import { dropQuestToasts, toast, toastNow, toastQuest } from '../ui/toast.js';
import { stats } from './achievements.js';
import { endTrial, inDungeon, trialRT } from './activities.js';
import {
  addBandit, addHorse, addWolf, animHorseLegs, animateLimbs, bandits, moveEntityHorse, retireEntity, villagers, wolves,
} from './actors.js';
import { dayPhase } from './calendar.js';
import { bountyRT } from './events.js';
import { remember } from './mind.js';
import { navNext, navPath } from './nav.js';
import { namedNPCs, steward } from './npcs.js';
import { addPickup } from './pickups.js';
import { prologue, setTutor } from './prologue.js';

// ================= 任务系统 =================
export const missions = MISSIONS;
export const quest = { idx: 0, active: false, progress: 0, timer: 0 };
// 任务运行时对象
// mcStriker / mcNextAt:护送时"谁正在砍商人、下一刀最早何时"(ai.js 的伏兵逻辑读写,保证同一时间只有一人下手)
// riders:快递路上的黑石骑手;runner:内鬼的信使;alpha/pack:狼灾的头狼与随行的狼
export const questRT = { rings: [], ringIdx: 0, merchant: null, specialHorse: null, boss: null, escortSpawned: 0,
  ambush: false, mcStriker: null, mcNextAt: 0, riders: [], runner: null, alpha: null, pack: [] };
const ESCORT_HP = 6; // 商人每波伏击前回满

// 委托人(金色衣服的老者):人形模型就绪后才能建,启动装配时生成
export let questGiver = null;
// 头顶“!”
export const exGroup = new THREE.Group();
const exBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
const exDot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
// 目标光柱
export const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));


function clearRaceRings() {
  for (const r of questRT.rings) scene.remove(r);
  questRT.rings = [];
}
export function dismissMinions() {
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
// 委托专属的人和牲口(骑手的马、信使、头狼与狼群)随委托结束一并退场;倒下的狼留 3 秒尸体再收
function clearMissionActors() {
  for (const r of questRT.riders) retireEntity(r.h);
  questRT.riders = [];
  if (questRT.runner) { retireEntity(questRT.runner); questRT.runner = null; }
  for (const w of questRT.pack) {
    if (w.dead) later(3, () => retireEntity(w, wolves));
    else retireEntity(w, wolves);
  }
  questRT.pack = [];
  questRT.alpha = null;
  pinMiller(false);
}
function failMission(msg) {
  quest.active = false;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { retireEntity(questRT.merchant); questRT.merchant = null; }
  removeEscortBandits(); // 伏兵随任务失败一并撤走,否则重接任务时旧伏兵会追杀新商人
  clearMissionActors();
  dropQuestToasts(); // 还在排队的进度提示(金环、商人受袭……)都过时了
  toastNow(msg, 4); // 失败原因当场说清,不排在别的提示后面
}
// 埃隆在哪:白天在喷泉广场,夜里回城堡(和他的作息表一致)
export function stewardWhere() { return dayPhase() === 'night' ? '城堡' : '喷泉广场'; }
// 信使带来的委托书:不计时的委托办完后可以原地接下一单(计时委托要回城找埃隆,免得一接就超时)
export function canAcceptRemotely() {
  const nx = missions[quest.idx];
  return !!nx && !quest.active && !nx.time && quest.offerT > 0;
}
// 主线收尾还差什么:全部委托完成后先去喷泉广场领勋章('medal')、再去城堡见领主('king'),都办完了是 'free';
// 主线没走完返回 null。HUD 任务栏、读档欢迎语、埃隆的话都按它写
export function mainlineLeft() {
  if (quest.idx < missions.length) return null;
  if (!stats.starTaken) return 'medal';
  const king = namedNPCs.find((n) => n.key === 'king');
  return king && !king.rewarded ? 'king' : 'free';
}
export function welcomeLine() {
  const left = mainlineLeft();
  if (left === 'medal') return '欢迎回来,英雄!全部委托已经完成——去喷泉广场领金狮勋章,再去城堡见领主。';
  if (left === 'king') return '欢迎回来,英雄!领主奥德里克在城堡等你领赏。';
  if (left === 'free') return '欢迎回来,王国之友!艾尔德里亚太平了——荒野、遗迹和节庆随你去闯。';
  if (quest.idx === 0) return '欢迎来到艾尔德里亚!去喷泉广场找管家埃隆接取委托吧(按 E 互动,光柱指路)';
  return `欢迎回来!下一单:${missions[quest.idx].title}——去${stewardWhere()}找管家埃隆(光柱指路)`;
}
export function talkQuestGiver(remote = false) {
  if (quest.idx >= missions.length) {
    toast(mainlineLeft() === 'free' ? '埃隆:领主的赏赐收到了吧?往后王国的事,也是你的事了——常回来看看。'
      : '埃隆:王国感谢你,勇者!去见领主大人吧,他有话对你说。', 3.5);
    return;
  }
  const m = missions[quest.idx];
  if (!quest.active) {
    quest.active = true;
    quest.progress = 0;
    quest.timer = m.time || 0;
    quest.offerT = 0;
    sfx.accept();
    dropQuestToasts(); // 上一次(失败的)尝试留下的提示作废
    openDialog(remote ? ['(王室信使勒住马,递来一封盖着火漆的委托书)', m.brief.replace(/^埃隆:/, '埃隆(信中):')] : [m.brief]);
    toastQuest(`接受委托【${m.title}】:${m.desc}`, 4.5);
    KINDS[m.type].start?.(m);
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
export function completeMission() {
  const m = missions[quest.idx];
  if (KINDS[m.type].unfinished?.(m)) return; // 例如狼杀够了、头狼还活着
  player.coins += m.reward;
  remember(`替领主府办结了委托「${m.title}」`, `m-${quest.idx}`);
  sfx.fanfare();
  const nx = missions[quest.idx + 1];
  showReward('委 托 完 成', m.title, `🪙 +${m.reward} 金币`,
    !nx ? '全部委托完成!去喷泉广场领取金狮勋章,再去见领主。'
      : nx.time ? `下一单:${nx.title} —— ${nx.desc}\n限时委托:回${stewardWhere()}找管家埃隆接取(光柱指路)`
        : `下一单:${nx.title} —— ${nx.desc}\n王室信使到了:20 秒内按 E 原地接下(骑在马上也行;错过了就回${stewardWhere()}找埃隆)`);
  quest.active = false;
  quest.idx++;
  quest.offerT = nx && !nx.time ? 20 : 0;
  dropQuestToasts(); // 上一单的过期提示作废
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { retireEntity(questRT.merchant); questRT.merchant = null; }
  removeEscortBandits();
  clearMissionActors();
  saveGame();
  KINDS[m.type].after?.();
  if (quest.idx >= missions.length) {
    addPickup('star', 0, 13);
    toastQuest('全部委托完成!去喷泉广场领取 ★ 金狮勋章 ★,再去见领主领赏!', 6);
  }
}
// 光柱寻路:玩家与目标之间隔着城墙/银月河/银月湖时,光柱与小地图箭头先指向航点图(systems/nav.js)给的下一跳
// (城角、门外/门内点、木桥两端、湖岸),直走就能到时指真目标。玩家或目标挪动 1.5 米以上、或过了 0.4 秒才重算
const via = { hop: null, px: 1e9, pz: 1e9, tx: 1e9, tz: 1e9, t: 0 };
function routeVia(tx, tz, dt) {
  if (inDungeon()) return null;
  const px = player.pos.x, pz = player.pos.z;
  via.t -= dt;
  if (via.t <= 0 || Math.abs(px - via.px) + Math.abs(pz - via.pz) > 1.5 || Math.abs(tx - via.tx) + Math.abs(tz - via.tz) > 1.5) {
    via.hop = navNext(px, pz, tx, tz, via.hop);
    via.px = px; via.pz = pz; via.tx = tx; via.tz = tz; via.t = 0.4;
  }
  return via.hop;
}
export let beaconRouted = null; // 被改道到城门时记下真目标,下一帧先还原再让任务逻辑更新
export function updateQuest(dt) {
  if (beaconRouted) {
    beacon.position.x = beaconRouted.x;
    beacon.position.z = beaconRouted.z;
    beaconRouted = null;
  }
  updateQuestTarget(dt);
  if (beacon.visible) {
    const hop = routeVia(beacon.position.x, beacon.position.z, dt);
    if (hop) {
      beaconRouted = { x: beacon.position.x, z: beacon.position.z };
      beacon.position.x = hop.x;
      beacon.position.z = hop.z;
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
  if (questRT.millerHoldT > 0) { // 送完快递,卢卡斯在门口多站一会儿
    questRT.millerHoldT -= dt;
    keepMillerAtMill();
    if (questRT.millerHoldT <= 0 && !(quest.active && missions[quest.idx].type === 'deliver')) pinMiller(false);
  }
  if (!quest.active || player.dead) return;
  const m = missions[quest.idx];
  KINDS[m.type].tick(m, dt);
}
function aimBeacon(x, z) { beacon.visible = true; beacon.position.x = x; beacon.position.z = z; }

// ================= 各类委托 =================
// 每种委托:接单时摆什么(start)、每帧怎么推进(tick)、够数了还差什么(unfinished:返回真 = 先别结算)、结算后说什么(after)。
// talkQuestGiver / updateQuestTarget / completeMission 按 m.type 查这张表
const KINDS = {
  coins: {
    tick(m) {
      beacon.visible = quest.progress >= m.goal; // 捡够了:光柱指回埃隆交差
      beacon.position.x = steward.pos.x;
      beacon.position.z = steward.pos.z;
    },
  },
  deliver: {
    start() {
      const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.3), lambert(0xb4813f));
      parcel.position.set(0, 1.0, -0.24);
      player.group.add(parcel);
      player.parcel = parcel;
      questRT.deliverAmbush = false;
      pinMiller(true);
      keepMillerAtMill(true); // 接单时你在城里,他看不见你:直接请到磨坊门口
    },
    tick(m, dt) {
      quest.timer -= dt;
      aimBeacon(world.windmillPos.x, world.windmillPos.z);
      // 半路截道:出了东门、离磨坊还远时,两个黑石骑手从林边杀出来追你
      if (!questRT.deliverAmbush && player.pos.x > 84 &&
          dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) > 30 * 30) {
        questRT.deliverAmbush = true;
        spawnRiders();
        toastQuest('⚠️ 两个黑石骑手从林边杀出:「把包裹留下!」(疾驰甩开他们,或者砍下马)', 3.5);
        sfx.wanted();
      }
      updateRiders(dt);
      keepMillerAtMill();
      if (dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) < 49) deliverParcel();
      else if (quest.timer <= 0) {
        questRT.deliverAmbush = false;
        failMission('投递超时!回去找埃隆重新接取…');
      }
    },
  },
  bandits: {
    start() {
      for (const [ox, oz] of [[-4, 2], [4, -2], [0, 6]]) addBandit(world.banditCamp.x + ox, world.banditCamp.z + oz).campFoe = true;
      // 营地头目:会二连击和紫色破盾重击(第一次见紫色会弹教学卡)
      const cap = addBandit(world.banditCamp.x, world.banditCamp.z - 4, { hp: 5, dmg: 2, speed: 5.6, scale: 1.12 });
      cap.elite = true;
      cap.captain = true;
      cap.campFoe = true;
    },
    tick(m) {
      beacon.visible = quest.progress < m.goal;
      beacon.position.x = world.banditCamp.x;
      beacon.position.z = world.banditCamp.z;
    },
    after() { // 剧情转折的引子:头目身上的信(下一单「内鬼的信使」由此而来)
      openDialog(['(你在营地头目身上搜出一封信——火漆上竟是领主府的鹿纹印。)',
        '(信里写着:「今日午后,哨塔遗迹,老地方交接。」……这得让埃隆看看。)']);
    },
  },
  courier: {
    start() { questRT.runner = null; }, // 走近哨塔遗迹时信使才现身(见 updateCourier)
    tick(m, dt) { updateCourier(dt); },
  },
  race: {
    start(m) {
      if (trialRT.active) endTrial(false); // 接正赛前先收计时赛的环
      questRT.ringIdx = 0;
      questRT.ringUnder = false;
      clearRaceRings();
      const high = new Set(m.high || []);
      world.raceRoute.forEach(([rx, rz], i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
          new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x996600, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
        ring.userData.high = high.has(i); // 高环:挂得高,要跃马(空格)穿过去
        ring.position.set(rx, ring.userData.high ? 3.7 : 2.4, rz);
        scene.add(ring);
        questRT.rings.push(ring);
      });
    },
    tick(m, dt) {
      quest.timer -= dt;
      if (quest.timer <= 0) { failMission('超时!回去找埃隆再试一次…'); return; }
      updateRace(dt);
    },
  },
  losthorse: {
    start() {
      if (!questRT.specialHorse) {
        questRT.specialHorse = addHorse(world.lostHorsePos.x, world.lostHorsePos.z, 0xf2efe6, false);
        questRT.specialHorse.special = true;
      }
    },
    tick(m, dt) {
      const sh = questRT.specialHorse;
      if (!sh) return;
      if (player.mounted !== sh) { aimBeacon(sh.pos.x, sh.pos.z); updateSkittish(sh, dt); return; }
      aimBeacon(world.stablePos.x, world.stablePos.z);
      if (dist2(player.pos.x, player.pos.z, world.stablePos.x, world.stablePos.z) < 100) {
        sh.home.copy(world.stablePos);
        sh.owned = false;
        completeMission();
        toastQuest('雪影归你了!它就在马厩等你。', 4);
      }
    },
  },
  escort: {
    start() {
      const mc = { ...makeHumanoid({ shirt: 0xb4813f, pants: 0x4a3a26, hair: 0x3a2a1a }),
        pos: new THREE.Vector3(world.escortRoute[0][0], 0, world.escortRoute[0][1]),
        yaw: 0, hp: ESCORT_HP, maxHp: ESCORT_HP, wp: 0, walkT: 0, crouch: 0, hurtT: 0 };
      mc.group.position.copy(mc.pos);
      scene.add(mc.group);
      questRT.merchant = mc;
      questRT.escortSpawned = 0;
      questRT.ambush = false;
      questRT.mcStriker = null;
      questRT.mcNextAt = 0;
    },
    tick(m, dt) {
      const mc = questRT.merchant;
      if (!mc) return;
      aimBeacon(mc.pos.x, mc.pos.z);
      if (mc.hp <= 0) { failMission('商人巴特倒下了……回去找埃隆重整旗鼓。'); return; }
      updateEscort(mc, dt);
    },
  },
  wolves: {
    start() {
      // 独眼头狼:大一圈、更扛揍,带两头狼守在林子里;狼杀够了它不死也不算完(见 unfinished)
      const a = addWolf(-140, -40);
      a.alpha = true;
      a.hp = a.maxHp = 9;
      a.speed += 0.8;
      a.group.scale.setScalar(1.35);
      questRT.alpha = a;
      questRT.pack = [a, addWolf(-134, -47), addWolf(-147, -33)];
    },
    tick() {
      const a = questRT.alpha;
      if (a && !a.dead) aimBeacon(a.pos.x, a.pos.z);
      else aimBeacon(-140, -40);
    },
    unfinished(m) {
      if (!questRT.alpha || questRT.alpha.dead) return false;
      quest.progress = Math.min(quest.progress, m.goal - 1);
      toastQuest('🐺 狼是杀够了,可独眼头狼还在林子里嚎——光柱指着它', 3, 'wolves');
      return true;
    },
  },
  boss: {
    start() {
      questRT.boss = addBandit(world.fortPos.x, world.fortPos.z - 2,
        { boss: true, hp: 12, speed: 6.8, scale: 1.35, dmg: 2 });
      addBandit(world.fortPos.x - 5, world.fortPos.z + 3);
      addBandit(world.fortPos.x + 5, world.fortPos.z + 3);
      toastQuest('⚔️ 血斧巴罗克在黑石要塞等着你……', 4);
    },
    tick() {
      if (!questRT.boss) return;
      aimBeacon(questRT.boss.pos.x, questRT.boss.pos.z);
      if (questRT.boss.dead) {
        questRT.boss = null;
        completeMission();
        toastNow('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 4); // 不管是刀、箭还是法术收的尾,倒下的这一刻就播
      }
    },
  },
};
// ② 送到磨坊:卢卡斯在门口接包裹(说完话再在门口站一会儿,夜里也别当着你的面钻回屋)
function deliverParcel() {
  const ambushed = questRT.deliverAmbush;
  questRT.deliverAmbush = false;
  const miller = millerVillager();
  if (miller) miller.yaw = Math.atan2(player.pos.x - miller.pos.x, player.pos.z - miller.pos.z);
  completeMission();
  openDialog([
    '磨坊主卢卡斯:(接过包裹,掂了掂)总算到了!这是今年的麦价文书——落到黑石那帮人手里,他们能把全城的面包价抬上天。',
    ambushed ? '卢卡斯:路上碰到追你的骑手了?……嗯,他们最近盯磨坊盯得紧。替我谢谢埃隆,也谢谢你。'
      : '卢卡斯:一路太平?那是你跑得快。最近黑石的人常在东路上晃悠,往后走这条路多留个心眼。',
  ], null, miller ? { key: miller.dbKey, name: '磨坊主卢卡斯', desc: VILLAGER_DESC_EN[villagers.indexOf(miller)],
    // 对话跟着说话人走远自动收起:他就在跟前才挂到他身上(还在路上走着的话挂在交包裹的地方)
    ...(dist2(miller.pos.x, miller.pos.z, player.pos.x, player.pos.z) < 64 ? { ent: miller } : {}) } : null);
  pinMiller(true);
  questRT.millerHoldT = 25;
}
// ⑤ 竞速:按顺序穿环;高环要跃马穿过——在高环底下没跳先不判,离开环区还没穿过去才提示"兜回来再跳"
function updateRace(dt) {
  const [rx, rz] = world.raceRoute[questRT.ringIdx];
  aimBeacon(rx, rz);
  questRT.rings.forEach((ring, i) => { // 高亮当前环
    ring.rotation.y += dt * (i === questRT.ringIdx ? 3 : 0.6);
    ring.material.emissiveIntensity = i < questRT.ringIdx ? 0.1 : i === questRT.ringIdx ? 1.2 : 0.4;
  });
  const high = questRT.rings[questRT.ringIdx].userData.high;
  const near = dist2(player.pos.x, player.pos.z, rx, rz) < (high ? 16 : 9);
  if (near && high && player.pos.y < 0.5) {
    questRT.ringUnder = true;
  } else if (near) {
    sfx.block();
    questRT.ringIdx++;
    questRT.ringUnder = false;
    if (questRT.ringIdx >= world.raceRoute.length) completeMission();
    else toastQuest(`金环 ${questRT.ringIdx}/${world.raceRoute.length}${questRT.rings[questRT.ringIdx].userData.high ? '(下一个是高环:跳!)' : ''}`, 1.2, 'ring');
  } else if (questRT.ringUnder) {
    questRT.ringUnder = false;
    callout('高环要跳!按空格', 'red');
    toastQuest('没跳过高环——兜回来,快到环前按空格跃马穿过去', 2.5, 'ring');
  }
}
// ② 快递的追兵:两名黑石骑手从前方林边斜插过来,骑马追你。人是普通盗贼(会砍、能被砍),脚下垫一匹不进马厩名单的马;
// 速度在小跑和疾驰之间——疾驰甩得掉,小跑会被追上砍。骑手落马,马受惊跑开,几秒后消失
function spawnRiders() {
  const dx = world.windmillPos.x - player.pos.x, dz = world.windmillPos.z - player.pos.z;
  const dd = Math.hypot(dx, dz) || 1;
  const fx = dx / dd, fz = dz / dd;
  for (const side of [-1, 1]) {
    const x = player.pos.x + fx * 14 - fz * 16 * side, z = player.pos.z + fz * 14 + fx * 16 * side;
    const b = addBandit(x, z, { hp: 2, speed: 12.5, escort: true });
    b.yaw = Math.atan2(player.pos.x - x, player.pos.z - z);
    const h = { ...makeHorse(0x3a2a20), pos: b.pos.clone(), yaw: b.yaw, walkT: 0 };
    h.group.position.copy(h.pos);
    scene.add(h.group);
    questRT.riders.push({ b, h, px: x, pz: z, fleeT: 3 });
  }
}
function updateRiders(dt) {
  for (let i = questRT.riders.length - 1; i >= 0; i--) {
    const r = questRT.riders[i], { b, h } = r;
    if (b.dead || !bandits.includes(b)) { // 落马:人摔在地上,马往远处跑
      if (!r.dropped) { r.dropped = true; b.group.position.y = 0; }
      r.fleeT -= dt;
      const ax = h.pos.x - player.pos.x, az = h.pos.z - player.pos.z, al = Math.hypot(ax, az) || 1;
      moveEntityHorse(h, h.pos.x + (ax / al) * 10, h.pos.z + (az / al) * 10, 10, dt);
      h.group.position.copy(h.pos);
      h.group.rotation.y = h.yaw;
      animHorseLegs(h, 1.6);
      if (r.fleeT <= 0) { retireEntity(h); questRT.riders.splice(i, 1); }
      continue;
    }
    const v = Math.hypot(b.pos.x - r.px, b.pos.z - r.pz) / Math.max(dt, 1e-3);
    r.px = b.pos.x; r.pz = b.pos.z;
    h.pos.set(b.pos.x, 0, b.pos.z);
    h.yaw = b.yaw;
    h.walkT += dt * v * 1.6;
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    animHorseLegs(h, v > 7 ? 1.6 : v > 0.5 ? 1 : 0);
    b.group.position.y = 1.35 + (h.visBob || 0); // 骑在鞍上(盗贼 AI 每帧把人摆回地面,这里再抬上去)
    b.parts.legL.rotation.x = -1.1;
    b.parts.legR.rotation.x = -1.1;
  }
}
// 磨坊主卢卡斯(村民)在快递期间守在磨坊门口:收包裹的人得在场——日程三处都临时改成磨坊,夜里也不回家睡
const MILL_DOOR = [136.5, 25];
function millerVillager() { return villagers.find((v) => v.id && v.id.name === '磨坊主卢卡斯') || null; }
function pinMiller(on) {
  const v = millerVillager();
  if (!v) return;
  if (on && !v._id0) {
    v._id0 = v.id;
    v.id = { ...v.id, home: MILL_DOOR, work: MILL_DOOR, leisure: MILL_DOOR };
  } else if (!on && v._id0) {
    v.id = v._id0;
    v._id0 = null;
  }
}
function keepMillerAtMill(anywhere = false) {
  const v = millerVillager();
  if (!v || (!anywhere && dist2(player.pos.x, player.pos.z, MILL_DOOR[0], MILL_DOOR[1]) > 70 * 70)) return;
  if (dist2(v.pos.x, v.pos.z, MILL_DOOR[0], MILL_DOOR[1]) > 64 &&
      dist2(v.pos.x, v.pos.z, player.pos.x, player.pos.z) > 50 * 50) { // 你还看不见他的时候,让他先到门口
    v.pos.set(MILL_DOOR[0], 0, MILL_DOOR[1]);
    v.group.position.copy(v.pos);
  }
  if (v.sleeping) { v.sleeping = false; v.group.visible = true; } // 夜里也等着收包裹
}
// ④ 内鬼的信使:走近哨塔遗迹,兜帽信使撒腿就跑——沿航点图逃回黑石要塞(北墙外 → 木桥 → 要塞);
// 贴到 2.2 米内就按倒他。你离得远时他小跑,追近了才拼命跑(9 米/秒,比人疾跑快:骑马追,或抄近路堵桥头);
// 让他逃进要塞,下一个信使会再回哨塔遗迹
const COURIER_SPOT = { x: 80, z: -118 };
function spawnRunner() {
  const r = { ...makeHumanoid({ shirt: 0x2a2a30, pants: 0x1e1e24, hair: 0x2a2018, hood: true }),
    pos: new THREE.Vector3(COURIER_SPOT.x, 0, COURIER_SPOT.z), yaw: 0, walkT: 0, leg: 0 };
  r.route = navPath(r.pos.x, r.pos.z, world.fortPos.x, world.fortPos.z).slice(1);
  r.group.position.copy(r.pos);
  scene.add(r.group);
  questRT.runner = r;
  toastQuest('🏃 哨塔边的兜帽人瞧见了你,撒腿就往西跑——追上他!', 3, 'courier');
  sfx.wanted();
}
function updateCourier(dt) {
  const r = questRT.runner;
  if (!r) {
    aimBeacon(COURIER_SPOT.x, COURIER_SPOT.z);
    if (dist2(player.pos.x, player.pos.z, COURIER_SPOT.x, COURIER_SPOT.z) < 45 * 45) spawnRunner();
    return;
  }
  aimBeacon(r.pos.x, r.pos.z);
  const pd = Math.hypot(player.pos.x - r.pos.x, player.pos.z - r.pos.z);
  if (pd < 2.2) {
    remember('截住了内鬼的信使:府里的税吏霍布投了黑石', 'courier');
    completeMission();
    openDialog([
      '黑石信使:(被你按在地上)别、别动手!我只是跑腿的——信是府里的税吏霍布给的,他收了巴罗克的金子!',
      '黑石信使:商队几时走、领主的白马拴在哪、卫兵几时换岗……全是霍布递出去的。他昨夜已经过河,投奔要塞了!',
      '(你从他怀里搜出第二封信:「白马已解缰,赶进幽暗森林。商人巴特的车队,不日走东路。——H」)',
    ]);
    return;
  }
  const tgt = r.route[r.leg];
  if (!tgt || dist2(r.pos.x, r.pos.z, world.fortPos.x, world.fortPos.z) < 14 * 14) { // 逃到要塞了
    retireEntity(r);
    questRT.runner = null;
    toastQuest('信使钻进要塞外的林子不见了……回哨塔遗迹,等下一个信使。', 3.5, 'courier');
    return;
  }
  const dx = tgt.x - r.pos.x, dz = tgt.z - r.pos.z, d = Math.hypot(dx, dz);
  if (d < 1.5) r.leg++;
  const sp = pd < 40 ? 9 : 5.5;
  if (d > 0.01) {
    r.pos.x += (dx / d) * Math.min(d, sp * dt);
    r.pos.z += (dz / d) * Math.min(d, sp * dt);
    resolveCollisions(r.pos, 0.4, colliders);
    r.yaw = angleLerp(r.yaw, Math.atan2(dx, dz), dt * 10);
  }
  r.walkT += dt * sp * 2.2;
  r.group.position.copy(r.pos);
  r.group.rotation.y = r.yaw;
  animateLimbs(r.parts, r.walkT, true, r.group, sp > 6 ? 1 : 0.6);
}
// ⑥ 受惊的白马:你骑着马、或疾跑着冲到 15 米内,它就撒蹄跑开 3.5 秒(不出幽暗森林那一片);
// 下马慢慢走到 4 米内,它认出你、不再躲,E 骑上它。你的速度取平滑后的实测值(不认按键,庇佑加速的步行不算疾跑)
function updateSkittish(sh, dt) {
  // 单帧取样封顶 20 米/秒:下马那一下(人被挪开 1.3 米)、传送不算"冲过来"
  const v = Math.min(20, Math.hypot(player.pos.x - (questRT.lastPX ?? player.pos.x),
    player.pos.z - (questRT.lastPZ ?? player.pos.z)) / Math.max(dt, 1e-3));
  questRT.lastPX = player.pos.x; questRT.lastPZ = player.pos.z;
  questRT.pSpeed = (questRT.pSpeed || 0) * 0.85 + v * 0.15;
  if (sh.calm) return;
  const d = Math.hypot(sh.pos.x - player.pos.x, sh.pos.z - player.pos.z);
  if (sh.fleeT > 0) {
    sh.fleeT -= dt;
    let ax = sh.pos.x - player.pos.x, az = sh.pos.z - player.pos.z;
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const hx = world.lostHorsePos.x - sh.pos.x, hz = world.lostHorsePos.z - sh.pos.z, hd = Math.hypot(hx, hz);
    if (hd > 35) { // 别跑出这片林子:越远越往回拐
      const k = Math.min(1.5, (hd - 35) / 10);
      ax += (hx / hd) * k; az += (hz / hd) * k;
      const l2 = Math.hypot(ax, az) || 1;
      ax /= l2; az /= l2;
    }
    moveEntityHorse(sh, sh.pos.x + ax * 10, sh.pos.z + az * 10, 9.5, dt);
    sh.group.position.copy(sh.pos);
    sh.group.rotation.y = sh.yaw;
    animHorseLegs(sh, 1.6);
    return;
  }
  const loud = player.mounted || questRT.pSpeed > 6.5;
  if (d < 4 && !loud) {
    sh.calm = true;
    callout('雪影认出了你,打了个响鼻', 'gold', sh.pos);
    toastQuest('雪影不躲了——按 E 骑上它', 3, 'horse');
  } else if (d < 15 && loud) {
    sh.fleeT = 3.5;
    callout('雪影受惊跑开了!', 'red', sh.pos);
    if (!questRT.horseHint) {
      questRT.horseHint = true;
      toastQuest('🐴 雪影被马蹄声和奔跑吓到了——下马,慢慢走过去(别按 Shift 疾跑;Z 潜行更稳)', 4.5, 'horse');
    }
  }
}
// 护送:商人沿路线走;到第 2、4 个路点遭伏击——伏击前给他回满血,伏击中他原地蹲下护住货箱,伏兵清光(或跑远)才起身。
// 伏兵怎么挑目标(扑商人 / 转来打你、同一时间只一人下手)在 ai.js 的 escortWantsMerchant / escortStrikeMerchant
const ESCORT_AMBUSH = { 2: [[10, -7], [10, 7]], 4: [[11, -6], [11, 7], [4, 11]] }; // 路点 → 伏兵相对商人的站位
function updateEscort(mc, dt) {
  if (mc.hurtT > 0) mc.hurtT -= dt;
  if (questRT.ambush) {
    const left = bandits.filter((b) => b.escort && !b.dead && dist2(b.pos.x, b.pos.z, mc.pos.x, mc.pos.z) < 70 * 70);
    if (!left.length) {
      questRT.ambush = false;
      for (let i = bandits.length - 1; i >= 0; i--) { // 跑远了的残兵撤掉(倒下的留着,委托结束时一并收)
        if (bandits[i].escort && !bandits[i].dead) retireEntity(bandits[i], bandits);
      }
      toastQuest('伏兵清干净了!商人拍拍尘土,接着赶路。', 2.5, 'escort');
      sfx.block();
    }
  }
  let walking = false;
  if (questRT.ambush) {
    mc.crouch = Math.min(1, mc.crouch + dt * 4);
    // 蹲着也盯着最近的伏兵(看得出他在害怕谁)
    let near = null, nd = Infinity;
    for (const b of bandits) {
      if (!b.escort || b.dead) continue;
      const d2v = dist2(b.pos.x, b.pos.z, mc.pos.x, mc.pos.z);
      if (d2v < nd) { nd = d2v; near = b; }
    }
    if (near) mc.yaw = angleLerp(mc.yaw, Math.atan2(near.pos.x - mc.pos.x, near.pos.z - mc.pos.z), dt * 5);
  } else {
    mc.crouch = Math.max(0, mc.crouch - dt * 3);
    const [tx, tz] = world.escortRoute[mc.wp];
    const dx = tx - mc.pos.x, dz = tz - mc.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) {
      mc.wp++;
      const spots = ESCORT_AMBUSH[mc.wp];
      if (spots && questRT.escortSpawned < mc.wp) startAmbush(mc, spots);
      if (mc.wp >= world.escortRoute.length) {
        retireEntity(mc);
        questRT.merchant = null;
        completeMission();
        return;
      }
    } else if (mc.crouch < 0.2) {
      mc.pos.x += (dx / d) * 2.4 * dt;
      mc.pos.z += (dz / d) * 2.4 * dt;
      mc.yaw = angleLerp(mc.yaw, Math.atan2(dx, dz), dt * 8);
      mc.walkT += dt * 5;
      walking = true;
    }
  }
  mc.group.position.copy(mc.pos);
  mc.group.rotation.y = mc.yaw;
  animateLimbs(mc.parts, mc.walkT, walking, mc.group, 0.5);
  // 蹲下:整个人矮下去、上身前倾抱头;挨刀时一哆嗦
  mc.group.scale.y = 1 - 0.3 * mc.crouch;
  if (mc.crouch > 0.01 || mc.hurtT > 0) {
    if (mc.parts.body) mc.parts.body.rotation.x = 0.45 * mc.crouch + (mc.hurtT > 0 ? -0.3 : 0);
    if (mc.parts.armL) mc.parts.armL.rotation.x = -2.2 * mc.crouch;
    if (mc.parts.armR) mc.parts.armR.rotation.x = -2.2 * mc.crouch;
  }
}
function startAmbush(mc, spots) {
  questRT.escortSpawned = mc.wp;
  questRT.ambush = true;
  questRT.mcStriker = null;
  questRT.mcNextAt = 0;
  mc.hp = mc.maxHp; // 每波伏击前回满:上一波的伤不带进这一波
  // 伏兵从路线前方两侧杀出(站位按"前进方向 × 侧向"摆)
  const [nx, nz] = world.escortRoute[Math.min(mc.wp, world.escortRoute.length - 1)];
  const fx0 = nx - mc.pos.x, fz0 = nz - mc.pos.z, fl = Math.hypot(fx0, fz0) || 1;
  const fx = fx0 / fl, fz = fz0 / fl;
  for (const [ahead, side] of spots) {
    const b = addBandit(mc.pos.x + fx * ahead - fz * side, mc.pos.z + fz * ahead + fx * side, { escort: true });
    b.yaw = Math.atan2(mc.pos.x - b.pos.x, mc.pos.z - b.pos.z);
  }
  toastQuest(`⚠️ 有埋伏!${spots.length} 个伏兵扑向商人——贴上去把他们引到自己身上!`, 3, 'escort');
  sfx.wanted();
  if (!stats.escortTip) { // 第一次伏击:教学卡讲清规则
    stats.escortTip = true;
    setTutor('护送', '贴近伏兵,把它们引到自己身上', '伏兵挨了你的刀、或你走进 10 米内,就转来打你;红扇形亮起 = 它要砍商人了,砍它一下就能打断');
    later(7, () => { if (!prologue.on) setTutor(null); });
  }
}
// 委托人与目标光柱立进场景(启动装配原位调用)
// 目标光柱:自转并一明一暗地呼吸(位置由 updateQuest 摆)
export function animateBeacon(dt, now) {
  beacon.rotation.y += dt;
  beacon.material.opacity = 0.22 + Math.sin(now * 0.004) * 0.1;
}
export function initQuests() {
  questGiver = makeHumanoid({ shirt: 0xc9a227, pants: 0x6a5a2a, hair: 0xd8d8d8 });
  questGiver.group.position.copy(world.questGiverPos);
  questGiver.group.rotation.y = Math.PI;
  scene.add(questGiver.group);
  exBar.position.y = 0.3;
  exDot.position.y = -0.1;
  exGroup.add(exBar, exDot);
  exGroup.position.set(world.questGiverPos.x, 2.1, world.questGiverPos.z);
  scene.add(exGroup);
  beacon.position.y = 20;
  beacon.visible = false;
  scene.add(beacon);
}
