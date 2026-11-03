// 游戏时钟定时器:按游戏内 dt 结算(暂停即冻结、慢镜同步变慢),取代改玩法状态的 setTimeout
const timers = [];
export function later(sec, fn) { timers.push({ t: sec, fn }); }
export function updateTimers(dt) {
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
