// 运行期共享的根对象:世界布局(world,buildWorld 的产物)、碰撞网格(colliders)、玩家(player)、是否已开局(started)。
// 启动装配时由 main.js 各登记一次(bindWorld / bindPlayer);之后各系统模块只读这些绑定、改它们的属性。
// 本模块不导入任何东西,放在依赖图最底层:系统模块依赖它,而不必反过来依赖 main.js。
// 注意:登记发生在 main 的启动装配里,模块顶层代码(加载期)读到的仍是 null——只能在函数里用。
export let world = null;
export let colliders = null;
export let player = null;
// 标题画面点下去才算开局:之前世界照常渲染,但不推进模拟、不接受玩法输入
export let started = false;

export function bindWorld(w) {
  world = w;
  colliders = w.colliders;
}
export function bindPlayer(p) {
  player = p;
}
export function markStarted() {
  started = true;
}
