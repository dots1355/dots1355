// 共享上下文:main.js 启动时把玩家、世界、碰撞体等"活对象"和少量回调登记进来;
// 拆出去的系统模块通过它访问,而不是隐式依赖 main.js 的模块级变量。
// 这里给出安全的缺省值:登记之前被调用也不会崩(例如加载期设置天气)。
export const ctx = {
  player: null,
  world: null,
  colliders: null,
  getLockFoe: () => null,
  isWinter: () => false,
  started: () => false,
  toast: () => {},
  mood: () => 0,
};
