// 统一水体着色:湖 / 河 / 喷泉 / 沼泽水塘 / 冰面共用一个着色器(各自一份材质参数,同一个程序)
// - 按水深变色:浅处透出水底(岸边柔和淡出),深处转成暗青;深度来自地形(地形挖成盆地)
// - 菲涅尔反射天空色(天顶/地平线随昼夜、群系),太阳高光;两层滚动法线 + 河流顺流
// - 岸边泡沫带、雨天涟漪、沼泽浮萍、冰面裂纹;低饱和配色,融进北境的灰调里
// 盆地里的水面网格是绝对坐标(noSnap);水深属性 aDepth 取盆地的解析深度(平滑,不露出地形 4m 网格的棱角)。
import * as THREE from 'three';
import { skyUniforms, sun } from '../systems/sky.js';
import { weather } from '../systems/weather.js';

const shared = {
  uTime: { value: 0 },
  uSkyTop: { value: new THREE.Color(0x5d86b8) },
  uSkyHor: { value: new THREE.Color(0xd0dbe2) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uRain: { value: 0 },
  uNormal: { value: null },
};

const VERT = `
  attribute float aDepth;
  attribute vec2 aFlow;
  varying float vDepth;
  varying vec2 vFlow;
  varying vec3 vW;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vDepth = aDepth;
    vFlow = aFlow;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = `
  uniform float uTime, uRain, uMurk, uWave, uDuck, uIce, uFoam, uAlpha;
  uniform vec3 uSkyTop, uSkyHor, uSunDir, uSunCol, uShallow, uDeep;
  uniform sampler2D uNormal;
  varying float vDepth;
  varying vec2 vFlow;
  varying vec3 vW;
  #include <fog_pars_fragment>
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // 雨点涟漪:每个 0.8m 格子里一圈不断扩散的环
  vec2 ripples(vec2 p) {
    vec2 acc = vec2(0.0);
    for (int k = 0; k < 2; k++) {
      vec2 q = p * (1.25 + float(k) * 0.55) + float(k) * 7.3;
      vec2 c = floor(q);
      vec2 o = vec2(wHash(c), wHash(c + 3.7)) * 0.6 + 0.2;
      float ph = fract(uTime * 0.9 + wHash(c + 11.1));
      vec2 dv = q - c - o;
      float d = length(dv);
      float ring = sin((d - ph * 0.5) * 52.0) * exp(-abs(d - ph * 0.5) * 18.0) * (1.0 - ph);
      acc += dv / max(d, 1e-3) * ring;
    }
    return acc;
  }
  void main() {
    float depth = max(vDepth, 0.0);
    vec3 V = normalize(cameraPosition - vW);
    vec2 p = vW.xz;
    vec2 flow = vFlow * uTime;
    vec2 n1 = texture2D(uNormal, p * 0.09 + vec2(uTime * 0.011, uTime * 0.007) - flow * 0.09).xy * 2.0 - 1.0;
    vec2 n2 = texture2D(uNormal, p * 0.21 - vec2(uTime * 0.008, -uTime * 0.012) - flow * 0.16).xy * 2.0 - 1.0;
    vec2 nxy = (n1 + n2) * uWave * (1.0 + uRain * 0.8);
    nxy += ripples(p) * 0.35 * uRain * (1.0 - uIce);
    vec3 N = normalize(vec3(nxy.x, 1.0, nxy.y));
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
    // 水色随深度加深;深浅再按 ~20m 的大斑块浮动(水草、淤泥):圆湖从高处看不再是一圈圈的靶心
    float dk = 1.0 - exp(-depth * uMurk * (0.75 + 0.5 * wNoise(p * 0.05 + 3.0)));
    vec3 light = uSkyHor * 0.42 + uSkyTop * 0.18 + uSunCol * max(uSunDir.y, 0.0) * 0.5;
    // 浅水底:细沙纹 + 斑驳(水下不再透出 4m 地形网格的三角明暗)
    vec3 shallowC = uShallow * (0.86 + 0.22 * wNoise(p * 1.6 + flow * 0.2) + 0.08 * sin(p.x * 3.1 + wNoise(p * 0.7) * 6.0));
    vec3 body = mix(shallowC, uDeep, dk) * light;
    vec3 col = mix(body, sky, fres * 0.85);
    col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 260.0) * 2.4 * (1.0 - uRain * 0.75) * (1.0 - uIce);
    // 岸边泡沫:最浅的一条带,碎成斑驳
    float foam = (1.0 - smoothstep(0.02, 0.16, depth)) * smoothstep(0.55, 0.85, wNoise(p * 3.1 + flow * 0.5 + uTime * 0.25)) * uFoam;
    col = mix(col, vec3(0.78, 0.8, 0.76) * light * 1.2, foam * 0.35);
    // 浮萍:成片的小绿点
    float duck = uDuck * smoothstep(0.52, 0.64, wNoise(p * 0.32 + 4.0)) * smoothstep(0.42, 0.72, wNoise(p * 4.3)) * (0.75 + 0.25 * wNoise(p * 11.0));
    col = mix(col, vec3(0.16, 0.21, 0.07) * light * 1.15, duck);
    float alpha = smoothstep(0.0, 0.32, depth) * mix(0.8, 1.0, dk * dk); // 深处不透:看不见盆底的坡与台阶
    alpha = max(alpha, fres * 0.9 * smoothstep(0.0, 0.12, depth));
    alpha = max(alpha, max(duck, foam * 0.7) * smoothstep(0.0, 0.05, depth));
    // 冰面:不透明的蓝白冰,浅色裂纹与积雪斑
    if (uIce > 0.5) {
      float cr = abs(wNoise(p * 0.9) - 0.5) + abs(wNoise(p * 2.3 + 9.0) - 0.5) * 0.5;
      float crack = 1.0 - smoothstep(0.015, 0.05, cr);
      float snow = smoothstep(0.55, 0.75, wNoise(p * 0.45 + 2.0));
      vec3 ice = mix(vec3(0.42, 0.56, 0.66), vec3(0.66, 0.77, 0.84), wNoise(p * 0.7));
      ice = mix(ice, vec3(0.9, 0.93, 0.95), crack * 0.7);
      ice = mix(ice, vec3(0.92, 0.94, 0.96), snow * 0.8);
      col = mix(ice * light * 1.35, sky, fres * 0.5);
      col += uSunCol * pow(max(dot(R, uSunDir), 0.0), 90.0) * 0.6;
      alpha = 0.97;
    }
    gl_FragColor = vec4(col, alpha * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// 各类水体的配色(sRGB 十六进制;低饱和)
const PRESETS = {
  lake: { shallow: 0x6e7558, deep: 0x1f3842, murk: 0.6, wave: 0.12, foam: 0.9 },
  river: { shallow: 0x737c5f, deep: 0x2a454c, murk: 0.75, wave: 0.15, foam: 1.0 },
  swamp: { shallow: 0x55533a, deep: 0x1f2617, murk: 1.3, wave: 0.06, foam: 0.25, duck: 0.75 },
  fountain: { shallow: 0x9ab5ad, deep: 0x4a7d88, murk: 0.4, wave: 0.18, foam: 0.6 },
  ice: { shallow: 0xcfe0e8, deep: 0xa8c4d2, murk: 1.0, wave: 0.03, foam: 0, ice: 1 },
};
const mats = {};
export function waterMaterial(kind = 'lake', normalTex = null) {
  if (normalTex && !shared.uNormal.value) shared.uNormal.value = normalTex;
  if (mats[kind]) return mats[kind];
  const P = PRESETS[kind] || PRESETS.lake;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      ...shared,
      uShallow: { value: new THREE.Color(P.shallow) },
      uDeep: { value: new THREE.Color(P.deep) },
      uMurk: { value: P.murk },
      uWave: { value: P.wave },
      uFoam: { value: P.foam },
      uDuck: { value: P.duck || 0 },
      uIce: { value: P.ice || 0 },
      uAlpha: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  m.userData.isWater = true;
  m.userData.shared = true; // 同类水面全场一份(荒野区块卸载时不能把它释放)
  mats[kind] = m;
  return m;
}

// 每帧一次:从天空/太阳/天气同步参数(挂在水面网格的 onBeforeRender 上,不渲染就不算)
let lastFrame = -1;
function syncUniforms(renderer) {
  const f = renderer.info.render.frame;
  if (f === lastFrame) return;
  lastFrame = f;
  shared.uTime.value = performance.now() * 0.001;
  shared.uSkyTop.value.copy(skyUniforms.topColor.value);
  shared.uSkyHor.value.copy(skyUniforms.horizonColor.value);
  shared.uSunDir.value.copy(skyUniforms.sunDir.value);
  shared.uSunCol.value.copy(sun.color).multiplyScalar(Math.min(1.4, sun.intensity / 3));
  shared.uRain.value = weather.rain;
}

// 水面网格:顶点为绝对坐标。depthFn(x,z) 给出水深(盆地解析深度,绝对坐标、不贴地);
// 或 depth = 固定水深(喷泉:跟着池子贴地)
export function waterMesh(geo, kind, { depth = null, depthFn = null, normalTex = null } = {}) {
  const n = geo.attributes.position.count;
  const D = new Float32Array(n).fill(depth ?? 1);
  if (depthFn) {
    const p = geo.attributes.position;
    for (let i = 0; i < n; i++) D[i] = depthFn(p.getX(i), p.getZ(i));
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(D, 1));
  if (!geo.attributes.aFlow) geo.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, waterMaterial(kind, normalTex));
  mesh.userData.noSnap = !!depthFn;
  mesh.renderOrder = 2;
  mesh.onBeforeRender = syncUniforms;
  return mesh;
}

// 极坐标网格(湖/水塘/冰湖/喷泉):r 从 r0 到 R(a)+margin,外缘随岸线起伏
export function polarWaterGeo(cx, cz, radiusFn, { r0 = 0, margin = 1.5, rings = 16, segs = 72, y = 0 } = {}) {
  const P = [], I = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const r = r0 + (radiusFn(a) + margin - r0) * Math.pow(t, 0.8);
      P.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * segs + i, b = j * segs + ((i + 1) % segs), c = a + segs, d = b + segs;
      I.push(a, b, c, b, d, c);
    }
  }
  if (r0 === 0) { // 圆心封口:第一圈收成一点
    const ci = P.length / 3;
    P.push(cx, y, cz);
    for (let i = 0; i < segs; i++) I.push(ci, (i + 1) % segs, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  return g;
}

// 河:沿折线中心的条带,横向 cols 列(水深随横截面变化),外扩 margin 让岸线由地形交线决定
export function riverWaterGeo(pts, { cols = 6, margin = 1.4, speed = 0.55, y = 0 } = {}) {
  const P = [], F = [], I = [];
  for (const q of pts) {
    const nx = -q.tz, nz = q.tx;
    const hw = q.w / 2 + margin;
    for (let c = 0; c <= cols; c++) {
      const s = (c / cols) * 2 - 1;
      P.push(q.x + nx * hw * s, y, q.z + nz * hw * s);
      const k = speed * (1 - s * s * 0.6); // 中流快、岸边慢
      F.push(q.tx * k, q.tz * k);
    }
  }
  const W = cols + 1;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let c = 0; c < cols; c++) {
      const a = i * W + c, b = a + 1, d = a + W, e = d + 1;
      I.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(F, 2));
  g.setIndex(I);
  return g;
}
