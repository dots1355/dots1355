// 魔法、冰霜留痕、技艺熟练度、潜行与龙吼:玩家的非刀剑能力都在这里。
// 法术:R 按下施放(火球按住聚能、松手放出,蓄满 0.55 秒为大火球);法力自然回复。
// 技艺:用什么涨什么(skillXp/skillLv),近战/弓箭伤害加成 meleeBonus/arrowBonus。
// 体力花销 spendSta 也在此:不够就喘不上气(出不了手),花光=力竭破绽。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { hitStop } from '../core/timefx.js';
import { simNow } from '../core/timers.js';
import { dist2, lambert, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { cam } from './camera.js';
import { awakenDragon, dragonRT } from './dragon.js';
import { prologue } from './prologue.js';
import { spawnDust, weather } from './weather.js';
import {
  applyDamage, arrows, bandits, calendar, callout, colliders, dayPhase, dialog, faceNearestFoe, guards,
  keys, midHeld, openDialog, player, remember, saveGame, started, stats, toast, unlockAch, wolves,
} from '../main.js';

// ================= 魔法系统 =================
// 四门法术分别来自四处地标:女巫卖火球、教堂授治愈、湖心祭坛赠冰霜、回响之镜予闪现。
// R 施放 · V 切换 · 数字键 1-4 直选;法力自然回复,自家安眠/庇佑时回得更快。
export const SPELLS = {
  spark: { name: '魔光弹', icon: '✴️', mp: 1, cd: 0.45 }, // 娘胎里带的:1 蓝速射,毁灭系入门
  fire:  { name: '火球术', icon: '🔥', mp: 3, cd: 1.1 },
  heal:  { name: '治愈术', icon: '✨', mp: 4, cd: 2.5 },
  frost: { name: '冰霜新星', icon: '❄️', mp: 4, cd: 6 },
  blink: { name: '闪现', icon: '💠', mp: 2, cd: 2.5 },
};
export function learnSpell(key) {
  if (player.spells.includes(key)) return false;
  player.spells.push(key);
  player.spellIdx = player.spells.length - 1;
  sfx.fanfare();
  toast(`${SPELLS[key].icon} 习得法术「${SPELLS[key].name}」!R 施放 · V 切换`, 5);
  remember(`习得了法术「${SPELLS[key].name}」`, `spell-${key}`);
  saveGame();
  return true;
}
export function cycleSpell() {
  if (player.spells.length < 2) { callout('目前只会魔光弹(女巫处可买火球术卷轴)', 'dim'); return; }
  player.fireChargeT = 0; // 换法术=松开引导
  player.spellIdx = (player.spellIdx + 1) % player.spells.length;
  const k = player.spells[player.spellIdx];
  sfx.equip();
  toast(`${SPELLS[k].icon} ${SPELLS[k].name}`, 1.2);
}
// 范围爆破:火球命中点的 AoE(打卫兵照样算犯罪)
// src:'player'(默认,火球/火油罐)或环境伤害(如 'dragon'):环境伤害不进连杀、不算卫兵罪行
export function explodeAt(x, z, dmg = 3, radius = 3.4, src = 'player') {
  const env = src !== 'player';
  cam.shake = Math.max(cam.shake, 0.35);
  sfx.stomp();
  spawnDust(x, 0.5, z, 16, radius * 0.5, 2.2);
  // 卫兵不受龙息之类的环境爆炸牵连,也不会因此通缉你
  for (const list of env ? [bandits, wolves] : [bandits, wolves, guards]) {
    for (const e of list) {
      if (e.dead || e.downT > 0 || dist2(x, z, e.pos.x, e.pos.z) > radius * radius) continue;
      applyDamage(e, dmg, { source: env ? 'env' : 'player', knock: 1.2, crit: true, crime: 2, crimeMsg: '你的火球炸到了卫兵!' });
    }
  }
}
// ================= 冰霜留痕:新星过后地面结霜,敌人踩上去减速一半 =================
export const frostPatches = [];
export function addFrostPatch(x, z, r = 5.5, dur = 6) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.06, z);
  scene.add(m);
  frostPatches.push({ x, z, r, t: dur, m });
}
export function updateFrostPatches(dt) {
  for (let i = frostPatches.length - 1; i >= 0; i--) {
    const p = frostPatches[i];
    p.t -= dt;
    if (p.t <= 0) {
      scene.remove(p.m);
      p.m.traverse ? p.m.traverse((o) => { // 拒马是组合体,逐件回收
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && !o.material._shared) o.material.dispose();
      }) : null;
      if (p.m.geometry) { p.m.geometry.dispose(); p.m.material.dispose(); }
      frostPatches.splice(i, 1);
      continue;
    }
    if (!p.wood && p.t < 1) p.m.material.opacity = 0.28 * p.t; // 冰面最后一秒融化(拒马不透明)
  }
}
// 拒马:攻城警报拉响时,卫兵在来袭方向支起两座木刺阵——踩进去的人腿脚都慢半拍
export function addBarricade(x, z) {
  const grp = new THREE.Group();
  const wood = lambert(0x6a4a28, { roughness: 0.92 });
  wood._shared = true; // 共享一份材质,dispose 时跳过
  for (let i = 0; i < 6; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.2, 5), wood);
    const a2 = (i / 6) * Math.PI * 2;
    spike.position.set(Math.cos(a2) * 1.7, 0.55, Math.sin(a2) * 1.7);
    spike.rotation.z = i % 2 ? 0.55 : -0.55;
    spike.rotation.y = a2;
    grp.add(spike);
  }
  grp.position.set(x, 0, z);
  scene.add(grp);
  frostPatches.push({ x, z, r: 3.2, t: 90, m: grp, wood: true });
}
export function frostSlow(e) {
  if (!frostPatches.length) return 1;
  for (const p of frostPatches) {
    if (dist2(e.pos.x, e.pos.z, p.x, p.z) < p.r * p.r) return 0.5;
  }
  return 1;
}

// 大火球:蓄力引导的产物——更大更疼,炸开半径 5,配大冷却
export function castBigFire() {
  if (!started || player.dead || player.carrying || dialog.open ||
      player.castT > 0 || player.staggerT > 0 ||
      player.spells[player.spellIdx] !== 'fire') return; // 蓄力途中切了法术/进了冷却就作废
  const cost = Math.max(2, Math.round(4 * (1 - 0.04 * (skillLv('destruction') - 1))));
  if (player.mp < cost) { callout(`法力不足(大火球要 ${cost} 点)`, 'dim'); return; }
  player.mp -= cost;
  player.castT = 1.8;
  player.castPoseT = 0.3;
  stats.casts = (stats.casts || 0) + 1;
  skillXp('destruction', 3);
  sfx.arrow();
  sfx.stomp();
  cam.shake = Math.max(cam.shake, 0.2);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false })));
  const pos = new THREE.Vector3(player.pos.x + fx * 0.9, 1.35, player.pos.z + fz * 0.9);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dragonAim(pos, 19) || new THREE.Vector3(fx, 0.05, fz).multiplyScalar(19),
    ttl: 2.4, stuck: false, fire: true, big: true });
}

// 对空瞄准:飞龙在前方 45 米内时,弹道自动抬向它(带提前量)——平射永远够不着 9 米高的龙
export function dragonAim(from, speed) {
  if (!dragonRT.on || dragonRT.hp <= 0 || dragonRT.phase === 'land' || dragonRT.phase === 'dead') return null;
  const gp = dragonRT.ent.group.position;
  const tx = gp.x, ty = gp.y + 1.6, tz = gp.z;
  const dx = tx - from.x, dz = tz - from.z;
  const dh = Math.hypot(dx, dz);
  if (dh > 45) return null;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  if ((dx * fx + dz * fz) / (dh || 1) < 0.35) return null; // 只瞄身前的龙
  const lead = dh / speed;
  const vx = dragonRT._vx || 0, vz = dragonRT._vz || 0;
  const v = new THREE.Vector3(tx + vx * lead - from.x, ty - from.y, tz + vz * lead - from.z);
  v.normalize().multiplyScalar(speed);
  v.aimed = true; // 对空弹道不吃重力(否则必然坠在龙下面)
  return v;
}
// R/中键:按下施放;火球例外——按下开始聚能,松手放出(不足 0.55 秒是小火球,蓄满是大火球)
export function spellDown() {
  if (!started || player.dead || dialog.open || !player.spells.length) return;
  if (player.spells[player.spellIdx] === 'fire') {
    if (player.castT > 0) { callout('火球术冷却中', 'dim'); return; }
    if (player.carrying) return;
    player.fireCharging = true;
    player.fireChargeT = 0;
    return;
  }
  castSpell();
}
export function spellUp() {
  if (!player.fireCharging) return;
  player.fireCharging = false;
  const t = player.fireChargeT || 0;
  player.fireChargeT = 0;
  if (player.dead || dialog.open || player.spells[player.spellIdx] !== 'fire') return;
  if (t >= 0.55) castBigFire();
  else castSpell();
}
export function castSpell() {
  if (!started || player.dead || player.castT > 0 || !player.spells.length ||
      player.carrying || dialog.open) return;
  const key = player.spells[player.spellIdx];
  const def = SPELLS[key];
  const cost = Math.max(1, Math.round(def.mp * (1 - 0.04 * (skillLv('destruction') - 1)))); // 法术专精:省蓝
  if (player.mp < cost) { callout(`法力不足(${SPELLS[key].name}要 ${cost} 点)`, 'dim'); return; }
  player.mp -= cost;
  player.castT = def.cd;
  player.castPoseT = 0.25; // 抬手施法的动作
  stats.casts = (stats.casts || 0) + 1;
  if (stats.casts >= 30) unlockAch('mage');
  skillXp('destruction', 2);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  if (key === 'spark') {
    // 魔光弹:速射直线光弹,带辉光;毁灭系每 3 级伤害 +1,5 级起三连扇射
    sfx.arrow();
    if (prologue.on && prologue.step === 5) prologue.flags.sparked = true;
    if (!player.sneaking) faceNearestFoe(9); // 法弹也吸目标,新手第一发就该打中
    const yaws = skillLv('destruction') >= 5
      ? [player.yaw - 0.17, player.yaw, player.yaw + 0.17]
      : [player.yaw];
    for (const yw of yaws) {
      const fx2 = Math.sin(yw), fz2 = Math.cos(yw);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xbfe4ff }));
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x5599ff, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false })));
      const pos = new THREE.Vector3(player.pos.x + fx2 * 0.7, 1.25, player.pos.z + fz2 * 0.7);
      mesh.position.copy(pos);
      scene.add(mesh);
      const vel = (yw === player.yaw && dragonAim(pos, 26)) || new THREE.Vector3(fx2, 0.02, fz2).multiplyScalar(26);
      arrows.push({ mesh, pos, vel,
        ttl: 1.8, stuck: false, mag: true, dmg: 1 + Math.floor((skillLv('destruction') - 1) / 3) });
    }
  } else if (key === 'fire') {
    sfx.arrow();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8830 }));
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff5510, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false })));
    const pos = new THREE.Vector3(player.pos.x + fx * 0.8, 1.3, player.pos.z + fz * 0.8);
    mesh.position.copy(pos);
    scene.add(mesh);
    arrows.push({ mesh, pos, vel: dragonAim(pos, 22) || new THREE.Vector3(fx, 0.06, fz).multiplyScalar(22), ttl: 2.2, stuck: false, fire: true });
  } else if (key === 'heal') {
    sfx.heart();
    player.hp = Math.min(player.maxHp, player.hp + 4);
    spawnDust(player.pos.x, 1.2, player.pos.z, 10, 0.8, 2.6);
    toast('✨ 暖流漫过伤口。(回复 ❤×2)', 2);
  } else if (key === 'frost') {
    sfx.clear();
    cam.shake = Math.max(cam.shake, 0.25);
    spawnDust(player.pos.x, 0.4, player.pos.z, 22, 3.2, 1.6);
    // 冰霜留痕:6 秒冰面(雨天水汽足,冻得住 9 秒),踩上减速一半
    addFrostPatch(player.pos.x, player.pos.z, 5.5,
      weather.state === 'rain' || weather.state === 'storm' ? 9 : 6);
    const freeze = (list) => {
      for (const e of list) {
        if (e.dead || e.downT > 0 || e.stunT === undefined) continue;
        if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > 49) continue;
        e.stunT = Math.max(e.stunT || 0, 3.5); e.stunSrc = 'other';
        applyDamage(e, 1, { crimeMsg: '你的寒气冻伤了卫兵!' });
      }
    };
    freeze(bandits);
    freeze(wolves);
    freeze(guards);
    toast('❄️ 寒气炸开,周围的敌人冻在了原地!', 2);
  } else if (key === 'blink') {
    sfx.roll();
    spawnDust(player.pos.x, 0.6, player.pos.z, 8, 0.5, 1.8);
    player.pos.x += fx * 7;
    player.pos.z += fz * 7;
    resolveCollisions(player.pos, 0.45, colliders);
    player.invulnT = Math.max(player.invulnT, 0.35);
    spawnDust(player.pos.x, 0.6, player.pos.z, 8, 0.5, 1.8);
  }
}
export function updateMagic(dt) {
  if (player.castT > 0) player.castT -= dt;
  if (player.riposteT > 0) player.riposteT -= dt;
  const regen = 0.32 * (player.homeDay === calendar.day ? 1.5 : 1) * (player.blessT > 0 ? 1.4 : 1);
  player.mp = Math.min(player.maxMp, player.mp + regen * dt);
  if (shout.cd > 0) shout.cd -= dt;
  // 按住连发:R/中键压住不放,魔光弹按冷却节奏一发接一发(只限魔光弹,别把治愈术的蓝烧干)
  const heldCast = (keys['KeyR'] || midHeld) && !dialog.open;
  if (heldCast && player.castT <= 0 && player.spells[player.spellIdx] === 'spark' &&
      player.mp >= 1) castSpell(); // 没蓝就松手,别每帧挤一条"法力不足"
  if (player.castPoseT > 0) player.castPoseT -= dt;
  // 火球聚能:按住期间掌心聚火,0.55 秒蓄满,松手放出(spellUp)
  if (player.fireCharging) {
    if (!heldCast || player.spells[player.spellIdx] !== 'fire' || player.dead || player.staggerT > 0) {
      if (!heldCast) spellUp(); // 松手的事件丢了也照样放出去
      else { player.fireCharging = false; player.fireChargeT = 0; }
    } else {
      const t0 = player.fireChargeT || 0;
      player.fireChargeT = Math.min(1, t0 + dt);
      if (rand() < 0.35) spawnDust(player.pos.x + Math.sin(player.yaw) * 0.7, 1.3,
        player.pos.z + Math.cos(player.yaw) * 0.7, 1, 0.3, 1.2); // 聚能星火
      if (t0 < 0.55 && player.fireChargeT >= 0.55) {
        sfx.clear();
        callout('蓄满!松手放大火球', 'gold');
      }
    }
  }
  // 体力(骑砍规则):格挡/疾跑/出手/喘气中不回,其余时刻 16/s 回满
  if (player.gaspT > 0) player.gaspT -= dt;
  if (player.staggerT > 0) player.staggerT -= dt;
  const busy = player.blocking || player.attackT > 0 || player.charging || player.gaspT > 0 || cam.moveState >= 2;
  if (!busy) player.sta = Math.min(player.maxSta, player.sta + 16 * dt);
  updateSneakXp(dt);
}
// 花体力:不够=喘不上气(出不了手);花光=力竭破绽
let gaspToastT = -1e9;
export function spendSta(cost) {
  if (player.sta < cost) {
    if (simNow() - gaspToastT > 1500) {
      gaspToastT = simNow();
      callout('喘不上气!', 'dim');
      sfx.hiccup();
    }
    return false;
  }
  player.sta -= cost;
  if (player.sta <= 0) { player.sta = 0; player.gaspT = 1.2; } // 榨干最后一口气=1.2 秒喘息
  return true;
}

// ================= 技能熟练度(上古卷轴式:用什么,涨什么) =================
export const SKILL_DEFS = {
  onehand:     { name: '武艺', icon: '⚔️', perk: '近战伤害 +6%/级' },
  archery:     { name: '弓术', icon: '🏹', perk: '箭矢伤害 +6%/级' },
  destruction: { name: '法术', icon: '🔮', perk: '法力消耗 -4%/级;5 级魔光弹三连扇射' },
  riding:      { name: '骑术', icon: '🐴', perk: '骑乘速度 +2%/级' },
  sneak:       { name: '潜行', icon: '🤫', perk: '警觉圈再缩 3%/级' },
};
export function skillXp(k, n) {
  const s = player.skills[k];
  if (!s || s.lv >= 10) return;
  s.xp += n;
  const need = s.lv * 20;
  if (s.xp >= need) {
    s.xp -= need;
    s.lv++;
    sfx.fanfare();
    // 技艺磨炼身体:每次升级体力上限 +3(封顶 160)——练什么都算锻炼
    if (player.maxSta < 180) {
      player.maxSta = Math.min(180, player.maxSta + 3);
      player.sta = player.maxSta; // 升级瞬间气也回满,爽快些
    }
    toast(`${SKILL_DEFS[k].icon} ${SKILL_DEFS[k].name}提升到 ${s.lv} 级!(${SKILL_DEFS[k].perk};体力上限 ${player.maxSta})`, 3.5);
    if (s.lv === 10) remember(`把${SKILL_DEFS[k].name}练到了炉火纯青`, `skill-${k}`);
    saveGame();
  }
}
export const skillLv = (k) => (player.skills[k] ? player.skills[k].lv : 1);
export const meleeBonus = (base) => Math.round(base * (1 + 0.06 * (skillLv('onehand') - 1)));
export const arrowBonus = (base) => Math.round(base * (1 + 0.06 * (skillLv('archery') - 1)));

// ================= 潜行(Z 键蹲行:靠近不惊、背刺三倍) =================
export function sneakFactor() {
  return player.sneaking ? Math.max(0.22, 0.45 - 0.03 * (skillLv('sneak') - 1)) : 1;
}
export function toggleSneak() {
  if (player.mounted || player.dead) return;
  player.sneaking = !player.sneaking;
  player.group.scale.y = player.sneaking ? 0.8 : 1;
  toast(player.sneaking ? '🤫 潜行(移动放缓,敌人警觉圈大幅缩小;近身出手=偷袭 ×3)' : '(起身)', 2);
}
let sneakXpT = 0;
function updateSneakXp(dt) {
  if (!player.sneaking) return;
  sneakXpT += dt;
  if (sneakXpT < 2) return;
  sneakXpT = 0;
  // 在活着的敌人眼皮底下潜着,才算练功
  const near = (list, r2) => list.some((e) => !e.dead && !(e.downT > 0) &&
    dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < r2);
  if (near(bandits, 400) || near(wolves, 400)) skillXp('sneak', 1);
}

// ================= 龙吼(龙骨之地的龙颅所授,X 键释放) =================
export const DRAGON_SKULL = { x: 298, z: -152 };
export const shout = { learned: false, cd: 0 };
export function learnShout() {
  if (shout.learned) {
    if (stats.dragonSlain) {
      openDialog(['(龙颅静默。它的残魂已得安息——而它的力量,在你血脉里。)']);
    } else if (dragonRT.on) {
      openDialog(['(骨头是空的。它的主人正在你头顶盘旋。)']);
    } else if (dayPhase() === 'night') {
      awakenDragon();
    } else {
      openDialog(['(龙颅空洞的眼窝深处,有风声盘旋。夜里再来——骨头缝里有什么在等着。)']);
    }
    return;
  }
  shout.learned = true;
  sfx.fanfare();
  cam.shake = 0.5;
  unlockAch('dovah');
  remember('把手放上龙骨之地的龙颅,学会了先古的战吼', 'shout');
  openDialog([
    '(你把手放上龙颅。骨头是凉的,却在你掌心底下嗡嗡作响,像一头还没散尽的雷。)',
    '(三个不属于任何语言的音节,自己滚进了你的胸腔。)',
    '🐉 习得「冲击战吼」!按 X 释放——把周围的一切掀翻在地(45 秒回气)。',
  ], () => saveGame());
}
export function doShout() {
  if (player.dead || dialog.open) return;
  if (!shout.learned) { callout('还没学会战吼(去龙骨之地的龙颅看看)', 'dim'); return; }
  if (shout.cd > 0) { callout(`战吼冷却中 ${Math.ceil(shout.cd)} 秒`, 'dim'); return; }
  shout.cd = stats.dragonSlain ? 22.5 : 45; // 屠龙者:龙魂减半冷却
  sfx.stomp();
  sfx.clear();
  cam.shake = 0.6;
  hitStop(0.08);
  spawnDust(player.pos.x, 0.4, player.pos.z, 26, 4, 2.6);
  for (const list of [bandits, wolves, guards]) {
    for (const e of list) {
      if (e.dead || e.downT > 0 || dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > 100) continue;
      if (e.stunT !== undefined) { e.stunT = Math.max(e.stunT || 0, 2); e.stunSrc = 'other'; }
      applyDamage(e, 1, { knock: 4, crimeMsg: '你的战吼掀翻了卫兵!' }); // FUS RO DAH:掀飞
    }
  }
  toast('🐉 冲击战吼!!', 2);
}

