// 天空与昼夜:日月星辰、天穹着色、远山环、雾色与光照随时间变化;群系氛围(雾色/雾距/阳光/曝光)
// 跨群系平滑过渡;视距跟随雾距(雾外不画)。一天的进度在 clock.time。
import * as THREE from 'three';
import { scene, camera, renderer, bloom, styleExp, styleBloomMul } from '../gfx/core.js';
import { biomeWeights } from '../terrain.js';
import { NIGHT_GLOW } from '../flora.js';
import { ctx } from '../core/ctx.js';
import { rand } from '../core/rng.js';
import { weather } from './weather.js';
import { surfaceUniforms } from '../gfx/surface.js';
import { setVegetationLight } from '../vegetation.js';

// 光照
export const hemi = new THREE.HemisphereLight(0xb4c4d4, 0x5e6355, 0.7); // 冷天光,暖不起来的北方
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); // 画质档位会按需改成 1024(setQuality)
// 阴影范围 ±70m:镜头距人物 6m,更远的影子本就被雾和透视压成几个像素;范围收窄后纹素密度还翻倍
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
export const moon = new THREE.DirectionalLight(0x8899cc, 0.0);
scene.add(moon);
// 随身提灯:夜里跟着玩家的一团暖光(强度在 updateDayNight 里按夜色调)
export const lantern = new THREE.PointLight(0xffd9a0, 0, 17, 1.6);
scene.add(lantern);

// 大气天空穹顶(程序化渐变 + 太阳光晕)
export const skyUniforms = {
  topColor: { value: new THREE.Color(0x2f6fd0) },
  horizonColor: { value: new THREE.Color(0xbcd8ee) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0xfff2cc) },
  sunGlow: { value: 1.0 },
  time: { value: 0 },
  dayMix: { value: 1.0 },
  cover: { value: 0.0 },
};
export const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 24, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `
      uniform vec3 topColor, horizonColor, sunDir, sunColor;
      uniform float sunGlow, time, dayMix, cover;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, amp = 0.5;
        for (int i = 0; i < 5; i++) { v += vnoise(p) * amp; p *= 2.1; amp *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.45));
        float s = max(dot(d, sunDir), 0.0);
        // 云层:方向投影到平面上做分形噪声
        if (d.y > 0.015) {
          vec2 uv = d.xz / (d.y + 0.22) * 0.9 + vec2(time * 0.006, time * 0.0025);
          float cov = fbm(uv);
          // cover(天气云量)越大,云覆盖越广、越暗
          float lo = mix(0.6, 0.22, cover);
          float hi = mix(0.8, 0.5, cover);
          float cloud = smoothstep(lo, hi, cov);
          float wispy = smoothstep(lo - 0.08, lo + 0.02, cov) * 0.22;
          float fade = smoothstep(0.04, 0.22, d.y);
          vec3 cloudBright = mix(vec3(0.045, 0.05, 0.08), vec3(1.06, 1.03, 0.99), dayMix);
          vec3 cloudDark  = mix(vec3(0.03, 0.035, 0.06), vec3(0.72, 0.74, 0.8), dayMix);
          // 朝阳一侧的云染上太阳色
          float sunTint = pow(s, 3.0) * 0.5;
          vec3 ccol = mix(cloudDark, cloudBright, smoothstep(0.5, 0.95, cov)) + sunColor * sunTint * 0.35;
          ccol *= 1.0 - 0.42 * cover;
          col = mix(col, ccol, (cloud * 0.9 + wispy) * fade);
        }
        col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 64.0) * 0.5 + pow(s, 6.0) * 0.12) * sunGlow;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
sky.renderOrder = -1;
sky.userData.noSnap = true;
scene.add(sky);

// 月亮/星星
export const moonBall = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }));
moonBall.userData.noSnap = true;
scene.add(moonBall);
const starGeo = new THREE.BufferGeometry();
{
  const pos = [];
  for (let i = 0; i < 450; i++) {
    const a = rand() * Math.PI * 2, e = rand() * Math.PI * 0.48;
    pos.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420 + 10, Math.sin(a) * Math.cos(e) * 420);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
export const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false, sizeAttenuation: false });
export const stars = new THREE.Points(starGeo, starMat);
stars.userData.noSnap = true;
scene.add(stars);

// 地平线远山环:两圈跟随玩家的雾中山脊(纯背景,永远走不到)——天际"永远有山"的地平线
function vistaRing(R, H, phase, hex) {
  const N = 140;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const h = H * Math.max(0.12,
      0.42 + 0.3 * Math.sin(a * 3 + phase) + 0.22 * Math.sin(a * 7 + phase * 2.3) + 0.14 * Math.sin(a * 13 + phase * 4.1));
    pos.push(Math.cos(a) * R, -8, Math.sin(a) * R);
    pos.push(Math.cos(a) * R, h, Math.sin(a) * R);
  }
  for (let i = 0; i < N; i++) {
    const b = i * 2;
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide, fog: true }));
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
export const vistaFar = vistaRing(360, 74, 1.7, 0x76858f);  // 远脊:几乎溶进雾里
export const vistaNear = vistaRing(300, 52, 4.9, 0x67757f); // 近脊:略深一层,错峰出剪影


// ================= 昼夜 =================
export const clock = { time: 0.28 }; // 一天的进度 0..1(从清晨开始)
// 热循环复用的临时对象(避免每帧分配)
const _sunDir = new THREE.Vector3();
const _sunPosV = new THREE.Vector3();
const _snapT = new THREE.Vector3();
const _snapM = new THREE.Matrix4();
const _snapInv = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _topC = new THREE.Color();
const _horC = new THREE.Color();
const _flashC = new THREE.Color(0xc8d4ff);
const C_MOON = new THREE.Color(0x8899cc);
const _vegSun = new THREE.Color(), _vegAmb = new THREE.Color();
// 北境天空:晴天天顶是冷而深的蓝,地平线是带蓝的雾白(远山与雾同色,远景自然溶进天里)
const C_DAY_TOP = new THREE.Color(0x3f70b2), C_DAY_HOR = new THREE.Color(0xb9cfe2);
const C_DUSK_TOP = new THREE.Color(0x3b3a63), C_DUSK_HOR = new THREE.Color(0xe8834a);
const C_NIGHT_TOP = new THREE.Color(0x040814), C_NIGHT_HOR = new THREE.Color(0x0e1830);
const C_SUN_DAY = new THREE.Color(0xf7ecd4), C_SUN_DUSK = new THREE.Color(0xf07a38);
// 天光(半球光的天空色):白天冷蓝、黄昏染暖、夜里月蓝
const C_HEMI_DAY = new THREE.Color(0xb4c4d4), C_HEMI_DUSK = new THREE.Color(0xe0a882), C_HEMI_NIGHT = new THREE.Color(0x7484b0);
const _hemiC = new THREE.Color();
let envIntensity = 1;

// 群系氛围:雾色倍率 rgb、雾近/远倍率、阳光色调 rgb、曝光、光强、天光色调 rgb(顺序同 terrain.BIOME_KEYS)
// 走进沼泽雾气收拢、天光发绿灰,荒漠热霾泛金、天光偏暖,焦土天色发红褐,雪原清冷透亮,林海林冠遮天昏暗发绿
export const BIOME_ATMO = [
  // 雾 r g b, 雾近, 雾远, 阳光 r g b, 曝光, 光强, 天光 r g b
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],                                   // plains 平原
  [0.72, 0.88, 0.74, 0.42, 0.6, 0.9, 0.98, 0.76, 0.9, 0.56, 0.74, 0.9, 0.72],  // forest 林海:林冠遮天,昏暗发绿
  [1.2, 1.02, 0.74, 0.9, 1.1, 1.14, 0.98, 0.74, 0.88, 1.08, 1.14, 1.0, 0.78],  // desert 荒漠(亮沙降曝光,免得一片白)
  [1.04, 1.1, 1.22, 0.72, 0.8, 0.94, 1.0, 1.12, 0.84, 1, 0.94, 1.0, 1.12],     // snow 雪原(雪地降曝光)
  [0.7, 0.84, 0.68, 0.3, 0.45, 0.86, 0.94, 0.72, 0.98, 0.78, 0.84, 0.98, 0.78], // swamp 沼泽
  [0.98, 0.6, 0.46, 0.45, 0.6, 1.16, 0.74, 0.54, 1.02, 0.9, 1.12, 0.8, 0.7],   // ash 焦土
  [0.95, 0.95, 0.99, 0.95, 1, 1, 1, 1, 1, 1, 1, 1, 1],                        // rock 碎石岗
  [1.0, 1.04, 0.96, 1.1, 1.15, 1.03, 1.0, 0.94, 1, 1.04, 1.02, 1.04, 0.96],    // hills 丘陵
];
const ATMO_N = BIOME_ATMO[0].length;
const _atmoW = new Float32Array(8);
export const atmo = BIOME_ATMO[0].slice(); // 平滑后的当前氛围(跨群系时缓缓过渡,不跳变)
let atmoScan = 0;
const _atmoT = BIOME_ATMO[0].slice();
function updateBiomeAtmo(dt) {
  if (atmoScan-- <= 0) { // 每 10 帧取一次群系权重
    atmoScan = 10;
    biomeWeights(ctx.player.pos.x, ctx.player.pos.z, _atmoW);
    for (let k = 0; k < ATMO_N; k++) {
      let v = 0;
      for (let b = 0; b < 8; b++) v += _atmoW[b] * BIOME_ATMO[b][k];
      _atmoT[k] = v;
    }
  }
  const a = Math.min(1, dt * 0.8);
  for (let k = 0; k < ATMO_N; k++) atmo[k] += (_atmoT[k] - atmo[k]) * a;
}
export function updateDayNight(dt) {
  updateBiomeAtmo(dt);
  clock.time = (clock.time + dt / 240) % 1;
  const ang = clock.time * Math.PI * 2 - Math.PI / 2;
  const elev = Math.sin(ang);
  const day = Math.max(0, Math.min(1, elev * 2 + 0.25));
  const night = 1 - day;
  const sx = Math.cos(ang) * 250, sy = elev * 220, sz = 80;
  // 阴影相机纹素对齐:把目标点量化到光空间纹素网格,消除移动时阴影边缘抖动
  _sunPosV.set(ctx.player.pos.x + sx * 0.4, Math.max(20, sy), ctx.player.pos.z + sz * 0.4);
  _snapT.set(ctx.player.pos.x, 0, ctx.player.pos.z);
  _snapM.lookAt(_sunPosV, _snapT, _UP);
  _snapInv.copy(_snapM).invert();
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  _snapT.applyMatrix4(_snapInv);
  _snapT.x = Math.round(_snapT.x / texel) * texel;
  _snapT.y = Math.round(_snapT.y / texel) * texel;
  _snapT.applyMatrix4(_snapM);
  const snapDx = _snapT.x - ctx.player.pos.x, snapDz = _snapT.z - ctx.player.pos.z;
  sun.position.set(_sunPosV.x + snapDx, _sunPosV.y, _sunPosV.z + snapDz);
  sun.target.position.copy(_snapT);
  const rainDim = 1 - 0.72 * weather.rain;
  const dgnDim = ctx.inDungeon() ? 0.1 : 1; // 地窖里只有火把
  sun.intensity = 3.4 * day * rainDim * dgnDim * atmo[9];
  sun.color.copy(C_SUN_DUSK).lerp(C_SUN_DAY, Math.min(1, Math.max(0, (elev - 0.05) * 2.4)));
  moon.position.set(-sx, Math.max(30, -sy), -sz);
  moon.intensity = 0.55 * night; // 月色提亮:夜里也看得清路
  moon.color.copy(C_MOON);
  if (weather.flash > 0.01 && dgnDim === 1) { // 闪电:借月光这盏定向灯,从闪电那边把整片地打亮一下
    const f = weather.flash;
    moon.position.copy(weather.boltDir).multiplyScalar(200);
    moon.intensity = moon.intensity * (1 - f) + f * 4.2;
    moon.color.lerp(_flashC, f);
  }
  hemi.intensity = (0.22 + 0.28 * day) * (1 - 0.3 * weather.rain) * dgnDim * (0.6 + 0.4 * atmo[9])
    + weather.flash * 2.2 * dgnDim; // 闪电:整片天光一下照亮(不只是网页遮罩一闪)
  // 天光色:昼冷夜蓝,太阳贴着地平线时(黄昏/清晨)染上暖橙;再乘群系色调
  const duskK = Math.max(0, 1 - Math.abs(elev - 0.06) / 0.3) * (1 - 0.6 * weather.cover);
  _hemiC.copy(C_HEMI_NIGHT).lerp(C_HEMI_DAY, day).lerp(C_HEMI_DUSK, duskK * 0.65);
  hemi.color.setRGB(_hemiC.r * atmo[10], _hemiC.g * atmo[11], _hemiC.b * atmo[12]);
  envIntensity = (0.1 + 0.25 * day) * rainDim * (ctx.inDungeon() ? 0.25 : 1);
  // 随身提灯:入夜自动点起一圈暖光(地窖里已有火把,不重复)
  lantern.intensity = night * 1.2 * (ctx.inDungeon() ? 0 : 1);
  lantern.position.set(ctx.player.pos.x, 2.4, ctx.player.pos.z);

  // 天空穹顶
  _sunDir.set(sx, sy, sz).normalize();
  skyUniforms.sunDir.value.copy(_sunDir);
  skyUniforms.sunColor.value.copy(sun.color);
  skyUniforms.sunGlow.value = (0.4 + day) * (1 - 0.75 * weather.cover);
  skyUniforms.cover.value = weather.cover;
  let top, hor;
  // 黄昏带加宽(太阳仰角 0.4 以下就开始染暖),傍晚真正有晚霞
  if (elev > 0.4) { top = C_DAY_TOP; hor = C_DAY_HOR; }
  else if (elev > -0.08) {
    const t = Math.pow((elev + 0.08) / 0.48, 1.4);
    top = _topC.lerpColors(C_DUSK_TOP, C_DAY_TOP, t);
    hor = _horC.lerpColors(C_DUSK_HOR, C_DAY_HOR, t);
  } else {
    const t = Math.max(0, (elev + 0.3) / 0.22);
    top = _topC.lerpColors(C_NIGHT_TOP, C_DUSK_TOP, t);
    hor = _horC.lerpColors(C_NIGHT_HOR, C_DUSK_HOR, t);
  }
  const rainSkyDim = 1 - 0.35 * weather.rain;
  skyUniforms.topColor.value.copy(top).multiplyScalar(rainSkyDim);
  skyUniforms.horizonColor.value.copy(hor).multiplyScalar(rainSkyDim);
  skyUniforms.time.value = performance.now() * 0.001;
  skyUniforms.dayMix.value = day;
  scene.fog.color.copy(hor).multiplyScalar(rainSkyDim);
  scene.fog.near = 130 - 80 * weather.rain;
  scene.fog.far = 430 - 230 * weather.rain;
  // 群系氛围叠加(地窖内由下方覆盖)
  scene.fog.color.r = Math.min(1, scene.fog.color.r * atmo[0]);
  scene.fog.color.g = Math.min(1, scene.fog.color.g * atmo[1]);
  scene.fog.color.b = Math.min(1, scene.fog.color.b * atmo[2]);
  scene.fog.near *= atmo[3];
  scene.fog.far *= atmo[4];
  sun.color.r *= atmo[5];
  sun.color.g *= atmo[6];
  sun.color.b *= atmo[7];
  skyUniforms.horizonColor.value.lerp(scene.fog.color, 0.6); // 地平线与雾同色,远景自然融进天里
  { const sc = surfaceUniforms.uSkyCol.value, h = skyUniforms.horizonColor.value; sc.r = h.r; sc.g = h.g; sc.b = h.b; } // 水洼倒映天色
  // 天顶也随群系偏色:荒漠暖、焦土红褐、沼泽绿灰、雪原清冷
  skyUniforms.topColor.value.r *= 0.65 + 0.35 * atmo[0];
  skyUniforms.topColor.value.g *= 0.65 + 0.35 * atmo[1];
  skyUniforms.topColor.value.b *= 0.65 + 0.35 * atmo[2];
  if (dgnDim < 1) {
    // 地窖:天穹熄灭,浓雾收拢,只剩火把撑开的一圈光
    skyUniforms.topColor.value.multiplyScalar(0.05);
    skyUniforms.horizonColor.value.multiplyScalar(0.05);
    skyUniforms.sunGlow.value = 0;
    scene.fog.color.multiplyScalar(0.06);
    scene.fog.near = 6;
    scene.fog.far = 55;
  }
  sky.position.copy(camera.position);
  stars.position.copy(camera.position); // 星空也要跟着走,不然离城即无星

  moonBall.position.set(camera.position.x - sx * 1.6, Math.max(-40, -sy * 1.6), camera.position.z - sz * 1.6);
  moonBall.visible = -sy > -20;
  starMat.opacity = Math.max(0, -elev * 2.2);

  // 草叶受光:透光/包裹光跟着太阳走(含群系与天气的明暗),最低环境光取雾色——黄昏草不发黑发褐
  _vegSun.copy(sun.color).multiplyScalar(sun.intensity * 0.3);
  // 最低环境光偏天顶色(背着太阳那半边天是蓝紫的):黄昏的草仍带一点绿,不被橙光染成褐色
  _vegAmb.copy(scene.fog.color).lerp(skyUniforms.topColor.value, 0.55).multiplyScalar(0.5 * (0.35 + 0.65 * day));
  setVegetationLight(_sunDir, _vegSun, _vegAmb);

  // 曝光与泛光随昼夜变化
  renderer.toneMappingExposure = (0.85 + day * 0.25) * styleExp * atmo[8] * (1 + weather.flash * 0.5);
  if (weather.flash > 0 && dgnDim === 1) { // 闪电照亮天穹与雾
    skyUniforms.topColor.value.lerp(_flashC, weather.flash * 0.55);
    skyUniforms.horizonColor.value.lerp(_flashC, weather.flash * 0.65);
    scene.fog.color.lerp(_flashC, weather.flash * 0.5);
  }
  bloom.strength = (0.28 + night * 0.4) * styleBloomMul;

  // 路灯与神龛烛火:入夜才亮
  for (const m of NIGHT_GLOW) m.emissiveIntensity = 0.12 + night * 2.6;
  // 火把与窗户
  for (const t of ctx.world.torches) {
    const flick = 0.8 + Math.sin(performance.now() * 0.013 + (t.light ? t.light.position.x : 0)) * 0.2;
    if (t.light) t.light.intensity = t.base * night * flick;
    if (t.window) t.flame.material.emissiveIntensity = night * 1.8;
    else t.flame.material.emissiveIntensity = 0.5 + night * flick * 2.2;
  }
}

// 环境反射强度随昼夜(每隔一段时间遍历一次材质)
const envMats = new Set();
let envScan = 0;
export function updateEnvIntensity() {
  if (envScan-- <= 0) {
    envScan = 180;
    envMats.clear();
    scene.traverse((o) => {
      if (o.material && o.material.isMeshStandardMaterial) envMats.add(o.material);
    });
  }
  for (const m of envMats) {
    m.envMapIntensity = envIntensity;
    // 雨天湿润:地面/建筑材质变光滑反光
    if (m.userData.wettable) m.roughness = m.userData.baseRough * (1 - 0.55 * weather.rain);
  }
}


// 视距跟着雾走:雾外的东西看不见却照样要画,远眺时那是九成的绘制量。
// 天穹/星空/远山环/月亮都缩进视距内(天穹着色只看方向,缩放不影响观感)
let viewFar = 0;
export function fitViewDistance() {
  const far = Math.max(90, Math.min(1600, scene.fog.far + 30));
  if (Math.abs(far - viewFar) > 4) {
    viewFar = far;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  sky.scale.setScalar((far * 0.9) / 1200);
  stars.scale.setScalar((far * 0.85) / 420);
  const vk = Math.min(1, (far - 25) / 366);
  vistaFar.scale.set(vk, 1, vk);
  vistaNear.scale.set(vk, 1, vk);
  // 月亮:方向不变,距离收进视距
  const mx = moonBall.position.x - camera.position.x, my = moonBall.position.y - camera.position.y, mz = moonBall.position.z - camera.position.z;
  const md = Math.hypot(mx, my, mz);
  if (md > far * 0.8) {
    const k = (far * 0.8) / md;
    moonBall.position.set(camera.position.x + mx * k, camera.position.y + my * k, camera.position.z + mz * k);
  }
}
