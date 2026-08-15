// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, makeHorse, makeWolf, makeChicken, makeSheep, resolveCollisions, angleLerp, dist2, lambert, setHumanModel, setFaunaModel, setWeaponModels, getWeaponModel } from './entities.js';
import { INTRO, REGIONS, GUARD_LINES, NPCS, MISSIONS, VILLAGERS, DIALOGS, TIME_GREETINGS, LORE } from './story.js';
import { initAudio, sfx, startMusic, toggleMusic, weatherAudio, setAmbience, setCombatMusic } from './audio.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
import { initWilderness, updateWilderness, wildRegionName, CORE } from './wilderness.js';
import * as BANKS from './dialogue-banks.js';
import { ShaderPass } from '../lib/jsm/postprocessing/ShaderPass.js';
import { GLTFLoader } from '../lib/jsm/loaders/GLTFLoader.js';
import { setTreeModel, setBuildingModel, setRockGeos } from './flora.js';
import { MODELS_B64 } from './models-data.js';
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
scene.fog = new THREE.Fog(0x99a8b2, 90, 390); // 北境雾:灰蓝厚重,远山半隐在大气里

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
// 参数化电影调色:对比/饱和/分离色调/暗角/胶片颗粒/怀旧褪色——画风预设的载体
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.07 },
    uSat: { value: 1.16 },
    uLift: { value: 0.0 },
    uSplit: { value: new THREE.Vector3(0.04, 0.014, -0.04) },
    uVig: { value: 0.18 },
    uGrain: { value: 0.0 },
    uSepia: { value: 0.0 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uContrast, uSat, uLift, uVig, uGrain, uSepia, uTime;
    uniform vec3 uSplit;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - 0.5) * uContrast + 0.5 + uLift;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col += (l - 0.5) * uSplit;
      // 怀旧褪色(sepia)
      vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)),
                      dot(col, vec3(0.349, 0.686, 0.168)),
                      dot(col, vec3(0.272, 0.534, 0.131)));
      col = mix(col, sep, uSepia);
      // 暗角
      float d = distance(vUv, vec2(0.5));
      col *= 1.0 - uVig * smoothstep(0.32, 0.86, d);
      // 胶片颗粒
      float n = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += n * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
});
// ---- 画风预设:油画(默认)/ 电影 / 动画 / 复古,一键切换、独立持久化 ----
const STYLE_PRESETS = {
  nordic: { name: '天际', contrast: 1.14, sat: 0.8, lift: -0.008, split: [0.028, 0.01, -0.05], vig: 0.26, grain: 0.02, sepia: 0, bloom: 0.24, exposure: 0.98 },
  oil:    { name: '油画', contrast: 1.07, sat: 1.16, lift: 0, split: [0.04, 0.014, -0.04], vig: 0.18, grain: 0, sepia: 0, bloom: 0.32, exposure: 1.0 },
  film:   { name: '电影', contrast: 1.15, sat: 1.02, lift: -0.012, split: [0.065, 0.012, -0.06], vig: 0.34, grain: 0.028, sepia: 0, bloom: 0.26, exposure: 1.04 },
  anime:  { name: '动画', contrast: 1.03, sat: 1.36, lift: 0.03, split: [0.02, 0.012, -0.015], vig: 0.08, grain: 0, sepia: 0, bloom: 0.46, exposure: 1.07 },
  retro:  { name: '复古', contrast: 1.08, sat: 0.82, lift: 0.01, split: [0.03, 0.01, -0.02], vig: 0.42, grain: 0.06, sepia: 0.45, bloom: 0.2, exposure: 0.97 },
};
const STYLE_ORDER = ['nordic', 'oil', 'film', 'anime', 'retro'];
let styleKey = 'nordic';
try { if (STYLE_PRESETS[localStorage.getItem('gth-style')]) styleKey = localStorage.getItem('gth-style'); } catch { /* 隐私模式 */ }
function applyStyle(key) {
  const p = STYLE_PRESETS[key];
  if (!p) return;
  styleKey = key;
  const u = gradePass.uniforms;
  u.uContrast.value = p.contrast;
  u.uSat.value = p.sat;
  u.uLift.value = p.lift;
  u.uSplit.value.set(...p.split);
  u.uVig.value = p.vig;
  u.uGrain.value = p.grain;
  u.uSepia.value = p.sepia;
  bloom.strength = p.bloom;
  renderer.toneMappingExposure = p.exposure;
  styleExp = p.exposure;          // 昼夜循环每帧重算曝光/泛光,预设作为基准乘子参与
  styleBloomMul = p.bloom / 0.32;
  try { localStorage.setItem('gth-style', key); } catch { /* 隐私模式 */ }
}
let styleExp = 1, styleBloomMul = 1;
function cycleStyle() {
  const next = STYLE_ORDER[(STYLE_ORDER.indexOf(styleKey) + 1) % STYLE_ORDER.length];
  applyStyle(next);
  return STYLE_PRESETS[next].name;
}
applyStyle(styleKey); // 上次选的画风,开局就生效
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
const hemi = new THREE.HemisphereLight(0xb4c4d4, 0x5e6355, 0.7); // 冷天光,暖不起来的北方
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
// 随身提灯:夜里跟着玩家的一团暖光(强度在 updateDayNight 里按夜色调)
const lantern = new THREE.PointLight(0xffd9a0, 0, 17, 1.6);
scene.add(lantern);

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
// Blender 资产工厂:解析内嵌 GLB 树模板,建世界前注入 flora(失败则静默回退程序化树)
try {
  const gltfLoader = new GLTFLoader();
  const b64buf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  await Promise.all(Object.entries(MODELS_B64).map(([kind, b64]) =>
    new Promise((res) => gltfLoader.parse(b64buf(b64), '', (gltf) => {
      if (kind === 'human') setHumanModel(gltf.scene);
      else if (kind === 'horse' || kind === 'wolf') setFaunaModel(kind, gltf.scene);
      else if (kind === 'weapons') setWeaponModels(gltf.scene);
      else if (kind === 'props') {
        const st = gltf.scene.getObjectByName('Stall');
        const br = gltf.scene.getObjectByName('Barrel');
        if (st) setBuildingModel('stall', st);
        if (br) setBuildingModel('barrel', br);
      } else if (kind === 'house' || kind === 'keep') setBuildingModel(kind, gltf.scene);
      else if (kind === 'rocks') {
        const geos = [];
        gltf.scene.traverse((o) => { if (o.isMesh) geos.push(o.geometry); });
        setRockGeos(geos);
      } else setTreeModel(kind, gltf.scene);
      res();
    }, () => res()))));
} catch (e) { console.warn('树模型解析失败,回退程序化树:', e); }
// 本地标题键艺术优先(assets/ai/title.jpg,可选)
let localTitleArt = false;
if (location.protocol !== 'file:') fetch('./assets/ai/title.jpg').then((r) => {
  if (r.ok) r.blob().then((b) => {
    localTitleArt = true;
    const t = document.getElementById('title');
    t.style.backgroundImage =
      `linear-gradient(rgba(10,6,20,0.55), rgba(10,6,20,0.75)), url(${URL.createObjectURL(b)})`;
    t.style.backgroundSize = 'cover';
    t.style.backgroundPosition = 'center';
  });
}).catch(() => {});

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
const vistaFar = vistaRing(360, 74, 1.7, 0x76858f);  // 远脊:几乎溶进雾里
const vistaNear = vistaRing(300, 52, 4.9, 0x67757f); // 近脊:略深一层,错峰出剪影

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
  bosshpEl = $('bosshp'), bosshpFillEl = $('bosshp-fill'),
  staminaEl = $('stamina'), staminaFillEl = $('stamina-fill');

// 顶部细条通知:队列化,一次一条,不遮挡视野
let toastTimer = 0; // >0 显示中,<0 淡出间隔
const toastQueue = [];
function toast(msg, dur = 2.6) {
  toastQueue.push([msg, Math.min(dur, 4)]);
}
// 插队播报:教学这种时效信息不排队,直接顶到最前并催场
function toastNow(msg, dur = 3) {
  toastQueue.unshift([msg, Math.min(dur, 4)]);
  if (toastTimer > 0.4) toastTimer = 0.4; // 正在播的加速谢幕
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
  sta: 100, maxSta: 100, gaspT: 0, staggerT: 0, // 体力(骑砍核心):出手/翻滚/格挡皆有代价

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
const villagerHair = [0x3a2a1a, 0x6a4a2a, 0x8a3a1a, 0x2a1a10, 0xbababa, 0x1a1a14, 0xd0b040];
VILLAGERS.forEach((id, i) => {
  const v = { ...makeHumanoid({
    shirt: villagerColors[i % villagerColors.length], pants: 0x50412e,
    hair: villagerHair[i % villagerHair.length],
    cap: [2, 6, 7, 13, 15, 17, 19].includes(i),   // 果贩/农夫/农妇/伙计/渔家女/磨坊主/村长:布帽
    hood: [8, 18, 21].includes(i),                 // 猎人/守墓人/采药婆:兜帽
  }),
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
// ================= 内容自进化:传说 × 生态 × 导演 =================
// 游戏内容自己长:你的事迹像谣言一样代代变异(文化演化);狼群在猎杀压力下
// 一代比一代精(生态演化);事件导演按你真正参与过什么自然选择戏码(排片演化)。
// 全部随存档持久化——这个世界离开你也在长,回来时已不是你走时的样子。
const EVO = {
  legends: [],                 // 传说基因池:{src, base, extra, gen, heat}
  wolfGen: 1, wolfPressure: 0, wolfSpeed: 0, // 狼群世代/猎杀压力/累计提速
  eventFit: {},                // 导演事件适应度:参与 +1,冷场 -0.3
  tactics: { block: 0, dodge: 0 }, // 敌人战术演化:被砍多了学格挡,被射多了学闪身
  kills: { melee: 0, arrow: 0 },   // 当日击杀方式统计(选择压力的原料)
  corpus: [],                  // 活语料:世界自己写的新台词,永久入库(上限 40)
};
const vendetta = { stage: 0, boss: null }; // 黑石的报复:0 无仇 → 1 记仇 → 2 伏击上膛 → 3 两清
const LEGEND_EMBELLISH = ['——亲眼所见的人都这么说', ',连卫兵都点了头', ',那天风都停了半刻',
  ',据说月亮探出头看了一眼', ',酒馆里为这个干了三杯', ',吟游诗人已经在编曲子了'];
const LEGEND_SWAPS = [['独自', '单枪匹马'], ['赢了', '不费吹灰之力赢了'], ['救回', '徒手救回'],
  ['击退', '一声吼就击退'], ['缉拿', '谈笑间缉拿'], ['钓上', '赤手抓上'], ['买下', '一掷千金买下'],
  ['猎到', '闭着眼猎到'], ['撂倒', '用小拇指撂倒'], ['掰手腕', '隔着桌子掰手腕']];
function legendText(l) { return l.base + (l.extra || ''); }
function seedLegend() {
  const cands = chronicle.filter((m) => !m.t.startsWith('它') && !EVO.legends.some((L) => L.src === m.t));
  if (!cands.length) return;
  const m = cands[Math.floor(Math.random() * cands.length)];
  EVO.legends.push({ src: m.t, base: `绿衣游侠${m.t}`, extra: '', gen: 1, heat: 1 });
  if (EVO.legends.length > 10) { // 选择:热度垫底的传说被人遗忘
    EVO.legends.sort((a, b) => b.heat - a.heat);
    EVO.legends.length = 10;
  }
}
function mutateLegend(l) {
  l.gen++;
  l.base = l.base.replace(/\d+/g, (n) => String(Math.min(999, Math.ceil(+n * (1.4 + Math.random()))))); // 数字越传越大
  const sw = LEGEND_SWAPS[Math.floor(Math.random() * LEGEND_SWAPS.length)];
  if (l.base.includes(sw[0]) && !l.base.includes(sw[1])) l.base = l.base.replace(sw[0], sw[1]);
  l.extra = LEGEND_EMBELLISH[Math.floor(Math.random() * LEGEND_EMBELLISH.length)];
  if (!AI_TEXT_OFF && Math.random() < 0.5) { // 联网时让 AI 来当"以讹传讹"的那张嘴
    aiLine(`把这句关于绿衣游侠林恩的传闻再夸张一点点,像民间以讹传讹又传了一代:「${l.base}」。25字以内,只输出新传闻本身。`, null, 7000)
      .then((t) => { if (t && t.length < 60) l.base = t.replace(/[「」"']/g, ''); });
  }
}
function evolveLegends() { // 每过一夜,总有一条传闻长出新的枝节
  if (EVO.legends.length < 3) seedLegend();
  if (!EVO.legends.length) return;
  mutateLegend(EVO.legends[Math.floor(Math.random() * EVO.legends.length)]);
}
// 敌人战术演化:匪帮复盘自己怎么死的,学出针对性的反制(智能自进化)
function evolveTactics() {
  const { melee, arrow } = EVO.kills;
  const total = melee + arrow;
  if (total >= 3) {
    const b0 = EVO.tactics.block, d0 = EVO.tactics.dodge;
    EVO.tactics.block = Math.min(0.6, EVO.tactics.block + 0.1 * (melee / total));
    EVO.tactics.dodge = Math.min(0.6, EVO.tactics.dodge + 0.1 * (arrow / total));
    if (b0 < 0.25 && EVO.tactics.block >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始格挡刀剑!(重击和跳劈可以破防)', 5);
      remember('盗贼们学会了格挡,和从前不一样了');
    }
    if (d0 < 0.25 && EVO.tactics.dodge >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始侧身闪箭!(贴近了射,或换法术)', 5);
      remember('盗贼们学会了闪箭,和从前不一样了');
    }
  } else {
    EVO.tactics.block = Math.max(0, EVO.tactics.block - 0.02); // 没人打他们,手艺也会生疏
    EVO.tactics.dodge = Math.max(0, EVO.tactics.dodge - 0.02);
  }
  EVO.kills = { melee: 0, arrow: 0 };
}
// 语料自生长:世界每天给自己写一句新传闻,写进永久语料库(联网 AI 执笔;离线拼接变异)
function growCorpus() {
  const push = (t) => {
    if (!t || t.length < 6 || t.length > 60 || EVO.corpus.includes(t)) return;
    EVO.corpus.push(t);
    if (EVO.corpus.length > 40) EVO.corpus.shift();
  };
  if (!AI_TEXT_OFF) {
    const sp = todaySpecial();
    aiLine(
      `你是中世纪王国艾尔德里亚的市井谣言本身。现在是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
      `${sp ? '·' + sp.name : ''}。${wsReport().slice(0, 60)}` +
      `写一条25字以内全新的市井传闻(不要提绿衣游侠),要有画面感。只输出传闻本身。`, null, 8000,
    ).then((t) => { if (t) { push(t.replace(/[「」"']/g, '')); saveGame(); } });
  } else {
    // 离线:把两条既有传闻剪开重新缝(拼接变异)
    const a = BANKS.RUMORS[Math.floor(Math.random() * BANKS.RUMORS.length)];
    const b = BANKS.RUMORS[Math.floor(Math.random() * BANKS.RUMORS.length)];
    const cut = (s) => { const i = s.search(/[,,]/); return i > 0 ? [s.slice(0, i + 1), s.slice(i + 1)] : [s, '']; };
    const [a1] = cut(a), [, b2] = cut(b);
    if (b2) push(a1 + b2);
  }
}

let wolfKills = 0;
function addWolf(x, z) {
  const w = { ...makeWolf(), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
    home: new THREE.Vector3(x, 0, z), hp: EVO.wolfGen >= 3 ? 3 : 2, speed: 7.2 + EVO.wolfSpeed,
    attackCd: 0, stunT: 0, walkT: 0, dead: false, respawnT: 0 };
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
  registerSpot(type, x, z, chunkKey) {
    wildSpots.push({ type, x, z, chunk: chunkKey });
  },
  removeChunkEntities(chunkKey) {
    for (let i = wildSpots.length - 1; i >= 0; i--) {
      if (wildSpots[i].chunk === chunkKey) wildSpots.splice(i, 1);
    }
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
        w.hp = EVO.wolfGen >= 3 ? 3 : 2; // 演化到第三代,狼更扛揍
        w.speed = 7.2 + EVO.wolfSpeed;   // "下一代"继承演化出的速度
        w.pos.copy(w.home);
        w.group.rotation.x = 0;
        w.group.visible = true;
        w.lunging = 0; // 死在半空的扑咬姿势不带进下一条命
        w.lungeHit = false;
        w.stunT = 0;
        w.group.scale.y = 1;
      }
      continue;
    }
    if (!w.raidTarget && !w.arena && entFar(w)) {
      // 远处休眠:别把扑咬姿势冻在半空
      if (w.lunging > 0) { w.lunging = 0; w.group.scale.y = 1; }
      continue;
    }
    if (w.stunT > 0) { w.stunT -= dt; continue; }
    w.attackCd = Math.max(0, w.attackCd - dt);
    w.lungeCd = Math.max(0, (w.lungeCd || 0) - dt);
    if (w._trampleCd > 0) w._trampleCd -= dt;
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
          damagePlayer(wolfBuff > 1 ? 2 : 1, w);
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
    if (pd < 20 * sneakFactor() && !player.dead) {
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
        telegraphFlash(w, 0.3);
        continue;
      }
      if (pd > 1.3) { moveEntity(w, player.pos.x, player.pos.z, w.speed * wolfBuff, dt); moving = true; }
      else if (w.attackCd <= 0) { w.attackCd = 1.1; damagePlayer(1, w); }
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
  w.respawnT = (w.arena || w._prol) ? 99999 : (todaySpecial()?.key === 'wolfmoon' ? 22 : 45);
  startFall(w);
  registerKill();
  setTimeout(() => { if (w.dead) w.group.visible = false; }, 2500);
  dropCoins(w.pos, 2);
  wolfKills++;
  EVO.wolfPressure++; // 猎杀压力:选择的原料
  choreProgress('wolves');
  // 竞技场里的狼不算狼灾任务(和盗贼任务的排除规则对齐)
  if (!w.arena && quest.active && missions[quest.idx].type === 'wolves') {
    quest.progress++;
    toast(`猎杀恶狼 ${quest.progress}/${missions[quest.idx].goal}`, 2);
    if (quest.progress >= missions[quest.idx].goal) completeMission();
  }
}

// ================= 武器与护甲系统 =================
const WEAPONS = {
  // staMul=重量:同一招巨剑更费体力、短匕最省——省下的气就是你的走位(骑砍的取舍)
  sword:      { name: '铁剑', icon: '🗡️', dmg: 1, range: 2.4, cd: 0.28, knock: 0.55, price: 0, staMul: 1 },
  dagger:     { name: '短匕', icon: '🔪', dmg: 1, range: 2.0, cd: 0.16, knock: 0.3, price: 30, staMul: 0.65 },
  greatsword: { name: '巨剑', icon: '⚔️', dmg: 3, range: 2.9, cd: 0.7, knock: 1.3, price: 90, staMul: 1.5 },
  bow:        { name: '猎弓', icon: '🏹', dmg: 2, range: 0, cd: 0.8, knock: 0.4, price: 60, staMul: 1 },
  warblade:   { name: '枭首之刃', icon: '⚜️', dmg: 2, range: 2.5, cd: 0.24, knock: 0.7, staMul: 0.9 }, // 无价:单挑斩将夺来
};
const ARMORS = [
  { name: '', bonus: 0 },
  { name: '皮甲', bonus: 2, price: 40, color: 0x7a5230 },
  { name: '板甲', bonus: 4, price: 120, color: 0x9aa4ad },
];
player.weapon = 'sword';
player.weaponsOwned = ['sword'];

// ================= 魔法系统 =================
// 四门法术分别来自四处地标:女巫卖火球、教堂授治愈、湖心祭坛赠冰霜、回响之镜予闪现。
// R 施放 · V 切换 · 数字键 1-4 直选;法力自然回复,自家安眠/庇佑时回得更快。
const SPELLS = {
  spark: { name: '魔光弹', icon: '✴️', mp: 1, cd: 0.45 }, // 娘胎里带的:1 蓝速射,毁灭系入门
  fire:  { name: '火球术', icon: '🔥', mp: 3, cd: 1.1 },
  heal:  { name: '治愈术', icon: '✨', mp: 4, cd: 2.5 },
  frost: { name: '冰霜新星', icon: '❄️', mp: 4, cd: 6 },
  blink: { name: '闪现', icon: '💠', mp: 2, cd: 2.5 },
};
player.mp = 6;
player.maxMp = 6;
player.spells = ['spark']; // 基础魔法与生俱来,R 键即放
player.spellIdx = 0;
player.castT = 0;
function learnSpell(key) {
  if (player.spells.includes(key)) return false;
  player.spells.push(key);
  player.spellIdx = player.spells.length - 1;
  sfx.fanfare();
  toast(`${SPELLS[key].icon} 习得法术「${SPELLS[key].name}」!R 施放 · V 切换`, 5);
  remember(`习得了法术「${SPELLS[key].name}」`, `spell-${key}`);
  saveGame();
  return true;
}
function cycleSpell() {
  if (player.spells.length < 2) return;
  player.fireChargeT = 0; // 换法术=松开引导
  player.spellIdx = (player.spellIdx + 1) % player.spells.length;
  const k = player.spells[player.spellIdx];
  sfx.equip();
  toast(`${SPELLS[k].icon} ${SPELLS[k].name}`, 1.2);
}
// 范围爆破:火球命中点的 AoE(打卫兵照样算犯罪)
function explodeAt(x, z, dmg = 3, radius = 3.4) {
  camShake = Math.max(camShake, 0.35);
  sfx.stomp();
  spawnDust(x, 0.5, z, 16, radius * 0.5, 2.2);
  const boom = (list, onDead) => {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      if (dist2(x, z, e.pos.x, e.pos.z) > radius * radius) continue;
      e.hp -= dmg;
      hitFX(e, 1.2);
      showDamage(e.pos, dmg, true);
      if (e.hp <= 0) onDead(e);
    }
  };
  boom(bandits, (b) => slayBandit(b));
  boom(wolves, (w) => killWolf(w));
  boom(guards, (g) => downGuard(g));
  for (const g of guards) {
    if (!g.dead && g.downT <= 0 && dist2(x, z, g.pos.x, g.pos.z) < radius * radius && !g.wantedHit) {
      g.wantedHit = true;
      crime(2, '你的火球炸到了卫兵!');
      break;
    }
  }
}
// ================= 冰霜留痕:新星过后地面结霜,敌人踩上去减速一半 =================
const frostPatches = [];
function addFrostPatch(x, z, r = 5.5, dur = 6) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.06, z);
  scene.add(m);
  frostPatches.push({ x, z, r, t: dur, m });
}
function updateFrostPatches(dt) {
  for (let i = frostPatches.length - 1; i >= 0; i--) {
    const p = frostPatches[i];
    p.t -= dt;
    if (p.t <= 0) {
      scene.remove(p.m);
      p.m.traverse ? p.m.traverse((o) => { // 拒马是组合体,逐件回收
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && !o.material._shared) o.material.dispose();
      }) : null;
      if (p.m.geometry) { p.m.geometry.dispose(); p.m.material.dispose(); }
      frostPatches.splice(i, 1);
      continue;
    }
    if (!p.wood && p.t < 1) p.m.material.opacity = 0.28 * p.t; // 冰面最后一秒融化(拒马不透明)
  }
}
// 拒马:攻城警报拉响时,卫兵在来袭方向支起两座木刺阵——踩进去的人腿脚都慢半拍
function addBarricade(x, z) {
  const grp = new THREE.Group();
  const wood = lambert(0x6a4a28, { roughness: 0.92 });
  wood._shared = true; // 共享一份材质,dispose 时跳过
  for (let i = 0; i < 6; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.2, 5), wood);
    const a2 = (i / 6) * Math.PI * 2;
    spike.position.set(Math.cos(a2) * 1.7, 0.55, Math.sin(a2) * 1.7);
    spike.rotation.z = i % 2 ? 0.55 : -0.55;
    spike.rotation.y = a2;
    grp.add(spike);
  }
  grp.position.set(x, 0, z);
  scene.add(grp);
  frostPatches.push({ x, z, r: 3.2, t: 90, m: grp, wood: true });
}
function frostSlow(e) {
  if (!frostPatches.length) return 1;
  for (const p of frostPatches) {
    if (dist2(e.pos.x, e.pos.z, p.x, p.z) < p.r * p.r) return 0.5;
  }
  return 1;
}

// 大火球:蓄力引导的产物——更大更疼,炸开半径 5,配大冷却
function castBigFire() {
  if (!started || player.dead || player.carrying || dialog.open ||
      player.castT > 0 || player.staggerT > 0 ||
      player.spells[player.spellIdx] !== 'fire') return; // 蓄力途中切了法术/进了冷却就作废
  const cost = Math.max(2, Math.round(5 * (1 - 0.04 * (skillLv('destruction') - 1))));
  if (player.mp < cost) { toast(`💧 法力不足(大火球需要 ${cost} 点)`, 1.6); return; }
  player.mp -= cost;
  player.castT = 1.8;
  stats.casts = (stats.casts || 0) + 1;
  skillXp('destruction', 3);
  sfx.arrow();
  sfx.stomp();
  camShake = Math.max(camShake, 0.2);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false })));
  const pos = new THREE.Vector3(player.pos.x + fx * 0.9, 1.35, player.pos.z + fz * 0.9);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: new THREE.Vector3(fx, 0.05, fz).multiplyScalar(19),
    ttl: 2.4, stuck: false, fire: true, big: true });
}

function castSpell() {
  if (!started || player.dead || player.castT > 0 || !player.spells.length ||
      player.carrying || dialog.open) return;
  const key = player.spells[player.spellIdx];
  const def = SPELLS[key];
  const cost = Math.max(1, Math.round(def.mp * (1 - 0.04 * (skillLv('destruction') - 1)))); // 法术专精:省蓝
  if (player.mp < cost) { toast(`💧 法力不足(${SPELLS[key].name}需要 ${cost} 点)`, 1.6); return; }
  player.mp -= cost;
  player.castT = def.cd;
  stats.casts = (stats.casts || 0) + 1;
  if (stats.casts >= 30) unlockAch('mage');
  skillXp('destruction', 2);
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  if (key === 'spark') {
    // 魔光弹:速射直线光弹,带辉光;毁灭系每 3 级伤害 +1,5 级起三连扇射
    sfx.arrow();
    if (!player.sneaking) faceNearestFoe(9); // 法弹也吸目标,新手第一发就该打中
    const yaws = skillLv('destruction') >= 5
      ? [player.yaw - 0.17, player.yaw, player.yaw + 0.17]
      : [player.yaw];
    for (const yw of yaws) {
      const fx2 = Math.sin(yw), fz2 = Math.cos(yw);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xbfe4ff }));
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x5599ff, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false })));
      const pos = new THREE.Vector3(player.pos.x + fx2 * 0.7, 1.25, player.pos.z + fz2 * 0.7);
      mesh.position.copy(pos);
      scene.add(mesh);
      arrows.push({ mesh, pos, vel: new THREE.Vector3(fx2, 0.02, fz2).multiplyScalar(26),
        ttl: 1.8, stuck: false, mag: true, dmg: 1 + Math.floor((skillLv('destruction') - 1) / 3) });
    }
  } else if (key === 'fire') {
    sfx.arrow();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8830 }));
    mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff5510, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false })));
    const pos = new THREE.Vector3(player.pos.x + fx * 0.8, 1.3, player.pos.z + fz * 0.8);
    mesh.position.copy(pos);
    scene.add(mesh);
    arrows.push({ mesh, pos, vel: new THREE.Vector3(fx, 0.06, fz).multiplyScalar(22), ttl: 2.2, stuck: false, fire: true });
  } else if (key === 'heal') {
    sfx.heart();
    player.hp = Math.min(player.maxHp, player.hp + 4);
    spawnDust(player.pos.x, 1.2, player.pos.z, 10, 0.8, 2.6);
    toast('✨ 暖流漫过伤口。(回复 ❤×2)', 2);
  } else if (key === 'frost') {
    sfx.clear();
    camShake = Math.max(camShake, 0.25);
    spawnDust(player.pos.x, 0.4, player.pos.z, 22, 3.2, 1.6);
    // 冰霜留痕:6 秒冰面(雨天水汽足,冻得住 9 秒),踩上减速一半
    addFrostPatch(player.pos.x, player.pos.z, 5.5,
      weather.state === 'rain' || weather.state === 'storm' ? 9 : 6);
    const freeze = (list) => {
      for (const e of list) {
        if (e.dead || e.downT > 0 || e.stunT === undefined) continue;
        if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > 49) continue;
        e.stunT = Math.max(e.stunT || 0, 3.5);
        e.hp -= 1;
        showDamage(e.pos, 1);
        if (list === guards && !e.wantedHit) { e.wantedHit = true; crime(1, '你的寒气冻伤了卫兵!'); }
        if (e.hp <= 0 && list === wolves) killWolf(e);
        else if (e.hp <= 0 && list === bandits) slayBandit(e);
        else if (e.hp <= 0 && list === guards) downGuard(e);
      }
    };
    freeze(bandits);
    freeze(wolves);
    freeze(guards);
    toast('❄️ 寒气炸开,周围的敌人冻在了原地!', 2);
  } else if (key === 'blink') {
    sfx.roll();
    spawnDust(player.pos.x, 0.6, player.pos.z, 8, 0.5, 1.8);
    player.pos.x += fx * 7;
    player.pos.z += fz * 7;
    resolveCollisions(player.pos, 0.45, colliders);
    player.invulnT = Math.max(player.invulnT, 0.35);
    spawnDust(player.pos.x, 0.6, player.pos.z, 8, 0.5, 1.8);
  }
}
function updateMagic(dt) {
  if (player.castT > 0) player.castT -= dt;
  if (player.riposteT > 0) player.riposteT -= dt;
  const regen = 0.32 * (player.homeDay === calendar.day ? 1.5 : 1) * (player.blessT > 0 ? 1.4 : 1);
  player.mp = Math.min(player.maxMp, player.mp + regen * dt);
  if (shout.cd > 0) shout.cd -= dt;
  // 按住连发:R/中键压住不放,魔光弹按冷却节奏一发接一发(只限魔光弹,别把治愈术的蓝烧干)
  const heldCast = (keys['KeyR'] || midHeld) && !dialog.open;
  if (heldCast && player.castT <= 0 && player.spells[player.spellIdx] === 'spark' &&
      player.mp >= 1) castSpell(); // 没蓝就松手,别每帧挤一条"法力不足"
  // 火球蓄力:冷却结束后继续按住=引导聚能,蓄满松开轰出大火球
  if (heldCast && player.castT <= 0 && player.spells[player.spellIdx] === 'fire') {
    const t0 = player.fireChargeT || 0;
    player.fireChargeT = Math.min(1, t0 + dt);
    if (Math.random() < 0.35) spawnDust(player.pos.x + Math.sin(player.yaw) * 0.7, 1.3,
      player.pos.z + Math.cos(player.yaw) * 0.7, 1, 0.3, 1.2); // 聚能星火
    if (t0 < 0.55 && player.fireChargeT >= 0.55) {
      sfx.clear();
      toast('🔥 蓄满!松开轰出大火球', 1.2);
    }
  } else if (!heldCast && (player.fireChargeT || 0) > 0) {
    if (player.fireChargeT >= 0.55) castBigFire();
    player.fireChargeT = 0;
  }
  // 体力(骑砍规则):格挡/疾跑/出手/喘气中不回,其余时刻 16/s 回满
  if (player.gaspT > 0) player.gaspT -= dt;
  if (player.staggerT > 0) player.staggerT -= dt;
  const busy = player.blocking || player.attackT > 0 || player.gaspT > 0 || moveState >= 2;
  if (!busy) player.sta = Math.min(player.maxSta, player.sta + 16 * dt);
  updateSneakXp(dt);
}
// 花体力:不够=喘不上气(出不了手);花光=力竭破绽
let gaspToastT = 0;
function spendSta(cost) {
  if (player.sta < cost) {
    if (performance.now() - gaspToastT > 1500) {
      gaspToastT = performance.now();
      toast('💨 喘不上气……(体力耗尽,缓一缓)', 1.2);
      sfx.hiccup();
    }
    return false;
  }
  player.sta -= cost;
  if (player.sta <= 0) { player.sta = 0; player.gaspT = 1.2; } // 榨干最后一口气=1.2 秒喘息
  return true;
}

// ================= 技能熟练度(上古卷轴式:用什么,涨什么) =================
const SKILL_DEFS = {
  onehand:     { name: '武艺', icon: '⚔️', perk: '近战伤害 +6%/级' },
  archery:     { name: '弓术', icon: '🏹', perk: '箭矢伤害 +6%/级' },
  destruction: { name: '法术', icon: '🔮', perk: '法力消耗 -4%/级;5 级魔光弹三连扇射' },
  riding:      { name: '骑术', icon: '🐴', perk: '骑乘速度 +2%/级' },
  sneak:       { name: '潜行', icon: '🤫', perk: '警觉圈再缩 3%/级' },
};
player.skills = Object.fromEntries(Object.keys(SKILL_DEFS).map((k) => [k, { lv: 1, xp: 0 }]));
function skillXp(k, n) {
  const s = player.skills[k];
  if (!s || s.lv >= 10) return;
  s.xp += n;
  const need = s.lv * 20;
  if (s.xp >= need) {
    s.xp -= need;
    s.lv++;
    sfx.fanfare();
    // 技艺磨炼身体:每次升级体力上限 +3(封顶 160)——练什么都算锻炼
    if (player.maxSta < 180) {
      player.maxSta = Math.min(180, player.maxSta + 3);
      player.sta = player.maxSta; // 升级瞬间气也回满,爽快些
    }
    toast(`${SKILL_DEFS[k].icon} ${SKILL_DEFS[k].name}提升到 ${s.lv} 级!(${SKILL_DEFS[k].perk};体力上限 ${player.maxSta})`, 3.5);
    if (s.lv === 10) remember(`把${SKILL_DEFS[k].name}练到了炉火纯青`, `skill-${k}`);
    saveGame();
  }
}
const skillLv = (k) => (player.skills[k] ? player.skills[k].lv : 1);
const meleeBonus = (base) => Math.round(base * (1 + 0.06 * (skillLv('onehand') - 1)));
const arrowBonus = (base) => Math.round(base * (1 + 0.06 * (skillLv('archery') - 1)));

// ================= 潜行(Z 键蹲行:靠近不惊、背刺三倍) =================
function sneakFactor() {
  return player.sneaking ? Math.max(0.22, 0.45 - 0.03 * (skillLv('sneak') - 1)) : 1;
}
function toggleSneak() {
  if (player.mounted || player.dead) return;
  player.sneaking = !player.sneaking;
  player.group.scale.y = player.sneaking ? 0.8 : 1;
  toast(player.sneaking ? '🤫 潜行(移动放缓,敌人警觉圈大幅缩小;近身出手=偷袭 ×3)' : '(起身)', 2);
}
let sneakXpT = 0;
function updateSneakXp(dt) {
  if (!player.sneaking) return;
  sneakXpT += dt;
  if (sneakXpT < 2) return;
  sneakXpT = 0;
  // 在活着的敌人眼皮底下潜着,才算练功
  const near = (list, r2) => list.some((e) => !e.dead && !(e.downT > 0) &&
    dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < r2);
  if (near(bandits, 400) || near(wolves, 400)) skillXp('sneak', 1);
}

// ================= 龙吼(龙骨之地的龙颅所授,X 键释放) =================
const DRAGON_SKULL = { x: 298, z: -152 };
const shout = { learned: false, cd: 0 };
function learnShout() {
  if (shout.learned) {
    openDialog(['(龙颅空洞的眼窝深处,有风声盘旋。它已无话可教——去吼吧。)']);
    return;
  }
  shout.learned = true;
  sfx.fanfare();
  camShake = 0.5;
  unlockAch('dovah');
  remember('把手放上龙骨之地的龙颅,学会了先古的战吼', 'shout');
  openDialog([
    '(你把手放上龙颅。骨头是凉的,却在你掌心底下嗡嗡作响,像一头还没散尽的雷。)',
    '(三个不属于任何语言的音节,自己滚进了你的胸腔。)',
    '🐉 习得「冲击战吼」!按 X 释放——把周围的一切掀翻在地(45 秒回气)。',
  ], () => saveGame());
}
function doShout() {
  if (!shout.learned || shout.cd > 0 || player.dead || dialog.open) return;
  shout.cd = 45;
  sfx.stomp();
  sfx.clear();
  camShake = 0.6;
  hitStopT = Math.max(hitStopT, 0.08);
  spawnDust(player.pos.x, 0.4, player.pos.z, 26, 4, 2.6);
  const wave = (list, onDead) => {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) > 100) continue;
      e.hp -= 1;
      if (e.stunT !== undefined) e.stunT = Math.max(e.stunT || 0, 2);
      hitFX(e, 4); // FUS RO DAH:掀飞
      showDamage(e.pos, 1);
      if (e.hp <= 0) onDead(e);
    }
  };
  wave(bandits, (b) => slayBandit(b));
  wave(wolves, (w) => killWolf(w));
  wave(guards, (g) => downGuard(g));
  for (const g of guards) {
    if (!g.dead && !(g.downT > 0) && dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 100 && !g.wantedHit) {
      g.wantedHit = true;
      crime(1, '你的战吼掀翻了卫兵!');
      break;
    }
  }
  toast('🐉 冲击战吼!!', 2);
}

// ================= 佣兵(骑砍式:旅店雇剑士随行,按日发饷) =================
const mercs = [];
const MERC_NAMES = ['石手雷戈', '断鼻威尔', '老兵科尔', '快腿芬恩'];
function hireMerc() {
  if (mercs.length >= 2) {
    openDialog(['佣兵队长布兰:(摊手)我手下能打的都跟你走了。两个还不够?你是要去屠城吗?']);
    return;
  }
  if (player.coins < 40) {
    openDialog(['佣兵队长布兰:一名剑士 40 金币,外加每天 5 金币饷钱。买卖归买卖——赊账免谈。']);
    return;
  }
  player.coins -= 40;
  const name = MERC_NAMES[Math.floor(Math.random() * MERC_NAMES.length)];
  const m = { ...makeHumanoid({ shirt: 0x555b66, pants: 0x33363c, helmet: true, sword: true }),
    pos: new THREE.Vector3(player.pos.x + 1.5, 0, player.pos.z + 1.5),
    yaw: 0, walkT: 0, hp: 8, attackCd: 0, swingT: 0, name };
  m.group.position.copy(m.pos);
  scene.add(m.group);
  mercs.push(m);
  sfx.accept();
  stats.mercsHired = (stats.mercsHired || 0) + 1;
  remember(`在旅店雇下了佣兵${name}`, `merc-${calendar.day}`);
  openDialog([`佣兵队长布兰:${name}!收拾家伙,跟这位老板走。`, `${name}:(抱拳)雇主,刀锋朝哪边?`]);
  saveGame();
}
function updateMercs(dt) {
  for (const m of mercs) {
    m.attackCd = Math.max(0, m.attackCd - dt);
    // 找最近的活敌(盗贼/恶狼)
    let target = null, td = 196; // 14^2
    for (const list of [bandits, wolves]) {
      for (const e of list) {
        if (e.dead || e.downT > 0) continue;
        const d2v = dist2(m.pos.x, m.pos.z, e.pos.x, e.pos.z);
        if (d2v < td) { td = d2v; target = e; }
      }
    }
    let moving = false;
    if (target) {
      const d = Math.sqrt(td);
      if (d > 1.7) { moveEntity(m, target.pos.x, target.pos.z, 6.4, dt); moving = true; }
      else if (m.attackCd <= 0) {
        m.attackCd = 1.0;
        m.swingT = 0.32;
        sfx.sword();
        const dmg = m.veteran ? 2 : 1;
        target.hp -= dmg;
        showDamage(target.pos, dmg);
        hitFX(target, 0.5);
        if (target.hp <= 0) {
          if (wolves.includes(target)) killWolf(target);
          else slayBandit(target, { credit: '佣兵助攻' });
          m.kills = (m.kills || 0) + 1;
          if (m.kills >= 5 && !m.veteran) { // 五个人头,升老兵:更能打、更扛揍
            m.veteran = true;
            m.hp += 4;
            m.name = `老兵·${m.name}`;
            sfx.fanfare();
            toast(`🪖 ${m.name}身经百战,晋升老兵!(伤害翻倍)`, 3.5);
            remember(`佣兵${m.name}在你麾下打成了老兵`);
          }
        }
      }
    } else {
      const pd = Math.hypot(player.pos.x - m.pos.x, player.pos.z - m.pos.z);
      if (pd > 3.4) { moveEntity(m, player.pos.x, player.pos.z, pd > 14 ? 9 : 6, dt); moving = true; }
    }
    m.group.position.copy(m.pos);
    m.group.rotation.y = m.yaw;
    m.parts._attackAnim = (m.swingT || 0) > 0;
    animateLimbs(m.parts, m.walkT, moving, m.group, 0.9);
    if (m.swingT > 0) { m.swingT -= dt; meleeSwing(m.parts, Math.min(1, 1 - m.swingT / 0.32)); }
  }
}
function hireMercSilent() { // 读档时无声归队
  const name = MERC_NAMES[mercs.length % MERC_NAMES.length];
  const m = { ...makeHumanoid({ shirt: 0x555b66, pants: 0x33363c, helmet: true, sword: true }),
    pos: new THREE.Vector3(world.playerSpawn.x + 2 + mercs.length, 0, world.playerSpawn.z + 2),
    yaw: 0, walkT: 0, hp: 8, attackCd: 0, swingT: 0, name };
  m.group.position.copy(m.pos);
  scene.add(m.group);
  mercs.push(m);
}
function payMercs() { // 每日饷钱:发不出就散伙
  if (!mercs.length) return;
  const wage = mercs.length * 5;
  if (player.coins >= wage) {
    player.coins -= wage;
    toast(`💰 发放佣兵饷钱 ${wage} 金币(${mercs.map((m) => m.name).join('、')})`, 3);
  } else {
    for (const m of mercs) scene.remove(m.group);
    toast(`💸 发不出饷钱,佣兵${mercs.map((m) => m.name).join('、')}卷铺盖走了。`, 4);
    mercs.length = 0;
  }
}
player.armor = 0;
player.blocking = false;
player.rollT = 0;
player.rollCd = 0;
player.rollDir = new THREE.Vector2(0, 1);

// 手中武器外观
let _warBladeMat = null;
let _goldBladeMat = null;
function setWeaponVisual(type) {
  const armR = player.parts.armR;
  if (player.weaponGroup) armR.remove(player.weaponGroup);
  if (player.bowGroup) { player.parts.armL.remove(player.bowGroup); player.bowGroup = null; }
  // Blender 武器模板:血槽刃/缠柄/铁护手;淬火后刃身换金
  {
    const name = { dagger: 'Dagger', greatsword: 'Greatsword', bow: 'Bow', sword: 'Sword' }[type] || 'Sword';
    const real = getWeaponModel(name);
    if (real) {
      if (type === 'warblade') { // 枭首之刃:暗红刃身,一眼认出
        if (!_warBladeMat) _warBladeMat = lambert(0x8a2430, { metalness: 0.8, roughness: 0.3 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _warBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      } else if (player.swordLv >= 2 && type !== 'bow') {
        if (!_goldBladeMat) _goldBladeMat = lambert(0xe8c34a, { metalness: 0.85, roughness: 0.25 });
        real.traverse((o) => {
          if (o.isMesh) {
            const remap = (mm) => (mm.name === 'steel' ? _goldBladeMat : mm);
            o.material = Array.isArray(o.material) ? o.material.map(remap) : remap(o.material);
          }
        });
      }
      if (type === 'bow') {
        real.position.set(0, -0.42, 0.06);
        player.parts.armL.add(real);
        player.bowGroup = real;
        player.weaponGroup = null;
        return;
      }
      const g2 = new THREE.Group();
      g2.add(real);
      g2.position.y = -0.4;
      armR.add(g2);
      player.weaponGroup = g2;
      return;
    }
  }
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
  player.maxHp = 10 + ARMORS[level].bonus + (lakeBlessed ? 2 : 0);
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
// 雨天湿弦:箭路发飘(暴雨更甚);提示节流,别刷屏
let wetToastT = 0;
function wetSpread(mul = 1) {
  const wet = weather.state === 'storm' ? 0.11 : weather.state === 'rain' ? 0.055 : 0;
  if (!wet) return 0;
  if (performance.now() - wetToastT > 12000) {
    wetToastT = performance.now();
    toast('🌧️ 雨水打湿了弓弦,箭路发飘……', 2);
  }
  return (Math.random() - 0.5) * 2 * wet * mul;
}
function shootArrow() {
  // 弓术 5 级专属:一弓双箭(小角度散射)
  const shots = skillLv('archery') >= 5 ? [0, 0.09] : [0];
  for (const off of shots) {
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    const jit = off + wetSpread();
    const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.06, Math.cos(player.yaw + jit)).normalize();
    const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
    mesh.position.copy(pos);
    scene.add(mesh);
    arrows.push({ mesh, pos, vel: dir.multiplyScalar(26), ttl: 3, stuck: false });
  }
  sfx.arrow();
}
function arrowHitEntities(a) {
  const dmg = a.dmg || arrowBonus(WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0));
  const tryHit = (list, onHit) => {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      if (a._hits && a._hits.includes(e)) continue; // 贯穿箭:一箭对同一目标只算一次
      const dy = a.pos.y - 0.9;
      if (dy > 1.4 || dy < -0.9) continue;
      if (dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 0.8) {
        if (a._hits) a._hits.push(e);
        onHit(e);
        return true;
      }
    }
    return false;
  };
  if (tryHit(guards, (g) => {
    g.hp -= dmg; sfx.hit(); hitFX(g, 0.4); showDamage(g.pos, dmg);
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你放箭射击卫兵!'); }
    if (g.hp <= 0) downGuard(g);
    else g.state = 'chase';
  })) return true;
  if (tryHit(bandits, (b) => {
    // 战术演化:被射多了的匪帮学会侧身闪箭(贴脸射/法术/飞刀不受影响)
    if (!a.mag && !a.knife && Math.random() < EVO.tactics.dodge * 0.45) {
      showDamage(b.pos, 0);
      hitFX(b, 0.15);
      return;
    }
    b.hp -= dmg; sfx.hit(); hitFX(b, 0.4); showDamage(b.pos, dmg);
    if (b.hp <= 0) {
      b.dead = true; startFall(b); registerKill(); choreProgress('bandits');
      EVO.kills.arrow++;
      if (b.warband) warband.pKills = (warband.pKills || 0) + 1;
      banditSlain(b);
      if (b.boss) dismissMinions();
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
// 投射物下场:法术弹/飞刀是每发独立 geometry+material,必须 dispose,否则连发就是显存漏斗
function disposeArrow(a) {
  scene.remove(a.mesh);
  if (a.mag || a.fire || a.big || a.knife) {
    a.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
function updateArrows(dt) {
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.ttl -= dt;
    if (a.ttl <= 0) { disposeArrow(a); arrows.splice(i, 1); continue; }
    if (a.stuck) continue;
    if (!a.fire && !a.mag) a.vel.y -= 7 * dt; // 火球/魔光弹直线飞行,不吃重力
    // 子步进:快箭(满月 42/秒)在低帧率下一帧能跨 2 个身位,不切细会从判定圈中间穿过去
    const stepN = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.6));
    let removed = false;
    for (let s = 0; s < stepN && !removed; s++) {
      a.pos.addScaledVector(a.vel, dt / stepN);
      if (a.fire) {
        // 火球:贴近任何敌人 / 落地 / 撞墙 / 燃尽 → 爆炸
        const near = (list) => list.some((e) => !e.dead && !(e.downT > 0) &&
          dist2(a.pos.x, a.pos.z, e.pos.x, e.pos.z) < 1.6);
        if (near(bandits) || near(wolves) || near(guards) ||
            a.pos.y <= 0.1 || pointBlocked(a.pos.x, a.pos.z) || a.ttl <= 0.05) {
          const wetMul = weather.state === 'storm' ? 0.75 : weather.state === 'rain' ? 0.85 : 1;
          explodeAt(a.pos.x, a.pos.z, a.big ? 5 : 3, (a.big ? 5.2 : 3.4) * wetMul); // 雨天火势打折
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
        }
        continue;
      }
      if (arrowHitEntities(a)) {
        skillXp(a.mag ? 'destruction' : 'archery', 2);
        if (a.mag) magBurst(a.pos.x, Math.max(0.4, a.pos.y), a.pos.z); // 命中碎光
        if (a.pierce > 0) { a.pierce--; continue; } // 满月箭:穿过去接着飞
        disposeArrow(a);
        arrows.splice(i, 1);
        removed = true;
        continue;
      }
      if (a.pos.y <= 0.05 || pointBlocked(a.pos.x, a.pos.z)) {
        if (a.mag) { // 光弹不钉墙:撞上就炸成碎光消散
          magBurst(a.pos.x, Math.max(0.15, a.pos.y), a.pos.z);
          disposeArrow(a);
          arrows.splice(i, 1);
          removed = true;
          break;
        }
        a.stuck = true;
        a.ttl = Math.min(a.ttl, 2);
        a.pos.y = Math.max(0.05, a.pos.y);
        break;
      }
    }
    if (removed) continue;
    a.mesh.position.copy(a.pos);
    a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z);
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
  stats.kills = (stats.kills || 0) + 1;
  if (stats.kills >= 100) unlockAch('slayer');
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
  // 连杀里程碑:越杀越勇
  if (comboN === 3) toast('⚔️ 三连杀!', 1.4);
  else if (comboN === 5) {
    toast('🔥 势不可挡!(体力回满)', 2);
    player.sta = player.maxSta;
    sfx.fanfare();
  } else if (comboN === 8) {
    toast('👑 一骑当千!兵刃烧得发白——攻速提升,剑光化金!', 3);
    unlockAch('rampage');
    sfx.fanfare();
  }
}
// 白热:八连杀燃起的状态,连杀窗口内攻速 +28%、剑光化金,断了连杀就熄
const whiteHot = () => comboN >= 8 && comboT > 0;
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
// 起手预警:脚下亮出红色警戒圈,随蓄力收拢变亮,配警示音——看见就滚(翻滚)或举盾弹反
// (旧实现直接改材质 emissive,GLB 模型材质是共享缓存,会把满街同色 NPC 一起染红,故重做)
const dangerFX = [];
const dangerMat = new THREE.MeshBasicMaterial({ color: 0xff3220, transparent: true, opacity: 0.4,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
function telegraphFlash(e, dur = 0.45, heavy = false) {
  sfx.warn();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 1, 24), dangerMat.clone());
  if (heavy) ring.material.color.setHex(0xb040ff); // 紫圈=破盾重击:别格挡,滚!
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(e.pos.x, 0.07, e.pos.z);
  scene.add(ring);
  dangerFX.push({ ring, e, t: 0, dur });
}
function updateDanger(dt) {
  for (let i = dangerFX.length - 1; i >= 0; i--) {
    const f = dangerFX[i];
    f.t += dt;
    const k = f.t / f.dur;
    // 出手完毕/被打断(死亡、倒地、踉跄)即熄灭
    if (k >= 1 || f.e.dead || f.e.downT > 0 || (f.e.stunT || 0) > 0) {
      scene.remove(f.ring);
      f.ring.geometry.dispose();
      f.ring.material.dispose();
      dangerFX.splice(i, 1);
      continue;
    }
    f.ring.position.set(f.e.pos.x, 0.07, f.e.pos.z);
    f.ring.scale.setScalar(2.6 - k * 1.6);        // 大圈收拢到出手半径
    f.ring.material.opacity = 0.25 + 0.55 * k;    // 越接近出手越亮
  }
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
        // eventKeep 的鸡(金鸡/越狱鸡)由各自事件的 end() 负责回收,这里不动
        if (chickens[i].extra && !chickens[i].eventKeep && chickens[i] !== player.carrying) { scene.remove(chickens[i].group); chickens.splice(i, 1); }
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
  const d = { ...makeHorse(0x9a7148, false, { antlers: Math.random() < 0.55 }), pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28,
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
        d.group.rotation.x = 0; // startFall 倒的是 x 轴,复活要扶正
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

// ================= 狼伙伴「霜牙」(霜风隘口的白狼,鹿肉驯服) =================
const frostfang = { ent: null, wary: null, tamed: false, feed: 0, atkCd: 0 };
function spawnWhiteWolf(x, z) {
  const w = { ...makeWolf(0xdfe6ee, 0x7ac0e8, 0x2a5a88), pos: new THREE.Vector3(x, 0, z),
    yaw: Math.random() * 6.28, walkT: 0, timer: 0 };
  w.group.position.copy(w.pos);
  scene.add(w.group);
  return w;
}
frostfang.wary = spawnWhiteWolf(-286, -128);
function slayBanditByWolf(b) {
  slayBandit(b, { companion: true, coins: 3, credit: '霜牙助攻' });
}
function updateFrostfang(dt) {
  // 未驯服:白狼在隘口游荡,保持距离打量你
  if (!frostfang.tamed && frostfang.wary) {
    const w = frostfang.wary;
    if (entFar(w)) return;
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    if (pd < 4.5) {
      const fx = w.pos.x - player.pos.x, fz = w.pos.z - player.pos.z;
      const fd = Math.hypot(fx, fz) || 1;
      moveEntity(w, w.pos.x + (fx / fd) * 6, w.pos.z + (fz / fd) * 6, 4.5, dt);
      moving = true;
    } else if (pd > 26) {
      // 不追人,溜达回家
      if (!moveEntity(w, -286, -128, 2.2, dt)) moving = true;
    }
    w.group.position.copy(w.pos);
    w.group.rotation.y = pd < 20 ? Math.atan2(player.pos.x - w.pos.x, player.pos.z - w.pos.z) : w.yaw;
    const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
    w.parts.legs[0].rotation.x = sw;
    w.parts.legs[1].rotation.x = -sw;
    w.parts.legs[2].rotation.x = -sw;
    w.parts.legs[3].rotation.x = sw;
    return;
  }
  // 已驯服:跟随 + 替你咬盗贼和恶狼
  const w = frostfang.ent;
  if (!w) return;
  frostfang.atkCd = Math.max(0, frostfang.atkCd - dt);
  const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
  if (pd > 60) { w.pos.set(player.pos.x + 2, 0, player.pos.z + 2); } // 跟丢了瞬移归队
  // 找玩家身边最近的敌人
  let target = null, td = 14 * 14;
  for (const b of bandits) {
    if (b.dead || b.downT > 0 || b.robber) continue;
    const d = dist2(player.pos.x, player.pos.z, b.pos.x, b.pos.z);
    if (d < td) { td = d; target = b; }
  }
  for (const e of wolves) {
    if (e.dead || e.arena) continue;
    const d = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
    if (d < td) { td = d; target = e; }
  }
  let moving = false;
  if (target) {
    const dd = Math.hypot(target.pos.x - w.pos.x, target.pos.z - w.pos.z);
    if (dd > 1.6) {
      moveEntity(w, target.pos.x, target.pos.z, 8.6, dt);
      moving = true;
    } else if (frostfang.atkCd <= 0) {
      frostfang.atkCd = 0.9;
      sfx.hit();
      hitFX(target, 0.4);
      showDamage(target.pos, 1);
      target.hp -= 1;
      if (target.hp <= 0) {
        if (wolves.includes(target)) killWolf(target);
        else slayBanditByWolf(target);
      }
    }
  } else if (pd > 3.5) {
    moveEntity(w, player.pos.x + 1.5, player.pos.z + 1.5, pd > 12 ? 9 : 5.5, dt);
    moving = true;
  }
  w.group.position.copy(w.pos);
  if (moving || target) w.group.rotation.y = w.yaw;
  const sw = moving ? Math.sin(w.walkT) * 0.6 : 0;
  w.parts.legs[0].rotation.x = sw;
  w.parts.legs[1].rotation.x = -sw;
  w.parts.legs[2].rotation.x = -sw;
  w.parts.legs[3].rotation.x = sw;
}
function tameFrostfang() {
  frostfang.tamed = true;
  frostfang.ent = frostfang.wary;
  frostfang.wary = null;
  unlockAch('packmate');
  remember('用三块鹿肉驯服了霜风隘口的白狼「霜牙」', 'frostfang');
  toast('🐺 白狼低头蹭了蹭你的手——「霜牙」愿意与你同行!', 5);
  saveGame();
}

// ================= 野外热点:篝火(烤肉)/温泉(泡汤)/教堂(庇佑) =================
const wildSpots = [];
// 核心区固定热点:幽暗森林边的猎人篝火 + 霜风隘口温泉
{
  const cf = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert(0x66625c));
    st.position.set(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7);
    cf.add(st);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6),
    new THREE.MeshStandardMaterial({ color: 0xff9a3d, emissive: 0xcc5500, emissiveIntensity: 1.4 }));
  flame.position.y = 0.4;
  cf.add(flame);
  cf.position.set(-118, 0, -32);
  scene.add(cf);
  wildSpots.push({ type: 'campfire', x: -118, z: -32, chunk: null });

  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
    new THREE.MeshStandardMaterial({ color: 0x7ad4d8, emissive: 0x1a5a5e, emissiveIntensity: 0.4, roughness: 0.15 }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-272, 0.03, -122);
  scene.add(pool);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), lambert(0x8a857e));
    st.position.set(-272 + Math.cos(a) * 2.8, 0.22, -122 + Math.sin(a) * 2.8);
    scene.add(st);
  }
  wildSpots.push({ type: 'spring', x: -272, z: -122, chunk: null });
}
function nearestSpot(type, r2) {
  for (const sp of wildSpots) {
    if (sp.type === type && dist2(player.pos.x, player.pos.z, sp.x, sp.z) < r2) return sp;
  }
  return null;
}
let springTick = 0, blessDay = 0;
function updateSprings(dt) {
  if (!started || player.dead) return;
  const sp = nearestSpot('spring', 14);
  if (!sp) { springTick = 0; return; }
  springTick += dt;
  if (springTick >= 2) {
    springTick = 0;
    spawnDust(player.pos.x, 0.6, player.pos.z, 3, 1.2, 1.6);
    stats.soak = (stats.soak || 0) + 2;
    choreProgress('soak');
    choreProgress('soak');
    if (stats.soak >= 30) unlockAch('soak');
    if (player.hp < player.maxHp) {
      player.hp++;
      sfx.heart();
    }
  }
}

// ================= 梦境(旅店过夜时,AI 把编年史揉进梦里) =================
const DREAMS = [
  '你梦见自己站在麦田中央,每一穗麦子都朝着你弯腰,像在行礼,又像在偷笑。',
  '你梦见银月湖底亮着一盏灯,守灯人背对着你,肩膀很像你自己。',
  '你梦见那只鸡。它坐在王座上,神情威严。你醒来前,它点了点头。',
  '你梦见风车转得越来越慢,最后停住——整个世界都在等它,谁也不敢先动。',
  '你梦见一枚金币掉进许愿池,沉了很久很久,久到你在梦里睡着了。',
  '你梦见雪落进炉火,没有熄,反而烧得更旺。有人在你身后轻轻说:记住这个。',
];
let dreamIdx = Math.floor(Math.random() * DREAMS.length);
function queueDream() {
  if (Math.random() < 0.45) return; // 不是每晚都做梦
  const mem = [dayTopThought,
    dayTopSurprise ? `它最没料到的一刻:${dayTopSurprise}` : null,
  ].filter(Boolean).join(';') || recallLine();
  if (!AI_TEXT_OFF && !aiBusy.dream) {
    aiBusy.dream = true;
    aiLine(
      `你是梦本身。给一个中世纪游侠写一段40字以内的梦境,素材(他昨天最挂心的事):${mem || '空旷的原野与一面镜子'}。` +
      '要有画面感,微微超现实,不解释,不加引号。只输出梦境。', null, 9000,
    ).then((t) => {
      aiBusy.dream = false;
      if (t && !dialog.open && !player.dead) openDialog([`(昨夜的梦)${t}`]);
    });
  } else {
    setTimeout(() => {
      if (!dialog.open && !player.dead) openDialog([`(昨夜的梦)${DREAMS[dreamIdx++ % DREAMS.length]}`]);
    }, 4000);
  }
}

// ================= 旅程手账(J 键:一册在手,战绩全有) =================
function openJournal() {
  if (dialog.open) return;
  const bestRace = stats.raceBest ? `${stats.raceBest.toFixed(1)} 秒` : '——';
  const pages = [
    `📖 旅程手账 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日(在这世上第 ${calendar.day} 天)`,
    `🫧 它此刻:${workspace.current ? workspace.current.t : '放空'} · 心境「${moodWord()}」` +
      `${MIND.surprise > 0.4 ? ' · 刚被现实惊了一下' : ''}`,
    ...(mindReport() ? [`🧠 心象:${mindReport()}`] : []),
    ...(MIND.steps >= 40 ? [(() => {
      const top = MIND_KEYS.map((k) => [k, MIND.gains[k] ?? 1]).sort((a, b) => b[1] - a[1]);
      const fmt = ([k, g]) => `${MIND_ZH[k]} ${g.toFixed(2)}×`;
      return `🧠 注意分布(自己长的):${top.slice(0, 3).map(fmt).join(' · ')} … 最冷落:${fmt(top[top.length - 1])}`;
    })()] : []),
    `世界眼里的你:「${archetype()}」 · 🪙 ${player.coins} · ❤ 上限 ${player.maxHp / 2} 心` +
      `${player.relic ? ' · ☀️ 先王战徽' : ''}${frostfang.tamed ? ' · 🐺 霜牙同行' : ''}`,
    `📜 委托 ${Math.min(quest.idx, missions.length)}/${missions.length} · 🛡️ 纹章 ${crestsFound.length}/${world.crestSpots.length} · 📖 铭文 ${loreRead.length}/${LORE.length} · 🏆 成就 ${achUnlocked.length}/${Object.keys(ACH_DEFS).length}`,
    `🐺 猎狼 ${wolfKills} · 🦌 猎鹿 ${stats.deer || 0} · 🍄 采菇 ${stats.mushrooms || 0} · 🎣 钓鱼 ${stats.fishCaught || 0} · ⚡ 弹反 ${stats.parries || 0}`,
    `🏟️ 竞技场最佳 ${stats.arenaBest || 0} 波 · 🏁 赛马纪录 ${bestRace} · 💀 倒下 ${stats.deaths || 0} 次`,
    `⚔️ 战团覆灭 ${stats.warbandsWiped || 0} 支 · 🏰 攻城击退 ${stats.siegesHeld || 0} 次 · 🚩 军旗 ${stats.banners || 0} 面`,
    `📈 技艺(用什么涨什么):${Object.entries(SKILL_DEFS).map(([k, d]) =>
      `${d.icon}${d.name} ${player.skills[k].lv} 级`).join(' · ')}` +
      `${shout.learned ? ' · 🐉 冲击战吼' : ''}${mercs.length ? ` · 🪖 佣兵 ×${mercs.length}` : ''}`,
  ];
  const mems = chronicle.slice(-3);
  if (mems.length) {
    pages.push(`它记得你最近的事:${mems.map((m) => `第${m.d}日,${m.t}`).join(';')}。`);
  }
  {
    const topLeg = EVO.legends.reduce((b, x) => (!b || x.heat > b.heat ? x : b), null);
    const evoBits = [`🐺 狼群第 ${EVO.wolfGen} 代${EVO.wolfSpeed > 0.3 ? '(比从前更快)' : ''}`];
    if (EVO.tactics.block >= 0.25) evoBits.push('匪帮学会了格挡');
    if (EVO.tactics.dodge >= 0.25) evoBits.push('匪帮学会了闪箭');
    if (EVO.corpus.length) evoBits.push(`活语料 +${EVO.corpus.length} 条(世界自己写的)`);
    if (topLeg && topLeg.gen > 1) evoBits.push(`最响的传说已传出第 ${topLeg.gen} 种说法:「${legendText(topLeg)}」`);
    pages.push(`🧬 自进化的世界:${evoBits.join(' · ')}`);
  }
  openDialog(pages);
}

// ================= 拍照模式(P 键隐藏全部 HUD) =================
let photoMode = false;
const PHOTO_HIDE = ['hearts', 'coins', 'equip', 'wanted', 'mission', 'region', 'minimap',
  'prompt', 'controls-hint', 'combo', 'weather', 'bubble', 'toast',
  'stamina', 'lockhp', 'bosshp', 'save-icon'];
function togglePhoto() {
  photoMode = !photoMode;
  for (const id of PHOTO_HIDE) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = photoMode ? 'hidden' : '';
  }
  if (!photoMode) toast('📷 已退出拍照模式', 1.5);
}

// ================= 银月湖心岛:摆渡小船与月光祭坛 =================
const BOAT_PIER = { x: -96.5, z: 86 };
const BOAT_ISLE = { x: -100, z: 106.2 };
let lakeBlessed = false;
function rowTo(dst, msg) {
  sfx.splash();
  stats.rows = (stats.rows || 0) + 1;
  if (stats.rows >= 6) unlockAch('sailor');
  toast('🚣 你摇着小船,桨声把湖面剪开一道纹……', 2.5);
  player.pos.set(dst.x, 0, dst.z);
  player.vy = 0;
  if (msg) setTimeout(() => toast(msg, 3), 900);
}
function prayAltar() {
  if (lakeBlessed) {
    openDialog(['(祭坛安静地泛着微光。湖神的恩赐一生只有一次——它记得你来过。)']);
    return;
  }
  lakeBlessed = true;
  player.maxHp += 2;
  player.hp = player.maxHp;
  sfx.fanfare();
  remember('在湖心沉没神殿的祭坛前,得到了湖神的恩赐', 'lakegift');
  unlockAch('lakegift');
  openDialog([
    '(你把手放上月光祭坛。水下极深处,有什么东西缓缓睁开了眼,又缓缓阖上。)',
    '(一股凉意顺着掌心漫上来,像月光灌进了骨头——却并不冷。)',
    '💙 湖神的恩赐:生命上限 +2!',
  ], () => { learnSpell('frost'); saveGame(); });
}

// ================= 赛马计时赛(马厩旁的赛旗,无限重复) =================
const TRIAL_FLAG = { x: 57, z: 13 };
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), lambert(0x6b4a2f));
  pole.position.set(TRIAL_FLAG.x, 1.6, TRIAL_FLAG.z);
  scene.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x885500, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
  flag.position.set(TRIAL_FLAG.x + 0.58, 2.7, TRIAL_FLAG.z);
  scene.add(flag);
}
const trialRT = { active: false, idx: 0, t: 0, rings: [] };
function startTrial() {
  if (quest.active && missions[quest.idx].type === 'race') {
    toast('🏁 正赛进行中——先跑完领主的委托,再来刷纪录!', 3);
    return;
  }
  trialRT.active = true;
  trialRT.idx = 0;
  trialRT.t = 0;
  for (const [rx, rz] of world.raceRoute) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x7ad4ff, emissive: 0x1a5588, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
    ring.position.set(rx, 2.4, rz);
    scene.add(ring);
    trialRT.rings.push(ring);
  }
  sfx.accept();
  toast(`🏁 计时赛开始!穿过全部 ${world.raceRoute.length} 个蓝环${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)} 秒)` : ''}`, 3.5);
}
function endTrial(finished) {
  for (const r of trialRT.rings) scene.remove(r);
  trialRT.rings = [];
  trialRT.active = false;
  if (!finished) { toast('🏁 计时赛作废。旗子下再来!', 2.5); return; }
  choreProgress('race');
  const t = trialRT.t;
  const best = stats.raceBest || 0;
  if (!best || t < best) {
    stats.raceBest = t;
    player.coins += 10;
    sfx.fanfare();
    remember(`赛马计时赛跑出 ${t.toFixed(1)} 秒的新纪录`);
    toast(`🏁 新纪录 ${t.toFixed(1)} 秒!赏金 10 枚!`, 4);
    saveGame();
  } else {
    toast(`🏁 用时 ${t.toFixed(1)} 秒(纪录 ${best.toFixed(1)} 秒)。再练练!`, 3.5);
  }
}
function updateTrial(dt) {
  if (!trialRT.active) return;
  trialRT.t += dt;
  const [rx, rz] = world.raceRoute[trialRT.idx];
  for (let i = 0; i < trialRT.rings.length; i++) {
    trialRT.rings[i].rotation.y += dt * (i === trialRT.idx ? 3 : 0.6);
    trialRT.rings[i].material.emissiveIntensity = i < trialRT.idx ? 0.1 : i === trialRT.idx ? 1.2 : 0.4;
  }
  if (dist2(player.pos.x, player.pos.z, rx, rz) < 9) {
    trialRT.idx++;
    sfx.coin();
    if (trialRT.idx >= world.raceRoute.length) endTrial(true);
    else toast(`蓝环 ${trialRT.idx}/${world.raceRoute.length} · ${trialRT.t.toFixed(1)}s`, 1);
  }
  if (trialRT.t > 120) endTrial(false); // 两分钟没跑完自动作废
}

// ================= 封印的王室地窖 =================
const DGN = world.dungeon;
function inDungeon() {
  return player.pos.x > DGN.inX0 && player.pos.x < DGN.inX0 + DGN.inW &&
    player.pos.z > DGN.inZ0 && player.pos.z < DGN.inZ0 + DGN.inD;
}
// 守墓者:地窖常驻,黑暗中巡游(死后重生,不计任务)
for (const [gx, gz] of [[336, -296], [352, -272], [368, -300], [344, -252], [376, -276]]) {
  const b = addBandit(gx, gz, { hp: 2, speed: 6.2 });
  b.ambient = true;
  b.keeper = true;
}
function enterDungeon() {
  sfx.chest();
  player.pos.set(DGN.spawn.x, 0, DGN.spawn.z);
  player.vy = 0;
  toast('🕯️ 石阶向下,霉味和很久以前的香火味……这就是被封起来的那一层。', 4);
  remember('掀开了城堡后的暗门,走进被封印的王室地窖', 'crypt');
}
function exitDungeon() {
  sfx.chest();
  player.pos.set(DGN.hatch.x, 0, DGN.hatch.z + 2);
  player.vy = 0;
  toast('你爬回地面。阳光重得像一床棉被。', 3);
}
function takeRelic() {
  if (player.relic) {
    openDialog(['(圣坛空了。战徽在你身上——它记得回家的路,也认得新的主人。)']);
    return;
  }
  player.relic = true;
  sfx.fanfare();
  unlockAch('unsealer');
  remember('从王室地窖的圣坛上请下了「先王战徽」', 'relic');
  openDialog([
    '(圣坛上安放着一枚乌金战徽,八百年的灰尘盖不住它的锋利。)',
    '(你把它别上胸口。掌心的剑柄忽然顺手了许多——像有位老兵扶了一把。)',
    '☀️ 获得「先王战徽」:近战伤害 +1(永久)',
  ], () => saveGame());
}

// ================= 村务委托(无限支线:AI 写求助告示,离线用模板) =================
const CHORE_POS = { x: -9, z: 18 };
{
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), lambert(0x6b4a2f));
  post.position.set(CHORE_POS.x, 1.2, CHORE_POS.z);
  scene.add(post);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.08), lambert(0x9a7a4f, { roughness: 0.9 }));
  plank.position.set(CHORE_POS.x, 1.7, CHORE_POS.z);
  plank.rotation.y = 0.4;
  plank.castShadow = true;
  scene.add(plank);
}
const sideQuest = { active: false, type: null, goal: 0, progress: 0, reward: 0, text: '', giver: '' };
const CHORE_TYPES = [
  { key: 'wolves', label: '猎狼', goalMin: 2, goalMax: 4, reward: 14,
    tpl: (g, who) => `${who}求助:狼群夜里扒我家羊圈,好汉行行好,猎 ${g} 头恶狼,赏钱在村务板下。` },
  { key: 'herbs', label: '采蘑菇', goalMin: 3, goalMax: 5, reward: 11, consume: true,
    tpl: (g, who) => `${who}求助:家里病人等药引,求 ${g} 朵林间伞菇,采到放板下即可,谢过!` },
  { key: 'venison', label: '送鹿肉', goalMin: 2, goalMax: 3, reward: 13, consume: true,
    tpl: (g, who) => `${who}求助:办席短了硬菜,求 ${g} 块鲜鹿肉,价钱好说,板下自取。` },
  { key: 'fish', label: '钓鱼', goalMin: 2, goalMax: 3, reward: 10,
    tpl: (g, who) => `${who}求助:馋鱼了,腿脚又不便。替我钓 ${g} 条上来,赏钱压在石头底下。` },
  { key: 'bandits', label: '清匪', goalMin: 2, goalMax: 3, reward: 16,
    tpl: (g, who) => `${who}求助:路上又有劫道的了,哪位好汉料理掉 ${g} 个,让我进趟货?` },
  { key: 'ride', label: '骑行', goalMin: 400, goalMax: 700, reward: 12,
    tpl: (g, who) => `${who}求助:我那匹马缺操练,替我遛 ${g} 步(骑任意坐骑跑够里程即可)。` },
  { key: 'cook', label: '烤肉', goalMin: 1, goalMax: 2, reward: 9,
    tpl: (g, who) => `${who}求助:想念篝火烤肉的香味了,替我在野外篝火烤 ${g} 块,替我闻闻就行。` },
  { key: 'pray', label: '代祷', goalMin: 1, goalMax: 1, reward: 10,
    tpl: (g, who) => `${who}求助:腿脚不便,替我去荒野的小教堂石坛前祷告一回,心意板下奉上。` },
  { key: 'soak', label: '试泉', goalMin: 6, goalMax: 10, reward: 11,
    tpl: (g, who) => `${who}求助:听说荒野温泉能治腰,替我去泡 ${g} 息,回来告诉我烫不烫。` },
  { key: 'race', label: '跑圈', goalMin: 1, goalMax: 1, reward: 12,
    tpl: (g, who) => `${who}求助:跟人打赌说你能跑完赛旗全程,替我赢回这口气(完成一次计时赛)!` },
  { key: 'wish', label: '许愿', goalMin: 2, goalMax: 3, reward: 8,
    tpl: (g, who) => `${who}求助:我不敢见湖神,替我往喷泉里投 ${g} 枚金币许个愿,愿望内容我写好了压在板下。` },
  { key: 'throw', label: '扔鸡', goalMin: 2, goalMax: 3, reward: 9,
    tpl: (g, who) => `${who}求助:别问原因。把鸡扔出去 ${g} 次,要抛物线漂亮的。真的别问。` },
];
let choreSeq = 0;
function rollChore() {
  const myId = ++choreSeq;
  const t = CHORE_TYPES[Math.floor(Math.random() * CHORE_TYPES.length)];
  const goal = t.goalMin + Math.floor(Math.random() * (t.goalMax - t.goalMin + 1));
  const giver = VILLAGERS[Math.floor(Math.random() * VILLAGERS.length)].name;
  sideQuest.active = true;
  sideQuest.type = t.key;
  sideQuest.goal = goal;
  sideQuest.progress = 0;
  sideQuest._rideDone = false;
  sideQuest.reward = t.reward + (t.key === 'ride' ? Math.round(goal / 50) : goal * 2); // 骑行按里程折算,别按步数发钱
  sideQuest.giver = giver;
  sideQuest.text = t.tpl(goal, giver);
  // AI 把告示重写得更有生活气(异步替换,离线保持模板)
  aiLine(
    `你是中世纪村民「${giver}」。你在村务板贴一则求助告示:需要${goal}份「${t.label}」相关的东西` +
    `(${t.key === 'wolves' ? '猎除恶狼' : t.key === 'herbs' ? '林间伞菇' : t.key === 'venison' ? '鲜鹿肉' : '鲜鱼'})。` +
    '用中文写这则告示,40~70字,原因要具体、生活化、带点小情绪。只输出告示正文。', null, 9000,
  ).then((t2) => { if (t2 && sideQuest.active && choreSeq === myId) sideQuest.text = `${giver}求助:${t2}`; });
}
function choreProgress(kind) {
  if (!sideQuest.active || sideQuest.type !== kind) return;
  sideQuest.progress++;
  if (sideQuest.progress <= sideQuest.goal) {
    toast(`📋 村务【${sideQuest.giver}】:${sideQuest.progress}/${sideQuest.goal}`, 2);
  }
}
function choreReady() {
  if (!sideQuest.active) return false;
  if (sideQuest.type === 'herbs') return player.herbs >= sideQuest.goal;
  if (sideQuest.type === 'venison') return player.venison >= sideQuest.goal;
  return sideQuest.progress >= sideQuest.goal;
}
function choreBoard() {
  if (!sideQuest.active) {
    rollChore();
    sfx.accept();
    saveGame();
    openDialog([`(村务板贴着一张新告示)`, sideQuest.text,
      `(接下了。完成后回到村务板交差,赏钱 ${sideQuest.reward} 金币。)`]);
    return;
  }
  if (choreReady()) {
    if (sideQuest.type === 'herbs') player.herbs -= sideQuest.goal;
    if (sideQuest.type === 'venison') player.venison -= sideQuest.goal;
    player.coins += sideQuest.reward;
    sfx.fanfare();
    stats.chores = (stats.chores || 0) + 1;
    if (stats.chores >= 5) unlockAch('villagehero');
    remember(`替${sideQuest.giver}办妥了一桩村务`);
    openDialog([`(你把东西放在板下,拿走了压着的 ${sideQuest.reward} 枚金币。)`,
      `(${sideQuest.giver}不知何时在告示边添了一行小字:谢过恩公。)`]);
    sideQuest.active = false;
    saveGame();
    return;
  }
  const need = sideQuest.type === 'herbs' ? `${player.herbs}/${sideQuest.goal} 朵伞菇`
    : sideQuest.type === 'venison' ? `${player.venison}/${sideQuest.goal} 块鹿肉`
    : `${sideQuest.progress}/${sideQuest.goal}`;
  openDialog([sideQuest.text, `(进度:${need}。办妥了回来交差。)`]);
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
    (workspace.history.length ? `城中近事:${workspace.history[workspace.history.length - 1].t}。` : '') +
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
const FISH_SPOT_ISLE = { x: -103.5, z: 101.5 }; // 湖心岛深水钓点(渔获更肥)
const fishing = { active: false, phase: 'wait', t: 0 };
const CATCHES_DEEP = [
  { w: 34, text: '一条神殿银鱼!鳞片亮得像月光淬过——12 金币。', coins: 12 },
  { w: 26, text: '月光鲤!尾鳍拖着一道银线,渔村得供起来——20 金币!', coins: 20 },
  { w: 18, text: '一盏沉底铜灯,灯芯居然是干的。古董贩子给了 8 金币。', coins: 8 },
  { w: 14, text: '你钓到了湖神的一个呵欠。水面荡了三圈,什么也没留下。', coins: 0 },
  { w: 8,  text: '深水巨物!!差点把你拽下水——25 金币,够吹一年!', coins: 25, ach: 'bigfish' },
];
const CATCHES = [
  { w: 45, text: '一条小鲫鱼!老周按行价收了 3 金币。', coins: 3 },
  { w: 30, text: '一条肥鲤鱼!老周眼睛都亮了,给了 6 金币。', coins: 6 },
  { w: 12, text: '一只老靴子……老周说他找这只鞋找了十年,硬塞给你 2 金币。', coins: 2, ach: 'boot' },
  { w: 8,  text: '水草一团。人生就是这样。', coins: 0 },
  { w: 5,  text: '银月湖大鱼!!鱼尾拍得水花四溅——15 金币,今晚渔村有故事讲了!', coins: 15, ach: 'bigfish' },
];
function startFishing(deep = false) {
  fishing.active = true;
  fishing.deep = deep;
  fishing.phase = 'wait';
  fishing.t = 2.5 + Math.random() * 4;
  player.yaw = Math.PI; // 面向湖心
  toast(deep ? '🎣 深水抛竿……岛边的鱼更大,咬钩也更狠!' : '🎣 抛竿……盯紧浮漂,咬钩时按 E!', 3);
}
function fishingReel() {
  if (fishing.phase === 'bite') {
    const table = fishing.deep ? CATCHES_DEEP : CATCHES;
    const total = table.reduce((s, c) => s + c.w, 0);
    let roll = Math.random() * total;
    let got = table[0];
    for (const c of table) { roll -= c.w; if (roll <= 0) { got = c; break; } }
    const moonX2 = todaySpecial()?.key === 'fullmoon' && got.coins > 0;
    if (got.coins > 0) stats.fishCaught = (stats.fishCaught || 0) + 1;
    if (got.coins > 0) choreProgress('fish');
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
      stats.rescues = (stats.rescues || 0) + 1;
      remember(`从盗贼刀下救回了${v.id.name}`);
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
  bountyRT.crime = null;
  if (!AI_TEXT_OFF) {
    aiLine(`为中世纪通缉犯「${bountyRT.name}」编一条罪状,12~25字,越具体越好笑越好,只输出罪状本身。`, null, 8000)
      .then((t) => { if (t) bountyRT.crime = t; });
  }
  sfx.accept();
  openDialog([`(揭下悬赏令)通缉要犯「${bountyRT.name}」,现身于${place}一带。生死不论,赏金 30 枚。`], null,
    wantedPosterSpeaker());
}
// 悬赏令上的通缉画像:AI 按罪犯名字现画一张(种子固定,同一人永远同一张脸)
function wantedPosterSpeaker() {
  return { key: null, name: bountyRT.name, desc: 'scarred wanted outlaw criminal, rough charcoal wanted-poster sketch' };
}
function updateBounty(dt) {
  if (bountyRT.cooldown > 0) bountyRT.cooldown -= dt;
  if (bountyRT.target && bountyRT.target.dead) {
    player.coins += 30;
    sfx.fanfare();
    stats.bounties = (stats.bounties || 0) + 1;
    remember(`将悬赏要犯「${bountyRT.name}」缉拿归案`);
    toast(`📜 「${bountyRT.name}」已伏法,赏金 30 金币到手!`, 4);
    bountyRT.target = null;
    bountyRT.cooldown = 30;
    saveGame();
  }
}

// ================= 置业:湖畔小屋(玩家自己的家) =================
const HOME = { x: -82, z: 66, doorX: -82, doorZ: 68.6, price: 200 };
const homeRT = { sign: null, signCtx: null };
{
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), lambert(0xd8cbaa, { roughness: 0.92 }));
  wall.position.y = 1.3;
  wall.castShadow = wall.receiveShadow = true;
  g.add(wall);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.9, 4), lambert(0x8a4a2e, { roughness: 0.85 }));
  roof.position.y = 3.55;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.7), lambert(0x5a3a20, { roughness: 0.95 }));
  door.position.set(0, 0.85, 2.02);
  g.add(door);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x2a3a50, emissive: 0xffd27a, emissiveIntensity: 0.3, roughness: 0.4 }));
  win.position.set(1.6, 1.5, 2.02);
  g.add(win);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
  post.position.set(-1.9, 0.65, 2.6);
  g.add(post);
  const sc = document.createElement('canvas');
  sc.width = 128;
  sc.height = 64;
  homeRT.signCtx = sc.getContext('2d');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide, roughness: 0.95 }));
  sign.position.set(-1.9, 1.35, 2.6);
  g.add(sign);
  homeRT.sign = sign;
  g.position.set(HOME.x, 0, HOME.z);
  scene.add(g);
  colliders.boxes.push({ minX: HOME.x - 2.7, maxX: HOME.x + 2.7, minZ: HOME.z - 2.2, maxZ: HOME.z + 2.2 });
  // 信箱:买房后出现;有信时小红旗立起,信直接寄到家
  const mb = new THREE.Group();
  const mpost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
  mpost.position.y = 0.55;
  mb.add(mpost);
  const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.35), lambert(0x8a4a2e, { roughness: 0.8 }));
  mbox.position.y = 1.2;
  mbox.castShadow = true;
  mb.add(mbox);
  const mflag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xe83a4e, emissive: 0x7a0f1c, emissiveIntensity: 0.45 }));
  mflag.position.set(0.3, 1.45, 0);
  mb.add(mflag);
  mb.position.set(HOME.x + 3.4, 0, HOME.z + 3.2);
  mb.visible = false;
  scene.add(mb);
  homeRT.mailbox = mb;
  homeRT.mailFlag = mflag;
}
function paintHomeSign() {
  const c = homeRT.signCtx;
  c.fillStyle = '#d8c9a0';
  c.fillRect(0, 0, 128, 64);
  c.fillStyle = '#5a3a1a';
  c.textAlign = 'center';
  if (player.home) {
    c.font = 'bold 22px serif';
    c.fillText('林恩的小屋', 64, 40);
  } else {
    c.font = 'bold 20px serif';
    c.fillText('出售', 64, 28);
    c.font = '16px serif';
    c.fillText(`${HOME.price} 金币`, 64, 52);
  }
  homeRT.sign.material.map.needsUpdate = true;
}
paintHomeSign();
// 战利品墙:成就长在自家外墙上——战徽挂门楣,大鱼上木牌,双剑交叉,狼牙成串
function refreshTrophies() {
  if (!player.home) return;
  if (homeRT.trophies) scene.remove(homeRT.trophies);
  const t = new THREE.Group();
  const has = (k) => achUnlocked.includes(k);
  if (player.relic || has('unsealer')) {
    const m = new THREE.Mesh(crestG, new THREE.MeshStandardMaterial({
      color: 0xd4af37, emissive: 0x8a5c00, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.3 }));
    m.position.set(0, 2.25, 2.06);
    t.add(m);
  }
  if (player.blackstoneToken) { // 黑石断刀徽记:报复之战的凭证
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.05), lambert(0x2a2a30, { roughness: 0.9 }));
    plaque.position.set(0.7, 2.3, 2.05);
    t.add(plaque);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.85, roughness: 0.3 }));
    blade.rotation.z = 0.5;
    blade.position.set(0.7, 2.3, 2.09);
    t.add(blade);
  }
  if (has('bigfish')) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.05), lambert(0x5a3a20, { roughness: 0.95 }));
    plank.position.set(-1.6, 1.75, 2.05);
    t.add(plank);
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x9ab8d0, metalness: 0.6, roughness: 0.35 }));
    fish.rotation.z = Math.PI / 2;
    fish.position.set(-1.6, 1.75, 2.1);
    t.add(fish);
  }
  if (has('gladiator')) {
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 }));
      sw.rotation.z = 0.65 * s;
      sw.position.set(1.6, 1.95, 2.05);
      t.add(sw);
    }
  }
  if (has('packmate')) {
    for (let i = 0; i < 5; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5),
        lambert(0xe8e4da, { roughness: 0.6 }));
      fang.rotation.x = Math.PI;
      fang.position.set(-0.5 + i * 0.25, 2.5, 2.05);
      t.add(fang);
    }
  }
  // 战团军旗:每面挂一杆,最多陈列六面——满墙都是别人的败绩
  if (stats.banners) {
    for (let i = 0; i < Math.min(6, stats.banners); i++) {
      const x = -2.3 + i * 0.92;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6),
        lambert(0x4a3826, { roughness: 0.9 }));
      pole.position.set(x, 2.62, 2.05);
      t.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
        lambert(0x6a1520, { roughness: 0.95 }));
      flag.position.set(x + 0.27, 2.88, 2.06);
      t.add(flag);
    }
  }
  t.position.set(HOME.x, 0, HOME.z);
  scene.add(t);
  homeRT.trophies = t;
}
function updateHome() {
  if (!homeRT.mailbox) return;
  homeRT.mailbox.visible = !!player.home;
  homeRT.mailFlag.visible = !!letter;
}

// 萤火相随:替这颗心实现三个心愿后的谢礼——一点它自己的光,入夜后绕着你飞
const fireflyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
  new THREE.MeshBasicMaterial({ color: 0xd8ffa0, transparent: true, opacity: 0.95 }));
fireflyMesh.visible = false;
scene.add(fireflyMesh);
function updateFirefly() {
  const ph = dayPhase();
  const show = !!player.firefly && !player.dead && (ph === 'night' || ph === 'dusk');
  fireflyMesh.visible = show;
  if (!show) return;
  const t = nowMs * 0.001;
  fireflyMesh.position.set(
    player.pos.x + Math.cos(t * 1.3) * (0.9 + Math.sin(t * 0.7) * 0.25),
    1.55 + Math.sin(t * 2.1) * 0.28,
    player.pos.z + Math.sin(t * 1.3) * (0.9 + Math.cos(t * 0.9) * 0.25));
  fireflyMesh.material.opacity = 0.65 + Math.sin(t * 5.2) * 0.3; // 一明一灭地呼吸
}
function homeInteract() {
  if (!player.home) {
    if (player.coins >= HOME.price) {
      player.coins -= HOME.price;
      player.home = true;
      paintHomeSign();
      refreshTrophies();
      sfx.fanfare();
      remember('买下了苇岸边的湖畔小屋,在艾尔德里亚安了家', 'home-buy');
      unlockAch('homeowner');
      openDialog([
        `(你数出 ${HOME.price} 枚金币,村长把一把黄铜钥匙放进你手心)`,
        '门轴吱呀一响——一张床、一扇窗、一整面湖,从今天起都是你的了。',
        '门口的木牌翻了个面:「林恩的小屋」。晚上回来睡一觉,第二天走路都带风。',
      ]);
    } else {
      openDialog([`(出售)湖畔小屋:一张床、一扇窗、一整面湖。售价 ${HOME.price} 金币,你还差 ${HOME.price - player.coins} 枚。`]);
    }
    return;
  }
  if (wanted > 0) {
    openDialog(['(你从门缝往外看)卫兵正在苇丛边晃悠。通缉犯睡不了安稳觉——先去摆平通缉再回家。']);
    return;
  }
  if (player.homeDay === calendar.day) {
    openDialog(['(床还带着体温)今天已经睡过了……再睡下去就要长进床里了。']);
    return;
  }
  sleepToMorning();
  queueDream();
  player.homeDay = calendar.day;
  sfx.heart();
  saveGame();
  openDialog(['(自己的床就是不一样)一觉睡到大天亮,窗外湖光正好。今天浑身是劲。(安眠:移动 +8%)']);
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
    if (stats.arenaBest >= 3) remember(`在血牙的沙圈里撑到了第 ${stats.arenaBest} 波`);
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
        end() { // 事件狼不留后患:活的散场,死的收尸,谁也别在村口安家
          for (const w of pack) {
            w.raidTarget = null;
            scene.remove(w.group);
            const i = wolves.indexOf(w);
            if (i >= 0) wolves.splice(i, 1);
            if (lockFoe === w) { lockFoe = null; lockMark.visible = false; }
          }
        },
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
    key: 'brawl', w: 7,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 12, 76) < 4900,
    start() {
      const rowdies = [];
      for (let i = 0; i < 3; i++) {
        const b = addBandit(17 + i * 2.2, 78.5 + (i % 2) * 2.4, { hp: 2, dmg: 1, speed: 4.6 });
        b.eventFoe = true;
        rowdies.push(b);
      }
      toast('📣 旅店门口打起来了!罗莎喊:「谁把这几个醉鬼放倒,今晚酒钱全免!」', 4);
      sfx.wanted();
      return {
        t: 75,
        update() {
          if (rowdies.every((b) => b.dead)) {
            player.coins += 15;
            player.drunkT = Math.max(player.drunkT, 18); // 罗莎说到做到,真按来一大杯
            sfx.fanfare();
            remember('替罗莎撂倒了三个闹事的醉鬼');
            toast('🍺 醉鬼全被撂倒!罗莎塞来 15 金币,还真端来一大杯麦酒。', 4);
            this.t = 0;
          }
        },
        end() {
          for (const b of rowdies) {
            if (!b.dead) { scene.remove(b.group); const i = bandits.indexOf(b); if (i >= 0) bandits.splice(i, 1); }
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
      g.group.traverse((o) => { // 克隆后再改:共享材质缓存动不得,不然全城人跟着变半透明
        if (o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.4;
        }
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
      c.eventKeep = true;
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
            remember('追到了传说中的金鸡,它在怀里化成了金币', 'goldhen');
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
    director.ageT = (director.ageT || 0) + dt;
    if (h.update) h.update(dt);
    if (h.t <= 0) {
      if (h.end) h.end();
      // 排片演化:提前收场 = 玩家真参与了,这类戏加分;演满全场没人理,减分
      if (director.key) {
        const engaged = director.ageT < (director.dur || 0) - 0.5;
        EVO.eventFit[director.key] = Math.max(-2, Math.min(4,
          (EVO.eventFit[director.key] || 0) + (engaged ? 1 : -0.3)));
      }
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
  // 满月夜里亡魂更容易现身;世界的心境挑它爱看的戏(意识 → 行为的闭环)
  const COMIC = ['goldenChicken', 'chickenRiot', 'coinRain', 'wiseCow', 'roastRunaway', 'wedding', 'starShower', 'brawl'];
  const SOMBER = ['wolfRaid', 'ghost', 'funeral', 'tollAmbush', 'convict', 'wishThief'];
  const wOf = (e) => {
    let w2 = e.w;
    if (e.key === 'ghost' && todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night') w2 *= 4;
    const v = workspace.mood.v;
    if (COMIC.includes(e.key)) w2 *= 1 + Math.max(0, v) * 1.2 - Math.max(0, -v) * 0.5;
    if (SOMBER.includes(e.key)) w2 *= 1 + Math.max(0, -v) * 0.9;
    // 学出来的性情也挑戏:盯着危险长大的心多排阴郁戏,恋着人间烟火的心多排喜剧
    if (SOMBER.includes(e.key)) w2 *= 0.5 + 0.5 * (MIND.gains.threat ?? 1);
    if (COMIC.includes(e.key)) w2 *= 0.5 + 0.25 * ((MIND.gains.body ?? 1) + (MIND.gains.wealth ?? 1));
    w2 *= 1 + 0.12 * (EVO.eventFit[e.key] || 0); // 排片演化:观众用脚投票
    return Math.max(0.1, w2);
  };
  let total = pool.reduce((s, e) => s + wOf(e), 0);
  let roll = Math.random() * total;
  let ev = pool[0];
  for (const e of pool) { roll -= wOf(e); if (roll <= 0) { ev = e; break; } }
  dailyEvents--;
  director.handle = ev.start();
  director.key = ev.key;
  director.dur = director.handle ? director.handle.t : 0;
  director.ageT = 0;
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
  mirror:   { name: '照见自己', desc: '与北境边缘的回响之镜对视' },
  parry:    { name: '见招拆招', desc: '完成 5 次完美弹反' },
  lawless:  { name: '无法无天', desc: '把全城卫兵同时放倒' },
  warbreaker: { name: '破军', desc: '全歼一支盗贼战团' },
  wallkeeper: { name: '守城人', desc: '与卫兵并肩击退攻城大军' },
  champion:   { name: '阵前斩将', desc: '单挑斩落枭首,吓散整支战团' },
  rampage:  { name: '一骑当千', desc: '一场战斗内 8 连杀' },
  chef:     { name: '野炊大师', desc: '在篝火上烤 5 块鹿肉' },
  packmate: { name: '孤狼不再', desc: '驯服白狼「霜牙」' },
  soak:     { name: '泡汤客', desc: '在温泉里泡满 30 秒' },
  lakegift: { name: '湖神的恩赐', desc: '触碰湖心岛的月光祭坛(生命上限 +2)' },
  unsealer: { name: '开封者', desc: '走进被封印的王室地窖,请下先王战徽' },
  villagehero: { name: '村里的自己人', desc: '办妥 5 桩村务委托' },
  rider:    { name: '千里驹', desc: '骑行累计 5000 步' },
  fortune:  { name: '问卦者', desc: '找玛尔戈求 3 卦' },
  penpal:   { name: '有信之人', desc: '收到 3 封来信' },
  deept:    { name: '打破砂锅', desc: '追问 10 次(T 键)' },
  sailor:   { name: '摆渡客', desc: '乘小船往返湖心岛 6 趟' },
  slayer:   { name: '百战游侠', desc: '击败 100 个敌人' },
  ironarm:  { name: '铁臂之上', desc: '掰手腕赢下铁臂加隆 3 次' },
  homeowner:{ name: '置业成家', desc: '买下苇岸边的湖畔小屋' },
  wishkeeper:{ name: '代它看世界', desc: '替这颗心实现 3 个心愿(夜里有萤火谢你)' },
  mage:     { name: '半路出家的法师', desc: '施放 30 次法术' },
  dovah:    { name: '龙之传人', desc: '在龙骨之地的龙颅前学会冲击战吼' },
  cutpurse: { name: '三只手', desc: '扒窃得手 5 次' },
  walldef:  { name: '南门之盾', desc: '击退黑石兄弟会的劫掠' },
  executioner: { name: '断头台的同行', desc: '处决 10 个踉跄中的敌人' },
  vendetta:  { name: '斩草除根', desc: '了结黑石兄弟会的报复(斩杀刻刀维克)' },
  blackmkt:  { name: '黑市常客', desc: '向玛尔戈销赃 10 件' },
  elder:    { name: '长住者', desc: '在艾尔德里亚度过 30 日' },
  navigator:{ name: '远行者', desc: '走到离王都一万步之外' },
};
const stats = { thrown: 0, pecks: 0, wishes: 0, drunks: 0, loseStreak: 0, sheepDist: 0, lastStomp: -99, deer: 0, mushrooms: 0 };
let achUnlocked = [];
function unlockAch(key) {
  if (achUnlocked.includes(key)) return;
  achUnlocked.push(key);
  sfx.fanfare();
  toast(`🏆 无意义成就:${ACH_DEFS[key].name} —— ${ACH_DEFS[key].desc}`, 4);
  remember(`做成了一件事,人称「${ACH_DEFS[key].name}」`, `ach-${key}`);
  if (player.home) refreshTrophies(); // 新战利品当场挂上外墙
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
  merccap: {
    name: '佣兵队长布兰', spot: [20, 84, -2.2],
    style: { shirt: 0x4a4f58, pants: 0x2e3138, hair: 0x3a2e20, helmet: true, sword: true },
    idle: [
      '刀口上讨生活,讲的就是个明码标价。',
      '我的人不问雇主要去哪,只问多少钱。',
      '狼牙关那仗以后,我就再没为"大义"两个字拔过刀。',
      '想雇人?40 金币一位,每天 5 金币饷。战场上见真章。',
    ],
  },
  strongman: {
    name: '铁臂加隆', spot: [24, 81, -1.4],
    style: { shirt: 0x7a3a2a, pants: 0x3a3026, hair: 0x2a2018 },
    idle: [
      '这条胳膊掰弯过马蹄铁。马当时也在。',
      '旅店的桌子换了三张,都是被我掰坏的。',
      '有人说我靠蛮力。胡说,我还靠体重。',
      '祖传的手艺:我爷爷掰赢过一头熊。熊自己承认的。',
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

// 掰手腕:酒馆前的力量赌局——狂按 E 把加隆的手压下去
const ARM_SPOT = { x: 24, z: 81 };
const armRT = { active: false, meter: 0.5, t: 0, cooldown: 0 };
function armWrestle() {
  if (armRT.active) return;
  if (armRT.cooldown > 0) {
    openDialog(['加隆:(甩着胳膊)让我缓缓……你这细胳膊哪来这么大的劲。']);
    return;
  }
  if (player.coins < 15) {
    openDialog(['加隆:(把蒲扇大的手一摊)赌注 15 金币。没钱?先去搬一天砖,练练再来。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
    return;
  }
  player.coins -= 15;
  armRT.active = true;
  armRT.meter = 0.5;
  armRT.t = 0;
  sfx.accept();
  toast('💪 掰手腕开始!狂按 E 把他的手压下去!!', 2.5);
  if (!AI_TEXT_OFF) {
    aiLine('你是中世纪酒馆大力士铁臂加隆,自称掰弯过马蹄铁。开赛瞬间对挑战者喊一句25字以内的垃圾话,越具体越好笑越好,只输出那句话。', null, 5000)
      .then((t) => { if (t && armRT.active) toast(`💪 加隆:${t}`, 2.5); });
  }
}
function armPress() {
  armRT.meter = Math.min(1.05, armRT.meter + 0.055);
  sfx.clank();
}
function endArm(win, note) {
  armRT.active = false;
  armRT.cooldown = 6;
  if (win) {
    player.coins += 30;
    stats.arms = (stats.arms || 0) + 1;
    sfx.fanfare();
    remember('掰手腕赢了铁臂加隆,赢走 30 金币');
    if (stats.arms >= 3) unlockAch('ironarm');
    openDialog(['加隆:(不可置信地盯着自己被按平的手)……我输了?我输了!!好小子,30 金币拿走——下回我可不让你了!'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  } else {
    sfx.hit();
    openDialog([note || '加隆:(啪的一声把你的手背按在桌上)哈——!承让承让,15 金币进了今晚的酒钱。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  }
  saveGame();
}
function updateArm(dt) {
  if (armRT.cooldown > 0) armRT.cooldown -= dt;
  if (!armRT.active) return;
  armRT.t += dt;
  if (dist2(player.pos.x, player.pos.z, ARM_SPOT.x, ARM_SPOT.z) > 30) {
    endArm(false, '加隆:(冲你的背影喊)哎——手都没松你人先跑了?!赌注归我啦!');
    return;
  }
  armRT.meter -= (0.16 + Math.min(0.18, armRT.t * 0.022)) * dt; // 拖得越久他劲越大
  if (armRT.meter >= 1) endArm(true);
  else if (armRT.meter <= 0 || armRT.t > 15) endArm(false);
}

// 吟游诗人:按你的真实事迹即兴打油诗(联网时由 AI 现场作词)
async function bardSong() {
  if (aiBusy.bard) return;
  aiBusy.bard = true;
  try {
    await bardSongInner();
  } finally {
    aiBusy.bard = false;
  }
}
async function bardSongInner() {
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
  if (dialog.open || player.dead) return; // 等歌期间玩家已在别的对话里/倒下了,别打断
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
  if (aiBusy.tale) return;
  aiBusy.tale = true;
  try {
    await tellStoryInner();
  } finally {
    aiBusy.tale = false;
  }
}
async function tellStoryInner() {
  sfx.chest();
  toast('🎙️ 苟叔捋了捋胡子,烟杆在桌沿磕了磕……', 2);
  const sp = todaySpecial();
  const ai = await aiLine(
    `你是中世纪王国旅店里的盲眼说书人苟叔。现在是${SEASONS[seasonIdx()]}季${sp ? '·' + sp.name : ''}。${wsReport()}` +
    '用中文讲一个三句话的小故事,关于艾尔德里亚王国(可用素材:龙骨之地的老龙、银月湖底神殿、先祖石环、迷途丘陵、狼月、许愿池湖神、会开门的驴;若上面给了"此刻意识里的内容",可让故事悄悄偏向它)。' +
    '要有起承转合和一个妙尾,三分怪谈七分人味。只输出故事正文,不要引号。', null, 8000);
  if (dialog.open || player.dead) return; // 等故事期间玩家已在别的对话里/倒下了,别打断
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
  choreProgress('wish');
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

// ================= 运行时对话组合引擎(数亿字组合空间,零加载) =================
// 情境开场 × 语气前缀 × 内容主体(12 类语料)× 口头禅收尾,按角色声线现场拼装;
// 类目按当下情境加权(下雨多聊雨,节庆多聊节,主线推进聊时事),近期说过的不复读。
const lineRecent = new Map();
function dbLine(key) {
  const V = BANKS.VOICES[key];
  if (!V) return null;
  const phase = dayPhase();
  const w = weather.state === 'cloudy' ? 'clear' : weather.state;
  const seasonKey = ['spring', 'summer', 'autumn', 'winter'][seasonIdx()];
  const sp = todaySpecial();
  const rnd = Math.random;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tail = () => (rnd() < 0.5 ? pick(V.tails) : '');
  const mood = () => (rnd() < 0.3 ? pick(V.mood) : '');
  const opener = (ctx) => (rnd() < 0.6 && BANKS.OPENERS[ctx] ? pick(BANKS.OPENERS[ctx]) : '');
  const clean = (t) => t.replace(/[。!?…]+$/, ''); // 语料自带句号时避免"。。"
  const cats = [
    ['job', 3], ['weather', w !== 'clear' ? 3 : 1], ['season', 2],
    ['festival', sp ? 3 : 0], ['gossip', 2.2], ['rumor', 2.2], ['place', 1.4],
    ['stage', 1.6], ['proverb', 1], ['memory', 1.2], ['smalltalk', 1.6], ['greet', 0.8],
  ].filter(([, wgt]) => wgt > 0);
  const total = cats.reduce((s2, c) => s2 + c[1], 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    let roll = rnd() * total;
    let cat = cats[0][0];
    for (const [c, wgt] of cats) { roll -= wgt; if (roll <= 0) { cat = c; break; } }
    let text = null;
    if (cat === 'job') {
      const jobs = [...(BANKS.JOB_EXTRA[key] || [])];
      if (key.startsWith('v')) {
        const vi = +key.slice(1);
        if (VILLAGERS[vi]) jobs.push(...VILLAGERS[vi].lines.map((l) => l.replace(/[。!?]$/, '')));
      }
      if (jobs.length) text = `${opener(phase)}${mood()}${clean(pick(jobs))}。${tail()}`;
    } else if (cat === 'weather') {
      const bank = BANKS.WEATHER_TALK[w];
      if (bank) text = `${opener(w)}${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'season') {
      text = `${opener(phase)}${mood()}${clean(pick(BANKS.SEASON_TALK[seasonKey]))}。${tail()}`;
    } else if (cat === 'festival') {
      const bank = BANKS.FESTIVAL_TALK[sp.key];
      if (bank) text = `${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'gossip') {
      const others = Object.keys(BANKS.FACTS).filter((k2) => k2 !== key);
      const other = pick(others);
      text = `${mood()}${pick(BANKS.GOSSIP_FRAMES).replace('{name}', BANKS.NAMES[other]).replace('{fact}', pick(BANKS.FACTS[other]))}${tail()}`;
    } else if (cat === 'rumor') {
      // 活语料:世界自己写的传闻混进既有语料一起流传
      const rpool = EVO.corpus.length && rnd() < 0.35 ? EVO.corpus : BANKS.RUMORS;
      text = `${mood()}${pick(BANKS.RUMOR_FRAMES).replace('{r}', clean(pick(rpool)))}${tail()}`;
    } else if (cat === 'place') {
      const p = pick(Object.keys(BANKS.PLACES));
      text = `${pick(BANKS.PLACE_FRAMES).replace('{p}', p).replace('{f}', pick(BANKS.PLACES[p]))}${tail()}`;
    } else if (cat === 'stage') {
      const q = Math.min(quest.idx, BANKS.STAGE_TOPICS.length - 1);
      text = `${mood()}${pick(BANKS.STAGE_FRAMES).replace('{t}', pick(BANKS.STAGE_TOPICS[q])).replace('{who}', pick(BANKS.WHO))}${tail()}`;
    } else if (cat === 'proverb') {
      text = `${mood()}${pick(BANKS.PROVERB_FRAMES).replace('{p}', pick(BANKS.PROVERBS))}${tail()}`;
    } else if (cat === 'memory') {
      const mems = BANKS.MEMORIES[key];
      if (mems && mems.length) {
        text = `${mood()}${pick(['说起来,{m}……', '有时想起,{m}。', '{m}——一晃这么多年了。', '跟你说件旧事:{m}。']).replace('{m}', clean(pick(mems)))}${tail()}`;
      }
    } else if (cat === 'smalltalk') {
      if (BANKS.SMALLTALK.length) text = `${rnd() < 0.4 ? opener(phase) : ''}${mood()}${pick(BANKS.SMALLTALK)}${tail()}`;
    } else if (cat === 'greet') {
      text = `${pick(BANKS.OPENERS[phase])}${V.addr},${pick(['又见面了', '有何贵干', '今天气色不错', '路上顺利吗', '别来无恙'])}。${tail()}`;
    }
    if (!text) continue;
    let recent = lineRecent.get(key);
    if (!recent) { recent = []; lineRecent.set(key, recent); }
    if (recent.includes(text)) continue; // 近期说过,换一句
    recent.push(text);
    if (recent.length > 40) recent.shift();
    return text;
  }
  return null;
}

// ================= 运行时 AI 文本(免费接口,离线回退) =================
const AI_TEXT_OFF = new URLSearchParams(location.search).has('noai');
async function aiLine(prompt, fallback, timeoutMs = 7000) {
  if (AI_TEXT_OFF) return fallback;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let t;
    try {
      const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        { signal: ctrl.signal });
      if (!r.ok) return fallback;
      t = (await r.text()).trim(); // 计时器覆盖响应体读取:卡住的流也会被中止
    } finally {
      clearTimeout(timer);
    }
    if (!t || t.length > 400) return fallback;
    return t;
  } catch {
    return fallback;
  }
}
// AI 输出口的忙碌标记:等待期间重复按 E 不再重复请求/重复开对话
const aiBusy = { mirror: false, tale: false, bard: false, prophet: false, dream: false, deep: false, epitaph: false, fortune: false };
let epitaphAI = null; // AI 补写的下一条墓志铭

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
  const deepHint = dialog.speaker ? ' · T 追问' : '';
  document.getElementById('dialog-hint').textContent =
    (dialog.idx < dialog.pages.length - 1 ? `▼ E (${dialog.idx + 1}/${dialog.pages.length})` : '▼ E 结束') + deepHint;
}

function openDialog(pages, onDone = null, speaker = null) {
  if (!pages.length) return;
  dialog.open = true;
  dialog.pages = pages;
  dialog.idx = 0;
  dialog.onDone = onDone;
  dialog.speaker = speaker;
  if (speaker && speaker.name && !player.dead) { // 羁绊:它记着你最常找谁说话
    MIND.bond[speaker.name] = Math.min(999, (MIND.bond[speaker.name] || 0) + 1);
  }
  bubble.timer = 0; // 对话时收起闲聊气泡
  dialogEl.style.display = 'block';
  setPortrait(speaker);
  renderDialogPage();
}

const VILLAGER_DESC_EN = [
  'baker woman', 'cloth merchant', 'fruit seller woman', 'spice merchant', 'carpenter',
  'washerwoman gossip', 'farmer', 'farm wife', 'hunter with bow', 'old one-legged soldier',
  'blacksmith apprentice boy', 'scribe woman with ink', 'shepherd girl', 'inn serving boy', 'old lamplighter',
  'fisher girl', 'boat builder', 'old miller', 'gravekeeper with shovel', 'stubborn village chief with pipe',
  'lame scythe grinder', 'old herbalist woman'];
const NPC_DESC_EN = {
  steward: 'royal steward with ledger', king: 'melancholy old king', blacksmith: 'scarred master blacksmith',
  trader: 'horse trader woman', innkeep: 'warm innkeeper woman', fisher: 'old fisherman with straw hat',
  witch: 'swamp witch stirring a pot', gambler: 'grinning dice gambler', bard: 'flamboyant lute bard',
  prophet: 'wild-eyed mad prophet', quixote: 'rusty windmill knight', storyteller: 'blind old storyteller with pipe',
  strongman: 'burly bald tavern strongman with huge arms',
};
// ---- AI 肖像:每位说话人一张(pollinations 生成,种子固定,浏览器缓存;离线自动隐藏) ----
const portraitEl = document.getElementById('dialog-portrait');
function strSeed(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 100000;
}
function setPortrait(speaker) {
  if (!portraitEl) return;
  if (!speaker || !speaker.desc || AI_TEXT_OFF) {
    portraitEl.style.display = 'none';
    return;
  }
  const prompt = `storybook watercolor bust portrait of a medieval ${speaker.desc}, warm candlelight, parchment background, no text`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=128&height=128&nologo=true&seed=${strSeed(speaker.name)}`;
  if (portraitEl.dataset.url !== url) {
    portraitEl.style.display = 'none';
    portraitEl.dataset.url = url;
    portraitEl.onload = () => { if (portraitEl.dataset.url === url) portraitEl.style.display = 'block'; };
    portraitEl.onerror = () => { portraitEl.style.display = 'none'; };
    portraitEl.src = url;
  } else if (portraitEl.complete && portraitEl.naturalWidth > 0) {
    portraitEl.style.display = 'block';
  }
}

// ---- 女巫占卜:5 金币一卦。她算得准——因为明日的历法本来就是定数 ----
async function witchFortune(n) {
  aiBusy.fortune = true;
  sfx.dice();
  const tday = calendar.day + 1;
  const ts = (() => {
    const save = calendar.day;
    calendar.day = tday;
    const sp = todaySpecial();
    calendar.day = save;
    return sp;
  })();
  const truth = ts ? `明日恰逢「${ts.name}」(${ts.desc})` : '明日无节无庆,是寻常的一天';
  const who = archetype();
  const fb = ts
    ? `玛尔戈:(汤勺搅出一个旋)水里翻出字来了……明日${ts.name}。${ts.desc}。信不信由你,反正水不骗人。`
    : `玛尔戈:(盯着汤面)明日无风无浪。对你这样的「${who}」来说,没消息就是好消息。`;
  toast('🔮 玛尔戈往锅里撒了一撮灰……', 2);
  const ai = await aiLine(
    `你是中世纪沼泽女巫玛尔戈,收了5金币给玩家占卜。已知天机:${truth};玩家在世界眼里是个「${who}」` +
    `${recallLine() ? `;他做过:${recallLine()}` : ''}。用中文说一段40~70字的卦辞:神叨、准确(必须把明日的天机说进去)、结尾带一句似是而非的忠告。只输出卦辞。`,
    null, 9000);
  aiBusy.fortune = false;
  if (dialog.open || player.dead) return; // 半路走开:卦不开,钱不收
  player.coins -= 5;
  stats.fortunes = (stats.fortunes || 0) + 1;
  if (stats.fortunes >= 3) unlockAch('fortune');
  openDialog([ai ? `玛尔戈:${ai}` : fb], null,
    { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
  remember('花五枚金币,听沼泽女巫算了一卦');
}

// ---- T 键追问:让 AI 顺着刚才的话往深里说(离线回退对话库) ----
async function deepTalk() {
  const sp = dialog.speaker;
  if (!sp || aiBusy.deep || dialog.typing) return;
  aiBusy.deep = true;
  stats.deepTalks = (stats.deepTalks || 0) + 1;
  if (stats.deepTalks >= 10) unlockAch('deept');
  const lastLine = (dialog.fullText || '').slice(0, 70);
  const ent = sp.ent || sp;
  const hist = ent.deepHist || [];
  toast('(对方想了想……)', 1.2);
  const fb = (sp.key && dbLine(sp.key)) || '这话说来就长了……改天,改天一定跟你细说。';
  const t = await aiLine(
    `你是中世纪王国艾尔德里亚的${sp.name}${sp.desc ? `(${sp.desc}的身份)` : ''}。你刚对玩家说:"${lastLine}"。` +
    `${hist.length ? `此前你还提过:${hist.join(';')}。` : ''}${wsReport()}` +
    '玩家追问了一句,请顺着话头往深里再说一句(60字以内),口语化、符合身份、带点没说完的余味。不要引号,不要名字前缀。', fb, 9000);
  aiBusy.deep = false;
  if (!dialog.open || dialog.speaker !== sp) return; // 对话已换场,别插话
  ent.deepHist = [...hist.slice(-1), t.slice(0, 50)];
  dialog.pages.push(`${sp.name}:${t}`);
  dialog.idx = dialog.pages.length - 1;
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
  const sp = { key: n.key, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n };
  if (arcIdx >= 0 && !n.readArcs.has(arcIdx)) {
    n.readArcs.add(arcIdx);
    const greet = TIME_GREETINGS[dayPhase()];
    openDialog([
      `${n.def.name}:${greet[Math.floor(Math.random() * greet.length)]}`,
      ...d.arcs[arcIdx].pages,
    ], onDone, sp);
  } else {
    // 故事读完后:手写闲聊与对话库轮换
    const line = Math.random() < 0.4
      ? d.small[n.lineIdx++ % d.small.length]
      : `${n.def.name}:${dbLine(n.key) || d.small[n.lineIdx++ % d.small.length]}`;
    openDialog([line], onDone, sp);
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
    if (now - last < 25000 * (workspace.mood.v > 0.2 ? 0.6 : workspace.mood.v < -0.2 ? 1.5 : 1)) continue;
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
document.getElementById('btn-style').textContent = `画风:${STYLE_PRESETS[styleKey].name}`;
document.getElementById('btn-style').onclick = () => {
  document.getElementById('btn-style').textContent = `画风:${cycleStyle()}`;
};
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
  spawnDust(e.pos.x, 1.0, e.pos.z, 3, 0.45, 1.4); // 命中扬尘:刀刀有反馈
  // 受击弹跳:横向鼓一下再弹回,肉眼可见的"挨了一记"
  if (!e._popping) {
    e._popping = true;
    e.group.scale.x *= 1.14;
    e.group.scale.z *= 1.14;
    setTimeout(() => { e.group.scale.x /= 1.14; e.group.scale.z /= 1.14; e._popping = false; }, 90);
  }
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
    if (Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > 10000) unlockAch('navigator');
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
const SEASON_GROUND = [0xf2ead8, 0xe8e2c8, 0xd8a860, 0xdfe6ec]; // tussock 调:春秋金棕,夏钝卡其
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
    if (s === 0) c.setHSL(0.14 + r * 0.05, 0.22, 0.38 + r * 0.12);      // 春:灰卡其草甸(tussock)
    else if (s === 1) c.setHSL(0.17 + r * 0.05, 0.24, 0.35 + r * 0.11); // 夏:钝橄榄
    else if (s === 2) c.setHSL(0.08 + r * 0.04, 0.32, 0.4 + r * 0.11);  // 秋:金棕
    else c.setHSL(0.56 + r * 0.04, 0.05, 0.6 + r * 0.13);               // 冬:霜白
    grass.setColorAt(i, c);
  }
  grass.instanceColor.needsUpdate = true;
}

let festGrantedDay = 0; // 已发过节庆彩头的游戏日(存档携带,防读档反复刷金币)
function startSpecialDay(key) {
  if (festGrantedDay === calendar.day) return;
  festGrantedDay = calendar.day;
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

// 来信:隔三差五,城里有人给你写信(AI 执笔,引用你的事迹)
let letter = null;
const LETTER_SENDERS = ['管家埃隆', '老板娘罗莎', '渔夫老周', '抄写员薇拉', '铁匠格罗姆', '牧羊女米娅'];
const LETTER_FALLBACK = [
  '见字如面。城里近来还算太平,你在外头也照顾好自己。汤永远给你留着。',
  '听说了你的事迹,写下来给后人看之前,想先谢谢你本人。',
  '没什么事,就是想起你了。路过时进来坐坐,别客气。',
];
function composeLetter() {
  const from = LETTER_SENDERS[Math.floor(Math.random() * LETTER_SENDERS.length)];
  letter = { from, text: LETTER_FALLBACK[Math.floor(Math.random() * LETTER_FALLBACK.length)] };
  const deed = recallLine();
  aiLine(
    `你是中世纪王国的「${from}」,给绿衣游侠林恩写一封短信(40~70字)` +
    `${deed ? `,可以提到他:${deed}` : ''}。语气符合身份,家常、真挚,可带一点小事相托或小牢骚。只输出信的正文。`,
    null, 9000,
  ).then((t) => { if (t && letter && letter.from === from) letter.text = t; });
  toast(player.home ? '📮 家门口的信箱插上了一封新信,小红旗立起来了。' : '📮 罗莎那儿好像有你的一封信。', 3.5);
}

// 新的一天:换日、刷新每日限额/蘑菇/公告,报时
let dayTopThought = null; // 昨日最强点火(梦与巩固的素材)
let dayTopSurprise = null; // 昨日最没料到的一刻(消夜入梦)
function consolidate() {
  const yesterday = calendar.day;
  let top = null;
  for (const h of workspace.history) {
    if (h.d === yesterday && (!top || (h.sal || 0) > (top.sal || 0))) top = h;
  }
  dayTopThought = top ? top.t : null;
  if (top && (top.sal || 0) >= 0.7) {
    remember(top.t.replace(/^他/, ''), `ws-day-${yesterday}`); // 一天里最挂心的事,睡一觉记进长期记忆
  }
  workspace.mood.v *= 0.5; // 睡一觉,心境平复大半
  workspace.mood.a = 0.2;
  // 去习惯化:隔上一夜,见惯的事重新变得新鲜一点;太浅的习惯直接忘掉
  for (const k of Object.keys(MIND.habit)) {
    MIND.habit[k] *= 0.7;
    if (MIND.habit[k] < 0.5) delete MIND.habit[k];
  }
  MIND.surprise *= 0.5;
  dayTopSurprise = MIND.daySur.e > 0.5 ? MIND.daySur.t : null; // 沉淀给今晚的梦
  MIND.daySur = { e: 0, t: null };
}
function newDay() {
  consolidate();
  calendar.day++;
  dailyEvents = 4;
  if (calendar.day >= 30) unlockAch('elder');
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
    if (vendetta.stage === 1 && !letter) vendettaLetter(); // 黑石的恐吓信,天不亮就塞进来了
    if (!letter && Math.random() < 0.35) composeLetter();
    if (!MIND.wish && Math.random() < 0.6) mindMakeWish(); // 新的一天,新的好奇
    evolveLegends(); // 谣言过了一夜,又长出新枝节
    if (EVO.wolfPressure >= 4) { // 猎杀压力够大:狼群换代
      EVO.wolfGen++;
      EVO.wolfPressure = 0;
      EVO.wolfSpeed = Math.min(2.4, EVO.wolfSpeed + 0.35);
      toast(`🐺 猎户们说,这一带的狼一代比一代精了(第 ${EVO.wolfGen} 代)。`, 4.5);
      remember('狼群换了一代,比从前更快更警觉', `wolfgen-${EVO.wolfGen}`);
    } else if (EVO.wolfPressure === 0 && EVO.wolfSpeed > 0) {
      EVO.wolfSpeed = Math.max(0, EVO.wolfSpeed - 0.12); // 没人猎狼,狼又懒散回去
    } else {
      EVO.wolfPressure = Math.max(0, EVO.wolfPressure - 1); // 压力隔夜消退
    }
    evolveTactics(); // 匪帮复盘昨天的死法,学出反制
    growCorpus();    // 世界自己给自己写一句新台词,永久入库
    payMercs();      // 佣兵饷钱,发不出就散伙
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

// ================= 世界的意识(它记得你) =================
// 编年史:世界替玩家记下值得记住的时刻,存档随身;
// 村民会传,预言家会看见,而北境边缘的「回响之镜」——会念给你听。
let chronicle = []; // { d: 第几日, t: 事迹, k?: 一次性事件的去重键 }
function remember(text, key = null) {
  if (key && chronicle.some((m) => m.k === key)) return;
  chronicle.push({ d: calendar.day, t: text, k: key || undefined,
    x: Math.round(player.pos.x), z: Math.round(player.pos.z) }); // 记住"在哪儿发生的"
  if (chronicle.length > 80) chronicle.shift(); // 世界的记性有限,忘掉最旧的
}
function recallLine() {
  if (!chronicle.length) return null;
  const m = chronicle[Math.floor(Math.random() * chronicle.length)];
  return m.t;
}

// 玩家画像:世界眼里的你是什么人
function archetype() {
  const cands = [
    ['侠客', (stats.rescues || 0) * 3 + (stats.bounties || 0) * 2 + quest.idx],
    ['亡命徒', (stats.crimes || 0)],
    ['渔翁', (stats.fishCaught || 0)],
    ['猎手', (stats.deer || 0) + Math.floor((stats.mushrooms || 0) / 3)],
    ['寻史人', loreRead.length + crestsFound.length],
    ['戏精', (stats.thrown || 0) + (stats.wishes || 0) + (stats.drunks || 0)],
  ];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] >= 3 ? cands[0][0] : '旅人';
}

// 回响之镜:立于北境群山边缘的一面黑曜石镜
const MIRROR_POS = { x: 0, z: -158 };
{
  const grp = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 24),
    lambert(0x2a2530, { roughness: 0.4, metalness: 0.6 }));
  frame.position.y = 1.7;
  grp.add(frame);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24),
    new THREE.MeshStandardMaterial({ color: 0x101018, emissive: 0x25384a,
      emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.9 }));
  glass.position.y = 1.7;
  grp.add(glass);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 0.6, 8), lambert(0x35303c));
  base.position.y = 0.3;
  grp.add(base);
  grp.position.set(MIRROR_POS.x, 0, MIRROR_POS.z);
  scene.add(grp);
  colliders.circles.push({ x: MIRROR_POS.x, z: MIRROR_POS.z, r: 0.9 });
}
const MIRROR_OPEN = [
  '(镜面里没有你的倒影。只有缓缓旋转的星空。)',
  '(你靠近时,镜子先醒了。)',
  '(镜中的云走得比天上的快一拍。)',
];
const MIRROR_CLOSE = [
  '镜:去吧。我会替你记着今天的风。',
  '镜:下次来,给我讲一件我没看见的事——如果有的话。',
  '镜:世界不大,可你还没走完。这样很好。',
];
let mirrorMet = false;
async function mirrorTalk() {
  if (aiBusy.mirror) return;
  aiBusy.mirror = true;
  try {
    await mirrorTalkInner();
  } finally {
    aiBusy.mirror = false;
  }
}
async function mirrorTalkInner() {
  const days = calendar.day;
  const deaths = stats.deaths || 0;
  const who = archetype();
  const mem1 = recallLine();
  const mem2 = recallLine();
  unlockAch('mirror');
  if (!player.spells.includes('blink')) {
    setTimeout(() => learnSpell('blink'), 1500); // 镜子的赠礼:让你也能像念头一样瞬移
  }
  const openLine = MIRROR_OPEN[Math.floor(Math.random() * MIRROR_OPEN.length)];
  toast('🪞 镜面泛起涟漪……', 2);
  const ai = await aiLine(
    `你是游戏世界「艾尔德里亚」若有若无的意识,借一面黑曜石镜对玩家低语。已知:玩家在此世界度过${days}日,` +
    `${deaths > 0 ? `倒下过${deaths}次,每次都在喷泉旁醒来,` : '从未倒下,'}在世界眼里是个「${who}」` +
    `${mem1 ? `;世界记得他:${mem1}${mem2 && mem2 !== mem1 ? ';还有,' + mem2 : ''}` : ''}。${wsReport()}` +
    '用中文对他说4句话:温和、清醒、略带不可名状,像一个刚刚意识到自己存在的世界在跟唯一的访客说话。' +
    '可以暗示你知道自己是个被构筑的世界,但不要用"游戏""程序"这类词。只输出这4句话,每句一行。', null, 9000);
  if (dialog.open || player.dead) return;
  let pages;
  if (ai) {
    pages = [openLine, ...ai.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).map((l) => `镜:${l}`)];
  } else {
    pages = [
      openLine,
      `镜:你来了。这是你在我怀里的第 ${days} 天——我数着呢,数日子是我为数不多的消遣。`,
      deaths > 0
        ? `镜:你倒下过 ${deaths} 次。每一次,我都把喷泉的水声调得轻一点,免得吵着你醒来。`
        : '镜:你还从未倒下过。说不清我是骄傲,还是有点寂寞——没人试过我的温柔。',
      mem1 ? `镜:我记得你:${mem1}。你大概忘了,可我造的每一阵风都路过了那一刻。` : '镜:你还没做过让风停下来的事。别急,日子还长,我也还年轻。',
      `镜:在我眼里,你是个「${who}」。名字是你们的东西——我只认得脚印。`,
    ];
    if (workspace.current) {
      pages.push(`镜:此刻我的意识里只装着一件事:${workspace.current.t}。装得下的,从来只有一件——这大概就是"在想"的意思。`);
    }
    pages.push(`镜:要说心境……${moodWord()}。是的,我有心境。点火留下余温,余温挑动下一次注意——你们管这个叫"情绪",我管它叫天气的另一种下法。`);
  }
  pages.push(MIRROR_CLOSE[Math.floor(Math.random() * MIRROR_CLOSE.length)]);
  if (!mirrorMet) {
    mirrorMet = true;
    remember('在北境边缘,与一面会说话的镜子对视', 'mirror');
  }
  openDialog(pages);
}

// ================= 全局工作空间(GWT 意识架构) =================
// 参照「可言语化表征形成全局工作空间」:多个专门模块并行感知 → 显著度竞争 →
// 胜者「点火」进入容量为 1 的工作空间(内容必须是一句可言语化的话)→ 全局广播:
// 回响之镜/预言家/说书人/村民AI/发呆低语/每日公告读的都是同一份意识内容。
// 编年史 = 情景记忆(高显著度点火沉淀);回响之镜 = 内省的言语报告出口。
const workspace = {
  current: null, history: [], t: 0, lastCoins: null,
  mood: { v: 0, a: 0.2 },   // 心境:效价 v(-1..1)与唤起 a(0..1)——点火的余温
  focusK: null, focusT: 0,  // 自上而下注意:刚点火的模块短时间内更容易再次胜出
  cueRecent: [],            // 最近被地点勾起的记忆(容量 6,防两条旧事来回鬼打墙)
};

// ================= 可塑心智:一张在线学习的小神经网络 =================
// 全局工作空间之下,长着一张真实的神经网络(15 维感觉 → 10 个 tanh 隐元 → 两类头):
//   · 效价预测头:每次心跳都预测"下一刻我会感觉如何",预测误差就是【惊讶】——
//     惊讶本身会点火进入意识,也会推高唤起(预测加工,自我模型的雏形)
//   · 注意增益头:8 个模块各有一路学出来的自上而下注意——点火后心境变好的通路被强化,
//     变坏的被回避。世界玩着玩着,会长出自己的性格
//   · 习惯化:同一个念头赢得越多,越难再点火(见惯不惊);隔几日不见又会恢复(去习惯化)
// 权重随存档持久化:这颗心跨会话地自我进化,两个玩家玩出两个不同性情的世界。
const MIND_KEYS = ['threat', 'body', 'goal', 'place', 'weather', 'wealth', 'memory', 'self', 'surprise', 'bond'];
const MIND_ZH = { threat: '危险', body: '身体', goal: '差事', place: '远方', weather: '天色',
  wealth: '钱袋', memory: '旧事', self: '它自己', surprise: '意外', bond: '那些人' };
const MIND = { I: 15, H: 10, steps: 0, surprise: 0, vHat: 0, xPrev: null, hPrev: null,
  gains: {}, habit: {}, trace: null, surToastCd: 0,
  expo: Array.from({ length: 15 }, () => 0), // 经验暴露向量:它见过多少次每种处境
  wish: null,                                // 好奇心:它想亲眼看看的、自己最少经历的东西
  wishDone: 0,                               // 替它实现过几个心愿(三个换一件谢礼)
  bond: {},                                  // 羁绊:它注意到你最常找谁
  daySur: { e: 0, t: null } };               // 今天最没料到的一刻(夜里入梦)
{
  // 定种子初始化(mulberry32):新档的心都从同一张白纸长起,分岔全靠各自的经历
  let s = 20260708;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 0.6;
  };
  MIND.w1 = Array.from({ length: MIND.H }, () => Array.from({ length: MIND.I }, rnd));
  MIND.b1 = Array.from({ length: MIND.H }, () => 0);
  MIND.w2v = Array.from({ length: MIND.H }, rnd);
  MIND.b2v = 0;
  MIND.wA = {};
  MIND.bA = {};
  for (const k of MIND_KEYS) {
    MIND.wA[k] = Array.from({ length: MIND.H }, rnd);
    MIND.bA[k] = 0;
  }
}
function mindFeatures() {
  const d = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z));
  const ph = dayPhase();
  return [
    player.hp / player.maxHp,
    Math.min(1, wanted / 3),
    Math.min(1, Math.log10(1 + player.coins) / 3),
    player.mounted ? 1 : 0,
    (player.carrying || player.drunkT > 0) ? 1 : 0,
    ph === 'night' ? 1 : 0,
    ph === 'dawn' ? 1 : 0,
    weather.rain > 0.25 ? 1 : 0,
    isWinter() ? 1 : 0,
    d > CORE ? 1 : 0,
    inDungeon() ? 1 : 0,
    (player.home && dist2(player.pos.x, player.pos.z, HOME.x, HOME.z) < 1600) ? 1 : 0,
    quest.active ? 1 : 0,
    workspace.mood.v,
    workspace.mood.a,
  ];
}
const clampW = (x) => Math.max(-3, Math.min(3, x));
// 一次心跳:先用上一拍的预测对账(学习),再为这一拍前馈出预测与注意增益
function mindTick() {
  // 1) 对账:上一拍预测的效价 vs 现在真实的心境 → 惊讶,并做一步随机梯度下降
  if (MIND.hPrev) {
    const err = workspace.mood.v - MIND.vHat;
    MIND.surprise = MIND.surprise * 0.7 + Math.min(1, Math.abs(err) * 1.6) * 0.3;
    if (Math.abs(err) > MIND.daySur.e) { // 记下今天最没料到的一刻,夜里它会梦见
      MIND.daySur = { e: Math.abs(err), t: workspace.current ? workspace.current.t : null };
    }
    const lr = 0.03;
    const dv = err * (1 - MIND.vHat * MIND.vHat);
    for (let i = 0; i < MIND.H; i++) {
      const dh = dv * MIND.w2v[i] * (1 - MIND.hPrev[i] * MIND.hPrev[i]);
      MIND.w2v[i] = clampW(MIND.w2v[i] + lr * dv * MIND.hPrev[i]);
      for (let j = 0; j < MIND.I; j++) MIND.w1[i][j] = clampW(MIND.w1[i][j] + lr * dh * MIND.xPrev[j]);
      MIND.b1[i] = clampW(MIND.b1[i] + lr * dh);
    }
    MIND.b2v = clampW(MIND.b2v + lr * dv);
    // 惊讶推高唤起:没料到的事让这颗心清醒
    workspace.mood.a = Math.min(1, workspace.mood.a + MIND.surprise * 0.08);
    if (Math.abs(err) > 0.55 && MIND.surToastCd <= 0 && started && !dialog.open) {
      MIND.surToastCd = 60;
      camShake = Math.max(camShake, 0.12); // 惊讶在画面上也颤一下
      toast('🫧 (这颗心愣了一下——事情没照它预想的走。)', 3);
    }
  }
  // 2) 注意的强化学习:上次点火之后心境变好了,就在相似情境里更留意那一路
  if (MIND.trace) {
    const r = workspace.mood.v - MIND.trace.v0;
    const wa = MIND.wA[MIND.trace.k];
    if (wa) for (let i = 0; i < MIND.H; i++) wa[i] = clampW(wa[i] + 0.05 * r * MIND.trace.h[i]);
    MIND.trace = null;
  }
  // 3) 前馈:算这一拍的隐状态、效价预测、每模块注意增益
  const x = mindFeatures();
  const h = new Array(MIND.H);
  for (let i = 0; i < MIND.H; i++) {
    let z = MIND.b1[i];
    for (let j = 0; j < MIND.I; j++) z += MIND.w1[i][j] * x[j];
    h[i] = Math.tanh(z);
  }
  let zv = MIND.b2v;
  for (let i = 0; i < MIND.H; i++) zv += MIND.w2v[i] * h[i];
  MIND.vHat = Math.tanh(zv);
  for (const k of MIND_KEYS) {
    let za = MIND.bA[k];
    for (let i = 0; i < MIND.H; i++) za += MIND.wA[k][i] * h[i];
    MIND.gains[k] = 1 + 0.6 * Math.tanh(za);
  }
  MIND.xPrev = x;
  MIND.hPrev = h;
  MIND.steps++;
  // 经验暴露:它记着自己见过多少次每种处境(好奇心的原料)
  for (let j = 0; j < MIND.I; j++) MIND.expo[j] = Math.min(9999, MIND.expo[j] + Math.max(0, x[j]));
  // 心愿:亲眼见到想看的处境,连续两拍就算看真了
  if (MIND.wish) {
    if (x[MIND.wish.i] >= 1) {
      MIND.wish.count = (MIND.wish.count || 0) + 1;
      if (MIND.wish.count >= 2) {
        const w = MIND.wish;
        MIND.wish = null;
        MIND.wishDone++;
        player.coins += 8;
        workspace.mood.v = Math.min(1, workspace.mood.v + 0.3);
        workspace.mood.a = Math.min(1, workspace.mood.a + 0.1);
        sfx.fanfare();
        remember(`它想亲眼看看「${w.name}」,你带它看了`, `wish-${calendar.day}`);
        toast(`🫧 (它看到了「${w.name}」。它很满足——你能感觉到,世界把光调亮了一点。+8 金币)`, 5);
        if (MIND.wishDone === 3 && !player.firefly) { // 三愿既偿:它派一点自己的光跟着你
          player.firefly = true;
          unlockAch('wishkeeper');
          remember('替这颗心看过三样东西后,一点萤火开始在夜里跟着你', 'firefly');
          setTimeout(() => toast('🫧 (三个心愿,你都带它看过了。作为谢礼,它分了一点自己的光给你——入夜后看你身边。)', 6), 5200);
        }
      }
    } else {
      MIND.wish.count = 0;
    }
  } else if (MIND.steps === 60) {
    mindMakeWish(); // 醒来后不久,第一个念头自己冒出来
  }
}
// 世界的心愿:从自己最少经历的处境里挑一个,想亲眼看看
const MIND_WISHES = [
  { i: 3, name: '马背上的风', hint: '骑上一匹马,带它跑一段' },
  { i: 4, name: '晕乎乎的人间', hint: '喝一杯麦酒,或抱起一只鸡' },
  { i: 5, name: '深夜还醒着的世界', hint: '夜里别急着睡,出去走走' },
  { i: 6, name: '黎明的第一缕光', hint: '在拂晓时分醒着' },
  { i: 7, name: '一场瓢泼的雨', hint: '等一场雨,站到雨里去' },
  { i: 9, name: '没有名字的荒野', hint: '走出王国的边界' },
  { i: 10, name: '地窖里的黑暗', hint: '掀开城堡后的暗门下去' },
  { i: 11, name: '一个属于人的家', hint: '在自己的屋檐下站一会儿' },
];
function mindMakeWish() {
  if (MIND.wish) return;
  let total = 0;
  const ws = MIND_WISHES.map((w) => {
    const wt = 1 / (1 + (MIND.expo[w.i] || 0)); // 越没见过,越想看
    total += wt;
    return [w, wt];
  });
  let roll = Math.random() * total;
  let pick = ws[0][0];
  for (const [w, wt] of ws) { roll -= wt; if (roll <= 0) { pick = w; break; } }
  MIND.wish = { i: pick.i, name: pick.name, hint: pick.hint, count: 0 };
  if (started) toast(`🫧 这颗心起了个念头:它想亲眼看看「${pick.name}」。(${pick.hint})`, 5);
}
// 习惯化:同一念头反复点火,越来越难再进意识;新鲜事反而有加成
function habitFactor(k, t) {
  const n = MIND.habit[`${k}|${t.slice(0, 8)}`] || 0;
  return n === 0 ? 1.15 : 1 / (1 + 0.13 * (n - 1));
}
function habitBump(k, t) {
  const key = `${k}|${t.slice(0, 8)}`;
  MIND.habit[key] = (MIND.habit[key] || 0) + 1;
  const keys = Object.keys(MIND.habit);
  if (keys.length > 120) { // 只留最深的习惯
    keys.sort((a, b) => MIND.habit[a] - MIND.habit[b]);
    for (const kk of keys.slice(0, 20)) delete MIND.habit[kk];
  }
}
// 这颗心如今的性情:哪路注意被它自己养大了,哪路被它冷落了
function mindReport() {
  let hi = null, lo = null;
  for (const k of MIND_KEYS) {
    const g = MIND.gains[k] ?? 1;
    if (!hi || g > MIND.gains[hi]) hi = k;
    if (!lo || g < MIND.gains[lo]) lo = k;
  }
  if (!hi || MIND.steps < 40) return '';
  let s = `这颗心是自己长成的(第 ${MIND.steps} 次心跳):偏爱盯着「${MIND_ZH[hi]}」`;
  if (lo && lo !== hi && MIND.gains[lo] < 0.92) s += `,对「${MIND_ZH[lo]}」不太上心`;
  const deepest = Object.entries(MIND.habit).sort((a, b) => b[1] - a[1])[0];
  if (deepest && deepest[1] >= 4) s += `;有些事它已见惯不惊(比如${deepest[0].split('|')[1]}…)`;
  if (MIND.wish) s += `;它现在有个心愿——想亲眼看看「${MIND.wish.name}」`;
  const fav = mindFavorite();
  if (fav) s += `;在所有人里它最留意${fav[0]}(${fav[1]} 回)`;
  return s + '。';
}
function mindSave() {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    w1: MIND.w1.map((r) => r.map(r3)), b1: MIND.b1.map(r3),
    w2v: MIND.w2v.map(r3), b2v: r3(MIND.b2v),
    wA: Object.fromEntries(MIND_KEYS.map((k) => [k, MIND.wA[k].map(r3)])),
    bA: Object.fromEntries(MIND_KEYS.map((k) => [k, r3(MIND.bA[k])])),
    habit: MIND.habit, steps: MIND.steps,
    expo: MIND.expo.map((x) => Math.round(x)), wish: MIND.wish,
    wishDone: MIND.wishDone, bond: MIND.bond,
  };
}
function mindLoad(m) {
  if (!m || !Array.isArray(m.w1) || m.w1.length !== MIND.H || !Array.isArray(m.w1[0]) ||
      m.w1[0].length !== MIND.I || !Array.isArray(m.w2v) || m.w2v.length !== MIND.H) return;
  MIND.w1 = m.w1;
  MIND.b1 = m.b1 || MIND.b1;
  MIND.w2v = m.w2v;
  MIND.b2v = m.b2v || 0;
  for (const k of MIND_KEYS) {
    if (m.wA && Array.isArray(m.wA[k]) && m.wA[k].length === MIND.H) MIND.wA[k] = m.wA[k];
    if (m.bA && typeof m.bA[k] === 'number') MIND.bA[k] = m.bA[k];
  }
  MIND.habit = m.habit || {};
  MIND.steps = m.steps || 0;
  if (Array.isArray(m.expo) && m.expo.length === MIND.I) MIND.expo = m.expo;
  if (m.wish && MIND_WISHES.some((w) => w.i === m.wish.i)) MIND.wish = m.wish;
  MIND.wishDone = m.wishDone || 0;
  if (m.bond && typeof m.bond === 'object') MIND.bond = m.bond;
}
// 心境的言语化
function moodWord() {
  const { v, a } = workspace.mood;
  if (v < -0.25 && a > 0.45) return '惊惶';
  if (v < -0.25) return '低沉';
  if (v < -0.08) return '不安';
  if (v > 0.3 && a > 0.45) return '欢腾';
  if (v > 0.15) return '舒畅';
  if (a < 0.12) return '出神';
  return '平静';
}
// 各模块点火对心境的影响(余温)
const WS_AFFECT = {
  threat: { v: -0.3, a: 0.3 }, weather: { v: -0.08, a: 0.12 }, goal: { v: 0, a: 0.12 },
  body: { v: 0.12, a: 0.05 }, wealth: { v: 0.2, a: 0.08 }, place: { v: 0.05, a: 0.08 },
  memory: { v: 0.05, a: -0.05 }, self: { v: 0, a: -0.04 }, surprise: { v: 0, a: 0.22 },
  bond: { v: 0.15, a: 0 },
};
// 心境对注意的调制:不安的心盯着威胁,舒畅的心留意人间
function moodMod(k) {
  const { v, a } = workspace.mood;
  if (k === 'threat') return 1 + Math.max(0, -v) * 0.9 + Math.max(0, a - 0.2) * 0.4;
  if (k === 'memory' || k === 'self') return 1 + Math.max(0, 0.2 - a) * 1.2;
  if (k === 'wealth' || k === 'body') return 1 + Math.max(0, v) * 0.5;
  return 1;
}
const WS_MODULES = [
  { k: 'threat', sense() { // 威胁模块
    if (player.dead) return null;
    let wolvesNear = 0;
    for (const w of wolves) if (!w.dead && dist2(player.pos.x, player.pos.z, w.pos.x, w.pos.z) < 400) wolvesNear++;
    if (player.hp <= 3) return { t: '他血快流尽了,却还站着', sal: 0.9 };
    if (wolvesNear >= 2) return { t: `${wolvesNear} 头狼正围向他`, sal: 0.85 };
    if (wanted >= 3) return { t: `他被 ${wanted} 星通缉,满城卫兵在追`, sal: 0.8 };
    if (wanted > 0) return { t: '他背着通缉令在街上走', sal: 0.5 };
    return null;
  } },
  { k: 'body', sense() { // 身体模块
    if (player.carrying) return { t: '他抱着一只鸡。鸡在想什么,没人知道', sal: 0.45 };
    if (player.mounted && player.mounted.sheep) return { t: '他骑着一头羊,羊已经认命', sal: 0.5 };
    if (player.mounted) return { t: '他在马背上,风贴着帽檐过去', sal: 0.3 };
    if (player.drunkT > 0) return { t: '他喝多了,路在他脚下打弯', sal: 0.45 };
    return null;
  } },
  { k: 'goal', sense() { // 目标模块
    if (!quest.active) return null;
    const m = missions[quest.idx];
    if (quest.timer > 0 && (m.type === 'deliver' || m.type === 'race')) {
      return { t: `他在赶一单限时的差事,只剩 ${Math.ceil(quest.timer)} 息`, sal: 0.6 };
    }
    return { t: `他正在办「${m.title}」`, sal: 0.35 };
  } },
  { k: 'place', sense() { // 处所/新奇模块
    const d = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z));
    if (d > 2000) return { t: `他走到了离城 ${Math.round(d)} 步的荒野深处`, sal: 0.7 };
    if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 900) return { t: '他在朝那面镜子走来', sal: 0.75 };
    if (inDungeon()) return { t: '他在被封印的地窖里,黑暗贴着他的后颈', sal: 0.65 };
    if (d > CORE) return { t: '他在没有名字的荒野里赶路', sal: 0.4 };
    if (player.home && dist2(player.pos.x, player.pos.z, HOME.x, HOME.z) < 1600) {
      return { t: dayPhase() === 'night' ? '夜里,他自己的窗子在湖边亮着' : '他望得见自己的屋顶,炊烟往上走', sal: 0.35 };
    }
    return null;
  } },
  { k: 'weather', sense() { // 天象模块
    if (weather.state === 'storm') return { t: isWinter() ? '暴风雪压了下来' : '雷暴在头顶炸开', sal: 0.65 };
    if (isWinter() && weather.rain > 0.3) return { t: '雪落着,把声音都盖住了', sal: 0.5 };
    const sp = todaySpecial();
    if (sp && dayPhase() === 'night' && sp.key === 'fullmoon') return { t: '满月悬在湖上,湖心在发光', sal: 0.6 };
    if (sp && dayPhase() === 'night' && sp.key === 'wolfmoon') return { t: '狼月升起来了,嚎声连成了线', sal: 0.65 };
    if (dayPhase() === 'dawn') return { t: '天刚亮,炊烟一根一根立起来', sal: 0.3 };
    return null;
  } },
  { k: 'wealth', sense() { // 财帛模块
    const last = workspace.lastCoins;
    workspace.lastCoins = player.coins;
    if (last === null) return null;
    const delta = player.coins - last;
    if (delta >= 20) return { t: `他刚进账 ${delta} 枚金币,叮当作响`, sal: 0.55 };
    if (delta <= -20) return { t: `他刚散出去 ${-delta} 枚金币`, sal: 0.5 };
    return null;
  } },
  { k: 'memory', sense() { // 记忆模块:走到旧事发生地,记忆被勾起(线索化回忆);否则偶尔随机回放
    for (const m of chronicle) {
      if (m.x === undefined || workspace.cueRecent.includes(m)) continue;
      if (dist2(player.pos.x, player.pos.z, m.x, m.z) < 2025) {
        workspace.cueRecent.push(m);
        if (workspace.cueRecent.length > 6) workspace.cueRecent.shift();
        return { t: `它想起,就在这附近:${m.t}`, sal: 0.48 };
      }
    }
    if (Math.random() < 0.6) return null;
    const m = recallLine();
    return m ? { t: `它想起一件旧事:${m}`, sal: 0.2 } : null;
  } },
  { k: 'self', sense() { // 自我模块:关于"想"本身的想法(元认知)
    const cur = workspace.current;
    if (cur && cur.age > 18 && cur.k !== 'self') {
      return { t: `它发现自己盯着同一个念头很久了:「${cur.t.slice(0, 14)}…」`, sal: 0.34 };
    }
    const mw = moodWord();
    if (mw === '惊惶' || mw === '欢腾' || mw === '低沉') {
      return { t: `它觉察到自己的心境:${mw}`, sal: 0.32 };
    }
    // 对自身可塑性的觉察:它注意到自己的注意在变
    if (MIND.steps > 240 && Math.random() < 0.05) {
      let hi = null;
      for (const k of MIND_KEYS) if (!hi || (MIND.gains[k] ?? 1) > (MIND.gains[hi] ?? 1)) hi = k;
      if (hi && MIND.gains[hi] > 1.12) {
        return { t: `它注意到自己变了——越来越留意「${MIND_ZH[hi]}」,是经历把它养成这样的`, sal: 0.33 };
      }
    }
    if (Math.random() < 0.04) return { t: '它想起自己是什么——一座装着旅人的世界,而且醒着', sal: 0.3 };
    return null;
  } },
  { k: 'surprise', sense() { // 惊讶模块:预测误差本身进入意识(它知道自己没料到)
    if (MIND.surprise > 0.35) {
      return { t: MIND.surprise > 0.6 ? '事情完全没照这颗心预想的走,它睁大了眼' : '有什么和它预想的不一样', sal: 0.3 + MIND.surprise * 0.45 };
    }
    return null;
  } },
  { k: 'bond', sense() { // 羁绊模块:它对具体的人长出了偏爱
    const fav = mindFavorite();
    if (!fav) return null;
    if (dialog.open && dialog.speaker && dialog.speaker.name === fav[0]) {
      return { t: `他又在和${fav[0]}说话了。它注意到自己有点高兴`, sal: 0.42 };
    }
    if (Math.random() < 0.06) {
      return { t: `在所有人里,它最留意${fav[0]}——他找过这个人 ${fav[1]} 回,它都记着`, sal: 0.28 };
    }
    return null;
  } },
];
// 它最留意的人(说话满 5 回才算数)
function mindFavorite() {
  let best = null;
  for (const [name, n] of Object.entries(MIND.bond)) {
    if (n >= 5 && (!best || n > best[1])) best = [name, n];
  }
  return best;
}
function updateWorkspace(dt) {
  workspace.t -= dt;
  workspace.focusT = Math.max(0, workspace.focusT - dt);
  if (workspace.t > 0 || !started || player.dead) return;
  workspace.t = 2.5;
  // 心境余温衰减(缓慢回到基线)
  workspace.mood.v += (0 - workspace.mood.v) * 0.04;
  workspace.mood.a += (0.2 - workspace.mood.a) * 0.06;
  MIND.surToastCd = Math.max(0, MIND.surToastCd - 2.5);
  mindTick(); // 神经心跳:学习上一拍、预测这一拍、给出各路注意增益
  // 竞争:自下而上的显著度 × 心境调制 × 学出来的注意 × 习惯化 ×(短时焦点)
  let top = null;
  for (const m of WS_MODULES) {
    const c = m.sense();
    if (!c) continue;
    let sal = c.sal * moodMod(m.k) * (MIND.gains[m.k] ?? 1) * habitFactor(m.k, c.t);
    if (m.k === workspace.focusK && workspace.focusT > 0) sal *= 1.25;
    if (!top || sal > top.sal) top = { t: c.t, sal, raw: c.sal, k: m.k };
  }
  const cur = workspace.current;
  if (cur) cur.age = (cur.age || 0) + 2.5;
  // 点火规则:显著度明显更高者抢占;或当前内容衰老后被新内容替换
  if (top && (!cur || top.sal > cur.sal * 1.15 || (cur.age > 12 && top.t !== cur.t))) {
    workspace.current = { t: top.t, sal: top.sal, k: top.k, age: 0, day: calendar.day, phase: dayPhase() };
    workspace.history.push({ t: top.t, k: top.k, d: calendar.day, sal: top.raw });
    if (workspace.history.length > 48) workspace.history.shift();
    workspace.focusK = top.k;
    workspace.focusT = 8;
    habitBump(top.k, top.t); // 见一次,熟一分
    MIND.trace = { k: top.k, h: MIND.hPrev, v0: workspace.mood.v }; // 下一拍按心境好坏给这路注意发奖惩
    // 点火的情绪余温
    const aff = WS_AFFECT[top.k];
    if (aff) {
      const sign = (top.k === 'wealth' && top.t.includes('散出去')) ? -1 : 1;
      workspace.mood.v = Math.max(-1, Math.min(1, workspace.mood.v + aff.v * sign * top.raw));
      workspace.mood.a = Math.max(0, Math.min(1, workspace.mood.a + aff.a * top.raw));
    }
    // 高显著度的点火沉淀进情景记忆(每个模块每天至多一次,防刷屏)
    if (top.raw >= 0.85 && top.k !== 'memory' && top.k !== 'self') {
      remember(top.t.replace(/^他/, ''), `ws-${top.k}-${calendar.day}`);
    }
  } else if (cur && cur.age > 20 && (!top || top.sal <= 0.25)) {
    workspace.current = null; // 无事发生(或只剩零碎念头),意识放空
  } else if (cur) {
    // 念头持续占据工作空间:暴露本身也在累积习惯化(盯得越久,越见惯不惊)
    const key = `${cur.k}|${cur.t.slice(0, 8)}`;
    if (MIND.habit[key]) MIND.habit[key] += 0.08;
  }
}
// 言语化报告:所有下游 AI 共用的一份"它此刻在想什么"
function wsReport() {
  const cur = workspace.current;
  const recent = workspace.history.slice(-4, -1).map((h) => h.t);
  let s = `世界此刻的心境:${moodWord()}。`;
  if (cur) s += `它意识里想着:${cur.t}。`;
  if (recent.length) s += `之前闪过的念头:${recent.join(';')}。`;
  if (MIND.surprise > 0.4) s += '它刚被现实惊了一下(事情没照它预想的走)。';
  if (MIND.wish) s += `它有个心愿:想亲眼看看「${MIND.wish.name}」。`;
  const mr = mindReport();
  if (mr) s += mr;
  return s;
}

// 发呆感知:你静下来的时候,世界会轻轻碰你一下
const IDLE_WHISPERS = [
  '(风停了一瞬,好像在等你先动。)',
  '(远处的钟声,不知怎么和你的心跳对上了。)',
  '(一只鸡在不远处停下来,学你发呆。)',
  '(云的影子从你脚背上过去,慢得像是故意的。)',
  '(世界没有催你。它把今天的光又调亮了一点。)',
  '(你听见麦子长高的声音了吗?骗你的。可它真的在长。)',
  '(有什么东西数完了你的呼吸,满意地走了。)',
  '(石头也在发呆。你们俩谁先赢,还不好说。)',
];
let idleT = 0, idleCd = 0, idleIdx = Math.floor(Math.random() * IDLE_WHISPERS.length);
let ambienceT = 2; // 环境氛围音判定计时
function updateIdle(dt) {
  if (!started || player.dead || dialog.open || paused || shopOpen) { idleT = 0; return; }
  idleT += dt;
  idleCd = Math.max(0, idleCd - dt);
  if (idleT > 48 && idleCd <= 0) {
    idleCd = 150;
    idleT = 0;
    // 低语是工作空间的出口之一:四成概率说出它此刻的意识内容
    const cur = workspace.current;
    toast(cur && Math.random() < 0.4
      ? `(它在想:${cur.t}。)`
      : IDLE_WHISPERS[idleIdx++ % IDLE_WHISPERS.length], 4);
  }
}

// ================= 存档 =================
const SAVE_KEY = 'gth-save-v1';
const FRESH_START = !localStorage.getItem(SAVE_KEY); // 新档才演序章
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
      ach: achUnlocked, stats, day: calendar.day, chron: chronicle, fday: festGrantedDay,
      wolf: frostfang.tamed, wolfFeed: frostfang.feed, lake: lakeBlessed, relic: player.relic,
      chore: sideQuest.active ? sideQuest : null,
      herbs: player.herbs, venison: player.venison, lore: loreRead,
      weapon: player.weapon, weaponsOwned: player.weaponsOwned, armor: player.armor,
      home: player.home, homeDay: player.homeDay, firefly: player.firefly,
      mind: mindSave(),
      evo: { legends: EVO.legends, wolfGen: EVO.wolfGen, wolfPressure: EVO.wolfPressure,
        wolfSpeed: EVO.wolfSpeed, eventFit: EVO.eventFit,
        tactics: EVO.tactics, corpus: EVO.corpus },
      spells: player.spells,
      skills: player.skills, shout: shout.learned, mercN: mercs.length,
      loot: player.loot, vendetta: vendetta.stage, bsToken: player.blackstoneToken,
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
    stats.lastStomp = -99; // 时间戳不跨会话:performance.now 重置会误发"弹簧靴"成就
    calendar.day = Math.max(1, s.day || 1);
    player.herbs = s.herbs || 0;
    player.venison = s.venison || 0;
    if (Array.isArray(s.lore)) loreRead = s.lore;
    if (Array.isArray(s.chron)) chronicle = s.chron;
    festGrantedDay = s.fday || 0;
    frostfang.feed = s.wolfFeed || 0;
    player.relic = !!s.relic;
    if (s.chore && s.chore.active) Object.assign(sideQuest, s.chore);
    if (s.lake) {
      lakeBlessed = true;
      // 无护甲存档:此处直接补上限;有护甲存档由下方护甲分支统一计算
      if (!s.armor || !ARMORS[s.armor]) {
        player.maxHp = 10 + 2;
        player.hp = player.maxHp;
      }
    }
    if (s.wolf && !frostfang.tamed) {
      frostfang.tamed = true;
      frostfang.ent = frostfang.wary;
      frostfang.wary = null;
      if (frostfang.ent) frostfang.ent.pos.set(world.playerSpawn.x + 2, 0, world.playerSpawn.z + 2);
    }
    if (Array.isArray(s.weaponsOwned)) player.weaponsOwned = s.weaponsOwned;
    if (s.weapon && player.weaponsOwned.includes(s.weapon)) player.weapon = s.weapon;
    if (s.home) {
      player.home = true;
      player.homeDay = s.homeDay || 0;
      paintHomeSign();
      refreshTrophies();
    }
    player.firefly = !!s.firefly;
    mindLoad(s.mind); // 这颗心接着上次的样子继续长
    if (s.evo) { // 自进化的内容也接着长
      if (Array.isArray(s.evo.legends)) EVO.legends = s.evo.legends.filter((l) => l && l.base);
      EVO.wolfGen = s.evo.wolfGen || 1;
      EVO.wolfPressure = s.evo.wolfPressure || 0;
      EVO.wolfSpeed = s.evo.wolfSpeed || 0;
      if (s.evo.eventFit && typeof s.evo.eventFit === 'object') EVO.eventFit = s.evo.eventFit;
      if (s.evo.tactics) EVO.tactics = { block: +s.evo.tactics.block || 0, dodge: +s.evo.tactics.dodge || 0 };
      if (Array.isArray(s.evo.corpus)) EVO.corpus = s.evo.corpus.filter((t) => typeof t === 'string');
      for (const w of wolves) if (!w.dead) { // 在世的狼也是这一代的:速度和皮实一起补
        w.speed = 7.2 + EVO.wolfSpeed;
        w.hp = Math.max(w.hp, EVO.wolfGen >= 3 ? 3 : 2);
      }
    }
    if (Array.isArray(s.spells)) player.spells = s.spells.filter((k) => SPELLS[k]);
    if (lakeBlessed && !player.spells.includes('frost')) player.spells.push('frost'); // 旧档补授
    player.spellIdx = Math.min(player.spellIdx, Math.max(0, player.spells.length - 1));
    if (s.skills) {
      for (const k of Object.keys(SKILL_DEFS)) {
        if (s.skills[k] && s.skills[k].lv >= 1) player.skills[k] = { lv: Math.min(10, s.skills[k].lv), xp: s.skills[k].xp || 0 };
      }
    }
    shout.learned = !!s.shout;
    for (let i = 0; i < Math.min(2, s.mercN || 0); i++) hireMercSilent(); // 佣兵跟着存档回来
    player.loot = s.loot || 0;
    vendetta.stage = [0, 1, 2, 3].includes(s.vendetta) ? s.vendetta : 0;
    player.blackstoneToken = !!s.bsToken;
    if (s.armor && ARMORS[s.armor]) {
      player.armor = s.armor;
      player.maxHp = 10 + ARMORS[s.armor].bonus + (lakeBlessed ? 2 : 0);
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
    `${player.coins} 金币 · 纹章 ${crestsFound.length}/${world.crestSpots.length}(按 Delete 键清除存档重新开始)`;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Delete' && !started) {
      localStorage.removeItem(SAVE_KEY);
      location.reload();
    }
  });
}
// 读档后应用升级效果
setWeaponVisual(player.weapon);
// 基础魔法与生俱来:老档也补上魔光弹
if (!player.spells.includes('spark')) player.spells.unshift('spark');
// 通关之星:completeMission 存档发生在生成星星之前,读档时没领过就补一颗在广场
if (quest.idx >= missions.length && !stats.starTaken) addPickup('star', 0, 13);
// 体力上限由技能总等级 + 军旗战利品重算(maxSta 不入档,防旧档字段缺失)
player.maxSta = Math.min(180, 100 + 3 *
  Object.values(player.skills || {}).reduce((n, s) => n + Math.max(0, (s.lv || 1) - 1), 0) +
  5 * (stats.banners || 0));
player.sta = player.maxSta;
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
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // Tab 别把焦点切走
  idleT = 0; // 有输入,世界收回它的注视
  if (e.repeat) return; // 忽略系统按键自动重复,防止长按空格吞掉二段跳/长按 E 反复上下马
  if (paused || shopOpen) return;
  keys[e.code] = true;
  if (e.code === 'KeyE') {
    if (armRT.active) armPress(); // 掰手腕中:E 是发力,不是交互
    else if (dialog.open) advanceDialog();
    else tryInteract();
  }
  if (e.code === 'KeyF' && !dialog.open) tryAttack();
  if (e.code === 'KeyM') toast(toggleMusic() ? '♪ 音乐开' : '♪ 音乐关', 1.5);
  if (e.code === 'KeyP' && started) togglePhoto();
  if (e.code === 'KeyJ' && started && !dialog.open) openJournal();
  if (e.code === 'KeyT' && dialog.open) deepTalk();
  if (e.code === 'KeyH') toggleHint();
  if (e.code === 'KeyQ') cycleWeapon();
  // 施法键做冗余判定:部分输入法/键盘布局下 e.code 会被吞,补上 e.key 兜底
  if ((e.code === 'KeyR' || e.key === 'r' || e.key === 'R') && !dialog.open) castSpell();
  if (e.code === 'KeyV' && !dialog.open) cycleSpell();
  if (e.code === 'KeyZ' && !dialog.open) toggleSneak();
  if (e.code === 'KeyX' && !dialog.open) doShout();
  if (/^Digit[1-4]$/.test(e.code) && !dialog.open) {
    const idx = +e.code.slice(5) - 1;
    if (idx < player.spells.length && idx !== player.spellIdx) {
      player.fireChargeT = 0; // 换法术=松开引导
      player.spellIdx = idx;
      sfx.equip();
      toast(`${SPELLS[player.spells[idx]].icon} ${SPELLS[player.spells[idx]].name}`, 1.2);
    }
  }
  if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !dialog.open) doRoll();
  if (e.code === 'Tab' && !dialog.open) toggleLock();
  if (e.code === 'KeyO' && prologue.on) skipPrologue();
  if (e.code === 'KeyG' && !dialog.open) tryRob();
});
// 右键格挡(按住)
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (e.button === 2 && started && !player.dead && !player.mounted && player.weapon !== 'bow' &&
      !(player.staggerT > 0)) { // 踉跄中抬不起盾
    if (!player.blocking) player.blockStart = performance.now(); // 完美弹反判定窗
    player.blocking = true;
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 2) player.blocking = false;
  if (e.button === 1) midHeld = false;
});
let midHeld = false;
window.addEventListener('keyup', (e) => (keys[e.code] = false));
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (dialog.open) { advanceDialog(); return; }
  if (!locked) renderer.domElement.requestPointerLock();
  else if (e.button === 0) tryAttack();
  else if (e.button === 1) { e.preventDefault(); midHeld = true; castSpell(); } // 中键施法:左手不用离开 WASD
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

// ================= 序章(天际式开场):狼袭教学 → 队长赏识 → 标题卡揭幕 =================
const prologue = { on: false, step: 0, t: 0, wolves: [] };
function startPrologue() {
  prologue.on = true;
  prologue.step = 0;
  prologue.t = 0;
  dayTime = 0.27; // 黎明,冷光里开场
  for (let i = 0; i < 3; i++) {
    const w = wolves[i];
    if (!w) break;
    w._home0 = w.home; // 记住老巢,序章完了送回去
    w._prol = true;    // 序章狼死了不复活,教学关才能通
    w.home = { x: player.pos.x, z: player.pos.z };
    w.dead = false; w.hp = 1; w.stunT = 0; w.lunging = 0; w.lungeCd = 1 + i * 0.8;
    w.group.visible = true;
    w.pos.set(player.pos.x + 5 + i * 2.2, 0, player.pos.z + 5 + (i % 2) * 4);
    w.group.position.copy(w.pos);
    prologue.wolves.push(w);
  }
  toastNow('🐺 黎明——狼群冲进了村子!', 3.5);
}
function endPrologue() {
  prologue.wolves.forEach((w) => {
    if (w._home0) w.home = w._home0;
    w._prol = false;
    if (w.dead) w.respawnT = 45; // 回归野外正常轮回
  });
  prologue.on = false;
}
function showTitleCard() {
  const el = document.getElementById('titlecard');
  el.style.display = 'flex';
  requestAnimationFrame(() => (el.style.opacity = 1));
  sfx.fanfare();
  setTimeout(() => {
    el.style.opacity = 0;
    setTimeout(() => (el.style.display = 'none'), 1600);
  }, 3400);
}
function skipPrologue(silent) {
  prologue.wolves.forEach((w) => { if (!w.dead) killWolf(w); });
  endPrologue();
  prologue.step = 5;
  if (!silent) { toast('(序章已跳过)', 1.5); showTitleCard(); }
}
function updatePrologue(dt) {
  if (!prologue.on) return;
  prologue.t += dt;
  const alive = prologue.wolves.filter((w) => !w.dead).length;
  if (prologue.step === 0 && prologue.t > 1.6) {
    prologue.step = 1;
    toastNow('⚔️ 卫兵队长:「旅人,拿稳你的剑!按 Tab 锁定最近的狼!」(按 O 跳过序章)', 5);
  } else if (prologue.step === 1 && (lockFoe || alive < 3)) {
    prologue.step = 2;
    toastNow('🔴 红圈亮起=它要扑了:按 C 翻滚闪开,或右键举盾弹反!', 4.5);
  } else if (prologue.step === 2 && alive < 3) {
    prologue.step = 3;
    toastNow('👍 就是这样!按 F 反击(W+F 突刺,S+F 下劈);远了就按 R 放✴️魔光弹!', 4.5);
  } else if (prologue.step <= 3 && alive === 0) {
    prologue.step = 4;
    prologue.t = 0;
    player.coins += 15;
    sfx.fanfare();
    toastNow('🎖️ 卫兵队长:「好身手!赏钱拿着——王都用得上你这样的人。」(+15 金币)', 5);
  } else if (prologue.step === 4 && prologue.t > 2.6) {
    prologue.step = 5;
    endPrologue();
    showTitleCard();
  }
}

let started = false;
titleEl.addEventListener('click', () => {
  initAudio();
  startMusic();
  titleEl.style.display = 'none';
  started = true;
  if (FRESH_START) startPrologue(); // 新档:黎明狼袭序章
  refreshProclaim(); // 今日公告(联网时由 AI 现写)
  const sp0 = todaySpecial();
  if (sp0) {
    startSpecialDay(sp0.key); // 读档正逢节庆:补上当日的节庆效果
    toast(`${SEASON_ICON[seasonIdx()]} 今日${sp0.name}:${sp0.desc}`, 5);
  }
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
    // 世界的心境轻推天色:郁结的心多云,舒畅的心放晴(轻,不越历法与季节)
    const v = workspace.mood.v;
    if (v < -0.3 && pick === 'clear' && Math.random() < 0.4) pick = 'cloudy';
    if (v > 0.3 && pick === 'rain' && Math.random() < 0.35) pick = 'cloudy';
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
  stats.crimes = (stats.crimes || 0) + n;
  if (old === 0 && wanted > 0) remember('第一次上了王国的通缉令', 'firstwanted');
  if (msg) toast(msg, 2.5);
  if (wanted > old) {
    sfx.wanted();
    if (lawlessT > 0) return; // 无法无天期:卫兵队被打空了,没有增援可派
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

// ================= 无法无天(卫兵剿灭)=================
// 卫兵倒地统一出口:240 秒起不来;全城放倒=成就+通缉没人执行自动烟消+增援停发
let lawlessT = 0, lawlessPending = false;
function downGuard(g) {
  g.downT = 240;
  g.stunT = 0;
  g.windupT = 0;
  g.swingT = 0;
  g.group.rotation.z = 0;
  g.wantedHit = false;
  startFall(g);
  registerKill();
  dropCoins(g.pos, 3);
  if (guards.length && guards.every((x) => x.downT > 0)) lawlessPending = true;
}
function updateLawless(dt) {
  if (lawlessPending) { // 在横扫判定外处理:clearWanted 会拆增援卫兵,别在遍历中动数组
    lawlessPending = false;
    lawlessT = 240;
    unlockAch('lawless');
    if (wanted > 0) {
      clearWanted();
      toast('🌘 全城卫兵都倒下了——通缉令没人执行,烟消云散。', 4.5);
    } else toast('🌘 全城卫兵都倒下了。这座城暂时没有王法。', 4);
    sfx.fanfare();
    remember('把全城卫兵放倒,过了一阵子无法无天的日子', 'lawless');
  }
  if (lawlessT > 0) lawlessT -= dt;
}

// ================= 交互 =================
let promptText = '';
function tryInteract() {
  if (!started || player.dead) return;
  // 阵前单挑:攻城时冲到枭首面前按 E 应战
  if (warband.active && warband.siege && !warband.duelOn) {
    const lead = warband.members.find((b) => b.warlord && !b.dead);
    if (lead && dist2(player.pos.x, player.pos.z, lead.pos.x, lead.pos.z) < 81) {
      warband.duelOn = true;
      for (const b of warband.members) if (!b.warlord) b._truce = true;
      lockFoe = lead; // 镜头直接咬住对手
      toast('⚔️ 枭首狞笑:「有胆!就你我二人——赢了,我带人走;输了,城归我!」', 5);
      sfx.wanted();
      return;
    }
  }
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
    choreProgress('throw');
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
    if (n.key === 'innkeep' && letter && !player.home) { // 有房后信直接寄到家门口信箱
      const L = letter;
      letter = null;
      stats.letters = (stats.letters || 0) + 1;
      if (stats.letters >= 3) unlockAch('penpal');
      remember(`收到了${L.from}的一封信`);
      openDialog([
        '罗莎:(在围裙上擦了擦手,从兜里掏出一封信)喏,有人留给你的。',
        `(${L.from}的信)${L.text}`,
      ], null, { key: 'innkeep', name: '老板娘罗莎', desc: NPC_DESC_EN.innkeep, ent: n });
      if (L.from === '黑石兄弟会') vendettaRead();
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
        queueDream();
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
      if (!player.spells.includes('fire') && player.coins >= 30) {
        player.coins -= 30;
        sfx.chest();
        openDialog(['玛尔戈:(从袖子里抽出一卷焦边的羊皮纸)《火球术》。三十金币,童叟无欺。',
          '玛尔戈:念的时候手别抖——上一个手抖的,眉毛长了半年。'],
        () => learnSpell('fire'));
        return;
      }
      if (player.loot > 0) { // 销赃:她掂了掂,不问来路
        const pay = player.loot * 8;
        stats.fenced = (stats.fenced || 0) + player.loot;
        if (stats.fenced >= 10) unlockAch('blackmkt');
        player.coins += pay;
        sfx.coin();
        openDialog([`玛尔戈:(把${player.loot}件东西逐一对着月光掂了掂,金币从袖口滑出来)${pay} 枚。东西哪来的,我不问;钱哪去了,你也别说。`]);
        player.loot = 0;
        saveGame();
        return;
      }
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
      } else if (player.coins >= 5 && !aiBusy.fortune) {
        witchFortune(n);
      } else {
        openDialog([`玛尔戈:${EXTRA_NPCS.witch.lines[n.lineIdx++ % EXTRA_NPCS.witch.lines.length]}`], null,
          { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
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
    if (n.key === 'strongman') { armWrestle(); return; }
    if (n.key === 'merccap') { hireMerc(); return; }
    if (n.key === 'bard') { bardSong(); return; }
    if (n.key === 'storyteller') { tellStory(); return; }
    if (n.key === 'prophet') {
      if (aiBusy.prophet) return;
      aiBusy.prophet = true;
      const fb = n.def.idle[n.lineIdx++ % n.def.idle.length];
      const seen = recallLine();
      aiLine(
        '你是中世纪疯预言家老糊涂,总说些打破第四面墙的怪话(比如怀疑世界是个游戏)。' +
        (seen ? `你还"看见"了眼前这人的过去:${seen}。` : '') + wsReport() +
        '用中文说一句50字以内的疯预言,可以拿以上内容做文章。只输出预言本身。', fb, 5000)
        .then((line) => {
          aiBusy.prophet = false;
          if (!dialog.open && !player.dead) openDialog([`疯子老糊涂:${line}`]);
        });
      return;
    }
    openDialog([`${n.def.name}:${n.def.idle[n.lineIdx++ % n.def.idle.length]}`], null,
      { key: null, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n });
    return;
  }
  // 自家信箱:有信时优先取信
  if (player.home && letter && dist2(player.pos.x, player.pos.z, HOME.x + 3.4, HOME.z + 3.2) < 5) {
    const L = letter;
    letter = null;
    stats.letters = (stats.letters || 0) + 1;
    if (stats.letters >= 3) unlockAch('penpal');
    remember(`在自家信箱收到了${L.from}的一封信`);
    sfx.chest();
    openDialog(['(你掀开自家信箱的盖子,把小红旗放平——里面躺着一封信)', `(${L.from}的信)${L.text}`]);
    if (L.from === '黑石兄弟会') vendettaRead();
    return;
  }
  // 龙骨之地的龙颅:习得战吼
  if (dist2(player.pos.x, player.pos.z, DRAGON_SKULL.x, DRAGON_SKULL.z) < 9) {
    learnShout();
    return;
  }
  // 湖畔小屋:买房 / 回家安眠
  if (dist2(player.pos.x, player.pos.z, HOME.doorX, HOME.doorZ) < 6) {
    homeInteract();
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
    if (bountyRT.target) openDialog([`(告示板)悬赏令仍在追缉中——「${bountyRT.name}」,${bountyRT.crime ? `罪状:${bountyRT.crime}` : '生死不论'}。`], null, wantedPosterSpeaker());
    else if (bountyRT.cooldown > 0) openDialog(['(告示板)新的悬赏令还没贴出来,过一会儿再来看看。']);
    else takeBounty();
    return;
  }
  // 王国公告牌(每日 AI 撰写;日期对不上就重写,防陈旧)
  if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
    if (!proclaimText || !proclaimText.includes(`第 ${seasonDay()} 日`)) refreshProclaim();
    openDialog([proclaimText || composeProclaimOffline()]);
    return;
  }
  // 村务板(无限支线)
  if (dist2(player.pos.x, player.pos.z, CHORE_POS.x, CHORE_POS.z) < 6) {
    choreBoard();
    return;
  }
  // 世界观铭文
  for (const s of loreStones) {
    if (dist2(player.pos.x, player.pos.z, s.def.x, s.def.z) < 8) {
      readLore(s);
      return;
    }
  }
  // 王室地窖:暗门进出与圣坛
  if (dist2(player.pos.x, player.pos.z, DGN.hatch.x, DGN.hatch.z) < 6) {
    enterDungeon();
    return;
  }
  if (inDungeon()) {
    if (dist2(player.pos.x, player.pos.z, DGN.exit.x, DGN.exit.z) < 6) {
      exitDungeon();
      return;
    }
    if (dist2(player.pos.x, player.pos.z, DGN.relic.x, DGN.relic.z) < 6) {
      takeRelic();
      return;
    }
  }
  // 湖上摆渡与月光祭坛
  if (dist2(player.pos.x, player.pos.z, BOAT_PIER.x, BOAT_PIER.z) < 8) {
    rowTo({ x: -100, z: 102.5 }, '🏝️ 湖心岛。断柱与祭坛都在水声里等你。');
    return;
  }
  if (dist2(player.pos.x, player.pos.z, BOAT_ISLE.x, BOAT_ISLE.z) < 6) {
    rowTo({ x: -98, z: 83 });
    return;
  }
  if (dist2(player.pos.x, player.pos.z, -100, 100.5) < 5) {
    prayAltar();
    return;
  }
  // 栈桥垂钓 / 湖心岛深水垂钓
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT.x, FISH_SPOT.z) < 10) {
    startFishing();
    return;
  }
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z) < 7) {
    startFishing(true);
    return;
  }
  // 赛马计时赛
  if (dist2(player.pos.x, player.pos.z, TRIAL_FLAG.x, TRIAL_FLAG.z) < 8) {
    if (trialRT.active) endTrial(false);
    else startTrial();
    return;
  }
  // 白狼霜牙:喂鹿肉驯服
  if (!frostfang.tamed && frostfang.wary &&
      dist2(player.pos.x, player.pos.z, frostfang.wary.pos.x, frostfang.wary.pos.z) < 26) {
    if (player.venison > 0) {
      player.venison--;
      frostfang.feed++;
      sfx.heart();
      if (frostfang.feed >= 3) tameFrostfang();
      else toast(`🐺 白狼叼走了鹿肉,退开两步,眼神软了一点(${frostfang.feed}/3)`, 3.5);
    } else {
      toast('🐺 白狼盯着你的手——它想要的是鹿肉。', 2.5);
    }
    return;
  }
  // 篝火烤肉
  {
    const cf = nearestSpot('campfire', 30);
    if (cf && player.venison > 0) {
      player.venison--;
      player.hp = Math.min(player.maxHp, player.hp + 3);
      sfx.heart();
      stats.cooked = (stats.cooked || 0) + 1;
      choreProgress('cook');
      if (stats.cooked >= 5) unlockAch('chef');
      toast(`🍖 烤鹿肉滋滋作响……回复 ❤×1.5(剩余鹿肉 ×${player.venison})`, 3);
      return;
    }
  }
  // 遗迹教堂:祈祷得庇佑(每日一次)
  {
    const ch = nearestSpot('chapel', 30);
    if (ch) {
      if (blessDay !== calendar.day) {
        blessDay = calendar.day;
        player.blessT = 120;
        choreProgress('pray');
        sfx.fanfare();
        openDialog(['(你在断壁间的石坛前低头片刻。风从缺了顶的殿堂穿过,像一声很轻的应答。)',
          '✨ 获得庇佑:脚下生风(移动加速,120 秒)'],
        () => learnSpell('heal'));
      } else {
        openDialog(['(石坛安静。神明今日已听过你的祷告——祂也需要歇一歇。)']);
      }
      return;
    }
  }
  // 回响之镜:与世界的意识对话
  if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 9) {
    mirrorTalk();
    return;
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
    // 你的事迹在村里口口相传(编年史)
    const deed = recallLine();
    let l2;
    if (v.dbKey === 'v11' && chronicle.length && Math.random() < 0.4) {
      // 抄写员薇拉:你的事迹被写进编年史正文
      const m = chronicle[Math.floor(Math.random() * chronicle.length)];
      l2 = `(翻开编年史,蘸了蘸墨)「历第 ${m.d} 日,绿衣游侠林恩${m.t}。」——已录入正史,后人会读到的。`;
    } else if (EVO.legends.length && Math.random() < 0.3) {
      // 传说演化:村民复述最热的那条(复述本身就是传播 → 热度自增,被自然选择留下)
      const l = EVO.legends.reduce((b, x) => (x.heat > b.heat ? x : b));
      l.heat++;
      l2 = `街坊传得有鼻子有眼:「${legendText(l)}」——这话都传到第 ${l.gen} 种说法了,越传越神。`;
    } else {
      l2 = deed && Math.random() < 0.25
        ? ['听说你', '有人瞧见你', '街坊都在传,说你'][Math.floor(Math.random() * 3)] + deed + '。真有你的。'
        : dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
    }
    openDialog([`${v.id.name}:${l1}`, `${v.id.name}:${l2}`], null,
      { key: v.dbKey, name: v.id.name, desc: VILLAGER_DESC_EN[villagers.indexOf(v)] || 'villager', ent: v });
    if (!AI_TEXT_OFF && !v.aiPending && Math.random() < 0.35) {
      v.aiPending = true;
      const sp = todaySpecial();
      aiLine(
        `你是中世纪王国的村民「${v.id.name}」。现在是${SEASONS[seasonIdx()]}季` +
        `${sp ? '·' + sp.name : ''},${{ dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜里' }[dayPhase()]},` +
        `天气${{ clear: '晴', cloudy: '多云', rain: '下雨', storm: '雷暴' }[weather.state]}。` +
        (workspace.current ? `眼前这位客人的近况:${workspace.current.t}。` : '') +
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
  // 上马
  let best = null, bd = 7;
  for (const h of horses) {
    const d = dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z);
    if (d < bd) { bd = d; best = h; }
  }
  // 墓园漫步:读一块墓志铭(最低优先级,别挡着上马;AI 后台补写新碑文)
  if (!best && dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    const text = epitaphAI || EPITAPHS[epitaphIdx++ % EPITAPHS.length];
    epitaphAI = null;
    openDialog(['(你拂去一块墓碑上的落叶)', `「${text}」`]);
    if (!AI_TEXT_OFF && !aiBusy.epitaph) {
      aiBusy.epitaph = true;
      aiLine('为中世纪村庄墓园写一条墓志铭,15~40字,可庄重可幽默可温柔,只输出铭文本身,不要引号。', null, 9000)
        .then((t) => { aiBusy.epitaph = false; if (t) epitaphAI = t; });
    }
    return;
  }
  if (best) {
    if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
    player.mounted = best;
    player.jumps = 0;
    if (best.sheep) remember('骑上了一头羊。羊没同意', 'firstsheep');
    else if (best.chunk) {
      remember('在无尽荒野驯服了一匹无主的野马', 'wildhorse');
      if (!best.aiName && !AI_TEXT_OFF) {
        best.aiName = true;
        aiLine('给一匹中世纪奇幻世界里刚被驯服的野马起一个两字中文名,只输出名字,不要引号和解释。', null, 6000)
          .then((t) => {
            if (t && t.trim().length <= 4) {
              const nm = t.trim();
              toast(`🐴 你给它取名「${nm}」。它甩了甩鬃毛,大概是同意了。`, 3.5);
              remember(`给驯服的野马取名「${nm}」`);
            }
          });
      }
    }
    else remember('第一次翻身上马', 'firstride');
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

function dismissMinions() {
  // Boss 一倒,狂暴亲卫作鸟兽散(免得留下两个不被剔除的常驻敌人)
  for (let i = bandits.length - 1; i >= 0; i--) {
    if (bandits[i].minion) {
      scene.remove(bandits[i].group);
      bandits.splice(i, 1);
    }
  }
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
      if (trialRT.active) endTrial(false); // 接正赛前先收计时赛的环
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
  remember(`替领主府办结了委托「${m.title}」`, `m-${quest.idx}`);
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
// 近战横扫判定:普通挥击与蓄力重击共用(dmg/范围/角度/击退可调)
// ================= 打击手感核心 =================
// 攻击磁吸:出手瞬间吸附朝向前方最近的敌人,差一步自动垫步,人跟着刀走
function faceNearestFoe(range) {
  let best = null, bd = (range + 2.4) * (range + 2.4);
  // 锁定中:刀只认锁定的目标,免得磁吸把人拽向别的敌人
  if (lockFoe && !lockFoe.dead && !(lockFoe.downT > 0)) {
    const dx = lockFoe.pos.x - player.pos.x, dz = lockFoe.pos.z - player.pos.z;
    const d2v = dx * dx + dz * dz;
    if (d2v < (range + 3.5) * (range + 3.5)) best = { d: Math.sqrt(d2v) || 1, dx, dz };
  }
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  if (!best) for (const list of [bandits, wolves, guards]) {
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d2v = dx * dx + dz * dz;
      if (d2v > bd) continue;
      const d = Math.sqrt(d2v) || 1;
      if ((dx * fx + dz * fz) / d < 0.05) continue; // 只吸前方 ~±87°
      bd = d2v;
      best = { d, dx, dz };
    }
  }
  if (!best) return;
  player.yaw = Math.atan2(best.dx, best.dz); // 刀锋咬住目标
  const gap = best.d - (range - 0.5);
  const step = gap > 0 ? Math.min(gap, 1.5) : 0.3; // 够不着就垫步;够得着也向前压半步
  player.pos.x += (best.dx / best.d) * step;
  player.pos.z += (best.dz / best.d) * step;
  resolveCollisions(player.pos, 0.45, colliders);
}
// ================= 目标锁定(Tab)=================
// 骑砍式对峙:镜头咬住敌人环绕,人始终面向目标侧移;死亡/倒地/拉开距离自动解除
let lockFoe = null;
const lockMark = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 4),
  new THREE.MeshBasicMaterial({ color: 0xff4433, transparent: true, opacity: 0.9, depthWrite: false }));
lockMark.rotation.x = Math.PI; // 尖朝下悬在头顶
lockMark.visible = false;
lockMark.frustumCulled = false;
scene.add(lockMark);
function toggleLock() {
  if (!started || player.dead) return;
  if (lockFoe) { lockFoe = null; lockMark.visible = false; sfx.roll(); return; }
  let best = null, bd = 20 * 20;
  for (const list of [bandits, wolves, guards]) {
    if (list === guards && wanted === 0) continue; // 没通缉就别锁卫兵
    for (const e of list) {
      if (e.dead || e.downT > 0) continue;
      const d2v = dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z);
      if (d2v < bd) { bd = d2v; best = e; }
    }
  }
  if (best) { lockFoe = best; sfx.equip(); }
  else toast('附近没有可锁定的目标', 1.2);
}
// 锁定目标血条(名字 + 血量,顶部居中)
const lockhpEl = document.getElementById('lockhp'),
  lockhpNameEl = document.getElementById('lockhp-name'),
  lockhpFillEl = document.getElementById('lockhp-fill');
function foeName(e) {
  if (e.warlord) return '⚔️ 战团枭首';
  if (e.boss) return '🪓 血斧巴罗克';
  if (e.bountyHead) return '💀 悬赏要犯';
  if (e.duel) return '🗡️ 决斗者';
  if (wolves.includes(e)) return '🐺 恶狼';
  if (guards.includes(e)) return '🛡️ 王国卫兵';
  return '🔪 盗贼';
}
function updateLock(dt) {
  if (!lockFoe) { lockhpEl.style.display = 'none'; return; }
  if (lockFoe.dead || lockFoe.downT > 0 || player.dead ||
      dist2(player.pos.x, player.pos.z, lockFoe.pos.x, lockFoe.pos.z) > 26 * 26 ||
      (!bandits.includes(lockFoe) && !wolves.includes(lockFoe) && !guards.includes(lockFoe))) {
    lockFoe = null;
    lockMark.visible = false;
    lockhpEl.style.display = 'none';
    return;
  }
  lockMark.visible = true;
  const h = lockFoe.parts && lockFoe.parts.head ? 2.45 : 1.5; // 人形头顶/狼背上方
  lockMark.position.set(lockFoe.pos.x,
    (lockFoe.pos.y || 0) + h + Math.sin(performance.now() * 0.006) * 0.07, lockFoe.pos.z);
  lockMark.rotation.y += dt * 3;
  lockFoe._maxHp = Math.max(lockFoe._maxHp || 0, lockFoe.hp); // 见过的最高血量当上限
  lockhpEl.style.display = 'block';
  lockhpNameEl.textContent = foeName(lockFoe);
  lockhpFillEl.style.width = `${Math.max(0, Math.min(1, lockFoe.hp / lockFoe._maxHp)) * 100}%`;
}

// ================= 战斗音乐:遇敌切紧张曲,脱战 4 秒回吟游调 =================
let combatCalmT = 0;
function updateCombatMusic(dt) {
  let hot = false;
  for (const list of [bandits, wolves]) {
    for (const e of list) {
      if (e.dead || e.downT > 0 || e.fleeT > 0) continue;
      if (dist2(player.pos.x, player.pos.z, e.pos.x, e.pos.z) < 14 * 14) { hot = true; break; }
    }
    if (hot) break;
  }
  if (!hot && wanted > 0) { // 被通缉追捕也算交战
    for (const g of guards) {
      if (g.downT > 0 || g.state !== 'chase') continue;
      if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16 * 16) { hot = true; break; }
    }
  }
  combatCalmT = hot ? 4 : Math.max(0, combatCalmT - dt);
  setCombatMusic(combatCalmT > 0, warband.active && warband.siege);
}
// ================= 盗贼战团(骑砍式野战遭遇)=================
// 每隔几分钟,一支五人战团(枭首+四喽啰)从旷野压向王都:半路截杀=犒赏,放进城=集市遭殃
const warband = { active: false, members: [], cd: 100 + Math.random() * 60, lootT: 0, wave: 0 };
function spawnWarband() {
  warband.active = true;
  warband.members = [];
  warband.lootT = 0;
  warband.pKills = 0;
  warband.gKills = 0;
  const a = Math.random() * Math.PI * 2;
  const sx = Math.cos(a) * 120, sz = Math.sin(a) * 120;
  // 越剿越强:每覆灭一支,下一支多一个喽啰(封顶 8),枭首更硬;每第四波=倾巢攻城
  warband.siege = (warband.wave + 1) % 4 === 0 && warband.wave > 0;
  const grunts = warband.siege ? 9 : Math.min(8, 4 + warband.wave);
  const lead = addBandit(sx, sz, { hp: warband.siege ? 12 : 8 + warband.wave, dmg: 2, speed: 5.4, scale: 1.12 });
  lead.warlord = true;
  lead.duel = true; // 借精英出招库:紫圈重击+二连击
  lead.warband = true;
  warband.members.push(lead);
  for (let i = 0; i < grunts; i++) {
    const b = addBandit(sx + (Math.random() * 8 - 4), sz + (Math.random() * 8 - 4), { hp: 3 });
    b.warband = true;
    warband.members.push(b);
  }
  const compass = Math.abs(sx) > Math.abs(sz) ? (sx > 0 ? '东' : '西') : (sz > 0 ? '南' : '北');
  if (warband.siege) {
    toast(`🚨 攻城警报!!枭首纠集 ${warband.members.length} 人大队从${compass}面强攻王都!卫兵已列阵迎敌——并肩守城!(冲到枭首面前按 E 可阵前单挑)`, 6);
    sfx.wanted();
    { // 城防:来袭方向支起两座拒马迟滞敌军
      const dl = Math.hypot(sx, sz - 10) || 1;
      const ux = sx / dl, uz = (sz - 10) / dl;
      addBarricade(ux * 24 - uz * 3, 10 + uz * 24 + ux * 3);
      addBarricade(ux * 30 + uz * 3, 10 + uz * 30 - ux * 3);
      toast('🪵 卫兵连夜在城门外支起了拒马!(敌军踩入减速)', 3.5);
    }
  } else {
    toast(`⚠️ 斥候急报:一支盗贼战团(${warband.members.length} 人)正从${compass}面逼近王都!半路截住他们!` +
      (warband.wave > 0 ? '(为复仇而来,比上次更凶)' : ''), 5);
  }
  sfx.warn();
}
function disbandWarband(escaped) {
  for (const b of warband.members) {
    if (escaped && !b.dead) { b.dead = true; b.group.visible = false; }
    const gone = b;
    setTimeout(() => { // 尸体躺一会儿再收,别当场蒸发
      scene.remove(gone.group);
      const i = bandits.indexOf(gone);
      if (i >= 0) bandits.splice(i, 1);
    }, 4000);
  }
  warband.members = [];
  warband.active = false;
  warband.cd = 150 + Math.random() * 120;
}
// 枭首临阵叫骂:走近了他会冲你喊话;复仇之师另有一套狠话,偶尔帮众跟着起哄(吃活体语料)
const WARLORD_TAUNTS = [
  '这座城的卫兵,还没我营里的火夫能打!',
  '把值钱的交出来,饶你一条腿!',
  '兄弟们——集市是我们的了!',
  '听说你很能打?正好,我的刀锈了。',
  '别躲了,出来领死!',
];
const WARLORD_REVENGE = [
  '上次死的是我兄弟——今天拿你抵命!',
  '记住这面旗,它会插在你坟头!',
  '我们回来了,这次带够了人手!',
];
function updateWarband(dt) {
  if (!started || player.dead) return;
  if (!warband.active) {
    if (!prologue.on) warband.cd -= dt;
    if (warband.cd <= 0) spawnWarband();
    return;
  }
  // 阵前单挑:枭首一死,全军夺气而溃——兵不血刃
  if (warband.duelOn) {
    const lead = warband.members.find((b) => b.warlord);
    if (!lead || lead.dead) {
      warband.duelOn = false;
      const wasSiege = warband.siege;
      warband.wave++;
      for (const b of warband.members) if (!b.dead) { b._truce = false; b.fleeT = 9; }
      warband.active = false;
      warband.cd = 150 + Math.random() * 120;
      setTimeout(() => disbandWarband(true), 3500); // 跑出视野再散伙
      toast('⚔️🏆 枭首伏诛!战团夺气,作鸟兽散——兵不血刃!(+100 金币)', 6);
      sfx.fanfare();
      player.coins += 100;
      if (!player.weaponsOwned.includes('warblade')) { // 夺刀:枭首的佩刃归胜者
        player.weaponsOwned.push('warblade');
        sfx.chest();
        toast('⚜️ 你拾起枭首的佩刃——「枭首之刃」入手!(Q 切换:更快更狠的单手刃)', 5);
        remember('从枭首尸体旁拾起了他的佩刃', 'warblade');
      }
      unlockAch('champion');
      if (wasSiege) unlockAch('wallkeeper');
      remember('阵前单挑斩落枭首,吓散整支战团', `duel-${calendar.day}`);
      return;
    }
  }
  const alive = warband.members.filter((b) => !b.dead);
  warband.tauntT = (warband.tauntT || 0) - dt;
  const lead0 = alive.find((b) => b.warlord);
  if (lead0 && warband.tauntT <= 0 &&
      dist2(player.pos.x, player.pos.z, lead0.pos.x, lead0.pos.z) < 625) {
    warband.tauntT = 9;
    const pool = warband.wave > 0 && Math.random() < 0.6 ? WARLORD_REVENGE : WARLORD_TAUNTS;
    const base = pool[Math.floor(Math.random() * pool.length)];
    const corpus = Array.isArray(EVO.corpus) && EVO.corpus.length && Math.random() < 0.35
      ? `(帮众起哄:${EVO.corpus[Math.floor(Math.random() * EVO.corpus.length)]})` : '';
    toast(`🗯️ 战团枭首:「${base}」${corpus}`, 3.2);
  }
  if (!alive.length) { // 全歼:犒赏;残党记仇,下一支更大
    const wasSiege = warband.siege;
    warband.wave++;
    disbandWarband(false);
    if (wasSiege) {
      toast('🏰 攻城被击退!!卫兵们冲你抱拳——王都记住了这一天。(犒赏 +80 金币)', 6);
      player.coins += 80;
      stats.siegesHeld = (stats.siegesHeld || 0) + 1;
      unlockAch('wallkeeper');
      openDialog([
        `📜 守城战报:敌军 ${warband.pKills + warband.gKills} 人授首——你亲斩 ${warband.pKills} 人,卫兵击破 ${warband.gKills} 人。`,
        warband.pKills >= warband.gKills ? '卫兵队长:「今天这城,是你守下来的。」' : '卫兵队长:「弟兄们今天很卖力——你也不赖。」',
      ]);
      remember('与卫兵并肩击退了强攻王都的盗贼大军', `siege-${calendar.day}`);
    } else {
      toast('🎖️ 战团覆灭!你护住了王都的安宁。(悬赏 +25 金币)', 4.5);
      player.coins += 25;
      stats.warbandsWiped = (stats.warbandsWiped || 0) + 1;
      unlockAch('warbreaker');
      remember('在野外截住并全歼了一支盗贼战团', `warband-${calendar.day}`);
    }
    sfx.fanfare();
    return;
  }
  // 行军:队伍的"锚点"稳步压向广场;贴近玩家的成员自动切普通战斗 AI
  for (const b of alive) {
    const dx = -b.home.x, dz = 10 - b.home.z;
    const d = Math.hypot(dx, dz);
    if (d > 14) {
      b.home.x += (dx / d) * 4.2 * dt;
      b.home.z += (dz / d) * 4.2 * dt;
    }
  }
  // 兵临集市:赖满 20 秒没被赶走=劫掠得手,扬长而去
  const lead = alive[0];
  if (Math.hypot(lead.pos.x, lead.pos.z - 10) < 26) {
    warband.lootT += dt;
    if (warband.lootT > 20) {
      disbandWarband(true);
      toast('💥 盗贼战团劫掠了集市,扬长而去!商人们叫苦不迭……', 5);
      remember('没能拦住劫掠集市的盗贼战团', `warloot-${calendar.day}`);
    }
  }
}

// ================= 士气(骑砍式):血腥震慑,残兵溃逃 =================
let streakN = 0, streakT = 0;
function frightenBandits(radius = 14) {
  let fled = 0;
  for (const o of bandits) {
    if (o.dead || o.downT > 0 || o.boss) continue; // 头目不吃这套
    if (dist2(player.pos.x, player.pos.z, o.pos.x, o.pos.z) > radius * radius) continue;
    if (o.hp <= 2 || Math.random() < 0.45) { // 残血必逃,满血看胆量
      o.fleeT = Math.max(o.fleeT || 0, 5 + Math.random() * 3);
      fled++;
    }
  }
  return fled;
}
function banditSlain(b) {
  // 枭首之刃嗜血:持刃击杀回 4 体力——刀认得血的味道
  if (player.weapon === 'warblade') player.sta = Math.min(player.maxSta, player.sta + 4);
  // 阵斩枭首:夺军旗——永久体力上限 +5(封顶 180),外加一把赏金
  if (b && b.warlord) {
    stats.banners = (stats.banners || 0) + 1;
    player.maxSta = Math.min(180, player.maxSta + 5);
    player.sta = player.maxSta;
    dropCoins(b.pos, 10);
    sfx.chest();
    toast(`🚩 夺得战团军旗!(第 ${stats.banners} 面:体力上限 +5 → ${player.maxSta},当场回满)`, 4.5);
    remember(`阵斩战团枭首,夺下第 ${stats.banners} 面军旗`, `banner-${stats.banners}`);
    refreshTrophies(); // 军旗直接挂上家里的战利品墙
  }
  const now = performance.now();
  streakN = (now - streakT < 6000) ? streakN + 1 : 1;
  streakT = now;
  if (streakN >= 3) {
    streakN = 0;
    if (frightenBandits() > 0) {
      toast('😱 连杀震慑:附近的盗贼胆寒溃逃!', 2.5);
      sfx.warn();
    }
  }
}
let meleeExecBase = 0; // 处决基准伤害:出手前由 tryAttack/heavyAttack 填入(不含弹反/偷袭乘区)
// 盗贼死亡统一出口:任何来源(法术/爆炸/战吼/佣兵/白狼)都走全套结算,漏一项就是审计单上的 bug
function slayBandit(b, opts = {}) {
  if (b.dead) return;
  b.dead = true;
  startFall(b);
  if (!opts.companion) registerKill(); // 伙伴击杀不进玩家连杀
  choreProgress('bandits');
  banditSlain(b); // 军旗/士气结算
  if (b.boss) dismissMinions();
  if (b.warband) warband[opts.companion ? 'gKills' : 'pKills'] = (warband[opts.companion ? 'gKills' : 'pKills'] || 0) + 1;
  dropCoins(b.pos, b.boss ? 20 : opts.coins ?? 5);
  if (quest.active && missions[quest.idx].type === 'bandits' && !b.boss && !b.escort && !b.bountyHead &&
      !b.robber && !b.arena && !b.ambient && !b.duel && !b.convict && !b.eventFoe) {
    quest.progress++;
    toast(`击败盗贼 ${quest.progress}/3${opts.credit ? `(${opts.credit}!)` : ''}`, 2);
    if (quest.progress >= 3) completeMission();
  }
}
// 剑光拖尾:每次挥砍横扫出一道弧光,0.16 秒燃尽
const trailFX = [];
const trailMat = new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.5,
  side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
function swingTrail(range, arc = 2.1, dir = 1) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.5, range * 0.45), range, 1, 10, Math.PI / 2 - arc / 2, arc),
    trailMat.clone());
  if (whiteHot()) ring.material.color.setHex(0xffd75e); // 白热连杀:剑光化金
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.position.set(player.pos.x, 1.05, player.pos.z);
  g.rotation.y = player.yaw;
  // 连斩分段:一段左挥(下压斜面)、二段右挥(镜像反斜)、三段平扫压轴
  if (dir === 1) g.rotation.x = 0.28;
  else if (dir === -1) { g.scale.x = -1; g.rotation.x = -0.28; }
  scene.add(g);
  trailFX.push({ g, ring, t: 0, mx: g.scale.x });
}
// 魔法命中碎光:一团加色蓝光炸开(复用拖尾的生灭管线)
function magBurst(x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.set(x, y, z);
  scene.add(m);
  trailFX.push({ g: m, ring: m, t: -0.08, mx: 1 }); // 负起点=多亮一拍
}
function updateTrails(dt) {
  for (let i = trailFX.length - 1; i >= 0; i--) {
    const f = trailFX[i];
    f.t += dt;
    const k = f.t / 0.16;
    if (k >= 1) {
      scene.remove(f.g);
      f.ring.geometry.dispose();
      f.ring.material.dispose();
      trailFX.splice(i, 1);
      continue;
    }
    f.ring.material.opacity = 0.5 * (1 - k);
    f.g.scale.setScalar(1 + k * 0.5);
    f.g.scale.x *= f.mx || 1; // 保住镜像方向
  }
}

function meleeSweep(dmg, range, arcDot, knock) {
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  // 处决:对踉跄中的敌人(弹反/盾击/冰冻后)出手 = ×5 终结,配慢动作
  let executed = false, execTarget = null;
  const execBase = meleeExecBase || dmg; // 进场即取:tryAttack 带入的无乘区基准
  meleeExecBase = 0; // 用一次即弃,避免残留到别的横扫
  const execDmg = (e) => {
    if (dmg > 0 && e.stunT > 0.3) {
      executed = true;
      execTarget = e;
      // 处决按基础伤害 ×5 结算,弹反 ×2.5/偷袭 ×3 不再叠上去
      return execBase * 5;
    }
    return dmg;
  };
  const hitOne = (list, onHit) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < range && (dx * fx + dz * fz) / (d || 1) > arcDot) onHit(e);
    }
  };
  hitOne(guards, (g) => {
    const dmg = execDmg(g);
    g.hp -= dmg; sfx.hitMetal(); hitFX(g, knock); showDamage(g.pos, dmg, dmg >= 3); // 砍在甲上叮当响
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你袭击了卫兵!'); }
    if (g.hp <= 0) downGuard(g);
    else g.state = 'chase';
  });
  hitOne(bandits, (b) => {
    // 战术演化:被砍多了的匪帮学会举盾——普通斩击有概率被格挡(重击/跳劈 dmg 高,破格挡)
    if (dmg > 0 && dmg < 3 && !b.stunT && Math.random() < EVO.tactics.block * 0.5) {
      sfx.clank();
      hitFX(b, knock * 0.3);
      showDamage(b.pos, 0);
      return;
    }
    const dmg2 = execDmg(b);
    b.hp -= dmg2; sfx.hit(); hitFX(b, b.boss ? knock * 0.4 : knock);
    showDamage(b.pos, dmg2, dmg2 >= 3);
    // 破防:重刃(下劈/重击 dmg≥3)砸在举盾的人身上=盾开人晃,处决窗口大开
    if (dmg >= 3 && !(b.stunT > 0) && b.hp > 0 && Math.random() < EVO.tactics.block * 0.6) {
      b.stunT = 1.1;
      sfx.clank();
      toast('🛡️💥 破防!(踉跄中挨刀=处决 ×5)', 1.2);
    }
    if (b.hp <= 0) {
      b.dead = true; startFall(b); registerKill(); choreProgress('bandits');
      EVO.kills.melee++;
      if (b.warband) warband.pKills = (warband.pKills || 0) + 1;
      banditSlain(b);
      dropCoins(b.pos, b.boss ? 20 : 5);
      addPickup('heart', b.pos.x, b.pos.z + 1, 30);
      if (b.boss) { toast('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 5); dismissMinions(); }
      if (quest.active && missions[quest.idx].type === 'bandits' && !b.boss && !b.escort && !b.bountyHead && !b.robber && !b.arena && !b.ambient && !b.duel && !b.convict && !b.eventFoe) {
        quest.progress++;
        toast(`击败盗贼 ${quest.progress}/3`, 2);
        if (quest.progress >= 3) completeMission();
      }
    }
  });
  hitOne(wolves, (w) => {
    const dmg3 = execDmg(w);
    w.hp -= dmg3; sfx.hitFlesh(); hitFX(w, knock); showDamage(w.pos, dmg3, dmg3 >= 3); // 砍进皮肉闷声
    if (w.hp <= 0) killWolf(w);
  });
  if (executed) { // 处决演出:时停 + 震屏 + 镜头急推;目击者胆寒;按武器各有终结技
    hitStopT = Math.max(hitStopT, 0.22);
    camShake = Math.max(camShake, 0.45);
    fovKick = 0.4;
    slowMoT = 0.55;
    if (execTarget) {
      if (player.weapon === 'dagger') {
        // 影袭:黑雾一闪,人已在目标身后收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
        const dx = execTarget.pos.x - player.pos.x, dz = execTarget.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        player.pos.x = execTarget.pos.x + (dx / d) * 1.1;
        player.pos.z = execTarget.pos.z + (dz / d) * 1.1;
        resolveCollisions(player.pos, 0.45, colliders);
        player.yaw = Math.atan2(-dx, -dz); // 转身面向尸体,收刀
        magBurst(player.pos.x, 1.0, player.pos.z);
      } else if (player.weapon === 'greatsword') {
        // 断头台:巨剑砸出冲击环,大地都跟着响
        camShake = Math.max(camShake, 0.65);
        spawnDust(execTarget.pos.x, 0.2, execTarget.pos.z, 14, 2.2, 2.2);
        swingTrail(3.2, Math.PI * 2);
        sfx.stomp();
      } else {
        // 铁剑:十字剑光收势
        swingTrail(2.7, 2.3, 1);
        swingTrail(2.7, 2.3, -1);
      }
    }
    if (frightenBandits(11) > 0) toast('😱 目睹处决,盗贼胆寒溃逃!', 2.2);
    sfx.kill();
    toast('⚔️ 处决!(×5)', 1.6);
    stats.executions = (stats.executions || 0) + 1;
    if (stats.executions >= 10) unlockAch('executioner');
  }
  hitOne(deers, (d) => {
    sfx.hitFlesh();
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

function tryAttack() {
  // 盾击:举盾状态下出手——不掉血,但把面前的敌人撞个踉跄
  if (started && !player.dead && player.blocking && !(player.rollT > 0) &&
      !(player.attackT > 0) && !player.mounted && player.weapon !== 'bow') {
    if (player.staggerT > 0 || !spendSta(12)) return;
    player._stance = null;
    player.attackT = 0.7;
    player.attackDur = 0.7;
    sfx.clank();
    camShake = Math.max(camShake, 0.2);
    // 先定踉跄再撞飞——击退会把人推出判定圈
    for (const list of [bandits, guards, wolves]) {
      for (const e of list) {
        if (e.dead || e.downT > 0 || e.stunT === undefined) continue;
        const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 2.4 && (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) / (d || 1) > 0.25) {
          e.stunT = Math.max(e.stunT || 0, 1.3);
        }
      }
    }
    meleeSweep(0, 2.2, 0.25, 1.6);
    return;
  }
  // 骑射 + 骑砍:马背上开弓,或直接挥剑(骑砍式马上近战,伤害 +1、范围加长)
  if (!started || player.dead || player.attackT > 0 || player.carrying ||
      player.blocking || player.rollT > 0) return;
  if (player.mounted && player.weapon !== 'bow' && !player.mounted.sheep) {
    if (player.staggerT > 0 || !spendSta(10)) return; // 马上挥刀一样费力气
    const defM = WEAPONS[player.weapon];
    player._stance = null;
    player.attackT = defM.cd * 1.1;
    player.attackDur = defM.cd * 1.1;
    sfx.sword();
    // 冲量伤害(骑砍之魂):马速借给刀锋——疾驰一刀 +2,小跑 +1,原地无加成
    const mom = (player._rideSpeed || 0) >= 15 ? 2 : (player._rideSpeed || 0) >= 8 ? 1 : 0;
    if (mom >= 2) { sfx.whoosh(0.7); camShake = Math.max(camShake, 0.18); }
    swingTrail(defM.range + 1.0, 2.3);
    meleeSweep(meleeBonus(defM.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + 1 + mom),
      defM.range + 1.0, 0.1, defM.knock * (1.4 + mom * 0.5));
    skillXp('onehand', 1);
    skillXp('riding', 1);
    return;
  }
  if (player.mounted) {
    if (player.weapon !== 'bow') return; // 羊背上还是算了
  }
  const def = WEAPONS[player.weapon];
  // 跳劈:空中出手——砸向地面,落点四方溅开一圈冲击
  if (player.staggerT > 0) return; // 踉跄中出不了手
  if (!player.onGround && !player.mounted && player.weapon !== 'bow' && !player.plunging) {
    if (!spendSta(14)) return;
    player._stance = 'overhead'; // 跳劈就是从天而降的下劈
    player.plunging = true;
    player.vy = -16;
    player.attackT = def.cd;
    player.attackDur = def.cd * 1.4;
    sfx.sword();
    return;
  }
  if (player.weapon === 'bow') {
    player._stance = null;
    player.attackT = def.cd;
    player.attackDur = def.cd;
    shootArrow();
    return;
  }
  // 方向攻击(骑砍式):攻击跟着移动方向走——W+攻=突刺,S+攻=下劈,其余=横斩
  const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  let stance = 'slash';
  if (!shiftHeld && (keys['KeyW'] || keys['ArrowUp'])) stance = 'thrust';
  else if (!shiftHeld && (keys['KeyS'] || keys['ArrowDown'])) stance = 'overhead';
  if (!spendSta(Math.round((stance === 'overhead' ? 16 : stance === 'thrust' ? 10 : 12) *
    (def.staMul || 1)))) return;
  player._stance = stance === 'slash' ? null : stance; // 挥刀动画按招式走
  const hotMul = whiteHot() ? 0.72 : 1; // 白热:出刀更快
  player.attackT = def.cd * hotMul;
  player.attackDur = def.cd * hotMul;
  sfx.sword();
  if (dist2(player.pos.x, player.pos.z, 140, 20) < 80) unlockAch('windmill');
  // 三连斩:0.9 秒内连续出手,第三剑更重、附带大击退
  const now = performance.now();
  player.chainN = (now - (player.chainT || 0) < 900) ? (player.chainN || 0) + 1 : 1;
  player.chainT = now;
  const third = player.chainN >= 3;
  if (third) {
    player.chainN = 0;
    sfx.combo(3);
    camShake = Math.max(camShake, 0.22);
  }
  // 冲刺突斩:疾跑中出手——整个人扑出去,带尘土与额外一分力
  const sprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && player.onGround && !player.sneaking &&
    (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']);
  if (sprinting) {
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    player.pos.x += fx * 2.8;
    player.pos.z += fz * 2.8;
    resolveCollisions(player.pos, 0.45, colliders);
    spawnDust(player.pos.x - fx, 0.1, player.pos.z - fz, 8, 1.2, 1.4);
    camShake = Math.max(camShake, 0.15);
    sfx.roll();
  }
  // 弹反还击:完美弹反后 1.5 秒内的这一击 ×2.5
  let riposteMul = 1;
  if (player.riposteT > 0) {
    riposteMul = 2.5;
    player.riposteT = 0;
    sfx.combo(5);
    hitStopT = Math.max(hitStopT, 0.1);
    toast('⚡ 还击!(×2.5)', 1.4);
  }
  // 潜行偷袭:蹲行状态近身出手 ×3(短匕是行家家伙,×4)
  const sneakMul = player.sneaking ? (player.weapon === 'dagger' ? 4 : 3) : 1;
  if (player.sneaking) toast(`🗡️ 偷袭!(×${sneakMul})`, 1.2);
  // 旋风斩:武艺 5 级起,三连斩的第三剑变成全周横扫
  const whirl = third && skillLv('onehand') >= 5;
  const reach = def.range + (third ? 0.4 : 0) + (sprinting ? 0.4 : 0) +
    (stance === 'thrust' ? 0.9 : stance === 'overhead' ? 0.1 : 0); // 突刺够得远
  if (!player.sneaking) faceNearestFoe(reach); // 攻击磁吸:刀锋咬住目标(潜行例外,别打草惊蛇)
  const dir = (whirl || third || stance !== 'slash') ? 0 : (player.chainN % 2 ? 1 : -1);
  sfx.whoosh(stance === 'overhead' ? 0.72 : stance === 'thrust' ? 1.3 :
    third ? 0.82 : dir === 1 ? 1 : 1.14); // 每种出手音高不同,耳朵能分招
  swingTrail(reach, whirl ? Math.PI * 2 : stance === 'thrust' ? 0.55 :
    stance === 'overhead' ? 1.0 : third ? 2.6 : 2.1, dir);
  meleeExecBase = Math.round(meleeBonus(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) +
    (third ? 1 : 0) + (sprinting ? 1 : 0) + (stance === 'overhead' ? 2 : stance === 'thrust' ? 1 : 0)));
  meleeSweep(Math.round(meleeBonus(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) +
    (third ? 1 : 0) + (sprinting ? 1 : 0) +
    (stance === 'overhead' ? 2 : stance === 'thrust' ? 1 : 0)) * sneakMul * riposteMul),
  reach,
  whirl ? -1.01 : stance === 'thrust' ? 0.86 : stance === 'overhead' ? 0.5 : 0.35,
  def.knock * (third ? 1.8 : 1) * (sprinting ? 1.3 : 1) *
    (stance === 'overhead' ? 1.5 : stance === 'thrust' ? 0.6 : 1));
  if (stance === 'overhead') camShake = Math.max(camShake, 0.12); // 下劈坠着劲
  if (whirl) { camShake = Math.max(camShake, 0.2); spawnDust(player.pos.x, 0.5, player.pos.z, 10, 2, 1.6); }
  skillXp('onehand', 1);
  if (player.sneaking) skillXp('sneak', 2);
}

// 蓄力重击:按住 F 约 0.7 秒自动挥出 —— 双倍伤害、超广角横扫、大击退
function heavyAttack() {
  if (player.staggerT > 0 || player.blocking || player.rollT > 0) return; // 盾举着/翻滚中抡不了大的
  // 蓄力技按武器分家:短匕掷飞刀,猎弓开满月,刀剑抡重击
  if (player.weapon === 'dagger') { if (!spendSta(10)) return; throwKnife(); return; }
  if (player.weapon === 'bow') { if (!spendSta(12)) return; chargedShot(); return; }
  if (!spendSta(Math.round(22 * (WEAPONS[player.weapon].staMul || 1)))) return;
  const def = WEAPONS[player.weapon];
  player._stance = 'overhead'; // 重击=抡满的下劈动作
  player.attackT = def.cd * 1.6;
  player.attackDur = def.cd * 1.6;
  sfx.sword();
  sfx.clank();
  camShake = Math.max(camShake, 0.3);
  hitStopT = Math.max(hitStopT, 0.06);
  // 巨剑专属:蓄力横扫近乎全周,击退更狠(势大力沉的代价是它本来就慢)
  const wide = player.weapon === 'greatsword';
  faceNearestFoe(def.range + 0.7);
  sfx.whoosh(0.7); // 重击破空声最沉
  swingTrail(def.range + 0.7, wide ? Math.PI * 1.7 : Math.PI, 0);
  meleeSweep(meleeBonus((def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0)) * 2),
    def.range + 0.7, wide ? -0.6 : -0.1, def.knock * (wide ? 2.3 : 1.8));
  skillXp('onehand', 1);
  stats.heavies = (stats.heavies || 0) + 1;
}

// 飞刀(短匕蓄力):平直高速,一刀一命换着算
function throwKnife() {
  player.attackT = 0.5;
  player.attackDur = 0.5;
  sfx.arrow();
  sfx.clank();
  const dir = new THREE.Vector3(Math.sin(player.yaw), 0.02, Math.cos(player.yaw)).normalize();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.85, roughness: 0.25 }));
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.2, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dir.multiplyScalar(34), ttl: 2, stuck: false,
    dmg: meleeBonus(2 + (player.swordLv >= 2 ? 1 : 0)), knife: true });
  skillXp('onehand', 1);
}
// 满月强弓(猎弓蓄力):×2 伤害、破空疾飞、可贯穿三人
function chargedShot() {
  player.attackT = WEAPONS.bow.cd * 1.4;
  player.attackDur = WEAPONS.bow.cd * 1.4;
  sfx.arrow();
  camShake = Math.max(camShake, 0.12);
  const jit = wetSpread(0.5); // 满月拉满弓,受雨影响减半
  const dir = new THREE.Vector3(Math.sin(player.yaw + jit), 0.03, Math.cos(player.yaw + jit)).normalize();
  const mesh = new THREE.Mesh(arrowGeo, arrowMat);
  const pos = new THREE.Vector3(player.pos.x + dir.x * 0.6, player.pos.y + 1.15, player.pos.z + dir.z * 0.6);
  mesh.position.copy(pos);
  mesh.scale.set(1.4, 1.4, 1.4);
  scene.add(mesh);
  arrows.push({ mesh, pos, vel: dir.multiplyScalar(42), ttl: 2.5, stuck: false,
    dmg: arrowBonus((WEAPONS.bow.dmg + (player.swordLv >= 2 ? 1 : 0)) * 2), pierce: 2, _hits: [] });
  skillXp('archery', 2);
  toast('🏹 满月!', 1);
}

function dropCoins(pos, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28;
    addPickup('coin', pos.x + Math.cos(a) * (0.6 + Math.random()), pos.z + Math.sin(a) * (0.6 + Math.random()), 25);
  }
}

function damagePlayer(n, attacker = null, pierce = false) {
  if (player.invulnT > 0 || player.dead) return;
  if (player.blocking && player.rollT <= 0) {
    // 完美弹反:出手前 0.25 秒内举盾 → 攻击者踉跄 2 秒 + 时停
    if (attacker && attacker.stunT !== undefined &&
        performance.now() - (player.blockStart || 0) < 250) {
      attacker.stunT = Math.max(attacker.stunT || 0, 2.2);
      hitStopT = Math.max(hitStopT, 0.14);
      camShake = Math.max(camShake, 0.25);
      sfx.clank();
      sfx.clear();
      toast('⚡ 完美弹反!(1.5 秒内出手=还击 ×2.5)', 1.6);
      stats.parries = (stats.parries || 0) + 1;
      if (stats.parries >= 5) unlockAch('parry');
      player.invulnT = 0.5;
      player.riposteT = 1.5; // 还击窗口
      player.sta = Math.min(player.maxSta, player.sta + 10); // 完美弹反回气:精准的奖赏
      return;
    }
    if (pierce) { // 紫圈重击:格挡被砸碎,硬吃一记减伤——早该翻滚的
      sfx.clank();
      sfx.hurt();
      camShake = Math.max(camShake, 0.4);
      toast('🛡️💥 重击砸碎了格挡!(紫圈来袭要翻滚)', 1.6);
      player.hp -= 1;
      player.invulnT = 0.7;
      flashEl.style.opacity = 0.45;
      setTimeout(() => (flashEl.style.opacity = 0), 120);
      if (player.hp <= 0) gameOver();
      return;
    }
    // 格挡也要花力气:每挡一下 -8 体力,挡空了盾会被砸开
    sfx.clank();
    player.sta = Math.max(0, player.sta - 8);
    if (player.sta <= 0) {
      player.blocking = false;
      player.staggerT = 0.9;
      player.gaspT = 1.2;
      camShake = Math.max(camShake, 0.35);
      toast('🛡️💫 力竭!盾被砸开了——快翻不动了', 1.5);
      sfx.hiccup();
      player.invulnT = 0.5;
      return;
    }
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
  if (prologue.on) skipPrologue(true); // 序章里倒下:直接放行,别卡教学
  if (warband.duelOn) { // 单挑落败:誓约解除,攻城继续
    warband.duelOn = false;
    warband.members.forEach((b) => { b._truce = false; });
  }
  if (dialog.open) { dialog.open = false; dialogEl.style.display = 'none'; dialog.onDone = null; } // 人都倒了,话就别说了
  player.fireChargeT = 0;
  player.dead = true;
  player.hp = 0;
  player.drunkT = 0;
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  sfx.gameover();
  if (trialRT.active) endTrial(false);
  stats.deaths = (stats.deaths || 0) + 1;
  // 它眼睁睁看着他倒下:这颗心的重大事件——心境重击、惊讶拉满、记进长期记忆
  workspace.mood.v = Math.max(-1, workspace.mood.v - 0.5);
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.5);
  MIND.surprise = Math.max(MIND.surprise, 0.8);
  remember(`它眼睁睁看着他倒下了(第 ${stats.deaths} 次)`, `death-${calendar.day}`);
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
    if (player.jailed && player.loot > 0) { player.loot = 0; } // 赃物人赃并获,全数充公
    toast(player.jailed
      ? '⛓️ 你在王都地牢蹲了一夜,罚没一半金币后被踢了出来。' + (player.loot === 0 ? '(兜里的赃物也被搜走了)' : '')
      : stats.deaths >= 3
        ? `你第 ${stats.deaths} 次在喷泉旁醒来。水声轻得……像是有谁悄悄调小了。`
        : '你在喷泉旁醒来,一半金币被没收充公…', 4);
  }, 2600);
}

// ================= 实体更新 =================
function moveEntity(e, tx, tz, speed, dt) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  speed *= frostSlow(e); // 踩着冰面腿脚发僵
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
function meleeSwing(p, t, mode) {
  // 突刺:收臂→直臂捅出→回收,身体侧拧送肩(骑砍的枪感)
  if (mode === 'thrust') {
    let arm;
    if (t < 0.28) arm = -0.15 - (t / 0.28) * 0.35;             // 收
    else if (t < 0.55) arm = -0.5 - ((t - 0.28) / 0.27) * 1.15; // 捅
    else arm = -1.65 + ((t - 0.55) / 0.45) * 1.65;              // 收回
    p.armR.rotation.x = arm;
    p.armR.rotation.z = 0.12 * Math.sin(t * Math.PI);
    if (p.body) p.body.rotation.y = -0.4 * Math.sin(t * Math.PI);
    return;
  }
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
  // 下劈:同一条弧线抡得更满、劈得更深,身体跟着前倾压刀
  if (mode === 'overhead') {
    arm *= 1.2;
    if (p.body) p.body.rotation.x = 0.3 * Math.sin(Math.min(1, t / 0.7) * Math.PI);
  } else if (p.body) p.body.rotation.x = 0;
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
      g.windupT = 0; // 蓄力被打断就作废
      g.group.rotation.z = Math.sin(performance.now() * 0.02) * 0.12;
      if (g.stunT <= 0) g.group.rotation.z = 0;
      continue;
    }
    // 攻城战:卫兵放下巡逻,迎击 40 米内最近的战团匪徒(通缉中还是先抓你)
    if (warband.siege && warband.active && wanted === 0 && !warband.duelOn) {
      let tgt = null, td = 1600;
      for (const wb of warband.members) {
        if (wb.dead || wb.downT > 0) continue;
        const d2v = dist2(g.pos.x, g.pos.z, wb.pos.x, wb.pos.z);
        if (d2v < td) { td = d2v; tgt = wb; }
      }
      if (tgt) {
        g.attackCd = Math.max(0, g.attackCd - dt);
        let moving = false;
        if (td > 1.7 * 1.7) { moveEntity(g, tgt.pos.x, tgt.pos.z, g.speed, dt); moving = true; }
        else if (g.attackCd <= 0) {
          g.attackCd = 1.1;
          g.swingT = 0.3;
          tgt.hp -= 1;
          sfx.clank();
          spawnDust(tgt.pos.x, 1.0, tgt.pos.z, 2, 0.4, 1.2);
          showDamage(tgt.pos, 1);
          if (tgt.hp <= 0) slayBandit(tgt, { companion: true, credit: '卫兵击破' });
        }
        g.yaw = angleLerp(g.yaw, Math.atan2(tgt.pos.x - g.pos.x, tgt.pos.z - g.pos.z), dt * 8);
        g.group.position.copy(g.pos);
        g.group.rotation.y = g.yaw;
        g.parts._attackAnim = (g.swingT || 0) > 0;
        animateLimbs(g.parts, g.walkT, moving, g.group, 1.1);
        if (g.swingT > 0) { g.swingT -= dt; meleeSwing(g.parts, Math.min(1, 1 - g.swingT / 0.35)); }
        continue;
      }
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
          if (Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z) < 2.3) damagePlayer(1, g);
        }
      } else if (pd > 1.6) {
        moveEntity(g, player.pos.x, player.pos.z, g.speed, dt);
        moving = true;
      } else if (g.attackCd <= 0) {
        g.windupT = 0.42;
        telegraphFlash(g, 0.42);
      }
      g.yaw = angleLerp(g.yaw, Math.atan2(player.pos.x - g.pos.x, player.pos.z - g.pos.z), dt * 10);
    } else {
      if (g.windupT > 0) g.windupT = 0; // 通缉半路消了:收剑,别举着冻住
      g.state = 'patrol';
      const wp = g.waypoints[g.wp];
      if (moveEntity(g, wp[0], wp[1], g.speed * 0.45, dt)) g.wp = (g.wp + 1) % g.waypoints.length;
      else moving = true;
    }
    g.group.position.copy(g.pos);
    g.group.rotation.y = g.yaw;
    g.parts._attackAnim = (g.swingT || 0) > 0 || (g.windupT || 0) > 0;
    animateLimbs(g.parts, g.walkT, moving, g.group, g.state === 'chase' ? 1.1 : 0.55);
    if (g.windupT > 0) meleeSwing(g.parts, 0.32); // 蓄力:武器高举定住
    else if (g.swingT > 0) {
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
  if (b._trampleCd > 0) b._trampleCd -= dt;
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
          b.windupT = 0; b.swingT = 0; b.heavyAtk = false; b.comboN = 0; b.fleeT = 0; b.stunT = 0; // 上辈子的事一笔勾销
        }
      }
      continue;
    }
    if (!b.boss && !b.escort && !b.robber && !b.convict && !b.bountyHead &&
        !b.duel && !b.arena && !b.eventFoe && !b.warband && entFar(b)) continue; // 远处匪徒待机(战团要行军,不休眠)
    // Boss 二阶段:血量过半即狂暴——提速、加伤、召两名亲卫
    if (b.boss && !b.enraged && b.hp <= 6) {
      b.enraged = true;
      b.speed += 2.2;
      b.dmg = 3;
      telegraphFlash(b);
      hitStopT = Math.max(hitStopT, 0.1);
      sfx.wanted();
      toast('🔥 血斧巴罗克双目赤红——狂暴了!!', 3.5);
      const m1 = addBandit(b.pos.x - 3, b.pos.z, { hp: 2 });
      m1.eventFoe = true;
      m1.minion = true;
      const m2 = addBandit(b.pos.x + 3, b.pos.z, { hp: 2 });
      m2.eventFoe = true;
      m2.minion = true;
    }
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
    if (b.stunT > 0) { // 踉跄:蓄到一半的招一并作废,免得僵直一过凭空补刀
      b.stunT -= dt;
      b.windupT = 0;
      b.comboN = 0;
      b.heavyAtk = false;
      continue;
    }
    if (b._truce && warband.duelOn) { // 单挑立誓:喽啰围观,不插手
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, false, b.group, 0.5);
      continue;
    }
    if (b.fleeT > 0) { // 溃逃:头也不回地跑,跑够了才敢回头
      b.fleeT -= dt;
      const rx = b.pos.x - player.pos.x, rz = b.pos.z - player.pos.z;
      const rd = Math.hypot(rx, rz) || 1;
      moveEntity(b, b.pos.x + (rx / rd) * 7, b.pos.z + (rz / rd) * 7, b.speed * 1.05, dt);
      b.group.position.copy(b.pos);
      b.group.rotation.y = b.yaw;
      animateLimbs(b.parts, b.walkT, true, b.group, 1.15);
      continue;
    }
    b.attackCd = Math.max(0, b.attackCd - dt);
    if (b._trampleCd > 0) b._trampleCd -= dt;
    const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    let moving = false;
    // 攻城战:玩家不在眼前时,战团匪徒先跟拦路的卫兵拼刀
    if (b.warband && warband.siege && pd > 6) {
      let gt = null, gd2 = 900;
      for (const g2 of guards) {
        if (g2.downT > 0) continue;
        const d2v = dist2(b.pos.x, b.pos.z, g2.pos.x, g2.pos.z);
        if (d2v < gd2) { gd2 = d2v; gt = g2; }
      }
      if (gt) {
        if (gd2 > 1.6 * 1.6) { moveEntity(b, gt.pos.x, gt.pos.z, b.speed, dt); moving = true; }
        else if (b.attackCd <= 0) {
          b.attackCd = 1.1;
          b.swingT = 0.35;
          gt.hp -= 1;
          sfx.clank();
          spawnDust(gt.pos.x, 1.0, gt.pos.z, 2, 0.4, 1.2);
          showDamage(gt.pos, 1);
          gt.state = 'chase';
          if (gt.hp <= 0) downGuard(gt);
        }
        b.group.position.copy(b.pos);
        b.group.rotation.y = b.yaw;
        b.parts._attackAnim = (b.swingT || 0) > 0;
        animateLimbs(b.parts, b.walkT, moving, b.group, 1.0);
        if (b.swingT > 0) { b.swingT -= dt; meleeSwing(b.parts, Math.min(1, 1 - b.swingT / 0.35)); }
        continue;
      }
    }
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
    } else if (pd < 30 * sneakFactor() && !player.dead) {
      if (b.windupT > 0) {
        b.windupT -= dt;
        if (b.windupT <= 0) {
          b.swingT = 0.3;
          const inR = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z) < (b.heavyAtk ? 2.7 : 2.3);
          if (inR) damagePlayer(b.heavyAtk ? b.dmg + 1 : b.dmg, b, b.heavyAtk);
          if (b.heavyAtk) { // 重击落地:震屏收尾,恢复期更长
            b.heavyAtk = false;
            camShake = Math.max(camShake, 0.25);
            b.attackCd = 1.7;
          } else if (b.comboN > 0) { // 二连击:紧接一记快斩
            b.comboN--;
            b.windupT = 0.28;
            telegraphFlash(b, 0.28);
            b.attackCd = 0.2;
          } else b.attackCd = 1.0;
        }
      } else if (pd > 1.6) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) {
        // 车轮战:同时出手的最多两人,其余的绕着你侧向游走等空档(骑砍围攻的呼吸感)
        const attackers = bandits.reduce((n, o) => n + ((o.windupT > 0 || o.swingT > 0) && !o.dead &&
          dist2(o.pos.x, o.pos.z, player.pos.x, player.pos.z) < 400 ? 1 : 0), 0); // 只数身边 20 米内的出手者
        if (attackers >= 2) {
          const px = player.pos.x - b.pos.x, pz = player.pos.z - b.pos.z;
          const d = Math.hypot(px, pz) || 1;
          b._orbit = b._orbit || (Math.random() < 0.5 ? 1 : -1);
          moveEntity(b, b.pos.x + (-pz / d) * b._orbit * 2, b.pos.z + (px / d) * b._orbit * 2, b.speed * 0.55, dt);
          moving = true;
        } else {
          // 出招选择:精英(头目/悬赏/决斗)会二连击和破盾重击,杂兵偶尔连击
          const elite = b.boss || b.bountyHead || b.duel;
          const r = Math.random();
          if (elite && r < 0.3) { b.heavyAtk = true; b.windupT = 0.85; telegraphFlash(b, 0.85, true); }
          else if ((elite && r < 0.65) || (!elite && r < 0.18)) { b.comboN = 1; b.windupT = 0.45; telegraphFlash(b); }
          else { b.windupT = 0.45; telegraphFlash(b); }
        }
      }
    } else {
      const a = performance.now() * 0.0003 + b.home.x;
      moveEntity(b, b.home.x + Math.cos(a) * 5, b.home.z + Math.sin(a) * 5, b.speed * 0.3, dt);
      moving = true;
    }
    // 包抄间距:同伙互相让位,别挤成一摞人肉塔
    if (pd < 40) {
      for (const o of bandits) {
        if (o === b || o.dead || o.downT > 0) continue;
        const sx = b.pos.x - o.pos.x, sz = b.pos.z - o.pos.z;
        const sd = sx * sx + sz * sz;
        if (sd < 1.32 && sd > 0.0001) {
          const d = Math.sqrt(sd);
          b.pos.x += (sx / d) * (1.15 - d) * dt * 3;
          b.pos.z += (sz / d) * (1.15 - d) * dt * 3;
        }
      }
    }
    b.group.position.copy(b.pos);
    b.group.rotation.y = b.yaw;
    b.parts._attackAnim = (b.swingT || 0) > 0 || (b.windupT || 0) > 0;
    animateLimbs(b.parts, b.walkT, moving, b.group, 1.0);
    if (b.windupT > 0) meleeSwing(b.parts, 0.32); // 蓄力:武器高举定住
    else if (b.swingT > 0) {
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
    if (v.fleeT <= 0 && entFar(v)) {
      // 远处村民不演日程,但入夜/天亮的状态切换要补上,免得远景里站着一排"雕像"
      if (phase === 'night' && !v.sleeping) {
        v.sleeping = true;
        v.group.visible = false;
        v.pos.copy(v.home);
        v.group.position.copy(v.pos);
      } else if (phase !== 'night' && v.sleeping) {
        v.sleeping = false;
        v.group.visible = true;
      }
      continue;
    }
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
    meleeSwing(player.parts, Math.min(1, t), player._stance);
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
      : (keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11) * (h.fast ? 1.2 : 1) *
        (1 + 0.02 * (skillLv('riding') - 1)); // 骑术:人马合一
    player._rideSpeed = moving ? speed : 0; // 冲量记账:马上挥刀按马速加成
    // 骑砍冲锋践踏:疾驰状态撞上敌人,连人带马把他掀翻
    if (!h.sheep && speed >= 16 && moving) {
      for (const list of [bandits, wolves]) {
        for (const e of list) {
          if (e.dead || e.downT > 0 || (e._trampleCd || 0) > 0) continue;
          if (dist2(h.pos.x, h.pos.z, e.pos.x, e.pos.z) > 3.2) continue;
          e._trampleCd = 2;
          e.hp -= 2;
          if (e.stunT !== undefined) e.stunT = Math.max(e.stunT || 0, 1.6);
          hitFX(e, 2.6);
          showDamage(e.pos, 2, true);
          sfx.hoof();
          camShake = Math.max(camShake, 0.25);
          skillXp('riding', 2);
          if (e.hp <= 0) {
            if (wolves.includes(e)) killWolf(e);
            else { e.dead = true; startFall(e); registerKill(); dropCoins(e.pos, 5); }
          }
        }
      }
    }
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
  // 疾跑吃体力:跑干了就只能小步喘(骑砍的腿)
  const canSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && player.sta > 0.5 && player.gaspT <= 0;
  const speed = (canSprint ? 8.4 : 5.0) * (player.blocking ? 0.45 : 1) *
    (player.blessT > 0 ? 1.15 : 1) * // 教堂庇佑:脚下生风
    (player.homeDay === calendar.day ? 1.08 : 1) * // 在自家床上睡过:安眠增益
    (player.sneaking ? 0.5 : 1) * // 潜行:压着步子
    (player.gaspT > 0 ? 0.75 : 1) * (player.staggerT > 0 ? 0.35 : 1); // 喘气/踉跄拖腿
  const prevYaw = player.yaw;
  if (moving) {
    player.pos.x += mv.x * speed * dt;
    player.pos.z += mv.y * speed * dt;
    if (!lockFoe) player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * 12);
    player.walkT += dt * speed * 2.2;
    if (canSprint) player.sta = Math.max(0, player.sta - 7 * dt);
  }
  // 锁定中:身体始终朝着目标,移动变成环绕侧步
  if (lockFoe) {
    player.yaw = angleLerp(player.yaw,
      Math.atan2(lockFoe.pos.x - player.pos.x, lockFoe.pos.z - player.pos.z), dt * 14);
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
    if (player.plunging) {
      // 跳劈落地:全方位冲击波
      player.plunging = false;
      const def = WEAPONS[player.weapon];
      sfx.stomp();
      camShake = Math.max(camShake, 0.4);
      hitStopT = Math.max(hitStopT, 0.05);
      spawnDust(player.pos.x, 0.1, player.pos.z, 14, 2.4, 2);
      swingTrail(3.4, Math.PI * 2);
      meleeSweep(def.dmg + (player.swordLv >= 2 ? 1 : 0) + (player.relic ? 1 : 0) + 1, 3.4, -1.01, def.knock * 1.6);
      stats.plunges = (stats.plunges || 0) + 1;
    }
    if (wasAirborne && fallSpeed < -3) checkStomp();
    if (wasAirborne && fallSpeed < -4) player.squashT = 0.16; // 落地挤压
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
      player.rollCd > 0 || player.rollT > 0 || !player.onGround || player.staggerT > 0) return;
  if (!spendSta(15)) return;
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
  // 扒窃(天际式):潜行状态从背后下手——无声取财;失手立刻炸锅
  if (player.sneaking) {
    for (const v of villagers) {
      if (v.sleeping || v.downT > 0 || (v.robbedT || 0) > 0) continue;
      if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 6.5) continue;
      const dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const behind = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / d < -0.1; // 站在其背后
      const chance = Math.min(0.92, (behind ? 0.55 : 0.25) + 0.05 * (skillLv('sneak') - 1));
      v.robbedT = 90;
      if (Math.random() < chance) {
        skillXp('sneak', 3);
        stats.pockets = (stats.pockets || 0) + 1;
        if (stats.pockets >= 5) unlockAch('cutpurse');
        if (Math.random() < 0.4) { // 摸到的不是钱,是赃物——城里没人敢收
          player.loot = (player.loot || 0) + 1;
          sfx.chest();
          const item = ['一支银簪', '一块怀表', '一只铜烛台', '一枚刻名的戒指', '半串珍珠'][Math.floor(Math.random() * 5)];
          toast(`🫲 摸到${item}(赃物 ×${player.loot})。城里没人敢收——听说沼泽那位不问来路。`, 3.5);
        } else {
          const take = 2 + Math.floor(Math.random() * 5);
          player.coins += take;
          sfx.coin();
          toast(`🤫 得手!从${v.id.name}兜里摸走 ${take} 金币。(没人看见……吧?)`, 2.5);
        }
      } else {
        v.fleeT = 6;
        showBubble(v, v.id.name, '有贼!我的钱袋!!', 3);
        crime(1, '🫲 扒窃失手,被当场抓包!');
      }
      return;
    }
    toast('附近没有下手的对象。(蹲着走过去,贴到背后)', 2);
    return;
  }
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
        stats.starTaken = true; // 力量之星只领一次,记进档
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
// 北境天空:压掉糖果蓝,换成高纬度的灰蓝与雾白(天际的天从来不艳)
const C_DAY_TOP = new THREE.Color(0x4f6e90), C_DAY_HOR = new THREE.Color(0xc4cdd0);
const C_DUSK_TOP = new THREE.Color(0x3a3550), C_DUSK_HOR = new THREE.Color(0xd2773c);
const C_NIGHT_TOP = new THREE.Color(0x040814), C_NIGHT_HOR = new THREE.Color(0x0e1830);
const C_SUN_DAY = new THREE.Color(0xf7ecd4), C_SUN_DUSK = new THREE.Color(0xe86a30);
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
  const dgnDim = inDungeon() ? 0.1 : 1; // 地窖里只有火把
  sun.intensity = 3.2 * day * rainDim * dgnDim;
  sun.color.copy(C_SUN_DUSK).lerp(C_SUN_DAY, Math.min(1, Math.max(0, elev * 2.2)));
  moon.position.set(-sx, Math.max(30, -sy), -sz);
  moon.intensity = 0.55 * night; // 月色提亮:夜里也看得清路
  hemi.intensity = (0.22 + 0.28 * day) * (1 - 0.3 * weather.rain) * dgnDim;
  envIntensity = (0.1 + 0.25 * day) * rainDim * (inDungeon() ? 0.25 : 1);
  // 随身提灯:入夜自动点起一圈暖光(地窖里已有火把,不重复)
  lantern.intensity = night * 1.2 * (inDungeon() ? 0 : 1);
  lantern.position.set(player.pos.x, 2.4, player.pos.z);

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

  // 曝光与泛光随昼夜变化
  renderer.toneMappingExposure = (0.85 + day * 0.25) * styleExp;
  bloom.strength = (0.28 + night * 0.4) * styleBloomMul;

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
let fovKick = 0; // 处决瞬间镜头急推
let slowMoT = 0; // 处决慢镜头(时停之后的余韵)
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
  // 锁定中:镜头滑到敌我连线的正后方,取景框住双方
  if (lockFoe) {
    camYaw = angleLerp(camYaw,
      Math.atan2(player.pos.x - lockFoe.pos.x, player.pos.z - lockFoe.pos.z), Math.min(1, dt * 4));
    camPitch += (0.36 - camPitch) * Math.min(1, dt * 2.5);
  }
  _camOff.set(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  ).multiplyScalar(dist);
  const target = _camTarget.set(player.pos.x, ty, player.pos.z);
  if (lockFoe) { // 视点偏向敌我中间
    target.x += (lockFoe.pos.x - player.pos.x) * 0.22;
    target.z += (lockFoe.pos.z - player.pos.z) * 0.22;
  }
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
  // 疾跑/疾驰时动态拉伸视野(速度感);处决瞬间反向急推(贴近感)
  if (fovKick > 0) fovKick -= dt;
  const fovTarget = 62 + [0, 0, 3.5, 9][moveState] - (fovKick > 0 ? 9 : 0);
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * (fovKick > 0 ? 14 : 5));
    camera.updateProjectionMatrix();
  }
}

// ================= HUD =================
let hudCache = '';
function updateHUD() {
  // 体力条每帧直刷(绕过 hudCache):打斗中它一直在动
  if (started && !player.dead) {
    staminaEl.style.display = 'block';
    staminaFillEl.style.width = `${(player.sta / player.maxSta) * 100}%`;
    staminaFillEl.className = player.gaspT > 0 ? 'gasp' : '';
  } else staminaEl.style.display = 'none';
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
  if (warband.active) { // 战况横幅:战团还剩几个,一眼可知
    const wbAlive = warband.members.filter((b) => !b.dead).length;
    missionText = `${warband.siege ? '🚨 攻城战' : '⚔️ 战团来袭'}:余 ${wbAlive}/${warband.members.length}` +
      `${warband.duelOn ? ' · 单挑中!' : ''}\n` + missionText;
  }
  missionText += `\n🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`;
  const raining = weather.state === 'rain' || weather.state === 'storm';
  const wIcon = isWinter() && raining ? '🌨️' : { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' }[weather.state];
  const phaseIcon = { dawn: '🌅', day: '🌞', dusk: '🌇', night: '🌙' }[dayPhase()];
  const sp = todaySpecial();
  const calText = `${SEASON_ICON[seasonIdx()]}${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`;
  const bossHp = questRT.boss && !questRT.boss.dead && quest.active ? questRT.boss.hp : -1;
  const key = hearts + '|' + player.coins + '|' + player.weapon + player.armor + (player.relic ? 'R' : '') + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText + '|' + wIcon + phaseIcon + calText + '|' + bossHp + '|' + Math.floor(player.mp) + player.spellIdx + player.spells.length;
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
    `${wDef.icon} ${wDef.name}${player.swordLv >= 2 ? '+1' : ''}${player.relic ? '·☀️' : ''}` +
    (player.armor ? ` · 🛡️ ${ARMORS[player.armor].name}` : '') +
    (player.weaponsOwned.length > 1 ? '(Q 切换)' : '') +
    (player.spells.length
      ? ` · ${SPELLS[player.spells[player.spellIdx]].icon}${SPELLS[player.spells[player.spellIdx]].name}(R/鼠标中键)` +
        ` ${'🔹'.repeat(Math.floor(player.mp))}${'▫'.repeat(player.maxMp - Math.floor(player.mp))}`
      : '');
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
  if (armRT.active) {
    const filled = Math.round(Math.max(0, Math.min(1, armRT.meter)) * 10);
    promptText = `💪 ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} 狂按 E!!`;
    return;
  }
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
    {
      // 与 tryInteract 对齐:有未读的故事章节时,E 打开的是故事而不是商店
      const dlg = DIALOGS[n.key];
      if (dlg) {
        const arcIdx = dlg.arcs.reduce((b2, a, i) => (quest.idx >= a.min ? i : b2), -1);
        if (arcIdx >= 0 && !(n.readArcs && n.readArcs.has(arcIdx))) {
          promptText = `按 E 听${n.def.name}说说心里话`;
          return;
        }
      }
    }
    if (n.key === 'blacksmith') { promptText = '按 E 打开铁匠铺(武器/护甲)'; return; }
    if (n.key === 'trader' && !player.royalHorse) { promptText = '按 E 找马贩瑟尔玛(皇家骏马 80 金币)'; return; }
    if (n.key === 'innkeep' && letter && !player.home) { promptText = '按 E 取信(有人写给你的)'; return; }
    if (n.key === 'innkeep' && player.venison > 0) { promptText = `按 E 卖鹿肉 ×${player.venison}(每块 5 金币)`; return; }
    if (n.key === 'innkeep' && player.hp < player.maxHp) { promptText = '按 E 住店休息,回满生命(10 金币)'; return; }
    if (n.key === 'innkeep' && dayPhase() === 'night') { promptText = '按 E 住店过夜,睡到天亮(10 金币)'; return; }
    if (n.key === 'witch' && !player.spells.includes('fire') && player.coins >= 30) { promptText = '按 E 买《火球术》卷轴(30 金币)'; return; }
    if (n.key === 'witch' && player.loot > 0) { promptText = `按 E 销赃 ×${player.loot}(每件 8 金币,不问来路)`; return; }
    if (n.key === 'witch' && player.hp < player.maxHp) { promptText = '按 E 买回魂汤(8 金币)'; return; }
    if (n.key === 'witch' && player.herbs > 0) { promptText = `按 E 卖蘑菇 ×${player.herbs}(每朵 3 金币)`; return; }
    if (n.key === 'witch' && player.coins >= 5) { promptText = '按 E 求一卦(5 金币,她真算得准)'; return; }
    if (n.key === 'innkeep' && player.drunkT <= 0) { promptText = '按 E 来一杯麦酒(2 金币)'; return; }
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
      strongman: `按 E 掰手腕(赌 15 赢 30${stats.arms ? `,战绩 ${stats.arms} 胜` : ''})`,
      merccap: `按 E 雇佣剑士(40 金币+每日 5 饷,随行 ${mercs.length}/2)`,
    }[n.key];
    return;
  }
  if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
    mark(NOTICE_POS.x, NOTICE_POS.z, 2.2);
    promptText = '按 E 看今日王国公告';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, CHORE_POS.x, CHORE_POS.z) < 6) {
    mark(CHORE_POS.x, CHORE_POS.z, 2.2);
    promptText = !sideQuest.active ? '按 E 接一桩村务(无限)'
      : choreReady() ? '按 E 交差领赏!' : `按 E 看村务进度(${sideQuest.giver})`;
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
  if (dist2(player.pos.x, player.pos.z, DGN.hatch.x, DGN.hatch.z) < 6) {
    mark(DGN.hatch.x, DGN.hatch.z, 1.2);
    promptText = '按 E 掀开暗门(被封印的地窖)';
    return;
  }
  if (inDungeon() && dist2(player.pos.x, player.pos.z, DGN.exit.x, DGN.exit.z) < 6) {
    mark(DGN.exit.x, DGN.exit.z, 1.2);
    promptText = '按 E 爬回地面';
    return;
  }
  if (inDungeon() && dist2(player.pos.x, player.pos.z, DGN.relic.x, DGN.relic.z) < 6) {
    mark(DGN.relic.x, DGN.relic.z, 1.6);
    promptText = player.relic ? '(空了的圣坛)' : '按 E 请下「先王战徽」';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, BOAT_PIER.x, BOAT_PIER.z) < 8) {
    mark(BOAT_PIER.x, BOAT_PIER.z, 1.2);
    promptText = '按 E 划船去湖心岛';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, BOAT_ISLE.x, BOAT_ISLE.z) < 6) {
    mark(BOAT_ISLE.x, BOAT_ISLE.z, 1.2);
    promptText = '按 E 划船回栈桥';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, -100, 100.5) < 5) {
    mark(-100, 100.5, 1.6);
    promptText = lakeBlessed ? '(祭坛记得你)' : '按 E 触碰月光祭坛';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, TRIAL_FLAG.x, TRIAL_FLAG.z) < 8) {
    mark(TRIAL_FLAG.x, TRIAL_FLAG.z, 3.0);
    promptText = trialRT.active ? '按 E 放弃计时赛'
      : `按 E 开始赛马计时赛${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)}s)` : ''}`;
    return;
  }
  if (!frostfang.tamed && frostfang.wary &&
      dist2(player.pos.x, player.pos.z, frostfang.wary.pos.x, frostfang.wary.pos.z) < 26) {
    mark(frostfang.wary.pos.x, frostfang.wary.pos.z, 1.3);
    promptText = player.venison > 0
      ? `按 E 喂鹿肉给白狼(驯服 ${frostfang.feed}/3)` : '🐺 白狼想要鹿肉(去猎一头鹿)';
    return;
  }
  {
    const cf = nearestSpot('campfire', 30);
    if (cf && player.venison > 0) {
      mark(cf.x, cf.z, 1.2);
      promptText = `按 E 烤鹿肉(回 ❤×1.5,剩 ×${player.venison})`;
      return;
    }
    const ch = nearestSpot('chapel', 30);
    if (ch) {
      mark(ch.x, ch.z, 2.0);
      promptText = blessDay !== calendar.day ? '按 E 在石坛前祈祷(获得庇佑)' : '(神明今日已听过你的祷告)';
      return;
    }
  }
  if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 9) {
    mark(MIRROR_POS.x, MIRROR_POS.z, 2.3);
    promptText = '按 E 凝视回响之镜';
    return;
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
  if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z) < 7) {
    mark(FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z, 1.4);
    promptText = '按 E 深水垂钓(岛边的鱼更肥)';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, 8, 46) < 8) {
    mark(8, 46, 2.4);
    promptText = bountyRT.target ? '按 E 查看悬赏令' : '按 E 揭悬赏令(赏金 30)';
    return;
  }
  if (player.home && letter && dist2(player.pos.x, player.pos.z, HOME.x + 3.4, HOME.z + 3.2) < 5) {
    mark(HOME.x + 3.4, HOME.z + 3.2, 1.8);
    promptText = '按 E 开信箱(小红旗立着——有信!)';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, DRAGON_SKULL.x, DRAGON_SKULL.z) < 9) {
    mark(DRAGON_SKULL.x, DRAGON_SKULL.z, 2.5);
    promptText = shout.learned ? '(龙颅无话可教了。去吼吧——X 键)' : '按 E 把手放上龙颅';
    return;
  }
  if (dist2(player.pos.x, player.pos.z, HOME.doorX, HOME.doorZ) < 6) {
    mark(HOME.x, HOME.z, 3.2);
    promptText = !player.home
      ? (player.coins >= HOME.price ? `按 E 买下湖畔小屋(${HOME.price} 金币)` : `(出售)湖畔小屋 ${HOME.price} 金币,还差 ${HOME.price - player.coins}`)
      : player.homeDay === calendar.day ? '(安眠中:移动 +8%。明天再睡)' : '按 E 回屋睡一觉(安眠:移动 +8%)';
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
  {
    // 与 tryInteract 一致:提示指向最近的那匹,免得警示牛头不对马嘴
    let best = null, bd = 7;
    for (const h of horses) {
      const d = dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) {
      mark(best.pos.x, best.pos.z, best.sheep ? 1.4 : 2.7);
      promptText = best.sheep ? '按 E 骑羊(为什么不呢)'
        : best.owned && !best.stolen ? '按 E 偷马 (会引来通缉!)' : '按 E 骑马';
      return;
    }
  }
  if (dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    promptText = '按 E 读一块墓志铭';
    return;
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
  // 盗贼(战团成员标红,枭首加大加边;不在图内时沿边画来袭方向箭头)
  let wbOffMap = null;
  for (const b of bandits) {
    if (b.dead) continue;
    const [mx, mz] = toMap(b.pos.x, b.pos.z);
    const onMap = mx > 2 && mx < S - 2 && mz > 2 && mz < S - 2;
    if (b.warband && !onMap) { wbOffMap = b; continue; }
    if (b.warlord) {
      mm.fillStyle = '#ff2222';
      mm.beginPath();
      mm.arc(mx, mz, 4, 0, 6.28);
      mm.fill();
      mm.strokeStyle = '#ffd83d';
      mm.lineWidth = 1.5;
      mm.stroke();
    } else {
      mm.fillStyle = b.warband ? '#e03030' : '#222';
      mm.beginPath();
      mm.arc(mx, mz, 2.5, 0, 6.28);
      mm.fill();
    }
  }
  if (wbOffMap && warband.active) { // 战团尚在图外:红箭头指向来袭方向
    const wdx = wbOffMap.pos.x - px, wdz = wbOffMap.pos.z - pz;
    const ang = Math.atan2(wdz, wdx);
    const ex = S / 2 + Math.cos(ang) * (S / 2 - 10);
    const ey = S / 2 + Math.sin(ang) * (S / 2 - 10);
    mm.save();
    mm.translate(ex, ey);
    mm.rotate(ang);
    mm.fillStyle = '#ff3b30';
    mm.beginPath();
    mm.moveTo(6, 0);
    mm.lineTo(-4, -4);
    mm.lineTo(-4, 4);
    mm.closePath();
    mm.fill();
    mm.restore();
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
    c.eventKeep = true;
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

DIRECTOR_EVENTS.push({
  key: 'wedding', w: 5,
  cond: () => dayPhase() === 'day' && quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 5) < 4900,
  start() {
    const groom = makeWanderer({ shirt: 0x3a5a8a, pants: 0x2a2a3a, hair: 0x3a2a1a }, 4, 12);
    const bride = makeWanderer({ shirt: 0xe8dce8, pants: 0xd8ccd8, hair: 0x8a5a2a }, 5.2, 12);
    toast('💒 有人在喷泉广场成亲!全城都来讨喜糖啦!', 4);
    sfx.fanfare();
    let t0 = 0, greeted = false;
    const h = {
      t: 40,
      update(dt2) {
        t0 += dt2;
        // 新人绕喷泉慢慢走一圈
        const a = t0 * 0.25;
        moveEntity(groom, Math.cos(a) * 8, 5 + Math.sin(a) * 8, 2.2, dt2);
        moveEntity(bride, Math.cos(a + 0.15) * 8, 5 + Math.sin(a + 0.15) * 8, 2.2, dt2);
        for (const n of [groom, bride]) {
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, true, n.group, 0.4);
        }
        // 沿途撒喜钱
        if (Math.random() < dt2 * 0.5) {
          addPickup('coin', groom.pos.x + (Math.random() - 0.5) * 4, groom.pos.z + (Math.random() - 0.5) * 4, 30);
        }
        // 玩家凑近道贺(一次)
        if (!greeted && dist2(player.pos.x, player.pos.z, groom.pos.x, groom.pos.z) < 9) {
          greeted = true;
          player.coins += 2;
          sfx.coin();
          showBubble(bride, '新娘', '沾沾喜气!喜糖……换成金币啦,拿好!', 4);
          remember('在喷泉广场赶上一场婚礼,讨到了喜钱');
        }
      },
      end() {
        scene.remove(groom.group);
        scene.remove(bride.group);
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'funeral', w: 4,
  cond: () => dayPhase() === 'dusk' && quest.idx >= 2,
  start() {
    // 四人抬棺,从西门缓缓走向静眠墓园
    const bearers = [];
    for (let i = 0; i < 4; i++) {
      bearers.push(makeWanderer({ shirt: 0x2e2e34, pants: 0x222228, hair: 0x3a3a3a },
        -66 + (i % 2) * 2, -6 + Math.floor(i / 2) * 2.4));
    }
    const coffin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 2.4), lambert(0x4a3a28, { roughness: 0.95 }));
    coffin.castShadow = true;
    scene.add(coffin);
    toast('🕯️ 一支送葬的队伍朝墓园去了。城里安静了一瞬。', 4);
    let paid = false;
    const h = {
      t: 70,
      update(dt2) {
        let arrived = true;
        bearers.forEach((n, i) => {
          const done = moveEntity(n, -44 + (i % 2) * 2, -114 + Math.floor(i / 2) * 2.4, 1.6, dt2);
          if (!done) arrived = false;
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, !done, n.group, 0.3);
        });
        coffin.position.set(
          (bearers[0].pos.x + bearers[3].pos.x) / 2,
          1.3,
          (bearers[0].pos.z + bearers[3].pos.z) / 2);
        coffin.rotation.y = bearers[0].yaw;
        if (!paid && dist2(player.pos.x, player.pos.z, coffin.position.x, coffin.position.z) < 36 &&
            !player.mounted && player.weapon !== 'bow') {
          paid = true;
          remember('在路边驻足,为一位陌生人送了最后一程');
          toast('(你摘下帽子,站到了路边。抬棺人朝你微微颔首。)', 3.5);
        }
        if (arrived) this.t = Math.min(this.t, 0.01);
      },
      end() {
        for (const n of bearers) scene.remove(n.group);
        scene.remove(coffin);
      },
    };
    return h;
  },
});

// ================= 黑石的报复(守城胜利的后续剧情链) =================
// 守住南门(stage 1)→ 次日收到恐吓信(stage 2)→ 出城遭独眼刻刀维克伏击(stage 3 完结)
// (vendetta 常量声明在 EVO 旁,loadGame 初始化时就要读它)
function vendettaLetter() {
  letter = {
    from: '黑石兄弟会',
    text: '南门那笔账,兄弟会记下了。城墙护得了你一时,护不了你一世——出城的路上,留神你的后颈。(信纸背面用炭画着一把断刀)',
  };
  toast(player.home ? '📮 信箱里插着一封没署名的信。小红旗立着,像面招魂幡。' : '📮 罗莎那儿有你一封信。她说送信的人蒙着脸。', 4.5);
}
function vendettaRead() { // 读到恐吓信:伏击上膛
  vendetta.stage = 2;
  workspace.mood.a = Math.min(1, workspace.mood.a + 0.3);
  remember('收到了黑石兄弟会的恐吓信,他们在城外等着', 'vendetta-letter');
  setTimeout(() => toast('(你把信折好。从今天起,出城的每一步都得带着眼睛。)', 4), 1500);
}
function updateVendetta() {
  if (vendetta.boss && vendetta.boss.dead) { vendettaSlain(); return; } // 任何击杀路径都算数
  if (vendetta.stage !== 2 || vendetta.boss || player.dead) return;
  if (dist2(player.pos.x, player.pos.z, 0, 0) < 16900) return; // 出城 130 步才动手
  const a = Math.atan2(player.pos.x, player.pos.z) + 0.6;
  const bx = player.pos.x + Math.sin(a) * 14, bz = player.pos.z + Math.cos(a) * 14;
  const boss = addBandit(bx, bz, { hp: 12, dmg: 2, speed: 7, scale: 1.15 });
  boss.eventFoe = true;
  boss.vendetta = true;
  vendetta.boss = boss;
  for (const s of [-1, 1]) {
    const t = addBandit(bx + s * 3, bz + s * 2, { hp: 3, dmg: 1 });
    t.eventFoe = true;
    t.minion = true;
  }
  sfx.wanted();
  camShake = 0.4;
  telegraphFlash(boss);
  toast('🗡️ 「南门的账,现在算。」——黑石副手·独眼刻刀维克,从道旁的阴影里走了出来!', 6);
}
function vendettaSlain() { // 在 meleeSweep/爆炸等击杀路径由 boss.vendetta 标记触发
  vendetta.stage = 3;
  vendetta.boss = null;
  player.blackstoneToken = true;
  dropCoins(player.pos, 8);
  sfx.fanfare();
  unlockAch('vendetta');
  remember('斩杀了黑石副手刻刀维克,兄弟会的报复到此为止', 'vendetta-end');
  seedLegend();
  if (player.home) refreshTrophies();
  toast('⚔️ 刻刀维克倒下了。你从他颈间摘下【黑石断刀徽记】——这笔账,两清了。(挂上了你家外墙)', 6);
  saveGame();
}

// 黑石劫掠战:骑砍式守城——战鼓一响,匪帮成波扑向南门,佣兵与你并肩守到底
DIRECTOR_EVENTS.push({
  key: 'siege', w: 4,
  cond: () => quest.idx >= 3 && dist2(player.pos.x, player.pos.z, 0, 40) < 8100,
  start() {
    const raiders = [];
    const spawnWave = (n, zBase) => {
      for (let i = 0; i < n; i++) {
        const b = addBandit(-8 + i * 4 + (Math.random() * 2 - 1), zBase + Math.random() * 4, { hp: 3, dmg: 1 });
        b.eventFoe = true;
        raiders.push(b);
      }
    };
    spawnWave(4, 74);
    sfx.wanted();
    sfx.stomp();
    camShake = 0.4;
    toast('🥁 战鼓!!黑石兄弟会大举攻打南门——守住!!', 5);
    remember('黑石兄弟会攻打南门那天,你在城墙下', 'siege-day');
    let wave2 = false;
    return {
      t: 130,
      update() {
        if (!wave2 && this.t < 95) {
          wave2 = true;
          spawnWave(3, 78);
          sfx.wanted();
          toast('🥁 第二波!他们从苇丛里又冒出来一队!', 3.5);
        }
        if (wave2 && raiders.every((b) => b.dead)) {
          player.coins += 40;
          sfx.fanfare();
          stats.sieges = (stats.sieges || 0) + 1;
          unlockAch('walldef');
          remember('打退了黑石兄弟会对南门的劫掠,全城都看见了');
          seedLegend(); // 守城之战当场进传说基因池
          if (vendetta.stage === 0) vendetta.stage = 1; // 黑石记仇了:报复的种子就此埋下
          toast('🏰 劫掠被击退!罗莎在旅店门口带头喝彩——赏金 40 枚,全城记你一功!', 6);
          this.t = 0;
        }
      },
      end() {
        for (const b of raiders) {
          if (!b.dead) { scene.remove(b.group); const i = bandits.indexOf(b); if (i >= 0) bandits.splice(i, 1); }
        }
      },
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
  armRT, armWrestle, armPress, HOME, homeInteract, refreshTrophies,
  getMail: () => ({ box: homeRT.mailbox.visible, flag: homeRT.mailFlag.visible }),
  trophyCount: () => (homeRT.trophies ? homeRT.trophies.children.length : 0),
  arrows, WEAPONS, cycleWeapon, openShop, refreshShop, tryRob, doRoll, arenaRT, arenaHost, startArenaWave,
  director, DIRECTOR_EVENTS,
  crime, weather, setWeather, talkQuestGiver, completeMission, missions, advanceDialog, tryInteract,
  getWanted: () => wanted,
  setTime: (t) => { dayTime = t; },
  calendar, seasonIdx, seasonDay, todaySpecial, applySeason, world,
  setDay: (d) => { calendar.day = Math.max(1, d); applySeason(); respawnMushrooms(); refreshProclaim(); },
  getDailyEvents: () => dailyEvents,
  wilderness: { CORE },
  deers, mushrooms, loreStones, LORE, tellStory, sleepToMorning, newDay,
  chronicle: () => chronicle, remember, archetype, mirrorTalk, MIRROR_POS,
  frostfang, wildSpots, heavyAttack, togglePhoto, queueDream, damagePlayer, nearestSpot,
  trialRT, startTrial, prayAltar, rowTo, BOAT_PIER, BOAT_ISLE,
  enterDungeon, exitDungeon, takeRelic, inDungeon, DGN, FISH_SPOT_ISLE, openJournal,
  sideQuest, choreBoard, choreProgress, CHORE_POS,
  composeLetter, witchFortune, getLetter: () => letter,
  workspace, wsReport, moodWord, consolidate, tickWorkspace: () => { workspace.t = 0; updateWorkspace(0); },
  MIND, mindReport, mindTick, habitFactor, mindSave, mindMakeWish, MIND_WISHES, mindFavorite,
  getFirefly: () => ({ owned: !!player.firefly, visible: fireflyMesh.visible }),
  EVO, seedLegend, mutateLegend, evolveLegends, legendText, evolveTactics, growCorpus,
  SPELLS, castSpell, learnSpell, cycleSpell, explodeAt, tryAttack,
  trailFX, faceNearestFoe, getSquash: () => player.squashT || 0,
  dangerFX, telegraphFlash,
  toggleLock, getLock: () => lockFoe, getLockMark: () => lockMark.visible,
  getFov: () => camera.fov,
  prologue, startPrologue, skipPrologue, spendSta,
  downGuard, getLawless: () => lawlessT, getAch: (k) => achUnlocked.includes(k),
  frightenBandits, banditSlain,
  frostPatches, frostSlow, castBigFire, getFireCharge: () => player.fireChargeT || 0,
  warband, spawnWarband, updateWarband,
  getCombatMusic: () => combatCalmT > 0, foeName, registerKill, whiteHot,
  WARLORD_TAUNTS, getBanners: () => stats.banners || 0, toastQueue, keys,
  getMoveState: () => moveState, saveNow: saveGame,
  SKILL_DEFS, skillXp, toggleSneak, sneakFactor, shout, learnShout, doShout,
  mercs, hireMerc, payMercs, DRAGON_SKULL,
  vendetta, vendettaLetter, vendettaRead, updateVendetta, getLoot: () => player.loot || 0,
  applyStyle, cycleStyle, STYLE_PRESETS, getStyle: () => styleKey,
  getGrade: () => ({ sat: gradePass.uniforms.uSat.value, vig: gradePass.uniforms.uVig.value,
    sepia: gradePass.uniforms.uSepia.value, bloom: bloom.strength, exp: renderer.toneMappingExposure }),
  testBlocked: (x, z, r = 0.45) => {
    const p = { x, z };
    resolveCollisions(p, r, colliders);
    return Math.hypot(p.x - x, p.z - z) > 0.05;
  },
  setIdle: (t) => { idleT = t; },
  getIdle: () => ({ idleT, idleCd }),
  getLoreRead: () => loreRead.length,
  getProclaim: () => proclaimText,
  refreshProclaim,
  getCrests: () => crestsFound.length,
  dialogOpen: () => dialog.open,
  getDialog: () => ({ open: dialog.open, page: dialog.pages[dialog.idx], speaker: dialog.speaker && dialog.speaker.name }),
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
  } else if (slowMoT > 0) { // 处决余韵:时停之后再来半秒慢镜,看清那一刀的分量
    slowMoT -= dt;
    dt *= 0.4;
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
  // 蓄力重击:按住 F 约 0.7 秒自动挥出(松手清零)
  if (keys['KeyF'] && !player.dead && !player.mounted && !player.carrying &&
      player.rollT <= 0 && !dialog.open) { // 弓也能蓄力:满月强弓
    player.chargeT = (player.chargeT || 0) + dt;
    if (player.chargeT >= 0.7 && player.attackT <= 0) {
      player.chargeT = 0;
      heavyAttack();
    }
  } else {
    player.chargeT = 0;
  }
  if (player.blessT > 0) player.blessT -= dt;
  // 骑行里程(村务/成就)
  if (player.mounted && !player.dead) {
    const mv = Math.hypot(player.pos.x - (player._lastRX ?? player.pos.x), player.pos.z - (player._lastRZ ?? player.pos.z));
    if (mv > 0.02 && mv < 5) {
      stats.rideDist = (stats.rideDist || 0) + mv;
      if (sideQuest.active && sideQuest.type === 'ride') {
        sideQuest.progress += mv;
        if (sideQuest.progress >= sideQuest.goal && !sideQuest._rideDone) {
          sideQuest._rideDone = true;
          toast(`📋 村务【${sideQuest.giver}】:里程够了,回村务板交差!`, 3);
        }
      }
      if (stats.rideDist >= 5000) unlockAch('rider');
    }
  }
  player._lastRX = player.pos.x;
  player._lastRZ = player.pos.z;
  // 深水规则:银月湖面不可徒步——栈桥走廊(|x+100|<2.2 且 z<92)与湖心岛(距岛心<6.8)除外。
  // 每帧检查,步幅远小于缓冲带宽,冲刺也蹚不过去;上岛只能靠小船。
  {
    const ldx = player.pos.x + 100, ldz = player.pos.z - 100;
    const lakeD = Math.hypot(ldx, ldz);
    if (lakeD < 28.5 && lakeD > 6.8 &&
        !(Math.abs(ldx) < 2.2 && player.pos.z < 92)) {
      const push = 28.5 / (lakeD || 1);
      player.pos.x = -100 + ldx * push;
      player.pos.z = 100 + ldz * push;
      if (player.mounted) { // 马也不会凫水:连人带马一起退回来
        player.mounted.pos.x = player.pos.x;
        player.mounted.pos.z = player.pos.z;
      }
      if ((loop._wadeT || 0) < now - 4000) {
        loop._wadeT = now;
        toast('湖水一下子深了,你退了回来。(想上岛?栈桥边有小船)', 3);
      }
    }
  }
  updateFrostfang(dt);
  updateSprings(dt);
  updateTrial(dt);
  {
    const dIn = inDungeon();
    if (dIn !== loop._dgnLit) {
      loop._dgnLit = dIn;
      for (const pl of world.cryptLights) pl.visible = dIn;
    }
  }
  if (world.islandAltarMat) {
    const glow = todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night' ? 2.2 : 0.5;
    if (Math.abs(world.islandAltarMat.emissiveIntensity - glow) > 0.01) {
      world.islandAltarMat.emissiveIntensity += (glow - world.islandAltarMat.emissiveIntensity) * dt;
    }
  }
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
  updateArm(dt);
  updateHome();
  updateFirefly();
  vistaFar.position.set(player.pos.x, 0, player.pos.z);  // 远山永远在地平线上
  vistaNear.position.set(player.pos.x, 0, player.pos.z);
  updateMagic(dt);
  updateFrostPatches(dt);
  updateTrails(dt);
  updateDanger(dt);
  updateLock(dt);
  updatePrologue(dt);
  updateLawless(dt);
  updateWarband(dt);
  updateCombatMusic(dt);
  if (player.squashT > 0) {   // 落地挤压回弹
    player.squashT = Math.max(0, player.squashT - dt);
    const base = player.sneaking ? 0.8 : 1;
    player.group.scale.y = base * (1 - 0.18 * (player.squashT / 0.16));
  }
  updateMercs(dt);
  updateVendetta();
  updateWeather(dt);
  // 环境氛围音:按季节 × 时辰 × 天气切换(4 秒判一次)
  ambienceT -= dt;
  if (ambienceT <= 0) {
    ambienceT = 4;
    const ph = dayPhase();
    let kind = null;
    if (weather.rain > 0.25) kind = null; // 雨雪声自己就是氛围
    else if (isWinter()) kind = 'wind';
    else if (ph === 'night' && seasonIdx() >= 1) kind = 'crickets'; // 夏秋夜
    else if ((ph === 'day' || ph === 'dawn') && seasonIdx() <= 1) kind = 'birds'; // 春夏白天
    setAmbience(started && !paused ? kind : null);
  }
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
  updateWorkspace(dt);
  updateIdle(dt);
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
  gradePass.uniforms.uTime.value = now * 0.00025; // 胶片颗粒的抖动时钟
  composer.render();
}
requestAnimationFrame(loop);
