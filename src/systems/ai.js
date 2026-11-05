// 非玩家角色的行为(每帧):卫兵巡逻/追捕(通缉时起手转向、最后 0.2 秒锁死方向)、街头劫匪、盗贼(巡逻→追击→
// 起手预警→出手,精英/首领/亲卫,学来的格挡与闪箭)、狼(蹲伏扑咬、贴身撕咬、袭击村民、狼月加成)、
// 村民(作息、闲逛、受惊逃散、夜里回家睡觉)、马(吃草、闲逛、受惊、被唤来)。远处的实体按 entFar 休眠。
// 实体名单与生成在 actors.js;伤害一律走 combat.applyDamage / player.damagePlayer。
// 主循环依次调 updateGuards/updateBandits/updateWolves/updateVillagers/updateHorses。
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { colliders, player } from '../core/state.js';
import { hitStop } from '../core/timefx.js';
import { simNow } from '../core/timers.js';
import { angleLerp, dist2, resolveCollisions } from '../entities.js';
import { callout } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import {
  addBandit, animHorseLegs, animateLimbs, bandits, entFar, guards, horses, meleeSwing, moveEntity,
  moveEntityHorse, villagers, wolves,
} from './actors.js';
import { dayPhase, todaySpecial } from './calendar.js';
import { cam } from './camera.js';
import { applyDamage, inFrontArc, specialBandit, telegraphFlash, turnToward } from './combat.js';
import { streetEvent } from './events.js';
import { EVO } from './evo.js';
import { resetEvade, wanted } from './law.js';
import { sneakFactor } from './magic.js';
import { damagePlayer } from './player.js';
import { prologue } from './prologue.js';
import { questRT } from './quests.js';
import { warband } from './warband.js';
import { spawnDust } from './weather.js';

// ================= 实体更新 =================



export function updateGuards(dt) {
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

export function updateBandits(dt) {
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
    // 护送委托的伏兵:没被你缠住时扑商人(见 escortWantsMerchant / escortStrikeMerchant)
    const mc = questRT.merchant;
    if (b.escort && mc && mc.hp > 0 && escortWantsMerchant(b, pd, dt)) {
      moving = escortStrikeMerchant(b, mc, dt);
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
// ================= 护送委托的伏兵 =================
// 伏兵先扑商人;挨了刀(谁打的都算,箭和法术也算)就转来追你 6 秒,你走进 10 米内它就一直缠着你(离开后还追 2.5 秒)
// ——把它们引到自己身上。同一时间最多一个伏兵对商人下手:先亮红扇形起手 0.9 秒(砍它一下就打断),
// 两刀之间至少隔 1.6 秒;没轮到的在商人身边游走。
const MC_WIND = 0.9, MC_GAP = 1.6, AGGRO_IN = 10;
function escortWantsMerchant(b, pd, dt) {
  if (b.hp < (b._hpSeen ?? b.hp)) b.aggroT = 6;
  b._hpSeen = b.hp;
  if (pd < AGGRO_IN) b.aggroT = Math.max(b.aggroT || 0, 2.5);
  else if (b.aggroT > 0) b.aggroT -= dt;
  const aggro = b.aggroT > 0;
  if (aggro && b.mcStrike) { b.mcStrike = false; b.windupT = 0; } // 转头打你:砍商人的那刀收回
  if (questRT.mcStriker === b && !b.mcStrike) questRT.mcStriker = null;
  return !aggro;
}
// 对商人:轮到自己(没人在砍、间隔已过)就贴上去起手;起手被打断(踉跄/受击把 windupT 清零)就让出位置。返回是否在走动
function escortStrikeMerchant(b, mc, dt) {
  const dx = mc.pos.x - b.pos.x, dz = mc.pos.z - b.pos.z;
  const md = Math.hypot(dx, dz) || 0.01;
  if (b.mcStrike) {
    if (!(b.windupT > 0)) { b.mcStrike = false; questRT.mcStriker = null; return false; } // 被打断了
    if (b.windupT > 0.2) b.yaw = turnToward(b.yaw, Math.atan2(dx, dz), 3 * dt);
    b.windupT -= dt;
    if (b.windupT <= 0) {
      b.mcStrike = false;
      questRT.mcStriker = null;
      questRT.mcNextAt = simNow() + MC_GAP * 1000;
      b.swingT = 0.3;
      b.attackCd = 1.0;
      if (inFrontArc(b, mc.pos, 2.3)) {
        mc.hp--;
        mc.hurtT = 0.4;
        sfx.hit();
        callout(`商人挨了一刀!❤ ${Math.max(0, mc.hp)}/${mc.maxHp}`, 'red', mc.pos);
      }
    }
    return false;
  }
  const holder = questRT.mcStriker;
  if (holder && (holder.dead || !holder.mcStrike || !bandits.includes(holder))) questRT.mcStriker = null;
  const myTurn = !questRT.mcStriker && simNow() >= (questRT.mcNextAt || 0);
  if (!myTurn) { // 没轮到:在商人身边 3.5 米外绕着转,别挤成一团
    b._orbit = b._orbit || (rand() < 0.5 ? 1 : -1);
    const a = Math.atan2(-dx, -dz) + b._orbit * 0.6;
    moveEntity(b, mc.pos.x + Math.sin(a) * 3.5, mc.pos.z + Math.cos(a) * 3.5, b.speed * 0.45, dt);
    return true;
  }
  if (md > 1.6) { moveEntity(b, mc.pos.x, mc.pos.z, b.speed, dt); return true; }
  if (b.attackCd <= 0) {
    questRT.mcStriker = b;
    b.mcStrike = true;
    b.windupT = MC_WIND;
    b.yaw = Math.atan2(dx, dz);
    telegraphFlash(b, MC_WIND);
  }
  return false;
}
// 序章:狼这一口落空、而你刚翻滚过(1 秒内)= 真的用翻滚躲开了
function noteDodge(w) {
  if (!prologue.on || !w._prol || prologue.step !== 2) return;
  if (simNow() - (player.lastRollAt ?? -1e9) < 1000) prologue.flags.rolled = true;
}
export function updateWolves(dt) {
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
export function updateVillagers(dt) {
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

export function updateHorses(dt) {
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

