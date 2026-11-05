// 玩家出招:F/左键按下即出轻击,按住 0.2 秒且这一刀已落下就转入蓄力(武器渐亮、脚步放慢),松手抡重击;
// 弓:松手放箭、按住拉满月;短匕蓄力飞刀。出招中按的键进缓冲(0.35 秒),收刀前一刻自动接上。
// 伤害在判定帧(scheduleStrike:刀真正劈到的那一刻)由 combat.meleeSweep 结算,被打断则作废;格挡 updateBlock。
// 对外:attackDown/attackUp(输入队列调用)、tryAttack、heavyAttack、cancelCharge、endAttack、strikePending、
// updateAttackInput(dt)(主循环);initAttack() 把蓄力光与圆盾挂上玩家手臂。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { frame } from '../core/frame.js';
import { colliders, player, started } from '../core/state.js';
import { hitStop } from '../core/timefx.js';
import { simNow } from '../core/timers.js';
import { dist2, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { dialog } from '../ui/dialog.js';
import { callout, whiteHot } from '../ui/feedback.js';
import { paused } from '../ui/pause.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { bandits, guards, meleeSwing, wolves } from './actors.js';
import { cam } from './camera.js';
import { faceNearestFoe, lockFoe, meleeSweep, swingTrail, swingTrailV } from './combat.js';
import { WEAPONS } from './gear.js';
import { keys } from './input.js';
import { arrowBonus, dragonAim, meleeBonus, skillLv, skillXp, spendSta } from './magic.js';
import { arrowGeo, arrowMat, arrows, shootArrow, wetSpread } from './projectiles.js';
import { spawnDust } from './weather.js';

// ================= 出招输入与判定帧 =================
// 按下 F/左键:即出轻击(不等松手);按住超过 0.2 秒、这一刀已经落下,就收住余势转入蓄力——
// 武器渐亮、脚步放慢,松手抡出重击(伤害随蓄力 2~3.5 倍)。弓例外:松手放箭,按住拉满月。
// 出招中按下的键进缓冲(0.35 秒内有效),收刀前一刻自动接上,连按不吞键。
// 伤害在"判定帧"(刀真正劈到的那一刻)结算,刀光与命中同帧;被打断则这刀作废。
const CHARGE_START = 0.2, CHARGE_FULL = 1.0, ATK_BUFFER = 0.35;
// 跳劈:离地 ≥1m 或滞空 ≥0.25 秒才砸得下去(早按的进缓冲,够高了自动出手);体力 22(起跳另耗 8)。
// 落地后 0.6 秒硬直(跳不起、滚不了、举不起盾);正前 180° 内 2 伤、身后 1 伤,最多砸中两人(player.js 落地结算)
const PLUNGE_MIN_H = 1.0, PLUNGE_MIN_AIR = 0.25, PLUNGE_STA = 22;
export const plungeReady = () => player.pos.y >= PLUNGE_MIN_H || (player.airT || 0) >= PLUNGE_MIN_AIR;
const plungeWait = () => !player.onGround && !player.mounted && player.weapon !== 'bow' && !player.plunging && !plungeReady();
// 弹反:举盾那一刻起 150ms 内挨刀 = 完美弹反。松盾后 0.4 秒内再举不重开弹反窗;
// 举盾 0.3 秒没等到刀 = 弹反落空,之后 0.6 秒内举盾只算普通格挡(连点右键换不来弹反)
const PARRY_WIN = 150, PARRY_REARM = 400, PARRY_FAIL_AT = 300, PARRY_FAIL_CD = 600;
const chargeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending }));
// 圆盾:左臂一面铁箍木盾——格挡不再是"把持剑的手抬起来"。拿弓、巨剑(双手)时收起
export const playerShield = (() => {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.82 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.75 });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.045, 20), wood);
  face.rotation.z = Math.PI / 2; // 盾面朝外侧
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.026, 6, 24), iron);
  rim.rotation.y = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 6), iron);
  boss.scale.set(0.55, 1, 1);
  boss.position.x = -0.03;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.07), iron); // 横箍
  band.position.x = -0.026;
  for (const m of [face, rim, boss, band]) { m.castShadow = true; g.add(m); }
  g.position.set(-0.11, -0.3, 0.02);
  return g;
})();
function setChargeGlow(k) {
  chargeGlow.visible = k > 0.01;
  if (!chargeGlow.visible) return;
  chargeGlow.scale.setScalar(0.4 + k * 1.1 + (k >= 1 ? Math.sin(frame.now * 0.02) * 0.12 : 0));
  chargeGlow.material.opacity = 0.25 + 0.55 * k;
  chargeGlow.material.color.setHex(k >= 1 ? 0xffd75e : 0xbfe0ff);
}
export const strikePending = () => !!(player.strike && !player.strike.done);
export function attackDown() {
  if (!started || player.dead || dialog.open || paused) return;
  if (player.landLagT > 0) { player.atkBufT = ATK_BUFFER; return; } // 跳劈落地硬直中:记下,缓过来再出
  // 马上、空中下劈、举盾(盾击):即按即出;正在出招、或还没跳到能下劈的高度,就进缓冲
  if (player.mounted || player.blocking || !player.onGround) {
    if (player.attackT > 0 || strikePending() || plungeWait()) player.atkBufT = ATK_BUFFER;
    else tryAttack();
    return;
  }
  player.atkHeld = true;
  player.atkHoldT = 0;
  if (player.weapon === 'bow') return; // 弓:松手才放箭
  if (player.attackT > 0 || strikePending() || player.rollT > 0 || player.staggerT > 0) {
    player.atkBufT = ATK_BUFFER; // 出招/翻滚/硬直中:记下,一有空档就出
    return;
  }
  tryAttack();
}
export function attackUp() {
  if (!player.atkHeld) return;
  player.atkHeld = false;
  if (player.charging) { releaseCharge(); return; }
  if (player.weapon === 'bow') {
    if (player.attackT > 0) player.atkBufT = ATK_BUFFER;
    else tryAttack();
  }
}
export function cancelCharge() {
  if (!player.charging) return;
  player.charging = false;
  player.chargeT = 0;
  setChargeGlow(0);
  if (!(player.attackT > 0)) player.parts._attackAnim = false;
}
function releaseCharge() {
  const k = Math.min(1, player.chargeT / CHARGE_FULL);
  player.charging = false;
  player.chargeT = 0;
  setChargeGlow(0);
  heavyAttack(k);
}
export function lunge(dx, dz, dist, dur) {
  const d = Math.hypot(dx, dz) || 1;
  player.lungeT = dur;
  player.lungeVx = (dx / d) * (dist / dur);
  player.lungeVz = (dz / d) * (dist / dur);
}
function scheduleStrike(at, fn) { player.strike = { at, fn, done: false }; }
// 收招:出招计时清零、动作复位(缓冲接招/转蓄力/挨打打断都走这里)
export function endAttack() {
  player.attackT = 0;
  player.parts._attackAnim = false;
  player.parts.armR.rotation.z = 0;
  player.parts.body.rotation.y = 0;
  player._animFrom = 0;
}
// 举盾:按住右键。刀没落下、蓄力、翻滚、踉跄、跳劈落地硬直、骑马、拿弓时举不起来;条件一满足自动举起。
// 弹反窗只在"真正重新举盾"时打开(见 PARRY_*):player.parryUntil 是本次举盾的弹反截止时刻(游戏时钟)
let wasBlocking = false;
function updateBlock() {
  const able = started && !player.dead && !player.mounted && player.weapon !== 'bow' && !dialog.open &&
    !(player.staggerT > 0) && !(player.rollT > 0) && !player.charging && !strikePending() && !player.carrying &&
    !(player.landLagT > 0);
  const now = simNow();
  if (!player.blockHeld || !able) player.blocking = false;
  else if (!player.blocking) {
    player.blocking = true;
    player.blockStart = now;
    player.parryArmed = now >= (player.parryReadyAt || 0);
    player.parryUntil = player.parryArmed ? now + PARRY_WIN : -1;
  } else if (player.parryArmed && now - player.blockStart >= PARRY_FAIL_AT) {
    player.parryArmed = false; // 举了 0.3 秒没等到刀:这次弹反落空
    player.parryReadyAt = Math.max(player.parryReadyAt || 0, now + PARRY_FAIL_CD);
  }
  // 松盾(不论是松键、被砸开还是被别的动作打断):0.4 秒内再举不重开弹反窗
  if (wasBlocking && !player.blocking) player.parryReadyAt = Math.max(player.parryReadyAt || 0, now + PARRY_REARM);
  wasBlocking = player.blocking;
}
// 完美弹反判定(player.damagePlayer 调用):本次举盾的弹反窗还开着
export const inParryWindow = () => player.blocking && simNow() <= (player.parryUntil ?? -1);
// 弹反成功:窗口用掉,冷却清零(下一次干净的举盾照样能弹)
export function consumeParry() { player.parryUntil = -1; player.parryArmed = false; player.parryReadyAt = 0; }
export function updateAttackInput(dt) {
  updateBlock();
  if (player.dead) { player.atkHeld = false; cancelCharge(); player.strike = null; player.atkBufT = 0; return; }
  if (player.mounted) { player.atkHeld = false; cancelCharge(); }
  if (player.atkHeld) {
    player.atkHoldT += dt;
    // 按住不放:这一刀落下之后收住余势,转入蓄力
    if (!player.charging && !player.mounted && player.atkHoldT >= CHARGE_START && !strikePending() &&
        player.rollT <= 0 && !(player.staggerT > 0) && !player.blocking && !player.carrying && player.onGround &&
        !(player.landLagT > 0) &&
        (player.weapon === 'bow' ? player.attackT <= 0 : true)) {
      if (player.attackT > 0) endAttack();
      player.charging = true;
      player.chargeT = 0;
      player.atkBufT = 0;
      sfx.equip();
    }
  }
  if (player.charging) {
    if (player.rollT > 0 || player.staggerT > 0 || player.blocking || player.carrying) cancelCharge();
    else {
      const before = player.chargeT;
      player.chargeT = Math.min(CHARGE_FULL, player.chargeT + dt);
      if (before < CHARGE_FULL && player.chargeT >= CHARGE_FULL) { sfx.clank(); callout('满蓄!', 'gold'); }
      setChargeGlow(player.chargeT / CHARGE_FULL);
      // 蓄力姿势:剑举过肩,定在起手位
      player.parts._attackAnim = true;
      meleeSwing(player.parts, 0.3 * Math.min(1, player.chargeT * 4), 'overhead');
    }
  }
  // 输入缓冲:收刀前 0.06 秒(且这一刀已落下)就接出下一刀;空中早按的跳劈等跳到够高再出
  if (player.atkBufT > 0) {
    player.atkBufT -= dt;
    if (!player.charging && !strikePending() && player.attackT <= 0.06 &&
        !(player.rollT > 0) && !(player.staggerT > 0) && !(player.landLagT > 0) && !plungeWait()) {
      player.atkBufT = 0;
      if (player.attackT > 0) endAttack();
      tryAttack();
    }
  }
  const st = player.strike;
  if (st && !st.done) {
    if (player.staggerT > 0 || player.rollT > 0) player.strike = null; // 被打断/翻滚取消:这刀作废
    else if ((player.attackDur - player.attackT) >= st.at || player.attackT <= 0) {
      st.done = true;
      player.strike = null;
      st.fn();
    }
  }
  if (player.lungeT > 0) {
    const k = Math.min(dt, player.lungeT);
    player.lungeT -= k;
    player.pos.x += player.lungeVx * k;
    player.pos.z += player.lungeVz * k;
    resolveCollisions(player.pos, 0.45, colliders);
  }
}
export function tryAttack() {
  // 盾击:举盾状态下出手——不掉血,但把面前的敌人撞个踉跄
  if (started && !player.dead && player.blocking && !(player.rollT > 0) &&
      !(player.attackT > 0) && !player.mounted && player.weapon !== 'bow') {
    if ((player.bashCd || 0) > simNow()) { callout('盾击冷却中', 'dim'); return false; }
    if (player.staggerT > 0 || !spendSta(12)) return false;
    player.bashCd = simNow() + 1600; // 盾击 1.6 秒一次,别拿它当无限控
    player._stance = null;
    player.attackT = 0.7;
    player.attackDur = 0.7;
    sfx.clank();
    cam.shake = Math.max(cam.shake, 0.2);
    for (const list of [bandits, guards, wolves]) {
      for (const e of list) {
        if (e.dead || e.downT > 0 || e.stunT === undefined) continue;
        const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.4 && (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) / (d || 1) > 0.25) {
          e.stunT = Math.max(e.stunT || 0, 0.8);
          e.stunSrc = 'bash'; // 盾击只撞个踉跄,不开处决窗口
        }
      }
    }
    meleeSweep(0, 2.2, 0.25, 1.6);
    return true;
  }
  if (!started || player.dead || player.attackT > 0 || player.carrying ||
      player.blocking || player.rollT > 0 || player.landLagT > 0 || strikePending()) return false;
  // 骑砍:马背上挥剑(伤害 +1、范围加长),判定帧在挥到一半——刀光与扣血同帧
  if (player.mounted && player.weapon !== 'bow' && !player.mounted.sheep) {
    if (player.staggerT > 0 || !spendSta(10)) return false; // 马上挥刀一样费力气
    const defM = WEAPONS[player.weapon];
    player._stance = null;
    player.attackT = defM.cd * 1.25;
    player.attackDur = player.attackT;
    sfx.sword();
    // 冲量伤害(骑砍之魂):疾驰中的一刀 +1(冲一趟不再随手清场)
    const mom = (player._rideSpeed || 0) >= 15 ? 1 : 0;
    scheduleStrike(player.attackT * 0.4, () => {
      swingTrail(defM.range + 1.0, 2.3);
      if (mom) sfx.whoosh(0.8);
      meleeSweep(meleeBonus(defM.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + mom),
        defM.range + 1.0, 0.1, defM.knock * (1.4 + mom * 0.5), { maxHits: 2 });
    });
    skillXp('onehand', 1);
    skillXp('riding', 1);
    return true;
  }
  if (player.mounted) {
    if (player.weapon !== 'bow') return false; // 羊背上还是算了
  }
  const def = WEAPONS[player.weapon];
  // 跳劈:空中出手——砸向地面,落点溅开一圈冲击(跳得够高才行,见 PLUNGE_*)
  if (player.staggerT > 0) return false; // 踉跄中出不了手
  if (!player.onGround && !player.mounted && player.weapon !== 'bow' && !player.plunging) {
    if (!plungeReady()) return false;
    if (!spendSta(Math.round(PLUNGE_STA * (def.staMul || 1)))) return false;
    player._stance = 'overhead'; // 跳劈就是从天而降的下劈
    player.plunging = true;
    player.vy = -16;
    player.attackT = def.cd;
    player.attackDur = def.cd * 1.4;
    sfx.sword();
    return true;
  }
  if (player.weapon === 'bow') {
    player._stance = null;
    player.attackT = def.cd;
    player.attackDur = def.cd;
    shootArrow();
    return true;
  }
  // 方向攻击(骑砍式):W+攻=突刺(够得远、只扎一人),S+攻=下劈(慢、重,砸在起手中/举盾的人身上能破架),
  // 其余=横斩(快、扫一片)
  const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  let stance = 'slash';
  if (!shiftHeld && (keys['KeyW'] || keys['ArrowUp'])) stance = 'thrust';
  else if (!shiftHeld && (keys['KeyS'] || keys['ArrowDown'])) stance = 'overhead';
  if (!spendSta(Math.round((stance === 'overhead' ? 16 : stance === 'thrust' ? 11 : 12) *
    (def.staMul || 1)))) return false;
  player._stance = stance === 'slash' ? null : stance; // 挥刀动画按招式走
  player._animFrom = 0;
  stats.swings = (stats.swings || 0) + 1;
  const hotMul = whiteHot() ? 0.8 : 1; // 白热:出刀更快
  // 三连斩:节奏内连续出手,第三剑更重、附带大击退
  const now = simNow();
  player.chainN = (now - (player.chainT || 0) < 900 + def.cd * 1000) ? (player.chainN || 0) + 1 : 1;
  player.chainT = now;
  const third = player.chainN >= 3;
  if (third) player.chainN = 0;
  // 招式节奏:横斩快、突刺稍长、下劈抡得满(起手慢,一刀见分量);判定帧 = 刀真正落下的那一刻
  const durMul = stance === 'overhead' ? 1.9 : stance === 'thrust' ? 1.35 : third ? 1.5 : 1.3;
  const hitAt = stance === 'overhead' ? 0.52 : stance === 'thrust' ? 0.45 : 0.42;
  player.attackT = def.cd * durMul * hotMul;
  player.attackDur = player.attackT;
  sfx.sword();
  if (dist2(player.pos.x, player.pos.z, 140, 20) < 80) unlockAch('windmill');
  // 后撤下劈(没锁定时按着 S):刀朝镜头前方劈,不跟着脚步转身砍向背后
  if (stance === 'overhead' && !lockFoe) player.yaw = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  const sprinting = shiftHeld && player.onGround && !player.sneaking &&
    (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  // 潜行偷袭:蹲行状态近身出手 ×3(短匕是行家家伙,×4)
  const sneakMul = player.sneaking ? (player.weapon === 'dagger' ? 4 : 3) : 1;
  // 旋风斩:武艺 5 级起,三连斩的第三剑变成全周横扫
  const whirl = third && skillLv('onehand') >= 5;
  const reach = def.range + (third ? 0.4 : 0) + (sprinting ? 0.4 : 0) +
    (stance === 'thrust' ? 0.9 : stance === 'overhead' ? 0.1 : 0); // 突刺够得远
  if (sprinting) {
    // 冲刺突斩:扑出去的距离按目标远近定(冲到刚好够得着,不冲过头);前方没人就扑满 2.8m
    const tgt = faceNearestFoe(reach + 4.2, true);
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    lunge(fx, fz, tgt ? Math.max(0.5, Math.min(2.8, tgt.d - reach * 0.6)) : 2.8, 0.16);
    spawnDust(player.pos.x - fx, 0.1, player.pos.z - fz, 8, 1.2, 1.4);
    sfx.roll();
  } else if (!player.sneaking) faceNearestFoe(reach); // 攻击磁吸:刀锋咬住目标(潜行例外,别打草惊蛇)
  const dir = (whirl || third || stance !== 'slash') ? 0 : (player.chainN % 2 ? 1 : -1);
  const base = def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0);
  // 伤害:横斩/突刺 1×,下劈 +1(慢起手换来的),三连第三剑 +1,冲刺 +1
  const bonus = (third ? 1 : 0) + (sprinting ? 1 : 0) + (stance === 'overhead' ? 1 : 0);
  const sneaking = player.sneaking;
  scheduleStrike(player.attackT * hitAt, () => {
    // 弹反/满蓄破防后对方踉跄:这一刀砍在它身上就是处决(×5,由横扫按实际结果结算并给浮字)
    if (sneaking) callout(`偷袭 ×${sneakMul}`, 'gold');
    if (third) { sfx.combo(3); cam.shake = Math.max(cam.shake, 0.22); }
    sfx.whoosh(stance === 'overhead' ? 0.72 : stance === 'thrust' ? 1.3 : third ? 0.82 : dir === 1 ? 1 : 1.14);
    if (stance === 'overhead') swingTrailV(reach);
    else swingTrail(reach, whirl ? Math.PI * 2 : stance === 'thrust' ? 0.55 : third ? 2.6 : 2.1, dir);
    meleeSweep(Math.round(meleeBonus(base + bonus) * sneakMul),
      reach,
      whirl ? -1.01 : stance === 'thrust' ? 0.86 : stance === 'overhead' ? 0.5 : 0.35,
      def.knock * (third ? 1.8 : 1) * (sprinting ? 1.3 : 1) *
        (stance === 'overhead' ? 1.5 : stance === 'thrust' ? 0.6 : 1),
      { maxHits: whirl ? 4 : stance === 'thrust' ? 1 : stance === 'overhead' ? 2 : 3,
        guardBreak: stance === 'overhead' ? 'counter' : null,
        execBase: Math.round(meleeBonus(base + bonus)) });
    if (stance === 'overhead') cam.shake = Math.max(cam.shake, 0.14); // 下劈坠着劲
    if (whirl) { cam.shake = Math.max(cam.shake, 0.2); spawnDust(player.pos.x, 0.5, player.pos.z, 10, 2, 1.6); }
  });
  skillXp('onehand', 1);
  if (player.sneaking) skillXp('sneak', 2);
  return true;
}

// 蓄力重击:按住蓄力、松手抡出。伤害随蓄力 2~3.5 倍轻击、大击退;满蓄必破防(开处决窗口)。
// 动作从蓄力的举剑位接着往下劈,判定帧在剑真正落下的那一刻
export function heavyAttack(k = 1) {
  if (player.staggerT > 0 || player.blocking || player.rollT > 0) return; // 盾举着/翻滚中抡不了大的
  // 蓄力技按武器分家:短匕掷飞刀,猎弓开满月,刀剑抡重击
  if (player.weapon === 'dagger') { if (!spendSta(10)) return; throwKnife(); return; }
  if (player.weapon === 'bow') {
    if (k < 0.5) { tryAttack(); return; } // 拉得不够满:就是普通一箭
    if (!spendSta(12)) return;
    chargedShot();
    return;
  }
  if (!spendSta(Math.round((14 + 12 * k) * (WEAPONS[player.weapon].staMul || 1)))) return;
  const def = WEAPONS[player.weapon];
  player._stance = 'overhead'; // 重击=抡满的下劈动作
  player._animFrom = 0.3;      // 从蓄力举剑位接着播,不再先掉下来再抬回去
  player.attackT = def.cd * 1.7;
  player.attackDur = player.attackT;
  sfx.sword();
  const wide = player.weapon === 'greatsword'; // 巨剑:蓄力横扫近乎全周
  faceNearestFoe(def.range + 0.7);
  const mul = 2 + 1.5 * k; // 2~3.5 倍
  const full = k >= 0.99;
  scheduleStrike(player.attackT * 0.32, () => { // 0.32 处 = 动作 0.52:剑正落到身前
    sfx.clank();
    sfx.whoosh(0.7); // 重击破空声最沉
    cam.shake = Math.max(cam.shake, full ? 0.38 : 0.26);
    hitStop(full ? 0.1 : 0.06);
    if (wide) swingTrail(def.range + 0.7, Math.PI * 1.7, 0);
    else swingTrailV(def.range + 0.7, full);
    if (full) spawnDust(player.pos.x + Math.sin(player.yaw) * 1.6, 0.2, player.pos.z + Math.cos(player.yaw) * 1.6, 12, 1.4, 1.8);
    meleeSweep(Math.round(meleeBonus((def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0)) * mul)),
      def.range + 0.7, wide ? -0.6 : -0.1, def.knock * (wide ? 2.3 : 1.8) * (0.8 + 0.4 * k),
      { maxHits: wide ? 4 : 3, heavy: true, guardBreak: full ? 'full' : 'counter',
        execBase: Math.round(meleeBonus(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0))) });
  });
  skillXp('onehand', 1);
  stats.heavies = (stats.heavies || 0) + 1;
}

// 飞刀(短匕蓄力):平直高速,一刀一命换着算
function throwKnife() {
  player.attackT = 0.5;
  player.attackDur = 0.5;
  sfx.arrow();
  sfx.clank();
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0.02, Math.cos(player.yaw)).normalize();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.85, roughness: 0.25 }));
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.2, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dir.multiplyScalar(34), ttl: 2, stuck: false,
    dmg: meleeBonus(2 + (player.swordLv >= 2 ? 1 : 0)), knife: true });
  skillXp('onehand', 1);
}
// 满月强弓(猎弓蓄力):×2 伤害、破空疾飞、可贯穿三人
function chargedShot() {
  player.attackT = WEAPONS.bow.cd * 1.4;
  player.attackDur = WEAPONS.bow.cd * 1.4;
  sfx.arrow();
  cam.shake = Math.max(cam.shake, 0.12);
  const jit = wetSpread(0.5); // 满月拉满弓,受雨影响减半
  const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.03, Math.cos(player.yaw + jit)).normalize();
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  mesh.scale.set(1.4, 1.4, 1.4);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dragonAim(pos, 42) || dir.multiplyScalar(42), ttl: 2.5, stuck: false,
    dmg: arrowBonus((WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0)) * 2), pierce: 2, _hits: [] });
  skillXp('archery', 2);
  toast('🏹 满月!', 1);
}




// 蓄力光与圆盾挂上玩家的手臂(玩家建好后,启动装配调用)
export function initAttack() {
  chargeGlow.position.y = -0.5;
  chargeGlow.visible = false;
  player.parts.armR.add(chargeGlow);
  player.parts.armL.add(playerShield);
}
