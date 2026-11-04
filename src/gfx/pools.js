// 资源池:固定数量的点光池(光源只登记、按远近"附身")与特效材质池(用完回收不销毁)。
// 两者的目的相同:让着色器程序永远命中缓存——灯数恒定、材质不销毁,就不会在游戏中途重编译卡顿。
import * as THREE from 'three';
import { groundH } from '../terrain.js';

let scene = null;
// 点光池:场景里永远只有 LIGHT_POOL 盏点光(外加提灯)。火把、篝火、地窖烛台、陨石等光源
// 只登记不入场,每隔几帧挑离玩家最近的几处"附身"上去。灯的数量恒定 → 开灯/进地窖/天黑
// 都不会触发全场着色器重编译。
// 灭着的灯(强度 0 → 颜色 uniform 为 0)在片元着色器里整盏跳过:条件只依赖 uniform,
// 整个 draw 走同一分支,白天(光源全灭)每个片元就省掉 5 盏点光的衰减与 BRDF。
// 不改程序数、不改程序键,补丁在任何着色器编译之前生效(模块加载期)。
{
  const SC = THREE.ShaderChunk;
  const head = '\t\tpointLight = pointLights[ i ];\n\t\tgetPointLightInfo( pointLight, geometryPosition, directLight );\n';
  const tail = '\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SPOT_LIGHTS > 0 )';
  const src = SC.lights_fragment_begin;
  if (src.includes(head) && src.includes(tail)) {
    SC.lights_fragment_begin = src
      .replace(head, '\t\tpointLight = pointLights[ i ];\n\t\tif ( pointLight.color.r + pointLight.color.g + pointLight.color.b > 0.0 ) {\n' +
        '\t\tgetPointLightInfo( pointLight, geometryPosition, directLight );\n')
      .replace(tail, tail.replace('reflectedLight );\n\t}', 'reflectedLight );\n\t\t}\n\t}'));
  }
}
export const LIGHT_POOL = 4;
export const lightPool = [];
export function initLightPool(s) {
  scene = s;
  for (let i = 0; i < LIGHT_POOL; i++) {
    const pl = new THREE.PointLight(0xff9944, 0, 20, 2);
    pl.userData.noSnap = true; // 位置按光源的绝对高度直接给
    scene.add(pl);
    lightPool.push(pl);
  }
}
const lightSources = new Set();
export function addLightSource(pl) {
  if (pl.parent) pl.parent.remove(pl);
  lightSources.add(pl);
}
export function removeLightSource(pl) { lightSources.delete(pl); }
let lightPoolScan = 0;
const _lpList = [];
export function updateLightPool(px, pz) {
  if (lightPoolScan-- > 0) return;
  lightPoolScan = 3;
  _lpList.length = 0;
  for (const src of lightSources) {
    if (!src.visible || src.intensity <= 0.01) continue;
    const d = Math.hypot(src.position.x - px, src.position.z - pz);
    if (d > 110) continue;
    _lpList.push({ src, d });
  }
  _lpList.sort((a, b) => a.d - b.d);
  for (let i = 0; i < LIGHT_POOL; i++) {
    const pl = lightPool[i], it = _lpList[i];
    if (!it) { pl.intensity = 0; continue; }
    const s2 = it.src;
    pl.color.copy(s2.color);
    pl.intensity = s2.intensity;
    pl.distance = s2.distance;
    pl.decay = s2.decay;
    // 登记的光源坐标是"离地高度"(不入场就不会被贴地),这里补上地面
    pl.position.set(s2.position.x, s2.position.y + (s2.userData.absY ? 0 : groundH(s2.position.x, s2.position.z)), s2.position.z);
  }
}
// 特效材质池:剑光/碎光/预警圈用完不销毁而是回收。销毁会连带删掉着色器程序,
// 下一次出刀又要重编译(卡一下),回收则永远命中缓存
const matPools = new Map();
export function pooledMat(base) {
  let pool = matPools.get(base);
  if (!pool) { pool = []; matPools.set(base, pool); }
  const m = pool.pop() || base.clone();
  m.userData.poolBase = base;
  return m;
}
export function releaseMat(m) {
  const base = m.userData && m.userData.poolBase;
  if (!base) { m.dispose(); return; }
  m.copy(base);
  m.userData.poolBase = base;
  matPools.get(base).push(m);
}
