// 暂停菜单(唯一的系统菜单,ESC 解锁鼠标时弹出):继续、画质、画风、音乐、操作说明、清除存档(3 秒内点两次才删)。
// 对外:paused(暂停时世界冻结、只渲染,输入不入队)、setPaused(p)(暂停时丢掉排队的输入、松开蓄力)。
// 按钮在模块加载时接线(只碰 DOM 与 gfx/core 的画风表)。
import { toggleMusic } from '../audio.js';
import { SAVE_KEY } from '../core/save.js';
import { player } from '../core/state.js';
import { STYLE_PRESETS, renderer, styleKey } from '../gfx/core.js';
import { QUALITY, nextStyle, qualityIdx, setQuality } from '../gfx/quality.js';
import { hintVisible, toggleHint } from './hudview.js';
import { cancelCharge, inputQ } from '../main.js';

// ================= 暂停菜单(唯一系统菜单,ESC 弹出) =================
const pauseEl = document.getElementById('pause');
export let paused = false;
export function setPaused(p) {
  paused = p;
  pauseEl.style.display = p ? 'flex' : 'none';
  if (p) { // 暂停:丢掉排队的输入,松开蓄力(否则恢复时会凭空蓄满一记重击)
    inputQ.length = 0;
    player.atkHeld = false;
    cancelCharge();
  }
}
document.getElementById('btn-resume').onclick = () => {
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
document.getElementById('btn-quality').onclick = () => setQuality((qualityIdx + 1) % QUALITY.length, true);
document.getElementById('btn-style').textContent = `画风:${STYLE_PRESETS[styleKey].name}`;
document.getElementById('btn-style').onclick = () => nextStyle();
document.getElementById('btn-music').onclick = (ev) => {
  ev.target.textContent = `音乐:${toggleMusic() ? '开' : '关'}`;
};
document.getElementById('btn-help').onclick = () => {
  if (!hintVisible) toggleHint();
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
// 清除存档要点两次:第一次只变成确认按钮,3 秒内再点才真删(防手滑)
let wipeArmT = 0;
document.getElementById('btn-wipe').onclick = (ev) => {
  const btn = ev.currentTarget;
  if (performance.now() > wipeArmT) {
    wipeArmT = performance.now() + 3000;
    const old = btn.textContent;
    btn.textContent = '⚠️ 再点一次确认清除(不可恢复)';
    setTimeout(() => { if (performance.now() > wipeArmT) btn.textContent = old; }, 3100);
    return;
  }
  localStorage.removeItem(SAVE_KEY);
  location.reload();
};
