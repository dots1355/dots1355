// 黑石的报复(守城胜利的后续剧情链):守住南门 → 记仇(stage 1)→ 次日恐吓信(读信后 stage 2,伏击上膛)
// → 出城 130 步遭独眼刻刀维克伏击 → 斩杀两清(stage 3,挂上黑石断刀徽记)。
// 状态在 vendetta{stage, boss}(stage 随存档;模块加载时即初始化,读档可直接写)。
// 对外:vendettaLetter()(换日时塞信)、vendettaRead()(读信)、updateVendetta()(主循环)。攻城事件本身在导演事件表里。
import { sfx } from '../audio.js';
import { saveGame } from '../core/save.js';
import { player } from '../core/state.js';
import { dist2 } from '../entities.js';
import { toast } from '../ui/toast.js';
import { unlockAch } from './achievements.js';
import { addBandit } from './actors.js';
import { calendar } from './calendar.js';
import { cam } from './camera.js';
import { telegraphFlash } from './combat.js';
import { seedLegend } from './evo.js';
import { refreshTrophies } from './home.js';
import { remember, workspace } from './mind.js';
import { dropCoins } from './pickups.js';

// ================= 黑石的报复(守城胜利的后续剧情链) =================
export const vendetta = { stage: 0, boss: null }; // 黑石的报复:0 无仇 → 1 记仇 → 2 伏击上膛 → 3 两清
// 守住南门(stage 1)→ 次日收到恐吓信(stage 2)→ 出城遭独眼刻刀维克伏击(stage 3 完结)
export function vendettaLetter() {
  calendar.letter = {
    from: '黑石兄弟会',
    text: '南门那笔账,兄弟会记下了。城墙护得了你一时,护不了你一世——出城的路上,留神你的后颈。(信纸背面用炭画着一把断刀)',
  };
  toast(player.home ? '📮 信箱里插着一封没署名的信。小红旗立着,像面招魂幡。' : '📮 罗莎那儿有你一封信。她说送信的人蒙着脸。', 4.5);
}
export function vendettaRead() { // 读到恐吓信:伏击上膛
  vendetta.stage = 2;
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.3);
  remember('收到了黑石兄弟会的恐吓信,他们在城外等着', 'vendetta-letter');
  setTimeout(() => toast('(你把信折好。从今天起,出城的每一步都得带着眼睛。)', 4), 1500);
}
export function updateVendetta() {
  if (vendetta.boss && vendetta.boss.dead) { vendettaSlain(); return; } // 任何击杀路径都算数
  if (vendetta.stage !== 2 || vendetta.boss || player.dead) return;
  if (dist2(player.pos.x, player.pos.z, 0, 0) < 16900) return; // 出城 130 步才动手
  const a = Math.atan2(player.pos.x, player.pos.z) + 0.6;
  const bx = player.pos.x + Math.sin(a) * 14, bz = player.pos.z + Math.cos(a) * 14;
  const boss = addBandit(bx, bz, { hp: 12, dmg: 2, speed: 7, scale: 1.15 });
  boss.eventFoe = true;
  boss.vendetta = true;
  vendetta.boss = boss;
  for (const s of [-1, 1]) {
    const t = addBandit(bx + s * 3, bz + s * 2, { hp: 3, dmg: 1 });
    t.eventFoe = true;
    t.minion = true;
  }
  sfx.wanted();
  cam.shake = 0.4;
  telegraphFlash(boss);
  toast('🗡️ 「南门的账,现在算。」——黑石副手·独眼刻刀维克,从道旁的阴影里走了出来!', 6);
}
function vendettaSlain() { // 在 meleeSweep/爆炸等击杀路径由 boss.vendetta 标记触发
  vendetta.stage = 3;
  vendetta.boss = null;
  player.blackstoneToken = true;
  dropCoins(player.pos, 8);
  sfx.fanfare();
  unlockAch('vendetta');
  remember('斩杀了黑石副手刻刀维克,兄弟会的报复到此为止', 'vendetta-end');
  seedLegend();
  if (player.home) refreshTrophies();
  toast('⚔️ 刻刀维克倒下了。你从他颈间摘下【黑石断刀徽记】——这笔账,两清了。(挂上了你家外墙)', 6);
  saveGame();
}
