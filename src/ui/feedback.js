// 打击反馈:伤害数字与战斗浮字(showDamage/callout,屏幕投影的 DOM 池)、连杀条的显示(showCombo/hideCombo;
// 连杀规则在 systems/combat.js)、倒地动画(startFall)、受击闪白(实例级:首次受击把材质克隆为私有,flashEntity/flashing)、
// 受击弹跳与击退(hitFX)、残血红晕与心跳。主循环驱动:updateFlashes、updateKnockback、updateDamageNums、updateFalls、updateLowHp。
import * as THREE from 'three';
import { groundH } from '../terrain.js';
import { colliders, player } from '../core/state.js';
import { camera } from '../gfx/core.js';
import { sfx } from '../audio.js';
import { hitStop } from '../core/timefx.js';
import { spawnDust } from '../systems/weather.js';
import { resolveCollisions } from '../entities.js';

// ================= 打击感:慢动作/伤害数字/连杀/倒地动画 =================

const dmgPool = [];
const _dmgV = new THREE.Vector3();
export function showDamage(pos, text, crit = false) {
  let d = dmgPool.find((x) => x.t <= 0);
  if (!d) {
    if (dmgPool.length >= 14) return;
    d = { el: document.createElement('div'), t: 0, p: new THREE.Vector3() };
    document.getElementById('hud').appendChild(d.el);
    dmgPool.push(d);
  }
  d.el.className = crit ? 'dmgnum crit' : 'dmgnum';
  d.el.textContent = text;
  d.t = 0.75;
  d.p.set(pos.x, (pos.y || 0) + 1.5 + groundH(pos.x, pos.z), pos.z);
}
// 战斗即时浮字(弹反/还击/破防/打断/背刺……):当场出现在头顶,不进 toast 排队
export function callout(text, kind = 'gold', pos = null) {
  let d = dmgPool.find((x) => x.t <= 0);
  if (!d) {
    if (dmgPool.length >= 18) d = dmgPool.reduce((a, b) => (a.t < b.t ? a : b)); // 满了就顶掉最旧的
    else {
      d = { el: document.createElement('div'), t: 0, p: new THREE.Vector3() };
      document.getElementById('hud').appendChild(d.el);
      dmgPool.push(d);
    }
  }
  const at = pos || player.pos;
  d.el.className = `dmgnum callout ${kind}`;
  d.el.textContent = text;
  d.t = 1.1;
  d.p.set(at.x, (at.y || 0) + (pos ? 2.2 : 2.5) + groundH(at.x, at.z), at.z);
}
export function updateDamageNums(dt) {
  if (comboPopT > 0) { comboPopT -= dt; if (comboPopT <= 0) comboEl.style.transform = 'translateX(-50%) scale(1)'; }
  for (const d of dmgPool) {
    if (d.t <= 0) { d.el.style.display = 'none'; continue; }
    d.t -= dt;
    d.p.y += dt * 1.7;
    _dmgV.copy(d.p).project(camera);
    if (_dmgV.z > 1) { d.el.style.display = 'none'; continue; }
    d.el.style.display = 'block';
    d.el.style.left = `${(_dmgV.x * 0.5 + 0.5) * window.innerWidth}px`;
    d.el.style.top = `${(-_dmgV.y * 0.5 + 0.5) * window.innerHeight}px`;
    d.el.style.opacity = Math.min(1, d.t / 0.3);
  }
}

// 连杀条:只管显示(连杀几、弹一下、熄灭);计数与里程碑规则在 systems/combat.js 的 registerKill
const comboEl = document.getElementById('combo');
let comboPopT = 0;
export function showCombo(n) {
  comboEl.textContent = `${n} 连杀!`;
  comboEl.style.opacity = 1;
  comboEl.style.transform = 'translateX(-50%) scale(1.3)';
  comboPopT = 0.12;
}
export function hideCombo() { comboEl.style.opacity = 0; }

const fallAnims = [];
export function startFall(e) { e.group.rotation.x = 0; fallAnims.push({ e, t: 0.32 }); }
export function updateFalls(dt) {
  for (let i = fallAnims.length - 1; i >= 0; i--) {
    const f = fallAnims[i];
    f.t -= dt;
    f.e.group.rotation.x = -(1 - Math.max(0, f.t) / 0.32) * Math.PI / 2;
    if (f.t <= 0) fallAnims.splice(i, 1);
  }
}
// 受击闪白只作用于该实体自己的材质副本:人形/怪物的材质在全场共享,
// 直接改共享材质会让"砍一刀全城一起闪"。首次受击时把材质克隆为私有
// (同参数材质共用着色器程序,克隆开销很小),之后闪白/还原都只动自己。
export const flashing = new Set();
// 只克隆共享材质:已经是私有的(幽灵半透明、金鸡染色……)原样留用,不再"换下来就漏掉";
// 克隆会连 userData 一起拷,要清掉共享标记,否则实体卸载时这份私有材质不会被释放
function ownMaterials(e) {
  if (e._ownMats) return;
  e._ownMats = true;
  const own = (m) => {
    if (!m || !m.userData.shared) return m;
    const c = m.clone();
    delete c.userData.shared;
    return c;
  };
  e.group.traverse((o) => {
    if (!o.material) return;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
  });
}
function setFlash(e, on) {
  e.group.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : null;
    if (!mats) return;
    for (const m of mats) {
      if (!m.emissive) continue;
      if (on) {
        if (m._e0 === undefined) { m._e0 = m.emissive.getHex(); m._ei0 = m.emissiveIntensity; }
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.8;
      } else if (m._e0 !== undefined) {
        m.emissive.setHex(m._e0);
        m.emissiveIntensity = m._ei0;
        delete m._e0; delete m._ei0;
      }
    }
  });
}
function flashEntity(e, t = 0.09) {
  if (!e || !e.group) return;
  ownMaterials(e);
  if (!(e._flashT > 0)) setFlash(e, true);
  e._flashT = t;
  flashing.add(e);
}
// 受击弹跳与闪白按游戏时钟结算(暂停/卡顿时不会错位)
export function updateFlashes(dt) {
  for (const e of flashing) {
    if (e._popT > 0) {
      e._popT -= dt;
      if (e._popT <= 0) { e.group.scale.x /= 1.14; e.group.scale.z /= 1.14; e._popT = 0; }
    }
    if (e._flashT > 0) {
      e._flashT -= dt;
      if (e._flashT <= 0) { e._flashT = 0; setFlash(e, false); }
    }
    if (!(e._popT > 0) && !(e._flashT > 0)) flashing.delete(e);
  }
}
export function hitFX(e, push = 0.55) {
  hitStop(0.035);
  spawnDust(e.pos.x, 1.0, e.pos.z, 3, 0.45, 1.4); // 命中扬尘:刀刀有反馈
  // 受击弹跳:横向鼓一下再弹回,肉眼可见的"挨了一记"
  if (!(e._popT > 0)) {
    e.group.scale.x *= 1.14;
    e.group.scale.z *= 1.14;
  }
  e._popT = 0.09;
  // 击退是一股很快衰减的速度(0.12 秒左右滑出去),不再一帧瞬移
  const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  if (push > 0.01) {
    const T = 0.12 + Math.min(0.12, push * 0.03);
    e.kbT0 = e.kbT = T;
    e.kbVx = (dx / d) * (2 * push / T); // 线性衰减:总位移 = v0·T/2 = push
    e.kbVz = (dz / d) * (2 * push / T);
    if (!knockList.includes(e)) knockList.push(e);
  }
  flashEntity(e);
}
const knockList = [];
export function updateKnockback(dt) {
  for (let i = knockList.length - 1; i >= 0; i--) {
    const e = knockList[i];
    if (!(e.kbT > 0) || e.dead) { e.kbT = 0; knockList.splice(i, 1); continue; }
    const k = Math.min(dt, e.kbT);
    const f = e.kbT / e.kbT0; // 剩余比例:速度线性减到 0
    e.pos.x += e.kbVx * f * k;
    e.pos.z += e.kbVz * f * k;
    e.kbT -= k;
    resolveCollisions(e.pos, 0.4, colliders);
    if (e.group) { e.group.position.x = e.pos.x; e.group.position.z = e.pos.z; }
  }
}
// 残血:屏幕边缘红晕随心跳明灭,每 0.95 秒一声心跳
const lowhpEl = document.getElementById('lowhp');
export function updateLowHp(dt, now) {
  if (player.hp <= 3 && !player.dead) {
    lowhpEl.style.opacity = 0.55 + Math.sin(now * 0.008) * 0.3;
    player.hbT = (player.hbT || 0) - dt;
    if (player.hbT <= 0) { player.hbT = 0.95; sfx.heartbeat(); }
  } else if (lowhpEl.style.opacity !== '0') {
    lowhpEl.style.opacity = 0;
  }
}


