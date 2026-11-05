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
// 最近的 LIGHT_POOL 盏:插入排序进定长槽位(每次扫描零分配,不建临时对象、不排整表)
const _lpSrc = new Array(LIGHT_POOL).fill(null), _lpD = new Float64Array(LIGHT_POOL);
let _lpN = 0, _lpX = 0, _lpZ = 0;
function lpConsider(src) {
  if (!src.visible || src.intensity <= 0.01) return;
  const d = Math.hypot(src.position.x - _lpX, src.position.z - _lpZ);
  if (d > 110 || (_lpN === LIGHT_POOL && d >= _lpD[_lpN - 1])) return;
  let i = _lpN < LIGHT_POOL ? _lpN++ : _lpN - 1;
  while (i > 0 && _lpD[i - 1] > d) { _lpD[i] = _lpD[i - 1]; _lpSrc[i] = _lpSrc[i - 1]; i--; }
  _lpD[i] = d; _lpSrc[i] = src;
}
export function updateLightPool(px, pz) {
  if (lightPoolScan-- > 0) return;
  lightPoolScan = 3;
  _lpN = 0; _lpX = px; _lpZ = pz;
  lightSources.forEach(lpConsider);
  const n = _lpN;
  for (let i = 0; i < LIGHT_POOL; i++) {
    const pl = lightPool[i];
    if (i >= n) { pl.intensity = 0; _lpSrc[i] = null; continue; }
    const s2 = _lpSrc[i];
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

// 类型化数组池(荒野区块的地表与烘焙几何用):按约 √2 倍一档的容量分桶复用 ArrayBuffer,取出时给精确长度的视图。
// 区块卸载时把它独占几何的数组还回来:流式期间不再反复申请、丢弃几 MB 的缓冲
// (它们算外部内存,丢多了会逼出几十毫秒的 Major GC)。池里闲置的总量有上限,超出的照常交给 GC。
const ARR_POOL_MAX = 32 << 20; // 闲置上限 32MB
const arrPool = new Map(); // 容量(字节)→ ArrayBuffer[]
const arrOut = new WeakSet(); // 从池里借出去的缓冲(只收它们回来,别的数组不碰)
let arrIdle = 0;
function arrCap(bytes) { // 容量档位:64KB 以下按 2 倍,以上按 √2 倍(取整到 4KB),浪费不超过约四成
  let cap = 4096;
  while (cap < bytes) cap = cap < 65536 ? cap * 2 : Math.ceil((cap * Math.SQRT2) / 4096) * 4096;
  return cap;
}
export function takeArray(Type, n) {
  const cap = arrCap(n * Type.BYTES_PER_ELEMENT);
  const list = arrPool.get(cap);
  let buf = list && list.pop();
  if (buf) arrIdle -= cap;
  else buf = new ArrayBuffer(cap);
  arrOut.add(buf);
  return new Type(buf, 0, n);
}
function giveBackArray(a) {
  const buf = a && a.buffer;
  if (!buf || !arrOut.has(buf)) return;
  arrOut.delete(buf);
  if (arrIdle + buf.byteLength > ARR_POOL_MAX) return;
  let list = arrPool.get(buf.byteLength);
  if (!list) arrPool.set(buf.byteLength, (list = []));
  list.push(buf);
  arrIdle += buf.byteLength;
}
// 几何体已 dispose(显存已还)之后调用:属性与索引里借自池的数组收回(之后这份几何不能再用)
export function releaseGeometryArrays(geo) {
  for (const k in geo.attributes) giveBackArray(geo.attributes[k].array);
  if (geo.index) giveBackArray(geo.index.array);
}
export function arrayPoolStats() {
  let n = 0;
  for (const l of arrPool.values()) n += l.length;
  return { idleMB: +(arrIdle / 1048576).toFixed(1), buffers: n, sizes: arrPool.size };
}
