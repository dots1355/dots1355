// 布景的每帧动画:远山环与远景垫底跟着玩家走、群系环境粒子、风车/符文立石/宝箱盖/云、水面波纹、胶片颗粒时钟。
// 都只改画面,不碰玩法状态;主循环按系统表顺序逐个调用(见 main.js 的 SYSTEMS)。
import { updateAmbient } from '../ambient.js';
import { player, world } from '../core/state.js';
import { frame } from '../core/frame.js';
import { camera, gradePass, renderer } from '../gfx/core.js';
import { qualityIdx } from '../gfx/quality.js';
import { biomeWeights, groundH } from '../terrain.js';
import { inDungeon } from './activities.js';
import { clock, vistaFar, vistaNear } from './sky.js';
import { weather } from './weather.js';

// 远山永远在地平线上
export function followVista() {
  vistaFar.position.set(player.pos.x, 0, player.pos.z);
  vistaNear.position.set(player.pos.x, 0, player.pos.z);
}

// 群系环境粒子(雪/沙/余烬/落叶/萤火/花粉):地窖里不飘;夜里萤火更多,雨天随风斜飞
export function updateAmbientFX(dt) {
  if (inDungeon()) return;
  const elevA = Math.sin(clock.time * Math.PI * 2 - Math.PI / 2);
  updateAmbient(dt, frame.now * 0.001, camera.position, groundH(player.pos.x, player.pos.z), player.pos.x, player.pos.z,
    biomeWeights, { night: 1 - Math.max(0, Math.min(1, elevA * 2 + 0.25)), rain: weather.rain, windX: 0.94, windZ: 0.33,
      pixelH: renderer.domElement.height }, qualityIdx === 0 ? 0.6 : 1);
}

// 远景垫底跟着玩家走(地形网格本身是静态的),按 64m 对齐免得纹理游动
export function followUnderlay() {
  world.underlay.position.x = Math.round(player.pos.x / 64) * 64;
  world.underlay.position.z = Math.round(player.pos.z / 64) * 64;
}

// 风车转、符文立石呼吸(劈中时一晃)、打开的宝箱盖掀到底、云往东飘
export function animateScenery(dt) {
  for (const w of world.windmills) w.rotation.x += dt * 0.9;
  world.animRunes(dt);
  for (const c of world.chests) {
    if (c.opened && c.lid.rotation.x > -1.9) c.lid.rotation.x -= dt * 5;
  }
  for (const c of world.clouds) {
    c.position.x += dt * 1.5;
    if (c.position.x > 320) c.position.x = -320;
  }
}

// 水面波纹:法线贴图缓慢流动
export function animateWater(dt) {
  for (const m of world.waterMats) {
    m.normalMap.offset.x += dt * 0.018;
    m.normalMap.offset.y += dt * 0.011;
  }
}

// 胶片颗粒的抖动时钟(复古画风用)
export function tickFilmGrain(now) {
  gradePass.uniforms.uTime.value = now * 0.00025;
}
