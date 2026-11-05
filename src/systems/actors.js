// 实体名单与生命周期:马/卫兵/村民/盗贼/狼的名单与生成(addHorse/addGuard/addBandit/addWolf)、
// 开局常住人口与荒野生成钩子(initActors,启动装配调用一次)、退场(retireEntity/retireProp,释放独占资源)、
// 远距休眠判定 entFar、通用移动 moveEntity/moveEntityHorse 与人形/马的动作 animateLimbs/meleeSwing/animHorseLegs。
// 行为(AI 每帧怎么动)在 systems/ai.js;这里只管有谁、怎么来、怎么走、怎么退场。
import * as THREE from 'three';
import { frame } from '../core/frame.js';
import { rand } from '../core/rng.js';
import { colliders, player, world } from '../core/state.js';
import {
  angleLerp, disposeEntityGroup, dist2, makeHorse, makeHumanoid, makeWolf, resolveCollisions,
} from '../entities.js';
import { scene } from '../gfx/core.js';
import { VILLAGERS } from '../story.js';
import { flashing } from '../ui/feedback.js';
import { initWilderness } from '../wilderness.js';
import { wildSpots } from './activities.js';
import { EVO } from './evo.js';
import { addSheep } from './fauna.js';
import { frostSlow } from './magic.js';
import { addPickup, pickups } from './pickups.js';
import { lockFoe, setLockFoe } from '../main.js';

// ================= 马 =================
export const horses = [];
export function addHorse(x, z, color, owned) {
  const h = { ...makeHorse(color), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned, stolen: false, state: 'idle', timer: rand() * 4, walkT: 0 };
  h.group.position.copy(h.pos);
  scene.add(h.group);
  horses.push(h);
  return h;
}

// ================= 卫兵 / 村民 / 盗贼 =================
export const guards = [], villagers = [], bandits = [];

export function addGuard(x, z, waypoints, knight = false, extra = false) {
  const g = { ...makeHumanoid({ shirt: knight ? 0x5a1c1c : 0x8f2f35, pants: 0x3a3a44, helmet: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: 3, speed: knight ? 8.3 : 5.2,
    state: 'patrol', waypoints, wp: 0, attackCd: 0, stunT: 0, downT: 0, walkT: 0,
    extra, home: new THREE.Vector3(x, 0, z), wantedHit: false };
  g.group.position.copy(g.pos);
  scene.add(g.group);
  guards.push(g);
  return g;
}

// 每个村民都是有名有姓、有家有业的人(见 story.js)
const villagerColors = [0x7a5c8f, 0x4a7a9f, 0xa06a3a, 0x5f7a3a, 0x9f4a6a, 0x6a6a7a];
const villagerHair = [0x3a2a1a, 0x6a4a2a, 0x8a3a1a, 0x2a1a10, 0xbababa, 0x1a1a14, 0xd0b040];

// 盗贼血量:各处按"老数值"传 hp,这里统一 ×1.6(3→5、2→3、8→13):一刀一个的日子过去了
const FOE_HP_MUL = 1.6;
export function addBandit(x, z, opts = {}) {
  const hp0 = Math.max(1, Math.round((opts.hp ?? 3) * FOE_HP_MUL));
  const b = { ...makeHumanoid({ shirt: opts.boss ? 0x5a1020 : 0x3b3b46, pants: 0x26262e, hood: true, mask: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: hp0, maxHp: hp0, speed: opts.speed ?? 5.8,
    state: 'patrol', home: new THREE.Vector3(x, 0, z), attackCd: 0, stunT: 0, walkT: 0, dead: false,
    boss: !!opts.boss, escort: !!opts.escort, dmg: opts.dmg ?? 2 };
  if (opts.scale) b.group.scale.setScalar(opts.scale);
  b.group.position.copy(b.pos);
  scene.add(b.group);
  bandits.push(b);
  return b;
}
const CULL_D2 = 120 * 120;
export function entFar(e) {
  return dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > CULL_D2;
}
// 实体退场的统一出口:移出场景、释放它独占的几何/材质(合并网格、闪白私有材质;共享的不动)、
// 退出闪白与锁定、从所属名单摘掉。只 scene.remove 不释放,显存会随事件/增援/竞技场一轮轮慢慢涨
export function retireEntity(e, list = null) {
  if (!e) return;
  if (list) { const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); }
  if (e.group) {
    if (e.group.parent) e.group.parent.remove(e.group);
    disposeEntityGroup(e.group);
  }
  flashing.delete(e);
  if (lockFoe === e) setLockFoe(null);
}
// 实体之外的一次性道具(棺材、陨石……):自己的几何/材质一并释放
export function retireProp(o) {
  if (!o) return;
  if (o.parent) o.parent.remove(o);
  disposeEntityGroup(o);
}
export function moveEntity(e, tx, tz, speed, dt) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  speed *= frostSlow(e); // 踩着冰面腿脚发僵
  e.pos.x += (dx / d) * speed * dt;
  e.pos.z += (dz / d) * speed * dt;
  e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), dt * 10);
  e.walkT += dt * speed * 2.2;
  resolveCollisions(e.pos, 0.4, colliders);
  return false;
}
// 人形动画:四肢摆动 + 身体起伏 + 奔跑前倾 + 呼吸怠速 + 头部环视
export function animateLimbs(p, walkT, moving, group = null, speedNorm = 0.6) {
  if (p.cape) { // 披风:跑得越快扬得越高,步伐里轻轻起伏
    const goal = moving ? -0.18 - speedNorm * 0.55 + Math.sin(walkT * 2) * 0.06 : -0.06 + Math.sin(performance.now() * 0.0015) * 0.03;
    p.cape.rotation.x += (goal - p.cape.rotation.x) * 0.15;
  }
  const now = frame.now;
  const swing = moving ? Math.sin(walkT) * (0.45 + 0.35 * speedNorm) : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  if (p.armL) p.armL.rotation.x = -swing * 0.85;
  if (p.armR && !p._attackAnim) p.armR.rotation.x = swing * 0.85;
  let bob = 0;
  if (moving) {
    bob = Math.abs(Math.cos(walkT)) * 0.05 * (0.4 + speedNorm);
  } else {
    bob = Math.sin(now * 0.0018) * 0.012; // 呼吸
  }
  if (p.body) {
    p.body.position.y = 0.78 + bob * 0.5;
    if (!p._attackAnim) {
      p.body.rotation.x = moving ? 0.05 + 0.12 * Math.max(0, speedNorm - 0.8) : 0;
      p.body.rotation.y *= 0.85;
    }
  }
  if (p.head) {
    p.head.position.y = 1.32 + bob * 0.6;
    if (!moving) p.head.rotation.y = Math.sin(now * 0.0005 + p.head.id * 1.7) * 0.4;
    else p.head.rotation.y *= 0.9;
  }
  if (group) group.position.y += bob;
}
// 通用三段式挥剑:抬臂蓄力 → 劈砍 → 收势(t: 0→1)
export function meleeSwing(p, t, mode) {
  // 突刺:收臂→直臂捅出→回收,身体侧拧送肩(骑砍的枪感)
  if (mode === 'thrust') {
    let arm;
    if (t < 0.28) arm = -0.15 - (t / 0.28) * 0.35;             // 收
    else if (t < 0.55) arm = -0.5 - ((t - 0.28) / 0.27) * 1.15; // 捅
    else arm = -1.65 + ((t - 0.55) / 0.45) * 1.65;              // 收回
    p.armR.rotation.x = arm;
    p.armR.rotation.z = 0.12 * Math.sin(t * Math.PI);
    if (p.body) p.body.rotation.y = -0.4 * Math.sin(t * Math.PI);
    return;
  }
  let arm, twist;
  if (t < 0.32) {
    const k = t / 0.32;
    arm = -2.3 * (1 - (1 - k) * (1 - k));
    twist = -0.35 * k;
  } else if (t < 0.62) {
    const k = (t - 0.32) / 0.3;
    arm = -2.3 + 3.1 * k * k;
    twist = -0.35 + 0.8 * k;
  } else {
    const k = (t - 0.62) / 0.38;
    arm = 0.8 * (1 - k);
    twist = 0.45 * (1 - k);
  }
  // 下劈:同一条弧线抡得更满、劈得更深,身体跟着前倾压刀
  if (mode === 'overhead') {
    arm *= 1.2;
    if (p.body) p.body.rotation.x = 0.3 * Math.sin(Math.min(1, t / 0.7) * Math.PI);
  } else if (p.body) p.body.rotation.x = 0;
  p.armR.rotation.x = arm;
  p.armR.rotation.z = -0.25 * Math.sin(t * Math.PI);
  if (p.body) p.body.rotation.y = twist;
}
export function moveEntityHorse(h, tx, tz, speed, dt) {
  const dx = tx - h.pos.x, dz = tz - h.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  h.pos.x += (dx / d) * speed * dt;
  h.pos.z += (dz / d) * speed * dt;
  h.yaw = angleLerp(h.yaw, Math.atan2(dx, dz), dt * 6);
  h.walkT += dt * speed * 2;
  resolveCollisions(h.pos, 0.8, colliders);
  return false;
}
// 马匹步态:静止 / 小跑(对角步)/ 疾驰(前后肢分相 + 身体俯仰起伏)
export function animHorseLegs(h, intensity) {
  const w = h.walkT;
  const L = h.parts.legs;
  if (intensity < 0.05) {
    for (const leg of L) leg.rotation.x *= 0.8;
    h.visBob = (h.visBob || 0) * 0.8;
    h.visPitch = (h.visPitch || 0) * 0.8;
  } else if (intensity < 1.25) {
    // 小跑:对角腿成对
    const a = Math.sin(w) * 0.5;
    L[0].rotation.x = a; L[1].rotation.x = -a;
    L[2].rotation.x = -a; L[3].rotation.x = a;
    h.visBob = Math.abs(Math.sin(w)) * 0.04;
    h.visPitch = 0;
  } else {
    // 疾驰:后肢蹬地、前肢前伸,身体俯仰 + 腾空起伏
    const rear = Math.sin(w) * 0.9;
    const front = Math.sin(w + 2.2) * 0.9;
    L[0].rotation.x = rear; L[1].rotation.x = rear * 0.92;
    L[2].rotation.x = front; L[3].rotation.x = front * 0.92;
    h.visBob = Math.max(0, Math.sin(w + 0.6)) * 0.17;
    h.visPitch = Math.sin(w + 1.2) * 0.07;
  }
  h.group.position.y = h.pos.y + (h.visBob || 0);
  h.group.rotation.x = h.visPitch || 0;
}

// ================= 狼群 =================
export const wolves = [];
export function addWolf(x, z) {
  const w = { ...makeWolf(), pos: new THREE.Vector3(x, 0, z), yaw: rand() * 6.28,
    home: new THREE.Vector3(x, 0, z), hp: EVO.wolfGen >= 3 ? 4 : 3, speed: 7.2 + EVO.wolfSpeed,
    attackCd: 0, stunT: 0, walkT: 0, dead: false, respawnT: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  wolves.push(w);
  return w;
}

// 开局的常住人口:马厩与野外的马、巡逻卫兵、有名有姓的村民、各处狼窝;再接上无尽荒野的生成钩子
// (启动装配时在建好世界、模型就绪之后调用一次;出场顺序 = 名单顺序,测试会按名单取实体)
export function initActors() {
  addHorse(50, 6, 0x8b5a2b, true);
  addHorse(54, 5, 0x4a3a30, true);
  addHorse(30, 90, 0xc4a35a, false);
  addHorse(-40, 78, 0x9b7653, false);
  addHorse(100, -25, 0x6e5240, false);
  addGuard(10, 2, [[12, 2], [0, 16], [-12, 2], [0, -8]]);
  addGuard(-10, 8, [[-12, 2], [0, -8], [12, 2], [0, 16]]);
  addGuard(-3, 48, [[-3, 48], [3, 48], [3, 40], [-3, 40]]);
  addGuard(3, 44, [[3, 44], [-3, 44]]);
  addGuard(64, 3, [[64, 3], [64, -3], [56, 0]]);
  addGuard(-6, -28, [[-6, -28], [6, -28]]);
  addGuard(6, -30, [[6, -30], [-6, -30], [0, -20]]);
  addGuard(-40, 20, [[-40, 20], [-20, 20], [-20, -20], [-40, -20]]);
  VILLAGERS.forEach((id, i) => {
    const v = { ...makeHumanoid({
      shirt: villagerColors[i % villagerColors.length], pants: 0x50412e,
      hair: villagerHair[i % villagerHair.length],
      cap: [2, 13, 19].includes(i),                  // 果贩/伙计/村长:布帽
      straw: [6, 7, 15, 17].includes(i),             // 农夫/农妇/渔家女/磨坊主:草帽
      hood: [8, 18, 21].includes(i),                 // 猎人/守墓人/采药婆:兜帽
    }),
      id, dbKey: `v${i}`, pos: new THREE.Vector3(id.home[0], 0, id.home[1]), yaw: rand() * 6.28,
      home: new THREE.Vector3(id.home[0], 0, id.home[1]),
      state: 'idle', timer: rand() * 3, walkT: 0, fleeT: 0, downT: 0,
      sleeping: false, lineIdx: Math.floor(rand() * id.lines.length) };
    v.group.position.copy(v.pos);
    scene.add(v.group);
    villagers.push(v);
  });
  for (const [wx, wz] of world.wolfSpawns) addWolf(wx, wz);

  // ---- 无尽荒野接入:狼群/野马/野羊/匪帮/掉落由主系统托管 ----
  initWilderness(scene, colliders, {
    spawnWolf(x, z, chunkKey) {
      if (wolves.filter((w) => !w.dead).length > 42) return null;
      const w = addWolf(x, z);
      w.chunk = chunkKey;
      return w;
    },
    spawnHorse(x, z, chunkKey) {
      if (horses.filter((h) => h.chunk && !h.sheep).length > 8) return null;
      const wildColors = [0x8b5a2b, 0x4a3a30, 0xc4a35a, 0x9b7653, 0x6e5240, 0x3a3a3a];
      const h = addHorse(x, z, wildColors[Math.floor(rand() * wildColors.length)], false);
      h.chunk = chunkKey;
      return h;
    },
    spawnSheep(x, z, chunkKey) {
      if (horses.filter((h) => h.chunk && h.sheep).length > 10) return null;
      const s = addSheep(x, z);
      s.chunk = chunkKey;
      return s;
    },
    spawnBandit(x, z, chunkKey) {
      if (bandits.filter((b) => b.chunk && !b.dead).length > 10) return null;
      const b = addBandit(x, z, { hp: 3 });
      b.ambient = true; // 不计入主线任务,死后在窝点重生
      b.chunk = chunkKey;
      return b;
    },
    dropCoin(x, z, chunkKey) {
      addPickup('coin', x, z, 600, -1, chunkKey);
    },
    dropHeart(x, z, chunkKey) {
      addPickup('heart', x, z, 600, -1, chunkKey);
    },
    registerSpot(type, x, z, chunkKey) {
      wildSpots.push({ type, x, z, chunk: chunkKey });
    },
    removeChunkEntities(chunkKey) {
      for (let i = wildSpots.length - 1; i >= 0; i--) {
        if (wildSpots[i].chunk === chunkKey) wildSpots.splice(i, 1);
      }
      for (let i = pickups.length - 1; i >= 0; i--) {
        if (pickups[i].chunk === chunkKey) {
          scene.remove(pickups[i].mesh);
          pickups.splice(i, 1);
        }
      }
      for (let i = wolves.length - 1; i >= 0; i--) {
        if (wolves[i].chunk === chunkKey) {
          scene.remove(wolves[i].group);
          disposeEntityGroup(wolves[i].group);
          flashing.delete(wolves[i]);
          wolves.splice(i, 1);
        }
      }
      for (let i = bandits.length - 1; i >= 0; i--) {
        if (bandits[i].chunk === chunkKey) {
          scene.remove(bandits[i].group);
          disposeEntityGroup(bandits[i].group);
          flashing.delete(bandits[i]);
          bandits.splice(i, 1);
        }
      }
      for (let i = horses.length - 1; i >= 0; i--) {
        const h = horses[i];
        if (h.chunk !== chunkKey) continue;
        if (h === player.mounted) { h.chunk = null; continue; } // 骑走的坐骑归玩家
        scene.remove(h.group);
        disposeEntityGroup(h.group);
        horses.splice(i, 1);
      }
    },
  });
}
