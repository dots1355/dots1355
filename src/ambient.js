// 群系环境粒子:每个群系一种"空气里的东西"——雪原飘雪、荒漠扬沙、焦土余烬、林间落叶、
// 沼泽萤火(入夜)、平原花粉(白天)。粒子运动全在顶点着色器里按时间算(CPU 每帧只改几个 uniform),
// 在玩家周围的盒子里循环环绕;每种一个 Points、一次绘制,按所在位置的群系权重淡入淡出。
import * as THREE from 'three';

const KINDS = {
  //            数量  盒子(宽,高)  底高  颜色      尺寸   加色   下落   漂移  摆幅  闪烁
  snow:    { n: 900, box: [46, 18], y0: -2, col: 0xf4f8ff, size: 0.11, add: false, fall: 1.25, drift: 0.6, sway: 0.7, blink: 0 },
  sand:    { n: 650, box: [46, 5], y0: -0.5, col: 0xd8b98a, size: 0.07, add: false, fall: 0.05, drift: 7.5, sway: 0.4, blink: 0 },
  ember:   { n: 320, box: [40, 14], y0: -1, col: 0xff8a3a, size: 0.09, add: true, fall: -0.75, drift: 0.5, sway: 0.5, blink: 1 },
  leaf:    { n: 160, box: [40, 12], y0: -1, col: 0x9a8a3a, size: 0.2, add: false, fall: 0.7, drift: 0.9, sway: 1.4, blink: 0 },
  firefly: { n: 160, box: [36, 4], y0: -0.2, col: 0xd8ff7a, size: 0.12, add: true, fall: 0, drift: 0.25, sway: 1.1, blink: 2 },
  pollen:  { n: 260, box: [40, 6], y0: -0.5, col: 0xfff3d0, size: 0.05, add: true, fall: -0.05, drift: 0.5, sway: 0.6, blink: 0 },
};
// 群系(顺序同 terrain.BIOME_KEYS)→ 各种粒子的权重
const BIOME_MIX = [
  { pollen: 1 },                 // plains
  { leaf: 1, firefly: 0.4 },     // forest
  { sand: 1 },                   // desert
  { snow: 1 },                   // snow
  { firefly: 1 },                // swamp
  { ember: 1 },                  // ash
  { sand: 0.25 },                // rock
  { pollen: 0.8 },               // hills
];

const VERT = `
  attribute vec4 seed;
  uniform float uTime, uSize, uFall, uDrift, uSway, uBlink, uPix;
  uniform vec3 uCenter, uBox, uWind;
  varying float vA;
  void main() {
    vec3 lo = uCenter - uBox * 0.5;
    vec3 p = seed.xyz * uBox;
    float t = uTime + seed.w * 37.0;
    p.y -= uFall * t;
    p.xz += uWind.xz * uDrift * t;
    p.x += sin(t * 0.9 + seed.w * 6.28) * uSway;
    p.z += cos(t * 0.7 + seed.x * 6.28) * uSway;
    p = mod(p - lo, uBox) + lo;
    // 盒子边缘淡出:粒子环绕回来时不"闪现"
    vec3 q = abs((p - uCenter) / (uBox * 0.5));
    vA = (1.0 - smoothstep(0.75, 1.0, max(q.x, q.z))) * (1.0 - smoothstep(0.8, 1.0, q.y));
    if (uBlink > 1.5) vA *= 0.25 + 0.75 * pow(0.5 + 0.5 * sin(t * 2.3), 3.0);      // 萤火:一明一灭
    else if (uBlink > 0.5) vA *= 0.55 + 0.45 * sin(t * 9.0 + seed.y * 20.0);        // 余烬:噼啪闪
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // 贴着镜头的粒子淡掉、尺寸封顶:以前 0.5m 内的一片落叶/雪花会糊成一两百像素的大光斑,像镜头上沾了东西
    vA *= smoothstep(1.0, 2.6, -mv.z);
    gl_PointSize = min(uSize * uPix / max(0.5, -mv.z), 26.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vA;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    float a = (1.0 - r * 4.0) * vA * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }`;

const systems = {};
let root = null;
const _w = new Float32Array(8);

export function initAmbient(scene) {
  root = new THREE.Group();
  root.userData.noSnap = true;
  scene.add(root);
  for (const [key, k] of Object.entries(KINDS)) {
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(k.n * 4);
    for (let i = 0; i < k.n * 4; i++) seeds[i] = Math.random();
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(k.n * 3), 3)); // 占位:位置在着色器里算
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSize: { value: k.size }, uFall: { value: k.fall }, uDrift: { value: k.drift },
        uSway: { value: k.sway }, uBlink: { value: k.blink }, uPix: { value: 600 },
        uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(k.box[0], k.box[1], k.box[0]) },
        uWind: { value: new THREE.Vector3(1, 0, 0.35).normalize() },
        uColor: { value: new THREE.Color(k.col) }, uOpacity: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: k.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    pts.renderOrder = 5;
    root.add(pts);
    systems[key] = { pts, mat, k, op: 0 };
  }
}

// biomeWeights: terrain.js 的 biomeWeights;env: { night 0..1, rain 0..1, windX, windZ, pixelH }
export function updateAmbient(dt, time, cam, groundY, px, pz, biomeWeights, env, density = 1) {
  if (!root) return;
  biomeWeights(px, pz, _w);
  const target = {};
  for (let b = 0; b < 8; b++) {
    if (_w[b] < 0.02) continue;
    for (const [key, v] of Object.entries(BIOME_MIX[b])) target[key] = (target[key] || 0) + v * _w[b];
  }
  // 时段/天气:萤火只在入夜,花粉只在白天;下雨压住扬沙与花粉,雪原下雨=冻雨照下
  if (target.firefly) target.firefly *= env.night;
  if (target.pollen) target.pollen *= (1 - env.night) * (1 - env.rain);
  if (target.sand) target.sand *= 1 - 0.7 * env.rain;
  if (target.leaf) target.leaf *= 1 - 0.5 * env.rain;
  for (const key of Object.keys(systems)) {
    const S = systems[key];
    const goal = Math.min(1, (target[key] || 0)) * density;
    S.op += (goal - S.op) * Math.min(1, dt * 0.8);
    S.pts.visible = S.op > 0.02;
    if (!S.pts.visible) continue;
    const u = S.mat.uniforms;
    u.uTime.value = time;
    u.uOpacity.value = S.op * (key === 'sand' ? 0.55 : key === 'pollen' ? 0.7 : 0.9);
    u.uPix.value = env.pixelH * 0.9;
    const hb = S.k.box[1];
    u.uCenter.value.set(cam.x, groundY + hb * 0.5 + S.k.y0, cam.z);
    u.uWind.value.set(env.windX, 0, env.windZ);
  }
}
