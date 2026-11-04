// 静态合批:建好的世界里,大多数网格此后再也不会动(城墙、民房、栅栏、树、石头……)。
// 每个网格一次绘制调用,几千个就把 CPU 提交压垮了。这里把它们按"材质签名 × 64m 格"
// 合并成少量大网格:观感不变,绘制次数降一个数量级,64m 格仍能被视锥剔除。
//
// 约定:
// - 只处理调用方给出的顶层对象(buildWorld 新加进场景的那批);
// - protect 里的对象(及其子孙)保持原样:会动的风车叶、宝箱盖、?砖、云、火把火焰、
//   相机遮挡射线要用的墙体等;protectMats 里的材质按身份分组,不与别的材质归并;
//   受保护对象内部"跟着它一起动"的静态子件(风车的四片叶、宝箱的箱体、一朵云的几团)就地合成一个子网格;
// - 颜色不进签名:颜色烘进顶点色。无贴图的朴素标准材质连粗糙度/金属度也进顶点(gfx/vpbr.js),
//   同一格同一面向的全并成一个;带贴图的按"贴图 + 参数(不含颜色)"归并;
// - 透明材质、实例化/蒙皮网格、带子节点的网格不合并;
// - 逻辑 y 是离地高度:合并时把每个顶层对象的地面高度直接烘进顶点(合并结果不再贴地)。
import * as THREE from 'three';
import { mergeGeometries } from '../lib/jsm/utils/BufferGeometryUtils.js';
import { plainStandard, vpbrMaterial, bakeVPBR } from './gfx/vpbr.js';
import { NIGHT_GLOW } from './flora.js';

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
const q = (x) => Math.round(x * 20) / 20; // 粗糙度/金属度按 0.05 归档,近似值合一

// 贴图按"图源 + 采样参数"认:同一张图各自 clone 出来设 repeat 的材质(texMat)也能归并
function texSig(t) {
  if (!t) return '-';
  return [t.source ? t.source.uuid : t.uuid, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation, t.center.x, t.center.y,
    t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.anisotropy, t.flipY, t.colorSpace, t.channel].join(':');
}
// 签名不含颜色(颜色进顶点色);无贴图朴素材质整类合一
function matSig(m, protectMats) {
  if (protectMats.has(m)) return 'id:' + m.uuid;
  if (plainStandard(m, { allowFlat: true, allowEmissive: false })) return `vpbr|${m.side}|${m.userData.wettable ? 1 : 0}`;
  const c = (x) => (x ? x.getHexString() : '-');
  const parts = [m.type, c(m.emissive), m.emissiveIntensity, q(m.roughness ?? 0), q(m.metalness ?? 0),
    m.side, m.vertexColors, m.flatShading, m.opacity, m.alphaTest, m.fog, m.envMapIntensity,
    m.depthWrite, m.depthTest, m.polygonOffset, m.wireframe, !!m.userData.wettable, m.userData.baseRough];
  for (const k of TEX_SLOTS) parts.push(texSig(m[k]));
  return parts.join('|');
}
function needsUV(m) {
  for (const k of TEX_SLOTS) if (m[k]) return true;
  return false;
}
function eligible(m, blocked) {
  if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m.isPoints || m.isLine) return false;
  if ((blocked && blocked.has(m)) || m.children.length || m.userData.noBatch) return false;
  const mat = m.material;
  if (!mat || Array.isArray(mat) || mat.transparent || mat.isShaderMaterial || mat.isRawShaderMaterial) return false;
  if (m.morphTargetInfluences && m.morphTargetInfluences.length) return false;
  return !!(m.geometry && m.geometry.attributes.position);
}

// 把一份几何体整理成统一的属性集(position/normal[/uv][/color]),非索引的补顺序索引;
// tint 给了就把材质颜色乘进顶点色(多种颜色并成一个白色材质时用)
function normalizeGeo(src, matrix, keepUV, keepColor, tint) {
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
    const col = tint && !tint.vertexColors ? null : src.attributes.color;
    const C = new Float32Array(n * 3).fill(1);
    if (col) for (let i = 0; i < n; i++) { C[i * 3] = col.getX(i); C[i * 3 + 1] = col.getY(i); C[i * 3 + 2] = col.getZ(i); }
    if (tint) for (let i = 0; i < n; i++) { C[i * 3] *= tint.color.r; C[i * 3 + 1] *= tint.color.g; C[i * 3 + 2] *= tint.color.b; }
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

// 一组同签名的网格合成一个网格;list: [{ m, matrix }](matrix:几何本地 → 输出空间)
function mergeGroup(sig, list, canonOf) {
  const first = list[0].m.material;
  if (sig.startsWith('vpbr|')) {
    const geo = bakeVPBR(list.map((it) => ({ geometry: it.m.geometry, material: it.m.material, matrix: it.matrix })));
    return new THREE.Mesh(geo, vpbrMaterial({ side: first.side, wettable: !!first.userData.wettable }));
  }
  // 带贴图/特殊参数的:同一个材质对象就照旧用它;不同颜色的多份材质并成一份白色顶点色材质
  const mats = new Set(list.map((it) => it.m.material));
  const multi = mats.size > 1 && !sig.startsWith('id:');
  let mat = first;
  if (multi) {
    mat = canonOf.get(sig);
    if (!mat) {
      mat = first.clone();
      mat.color.set(0xffffff);
      mat.vertexColors = true;
      canonOf.set(sig, mat);
    }
  }
  const keepUV = needsUV(first), keepColor = multi || !!first.vertexColors;
  const geos = [];
  for (const it of list) {
    const g = normalizeGeo(it.m.geometry, it.matrix, keepUV, keepColor, multi ? it.m.material : null);
    if (g) geos.push(g);
  }
  if (geos.length < 2) { for (const g of geos) g.dispose(); return null; }
  const mg = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return mg ? new THREE.Mesh(mg, mat) : null;
}

// 受保护对象内部的静态子件:相对它不动,就地并成它的子网格(风车叶、宝箱体、一朵云的几团)
function localMerge(P, blockedSelfs, protectMats, canonOf) {
  P.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(P.matrixWorld).invert();
  const groups = new Map();
  const walk = (o) => {
    for (const c of o.children) {
      if (blockedSelfs.has(c)) continue; // 嵌套的受保护对象(宝箱盖)自己处理
      if (c.visible === false) continue;
      if (eligible(c, null)) {
        const sig = matSig(c.material, protectMats);
        // 一件东西内部的小零件(锁扣、铆钉)投不投影无所谓:按"有一件投影就投影"并在一起
        if (!groups.has(sig)) groups.set(sig, { sig, cast: false, recv: false, list: [] });
        const grp = groups.get(sig);
        grp.cast = grp.cast || c.castShadow;
        grp.recv = grp.recv || c.receiveShadow;
        grp.list.push({ m: c, matrix: new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld) });
      } else walk(c);
    }
  };
  walk(P);
  let merged = 0;
  for (const grp of groups.values()) {
    if (grp.list.length < 2) continue;
    const mesh = mergeGroup(grp.sig, grp.list, canonOf);
    if (!mesh) continue;
    mesh.geometry.computeBoundingSphere();
    mesh.castShadow = grp.cast;
    mesh.receiveShadow = grp.recv;
    mesh.matrixAutoUpdate = false;
    mesh.userData.batched = true;
    for (const it of grp.list) { it.m.parent.remove(it.m); merged++; }
    P.add(mesh);
  }
  return merged;
}

export function staticBatch(scene, tops, { groundH, protect = [], protectMats = new Set(), raycastKeep = new Set(), cell = 64 }) {
  for (const m of NIGHT_GLOW) protectMats.add(m); // 路灯/神龛的玻璃按昼夜调亮度:必须保持原材质
  const blocked = new Set();
  const protSelf = new Set();
  for (const o of protect) if (o && o.isObject3D) { protSelf.add(o); o.traverse((d) => blocked.add(d)); }
  const groups = new Map();
  const canonOf = new Map(); // 签名 → 合并后的规范材质
  let candidates = 0;
  for (const T of tops) {
    if (!T.parent || blocked.has(T)) continue;
    const gOff = T.userData.noSnap ? 0 : groundH(T.position.x, T.position.z);
    T.position.y += gOff;
    T.updateMatrixWorld(true);
    T.traverse((m) => {
      if (!eligible(m, blocked)) return;
      for (let p = m; p; p = p.parent) if (!p.visible) return; // 隐藏的(按需显示)不并
      const sig = matSig(m.material, protectMats);
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
  for (const grp of groups.values()) {
    if (grp.list.length < 2) continue;
    const mesh = mergeGroup(grp.sig, grp.list, canonOf);
    if (!mesh) continue;
    mesh.geometry.computeBoundingSphere();
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
      merged++;
    }
  }
  // 受保护对象内部就地合并
  let local = 0;
  for (const P of protSelf) if (P.parent || P.isScene) local += localMerge(P, protSelf, protectMats, canonOf);
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
  return { candidates, merged, local, outMeshes, emptied, frozen, materials: canonOf.size };
}
