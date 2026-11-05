// 顶部提示条(toast):队列化,一次一条。
// 对外:toast(一般)/ toastQuest(委托,进度推进时 dropQuestToasts 作废旧条)/ toastAmbient(氛围,忙时不播)/
// toastNow(插队,教学用)/ updateToast(dt) 由主循环驱动;toastQueue 供测试清空。
// 档位:委托(2)> 一般(1)> 氛围(0);排太久(>7 秒)的过期作废;队列最多 5 条,满了先挤掉低档的旧条。
import { simNow } from '../core/timers.js';
import { richText } from './hud.js';

// "现在忙着呢"(有委托在办、序章里):启动装配时由 main 登记,本模块不认识玩法模块
let ambientBusy = () => false;
export function setAmbientGate(fn) { ambientBusy = fn; }
// 顶部细条通知:队列化,一次一条,不遮挡视野
const toastEl = document.getElementById('toast');
let toastTimer = 0; // >0 显示中,<0 淡出间隔
export const toastQueue = [];
// 提示分三档:委托(2)> 一般(1)> 氛围(0)。队列里先播高档的,同档先来先播;
// 排太久(>7 秒)的过期作废——过时的提示比没有提示更误导;队列最多 5 条,满了先挤掉低档的旧条。
// 条目:[文字, 时长, 入队时刻(游戏时钟), 插队?, 档位, 标签]
function pushToast(msg, dur, tier, tag) {
  toastQueue.push([msg, Math.min(dur, 4), simNow(), false, tier, tag]);
  while (toastQueue.length > 5) {
    let k = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      if (toastQueue[i][3]) continue;
      if (k < 0 || toastQueue[i][4] < toastQueue[k][4]) k = i;
    }
    toastQueue.splice(k < 0 ? 0 : k, 1);
  }
}
export function toast(msg, dur = 2.6) { pushToast(msg, dur, 1, null); }
// 委托类:进度一推进,同一委托的旧提示就作废(dropQuestToasts)
export function toastQuest(msg, dur = 3.5) { pushToast(msg, dur, 2, 'quest'); }
// 氛围类(世界的心声、闲笔):有委托在办、或队列已经排着两条以上时,直接不播
export function toastAmbient(msg, dur = 3.5) {
  if (ambientBusy() || toastQueue.length >= 2) return;
  pushToast(msg, dur, 0, 'ambient');
}
export function dropQuestToasts() {
  for (let i = toastQueue.length - 1; i >= 0; i--) if (toastQueue[i][5] === 'quest') toastQueue.splice(i, 1);
}
// 插队播报:教学这种时效信息不排队,直接顶到最前并催场
export function toastNow(msg, dur = 3) {
  toastQueue.unshift([msg, Math.min(dur, 4), simNow(), true, 3, null]);
  if (toastTimer > 0.4) toastTimer = 0.4; // 正在播的加速谢幕
}
export function updateToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) {
      toastEl.style.opacity = 0;
      toastTimer = -0.45;
    }
  } else if (toastTimer < 0) {
    toastTimer = Math.min(0, toastTimer + dt);
  } else if (toastQueue.length) {
    const now = simNow();
    for (let i = toastQueue.length - 1; i >= 0 && toastQueue.length > 1; i--) {
      if (!toastQueue[i][3] && now - toastQueue[i][2] > 7000) toastQueue.splice(i, 1);
    }
    let k = 0; // 档位最高的先播(插队的档位 3)
    for (let i = 1; i < toastQueue.length; i++) if (toastQueue[i][4] > toastQueue[k][4]) k = i;
    const [msg, dur] = toastQueue.splice(k, 1)[0];
    toastEl.innerHTML = richText(msg); // 文字里的 emoji 换成统一的 SVG 图标
    toastEl.style.opacity = 1;
    toastTimer = dur;
  }
}

