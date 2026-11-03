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

// ---- 着色器补丁:单骨刚体蒙皮 + 逐顶点粗糙度/金属度/自发光 + 顶点色平方解码 ----
const SKIN_BASE = `#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( bindMatrix[ 3 ][ 3 ] + skinIndex.x );
#endif`;
const SKIN_NORMAL = `#ifdef USE_SKINNING
	mat4 skinMatrix = bindMatrixInverse * boneMatX;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`;
const SKINNING = `#ifdef USE_SKINNING
	transformed = ( bindMatrixInverse * ( boneMatX * vec4( transformed, 1.0 ) ) ).xyz;
#endif`;
function patchSkinning(src) {
  return src.replace('#include <skinbase_vertex>', SKIN_BASE)
    .replace('#include <skinnormal_vertex>', SKIN_NORMAL)
    .replace('#include <skinning_vertex>', SKINNING);
}
// 子类而不是给实例挂 onBeforeCompile:clone() 出来的私有材质(闪白、幽灵半透明、金鸡染色)自动带着补丁
export class EntityMaterial extends THREE.MeshStandardMaterial {
  constructor(params) {
    super(params);
    this.isEntityMaterial = true;
  }
  // 克隆出来的一律是某个实体的私有材质:去掉共享标记,卸载时才会被释放
  copy(src) {
    super.copy(src);
    delete this.userData.shared;
    return this;
  }
  onBeforeCompile(sh) {
    sh.vertexShader = 'attribute vec3 aRM;\nvarying vec3 vRM;\n' + patchSkinning(sh.vertexShader)
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n\tvColor *= vColor;\n#endif\n\tvRM = aRM;');
    sh.fragmentShader = 'varying vec3 vRM;\n' + sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor *= vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor *= vRM.y;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance += vColor * ( vRM.z * 4.0 );\n#endif');
  }
  customProgramCacheKey() { return 'ent-rigid-1'; }
}
class EntityDepthMaterial extends THREE.MeshDepthMaterial {
  onBeforeCompile(sh) { sh.vertexShader = patchSkinning(sh.vertexShader); }
  customProgramCacheKey() { return 'ent-rigid-depth-1'; }
}
// 全场实体共用的材质(颜色在顶点里,material.color 只当整体染色用)
export const ENTITY_MAT = new EntityMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 1 });
ENTITY_MAT.userData.shared = true;
const DEPTH_MAT = new EntityDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
DEPTH_MAT.userData.shared = true;

// ---- 合并 ----
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
  'bumpMap', 'displacementMap', 'lightMap', 'envMap'];
function plainStandard(m) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isEntityMaterial) return false;
  if (m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.wireframe || !m.visible || m.flatShading) return false;
  if (!m.depthTest || !m.depthWrite || !m.colorWrite || m.polygonOffset || m.fog === false) return false;
  if (m.blending !== THREE.NormalBlending) return false;
  for (const k of TEX_SLOTS) if (m[k]) return false;
  return true;
}
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
const _col = new THREE.Color(), _em = new THREE.Color();
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _nm = new THREE.Matrix3(), _rootInv = new THREE.Matrix4(), _box = new THREE.Box3();
const enc = (x) => Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, x)) * 255)));
const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
// 材质 → 每顶点 [r,g,b(平方根编码), 粗糙度, 金属度, 自发光强度/4]
function matCode(m) {
  _col.copy(m.color);
  _em.copy(m.emissive).multiplyScalar(m.emissiveIntensity);
  const emax = Math.max(_em.r, _em.g, _em.b);
  const cmax = Math.max(_col.r, _col.g, _col.b, 0.04);
  const ek = emax > 0 ? Math.min(4, emax / cmax) : 0;
  return [enc(_col.r), enc(_col.g), enc(_col.b), u8(m.roughness), u8(m.metalness), u8(ek / 4)];
}

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
  // 3) 逐网格统计
  let nv = 0, ni = 0;
  const items = meshes.map((m) => {
    let b = m;
    while (!boneSet.has(b)) b = b.parent;
    const bi = boneIdx.get(b);
    const rel = new THREE.Matrix4().multiplyMatrices(boneInv[bi], m.matrixWorld);
    const toRoot = new THREE.Matrix4().multiplyMatrices(_rootInv, m.matrixWorld);
    let g = m.geometry;
    if (!g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
    const n = g.attributes.position.count;
    const ic = g.index ? g.index.count : n - (n % 3);
    const it = { m, g, bi, rel, toRoot, n, ic, v0: nv };
    nv += n;
    ni += ic;
    return it;
  });
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const C = new Uint8Array(nv * 3), RM = new Uint8Array(nv * 3), SI = new Uint8Array(nv);
  const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  _box.makeEmpty();
  let io = 0;
  let cast = false, recv = false;
  for (const it of items) {
    const { m, g, bi, rel, toRoot, n, v0 } = it;
    if (m.castShadow) cast = true;
    if (m.receiveShadow) recv = true;
    const pos = g.attributes.position, nor = g.attributes.normal;
    _nm.getNormalMatrix(rel);
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i);
      _box.expandByPoint(_n.copy(_v).applyMatrix4(toRoot));
      _v.applyMatrix4(rel);
      const o3 = (v0 + i) * 3;
      P[o3] = _v.x; P[o3 + 1] = _v.y; P[o3 + 2] = _v.z;
      _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      N[o3] = _n.x; N[o3 + 1] = _n.y; N[o3 + 2] = _n.z;
      SI[v0 + i] = bi;
    }
    // 颜色/粗糙度/金属度:多材质网格按 groups 分段涂
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const vcol = g.attributes.color;
    const paint = (code, mat, a, b) => {
      for (let i = a; i < b; i++) {
        const o3 = (v0 + i) * 3;
        if (vcol && mat.vertexColors) {
          C[o3] = enc(mat.color.r * vcol.getX(i));
          C[o3 + 1] = enc(mat.color.g * vcol.getY(i));
          C[o3 + 2] = enc(mat.color.b * vcol.getZ(i));
        } else { C[o3] = code[0]; C[o3 + 1] = code[1]; C[o3 + 2] = code[2]; }
        RM[o3] = code[3]; RM[o3 + 1] = code[4]; RM[o3 + 2] = code[5];
      }
    };
    if (mats.length > 1 && g.groups.length) {
      for (const grp of g.groups) {
        const mat = mats[grp.materialIndex] || mats[0];
        const code = matCode(mat);
        const end = Math.min(grp.start + grp.count, g.index ? g.index.count : n);
        for (let k = grp.start; k < end; k++) {
          const vi = g.index ? g.index.getX(k) : k;
          paint(code, mat, vi, vi + 1);
        }
      }
    } else paint(matCode(mats[0]), mats[0], 0, n);
    // 索引(镜像变换要翻转绕序,否则双面材质会按背面打光)
    const flip = rel.determinant() < 0;
    const idx = g.index;
    for (let k = 0; k < it.ic; k += 3) {
      const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
      I[io++] = v0 + a;
      I[io++] = v0 + (flip ? c : b);
      I[io++] = v0 + (flip ? b : c);
    }
    if (g !== m.geometry) g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3, true));
  geo.setAttribute('aRM', new THREE.BufferAttribute(RM, 3, true));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 1));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
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
// 用 layers 隐藏而不是 visible:玩法代码自己会改 visible(死狼、隐身闪烁),两边互不干扰
function applySkinLOD(e, lv) {
  e.lod = lv;
  e.root.traverse((o) => {
    if (!o.isMesh) return;
    const u = o.userData;
    if (u.cast0 === undefined) u.cast0 = o.castShadow;
    o.castShadow = lv === 0 && u.cast0;
    if (lv === 2) {
      if (u.lm0 === undefined) { u.lm0 = o.layers.mask; o.layers.mask = 0; }
    } else if (u.lm0 !== undefined) { o.layers.mask = u.lm0; delete u.lm0; }
  });
}
export function updateSkinLOD(cx, cz, shadowD, hideD) {
  for (let s = 0, n = slots.length; s < n; s++) {
    const ref = slots[s];
    const e = ref && ref.deref();
    if (!e) continue;
    const m = e.root.matrixWorld.elements;
    const d = Math.hypot(m[12] - cx, m[14] - cz);
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
