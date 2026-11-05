// 城中随机事件与竞技:街头事件(抢劫路人/受惊的马,每日限额与导演共享 calendar.dailyEvents)、
// 悬赏板(无限重复的通缉要犯)、荒沙角斗场(波次生存,场主血牙)。骰子与掰手腕这类小赌局在 npcs.js。
// 对外:streetEvent/bountyRT/arenaRT 状态;trySpawnStreetEvent、takeBounty、startArenaWave;
// initEvents() 启动装配调用一次;主循环调 updateStreetEvent/updateBounty/updateArena。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { PACK_HOST_LINES } from '../content-packs.js';
import { AI_TEXT_OFF, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import { colliders, player, started, world } from '../core/state.js';
import { dist2, lambert, makeHumanoid } from '../entities.js';
import { scene } from '../gfx/core.js';
import { openDialog, showBubble } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import {
  addBandit, addHorse, addWolf, animateLimbs, bandits, horses, moveEntity, retireEntity, villagers,
  wolves,
} from './actors.js';
import { calendar } from './calendar.js';
import { remember } from './mind.js';
import { quest } from './quests.js';

// ================= 街头随机事件(GTA 式) =================
export const streetEvent = { type: null, t: 0, villager: null, bandit: null, horse: null, cooldown: 130 };
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
export function trySpawnStreetEvent() {
  if (arenaRT.active) return;
  if (calendar.dailyEvents <= 0) { streetEvent.cooldown = 60; return; } // 今日热闹够了
  calendar.dailyEvents--;
  if (rand() < 0.5) {
    // 抢劫:挑一个不太远的清醒村民
    const v = villagers.find((x) => !x.sleeping && x.downT <= 0 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) > 100);
    if (!v) { calendar.dailyEvents++; streetEvent.cooldown = 25; return; }
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
export function updateStreetEvent(dt) {
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
export const bountyRT = { target: null, name: '', cooldown: 0 };
export function takeBounty() {
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
export function wantedPosterSpeaker() {
  return { key: null, name: bountyRT.name, desc: 'scarred wanted outlaw criminal, rough charcoal wanted-poster sketch' };
}
export function updateBounty(dt) {
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


// ================= 荒沙角斗场(波次生存) =================
const ARENA = { x: 60, z: -85, r: 13 };
// 角斗场主血牙:人形模型就绪后才能建,启动装配时生成
export let arenaHost = null;
export const HOST_LINES = [
  '我叫血牙,当年在南方斗过狮子。现在?看别人流血,收门票。',
  '规矩:站在沙圈里,活下来。走出圈,就算认输。',
  '第五波之后才算开胃。撑得越久,赏钱越厚。',
];
HOST_LINES.push(...PACK_HOST_LINES); // 内容包里血牙的台词
export const arenaRT = { active: false, wave: 0, betweenT: 0, foes: [] };
export function startArenaWave() {
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
export function updateArena(dt) {
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

// 悬赏告示板、角斗场与场主血牙立进场景(启动装配原位调用)
export function initEvents() {
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
  arenaHost = { ...makeHumanoid({ shirt: 0x8a2f2f, pants: 0x3a3026, helmet: true, sword: true }),
    pos: new THREE.Vector3(ARENA.x + 6, 0, ARENA.z + 11), yaw: -0.6, lineIdx: 0 };
  arenaHost.group.position.copy(arenaHost.pos);
  arenaHost.group.rotation.y = arenaHost.yaw;
  scene.add(arenaHost.group);
}
