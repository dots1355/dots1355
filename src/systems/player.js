// 玩家:每帧移动与跳跃/骑乘/冲刺/潜行/踩踏(updatePlayer、checkStomp)、翻滚 doRoll、扒窃 tryRob、人群软碰撞 pushCrowd;
// 挨打 damagePlayer(格挡/弹反/破盾/硬直)与倒下 gameOver(按死因给标题、罚没、喷泉旁醒来);
// 派生属性只在这里算:recomputeMaxHp(护甲 + 湖神恩赐 + 屠龙者)、recomputeMaxSta(技艺等级 + 军旗)。
// 每帧小规则:updateRegen(脱战回血)、updateBuffs(庇佑倒计时)、enforceDeepWater(湖面不可徒步)、updateSquash(落地回弹)。
// 玩家对象本身在启动装配时创建并登记进 core/state.js。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { colliders, player, started, world } from '../core/state.js';
import { hitStop } from '../core/timefx.js';
import { simNow } from '../core/timers.js';
import { angleLerp, dist2, makeHumanoid, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { groundH } from '../terrain.js';
import { dismissDialog, showBubble } from '../ui/dialog.js';
import { callout, hitFX } from '../ui/feedback.js';
import { titleArtURL } from '../ui/title.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { endTrial, fishing, inDungeon, lakeBlessed, trialRT } from './activities.js';
import {
  animHorseLegs, animateLimbs, bandits, guards, horses, meleeSwing, villagers, wolves,
} from './actors.js';
import { cancelCharge, endAttack, playerShield, strikePending } from './attack.js';
import { calendar } from './calendar.js';
import { cam } from './camera.js';
import { combatCalmT, lockFoe, meleeSweep, swingTrail } from './combat.js';
import { dragonRT } from './dragon.js';
import { chickens, pokeChicken } from './fauna.js';
import { ARMORS, WEAPONS } from './gear.js';
import { keys } from './input.js';
import { clearWanted, crime, wanted } from './law.js';
import { SKILL_DEFS, skillLv, skillXp, spendSta } from './magic.js';
import { MIND, remember, workspace } from './mind.js';
import { namedNPCs } from './npcs.js';
import { dropCoins } from './pickups.js';
import { prologue, skipPrologue } from './prologue.js';
import { warband } from './warband.js';
import { spawnDust } from './weather.js';

// ================= 玩家更新 =================
// 受击红闪与倒下画面
const flashEl = document.getElementById('flash'),
  gameoverEl = document.getElementById('gameover'), gameoverText = document.getElementById('gameover-text');
const _moveFwd = new THREE.Vector2();
const _moveRight = new THREE.Vector2();
const _moveVec = new THREE.Vector2();
export function updatePlayer(dt) {
  if (player.dead) return;
  player.invulnT = Math.max(0, player.invulnT - dt);

  // 醉酒:打嗝 + 清醒判定
  if (player.drunkT > 0) {
    player.drunkT -= dt;
    player.hiccupT -= dt;
    if (player.hiccupT <= 0) {
      player.hiccupT = 3 + rand() * 3;
      sfx.hiccup();
      cam.shake = Math.max(cam.shake, 0.12);
    }
    if (player.drunkT <= 0) toast('你清醒过来了……头好痛。', 2.5);
  }

  // 攻击动画(三段式:蓄力→劈砍→收势)
  if (player.attackT > 0) {
    player.attackT -= dt;
    const t = 1 - player.attackT / (player.attackDur || 0.35);
    const from = player._animFrom || 0; // 重击从蓄力举剑位接着播
    player.parts._attackAnim = true;
    meleeSwing(player.parts, Math.min(1, from + (1 - from) * t), player._stance);
    if (player.attackT <= 0) endAttack();
  }

  const f = _moveFwd.set(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  const r = _moveRight.set(-f.y, f.x);
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  const mv = _moveVec.set(f.x * iz + r.x * ix, f.y * iz + r.y * ix);
  const moving = mv.lengthSq() > 0;
  if (moving) mv.normalize();
  // 醉酒:走路画龙
  if (moving && player.drunkT > 0) {
    const wob = Math.sin(performance.now() * 0.0012) * 0.7;
    const cw = Math.cos(wob), sw = Math.sin(wob);
    mv.set(mv.x * cw - mv.y * sw, mv.x * sw + mv.y * cw);
  }

  if (player.mounted) {
    const h = player.mounted;
    const speed = h.sheep
      ? (keys['ShiftLeft'] || keys['ShiftRight'] ? 4.6 : 3.2)
      : (keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11) * (h.fast ? 1.2 : 1) *
        (1 + 0.02 * (skillLv('riding') - 1)); // 骑术:人马合一
    player._rideSpeed = moving ? speed : 0; // 冲量记账:马上挥刀按马速加成
    // 骑砍冲锋践踏:疾驰状态撞上敌人,连人带马把他掀翻
    if (!h.sheep && speed >= 16 && moving) {
      for (const list of [bandits, wolves]) {
        for (const e of list) {
          if (e.dead || e.downT > 0 || (e._trampleCd || 0) > 0) continue;
          if (dist2(h.pos.x, h.pos.z, e.pos.x, e.pos.z) > 3.2) continue;
          e._trampleCd = 2.5;
          // 践踏只把人撞个趔趄(0.5 秒、不扣血、不开处决):冲阵要靠马上那一刀,不是自动清场
          if (e.stunT !== undefined) { e.stunT = Math.max(e.stunT || 0, 0.5); e.stunSrc = 'bash'; }
          hitFX(e, 2.2);
          callout('撞翻!', 'gold', e.pos);
          sfx.hoof();
          cam.shake = Math.max(cam.shake, 0.25);
          skillXp('riding', 2);
        }
      }
    }
    if (moving) {
      // 坡度:马能爬缓坡,陡坡明显吃力,悬崖上不去;下坡略快
      const hg0 = groundH(h.pos.x, h.pos.z);
      const hg1 = groundH(h.pos.x + mv.x * 1.2, h.pos.z + mv.y * 1.2);
      const hGrade = (hg1 - hg0) / 1.2;
      const hSlope = hGrade > 0 ? Math.max(0.1, 1 - Math.max(0, hGrade - 0.3) * 1.25) : Math.min(1.1, 1 - hGrade * 0.12);
      h.pos.x += mv.x * speed * hSlope * dt;
      h.pos.z += mv.y * speed * hSlope * dt;
      h.yaw = angleLerp(h.yaw, Math.atan2(mv.x, mv.y), dt * 6);
      h.walkT += dt * speed * 1.6;
      if (h.sheep) {
        stats.sheepDist += speed * dt;
        if (stats.sheepDist >= 100) unlockAch('shepherd');
      }
    }
    // 骑乘跳跃
    if (keys['Space'] && player.onGround) {
      player.vy = 8;
      player.onGround = false;
      sfx.jump();
      keys['Space'] = false;
    }
    const horseAirborne = !player.onGround;
    player.vy -= 22 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vy = 0;
      player.onGround = true;
      if (horseAirborne) spawnDust(h.pos.x, 0.1, h.pos.z, 7, 1.4, 1.8);
    }
    // 马蹄声与扬尘(节奏随速度)
    if (moving && player.onGround) {
      h.stepT = (h.stepT || 0) - dt;
      if (h.stepT <= 0) {
        h.stepT = (keys['ShiftLeft'] || keys['ShiftRight']) ? 0.17 : 0.32;
        if (h.sheep) { if (rand() < 0.22) sfx.baa(); }
        else sfx.hoof();
        spawnDust(h.pos.x - Math.sin(h.yaw) * 1.1, 0.08, h.pos.z - Math.cos(h.yaw) * 1.1,
          (keys['ShiftLeft'] || keys['ShiftRight']) ? 3 : 1, 0.8, 1.3);
      }
    }
    resolveCollisions(h.pos, 0.85, colliders);
    h.pos.y = player.pos.y;
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    const galloping = moving && (keys['ShiftLeft'] || keys['ShiftRight']);
    animHorseLegs(h, moving ? (galloping ? 1.6 : 1.0) : 0);
    cam.moveState = moving ? (galloping ? 3 : 2) : 0;
    player.pos.x = h.pos.x;
    player.pos.z = h.pos.z;
    player.yaw = h.yaw;
    // 骑手随马起伏,疾驰时前倾(骑羊时……贴地飞行)
    player.group.position.set(h.pos.x, h.pos.y + (h.sheep ? 0.72 : 1.35) + (h.visBob || 0), h.pos.z);
    player.group.rotation.y = h.yaw;
    player.parts.legL.rotation.x = -1.1;
    player.parts.legR.rotation.x = -1.1;
    player.parts.body.rotation.x = galloping ? 0.3 : 0.1;
    player.parts.armL.rotation.x = -0.55;
    if (!player.parts._attackAnim) player.parts.armR.rotation.x = -0.55;
    return;
  }

  // 翻滚接管本帧
  if (player.rollCd > 0) player.rollCd -= dt;
  if (player.rollT > 0) {
    player.rollT -= dt;
    player.pos.x += player.rollDir.x * 13 * dt;
    player.pos.z += player.rollDir.y * 13 * dt;
    resolveCollisions(player.pos, 0.45, colliders);
    player.group.position.copy(player.pos);
    player.group.rotation.y = player.yaw;
    player.group.rotation.x = -(1 - Math.max(0, player.rollT) / 0.38) * Math.PI * 2;
    if (player.rollT <= 0) player.group.rotation.x = 0;
    cam.moveState = 2;
    return;
  }
  // 疾跑吃体力:跑干了就只能小步喘(骑砍的腿);出招与蓄力时不能疾跑
  const committed = player.attackT > 0 && !(player.lungeT > 0); // 出招有承诺:脚下收住
  const canSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && player.sta > 0.5 && player.gaspT <= 0 &&
    !committed && !player.charging;
  const speed = (canSprint ? 8.4 : 5.0) * (player.blocking ? 0.45 : 1) *
    (committed ? 0.3 : 1) * (player.charging ? 0.5 : 1) *
    (player.blessT > 0 ? 1.15 : 1) * // 教堂庇佑:脚下生风
    (player.homeDay === calendar.day ? 1.08 : 1) * // 在自家床上睡过:安眠增益
    (player.sneaking ? 0.5 : 1) * // 潜行:压着步子
    (player.gaspT > 0 ? 0.75 : 1) * (player.staggerT > 0 ? 0.35 : 1); // 喘气/踉跄拖腿
  const prevYaw = player.yaw;
  if (moving) {
    // 坡度:上坡越陡越慢(陡崖几乎爬不动),下坡略快——山才像山
    const h0 = groundH(player.pos.x, player.pos.z);
    const h1 = groundH(player.pos.x + mv.x * 0.8, player.pos.z + mv.y * 0.8);
    const grade = (h1 - h0) / 0.8;
    const slopeMul = grade > 0 ? Math.max(0.12, 1 - Math.max(0, grade - 0.25) * 1.15) : Math.min(1.12, 1 - grade * 0.15);
    player.pos.x += mv.x * speed * slopeMul * dt;
    player.pos.z += mv.y * speed * slopeMul * dt;
    // 出招中不跟着脚步转身(刀已出手);蓄力时只能慢慢调整朝向
    if (!lockFoe && !committed) player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * (player.charging ? 4 : 12));
    player.walkT += dt * speed * 2.2;
    if (canSprint) player.sta = Math.max(0, player.sta - 7 * dt);
  }
  // 锁定中:身体始终朝着目标,移动变成环绕侧步
  if (lockFoe) {
    player.yaw = angleLerp(player.yaw,
      Math.atan2(lockFoe.pos.x - player.pos.x, lockFoe.pos.z - player.pos.z), dt * 14);
  }
  cam.moveState = moving ? (speed > 5 ? 2 : 1) : 0;
  if (fishing.active && moving) {
    fishing.active = false;
    toast('收竿了。', 1.5);
  }
  // 疾跑扬尘
  if (moving && player.onGround && speed > 5) {
    player.stepT = (player.stepT || 0) - dt;
    if (player.stepT <= 0) {
      player.stepT = 0.22;
      spawnDust(player.pos.x, 0.05, player.pos.z, 1, 0.35, 1.0);
    }
  }
  // 转向侧倾
  let dyaw = (player.yaw - prevYaw) % (Math.PI * 2);
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  player.lean = (player.lean || 0) * 0.86 + Math.max(-0.16, Math.min(0.16, -dyaw * 1.6)) * 0.14;

  // 跳跃(二段跳)
  if (keys['Space']) {
    if (player.onGround) {
      player.vy = 8.2; player.onGround = false; player.jumps = 1; sfx.jump();
    } else if (player.jumps === 1) {
      player.vy = 7.4; player.jumps = 2; sfx.jump();
    }
    keys['Space'] = false;
  }
  const wasAirborne = !player.onGround;
  const fallSpeed = player.vy;
  player.vy -= 22 * dt;
  // 抱着鸡:扑腾缓降(塞尔达欠我们的)
  if (player.carrying && player.vy < -2.4) player.vy = -2.4;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vy = 0;
    // 先重置着地状态,再判定踩踏——checkStomp 的弹跳(onGround=false)才能保留,支持连环踩踏
    player.onGround = true;
    player.jumps = 0;
    if (player.plunging) {
      // 跳劈落地:全方位冲击波
      player.plunging = false;
      const def = WEAPONS[player.weapon];
      sfx.stomp();
      cam.shake = Math.max(cam.shake, 0.4);
      hitStop(0.05);
      spawnDust(player.pos.x, 0.1, player.pos.z, 14, 2.4, 2);
      swingTrail(3.4, Math.PI * 2);
      meleeSweep(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + 1, 3.4, -1.01, def.knock * 1.6);
      stats.plunges = (stats.plunges || 0) + 1;
    }
    if (wasAirborne && fallSpeed < -3) checkStomp();
    if (wasAirborne && fallSpeed < -4) player.squashT = 0.16; // 落地挤压
    if (wasAirborne && fallSpeed < -10) cam.shake = 0.22;
    if (wasAirborne && fallSpeed < -6) spawnDust(player.pos.x, 0.06, player.pos.z, 6, 0.9, 1.5);
  }

  resolveCollisions(player.pos, 0.45, colliders);
  pushCrowd();
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  player.group.rotation.z = player.lean || 0;
  // 受伤闪烁
  player.group.visible = player.invulnT > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true;
  animateLimbs(player.parts, player.walkT, moving, player.group, speed / 7.6);
  // 格挡姿势:有盾就把左臂的圆盾横在身前、剑收在腰侧;巨剑没盾,横剑挡
  playerShield.visible = player.weapon !== 'bow' && player.weapon !== 'greatsword';
  const hasShield = playerShield.visible;
  if (player.blocking && !player.parts._attackAnim) {
    if (hasShield) {
      player.parts.armL.rotation.x = -1.3;
      player.parts.armL.rotation.z = 0.55;
      player.parts.armR.rotation.x = -0.45;
      player.parts.armR.rotation.z = -0.2;
    } else {
      player.parts.armR.rotation.x = -1.35;
      player.parts.armR.rotation.z = -0.5;
    }
  } else if (!player.parts._attackAnim) {
    player.parts.armR.rotation.z = 0;
  }
  if (!player.blocking) player.parts.armL.rotation.z = 0;
  playerShield.rotation.y = player.blocking ? -1.1 : 0; // 举盾时盾面转向正前
  // 施法:抬手前推(火球聚能时一直举着)
  if ((player.castPoseT > 0 || player.fireCharging) && !player.parts._attackAnim && !player.blocking) {
    player.parts.armR.rotation.x = -1.45;
    player.parts.armR.rotation.z = 0.15;
    player.parts.armL.rotation.x = -1.1;
  }
  // 挨打:身子一缩、往后一仰(0.3 秒硬直)
  if (player.hurtT > 0) {
    player.hurtT -= dt;
    player.parts.body.rotation.x = -0.3 * Math.min(1, player.hurtT / 0.15);
  }
  // 抱鸡:高举过头,鸡随身,空中扑腾
  if (player.carrying) {
    const c = player.carrying;
    c.pos.set(player.pos.x, player.pos.y + 1.78, player.pos.z);
    c.group.position.copy(c.pos);
    c.group.rotation.y = player.yaw;
    c.walkT += dt * (player.onGround ? 4 : 26);
    c.parts.body.position.y = 0.26 + (!player.onGround ? Math.abs(Math.sin(c.walkT)) * 0.07 : 0);
    if (!player.parts._attackAnim) {
      player.parts.armL.rotation.x = Math.PI * 0.92;
      player.parts.armR.rotation.x = Math.PI * 0.92;
    }
  }
}

function checkStomp() {
  const tryStomp = (list, isGuard) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.stunT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 1.3) {
        e.stunT = 5; e.stunSrc = 'other';
        player.vy = 7.5;
        player.onGround = false;
        player.jumps = 1;
        sfx.stomp();
        const nowS = performance.now() / 1000;
        if (nowS - stats.lastStomp < 2) unlockAch('bouncer');
        stats.lastStomp = nowS;
        spawnDust(e.pos.x, 0.3, e.pos.z, 6, 0.8, 1.6);
        toast(isGuard ? '踩晕了卫兵!' : '踩晕了敌人!', 1.5);
        if (isGuard) crime(1);
        return true;
      }
    }
    return false;
  };
  // 踩到鸡:弹起 + 拉仇恨
  for (const c of chickens) {
    if (c === player.carrying || c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 1.1) {
      pokeChicken(c);
      player.vy = 7.5;
      player.onGround = false;
      player.jumps = 1;
      sfx.stomp();
      return true;
    }
  }
  return tryStomp(guards, true) || tryStomp(bandits, false) || tryStomp(wolves, false);
}

export function doRoll() {
  if (!started || player.dead || player.mounted || player.carrying ||
      player.rollCd > 0 || player.rollT > 0 || !player.onGround || player.staggerT > 0) return;
  if (!spendSta(15)) return;
  player.lastRollAt = simNow(); // 序章"真的躲开了"的判定要用
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = -fz, rz = fx;
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
  if (dx === 0 && dz === 0) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); }
  const d = Math.hypot(dx, dz);
  player.rollDir.set(dx / d, dz / d);
  player.yaw = Math.atan2(dx, dz);
  player.rollT = 0.38;
  player.rollCd = 0.95;
  player.invulnT = Math.max(player.invulnT, 0.45); // 无敌帧
  sfx.roll();
  spawnDust(player.pos.x, 0.05, player.pos.z, 4, 0.5, 1);
}

export function tryRob() {
  if (!started || player.dead || player.mounted) return;
  // 扒窃(天际式):潜行状态从背后下手——无声取财;失手立刻炸锅
  if (player.sneaking) {
    for (const v of villagers) {
      if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
      if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6.5) continue;
      const dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const behind = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / d < -0.1; // 站在其背后
      const chance = Math.min(0.92, (behind ? 0.55 : 0.25) + 0.05 * (skillLv('sneak') - 1));
      v.robbedT = 90;
      if (rand() < chance) {
        skillXp('sneak', 3);
        stats.pockets = (stats.pockets || 0) + 1;
        if (stats.pockets >= 5) unlockAch('cutpurse');
        if (rand() < 0.4) { // 摸到的不是钱,是赃物——城里没人敢收
          player.loot = (player.loot || 0) + 1;
          sfx.chest();
          const item = ['一支银簪', '一块怀表', '一只铜烛台', '一枚刻名的戒指', '半串珍珠'][Math.floor(rand() * 5)];
          toast(`🫲 摸到${item}(赃物 ×${player.loot})。城里没人敢收——听说沼泽那位不问来路。`, 3.5);
        } else {
          const take = 2 + Math.floor(rand() * 5);
          player.coins += take;
          sfx.coin();
          toast(`🤫 得手!从${v.id.name}兜里摸走 ${take} 金币。(没人看见……吧?)`, 2.5);
        }
      } else {
        v.fleeT = 6;
        showBubble(v, v.id.name, '有贼!我的钱袋!!', 3);
        crime(1, '🫲 扒窃失手,被当场抓包!');
      }
      return;
    }
    toast('附近没有下手的对象。(蹲着走过去,贴到背后)', 2);
    return;
  }
  for (const v of villagers) {
    if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6) continue;
    v.robbedT = 60;
    v.fleeT = 6;
    dropCoins(v.pos, 3 + Math.floor(rand() * 4));
    showBubble(v, v.id.name, '救命!抢劫啦——!!', 3);
    crime(2, '💰 你抢劫了村民!');
    return;
  }
  toast('附近没有可以抢的人。(你在想什么?)', 2);
}
function pushCrowd() {
  const softly = (list, r) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.sleeping || e === player.mounted) continue;
      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < r * r && dd > 1e-6) {
        const d = Math.sqrt(dd), pv = r - d;
        player.pos.x += (dx / d) * pv * 0.6;
        player.pos.z += (dz / d) * pv * 0.6;
        e.pos.x -= (dx / d) * pv * 0.35;
        e.pos.z -= (dz / d) * pv * 0.35;
      }
    }
  };
  softly(villagers, 0.75);
  softly(guards, 0.75);
  softly(namedNPCs, 0.8);
  softly(bandits, 0.75);
  softly(wolves, 0.7);
  softly(horses, 1.05);
}

// ================= 玩家本体 =================
// 游侠林恩:苔绿兜帽 + 短披风。启动装配时生成一次(人形模型就绪之后),由 main 登记进 core/state.js
export function spawnPlayer(spawn) {
  const p = {
    ...makeHumanoid({ shirt: 0x4b5e3c, pants: 0x5a4430, ranger: true, sword: true }), // 游侠:苔绿兜帽 + 短披风
    pos: spawn.clone(),
    vy: 0, yaw: 0, onGround: true, jumps: 0,
    hp: 10, maxHp: 10, coins: 0,
    sta: 100, maxSta: 100, gaspT: 0, staggerT: 0, // 体力(骑砍核心):出手/翻滚/格挡皆有代价

    walkT: 0, attackT: 0, invulnT: 0, mounted: null, dead: false, herbs: 0, venison: 0,
    parcel: null, swordLv: 1, royalHorse: false,
    carrying: null, drunkT: 0, hiccupT: 0,
    // 法术:魔光弹与生俱来,R 键即放(法力自然回复)
    mp: 8, maxMp: 8, spells: ['spark'], spellIdx: 0, castT: 0,
    // 技艺熟练度:用什么涨什么(定义见 systems/magic.js 的 SKILL_DEFS)
    skills: Object.fromEntries(Object.keys(SKILL_DEFS).map((k) => [k, { lv: 1, xp: 0 }])),
    // 装备(systems/gear.js):手中武器、已拥有的武器、护甲档
    weapon: 'sword', weaponsOwned: ['sword'], armor: 0,
    // 格挡与翻滚(systems/attack.js、systems/player.js)
    blocking: false, rollT: 0, rollCd: 0, rollDir: new THREE.Vector2(0, 1),
  };
  p.group.position.copy(p.pos);
  scene.add(p.group);
  return p;
}

// ================= 派生属性:只在这里计算 =================
// 生命上限:10 + 护甲 + 湖神恩赐 + 屠龙者。读档、买甲、奇遇都走这一处
export function recomputeMaxHp() {
  player.maxHp = 10 + ((ARMORS[player.armor] && ARMORS[player.armor].bonus) || 0) +
    (lakeBlessed ? 2 : 0) + (stats.dragonSlain ? 2 : 0);
  player.hp = Math.min(player.hp, player.maxHp);
  return player.maxHp;
}
// 体力上限:100 + 每级技艺 3 + 每面军旗 5,封顶 180。不入档——读档、技艺升级、夺旗都走这一处重算
export function recomputeMaxSta() {
  player.maxSta = Math.min(180, 100 + 3 *
    Object.values(player.skills || {}).reduce((n, s) => n + Math.max(0, (s.lv || 1) - 1), 0) +
    5 * (stats.banners || 0));
  return player.maxSta;
}

// ================= 玩家的每帧小规则 =================
// 脱战回血:离开战斗几秒后,每 2.5 秒回半颗心(不必非得找旅店或死一次)
export function updateRegen(dt) {
  if (!player.dead && combatCalmT <= 0 && player.hp < player.maxHp && !inDungeon()) {
    player.regenT = (player.regenT || 0) + dt;
    if (player.regenT >= 2.5) { player.regenT = 0; player.hp = Math.min(player.maxHp, player.hp + 1); }
  } else player.regenT = 0;
}
// 限时增益倒计时(教堂庇佑:脚下生风)
export function updateBuffs(dt) {
  if (player.blessT > 0) player.blessT -= dt;
}
// 深水规则:银月湖面不可徒步——栈桥走廊(|x+100|<1.3 即桥面宽,且 z<92)与湖心岛(距岛心<6.8)除外。
// 每帧检查,步幅远小于缓冲带宽,冲刺也蹚不过去;上岛只能靠小船。
let wadeToastAt = 0;
export function enforceDeepWater(now) {
  const ldx = player.pos.x + 100, ldz = player.pos.z - 100;
  const lakeD = Math.hypot(ldx, ldz);
  if (lakeD < 28.5 && lakeD > 6.8 &&
      !(Math.abs(ldx) < 1.3 && player.pos.z < 92)) {
    const push = 28.5 / (lakeD || 1);
    player.pos.x = -100 + ldx * push;
    player.pos.z = 100 + ldz * push;
    if (player.mounted) { // 马也不会凫水:连人带马一起退回来
      player.mounted.pos.x = player.pos.x;
      player.mounted.pos.z = player.pos.z;
    }
    if (wadeToastAt < now - 4000) {
      wadeToastAt = now;
      toast('湖水一下子深了,你退了回来。(想上岛?栈桥边有小船)', 3);
    }
  }
}
// 落地挤压回弹(潜行时本来就矮一截)
export function updateSquash(dt) {
  if (!(player.squashT > 0)) return;
  player.squashT = Math.max(0, player.squashT - dt);
  const base = player.sneaking ? 0.8 : 1;
  player.group.scale.y = base * (1 - 0.18 * (player.squashT / 0.16));
}
// 挨打硬直:打断自己正在出的刀(判定帧未到的作废)、散掉蓄力与火球聚能,身子后仰一下
function playerHitStagger(t) {
  player.staggerT = Math.max(player.staggerT || 0, t);
  player.hurtT = 0.3;
  if (strikePending()) { player.strike = null; endAttack(); }
  player.atkBufT = 0;
  cancelCharge();
  if (player.fireCharging) { player.fireCharging = false; player.fireChargeT = 0; }
}
export function damagePlayer(n, attacker = null, pierce = false) {
  if (player.invulnT > 0 || player.dead) return;
  player.lastHitBy = attacker ? (wolves.includes(attacker) ? 'wolf' : guards.includes(attacker) ? 'guard' : 'bandit')
    : (dragonRT.on ? 'dragon' : 'other');
  // 盾只护正面:从侧后方来的刀挡不住(绕背、包夹才有意义)
  let blockOk = player.blocking && player.rollT <= 0;
  if (blockOk && attacker && attacker.pos) {
    const dx = attacker.pos.x - player.pos.x, dz = attacker.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if ((Math.sin(player.yaw) * dx + Math.cos(player.yaw) * dz) / d < -0.15) {
      blockOk = false;
      callout('身后中招!盾只护正面', 'red');
    }
  }
  if (blockOk) {
    // 完美弹反:出手前 0.25 秒内举盾 → 攻击者踉跄 2 秒 + 时停
    if (attacker && attacker.stunT !== undefined &&
        simNow() - (player.blockStart ?? -1e9) < 250) {
      attacker.stunT = Math.max(attacker.stunT || 0, 2.2); attacker.stunSrc = 'parry';
      hitStop(0.14);
      cam.shake = Math.max(cam.shake, 0.25);
      sfx.clank();
      sfx.clear();
      callout('完美弹反!快还击', 'gold');
      if (prologue.on) { prologue.flags.blocked = true; prologue.flags.parried = true; }
      stats.parries = (stats.parries || 0) + 1;
      if (stats.parries >= 5) unlockAch('parry');
      player.invulnT = 0.5;
      player.riposteT = 1.5; // 还击窗口
      player.sta = Math.min(player.maxSta, player.sta + 10); // 完美弹反回气:精准的奖赏
      return;
    }
    if (pierce) { // 紫圈重击:格挡被砸碎,硬吃一记减伤——早该翻滚的
      sfx.clank();
      sfx.hurt();
      cam.shake = Math.max(cam.shake, 0.4);
      callout('格挡被砸碎!紫圈要翻滚', 'red');
      player.hp -= 1;
      player.invulnT = 0.7;
      playerHitStagger(0.4);
      flashEl.style.opacity = 0.45;
      setTimeout(() => (flashEl.style.opacity = 0), 120);
      if (player.hp <= 0) gameOver();
      return;
    }
    // 格挡也要花力气:每挡一下 -14 体力(一直举盾不是万能的),挡空了盾会被砸开
    sfx.clank();
    if (prologue.on) prologue.flags.blocked = true;
    player.sta = Math.max(0, player.sta - 14);
    if (player.sta <= 0) {
      player.blocking = false;
      player.staggerT = 0.9;
      player.gaspT = 1.2;
      cam.shake = Math.max(cam.shake, 0.35);
      callout('力竭!盾被砸开', 'red');
      sfx.hiccup();
      player.invulnT = 0.5;
      return;
    }
    cam.shake = Math.max(cam.shake, 0.15);
    player.invulnT = 0.35;
    return;
  }
  player.hp -= n;
  player.invulnT = 0.7;
  cam.shake = 0.45;
  playerHitStagger(0.3); // 挨打有代价:手里这刀作废、蓄力散掉、0.3 秒缓不过劲
  fishing.active = false;
  sfx.hurt();
  flashEl.style.opacity = 0.45;
  setTimeout(() => (flashEl.style.opacity = 0), 120);
  if (player.hp <= 0) gameOver();
}
function gameOver() {
  if (prologue.on) skipPrologue(true); // 序章里倒下:直接放行,别卡教学
  if (warband.duelOn) { // 单挑落败:誓约解除,攻城继续
    warband.duelOn = false;
    warband.members.forEach((b) => { b._truce = false; });
  }
  dismissDialog(); // 人都倒了,话就别说了
  player.fireChargeT = 0;
  player.dead = true;
  player.hp = 0;
  player.drunkT = 0;
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  sfx.gameover();
  if (trialRT.active) endTrial(false);
  stats.deaths = (stats.deaths || 0) + 1;
  // 它眼睁睁看着他倒下:这颗心的重大事件——心境重击、惊讶拉满、记进长期记忆
  workspace.mood.v = Math.max(-1, workspace.mood.v - 0.5);
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.5);
  MIND.surprise = Math.max(MIND.surprise, 0.8);
  remember(`它眼睁睁看着他倒下了(第 ${stats.deaths} 次)`, `death-${calendar.day}`);
  player.jailed = wanted > 0;
  // 按死因给标题:被抓、葬身狼口、倒在匪刃下、霜龙之怒……
  const cause = wanted > 0 ? ['通缉终结', '你被王国卫兵抓住了!关进地牢,罚没一半金币。']
    : player.lastHitBy === 'wolf' ? ['葬身狼口', '狼群把你拖倒了……']
    : player.lastHitBy === 'dragon' ? ['霜龙之怒', '冰息吞没了你……幸存者把你抬回了王都。']
    : player.lastHitBy === 'bandit' ? ['倒在匪刃下', '盗贼搜走了你一半的金币。']
    : ['你倒下了', '眼前一黑……'];
  gameoverEl.querySelector('h1').textContent = cause[0];
  gameoverText.textContent = cause[1];
  if (titleArtURL) {
    gameoverEl.style.backgroundImage =
      `linear-gradient(rgba(70,0,0,0.72), rgba(30,0,0,0.85)), url(${titleArtURL})`;
    gameoverEl.style.backgroundSize = 'cover';
    gameoverEl.style.backgroundPosition = 'center';
  }
  gameoverEl.style.display = 'flex';
  setTimeout(() => {
    if (player.jailed) player.pos.set(13, 0, -28);
    else player.pos.copy(world.playerSpawn);
    player.hp = player.maxHp;
    player.coins = Math.floor(player.coins / 2);
    player.mounted = null;
    player.vy = 0;
    clearWanted();
    player.dead = false;
    gameoverEl.style.display = 'none';
    if (player.jailed && player.loot > 0) { player.loot = 0; } // 赃物人赃并获,全数充公
    const lostHow = player.lastHitBy === 'bandit' ? '盗贼搜走了你一半的金币'
      : player.lastHitBy === 'wolf' ? '赶狼的牧人把你背了回来,一半金币算作谢礼'
        : player.lastHitBy === 'dragon' ? '幸存者把你抬回了王都,一半金币付了药钱'
          : '一半金币不知丢在了哪里';
    toast(player.jailed
      ? '⛓️ 你在王都地牢蹲了一夜,罚没一半金币后被踢了出来。' + (player.loot === 0 ? '(兜里的赃物也被搜走了)' : '')
      : stats.deaths >= 3
        ? `你第 ${stats.deaths} 次在喷泉旁醒来(${lostHow})。水声轻得……像是有谁悄悄调小了。`
        : `你在喷泉旁醒来——${lostHow}。`, 4);
  }, 2600);
}
