// 天气系统:晴/多云/雨/雷暴的马尔可夫轮换(世界心境轻推天色)、雷电闪屏与震屏、
// 环绕玩家的雨/雪线段粒子(冬季降水变雪)、地面扬尘(雨天不起尘)。只依赖 ctx 里的玩家与几个回调。
import * as THREE from 'three';
import { scene } from '../gfx/core.js';
import { groundH } from '../terrain.js';
import { rand } from '../core/rng.js';
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
export const weather = { state: 'clear', timer: 60, rain: 0, targetRain: 0, cover: 0.05, targetCover: 0.05, boltT: 4 };

export function setWeather(s) {
  const def = WEATHER_DEF[s];
  weather.state = s;
  weather.targetRain = def.rain;
  weather.targetCover = def.cover;
  weather.timer = def.dur[0] + rand() * (def.dur[1] - def.dur[0]);
  if (ctx.started() && (s === 'rain' || s === 'storm')) {
    if (ctx.isWinter()) ctx.toast(s === 'storm' ? '🌨️ 暴风雪来了!' : '🌨️ 下雪了……', 2.5);
    else ctx.toast(s === 'storm' ? '⛈️ 雷暴来袭!' : '🌧️ 下雨了…', 2.5);
  }
}

function lightning() {
  const el = document.getElementById('lightning');
  el.style.transition = 'none';
  el.style.opacity = 0.75;
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.35s';
    el.style.opacity = 0;
  });
  cam.shake = Math.max(cam.shake, 0.3);
  setTimeout(() => weatherAudio.thunder(), 400 + rand() * 1200);
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
  weatherAudio.setRain(ctx.started() && !ctx.isWinter() ? weather.rain : 0); // 雪落无声
  if (weather.state === 'storm' && weather.rain > 0.7 && !ctx.isWinter()) {
    weather.boltT -= dt;
    if (weather.boltT <= 0) {
      weather.boltT = 3 + rand() * 8;
      lightning();
    }
  }
}

// ---- 雨(线段粒子,环绕玩家的体积内循环)----
const RAIN_N = 1100;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0x9fb8d0, transparent: true, opacity: 0 });
const rainLines = new THREE.LineSegments(rainGeo, rainMat);
rainLines.frustumCulled = false;
rainLines.visible = false;
rainLines.userData.noSnap = true; // 雨幕自己按玩家脚下高度对齐
scene.add(rainLines);
const drops = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) {
  drops[i * 3] = (rand() - 0.5) * 56;
  drops[i * 3 + 1] = rand() * 24;
  drops[i * 3 + 2] = (rand() - 0.5) * 56;
}

export function updateRain(dt) {
  const snow = ctx.isWinter(); // 冬季降水变成雪:白色、慢落、随风打旋
  rainMat.color.setHex(snow ? 0xf0f5ff : 0x9fb8d0);
  rainMat.opacity = weather.rain * (snow ? 0.6 : 0.38);
  rainLines.visible = weather.rain > 0.03;
  if (!rainLines.visible) return;
  const cx = ctx.player.pos.x, cz = ctx.player.pos.z;
  rainLines.position.y = groundH(cx, cz);
  const wind = snow ? 1.4 : 4.5;
  const fall = snow ? 6.5 : 30;
  const t = performance.now() * 0.001;
  for (let i = 0; i < RAIN_N; i++) {
    let x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2];
    y -= fall * dt;
    x += wind * dt;
    if (snow) { x += Math.sin(t * 1.7 + i) * 0.8 * dt; z += Math.cos(t * 1.3 + i * 0.7) * 0.8 * dt; }
    if (y < 0) {
      y = 20 + rand() * 6;
      x = cx + (rand() - 0.5) * 56;
      z = cz + (rand() - 0.5) * 56;
    }
    if (x < cx - 28) x += 56; else if (x > cx + 28) x -= 56;
    if (z < cz - 28) z += 56; else if (z > cz + 28) z -= 56;
    drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x + (snow ? 0.1 : 0.08); rainPos[i * 6 + 4] = y + (snow ? 0.12 : 0.55); rainPos[i * 6 + 5] = z;
  }
  rainGeo.attributes.position.needsUpdate = true;
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

