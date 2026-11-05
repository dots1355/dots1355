// 佣兵(骑砍式):旅店雇剑士随行,替你砍盗贼和恶狼,五个人头升老兵;按日发饷,发不出就散伙。
// 对外:mercs(名单)、hireMerc()(布兰处雇人)、hireMercSilent()(读档归队)、payMercs()(换日时)、updateMercs(dt)。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { player, world } from '../core/state.js';
import { dist2, makeHumanoid } from '../entities.js';
import { scene } from '../gfx/core.js';
import { openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { stats } from './achievements.js';
import { animateLimbs, bandits, meleeSwing, moveEntity, retireEntity, wolves } from './actors.js';
import { calendar } from './calendar.js';
import { remember } from './mind.js';
import { applyDamage, saveGame } from '../main.js';

// ================= 佣兵(骑砍式:旅店雇剑士随行,按日发饷) =================
export const mercs = [];
const MERC_NAMES = ['石手雷戈', '断鼻威尔', '老兵科尔', '快腿芬恩'];
export function hireMerc() {
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
export function updateMercs(dt) {
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
export function hireMercSilent() { // 读档时无声归队
  const name = MERC_NAMES[mercs.length % MERC_NAMES.length];
  const m = { ...makeHumanoid({ shirt: 0x555b66, pants: 0x33363c, helmet: true, sword: true }),
    pos: new THREE.Vector3(world.playerSpawn.x + 2 + mercs.length, 0, world.playerSpawn.z + 2),
    yaw: 0, walkT: 0, hp: 8, attackCd: 0, swingT: 0, name };
  m.group.position.copy(m.pos);
  scene.add(m.group);
  mercs.push(m);
}
export function payMercs() { // 每日饷钱:发不出就散伙
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
