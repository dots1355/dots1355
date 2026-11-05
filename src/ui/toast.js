// 顶部提示条(toast):队列化,一次一条。
// 对外:toast(一般)/ toastQuest(委托;可带 key——同一 key 只留最新一条,例如金环、猎狼、商人受袭这类进度)/
// toastAmbient(氛围,忙时不播)/ toastNow(插队:教学、委托失败、Boss 倒下这种过时就误导的信息)/
// dropQuestToasts(委托完成、失败、重接时把还在排队的委托提示作废)/ updateToast(dt) 由主循环驱动;toastQueue 供测试清空。
// 档位:插队(3)> 委托(2)> 一般(1)> 氛围(0);同档先来先播;排太久(>7 秒)的过期作废;
// 一模一样的话已经在排队就不排第二遍;队列最多 5 条,满了先挤掉低档的旧条。
import { simNow } from '../core/timers.js';
import { richText } from './hud.js';

// "现在忙着呢"(有委托在办、序章里):启动装配时由 main 登记,本模块不认识玩法模块
let ambientBusy = () => false;
export function setAmbientGate(fn) { ambientBusy = fn; }
// 顶部细条通知:队列化,一次一条,不遮挡视野
const toastEl = document.getElementById('toast');
let toastTimer = 0; // >0 显示中,<0 淡出间隔
// 条目:{ msg, dur, at(入队时刻,游戏时钟), tier(档位), front(插队), quest(委托类), key(同 key 只留最新) }
export const toastQueue = [];
function enqueue(e) {
  for (let i = toastQueue.length - 1; i >= 0; i--) {
    const q = toastQueue[i];
    if ((e.key && q.key === e.key) || q.msg === e.msg) toastQueue.splice(i, 1); // 旧进度作废;同一句不播两遍
  }
  if (e.front) toastQueue.unshift(e); else toastQueue.push(e);
  while (toastQueue.length > 5) {
    let k = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      if (toastQueue[i].front) continue;
      if (k < 0 || toastQueue[i].tier < toastQueue[k].tier) k = i;
    }
    toastQueue.splice(k < 0 ? toastQueue.length - 1 : k, 1);
  }
}
const entry = (msg, dur, tier, extra = {}) => ({ msg, dur: Math.min(dur, 4), at: simNow(), tier, ...extra });
export function toast(msg, dur = 2.6) { enqueue(entry(msg, dur, 1)); }
// 委托类:任务完成/失败/重接时整批作废(dropQuestToasts);带 key 的进度提示同 key 只留最新一条
export function toastQuest(msg, dur = 3.5, key = null) { enqueue(entry(msg, dur, 2, { quest: true, key })); }
// 氛围类(世界的心声、闲笔):有委托在办、或队列已经排着两条以上时,直接不播
export function toastAmbient(msg, dur = 3.5) {
  if (ambientBusy() || toastQueue.length >= 2) return;
  enqueue(entry(msg, dur, 0));
}
export function dropQuestToasts() {
  for (let i = toastQueue.length - 1; i >= 0; i--) if (toastQueue[i].quest) toastQueue.splice(i, 1);
}
// 插队播报:时效信息不排队,直接顶到最前并催场(正在播的那条 0.4 秒内谢幕)
export function toastNow(msg, dur = 3, key = null) {
  enqueue(entry(msg, dur, 3, { front: true, key }));
  if (toastTimer > 0.4) toastTimer = 0.4;
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
      if (!toastQueue[i].front && now - toastQueue[i].at > 7000) toastQueue.splice(i, 1);
    }
    let k = 0; // 档位最高的先播
    for (let i = 1; i < toastQueue.length; i++) if (toastQueue[i].tier > toastQueue[k].tier) k = i;
    const { msg, dur } = toastQueue.splice(k, 1)[0];
    toastEl.innerHTML = richText(msg); // 文字里的 emoji 换成统一的 SVG 图标
    toastEl.style.opacity = 1;
    toastTimer = dur;
  }
}
