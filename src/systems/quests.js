// 领主委托链:missions(story.js 的委托表)、进度 quest{idx,active,progress,timer}(随存档)、运行时对象 questRT。
// 委托人管家埃隆(questGiver,头顶金色「!」exGroup)接单/交差(talkQuestGiver、completeMission、failMission),领赏面板。
// 目标光柱 beacon:updateQuest(dt) 每帧推进委托并摆光柱;隔着城墙/河/湖时经航点图(nav.js)先指下一跳(routeVia)。
// initQuests() 启动装配调用一次。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { saveGame } from '../core/save.js';
import { later } from '../core/timers.js';
import { player, world } from '../core/state.js';
import { angleLerp, dist2, lambert, makeHumanoid } from '../entities.js';
import { scene } from '../gfx/core.js';
import { MISSIONS } from '../story.js';
import { openDialog } from '../ui/dialog.js';
import { dropQuestToasts, toast, toastNow, toastQuest } from '../ui/toast.js';
import { stats } from './achievements.js';
import { endTrial, inDungeon, trialRT } from './activities.js';
import { addBandit, addHorse, animateLimbs, bandits, retireEntity } from './actors.js';
import { dayPhase } from './calendar.js';
import { bountyRT } from './events.js';
import { remember } from './mind.js';
import { navNext } from './nav.js';
import { steward } from './npcs.js';
import { addPickup } from './pickups.js';
import { prologue, setTutor } from './prologue.js';

// ================= 任务系统 =================
export const missions = MISSIONS;
export const quest = { idx: 0, active: false, progress: 0, timer: 0 };
// 任务运行时对象
// mcStriker / mcNextAt:护送时"谁正在砍商人、下一刀最早何时"(ai.js 的伏兵逻辑读写,保证同一时间只有一人下手)
export const questRT = { rings: [], ringIdx: 0, merchant: null, specialHorse: null, boss: null, escortSpawned: 0,
  ambush: false, mcStriker: null, mcNextAt: 0 };
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
function failMission(msg) {
  quest.active = false;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { retireEntity(questRT.merchant); questRT.merchant = null; }
  removeEscortBandits(); // 伏兵随任务失败一并撤走,否则重接任务时旧伏兵会追杀新商人
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
export function talkQuestGiver(remote = false) {
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
    dropQuestToasts(); // 上一次(失败的)尝试留下的提示作废
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
        yaw: 0, hp: ESCORT_HP, maxHp: ESCORT_HP, wp: 0, walkT: 0, crouch: 0, hurtT: 0 };
      mc.group.position.copy(mc.pos);
      scene.add(mc.group);
      questRT.merchant = mc;
      questRT.escortSpawned = 0;
      questRT.ambush = false;
      questRT.mcStriker = null;
      questRT.mcNextAt = 0;
    } else if (m.type === 'boss') {
      questRT.boss = addBandit(world.fortPos.x, world.fortPos.z - 2,
        { boss: true, hp: 12, speed: 6.8, scale: 1.35, dmg: 2 });
      addBandit(world.fortPos.x - 5, world.fortPos.z + 3);
      addBandit(world.fortPos.x + 5, world.fortPos.z + 3);
      toastQuest('⚔️ 血斧巴罗克在黑石要塞等着你……', 4);
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
export function completeMission() {
  const m = missions[quest.idx];
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
  saveGame();
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
      else toastQuest(`金环 ${questRT.ringIdx}/${world.raceRoute.length}`, 1.2, 'ring');
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
        toastQuest('雪影归你了!它就在马厩等你。', 4);
      }
    } else {
      setBeacon(sh.pos.x, sh.pos.z);
    }
  } else if (m.type === 'escort') {
    const mc = questRT.merchant;
    if (!mc) return;
    setBeacon(mc.pos.x, mc.pos.z);
    if (mc.hp <= 0) { failMission('商人巴特倒下了……回去找埃隆重整旗鼓。'); return; }
    updateEscort(mc, dt);
  } else if (m.type === 'wolves') {
    setBeacon(-140, -40);
  } else if (m.type === 'boss') {
    if (questRT.boss) setBeacon(questRT.boss.pos.x, questRT.boss.pos.z);
    if (questRT.boss && questRT.boss.dead) {
      questRT.boss = null;
      completeMission();
      toastNow('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 4); // 不管是刀、箭还是法术收的尾,倒下的这一刻就播
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
