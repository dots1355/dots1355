// 箭矢与投射物:箭、魔光弹、火球、飞刀共用一张表 arrows,逐帧子步进飞行与命中(受击目标注册表 combat.TARGET_KINDS + 飞龙)。
// 对外:arrows、shootArrow()(弓)、wetSpread()(雨天湿弦的散布)、updateArrows(dt);arrowGeo/arrowMat 供飞刀等复用。
// 命中一律走 applyDamage(伤害来源决定罪责与连杀);法术弹/飞刀是独占资源,下场时释放。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { colliders, player } from '../core/state.js';
import { simNow } from '../core/timers.js';
import { dist2, lambert } from '../entities.js';
import { scene } from '../gfx/core.js';
import { toast } from '../ui/toast.js';
import { TARGET_KINDS, magBurst } from './combat.js';
import { damageDragon, dragonRT } from './dragon.js';
import { WEAPONS } from './gear.js';
import { arrowBonus, dragonAim, explodeAt, skillLv, skillXp } from './magic.js';
import { prologue } from './prologue.js';
import { weather } from './weather.js';

// ================= 箭矢与投射物 =================
export const arrows = [];
export const arrowGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.55, 4);
arrowGeo.rotateX(Math.PI / 2);
export const arrowMat = lambert(0x8a6a45, { roughness: 0.8 });
function pointBlocked(x, z) {
  for (const b of colliders.boxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  for (const cc of colliders.circles) {
    const dx = x - cc.x, dz = z - cc.z;
    if (dx * dx + dz * dz < cc.r * cc.r) return true;
  }
  return false;
}
// 雨天湿弦:箭路发飘(暴雨更甚);提示节流,别刷屏
let wetToastT = -1e9;
export function wetSpread(mul = 1) {
  const wet = weather.state === 'storm' ? 0.11 : weather.state === 'rain' ? 0.055 : 0;
  if (!wet) return 0;
  if (simNow() - wetToastT > 12000) {
    wetToastT = simNow();
    toast('🌧️ 雨水打湿了弓弦,箭路发飘……', 2);
  }
  return (rand() - 0.5) * 2 * wet * mul;
}
export function shootArrow() {
  // 弓术 5 级专属:一弓双箭(小角度散射)
  const shots = skillLv('archery') >= 5 ? [0, 0.09] : [0];
  for (const off of shots) {
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    const jit = off + wetSpread();
    const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.06, Math.cos(player.yaw + jit)).normalize();
    const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
    mesh.position.copy(pos);
    scene.add(mesh);
    arrows.push({ mesh, pos, vel: (off === 0 && dragonAim(pos, 30)) || dir.multiplyScalar(26), ttl: 3, stuck: false });
  }
  sfx.arrow();
}
// 箭/法弹/飞刀命中:按受击目标注册表的顺序找第一个挨上的(身位 0.8m²、高度 0~2.3m;鸡更小更矮),结算交给该类目标
function arrowHitEntities(a) {
  const dmg = a.dmg || arrowBonus(WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0));
  for (const T of TARGET_KINDS) {
    const [ylo, yhi] = T.arrowY || [0, 2.3];
    if (a.pos.y < ylo || a.pos.y > yhi) continue;
    const r2 = T.arrowR2 || 0.8;
    for (const e of T.list()) {
      if (!T.alive(e) || (a._hits && a._hits.includes(e))) continue; // 贯穿箭:一箭对同一目标只算一次
      if (dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) >= r2) continue;
      if (a._hits) a._hits.push(e);
      T.arrow(e, a, dmg);
      return true;
    }
  }
  return false;
}
// 火球的近炸引信:贴近任何可受击的目标就炸
const nearTarget = (a) => TARGET_KINDS.some((T) => T.list().some((e) => T.alive(e) &&
  dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 1.6));
// 投射物下场:法术弹/飞刀是每发独立 geometry+material,必须 dispose,否则连发就是显存漏斗
function disposeArrow(a) {
  scene.remove(a.mesh);
  if (a.mag || a.fire || a.big || a.knife) {
    a.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
export function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.ttl -= dt;
    if (a.ttl <= 0) { disposeArrow(a); arrows.splice(i, 1); continue; }
    if (a.stuck) continue;
    if (!a.fire && !a.mag && !a.vel.aimed) a.vel.y -= 7 * dt; // 火球/魔光弹/对空箭直线飞行,不吃重力
    // 子步进:快箭(满月 42/秒)在低帧率下一帧能跨 2 个身位,不切细会从判定圈中间穿过去
    const stepN = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.6));
    let removed = false;
    for (let s = 0; s < stepN && !removed; s++) {
      a.pos.addScaledVector(a.vel, dt / stepN);
      if (a.fire) {
        // 火球:贴近任何敌人 / 落地 / 撞墙 / 燃尽 → 爆炸
        if (dragonRT.on && dragonRT.hp > 0) { // 火球打龙:三维近身即炸
          const gp = dragonRT.ent.group.position;
          if (Math.abs(a.pos.y - gp.y - 1.6) < 3 && dist2(a.pos.x, a.pos.z, gp.x, gp.z) < 3.2 * 3.2) {
            magBurst(a.pos.x, a.pos.y, a.pos.z);
            damageDragon(a.big ? 5 : 3, a);
            skillXp('destruction', 2);
            disposeArrow(a);
            arrows.splice(i, 1);
            removed = true;
            continue;
          }
        }
        if (nearTarget(a) || a.pos.y <= 0.1 || pointBlocked(a.pos.x, a.pos.z) || a.ttl <= 0.05) {
          const wetMul = weather.state === 'storm' ? 0.75 : weather.state === 'rain' ? 0.85 : 1;
          explodeAt(a.pos.x, a.pos.z, a.big ? 4 : 2, (a.big ? 5.2 : 3.4) * wetMul); // 雨天火势打折;小火球不再一发清场
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
        }
        continue;
      }
      if (dragonRT.on && dragonRT.hp > 0) { // 飞龙判定:三维距离,不受地面身位限制
        const gp = dragonRT.ent.group.position;
        if (Math.abs(a.pos.y - gp.y - 1.6) < 2.4 && dist2(a.pos.x, a.pos.z, gp.x, gp.z) < 2.6 * 2.6) {
          if (a.fire) explodeAt(a.pos.x, a.pos.z, 0, 1);
          damageDragon(a.fire ? (a.big ? 5 : 3) :
            (a.dmg || arrowBonus(WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0))), a);
          skillXp(a.mag || a.fire ? 'destruction' : 'archery', 2);
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
          continue;
        }
      }
      if (arrowHitEntities(a)) {
        if (a.mag && prologue.on) prologue.flags.sparkHit = true; // 序章:魔光弹要真打中才算学会
        skillXp(a.mag ? 'destruction' : 'archery', 2);
        if (a.mag) magBurst(a.pos.x, Math.max(0.4, a.pos.y), a.pos.z); // 命中碎光
        if (a.pierce > 0) { a.pierce--; continue; } // 满月箭:穿过去接着飞
        disposeArrow(a);
        arrows.splice(i, 1);
        removed = true;
        continue;
      }
      if (a.pos.y <= 0.05 || pointBlocked(a.pos.x, a.pos.z)) {
        if (a.mag) { // 光弹不钉墙:撞上就炸成碎光消散
          magBurst(a.pos.x, Math.max(0.15, a.pos.y), a.pos.z);
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
          break;
        }
        a.stuck = true;
        a.ttl = Math.min(a.ttl, 2);
        a.pos.y = Math.max(0.05, a.pos.y);
        break;
      }
    }
    if (removed) continue;
    a.mesh.position.copy(a.pos);
    a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
  }
}
