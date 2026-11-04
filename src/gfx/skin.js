// 刚体蒙皮合批:实体(人形/马/狼/鹿/鸡/羊)照旧用积木层级搭好,再把全部网格合成一个 SkinnedMesh。
//
// 为什么:一个人形 13~19 个网格、一匹马 18 个,几十个实体就是上千次绘制,还要再进阴影 pass 一遍。
// 合并后每个实体主 pass 1 次、阴影 1 次。
//
// 怎么做:
// - 每个部件的顶点按它所挂的"动画节点"做权重 1 的蒙皮(刚体),颜色烘进顶点色,
//   粗糙度/金属度/自发光强度烘进逐顶点属性 aRM——不同材质的部件也能共用一个材质、一次绘制。
// - 动画节点(group 根 + parts 里引用到的 body/head/armL/armR/legL/legR/cape/sword/legs[]…)原样留在层级里,
//   玩法代码照旧改它们的 rotation/position;之后挂上去的武器、蓄力光球等也照常挂、照常画。
//   原来本身就是网格的动画节点(比如 Torso、披风)换成同名同变换的空节点,子节点一并接过去。
// - 骨骼矩阵全场共用一张"调色板"纹理(每个实体占一行),共用一个 Skeleton:每帧只更新/上传一次,
//   每次绘制不再各传一张骨骼纹理。实体的行号放在 bindMatrix[3][3](逐对象 uniform,本来就每次绘制都设)。
// - 动画节点被设为 visible=false(比如玩家换武器后藏起的初始佩剑)时,调色板里写零矩阵,那部分顶点塌成一点,
//   等同隐藏。
// - 所有实体共用一个材质;受击闪白时 main.js 的 ownMaterials 再给那一个实体克隆私有材质(克隆保留补丁)。
// - 卸载走 disposeEntityGroup → releaseSkin;漏掉释放的实体被 GC 后,行号与几何体由 WeakRef/FinalizationRegistry 回收。
import * as THREE from 'three';
import { VertexPBRMaterial, RigidDepthMaterial, plainStandard, bakeVPBR } from './vpbr.js';
import { renderer } from './core.js';

const SLOT_BONES = 12;          // 每个实体最多 12 根骨(人形 9 根)
const ROW = SLOT_BONES * 4;     // 调色板纹理一行 = 一个实体(一根骨 4 个 RGBA 纹素)

// ---- 共享骨骼调色板 ----
let capacity = 0, palette = null, paletteTex = null;
const slots = [];      // 行号 → WeakRef(entry) | null
const freeSlots = [];
export const SKELETON = new THREE.Skeleton([], []);
SKELETON.update = updatePalette;
SKELETON.dispose = () => {}; // 全场共用,单个实体卸载不能把它销毁

function ensureCapacity(n) {
  if (n <= capacity) return;
  let cap = Math.max(64, capacity);
  while (cap < n) cap *= 2;
  const data = new Float32Array(ROW * 4 * cap);
  if (palette) data.set(palette);
  const tex = new THREE.DataTexture(data, ROW, cap, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  if (paletteTex) paletteTex.dispose();
  palette = data;
  paletteTex = tex;
  capacity = cap;
  SKELETON.boneMatrices = data;
  SKELETON.boneTexture = tex;
}
function allocSlot() {
  let s = freeSlots.pop();
  if (s === undefined) {
    s = slots.length;
    slots.push(null);
    ensureCapacity(slots.length);
  }
  return s;
}
// 渲染器每帧(遇到第一个通过剔除的蒙皮网格时)调用一次:把各实体动画节点的世界矩阵写进调色板
function updatePalette() {
  const P = palette;
  if (!P) return;
  for (let s = 0, n = slots.length; s < n; s++) {
    const ref = slots[s];
    if (ref === null) continue;
    const e = ref.deref();
    if (e === undefined) { slots[s] = null; freeSlots.push(s); continue; } // 实体已被回收(没走 dispose)
    const mesh = e.mesh;
    if (!mesh.visible || mesh.layers.mask === 0 || !e.root.visible || e.root.parent === null) continue; // 这帧不画
    const bones = e.bones, chains = e.chains;
    let off = s * ROW * 4;
    for (let b = 0; b < bones.length; b++, off += 16) {
      const ch = chains[b];
      let vis = true;
      for (let k = 0; k < ch.length; k++) if (!ch[k].visible) { vis = false; break; }
      if (vis) P.set(bones[b].matrixWorld.elements, off);
      else P.fill(0, off, off + 16);
    }
  }
  paletteTex.needsUpdate = true;
}
// 漏掉 dispose 的实体:根节点被 GC 后释放它独占的合并几何体(行号由 updatePalette 回收)
const finalizer = typeof FinalizationRegistry === 'function'
  ? new FinalizationRegistry((held) => { if (!held.released) { held.released = true; held.geometry.dispose(); } })
  : null;

// 全场实体共用的材质(颜色在顶点里,material.color 只当整体染色用;克隆出来的私有材质自动带补丁)
export const ENTITY_MAT = new VertexPBRMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 1 });
ENTITY_MAT.userData.shared = true;
const DEPTH_MAT = new RigidDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
DEPTH_MAT.userData.shared = true;

function mergeable(o, root) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) return false;
  const g = o.geometry;
  if (!g || !g.attributes.position || g.attributes.position.count === 0) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) if (!plainStandard(m)) return false;
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; // 建好时就藏着的部件不并(按需显示的)
  return true;
}
const _rootInv = new THREE.Matrix4(), _box = new THREE.Box3();

// model = { group, parts }:就地改造并返回;没得可并(或骨太多)时原样返回
export function rigidSkin(model) {
  const root = model && model.group;
  if (!root) return model;
  const parts = model.parts || {};
  root.updateMatrixWorld(true);
  // 1) 动画节点 = 根 + parts 里引用的、属于本实体的 Object3D
  const inTree = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  const boneSet = new Set([root]);
  const addRef = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { for (const x of v) addRef(x); return; }
    if (v.isObject3D && inTree(v)) boneSet.add(v);
  };
  for (const k of Object.keys(parts)) addRef(parts[k]);
  // 2) 可并的网格
  const meshes = [];
  root.traverse((o) => { if (mergeable(o, root)) meshes.push(o); });
  if (meshes.length < 2) return model;
  const bones = [root];
  root.traverse((o) => { if (o !== root && boneSet.has(o)) bones.push(o); });
  if (bones.length > SLOT_BONES) return model;
  const boneIdx = new Map(bones.map((b, i) => [b, i]));
  const boneInv = bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
  _rootInv.copy(root.matrixWorld).invert();
  // 3) 烘焙:顶点进各自骨骼的本地空间,包围盒按根节点空间累计
  _box.makeEmpty();
  let cast = false, recv = false;
  const items = meshes.map((m) => {
    let b = m;
    while (!boneSet.has(b)) b = b.parent;
    const bi = boneIdx.get(b);
    if (m.castShadow) cast = true;
    if (m.receiveShadow) recv = true;
    return { m, geometry: m.geometry, material: m.material, bone: bi,
      matrix: new THREE.Matrix4().multiplyMatrices(boneInv[bi], m.matrixWorld),
      boxMatrix: new THREE.Matrix4().multiplyMatrices(_rootInv, m.matrixWorld) };
  });
  const geo = bakeVPBR(items, { skin: true, box: _box });
  // 4) 拆掉已并入的网格:作为动画节点(或还带子节点)的换成同变换空节点
  const swap = new Map();
  for (const { m } of items) {
    const parent = m.parent;
    if (boneSet.has(m) || m.children.length) {
      const o = new THREE.Object3D();
      o.name = m.name;
      o.position.copy(m.position);
      o.quaternion.copy(m.quaternion);
      o.scale.copy(m.scale);
      o.visible = m.visible;
      o.userData = m.userData;
      o.matrixAutoUpdate = m.matrixAutoUpdate;
      o.matrix.copy(m.matrix);
      o.matrixWorld.copy(m.matrixWorld);
      while (m.children.length) o.add(m.children[0]);
      parent.children[parent.children.indexOf(m)] = o;
      o.parent = parent;
      m.parent = null;
      swap.set(m, o);
    } else parent.remove(m);
    if (!m.geometry.userData.shared) m.geometry.dispose();
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (mt && !mt.userData.shared) mt.dispose();
  }
  const sw = (o) => swap.get(o) || o;
  for (let i = 0; i < bones.length; i++) bones[i] = sw(bones[i]);
  for (const k of Object.keys(parts)) {
    const v = parts[k];
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) if (v[i] && v[i].isObject3D) v[i] = sw(v[i]); } else if (v && v.isObject3D) parts[k] = sw(v);
  }
  // 掏空了的中间分组(GLB 克隆壳、武器外壳…)不是动画节点就摘掉,省得每帧更新矩阵
  const bonesNow = new Set(bones);
  const prune = (o) => {
    for (let i = o.children.length - 1; i >= 0; i--) prune(o.children[i]);
    if (o !== root && !bonesNow.has(o) && !o.children.length && !o.isMesh && !o.isLight && o.type !== 'Bone' &&
        (o.isGroup || o.type === 'Object3D') && o.parent) o.parent.remove(o);
  };
  prune(root);
  // 5) 蒙皮网格
  const mesh = new THREE.SkinnedMesh(geo, ENTITY_MAT);
  mesh.name = 'skin';
  mesh.skeleton = SKELETON;
  mesh.customDepthMaterial = DEPTH_MAT;
  mesh.castShadow = cast;
  mesh.receiveShadow = recv;
  const sph = new THREE.Sphere();
  _box.getBoundingSphere(sph);
  sph.radius += 0.35; // 抡臂/抬腿的余量
  mesh.boundingSphere = sph;
  root.add(mesh);
  const slot = allocSlot();
  mesh.bindMatrix.identity();
  mesh.bindMatrix.elements[15] = slot * SLOT_BONES;
  const chains = bones.map((b) => { const ch = []; for (let p = b; p && p !== root; p = p.parent) ch.push(p); return ch; });
  const held = { geometry: geo, released: false };
  const entry = { root, mesh, bones, chains, slot, held, lod: 0 };
  slots[slot] = new WeakRef(entry);
  root._skin = entry;
  // 根节点的 visible = 玩法设的可见性 && 远近分级。玩法代码只写不读 group.visible(死亡/隐身/重生),
  // 渲染器读到的是合成后的值:远处(lod 2)整棵子树在主 pass 与阴影 pass 的遍历里直接剪掉,
  // 中距(lod 1,本来就不投影)在阴影 pass 里也剪掉——每个实体十来个节点,几十个实体就是上千次递归
  let gameVis = root.visible;
  Object.defineProperty(root, 'visible', {
    configurable: true,
    enumerable: true,
    get() { return gameVis && entry.lod !== 2 && !(shadowPass && entry.lod === 1); },
    set(v) { gameVis = v; },
  });
  mesh._skin = entry;
  if (finalizer) finalizer.register(root, held, held);
  return model;
}

// 实体卸载:归还调色板行号(几何/材质由 disposeEntityGroup 照常释放)
export function releaseSkin(mesh) {
  const e = mesh && mesh._skin;
  if (!e || e.held.released) return;
  e.held.released = true;
  if (finalizer) finalizer.unregister(e.held);
  if (slots[e.slot] && slots[e.slot].deref() === e) { slots[e.slot] = null; freeSlots.push(e.slot); }
  mesh.visible = false; // 万一还留在场景里:宁可不画,也别借用下一个实体的骨骼
}

// ---- 远近分级:0 近(投影)/ 1 中(不投影)/ 2 远(整体不画) ----
// 远处隐藏走根节点 visible 的访问器(见 rigidSkin):玩法代码写的可见性(死狼、隐身闪烁)与分级互不覆盖
// 阴影 pass 期间为 true(包住渲染器的 shadowMap.render):中距实体在阴影遍历里整棵剪掉
let shadowPass = false;
{
  const sm = renderer.shadowMap, render = sm.render;
  sm.render = function (...args) {
    shadowPass = true;
    try { return render.apply(this, args); } finally { shadowPass = false; }
  };
}
// 远近分级:lod 由根节点的 visible 访问器读取(远处整棵不画);这里只管投影开关与矩阵更新
function applySkinLOD(e, lv) {
  e.lod = lv;
  // 远到不画的实体连矩阵也不算:整棵子树(根 + 十来个骨骼节点 + 挂件)跳过每帧的 updateMatrixWorld。
  // 只对挂在场景顶层的实体这么做;重新进入视距时根节点会带着子节点一起重算
  if (!e.root.parent || e.root.parent.isScene) e.root.matrixWorldAutoUpdate = lv !== 2;
  e.root.traverse((o) => {
    if (!o.isMesh) return;
    const u = o.userData;
    if (u.cast0 === undefined) u.cast0 = o.castShadow;
    o.castShadow = lv === 0 && u.cast0;
  });
}
export function updateSkinLOD(cx, cz, shadowD, hideD) {
  for (let s = 0, n = slots.length; s < n; s++) {
    const ref = slots[s];
    const e = ref && ref.deref();
    if (!e) continue;
    // 挂在场景顶层的实体直接用 position(玩法每帧都写它):matrixWorld 要等渲染才更新,
    // 只跑模拟不渲染的那几帧(加载、测试步进)里它还停在旧位置,传送后会被误判成"远处"藏掉
    const r = e.root;
    let x, z;
    if (!r.parent || r.parent.isScene) { x = r.position.x; z = r.position.z; } else { const m = r.matrixWorld.elements; x = m[12]; z = m[14]; }
    const d = Math.hypot(x - cx, z - cz);
    // 回差:近 6m、远 10m,免得边界上来回切
    const lv = d < shadowD + (e.lod === 0 ? 6 : 0) ? 0 : d < hideD + (e.lod <= 1 ? 10 : 0) ? 1 : 2;
    if (lv !== e.lod) applySkinLOD(e, lv);
  }
}
export function skinStats() {
  let live = 0;
  for (const r of slots) if (r && r.deref()) live++;
  return { live, slots: slots.length, capacity };
}
