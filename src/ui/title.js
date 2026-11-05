import { initAudio, startMusic } from '../audio.js';
import { FRESH_START, SAVE_KEY } from '../core/save.js';
import { markStarted, player, started, world } from '../core/state.js';
import { renderer } from '../gfx/core.js';
import { INTRO } from '../story.js';
import { refreshProclaim } from '../systems/activities.js';
import { SEASON_ICON, seasonIdx, startSpecialDay, todaySpecial } from '../systems/calendar.js';
import { crestsFound } from '../systems/pickups.js';
import { prologue, startPrologue } from '../systems/prologue.js';
import { missions, quest } from '../systems/quests.js';
import { toast } from './toast.js';
// 标题画面:世界观开场(INTRO)、存档信息与 Delete 连按两次清档、点击开局(startGame);
// 以及标题/倒下画面的背景图——本地 assets/ai/title.jpg 优先,否则用 AI 现画的那张(setTitleArt)。
// 对外:loadLocalTitleArt()、setTitleArt(bitmap)、titleArtURL(倒下画面复用)、initTitle(hasSave)(启动装配读档后调用)。
const titleEl = document.getElementById('title');
let localTitleArt = false;
export function loadLocalTitleArt() {
  if (location.protocol === 'file:') return;
  fetch('./assets/ai/title.jpg').then((r) => {
    if (r.ok) r.blob().then((b) => {
      localTitleArt = true;
      titleEl.style.backgroundImage =
        `linear-gradient(rgba(10,6,20,0.55), rgba(10,6,20,0.75)), url(${URL.createObjectURL(b)})`;
      titleEl.style.backgroundSize = 'cover';
      titleEl.style.backgroundPosition = 'center';
    });
  }).catch(() => {});
}
export let titleArtURL = null;
export function setTitleArt(bitmap) {
  if (localTitleArt) return;
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  titleArtURL = c.toDataURL('image/jpeg', 0.9);
  const t = document.getElementById('title');
  t.style.backgroundImage =
    `linear-gradient(rgba(10,6,20,0.5), rgba(10,6,20,0.72)), url(${titleArtURL})`;
  t.style.backgroundSize = 'cover';
  t.style.backgroundPosition = 'center';
}

// 标题画面:世界观开场 + 存档信息;有存档时 Delete 连按两次清档(须在玩法键盘监听之前登记)
export function initTitle(hasSave) {
  document.getElementById('lore').textContent = INTRO;
  if (hasSave) {
    document.getElementById('save-info').textContent =
      `💾 检测到存档:委托 ${Math.min(quest.idx + 1, missions.length)}/${missions.length} · ` +
      `${player.coins} 金币 · 纹章 ${crestsFound.length}/${world.crestSpots.length}(按 Delete 键清除存档重新开始)`;
    // 清档要按两次(3 秒内):手滑一下不该把几个小时的进度抹掉
    let delArmT = -1e9;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Delete' || started) return;
      const el = document.getElementById('save-info');
      if (performance.now() - delArmT > 3000) {
        delArmT = performance.now();
        el.textContent = '⚠️ 真的要清除存档吗?3 秒内再按一次 Delete 确认(进度无法恢复)';
        el.style.color = '#ff8a6a';
        return;
      }
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    });
  }
  titleEl.addEventListener('click', startGame);
}
// 点标题开局:开声音与音乐、新档演序章、今日公告、读档正逢节庆补上效果、锁定鼠标
function startGame() {
  initAudio();
  startMusic();
  titleEl.style.display = 'none';
  markStarted();
  if (FRESH_START) startPrologue(); // 新档:黎明狼袭序章
  refreshProclaim(); // 今日公告(联网时由 AI 现写)
  const sp0 = todaySpecial();
  if (sp0) {
    startSpecialDay(sp0.key); // 读档正逢节庆:补上当日的节庆效果
    toast(`${SEASON_ICON[seasonIdx()]} 今日${sp0.name}:${sp0.desc}`, 5);
  }
  renderer.domElement.requestPointerLock();
  // 序章里不催你去找管家(和"打狼"打架);序章结束再说
  if (!prologue.on) toast('欢迎来到艾尔德里亚!去喷泉广场找管家埃隆接取委托吧(按 E 互动)', 5);
}
