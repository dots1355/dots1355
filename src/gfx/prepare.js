// 开局最后一步的渲染准备(所有系统都已建好场景之后、主循环开始之前,各调用一次):
//   poolSceneLights  场景里现有的点光(火把/篝火/地窖烛台)全部改为登记,由点光池代为发光
//   batchStaticWorld 世界里不会再动的网格按"材质 × 格"合并;没并进去的开局小件交给远景剔除
//   warmShaders      场景材质 + 特效材质对着后处理的离屏目标一次编译好(首次出刀/施法/下雨不卡)
// 只依赖渲染层与传进来的对象,不碰玩法状态。
import * as THREE from 'three';
import { registerSmallProps, staticBatch } from '../batch.js';
import { groundH } from '../terrain.js';
import { camera, composer, renderer, scene } from './core.js';
import { LIGHT_POOL, addLightSource, lightPool } from './pools.js';

// keep:不入池的点光(玩家的提灯由 sky.js 直接驱动)
export function poolSceneLights(keep) {
  scene.updateMatrixWorld(true);
  const found = [];
  scene.traverse((o) => { if (o.isPointLight && o !== keep && !lightPool.includes(o)) found.push(o); });
  const wp = new THREE.Vector3();
  for (const pl of found) {
    pl.getWorldPosition(wp);
    addLightSource(pl);
    pl.position.copy(wp); // 摘下来后用世界坐标(仍是离地高度)
  }
  console.info('点光入池', found.length, '盏 →', LIGHT_POOL, '盏常驻');
}

// world:buildWorld 的产物(它引用到的对象/材质都是"活的",原样保留);worldTops:buildWorld 新建的顶层对象(合批候选);
// preWorldTops:建世界之前就在场景里的顶层对象(不参与小件剔除);keepVisible:远远找人用的标记,不剔
export function batchStaticWorld(world, worldTops, preWorldTops, keepVisible = []) {
  const protect = [], protectMats = new Set();
  const scan = (v, depth) => {
    if (!v || depth > 4) return;
    if (v.isObject3D) { protect.push(v); return; }
    if (v.isMaterial) { protectMats.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) scan(x, depth + 1); return; }
    if (typeof v === 'object' && !(v instanceof THREE.Vector3) && v.constructor === Object) {
      for (const k of Object.keys(v)) if (k !== 'colliders' && k !== 'features' && k !== 'occluders') scan(v[k], depth + 1);
    }
  };
  scan(world, 0);
  for (const m of world.waterMats || []) protectMats.add(m);
  // 夜窗:每户两扇、各一份参数相同的材质,亮度由 sky.js 统一设——并成一份共享材质后窗子就能随房子合批
  const winFlames = new Set();
  let winMat = null;
  const sameWin = (a, b) => a.type === b.type && a.color.equals(b.color) && a.emissive.equals(b.emissive) &&
    a.roughness === b.roughness && a.metalness === b.metalness && !a.map && !b.map;
  for (const t of world.torches || []) {
    if (!t.window || !t.flame || !t.flame.material || !t.flame.material.isMeshStandardMaterial) continue;
    if (!winMat) winMat = t.flame.material;
    else if (t.flame.material !== winMat) {
      if (!sameWin(t.flame.material, winMat)) continue;
      t.flame.material.dispose();
      t.flame.material = winMat;
    }
    winFlames.add(t.flame);
  }
  if (winMat) protectMats.add(winMat);
  const t0 = performance.now();
  const st = staticBatch(scene, worldTops, { groundH, protect: protect.filter((o) => !winFlames.has(o)), protectMats,
    raycastKeep: new Set(world.occluders) });
  console.info('静态合批', st, `${(performance.now() - t0).toFixed(0)}ms`);
  // 没并进去的小件(开局就有的碑、牌、蘑菇、火把头……)交给远景剔除(按画质档的 propFar)
  const keep = new Set(keepVisible);
  console.info('小件远景剔除', registerSmallProps(scene.children.filter((o) => !preWorldTops.has(o) && !keep.has(o))));
}

// 必须对着后处理的离屏目标编译:RenderPass 画进 composer 的渲染目标(不做色调映射、线性输出),
// 对着屏幕编译出来的是另一套程序变体——白编一遍,首帧和首次挥刀/下雨时还得再编。
// 场景里藏着的东西(雨线、按需显示的部件)compile 也会照顾到;拖尾用真实的弧形几何挂进来一起编。
// fx:{ trailMat, burstGeo, burstMats }——刀光材质、法弹碎光几何与要一并预热的特效材质
export function warmShaders({ trailMat, burstGeo, burstMats }) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 1, 18, 1, 0, 2.1), trailMat);
  // 法弹/火球的不透明内核是每发新建、命中即销毁的 MeshBasicMaterial:场上没有别的同类材质时,
  // 程序跟着最后一个用户一起被释放,下一发又得重编。预热编一份且永不 dispose,程序就一直在缓存里
  const boltCore = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const tmp = [ring, ...[...burstMats, boltCore].map((m) => new THREE.Mesh(burstGeo, m))];
  for (const t of tmp) { t.position.set(0, -60, 0); t.userData.noSnap = true; scene.add(t); }
  const rt0 = renderer.getRenderTarget();
  renderer.setRenderTarget(composer.readBuffer);
  try { renderer.compile(scene, camera); } catch (e) { console.warn('预热失败', e); }
  renderer.setRenderTarget(rt0);
  for (const t of tmp) scene.remove(t);
  ring.geometry.dispose();
}
