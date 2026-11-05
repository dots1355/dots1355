// 贴地:玩法里实体的 y 一律是"离地高度"(站在地上就是 0),渲染前统一加上地面高度。
// 顶层物体在"模拟前取消、渲染前加上"地面偏移;位置没动就复用上次算好的高度,几乎零开销。
// 已经是绝对坐标的东西(地表网格、天空、粒子缓冲、合批网格)标 userData.noSnap 跳过。
// 主循环:unsnapScene() → tick → snapScene() → 渲染;测试步进 __gtm.step 也成对调用。
import { groundH } from '../terrain.js';
import { scene } from './core.js';

export function unsnapScene() {
  const ch = scene.children;
  for (let i = 0; i < ch.length; i++) {
    const u = ch[i].userData;
    if (u.snapped) { ch[i].position.y -= u.gOff; u.snapped = false; }
  }
}
export function snapScene() {
  const ch = scene.children;
  for (let i = 0; i < ch.length; i++) {
    const o = ch[i], u = o.userData;
    if (u.snapped || u.noSnap) continue;
    const p = o.position;
    if (u.gX !== p.x || u.gZ !== p.z) { u.gX = p.x; u.gZ = p.z; u.gOff = groundH(p.x, p.z); }
    p.y += u.gOff;
    u.snapped = true;
  }
}
