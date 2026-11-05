// 天气系统:晴/多云/雨/雷暴的马尔可夫轮换(世界心境轻推天色)、雷电(真正照亮场景 + 天边一道闪电)、
// 环绕玩家的实例化雨丝面片(冬季变雪花,运动全在着色器)、地面水花与水面涟漪、雨后地面湿润与水洼
// (gfx/surface.js 的 uWet)、地面扬尘(雨天不起尘)。玩家与开局状态读 core/state.js,其余经 ctx 的几个回调。
import * as THREE from 'three';
import { scene, camera } from '../gfx/core.js';
import { groundH } from '../terrain.js';
import { waterBasin } from '../waterbodies.js';
import { setWetness } from '../gfx/surface.js';
import { getVegetationDensity } from '../vegetation.js';
import { rand } from '../core/rng.js';
import { player, started } from '../core/state.js';
import { ctx } from '../core/ctx.js';
import { cam } from './camera.js';
import { weatherAudio } from '../audio.js';

// ================= 天气系统 =================
export const WEATHER_DEF = {
  clear:  { rain: 0,   cover: 0.05, dur: [55, 110], next: { cloudy: 1 } },
  cloudy: { rain: 0,   cover: 0.55, dur: [30, 60],  next: { rain: 0.55, clear: 0.45 } },
  rain:   { rain: 0.7, cover: 0.85, dur: [30, 60],  next: { storm: 0.35, cloudy: 0.65 } },
  storm:  { rain: 1,   cover: 1,    dur: [22, 45],  next: { rain: 1 } },
};
export const weather = { state: 'clear', timer: 60, rain: 0, targetRain: 0, cover: 0.05, targetCover: 0.05, boltT: 4,
  wet: 0,    // 地面湿润度:下雨时慢慢变湿,雨停后更慢地晾干
  flash: 0,  // 闪电亮度 0..1(sky.js 用它真正照亮场景:天光、定向闪光、天穹与雾)
  flashT: 9, // 距这道闪电过去的秒数(驱动明灭的包络)
  boltDir: new THREE.Vector3(0, 1, 0) }; // 闪电所在方向(定向闪光从那边打过来)

export function setWeather(s) {
  const def = WEATHER_DEF[s];
  weather.state = s;
  weather.targetRain = def.rain;
  weather.targetCover = def.cover;
  weather.timer = def.dur[0] + rand() * (def.dur[1] - def.dur[0]);
  if (started && (s === 'rain' || s === 'storm')) {
    if (ctx.isWinter()) ctx.toast(s === 'storm' ? '🌨️ 暴风雪来了!' : '🌨️ 下雪了……', 2.5);
    else ctx.toast(s === 'storm' ? '⛈️ 雷暴来袭!' : '🌧️ 下雨了…', 2.5);
  }
}

function lightning() {
  const el = document.getElementById('lightning');
  el.style.transition = 'none';
  el.style.opacity = 0.22; // 网页遮罩只留一点眩光,真正的亮来自场景灯光(weather.flash → sky.js)
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = 0;
  });
  weather.flashT = 0;
  showBolt();
  cam.shake = Math.max(cam.shake, 0.3);
  setTimeout(() => weatherAudio.thunder(), 400 + rand() * 1200);
}
// 闪电明灭:主闪 0.1 秒最亮 → 暗一下 → 回闪 → 0.6 秒内熄灭(不是一帧白屏)
function flashEnvelope(t) {
  if (t > 0.75) return 0;
  const main = Math.exp(-t * 9);
  const re = t > 0.16 ? Math.exp(-(t - 0.16) * 10) * 0.75 : 0;
  const flick = t < 0.12 ? 0.75 + 0.25 * Math.sin(t * 160) : 1;
  return Math.min(1, Math.max(main * flick, re));
}

// 天边的闪电:一条随机折线(朝向镜头的细带,加性混合),亮约 0.2 秒
const boltMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, fog: false, side: THREE.DoubleSide });
const boltMesh = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
boltMesh.frustumCulled = false;
boltMesh.userData.noSnap = true;
boltMesh.visible = false;
scene.add(boltMesh);
let boltT = 0;
const _camDir = new THREE.Vector3();
function showBolt() {
  const P = [];
  // 落在镜头前方 ±50° 内的远处:玩家看得见这道闪电,照亮也从那边来
  camera.getWorldDirection(_camDir);
  const a = Math.atan2(_camDir.z, _camDir.x) + (rand() - 0.5) * 1.75, dist = 120 + rand() * 70;
  const sx = Math.sin(a), sz = -Math.cos(a); // 与视线大致垂直的横向
  weather.boltDir.set(Math.cos(a), 0.9, Math.sin(a)).normalize();
  const seg = (x0, y0, z0, x1, y1, z1, w) => {
    const ox = sx * w, oz = sz * w;
    P.push(x0 - ox, y0, z0 - oz, x0 + ox, y0, z0 + oz, x1 + ox, y1, z1 + oz,
      x0 - ox, y0, z0 - oz, x1 + ox, y1, z1 + oz, x1 - ox, y1, z1 - oz);
  };
  let x = camera.position.x + Math.cos(a) * dist, z = camera.position.z + Math.sin(a) * dist, y = camera.position.y + 95;
  const bot = camera.position.y - 5;
  while (y > bot) {
    const ny = y - (6 + rand() * 9), nx = x + (rand() - 0.5) * 9, nz = z + (rand() - 0.5) * 9;
    seg(x, y, z, nx, ny, nz, 0.6);
    if (rand() < 0.35) seg(nx, ny, nz, nx + (rand() - 0.5) * 14, ny - 10 - rand() * 8, nz + (rand() - 0.5) * 14, 0.3); // 分叉
    x = nx; y = ny; z = nz;
  }
  boltMesh.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  boltMesh.geometry = g;
  boltMesh.visible = true;
  boltT = 0.3;
}

export function updateWeather(dt) {
  weather.timer -= dt;
  if (weather.timer <= 0) {
    const nx = WEATHER_DEF[weather.state].next;
    let r = rand(), pick = 'clear';
    for (const [k, p] of Object.entries(nx)) { r -= p; if (r <= 0) { pick = k; break; } }
    // 世界的心境轻推天色:郁结的心多云,舒畅的心放晴(轻,不越历法与季节)
    const v = ctx.mood(); // 世界心境 -1..1
    if (v < -0.3 && pick === 'clear' && rand() < 0.4) pick = 'cloudy';
    if (v > 0.3 && pick === 'rain' && rand() < 0.35) pick = 'cloudy';
    setWeather(pick);
  }
  const step = (cur, tgt, rate) => cur + Math.max(-rate * dt, Math.min(rate * dt, tgt - cur));
  weather.rain = step(weather.rain, weather.targetRain, 0.12);
  weather.cover = step(weather.cover, weather.targetCover, 0.1);
  weatherAudio.setRain(started && !ctx.isWinter() ? weather.rain : 0); // 雪落无声
  if (weather.state === 'storm' && weather.rain > 0.7 && !ctx.isWinter()) {
    weather.boltT -= dt;
    if (weather.boltT <= 0) {
      weather.boltT = 3 + rand() * 8;
      lightning();
    }
  }
  // 闪电:按包络明灭;天边那道闪电随主闪一起熄灭
  weather.flashT += dt;
  weather.flash = flashEnvelope(weather.flashT);
  if (boltT > 0) {
    boltT -= dt;
    boltMat.opacity = Math.max(0, Math.min(1, boltT * 6)) * (0.6 + 0.4 * weather.flash);
    if (boltT <= 0) boltMesh.visible = false;
  }
  // 地面湿润:下雨约 25 秒湿透,雨停约 90 秒晾干(冬天的雪不算湿)
  const wetGoal = ctx.isWinter() ? 0 : Math.min(1, weather.rain * 1.3);
  if (wetGoal > weather.wet) weather.wet = Math.min(wetGoal, weather.wet + 0.04 * dt);
  else weather.wet = Math.max(wetGoal, weather.wet - 0.011 * dt);
  setWetness(weather.wet, ctx.isWinter() ? 0 : weather.rain, dt);
}


// ---- 雨丝:实例化细长面片(最多 4000 根,按画质档位缩减),绕下落方向朝向镜头;下落、风斜、循环全在着色器 ----
// 世界坐标锚定:每根雨丝有固定的种子位置,按镜头周围 40×24×40 的体积取模——走动时雨不会"跟着人跑"
const RAIN_MAX = 4000;
const RAIN_BOX = new THREE.Vector3(40, 24, 40);
const rainU = {
  uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: RAIN_BOX },
  uAlpha: { value: 0 }, uSnow: { value: 0 }, uWind: { value: new THREE.Vector2(3.5, 1.2) },
  uColor: { value: new THREE.Color(0xa9bccd) },
};
const rainGeo = (() => {
  const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // y 0..1 = 雨丝头 → 尾
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(RAIN_MAX * 4);
  for (let i = 0; i < RAIN_MAX; i++) {
    seed[i * 4] = rand() * RAIN_BOX.x;
    seed[i * 4 + 1] = rand() * RAIN_BOX.y;
    seed[i * 4 + 2] = rand() * RAIN_BOX.z;
    seed[i * 4 + 3] = rand(); // 长度/速度的个体差异
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = 0;
  return g;
})();
const rainMat = new THREE.ShaderMaterial({
  uniforms: rainU,
  transparent: true,
  depthWrite: false,
  vertexShader: `
    attribute vec4 aSeed;
    uniform float uTime, uSnow;
    uniform vec3 uCenter, uBox;
    uniform vec2 uWind;
    varying vec2 vUv;
    varying float vFade;
    void main() {
      vUv = uv;
      float speed = mix(mix(11.0, 15.0, aSeed.w), mix(1.1, 1.8, aSeed.w), uSnow);
      vec3 p = aSeed.xyz;
      p.y -= uTime * speed;
      p.xz += uWind * uTime;
      p.xz += vec2(sin(uTime * 1.3 + aSeed.w * 40.0), cos(uTime * 1.1 + aSeed.w * 30.0)) * 0.35 * uSnow;
      vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5; // 以镜头为中心循环
      vec3 w = uCenter + rel;
      float len = mix(mix(0.8, 1.2, aSeed.w), 0.07, uSnow);
      float wid = mix(0.017, 0.07, uSnow);
      vec3 dir = normalize(mix(vec3(uWind.x, -speed, uWind.y), vec3(0.0, -1.0, 0.0), uSnow)); // 下落方向(含风斜)
      vec3 toCam = cameraPosition - w;
      vec3 side = normalize(cross(dir, toCam));
      vec3 pos = w + dir * (position.y - 1.0) * len + side * position.x * wid; // y=1 雨滴头,y=0 拖尾在上方
      vFade = smoothstep(0.6, 3.0, length(toCam)) * (1.0 - smoothstep(13.0, 19.5, length(rel.xz)));
      gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
    }`,
  fragmentShader: `
    uniform float uAlpha, uSnow;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying float vFade;
    void main() {
      float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
      float a = mix(smoothstep(0.0, 1.0, vUv.y) * edge, smoothstep(0.0, 0.7, edge) * (1.0 - abs(vUv.y - 0.5) * 1.2), uSnow);
      gl_FragColor = vec4(uColor, a * uAlpha * vFade);
    }`,
});
const rainMesh = new THREE.Mesh(rainGeo, rainMat);
rainMesh.frustumCulled = false;
rainMesh.userData.noSnap = true; // 着色器里已是世界坐标
rainMesh.renderOrder = 3;
scene.add(rainMesh); // 常驻场景(数量为 0 时不画):预热阶段就编译好,第一场雨不卡

// ---- 地面水花 / 水面涟漪:贴地(或贴水面)扩散的小环;CPU 只在一圈播完时给它换个位置 ----
const SPLASH_N = 260;
const splashU = { uAlpha: { value: 0 } };
const splashGeo = (() => {
  const base = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_N * 4), 4)); // xyz + 相位
  g.instanceCount = 0;
  return g;
})();
const splashMat = new THREE.ShaderMaterial({
  uniforms: splashU,
  transparent: true,
  depthWrite: false,
  vertexShader: `
    attribute vec4 aPos;
    varying vec2 vUv;
    varying float vPh;
    void main() {
      vUv = uv;
      vPh = aPos.w;
      float s = mix(0.06, 0.34, aPos.w);
      gl_Position = projectionMatrix * viewMatrix * vec4(aPos.xyz + vec3(position.x * s, 0.03, position.z * s), 1.0);
    }`,
  fragmentShader: `
    uniform float uAlpha;
    varying vec2 vUv;
    varying float vPh;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float ring = smoothstep(0.62, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d));
      float core = (1.0 - smoothstep(0.0, 0.3, d)) * (1.0 - smoothstep(0.0, 0.25, vPh)) * 1.4;
      gl_FragColor = vec4(vec3(0.74, 0.79, 0.84), (ring * 0.8 + core) * (1.0 - vPh) * uAlpha);
    }`,
});
const splashMesh = new THREE.Mesh(splashGeo, splashMat);
splashMesh.frustumCulled = false;
splashMesh.userData.noSnap = true;
splashMesh.renderOrder = 3;
scene.add(splashMesh);
const splashLife = new Float32Array(SPLASH_N).fill(2);
const splashRate = new Float32Array(SPLASH_N).fill(3);

let rainTime = 0;
export function updateRain(dt) {
  const snow = ctx.isWinter(); // 冬季降水变成雪:白色、慢落、随风打旋
  const k = weather.rain;
  const dens = Math.max(0.35, Math.min(1, getVegetationDensity())); // 跟画质档位走:均衡≈2600 根,精致 4000
  rainGeo.instanceCount = k > 0.03 ? Math.floor(RAIN_MAX * dens * Math.min(1, 0.35 + k * 0.75)) : 0;
  rainTime += dt;
  rainU.uTime.value = rainTime;
  rainU.uCenter.value.set(camera.position.x, camera.position.y + 4, camera.position.z);
  rainU.uSnow.value = snow ? 1 : 0;
  rainU.uAlpha.value = (snow ? 0.75 : 0.45) * Math.min(1, k * 1.4) * (1 + weather.flash * 1.2); // 闪电时雨丝一亮
  rainU.uColor.value.setHex(snow ? 0xf2f6ff : 0xa9bccd);
  rainU.uWind.value.set(snow ? 1.2 : 3.5, snow ? 0.5 : 1.2);
  // 水花:只在下雨(不下雪)时,玩家周围 14m 内;落在水面上就是一圈涟漪
  const on = !snow && k > 0.1;
  splashGeo.instanceCount = on ? Math.floor(SPLASH_N * dens) : 0;
  splashU.uAlpha.value = on ? Math.min(0.36, k * 0.4) : 0;
  if (!on) return;
  const A = splashGeo.attributes.aPos, arr = A.array;
  const cx = player.pos.x, cz = player.pos.z;
  for (let i = 0; i < splashGeo.instanceCount; i++) {
    splashLife[i] += dt * splashRate[i];
    if (splashLife[i] >= 1) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 14;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      arr[i * 4] = x; arr[i * 4 + 1] = waterBasin(x, z) > 0.02 ? 0.0 : groundH(x, z); arr[i * 4 + 2] = z;
      splashLife[i] = rand() * 0.2;
      splashRate[i] = 2.2 + rand() * 1.6;
    }
    arr[i * 4 + 3] = splashLife[i];
  }
  A.needsUpdate = true;
}

// ---- 尘土粒子(马蹄扬尘/疾跑/落地)----
const DUST_MAX = 400;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_MAX * 3).fill(-9999);
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: 0xc9b08a, size: 0.38, transparent: true, opacity: 0.5, depthWrite: false });
const dustPts = new THREE.Points(dustGeo, dustMat);
dustPts.frustumCulled = false;
dustPts.userData.noSnap = true; // 粒子缓冲里已是绝对坐标
scene.add(dustPts);
const dust = [];
const dustFree = [...Array(DUST_MAX).keys()];

export function spawnDust(x, y, z, n = 3, spread = 0.5, up = 1.4) {
  if (weather.rain > 0.5) return; // 雨天地面湿润无尘
  for (let k = 0; k < n; k++) {
    const i = dustFree.pop();
    if (i === undefined) return;
    const gy = groundH(x, z);
    dustPos[i * 3] = x + (rand() - 0.5) * spread;
    dustPos[i * 3 + 1] = gy + y + rand() * 0.2;
    dustPos[i * 3 + 2] = z + (rand() - 0.5) * spread;
    dust.push({
      i, floor: gy + 0.04,
      vx: (rand() - 0.5) * 1.3, vy: up * (0.5 + rand() * 0.7), vz: (rand() - 0.5) * 1.3,
      life: 0, max: 0.45 + rand() * 0.4,
    });
  }
}

export function updateDust(dt) {
  if (!dust.length) return;
  for (let k = dust.length - 1; k >= 0; k--) {
    const p = dust[k];
    p.life += dt;
    if (p.life > p.max) {
      dustPos[p.i * 3 + 1] = -9999;
      dustFree.push(p.i);
      dust.splice(k, 1);
      continue;
    }
    p.vy -= 2.0 * dt;
    dustPos[p.i * 3] += p.vx * dt;
    dustPos[p.i * 3 + 1] = Math.max(p.floor, dustPos[p.i * 3 + 1] + p.vy * dt);
    dustPos[p.i * 3 + 2] += p.vz * dt;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

