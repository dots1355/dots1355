// 战斗结算:所有对敌伤害走 applyDamage(target, n, { source })——source 决定算不算你的罪、进不进你的连杀
// (player / companion / env / foe);死亡按身份统一结算(slayBandit / killWolf / law.downGuard)。
// 也在这里:近战横扫判定 meleeSweep(判定帧调用,含处决/背刺/破防)、受击打断 flinch、敌人起手预警扇形 telegraphFlash
// (暗区 = 真实判定范围,亮区长满 = 刀落下)与 inFrontArc/turnToward、Tab 锁定(lockFoe/setLockFoe/toggleLock)、
// 士气(残兵溃逃 frightenBandits)、刀光与法弹碎光、战斗音乐。
// 主循环调 updateTrails/updateDanger/updateLock/updateCombatMusic;initCombat() 启动装配调用一次。
import * as THREE from 'three';
import { setCombatMusic, sfx } from '../audio.js';
import { frame } from '../core/frame.js';
import { rand } from '../core/rng.js';
import { colliders, player, started, world } from '../core/state.js';
import { hitStop, slowMo } from '../core/timefx.js';
import { later, simNow } from '../core/timers.js';
import { dist2, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { pooledMat, releaseMat } from '../gfx/pools.js';
import { callout, hideCombo, hitFX, showCombo, showDamage, startFall } from '../ui/feedback.js';
import { dropQuestToasts, toast, toastQuest } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { choreProgress } from './activities.js';
import { bandits, guards, villagers, wolves } from './actors.js';
import { lunge } from './attack.js';
import { todaySpecial } from './calendar.js';
import { cam } from './camera.js';
import { damageDragon, dragonRT } from './dragon.js';
import { EVO } from './evo.js';
import { chickens, deers, killDeer, pokeChicken } from './fauna.js';
import { refreshTrophies } from './home.js';
import { crime, downGuard, wanted } from './law.js';
import { remember } from './mind.js';
import { addPickup, dropCoins } from './pickups.js';
import { recomputeMaxSta } from './player.js';
import { notePracticeHit, prologue, setTutor } from './prologue.js';
import { completeMission, dismissMinions, missions, quest } from './quests.js';
import { warband } from './warband.js';
import { spawnDust } from './weather.js';

// ================= 打击手感核心 =================
// 起手预警:敌人面前铺开一块扇形——暗的是这一刀真正打得到的范围(半径 = 实际判定距离、
// 张角 = 实际判定角),亮的从脚下往外长,长满的那一刻刀落下。站到扇形外(侧闪、绕背、后撤)就挨不着。
// 敌人起手时会慢慢转向你,最后 0.2 秒锁死方向。紫色 = 破盾重击:别格挡,滚!
// (旧实现直接改材质 emissive,GLB 模型材质是共享缓存,会把满街同色 NPC 一起染红,故重做)
export const dangerFX = [];
export const dangerMat = new THREE.MeshBasicMaterial({ color: 0xff3220, transparent: true, opacity: 0.4,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
const _sectorGeos = new Map();
function sectorGeo(arc) {
  const key = arc.toFixed(3);
  let g = _sectorGeos.get(key);
  if (!g) {
    g = new THREE.CircleGeometry(1, 24, -Math.PI / 2 - arc / 2, arc); // 朝 +Z(实体正前)张开
    g.userData.shared = true;
    _sectorGeos.set(key, g);
  }
  return g;
}
// 长条预警(狼扑的冲刺走廊、霜龙俯冲的航线):单位长方形,从原点沿 +Z 铺开(长、宽靠缩放)
const _rectGeo = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0.5);
  g.userData.shared = true;
  return g;
})();
// 敌人出手的判定:range 内、且在它正前方 ±arc/2 以内
const FOE_ARC = 2.1; // ≈120°
export function inFrontArc(e, p, range, arc = FOE_ARC) {
  const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 0.6) return true; // 贴脸了躲不开
  return (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / d > Math.cos(arc / 2);
}
// 走廊判定:从 (x0,z0) 沿 yaw 方向、长 len、半宽 halfW 的长条里(与 telegraphFlash 的 rect 预警同一几何)
export function inCorridor(x0, z0, yaw, len, halfW, p) {
  const dx = p.x - x0, dz = p.z - z0;
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const lat = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw));
  return along >= -halfW * 0.5 && along <= len && lat <= halfW;
}
// 起手锚点:突进型的招从起手那一刻的站位算判定(扇形也画在那里)——敌人往前冲了几步,锚点 = 现位置减去已冲的距离
export function windupAnchor(e) {
  const k = e.lungeDone || 0;
  return { x: e.pos.x - Math.sin(e.yaw) * k, z: e.pos.z - Math.cos(e.yaw) * k };
}
// 转向(角速度上限):起手中的敌人只能慢慢扭过来
export function turnToward(cur, want, maxStep) {
  let d = (want - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
let rearWarnT = -1e9;
// opts.shape:'sector'(默认扇形)| 'rect'(长条走廊:range = 长度,opts.width = 宽,从实体脚下沿朝向铺开);
// opts.anchored:画在起手锚点(windupAnchor)——突进型的招,扇形不跟着人往前冲;
// opts.watch():返回 false 就熄灭(起手被打断/吓跑/作废);opts.quiet:不出声、不喊"身后"(霜龙等自带提示的大招)
export function telegraphFlash(e, dur = 0.45, heavy = false, range = heavy ? 2.7 : 2.3, arc = FOE_ARC, opts = {}) {
  if (!opts.quiet) sfx.warn();
  // 第一次见到紫色破盾重击:弹一张教学卡
  if (heavy && !stats.seenPurple && started && !prologue.on) {
    stats.seenPurple = true;
    setTutor('C', '紫色扇形 = 破盾重击:盾挡不住、也弹不开!', '按 C 翻滚躲开,或者在亮区长满前退出扇形');
    later(4.5, () => { if (!prologue.on) setTutor(null); });
  }
  // 身后起手:镜头看不到的方向有人举刀,头顶先喊一声
  if (!opts.quiet && e.pos && simNow() - rearWarnT > 1200) {
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < range + 1.5 && (dx * -Math.sin(cam.yaw) + dz * -Math.cos(cam.yaw)) / d < -0.25) {
      rearWarnT = simNow();
      callout('⚠ 身后!', 'red');
    }
  }
  const rect = opts.shape === 'rect';
  const geo = rect ? _rectGeo : sectorGeo(arc);
  const grp = new THREE.Group();
  const zone = new THREE.Mesh(geo, pooledMat(dangerMat));
  const fill = new THREE.Mesh(geo, pooledMat(dangerMat));
  for (const m of [zone, fill]) {
    if (!rect) m.rotation.x = -Math.PI / 2;
    if (heavy) m.material.color.setHex(0xb040ff); // 紫=破盾重击:别格挡,滚!
    grp.add(m);
  }
  zone.position.y = 0.1;
  fill.position.y = 0.12;
  if (rect) { zone.scale.set(opts.width, 1, range); fill.scale.set(opts.width, 1, 0.05); }
  else { zone.scale.setScalar(range); fill.scale.setScalar(0.05); }
  const at = opts.anchored ? windupAnchor(e) : e.pos;
  grp.position.set(at.x, 0, at.z);
  grp.rotation.y = e.yaw || 0;
  scene.add(grp);
  dangerFX.push({ grp, zone, fill, e, t: 0, dur, range, arc, sector: true, rect, width: opts.width || 0,
    anchored: !!opts.anchored, watch: opts.watch || null });
}
function removeDanger(f) {
  if (f.sector) {
    scene.remove(f.grp);
    releaseMat(f.zone.material);
    releaseMat(f.fill.material);
  } else {
    scene.remove(f.ring);
    f.ring.geometry.dispose();
    releaseMat(f.ring.material);
  }
}
export function updateDanger(dt) {
  for (let i = dangerFX.length - 1; i >= 0; i--) {
    const f = dangerFX[i];
    f.t += dt;
    const k = f.t / f.dur;
    // 出手完毕/被打断(死亡、倒地、踉跄、起手作废)即熄灭
    if (k >= 1 || f.e.dead || f.e.downT > 0 || (f.e.stunT || 0) > 0 || (f.e.hitStunT || 0) > 0 || (f.watch && !f.watch())) {
      removeDanger(f);
      dangerFX.splice(i, 1);
      continue;
    }
    if (f.sector) {
      const at = f.anchored ? windupAnchor(f.e) : f.e.pos;
      f.grp.position.set(at.x, 0, at.z);
      f.grp.rotation.y = f.e.yaw || 0;
      if (f.rect) f.fill.scale.set(f.width, 1, Math.max(0.05, k) * f.range); // 亮条铺满 = 扑出去
      else f.fill.scale.setScalar(Math.max(0.05, k) * f.range); // 亮区长满 = 刀落下
      f.zone.material.opacity = 0.12 + 0.12 * k;
      f.fill.material.opacity = 0.28 + 0.42 * k;
      continue;
    }
    f.ring.material.opacity = 0.25 + 0.55 * k;    // 越接近出手越亮
  }
}
// 攻击磁吸:出手瞬间转身咬住前方的敌人,差一步自动垫步,人跟着刀走。
// "前方" = 人面朝的方向或镜头正前方(±87°)二者取其一:横移/后撤中出刀,镜头前的敌人照样咬得住;
// 近的、正的优先。没通缉时不吸卫兵(免得砍盗贼时一刀误伤卫兵)。
// noStep=true 时只转向不垫步(冲刺突斩自己算扑出距离)。返回目标 { d, dx, dz } 或 null
export function faceNearestFoe(range, noStep = false) {
  let best = null;
  // 锁定中:刀只认锁定的目标,免得磁吸把人拽向别的敌人
  if (lockFoe && !lockFoe.dead && !(lockFoe.downT > 0)) {
    const dx = lockFoe.pos.x - player.pos.x, dz = lockFoe.pos.z - player.pos.z;
    const d2v = dx * dx + dz * dz;
    if (d2v < (range + 3.5) * (range + 3.5)) best = { d: Math.sqrt(d2v) || 1, dx, dz };
  }
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const cx = -Math.sin(cam.yaw), cz = -Math.cos(cam.yaw);
  const r2 = (range + 2.4) * (range + 2.4);
  let bs = Infinity;
  if (!best) for (const list of [bandits, wolves, guards]) {
    if (list === guards && wanted === 0) continue;
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d2v = dx * dx + dz * dz;
      if (d2v > r2) continue;
      const d = Math.sqrt(d2v) || 1;
      const ca = Math.max((dx * fx + dz * fz) / d, (dx * cx + dz * cz) / d);
      if (ca < 0.05) continue; // 只吸前方 ~±87°
      const score = d + (1 - ca) * 2.5;
      if (score < bs) { bs = score; best = { d, dx, dz }; }
    }
  }
  if (!best) return null;
  player.yaw = Math.atan2(best.dx, best.dz); // 刀锋咬住目标
  if (noStep) return best;
  const gap = best.d - (range - 0.5);
  const step = gap > 0 ? Math.min(gap, 1.5) : 0.3; // 够不着就垫步;够得着也向前压半步
  if (!(player.lungeT > 0)) lunge(best.dx, best.dz, step, 0.1); // 垫步在 0.1 秒内滑过去,不瞬移
  return best;
}
// ================= 目标锁定(Tab)=================
// 骑砍式对峙:镜头咬住敌人环绕,人始终面向目标侧移;死亡/倒地/拉开距离自动解除
export let lockFoe = null;
// 锁定目标的唯一写入口(拆出去的系统用它,不直接改 lockFoe)
export function setLockFoe(e) { lockFoe = e; if (!e) lockMark.visible = false; }
export const lockMark = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 4),
  new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.9, depthWrite: false }));
export function toggleLock() {
  if (!started || player.dead) return;
  if (lockFoe) { lockFoe = null; lockMark.visible = false; sfx.roll(); return; }
  let best = null, bd = 20 * 20;
  for (const list of [bandits, wolves, guards]) {
    if (list === guards && wanted === 0) continue; // 没通缉就别锁卫兵
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const d2v = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      if (d2v < bd) { bd = d2v; best = e; }
    }
  }
  if (best) { lockFoe = best; sfx.equip(); }
  else toast('附近没有可锁定的目标', 1.2);
}
// 锁定目标血条(名字 + 血量,顶部居中)
const lockhpEl = document.getElementById('lockhp'),
  lockhpNameEl = document.getElementById('lockhp-name'),
  lockhpFillEl = document.getElementById('lockhp-fill');
export function foeName(e) {
  if (e.warlord) return '⚔️ 战团枭首';
  if (e.boss) return '🪓 血斧巴罗克';
  if (e.bountyHead) return '💀 悬赏要犯';
  if (e.duel) return '🗡️ 决斗者';
  if (wolves.includes(e)) return '🐺 恶狼';
  if (guards.includes(e)) return '🛡️ 王国卫兵';
  return '🔪 盗贼';
}
export function updateLock(dt) {
  if (!lockFoe) { lockhpEl.style.display = 'none'; return; }
  if (lockFoe.dead || lockFoe.downT > 0 || player.dead ||
      dist2(player.pos.x, player.pos.z, lockFoe.pos.x, lockFoe.pos.z) > 26 * 26 ||
      (!bandits.includes(lockFoe) && !wolves.includes(lockFoe) && !guards.includes(lockFoe))) {
    lockFoe = null;
    lockMark.visible = false;
    lockhpEl.style.display = 'none';
    return;
  }
  lockMark.visible = true;
  const h = lockFoe.parts && lockFoe.parts.head ? 2.45 : 1.5; // 人形头顶/狼背上方
  lockMark.position.set(lockFoe.pos.x,
    (lockFoe.pos.y || 0) + h + Math.sin(frame.now * 0.006) * 0.07, lockFoe.pos.z);
  lockMark.rotation.y += dt * 3;
  lockFoe._maxHp = Math.max(lockFoe._maxHp || 0, lockFoe.hp); // 见过的最高血量当上限
  lockhpEl.style.display = 'block';
  lockhpNameEl.textContent = foeName(lockFoe);
  lockhpFillEl.style.width = `${Math.max(0, Math.min(1, lockFoe.hp / lockFoe._maxHp)) * 100}%`;
}

// ================= 战斗音乐:遇敌切紧张曲,脱战 4 秒回吟游调 =================
export let combatCalmT = 0;
export function updateCombatMusic(dt) {
  let hot = false;
  for (const list of [bandits, wolves]) {
    for (const e of list) {
      if (e.dead || e.downT > 0 || e.fleeT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 14 * 14) { hot = true; break; }
    }
    if (hot) break;
  }
  if (!hot && wanted > 0) { // 被通缉追捕也算交战
    for (const g of guards) {
      if (g.downT > 0 || g.state !== 'chase') continue;
      if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16 * 16) { hot = true; break; }
    }
  }
  if (dragonRT.on && dragonRT.hp > 0 &&
      dist2(player.pos.x, player.pos.z, dragonRT.ent.group.position.x, dragonRT.ent.group.position.z) < 3600) hot = true;
  combatCalmT = hot ? 4 : Math.max(0, combatCalmT - dt);
  setCombatMusic(combatCalmT > 0, (warband.active && warband.siege) || dragonRT.on); // 屠龙也配战鼓
}
// ================= 连杀(玩法规则;连杀条的显示在 ui/feedback.js) =================
// 进你连杀的击杀(伙伴/环境击杀不算)每次续 4 秒:二连起计数,三连浮字,五连"势不可挡"回满体力,
// 八连"一骑当千"白热(出刀更快、剑光化金);窗口过了就断。全部按游戏时钟结算(updateCombo 在主循环里)
export const killStreak = { n: 0, t: 0 };
export function registerKill() {
  stats.kills = (stats.kills || 0) + 1;
  if (stats.kills >= 100) unlockAch('slayer');
  killStreak.t = 4;
  killStreak.n++;
  sfx.kill();
  hitStop(0.09);
  const n = killStreak.n;
  if (n >= 2) { sfx.combo(Math.min(n, 8)); showCombo(n); }
  // 连杀里程碑:越杀越勇
  if (n === 3) callout('三连杀!', 'gold');
  else if (n === 5) {
    callout('势不可挡!体力回满', 'gold');
    player.sta = player.maxSta;
    sfx.fanfare();
  } else if (n === 8) {
    callout('一骑当千!剑光化金', 'gold');
    unlockAch('rampage');
    sfx.fanfare();
  }
}
// 白热:八连杀燃起的状态,连杀窗口内攻速 +28%、剑光化金,断了连杀就熄
export const whiteHot = () => killStreak.n >= 8 && killStreak.t > 0;
export function updateCombo(dt) {
  if (killStreak.t > 0) {
    killStreak.t -= dt;
    if (killStreak.t <= 0) { killStreak.n = 0; hideCombo(); }
  }
}
// ================= 士气(骑砍式):血腥震慑,残兵溃逃 =================
// 6 秒内(游戏时钟)连斩三名盗贼:附近的盗贼胆寒溃逃
const morale = { n: 0, at: -1e9 };
export function frightenBandits(radius = 14, except = null) {
  let fled = 0;
  for (const o of bandits) {
    if (o.dead || o.downT > 0 || o.boss || o === except) continue; // 头目不吃这套;挨处决的那个自己正晃着,轮不到它跑
    if (dist2(player.pos.x, player.pos.z, o.pos.x, o.pos.z) > radius * radius) continue;
    if (o.hp <= Math.max(2, (o.maxHp || 5) * 0.35) || rand() < 0.45) { // 残血必逃,满血看胆量
      o.fleeT = Math.max(o.fleeT || 0, 5 + rand() * 3);
      // 吓跑了就收刀:举到一半的这一刀作废(扇形随之熄灭),免得逃完回头凭空补一刀
      o.windupT = 0; o.comboN = 0; o.heavyAtk = false;
      fled++;
    }
  }
  return fled;
}
export function banditSlain(b) {
  // 枭首之刃嗜血:持刃击杀回 4 体力——刀认得血的味道
  if (player.weapon === 'warblade') player.sta = Math.min(player.maxSta, player.sta + 4);
  // 阵斩枭首:夺军旗——永久体力上限 +5(封顶 180),外加一把赏金
  if (b && b.warlord) {
    stats.banners = (stats.banners || 0) + 1;
    recomputeMaxSta();
    player.sta = player.maxSta;
    dropCoins(b.pos, 10);
    sfx.chest();
    toast(`🚩 夺得战团军旗!(第 ${stats.banners} 面:体力上限 +5 → ${player.maxSta},当场回满)`, 4.5);
    remember(`阵斩战团枭首,夺下第 ${stats.banners} 面军旗`, `banner-${stats.banners}`);
    refreshTrophies(); // 军旗直接挂上家里的战利品墙
  }
  const now = simNow();
  morale.n = now - morale.at < 6000 ? morale.n + 1 : 1;
  morale.at = now;
  if (morale.n >= 3) {
    morale.n = 0;
    if (frightenBandits() > 0) {
      callout('连杀震慑:附近的盗贼胆寒溃逃!', 'gold');
      sfx.warn();
    }
  }
}
// ================= 统一伤害结算 =================
// 所有"对敌人造成伤害"都走这里:扣血 → 受击表现 → 伤卫兵即犯罪(仅玩家来源)→ 按身份走死亡结算。
// source: 'player'(默认)| 'companion'(佣兵/白狼/卫兵援手,不进玩家连杀)| 'env'(龙息等,不算你的罪也不进连杀)| 'foe'(敌人互殴)
// opts: knock(击退/受击闪白,不给则无)、crit(数字放大)、silent(不出数字)、crime/crimeMsg(伤卫兵的罪名)、credit/coins(伙伴击杀)
function foeKind(e) {
  return wolves.includes(e) ? 'wolf' : guards.includes(e) ? 'guard' : bandits.includes(e) ? 'bandit' : 'other';
}
export function applyDamage(e, n, opts = {}) {
  if (!e || e.dead || e.downT > 0) return false;
  const src = opts.source || 'player';
  e.hp -= n;
  if (opts.knock !== undefined) hitFX(e, opts.knock);
  if (!opts.silent) showDamage(e.pos, n, opts.crit ?? n >= 3);
  const kind = foeKind(e);
  if (kind === 'guard' && src === 'player' && !e.wantedHit) {
    e.wantedHit = true;
    crime(opts.crime || 1, opts.crimeMsg || '你袭击了卫兵!');
  }
  if (e.hp > 0) return false;
  if (kind === 'wolf') killWolf(e, src === 'env' || src === 'foe' ? { env: true } : {});
  else if (kind === 'bandit') {
    slayBandit(e, src === 'player' ? {} : { companion: true, credit: opts.credit, coins: opts.coins ?? (src === 'env' ? 2 : undefined) });
  } else if (kind === 'guard') downGuard(e);
  return true;
}
// 特殊身份的盗贼(剧情首领/押解/悬赏/劫匪/竞技/单挑/囚犯/事件):不算"普通盗贼",各处判定共用这一张表
const SPECIAL_BANDIT = ['boss', 'escort', 'bountyHead', 'robber', 'arena', 'duel', 'convict', 'eventFoe'];
export function specialBandit(b) {
  for (const k of SPECIAL_BANDIT) if (b[k]) return true;
  return false;
}
// 盗贼死亡统一出口:任何来源(弓/剑/践踏/法术/爆炸/战吼/佣兵/白狼)都走全套结算
export function slayBandit(b, opts = {}) {
  if (b.dead) return;
  b.dead = true;
  startFall(b);
  if (!opts.companion) registerKill(); // 伙伴击杀不进玩家连杀
  choreProgress('bandits');
  banditSlain(b); // 军旗/士气结算
  if (b.boss) dismissMinions();
  if (b.warband) warband[opts.companion ? 'gKills' : 'pKills'] = (warband[opts.companion ? 'gKills' : 'pKills'] || 0) + 1;
  dropCoins(b.pos, b.boss ? 20 : opts.coins ?? 5);
  if (quest.active && missions[quest.idx].type === 'bandits' && (b.campFoe || (!specialBandit(b) && !b.ambient))) {
    quest.progress++;
    const goal = missions[quest.idx].goal;
    dropQuestToasts();
    if (quest.progress < goal) toastQuest(`${b.captain ? '营地头目倒下了!' : '击败盗贼'} ${quest.progress}/${goal}${opts.credit ? `(${opts.credit}!)` : ''}`, 2);
    if (quest.progress >= goal) completeMission();
  }
}
export let wolfKills = 0;
export function killWolf(w, opts = {}) {
  w.dead = true;
  w.respawnT = (w.arena || w._prol) ? 99999 : (todaySpecial()?.key === 'wolfmoon' ? 22 : 45);
  startFall(w);
  if (!opts.env) registerKill(); // 环境击杀(龙息等)不进玩家连杀
  later(2.5, () => { if (w.dead) w.group.visible = false; });
  dropCoins(w.pos, 2);
  wolfKills++;
  EVO.wolfPressure++; // 猎杀压力:选择的原料
  choreProgress('wolves');
  // 竞技场里的狼不算狼灾任务(和盗贼任务的排除规则对齐)
  if (!w.arena && quest.active && missions[quest.idx].type === 'wolves') {
    quest.progress++;
    toast(`猎杀恶狼 ${quest.progress}/${missions[quest.idx].goal}`, 2);
    if (quest.progress >= missions[quest.idx].goal) completeMission();
  }
}
// 剑光拖尾:每次挥砍横扫出一道弧光,0.16 秒燃尽
export const trailFX = [];
export const trailMat = new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.5,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
export function swingTrail(range, arc = 2.1, dir = 1) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh( // 弧向 18 段、径向 1 段:一道弯月形的刀光(旧参数反了,画成一片三角)
    new THREE.RingGeometry(Math.max(0.5, range * 0.45), range, 18, 1, Math.PI / 2 - arc / 2, arc),
    pooledMat(trailMat));
  if (whiteHot()) ring.material.color.setHex(0xffd75e); // 白热连杀:剑光化金
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.position.set(player.pos.x, 1.05, player.pos.z);
  g.rotation.y = player.yaw;
  // 连斩分段:一段左挥(下压斜面)、二段右挥(镜像反斜)、三段平扫压轴
  if (dir === 1) g.rotation.x = 0.28;
  else if (dir === -1) { g.scale.x = -1; g.rotation.x = -0.28; }
  scene.add(g);
  trailFX.push({ g, ring, t: 0, mx: g.scale.x });
}
// 竖劈刀光:下劈/重击是从头顶劈到身前的竖弧(横向的弯月对不上动作)
export function swingTrailV(range, big = false) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.4, range * 0.4), range, 16, 1, -0.55, 2.2),
    pooledMat(trailMat));
  if (whiteHot() || big) ring.material.color.setHex(0xffd75e);
  ring.rotation.y = -Math.PI / 2; // 弧面立起来,沿身前竖着
  g.add(ring);
  g.position.set(player.pos.x, 0.9, player.pos.z);
  g.rotation.y = player.yaw;
  scene.add(g);
  trailFX.push({ g, ring, t: 0, mx: 1 });
}
// 魔法命中碎光:一团加色蓝光炸开(复用拖尾的生灭管线)
export const magBurstGeo = new THREE.SphereGeometry(0.2, 8, 6);
export const magBurstMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.8,
  blending: THREE.AdditiveBlending, depthWrite: false });
export function magBurst(x, y, z) {
  const m = new THREE.Mesh(magBurstGeo, pooledMat(magBurstMat));
  m.position.set(x, y, z);
  scene.add(m);
  trailFX.push({ g: m, ring: m, t: -0.08, mx: 1 }); // 负起点=多亮一拍
}
export function updateTrails(dt) {
  for (let i = trailFX.length - 1; i >= 0; i--) {
    const f = trailFX[i];
    f.t += dt;
    const k = f.t / 0.16;
    if (k >= 1) {
      scene.remove(f.g);
      if (!f.ring.geometry.userData.shared) f.ring.geometry.dispose();
      releaseMat(f.ring.material);
      trailFX.splice(i, 1);
      continue;
    }
    f.ring.material.opacity = (f.ring.material.userData.poolBase === magBurstMat ? 0.8 : 0.5) * (1 - k);
    f.g.scale.setScalar(1 + k * 0.5);
    f.g.scale.x *= f.mx || 1; // 保住镜像方向
  }
}

// 精英:头目/悬赏/决斗/战团枭首/营地头目——只吃重击的打断,处决伤害封顶(见 EXEC_ELITE_CAP),出招库更全
export const isElite = (e) => !!(e.boss || e.bountyHead || e.duel || e.warlord || e.elite);
// 起手后段霸体:起手进入最后 40% 时轻击打不断(刀已经抡起来了),只有重击/下劈截击能拦
export const windupArmored = (e) => e.windupT > 0 && e.windupT <= (e.windupDur || 0.62) * 0.4;
// 受击硬直:打断对方的起手。杂兵挨一刀就收招;被打断后有一段霸体(连砍砍不断,不能无限控);
// 精英只吃重击的打断;起手后段霸体时轻击也打不断
export function flinch(e, heavy) {
  if (e.dead || e.downT > 0) return;
  if (!heavy && (isElite(e) || (e.armorT || 0) > 0 || windupArmored(e))) return;
  e.hitStunT = heavy ? 0.6 : 0.3;
  e.armorT = heavy ? 0.9 : 1.3;
  if (e.windupT > 0 || e.biteT > 0 || e.braceT > 0) callout('打断!', 'blue', e.pos);
  e.windupT = 0;
  e.biteT = 0;
  e.braceT = 0; // 举刀等着扎马的架势也被砍散
  e.comboN = 0;
  e.heavyAtk = false;
}
// 背刺:从对方背后下手 ×1.5(敌人正面对着你时没有)
function backstabMul(e) {
  if (e.yaw === undefined) return 1;
  const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  return (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / d < -0.35 ? 1.5 : 1;
}
// 符文立石:刀锋判定帧劈中身前的立石(与砍人同一刀长与扇面),符文碎光化作金币
function strikeRuneStones(range, arcDot) {
  const b = world.runeStrike(player.pos.x, player.pos.z, player.yaw, range, arcDot);
  if (!b) return;
  magBurst(b.x, b.y, b.z);
  sfx.block();
  cam.shake = Math.max(cam.shake, 0.15);
  for (let i = 0; i < 5; i++) {
    const a = rand() * 6.28;
    addPickup('coin', b.x + Math.cos(a) * 1.4, b.z + Math.sin(a) * 1.4, 30);
  }
  callout('符文碎光 +5 金币', 'blue', { x: b.x, y: b.y + 1.2, z: b.z });
}
// ================= 受击目标注册表 =================
// 近战横扫(meleeSweep)、箭/法弹/飞刀(projectiles)、爆炸(magic.explodeAt)、踩踏(player.checkStomp)都从这一张表取候选:
// 新加一种目标只登记一处,不会再有"某种伤害源打不到某种目标"的漏网(曾经剑砍不到村民和鹿)。
// 每类:名单 list()、敌对 hostile(近战按敌对优先占刀数、挨打会被打断起手)、能否挨打 alive(e)、箭/踩踏的判定尺寸,
// 以及四种伤害源各自的结算 melee(e, h) / arrow(e, a, dmg) / blast(e, dmg, src) / stomp(e)(没有 = 这种伤害源够不着它)。
// 罪责、连杀、任务进度、掉落仍由 applyDamage / killDeer / pokeChicken / hurtVillager 统一结算。
const STOMP_STUN = 1.5; // 踩头:晕一下(不开处决)
const aliveFoe = (e) => !e.dead && !(e.downT > 0);
function stunFoe(e) { e.stunT = Math.max(e.stunT || 0, STOMP_STUN); e.stunSrc = 'other'; e.windupT = 0; e.braceT = 0; }
function hurtVillager(v, downT, crimeN, msg) {
  v.downT = downT;
  v.group.rotation.x = -Math.PI / 2;
  sfx.hit();
  crime(crimeN, msg);
}
export const TARGET_KINDS = [
  { kind: 'guard', hostile: true, list: () => guards, alive: aliveFoe,
    melee(g, h) { const n = h.execDmg(g); sfx.hitMetal(); if (!applyDamage(g, n, { knock: h.knock })) g.state = 'chase'; },
    arrow(g, a, dmg) { sfx.hit(); if (!applyDamage(g, dmg, { knock: 0.4, crit: false, crimeMsg: '你放箭射击卫兵!' })) g.state = 'chase'; },
    blast(g, dmg, src) { // 龙息之类的环境爆炸不牵连卫兵,也不会因此通缉你
      if (src === 'player') applyDamage(g, dmg, { knock: 1.2, crit: true, crime: 2, crimeMsg: '你的火球炸到了卫兵!' });
    },
    stomp(g) { stunFoe(g); callout('踩晕了卫兵!', 'red', g.pos); crime(1); } },
  { kind: 'bandit', hostile: true, list: () => bandits, alive: aliveFoe,
    melee: (b, h) => banditMelee(b, h),
    arrow(b, a, dmg) {
      // 战术演化:被射多了的匪帮学会侧身闪箭(贴脸射/法术/飞刀不受影响)
      if (!a.mag && !a.knife && rand() < EVO.tactics.dodge * 0.45) { showDamage(b.pos, 0); hitFX(b, 0.15); return; }
      sfx.hit();
      if (applyDamage(b, dmg, { knock: 0.4, crit: false })) EVO.kills.arrow++;
      else flinch(b, false); // 箭/法弹也能打断起手
    },
    blast(b, dmg, src) { applyDamage(b, dmg, { source: src === 'player' ? 'player' : 'env', knock: 1.2, crit: true }); },
    stomp(b) { stunFoe(b); callout('踩晕了!', 'gold', b.pos); } },
  { kind: 'wolf', hostile: true, list: () => wolves, alive: aliveFoe,
    melee(w, h) { const n = h.execDmg(w); sfx.hitFlesh(); applyDamage(w, n, { knock: h.knock }); }, // 砍进皮肉闷声
    arrow(w, a, dmg) { sfx.hit(); if (!applyDamage(w, dmg, { knock: 0.4, crit: false })) flinch(w, false); },
    blast(w, dmg, src) { applyDamage(w, dmg, { source: src === 'player' ? 'player' : 'env', knock: 1.2, crit: true }); },
    stomp(w) { stunFoe(w); callout('踩晕了!', 'gold', w.pos); } },
  { kind: 'deer', hostile: false, list: () => deers, alive: (d) => !d.dead,
    melee(d) { sfx.hitFlesh(); killDeer(d); },
    arrow(d) { sfx.hit(); killDeer(d); },
    blast(d, dmg, src) { if (src === 'player') killDeer(d); } }, // 鹿是大个子,踩不上去(没有 stomp)
  // 鸡不会死,但它们会记住你
  { kind: 'chicken', hostile: false, list: () => chickens, arrowR2: 0.5, arrowY: [-1, 1], stompR2: 1.1,
    alive: (c) => c !== player.carrying && c.state !== 'thrown',
    melee: (c) => pokeChicken(c), arrow: (c) => pokeChicken(c),
    blast(c, dmg, src) { if (src === 'player') pokeChicken(c); },
    stomp: (c) => pokeChicken(c) },
  { kind: 'villager', hostile: false, list: () => villagers, alive: (v) => !(v.downT > 0) && !v.sleeping,
    melee(v) { hurtVillager(v, 10, 2, '你袭击了村民!这是重罪!'); },
    arrow(v) { hurtVillager(v, 10, 2, '你射伤了村民!这是重罪!'); },
    blast(v, dmg, src) { if (src === 'player') hurtVillager(v, 10, 2, '你的火球炸伤了村民!这是重罪!'); },
    stomp(v) { hurtVillager(v, 4, 1, '你一脚踩翻了村民!'); } },
];
// 刀砍在盗贼身上:学来的格挡、处决、破防/截击都在这里
function banditMelee(b, h) {
  const winding = b.windupT > 0; // 正在起手:下劈/重击砸上去能破架
  const guarding = h.dmg > 0 && !(b.stunT > 0) && rand() < EVO.tactics.block * 0.5; // 战术演化:学会了举盾
  // 举盾挡下:轻刀被格开;破架的招(下劈/重击)照样砸开
  if (guarding && !h.gb && h.dmg < 3) {
    sfx.clank();
    hitFX(b, h.knock * 0.3);
    showDamage(b.pos, 0);
    callout('被格挡', 'dim', b.pos);
    return;
  }
  const n = h.execDmg(b);
  sfx.hit();
  if (b.boss && b.hp - n <= 0) toast('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 5);
  if (applyDamage(b, n, { knock: b.boss ? h.knock * 0.4 : h.knock })) { // 统一结算(连杀/村务/军旗/任务/掉落)
    EVO.kills.melee++;
    // 近战击杀的犒赏:血少时必掉一颗心,平时两成——换血不能白换
    if (player.hp <= player.maxHp * 0.3 || rand() < 0.2) addPickup('heart', b.pos.x, b.pos.z + 1, 30);
    return;
  }
  if (b.stunT > 0 || b === h.execTarget) return; // 刚被处决的这一刀不再顺手破防
  if (h.gb === 'full') { // 满蓄重击:盾开人晃,处决窗口大开
    b.stunT = 1.2;
    b.stunSrc = 'break';
    sfx.clank();
    callout('破防!再砍=处决', 'gold', b.pos);
  } else if (h.gb === 'counter' && (winding || guarding)) { // 下劈截在起手上/砸在盾上:破架,留一个空档
    b.stunT = 0.6;
    b.stunSrc = 'counter';
    sfx.clank();
    callout(winding ? '截击!' : '破架!', 'gold', b.pos);
  }
}
// 处决封顶:精英/首领一次处决最多掉最大血量的 35%——Boss 战至少要两三次弹反或破防
const EXEC_ELITE_CAP = 0.35;
// 近战横扫判定:普通挥击与蓄力重击共用(dmg/范围/角度/击退可调),在出招的判定帧调用。
// opts.rearDmg:身后半圈的目标只吃这么多(跳劈的冲击波:正面吃满、背后溅到);opts.kind:'light'|'heavy'(序章练刀计数);
// opts.stun:撞个踉跄(盾击:不开处决窗口),先于结算挂上
export function meleeSweep(dmg, range, arcDot, knock, opts = {}) {
  if (dmg > 0) strikeRuneStones(range, arcDot);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const maxHits = opts.maxHits ?? 3;
  const heavy = !!opts.heavy;
  const execBase = opts.execBase || dmg; // 处决基准:出招方带入的无乘区伤害(不含偷袭乘区)
  const rearOf = (e) => opts.rearDmg !== undefined &&
    ((e.pos.x - player.pos.x) * fx + (e.pos.z - player.pos.z) * fz) < 0;
  // 这一刀的结算上下文。gb:'full' 满蓄重击必破防(可处决);'counter' 下劈/半蓄砸在起手中或举盾的人身上才破架。
  // 处决:只对"弹反"或"满蓄重击破防"造成的踉跄出手 = ×5 终结,一刀只处决一人;处决用掉这次踉跄
  // (一次弹反只换一次处决)。盾击/冰霜/战吼/下劈破架的踉跄只是空档,不开处决
  const h = { dmg, knock, gb: opts.guardBreak || null, execTarget: null,
    execDmg(e) {
      if (dmg > 0 && !h.execTarget && e.stunT > 0.3 && (e.stunSrc === 'parry' || e.stunSrc === 'break')) {
        h.execTarget = e;
        e.stunT = 0; // 踉跄就此用掉:再砍就是普通的一刀
        e.stunSrc = '';
        // 处决按基础伤害 ×5 结算(偷袭 ×3 不叠上去);精英/首领封顶最大血量的 35%
        const n = execBase * 5;
        return isElite(e) ? Math.min(n, Math.max(1, Math.round((e.maxHp || e.hp) * EXEC_ELITE_CAP))) : n;
      }
      const base = rearOf(e) ? Math.min(dmg, opts.rearDmg) : dmg;
      const bs = base > 0 ? backstabMul(e) : 1;
      if (bs > 1) callout('背刺 ×1.5', 'gold', e.pos);
      return Math.round(base * bs);
    } };
  // 候选:注册表里刀锋范围内的目标——敌对的优先占刀数(砍盗贼时旁边的鸡、村民不抢刀),同类按远近,最多 maxHits 个;
  // 不伤人的推挤(盾击)只对敌人
  const cand = [];
  for (const T of TARGET_KINDS) {
    if (!T.hostile && dmg <= 0) continue;
    for (const e of T.list()) {
      if (!T.alive(e)) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d || 1) > arcDot) cand.push({ e, T, d });
    }
  }
  cand.sort((a, b) => (b.T.hostile - a.T.hostile) || (a.d - b.d));
  let foesHit = 0;
  for (const { e, T } of cand.slice(0, maxHits)) {
    if (!T.alive(e)) continue;
    if (opts.stun && T.hostile && e.stunT !== undefined) { e.stunT = Math.max(e.stunT || 0, opts.stun); e.stunSrc = 'bash'; }
    if (T.hostile && e !== h.execTarget) foesHit++;
    T.melee(e, h);
    if (e === h.execTarget && !e.dead && !(e.downT > 0)) {
      // 处决后没死:晃一下缓过神(0.5 秒),之后一段霸体——别想趁势轻刀连控
      e.hitStunT = Math.max(e.hitStunT || 0, 0.5);
      e.armorT = Math.max(e.armorT || 0, 1.2);
      e.windupT = 0;
      continue;
    }
    if (T.hostile && !e.dead && !(e.downT > 0) && dmg > 0) flinch(e, heavy);
  }
  const execTarget = h.execTarget, executed = !!execTarget;
  if (foesHit && dmg > 0) hitStop(0.06); // 刀砍实了:顿一帧半(受击闪白那 35ms 太短,手上没分量)
  if (foesHit && dmg > 0 && !executed && opts.kind) notePracticeHit(opts.kind); // 序章的出刀练习按"打中"计
  if (executed) { // 处决演出:时停 + 震屏 + 镜头急推;目击者胆寒;按武器各有终结技
    hitStop(0.22);
    cam.shake = Math.max(cam.shake, 0.45);
    cam.fovKick = 0.4;
    slowMo(0.55);
    if (execTarget) {
      if (player.weapon === 'dagger') {
        // 影袭:黑雾一闪,人已在目标身后收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
        const dx = execTarget.pos.x - player.pos.x, dz = execTarget.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        player.pos.x = execTarget.pos.x + (dx / d) * 1.1;
        player.pos.z = execTarget.pos.z + (dz / d) * 1.1;
        resolveCollisions(player.pos, 0.45, colliders);
        player.yaw = Math.atan2(-dx, -dz); // 转身面向尸体,收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
      } else if (player.weapon === 'greatsword') {
        // 断头台:巨剑砸出冲击环,大地都跟着响
        cam.shake = Math.max(cam.shake, 0.65);
        spawnDust(execTarget.pos.x, 0.2, execTarget.pos.z, 14, 2.2, 2.2);
        swingTrail(3.2, Math.PI * 2);
        sfx.stomp();
      } else {
        // 铁剑:十字剑光收势
        swingTrail(2.7, 2.3, 1);
        swingTrail(2.7, 2.3, -1);
      }
    }
    callout('处决 ×5', 'gold', execTarget ? execTarget.pos : null);
    if (frightenBandits(11, execTarget) > 0) callout('目睹处决,盗贼胆寒溃逃!', 'dim');
    sfx.kill();
    stats.executions = (stats.executions || 0) + 1;
    if (stats.executions >= 10) unlockAch('executioner');
  }
  // 落地喘息的霜龙:近战窗口
  if (dragonRT.on && dragonRT.hp > 0 && dragonRT.phase === 'land' && dmg > 0) {
    const gp = dragonRT.ent.group.position;
    const ddx = gp.x - player.pos.x, ddz = gp.z - player.pos.z;
    const dd = Math.hypot(ddx, ddz);
    if (dd < range + 2.4 && (ddx * fx + ddz * fz) / (dd || 1) > arcDot) {
      damageDragon(Math.max(1, Math.round(dmg * 0.6)), null); // 龙鳞厚:近战打六折
      sfx.hitMetal();
      hitStop(0.05);
    }
  }
}

// 锁定标记(头顶的倒三角)进场景;法弹碎光几何标为共享(实体退场时不释放)。启动装配调用
export function initCombat() {
  lockMark.rotation.x = Math.PI; // 尖朝下悬在头顶
  lockMark.visible = false;
  lockMark.frustumCulled = false;
  scene.add(lockMark);
  magBurstGeo.userData.shared = true;
}
