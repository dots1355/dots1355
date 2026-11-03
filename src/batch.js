// 静态合批:建好的世界里,大多数网格此后再也不会动(城墙、民房、栅栏、树、石头……)。
// 每个网格一次绘制调用,几千个就把 CPU 提交压垮了。这里把它们按"材质签名 × 64m 格"
// 合并成少量大网格:观感不变,绘制次数降一个数量级,64m 格仍能被视锥剔除。
//
// 约定:
// - 只处理调用方给出的顶层对象(buildWorld 新加进场景的那批);
// - protect 里的对象(及其子孙)保持原样:会动的风车叶、宝箱盖、?砖、云、火把火焰、
//   相机遮挡射线要用的墙体等;protectMats 里的材质按身份分组,不与别的材质归并;
// - 透明材质、实例化/蒙皮网格、带子节点的网格不合并;
// - 逻辑 y 是离地高度:合并时把每个顶层对象的地面高度直接烘进顶点(合并结果不再贴地)。
import * as THREE from 'three';
import { mergeGeometries } from '../lib/jsm/utils/BufferGeometryUtils.js';

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];

function texSig(t) {
  return t ? t.uuid : '-';
}
function matSig(m, protectMats) {
  if (protectMats.has(m)) return 'id:' + m.uuid;
  const c = (x) => (x ? x.getHexString() : '-');
  const parts = [m.type, c(m.color), c(m.emissive), m.emissiveIntensity, m.roughness, m.metalness,
    m.side, m.vertexColors, m.flatShading, m.opacity, m.alphaTest, m.fog, m.envMapIntensity,
    m.depthWrite, m.depthTest, m.polygonOffset, m.wireframe, !!m.userData.wettable, m.userData.baseRough];
  for (const k of TEX_SLOTS) parts.push(texSig(m[k]));
  return parts.join('|');
}
function needsUV(m) {
  for (const k of TEX_SLOTS) if (m[k]) return true;
  return false;
}

// 把一份几何体整理成统一的属性集(position/normal[/uv][/color]),非索引的补顺序索引
function normalizeGeo(src, matrix, keepUV, keepColor) {
  const g = new THREE.BufferGeometry();
  const pos = src.attributes.position;
  if (!pos) return null;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  const nor = src.attributes.normal;
  if (nor) {
    const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { N[i * 3] = nor.getX(i); N[i * 3 + 1] = nor.getY(i); N[i * 3 + 2] = nor.getZ(i); }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  }
  if (keepUV) {
    const uv = src.attributes.uv;
    const U = new Float32Array(n * 2);
    if (uv) for (let i = 0; i < n; i++) { U[i * 2] = uv.getX(i); U[i * 2 + 1] = uv.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  }
  if (keepColor) {
    const col = src.attributes.color;
    const C = new Float32Array(n * 3).fill(1);
    if (col) for (let i = 0; i < n; i++) { C[i * 3] = col.getX(i); C[i * 3 + 1] = col.getY(i); C[i * 3 + 2] = col.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  }
  const idx = src.index;
  const I = new Uint32Array(idx ? idx.count : n);
  if (idx) for (let i = 0; i < idx.count; i++) I[i] = idx.getX(i);
  else for (let i = 0; i < n; i++) I[i] = i;
  g.setIndex(new THREE.BufferAttribute(I, 1));
  if (!nor) g.computeVertexNormals();
  g.applyMatrix4(matrix);
  return g;
}

export function staticBatch(scene, tops, { groundH, protect = [], protectMats = new Set(), raycastKeep = new Set(), cell = 64 }) {
  const blocked = new Set();
  for (const o of protect) if (o && o.isObject3D) o.traverse((d) => blocked.add(d));
  const groups = new Map();
  const canon = new Map(); // 签名 → 规范材质(同观感材质合一)
  let candidates = 0;
  for (const T of tops) {
    if (!T.parent || blocked.has(T)) continue;
    const gOff = T.userData.noSnap ? 0 : groundH(T.position.x, T.position.z);
    T.position.y += gOff;
    T.updateMatrixWorld(true);
    T.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.isPoints || m.isLine) return;
      if (blocked.has(m) || m.children.length || m.userData.noBatch) return;
      const mat = m.material;
      if (!mat || Array.isArray(mat) || mat.transparent || mat.isShaderMaterial || mat.isRawShaderMaterial) return;
      if (m.morphTargetInfluences && m.morphTargetInfluences.length) return;
      for (let p = m; p; p = p.parent) if (!p.visible) return; // 隐藏的(按需显示)不并
      if (!m.geometry || !m.geometry.attributes.position) return;
      const sig = matSig(mat, protectMats);
      if (!canon.has(sig)) canon.set(sig, mat);
      const wp = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const key = `${sig}#${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}#${Math.floor(wp.x / cell)},${Math.floor(wp.z / cell)}`;
      if (!groups.has(key)) groups.set(key, { sig, cast: m.castShadow, recv: m.receiveShadow, list: [] });
      groups.get(key).list.push({ m, matrix: m.matrixWorld.clone() });
      candidates++;
    });
    T.position.y -= gOff;
    T.updateMatrixWorld(true);
  }
  let merged = 0, outMeshes = 0;
  const removed = new Set();
  for (const grp of groups.values()) {
    if (grp.list.length < 2) continue;
    const mat = canon.get(grp.sig);
    const keepUV = needsUV(mat), keepColor = !!mat.vertexColors;
    const geos = [];
    for (const it of grp.list) {
      const g = normalizeGeo(it.m.geometry, it.matrix, keepUV, keepColor);
      if (g) geos.push(g);
    }
    if (geos.length < 2) continue;
    const mg = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!mg) continue;
    mg.computeBoundingSphere();
    const mesh = new THREE.Mesh(mg, mat);
    mesh.castShadow = grp.cast;
    mesh.receiveShadow = grp.recv;
    mesh.matrixAutoUpdate = false;
    mesh.userData.noSnap = true;
    mesh.userData.batched = true;
    scene.add(mesh);
    outMeshes++;
    for (const it of grp.list) {
      it.m.parent.remove(it.m);
      // 相机防穿墙射线仍要打在这些墙上:摘下后把烘好的(含地面高度的)世界矩阵定住
      if (raycastKeep.has(it.m)) {
        it.m.matrixWorld.copy(it.matrix);
        it.m.matrixAutoUpdate = false;
        it.m.matrixWorldAutoUpdate = false;
      }
      removed.add(it.m);
      merged++;
    }
  }
  // 掏空了的顶层分组(只剩空壳)也摘掉,省得每帧遍历
  let emptied = 0;
  for (const T of tops) {
    if (!T.parent || T.isMesh || T.isLight) continue;
    let live = false;
    T.traverse((d) => { if (d !== T && !d.isGroup && d.type !== 'Object3D') live = true; });
    if (!live) { T.parent.remove(T); emptied++; }
  }
  // 没并进去的静态顶层对象(独一份材质的路面、招牌等):地面高度直接烘进位置,不再参与每帧贴地,
  // 矩阵也冻结(子树里有"活"对象的不冻,比如带转动风车叶的风车)
  let frozen = 0;
  for (const T of tops) {
    if (!T.parent || T.isLight || blocked.has(T)) continue;
    let live = false;
    T.traverse((d) => { if (blocked.has(d) || d.isLight) live = true; });
    if (live) continue;
    if (!T.userData.noSnap) {
      T.position.y += groundH(T.position.x, T.position.z);
      T.userData.noSnap = true;
    }
    T.updateMatrixWorld(true);
    T.traverse((d) => { d.matrixAutoUpdate = false; d.matrixWorldAutoUpdate = false; });
    frozen++;
  }
  return { candidates, merged, outMeshes, emptied, frozen, materials: canon.size };
}
