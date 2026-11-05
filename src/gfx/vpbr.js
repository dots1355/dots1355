// 顶点色 PBR:把"只差颜色/粗糙度/金属度"的一堆朴素材质并成一个材质、一次绘制。
// 颜色(平方根编码,暗部不掉精度)烘进 color,粗糙度/金属度/自发光强度烘进 aRM(都是 8 位归一化),
// 着色器里再乘回来。实体合批(skin.js)、静态合批(batch.js)、地标实例化(flora.js)与荒野区块共用。
// 同一个补丁里还带"单骨刚体蒙皮"(只在 USE_SKINNING 时生效):骨骼行号放在 bindMatrix[3][3]。
import * as THREE from 'three';
import { ENTITY_DETAIL_COLOR, ENTITY_DETAIL_PARS, STATIC_DETAIL_COLOR } from './surface.js';

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
export class VertexPBRMaterial extends THREE.MeshStandardMaterial {
  constructor(params) {
    super(params);
    this.isVertexPBRMaterial = true;
  }
  // 克隆出来的一律是私有材质:去掉共享标记,卸载时才会被释放
  copy(src) {
    super.copy(src);
    delete this.userData.shared;
    return this;
  }
  onBeforeCompile(sh) {
    // 蒙皮实体(角色/生物)另带程序化质感(gfx/surface.js):骨骼本地坐标交给片元;片元里没有 USE_SKINNING,
    // 用一个整批相同的 varying 开关(静态合批/实例化走同一个材质类,但不画质感)
    sh.vertexShader = 'attribute vec3 aRM;\nvarying vec3 vRM;\nvarying vec3 vObjP;\nvarying float vEdOn;\n' + patchSkinning(sh.vertexShader)
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n\tvColor *= vColor;\n#endif\n\tvRM = aRM;\n\tvObjP = position;\n' +
        '#ifdef USE_SKINNING\n\tvEdOn = 1.0;\n#else\n\tvEdOn = 0.0;\n#endif');
    sh.fragmentShader = 'varying vec3 vRM;\nvarying float vEdOn;\n' + ENTITY_DETAIL_PARS + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tif ( vEdOn > 0.5 ) ' + ENTITY_DETAIL_COLOR + '\n\telse ' + STATIC_DETAIL_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor *= vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor *= vRM.y;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance += vColor * ( vRM.z * 4.0 );\n#endif');
  }
  customProgramCacheKey() { return 'vpbr-3'; }
}
// 阴影深度:只需要刚体蒙皮的补丁(实例化/普通网格用渲染器自带的深度材质即可)
export class RigidDepthMaterial extends THREE.MeshDepthMaterial {
  onBeforeCompile(sh) { sh.vertexShader = patchSkinning(sh.vertexShader); }
  customProgramCacheKey() { return 'vpbr-depth-1'; }
}
// 实例化网格专用的阴影深度材质:渲染器自带的那一个被普通/实例化/蒙皮网格轮流用,每次切换都要重查程序
export const INSTANCED_DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
INSTANCED_DEPTH.userData.shared = true;
// 共享的顶点色 PBR 材质(按面向/是否淋雨变滑区分;flatShading 的部件在烘焙时改成面法线)。
// 实例化与普通网格各用一份:同一个材质对象交替画两种网格,渲染器每次切换都要重新查找着色器程序
const shared = new Map();
export function vpbrMaterial({ side = THREE.FrontSide, wettable = false, instanced = false } = {}) {
  const key = side + '|' + (wettable ? 1 : 0) + '|' + (instanced ? 1 : 0);
  let m = shared.get(key);
  if (!m) {
    m = new VertexPBRMaterial({ vertexColors: true, side, roughness: 1, metalness: 1 });
    m.userData.shared = true;
    if (wettable) { m.userData.wettable = true; m.userData.baseRough = 1; } // 雨天按比例压低每个顶点的粗糙度
    shared.set(key, m);
  }
  return m;
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
  'bumpMap', 'displacementMap', 'lightMap', 'envMap'];
// 能并进顶点色 PBR 的"朴素"标准材质:无贴图、不透明、常规混合与深度
export function plainStandard(m, { allowFlat = false, allowEmissive = true } = {}) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isVertexPBRMaterial) return false;
  if (m.transparent || m.opacity < 1 || m.alphaTest > 0 || m.wireframe || !m.visible) return false;
  if (m.flatShading && !allowFlat) return false;
  if (!m.depthTest || !m.depthWrite || !m.colorWrite || m.polygonOffset || m.fog === false) return false;
  if (m.blending !== THREE.NormalBlending || m.vertexColors) return false;
  if (!allowEmissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) return false;
  for (const k of TEX_SLOTS) if (m[k]) return false;
  return true;
}
const _col = new THREE.Color(), _em = new THREE.Color();
const enc = (x) => Math.max(0, Math.min(255, Math.round(Math.sqrt(Math.max(0, x)) * 255)));
const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
// 材质 → 每顶点 [r,g,b(平方根编码), 粗糙度, 金属度, 自发光强度/4](自发光按"本色 × 强度"近似)
export function vpbrCode(m) {
  _col.copy(m.color);
  _em.copy(m.emissive).multiplyScalar(m.emissiveIntensity);
  const emax = Math.max(_em.r, _em.g, _em.b);
  const cmax = Math.max(_col.r, _col.g, _col.b, 0.04);
  const ek = emax > 0 ? Math.min(4, emax / cmax) : 0;
  return [enc(_col.r), enc(_col.g), enc(_col.b), u8(m.roughness), u8(m.metalness), u8(ek / 4)];
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _nm = new THREE.Matrix3();
// 直接读的顶点数组(非交错 Float32、3 分量)才走快路径,否则逐个取
const raw3 = (attr) => (!attr.isInterleavedBufferAttribute && attr.itemSize === 3 && attr.array instanceof Float32Array && !attr.normalized
  ? attr.array : null);
// items: [{ geometry, material(或数组 + geometry.groups), matrix(几何本地 → 输出空间), bone?, boxMatrix? }]
// 返回带 position/normal/color/aRM(/skinIndex)/index 的几何;box 给了就把顶点(按 boxMatrix 或 matrix)扩进去
export function bakeVPBR(items, opts) {
  const it = bakeVPBRSteps(items, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
// 可分帧的版本:每烘完约 chunk 个顶点 yield 一次(荒野区块用它把重活摊到多帧)
export function* bakeVPBRSteps(items, { skin = false, box = null, chunk = Infinity } = {}) {
  let nv = 0, ni = 0;
  const prep = items.map((item) => {
    let g = item.geometry;
    if (!g.attributes.normal) { g = g.clone(); g.computeVertexNormals(); }
    const mats = Array.isArray(item.material) ? item.material : [item.material];
    const flat = mats.some((m) => m.flatShading);
    const n = g.attributes.position.count;
    const ic = g.index ? g.index.count : n - (n % 3);
    const p = { item, g, mats, flat, n, ic, v0: nv };
    nv += flat ? ic : n; // 面法线要拆成独立顶点
    ni += ic;
    return p;
  });
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  const C = new Uint8Array(nv * 3), RM = new Uint8Array(nv * 3), SI = skin ? new Uint8Array(nv) : null;
  const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
  let io = 0, done = 0;
  for (const { item, g, mats, flat, n, ic, v0 } of prep) {
    const matrix = item.matrix, e = matrix.elements;
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
    const flip = matrix.determinant() < 0; // 镜像变换:翻转绕序,否则按背面打光
    // 每个原顶点(或面拆开后的每个角)对应的材质编码
    const codes = mats.map(vpbrCode);
    let matOf = null;
    if (mats.length > 1 && g.groups.length) {
      matOf = new Uint8Array(flat ? ic : n);
      for (const grp of g.groups) {
        const end = Math.min(grp.start + grp.count, idx ? idx.count : n);
        for (let k = grp.start; k < end; k++) matOf[flat ? k : (idx ? idx.getX(k) : k)] = Math.min(mats.length - 1, grp.materialIndex);
      }
    }
    const bone = item.bone || 0;
    const fill = (o0, cnt, code) => { // 连续一段顶点涂同一个材质编码
      for (let o = o0; o < o0 + cnt; o++) {
        const o3 = o * 3;
        C[o3] = code[0]; C[o3 + 1] = code[1]; C[o3 + 2] = code[2];
        RM[o3] = code[3]; RM[o3 + 1] = code[4]; RM[o3 + 2] = code[5];
      }
      if (SI) SI.fill(bone, o0, o0 + cnt);
    };
    if (box) {
      const bm = item.boxMatrix || matrix;
      for (let i = 0; i < n; i++) box.expandByPoint(_v.fromBufferAttribute(pos, i).applyMatrix4(bm));
    }
    if (!flat) {
      _nm.getNormalMatrix(matrix);
      const m = _nm.elements;
      const pa = raw3(pos), na = raw3(nor);
      for (let i = 0; i < n; i++) {
        let x, y, z, nx, ny, nz;
        if (pa) { x = pa[i * 3]; y = pa[i * 3 + 1]; z = pa[i * 3 + 2]; } else { x = pos.getX(i); y = pos.getY(i); z = pos.getZ(i); }
        if (na) { nx = na[i * 3]; ny = na[i * 3 + 1]; nz = na[i * 3 + 2]; } else { nx = nor.getX(i); ny = nor.getY(i); nz = nor.getZ(i); }
        const o3 = (v0 + i) * 3;
        P[o3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        P[o3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        P[o3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const tx = m[0] * nx + m[3] * ny + m[6] * nz, ty = m[1] * nx + m[4] * ny + m[7] * nz, tz = m[2] * nx + m[5] * ny + m[8] * nz;
        const l = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
        N[o3] = tx * l; N[o3 + 1] = ty * l; N[o3 + 2] = tz * l;
      }
      if (matOf) for (let i = 0; i < n; i++) fill(v0 + i, 1, codes[matOf[i]]);
      else fill(v0, n, codes[0]);
      const ia = idx ? idx.array : null;
      for (let k = 0; k < ic; k += 3) {
        const a = ia ? ia[k] : k, b = ia ? ia[k + 1] : k + 1, c = ia ? ia[k + 2] : k + 2;
        I[io++] = v0 + a;
        I[io++] = v0 + (flip ? c : b);
        I[io++] = v0 + (flip ? b : c);
      }
    } else {
      for (let k = 0; k < ic; k += 3) {
        const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
        _a.fromBufferAttribute(pos, a).applyMatrix4(matrix);
        _b.fromBufferAttribute(pos, b).applyMatrix4(matrix);
        _c.fromBufferAttribute(pos, c).applyMatrix4(matrix);
        _n.subVectors(_c, _b).cross(_v.subVectors(_a, _b)).normalize();
        if (flip) _n.negate();
        const tri = flip ? [_a, _c, _b] : [_a, _b, _c];
        for (let j = 0; j < 3; j++) {
          const o = v0 + k + j;
          P[o * 3] = tri[j].x; P[o * 3 + 1] = tri[j].y; P[o * 3 + 2] = tri[j].z;
          N[o * 3] = _n.x; N[o * 3 + 1] = _n.y; N[o * 3 + 2] = _n.z;
          I[io++] = o;
        }
        fill(v0 + k, 3, codes[matOf ? matOf[k] : 0]);
      }
    }
    if (g !== item.geometry) g.dispose();
    done += flat ? ic : n;
    if (done >= chunk) { done = 0; yield; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(C, 3, true));
  geo.setAttribute('aRM', new THREE.BufferAttribute(RM, 3, true));
  if (SI) geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 1));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  return geo;
}
