// 输入:键鼠事件只把玩法动作 queueInput(fn) 入队,tick 开头 drainInput() 按发生顺序统一执行(动作总在模拟步内生效);
// 暂停/看地图/未开局时不入队。界面操作(对话翻页、追问、地图、拍照、手账、画风、操作说明)仍即时响应。
// 对外:keys(按住的键)、locked(鼠标是否锁定)、midHeld(中键按住)、inputQ/queueInput/drainInput;
// initInput() 启动装配时登记全部监听(在标题画面之后)。
import { sfx } from '../audio.js';
import { player, started } from '../core/state.js';
import { renderer } from '../gfx/core.js';
import { nextStyle } from '../gfx/quality.js';
import { advanceDialog, deepTalk, dialog } from '../ui/dialog.js';
import { toggleHint } from '../ui/hudview.js';
import { mapState, toggleBigMap } from '../ui/maps.js';
import { paused, setPaused } from '../ui/pause.js';
import { toast } from '../ui/toast.js';
import { openJournal, togglePhoto } from './activities.js';
import { attackDown, attackUp } from './attack.js';
import { cam } from './camera.js';
import { toggleLock } from './combat.js';
import { cycleWeapon, shopOpen } from './gear.js';
import { tryInteract } from './interact.js';
import { SPELLS, cycleSpell, doShout, spellDown, spellUp, toggleSneak } from './magic.js';
import { idle } from './mind.js';
import { armPress, armRT } from './npcs.js';
import { doRoll, tryRob } from './player.js';
import { prologue, skipPrologue, whistleHorse } from './prologue.js';

// ================= 输入 =================
// 玩法动作先入队,在 tick 开头统一消费:动作总在模拟步内、按发生顺序生效(不再在两帧之间
// 偷偷改状态);暂停/看地图时清空,测试也可以直接往队列里注入。界面操作(对话翻页、菜单)仍即时。
export const inputQ = [];
function queueInput(fn) { if (started && !paused && !mapState.open) inputQ.push(fn); }
export function drainInput() {
  while (inputQ.length) {
    const fn = inputQ.shift();
    try { fn(); } catch (err) { console.error(err); }
  }
}
export const keys = {};
export let locked = false;
export let midHeld = false;
// 键鼠监听登记(启动装配调用;须在标题画面的 Delete 清档监听之后,保持监听顺序)
export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // Tab 别把焦点切走
    idle.t = 0; // 有输入,世界收回它的注视
    if (e.repeat) return; // 忽略系统按键自动重复,防止长按空格吞掉二段跳/长按 E 反复上下马
    if (paused || shopOpen) return;
    keys[e.code] = true;
    if (e.code === 'KeyE') {
      if (armRT.active) queueInput(armPress); // 掰手腕中:E 是发力,不是交互
      else if (dialog.open) advanceDialog();
      else queueInput(() => tryInteract());
    }
    if (e.code === 'KeyF' && !dialog.open) queueInput(attackDown);
    if (e.code === 'KeyM' && started) toggleBigMap(); // M=地图(音乐开关在暂停菜单)
    if (e.code === 'KeyP' && started) togglePhoto();
    if (e.code === 'KeyJ' && started && !dialog.open) openJournal();
    if (e.code === 'KeyT' && dialog.open) deepTalk();
    if (e.code === 'KeyH') toggleHint();
    if (e.code === 'KeyK') { // 画风随手切:写实/油画/卡通/水墨/像素/版画/电影/复古
      toast(`🎨 画风:${nextStyle()}(K 键继续切换)`, 1.6);
    }
    if (e.code === 'KeyQ') queueInput(cycleWeapon);
    // 施法键做冗余判定:部分输入法/键盘布局下 e.code 会被吞,补上 e.key 兜底
    if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && !dialog.open && !e.repeat) queueInput(spellDown);
    if (e.code === 'KeyV' && !dialog.open) queueInput(cycleSpell);
    if (e.code === 'KeyZ' && !dialog.open) queueInput(toggleSneak);
    if (e.code === 'KeyX' && !dialog.open) queueInput(doShout);
    if (/^Digit[1-4]$/.test(e.code) && !dialog.open) {
      const idx = +e.code.slice(5) - 1;
      if (idx < player.spells.length && idx !== player.spellIdx) {
        player.fireChargeT = 0; // 换法术=松开引导
        player.spellIdx = idx;
        sfx.equip();
        toast(`${SPELLS[player.spells[idx]].icon} ${SPELLS[player.spells[idx]].name}`, 1.2);
      }
    }
    if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !dialog.open) queueInput(doRoll);
    if (e.code === 'Tab' && !dialog.open) queueInput(toggleLock);
    if (e.code === 'KeyO' && prologue.on) skipPrologue();
    if (e.code === 'KeyG' && !dialog.open) queueInput(tryRob);
    if (e.code === 'KeyB' && started && !dialog.open) queueInput(whistleHorse);
  });
  // 右键格挡(按住)
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  // 只记"按着没有";真正举不举得起盾由 updateBlock 每帧判定(刀没落下/蓄力/翻滚/踉跄时举不起,条件一满足自动举起)
  window.addEventListener('mousedown', (e) => { if (e.button === 2) player.blockHeld = true; });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) queueInput(attackUp);
    if (e.button === 2) { player.blockHeld = false; player.blocking = false; }
    if (e.button === 1) { midHeld = false; queueInput(spellUp); }
  });
  window.addEventListener('blur', () => { player.blockHeld = false; player.blocking = false; });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyF') queueInput(attackUp);
    if (e.code === 'KeyR') queueInput(spellUp);
  });
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (!started) return;
    if (dialog.open) { advanceDialog(); return; }
    if (!locked) renderer.domElement.requestPointerLock();
    else if (e.button === 0) queueInput(attackDown);
    else if (e.button === 1) { e.preventDefault(); midHeld = true; queueInput(spellDown); } // 中键施法:左手不用离开 WASD
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    // ESC 解锁鼠标 → 弹出暂停菜单(GTA 式)
    if (!locked && started && !player.dead && !dialog.open && !shopOpen) setPaused(true);
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    cam.yaw -= e.movementX * 0.0028;
    cam.pitch = Math.max(-0.1, Math.min(1.15, cam.pitch + e.movementY * 0.0028));
  });
}
