// 游戏时钟定时器:按游戏内 dt 结算(暂停即冻结、慢镜同步变慢),取代改玩法状态的 setTimeout
const timers = [];
let simMs = 0;
// 游戏时钟(毫秒):跟着 tick 的 dt 走——暂停冻结、时停/慢镜同步,测试用 __gtm.step 也能推进
// (弹反窗口、盾击冷却、连斩计时这类玩法计时一律用它,别用 performance.now())
export function simNow() { return simMs; }
export function later(sec, fn) { timers.push({ t: sec, fn }); }
export function updateTimers(dt) {
  simMs += dt * 1000;
  for (let i = timers.length - 1; i >= 0; i--) {
    const tm = timers[i];
    tm.t -= dt;
    if (tm.t <= 0) {
      timers.splice(i, 1);
      try { tm.fn(); } catch (err) { console.error(err); }
    }
  }
}
export function pendingTimers() { return timers.length; }
