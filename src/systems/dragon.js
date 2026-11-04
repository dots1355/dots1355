// 霜龙(龙骨之地终局 Boss):学会战吼后夜里再触龙颅,骨翼重聚血肉。
// 空中盘旋 → 俯冲(地面预警、破防)/ 三段冰息(逐段预警);掉血到阈值落地喘息,每次落地最多挨 6 点。
// 状态全在 dragonRT;对空瞄准 dragonAim 在魔法模块里读它。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { hitStop, slowMo } from '../core/timefx.js';
import { later } from '../core/timers.js';
import { angleLerp, dist2, makeDragon } from '../entities.js';
import { scene } from '../gfx/core.js';
import { pooledMat } from '../gfx/pools.js';
import { cam } from './camera.js';
import { DRAGON_SKULL, addFrostPatch, explodeAt } from './magic.js';
import { spawnDust } from './weather.js';
import {
  callout, damagePlayer, dangerFX, dangerMat, openDialog, player, recomputeMaxHp, remember, saveGame,
  showDamage, stats, toast, unlockAch,
} from '../main.js';

// ================= 霜龙苏醒(龙骨之地终局 Boss)=================
// 学会战吼后,夜里再触龙颅——骨翼重聚血肉。空中盘旋/俯冲/三段吐息;掉血落地喘息时才能近战。
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
  } else if (dragonRT.phase !== 'dead') nDmg = Math.max(1, Math.round(nDmg * 0.6)); // 空中:鳞甲迎风,打七折还多
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
    while (dragonRT.landAt.length && dragonRT.hp <= dragonRT.landAt[0]) dragonRT.landAt.shift();
    dragonRT.phase = 'land';
    dragonRT.t = 7;
    dragonRT.landDmg = 0;
    dragonRT.sweepT = 1.4;
    callout('霜龙坠地喘息——上刀!', 'gold');
    sfx.stomp();
    cam.shake = Math.max(cam.shake, 0.4);
  }
}
// 地面范围预警:一圈不收缩的红环(龙尾横扫等大范围招式)
export function telegraphArea(x, z, r, dur) {
  sfx.warn();
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.2, r - 0.6), r, 48, 1), pooledMat(dangerMat));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.12, z);
  scene.add(ring);
  dangerFX.push({ ring, e: { pos: { x, z }, dead: false }, t: 0, dur, fixed: true });
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
  dragonRT.t -= dt;
  // 翼拍:飞行大摆,落地收拢
  const flap = dragonRT.phase === 'land' || dragonRT.phase === 'dead'
    ? 0.95 : Math.sin(performance.now() * 0.006) * 0.55;
  const W = dragonRT.ent.parts.wings;
  if (W.length === 2) {
    W[0].rotation.z = -0.15 + flap;
    W[1].rotation.z = 0.15 - flap;
  }
  if (dragonRT.phase === 'rise') {
    g.position.y += dt * 4;
    if (g.position.y >= dragonRT.h) { dragonRT.phase = 'circle'; dragonRT.t = 6; }
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
        // 俯冲:先盯住你脚下(0.8 秒地面红环预警),再沿直线扑过去——不追踪,滚开或侧跑就扑空
        dragonRT.phase = 'swoopWind';
        dragonRT.t = 0.8;
        dragonRT._sw = false;
        dragonRT.swX = player.pos.x;
        dragonRT.swZ = player.pos.z;
        telegraphArea(player.pos.x, player.pos.z, 3.2, 0.8 + 0.5);
        callout('俯冲!滚开!', 'red');
        sfx.warn();
      } else {
        dragonRT.phase = 'breath';
        dragonRT.t = 2.2;
        dragonRT._breathed = false;
        callout('冰息!看地上的圈', 'red');
        sfx.warn();
      }
    }
  } else if (dragonRT.phase === 'swoopWind') {
    g.position.y += (dragonRT.h + 1.5 - g.position.y) * Math.min(1, dt * 3); // 拔高蓄势
    g.rotation.y = angleLerp(g.rotation.y, Math.atan2(dragonRT.swX - g.position.x, dragonRT.swZ - g.position.z), dt * 6);
    if (dragonRT.t <= 0) {
      dragonRT.phase = 'swoop';
      dragonRT.t = 2.5;
      const dx = dragonRT.swX - g.position.x, dz = dragonRT.swZ - g.position.z;
      const dd = Math.hypot(dx, dz) || 1;
      dragonRT.swVx = dx / dd;
      dragonRT.swVz = dz / dd;
      dragonRT.swLeft = dd + 6; // 冲过落点再拉起
    }
  } else if (dragonRT.phase === 'swoop') {
    const step = 24 * dt;
    g.position.x += dragonRT.swVx * step;
    g.position.z += dragonRT.swVz * step;
    dragonRT.swLeft -= step;
    g.position.y += (1.4 - g.position.y) * Math.min(1, dt * 4);
    g.rotation.y = Math.atan2(dragonRT.swVx, dragonRT.swVz);
    if (!dragonRT._sw && Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < 2.6 && !(player.rollT > 0)) {
      dragonRT._sw = true;
      damagePlayer(2, null, true); // 俯冲是破防的:盾挡不住,得滚
      cam.shake = Math.max(cam.shake, 0.4);
    }
    if (dragonRT.t <= 0 || dragonRT.swLeft <= 0) { dragonRT.phase = 'circle'; dragonRT.t = 5 + rand() * 3; }
  } else if (dragonRT.phase === 'breath') {
    g.position.y += (dragonRT.h - g.position.y) * Math.min(1, dt * 2);
    g.rotation.y = Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z);
    if (!dragonRT._breathed && dragonRT.t <= 2.0) {
      // 三段冰息:沿龙→你的连线依次炸开,每一段落下前 0.8 秒地上先亮圈
      dragonRT._breathed = true;
      const bx = g.position.x, bz = g.position.z;
      const dx = player.pos.x - bx, dz = player.pos.z - bz;
      const dd = Math.hypot(dx, dz) || 1;
      for (let i = 1; i <= 3; i++) {
        const px2 = bx + (dx / dd) * dd * (i / 3), pz2 = bz + (dz / dd) * dd * (i / 3);
        const at = 0.8 + (i - 1) * 0.28;
        telegraphArea(px2, pz2, 2.6, at);
        later(at, () => { // 龙的伤害不算你的罪,也不算你的连杀
          explodeAt(px2, pz2, 2, 2.6, 'dragon');
          addFrostPatch(px2, pz2, 2.6, 4); // 息后留霜
          if (!player.dead && dist2(player.pos.x, player.pos.z, px2, pz2) < 2.6 * 2.6 && !(player.rollT > 0)) damagePlayer(2, null);
        });
      }
    }
    if (dragonRT.t <= 0) { dragonRT.phase = 'circle'; dragonRT.t = 5 + rand() * 3; }
  } else if (dragonRT.phase === 'land') {
    g.position.y += (0 - g.position.y) * Math.min(1, dt * 3);
    g.rotation.y = angleLerp(g.rotation.y, Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z), dt * 3);
    // 落地也不是任人宰割:每 2.4 秒一记龙尾横扫(0.9 秒红圈预警,翻滚或退出圈外)
    dragonRT.sweepT = (dragonRT.sweepT ?? 1.2) - dt;
    if (!(dragonRT.sweepWind > 0) && dragonRT.sweepT <= 0) {
      dragonRT.sweepWind = 0.9;
      telegraphArea(g.position.x, g.position.z, 5.4, 0.9);
    }
    if (dragonRT.sweepWind > 0) {
      dragonRT.sweepWind -= dt;
      g.rotation.z = Math.sin(dragonRT.sweepWind * 9) * 0.08; // 蓄力:身子一拧
      if (dragonRT.sweepWind <= 0) {
        g.rotation.z = 0;
        dragonRT.sweepT = 2.4;
        cam.shake = Math.max(cam.shake, 0.35);
        sfx.stomp();
        spawnDust(g.position.x, 0.3, g.position.z, 18, 5, 2);
        if (Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < 5.4 && !(player.rollT > 0)) {
          damagePlayer(2, null, true);
          callout('被龙尾扫中!', 'red');
        }
      }
    }
    if (dragonRT.t <= 0) {
      dragonRT.sweepWind = 0;
      g.rotation.z = 0;
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

