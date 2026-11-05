// 动物与采集:鸡(扔鸡、惹毛鸡群的报复)、绵羊(能骑,复用坐骑系统)、鹿(受惊逃窜、猎鹿)、蘑菇(采给女巫)、
// 隘口白狼「霜牙」(三块鹿肉驯服,随行替你咬敌人)。
// 对外:chickens/deers/mushrooms/frostfang 名单与状态;addChicken/addSheep/pokeChicken/startChickenRiot/killDeer/
// respawnMushrooms/tameFrostfang;initFauna() 启动装配调用一次;主循环调 updateChickens/updateDeers/updateFrostfang。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import { player } from '../core/state.js';
import { later } from '../core/timers.js';
import { dist2, lambert, makeChicken, makeHorse, makeSheep, makeWolf } from '../entities.js';
import { scene } from '../gfx/core.js';
import { startFall } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import {
  addBandit, bandits, entFar, guards, horses, moveEntity, retireEntity, villagers, wolves,
} from './actors.js';
import { applyDamage } from './combat.js';
import { crime } from './law.js';
import { remember } from './mind.js';
import { spawnDust } from './weather.js';
import { damagePlayer } from '../main.js';

// ================= 鸡(惹不起的存在) =================
export const chickens = [];
export let chickenAnger = 0, chickenAngerT = 0, revengeT = 0;
export function addChicken(x, z) {
  const c = { ...makeChicken(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), state: 'idle', timer: rand() * 3,
    vel: new THREE.Vector3(), walkT: 0, peckCd: 0, extra: false };
  c.group.position.copy(c.pos);
  scene.add(c.group);
  chickens.push(c);
  return c;
}

// 导演事件「鸡群暴动」:直接拉满愤怒、开始 t 秒的报复
export function startChickenRiot(t) {
  chickenAnger = 3;
  revengeT = t;
}
export function pokeChicken(c) {
  sfx.cluck();
  c.state = 'flee';
  c.timer = 2.5;
  chickenAnger++;
  chickenAngerT = 30;
  spawnDust(c.pos.x, 0.3, c.pos.z, 3, 0.4, 1.2);
  if (chickenAnger === 2) toast('🐔 那只鸡狠狠地瞪了你一眼。', 2);
  if (chickenAnger >= 3 && revengeT <= 0) {
    revengeT = 22;
    toast('🐔🐔🐔 你惹怒了鸡群!!快跑!!', 3.5);
    sfx.wanted();
    for (let i = 0; i < 5; i++) {
      const a = rand() * 6.28;
      const rc = addChicken(player.pos.x + Math.cos(a) * 12, player.pos.z + Math.sin(a) * 12);
      rc.extra = true;
    }
  }
}

export function updateChickens(dt) {
  if (chickenAngerT > 0) { chickenAngerT -= dt; if (chickenAngerT <= 0) chickenAnger = 0; }
  if (revengeT > 0) {
    revengeT -= dt;
    if (revengeT <= 0) {
      chickenAnger = 0;
      toast('鸡群消气了……这次就算了。', 2.5);
      for (let i = chickens.length - 1; i >= 0; i--) {
        // eventKeep 的鸡(金鸡/越狱鸡)由各自事件的 end() 负责回收,这里不动
        if (chickens[i].extra && !chickens[i].eventKeep && chickens[i] !== player.carrying) retireEntity(chickens[i], chickens);
        else chickens[i].state = chickens[i] === player.carrying ? 'carried' : 'idle';
      }
    }
  }
  for (const c of chickens) {
    if (c === player.carrying) continue;
    if (c.state !== 'thrown' && revengeT <= 0 && entFar(c)) continue; // 远处的鸡不啄米
    let moving = false;
    if (c.state === 'thrown') {
      c.vel.y -= 14 * dt;
      if (c.vel.y < -3) c.vel.y = -3; // 扑腾缓降
      c.pos.addScaledVector(c.vel, dt);
      c.walkT += dt * 30;
      if (c.pos.y <= 0) {
        c.pos.y = 0;
        c.state = 'flee';
        c.timer = 3;
        sfx.cluck();
        // 鸡弹砸中卫兵:袭警!
        for (const g of guards) {
          if (g.downT <= 0 && dist2(c.pos.x, c.pos.z, g.pos.x, g.pos.z) < 2.2) {
            g.stunT = Math.max(g.stunT, 2.5); g.stunSrc = 'other';
            crime(1, '🐔 你用一只鸡袭击了卫兵!');
            break;
          }
        }
        // 砸中村民:吓个半死(不算犯罪,算没品)
        for (const v of villagers) {
          if (!v.sleeping && v.downT <= 0 && dist2(c.pos.x, c.pos.z, v.pos.x, v.pos.z) < 2.2) {
            v.fleeT = 3.5;
            toast('🐔 精准鸡击!村民魂飞魄散。', 2);
            break;
          }
        }
      }
    } else if (revengeT > 0 && !player.dead) {
      c.peckCd = Math.max(0, c.peckCd - dt);
      const pd = Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z);
      if (pd > 0.7) { moveEntity(c, player.pos.x, player.pos.z, 6.8, dt); moving = true; }
      else if (c.peckCd <= 0) {
        c.peckCd = 1.1;
        damagePlayer(1);
        sfx.cluck();
        if (++stats.pecks >= 5) unlockAch('pecked');
      }
    } else if (c.state === 'flee') {
      c.timer -= dt;
      if (c.timer <= 0) c.state = 'idle';
      const fx = c.pos.x - player.pos.x, fz = c.pos.z - player.pos.z;
      const d = Math.hypot(fx, fz) || 1;
      moveEntity(c, c.pos.x + (fx / d) * 4, c.pos.z + (fz / d) * 4, 5.5, dt);
      moving = true;
    } else {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.timer = 1.5 + rand() * 3;
        const a = rand() * 6.28;
        c.target = [c.home.x + Math.cos(a) * 4, c.home.z + Math.sin(a) * 4];
      }
      if (c.target && !moveEntity(c, c.target[0], c.target[1], 1.6, dt)) moving = true;
    }
    c.group.position.copy(c.pos);
    c.group.rotation.y = c.yaw;
    c.parts.head.position.z = 0.16 + (moving ? Math.sin(c.walkT * 2) * 0.05 : 0);
    c.parts.body.position.y = 0.26 + (moving ? Math.abs(Math.sin(c.walkT)) * 0.03 : 0);
  }
}

// ================= 绵羊(可以骑,为什么不呢) =================
export function addSheep(x, z) {
  const s = { ...makeSheep(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned: false, stolen: false, sheep: true,
    state: 'idle', timer: rand() * 4, walkT: 0, baaT: 0 };
  s.group.position.copy(s.pos);
  scene.add(s.group);
  horses.push(s); // 复用坐骑系统
  return s;
}



// ================= 猎鹿(卖鹿肉给罗莎) =================
export const deers = [];
function addDeer(x, z) {
  const d = { ...makeHorse(0x9a7148, false, { antlers: rand() < 0.55 }), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), deer: true, state: 'graze', timer: rand() * 4,
    walkT: 0, dead: false, respawnT: 0, fleeT: 0, downT: 0, hp: 1 };
  d.group.scale.setScalar(0.62);
  d.group.position.copy(d.pos);
  scene.add(d.group);
  deers.push(d);
  return d;
}

export function updateDeers(dt) {
  for (const d of deers) {
    if (d.dead) {
      d.respawnT -= dt;
      if (d.respawnT <= 0) {
        d.dead = false;
        d.hp = 1;
        d.pos.copy(d.home);
        d.group.rotation.x = 0; // startFall 倒的是 x 轴,复活要扶正
        d.group.rotation.z = 0;
        d.group.visible = true;
      }
      continue;
    }
    if (entFar(d)) continue;
    const pd2 = dist2(player.pos.x, player.pos.z, d.pos.x, d.pos.z);
    let moving = false;
    if (pd2 < 130 && !player.dead) {
      // 受惊逃窜:朝远离玩家的方向跑
      d.fleeT = 1.2;
    }
    if (d.fleeT > 0) {
      d.fleeT -= dt;
      const fx = d.pos.x - player.pos.x, fz = d.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(d, d.pos.x + (fx / fd) * 10, d.pos.z + (fz / fd) * 10, 8.6, dt);
      moving = true;
    } else {
      d.timer -= dt;
      if (d.timer <= 0) {
        d.timer = 2 + rand() * 4;
        d.tx = d.home.x + (rand() - 0.5) * 22;
        d.tz = d.home.z + (rand() - 0.5) * 22;
      }
      if (d.tx !== undefined && !moveEntity(d, d.tx, d.tz, 1.8, dt)) moving = true;
    }
    d.group.position.copy(d.pos);
    d.group.rotation.y = d.yaw;
    const sw = moving ? Math.sin(d.walkT) * 0.55 : 0;
    d.parts.legs[0].rotation.x = sw;
    d.parts.legs[1].rotation.x = -sw;
    d.parts.legs[2].rotation.x = -sw;
    d.parts.legs[3].rotation.x = sw;
  }
}
export function killDeer(d) {
  d.dead = true;
  d.respawnT = 300;
  startFall(d);
  later(2.5, () => { if (d.dead) d.group.visible = false; });
  player.venison++;
  stats.deer = (stats.deer || 0) + 1;
  if (stats.deer >= 5) unlockAch('hunter');
  toast(`🦌 猎到一头鹿!鹿肉 ×${player.venison}(卖给旅店老板娘,5 金币一块)`, 3);
}

// ================= 采蘑菇(卖给女巫玛尔戈) =================
export const mushrooms = [];
const MUSH_SPOTS = [
  [-128, -44], [-142, -58], [-160, -36], [-176, -70], [-150, -102], [-118, -88],
  [-196, -18], [-124, -18], [-282, 210], [-266, 244], [58, 132], [84, 118], [-52, 148], [-204, 84],
];
export function respawnMushrooms() {
  for (const m of mushrooms) { m.picked = false; m.group.visible = true; }
}

// ================= 狼伙伴「霜牙」(霜风隘口的白狼,鹿肉驯服) =================
export const frostfang = { ent: null, wary: null, tamed: false, feed: 0, atkCd: 0 };
function spawnWhiteWolf(x, z) {
  const w = { ...makeWolf(0xdfe6ee, 0x7ac0e8, 0x2a5a88), pos: new THREE.Vector3(x, 0, z),
    yaw: rand() * 6.28, walkT: 0, timer: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  return w;
}
export function updateFrostfang(dt) {
  // 未驯服:白狼在隘口游荡,保持距离打量你
  if (!frostfang.tamed && frostfang.wary) {
    const w = frostfang.wary;
    if (entFar(w)) return;
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    if (pd < 4.5) {
      const fx = w.pos.x - player.pos.x, fz = w.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(w, w.pos.x + (fx / fd) * 6, w.pos.z + (fz / fd) * 6, 4.5, dt);
      moving = true;
    } else if (pd > 26) {
      // 不追人,溜达回家
      if (!moveEntity(w, -286, -128, 2.2, dt)) moving = true;
    }
    w.group.position.copy(w.pos);
    w.group.rotation.y = pd < 20 ? Math.atan2(player.pos.x - w.pos.x, player.pos.z - w.pos.z) : w.yaw;
    const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
    w.parts.legs[0].rotation.x = sw;
    w.parts.legs[1].rotation.x = -sw;
    w.parts.legs[2].rotation.x = -sw;
    w.parts.legs[3].rotation.x = sw;
    return;
  }
  // 已驯服:跟随 + 替你咬盗贼和恶狼
  const w = frostfang.ent;
  if (!w) return;
  frostfang.atkCd = Math.max(0, frostfang.atkCd - dt);
  const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
  if (pd > 60) { w.pos.set(player.pos.x + 2, 0, player.pos.z + 2); } // 跟丢了瞬移归队
  // 找玩家身边最近的敌人
  let target = null, td = 14 * 14;
  for (const b of bandits) {
    if (b.dead || b.downT > 0 || b.robber) continue;
    const d = dist2(player.pos.x, player.pos.z, b.pos.x, b.pos.z);
    if (d < td) { td = d; target = b; }
  }
  for (const e of wolves) {
    if (e.dead || e.arena) continue;
    const d = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
    if (d < td) { td = d; target = e; }
  }
  let moving = false;
  if (target) {
    const dd = Math.hypot(target.pos.x - w.pos.x, target.pos.z - w.pos.z);
    if (dd > 1.6) {
      moveEntity(w, target.pos.x, target.pos.z, 8.6, dt);
      moving = true;
    } else if (frostfang.atkCd <= 0) {
      frostfang.atkCd = 0.9;
      sfx.hit();
      applyDamage(target, 1, { source: 'companion', knock: 0.4, credit: '霜牙助攻', coins: 3 });
    }
  } else if (pd > 3.5) {
    moveEntity(w, player.pos.x + 1.5, player.pos.z + 1.5, pd > 12 ? 9 : 5.5, dt);
    moving = true;
  }
  w.group.position.copy(w.pos);
  if (moving || target) w.group.rotation.y = w.yaw;
  const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
  w.parts.legs[0].rotation.x = sw;
  w.parts.legs[1].rotation.x = -sw;
  w.parts.legs[2].rotation.x = -sw;
  w.parts.legs[3].rotation.x = sw;
}
export function tameFrostfang() {
  frostfang.tamed = true;
  frostfang.ent = frostfang.wary;
  frostfang.wary = null;
  unlockAch('packmate');
  remember('用三块鹿肉驯服了霜风隘口的白狼「霜牙」', 'frostfang');
  toast('🐺 白狼低头蹭了蹭你的手——「霜牙」愿意与你同行!', 5);
  saveGame();
}

// 开局的动物与采集点:鸡群、羊群、灰烬荒地的常驻匪帮、鹿群、蘑菇、隘口白狼(启动装配原位调用)
export function initFauna() {
  [[18, 84], [22, 88], [26, 84], [10, 22], [-14, 20], [44, 14], [14, 78], [-16, 90]]
    .forEach(([x, z]) => addChicken(x, z));
  [[-38, 63], [-42, 67], [-36, 68], [-44, 62], [-40, 71], [-34, 64]].forEach(([x, z]) => addSheep(x, z));
  // 灰烬荒地的常驻匪帮(死后一分钟重生)
  for (const [ax, az] of [[-368, -30], [-390, -52], [-372, -60]]) {
    const b = addBandit(ax, az, { hp: 3 });
    b.ambient = true;
  }
  [[-150, -30], [-120, -70], [-172, -94], [-60, -122], [96, -92], [-214, 62], [64, 124], [-70, 134]]
    .forEach(([x, z]) => addDeer(x, z));
  {
    const stemG = new THREE.CylinderGeometry(0.09, 0.12, 0.34, 5);
    const capG = new THREE.SphereGeometry(0.26, 7, 5);
    for (const [mx, mz] of MUSH_SPOTS) {
      const grp = new THREE.Group();
      const stem = new THREE.Mesh(stemG, lambert(0xe8e0d0));
      stem.position.y = 0.17;
      grp.add(stem);
      const cap = new THREE.Mesh(capG, lambert(rand() < 0.5 ? 0xc03028 : 0xb98a3a, { roughness: 0.7 }));
      cap.scale.y = 0.62;
      cap.position.y = 0.4;
      cap.castShadow = true;
      grp.add(cap);
      grp.position.set(mx, 0, mz);
      scene.add(grp);
      mushrooms.push({ group: grp, x: mx, z: mz, picked: false });
    }
  }
  frostfang.wary = spawnWhiteWolf(-286, -128);
}
