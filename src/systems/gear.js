// 装备:武器表 WEAPONS(伤害/距离/冷却/击退/体力倍率)、护甲表 ARMORS、手中武器与护甲的外观、铁匠铺商店。
// 对外:setWeaponVisual/setArmorVisual、applyArmor、cycleWeapon(Q)、openShop/refreshShop、shopOpen(商店开着时不收玩法输入)。
// 买甲后的生命上限由 player.recomputeMaxHp() 统一重算(派生属性只在 systems/player.js 里算)。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { saveGame } from '../core/save.js';
import { player } from '../core/state.js';
import { getWeaponModel, lambert } from '../entities.js';
import { renderer } from '../gfx/core.js';
import { callout } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import { recomputeMaxHp } from './player.js';

// ================= 武器与护甲系统 =================
export const WEAPONS = {
  // staMul=重量:同一招巨剑更费体力、短匕最省——省下的气就是你的走位(骑砍的取舍)
  sword:      { name: '铁剑', icon: '🗡️', dmg: 1, range: 2.4, cd: 0.28, knock: 0.55, price: 0, staMul: 1 },
  dagger:     { name: '短匕', icon: '🔪', dmg: 1, range: 2.0, cd: 0.16, knock: 0.3, price: 30, staMul: 0.65 },
  greatsword: { name: '巨剑', icon: '⚔️', dmg: 3, range: 2.9, cd: 0.7, knock: 1.3, price: 90, staMul: 1.5 },
  bow:        { name: '猎弓', icon: '🏹', dmg: 2, range: 0, cd: 0.8, knock: 0.4, price: 60, staMul: 1 },
  warblade:   { name: '枭首之刃', icon: '⚜️', dmg: 2, range: 2.5, cd: 0.24, knock: 0.7, staMul: 0.9 }, // 无价:单挑斩将夺来
};
export const ARMORS = [
  { name: '', bonus: 0 },
  { name: '皮甲', bonus: 2, price: 40, color: 0x7a5230 },
  { name: '板甲', bonus: 4, price: 120, color: 0x9aa4ad },
];


// 手中武器外观
let _warBladeMat = null;
let _goldBladeMat = null;
export function setWeaponVisual(type) {
  const armR = player.parts.armR;
  if (player.weaponGroup) armR.remove(player.weaponGroup);
  if (player.bowGroup) { player.parts.armL.remove(player.bowGroup); player.bowGroup = null; }
  // Blender 武器模板:血槽刃/缠柄/铁护手;淬火后刃身换金
  {
    const name = { dagger: 'Dagger', greatsword: 'Greatsword', bow: 'Bow', sword: 'Sword' }[type] || 'Sword';
    const real = getWeaponModel(name);
    if (real) {
      if (type === 'warblade') { // 枭首之刃:暗红刃身,一眼认出
        if (!_warBladeMat) _warBladeMat = lambert(0x8a2430, { metalness: 0.8, roughness: 0.3 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _warBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      } else if (player.swordLv >= 2 && type !== 'bow') {
        if (!_goldBladeMat) _goldBladeMat = lambert(0xe8c34a, { metalness: 0.85, roughness: 0.25 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _goldBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      }
      if (type === 'bow') {
        real.position.set(0, -0.42, 0.06);
        player.parts.armL.add(real);
        player.bowGroup = real;
        player.weaponGroup = null;
        return;
      }
      const g2 = new THREE.Group();
      g2.add(real);
      g2.position.y = -0.4;
      armR.add(g2);
      player.weaponGroup = g2;
      return;
    }
  }
  const g = new THREE.Group();
  const steel = lambert(player.swordLv >= 2 ? 0xe8c34a : 0xd8dde2,
    { metalness: 0.85, roughness: 0.25 });
  if (type === 'dagger') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), steel);
    blade.position.y = -0.46;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), lambert(0x6b4a2f));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'greatsword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.15, 0.035), steel);
    blade.position.y = -0.82;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), lambert(0x8a6a20, { metalness: 0.6, roughness: 0.35 }));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'bow') {
    // 弓持在左手
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 14, Math.PI), lambert(0x6b4a2f, { roughness: 0.8 }));
    arc.rotation.z = Math.PI / 2;
    bow.add(arc);
    const stringMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.84, 0.012), lambert(0xd8d0c0));
    bow.add(stringMesh);
    bow.position.set(0, -0.42, 0.06);
    player.parts.armL.add(bow);
    player.bowGroup = bow;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.03), steel);
    blade.position.y = -0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), lambert(0xc9a227));
    guard.position.y = -0.26;
    g.add(blade, guard);
  }
  g.position.y = -0.2;
  armR.add(g);
  player.weaponGroup = g;
  if (player.parts.sword) player.parts.sword.visible = false; // 隐藏初始剑模型
}
export function setArmorVisual(level) {
  if (player.armorMesh) { player.group.remove(player.armorMesh); player.armorMesh = null; }
  if (level <= 0) return;
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.285, 0.5, 10),
    lambert(ARMORS[level].color, { metalness: level === 2 ? 0.7 : 0.1, roughness: level === 2 ? 0.35 : 0.8 }));
  vest.position.y = 0.8;
  player.group.add(vest);
  player.armorMesh = vest;
}
function applyArmor(level) {
  player.armor = level;
  recomputeMaxHp();
  player.hp = Math.min(player.hp + ARMORS[level].bonus, player.maxHp);
  setArmorVisual(level);
}
export function cycleWeapon() {
  if (player.mounted || player.carrying) return;
  if (player.weaponsOwned.length < 2) { callout('只有一把武器(铁匠铺能买短匕/巨剑/猎弓)', 'dim'); return; }
  const i = player.weaponsOwned.indexOf(player.weapon);
  player.weapon = player.weaponsOwned[(i + 1) % player.weaponsOwned.length];
  setWeaponVisual(player.weapon);
  sfx.equip();
  toast(`${WEAPONS[player.weapon].icon} 已装备:${WEAPONS[player.weapon].name}`, 1.5);
}


// ---- 铁匠铺(装备商店) ----
const shopEl = document.getElementById('shop');
export let shopOpen = false;
export function refreshShop() {
  const items = [
    ['shop-dagger', `🔪 短匕 —— 30 金币(出手极快)`, () => !player.weaponsOwned.includes('dagger') && player.coins >= 30,
      () => { player.coins -= 30; player.weaponsOwned.push('dagger'); }],
    ['shop-greatsword', `⚔️ 巨剑 —— 90 金币(势大力沉,击退拉满)`, () => !player.weaponsOwned.includes('greatsword') && player.coins >= 90,
      () => { player.coins -= 90; player.weaponsOwned.push('greatsword'); }],
    ['shop-bow', `🏹 猎弓 —— 60 金币(远程射击,箭矢管够)`, () => !player.weaponsOwned.includes('bow') && player.coins >= 60,
      () => { player.coins -= 60; player.weaponsOwned.push('bow'); }],
    ['shop-temper', `🔥 淬火陨铁 —— 50 金币(所有武器伤害 +1)`, () => player.swordLv === 1 && player.coins >= 50,
      () => { player.coins -= 50; player.swordLv = 2; setWeaponVisual(player.weapon); }],
    ['shop-leather', `🛡️ 皮甲 —— 40 金币(生命上限 +1 心)`, () => player.armor < 1 && player.coins >= 40,
      () => { player.coins -= 40; applyArmor(1); }],
    ['shop-plate', `🛡️ 板甲 —— 120 金币(生命上限 +2 心)`, () => player.armor < 2 && player.coins >= 120,
      () => { player.coins -= 120; applyArmor(2); }],
  ];
  for (const [id, label, canBuy, buy] of items) {
    const btn = document.getElementById(id);
    const owned = id === 'shop-dagger' ? player.weaponsOwned.includes('dagger')
      : id === 'shop-greatsword' ? player.weaponsOwned.includes('greatsword')
      : id === 'shop-bow' ? player.weaponsOwned.includes('bow')
      : id === 'shop-temper' ? player.swordLv >= 2
      : id === 'shop-leather' ? player.armor >= 1
      : player.armor >= 2;
    btn.textContent = owned ? `${label.split('——')[0]}—— 已拥有` : label;
    btn.disabled = !canBuy();
    btn.onclick = () => {
      if (!canBuy()) return;
      buy();
      sfx.chest();
      saveGame();
      refreshShop();
    };
  }
}
export function openShop() {
  shopOpen = true;
  refreshShop();
  shopEl.style.display = 'flex';
  document.exitPointerLock();
}
document.getElementById('shop-close').onclick = () => {
  shopOpen = false;
  shopEl.style.display = 'none';
  renderer.domElement.requestPointerLock();
  toast('格罗姆:武器认主,好好待它们。', 2);
};

