// 盗贼战团(骑砍式野战遭遇):城外游荡时冷不防杀出一支带枭首的战团;攻城时兵分几路扑向城门(避开城墙寻路)。
// 枭首会叫阵单挑(duel):应战则其余人停手旁观,斩将即全军溃散;夺军旗永久加体力上限。
// 对外:warband(状态)、spawnWarband(siege)、WARLORD_TAUNTS;主循环调 updateWarband(dt)。
import { sfx } from '../audio.js';
import { rand } from '../core/rng.js';
import { player, started, world } from '../core/state.js';
import { later } from '../core/timers.js';
import { disposeEntityGroup, dist2 } from '../entities.js';
import { scene } from '../gfx/core.js';
import { openDialog } from '../ui/dialog.js';
import { callout, flashing } from '../ui/feedback.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { addBandit, bandits } from './actors.js';
import { calendar } from './calendar.js';
import { addBarricade } from './magic.js';
import { remember } from './mind.js';
import { navNext } from './nav.js';
import { prologue } from './prologue.js';
import { quest } from './quests.js';

// ================= 盗贼战团(骑砍式野战遭遇)=================
// 每隔几分钟,一支五人战团(枭首+四喽啰)从旷野压向王都:半路截杀=犒赏,放进城=集市遭殃
export const warband = { active: false, members: [], cd: 100 + rand() * 60, lootT: 0, wave: 0 };
// 刷人摊开:每帧至多 2 人(本帧枭首 + 1 名喽啰,其余按游戏时钟逐帧补齐),攻城的十人大队也不会挤在一帧里建模
const SPAWN_PER_FRAME = 2;
export function spawnWarband() {
  warband.active = true;
  warband.members = [];
  warband.lootT = 0;
  warband.pKills = 0;
  warband.gKills = 0;
  // 只从东、南、北面来:西边隔着河(唯一的木桥在 (-95,-34)),从那边刷出会卡在河岸
  const a = -Math.PI * 0.75 + rand() * Math.PI * 1.5;
  const sx = Math.cos(a) * 120, sz = Math.sin(a) * 120;
  // 行军路线:先到离出发点最近的城门,再进城压向广场
  const gate = world.gates.reduce((g0, g1) =>
    (Math.hypot(g0.x - sx, g0.z - sz) <= Math.hypot(g1.x - sx, g1.z - sz) ? g0 : g1));
  const outX = gate.x + Math.sign(gate.x) * 12, outZ = gate.z + Math.sign(gate.z) * 12; // 门外集结点
  warband.path = [[outX, outZ], [gate.x, gate.z], [0, 10]];
  warband.wp = 0;
  warband.ax = sx;
  warband.az = sz;
  warband.bestD = Infinity;
  warband.stallT = 0;
  // 越剿越强:每覆灭一支,下一支多一个喽啰(封顶 8),枭首更硬;每第四波=倾巢攻城
  warband.siege = (warband.wave + 1) % 4 === 0 && warband.wave > 0;
  const grunts = warband.siege ? 9 : Math.min(8, 4 + warband.wave);
  const lead = addBandit(sx, sz, { hp: warband.siege ? 12 : 10 + warband.wave, dmg: 2, speed: 5.4, scale: 1.12 });
  lead.warlord = true;
  lead.duel = true; // 借精英出招库:紫圈重击+二连击
  lead.warband = true;
  lead._ox = 0; lead._oz = 0;
  warband.members.push(lead);
  const offs = []; // 队形:相对锚点的站位(随机数一次掷完,顺序与逐个现刷时一样)
  for (let i = 0; i < grunts; i++) offs.push(rand() * 8 - 4, rand() * 8 - 4);
  const list = warband.members, total = 1 + grunts;
  const spawnSome = (n) => {
    if (warband.members !== list) return; // 战团已散伙或换了一支
    for (let k = 0; k < n && offs.length; k++) {
      const ox = offs.shift(), oz = offs.shift();
      const b = addBandit(warband.ax + ox, warband.az + oz, { hp: 3 });
      b.warband = true;
      b._ox = ox; b._oz = oz;
      list.push(b);
    }
    if (offs.length) later(0, () => spawnSome(SPAWN_PER_FRAME));
  };
  spawnSome(SPAWN_PER_FRAME - 1);
  const compass = Math.abs(sx) > Math.abs(sz) ? (sx > 0 ? '东' : '西') : (sz > 0 ? '南' : '北');
  if (warband.siege) {
    toast(`🚨 攻城警报!!枭首纠集 ${total} 人大队从${compass}面强攻王都!卫兵已列阵迎敌——并肩守城!(冲到枭首面前按 E 可阵前单挑)`, 6);
    sfx.wanted();
    { // 城防:来袭方向支起两座拒马迟滞敌军
      const dl = Math.hypot(sx, sz - 10) || 1;
      const ux = sx / dl, uz = (sz - 10) / dl;
      addBarricade(ux * 24 - uz * 3, 10 + uz * 24 + ux * 3);
      addBarricade(ux * 30 + uz * 3, 10 + uz * 30 - ux * 3);
      toast('🪵 卫兵连夜在城门外支起了拒马!(敌军踩入减速)', 3.5);
    }
  } else {
    toast(`⚠️ 斥候急报:一支盗贼战团(${total} 人)正从${compass}面逼近王都!半路截住他们!` +
      (warband.wave > 0 ? '(为复仇而来,比上次更凶)' : ''), 5);
  }
  sfx.warn();
}
function disbandWarband(escaped) {
  for (const b of warband.members) {
    if (escaped && !b.dead) { b.dead = true; b.group.visible = false; }
    const gone = b;
    later(4, () => { // 尸体躺一会儿再收,别当场蒸发
      scene.remove(gone.group);
      disposeEntityGroup(gone.group);
      flashing.delete(gone);
      const i = bandits.indexOf(gone);
      if (i >= 0) bandits.splice(i, 1);
    });
  }
  warband.members = [];
  warband.active = false;
  warband.cd = 150 + rand() * 120;
}
// 枭首临阵叫骂:走近了他会冲你喊话;复仇之师另有一套狠话,偶尔帮众跟着起哄(吃活体语料)
export const WARLORD_TAUNTS = [
  '这座城的卫兵,还没我营里的火夫能打!',
  '把值钱的交出来,饶你一条腿!',
  '兄弟们——集市是我们的了!',
  '听说你很能打?正好,我的刀锈了。',
  '别躲了,出来领死!',
];
const WARLORD_REVENGE = [
  '上次死的是我兄弟——今天拿你抵命!',
  '记住这面旗,它会插在你坟头!',
  '我们回来了,这次带够了人手!',
];
// 玩家离王都多远(战团只冲王都来:人在 300 米外时不再刷新战团,在途的横幅改报距离)
export function playerFarFromTown() { return Math.hypot(player.pos.x, player.pos.z) > 300; }
export function updateWarband(dt) {
  if (!started || player.dead) return;
  if (!warband.active) {
    // 新手先办完剿匪委托,战团才开始出没;人在远方时不刷(半路截不住、横幅白挂)
    if (!prologue.on && quest.idx >= 3 && !playerFarFromTown()) warband.cd -= dt;
    if (warband.cd <= 0) spawnWarband();
    return;
  }
  // 阵前单挑:枭首一死,全军夺气而溃——兵不血刃
  if (warband.duelOn) {
    const lead = warband.members.find((b) => b.warlord);
    if (!lead || lead.dead) {
      warband.duelOn = false;
      const wasSiege = warband.siege;
      warband.wave++;
      for (const b of warband.members) if (!b.dead) { b._truce = false; b.fleeT = 9; }
      warband.active = false;
      warband.cd = 150 + rand() * 120;
      later(3.5, () => disbandWarband(true)); // 跑出视野再散伙
      toast('⚔️🏆 枭首伏诛!战团夺气,作鸟兽散——兵不血刃!(+100 金币)', 6);
      sfx.fanfare();
      player.coins += 100;
      if (!player.weaponsOwned.includes('warblade')) { // 夺刀:枭首的佩刃归胜者
        player.weaponsOwned.push('warblade');
        sfx.chest();
        toast('⚜️ 你拾起枭首的佩刃——「枭首之刃」入手!(Q 切换:更快更狠的单手刃)', 5);
        remember('从枭首尸体旁拾起了他的佩刃', 'warblade');
      }
      unlockAch('champion');
      if (wasSiege) unlockAch('wallkeeper');
      remember('阵前单挑斩落枭首,吓散整支战团', `duel-${calendar.day}`);
      return;
    }
  }
  const alive = warband.members.filter((b) => !b.dead);
  warband.tauntT = (warband.tauntT || 0) - dt;
  const lead0 = alive.find((b) => b.warlord);
  // 枭首叫骂:头顶冒一句(不进提示队列),30 秒一次
  if (lead0 && warband.tauntT <= 0 &&
      dist2(player.pos.x, player.pos.z, lead0.pos.x, lead0.pos.z) < 625) {
    warband.tauntT = 30;
    const pool = warband.wave > 0 && rand() < 0.6 ? WARLORD_REVENGE : WARLORD_TAUNTS;
    callout(`「${pool[Math.floor(rand() * pool.length)]}」`, 'red', lead0.pos);
  }
  if (!alive.length) { // 全歼:犒赏;残党记仇,下一支更大
    const wasSiege = warband.siege;
    warband.wave++;
    disbandWarband(false);
    if (wasSiege) {
      toast('🏰 攻城被击退!!卫兵们冲你抱拳——王都记住了这一天。(犒赏 +80 金币)', 6);
      player.coins += 80;
      stats.siegesHeld = (stats.siegesHeld || 0) + 1;
      unlockAch('wallkeeper');
      openDialog([
        `📜 守城战报:敌军 ${warband.pKills + warband.gKills} 人授首——你亲斩 ${warband.pKills} 人,卫兵击破 ${warband.gKills} 人。`,
        warband.pKills >= warband.gKills ? '卫兵队长:「今天这城,是你守下来的。」' : '卫兵队长:「弟兄们今天很卖力——你也不赖。」',
      ]);
      remember('与卫兵并肩击退了强攻王都的盗贼大军', `siege-${calendar.day}`);
    } else {
      toast('🎖️ 战团覆灭!你护住了王都的安宁。(悬赏 +25 金币)', 4.5);
      player.coins += 25;
      stats.warbandsWiped = (stats.warbandsWiped || 0) + 1;
      unlockAch('warbreaker');
      remember('在野外截住并全歼了一支盗贼战团', `warband-${calendar.day}`);
    }
    sfx.fanfare();
    return;
  }
  // 行军:队伍的锚点沿航点(门外集结 → 城门 → 广场)稳步推进;每一段都走光柱用的同一张航点图(nav.js)——
  // 从北面来就先绕到城角再到门,不再贴着北墙横移。成员按队形跟着锚点;贴近玩家的成员自动切普通战斗 AI
  const path = warband.path || [[0, 10]];
  const wpT = path[Math.min(warband.wp || 0, path.length - 1)];
  const last = (warband.wp || 0) >= path.length - 1;
  const hop = navNext(warband.ax, warband.az, wpT[0], wpT[1], warband.hop);
  warband.hop = hop;
  const hx = hop ? hop.x : wpT[0], hz = hop ? hop.z : wpT[1]; // 眼下这一步要去的点(航点或路标本身)
  {
    const d = Math.hypot(wpT[0] - warband.ax, wpT[1] - warband.az);
    if (d < (last ? 14 : 3) && !last) warband.wp++;
    else if (d > (last ? 14 : 0.5)) {
      // 锚点别跑出队伍太远:成员落后(被卡住/在打架)时锚点等人
      let lag = 0;
      for (const b of alive) lag = Math.max(lag, Math.hypot(b.pos.x - b.home.x, b.pos.z - b.home.z));
      const sp = lag > 14 ? 0.6 : 4.2;
      const ex = hx - warband.ax, ez = hz - warband.az, el = Math.hypot(ex, ez) || 1;
      const step = Math.min(el, sp * dt);
      warband.ax += (ex / el) * step;
      warband.az += (ez / el) * step;
    }
  }
  // 成员的落脚点 = 锚点 + 队形偏移;隔着城墙(锚点进了城门、人还在墙外)时先去航点图给的下一跳(门外点/门内点),
  // 别顶着门楼塔和城墙挤。每人每 0.5 秒重查一次
  for (const b of alive) {
    const tx = warband.ax + (b._ox || 0), tz = warband.az + (b._oz || 0);
    b._navT = (b._navT || 0) - dt;
    if (b._navT <= 0) { b._navT = 0.5; b._hop = navNext(b.pos.x, b.pos.z, tx, tz, b._hop); }
    b.home.x = b._hop ? b._hop.x : tx;
    b.home.z = b._hop ? b._hop.z : tz;
  }
  // 卡住兜底:60 秒没有朝眼下这一跳(城角/城门/广场)逼近 5 米以上,战团畏缩撤走(横幅一并清掉);
  // 换了一跳就重新计——绕城角时离广场先远后近,不算卡住
  {
    const hopKey = `${Math.round(hx)},${Math.round(hz)}`; // 按"量的是哪个点"认:换了目标就重新计
    if (warband.hopKey !== hopKey) { warband.hopKey = hopKey; warband.bestD = Infinity; warband.stallT = 0; }
    let sum = 0;
    for (const b of alive) sum += Math.hypot(b.pos.x - hx, b.pos.z - hz);
    const avg = sum / alive.length;
    const engaged = alive.some((b) => dist2(b.pos.x, b.pos.z, player.pos.x, player.pos.z) < 900); // 正和你交手:不算卡住
    if (avg < warband.bestD - 5 || engaged) { warband.bestD = Math.min(warband.bestD, avg); warband.stallT = 0; }
    else warband.stallT += dt;
    if (warband.stallT > 60 && !warband.siege) {
      disbandWarband(true);
      toast('🏳️ 盗贼战团迟迟攻不进来,悻悻撤走了。', 4);
      return;
    }
  }
  // 兵临集市:赖满 20 秒没被赶走=劫掠得手,扬长而去
  const lead = alive[0];
  if (Math.hypot(lead.pos.x, lead.pos.z - 10) < 26) {
    warband.lootT += dt;
    if (warband.lootT > 20) {
      disbandWarband(true);
      toast('💥 盗贼战团劫掠了集市,扬长而去!商人们叫苦不迭……', 5);
      remember('没能拦住劫掠集市的盗贼战团', `warloot-${calendar.day}`);
    }
  }
}

