// 霜龙(龙骨之地终局 Boss):学会战吼后夜里再触龙颅,骨翼重聚血肉。
// 空中盘旋,每 3~5 秒出一招:俯冲(整条贴地航线画成长条预警、破防;常常掉头连冲两次)/ 追踪冰息(三团冰爆
// 依次砸向你脚下,站着不动必中);掉血到阈值落地喘息(每次最多挨 6 点),落地时龙尾横扫
// (紫环,破防)与正面爪击(红扇形,可格挡)轮番来。状态全在 dragonRT;对空瞄准 dragonAim 在魔法模块里读它。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { frame } from '../core/frame.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import { player } from '../core/state.js';
import { hitStop, slowMo } from '../core/timefx.js';
import { later } from '../core/timers.js';
import { angleLerp, dist2, makeDragon } from '../entities.js';
import { scene } from '../gfx/core.js';
import { pooledMat } from '../gfx/pools.js';
import { openDialog } from '../ui/dialog.js';
import { callout, showDamage } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { cam } from './camera.js';
import { dangerFX, dangerMat, inCorridor, inFrontArc, telegraphFlash } from './combat.js';
import { DRAGON_SKULL, addFrostPatch, explodeAt } from './magic.js';
import { remember } from './mind.js';
import { damagePlayer, recomputeMaxHp } from './player.js';
import { spawnDust } from './weather.js';

// ================= 霜龙苏醒(龙骨之地终局 Boss)=================
// 学会战吼后,夜里再触龙颅——骨翼重聚血肉。空中盘旋/俯冲/追踪冰息;掉血落地喘息时才能近战。
export const dragonRT = { on: false, ent: null, hp: 0, maxHp: 30, phase: 'circle', t: 0, h: 9, ang: 0,
  landAt: [], _sw: false, _breathed: false };
export function awakenDragon() {
  const d = makeDragon();
  d.group.scale.setScalar(1.5);
  dragonRT.ent = d;
  dragonRT.on = true;
  dragonRT.hp = dragonRT.maxHp;
  dragonRT.phase = 'rise';
  dragonRT.t = 0;
  dragonRT.ang = 0;
  dragonRT.landAt = [23, 13, 5];
  dragonRT.landDmg = 0;
  d.group.position.set(DRAGON_SKULL.x, 0.5, DRAGON_SKULL.z);
  scene.add(d.group);
  cam.shake = 0.6;
  sfx.wanted();
  sfx.stomp();
  toast('🐉 大地震颤——霜龙的残魂闻声而起,骨翼重聚血肉!!(飞行时用弓和法术,等它落地喘息再上刀)', 6);
  remember('在龙骨之地唤醒了霜龙的残魂', 'dragonwake');
}
const DRAGON_LAND_CAP = 6; // 每次落地最多挨 6 点:落地是窗口,不是刑场
export function damageDragon(nDmg, from) {
  if (!dragonRT.on || dragonRT.hp <= 0) return;
  if (dragonRT.phase === 'land') {
    nDmg = Math.min(nDmg, DRAGON_LAND_CAP - (dragonRT.landDmg || 0));
    if (nDmg <= 0) return;
    dragonRT.landDmg = (dragonRT.landDmg || 0) + nDmg;
  } else if (dragonRT.phase !== 'dead') nDmg = Math.max(1, Math.round(nDmg * 0.75)); // 空中:鳞甲迎风,打七五折
  dragonRT.hp -= nDmg;
  showDamage(dragonRT.ent.group.position, nDmg, nDmg >= 3);
  sfx.hit();
  if (dragonRT.hp <= 0) {
    dragonRT.phase = 'dead';
    dragonRT.t = 2.2;
    hitStop(0.25);
    slowMo(0.8);
    cam.shake = 0.8;
    return;
  }
  if (dragonRT.phase === 'land') {
    // 落地中跨过的阈值直接作废(不再重置落地计时、连锁续地);挨满上限就振翅起飞
    while (dragonRT.landAt.length && dragonRT.hp <= dragonRT.landAt[0]) dragonRT.landAt.shift();
    if (dragonRT.landDmg >= DRAGON_LAND_CAP) {
      dragonRT.t = Math.min(dragonRT.t, 0.6);
      callout('霜龙怒吼,要起飞了!', 'red');
    }
    return;
  }
  if (dragonRT.landAt.length && dragonRT.hp <= dragonRT.landAt[0]) {
    const g0 = dragonRT.ent.group;
    while (dragonRT.landAt.length && dragonRT.hp <= dragonRT.landAt[0]) dragonRT.landAt.shift();
    dragonRT.phase = 'land';
    dragonRT.t = 7;
    dragonRT.landDmg = 0;
    dragonRT.atkT = 1.4;
    dragonRT.landAtk = null;
    dragonRT.nextClaw = rand() < 0.5;
    g0.rotation.x = 0;
    g0.rotation.z = 0;
    callout('霜龙坠地喘息——上刀!', 'gold');
    sfx.stomp();
    cam.shake = Math.max(cam.shake, 0.4);
  }
}
// 地面范围预警:一圈不收缩的红环(冰息落点等);purple=紫环(破防:盾挡不住,只能滚/退出圈外)
export function telegraphArea(x, z, r, dur, purple = false) {
  sfx.warn();
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.2, r - 0.6), r, 48, 1), pooledMat(dangerMat));
  if (purple) ring.material.color.setHex(0xb040ff);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.12, z);
  scene.add(ring);
  dangerFX.push({ ring, e: { pos: { x, z }, dead: false }, t: 0, dur, fixed: true });
}
// ---- 招式参数 ----
const AIR_GAP = [3, 5];           // 空中两招之间隔 3~5 秒
const SWOOP_SPEED = 24, SWOOP_HALF_W = 2.6, SWOOP_OVER = 6; // 俯冲:冲过你脚下 6 米再拉起,身侧 2.6 米内都会被扫到
const SWOOP_DIVE = 5;             // 头 5 米还在半空往下扎(够不着人),之后贴地掠过——只有贴地段判伤,预警也只画这一段
const BREATH_N = 3, BREATH_GAP = 0.36, BREATH_WARN = 0.8, BREATH_R = 2.6, BREATH_LEAD = 0.15; // 追踪冰息
const TAIL_R = 5.4, TAIL_WIND = 0.9, CLAW_R = 6, CLAW_ARC = 1.9, CLAW_WIND = 0.7; // 落地:龙尾横扫 / 正面爪击
const gap = () => AIR_GAP[0] + rand() * (AIR_GAP[1] - AIR_GAP[0]);
const airGap = () => gap() * (dragonRT.hp <= dragonRT.maxHp / 2 ? 0.8 : 1); // 半血以后更急
// 俯冲航线:从龙此刻的位置直扑落点 (swX, swZ),冲过落点 6 米再拉起
function planSwoop() {
  const g = dragonRT.ent.group;
  const dx = dragonRT.swX - g.position.x, dz = dragonRT.swZ - g.position.z;
  const dd = Math.hypot(dx, dz) || 1;
  dragonRT.swVx = dx / dd;
  dragonRT.swVz = dz / dd;
  dragonRT.sw0x = g.position.x;
  dragonRT.sw0z = g.position.z;
  dragonRT.swLen = dd + SWOOP_OVER;
  dragonRT._swFor = swoopKey();
}
// 航线按"起点 + 落点"认:蓄势时龙只拔高、不挪平面位置,二者没变就还是这一趟
const swoopKey = () => {
  const g = dragonRT.ent.group;
  return `${dragonRT.swX},${dragonRT.swZ},${g.position.x},${g.position.z}`;
};
// 俯冲蓄势:盯住你脚下,航线定死(不追踪);地上画出整条贴地航线
export function beginSwoopWind(wind) {
  const g = dragonRT.ent.group;
  dragonRT.phase = 'swoopWind';
  dragonRT.t = wind;
  dragonRT._sw = false;
  dragonRT.swX = player.pos.x;
  dragonRT.swZ = player.pos.z;
  planSwoop();
  const yaw = Math.atan2(dragonRT.swVx, dragonRT.swVz);
  const from = Math.min(SWOOP_DIVE, dragonRT.swLen);
  const strip = { pos: { x: g.position.x + dragonRT.swVx * from, z: g.position.z + dragonRT.swVz * from }, yaw, dead: false };
  telegraphFlash(strip, wind + 0.3, true, dragonRT.swLen + SWOOP_HALF_W - from, 0,
    { shape: 'rect', width: SWOOP_HALF_W * 2, quiet: true });
  callout(dragonRT.swoopsLeft > 1 ? '俯冲!(还会掉头再冲)' : '俯冲!闪出长条', 'red');
  sfx.warn();
}
// 俯冲判定:你在贴地航线的长条里,而且龙正掠过你身边
function swoopHits() {
  const yaw = Math.atan2(dragonRT.swVx, dragonRT.swVz);
  if (!inCorridor(dragonRT.sw0x, dragonRT.sw0z, yaw, dragonRT.swLen + SWOOP_HALF_W, SWOOP_HALF_W, player.pos)) return false;
  const along = (player.pos.x - dragonRT.sw0x) * dragonRT.swVx + (player.pos.z - dragonRT.sw0z) * dragonRT.swVz;
  const flown = dragonRT.swLen - dragonRT.swLeft;
  return along >= SWOOP_DIVE && Math.abs(along - flown) < SWOOP_HALF_W;
}
// 追踪冰息:每 0.36 秒锁定一次你脚下(带一点提前量)亮圈,0.8 秒后炸开——站着不动必中,一直跑就躲得开
function breathBurst() {
  const vx = dragonRT._pvx || 0, vz = dragonRT._pvz || 0;
  const px2 = player.pos.x + vx * BREATH_LEAD, pz2 = player.pos.z + vz * BREATH_LEAD;
  telegraphArea(px2, pz2, BREATH_R, BREATH_WARN);
  later(BREATH_WARN, () => { // 龙的伤害不算你的罪,也不算你的连杀
    if (!dragonRT.on || dragonRT.phase === 'dead') return;
    explodeAt(px2, pz2, 2, BREATH_R, 'dragon');
    addFrostPatch(px2, pz2, BREATH_R, 4); // 息后留霜
    if (!player.dead && dist2(player.pos.x, player.pos.z, px2, pz2) < BREATH_R * BREATH_R) damagePlayer(2, null);
  });
}
export function updateDragon(dt) {
  if (!dragonRT.on) return;
  const g = dragonRT.ent.group;
  if (dt > 0) { // 记下龙的水平速度:对空弹道要打提前量
    dragonRT._vx = (g.position.x - (dragonRT._px ?? g.position.x)) / dt;
    dragonRT._vz = (g.position.z - (dragonRT._pz ?? g.position.z)) / dt;
  }
  dragonRT._px = g.position.x;
  dragonRT._pz = g.position.z;
  if (dt > 0) { // 你的移动速度:追踪冰息打提前量用
    dragonRT._pvx = (player.pos.x - (dragonRT._ppx ?? player.pos.x)) / dt;
    dragonRT._pvz = (player.pos.z - (dragonRT._ppz ?? player.pos.z)) / dt;
  }
  dragonRT._ppx = player.pos.x;
  dragonRT._ppz = player.pos.z;
  dragonRT.t -= dt;
  // 翼拍:飞行大摆,落地收拢
  const flap = dragonRT.phase === 'land' || dragonRT.phase === 'dead'
    ? 0.95 : Math.sin(frame.now * 0.006) * 0.55;
  const W = dragonRT.ent.parts.wings;
  if (W.length === 2) {
    W[0].rotation.z = -0.15 + flap;
    W[1].rotation.z = 0.15 - flap;
  }
  if (dragonRT.phase === 'rise') {
    g.position.y += dt * 4;
    if (g.position.y >= dragonRT.h) { dragonRT.phase = 'circle'; dragonRT.t = 3; }
  } else if (dragonRT.phase === 'circle') {
    dragonRT.ang += dt * 0.55;
    const cx = DRAGON_SKULL.x + Math.cos(dragonRT.ang) * 17;
    const cz = DRAGON_SKULL.z + Math.sin(dragonRT.ang) * 17;
    g.position.x += (cx - g.position.x) * Math.min(1, dt * 2);
    g.position.z += (cz - g.position.z) * Math.min(1, dt * 2);
    g.position.y += (dragonRT.h - g.position.y) * Math.min(1, dt * 2);
    g.rotation.y = Math.atan2(-Math.sin(dragonRT.ang), Math.cos(dragonRT.ang)); // 沿切线飞
    g.rotation.z = 0;
    if (dragonRT.t <= 0 && dist2(player.pos.x, player.pos.z, DRAGON_SKULL.x, DRAGON_SKULL.z) < 3600) {
      if (rand() < 0.55) {
        // 俯冲:先盯住你脚下(0.8 秒蓄势,整条贴地航线亮出长条),再沿直线扑过去——不追踪,横着闪出长条就扑空;
        // 半血以后必定掉头连冲两次,之前四成会连冲
        dragonRT.swoopsLeft = dragonRT.hp <= dragonRT.maxHp / 2 || rand() < 0.4 ? 2 : 1;
        beginSwoopWind(0.8);
      } else {
        dragonRT.phase = 'breath';
        dragonRT.t = BREATH_N * BREATH_GAP + BREATH_WARN + 0.3;
        dragonRT.breathN = 0;
        dragonRT.breathT = 0.25;
        callout('冰息!别停下,也别直线跑', 'red');
        sfx.warn();
      }
    }
  } else if (dragonRT.phase === 'swoopWind') {
    g.position.y += (dragonRT.h + 1.5 - g.position.y) * Math.min(1, dt * 3); // 拔高蓄势
    g.rotation.y = angleLerp(g.rotation.y, Math.atan2(dragonRT.swVx, dragonRT.swVz), dt * 6);
    if (dragonRT.t <= 0) {
      // 起点/落点被外部直接改过(调试/测试直接设位置和 swX/swZ 进蓄势):按龙此刻的位置重定航线,别沿用上一趟的
      if (dragonRT._swFor !== swoopKey()) planSwoop();
      dragonRT.phase = 'swoop';
      dragonRT.t = 3;
      dragonRT.swLeft = dragonRT.swLen;
      dragonRT.swY0 = g.position.y;
    }
  } else if (dragonRT.phase === 'swoop') {
    const step = Math.min(SWOOP_SPEED * dt, dragonRT.swLeft);
    g.position.x += dragonRT.swVx * step;
    g.position.z += dragonRT.swVz * step;
    dragonRT.swLeft -= step;
    // 头 5 米从高处扎下来,之后贴地 1.4 米掠过(判伤只在贴地段,和地上的长条一致)
    const flown = dragonRT.swLen - dragonRT.swLeft;
    g.position.y = dragonRT.swY0 + (1.4 - dragonRT.swY0) * Math.min(1, flown / SWOOP_DIVE);
    g.rotation.y = Math.atan2(dragonRT.swVx, dragonRT.swVz);
    if (!dragonRT._sw && swoopHits()) {
      dragonRT._sw = true;
      damagePlayer(2, null, true); // 俯冲是破防的:盾挡不住,得滚(无敌帧里滚过去也算躲开)
      cam.shake = Math.max(cam.shake, 0.4);
    }
    if (dragonRT.t <= 0 || dragonRT.swLeft <= 0) {
      if (dragonRT.swoopsLeft > 1) { dragonRT.swoopsLeft--; beginSwoopWind(0.6); } // 连冲:掉头再扑一次
      else { dragonRT.phase = 'circle'; dragonRT.t = airGap(); }
    }
  } else if (dragonRT.phase === 'breath') {
    g.position.y += (dragonRT.h - g.position.y) * Math.min(1, dt * 2);
    g.rotation.y = Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z);
    // 追踪冰息:三团冰爆依次锁定你脚下亮圈,0.8 秒后炸开——得一直跑,或者卡着时机滚
    dragonRT.breathT -= dt;
    if (dragonRT.breathN < BREATH_N && dragonRT.breathT <= 0) {
      dragonRT.breathN++;
      dragonRT.breathT = BREATH_GAP;
      breathBurst();
    }
    if (dragonRT.t <= 0) { dragonRT.phase = 'circle'; dragonRT.t = airGap(); }
  } else if (dragonRT.phase === 'land') {
    g.position.y += (0 - g.position.y) * Math.min(1, dt * 3);
    // 落地也不是任人宰割:龙尾横扫(紫环 5.4 米,破防:翻滚或退出圈外)与正面爪击(红扇形 6 米 ±55°,可格挡、侧闪)轮番来,
    // 爪击起手时朝向锁死
    if (dragonRT.landAtk !== 'claw') {
      g.rotation.y = angleLerp(g.rotation.y, Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z), dt * 3);
    }
    dragonRT.atkT = (dragonRT.atkT ?? 1.2) - dt;
    if (!dragonRT.landAtk && dragonRT.atkT <= 0) {
      dragonRT.landAtk = dragonRT.nextClaw ? 'claw' : 'tail';
      dragonRT.nextClaw = !dragonRT.nextClaw;
      if (dragonRT.landAtk === 'claw') {
        dragonRT.windT = CLAW_WIND;
        dragonRT.claw = { pos: { x: g.position.x, z: g.position.z }, yaw: g.rotation.y, dead: false };
        telegraphFlash(dragonRT.claw, CLAW_WIND, false, CLAW_R, CLAW_ARC, { quiet: true });
        sfx.warn();
      } else {
        dragonRT.windT = TAIL_WIND;
        telegraphArea(g.position.x, g.position.z, TAIL_R, TAIL_WIND, true);
      }
    }
    if (dragonRT.landAtk) {
      dragonRT.windT -= dt;
      if (dragonRT.landAtk === 'tail') g.rotation.z = Math.sin(dragonRT.windT * 9) * 0.08; // 蓄力:身子一拧
      else g.rotation.x = -0.12 * Math.min(1, (CLAW_WIND - dragonRT.windT) * 3); // 抬起前爪
      if (dragonRT.windT <= 0) {
        g.rotation.z = 0;
        g.rotation.x = 0;
        cam.shake = Math.max(cam.shake, 0.35);
        sfx.stomp();
        if (dragonRT.landAtk === 'tail') {
          spawnDust(g.position.x, 0.3, g.position.z, 18, 5, 2);
          if (Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < TAIL_R) {
            damagePlayer(2, null, true);
            callout('被龙尾扫中!', 'red');
          }
        } else {
          const c = dragonRT.claw;
          spawnDust(c.pos.x + Math.sin(c.yaw) * 3, 0.3, c.pos.z + Math.cos(c.yaw) * 3, 12, 2.5, 1.8);
          if (inFrontArc(c, player.pos, CLAW_R, CLAW_ARC)) {
            damagePlayer(2, c); // 爪击能用盾挡(弹不开)
            callout('被龙爪拍中!', 'red');
          }
        }
        dragonRT.landAtk = null;
        dragonRT.atkT = 1.5;
      }
    }
    if (dragonRT.t <= 0) {
      dragonRT.landAtk = null;
      g.rotation.z = 0;
      g.rotation.x = 0;
      dragonRT.phase = 'rise';
      callout('霜龙振翅升空', 'dim');
    }
  } else if (dragonRT.phase === 'dead') {
    g.position.y += (0 - g.position.y) * Math.min(1, dt * 2.5);
    g.rotation.z = Math.min(0.6, g.rotation.z + dt);
    if (dragonRT.t <= 0) {
      dragonRT.on = false;
      scene.remove(g);
      stats.dragonSlain = true;
      recomputeMaxHp();
      player.hp = player.maxHp;
      player.coins += 150;
      unlockAch('dragonslayer');
      sfx.fanfare();
      openDialog([
        '(霜龙的残魂散作漫天冰晶,像一场向上落的雪。)',
        '🐉 屠龙者!龙魂涌入你的血脉:生命上限 +2、战吼冷却减半、+150 金币!',
      ]);
      remember('斩落了龙骨之地的霜龙残魂', 'dragonslain');
      saveGame();
    }
  }
}

