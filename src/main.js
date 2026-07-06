// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, makeHorse, makeWolf, makeChicken, makeSheep, resolveCollisions, angleLerp, dist2, lambert } from './entities.js';
import { INTRO, REGIONS, GUARD_LINES, NPCS, MISSIONS, VILLAGERS, DIALOGS, TIME_GREETINGS, LORE } from './story.js';
import { initAudio, sfx, startMusic, toggleMusic, weatherAudio } from './audio.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
import { initWilderness, updateWilderness, wildRegionName, CORE } from './wilderness.js';
import { ShaderPass } from '../lib/jsm/postprocessing/ShaderPass.js';
import { EffectComposer } from '../lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../lib/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from '../lib/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from '../lib/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from '../lib/jsm/environments/RoomEnvironment.js';

// ================= 基础渲染 =================
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 1.5 上限:SMAA 在,肉眼无差,填充率省一半
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 130, 430);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);

// PBR 环境反射
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// 后处理:泛光 + SMAA 抗锯齿 + 输出色调
// 低画质模式(?lowfx=1):跳过后处理,适合低配设备
const LOWFX = new URLSearchParams(location.search).has('lowfx');
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// 环境光遮蔽:让物体接触处产生柔和阴影,大幅提升体积感
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 0.85, samples: 12 });
gtao.enabled = !LOWFX;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.85);
bloom.enabled = !LOWFX;
composer.addPass(bloom);
// GTA 风格电影调色:对比度 + 饱和 + 暖高光/冷阴影分离色调
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - 0.5) * 1.06 + 0.5;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.13);
      col += (l - 0.5) * vec3(0.035, 0.012, -0.035);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
// OutputPass(ACES 色调映射 + sRGB)先行,调色与 SMAA 作用于显示域 LDR,避免裁剪 HDR 高光
composer.addPass(new OutputPass());
gradePass.enabled = !LOWFX;
composer.addPass(gradePass);
const smaa = new SMAAPass(window.innerWidth, window.innerHeight);
smaa.enabled = !LOWFX;
composer.addPass(smaa);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// 光照
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6a7d55, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(LOWFX ? 1024 : 2048, LOWFX ? 1024 : 2048); // 2048 在此画风下与 4096 无肉眼差,阴影渲染省 4 倍
sun.shadow.camera.left = -130; sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130;
sun.shadow.camera.far = 600;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
const moon = new THREE.DirectionalLight(0x8899cc, 0.0);
scene.add(moon);

// 大气天空穹顶(程序化渐变 + 太阳光晕)
const skyUniforms = {
  topColor: { value: new THREE.Color(0x2f6fd0) },
  horizonColor: { value: new THREE.Color(0xbcd8ee) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(0xfff2cc) },
  sunGlow: { value: 1.0 },
  time: { value: 0 },
  dayMix: { value: 1.0 },
  cover: { value: 0.0 },
};
const sky = new THREE.Mesh(
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
        vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
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
scene.add(sky);

// 月亮/星星
const moonBall = new THREE.Mesh(new THREE.SphereGeometry(7, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }));
scene.add(moonBall);
const starGeo = new THREE.BufferGeometry();
{
  const pos = [];
  for (let i = 0; i < 450; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48;
    pos.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420 + 10, Math.sin(a) * Math.cos(e) * 420);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false, sizeAttenuation: false });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// ================= 世界 =================
// 先加载 AI 素材(assets/ai/ 下的无缝贴图会覆盖程序化贴图)
const aiLoaded = await preloadAIAssets();
if (aiLoaded.length) console.info('AI 贴图已加载:', aiLoaded.join(', '));
// 本地标题键艺术优先(assets/ai/title.jpg,可选)
let localTitleArt = false;
fetch('./assets/ai/title.jpg').then((r) => {
  if (r.ok) r.blob().then((b) => {
    localTitleArt = true;
    const t = document.getElementById('title');
    t.style.backgroundImage =
      `linear-gradient(rgba(10,6,20,0.55), rgba(10,6,20,0.75)), url(${URL.createObjectURL(b)})`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
  });
}).catch(() => {});

const world = buildWorld(scene);
const { colliders } = world;

// ---- 运行时 AI 贴图生成(玩家浏览器联网时,后台生成照片级贴图并热替换)----
const aiStatusEl = document.getElementById('ai-status');
let titleArtURL = null;
function setTitleArt(bitmap) {
  if (localTitleArt) return;
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d').drawImage(bitmap, 0, 0);
  titleArtURL = c.toDataURL('image/jpeg', 0.9);
  const t = document.getElementById('title');
  t.style.backgroundImage =
    `linear-gradient(rgba(10,6,20,0.5), rgba(10,6,20,0.72)), url(${titleArtURL})`;
  t.style.backgroundSize = 'cover';
  t.style.backgroundPosition = 'center';
}
let aiSwapped = 0;
generateRemoteAITextures({
  onStatus(state, done, total) {
    if (!aiStatusEl) return;
    if (state === 'generating') aiStatusEl.textContent = `🎨 AI 高清材质生成中… ${done}/${total}(首次需约 1 分钟,已自动缓存)`;
    else if (state === 'done') aiStatusEl.textContent = `🎨 AI 高清材质已启用(${done}/${total})`;
    else aiStatusEl.textContent = '🎨 离线模式:使用内置程序化材质(联网后自动启用 AI 材质)';
  },
  onTexture(name, canvases) {
    const set = new Set(canvases);
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat.map && set.has(mat.map.image)) mat.map.needsUpdate = true;
        if (mat.normalMap && set.has(mat.normalMap.image)) mat.normalMap.needsUpdate = true;
      }
    });
    aiSwapped++;
    if (started) toast(`🎨 AI 材质已应用:${name}`, 1.5);
  },
  onTitle: setTitleArt,
}).catch(() => {});

// ================= HUD 引用 =================
const $ = (id) => document.getElementById(id);
const heartsEl = $('hearts'), coinsEl = $('coins'), wantedEl = $('wanted'),
  missionEl = $('mission'), timerEl = $('timer'), promptEl = $('prompt'),
  toastEl = $('toast'), flashEl = $('flash'), titleEl = $('title'),
  gameoverEl = $('gameover'), gameoverText = $('gameover-text'),
  minimap = $('minimap'), mm = minimap.getContext('2d'),
  lowhpEl = $('lowhp'), weatherEl = $('weather'), equipEl = $('equip'),
  bosshpEl = $('bosshp'), bosshpFillEl = $('bosshp-fill');

// 顶部细条通知:队列化,一次一条,不遮挡视野
let toastTimer = 0; // >0 显示中,<0 淡出间隔
const toastQueue = [];
function toast(msg, dur = 2.6) {
  toastQueue.push([msg, Math.min(dur, 4)]);
}
function updateToast(dt) {
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) {
      toastEl.style.opacity = 0;
      toastTimer = -0.45;
    }
  } else if (toastTimer < 0) {
    toastTimer = Math.min(0, toastTimer + dt);
  } else if (toastQueue.length) {
    const [msg, dur] = toastQueue.shift();
    toastEl.textContent = msg;
    toastEl.style.opacity = 1;
    toastTimer = dur;
  }
}

// ================= 玩家 =================
const player = {
  ...makeHumanoid({ shirt: 0x2f8f4e, pants: 0x6b4a2f, cap: true, sword: true }),
  pos: world.playerSpawn.clone(),
  vy: 0, yaw: 0, onGround: true, jumps: 0,
  hp: 10, maxHp: 10, coins: 0,
  walkT: 0, attackT: 0, invulnT: 0, mounted: null, dead: false, herbs: 0, venison: 0,
  parcel: null, swordLv: 1, royalHorse: false,
  carrying: null, drunkT: 0, hiccupT: 0,
};
player.group.position.copy(player.pos);
scene.add(player.group);

// ================= 马 =================
const horses = [];
function addHorse(x, z, color, owned) {
  const h = { ...makeHorse(color), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned, stolen: false, state: 'idle', timer: Math.random() * 4, walkT: 0 };
  h.group.position.copy(h.pos);
  scene.add(h.group);
  horses.push(h);
  return h;
}
addHorse(50, 6, 0x8b5a2b, true);
addHorse(54, 5, 0x4a3a30, true);
addHorse(30, 90, 0xc4a35a, false);
addHorse(-40, 78, 0x9b7653, false);
addHorse(100, -25, 0x6e5240, false);

// ================= 卫兵 / 村民 / 盗贼 =================
const guards = [], villagers = [], bandits = [];

function addGuard(x, z, waypoints, knight = false, extra = false) {
  const g = { ...makeHumanoid({ shirt: knight ? 0x5a1c1c : 0x8f2f35, pants: 0x3a3a44, helmet: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: 3, speed: knight ? 8.3 : 5.2,
    state: 'patrol', waypoints, wp: 0, attackCd: 0, stunT: 0, downT: 0, walkT: 0,
    extra, home: new THREE.Vector3(x, 0, z), wantedHit: false };
  g.group.position.copy(g.pos);
  scene.add(g.group);
  guards.push(g);
  return g;
}
addGuard(10, 2, [[12, 2], [0, 16], [-12, 2], [0, -8]]);
addGuard(-10, 8, [[-12, 2], [0, -8], [12, 2], [0, 16]]);
addGuard(-3, 48, [[-3, 48], [3, 48], [3, 40], [-3, 40]]);
addGuard(3, 44, [[3, 44], [-3, 44]]);
addGuard(64, 3, [[64, 3], [64, -3], [56, 0]]);
addGuard(-6, -28, [[-6, -28], [6, -28]]);
addGuard(6, -30, [[6, -30], [-6, -30], [0, -20]]);
addGuard(-40, 20, [[-40, 20], [-20, 20], [-20, -20], [-40, -20]]);

// 每个村民都是有名有姓、有家有业的人(见 story.js)
const villagerColors = [0x7a5c8f, 0x4a7a9f, 0xa06a3a, 0x5f7a3a, 0x9f4a6a, 0x6a6a7a];
VILLAGERS.forEach((id, i) => {
  const v = { ...makeHumanoid({ shirt: villagerColors[i % villagerColors.length], pants: 0x50412e }),
    id, dbKey: `v${i}`, pos: new THREE.Vector3(id.home[0], 0, id.home[1]), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(id.home[0], 0, id.home[1]),
    state: 'idle', timer: Math.random() * 3, walkT: 0, fleeT: 0, downT: 0,
    sleeping: false, lineIdx: Math.floor(Math.random() * id.lines.length) };
  v.group.position.copy(v.pos);
  scene.add(v.group);
  villagers.push(v);
});

function addBandit(x, z, opts = {}) {
  const b = { ...makeHumanoid({ shirt: opts.boss ? 0x5a1020 : 0x3b3b46, pants: 0x26262e, hood: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: opts.hp ?? 3, speed: opts.speed ?? 5.8,
    state: 'patrol', home: new THREE.Vector3(x, 0, z), attackCd: 0, stunT: 0, walkT: 0, dead: false,
    boss: !!opts.boss, escort: !!opts.escort, dmg: opts.dmg ?? 2 };
  if (opts.scale) b.group.scale.setScalar(opts.scale);
  b.group.position.copy(b.pos);
  scene.add(b.group);
  bandits.push(b);
  return b;
}

// ================= 狼群 =================
const wolves = [];
let wolfKills = 0;
function addWolf(x, z) {
  const w = { ...makeWolf(), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), hp: 2, speed: 7.2, attackCd: 0, stunT: 0, walkT: 0,
    dead: false, respawnT: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  wolves.push(w);
  return w;
}
for (const [wx, wz] of world.wolfSpawns) addWolf(wx, wz);

// ---- 无尽荒野接入:狼群/野马/野羊/匪帮/掉落由主系统托管 ----
initWilderness(scene, colliders, {
  spawnWolf(x, z, chunkKey) {
    if (wolves.filter((w) => !w.dead).length > 42) return null;
    const w = addWolf(x, z);
    w.chunk = chunkKey;
    return w;
  },
  spawnHorse(x, z, chunkKey) {
    if (horses.filter((h) => h.chunk && !h.sheep).length > 8) return null;
    const wildColors = [0x8b5a2b, 0x4a3a30, 0xc4a35a, 0x9b7653, 0x6e5240, 0x3a3a3a];
    const h = addHorse(x, z, wildColors[Math.floor(Math.random() * wildColors.length)], false);
    h.chunk = chunkKey;
    return h;
  },
  spawnSheep(x, z, chunkKey) {
    if (horses.filter((h) => h.chunk && h.sheep).length > 10) return null;
    const s = addSheep(x, z);
    s.chunk = chunkKey;
    return s;
  },
  spawnBandit(x, z, chunkKey) {
    if (bandits.filter((b) => b.chunk && !b.dead).length > 10) return null;
    const b = addBandit(x, z, { hp: 3 });
    b.ambient = true; // 不计入主线任务,死后在窝点重生
    b.chunk = chunkKey;
    return b;
  },
  dropCoin(x, z, chunkKey) {
    addPickup('coin', x, z, 600, -1, chunkKey);
  },
  dropHeart(x, z, chunkKey) {
    addPickup('heart', x, z, 600, -1, chunkKey);
  },
  removeChunkEntities(chunkKey) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      if (pickups[i].chunk === chunkKey) {
        scene.remove(pickups[i].mesh);
        pickups.splice(i, 1);
      }
    }
    for (let i = wolves.length - 1; i >= 0; i--) {
      if (wolves[i].chunk === chunkKey) {
        scene.remove(wolves[i].group);
        wolves.splice(i, 1);
      }
    }
    for (let i = bandits.length - 1; i >= 0; i--) {
      if (bandits[i].chunk === chunkKey) {
        scene.remove(bandits[i].group);
        bandits.splice(i, 1);
      }
    }
    for (let i = horses.length - 1; i >= 0; i--) {
      const h = horses[i];
      if (h.chunk !== chunkKey) continue;
      if (h === player.mounted) { h.chunk = null; continue; } // 骑走的坐骑归玩家
      scene.remove(h.group);
      horses.splice(i, 1);
    }
  },
});

function updateWolves(dt) {
  // 狼月之夜:入夜后狼群更快更狠
  const wolfBuff = todaySpecial()?.key === 'wolfmoon' && dayPhase() === 'night' ? 1.3 : 1;
  for (const w of wolves) {
    if (w.dead) {
      w.respawnT -= dt;
      if (w.respawnT <= 0) {
        w.dead = false;
        w.hp = 2;
        w.pos.copy(w.home);
        w.group.rotation.x = 0;
        w.group.visible = true;
      }
      continue;
    }
    if (!w.raidTarget && !w.arena && entFar(w)) continue; // 远处的狼睡觉去
    if (w.stunT > 0) { w.stunT -= dt; continue; }
    w.attackCd = Math.max(0, w.attackCd - dt);
    w.lungeCd = Math.max(0, (w.lungeCd || 0) - dt);
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    // 扑咬:蹲伏蓄力 0.3s → 猛扑
    if (w.lunging > 0) {
      w.lunging -= dt;
      if (w.lunging > 0.28) {
        w.group.scale.y = 0.75; // 蹲伏
      } else {
        w.group.scale.y = 1;
        w.pos.x += w.lungeX * 15 * dt;
        w.pos.z += w.lungeZ * 15 * dt;
        resolveCollisions(w.pos, 0.4, colliders);
        if (!w.lungeHit && Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z) < 1.2) {
          w.lungeHit = true;
          damagePlayer(wolfBuff > 1 ? 2 : 1);
        }
      }
      if (w.lunging <= 0) w.group.scale.y = 1;
      w.group.position.copy(w.pos);
      continue;
    }
    // 事件:袭击居民的狼优先咬村民
    if (w.raidTarget && w.raidTarget.downT <= 0 && pd > 9) {
      const v = w.raidTarget;
      const vd = Math.hypot(v.pos.x - w.pos.x, v.pos.z - w.pos.z);
      if (vd > 1.2) { moveEntity(w, v.pos.x, v.pos.z, w.speed, dt); moving = true; }
      else if (w.attackCd <= 0) {
        w.attackCd = 1.4;
        v.downT = 6;
        v.group.rotation.x = -Math.PI / 2;
        sfx.hit();
        w.raidTarget = villagers.find((x) => !x.sleeping && x.downT <= 0 &&
          dist2(w.pos.x, w.pos.z, x.pos.x, x.pos.z) < 900) || null;
      }
      w.group.position.copy(w.pos);
      w.group.rotation.y = w.yaw;
      const sw2 = moving ? Math.sin(w.walkT) * 0.6 : 0;
      w.parts.legs[0].rotation.x = sw2;
      w.parts.legs[1].rotation.x = -sw2;
      w.parts.legs[2].rotation.x = -sw2;
      w.parts.legs[3].rotation.x = sw2;
      continue;
    }
    if (pd < 20 && !player.dead) {
      if (pd < 6 && pd > 1.6 && w.lungeCd <= 0) {
        // 起跳预警
        w.lunging = 0.58;
        w.lungeCd = 2.4;
        w.lungeHit = false;
        const ld = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z) || 1;
        w.lungeX = (player.pos.x - w.pos.x) / ld;
        w.lungeZ = (player.pos.z - w.pos.z) / ld;
        w.yaw = Math.atan2(w.lungeX, w.lungeZ);
        w.group.rotation.y = w.yaw;
        telegraphFlash(w);
        continue;
      }
      if (pd > 1.3) { moveEntity(w, player.pos.x, player.pos.z, w.speed * wolfBuff, dt); moving = true; }
      else if (w.attackCd <= 0) { w.attackCd = 1.1; damagePlayer(1); }
    } else {
      const a = performance.now() * 0.0004 + w.home.x;
      moveEntity(w, w.home.x + Math.cos(a) * 6, w.home.z + Math.sin(a) * 6, w.speed * 0.25, dt);
      moving = true;
    }
    w.group.position.copy(w.pos);
    w.group.rotation.y = w.yaw;
    const swing = moving ? Math.sin(w.walkT) * 0.6 : 0;
    w.parts.legs[0].rotation.x = swing;
    w.parts.legs[1].rotation.x = -swing;
    w.parts.legs[2].rotation.x = -swing;
    w.parts.legs[3].rotation.x = swing;
  }
}

function killWolf(w) {
  w.dead = true;
  w.respawnT = w.arena ? 99999 : (todaySpecial()?.key === 'wolfmoon' ? 22 : 45);
  startFall(w);
  registerKill();
  setTimeout(() => { if (w.dead) w.group.visible = false; }, 2500);
  dropCoins(w.pos, 2);
  wolfKills++;
  // 竞技场里的狼不算狼灾任务(和盗贼任务的排除规则对齐)
  if (!w.arena && quest.active && missions[quest.idx].type === 'wolves') {
    quest.progress++;
    toast(`猎杀恶狼 ${quest.progress}/${missions[quest.idx].goal}`, 2);
    if (quest.progress >= missions[quest.idx].goal) completeMission();
  }
}

// ================= 武器与护甲系统 =================
const WEAPONS = {
  sword:      { name: '铁剑', icon: '🗡️', dmg: 1, range: 2.4, cd: 0.28, knock: 0.55, price: 0 },
  dagger:     { name: '短匕', icon: '🔪', dmg: 1, range: 2.0, cd: 0.16, knock: 0.3, price: 30 },
  greatsword: { name: '巨剑', icon: '⚔️', dmg: 3, range: 2.9, cd: 0.7, knock: 1.3, price: 90 },
  bow:        { name: '猎弓', icon: '🏹', dmg: 2, range: 0, cd: 0.8, knock: 0.4, price: 60 },
};
const ARMORS = [
  { name: '', bonus: 0 },
  { name: '皮甲', bonus: 2, price: 40, color: 0x7a5230 },
  { name: '板甲', bonus: 4, price: 120, color: 0x9aa4ad },
];
player.weapon = 'sword';
player.weaponsOwned = ['sword'];
player.armor = 0;
player.blocking = false;
player.rollT = 0;
player.rollCd = 0;
player.rollDir = new THREE.Vector2(0, 1);

// 手中武器外观
function setWeaponVisual(type) {
  const armR = player.parts.armR;
  if (player.weaponGroup) armR.remove(player.weaponGroup);
  if (player.bowGroup) { player.parts.armL.remove(player.bowGroup); player.bowGroup = null; }
  const g = new THREE.Group();
  const steel = lambert(player.swordLv >= 2 ? 0xe8c34a : 0xd8dde2,
    { metalness: 0.85, roughness: 0.25 });
  if (type === 'dagger') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), steel);
    blade.position.y = -0.46;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), lambert(0x6b4a2f));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'greatsword') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.15, 0.035), steel);
    blade.position.y = -0.82;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.08), lambert(0x8a6a20, { metalness: 0.6, roughness: 0.35 }));
    guard.position.y = -0.28;
    g.add(blade, guard);
  } else if (type === 'bow') {
    // 弓持在左手
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 14, Math.PI), lambert(0x6b4a2f, { roughness: 0.8 }));
    arc.rotation.z = Math.PI / 2;
    bow.add(arc);
    const stringMesh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.84, 0.012), lambert(0xd8d0c0));
    bow.add(stringMesh);
    bow.position.set(0, -0.42, 0.06);
    player.parts.armL.add(bow);
    player.bowGroup = bow;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.03), steel);
    blade.position.y = -0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), lambert(0xc9a227));
    guard.position.y = -0.26;
    g.add(blade, guard);
  }
  g.position.y = -0.2;
  armR.add(g);
  player.weaponGroup = g;
  if (player.parts.sword) player.parts.sword.visible = false; // 隐藏初始剑模型
}
function setArmorVisual(level) {
  if (player.armorMesh) { player.group.remove(player.armorMesh); player.armorMesh = null; }
  if (level <= 0) return;
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.285, 0.5, 10),
    lambert(ARMORS[level].color, { metalness: level === 2 ? 0.7 : 0.1, roughness: level === 2 ? 0.35 : 0.8 }));
  vest.position.y = 0.8;
  player.group.add(vest);
  player.armorMesh = vest;
}
function applyArmor(level) {
  player.armor = level;
  player.maxHp = 10 + ARMORS[level].bonus;
  player.hp = Math.min(player.hp + ARMORS[level].bonus, player.maxHp);
  setArmorVisual(level);
}
function cycleWeapon() {
  if (player.weaponsOwned.length < 2 || player.mounted || player.carrying) return;
  const i = player.weaponsOwned.indexOf(player.weapon);
  player.weapon = player.weaponsOwned[(i + 1) % player.weaponsOwned.length];
  setWeaponVisual(player.weapon);
  sfx.equip();
  toast(`${WEAPONS[player.weapon].icon} 已装备:${WEAPONS[player.weapon].name}`, 1.5);
}

// ---- 箭矢 ----
const arrows = [];
const arrowGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.55, 4);
arrowGeo.rotateX(Math.PI / 2);
const arrowMat = lambert(0x8a6a45, { roughness: 0.8 });
function pointBlocked(x, z) {
  for (const b of colliders.boxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  for (const cc of colliders.circles) {
    const dx = x - cc.x, dz = z - cc.z;
    if (dx * dx + dz * dz < cc.r * cc.r) return true;
  }
  return false;
}
function shootArrow() {
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0.06, Math.cos(player.yaw)).normalize();
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dir.multiplyScalar(26), ttl: 3, stuck: false });
  sfx.arrow();
}
function arrowHitEntities(a) {
  const dmg = WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0);
  const tryHit = (list, onHit) => {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const dy = a.pos.y - 0.9;
      if (dy > 1.4 || dy < -0.9) continue;
      if (dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 0.8) { onHit(e); return true; }
    }
    return false;
  };
  if (tryHit(guards, (g) => {
    g.hp -= dmg; sfx.hit(); hitFX(g, 0.4); showDamage(g.pos, dmg);
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你放箭射击卫兵!'); }
    if (g.hp <= 0) {
      g.downT = 14; g.stunT = 0; g.group.rotation.z = 0;
      g.wantedHit = false; startFall(g); registerKill(); dropCoins(g.pos, 3);
    } else g.state = 'chase';
  })) return true;
  if (tryHit(bandits, (b) => {
    b.hp -= dmg; sfx.hit(); hitFX(b, 0.4); showDamage(b.pos, dmg);
    if (b.hp <= 0) {
      b.dead = true; startFall(b); registerKill();
      dropCoins(b.pos, b.boss ? 20 : 5);
      if (quest.active && missions[quest.idx].type === 'bandits' && !b.boss && !b.escort && !b.bountyHead && !b.robber && !b.arena && !b.ambient && !b.duel && !b.convict && !b.eventFoe) {
        quest.progress++;
        toast(`击败盗贼 ${quest.progress}/3`, 2);
        if (quest.progress >= 3) completeMission();
      }
    }
  })) return true;
  if (tryHit(wolves, (w) => {
    w.hp -= dmg; sfx.hit(); hitFX(w, 0.4); showDamage(w.pos, dmg);
    if (w.hp <= 0) killWolf(w);
  })) return true;
  if (tryHit(deers, (d) => {
    sfx.hit();
    killDeer(d);
  })) return true;
  for (const c of chickens) {
    if (c === player.carrying || c.state === 'thrown') continue;
    if (dist2(a.pos.x, a.pos.z, c.pos.x, c.pos.z) < 0.5 && a.pos.y < 1) { pokeChicken(c); return true; }
  }
  return false;
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.ttl -= dt;
    if (a.ttl <= 0) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
    if (a.stuck) continue;
    a.vel.y -= 7 * dt;
    a.pos.addScaledVector(a.vel, dt);
    a.mesh.position.copy(a.pos);
    a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
    if (arrowHitEntities(a)) { scene.remove(a.mesh); arrows.splice(i, 1); continue; }
    if (a.pos.y <= 0.05 || pointBlocked(a.pos.x, a.pos.z)) {
      a.stuck = true;
      a.ttl = Math.min(a.ttl, 2);
      a.pos.y = Math.max(0.05, a.pos.y);
      a.mesh.position.copy(a.pos);
    }
  }
}

// ---- 铁匠铺(装备商店) ----
const shopEl = document.getElementById('shop');
let shopOpen = false;
function refreshShop() {
  const items = [
    ['shop-dagger', `🔪 短匕 —— 30 金币(出手极快)`, () => !player.weaponsOwned.includes('dagger') && player.coins >= 30,
      () => { player.coins -= 30; player.weaponsOwned.push('dagger'); }],
    ['shop-greatsword', `⚔️ 巨剑 —— 90 金币(势大力沉,击退拉满)`, () => !player.weaponsOwned.includes('greatsword') && player.coins >= 90,
      () => { player.coins -= 90; player.weaponsOwned.push('greatsword'); }],
    ['shop-bow', `🏹 猎弓 —— 60 金币(远程射击,箭矢管够)`, () => !player.weaponsOwned.includes('bow') && player.coins >= 60,
      () => { player.coins -= 60; player.weaponsOwned.push('bow'); }],
    ['shop-temper', `🔥 淬火陨铁 —— 50 金币(所有武器伤害 +1)`, () => player.swordLv === 1 && player.coins >= 50,
      () => { player.coins -= 50; player.swordLv = 2; setWeaponVisual(player.weapon); }],
    ['shop-leather', `🛡️ 皮甲 —— 40 金币(生命上限 +1 心)`, () => player.armor < 1 && player.coins >= 40,
      () => { player.coins -= 40; applyArmor(1); }],
    ['shop-plate', `🛡️ 板甲 —— 120 金币(生命上限 +2 心)`, () => player.armor < 2 && player.coins >= 120,
      () => { player.coins -= 120; applyArmor(2); }],
  ];
  for (const [id, label, canBuy, buy] of items) {
    const btn = document.getElementById(id);
    const owned = id === 'shop-dagger' ? player.weaponsOwned.includes('dagger')
      : id === 'shop-greatsword' ? player.weaponsOwned.includes('greatsword')
      : id === 'shop-bow' ? player.weaponsOwned.includes('bow')
      : id === 'shop-temper' ? player.swordLv >= 2
      : id === 'shop-leather' ? player.armor >= 1
      : player.armor >= 2;
    btn.textContent = owned ? `${label.split('——')[0]}—— 已拥有` : label;
    btn.disabled = !canBuy();
    btn.onclick = () => {
      if (!canBuy()) return;
      buy();
      sfx.chest();
      saveGame();
      refreshShop();
    };
  }
}
function openShop() {
  shopOpen = true;
  refreshShop();
  shopEl.style.display = 'flex';
  document.exitPointerLock();
}
document.getElementById('shop-close').onclick = () => {
  shopOpen = false;
  shopEl.style.display = 'none';
  renderer.domElement.requestPointerLock();
  toast('格罗姆:武器认主,好好待它们。', 2);
};

// ================= 打击感:慢动作/伤害数字/连杀/倒地动画 =================
let hitStopT = 0;
function hitStop(t) { hitStopT = Math.max(hitStopT, t); }

const dmgPool = [];
const _dmgV = new THREE.Vector3();
function showDamage(pos, text, crit = false) {
  let d = dmgPool.find((x) => x.t <= 0);
  if (!d) {
    if (dmgPool.length >= 14) return;
    d = { el: document.createElement('div'), t: 0, p: new THREE.Vector3() };
    document.getElementById('hud').appendChild(d.el);
    dmgPool.push(d);
  }
  d.el.className = crit ? 'dmgnum crit' : 'dmgnum';
  d.el.textContent = text;
  d.t = 0.75;
  d.p.set(pos.x, (pos.y || 0) + 1.5, pos.z);
}
function updateDamageNums(dt) {
  for (const d of dmgPool) {
    if (d.t <= 0) { d.el.style.display = 'none'; continue; }
    d.t -= dt;
    d.p.y += dt * 1.7;
    _dmgV.copy(d.p).project(camera);
    if (_dmgV.z > 1) { d.el.style.display = 'none'; continue; }
    d.el.style.display = 'block';
    d.el.style.left = `${(_dmgV.x * 0.5 + 0.5) * window.innerWidth}px`;
    d.el.style.top = `${(-_dmgV.y * 0.5 + 0.5) * window.innerHeight}px`;
    d.el.style.opacity = Math.min(1, d.t / 0.3);
  }
}

let comboN = 0, comboT = 0;
function registerKill() {
  comboT = 4;
  comboN++;
  sfx.kill();
  hitStop(0.09);
  if (comboN >= 2) {
    sfx.combo(Math.min(comboN, 8));
    const el = document.getElementById('combo');
    el.textContent = `${comboN} 连杀!`;
    el.style.opacity = 1;
    el.style.transform = 'translateX(-50%) scale(1.3)';
    setTimeout(() => { el.style.transform = 'translateX(-50%) scale(1)'; }, 120);
  }
}
function updateCombo(dt) {
  if (comboT > 0) {
    comboT -= dt;
    if (comboT <= 0) { comboN = 0; document.getElementById('combo').style.opacity = 0; }
  }
}

const fallAnims = [];
function startFall(e) { e.group.rotation.x = 0; fallAnims.push({ e, t: 0.32 }); }
function updateFalls(dt) {
  for (let i = fallAnims.length - 1; i >= 0; i--) {
    const f = fallAnims[i];
    f.t -= dt;
    f.e.group.rotation.x = -(1 - Math.max(0, f.t) / 0.32) * Math.PI / 2;
    if (f.t <= 0) fallAnims.splice(i, 1);
  }
}

// 敌人攻击预警红光
function telegraphFlash(e) {
  e.group.traverse((o) => {
    const m = o.material;
    if (m && m.emissive && m._t0 === undefined) {
      m._t0 = m.emissive.getHex();
      m._ti0 = m.emissiveIntensity;
      m.emissive.setHex(0xff2200);
      m.emissiveIntensity = 0.7;
    }
  });
  setTimeout(() => {
    e.group.traverse((o) => {
      const m = o.material;
      if (m && m._t0 !== undefined) {
        m.emissive.setHex(m._t0);
        m.emissiveIntensity = m._ti0;
        delete m._t0;
        delete m._ti0;
      }
    });
  }, 380);
}

// ================= 鸡(惹不起的存在) =================
const chickens = [];
let chickenAnger = 0, chickenAngerT = 0, revengeT = 0;
function addChicken(x, z) {
  const c = { ...makeChicken(), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), state: 'idle', timer: Math.random() * 3,
    vel: new THREE.Vector3(), walkT: 0, peckCd: 0, extra: false };
  c.group.position.copy(c.pos);
  scene.add(c.group);
  chickens.push(c);
  return c;
}
[[18, 84], [22, 88], [26, 84], [10, 22], [-14, 20], [44, 14], [14, 78], [-16, 90]]
  .forEach(([x, z]) => addChicken(x, z));

function pokeChicken(c) {
  sfx.cluck();
  c.state = 'flee';
  c.timer = 2.5;
  chickenAnger++;
  chickenAngerT = 30;
  spawnDust(c.pos.x, 0.3, c.pos.z, 3, 0.4, 1.2);
  if (chickenAnger === 2) toast('🐔 那只鸡狠狠地瞪了你一眼。', 2);
  if (chickenAnger >= 3 && revengeT <= 0) {
    revengeT = 22;
    toast('🐔🐔🐔 你惹怒了鸡群!!快跑!!', 3.5);
    sfx.wanted();
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 6.28;
      const rc = addChicken(player.pos.x + Math.cos(a) * 12, player.pos.z + Math.sin(a) * 12);
      rc.extra = true;
    }
  }
}

function updateChickens(dt) {
  if (chickenAngerT > 0) { chickenAngerT -= dt; if (chickenAngerT <= 0) chickenAnger = 0; }
  if (revengeT > 0) {
    revengeT -= dt;
    if (revengeT <= 0) {
      chickenAnger = 0;
      toast('鸡群消气了……这次就算了。', 2.5);
      for (let i = chickens.length - 1; i >= 0; i--) {
        if (chickens[i].extra && chickens[i] !== player.carrying) { scene.remove(chickens[i].group); chickens.splice(i, 1); }
        else chickens[i].state = chickens[i] === player.carrying ? 'carried' : 'idle';
      }
    }
  }
  for (const c of chickens) {
    if (c === player.carrying) continue;
    if (c.state !== 'thrown' && revengeT <= 0 && entFar(c)) continue; // 远处的鸡不啄米
    let moving = false;
    if (c.state === 'thrown') {
      c.vel.y -= 14 * dt;
      if (c.vel.y < -3) c.vel.y = -3; // 扑腾缓降
      c.pos.addScaledVector(c.vel, dt);
      c.walkT += dt * 30;
      if (c.pos.y <= 0) {
        c.pos.y = 0;
        c.state = 'flee';
        c.timer = 3;
        sfx.cluck();
        // 鸡弹砸中卫兵:袭警!
        for (const g of guards) {
          if (g.downT <= 0 && dist2(c.pos.x, c.pos.z, g.pos.x, g.pos.z) < 2.2) {
            g.stunT = Math.max(g.stunT, 2.5);
            crime(1, '🐔 你用一只鸡袭击了卫兵!');
            break;
          }
        }
        // 砸中村民:吓个半死(不算犯罪,算没品)
        for (const v of villagers) {
          if (!v.sleeping && v.downT <= 0 && dist2(c.pos.x, c.pos.z, v.pos.x, v.pos.z) < 2.2) {
            v.fleeT = 3.5;
            toast('🐔 精准鸡击!村民魂飞魄散。', 2);
            break;
          }
        }
      }
    } else if (revengeT > 0 && !player.dead) {
      c.peckCd = Math.max(0, c.peckCd - dt);
      const pd = Math.hypot(player.pos.x - c.pos.x, player.pos.z - c.pos.z);
      if (pd > 0.7) { moveEntity(c, player.pos.x, player.pos.z, 6.8, dt); moving = true; }
      else if (c.peckCd <= 0) {
        c.peckCd = 1.1;
        damagePlayer(1);
        sfx.cluck();
        if (++stats.pecks >= 5) unlockAch('pecked');
      }
    } else if (c.state === 'flee') {
      c.timer -= dt;
      if (c.timer <= 0) c.state = 'idle';
      const fx = c.pos.x - player.pos.x, fz = c.pos.z - player.pos.z;
      const d = Math.hypot(fx, fz) || 1;
      moveEntity(c, c.pos.x + (fx / d) * 4, c.pos.z + (fz / d) * 4, 5.5, dt);
      moving = true;
    } else {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.timer = 1.5 + Math.random() * 3;
        const a = Math.random() * 6.28;
        c.target = [c.home.x + Math.cos(a) * 4, c.home.z + Math.sin(a) * 4];
      }
      if (c.target && !moveEntity(c, c.target[0], c.target[1], 1.6, dt)) moving = true;
    }
    c.group.position.copy(c.pos);
    c.group.rotation.y = c.yaw;
    c.parts.head.position.z = 0.16 + (moving ? Math.sin(c.walkT * 2) * 0.05 : 0);
    c.parts.body.position.y = 0.26 + (moving ? Math.abs(Math.sin(c.walkT)) * 0.03 : 0);
  }
}

// ================= 绵羊(可以骑,为什么不呢) =================
function addSheep(x, z) {
  const s = { ...makeSheep(), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), owned: false, stolen: false, sheep: true,
    state: 'idle', timer: Math.random() * 4, walkT: 0, baaT: 0 };
  s.group.position.copy(s.pos);
  scene.add(s.group);
  horses.push(s); // 复用坐骑系统
  return s;
}
[[-38, 63], [-42, 67], [-36, 68], [-44, 62], [-40, 71], [-34, 64]].forEach(([x, z]) => addSheep(x, z));

// 灰烬荒地的常驻匪帮(死后一分钟重生)
for (const [ax, az] of [[-368, -30], [-390, -52], [-372, -60]]) {
  const b = addBandit(ax, az, { hp: 3 });
  b.ambient = true;
}

// ================= 远距休眠(性能):够远又没有戏份的实体这一帧不演 =================
const CULL_D2 = 120 * 120;
function entFar(e) {
  return dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > CULL_D2;
}

// ================= 猎鹿(卖鹿肉给罗莎) =================
const deers = [];
function addDeer(x, z) {
  const d = { ...makeHorse(0x9a7148), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), deer: true, state: 'graze', timer: Math.random() * 4,
    walkT: 0, dead: false, respawnT: 0, fleeT: 0, downT: 0, hp: 1 };
  d.group.scale.setScalar(0.62);
  d.group.position.copy(d.pos);
  scene.add(d.group);
  deers.push(d);
  return d;
}
[[-150, -30], [-120, -70], [-172, -94], [-60, -122], [96, -92], [-214, 62], [64, 124], [-70, 134]]
  .forEach(([x, z]) => addDeer(x, z));

function updateDeers(dt) {
  for (const d of deers) {
    if (d.dead) {
      d.respawnT -= dt;
      if (d.respawnT <= 0) {
        d.dead = false;
        d.hp = 1;
        d.pos.copy(d.home);
        d.group.rotation.z = 0;
        d.group.visible = true;
      }
      continue;
    }
    if (entFar(d)) continue;
    const pd2 = dist2(player.pos.x, player.pos.z, d.pos.x, d.pos.z);
    let moving = false;
    if (pd2 < 130 && !player.dead) {
      // 受惊逃窜:朝远离玩家的方向跑
      d.fleeT = 1.2;
    }
    if (d.fleeT > 0) {
      d.fleeT -= dt;
      const fx = d.pos.x - player.pos.x, fz = d.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(d, d.pos.x + (fx / fd) * 10, d.pos.z + (fz / fd) * 10, 8.6, dt);
      moving = true;
    } else {
      d.timer -= dt;
      if (d.timer <= 0) {
        d.timer = 2 + Math.random() * 4;
        d.tx = d.home.x + (Math.random() - 0.5) * 22;
        d.tz = d.home.z + (Math.random() - 0.5) * 22;
      }
      if (d.tx !== undefined && !moveEntity(d, d.tx, d.tz, 1.8, dt)) moving = true;
    }
    d.group.position.copy(d.pos);
    d.group.rotation.y = d.yaw;
    const sw = moving ? Math.sin(d.walkT) * 0.55 : 0;
    d.parts.legs[0].rotation.x = sw;
    d.parts.legs[1].rotation.x = -sw;
    d.parts.legs[2].rotation.x = -sw;
    d.parts.legs[3].rotation.x = sw;
  }
}
function killDeer(d) {
  d.dead = true;
  d.respawnT = 300;
  startFall(d);
  setTimeout(() => { if (d.dead) d.group.visible = false; }, 2500);
  player.venison++;
  stats.deer = (stats.deer || 0) + 1;
  if (stats.deer >= 5) unlockAch('hunter');
  toast(`🦌 猎到一头鹿!鹿肉 ×${player.venison}(卖给旅店老板娘,5 金币一块)`, 3);
}

// ================= 采蘑菇(卖给女巫玛尔戈) =================
const mushrooms = [];
const MUSH_SPOTS = [
  [-128, -44], [-142, -58], [-160, -36], [-176, -70], [-150, -102], [-118, -88],
  [-196, -18], [-124, -18], [-282, 210], [-266, 244], [58, 132], [84, 118], [-52, 148], [-204, 84],
];
{
  const stemG = new THREE.CylinderGeometry(0.09, 0.12, 0.34, 5);
  const capG = new THREE.SphereGeometry(0.26, 7, 5);
  for (const [mx, mz] of MUSH_SPOTS) {
    const grp = new THREE.Group();
    const stem = new THREE.Mesh(stemG, lambert(0xe8e0d0));
    stem.position.y = 0.17;
    grp.add(stem);
    const cap = new THREE.Mesh(capG, lambert(Math.random() < 0.5 ? 0xc03028 : 0xb98a3a, { roughness: 0.7 }));
    cap.scale.y = 0.62;
    cap.position.y = 0.4;
    cap.castShadow = true;
    grp.add(cap);
    grp.position.set(mx, 0, mz);
    scene.add(grp);
    mushrooms.push({ group: grp, x: mx, z: mz, picked: false });
  }
}
function respawnMushrooms() {
  for (const m of mushrooms) { m.picked = false; m.group.visible = true; }
}

// ================= 世界观铭文(可阅读的石碑,集齐 12 处) =================
let loreRead = [];
const loreStones = [];
{
  const slabG = new THREE.BoxGeometry(1.0, 1.5, 0.26);
  const baseG = new THREE.BoxGeometry(1.3, 0.3, 0.5);
  for (const L of LORE) {
    const grp = new THREE.Group();
    const slab = new THREE.Mesh(slabG, lambert(0x8d8a84, { roughness: 0.9 }));
    slab.position.y = 0.95;
    slab.castShadow = true;
    grp.add(slab);
    const base = new THREE.Mesh(baseG, lambert(0x6f6c66));
    base.position.y = 0.15;
    grp.add(base);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x9adcc8, emissive: 0x1a5548, emissiveIntensity: 0.5, roughness: 0.6 }));
    rune.position.set(0, 0.98, 0.14);
    grp.add(rune);
    grp.position.set(L.x, 0, L.z);
    grp.rotation.y = Math.random() * 6.28;
    scene.add(grp);
    loreStones.push({ group: grp, def: L });
  }
}
function readLore(s) {
  const idx = LORE.indexOf(s.def);
  const isNew = !loreRead.includes(idx);
  if (isNew) {
    loreRead.push(idx);
    sfx.chest();
    saveGame();
  }
  // 长文按句切页,读起来不挤
  const parts = s.def.text.split(/(?<=[。」])/).filter(Boolean);
  const pages = [`【铭文 · ${s.def.title}】`];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 60) { pages.push(cur); cur = p; } else cur += p;
  }
  if (cur) pages.push(cur);
  if (isNew) pages.push(`(📜 已收录铭文 ${loreRead.length}/${LORE.length}${loreRead.length >= LORE.length ? ' —— 全部集齐!' : ''})`);
  openDialog(pages, isNew && loreRead.length >= LORE.length ? () => unlockAch('scribe') : null);
}

// ================= 王国公告牌(每日 AI 撰写,离线用内置文风) =================
const NOTICE_POS = { x: -5, z: 12 };
{
  const grp = new THREE.Group();
  const postG = new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6);
  for (const sx of [-0.8, 0.8]) {
    const post = new THREE.Mesh(postG, lambert(0x6b4a2f));
    post.position.set(sx, 1.1, 0);
    grp.add(post);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 0.1), lambert(0x8a6a45, { roughness: 0.9 }));
  panel.position.y = 1.55;
  panel.castShadow = true;
  grp.add(panel);
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xe8ddc2, roughness: 0.95 }));
  paper.position.set(0, 1.55, 0.06);
  grp.add(paper);
  grp.position.set(NOTICE_POS.x, 0, NOTICE_POS.z);
  grp.rotation.y = 2.4;
  scene.add(grp);
}
let proclaimText = null;
const PROCLAIM_STOCK = [
  '城中井水甘冽如常,巡逻如常,税吏比巡逻更如常。',
  '南门吊桥的响声已聆听半年,领主府表示:再听听。',
  '风车、面包与告示,是王都每天醒来的三件事。',
  '卫兵队提醒:抱着鸡奔跑不犯法,但很可疑。',
  '喷泉许愿池本月捞出金币三百枚,愿望办理进度:排队中。',
];
function composeProclaimOffline() {
  const sp = todaySpecial();
  const head = `${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日`;
  const fest = sp ? `今日${sp.name}——${sp.desc}。` : '';
  const stage = quest.idx >= missions.length ? '王国大患已除,领主嘉许全城同庆。'
    : quest.idx > 0 ? `绿衣游侠已为王国办结 ${quest.idx} 件委托,领主府记功在案。` : '领主府招募能人异士,详情垂询管家埃隆。';
  return `【王国公告 · ${head}】${fest}${stage}${PROCLAIM_STOCK[calendar.day % PROCLAIM_STOCK.length]}`;
}
function refreshProclaim() {
  proclaimText = composeProclaimOffline();
  const sp = todaySpecial();
  aiLine(
    `你是中世纪王国艾尔德里亚的王室传令官。今天是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
    `${sp ? ',逢' + sp.name : ''},天气${{ clear: '晴', cloudy: '多云', rain: '雨', storm: '雷暴' }[weather.state]}。` +
    '用中文写一则60字以内的每日公告,口吻庄重里带点冷幽默,只输出公告正文,不要引号。', null, 8000,
  ).then((t) => { if (t) proclaimText = `【王国公告 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日】${t}`; });
}

// ================= 任务系统 =================
const missions = MISSIONS;
const quest = { idx: 0, active: false, progress: 0, timer: 0 };
// 任务运行时对象
const questRT = { rings: [], ringIdx: 0, merchant: null, specialHorse: null, boss: null, escortSpawned: 0 };

// 委托人(金色衣服的老者)
const questGiver = makeHumanoid({ shirt: 0xc9a227, pants: 0x6a5a2a, hair: 0xd8d8d8 });
questGiver.group.position.copy(world.questGiverPos);
questGiver.group.rotation.y = Math.PI;
scene.add(questGiver.group);
// 头顶“!”
const exGroup = new THREE.Group();
const exBar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.14),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
exBar.position.y = 0.3;
const exDot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15),
  new THREE.MeshLambertMaterial({ color: 0xffd83d, emissive: 0x886600 }));
exDot.position.y = -0.1;
exGroup.add(exBar, exDot);
exGroup.position.set(world.questGiverPos.x, 2.1, world.questGiverPos.z);
scene.add(exGroup);

// ================= 钓鱼(栈桥尽头) =================
const FISH_SPOT = { x: -100, z: 82 };
const fishing = { active: false, phase: 'wait', t: 0 };
const CATCHES = [
  { w: 45, text: '一条小鲫鱼!老周按行价收了 3 金币。', coins: 3 },
  { w: 30, text: '一条肥鲤鱼!老周眼睛都亮了,给了 6 金币。', coins: 6 },
  { w: 12, text: '一只老靴子……老周说他找这只鞋找了十年,硬塞给你 2 金币。', coins: 2, ach: 'boot' },
  { w: 8,  text: '水草一团。人生就是这样。', coins: 0 },
  { w: 5,  text: '银月湖大鱼!!鱼尾拍得水花四溅——15 金币,今晚渔村有故事讲了!', coins: 15, ach: 'bigfish' },
];
function startFishing() {
  fishing.active = true;
  fishing.phase = 'wait';
  fishing.t = 2.5 + Math.random() * 4;
  player.yaw = Math.PI; // 面向湖心
  toast('🎣 抛竿……盯紧浮漂,咬钩时按 E!', 3);
}
function fishingReel() {
  if (fishing.phase === 'bite') {
    const total = CATCHES.reduce((s, c) => s + c.w, 0);
    let roll = Math.random() * total;
    let got = CATCHES[0];
    for (const c of CATCHES) { roll -= c.w; if (roll <= 0) { got = c; break; } }
    const moonX2 = todaySpecial()?.key === 'fullmoon' && got.coins > 0;
    player.coins += moonX2 ? got.coins * 2 : got.coins;
    if (got.coins > 0) sfx.coin();
    sfx.splash();
    if (got.ach) unlockAch(got.ach);
    openDialog([`(收杆!)${got.text}` + (moonX2 ? '(🌕 满月夜,鱼获双倍!)' : '')]);
  } else {
    sfx.splash();
    toast('收早了,鱼吐着泡跑了。', 2);
  }
  fishing.active = false;
}
function updateFishing(dt) {
  if (!fishing.active) return;
  fishing.t -= dt;
  if (fishing.phase === 'wait' && fishing.t <= 0) {
    fishing.phase = 'bite';
    fishing.t = 0.9;
    sfx.splash();
  } else if (fishing.phase === 'bite' && fishing.t <= 0) {
    fishing.phase = 'wait';
    fishing.t = 2.5 + Math.random() * 4;
    toast('浮漂动了一下又静了……鱼跑了。', 2);
  }
}

// ================= 街头随机事件(GTA 式) =================
const streetEvent = { type: null, t: 0, villager: null, bandit: null, horse: null, cooldown: 130 };
function endStreetEvent() {
  if (streetEvent.bandit && !streetEvent.bandit.dead) {
    scene.remove(streetEvent.bandit.group);
    const i = bandits.indexOf(streetEvent.bandit);
    if (i >= 0) bandits.splice(i, 1);
  }
  if (streetEvent.horse) {
    streetEvent.horse.runaway = false;
    // 事件的马不留档:骑着就归你,否则撤走,免得满地图攒野马
    if (streetEvent.horse !== player.mounted) {
      const hi = horses.indexOf(streetEvent.horse);
      if (hi >= 0) { scene.remove(streetEvent.horse.group); horses.splice(hi, 1); }
    }
  }
  streetEvent.type = null;
  streetEvent.bandit = null;
  streetEvent.horse = null;
  streetEvent.cooldown = 150 + Math.random() * 90;
}
function trySpawnStreetEvent() {
  if (arenaRT.active) return;
  if (dailyEvents <= 0) { streetEvent.cooldown = 60; return; } // 今日热闹够了
  dailyEvents--;
  if (Math.random() < 0.5) {
    // 抢劫:挑一个不太远的清醒村民
    const v = villagers.find((x) => !x.sleeping && x.downT <= 0 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600 &&
      dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) > 100);
    if (!v) { dailyEvents++; streetEvent.cooldown = 25; return; }
    streetEvent.type = 'robbery';
    streetEvent.villager = v;
    streetEvent.t = 40;
    streetEvent.bandit = addBandit(v.pos.x + 6, v.pos.z + 3, { escort: false });
    streetEvent.bandit.robber = true;
    toast('⚠️ 有盗贼在抢劫路人!快去帮忙!', 3.5);
    sfx.wanted();
  } else {
    streetEvent.type = 'horse';
    streetEvent.t = 60;
    const a = Math.random() * 6.28;
    streetEvent.horse = addHorse(player.pos.x + Math.cos(a) * 25, player.pos.z + Math.sin(a) * 25,
      0x7a4a30, false);
    streetEvent.horse.runaway = true;
    toast('🐴 一匹受惊的马狂奔而过!骑上它让它安静下来!', 3.5);
  }
}
function updateStreetEvent(dt) {
  if (!streetEvent.type) {
    streetEvent.cooldown -= dt;
    if (streetEvent.cooldown <= 0 && started && !player.dead && quest.idx > 0) trySpawnStreetEvent();
    return;
  }
  streetEvent.t -= dt;
  if (streetEvent.type === 'robbery') {
    const b = streetEvent.bandit, v = streetEvent.villager;
    if (b.dead) {
      unlockAch('hero');
      player.coins += 15;
      sfx.coin();
      showBubble(v, v.id.name, '恩人呐!这点心意您一定收下!(塞给你 15 金币)', 4);
      streetEvent.bandit = null;
      endStreetEvent();
      return;
    }
    if (streetEvent.t <= 0) { endStreetEvent(); return; }
    // 盗贼得手后逃向森林
    if (b.fleeing) {
      moveEntity(b, -150, -20, 6.5, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1);
      if (dist2(b.pos.x, b.pos.z, -150, -20) < 100) endStreetEvent();
    }
  } else if (streetEvent.type === 'horse') {
    const h = streetEvent.horse;
    if (player.mounted === h) {
      h.runaway = false;
      player.coins += 10;
      sfx.coin();
      toast('🐴 马安静了下来。马主人追上来,塞给你 10 金币连声道谢!', 4);
      streetEvent.horse = null;
      endStreetEvent();
      return;
    }
    if (streetEvent.t <= 0) { endStreetEvent(); return; }
  }
}

// ================= 悬赏板(无限重复) =================
const BOUNTY_NAMES = ['独眼汉斯', '瘸腿约里克', '大鼻子威利', '无声的多特', '斑脸巴克', '铁牙戈登'];
const BOUNTY_SPOTS = [
  ['幽暗森林', -150, -20], ['哨塔遗迹', 80, -118], ['先祖石环', 168, -58], ['静眠墓园', -42, -118],
  ['琥珀荒漠', 300, 188], ['灰烬荒地', -378, -42], ['龙骨之地', 298, -150], ['雾语沼泽', -288, 244],
];
const bountyRT = { target: null, name: '', cooldown: 0 };
{
  // 告示板
  const bb = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 2.2, 5),
      lambert(0x6b4a2f, { roughness: 0.9 }));
    post.position.set(0.8 * s, 1.1, 0);
    bb.add(post);
  }
  const bCanvas = document.createElement('canvas');
  bCanvas.width = 128; bCanvas.height = 96;
  const bg = bCanvas.getContext('2d');
  bg.fillStyle = '#d8c9a0'; bg.fillRect(0, 0, 128, 96);
  bg.fillStyle = '#5a3a1a'; bg.font = 'bold 40px serif';
  bg.textAlign = 'center'; bg.fillText('悬赏', 64, 58);
  const plank = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bCanvas), side: THREE.DoubleSide, roughness: 0.95 }));
  plank.position.y = 1.6;
  bb.add(plank);
  bb.position.set(8, 0, 46);
  bb.rotation.y = -0.5;
  scene.add(bb);
  colliders.circles.push({ x: 8, z: 46, r: 0.9 });
}
function takeBounty() {
  const [place, bx, bz] = BOUNTY_SPOTS[Math.floor(Math.random() * BOUNTY_SPOTS.length)];
  bountyRT.name = BOUNTY_NAMES[Math.floor(Math.random() * BOUNTY_NAMES.length)];
  bountyRT.target = addBandit(bx + (Math.random() * 8 - 4), bz + (Math.random() * 8 - 4),
    { hp: 5, scale: 1.12, dmg: 2 });
  bountyRT.target.bountyHead = true;
  sfx.accept();
  openDialog([`(揭下悬赏令)通缉要犯「${bountyRT.name}」,现身于${place}一带。生死不论,赏金 30 枚。`]);
}
function updateBounty(dt) {
  if (bountyRT.cooldown > 0) bountyRT.cooldown -= dt;
  if (bountyRT.target && bountyRT.target.dead) {
    player.coins += 30;
    sfx.fanfare();
    toast(`📜 「${bountyRT.name}」已伏法,赏金 30 金币到手!`, 4);
    bountyRT.target = null;
    bountyRT.cooldown = 30;
    saveGame();
  }
}

// ================= 荒沙角斗场(波次生存) =================
const ARENA = { x: 60, z: -85, r: 13 };
{
  const sandD = new THREE.Mesh(new THREE.CircleGeometry(ARENA.r, 24), lambert(0xd9c48f, { roughness: 1 }));
  sandD.rotation.x = -Math.PI / 2;
  sandD.position.set(ARENA.x, 0.035, ARENA.z);
  sandD.receiveShadow = true;
  scene.add(sandD);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (a > 1.1 && a < 2.0) continue; // 入口豁口
    const px = ARENA.x + Math.cos(a) * ARENA.r, pz = ARENA.z + Math.sin(a) * ARENA.r;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.72, 3.6, 7),
      lambert(0x8d8476, { roughness: 0.95 }));
    pillar.position.set(px, 1.8, pz);
    pillar.castShadow = true;
    scene.add(pillar);
    colliders.circles.push({ x: px, z: pz, r: 0.85 });
  }
  const brazier = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 6),
    new THREE.MeshLambertMaterial({ color: 0xff7722, emissive: 0xff5500 }));
  brazier.position.set(ARENA.x + 4.5, 0.4, ARENA.z + 11.5);
  scene.add(brazier);
  const bLight = new THREE.PointLight(0xff8844, 0, 20, 2);
  bLight.position.set(ARENA.x + 4.5, 1.4, ARENA.z + 11.5);
  scene.add(bLight);
  world.torches.push({ light: bLight, flame: brazier, base: 10 });
}
const arenaHost = { ...makeHumanoid({ shirt: 0x8a2f2f, pants: 0x3a3026, helmet: true, sword: true }),
  pos: new THREE.Vector3(ARENA.x + 6, 0, ARENA.z + 11), yaw: -0.6, lineIdx: 0 };
arenaHost.group.position.copy(arenaHost.pos);
arenaHost.group.rotation.y = arenaHost.yaw;
scene.add(arenaHost.group);
const HOST_LINES = [
  '我叫血牙,当年在南方斗过狮子。现在?看别人流血,收门票。',
  '规矩:站在沙圈里,活下来。走出圈,就算认输。',
  '第五波之后才算开胃。撑得越久,赏钱越厚。',
];
const arenaRT = { active: false, wave: 0, betweenT: 0, foes: [] };
function startArenaWave() {
  arenaRT.wave++;
  toast(`🏟️ 第 ${arenaRT.wave} 波!敌人入场!`, 2);
  sfx.wanted();
  const n = 1 + arenaRT.wave;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const px = ARENA.x + Math.cos(a) * (ARENA.r - 2.5);
    const pz = ARENA.z + Math.sin(a) * (ARENA.r - 2.5);
    if (i % 3 === 2) {
      const w = addWolf(px, pz);
      w.arena = true;
      w.hp = 2 + Math.floor(arenaRT.wave / 3);
      arenaRT.foes.push(w);
    } else {
      const b = addBandit(px, pz, {
        hp: 3 + Math.floor(arenaRT.wave / 2),
        dmg: arenaRT.wave >= 4 ? 2 : 1,
        speed: 5.8 + Math.min(2, arenaRT.wave * 0.25),
      });
      b.arena = true;
      arenaRT.foes.push(b);
    }
  }
}
function endArena(msg) {
  const reached = arenaRT.wave;
  arenaRT.active = false;
  for (const f of arenaRT.foes) {
    scene.remove(f.group);
    let idx = bandits.indexOf(f);
    if (idx >= 0) bandits.splice(idx, 1);
    idx = wolves.indexOf(f);
    if (idx >= 0) wolves.splice(idx, 1);
  }
  arenaRT.foes = [];
  arenaRT.wave = 0;
  if (reached - 1 > (stats.arenaBest || 0)) {
    stats.arenaBest = reached - 1;
    saveGame();
  }
  toast(msg, 4);
}
function updateArena(dt) {
  if (!arenaRT.active) return;
  if (player.dead) { endArena('🏟️ 角斗结束。血牙记下了你的名字。'); return; }
  if (dist2(player.pos.x, player.pos.z, ARENA.x, ARENA.z) > (ARENA.r + 5) * (ARENA.r + 5)) {
    endArena(`🏟️ 你走出了沙圈,角斗结束。本次撑到第 ${arenaRT.wave} 波(最佳:${Math.max(stats.arenaBest || 0, arenaRT.wave - 1)})`);
    return;
  }
  if (arenaRT.betweenT > 0) {
    arenaRT.betweenT -= dt;
    if (arenaRT.betweenT <= 0) startArenaWave();
    return;
  }
  if (!arenaRT.foes.some((f) => !f.dead && !(f.downT > 0))) {
    const reward = arenaRT.wave * 10;
    player.coins += reward;
    sfx.fanfare();
    toast(`🏟️ 第 ${arenaRT.wave} 波清空!+${reward} 金币,4 秒后下一波…`, 3);
    if (arenaRT.wave >= 5) unlockAch('gladiator');
    arenaRT.betweenT = 4;
  }
}

// ================= 事件导演:永无止境的随机事件 =================
// 每 45~105 秒按权重与条件(时辰/位置/进度)抽取一个事件在玩家附近上演
const director = { handle: null, cd: 90 };

function spawnNearPlayer(minR, maxR) {
  const a = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  const p = { x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r };
  resolveCollisions(p, 1, colliders);
  return p;
}
function makeWanderer(style, x, z) {
  const n = { ...makeHumanoid(style), pos: new THREE.Vector3(x, 0, z), yaw: 0, walkT: 0 };
  n.group.position.copy(n.pos);
  scene.add(n.group);
  return n;
}

const DIRECTOR_EVENTS = [
  {
    key: 'wolfRaid', w: 10,
    cond: () => quest.idx >= 2 && villagers.some((v) => !v.sleeping &&
      dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) < 3600),
    start() {
      const v = villagers.find((x) => !x.sleeping && dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600);
      const pack = [];
      for (let i = 0; i < 3; i++) {
        const p = spawnNearPlayer(24, 34);
        const w = addWolf(p.x, p.z);
        w.raidTarget = v;
        pack.push(w);
      }
      toast('📣 狼群袭击了居民!快去救人!', 3.5);
      sfx.wanted();
      return {
        t: 60,
        update() {
          if (pack.every((w) => w.dead)) {
            player.coins += 20;
            sfx.fanfare();
            toast('🐺 狼群被击退!居民凑了 20 金币谢你。', 4);
            this.t = 0;
          }
        },
        end() { for (const w of pack) { w.raidTarget = null; } },
      };
    },
  },
  {
    key: 'tollAmbush', w: 9,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 0) > 8100,
    start() {
      const thugs = [];
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        const p = spawnNearPlayer(12, 18);
        thugs.push(addBandit(p.x, p.z, { hp: 3 }));
      }
      for (const b of thugs) b.eventFoe = true;
      toast('📣 「站住!留下买路钱!」——路霸现身!', 3.5);
      sfx.wanted();
      return {
        t: 70,
        update() {
          if (thugs.every((b) => b.dead)) {
            player.coins += 15;
            toast('💰 路霸被清剿,+15 金币。', 3);
            sfx.coin();
            this.t = 0;
          }
        },
        end() {
          for (const b of thugs) {
            if (!b.dead) { scene.remove(b.group); const i = bandits.indexOf(b); if (i >= 0) bandits.splice(i, 1); }
          }
        },
      };
    },
  },
  {
    key: 'duelist', w: 7,
    cond: () => quest.idx >= 2,
    start() {
      const p = spawnNearPlayer(10, 15);
      const d = addBandit(p.x, p.z, { hp: 5, dmg: 1, speed: 6 });
      d.duel = true;
      d.eventFoe = true;
      toast('📣 流浪剑客卡洛拔剑相向:「久仰!让我看看你的剑!」', 4);
      return {
        t: 90,
        update() {
          if (d.dead) {
            player.coins += 20;
            sfx.fanfare();
            toast('🤺 卡洛抱拳认负:「好剑法!」(+20 金币)', 4);
            this.t = 0;
          }
        },
        end() {
          if (!d.dead) {
            toast('🤺 卡洛收剑离去:「下次再切磋。」', 3);
            scene.remove(d.group);
            const i = bandits.indexOf(d);
            if (i >= 0) bandits.splice(i, 1);
          }
        },
      };
    },
  },
  {
    key: 'convict', w: 8,
    cond: () => quest.idx >= 1,
    start() {
      const p = spawnNearPlayer(14, 20);
      const c = addBandit(p.x, p.z, { hp: 4, speed: 6.4 });
      c.convict = true;
      c.eventFoe = true;
      toast('📣 有逃犯越狱!活捉或击倒都有赏!', 3.5);
      sfx.wanted();
      return {
        t: 80,
        update() {
          if (c.dead) {
            player.coins += 25;
            sfx.fanfare();
            toast('⛓️ 逃犯归案,+25 金币赏金!', 3.5);
            this.t = 0;
          } else if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) > 32400) {
            toast('⛓️ 逃犯跑远了……', 2.5);
            this.t = 0;
          }
        },
        end() {
          if (!c.dead) { scene.remove(c.group); const i = bandits.indexOf(c); if (i >= 0) bandits.splice(i, 1); }
        },
      };
    },
  },
  {
    key: 'meteor', w: 6,
    cond: () => dayPhase() === 'night' || dayPhase() === 'dusk',
    start() {
      const p = spawnNearPlayer(28, 50);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
      const glow = new THREE.PointLight(0xffaa44, 30, 60, 2);
      ball.position.set(p.x + 40, 90, p.z - 30);
      glow.position.copy(ball.position);
      scene.add(ball, glow);
      toast('☄️ 夜空中有什么东西坠落了!', 3);
      let landed = false;
      return {
        t: 40,
        update(dt2) {
          if (!landed) {
            ball.position.x -= 40 * dt2 * 0.55;
            ball.position.y -= 90 * dt2 * 0.55;
            ball.position.z += 30 * dt2 * 0.55;
            glow.position.copy(ball.position);
            if (ball.position.y <= 0.5) {
              landed = true;
              scene.remove(ball);
              weatherAudio.thunder();
              camShake = Math.max(camShake, 0.5);
              spawnDust(p.x, 0.3, p.z, 20, 4, 2.5);
              const crater = new THREE.Mesh(new THREE.CircleGeometry(3.2, 12),
                lambert(0x4a4038, { roughness: 1 }));
              crater.rotation.x = -Math.PI / 2;
              crater.position.set(p.x, 0.04, p.z);
              scene.add(crater);
              this.crater = crater;
              for (let i = 0; i < 10; i++) {
                const a2 = Math.random() * 6.28;
                addPickup('coin', p.x + Math.cos(a2) * (1 + Math.random() * 2.5),
                  p.z + Math.sin(a2) * (1 + Math.random() * 2.5), 60);
              }
              toast('☄️ 陨石坠地!坑里散着灼热的金币!', 4);
            }
          } else {
            glow.intensity = Math.max(0, glow.intensity - dt2 * 15);
          }
        },
        end() { scene.remove(ball); scene.remove(glow); },
      };
    },
  },
  {
    key: 'mysticMerchant', w: 6,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(12, 16);
      const m = makeWanderer({ shirt: 0x2a3a5a, pants: 0x1a2438, hood: true }, p.x, p.z);
      toast('📣 一位兜帽商人不知从哪儿冒了出来……', 3);
      const h = {
        t: 45,
        merchant: m,
        update() {
          if (dist2(player.pos.x, player.pos.z, m.pos.x, m.pos.z) < 30) {
            m.group.rotation.y = angleLerp(m.group.rotation.y,
              Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z), 0.1);
          }
        },
        end() {
          spawnDust(m.pos.x, 0.5, m.pos.z, 8, 0.8, 1.5);
          scene.remove(m.group);
          if (director.mystic === m) director.mystic = null;
        },
      };
      director.mystic = m;
      return h;
    },
  },
  {
    key: 'ghost', w: 5,
    cond: () => dayPhase() === 'night',
    start() {
      const p = spawnNearPlayer(15, 22);
      const g = makeWanderer({ shirt: 0xeeeeff, pants: 0xddddee, hair: 0xffffff }, p.x, p.z);
      g.group.traverse((o) => {
        if (o.material) { o.material.transparent = true; o.material.opacity = 0.4; }
      });
      toast('👻 夜色里飘着一个苍白的身影……', 3);
      let t0 = 0;
      return {
        t: 50,
        update(dt2) {
          t0 += dt2;
          g.group.position.y = 0.3 + Math.sin(t0 * 2) * 0.15;
          if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16) {
            sfx.hurt();
            spawnDust(g.pos.x, 1, g.pos.z, 10, 1, 1.2);
            for (let i = 0; i < 12; i++) {
              const a2 = Math.random() * 6.28;
              addPickup('coin', g.pos.x + Math.cos(a2) * 2, g.pos.z + Math.sin(a2) * 2, 40);
            }
            toast(`👻 「${GHOST_LINES[Math.floor(Math.random() * GHOST_LINES.length)]}」——幽灵消散了,留下一把冰凉的古币`, 4.5);
            this.t = 0;
          }
        },
        end() { scene.remove(g.group); },
      };
    },
  },
  {
    key: 'goldenChicken', w: 5,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(10, 14);
      const c = addChicken(p.x, p.z);
      c.golden = true;
      c.extra = true;
      c.group.traverse((o) => {
        if (o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.setHex(0xffd83d);
          if (o.material.emissive) { o.material.emissive.setHex(0x8a5c00); o.material.emissiveIntensity = 0.5; }
        }
      });
      toast('🐔✨ 一只金鸡出没!抱住它!', 3.5);
      return {
        t: 45,
        update() {
          // 金鸡永远想逃离玩家
          if (c.state !== 'carried' && c !== player.carrying) {
            c.state = 'flee';
            c.timer = 1;
          }
          if (player.carrying === c) {
            player.coins += 30;
            sfx.fanfare();
            toast('🐔✨ 金鸡在你怀里化作 30 枚金币!!', 4);
            player.carrying = null;
            this.t = 0;
          }
        },
        end() {
          const i = chickens.indexOf(c);
          if (i >= 0) { scene.remove(c.group); chickens.splice(i, 1); }
        },
      };
    },
  },
  {
    key: 'chickenRiot', w: 3,
    cond: () => revengeT <= 0 && dist2(player.pos.x, player.pos.z, 20, 85) < 14400,
    start() {
      chickenAnger = 3;
      revengeT = 15;
      toast('🐔 鸡群今天心情不好——暴动了!!', 3.5);
      sfx.wanted();
      for (let i = 0; i < 4; i++) {
        const p = spawnNearPlayer(10, 14);
        const rc = addChicken(p.x, p.z);
        rc.extra = true;
      }
      return { t: 16, update() {}, end() {} };
    },
  },
  {
    key: 'coinRain', w: 4,
    cond: () => true,
    start() {
      toast('💨 一阵怪风卷来了谁家的钱袋!', 3);
      sfx.coin();
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * 6.28;
        addPickup('coin', player.pos.x + Math.cos(a) * (3 + Math.random() * 6),
          player.pos.z + Math.sin(a) * (3 + Math.random() * 6), 30);
      }
      return { t: 5, update() {}, end() {} };
    },
  },
];

function updateDirector(dt) {
  if (!started || player.dead || arenaRT.active) return;
  if (director.handle) {
    const h = director.handle;
    h.t -= dt;
    if (h.update) h.update(dt);
    if (h.t <= 0) {
      if (h.end) h.end();
      director.handle = null;
      director.cd = 90 + Math.random() * 70;
    }
    return;
  }
  director.cd -= dt;
  if (director.cd > 0) return;
  if (dailyEvents <= 0) { director.cd = 45; return; } // 今日限额已满,明天再说
  const pool = DIRECTOR_EVENTS.filter((e) => e.cond());
  if (!pool.length) { director.cd = 30; return; }
  // 满月夜里亡魂更容易现身
  const wOf = (e) => (e.key === 'ghost' && todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night') ? e.w * 4 : e.w;
  let total = pool.reduce((s, e) => s + wOf(e), 0);
  let roll = Math.random() * total;
  let ev = pool[0];
  for (const e of pool) { roll -= wOf(e); if (roll <= 0) { ev = e; break; } }
  dailyEvents--;
  director.handle = ev.start();
}

// ================= 具名 NPC =================
const npcStyles = {
  witch: { shirt: 0x3a2a4a, pants: 0x261a30, hood: true, hair: 0x888888 },
  king: { shirt: 0x7a1f8a, pants: 0x3a2a4a, hair: 0xd8d8d8 },
  blacksmith: { shirt: 0x5a4632, pants: 0x33261a, hair: 0x2a1a10 },
  trader: { shirt: 0x2a6a5a, pants: 0x4a3a26, hair: 0x6a4a2a },
  innkeep: { shirt: 0xa04a5a, pants: 0x4a3320, hair: 0x8a3a1a },
  fisher: { shirt: 0x3a5a7a, pants: 0x33301c, hair: 0xbababa },
};
const namedNPCs = [];
const EXTRA_NPCS = {
  witch: { name: '沼泽女巫玛尔戈', lines: [
    '汤锅里炖的?蘑菇、蛙腿、还有一点点秘密。',
    '乌拉那丫头又来讨药方了。告诉她,桦树皮我收着呢。',
    '沼泽认得善人的脚印。你的脚印……还行。',
  ] },
};
for (const [key, [nx, nz, nyaw]] of Object.entries(world.npcSpots)) {
  const n = { ...makeHumanoid(npcStyles[key]), key, def: NPCS[key] || EXTRA_NPCS[key],
    pos: new THREE.Vector3(nx, 0, nz), yaw: nyaw, lineIdx: 0, rewarded: false, walkT: 0 };
  n.group.position.copy(n.pos);
  n.group.rotation.y = nyaw;
  scene.add(n.group);
  namedNPCs.push(n);
}
// 管家埃隆(委托人)也是有日程的活人
const steward = { group: questGiver.group, parts: questGiver.parts, key: 'steward',
  def: NPCS.steward, pos: world.questGiverPos.clone(), yaw: Math.PI, lineIdx: 0, walkT: 0 };
namedNPCs.push(steward);

// ================= 无意义成就(奖励瞎玩) =================
const ACH_DEFS = {
  boot:     { name: '湖底时尚', desc: '钓上一只老靴子' },
  bigfish:  { name: '银月传说', desc: '钓上湖中大鱼' },
  hero:     { name: '见义勇为', desc: '阻止一次街头抢劫' },
  gladiator:{ name: '角斗新星', desc: '竞技场撑过 5 波' },
  chucker:  { name: '禽兽行为', desc: '扔出 10 次鸡' },
  pecked:   { name: '鸡下败将', desc: '被复仇鸡群啄中 5 次' },
  windmill: { name: '第二位风车骑士', desc: '对着风车挥剑' },
  wisher:   { name: '许愿池钉子户', desc: '许愿 10 次' },
  drunkard: { name: '酒中豪杰', desc: '醉倒 3 次' },
  loser:    { name: '赌怪', desc: '骰子连输 3 把' },
  shepherd: { name: '羊骑士', desc: '骑羊走过 100 米' },
  bouncer:  { name: '弹簧靴', desc: '2 秒内连环踩踏两个目标' },
  hunter:   { name: '荒野猎手', desc: '猎到 5 头鹿' },
  forager:  { name: '采菇人', desc: '采到 15 朵蘑菇' },
  scribe:   { name: '史官', desc: '读遍全部 12 处世界观铭文' },
};
const stats = { thrown: 0, pecks: 0, wishes: 0, drunks: 0, loseStreak: 0, sheepDist: 0, lastStomp: -99, deer: 0, mushrooms: 0 };
let achUnlocked = [];
function unlockAch(key) {
  if (achUnlocked.includes(key)) return;
  achUnlocked.push(key);
  sfx.fanfare();
  toast(`🏆 无意义成就:${ACH_DEFS[key].name} —— ${ACH_DEFS[key].desc}`, 4);
  saveGame();
}

// ================= 搞笑 NPC(无意义但快乐) =================
const FUNNY = {
  gambler: {
    name: '赌鬼豆子', spot: [8, 74.5, 2.6],
    style: { shirt: 0x8a6a1a, pants: 0x3a3026, hair: 0x1a1a14 },
    idle: [
      '手气这东西,越没有越想要。',
      '我戒赌了。从今天中午开始。',
      '这对骰子跟了我十年,输了我八年。',
      '别信什么必胜法,信我——也别信。',
    ],
  },
  bard: {
    name: '吟游诗人皮波', spot: [-5, 9.5, 2.8],
    style: { shirt: 0x9a3aa0, pants: 0x2a2a3a, hair: 0xd0b040 },
    idle: [
      '琴弦一响,金币作响……最好是。',
      '我给巨龙写过歌。它没来听,万幸。',
      '灵感这东西,和跳蚤一样,痒的时候抓不着。',
      '想听你自己的歌吗?我出词,你出事迹。',
    ],
  },
  prophet: {
    name: '疯子老糊涂', spot: [-11, 1.5, 1.2],
    style: { shirt: 0x5a5a52, pants: 0x4a4640, hair: 0xcccccc },
    idle: [
      '我看见了!头顶的太阳每四分钟绕一圈——这合理吗?!',
      '世界的尽头有一堵看不见的墙。我走过去,鼻子撞扁了。',
      '雨不是云下的!是有人在天上倒水!我数过,每次都是一千一百条雨丝!',
      '金币会自己转圈圈,你没发现吗?没有风!它们自己在转!',
      '我梦见我们都是一堆会走路的方块……醒来后我看了看我的手,不敢再想。',
      '每天清晨,面包师都从同一个位置出现。时间是个圈!圈!',
      '月亮和太阳从来不同时出现超过一炷香——有人在换布景!',
      '你走路的样子……腿的摆动像被人操纵着。你自己知道吗?!',
    ],
  },
  storyteller: {
    name: '盲眼说书人苟叔', spot: [17, 73, -2.2],
    style: { shirt: 0x4a4038, pants: 0x33302a, hair: 0xd8d8d8 },
    idle: [
      '(敲了敲烟杆)故事嘛,得等火候。',
      '我眼睛瞎了,故事反倒看得更清了。',
      '旅店的酒是引子,故事才是正菜。',
      '想听哪段?龙骨?湖底?还是……你自己的?',
    ],
  },
  quixote: {
    name: '风车骑士唐豆', spot: [133.5, 14.5, 1.0],
    style: { shirt: 0x7a7a86, pants: 0x3a3a44, helmet: true, sword: true },
    idle: [
      '退后!那个挥舞四条巨臂的巨人是我的对手!',
      '我叫唐豆,风车骑士!已与此巨人激战三年,不分胜负!',
      '它转一圈,我砍一剑。公平的决斗!',
      '别被它温和的外表骗了——它在积蓄力量,我看得出来!',
      '等我打败它,磨坊主会把它的四条手臂送给我做纪念。他亲口答应的!',
    ],
  },
};
const funnyNPCs = [];
for (const [key, def] of Object.entries(FUNNY)) {
  const n = { ...makeHumanoid(def.style), key, def,
    pos: new THREE.Vector3(def.spot[0], 0, def.spot[1]), yaw: def.spot[2],
    lineIdx: 0, walkT: 0, swingT: 0 };
  n.group.position.copy(n.pos);
  n.group.rotation.y = n.yaw;
  scene.add(n.group);
  funnyNPCs.push(n);
}
const quixote = funnyNPCs.find((n) => n.key === 'quixote');
let quixoteT = 2;

// 骰子赌局
function gamble() {
  sfx.dice();
  if (player.coins < 10) {
    openDialog(['豆子:(把骰子一收)兜里连十个金币都没有?去去去,赚够了再来坐庄家对面。']);
    return;
  }
  const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
  const c = 1 + Math.floor(Math.random() * 6), d = 1 + Math.floor(Math.random() * 6);
  const my = a + b, his = c + d;
  let result;
  if (my > his) { player.coins += 10; stats.loseStreak = 0; result = '豆子:(肉痛地推来金币)哎哟!拿走拿走,今晚喝西北风的是我。'; }
  else if (my < his) {
    player.coins -= 10;
    if (++stats.loseStreak >= 3) unlockAch('loser');
    result = '豆子:(笑眯眯地扒拉金币)承让承让——骰子亲我,不亲你。';
  }
  else { result = '豆子:平局!钱各回各家……真没意思,再来?'; }
  openDialog([
    '豆子:(搓了搓骰子)十个金币,买定离手——',
    `豆子:(哗啦一掷)你 ${a}+${b}=${my} 点,我 ${c}+${d}=${his} 点!`,
    result,
  ]);
}

// 吟游诗人:按你的真实事迹即兴打油诗(联网时由 AI 现场作词)
async function bardSong() {
  sfx.lute();
  const deedsForAI = [];
  if (wanted > 0) deedsForAI.push(`被通缉${wanted}星`);
  if (player.royalHorse) deedsForAI.push('有一匹皇家骏马');
  if (wolfKills > 0) deedsForAI.push(`猎杀了${wolfKills}头恶狼`);
  if (quest.idx > 0) deedsForAI.push(`完成了${quest.idx}件领主委托`);
  deedsForAI.push(`身上有${player.coins}枚金币`);
  toast('🎵 皮波拨了拨琴弦,正在酝酿……', 2);
  const ai = await aiLine(
    `你是中世纪吟游诗人皮波。用中文写一首恰好4行的幽默打油诗,歌颂绿帽游侠林恩:` +
    `${deedsForAI.join(',')}。要押韵、要俏皮。只输出四行诗,不要任何解释。`, null);
  if (ai) {
    const lines = ai.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    openDialog([
      '皮波:(拨响鲁特琴)咳咳——AI……啊不,缪斯女神刚给了我灵感!',
      ...lines.map((l) => `皮波:♪ ${l} ♪`),
      '皮波:(潇洒收弦)……打赏随意,掌声免费!',
    ]);
    return;
  }
  bardSongOffline();
}
function bardSongOffline() {
  const deeds = [];
  if (wanted > 0) deeds.push(`通缉星星头上飘,卫兵追他满城跑`);
  if (horses.some((h) => h.stolen)) deeds.push('顺过人家一匹马(嘘——)');
  if (player.royalHorse) deeds.push('胯下疾风踏烟尘');
  if (wolfKills > 0) deeds.push(`林中恶狼${wolfKills}头倒`);
  if (crestsFound.length > 0) deeds.push(`皇家纹章寻得${crestsFound.length}枚`);
  if (quest.idx >= missions.length) deeds.push('血斧授首,要塞已平');
  else if (quest.idx > 0) deeds.push(`领主的委托办完${quest.idx}件`);
  if (Math.random() < 0.6) deeds.push(BARD_COUPLETS[Math.floor(Math.random() * BARD_COUPLETS.length)]);
  deeds.push(`腰间金币${player.coins}枚,叮当作响赛铃铛`);
  if (deeds.length < 3) deeds.push('初来乍到名声浅,且看来日翻波澜');
  const pages = ['皮波:(拨响鲁特琴)咳咳——《绿帽游侠之歌》,即兴版,走你!'];
  for (let i = 0; i < deeds.length; i += 2) {
    pages.push(`皮波:♪ ${deeds.slice(i, i + 2).join(';')} ♪`);
  }
  pages.push('皮波:(潇洒收弦)……打赏随意,掌声免费!');
  openDialog(pages);
}

// 盲眼说书人:AI 现场编故事,离线用内置话本
const TALES = [
  '说是龙骨之地的龙啊,不是死的,是睡的。有个牧童在龙头骨里躲雨,听见了呼噜声——他发誓那不是风。第二天他把羊都数了三遍,一只没少,就是每只羊看他的眼神都变了。',
  '银月湖底的神殿,每逢月圆就亮一盏灯。老辈渔夫说,那是守殿人还在换灯油。有人问守了多少年,老渔夫掰着指头数了半天说:比湖里的鱼加起来还老。',
  '先祖石环立石那晚,天上的星星多得挤不下。立石的人说:我们数过星星,星星也在数我们。后来星星数累了,掉下来一颗,就成了如今许愿的喷泉。',
  '迷途丘陵里有个货郎,转了七天七夜出不来。最后他把担子一撂,坐地上骂了半个时辰——骂完抬头,路就在眼前。所以老话讲:丘陵认怂不认路。',
  '灰烬荒地那一仗,两边打到最后发现军旗上绣的是同一句家训。停手那天,活下来的人凑了一锅粥,一人一碗,喝完各自回家。从那以后那地方长不出草,倒年年长出野葱。',
  '狼月之夜,猎人罗尔夫的爷爷跟一头老狼在雪地里对坐了一宿。天亮时老狼起身走了,留下一只兔子。他爷爷说:那是狼在还二十年前的一箭之情。',
  '许愿池里住着个数钱的湖神。有年发大水,金币冲出来铺了半条街,湖神心疼得三天没显灵。后来它学乖了,愿望办不办另说,钱先沉到最底下。',
  '三石村有头驴,学会了拿嘴开门栓。村长把门栓换了三次,驴学了三次。第四次村长服了,给驴配了把钥匙——挂脖子上那种。驴现在见了村长还点头。',
];
let taleIdx = Math.floor(Math.random() * TALES.length);
async function tellStory() {
  sfx.chest();
  toast('🎙️ 苟叔捋了捋胡子,烟杆在桌沿磕了磕……', 2);
  const sp = todaySpecial();
  const ai = await aiLine(
    `你是中世纪王国旅店里的盲眼说书人苟叔。现在是${SEASONS[seasonIdx()]}季${sp ? '·' + sp.name : ''}。` +
    '用中文讲一个三句话的小故事,关于艾尔德里亚王国(可用素材:龙骨之地的老龙、银月湖底神殿、先祖石环、迷途丘陵、狼月、许愿池湖神、会开门的驴)。' +
    '要有起承转合和一个妙尾,三分怪谈七分人味。只输出故事正文,不要引号。', null, 8000);
  const text = ai || TALES[taleIdx++ % TALES.length];
  const parts = text.split(/(?<=[。!?])/).filter((p) => p.trim());
  const pages = ['苟叔:(压低嗓子)听好了——'];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 55) { pages.push(`苟叔:${cur}`); cur = p; } else cur += p;
  }
  if (cur) pages.push(`苟叔:${cur}`);
  pages.push('苟叔:(烟杆一点)欲知后事——明儿,还是这张桌。');
  openDialog(pages);
}

// 喷泉许愿
const WISHES = [
  ['水花溅了你一脸。愿望大概是收到了。', null],
  ['一条鱼吐了个泡,像是在嘲笑你。', null],
  ['你听见硬币落底的声音……它去和另外三百枚作伴了。', null],
  ['什么都没发生。这就是人生。', null],
  ['水面映出你的绿帽子。真好看。就这样。', null],
  ['一只青蛙浮上来看了你一眼,又沉下去了。', null],
  ['你许愿的瞬间打了个喷嚏。愿望作废,金币不退。', null],
  ['湖神打了个喷嚏——十枚金币喷了出来?!', 'coins'],
  ['一颗心从水里浮了上来?!别问,快捡!', 'heart'],
];
function fountainWish() {
  player.coins--;
  sfx.splash();
  if (++stats.wishes >= 10) unlockAch('wisher');
  const [text, effect] = WISHES[Math.floor(Math.random() * WISHES.length)];
  if (effect === 'coins') { player.coins += 10; sfx.coin(); }
  if (effect === 'heart') addPickup('heart', player.pos.x + 1, player.pos.z + 1, 20);
  openDialog([`(叮——金币入水)${text}`]);
}

// 具名 NPC 的一天:白天守铺 → 黄昏去旅店 → 夜里回家
const NPC_SCHEDULE = {
  steward:    { dawn: [4, 10], day: [4, 10], dusk: [4, 10], night: [0, -29.5] },
  blacksmith: { dawn: [24.8, -8], day: [24.8, -8], dusk: [10, 73.5], night: [27, -9] },
  trader:     { dawn: [48, 10], day: [48, 10], dusk: [11.5, 73.5], night: [43, 20] },
  fisher:     { dawn: [-100, 72], day: [-100, 72], dusk: [-100, 58], night: [-108, 60] },
};

// ================= 对话数据库(100 万字,tools/gen-dialogue.mjs 生成) =================
// 每行按情境标签(时辰/天气/季节/节庆/任务进度)筛选,近期说过的不复读
let DB = null;
const dbUsed = new Map();
fetch('./src/dialogue-db.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { DB = d; })
  .catch(() => { /* 缺失时回退到内置台词 */ });

function dbLine(key) {
  if (!DB || !DB[key]) return null;
  const lines = DB[key];
  const w = weather.state === 'cloudy' ? 'clear' : weather.state;
  const ctxs = new Set([`q${Math.min(quest.idx, 8)}`, dayPhase(), w,
    ['spring', 'summer', 'autumn', 'winter'][seasonIdx()]]);
  const sp = todaySpecial();
  if (sp) ctxs.add(sp.key);
  let used = dbUsed.get(key);
  if (!used) { used = new Set(); dbUsed.set(key, used); }
  if (used.size > lines.length * 0.8) used.clear();
  for (let tries = 0; tries < 30; tries++) {
    const i = Math.floor(Math.random() * lines.length);
    if (used.has(i)) continue;
    const L = lines[i];
    if (L.c && !ctxs.has(L.c)) continue;
    used.add(i);
    return L.t;
  }
  return lines[Math.floor(Math.random() * lines.length)].t;
}

// ================= 运行时 AI 文本(免费接口,离线回退) =================
const AI_TEXT_OFF = new URLSearchParams(location.search).has('noai');
async function aiLine(prompt, fallback, timeoutMs = 7000) {
  if (AI_TEXT_OFF) return fallback;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
      { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return fallback;
    const t = (await r.text()).trim();
    if (!t || t.length > 400) return fallback;
    return t;
  } catch {
    return fallback;
  }
}

// ================= 对话面板(RDR2 式多页对话) =================
const dialogEl = document.getElementById('dialog');
const dialogNameEl = document.getElementById('dialog-name');
const dialogTextEl = document.getElementById('dialog-text');
const dialog = { open: false, pages: [], idx: 0, onDone: null };

let typeTimer = null;
function renderDialogPage() {
  const page = dialog.pages[dialog.idx];
  const ci = page.indexOf(':');
  let text;
  if (ci > 0 && ci < 8) {
    dialogNameEl.textContent = page.slice(0, ci);
    text = page.slice(ci + 1);
  } else {
    dialogNameEl.textContent = '';
    text = page;
  }
  // 打字机效果:E 先跳字,再翻页
  dialog.fullText = text;
  dialog.typing = true;
  dialogTextEl.textContent = '';
  clearInterval(typeTimer);
  let i = 0;
  typeTimer = setInterval(() => {
    i += 2;
    dialogTextEl.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typeTimer);
      dialog.typing = false;
    }
  }, 22);
  document.getElementById('dialog-hint').textContent =
    dialog.idx < dialog.pages.length - 1 ? `▼ E (${dialog.idx + 1}/${dialog.pages.length})` : '▼ E 结束';
}

function openDialog(pages, onDone = null) {
  if (!pages.length) return;
  dialog.open = true;
  dialog.pages = pages;
  dialog.idx = 0;
  dialog.onDone = onDone;
  bubble.timer = 0; // 对话时收起闲聊气泡
  dialogEl.style.display = 'block';
  renderDialogPage();
}

function advanceDialog() {
  if (dialog.typing) {
    // 第一次按键:直接显示整页
    clearInterval(typeTimer);
    dialog.typing = false;
    dialogTextEl.textContent = dialog.fullText;
    return;
  }
  dialog.idx++;
  if (dialog.idx >= dialog.pages.length) {
    dialog.open = false;
    dialogEl.style.display = 'none';
    const f = dialog.onDone;
    dialog.onDone = null;
    if (f) f();
  } else {
    renderDialogPage();
  }
}

// 具名 NPC 对话:优先播当前阶段未读的故事章节,读完只剩闲聊
function npcTalk(n, onDone = null) {
  const d = DIALOGS[n.key];
  if (!d) return;
  const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
  n.readArcs = n.readArcs || new Set();
  if (arcIdx >= 0 && !n.readArcs.has(arcIdx)) {
    n.readArcs.add(arcIdx);
    const greet = TIME_GREETINGS[dayPhase()];
    openDialog([
      `${n.def.name}:${greet[Math.floor(Math.random() * greet.length)]}`,
      ...d.arcs[arcIdx].pages,
    ], onDone);
  } else {
    // 故事读完后:手写闲聊与对话库轮换
    const line = Math.random() < 0.4
      ? d.small[n.lineIdx++ % d.small.length]
      : `${n.def.name}:${dbLine(n.key) || d.small[n.lineIdx++ % d.small.length]}`;
    openDialog([line], onDone);
  }
}

// ================= 对话气泡 =================
const bubbleEl = document.getElementById('bubble');
const bubble = { timer: 0, anchor: null, cooldowns: new Map() };
function showBubble(anchor, name, text, dur = 3.2) {
  bubbleEl.innerHTML = name ? `<b>${name}</b><br>${text}` : text;
  bubble.anchor = anchor;
  bubble.timer = dur;
}
const _bubbleV = new THREE.Vector3();
function updateBubble(dt) {
  if (bubble.timer <= 0) { bubbleEl.style.display = 'none'; return; }
  bubble.timer -= dt;
  // 走远了自动收起
  if (dist2(player.pos.x, player.pos.z, bubble.anchor.pos.x, bubble.anchor.pos.z) > 240) {
    bubble.timer = 0;
    bubbleEl.style.display = 'none';
    return;
  }
  _bubbleV.copy(bubble.anchor.pos).y += 2.1;
  _bubbleV.project(camera);
  if (_bubbleV.z > 1) { bubbleEl.style.display = 'none'; return; }
  bubbleEl.style.display = 'block';
  bubbleEl.style.left = `${(_bubbleV.x * 0.5 + 0.5) * window.innerWidth}px`;
  bubbleEl.style.top = `${(-_bubbleV.y * 0.5 + 0.5) * window.innerHeight}px`;
  // 村民闲聊触发
}
function villagerChatter() {
  if (bubble.timer > 0 || dialog.open) return;
  const now = performance.now();
  for (const v of villagers) {
    if (v.downT > 0 || v.fleeT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(v) || 0;
    if (now - last < 25000) continue;
    bubble.cooldowns.set(v, now);
    showBubble(v, v.id.name, dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length]);
    return;
  }
  for (const g of guards) {
    if (g.downT > 0 || wanted > 0) continue;
    if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) > 8) continue;
    const last = bubble.cooldowns.get(g) || 0;
    if (now - last < 30000) continue;
    bubble.cooldowns.set(g, now);
    showBubble(g, null, dbLine('guard') || GUARD_LINES[Math.floor(Math.random() * GUARD_LINES.length)]);
    return;
  }
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(n) || 0;
    if (now - last < 20000) continue;
    bubble.cooldowns.set(n, now);
    showBubble(n, n.def.name, n.def.idle[Math.floor(Math.random() * n.def.idle.length)]);
    return;
  }
}

// ================= 操作说明:20 秒后淡出,按 H 呼出 =================
const hintEl = document.getElementById('controls-hint');
let hintFadeT = 20;
let hintVisible = true;
function updateHintFade(dt) {
  if (!started || !hintVisible || hintFadeT <= 0) return;
  hintFadeT -= dt;
  if (hintFadeT <= 0) {
    hintVisible = false;
    hintEl.style.opacity = 0;
  }
}
function toggleHint() {
  hintVisible = !hintVisible;
  hintEl.style.opacity = hintVisible ? 1 : 0;
  hintFadeT = hintVisible ? 20 : 0;
}

// ================= 暂停菜单(唯一系统菜单,ESC 弹出) =================
const pauseEl = document.getElementById('pause');
let paused = false;
let fxHigh = !LOWFX;
function setPaused(p) {
  paused = p;
  pauseEl.style.display = p ? 'flex' : 'none';
}
function setQuality(high) {
  fxHigh = high;
  gtao.enabled = bloom.enabled = smaa.enabled = gradePass.enabled = high;
  document.getElementById('btn-quality').textContent = `画质:${high ? '精致' : '流畅'}`;
  try { localStorage.setItem('gth-fx', high ? 'hi' : 'lo'); } catch { /* 忽略 */ }
}
try { if (localStorage.getItem('gth-fx') === 'lo') setQuality(false); else setQuality(fxHigh); } catch { /* 忽略 */ }
document.getElementById('btn-resume').onclick = () => {
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
document.getElementById('btn-quality').onclick = () => setQuality(!fxHigh);
document.getElementById('btn-music').onclick = (ev) => {
  ev.target.textContent = `音乐:${toggleMusic() ? '开' : '关'}`;
};
document.getElementById('btn-help').onclick = () => {
  if (!hintVisible) toggleHint();
  setPaused(false);
  renderer.domElement.requestPointerLock();
};
document.getElementById('btn-wipe').onclick = () => {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
};

// ================= 交互目标标记(头顶金色小箭头) =================
const interactMarker = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 4),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.85 }));
interactMarker.rotation.x = Math.PI;
interactMarker.visible = false;
scene.add(interactMarker);
let promptTargetPos = null;

// ================= 命中反馈:白闪 + 击退 =================
function hitFX(e, push = 0.55) {
  hitStop(0.035);
  const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  e.pos.x += (dx / d) * push;
  e.pos.z += (dz / d) * push;
  resolveCollisions(e.pos, 0.4, colliders);
  e.group.traverse((o) => {
    const m = o.material;
    if (m && m.emissive && m._e0 === undefined) {
      m._e0 = m.emissive.getHex();
      m._ei0 = m.emissiveIntensity;
      m.emissive.setHex(0xffffff);
      m.emissiveIntensity = 0.8;
    }
  });
  setTimeout(() => {
    e.group.traverse((o) => {
      const m = o.material;
      if (m && m._e0 !== undefined) {
        m.emissive.setHex(m._e0);
        m.emissiveIntensity = m._ei0;
        delete m._e0;
        delete m._ei0;
      }
    });
  }, 90);
}

// ================= 人群软碰撞(不再穿过 NPC) =================
function pushCrowd() {
  const softly = (list, r) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.sleeping || e === player.mounted) continue;
      const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < r * r && dd > 1e-6) {
        const d = Math.sqrt(dd), pv = r - d;
        player.pos.x += (dx / d) * pv * 0.6;
        player.pos.z += (dz / d) * pv * 0.6;
        e.pos.x -= (dx / d) * pv * 0.35;
        e.pos.z -= (dz / d) * pv * 0.35;
      }
    }
  };
  softly(villagers, 0.75);
  softly(guards, 0.75);
  softly(namedNPCs, 0.8);
  softly(bandits, 0.75);
  softly(wolves, 0.7);
  softly(horses, 1.05);
}

// ================= 区域浮现(GTA 式) =================
const regionEl = document.getElementById('region');
let curRegion = '';
let regionCheckT = 0;
function updateRegion(dt) {
  regionCheckT -= dt;
  if (regionCheckT > 0) return;
  regionCheckT = 0.5;
  let name = '艾尔德里亚原野';
  for (const r of REGIONS) {
    if (r.band !== undefined) { if (player.pos.z < r.band) { name = r.name; break; } continue; }
    if (dist2(player.pos.x, player.pos.z, r.x, r.z) < r.r * r.r) { name = r.name; break; }
  }
  // 核心之外:程序化荒野群系命名
  if ((name === '艾尔德里亚原野' || name === '北境群山') &&
      (Math.abs(player.pos.x) > CORE || Math.abs(player.pos.z) > CORE)) {
    name = wildRegionName(player.pos.x, player.pos.z);
  }
  if (name !== curRegion) {
    curRegion = name;
    regionEl.textContent = name;
    regionEl.classList.remove('show');
    void regionEl.offsetWidth; // 重启 CSS 动画
    regionEl.classList.add('show');
  }
}

// ================= 历法:季节与日子 =================
const SEASONS = ['春', '夏', '秋', '冬'];
const SEASON_ICON = ['🌸', '☀️', '🍂', '❄️'];
const SEASON_DAYS = 6; // 一日 240 秒,六日为一季
const calendar = { day: 1, lastPhase: 'dawn' };
let dailyEvents = 4; // 每日事件限额:导演事件与街头事件共享,免得此起彼伏乱成一锅粥

function seasonIdx() { return Math.floor((calendar.day - 1) / SEASON_DAYS) % 4; }
function seasonDay() { return ((calendar.day - 1) % SEASON_DAYS) + 1; }
function isWinter() { return seasonIdx() === 3; }

// 定日事件:村庄的日子按历法过,而不是随机砸下来
function todaySpecial() {
  const s = seasonIdx(), d = seasonDay();
  if (s === 2 && d === 1) return { key: 'harvest', name: '丰收节', desc: '田里落满了金币!' };
  if (d === 2) return { key: 'market', name: '集市日', desc: '喷泉广场满地是赶集人掉的金币' };
  if (d === 3) return { key: 'fullmoon', name: '满月夜', desc: '今日鱼获双倍,入夜亡魂徘徊' };
  if (d === 5) return { key: 'wolfmoon', name: '狼月', desc: '入夜后狼群嗜血,荒野勿独行' };
  return null;
}

// 季节换装:地表与草皮随季节改色,冬季积雪盖地
const SEASON_GROUND = [0xffffff, 0xeef8d2, 0xdca55c, 0xdfe6ec];
function applySeason() {
  const s = seasonIdx();
  const gm = world.ground.material;
  if (!gm.userData.baseMap) { gm.userData.baseMap = gm.map; gm.userData.baseNormal = gm.normalMap; }
  gm.map = s === 3 ? null : gm.userData.baseMap; // 冬:雪盖住草地纹理
  gm.normalMap = s === 3 ? null : gm.userData.baseNormal;
  gm.needsUpdate = true;
  gm.color.setHex(SEASON_GROUND[s]);
  const grass = world.grassMesh;
  if (!grass) return;
  const c = new THREE.Color();
  for (let i = 0; i < grass.count; i++) {
    const r = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1; // 每株草稳定的伪随机
    if (s === 0) c.setHSL(0.25 + r * 0.06, 0.48, 0.4 + r * 0.16);       // 春:嫩绿
    else if (s === 1) c.setHSL(0.29 + r * 0.05, 0.55, 0.36 + r * 0.14); // 夏:浓绿
    else if (s === 2) c.setHSL(0.07 + r * 0.05, 0.55, 0.42 + r * 0.14); // 秋:金黄
    else c.setHSL(0.56 + r * 0.04, 0.08, 0.6 + r * 0.15);               // 冬:霜白
    grass.setColorAt(i, c);
  }
  grass.instanceColor.needsUpdate = true;
}

function startSpecialDay(key) {
  if (key === 'market') {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, r = 4 + Math.random() * 9;
      addPickup('coin', Math.cos(a) * r, 5 + Math.sin(a) * r, 220);
    }
  } else if (key === 'harvest') {
    for (const [fx, fz, w, d] of [[24, 88, 24, 14], [-18, 92, 20, 12], [52, 96, 18, 10]]) {
      for (let i = 0; i < 8; i++) {
        addPickup('coin', fx + (Math.random() - 0.5) * (w - 2), fz + (Math.random() - 0.5) * (d - 2), 220);
      }
    }
  }
}

// 新的一天:换日、刷新每日限额/蘑菇/公告,报时
function newDay() {
  calendar.day++;
  dailyEvents = 4;
  applySeason();
  respawnMushrooms();
  const sp = todaySpecial();
  if (started) {
    const sd = seasonDay();
    toast(`🌅 ${SEASON_ICON[seasonIdx()]} ${SEASONS[seasonIdx()]}·第 ${sd} 日` +
      (sd === 1 ? `,${SEASONS[seasonIdx()]}天来了` : '') +
      (sp ? ` — 今日${sp.name}:${sp.desc}` : ''), sp ? 5.5 : 3.2);
    if (sp) startSpecialDay(sp.key);
    refreshProclaim();
    saveGame();
  }
}

// 睡到天亮:换日 + 回满生命(旅店过夜用)
function sleepToMorning() {
  dayTime = 0.27;
  calendar.lastPhase = 'dawn';
  player.hp = player.maxHp;
  newDay();
}

// 天亮换日:昼夜相位从 night 跨入 dawn 时 day++
function updateCalendar() {
  const phase = dayPhase();
  if (phase === calendar.lastPhase) return;
  const from = calendar.lastPhase;
  calendar.lastPhase = phase;
  if (phase === 'dawn' && from === 'night') {
    newDay();
  } else if (phase === 'dusk' && started && todaySpecial()?.key === 'wolfmoon') {
    toast('🌕 狼月将升……天黑后狼群会变得凶猛,备好武器', 4);
  } else if (phase === 'night' && started && todaySpecial()?.key === 'fullmoon') {
    toast('🌕 满月高悬,湖面泛着银光……', 3.5);
  }
}

// ================= 存档 =================
const SAVE_KEY = 'gth-save-v1';
let crestsFound = [];
let saveIconTimer = null;
function saveGame() {
  const icon = document.getElementById('save-icon');
  icon.style.opacity = 1;
  clearTimeout(saveIconTimer);
  saveIconTimer = setTimeout(() => { icon.style.opacity = 0; }, 1000);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      coins: player.coins, questIdx: quest.idx, crests: crestsFound,
      swordLv: player.swordLv, royalHorse: player.royalHorse,
      kingRewarded: namedNPCs.find((n) => n.key === 'king')?.rewarded || false,
      ach: achUnlocked, stats, day: calendar.day,
      herbs: player.herbs, venison: player.venison, lore: loreRead,
      weapon: player.weapon, weaponsOwned: player.weaponsOwned, armor: player.armor,
    }));
  } catch { /* 隐私模式等 */ }
}
function loadGame() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!s) return false;
    player.coins = s.coins || 0;
    quest.idx = Math.min(s.questIdx || 0, missions.length);
    crestsFound = Array.isArray(s.crests) ? s.crests : [];
    player.swordLv = s.swordLv || 1;
    player.royalHorse = !!s.royalHorse;
    if (s.kingRewarded) {
      const king = namedNPCs.find((n) => n.key === 'king');
      if (king) king.rewarded = true;
    }
    if (Array.isArray(s.ach)) achUnlocked = s.ach;
    if (s.stats) Object.assign(stats, s.stats);
    calendar.day = Math.max(1, s.day || 1);
    player.herbs = s.herbs || 0;
    player.venison = s.venison || 0;
    if (Array.isArray(s.lore)) loreRead = s.lore;
    if (Array.isArray(s.weaponsOwned)) player.weaponsOwned = s.weaponsOwned;
    if (s.weapon && player.weaponsOwned.includes(s.weapon)) player.weapon = s.weapon;
    if (s.armor) {
      player.armor = s.armor;
      player.maxHp = 10 + ARMORS[s.armor].bonus;
      player.hp = player.maxHp;
    }
    return true;
  } catch { return false; }
}

// 目标光柱
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
beacon.position.y = 20;
beacon.visible = false;
scene.add(beacon);

// ================= 拾取物 =================
const pickups = [];
const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.07, 12);
coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffd83d, emissive: 0x8a5c00, emissiveIntensity: 0.55, metalness: 0.9, roughness: 0.22 });
const heartMat = new THREE.MeshStandardMaterial({
  color: 0xe83a4e, emissive: 0x7a0f1c, emissiveIntensity: 0.6, metalness: 0.15, roughness: 0.35 });

function heartGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.5); s.bezierCurveTo(0.5, 1.1, 1.4, 0.5, 0, -0.7);
  s.bezierCurveTo(-1.4, 0.5, -0.5, 1.1, 0, 0.5);
  return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).scale(0.45, 0.45, 0.45);
}
const heartG = heartGeo();

function starGeoBig() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * r, -Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
}

// 皇家纹章(盾形收集品)
function crestGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.6);
  s.lineTo(0.5, 0.42);
  s.lineTo(0.5, -0.05);
  s.quadraticCurveTo(0.45, -0.45, 0, -0.65);
  s.quadraticCurveTo(-0.45, -0.45, -0.5, -0.05);
  s.lineTo(-0.5, 0.42);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false }).scale(0.7, 0.7, 0.7);
}
const crestG = crestGeo();
const crestMat = new THREE.MeshStandardMaterial({
  color: 0x3f6fd0, emissive: 0x1a3a88, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 });

function addPickup(type, x, z, ttl = Infinity, id = -1, chunk = null) {
  let mesh;
  if (type === 'coin') mesh = new THREE.Mesh(coinGeo, coinMat);
  else if (type === 'heart') mesh = new THREE.Mesh(heartG, heartMat);
  else if (type === 'crest') mesh = new THREE.Mesh(crestG, crestMat);
  else mesh = new THREE.Mesh(starGeoBig(), new THREE.MeshStandardMaterial({
    color: 0xffd83d, emissive: 0xaa7700, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.25 }));
  mesh.position.set(x, type === 'star' ? 1.4 : type === 'crest' ? 1.0 : 0.65, z);
  if (type === 'star') mesh.scale.setScalar(1.4);
  mesh.castShadow = true;
  scene.add(mesh);
  pickups.push({ mesh, type, x, z, ttl, id, chunk, t: Math.random() * 6 });
}
for (const [x, z] of world.coinSpots) addPickup('coin', x, z);

// 读档,然后生成未收集的纹章
const hasSave = loadGame();
world.crestSpots.forEach(([x, z], i) => {
  if (!crestsFound.includes(i)) addPickup('crest', x, z, Infinity, i);
});
// 标题画面:世界观开场 + 存档信息
document.getElementById('lore').textContent = INTRO;
if (hasSave) {
  document.getElementById('save-info').textContent =
    `💾 检测到存档:委托 ${Math.min(quest.idx + 1, missions.length)}/${missions.length} · ` +
    `${player.coins} 金币 · 纹章 ${crestsFound.length}/10(按 Delete 键清除存档重新开始)`;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Delete' && !started) {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }
  });
}
// 读档后应用升级效果
setWeaponVisual(player.weapon);
setArmorVisual(player.armor);
applySeason();
if (player.royalHorse) {
  const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
  rh.fast = true;
}

// ================= 输入 =================
const keys = {};
let camYaw = 0, camPitch = 0.35, locked = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return; // 忽略系统按键自动重复,防止长按空格吞掉二段跳/长按 E 反复上下马
  if (paused || shopOpen) return;
  keys[e.code] = true;
  if (e.code === 'KeyE') {
    if (dialog.open) advanceDialog();
    else tryInteract();
  }
  if (e.code === 'KeyF' && !dialog.open) tryAttack();
  if (e.code === 'KeyM') toast(toggleMusic() ? '♪ 音乐开' : '♪ 音乐关', 1.5);
  if (e.code === 'KeyH') toggleHint();
  if (e.code === 'KeyQ') cycleWeapon();
  if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !dialog.open) doRoll();
  if (e.code === 'KeyG' && !dialog.open) tryRob();
});
// 右键格挡(按住)
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.button === 2 && started && !player.dead && !player.mounted && player.weapon !== 'bow') {
    player.blocking = true;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) player.blocking = false;
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (dialog.open) { advanceDialog(); return; }
  if (!locked) renderer.domElement.requestPointerLock();
  else if (e.button === 0) tryAttack();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  // ESC 解锁鼠标 → 弹出暂停菜单(GTA 式)
  if (!locked && started && !player.dead && !dialog.open && !shopOpen) setPaused(true);
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  camYaw -= e.movementX * 0.0028;
  camPitch = Math.max(-0.1, Math.min(1.15, camPitch + e.movementY * 0.0028));
});

let started = false;
titleEl.addEventListener('click', () => {
  initAudio();
  startMusic();
  titleEl.style.display = 'none';
  started = true;
  refreshProclaim(); // 今日公告(联网时由 AI 现写)
  renderer.domElement.requestPointerLock();
  toast('欢迎来到艾尔德里亚!去喷泉广场找管家埃隆接取委托吧(按 E 互动)', 5);
});

// ================= 天气系统 =================
const WEATHER_DEF = {
  clear:  { rain: 0,   cover: 0.05, dur: [55, 110], next: { cloudy: 1 } },
  cloudy: { rain: 0,   cover: 0.55, dur: [30, 60],  next: { rain: 0.55, clear: 0.45 } },
  rain:   { rain: 0.7, cover: 0.85, dur: [30, 60],  next: { storm: 0.35, cloudy: 0.65 } },
  storm:  { rain: 1,   cover: 1,    dur: [22, 45],  next: { rain: 1 } },
};
const weather = { state: 'clear', timer: 60, rain: 0, targetRain: 0, cover: 0.05, targetCover: 0.05, boltT: 4 };

function setWeather(s) {
  const def = WEATHER_DEF[s];
  weather.state = s;
  weather.targetRain = def.rain;
  weather.targetCover = def.cover;
  weather.timer = def.dur[0] + Math.random() * (def.dur[1] - def.dur[0]);
  if (started && (s === 'rain' || s === 'storm')) {
    if (isWinter()) toast(s === 'storm' ? '🌨️ 暴风雪来了!' : '🌨️ 下雪了……', 2.5);
    else toast(s === 'storm' ? '⛈️ 雷暴来袭!' : '🌧️ 下雨了…', 2.5);
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
  camShake = Math.max(camShake, 0.3);
  setTimeout(() => weatherAudio.thunder(), 400 + Math.random() * 1200);
}

function updateWeather(dt) {
  weather.timer -= dt;
  if (weather.timer <= 0) {
    const nx = WEATHER_DEF[weather.state].next;
    let r = Math.random(), pick = 'clear';
    for (const [k, p] of Object.entries(nx)) { r -= p; if (r <= 0) { pick = k; break; } }
    setWeather(pick);
  }
  const step = (cur, tgt, rate) => cur + Math.max(-rate * dt, Math.min(rate * dt, tgt - cur));
  weather.rain = step(weather.rain, weather.targetRain, 0.12);
  weather.cover = step(weather.cover, weather.targetCover, 0.1);
  weatherAudio.setRain(started && !isWinter() ? weather.rain : 0); // 雪落无声
  if (weather.state === 'storm' && weather.rain > 0.7 && !isWinter()) {
    weather.boltT -= dt;
    if (weather.boltT <= 0) {
      weather.boltT = 3 + Math.random() * 8;
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
scene.add(rainLines);
const drops = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) {
  drops[i * 3] = (Math.random() - 0.5) * 56;
  drops[i * 3 + 1] = Math.random() * 24;
  drops[i * 3 + 2] = (Math.random() - 0.5) * 56;
}

function updateRain(dt) {
  const snow = isWinter(); // 冬季降水变成雪:白色、慢落、随风打旋
  rainMat.color.setHex(snow ? 0xf0f5ff : 0x9fb8d0);
  rainMat.opacity = weather.rain * (snow ? 0.6 : 0.38);
  rainLines.visible = weather.rain > 0.03;
  if (!rainLines.visible) return;
  const cx = player.pos.x, cz = player.pos.z;
  const wind = snow ? 1.4 : 4.5;
  const fall = snow ? 6.5 : 30;
  const t = performance.now() * 0.001;
  for (let i = 0; i < RAIN_N; i++) {
    let x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2];
    y -= fall * dt;
    x += wind * dt;
    if (snow) { x += Math.sin(t * 1.7 + i) * 0.8 * dt; z += Math.cos(t * 1.3 + i * 0.7) * 0.8 * dt; }
    if (y < 0) {
      y = 20 + Math.random() * 6;
      x = cx + (Math.random() - 0.5) * 56;
      z = cz + (Math.random() - 0.5) * 56;
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
scene.add(dustPts);
const dust = [];
const dustFree = [...Array(DUST_MAX).keys()];

function spawnDust(x, y, z, n = 3, spread = 0.5, up = 1.4) {
  if (weather.rain > 0.5) return; // 雨天地面湿润无尘
  for (let k = 0; k < n; k++) {
    const i = dustFree.pop();
    if (i === undefined) return;
    dustPos[i * 3] = x + (Math.random() - 0.5) * spread;
    dustPos[i * 3 + 1] = y + Math.random() * 0.2;
    dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    dust.push({
      i,
      vx: (Math.random() - 0.5) * 1.3, vy: up * (0.5 + Math.random() * 0.7), vz: (Math.random() - 0.5) * 1.3,
      life: 0, max: 0.45 + Math.random() * 0.4,
    });
  }
}

function updateDust(dt) {
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
    dustPos[p.i * 3 + 1] = Math.max(0.04, dustPos[p.i * 3 + 1] + p.vy * dt);
    dustPos[p.i * 3 + 2] += p.vz * dt;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// ================= 通缉系统 =================
let wanted = 0, heat = 0, evadeT = 0;
function crime(n, msg) {
  const old = wanted;
  wanted = Math.min(5, wanted + n);
  evadeT = 0;
  if (msg) toast(msg, 2.5);
  if (wanted > old) {
    sfx.wanted();
    // 增援:从最近的城门出动
    const gate = world.gates.reduce((a, b) =>
      dist2(a.x, a.z, player.pos.x, player.pos.z) < dist2(b.x, b.z, player.pos.x, player.pos.z) ? a : b);
    const extras = guards.filter((g) => g.extra).length;
    const want = Math.min(wanted * 2, 8);
    for (let i = extras; i < want; i++) {
      addGuard(gate.x + (Math.random() * 6 - 3), gate.z + (Math.random() * 6 - 3),
        [[gate.x, gate.z]], wanted >= 3, true);
    }
  }
}
function clearWanted() {
  wanted = 0;
  for (let i = guards.length - 1; i >= 0; i--) {
    if (guards[i].extra) { scene.remove(guards[i].group); guards.splice(i, 1); }
    else guards[i].state = 'patrol';
  }
}

// ================= 交互 =================
let promptText = '';
function tryInteract() {
  if (!started || player.dead) return;
  // 钓鱼中:收杆
  if (fishing.active) { fishingReel(); return; }
  // 扔鸡(抱着鸡时 E 投掷)
  if (player.carrying) {
    const c = player.carrying;
    player.carrying = null;
    c.state = 'thrown';
    c.pos.set(player.pos.x, player.pos.y + 1.9, player.pos.z);
    c.vel.set(Math.sin(player.yaw) * 8, 3.5, Math.cos(player.yaw) * 8);
    sfx.cluck();
    if (++stats.thrown >= 10) unlockAch('chucker');
    return;
  }
  // 下马
  if (player.mounted) {
    const h = player.mounted;
    player.mounted = null;
    player.pos.set(h.pos.x + Math.cos(h.yaw) * 1.3, 0, h.pos.z - Math.sin(h.yaw) * 1.3);
    resolveCollisions(player.pos, 0.45, colliders);
    return;
  }
  // 具名 NPC(委托/商店/领主/故事对话)
  for (const n of namedNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    // 管家埃隆:委托优先
    if (n.key === 'steward' && quest.idx < missions.length) {
      talkQuestGiver();
      return;
    }
    // 未读的故事章节优先
    const d = DIALOGS[n.key];
    if (d) {
      const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
      n.readArcs = n.readArcs || new Set();
      if (arcIdx >= 0 && !n.readArcs.has(arcIdx)) {
        // 领主终章附带赏金
        const grantKing = n.key === 'king' && quest.idx >= missions.length && !n.rewarded;
        npcTalk(n, grantKing ? () => {
          n.rewarded = true;
          player.coins += 100;
          sfx.fanfare();
          toast('💰 领主赏赐 100 金币!', 4);
          saveGame();
        } : null);
        return;
      }
    }
    // 商店行为
    if (n.key === 'blacksmith') {
      if (wanted > 0) { openDialog(['格罗姆:(把铁钳一横)通缉犯?我不做黑生意。洗白了再来。']); return; }
      openShop();
      return;
    }
    if (n.key === 'trader' && !player.royalHorse) {
      if (wanted > 0) { openDialog(['瑟尔玛:(挡在马厩前)带着通缉令买马?马会被连坐充公的,快走!']); return; }
      if (player.coins >= 80) {
        player.coins -= 80;
        player.royalHorse = true;
        const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
        rh.fast = true;
        rh.home.set(world.stablePos.x - 3, 0, world.stablePos.z - 3);
        sfx.fanfare();
        openDialog(['瑟尔玛:「疾风」交给你了。记住,喂它苹果时手要摊平——好了去吧,它等你等得直刨蹄子。']);
        saveGame();
      } else {
        openDialog(['瑟尔玛:80 金币,皇家骏马。分期?马又不能分期长大。']);
      }
      return;
    }
    if (n.key === 'innkeep' && player.venison > 0) {
      const pay = player.venison * 5;
      openDialog([`罗莎:(眼睛一亮)新鲜鹿肉?!今晚炖肉管够了!${player.venison} 块,一共 ${pay} 金币,拿好!`]);
      player.coins += pay;
      player.venison = 0;
      sfx.coin();
      return;
    }
    if (n.key === 'innkeep' && (player.hp < player.maxHp || dayPhase() === 'night')) {
      if (wanted > 0) { openDialog(['罗莎:(压低声音)后门快走!卫兵刚搜过一轮,我可藏不住你。']); return; }
      if (player.coins >= 10) {
        player.coins -= 10;
        sfx.heart();
        sleepToMorning();
        openDialog(['罗莎:(掀开门帘)天亮了,汤在灶上。伤都歇利索了吧?路上小心。']);
      } else {
        openDialog(['罗莎:住店 10 金币……先坐着喝口水吧,看你风尘仆仆的。']);
      }
      return;
    }
    if (n.key === 'innkeep' && player.drunkT <= 0) {
      // 满血就来一杯?
      if (player.coins >= 2) {
        player.coins -= 2;
        player.drunkT = 25;
        sfx.hiccup();
        if (++stats.drunks >= 3) unlockAch('drunkard');
        openDialog(['罗莎:(推来一大杯麦酒)自家酿的,后劲儿足——哎哎哎,你别一口闷啊!']);
      } else {
        openDialog(['罗莎:麦酒 2 金币。赊账?上一个赊账的还在后院劈柴呢。']);
      }
      return;
    }
    if (n.key === 'witch') {
      if (player.hp < player.maxHp) {
        if (player.coins >= 8) {
          player.coins -= 8;
          player.hp = player.maxHp;
          sfx.heart();
          openDialog(['玛尔戈:(舀了一勺冒泡的绿汤)喝。别问是什么,问了就不灵了。……看,好全了吧?']);
        } else {
          openDialog(['玛尔戈:一勺回魂汤,8 个金币。穷?那就去湖里洗把脸,精神精神。']);
        }
      } else if (player.herbs > 0) {
        const pay = player.herbs * 3;
        openDialog([`玛尔戈:(扒拉着你的蘑菇篓)成色不错……${player.herbs} 朵,${pay} 金币。别问进了哪口锅。`]);
        player.coins += pay;
        player.herbs = 0;
        sfx.coin();
      } else {
        openDialog([`玛尔戈:${EXTRA_NPCS.witch.lines[n.lineIdx++ % EXTRA_NPCS.witch.lines.length]}`]);
      }
      return;
    }
    // 闲聊
    npcTalk(n);
    return;
  }
  // 神秘商人
  if (director.mystic && dist2(player.pos.x, player.pos.z, director.mystic.pos.x, director.mystic.pos.z) < 6) {
    if (player.hp < player.maxHp && player.coins >= 5) {
      player.coins -= 5;
      player.hp = player.maxHp;
      sfx.heart();
      openDialog(['兜帽商人:(递来一小瓶)喝吧。别问来路,好东西都没有来路。(生命全满)']);
    } else if (player.hp < player.maxHp) {
      openDialog(['兜帽商人:灵药 5 枚金币。没钱?缘分未到。']);
    } else {
      openDialog(['兜帽商人:你气色好得很,不需要我。有缘再会。(他朝虚空看了一眼)']);
    }
    return;
  }
  // 智慧牛:提问
  if (director.cow && dist2(player.pos.x, player.pos.z, director.cow.pos.x, director.cow.pos.z) < 8) {
    const cow = director.cow;
    cow.asked++;
    cow.nodT = 1.4;
    cow.nodYes = Math.random() < 0.5;
    const lines = [cow.nodYes ? '「哞——」它缓缓地、郑重地点了点头。' : '「哞?」它把头摇得像磨坊的风车。'];
    if (cow.asked === 1) lines.unshift('(你凑到牛耳边,问了一个藏在心里的问题)');
    if (cow.asked === 3) lines.push('农夫汉克远远喊道:「别信它!上回它点头说不下雨,结果淹了我半亩地!」');
    if (cow.asked >= 5) lines.push('牛嚼了口草,似乎不打算再回答任何问题了。');
    openDialog(lines);
    return;
  }
  // 许愿池捞币人
  if (director.thief && dist2(player.pos.x, player.pos.z, director.thief.pos.x, director.thief.pos.z) < 6) {
    player.coins += 2;
    sfx.coin();
    openDialog([
      '你重重咳嗽了一声。捞币人吓得原地蹦起,塞给你 2 枚湿漉漉的金币:「嘘——我在帮湖神清点!对,清点!」',
      '(他一步三滑地溜进了夜色。喷泉里的愿望们松了口气。)',
    ]);
    if (director.handle) director.handle.t = Math.min(director.handle.t, 0.01);
    return;
  }
  // 事件鸡优先(金鸡/越狱鸡:比旅店人群的交互更贴身优先)
  for (const c of chickens) {
    if (!c.extra || c.state === 'thrown' || c === player.carrying) continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      player.carrying = c;
      c.state = 'carried';
      sfx.cluck();
      toast('你一把抱住了它!', 2);
      return;
    }
  }
  // 竞技场主持人
  if (!arenaRT.active && dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 7) {
    openDialog([
      `血牙:${HOST_LINES[arenaHost.lineIdx++ % HOST_LINES.length]}`,
      '血牙:想下场?站进沙圈,我一声锣响就开打。每清一波,赏金翻着涨。',
    ], () => {
      arenaRT.active = true;
      arenaRT.wave = 0;
      arenaRT.betweenT = 1.2;
      toast('🏟️ 角斗开始!站稳了!', 2.5);
    });
    return;
  }
  // 搞笑 NPC
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    if (n.key === 'gambler') { gamble(); return; }
    if (n.key === 'bard') { bardSong(); return; }
    if (n.key === 'storyteller') { tellStory(); return; }
    if (n.key === 'prophet') {
      const fb = n.def.idle[n.lineIdx++ % n.def.idle.length];
      aiLine(
        '你是中世纪疯predict预言家老糊涂,总说些打破第四面墙的怪话(比如怀疑世界是个游戏)。' +
        '用中文说一句50字以内的疯预言。只输出预言本身。', fb, 5000)
        .then((line) => openDialog([`疯子老糊涂:${line}`]));
      return;
    }
    openDialog([`${n.def.name}:${n.def.idle[n.lineIdx++ % n.def.idle.length]}`]);
    return;
  }
  // 栈桥垂钓
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT.x, FISH_SPOT.z) < 10) {
    startFishing();
    return;
  }
  // 悬赏板
  if (dist2(player.pos.x, player.pos.z, 8, 46) < 8) {
    if (wanted > 0) {
      const fine = wanted * 20;
      if (player.coins >= fine) {
        player.coins -= fine;
        clearWanted();
        sfx.clear();
        openDialog([`(你把 ${fine} 枚金币塞进告示板下的罚金箱)卫兵把你的通缉令撕了下来。你自由了——暂时。`]);
      } else {
        openDialog([`(告示板)你的通缉罚金是 ${fine} 金币,兜里不够。要么凑钱,要么躲风头。`]);
      }
      return;
    }
    if (bountyRT.target) openDialog([`(告示板)悬赏令仍在追缉中——「${bountyRT.name}」,生死不论。`]);
    else if (bountyRT.cooldown > 0) openDialog(['(告示板)新的悬赏令还没贴出来,过一会儿再来看看。']);
    else takeBounty();
    return;
  }
  // 王国公告牌(每日 AI 撰写)
  if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
    if (!proclaimText) refreshProclaim();
    openDialog([proclaimText || composeProclaimOffline()]);
    return;
  }
  // 世界观铭文
  for (const s of loreStones) {
    if (dist2(player.pos.x, player.pos.z, s.def.x, s.def.z) < 8) {
      readLore(s);
      return;
    }
  }
  // 采蘑菇
  for (const m of mushrooms) {
    if (!m.picked && dist2(player.pos.x, player.pos.z, m.x, m.z) < 4) {
      m.picked = true;
      m.group.visible = false;
      player.herbs++;
      stats.mushrooms = (stats.mushrooms || 0) + 1;
      if (stats.mushrooms >= 15) unlockAch('forager');
      sfx.coin();
      toast(`🍄 采到一朵伞菇(篓里 ×${player.herbs},女巫玛尔戈按 3 金币收)`, 2.5);
      return;
    }
  }
  // 抱鸡(半径小,贴身优先)
  for (const c of chickens) {
    if (c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      player.carrying = c;
      c.state = 'carried';
      sfx.cluck();
      toast(Math.random() < 0.4 ? `🐔 ${COMEDY_LINES[Math.floor(Math.random() * COMEDY_LINES.length)]}` : '你抱起了一只鸡。它一脸问号。', 2.5);
      return;
    }
  }
  // 村民对话(优先 100 万字对话库,按情境选行;AI 情境台词后台预取,下次开口就用)
  for (const v of villagers) {
    if (v.downT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 5.5) continue;
    const l1 = v.aiNext || dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
    v.aiNext = null;
    const l2 = dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
    openDialog([`${v.id.name}:${l1}`, `${v.id.name}:${l2}`]);
    if (!AI_TEXT_OFF && !v.aiPending && Math.random() < 0.35) {
      v.aiPending = true;
      const sp = todaySpecial();
      aiLine(
        `你是中世纪王国的村民「${v.id.name}」。现在是${SEASONS[seasonIdx()]}季` +
        `${sp ? '·' + sp.name : ''},${{ dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜里' }[dayPhase()]},` +
        `天气${{ clear: '晴', cloudy: '多云', rain: '下雨', storm: '雷暴' }[weather.state]}。` +
        '用中文说一句40字以内、符合你身份的闲聊,口语化,不要引号不要名字前缀。', null, 9000,
      ).then((t) => { v.aiPending = false; if (t) v.aiNext = t; });
    }
    return;
  }
  // 喷泉许愿
  if (player.coins > 0 && dist2(player.pos.x, player.pos.z, 0, 5) < 20) {
    fountainWish();
    return;
  }
  // 宝箱
  for (const c of world.chests) {
    if (!c.opened && dist2(player.pos.x, player.pos.z, c.x, c.z) < 5) {
      c.opened = true;
      sfx.chest();
      const wx = c.group.position.x, wz = c.group.position.z;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * 6.28;
        addPickup('coin', wx + Math.cos(a) * (1 + Math.random() * 1.5), wz + Math.sin(a) * (1 + Math.random() * 1.5), 40);
      }
      addPickup('heart', wx, wz + 1.2, 40);
      toast('打开了宝箱!', 2);
      return;
    }
  }
  // 墓园漫步:读一块墓志铭
  if (dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    openDialog(['(你拂去一块墓碑上的落叶)', `「${EPITAPHS[epitaphIdx++ % EPITAPHS.length]}」`]);
    return;
  }
  // 上马
  let best = null, bd = 7;
  for (const h of horses) {
    const d = dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z);
    if (d < bd) { bd = d; best = h; }
  }
  if (best) {
    if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
    player.mounted = best;
    player.jumps = 0;
    if (best.sheep) {
      sfx.baa();
      toast(Math.random() < 0.4 ? `🐑 ${COMEDY_LINES[Math.floor(Math.random() * COMEDY_LINES.length)]}` : '🐑 咩?!(它似乎认命了)', 2.5);
    } else {
      sfx.mount();
    }
    if (best.owned && !best.stolen) {
      best.stolen = true;
      crime(1, '你偷了一匹马!卫兵被惊动了!');
    }
  }
}

function clearRaceRings() {
  for (const r of questRT.rings) scene.remove(r);
  questRT.rings = [];
}

function removeEscortBandits() {
  for (let i = bandits.length - 1; i >= 0; i--) {
    if (bandits[i].escort) {
      scene.remove(bandits[i].group);
      bandits.splice(i, 1);
    }
  }
}

function failMission(msg) {
  quest.active = false;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { scene.remove(questRT.merchant.group); questRT.merchant = null; }
  removeEscortBandits(); // 伏兵随任务失败一并撤走,否则重接任务时旧伏兵会追杀新商人
  toast(msg, 3.5);
}

function talkQuestGiver() {
  if (quest.idx >= missions.length) {
    toast('埃隆:王国感谢你,勇者!去见领主大人吧,他有话对你说。', 3.5);
    return;
  }
  const m = missions[quest.idx];
  if (!quest.active) {
    quest.active = true;
    quest.progress = 0;
    quest.timer = m.time || 0;
    sfx.accept();
    openDialog([m.brief]);
    toast(`接受任务【${m.title}】:${m.desc}`, 4.5);
    if (m.type === 'deliver') {
      const parcel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.3), lambert(0xb4813f));
      parcel.position.set(0, 1.0, -0.24);
      player.group.add(parcel);
      player.parcel = parcel;
    } else if (m.type === 'bandits') {
      addBandit(world.banditCamp.x - 4, world.banditCamp.z + 2);
      addBandit(world.banditCamp.x + 4, world.banditCamp.z - 2);
      addBandit(world.banditCamp.x, world.banditCamp.z + 6);
    } else if (m.type === 'race') {
      questRT.ringIdx = 0;
      clearRaceRings();
      for (const [rx, rz] of world.raceRoute) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
          new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x996600, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
        ring.position.set(rx, 2.4, rz);
        scene.add(ring);
        questRT.rings.push(ring);
      }
    } else if (m.type === 'losthorse') {
      if (!questRT.specialHorse) {
        questRT.specialHorse = addHorse(world.lostHorsePos.x, world.lostHorsePos.z, 0xf2efe6, false);
        questRT.specialHorse.special = true;
      }
    } else if (m.type === 'escort') {
      const mc = { ...makeHumanoid({ shirt: 0xb4813f, pants: 0x4a3a26, hair: 0x3a2a1a }),
        pos: new THREE.Vector3(world.escortRoute[0][0], 0, world.escortRoute[0][1]),
        yaw: 0, hp: 5, wp: 0, walkT: 0 };
      mc.group.position.copy(mc.pos);
      scene.add(mc.group);
      questRT.merchant = mc;
      questRT.escortSpawned = 0;
    } else if (m.type === 'boss') {
      questRT.boss = addBandit(world.fortPos.x, world.fortPos.z - 2,
        { boss: true, hp: 12, speed: 6.8, scale: 1.35, dmg: 2 });
      addBandit(world.fortPos.x - 5, world.fortPos.z + 3);
      addBandit(world.fortPos.x + 5, world.fortPos.z + 3);
      toast('⚔️ 血斧巴罗克在黑石要塞等着你……', 4);
    }
  } else if (m.type === 'coins' && quest.progress >= m.goal) {
    completeMission();
  } else {
    toast(`任务进行中:${m.desc}`, 3);
  }
}

function completeMission() {
  const m = missions[quest.idx];
  player.coins += m.reward;
  sfx.fanfare();
  toast(`任务完成!奖励 ${m.reward} 金币`, 4);
  quest.active = false;
  quest.idx++;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { scene.remove(questRT.merchant.group); questRT.merchant = null; }
  removeEscortBandits();
  saveGame();
  if (quest.idx >= missions.length) {
    addPickup('star', 0, 13);
    toast('全部委托完成!去广场领取 ★ 力量之星 ★,再去见领主领赏!', 6);
  }
}

// ================= 攻击 =================
function tryAttack() {
  if (!started || player.dead || player.attackT > 0 || player.mounted || player.carrying ||
      player.blocking || player.rollT > 0) return;
  const def = WEAPONS[player.weapon];
  player.attackT = def.cd;
  player.attackDur = def.cd;
  if (player.weapon === 'bow') { shootArrow(); return; }
  sfx.sword();
  if (dist2(player.pos.x, player.pos.z, 140, 20) < 80) unlockAch('windmill');
  const dmg = def.dmg + (player.swordLv >= 2 ? 1 : 0);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const hitOne = (list, onHit) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < def.range && (dx * fx + dz * fz) / (d || 1) > 0.35) onHit(e);
    }
  };
  hitOne(guards, (g) => {
    g.hp -= dmg; sfx.hit(); hitFX(g, def.knock); showDamage(g.pos, dmg, dmg >= 3);
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你袭击了卫兵!'); }
    if (g.hp <= 0) {
      g.downT = 14; g.stunT = 0; g.group.rotation.z = 0;
      g.wantedHit = false;
      startFall(g); registerKill();
      dropCoins(g.pos, 3);
    } else g.state = 'chase';
  });
  hitOne(bandits, (b) => {
    b.hp -= dmg; sfx.hit(); hitFX(b, b.boss ? def.knock * 0.4 : def.knock);
    showDamage(b.pos, dmg, dmg >= 3);
    if (b.hp <= 0) {
      b.dead = true; startFall(b); registerKill();
      dropCoins(b.pos, b.boss ? 20 : 5);
      addPickup('heart', b.pos.x, b.pos.z + 1, 30);
      if (b.boss) toast('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 5);
      if (quest.active && missions[quest.idx].type === 'bandits' && !b.boss && !b.escort && !b.bountyHead && !b.robber && !b.arena && !b.ambient && !b.duel && !b.convict && !b.eventFoe) {
        quest.progress++;
        toast(`击败盗贼 ${quest.progress}/3`, 2);
        if (quest.progress >= 3) completeMission();
      }
    }
  });
  hitOne(wolves, (w) => {
    w.hp -= dmg; sfx.hit(); hitFX(w, def.knock); showDamage(w.pos, dmg, dmg >= 3);
    if (w.hp <= 0) killWolf(w);
  });
  hitOne(deers, (d) => {
    sfx.hit();
    killDeer(d);
  });
  // 鸡不会死,但它们会记住你
  hitOne(chickens, (c) => {
    if (c.state !== 'thrown' && c !== player.carrying) pokeChicken(c);
  });
  hitOne(villagers, (v) => {
    if (v.downT > 0) return;
    v.downT = 10; v.group.rotation.x = -Math.PI / 2;
    sfx.hit();
    crime(2, '你袭击了村民!这是重罪!');
  });
}

function dropCoins(pos, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28;
    addPickup('coin', pos.x + Math.cos(a) * (0.6 + Math.random()), pos.z + Math.sin(a) * (0.6 + Math.random()), 25);
  }
}

function damagePlayer(n) {
  if (player.invulnT > 0 || player.dead) return;
  if (player.blocking && player.rollT <= 0) {
    sfx.clank();
    camShake = Math.max(camShake, 0.15);
    player.invulnT = 0.35;
    return;
  }
  player.hp -= n;
  player.invulnT = 0.7;
  camShake = 0.45;
  fishing.active = false;
  sfx.hurt();
  flashEl.style.opacity = 0.45;
  setTimeout(() => (flashEl.style.opacity = 0), 120);
  if (player.hp <= 0) gameOver();
}

function gameOver() {
  player.dead = true;
  player.hp = 0;
  player.drunkT = 0;
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  sfx.gameover();
  player.jailed = wanted > 0;
  gameoverText.textContent = wanted > 0 ? '你被王国卫兵抓住了!' : '你倒下了……';
  if (titleArtURL) {
    gameoverEl.style.backgroundImage =
      `linear-gradient(rgba(70,0,0,0.72), rgba(30,0,0,0.85)), url(${titleArtURL})`;
    gameoverEl.style.backgroundSize = 'cover';
    gameoverEl.style.backgroundPosition = 'center';
  }
  gameoverEl.style.display = 'flex';
  setTimeout(() => {
    if (player.jailed) player.pos.set(13, 0, -28);
    else player.pos.copy(world.playerSpawn);
    player.hp = player.maxHp;
    player.coins = Math.floor(player.coins / 2);
    player.mounted = null;
    player.vy = 0;
    clearWanted();
    player.dead = false;
    gameoverEl.style.display = 'none';
    toast(player.jailed
      ? '⛓️ 你在王都地牢蹲了一夜,罚没一半金币后被踢了出来。'
      : '你在喷泉旁醒来,一半金币被没收充公…', 4);
  }, 2600);
}

// ================= 实体更新 =================
function moveEntity(e, tx, tz, speed, dt) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  e.pos.x += (dx / d) * speed * dt;
  e.pos.z += (dz / d) * speed * dt;
  e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), dt * 10);
  e.walkT += dt * speed * 2.2;
  resolveCollisions(e.pos, 0.4, colliders);
  return false;
}

// 人形动画:四肢摆动 + 身体起伏 + 奔跑前倾 + 呼吸怠速 + 头部环视
let nowMs = performance.now(); // 主循环每帧更新,免得几十个实体各查一次时钟
function animateLimbs(p, walkT, moving, group = null, speedNorm = 0.6) {
  const now = nowMs;
  const swing = moving ? Math.sin(walkT) * (0.45 + 0.35 * speedNorm) : 0;
  p.legL.rotation.x = swing;
  p.legR.rotation.x = -swing;
  if (p.armL) p.armL.rotation.x = -swing * 0.85;
  if (p.armR && !p._attackAnim) p.armR.rotation.x = swing * 0.85;
  let bob = 0;
  if (moving) {
    bob = Math.abs(Math.cos(walkT)) * 0.05 * (0.4 + speedNorm);
  } else {
    bob = Math.sin(now * 0.0018) * 0.012; // 呼吸
  }
  if (p.body) {
    p.body.position.y = 0.78 + bob * 0.5;
    if (!p._attackAnim) {
      p.body.rotation.x = moving ? 0.05 + 0.12 * Math.max(0, speedNorm - 0.8) : 0;
      p.body.rotation.y *= 0.85;
    }
  }
  if (p.head) {
    p.head.position.y = 1.32 + bob * 0.6;
    if (!moving) p.head.rotation.y = Math.sin(now * 0.0005 + p.head.id * 1.7) * 0.4;
    else p.head.rotation.y *= 0.9;
  }
  if (group) group.position.y += bob;
}

// 通用三段式挥剑:抬臂蓄力 → 劈砍 → 收势(t: 0→1)
function meleeSwing(p, t) {
  let arm, twist;
  if (t < 0.32) {
    const k = t / 0.32;
    arm = -2.3 * (1 - (1 - k) * (1 - k));
    twist = -0.35 * k;
  } else if (t < 0.62) {
    const k = (t - 0.32) / 0.3;
    arm = -2.3 + 3.1 * k * k;
    twist = -0.35 + 0.8 * k;
  } else {
    const k = (t - 0.62) / 0.38;
    arm = 0.8 * (1 - k);
    twist = 0.45 * (1 - k);
  }
  p.armR.rotation.x = arm;
  p.armR.rotation.z = -0.25 * Math.sin(t * Math.PI);
  if (p.body) p.body.rotation.y = twist;
}

function updateGuards(dt) {
  for (const g of guards) {
    if (g.downT > 0) {
      g.downT -= dt;
      if (g.downT <= 0) { g.hp = 3; g.group.rotation.x = 0; g.state = 'patrol'; }
      continue;
    }
    if (g.stunT > 0) {
      g.stunT -= dt;
      g.group.rotation.z = Math.sin(performance.now() * 0.02) * 0.12;
      if (g.stunT <= 0) g.group.rotation.z = 0;
      continue;
    }
    if (wanted === 0 && g.state !== 'chase' && entFar(g)) continue; // 无通缉时远处卫兵不巡逻动画
    g.attackCd = Math.max(0, g.attackCd - dt);
    const pd = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
    const sight = 22 + wanted * 8;
    let moving = false;
    if (wanted > 0 && pd < sight && !player.dead) {
      g.state = 'chase';
      if (pd < 25) evadeT = 0;
      if (g.windupT > 0) {
        g.windupT -= dt;
        if (g.windupT <= 0) {
          g.attackCd = 0.9;
          g.swingT = 0.3;
          if (Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z) < 2.3) damagePlayer(1);
        }
      } else if (pd > 1.6) {
        moveEntity(g, player.pos.x, player.pos.z, g.speed, dt);
        moving = true;
      } else if (g.attackCd <= 0) {
        g.windupT = 0.42;
        telegraphFlash(g);
      }
      g.yaw = angleLerp(g.yaw, Math.atan2(player.pos.x - g.pos.x, player.pos.z - g.pos.z), dt * 10);
    } else {
      g.state = 'patrol';
      const wp = g.waypoints[g.wp];
      if (moveEntity(g, wp[0], wp[1], g.speed * 0.45, dt)) g.wp = (g.wp + 1) % g.waypoints.length;
      else moving = true;
    }
    g.group.position.copy(g.pos);
    g.group.rotation.y = g.yaw;
    g.parts._attackAnim = (g.swingT || 0) > 0;
    animateLimbs(g.parts, g.walkT, moving, g.group, g.state === 'chase' ? 1.1 : 0.55);
    if (g.swingT > 0) {
      g.swingT -= dt;
      meleeSwing(g.parts, Math.min(1, 1 - g.swingT / 0.35));
    }
  }
}

function updateRobber(b, dt) {
  if (b.stunT > 0) { b.stunT -= dt; return; }
  const v = streetEvent.villager;
  if (b.fleeing || !v) return; // 逃跑移动由事件管理器驱动
  b.attackCd = Math.max(0, b.attackCd - dt);
  let moving = false;
  if (v.downT > 0) {
    b.fleeing = true;
    toast('盗贼得手了,正往幽暗森林逃!', 2.5);
  } else {
    const vd = Math.hypot(v.pos.x - b.pos.x, v.pos.z - b.pos.z);
    if (vd > 1.3) { moveEntity(b, v.pos.x, v.pos.z, 5.2, dt); moving = true; }
    else if (b.attackCd <= 0) {
      b.attackCd = 1;
      b.swingT = 0.35;
      v.downT = 8;
      v.group.rotation.x = -Math.PI / 2;
      sfx.hit();
    }
  }
  b.group.position.copy(b.pos);
  b.group.rotation.y = b.yaw;
  b.parts._attackAnim = (b.swingT || 0) > 0;
  animateLimbs(b.parts, b.walkT, moving, b.group, 1);
  if (b.swingT > 0) { b.swingT -= dt; meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35)); }
}

function updateBandits(dt) {
  for (const b of bandits) {
    if (b.dead) {
      if (b.ambient) {
        b.respawnT = (b.respawnT ?? 60) - dt;
        if (b.respawnT <= 0) {
          b.dead = false;
          b.hp = 3;
          b.pos.copy(b.home);
          b.group.rotation.x = 0;
          b.respawnT = 60;
        }
      }
      continue;
    }
    if (!b.boss && !b.escort && !b.robber && !b.convict && !b.bountyHead &&
        !b.duel && !b.arena && !b.eventFoe && entFar(b)) continue; // 远处匪徒待机
    if (b.robber) { updateRobber(b, dt); continue; }
    if (b.convict) {
      if (b.stunT > 0) { b.stunT -= dt; continue; }
      const fx2 = b.pos.x - player.pos.x, fz2 = b.pos.z - player.pos.z;
      const fd = Math.hypot(fx2, fz2) || 1;
      moveEntity(b, b.pos.x + (fx2 / fd) * 8, b.pos.z + (fz2 / fd) * 8, b.speed, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1);
      continue;
    }
    if (b.stunT > 0) { b.stunT -= dt; continue; }
    b.attackCd = Math.max(0, b.attackCd - dt);
    const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    let moving = false;
    // 护送任务的埋伏盗贼优先攻击商人(除非玩家贴脸)
    const mc = questRT.merchant;
    if (b.escort && mc && mc.hp > 0 && pd > 5) {
      const md = Math.hypot(mc.pos.x - b.pos.x, mc.pos.z - b.pos.z);
      if (md > 1.4) { moveEntity(b, mc.pos.x, mc.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) {
        b.attackCd = 1.0;
        b.swingT = 0.35;
        mc.hp--;
        sfx.hit();
        toast(`商人受袭!❤ ${Math.max(0, mc.hp)}/5`, 1.5);
      }
    } else if (pd < 30 && !player.dead) {
      if (b.windupT > 0) {
        b.windupT -= dt;
        if (b.windupT <= 0) {
          b.attackCd = 1.0;
          b.swingT = 0.3;
          if (Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z) < 2.3) damagePlayer(b.dmg);
        }
      } else if (pd > 1.6) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) { b.windupT = 0.45; telegraphFlash(b); }
    } else {
      const a = performance.now() * 0.0003 + b.home.x;
      moveEntity(b, b.home.x + Math.cos(a) * 5, b.home.z + Math.sin(a) * 5, b.speed * 0.3, dt);
      moving = true;
    }
    b.group.position.copy(b.pos);
    b.group.rotation.y = b.yaw;
    b.parts._attackAnim = (b.swingT || 0) > 0;
    animateLimbs(b.parts, b.walkT, moving, b.group, 1.0);
    if (b.swingT > 0) {
      b.swingT -= dt;
      meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35));
    }
  }
}

// 一天的时辰(驱动 NPC 日程)
function dayPhase() {
  if (dayTime >= 0.25 && dayTime < 0.33) return 'dawn';
  if (dayTime >= 0.33 && dayTime < 0.62) return 'day';
  if (dayTime >= 0.62 && dayTime < 0.72) return 'dusk';
  return 'night';
}

// 村民日程:清晨在家门口 → 白天上工 → 黄昏去旅店/广场 → 夜里回家睡觉
function updateVillagers(dt) {
  const phase = dayPhase();
  for (const v of villagers) {
    if (v.robbedT > 0) v.robbedT -= dt;
    if (v.downT > 0) {
      v.downT -= dt;
      if (v.downT <= 0) v.group.rotation.x = 0;
      continue;
    }
    if (v.fleeT <= 0 && entFar(v)) continue; // 远处村民不演日程
    // 夜里睡觉:走到家,消失在屋里
    if (phase === 'night' && v.fleeT <= 0) {
      if (v.sleeping) continue;
      if (moveEntity(v, v.home.x, v.home.z, 2.2, dt)) {
        v.sleeping = true;
        v.group.visible = false;
        continue;
      }
      v.group.position.copy(v.pos);
      v.group.rotation.y = v.yaw;
      animateLimbs(v.parts, v.walkT, true, v.group, 0.5);
      continue;
    }
    if (v.sleeping) { v.sleeping = false; v.group.visible = true; }

    const pd = Math.hypot(player.pos.x - v.pos.x, player.pos.z - v.pos.z);
    let moving = false;
    if (wanted > 0 && pd < 12) v.fleeT = 2;
    if (v.fleeT > 0) {
      v.fleeT -= dt;
      const fx = v.pos.x - player.pos.x, fz = v.pos.z - player.pos.z;
      const d = Math.hypot(fx, fz) || 1;
      moveEntity(v, v.pos.x + (fx / d) * 5, v.pos.z + (fz / d) * 5, 4.2, dt);
      moving = true;
    } else {
      // 当前时辰该去的地方
      const spot = phase === 'day' ? v.id.work : phase === 'dusk' ? v.id.leisure : v.id.home;
      const sd = Math.hypot(v.pos.x - spot[0], v.pos.z - spot[1]);
      if (sd > 6) {
        // 赶路
        moveEntity(v, spot[0], spot[1], 2.4, dt);
        moving = true;
      } else {
        // 在目的地附近晃悠、干活
        v.timer -= dt;
        if (v.timer <= 0) {
          v.timer = 2 + Math.random() * 4;
          const a = Math.random() * 6.28;
          v.target = [spot[0] + Math.cos(a) * 3.5, spot[1] + Math.sin(a) * 3.5];
        }
        if (v.target && !moveEntity(v, v.target[0], v.target[1], 1.5, dt)) moving = true;
      }
    }
    v.group.position.copy(v.pos);
    v.group.rotation.y = v.yaw;
    animateLimbs(v.parts, v.walkT, moving, v.group, v.fleeT > 0 ? 0.95 : 0.35);
  }
}

function updateHorses(dt) {
  for (const h of horses) {
    if (h === player.mounted) continue;
    if (!h.runaway && entFar(h)) continue; // 远处的马原地吃草
    // 空中下马后自然回落地面
    if (h.pos.y > 0) h.pos.y = Math.max(0, h.pos.y - 22 * dt);
    if (h.runaway) {
      // 受惊狂奔:不停变向
      h.timer -= dt;
      if (h.timer <= 0) {
        h.timer = 1.2 + Math.random();
        const a = Math.random() * 6.28;
        h.rTarget = [h.pos.x + Math.cos(a) * 20, h.pos.z + Math.sin(a) * 20];
      }
      if (h.rTarget) moveEntityHorse(h, h.rTarget[0], h.rTarget[1], 9, dt);
      h.group.position.copy(h.pos);
      h.group.rotation.y = h.yaw;
      animHorseLegs(h, 1.5);
      continue;
    }
    h.timer -= dt;
    let moving = false;
    if (h.timer <= 0) {
      h.timer = 3 + Math.random() * 5;
      const a = Math.random() * 6.28;
      h.target = [h.home.x + Math.cos(a) * 8, h.home.z + Math.sin(a) * 8];
      if (Math.random() < 0.5) h.target = null; // 吃草
    }
    if (h.target) {
      if (moveEntityHorse(h, h.target[0], h.target[1], 2, dt)) h.target = null;
      else moving = true;
    }
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    animHorseLegs(h, moving ? 1 : 0);
  }
}
function moveEntityHorse(h, tx, tz, speed, dt) {
  const dx = tx - h.pos.x, dz = tz - h.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  h.pos.x += (dx / d) * speed * dt;
  h.pos.z += (dz / d) * speed * dt;
  h.yaw = angleLerp(h.yaw, Math.atan2(dx, dz), dt * 6);
  h.walkT += dt * speed * 2;
  resolveCollisions(h.pos, 0.8, colliders);
  return false;
}
// 马匹步态:静止 / 小跑(对角步)/ 疾驰(前后肢分相 + 身体俯仰起伏)
function animHorseLegs(h, intensity) {
  const w = h.walkT;
  const L = h.parts.legs;
  if (intensity < 0.05) {
    for (const leg of L) leg.rotation.x *= 0.8;
    h.visBob = (h.visBob || 0) * 0.8;
    h.visPitch = (h.visPitch || 0) * 0.8;
  } else if (intensity < 1.25) {
    // 小跑:对角腿成对
    const a = Math.sin(w) * 0.5;
    L[0].rotation.x = a; L[1].rotation.x = -a;
    L[2].rotation.x = -a; L[3].rotation.x = a;
    h.visBob = Math.abs(Math.sin(w)) * 0.04;
    h.visPitch = 0;
  } else {
    // 疾驰:后肢蹬地、前肢前伸,身体俯仰 + 腾空起伏
    const rear = Math.sin(w) * 0.9;
    const front = Math.sin(w + 2.2) * 0.9;
    L[0].rotation.x = rear; L[1].rotation.x = rear * 0.92;
    L[2].rotation.x = front; L[3].rotation.x = front * 0.92;
    h.visBob = Math.max(0, Math.sin(w + 0.6)) * 0.17;
    h.visPitch = Math.sin(w + 1.2) * 0.07;
  }
  h.group.position.y = h.pos.y + (h.visBob || 0);
  h.group.rotation.x = h.visPitch || 0;
}

// ================= 玩家更新 =================
const _moveFwd = new THREE.Vector2();
const _moveRight = new THREE.Vector2();
const _moveVec = new THREE.Vector2();
function updatePlayer(dt) {
  if (player.dead) return;
  player.invulnT = Math.max(0, player.invulnT - dt);

  // 醉酒:打嗝 + 清醒判定
  if (player.drunkT > 0) {
    player.drunkT -= dt;
    player.hiccupT -= dt;
    if (player.hiccupT <= 0) {
      player.hiccupT = 3 + Math.random() * 3;
      sfx.hiccup();
      camShake = Math.max(camShake, 0.12);
    }
    if (player.drunkT <= 0) toast('你清醒过来了……头好痛。', 2.5);
  }

  // 攻击动画(三段式:蓄力→劈砍→收势)
  if (player.attackT > 0) {
    player.attackT -= dt;
    const t = 1 - player.attackT / (player.attackDur || 0.35);
    player.parts._attackAnim = true;
    meleeSwing(player.parts, Math.min(1, t));
    if (player.attackT <= 0) {
      player.parts._attackAnim = false;
      player.parts.armR.rotation.z = 0;
      player.parts.body.rotation.y = 0;
    }
  }

  const f = _moveFwd.set(-Math.sin(camYaw), -Math.cos(camYaw));
  const r = _moveRight.set(-f.y, f.x);
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  const mv = _moveVec.set(f.x * iz + r.x * ix, f.y * iz + r.y * ix);
  const moving = mv.lengthSq() > 0;
  if (moving) mv.normalize();
  // 醉酒:走路画龙
  if (moving && player.drunkT > 0) {
    const wob = Math.sin(performance.now() * 0.0012) * 0.7;
    const cw = Math.cos(wob), sw = Math.sin(wob);
    mv.set(mv.x * cw - mv.y * sw, mv.x * sw + mv.y * cw);
  }

  if (player.mounted) {
    const h = player.mounted;
    const speed = h.sheep
      ? (keys['ShiftLeft'] || keys['ShiftRight'] ? 4.6 : 3.2)
      : (keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11) * (h.fast ? 1.2 : 1);
    if (moving) {
      h.pos.x += mv.x * speed * dt;
      h.pos.z += mv.y * speed * dt;
      h.yaw = angleLerp(h.yaw, Math.atan2(mv.x, mv.y), dt * 6);
      h.walkT += dt * speed * 1.6;
      if (h.sheep) {
        stats.sheepDist += speed * dt;
        if (stats.sheepDist >= 100) unlockAch('shepherd');
      }
    }
    // 骑乘跳跃
    if (keys['Space'] && player.onGround) {
      player.vy = 8;
      player.onGround = false;
      sfx.jump();
      keys['Space'] = false;
    }
    const horseAirborne = !player.onGround;
    player.vy -= 22 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vy = 0;
      player.onGround = true;
      if (horseAirborne) spawnDust(h.pos.x, 0.1, h.pos.z, 7, 1.4, 1.8);
    }
    // 马蹄声与扬尘(节奏随速度)
    if (moving && player.onGround) {
      h.stepT = (h.stepT || 0) - dt;
      if (h.stepT <= 0) {
        h.stepT = (keys['ShiftLeft'] || keys['ShiftRight']) ? 0.17 : 0.32;
        if (h.sheep) { if (Math.random() < 0.22) sfx.baa(); }
        else sfx.hoof();
        spawnDust(h.pos.x - Math.sin(h.yaw) * 1.1, 0.08, h.pos.z - Math.cos(h.yaw) * 1.1,
          (keys['ShiftLeft'] || keys['ShiftRight']) ? 3 : 1, 0.8, 1.3);
      }
    }
    resolveCollisions(h.pos, 0.85, colliders);
    h.pos.y = player.pos.y;
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    const galloping = moving && (keys['ShiftLeft'] || keys['ShiftRight']);
    animHorseLegs(h, moving ? (galloping ? 1.6 : 1.0) : 0);
    moveState = moving ? (galloping ? 3 : 2) : 0;
    player.pos.x = h.pos.x;
    player.pos.z = h.pos.z;
    player.yaw = h.yaw;
    // 骑手随马起伏,疾驰时前倾(骑羊时……贴地飞行)
    player.group.position.set(h.pos.x, h.pos.y + (h.sheep ? 0.72 : 1.35) + (h.visBob || 0), h.pos.z);
    player.group.rotation.y = h.yaw;
    player.parts.legL.rotation.x = -1.1;
    player.parts.legR.rotation.x = -1.1;
    player.parts.body.rotation.x = galloping ? 0.3 : 0.1;
    player.parts.armL.rotation.x = -0.55;
    if (!player.parts._attackAnim) player.parts.armR.rotation.x = -0.55;
    return;
  }

  // 翻滚接管本帧
  if (player.rollCd > 0) player.rollCd -= dt;
  if (player.rollT > 0) {
    player.rollT -= dt;
    player.pos.x += player.rollDir.x * 13 * dt;
    player.pos.z += player.rollDir.y * 13 * dt;
    resolveCollisions(player.pos, 0.45, colliders);
    player.group.position.copy(player.pos);
    player.group.rotation.y = player.yaw;
    player.group.rotation.x = -(1 - Math.max(0, player.rollT) / 0.38) * Math.PI * 2;
    if (player.rollT <= 0) player.group.rotation.x = 0;
    moveState = 2;
    return;
  }
  const speed = (keys['ShiftLeft'] || keys['ShiftRight'] ? 8.4 : 5.0) * (player.blocking ? 0.45 : 1);
  const prevYaw = player.yaw;
  if (moving) {
    player.pos.x += mv.x * speed * dt;
    player.pos.z += mv.y * speed * dt;
    player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * 12);
    player.walkT += dt * speed * 2.2;
  }
  moveState = moving ? (speed > 5 ? 2 : 1) : 0;
  if (fishing.active && moving) {
    fishing.active = false;
    toast('收竿了。', 1.5);
  }
  // 疾跑扬尘
  if (moving && player.onGround && speed > 5) {
    player.stepT = (player.stepT || 0) - dt;
    if (player.stepT <= 0) {
      player.stepT = 0.22;
      spawnDust(player.pos.x, 0.05, player.pos.z, 1, 0.35, 1.0);
    }
  }
  // 转向侧倾
  let dyaw = (player.yaw - prevYaw) % (Math.PI * 2);
  if (dyaw > Math.PI) dyaw -= Math.PI * 2;
  if (dyaw < -Math.PI) dyaw += Math.PI * 2;
  player.lean = (player.lean || 0) * 0.86 + Math.max(-0.16, Math.min(0.16, -dyaw * 1.6)) * 0.14;

  // 跳跃(二段跳)
  if (keys['Space']) {
    if (player.onGround) {
      player.vy = 8.2; player.onGround = false; player.jumps = 1; sfx.jump();
    } else if (player.jumps === 1) {
      player.vy = 7.4; player.jumps = 2; sfx.jump();
    }
    keys['Space'] = false;
  }
  const wasAirborne = !player.onGround;
  const fallSpeed = player.vy;
  player.vy -= 22 * dt;
  // 抱着鸡:扑腾缓降(塞尔达欠我们的)
  if (player.carrying && player.vy < -2.4) player.vy = -2.4;
  player.pos.y += player.vy * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vy = 0;
    // 先重置着地状态,再判定踩踏——checkStomp 的弹跳(onGround=false)才能保留,支持连环踩踏
    player.onGround = true;
    player.jumps = 0;
    if (wasAirborne && fallSpeed < -3) checkStomp();
    if (wasAirborne && fallSpeed < -10) camShake = 0.22;
    if (wasAirborne && fallSpeed < -6) spawnDust(player.pos.x, 0.06, player.pos.z, 6, 0.9, 1.5);
  }

  // “?”砖块(从下方顶)
  if (player.vy > 0) {
    for (const b of world.qBlocks) {
      if (b.used) continue;
      const headY = player.pos.y + 1.55;
      if (Math.abs(player.pos.x - b.x) < 0.85 && Math.abs(player.pos.z - b.z) < 0.85 &&
          headY > b.y - 0.5 && headY < b.y + 0.2) {
        b.used = true;
        b.bump = 0.25;
        b.mesh.material = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
        player.vy = -1;
        sfx.block();
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * 6.28;
          addPickup('coin', b.x + Math.cos(a) * 1.2, b.z + Math.sin(a) * 1.2, 30);
        }
        toast('+5 金币!', 1.5);
      }
    }
  }

  resolveCollisions(player.pos, 0.45, colliders);
  pushCrowd();
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  player.group.rotation.z = player.lean || 0;
  // 受伤闪烁
  player.group.visible = player.invulnT > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true;
  animateLimbs(player.parts, player.walkT, moving, player.group, speed / 7.6);
  // 格挡姿势
  if (player.blocking && !player.parts._attackAnim) {
    player.parts.armR.rotation.x = -1.35;
    player.parts.armR.rotation.z = -0.5;
  } else if (!player.parts._attackAnim) {
    player.parts.armR.rotation.z = 0;
  }
  // 抱鸡:高举过头,鸡随身,空中扑腾
  if (player.carrying) {
    const c = player.carrying;
    c.pos.set(player.pos.x, player.pos.y + 1.78, player.pos.z);
    c.group.position.copy(c.pos);
    c.group.rotation.y = player.yaw;
    c.walkT += dt * (player.onGround ? 4 : 26);
    c.parts.body.position.y = 0.26 + (!player.onGround ? Math.abs(Math.sin(c.walkT)) * 0.07 : 0);
    if (!player.parts._attackAnim) {
      player.parts.armL.rotation.x = Math.PI * 0.92;
      player.parts.armR.rotation.x = Math.PI * 0.92;
    }
  }
}

function checkStomp() {
  const tryStomp = (list, isGuard) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead || e.stunT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 1.3) {
        e.stunT = 5;
        player.vy = 7.5;
        player.onGround = false;
        player.jumps = 1;
        sfx.stomp();
        const nowS = performance.now() / 1000;
        if (nowS - stats.lastStomp < 2) unlockAch('bouncer');
        stats.lastStomp = nowS;
        spawnDust(e.pos.x, 0.3, e.pos.z, 6, 0.8, 1.6);
        toast(isGuard ? '踩晕了卫兵!' : '踩晕了敌人!', 1.5);
        if (isGuard) crime(1);
        return true;
      }
    }
    return false;
  };
  // 踩到鸡:弹起 + 拉仇恨
  for (const c of chickens) {
    if (c === player.carrying || c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 1.1) {
      pokeChicken(c);
      player.vy = 7.5;
      player.onGround = false;
      player.jumps = 1;
      sfx.stomp();
      return true;
    }
  }
  return tryStomp(guards, true) || tryStomp(bandits, false) || tryStomp(wolves, false);
}

function doRoll() {
  if (!started || player.dead || player.mounted || player.carrying ||
      player.rollCd > 0 || player.rollT > 0 || !player.onGround) return;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = -fz, rz = fx;
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
  if (dx === 0 && dz === 0) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); }
  const d = Math.hypot(dx, dz);
  player.rollDir.set(dx / d, dz / d);
  player.yaw = Math.atan2(dx, dz);
  player.rollT = 0.38;
  player.rollCd = 0.95;
  player.invulnT = Math.max(player.invulnT, 0.45); // 无敌帧
  sfx.roll();
  spawnDust(player.pos.x, 0.05, player.pos.z, 4, 0.5, 1);
}

function tryRob() {
  if (!started || player.dead || player.mounted) return;
  for (const v of villagers) {
    if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6) continue;
    v.robbedT = 60;
    v.fleeT = 6;
    dropCoins(v.pos, 3 + Math.floor(Math.random() * 4));
    showBubble(v, v.id.name, '救命!抢劫啦——!!', 3);
    crime(2, '💰 你抢劫了村民!');
    return;
  }
  toast('附近没有可以抢的人。(你在想什么?)', 2);
}

// ================= 拾取 =================
function updatePickups(dt) {
  const radius = player.mounted ? 1.8 : 1.2;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    if (p.ttl !== Infinity) {
      p.ttl -= dt;
      if (p.ttl <= 0) { scene.remove(p.mesh); pickups.splice(i, 1); continue; }
      p.mesh.visible = p.ttl > 5 || Math.floor(p.t * 8) % 2 === 0;
    }
    p.mesh.rotation.y += dt * 3.5;
    // 金币磁吸:靠近就飞进口袋
    if (p.type === 'coin' && !player.dead) {
      const md = dist2(player.pos.x, player.pos.z, p.x, p.z);
      if (md < 30 && md > 0.05) {
        const d = Math.sqrt(md);
        const pull = (12 * dt) / d;
        p.x += (player.pos.x - p.x) * pull;
        p.z += (player.pos.z - p.z) * pull;
        p.mesh.position.x = p.x;
        p.mesh.position.z = p.z;
      }
    }
    p.mesh.position.y = (p.type === 'star' ? 1.4 : p.type === 'crest' ? 1.0 : 0.65) + Math.sin(p.t * 3) * 0.12;
    if (!player.dead && dist2(player.pos.x, player.pos.z, p.x, p.z) < radius * radius &&
        player.pos.y < 1.5) {
      if (p.type === 'coin') {
        player.coins++;
        sfx.coin();
        if (quest.active && missions[quest.idx].type === 'coins') quest.progress++;
      } else if (p.type === 'heart') {
        player.hp = Math.min(player.maxHp, player.hp + 2);
        sfx.heart();
      } else if (p.type === 'crest') {
        crestsFound.push(p.id);
        sfx.chest();
        if (crestsFound.length >= world.crestSpots.length) {
          player.coins += 100;
          sfx.fanfare();
          toast(`🛡️ 集齐 ${world.crestSpots.length} 枚皇家纹章!奖励 100 金币!`, 5);
        } else {
          toast(`🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`, 3);
        }
        saveGame();
      } else {
        sfx.fanfare();
        toast('★ 恭喜通关!你成了王国传奇——世界仍然开放,继续撒欢吧!★', 8);
      }
      scene.remove(p.mesh);
      pickups.splice(i, 1);
    }
  }
}

// ================= 任务更新 =================
function updateQuest(dt) {
  exGroup.visible = quest.idx < missions.length && !quest.active;
  exGroup.position.x = steward.pos.x;
  exGroup.position.z = steward.pos.z;
  exGroup.position.y = 2.1 + Math.sin(performance.now() * 0.003) * 0.15;
  exGroup.rotation.y += dt * 2;

  beacon.visible = false;
  if (bountyRT.target && !bountyRT.target.dead) {
    beacon.visible = true;
    beacon.position.x = bountyRT.target.pos.x;
    beacon.position.z = bountyRT.target.pos.z;
  }
  if (!quest.active || player.dead) return;
  const m = missions[quest.idx];
  const setBeacon = (x, z) => { beacon.visible = true; beacon.position.x = x; beacon.position.z = z; };

  if (m.type === 'deliver') {
    quest.timer -= dt;
    setBeacon(world.windmillPos.x, world.windmillPos.z);
    if (dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) < 49) {
      completeMission();
    } else if (quest.timer <= 0) {
      failMission('投递超时!回去找埃隆重新接取…');
    }
  } else if (m.type === 'coins') {
    beacon.visible = quest.progress >= m.goal;
    beacon.position.x = steward.pos.x;
    beacon.position.z = steward.pos.z;
  } else if (m.type === 'bandits') {
    beacon.visible = quest.progress < m.goal;
    beacon.position.x = world.banditCamp.x;
    beacon.position.z = world.banditCamp.z;
  } else if (m.type === 'race') {
    quest.timer -= dt;
    if (quest.timer <= 0) { failMission('超时!回去找埃隆再试一次…'); return; }
    const [rx, rz] = world.raceRoute[questRT.ringIdx];
    setBeacon(rx, rz);
    // 高亮当前环
    questRT.rings.forEach((ring, i) => {
      ring.rotation.y += dt * (i === questRT.ringIdx ? 3 : 0.6);
      ring.material.emissiveIntensity = i < questRT.ringIdx ? 0.1 : i === questRT.ringIdx ? 1.2 : 0.4;
    });
    if (dist2(player.pos.x, player.pos.z, rx, rz) < 9) {
      sfx.block();
      questRT.ringIdx++;
      if (questRT.ringIdx >= world.raceRoute.length) completeMission();
      else toast(`金环 ${questRT.ringIdx}/${world.raceRoute.length}`, 1.2);
    }
  } else if (m.type === 'losthorse') {
    const sh = questRT.specialHorse;
    if (!sh) return;
    if (player.mounted === sh) {
      setBeacon(world.stablePos.x, world.stablePos.z);
      if (dist2(player.pos.x, player.pos.z, world.stablePos.x, world.stablePos.z) < 100) {
        sh.home.copy(world.stablePos);
        sh.owned = false;
        completeMission();
        toast('雪影归你了!它就在马厩等你。', 4);
      }
    } else {
      setBeacon(sh.pos.x, sh.pos.z);
    }
  } else if (m.type === 'escort') {
    const mc = questRT.merchant;
    if (!mc) return;
    setBeacon(mc.pos.x, mc.pos.z);
    if (mc.hp <= 0) { failMission('商人巴特倒下了……回去找埃隆重整旗鼓。'); return; }
    // 沿路线行进
    const [tx, tz] = world.escortRoute[mc.wp];
    const dx = tx - mc.pos.x, dz = tz - mc.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) {
      mc.wp++;
      // 埋伏点:第 2、4 个路点
      if ((mc.wp === 2 || mc.wp === 4) && questRT.escortSpawned < mc.wp) {
        questRT.escortSpawned = mc.wp;
        addBandit(mc.pos.x + 8, mc.pos.z - 6, { escort: true });
        addBandit(mc.pos.x + 8, mc.pos.z + 6, { escort: true });
        toast('⚠️ 有埋伏!保护商人!', 2.5);
        sfx.wanted();
      }
      if (mc.wp >= world.escortRoute.length) {
        scene.remove(mc.group);
        questRT.merchant = null;
        completeMission();
        return;
      }
    } else {
      mc.pos.x += (dx / d) * 2.4 * dt;
      mc.pos.z += (dz / d) * 2.4 * dt;
      mc.yaw = angleLerp(mc.yaw, Math.atan2(dx, dz), dt * 8);
      mc.walkT += dt * 5;
    }
    mc.group.position.copy(mc.pos);
    mc.group.rotation.y = mc.yaw;
    animateLimbs(mc.parts, mc.walkT, d >= 1.5, mc.group, 0.5);
  } else if (m.type === 'wolves') {
    setBeacon(-140, -40);
  } else if (m.type === 'boss') {
    if (questRT.boss) setBeacon(questRT.boss.pos.x, questRT.boss.pos.z);
    if (questRT.boss && questRT.boss.dead) {
      questRT.boss = null;
      completeMission();
    }
  }
}

// ================= 通缉衰减 =================
function updateWanted(dt) {
  if (wanted <= 0) return;
  evadeT += dt;
  if (evadeT > 13) {
    wanted--;
    evadeT = 6;
    if (wanted === 0) {
      clearWanted();
      sfx.clear();
      toast('通缉解除,卫兵放弃了追捕', 3);
    }
  }
}

// ================= 昼夜 =================
let dayTime = 0.28; // 从清晨开始
// 热循环复用的临时对象(避免每帧分配)
const _sunDir = new THREE.Vector3();
const _sunPosV = new THREE.Vector3();
const _snapT = new THREE.Vector3();
const _snapM = new THREE.Matrix4();
const _snapInv = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);
const _topC = new THREE.Color();
const _horC = new THREE.Color();
const C_DAY_TOP = new THREE.Color(0x3d84ec), C_DAY_HOR = new THREE.Color(0xd4e8f8);
const C_DUSK_TOP = new THREE.Color(0x35306a), C_DUSK_HOR = new THREE.Color(0xff8a4a);
const C_NIGHT_TOP = new THREE.Color(0x040814), C_NIGHT_HOR = new THREE.Color(0x0e1830);
const C_SUN_DAY = new THREE.Color(0xfff2cc), C_SUN_DUSK = new THREE.Color(0xff6a2a);
let envIntensity = 1;

function updateDayNight(dt) {
  dayTime = (dayTime + dt / 240) % 1;
  const ang = dayTime * Math.PI * 2 - Math.PI / 2;
  const elev = Math.sin(ang);
  const day = Math.max(0, Math.min(1, elev * 2 + 0.25));
  const night = 1 - day;
  const sx = Math.cos(ang) * 250, sy = elev * 220, sz = 80;
  // 阴影相机纹素对齐:把目标点量化到光空间纹素网格,消除移动时阴影边缘抖动
  _sunPosV.set(player.pos.x + sx * 0.4, Math.max(20, sy), player.pos.z + sz * 0.4);
  _snapT.set(player.pos.x, 0, player.pos.z);
  _snapM.lookAt(_sunPosV, _snapT, _UP);
  _snapInv.copy(_snapM).invert();
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  _snapT.applyMatrix4(_snapInv);
  _snapT.x = Math.round(_snapT.x / texel) * texel;
  _snapT.y = Math.round(_snapT.y / texel) * texel;
  _snapT.applyMatrix4(_snapM);
  const snapDx = _snapT.x - player.pos.x, snapDz = _snapT.z - player.pos.z;
  sun.position.set(_sunPosV.x + snapDx, _sunPosV.y, _sunPosV.z + snapDz);
  sun.target.position.copy(_snapT);
  const rainDim = 1 - 0.72 * weather.rain;
  sun.intensity = 3.2 * day * rainDim;
  sun.color.copy(C_SUN_DUSK).lerp(C_SUN_DAY, Math.min(1, Math.max(0, elev * 2.2)));
  moon.position.set(-sx, Math.max(30, -sy), -sz);
  moon.intensity = 0.3 * night;
  hemi.intensity = (0.12 + 0.38 * day) * (1 - 0.3 * weather.rain);
  envIntensity = (0.05 + 0.3 * day) * rainDim;

  // 天空穹顶
  _sunDir.set(sx, sy, sz).normalize();
  skyUniforms.sunDir.value.copy(_sunDir);
  skyUniforms.sunColor.value.copy(sun.color);
  skyUniforms.sunGlow.value = (0.4 + day) * (1 - 0.75 * weather.cover);
  skyUniforms.cover.value = weather.cover;
  let top, hor;
  if (elev > 0.25) { top = C_DAY_TOP; hor = C_DAY_HOR; }
  else if (elev > -0.08) {
    const t = (elev + 0.08) / 0.33;
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
  sky.position.copy(camera.position);

  moonBall.position.set(camera.position.x - sx * 1.6, Math.max(-40, -sy * 1.6), camera.position.z - sz * 1.6);
  moonBall.visible = -sy > -20;
  starMat.opacity = Math.max(0, -elev * 2.2);

  // 曝光与泛光随昼夜变化
  renderer.toneMappingExposure = 0.85 + day * 0.25;
  bloom.strength = 0.28 + night * 0.4;

  // 火把与窗户
  for (const t of world.torches) {
    const flick = 0.8 + Math.sin(performance.now() * 0.013 + (t.light ? t.light.position.x : 0)) * 0.2;
    if (t.light) t.light.intensity = t.base * night * flick;
    if (t.window) t.flame.material.emissiveIntensity = night * 1.8;
    else t.flame.material.emissiveIntensity = 0.5 + night * flick * 2.2;
  }
}

// 环境反射强度随昼夜(每隔一段时间遍历一次材质)
const envMats = new Set();
let envScan = 0;
function updateEnvIntensity() {
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

// ================= 相机 =================
let moveState = 0; // 0 静止 1 走 2 跑 3 疾驰
let camShake = 0;
const _camOff = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _camRay = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
function updateCamera(dt) {
  const dist = player.mounted ? (player.mounted.sheep ? 6 : 9) : 6.2;
  const ty = player.pos.y + (player.mounted ? (player.mounted.sheep ? 1.7 : 2.6) : 1.7);
  // 醉酒:地平线跟着晃
  if (player.drunkT > 0) {
    camera.up.set(Math.sin(performance.now() * 0.0011) * 0.16, 1, 0).normalize();
  } else {
    camera.up.set(0, 1, 0);
  }
  _camOff.set(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  ).multiplyScalar(dist);
  const target = _camTarget.set(player.pos.x, ty, player.pos.z);
  const desired = _camDesired.copy(target).add(_camOff);
  desired.y = Math.max(0.6, desired.y);
  camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
  // 相机防穿墙:从视点向相机打射线,撞到墙体/建筑就把相机拉近
  _camDir.copy(camera.position).sub(target);
  const camLen = _camDir.length();
  if (camLen > 0.5) {
    _camDir.divideScalar(camLen);
    _camRay.set(target, _camDir);
    _camRay.far = camLen;
    const hits = _camRay.intersectObjects(world.occluders, false);
    if (hits.length) {
      camera.position.copy(target).addScaledVector(_camDir, Math.max(1.1, hits[0].distance * 0.88));
    }
  }
  // 受击/落地震屏
  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt);
    camera.position.x += (Math.random() - 0.5) * camShake * 0.5;
    camera.position.y += (Math.random() - 0.5) * camShake * 0.35;
  }
  camera.lookAt(target);
  // 疾跑/疾驰时动态拉伸视野(速度感)
  const fovTarget = 62 + [0, 0, 3.5, 9][moveState];
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
}

// ================= HUD =================
let hudCache = '';
function updateHUD() {
  const full = Math.floor(player.hp / 2);
  const half = player.hp % 2;
  const heartsMax = Math.ceil(player.maxHp / 2);
  const hearts = '❤️'.repeat(full) + (half ? '💔' : '') + '🖤'.repeat(Math.max(0, heartsMax - full - half));
  const stars = wanted > 0 ? '⭐'.repeat(wanted) + '✩'.repeat(5 - wanted) : '';
  let missionText;
  if (quest.idx >= missions.length) missionText = '🏆 全部委托完成 — 去谒见领主,王国是你的了!';
  else if (!quest.active) missionText = `📜 委托 ${quest.idx + 1}/${missions.length}:去喷泉广场找管家埃隆(按 E)`;
  else {
    const m = missions[quest.idx];
    let prog = '';
    if (m.type === 'coins') prog = ` (${Math.min(quest.progress, m.goal)}/${m.goal})` + (quest.progress >= m.goal ? ' — 回去交任务!' : '');
    if (m.type === 'bandits' || m.type === 'wolves') prog = ` (${quest.progress}/${m.goal})`;
    if (m.type === 'race') prog = ` (金环 ${questRT.ringIdx}/${world.raceRoute.length})`;
    if (m.type === 'escort' && questRT.merchant) prog = ` (商人 ❤×${Math.max(0, questRT.merchant.hp)})`;
    missionText = `📜 ${m.title}:${m.desc}${prog}`;
  }
  if (arenaRT.active) missionText = `🏟️ 竞技场:第 ${arenaRT.wave} 波(走出沙圈=认输)\n${missionText}`;
  const timerType = quest.active && (missions[quest.idx].type === 'deliver' || missions[quest.idx].type === 'race');
  const timer = timerType ? `⏱ ${Math.ceil(quest.timer)} 秒` : '';
  if (timer) missionText = `${timer}${quest.timer < 12 ? ' ⚠️' : ''}\n${missionText}`;
  missionText += `\n🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`;
  const raining = weather.state === 'rain' || weather.state === 'storm';
  const wIcon = isWinter() && raining ? '🌨️' : { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' }[weather.state];
  const phaseIcon = { dawn: '🌅', day: '🌞', dusk: '🌇', night: '🌙' }[dayPhase()];
  const sp = todaySpecial();
  const calText = `${SEASON_ICON[seasonIdx()]}${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`;
  const bossHp = questRT.boss && !questRT.boss.dead && quest.active ? questRT.boss.hp : -1;
  const key = hearts + '|' + player.coins + '|' + player.weapon + player.armor + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText + '|' + wIcon + phaseIcon + calText + '|' + bossHp;
  if (key === hudCache) return;
  hudCache = key;
  weatherEl.textContent = `${calText} ${phaseIcon} ${wIcon}`;
  heartsEl.textContent = hearts;
  coinsEl.textContent = `🪙 ${player.coins}`;
  wantedEl.textContent = stars;
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.textContent = missionText;
  const wDef = WEAPONS[player.weapon];
  equipEl.textContent =
    `${wDef.icon} ${wDef.name}${player.swordLv >= 2 ? '+1' : ''}` +
    (player.armor ? ` · 🛡️ ${ARMORS[player.armor].name}` : '') +
    (player.weaponsOwned.length > 1 ? '(Q 切换)' : '');
  promptEl.textContent = promptText;
  promptEl.style.display = promptText ? 'block' : 'none';
  // Boss 血条(仅 Boss 战期间)
  const boss = questRT.boss;
  if (boss && !boss.dead && quest.active) {
    bosshpEl.style.display = 'block';
    bosshpFillEl.style.width = `${Math.max(0, (boss.hp / 12) * 100)}%`;
  } else {
    bosshpEl.style.display = 'none';
  }
}

function computePrompt() {
  promptText = '';
  promptTargetPos = null;
  if (!started || player.dead) return;
  if (fishing.active) {
    promptText = fishing.phase === 'bite' ? '‼️ 咬钩了!按 E 收杆!!' : '🎣 等鱼上钩……(走动收竿)';
    return;
  }
  if (player.carrying) { promptText = '按 E 扔鸡!'; return; }
  if (player.mounted) { promptText = player.mounted.sheep ? '按 E 下羊(它松了口气)' : '按 E 下马'; return; }
  if (dialog.open) return;
  const mark = (x, z, h) => { promptTargetPos = { x, y: h, z }; };
  for (const n of namedNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    mark(n.pos.x, n.pos.z, 2.15);
    if (n.key === 'steward' && quest.idx < missions.length) { promptText = '按 E 与管家埃隆交谈(委托)'; return; }
    if (n.key === 'blacksmith') { promptText = '按 E 打开铁匠铺(武器/护甲)'; return; }
    if (n.key === 'trader' && !player.royalHorse) { promptText = '按 E 找马贩瑟尔玛(皇家骏马 80 金币)'; return; }
    if (n.key === 'innkeep' && player.venison > 0) { promptText = `按 E 卖鹿肉 ×${player.venison}(每块 5 金币)`; return; }
    if (n.key === 'innkeep' && player.hp < player.maxHp) { promptText = '按 E 住店休息,回满生命(10 金币)'; return; }
    if (n.key === 'innkeep' && dayPhase() === 'night') { promptText = '按 E 住店过夜,睡到天亮(10 金币)'; return; }
    if (n.key === 'witch' && player.hp < player.maxHp) { promptText = '按 E 买回魂汤(8 金币)'; return; }
    if (n.key === 'witch' && player.herbs > 0) { promptText = `按 E 卖蘑菇 ×${player.herbs}(每朵 3 金币)`; return; }
    if (n.key === 'king') {
      promptText = quest.idx >= missions.length && !n.rewarded ? '按 E 领取领主的重赏' : '按 E 谒见领主';
      return;
    }
    promptText = `按 E 与${n.def.name}交谈`;
    return;
  }
  if (director.mystic && dist2(player.pos.x, player.pos.z, director.mystic.pos.x, director.mystic.pos.z) < 6) {
    mark(director.mystic.pos.x, director.mystic.pos.z, 2.15);
    promptText = '按 E 与兜帽商人交易(灵药 5 金币)';
    return;
  }
  if (director.cow && dist2(player.pos.x, player.pos.z, director.cow.pos.x, director.cow.pos.z) < 8) {
    mark(director.cow.pos.x, director.cow.pos.z, 1.8);
    promptText = `按 E 向牛提问(还能问 ${Math.max(0, 5 - director.cow.asked)} 次)`;
    return;
  }
  if (director.thief && dist2(player.pos.x, player.pos.z, director.thief.pos.x, director.thief.pos.z) < 6) {
    mark(director.thief.pos.x, director.thief.pos.z, 2.15);
    promptText = '按 E 咳嗽一声';
    return;
  }
  for (const c of chickens) {
    if (!c.extra || c.state === 'thrown' || c === player.carrying) continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      mark(c.pos.x, c.pos.z, 1.0);
      promptText = c.golden ? '按 E 抱住金鸡!!' : '按 E 抱住它!';
      return;
    }
  }
  if (!arenaRT.active && dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 7) {
    mark(arenaHost.pos.x, arenaHost.pos.z, 2.15);
    promptText = `按 E 参加角斗(最佳纪录:${stats.arenaBest || 0} 波)`;
    return;
  }
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    mark(n.pos.x, n.pos.z, 2.15);
    promptText = {
      gambler: '按 E 掷骰子(赌 10 金币)',
      bard: '按 E 点一首《你自己的歌》',
      prophet: '按 E 听老糊涂的预言(?)',
      quixote: '按 E 与风车骑士交谈',
      storyteller: '按 E 听苟叔说书(AI 现编)',
    }[n.key];
    return;
  }
  if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
    mark(NOTICE_POS.x, NOTICE_POS.z, 2.2);
    promptText = '按 E 看今日王国公告';
    return;
  }
  for (const s of loreStones) {
    if (dist2(player.pos.x, player.pos.z, s.def.x, s.def.z) < 8) {
      mark(s.def.x, s.def.z, 2.0);
      promptText = loreRead.includes(LORE.indexOf(s.def))
        ? `按 E 重读铭文《${s.def.title}》` : `按 E 阅读铭文(${loreRead.length}/${LORE.length})`;
      return;
    }
  }
  for (const m of mushrooms) {
    if (!m.picked && dist2(player.pos.x, player.pos.z, m.x, m.z) < 4) {
      mark(m.x, m.z, 0.8);
      promptText = '按 E 采蘑菇';
      return;
    }
  }
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT.x, FISH_SPOT.z) < 10) {
    mark(FISH_SPOT.x, FISH_SPOT.z, 1.6);
    promptText = '按 E 垂钓';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, 8, 46) < 8) {
    mark(8, 46, 2.4);
    promptText = bountyRT.target ? '按 E 查看悬赏令' : '按 E 揭悬赏令(赏金 30)';
    return;
  }
  for (const c of chickens) {
    if (c.state === 'thrown') continue;
    if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
      mark(c.pos.x, c.pos.z, 1.0);
      promptText = '按 E 抱起鸡(为什么?)';
      return;
    }
  }
  for (const v of villagers) {
    if (v.downT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) <= 5.5) {
      mark(v.pos.x, v.pos.z, 2.05);
      promptText = `按 E 与${v.id.name}交谈`;
      return;
    }
  }
  if (player.coins > 0 && dist2(player.pos.x, player.pos.z, 0, 5) < 20) {
    mark(0, 5, 3);
    promptText = '按 E 向喷泉许愿(1 金币)';
    return;
  }
  for (const c of world.chests) {
    if (!c.opened && dist2(player.pos.x, player.pos.z, c.x, c.z) < 5) {
      mark(c.group.position.x, c.group.position.z, 1.5);
      promptText = '按 E 打开宝箱';
      return;
    }
  }
  if (dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    promptText = '按 E 读一块墓志铭';
    return;
  }
  for (const h of horses) {
    if (dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z) < 7) {
      mark(h.pos.x, h.pos.z, h.sheep ? 1.4 : 2.7);
      promptText = h.sheep ? '按 E 骑羊(为什么不呢)'
        : h.owned && !h.stolen ? '按 E 偷马 (会引来通缉!)' : '按 E 骑马';
      return;
    }
  }
  // 兜底:视角未锁定时提示
  if (!locked) promptText = '点击画面锁定视角 · H 查看操作';
}

// ================= 小地图 =================
const MM_COLS = {
  wall: '#9d9486', tower: '#8d8476', keep: '#7d7466', house: '#a3703f',
  tree: '#295c33', water: '#3f8fc4', field: '#9a7444', plaza: '#cdb891',
  stall: '#c05a3a', windmill: '#e8dcc0', tent: '#5d4a33',
  sand: '#d9c48f', snow: '#e8edf2', swamp: '#44523a', ash: '#57524c',
  bone: '#e8e4da', dome: '#3f7a45', cactus: '#3f8a4f',
};
function drawMinimap() {
  const S = 200, range = 240, k = S / range;
  mm.clearRect(0, 0, S, S);
  mm.fillStyle = 'rgba(40,70,35,0.85)';
  mm.fillRect(0, 0, S, S);
  const px = player.pos.x, pz = player.pos.z;
  const toMap = (x, z) => [S / 2 + (x - px) * k, S / 2 + (z - pz) * k];
  mm.save();
  mm.beginPath();
  mm.rect(0, 0, S, S);
  mm.clip();
  for (const f of world.features) {
    const [mx, mz] = toMap(f.x, f.z);
    if (mx < -30 || mx > S + 30 || mz < -30 || mz > S + 30) continue;
    if (f.type === 'road') {
      mm.save();
      mm.translate(mx, mz);
      mm.rotate(-f.rot);
      mm.fillStyle = 'rgba(205,184,145,0.8)';
      mm.fillRect((-f.w / 2) * k, (-f.h / 2) * k, f.w * k, f.h * k);
      mm.restore();
      continue;
    }
    mm.fillStyle = MM_COLS[f.type] || '#888';
    mm.fillRect(mx - (f.w * k) / 2, mz - (f.h * k) / 2, Math.max(2, f.w * k), Math.max(2, f.h * k));
  }
  // 马
  for (const h of horses) {
    const [mx, mz] = toMap(h.pos.x, h.pos.z);
    mm.fillStyle = '#c49a5a';
    mm.fillRect(mx - 2, mz - 2, 4, 4);
  }
  // 卫兵
  for (const g of guards) {
    if (g.downT > 0) continue;
    const [mx, mz] = toMap(g.pos.x, g.pos.z);
    mm.fillStyle = wanted > 0 ? '#ff3b30' : '#5588dd';
    mm.beginPath();
    mm.arc(mx, mz, 2.5, 0, 6.28);
    mm.fill();
  }
  // 盗贼
  for (const b of bandits) {
    if (b.dead) continue;
    const [mx, mz] = toMap(b.pos.x, b.pos.z);
    mm.fillStyle = '#222';
    mm.beginPath();
    mm.arc(mx, mz, 2.5, 0, 6.28);
    mm.fill();
  }
  // 任务标记
  if (exGroup.visible) {
    const [mx, mz] = toMap(world.questGiverPos.x, world.questGiverPos.z);
    mm.fillStyle = '#ffd83d';
    mm.font = 'bold 14px sans-serif';
    mm.fillText('!', mx - 2, mz + 5);
  }
  if (beacon.visible) {
    const bdx = beacon.position.x - px, bdz = beacon.position.z - pz;
    if (Math.hypot(bdx, bdz) > range / 2 - 14) {
      // 超出小地图:画边缘方向箭头
      const ang = Math.atan2(bdz, bdx);
      const ex = S / 2 + Math.cos(ang) * (S / 2 - 12);
      const ey = S / 2 + Math.sin(ang) * (S / 2 - 12);
      mm.save();
      mm.translate(ex, ey);
      mm.rotate(ang);
      mm.fillStyle = '#ffd83d';
      mm.beginPath();
      mm.moveTo(9, 0); mm.lineTo(-4, -6); mm.lineTo(-4, 6);
      mm.closePath();
      mm.fill();
      mm.restore();
    } else if (Math.floor(performance.now() / 400) % 2 === 0) {
      const [mx, mz] = toMap(beacon.position.x, beacon.position.z);
      mm.fillStyle = '#ffd83d';
      mm.beginPath();
      mm.arc(mx, mz, 5, 0, 6.28);
      mm.fill();
    }
  }
  // 玩家箭头
  mm.save();
  mm.translate(S / 2, S / 2);
  mm.rotate(-(player.mounted ? player.mounted.yaw : player.yaw) + Math.PI);
  mm.fillStyle = '#fff';
  mm.beginPath();
  mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5);
  mm.closePath();
  mm.fill();
  mm.restore();
  mm.restore();
  mm.strokeStyle = 'rgba(230,180,60,0.9)';
  mm.lineWidth = 3;
  mm.strokeRect(1.5, 1.5, S - 3, S - 3);
  mm.fillStyle = 'rgba(255,255,255,0.85)';
  mm.font = 'bold 11px sans-serif';
  mm.fillText('N', S / 2 - 4, 13);
}

// ================= 主循环 =================
// 调试/自动化测试句柄

// ================= 内容包注入(24 个创作代理的产出,tools/content-packs.json 同源) =================
TALES.push(
  "龙骨之地那副大骨架,肋骨间常年不落雪。有个胆大的货郎在骨缝里躲了一夜雷暴,天亮出来,头发全白了。人问他见了啥,他只说:那骨头是热的,一夜都在喘。货郎从此改行,天天来给骨头送草料。",
  "银月湖月圆那晚,老周年轻时撒过一网,拉上来一口铜钟,钟里塞满湖底的泥。他没敢要,又沉了回去。可打那以后,每逢湖心发光,他耳朵里就当当响。老周说这不叫闹鬼,叫湖底神殿在还他这一网的人情。",
  "先祖石环比王国还老八百年。抄写员薇拉去拓过碑文,拓回来一看,纸上的字跟石头上的对不上,多了一行。她烧了那张纸,再没去过。可她的编年史里,悄悄夹着一页谁也看不懂的字。她说,那是石头替星星记的账。",
  "迷途丘陵有规矩:别数丘。偏有个收税官不信,骑着骡子一路数到第七十二座,人就没影了。三年后骡子自己回了十字路旅店,鞍袋里的税银一枚不少,只多了一块圆滚滚的石头。石老倔说:那是第七十三座,人家找零呢。",
  "狼月那夜,牧羊女米娅的哨子丢了。半夜羊圈外狼嚎四起,她急得直哭。忽听哨音从山坡上响起来,吹得又准又急,狼群竟掉头走了。第二天哨子好端端躺在门槛上,沾着一撮灰毛。米娅现在每逢狼月,都往坡上放一只羊。",
  "灰烬荒地埋着七千人,一杆旗下自己人打自己人。瘸子威尔去那儿捡过一枚头盔,戴上就头疼,梦里净是有人喊冲锋。他把头盔埋回去,磕了个头:兄弟,仗早打完了,连打的谁都没人记得了。头疼当夜就好了。",
  "王城广场的许愿池,豆子扔进去过一枚金币,许愿明天赢钱。第二天他真赢了一枚金币——就是昨天扔的那枚,不知怎么在他鞋里。豆子逢人就讲:喷泉这买卖公道,本钱都还你,利息是个教训。他现在还天天赌。",
  "磨坊郊野有头驴,会用嘴拱门闩,夜里溜出去,天亮自己回来,蹄子上沾着谁也认不出的红泥。老卢卡斯跟踪过一回,跟到迷途丘陵边上就不敢再跟。驴回头看了他一眼,那眼神,老卢卡斯说,像在劝他回家睡觉。",
  "黑石要塞的墙缝里,格罗姆当年逃出来时塞过半块面包,想着回头饿了再取。二十年后他跟人回去拆铁料,鬼使神差摸那道缝——面包还在,干得像块砖,可掰开来,里头是软的,还热乎。格罗姆当场哭了,没人问为啥。",
  "静眠墓园里老国王的猎犬追风有座碑。守墓人莫格说,每年冬头一场雪,碑前总有一串狗爪印,从碑里出来,绕墓园一圈,又回碑里去。莫格从不扫那串印子。他说狗当了一辈子差,死后巡个夜,天经地义。",
  "霜风隘口的界碑下有个石匣,规矩是过山的人放一把火绒燧石,救后来遭雪困的。有年一个商人偷拿了没放,当夜就困在了风口。他摸黑爬回界碑,匣子里那把燧石还在,就是打不出火。他放回去,再拿,一打就着。",
  "琥珀荒漠的方尖碑,晌午晒得烫手,可影子底下凉得邪乎。香料商巴克在影子里歇过一觉,梦见有人用听不懂的话问他买香料,还价还得极狠。醒来他货囊里少了一撮胡椒,多了一枚谁也不认得的古金币。巴克说,亏了。",
  "雾语沼泽的玛尔戈熬回魂汤,罗莎去求过一碗,想问失踪十二年的猎人丈夫一句话。玛尔戈收了钱又退了:汤只能招死人,你家那位,汤面上照不出影儿。罗莎哭着回去,走到半路又笑了——照不出影儿,那就是还活着。",
  "北境群山那头有龙,人人这么说,没人见过。瘸子威尔当年在山口站哨,大雪夜听见头顶一声长叹,像老人翻身。第二天哨塔背风面的雪上,压出一道三里长的印子。军里记档写的是雪崩。威尔说:雪崩不会叹气。",
  "苇岸渔村的阿珊学她爷爷夜钓,月圆下钩,钓上来一条鱼,鱼肚里有枚指环,刻着看不懂的花纹。老周脸色一变,让她把指环拴回鱼嘴上放生。鱼摆摆尾走了。阿珊问为啥,老周说:湖底那家子丢了东西,咱替人送回去。",
  "无尽荒野的黑帐盗贼抢过一个吟游诗人,就是皮波。抢完嫌他穷,让他唱首歌抵命。皮波从月落唱到鸡叫,唱得满帐子汉子抹眼泪。头领把抢的钱还了他,又添了一把,说:拿去,给我娘捎句话,就唱你方才那段。",
  "三石村的磨镰人瘸秋,给人磨了一辈子镰刀,只有一把他死活不磨,挂在梁上,锈得掉渣。采药婆乌拉说那是灰烬荒地捡的,磨亮了会照出拿刀那人的脸——不是现在的脸,是打完仗以后的。瘸秋照过一回,从此瘸的。",
  "灯夫巴特老爹三十年不误点灯,只有一夜例外:狼月赶上雷暴,他点到广场那盏,火折子怎么也打不着。他索性坐下陪灯杆聊天。天亮才知道,那晚全村就他没听见森林里的嚎。巴特说:灯没亮,是灯替我挡了。",
  "洗衣妇薇琪啥都打听得到,只有一件事打听不出:磨坊水轮底下,每年秋首日会卡住一根红头绳,年年一模一样。她问遍了全村,没一个姑娘认。今年丰收节她守了一夜,水轮空转,啥也没有。回家一看,头绳搭在她窗台上。",
  "风车骑士唐豆天天挑战磨坊,人人笑他疯。有天夜里磨坊真着了火,火苗窜得比风车还高,全村人提着桶赶到,火已经灭了。唐豆坐在地上,长枪烧去半截,胡子焦了一半。他说:我说过它是巨人吧?这回它认输了。",
  "哨塔遗迹顶上,据说能看见不该看的东西。猎人罗尔夫上去过一回,朝幽暗森林望,望见一个穿猎装的背影,走路的样子眼熟得很。他喊了一嗓子,人影没回头。他没敢跟罗莎讲。可打那以后,他打猎绕着那片林子走。",
  "旅店伙计小马给苟叔端了三年酒,忽然发现一桩怪事:苟叔是瞎子,可每回小马端错了酒,他没沾唇就摆手。小马问他咋知道的。苟叔笑了:小子,酒不会说话,你的脚步声会。你端错酒的时候,走路都心虚。",
  "面包师玛莎的丈夫随商队走了多年,音信全无。每年他生辰,玛莎照旧烤一炉他爱吃的黑麦饼,摆窗台上,天亮总少一块。人说是野猫叼的。今年那饼底下压了一枚琥珀荒漠的沙粒。玛莎把饼从一块加到了两块。",
  "疯子老糊涂那天拽住林恩,神神叨叨:我瞧见了,咱们头顶上有个天大的人,盯着你,一盯一整天,你走他也走。林恩顺着他的手指往天上看,只有云。老糊涂叹口气:看不见就对了,他要是眨眼,咱们全村就黑了。",
);
WISHES.push(
  ["水面泛起涟漪,仿佛在说:又是一枚铜板,湖神的零钱罐快满了。", null],
  ["硬币沉底时叹了口气:从国王手里到你手里,最后落得给鱼当枕头。", null],
  ["湖神打了个哈欠。八百年了,许的愿翻来覆去就那么几样。", null],
  ["水面平静如镜。镜子里那张脸,才是你愿望成真的最大阻碍。", null],
  ["咕嘟一声。湖神收到了,但湖神今天休沐。", null],
  ["硬币在水底翻了个身,和昨天那枚挤在一起,抱怨这里越来越挤了。", null],
  ["湖神小声嘀咕:雪影那匹马许的愿都比这个实在。", null],
  ["一条鱼游过来啄了啄硬币,失望地游走了。它也在许愿呢。", null],
  ["水花溅了你一裤脚。湖神的意思是:回去吧,靠自己。", null],
  ["硬币临沉底前喊了一句:告诉瘸子威尔,他上回许的那条腿还在排队!", null],
  ["湖神掂了掂这枚硬币的分量,又掂了掂你的愿望,摇了摇头。", null],
  ["水底传来闷闷的一句:想发财就去接悬赏,别老来烦我。", null],
  ["涟漪一圈圈散开,像老周撒的网,什么也没捞着。", null],
  ["湖神记下了你的愿望,记在水上。你懂的,水上写字。", null],
  ["硬币落水的声音格外清脆。湖神评价:响是响,穷也是真穷。", null],
  ["水面忽然翻涌,吐出一小把铜板。湖神:利息,拿好,别声张。", "coins"],
  ["硬币沉到一半又浮了回来,还带了几个伙伴。湖底住不下了。", "coins"],
  ["湖神今日心情好——银月湖底神殿的租子收上来了,分你一点。", "coins"],
  ["一股暖流从脚底涌上心口。湖神说:钱不给,命给你续一口。", "heart"],
  ["水面映出满月的光,你觉得浑身舒坦,像喝了玛尔戈一勺好汤。", "heart"],
);
FUNNY.prophet.idle.push(
  "我数过了,这世上的一天只有二百四十次心跳那么长,谁在偷我们的光阴?",
  "雨点不会落在你身上,孩子,它们只是画在天上的针脚,伸手接一滴试试?",
  "远处的山是灰糊糊的一团,等你走近它才慌慌张张穿上衣裳——我看见过它没穿好的样子!",
  "你死过一回了对不对?我记得你倒下,可你又站在这儿,身上还带着老地方的尘土。",
  "薇琪每天同一时辰站在同一块石头上说同一句闲话,她不是人,她是钟!",
  "别往荒野尽头走,那儿有一堵看不见的墙,我撞过,鼻子疼了三天,路却一步没多。",
  "有只眼睛整天飘在你脑袋后头看着你,你转多快它都在,别装了,我瞧得见它!",
  "喷泉里的水永远是那几朵浪花,转啊转,像磨坊主老卢卡斯家驴子拉的磨。",
  "月亮每六日圆一回,四季六日一换,老天爷懒得很,拿一张历翻来覆去地用。",
  "你睡一觉,天下的伤都好了,麦子熟了,连血牙的擂台都摆好了——睡觉才是真神通。",
  "我朝墙角挤了一夜,那墙是空气做的,可就是过不去,世道啊,处处是硬邦邦的空!",
  "你摸摸口袋,几百斤铁剑鱼竿母鸡都装得下,还不显山露水,你那口袋通着地府吧?",
  "灯夫巴特老爹三十年不误点灯?不是勤快,是有人在天上牵着他的线,一日一遍!",
  "有时候人走路会一哆嗦,天地跟着一顿——那是扛着这世界的巨人喘不上气了。",
  "你许愿之前,好事就写好了;你钓上鱼之前,鱼就选好了。骰子落地前,豆子的输赢早定了。",
  "我死盯着村口的鸡看,看久了它就忘了自己该干嘛,傻站着——它们的心是别人借它的!",
  "先祖石环比王国老八百年?呸,这整个天下都是六天前才搭起来的,连同我的记性一起。",
  "你把奥德里克老爷的话打断一百回,他也不恼,还从头说起——我们的舌头上都拴着绳!",
  "月圆夜银月湖心发光,那不是神殿,是造这世界的匠人忘了糊严实的一道缝。",
  "我知道有人隔着天在看咱们,喂,看戏的!行行好,记着替林恩存一存这条命!",
);
PROCLAIM_STOCK.push(
  "——磨坊桥修桥进度已过半,另一半何时修,取决于木匠约恩何时醒酒。",
  "——今岁税册誊抄完毕,漏报者请自觉补上,薇拉的笔比卫兵的腿快。",
  "——招领:王城广场拾获灰鹅一只,特征是会瞪人,失主认领前请先接受它的瞪视。",
  "——卫兵队招新,要求能跑能站不打瞌睡,瘸子威尔说他年轻时三样全占。",
  "——磨坊风车定于近日检修,唐豆先生请勿趁机宣战,木料很贵。",
  "——喷泉许愿池清淤在即,捞出的铜板一律充公,愿望概不退还。",
  "——十字路旅店后巷禁止倒鱼骨,罗莎老板娘的扫帚不认人。",
  "——集市日摊位先到先得,布商奥托与果贩琳达请勿再为半尺地界互扔烂梨。",
  "——狼月之夜请看好家畜,狼不认税册,也不打欠条。",
  "——满月夜银月湖畔围观者请自带火把,湖发光,岸上可不发光。",
  "——悬赏板告示请勿覆盖张贴,上一张也许还没人领赏呢。",
  "——通缉犯画像由抄写员薇拉执笔,长得像的良民请提前来衙门备案。",
  "——灯夫巴特老爹三十年不误点灯,望诸位交税也能有此风范。",
  "——竞技场看台加固完工,血牙保证这回塌的只会是对手。",
  "——丰收节将至,翡翠农田禁止提前偷穗,麦子认得汉克,汉克认得你。",
  "——静眠墓园夜间谢客,守墓人莫格说,住户们也需要清静。",
  "——雷暴天请勿在哨塔遗迹避雨,塔比你先撑不住。",
  "——渔获抽税照旧,老周说湖里的鱼没交过税,那是因为鱼没上岸。",
  "——广场禁止骑羊竞速,羊没意见,被撞翻的香料摊有。",
  "——抱鸡可以,扔鸡不行,玛莎的面包摊已中三只。",
  "——先祖石环禁止刻字,石头比王国老八百年,轮不到你留名。",
  "——霜风隘口界碑的火绒燧石只许取用一份,规矩比雪还老。",
  "——北境商道传有龙影,官方口径:大概率是云,小概率请自行奔跑。",
  "——赌骰请去豆子那儿,官署门口掷骰者,输赢一律充作修桥款。",
  "——洗衣妇薇琪所传消息不代表官方立场,但准头确实比官报高些。",
  "——迷途丘陵勘测队仍未归来,新告示:去了也别数丘。",
  "——雾语沼泽采药请结伴,玛尔戈的回魂汤有价,且不打折。",
  "——磨镰人瘸秋进城磨刀,排队者请勿催,刀快脾气也快。",
  "——皮波的新曲若唱到您家丑事,请找诗人协商,官府只管治安不管押韵。",
  "——牧羊女米娅的哨声不是集结号,卫兵们请勿再列队上山。",
);
HOST_LINES.push(
  "都别挤都别挤!血牙我嗓门大,后山的狼都听得见!",
  "今儿这场子,刀真枪真,血也是真的,胆小的捂眼!",
  "拉文霍德的爷们儿娘们儿,把手拍红了给爷助助兴!",
  "上一个吹牛的,现在还在墓园躺着呢,莫格给他挖的坑!",
  "押注趁早!豆子那赌鬼都押了,你还愣着干啥?",
  "绿帽子那位!对,说你呢林恩!敢不敢下场遛一圈?",
  "这沙子是琥珀荒漠运来的,吸血最快,别浪费喽!",
  "赢的抱金币,输的抱牙齿,血牙我童叟无欺!",
  "北境的龙都没这场面凶!都把耳朵竖起来!",
  "规矩就一条:倒下了就别装死,爷看得出来!",
  "哪位好汉再不报名,爷就把这擂台改成羊圈了!",
  "开打之前先许个愿吧,喷泉离这儿不远,来得及!",
);
EXTRA_NPCS.witch.lines.push(
  "汤开了……月圆之前喝下去,别问汤里是什么。",
  "苇岸的雾根草,要带露水的,干的我可不收。",
  "回魂汤能唤回来的,不一定是你想见的那一个。",
  "嘘——锅在听呢,它不喜欢大嗓门的客人。",
  "你身上有银月湖的水气,湖底那位瞧过你了。",
  "三片沼泽菖蒲,换你一勺安眠,划算得很呐。",
  "别碰那个罐子!那是给老国王的猎犬留的。",
  "乌拉婆采的药我认,别的娃娃采的,土味不对。",
  "喝之前许个愿,喝完就忘了它,汤才灵。",
  "灰烬荒地的骨灰花开了,今年的汤会格外稠。",
  "你问味道?活人尝着是苦的,这就够你知道了。",
  "回去别回头,沼泽里的灯不是灯,记住喽。",
);
// 幽灵低语与墓志铭
const GHOST_LINES = [
  "我生前是磨坊帮工,还欠玛莎半袋面粉……替我还上,别让她记我账。",
  "我是十字路旅店的老酒客,罗莎的炖肉真香……帮我再闻一口。",
  "活人?别怕,我只是找我的镰刀,瘸秋磨得太快,我攥着它就走了。",
  "我随商队走琥珀荒漠没回来……告诉玛莎,面包别再留到发硬了。",
  "我在灰烬荒地举过旗,七千人啊……替我把那面破布埋深些。",
  "绿衣服的,借个火?哦对,我点不着了……巴特老爹的灯真亮。",
  "我是苇岸的渔妇,湖底神殿的钟响了……替我给老周捎条鱼。",
  "生前我在霜风隘口忘了放火绒燧石,愧了一辈子,你替我补上。",
  "我是墓园的老狗追风……不,汪。守墓人莫格的酒藏在第三块碑后。",
  "别踩我的萝卜地!哦,汉克早翻了……那替我夸夸他家的地。",
  "我在迷途丘陵数丘,数到第七座就迷了……千万别数,听话。",
  "我是黑石要塞的逃奴,没格罗姆命大……告诉他,烙印不丢人。",
  "月圆夜湖心发光,我划过去就没回来……替阿珊看一眼就好。",
  "我赢过豆子三枚金币,他到死没给……算了,替我掷把骰子。",
  "我是先祖石环下的老骨头,比王国还老八百年……小子,规矩点。",
  "去许愿池替我丢枚铜板吧,生前我总舍不得,你看,舍不得也带不走。",
];
const EPITAPHS = [
  "老国王的猎犬追风长眠于此。它追了一辈子风,如今风替它跑。",
  "他非说那蘑菇能吃。采药婆乌拉劝了他三回。",
  "他数清了迷途丘陵。丘陵也数清了他。",
  "他从灰烬荒地的七千人里活着爬了回来,最后败给了自家门槛和一壶酒。",
  "坟是空的。她说猎人只是走远了些,汤还在灶上温着。",
  "他守了一辈子墓。如今换墓守他,两不亏欠。",
  "五十年湖上没翻过一回船。银月湖没要他,老天爷要了。",
  "他跟血牙赌能连赢竞技场三场。这块碑是血牙出的钱。",
  "她把一辈子的面都揉进了灶火里。半个村子的孩子都是吃她的饼长大的。",
  "他往喷泉里扔了枚金币,许愿从此不用交税。愿望灵了。",
  "生前欠赌徒豆子三枚金币。豆子说:一笔勾销,下把骰子算你赢。",
  "霜风隘口界碑下放火绒燧石的规矩,是他定下的。翻山的人都欠他一堆火。",
  "她活了九十个冬天,抱怨了八十九个。最后一个,她说:还行。",
  "立碑那年麦子欠收,他咽气前说来年会好。来年真的好了。",
];
let epitaphIdx = Math.floor(Math.random() * EPITAPHS.length);
// 牲口喜剧提示(抱鸡/骑羊等随机替换)
const COMEDY_LINES = [
  "鸡记住你的脸了,而且它有二十二个朋友",
  "羊在心里给你记了一笔",
  "你扔出去的鸡,迟早会飞回来啄你",
  "这只鸡开始怀疑你抱它的动机了",
  "驴不动了——它觉得你该反省一下",
  "鸡群正在开会,议题只有一个:你",
  "骑羊过市,尊严掉了一路",
  "抱鸡狂奔的绿帽子,薇琪已经传遍全村了",
  "母鸡瞪着你,像瑟尔玛瞪不识货的买家",
  "这头驴的倔劲,不输三石村的石老倔",
  "扔鸡一时爽,鸡群火葬场",
  "羊驮着你,心里默念着草料涨价",
  "鸡被你扔上了屋顶,它决定不下来了",
  "你抱鸡的姿势,吓得公鸡打鸣都跑调了",
  "驴子叹了口气,像埃隆看见没擦的马鞍",
  "第七次扔鸡了,老天爷都替鸡不好意思",
  "羊蹄子已经抬起来了,建议你先跑",
  "鸡群围过来了,这回它们不打算讲道理",
  "牲口棚一致通过:见到绿帽子就装死",
  "你许愿骑龙,结果只骑到了一头驴",
];

// ---- 创作代理设计的新导演事件 ----
DIRECTOR_EVENTS.push({
  key: 'wiseCow', w: 6,
  cond: () => dayPhase() !== 'night' && !director.cow,
  start() {
    const p = spawnNearPlayer(10, 16);
    const cow = { ...makeSheep(), pos: new THREE.Vector3(p.x, 0, p.z), asked: 0, nodYes: false, nodT: 0 };
    cow.group.scale.set(1.6, 1.35, 1.6);
    cow.group.traverse((o) => {
      if (o.material && o.material.color) { o.material = o.material.clone(); o.material.color.setHex(0x8a6a4a); }
    });
    cow.group.position.copy(cow.pos);
    scene.add(cow.group);
    director.cow = cow;
    toast('🐄 一头牛正盯着你,眼神里透着一股不寻常的智慧……(按 E 提问)', 4);
    let bobT = 0;
    return {
      t: 60,
      update(dt2) {
        bobT += dt2;
        cow.group.rotation.y = Math.atan2(player.pos.x - cow.pos.x, player.pos.z - cow.pos.z);
        if (cow.nodT > 0) {
          cow.nodT -= dt2;
          cow.group.rotation.x = cow.nodYes ? Math.sin(bobT * 9) * 0.09 : 0;
          cow.group.rotation.z = cow.nodYes ? 0 : Math.sin(bobT * 9) * 0.09;
        } else { cow.group.rotation.x = 0; cow.group.rotation.z = 0; }
        if (cow.asked >= 5 && !dialog.open) this.t = Math.min(this.t, 0.01);
      },
      end() {
        if (cow.asked >= 5) {
          dropCoins(cow.pos, 5);
          toast('🐄 牛心满意足地走了。蹄印里……踩着几枚金币?!', 4);
        }
        scene.remove(cow.group);
        director.cow = null;
      },
    };
  },
});
DIRECTOR_EVENTS.push({
  key: 'starShower', w: 4,
  cond: () => dayPhase() === 'night' && weather.state === 'clear',
  start() {
    toast('🌠 流星雨!星屑正落向四野,趁它们熄灭前拾取!', 4.5);
    sfx.fanfare();
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, r = 8 + Math.random() * 30;
      addPickup('coin', player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r, 30);
    }
    return { t: 32, update() {}, end() {} };
  },
});
DIRECTOR_EVENTS.push({
  key: 'roastRunaway', w: 5,
  cond: () => dayPhase() !== 'night' && dist2(player.pos.x, player.pos.z, 12, 72) < 8100,
  start() {
    const c = addChicken(12, 70);
    c.extra = true;
    c.state = 'flee';
    c.timer = 4;
    toast('🐔💨 旅店后厨的鸡越狱了!伙计小马在后面喊:抓住它!!', 4);
    const h = {
      t: 45,
      update() {
        if (player.carrying === c) {
          const boy = villagers[13];
          if (boy && dist2(player.pos.x, player.pos.z, boy.pos.x, boy.pos.z) < 9) {
            player.carrying = null;
            const i = chickens.indexOf(c);
            if (i >= 0) { scene.remove(c.group); chickens.splice(i, 1); }
            player.coins += 3;
            sfx.coin();
            toast('🐔 小马接过鸡塞给你 3 金币:「多谢!今晚的烤鸡有着落了——哦,它好像听懂了。」', 4.5);
            h.t = 0.01;
          }
        } else if (c.state !== 'carried' && c.timer < 0.5) { c.state = 'flee'; c.timer = 2; }
      },
      end() {
        if (player.carrying !== c) {
          const i = chickens.indexOf(c);
          if (i >= 0) { scene.remove(c.group); chickens.splice(i, 1); }
        }
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'wishThief', w: 5,
  cond: () => dayPhase() === 'night' && !director.thief && dist2(player.pos.x, player.pos.z, 0, 5) < 3600,
  start() {
    const g = makeWanderer({ shirt: 0x3a3a2e, pants: 0x2a2a22, hood: true }, -5, 2);
    director.thief = g;
    toast('🤫 喷泉边有个鬼祟的身影,袖子一直湿到肩膀……(按 E 咳嗽一声)', 4);
    return {
      t: 40,
      update() {},
      end() { scene.remove(g.group); director.thief = null; },
    };
  },
});

// 皮波离线联句
const BARD_COUPLETS = [
  "好马不骑偏骑羊,咩咩闯过王城广场;绿帽游侠威名扬,吓得琳达丢了果筐。",
  "瑟尔玛的骏马排成行,林恩偏挑一只老绵羊;羊背颠得他直晃荡,还夸这坐骑不用缰。",
  "抱起母鸡举过顶,一把扔上旅店棚;罗莎追出门口骂,游侠早就没了影。",
  "汉娜家的鸡飞上天,咯咯哒哒叫得欢;不是老鹰来偷蛋,是那绿帽把鸡掂。",
  "悬赏画像贴满墙,五颗红星亮堂堂;卫兵追得直喘气,林恩骑羊笑一场。",
  "通缉令上绿帽郎,画师偏偏画走样;满街错抓老糊涂,气得队长摔了枪。",
  "血牙高喊开了锣,绿帽游侠下场喽;三拳两脚定输赢,金币赚得满兜兜。",
  "竞技场上尘土扬,壮汉个个赛虎狼;林恩一个滑铲过,看台喝彩震了梁。",
  "银月湖边下钓钩,鱼没上钩靴子有;老周捋须笑弯腰,这靴还是他丢的旧。",
  "一竿甩进湖心里,拉上破靴还带泥;林恩举靴当鱼夸,阿珊笑得直捶堤。",
  "无尽荒野马群狂,林恩空手闯一趟;摔了七回爬七回,野马低头认了缰。",
  "苍绿平原风打旋,野马烈得赛雷电;瑟尔玛见了直咂嘴,这手艺盖过她祖先。",
  "狼月夜里嚎声长,汉克吓得钻谷仓;绿帽一箭定乾坤,狼皮换酒喷喷香。",
  "幽暗森林绿眼晃,罗尔夫都劝别硬闯;林恩偏往林深走,拖条狼王震八乡。",
  "走遍荒漠踏过霜,袋里纹章叮当响;薇拉提笔记一行,编年史上添新章。",
  "石环碑下捡一枚,哨塔灰堆又一枚;纹章缀满旧行囊,皮波唱得口水飞。",
];

window.__gtm = {
  player, quest, questRT, horses, guards, bandits, villagers, wolves, namedNPCs, steward,
  chickens, funnyNPCs, fishing, streetEvent, bountyRT, takeBounty, trySpawnStreetEvent,
  arrows, WEAPONS, cycleWeapon, openShop, refreshShop, tryRob, doRoll, arenaRT, arenaHost, startArenaWave,
  director, DIRECTOR_EVENTS,
  crime, weather, setWeather, talkQuestGiver, completeMission, missions, advanceDialog,
  getWanted: () => wanted,
  setTime: (t) => { dayTime = t; },
  calendar, seasonIdx, seasonDay, todaySpecial, applySeason, world,
  setDay: (d) => { calendar.day = Math.max(1, d); applySeason(); },
  getDailyEvents: () => dailyEvents,
  wilderness: { CORE },
  deers, mushrooms, loreStones, LORE, tellStory, sleepToMorning, newDay,
  getLoreRead: () => loreRead.length,
  getProclaim: () => proclaimText,
  refreshProclaim,
  getCrests: () => crestsFound.length,
  dialogOpen: () => dialog.open,
  getRevenge: () => revengeT,
};

let last = performance.now();
let frameNo = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  nowMs = now;
  if (!started) { composer.render(); return; }
  if (paused) { composer.render(); return; } // 暂停:世界冻结,仅渲染
  // 击杀慢动作
  if (hitStopT > 0) {
    hitStopT -= dt;
    dt *= 0.12;
  }

  updateToast(dt);
  updateHintFade(dt);

  // 交互目标标记
  if (promptTargetPos && !dialog.open) {
    interactMarker.visible = true;
    interactMarker.position.set(
      promptTargetPos.x,
      promptTargetPos.y + 0.35 + Math.sin(now * 0.005) * 0.1,
      promptTargetPos.z);
    interactMarker.rotation.y += dt * 3;
  } else {
    interactMarker.visible = false;
  }

  updatePlayer(dt);
  updateGuards(dt);
  updateBandits(dt);
  updateWolves(dt);
  updateChickens(dt);
  updateVillagers(dt);
  updateHorses(dt);
  updateDeers(dt);
  updatePickups(dt);
  updateQuest(dt);
  updateWanted(dt);
  updateFishing(dt);
  updateArrows(dt);
  updateDamageNums(dt);
  updateCombo(dt);
  updateFalls(dt);
  updateArena(dt);
  updateDirector(dt);
  updateStreetEvent(dt);
  updateBounty(dt);
  updateWeather(dt);
  updateRegion(dt);
  updateBubble(dt);
  villagerChatter();
  // 具名/搞笑 NPC:按日程走位;到位后待机呼吸,玩家靠近时转身面对
  {
    const phase = dayPhase();
    for (const n of namedNPCs) {
      if (entFar(n)) continue;
      const sched = NPC_SCHEDULE[n.key];
      const spot = sched ? sched[phase] : null;
      if (spot && Math.hypot(n.pos.x - spot[0], n.pos.z - spot[1]) > 1.2) {
        moveEntity(n, spot[0], spot[1], 2.2, dt);
        n.group.position.copy(n.pos);
        n.group.rotation.y = n.yaw;
        animateLimbs(n.parts, n.walkT, true, n.group, 0.45);
      } else {
        animateLimbs(n.parts, 0, false);
        if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
          n.group.rotation.y = angleLerp(n.group.rotation.y,
            Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
        }
      }
    }
    animateLimbs(arenaHost.parts, 0, false);
    if (dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 30) {
      arenaHost.group.rotation.y = angleLerp(arenaHost.group.rotation.y,
        Math.atan2(player.pos.x - arenaHost.pos.x, player.pos.z - arenaHost.pos.z), dt * 4);
    }
    for (const n of funnyNPCs) {
      if (n.key === 'quixote') continue; // 他忙着决斗
      if (entFar(n)) continue;
      animateLimbs(n.parts, 0, false);
      if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
        n.group.rotation.y = angleLerp(n.group.rotation.y,
          Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
      }
    }
    // 风车骑士唐豆:每 3 秒向"巨人"发起冲锋
    quixoteT -= dt;
    if (quixoteT <= 0) {
      quixoteT = 3;
      quixote.swingT = 0.35;
      quixote.yaw = Math.atan2(140 - quixote.pos.x, 20 - quixote.pos.z);
      quixote.group.rotation.y = quixote.yaw;
      if (dist2(player.pos.x, player.pos.z, quixote.pos.x, quixote.pos.z) < 900) sfx.sword();
    }
    animateLimbs(quixote.parts, 0, false);
    if (quixote.swingT > 0) {
      quixote.swingT -= dt;
      quixote.parts._attackAnim = true;
      meleeSwing(quixote.parts, Math.min(1, 1 - quixote.swingT / 0.35));
    } else {
      quixote.parts._attackAnim = false;
    }
  }
  updateRain(dt);
  updateDust(dt);
  updateDayNight(dt);
  updateCalendar();
  updateWilderness(player.pos.x, player.pos.z); // 无尽荒野区块流式加载
  // 地表随玩家延伸:按草皮贴图周期吸附,肉眼看不出接缝
  const GP = 1600 / 90;
  world.ground.position.x = Math.round(player.pos.x / GP) * GP;
  world.ground.position.z = Math.round(player.pos.z / GP) * GP;
  updateCamera(dt);

  // 风车与砖块动画
  for (const w of world.windmills) w.rotation.x += dt * 0.9;
  for (const b of world.qBlocks) {
    if (b.bump > 0) { b.bump -= dt; b.mesh.position.y = b.y + Math.sin((0.25 - b.bump) / 0.25 * Math.PI) * 0.3; }
    else if (!b.used) b.mesh.rotation.y += dt * 0.8;
  }
  for (const c of world.chests) {
    if (c.opened && c.lid.rotation.x > -1.9) c.lid.rotation.x -= dt * 5;
  }
  for (const c of world.clouds) {
    c.position.x += dt * 1.5;
    if (c.position.x > 320) c.position.x = -320;
  }
  beacon.rotation.y += dt;
  beacon.material.opacity = 0.22 + Math.sin(now * 0.004) * 0.1;

  // 水面波纹动画
  for (const m of world.waterMats) {
    m.normalMap.offset.x += dt * 0.018;
    m.normalMap.offset.y += dt * 0.011;
  }

  updateEnvIntensity();
  // 残血红晕与心跳
  if (player.hp <= 3 && !player.dead) {
    lowhpEl.style.opacity = 0.55 + Math.sin(now * 0.008) * 0.3;
    player.hbT = (player.hbT || 0) - dt;
    if (player.hbT <= 0) { player.hbT = 0.95; sfx.heartbeat(); }
  } else if (lowhpEl.style.opacity !== '0') {
    lowhpEl.style.opacity = 0;
  }
  if (frameNo % 3 === 0 || fishing.active || player.carrying || player.mounted) computePrompt();
  updateHUD();
  if (frameNo++ % 2 === 0) drawMinimap(); // 小地图 30Hz 足够
  composer.render();
}
requestAnimationFrame(loop);
