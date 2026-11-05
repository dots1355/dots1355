// 王法:通缉星 wanted(0~5)与脱逃计时、犯罪 crime(n, msg)(满星召增援)、clearWanted()、resetEvade()(卫兵看见你)、
// 无法无天(全城卫兵同时被放倒:lawlessT 期间不再有人抓你;downGuard 是卫兵倒地的统一结算)、通缉衰减 updateWanted(dt)。
// 只有本模块改 wanted/evadeT/lawlessT;别的系统读它们或调上面的函数。主循环调 updateWanted、updateLawless。
import { stats, unlockAch } from './achievements.js';
import { remember } from './mind.js';
import { toast } from '../ui/toast.js';
import { sfx } from '../audio.js';
import { player, world } from '../core/state.js';
import { dist2 } from '../entities.js';
import { addGuard, guards, retireEntity } from './actors.js';
import { rand } from '../core/rng.js';
import { startFall } from '../ui/feedback.js';
import { registerKill } from './combat.js';
import { dropCoins } from './pickups.js';

// ================= 通缉系统 =================
export let wanted = 0, evadeT = 0;
export function crime(n, msg) {
  const old = wanted;
  wanted = Math.min(5, wanted + n);
  evadeT = 0;
  stats.crimes = (stats.crimes || 0) + n;
  if (old === 0 && wanted > 0) remember('第一次上了王国的通缉令', 'firstwanted');
  if (msg) toast(msg, 2.5);
  if (wanted > old) {
    sfx.wanted();
    if (lawlessT > 0) return; // 无法无天期:卫兵队被打空了,没有增援可派
    // 增援:从最近的城门出动
    const gate = world.gates.reduce((a, b) =>
      dist2(a.x, a.z, player.pos.x, player.pos.z) < dist2(b.x, b.z, player.pos.x, player.pos.z) ? a : b);
    const extras = guards.filter((g) => g.extra).length;
    const want = Math.min(wanted * 2, 8);
    for (let i = extras; i < want; i++) {
      addGuard(gate.x + (rand() * 6 - 3), gate.z + (rand() * 6 - 3),
        [[gate.x, gate.z]], wanted >= 3, true);
    }
  }
}
export function resetEvade() { evadeT = 0; } // 卫兵看见你了:脱逃计时归零
export function clearWanted() {
  wanted = 0;
  for (let i = guards.length - 1; i >= 0; i--) {
    if (guards[i].extra) retireEntity(guards[i], guards); // 增援卫兵撤走:头盔/佩剑等独占资源一并释放
    else guards[i].state = 'patrol';
  }
}

// ================= 无法无天(卫兵剿灭)=================
// 卫兵倒地统一出口:240 秒起不来;全城放倒=成就+通缉没人执行自动烟消+增援停发
export let lawlessT = 0, lawlessPending = false;
export function downGuard(g) {
  g.downT = 240;
  g.stunT = 0;
  g.windupT = 0;
  g.swingT = 0;
  g.group.rotation.z = 0;
  g.wantedHit = false;
  startFall(g);
  registerKill();
  dropCoins(g.pos, 3);
  if (guards.length && guards.every((x) => x.downT > 0)) lawlessPending = true;
}
export function updateLawless(dt) {
  if (lawlessPending) { // 在横扫判定外处理:clearWanted 会拆增援卫兵,别在遍历中动数组
    lawlessPending = false;
    lawlessT = 240;
    unlockAch('lawless');
    if (wanted > 0) {
      clearWanted();
      toast('🌘 全城卫兵都倒下了——通缉令没人执行,烟消云散。', 4.5);
    } else toast('🌘 全城卫兵都倒下了。这座城暂时没有王法。', 4);
    sfx.fanfare();
    remember('把全城卫兵放倒,过了一阵子无法无天的日子', 'lawless');
  }
  if (lawlessT > 0) lawlessT -= dt;
}
// ---- 通缉衰减:脱离卫兵视线一段时间后星星逐颗熄灭 ----
export function updateWanted(dt) {
  if (wanted <= 0) return;
  evadeT += dt;
  if (evadeT > 13) {
    wanted--;
    evadeT = 6;
    if (wanted === 0) {
      clearWanted();
      sfx.clear();
      toast('通缉解除,卫兵放弃了追捕', 3);
    }
  }
}
