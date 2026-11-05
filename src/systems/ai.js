// 非玩家角色的行为(每帧):卫兵巡逻/追捕、街头劫匪、盗贼(巡逻→追击→起手预警→出手,精英/首领/亲卫,学来的格挡与闪箭,
// 反骑兵:侧扑/举刀扎马)、狼(蹲伏扑咬、贴身撕咬、袭击村民、狼月加成)、村民(作息、闲逛、受惊逃散、夜里回家睡觉)、
// 马(吃草、闲逛、受惊、被唤来)。远处的实体按 entFar 休眠。卫兵与盗贼共用近战出招库 FOE_MOVES(起手→跟步突进→判定)。
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
import {
  applyDamage, inFrontArc, isElite, specialBandit, telegraphFlash, turnToward, windupAnchor,
} from './combat.js';
import { streetEvent } from './events.js';
import { EVO } from './evo.js';
import { resetEvade, wanted } from './law.js';
import { sneakFactor } from './magic.js';
import { damagePlayer, throwFromHorse } from './player.js';
import { prologue } from './prologue.js';
import { questRT } from './quests.js';
import { warband } from './warband.js';
import { spawnDust } from './weather.js';

// ================= 近战出招库(卫兵/盗贼共用) =================
// 每招:起手时长 windup、刀长 reach、起手末段的跟步突进 lunge、判定张角 arc、伤害加成 dmg、紫=破盾 pierce(弹不开、挡不住)、
// 起手姿势 pose。预警扇形 = 判定范围:画在起手那一刻的站位(锚点),半径 = 刀长 + 突进;起手中慢慢转向你(≤3 rad/s),
// 扇形跟着转,最后 0.2 秒锁死方向、最后 0.15 秒沿朝向突进(原地后撤一步躲不开了);刀落下时按"锚点 + 最终朝向"判定。
// 起手进入最后 40% 后轻击打不断(combat.windupArmored)——要拦只能下劈截击、重击,或者弹反。
export const FOE_MOVES = {
  slash:  { windup: 0.62, reach: 2.3, lunge: 1.0, arc: 2.1, pose: 'raise' },
  combo:  { windup: 0.42, reach: 2.3, lunge: 0.5, arc: 2.1, pose: 'raise' }, // 二连击的第二刀:起手短、跟步小
  heavy:  { windup: 1.0, reach: 2.7, lunge: 1.0, arc: 2.1, dmg: 1, pierce: true, pose: 'overhead' }, // 紫:双手举过头顶
  sweep:  { windup: 0.75, reach: 2.6, lunge: 0, arc: 3.8, pose: 'sweep' },   // 横扫:身前两百多度,退出刀长或绕到背后才躲得开
  thrust: { windup: 0.7, reach: 2.4, lunge: 2.2, arc: 0.5, pose: 'thrust' }, // 突刺:窄而长(4.6 米),中距离扑刺,侧闪躲
};
const LUNGE_T = 0.15, LOCK_T = 0.2, TURN_RATE = 3;
const moveOf = (e) => FOE_MOVES[e.atk] || (e.heavyAtk ? FOE_MOVES.heavy : FOE_MOVES.slash);
// 起手:记下招式,铺开预警(锚在此刻的站位,起手作废即熄灭)
export function startFoeMove(e, kind) {
  const mv = FOE_MOVES[kind];
  e.atk = kind;
  e.windupT = e.windupDur = mv.windup;
  e.heavyAtk = !!mv.pierce;
  e.lungeDone = 0;
  telegraphFlash(e, mv.windup, !!mv.pierce, mv.reach + mv.lunge, mv.arc, { anchored: true, watch: () => e.windupT > 0 });
}
// 起手中的一帧:转向目标(最后 0.2 秒锁死)、最后 0.15 秒向前突进(贴到 0.9 米就停);刀落下返回 true
function tickWindup(e, tx, tz, dt) {
  e.windupT -= dt;
  const mv = moveOf(e);
  if (e.windupT > LOCK_T) e.yaw = turnToward(e.yaw, Math.atan2(tx - e.pos.x, tz - e.pos.z), TURN_RATE * dt);
  if (e.windupT < LUNGE_T && mv.lunge > 0) {
    const left = mv.lunge - (e.lungeDone || 0);
    if (left > 0.001 && Math.hypot(tx - e.pos.x, tz - e.pos.z) > 0.9) {
      const step = Math.min(left, (mv.lunge / LUNGE_T) * dt);
      e.pos.x += Math.sin(e.yaw) * step;
      e.pos.z += Math.cos(e.yaw) * step;
      e.lungeDone = (e.lungeDone || 0) + step;
      resolveCollisions(e.pos, 0.4, colliders);
    }
  }
  return e.windupT <= 0;
}
// 刀落下:按锚点 + 最终朝向判定(= 预警范围),命中走 damagePlayer(紫圈破盾);返回这一招的名字
function foeStrike(e, baseDmg) {
  const kind = FOE_MOVES[e.atk] ? e.atk : e.heavyAtk ? 'heavy' : 'slash';
  const mv = FOE_MOVES[kind];
  const a = windupAnchor(e);
  if (inFrontArc({ pos: a, yaw: e.yaw }, player.pos, mv.reach + mv.lunge, mv.arc)) {
    damagePlayer(baseDmg + (mv.dmg || 0), e, !!mv.pierce);
  }
  e.swingT = 0.3;
  e.swingPose = mv.pose;
  e.atk = null; e.lungeDone = 0; e.heavyAtk = false;
  return kind;
}
// 不在起手中:清掉上一招的残留(被打断/吓跑/外部直接改 windupT 时,锚点和招式不带进下一次)
function clearStaleMove(e) {
  if (e.windupT > 0) return;
  e.atk = null; e.lungeDone = 0; e.windupDur = 0;
}
// 起手姿势(k = 起手进度 0→1):红 = 单手举刀;紫 = 双手高举过顶、身子后仰;横扫 = 刀横在身侧、上身拧过去;突刺 = 收臂侧身
function windupPose(p, pose, k) {
  const r = Math.min(1, k * 4);
  if (pose === 'overhead') {
    p.armR.rotation.x = -2.9 * r; p.armR.rotation.z = 0.3 * r;
    if (p.armL) { p.armL.rotation.x = -2.9 * r; p.armL.rotation.z = -0.3 * r; }
    if (p.body) p.body.rotation.x = -0.22 * r;
  } else if (pose === 'sweep') {
    p.armR.rotation.x = -1.35 * r; p.armR.rotation.z = -1.15 * r;
    if (p.body) p.body.rotation.y = 0.85 * r;
  } else if (pose === 'thrust') meleeSwing(p, 0.27 * r, 'thrust');
  else meleeSwing(p, 0.32);
}
// 出手动作(t: 0→1)
function swingPose(p, pose, t) {
  if (pose === 'overhead') {
    meleeSwing(p, t, 'overhead');
    if (p.armL) p.armL.rotation.x = p.armR.rotation.x;
  } else if (pose === 'sweep') {
    const k = Math.min(1, t * 1.6);
    p.armR.rotation.x = -1.35; p.armR.rotation.z = -1.15 + 1.6 * k;
    if (p.body) p.body.rotation.y = 0.85 - 1.7 * k;
  } else if (pose === 'thrust') meleeSwing(p, 0.28 + 0.72 * t, 'thrust');
  else meleeSwing(p, t);
}
// 人形的出招动画:起手定格在该招的架势、出手按招式挥完;不出招时把侧举的手臂收回
function animateFoeAttack(e, dt) {
  const p = e.parts;
  if (e.windupT > 0) windupPose(p, moveOf(e).pose, 1 - e.windupT / (e.windupDur || 0.62));
  else if (e.swingT > 0) {
    e.swingT -= dt;
    swingPose(p, e.swingPose || 'raise', Math.min(1, 1 - e.swingT / 0.35));
  } else if (p.armR.rotation.z !== 0 || (p.armL && p.armL.rotation.z !== 0)) {
    p.armR.rotation.z = 0;
    if (p.armL) p.armL.rotation.z = 0;
  }
}
// 踉跄(被弹反/破防/盾击/冻住):身子左右打晃、往后仰、刀垂着——一眼看得出"现在是空档"
function staggerPose(e) {
  const k = Math.min(1, (e.stunT || 0) * 2);
  e.group.rotation.z = Math.sin(simNow() * 0.012 + (e.walkT || 0)) * 0.16 * k;
  if (e.parts && e.parts.body) e.parts.body.rotation.x = -0.25 * k;
  if (e.parts && e.parts.armR) { e.parts.armR.rotation.x = 0.45 * k; e.parts.armR.rotation.z = 0; }
  if (k <= 0) e.group.rotation.z = 0;
}
// 踉跄被提前收掉(处决用掉了这次踉跄、被别的效果清零)时,把打晃的身子扶正——否则会一直歪着站
function settleStagger(e) {
  if (e.group.rotation.z !== 0 && !(e.stunT > 0)) e.group.rotation.z = 0;
}

// ================= 反骑兵(盗贼) =================
// 疾驰的马头正冲着自己、7 米内:四成侧扑让开,三成五举刀扎马(红扇形;骑手冲进 2.4 米正面就挨 2 下、半数被掀下马),
// 其余硬吃(被撞翻/砍倒)。举刀时挨一刀就散架——骑砍要抢在扎上来之前出手;同一人 3 秒内只反应一次
const CAV_R = 7, BRACE_R = 2.4, BRACE_ARC = 1.7;
function cavalryReact(b, pd) {
  const h = player.mounted;
  if (!h || h.sheep || (player._rideSpeed || 0) < 15 || (b._cavCd || 0) > 0 || pd > CAV_R) return false;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const rx = b.pos.x - player.pos.x, rz = b.pos.z - player.pos.z;
  if ((rx * fx + rz * fz) / (pd || 1) < 0.75) return false; // 马头没冲着我
  b._cavCd = 3;
  const r = rand();
  if (r < 0.4) {
    const side = rx * fz - rz * fx >= 0 ? 1 : -1;
    b.dodgeT = 0.32;
    b.dodgeVx = fz * side * 8.5;
    b.dodgeVz = -fx * side * 8.5;
    callout('侧扑闪开!', 'dim', b.pos);
    return true;
  }
  if (r < 0.75) {
    b.windupT = 0; b.comboN = 0;
    b.braceT = 1.0;
    b.yaw = Math.atan2(-rx, -rz);
    telegraphFlash(b, 1.0, false, BRACE_R, BRACE_ARC, { watch: () => b.braceT > 0 });
    return true;
  }
  return false;
}
// 举刀扎马的一帧:骑手冲进正面 2.4 米 → 扎中;骑手下了马就收势。返回 true = 本帧被它占用
function tickBrace(b, dt) {
  if (!(b.braceT > 0)) return false;
  b.braceT -= dt;
  if (!player.mounted) { b.braceT = 0; return false; }
  b.yaw = turnToward(b.yaw, Math.atan2(player.pos.x - b.pos.x, player.pos.z - b.pos.z), 5 * dt);
  if (inFrontArc(b, player.pos, BRACE_R, BRACE_ARC)) {
    b.braceT = 0;
    b.attackCd = 1.2;
    b.swingT = 0.3;
    b.swingPose = 'thrust';
    sfx.clank();
    cam.shake = Math.max(cam.shake, 0.4);
    damagePlayer(2, b);
    if (!player.dead && rand() < 0.5) throwFromHorse();
  }
  b.parts._attackAnim = true;
  meleeSwing(b.parts, 0.27, 'thrust');
  b.group.position.copy(b.pos);
  b.group.rotation.y = b.yaw;
  return true;
}

// ================= 实体更新 =================
export function updateGuards(dt) {
  for (const g of guards) {
    clearStaleMove(g);
    settleStagger(g);
    if (g.downT > 0) {
      g.downT -= dt;
      if (g.downT <= 0) { g.hp = 3; g.group.rotation.x = 0; g.state = 'patrol'; }
      continue;
    }
    if (g.stunT > 0) {
      g.stunT -= dt;
      g.windupT = 0; // 蓄力被打断就作废
      staggerPose(g);
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
        // 起手(出招库):慢慢转向你、最后 0.2 秒锁死,末段跟步突进;刀落下按预警范围判定
        if (tickWindup(g, player.pos.x, player.pos.z, dt)) { foeStrike(g, 1); g.attackCd = 0.9; }
      } else {
        if (pd > 1.6) {
          moveEntity(g, player.pos.x, player.pos.z, g.speed, dt);
          moving = true;
        } else if (g.attackCd <= 0) startFoeMove(g, rand() < 0.25 ? 'thrust' : 'slash'); // 卫兵:劈砍为主,间或长驱直刺
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
    animateFoeAttack(g, dt); // 起手架势 / 出手动作
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
    clearStaleMove(b);
    settleStagger(b);
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
    if (b.stunT > 0) { // 踉跄:蓄到一半的招一并作废,免得僵直一过凭空补刀;身子打晃,看得出是空档
      b.stunT -= dt;
      b.windupT = 0;
      b.comboN = 0;
      b.heavyAtk = false;
      b.braceT = 0;
      b.dodgeT = 0;
      staggerPose(b);
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
    if (b.fleeT > 0) { // 溃逃:头也不回地跑,跑够了才敢回头。不管是谁把它吓跑的(士气、战团溃散……),举到一半的刀都收了
      b.fleeT -= dt;
      if (b.windupT > 0 || b.comboN > 0) { b.windupT = 0; b.comboN = 0; b.heavyAtk = false; }
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
    if (b._cavCd > 0) b._cavCd -= dt;
    const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    let moving = false;
    if (b.dodgeT > 0) { // 侧扑让马:一个箭步扑出马道
      b.dodgeT -= dt;
      b.pos.x += b.dodgeVx * dt;
      b.pos.z += b.dodgeVz * dt;
      resolveCollisions(b.pos, 0.4, colliders);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT += dt * 14, true, b.group, 1.4);
      continue;
    }
    if (tickBrace(b, dt)) continue; // 举刀扎马
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
    // 护送任务的埋伏盗贼优先攻击商人(除非玩家贴脸)
    const mc = questRT.merchant;
    if (b.escort && mc && mc.hp > 0 && pd > 5) {
      const md = Math.hypot(mc.pos.x - b.pos.x, mc.pos.z - b.pos.z);
      if (md > 1.4) { moveEntity(b, mc.pos.x, mc.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) {
        b.attackCd = 1.0;
        b.swingT = 0.35;
        mc.hp--;
        sfx.hit();
        toast(`商人受袭!❤ ${Math.max(0, mc.hp)}/5`, 1.5);
      }
    } else if (pd < 30 * sneakFactor() && !player.dead) {
      if (b._midT > 0) b._midT -= dt;
      if (b.windupT > 0) {
        // 起手(出招库):慢慢转向你、最后 0.2 秒锁死,末段跟步突进;刀落下按预警范围判定
        if (tickWindup(b, player.pos.x, player.pos.z, dt)) {
          const kind = foeStrike(b, b.dmg);
          if (kind === 'heavy') { cam.shake = Math.max(cam.shake, 0.25); b.attackCd = 1.7; } // 重击落地:震屏收尾,恢复期更长
          else if (b.comboN > 0) { b.comboN--; startFoeMove(b, 'combo'); b.attackCd = 0.2; } // 二连击:紧接一记快斩
          else b.attackCd = kind === 'slash' ? 1.0 : 1.3;
        }
      } else if (cavalryReact(b, pd)) moving = false; // 疾驰的马冲过来:侧扑或举刀扎马(下一帧起生效)
      else if (pd > 1.6) {
        // 中距离扑刺:2.4~4.4 米、不在冷却、身边出手的不满两人——每 1.2 秒掷一次骰,扑刺过来(往后退不再是万全之策)
        if (pd > 2.4 && pd < 4.4 && b.attackCd <= 0 && !(b._midT > 0) && foesSwinging() < 2) {
          b._midT = 1.2;
          if (rand() < (isElite(b) ? 0.45 : 0.25)) startFoeMove(b, 'thrust');
        }
        if (!(b.windupT > 0)) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      } else if (b.attackCd <= 0) {
        // 车轮战:同时出手的最多两人,其余的绕着你侧向游走等空档(骑砍围攻的呼吸感)
        if (foesSwinging() >= 2) {
          const px = player.pos.x - b.pos.x, pz = player.pos.z - b.pos.z;
          const d = Math.hypot(px, pz) || 1;
          b._orbit = b._orbit || (rand() < 0.5 ? 1 : -1);
          moveEntity(b, b.pos.x + (-pz / d) * b._orbit * 2, b.pos.z + (px / d) * b._orbit * 2, b.speed * 0.55, dt);
          moving = true;
        } else startFoeMove(b, pickFoeMove(b));
      }
    } else {
      const a = simNow() * 0.0003 + b.home.x;
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
    animateFoeAttack(b, dt); // 起手架势(红/紫/横扫/突刺各不相同)/ 出手动作
  }
}
// 身边 20 米内正在出手(起手或挥刀)的盗贼数:车轮战最多两人同时出手
function foesSwinging() {
  let n = 0;
  for (const o of bandits) {
    if (!o.dead && (o.windupT > 0 || o.swingT > 0) && dist2(o.pos.x, o.pos.z, player.pos.x, player.pos.z) < 400) n++;
  }
  return n;
}
// 出招选择:精英(头目/悬赏/决斗/枭首/营地头目)会紫圈破盾重击、二连击、横扫、突刺;杂兵以劈砍为主,间或连击、横扫
function pickFoeMove(b) {
  const r = rand();
  if (isElite(b)) {
    if (r < 0.25) return 'heavy';
    if (r < 0.5) { b.comboN = 1; return 'slash'; }
    if (r < 0.68) return 'sweep';
    if (r < 0.8) return 'thrust';
    return 'slash';
  }
  if (r < 0.15) { b.comboN = 1; return 'slash'; }
  if (r < 0.27) return 'sweep';
  return 'slash';
}
// 狼扑:蹲伏 0.5 秒后以 15 m/s 扑出 0.28 秒(4.2 米),身侧 1.2 米内都算咬中
const WOLF_DASH = 4.2, WOLF_BITE_R = 1.2;
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
    if (w.stunT > 0) { // 踉跄/冻住:身子打晃
      w.stunT -= dt;
      w.group.rotation.z = w.stunT > 0 ? Math.sin(simNow() * 0.012 + w.walkT) * 0.14 * Math.min(1, w.stunT * 2) : 0;
      continue;
    }
    settleStagger(w);
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
        w.pos.x += w.lungeX * (WOLF_DASH / 0.28) * dt;
        w.pos.z += w.lungeZ * (WOLF_DASH / 0.28) * dt;
        resolveCollisions(w.pos, 0.4, colliders);
        if (!w.lungeHit && Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z) < WOLF_BITE_R) {
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
        // 扑咬:冲刺走廊 = 判定范围——扑出 4.2 米、身侧 1.2 米内都咬得到,所以画 5.4×2.4 的长条;横跨出走廊才躲得开
        telegraphFlash(w, 0.5, false, WOLF_DASH + WOLF_BITE_R, 0, { shape: 'rect', width: WOLF_BITE_R * 2,
          watch: () => w.lunging > 0.28 });
        continue;
      }
      if (pd > 1.3) { moveEntity(w, player.pos.x, player.pos.z, w.speed * wolfBuff, dt); moving = true; }
      else if (w.attackCd <= 0) { w.attackCd = 1.4; w.biteT = 0.5; telegraphFlash(w, 0.5, false, 1.7, 2.2); }
    } else {
      const a = simNow() * 0.0004 + w.home.x;
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

