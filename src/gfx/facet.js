// 统一着色风格:环境静物(树、岩石、地标、营地与集市道具)一律"刻面"——几何拆成独立三角形、用面法线,
// 和城里的民居(world.prepParts)、程序化岩石/符文立石一个画法;地表、水面、角色与生物保持光滑着色。
// 直接改几何法线(而不是开材质的 flatShading,见 facetKind 下的注意):之后无论被合批、实例化还是烘成顶点色材质,刻面都还在。
import * as THREE from 'three';

// 哪些 GLB 模板属于"环境静物"(models-data 里的键)
export const FACETED_KINDS = new Set(['nature', 'camp', 'props', 'oak', 'pine', 'birch']);

export function facetGeometry(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('normal');
  g.computeVertexNormals(); // 非索引几何:每个三角形三个顶点同一法线 → 刻面
  for (const k of Object.keys(geo.userData)) g.userData[k] = geo.userData[k];
  return g;
}

// 就地把一棵模板树里的网格换成刻面几何(同一几何被多处引用时只转一次)
export function facetModel(root) {
  const done = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry || !o.geometry.attributes.position) return;
    let g = done.get(o.geometry);
    if (!g) { g = facetGeometry(o.geometry); done.set(o.geometry, g); }
    o.geometry = g;
  });
  for (const src of done.keys()) src.dispose();
  return root;
}

export function facetKind(kind, root) {
  if (!FACETED_KINDS.has(kind)) return root;
  return facetModel(root);
}
// 注意:不要再给这些材质开 flatShading。材质端的平直着色靠片元导数现算法线,远处细碎三角形上会算出
// NaN 像素,泛光一模糊就把整屏染黑(实测:王都广场、磨坊方向整帧全黑);刻面只靠几何面法线就够了。

// 给调试/测试用:一个网格是不是刻面(非索引且相邻三顶点法线相同)
export function isFaceted(geo) {
  if (geo.index) return false;
  const n = geo.attributes.normal;
  if (!n || n.count < 3) return false;
  const a = new THREE.Vector3().fromBufferAttribute(n, 0), b = new THREE.Vector3().fromBufferAttribute(n, 1);
  return a.distanceTo(b) < 1e-4;
}
