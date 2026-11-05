// 序章(天际式开场):狼袭教学 → 队长赏识 → 标题卡揭幕。
// 一步一步教:锁定 → 翻滚(真的躲开一次)→ 格挡/弹反 → 出刀 → 魔光弹(要打中)→ 自由战斗;做到才进下一步。
// 教学卡 setTutor 也给别的系统用(例如第一次见到紫色重击)。玩家的马(序章送的)与 B 键唤马也在这里。
import { sfx } from '../audio.js';
import { colliders, player } from '../core/state.js';
import { resolveCollisions } from '../entities.js';
import { toast, toastNow } from '../ui/toast.js';
import { cam } from './camera.js';
import { clock } from './sky.js';
import { spawnDust } from './weather.js';
import { abHighlight, addHorse, callout, horses, killWolf, lockFoe, setLockFoe, wolves } from '../main.js';

// ================= 序章(天际式开场):狼袭教学 → 队长赏识 → 标题卡揭幕 =================
export const prologue = { on: false, step: 0, t: 0, wolves: [] };
// 教学卡:屏幕下方常驻,写清"现在要按什么";完成一步才换下一步(不再被别的提示挤掉)
const tutorEl = document.getElementById('tutor');
export function setTutor(keyLabel, text, sub = '') {
  if (!tutorEl) return;
  if (!text) { tutorEl.style.display = 'none'; abHighlight(null); return; }
  tutorEl.style.display = 'block';
  tutorEl.innerHTML = `<span class="tk">${keyLabel}</span><span class="tt">${text}</span>` +
    (sub ? `<div class="ts">${sub}</div>` : '');
  abHighlight(keyLabel);
}
export function startPrologue() {
  prologue.on = true;
  prologue.step = 0;
  prologue.t = 0;
  prologue.tries = 0;
  prologue.flags = {};
  clock.time = 0.27; // 黎明,冷光里开场
  for (let i = 0; i < 3; i++) {
    const w = wolves[i];
    if (!w) break;
    w._home0 = w.home; // 记住老巢,序章完了送回去
    w._prol = true;    // 序章狼死了不复活,教学关才能通
    w._hold = true;    // 先在场边候着,一只一只上
    w.home = { x: player.pos.x, z: player.pos.z };
    w.dead = false; w.hp = 2; w.stunT = 0; w.lunging = 0; w.lungeCd = 0.6; w.biteT = 0;
    w.group.visible = true;
    const a = 0.6 + i * 0.9;
    w.pos.set(player.pos.x + Math.sin(a) * (9 + i * 3), 0, player.pos.z + Math.cos(a) * (9 + i * 3));
    w.group.position.copy(w.pos);
    prologue.wolves.push(w);
  }
  toastNow('🐺 黎明——狼群冲进了村子!', 3.5);
}
function endPrologue() {
  prologue.wolves.forEach((w) => {
    if (w._home0) w.home = w._home0;
    w._prol = false;
    w._hold = false;
    if (w.dead) w.respawnT = 45; // 回归野外正常轮回
  });
  prologue.on = false;
  setTutor(null);
}
function showTitleCard() {
  const el = document.getElementById('titlecard');
  el.style.display = 'flex';
  requestAnimationFrame(() => (el.style.opacity = 1));
  sfx.fanfare();
  setTimeout(() => {
    el.style.opacity = 0;
    setTimeout(() => (el.style.display = 'none'), 1600);
  }, 3400);
}
// 序章奖励:回满血、赏钱、借你一匹马(按 B 吹口哨唤马)
function prologueReward() {
  player.hp = player.maxHp;
  player.sta = player.maxSta;
  player.mp = player.maxMp;
  player.coins += 15;
  giveStarterHorse();
}
export function skipPrologue(silent) {
  prologue.wolves.forEach((w) => { if (!w.dead) killWolf(w); });
  endPrologue();
  if (prologue.step < 9) prologueReward();
  prologue.step = 9;
  if (!silent) { toast('(序章已跳过)', 1.5); showTitleCard(); }
}
// 一步一步教:锁定 → 翻滚 → 格挡 → 出刀(轻点/按住) → 魔光弹 → 自由战斗。做到了才进下一步
function prologueRelease(i) {
  const w = prologue.wolves[i];
  if (w && !w.dead) { w._hold = false; w.lungeCd = 0.8; w.attackCd = 0.6; }
  return w;
}
export function updatePrologue(dt) {
  if (!prologue.on) return;
  prologue.t += dt;
  const P = prologue, F = P.flags;
  const w0 = P.wolves[0], w1 = P.wolves[1];
  if (player.hp < 3) player.hp = 3; // 教学里不让人倒下:学会比惩罚重要
  if (P.step === 0 && P.t > 1.4) {
    P.step = 1;
    toastNow('⚔️ 卫兵队长:「旅人,拿稳你的剑!」', 3);
    setTutor('Tab', '锁定最近的狼', '锁定后镜头会框住它,出刀也会自动对准(按 O 跳过序章)');
  } else if (P.step === 1 && lockFoe) {
    P.step = 2; P.t = 0;
    prologueRelease(0);
    setTutor('C', '它面前铺开红色扇形时,按 C 翻滚躲开', '亮区从脚下往外长,长满的一刻扑过来;翻滚有无敌帧,横着走出扇形也行');
  } else if (P.step === 2 && (F.rolled || P.t > 25)) {
    P.step = 3; P.t = 0;
    F.blocked = false;
    callout(F.rolled ? '漂亮的翻滚!' : '下次早点滚', 'gold');
    setTutor('右键', '按住右键举盾,挡下它的下一次扑咬', '亮区快长满(出手前一瞬)时才举盾 = 完美弹反:它会踉跄,还击伤害 ×2.5');
  } else if (P.step === 3 && (F.blocked || P.t > 25)) {
    P.step = 4; P.t = 0;
    callout(F.parried ? '完美弹反!' : '挡住了!', 'gold');
    setTutor('F', '出刀!轻点 F(或左键)快斩,按住蓄力、松手重击', 'W+F 突刺 · S+F 下劈(慢但重) · 敌人起手时砍它能打断');
  } else if (P.step === 4 && w0 && w0.dead) {
    P.step = 5; P.t = 0;
    F.sparked = false;
    F.sparkHit = false;
    const w = prologueRelease(1);
    if (w) { // 远远站在镜头正前方 7 米(魔光弹自动瞄准够得着),先学远程
      w._hold = true;
      const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
      w.pos.set(player.pos.x + fx * 7, 0, player.pos.z + fz * 7);
      resolveCollisions(w.pos, 0.4, colliders);
      w.group.position.copy(w.pos);
      setLockFoe(w); // 镜头直接框住它
    }
    setTutor('R', '前面那只:按 R(或鼠标中键)放魔光弹打中它', '魔光弹耗 1 点法力(蓝点),会自动吸附前方的敌人');
  } else if (P.step === 5 && F.sparked && !F.sparkHit && !F._missHint && P.t > 1.5) {
    F._missHint = true;
    callout('没打中——对准它再按 R', 'dim');
  } else if (P.step === 5 && (F.sparkHit || (w1 && w1.dead) || P.t > 30)) {
    P.step = 6; P.t = 0;
    prologueRelease(1);
    setTutor('自由', '把剩下的狼都解决掉', '体力条(黄)见底就砍不动、跑不动——留一口气翻滚');
  } else if (P.step === 6 && !F.thirdOut && (P.t > 4 || (w1 && w1.dead))) {
    F.thirdOut = true; // 第三只错开放出:别让一刀横扫全收
    prologueRelease(2);
  } else if (P.step === 6 && P.wolves.every((w) => w.dead)) {
    P.step = 7; P.t = 0;
    setTutor(null);
    prologueReward();
    sfx.fanfare();
    toastNow('🎖️ 卫兵队长:「好身手!赏钱拿着,这匹马也借你——按 B 吹口哨,它就会跑来。」(+15 金币)', 6);
  } else if (P.step === 7 && P.t > 3) {
    P.step = 9;
    endPrologue();
    showTitleCard();
    toast('欢迎来到艾尔德里亚!去喷泉广场找管家埃隆接取委托吧(按 E 互动,光柱指路)', 5);
  }
}
// 玩家的马:序章送一匹;按 B 吹口哨把它唤到身边
function giveStarterHorse() {
  if (player.horse && horses.includes(player.horse)) return;
  const a = player.yaw + Math.PI * 0.6;
  const h = addHorse(player.pos.x + Math.sin(a) * 4, player.pos.z + Math.cos(a) * 4, 0x6b4a32, false);
  h.playerHorse = true;
  player.horse = h;
}
export function whistleHorse() {
  const h = player.horse;
  if (!h || !horses.includes(h)) { callout('你还没有自己的马', 'dim'); return; }
  if (player.mounted === h) return;
  sfx.whoosh(1.4);
  const d = Math.hypot(h.pos.x - player.pos.x, h.pos.z - player.pos.z);
  if (d > 6) {
    const a = cam.yaw + Math.PI; // 从镜头背后跑进画面
    h.pos.set(player.pos.x + Math.sin(a) * 5 + Math.cos(a) * 2, 0, player.pos.z + Math.cos(a) * 5 - Math.sin(a) * 2);
    resolveCollisions(h.pos, 0.6, colliders);
    h.home.copy(h.pos);
    h.group.position.copy(h.pos);
    spawnDust(h.pos.x, 0.2, h.pos.z, 10, 1.2, 1.4);
    sfx.hoof();
  }
  callout('🐴 马来了', 'gold');
}

