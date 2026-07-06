// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, makeHorse, makeWolf, resolveCollisions, angleLerp, dist2, lambert } from './entities.js';
import { INTRO, REGIONS, GUARD_LINES, NPCS, MISSIONS, VILLAGERS, DIALOGS, TIME_GREETINGS } from './story.js';
import { initAudio, sfx, startMusic, toggleMusic, weatherAudio } from './audio.js';
import { preloadAIAssets, generateRemoteAITextures } from './textures.js';
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
sun.shadow.mapSize.set(LOWFX ? 1024 : 4096, LOWFX ? 1024 : 4096);
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
  minimap = $('minimap'), mm = minimap.getContext('2d');

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
  walkT: 0, attackT: 0, invulnT: 0, mounted: null, dead: false,
  parcel: null, swordLv: 1, royalHorse: false,
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
    id, pos: new THREE.Vector3(id.home[0], 0, id.home[1]), yaw: Math.random() * 6.28,
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

function updateWolves(dt) {
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
    if (w.stunT > 0) { w.stunT -= dt; continue; }
    w.attackCd = Math.max(0, w.attackCd - dt);
    const pd = Math.hypot(player.pos.x - w.pos.x, player.pos.z - w.pos.z);
    let moving = false;
    if (pd < 20 && !player.dead) {
      if (pd > 1.3) { moveEntity(w, player.pos.x, player.pos.z, w.speed, dt); moving = true; }
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
  w.respawnT = 45;
  w.group.rotation.x = -Math.PI / 2;
  setTimeout(() => { if (w.dead) w.group.visible = false; }, 2500);
  dropCoins(w.pos, 2);
  wolfKills++;
  if (quest.active && missions[quest.idx].type === 'wolves') {
    quest.progress++;
    toast(`猎杀恶狼 ${quest.progress}/${missions[quest.idx].goal}`, 2);
    if (quest.progress >= missions[quest.idx].goal) completeMission();
  }
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

// ================= 具名 NPC =================
const npcStyles = {
  king: { shirt: 0x7a1f8a, pants: 0x3a2a4a, hair: 0xd8d8d8 },
  blacksmith: { shirt: 0x5a4632, pants: 0x33261a, hair: 0x2a1a10 },
  trader: { shirt: 0x2a6a5a, pants: 0x4a3a26, hair: 0x6a4a2a },
  innkeep: { shirt: 0xa04a5a, pants: 0x4a3320, hair: 0x8a3a1a },
  fisher: { shirt: 0x3a5a7a, pants: 0x33301c, hair: 0xbababa },
};
const namedNPCs = [];
for (const [key, [nx, nz, nyaw]] of Object.entries(world.npcSpots)) {
  const n = { ...makeHumanoid(npcStyles[key]), key, def: NPCS[key],
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

// 具名 NPC 的一天:白天守铺 → 黄昏去旅店 → 夜里回家
const NPC_SCHEDULE = {
  steward:    { dawn: [4, 10], day: [4, 10], dusk: [4, 10], night: [0, -29.5] },
  blacksmith: { dawn: [24.8, -8], day: [24.8, -8], dusk: [10, 73.5], night: [27, -9] },
  trader:     { dawn: [48, 10], day: [48, 10], dusk: [11.5, 73.5], night: [43, 20] },
  fisher:     { dawn: [-100, 72], day: [-100, 72], dusk: [-100, 58], night: [-108, 60] },
};

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
    openDialog([d.small[n.lineIdx++ % d.small.length]], onDone);
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
    showBubble(v, v.id.name, v.id.lines[v.lineIdx++ % v.id.lines.length]);
    return;
  }
  for (const g of guards) {
    if (g.downT > 0 || wanted > 0) continue;
    if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) > 8) continue;
    const last = bubble.cooldowns.get(g) || 0;
    if (now - last < 30000) continue;
    bubble.cooldowns.set(g, now);
    showBubble(g, null, GUARD_LINES[Math.floor(Math.random() * GUARD_LINES.length)]);
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
  if (name !== curRegion) {
    curRegion = name;
    regionEl.textContent = name;
    regionEl.classList.remove('show');
    void regionEl.offsetWidth; // 重启 CSS 动画
    regionEl.classList.add('show');
  }
}

// ================= 存档 =================
const SAVE_KEY = 'gth-save-v1';
let crestsFound = [];
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      coins: player.coins, questIdx: quest.idx, crests: crestsFound,
      swordLv: player.swordLv, royalHorse: player.royalHorse,
      kingRewarded: namedNPCs.find((n) => n.key === 'king')?.rewarded || false,
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

function addPickup(type, x, z, ttl = Infinity, id = -1) {
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
  pickups.push({ mesh, type, x, z, ttl, id, t: Math.random() * 6 });
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
if (player.swordLv >= 2) {
  const blade = player.parts.sword?.children[0];
  if (blade) blade.material = lambert(0xe8c34a, { metalness: 0.9, roughness: 0.2 });
}
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
  keys[e.code] = true;
  if (e.code === 'KeyE') {
    if (dialog.open) advanceDialog();
    else tryInteract();
  }
  if (e.code === 'KeyF' && !dialog.open) tryAttack();
  if (e.code === 'KeyM') toast(toggleMusic() ? '♪ 音乐开' : '♪ 音乐关', 1.5);
  if (e.code === 'KeyH') toggleHint();
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
  if (started && (s === 'rain' || s === 'storm')) toast(s === 'storm' ? '⛈️ 雷暴来袭!' : '🌧️ 下雨了…', 2.5);
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
  weatherAudio.setRain(started ? weather.rain : 0);
  if (weather.state === 'storm' && weather.rain > 0.7) {
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
  rainMat.opacity = weather.rain * 0.38;
  rainLines.visible = weather.rain > 0.03;
  if (!rainLines.visible) return;
  const cx = player.pos.x, cz = player.pos.z;
  const wind = 4.5;
  for (let i = 0; i < RAIN_N; i++) {
    let x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2];
    y -= 30 * dt;
    x += wind * dt;
    if (y < 0) {
      y = 20 + Math.random() * 6;
      x = cx + (Math.random() - 0.5) * 56;
      z = cz + (Math.random() - 0.5) * 56;
    }
    if (x < cx - 28) x += 56; else if (x > cx + 28) x -= 56;
    if (z < cz - 28) z += 56; else if (z > cz + 28) z -= 56;
    drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x + 0.08; rainPos[i * 6 + 4] = y + 0.55; rainPos[i * 6 + 5] = z;
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
    if (n.key === 'blacksmith' && player.swordLv === 1) {
      if (player.coins >= 50) {
        player.coins -= 50;
        player.swordLv = 2;
        sfx.chest();
        const blade = player.parts.sword?.children[0];
        if (blade) blade.material = lambert(0xe8c34a, { metalness: 0.9, roughness: 0.2 });
        openDialog(['格罗姆:(火星四溅)……成了。摸摸这剑刃,陨铁的凉,能吃进骨头里。去吧,别让它闲着。']);
        saveGame();
      } else {
        openDialog(['格罗姆:淬陨铁要 50 金币。铁不等人,钱也一样。']);
      }
      return;
    }
    if (n.key === 'trader' && !player.royalHorse) {
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
    if (n.key === 'innkeep' && player.hp < player.maxHp) {
      if (player.coins >= 10) {
        player.coins -= 10;
        player.hp = player.maxHp;
        dayTime = 0.28;
        sfx.heart();
        openDialog(['罗莎:(掀开门帘)天亮了,汤在灶上。伤都歇利索了吧?路上小心。']);
      } else {
        openDialog(['罗莎:住店 10 金币……先坐着喝口水吧,看你风尘仆仆的。']);
      }
      return;
    }
    // 闲聊
    npcTalk(n);
    return;
  }
  // 村民对话
  for (const v of villagers) {
    if (v.downT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 5.5) continue;
    const l1 = v.id.lines[v.lineIdx++ % v.id.lines.length];
    const l2 = v.id.lines[v.lineIdx++ % v.id.lines.length];
    openDialog([`${v.id.name}:${l1}`, `${v.id.name}:${l2}`]);
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
  if (best) {
    player.mounted = best;
    player.jumps = 0;
    sfx.mount();
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

function failMission(msg) {
  quest.active = false;
  if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
  clearRaceRings();
  if (questRT.merchant) { scene.remove(questRT.merchant.group); questRT.merchant = null; }
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
  saveGame();
  if (quest.idx >= missions.length) {
    addPickup('star', 0, 13);
    toast('全部委托完成!去广场领取 ★ 力量之星 ★,再去见领主领赏!', 6);
  }
}

// ================= 攻击 =================
function tryAttack() {
  if (!started || player.dead || player.attackT > 0 || player.mounted) return;
  player.attackT = 0.35;
  sfx.sword();
  const dmg = player.swordLv; // 陨铁剑升级后伤害 2
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  const hitOne = (list, onHit) => {
    for (const e of list) {
      if (e.downT > 0 || e.dead) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.35) onHit(e);
    }
  };
  hitOne(guards, (g) => {
    g.hp -= dmg; sfx.hit();
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你袭击了卫兵!'); }
    if (g.hp <= 0) {
      g.downT = 14; g.stunT = 0; g.group.rotation.x = -Math.PI / 2; g.group.rotation.z = 0;
      g.wantedHit = false;
      dropCoins(g.pos, 3);
    } else g.state = 'chase';
  });
  hitOne(bandits, (b) => {
    b.hp -= dmg; sfx.hit();
    if (b.hp <= 0) {
      b.dead = true; b.group.rotation.x = -Math.PI / 2;
      dropCoins(b.pos, b.boss ? 20 : 5);
      addPickup('heart', b.pos.x, b.pos.z + 1, 30);
      if (b.boss) toast('⚔️ 血斧巴罗克倒下了!黑石兄弟会土崩瓦解!', 5);
      if (quest.active && missions[quest.idx].type === 'bandits' && !b.boss && !b.escort) {
        quest.progress++;
        toast(`击败盗贼 ${quest.progress}/3`, 2);
        if (quest.progress >= 3) completeMission();
      }
    }
  });
  hitOne(wolves, (w) => {
    w.hp -= dmg; sfx.hit();
    if (w.hp <= 0) killWolf(w);
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
  player.hp -= n;
  player.invulnT = 0.7;
  camShake = 0.45;
  sfx.hurt();
  flashEl.style.opacity = 0.45;
  setTimeout(() => (flashEl.style.opacity = 0), 120);
  if (player.hp <= 0) gameOver();
}

function gameOver() {
  player.dead = true;
  player.hp = 0;
  sfx.gameover();
  gameoverText.textContent = wanted > 0 ? '你被王国卫兵抓住了!' : '你倒下了……';
  if (titleArtURL) {
    gameoverEl.style.backgroundImage =
      `linear-gradient(rgba(70,0,0,0.72), rgba(30,0,0,0.85)), url(${titleArtURL})`;
    gameoverEl.style.backgroundSize = 'cover';
    gameoverEl.style.backgroundPosition = 'center';
  }
  gameoverEl.style.display = 'flex';
  setTimeout(() => {
    player.pos.copy(world.playerSpawn);
    player.hp = player.maxHp;
    player.coins = Math.floor(player.coins / 2);
    player.mounted = null;
    player.vy = 0;
    clearWanted();
    player.dead = false;
    gameoverEl.style.display = 'none';
    toast('你在喷泉旁醒来,一半金币被没收充公…', 4);
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
function animateLimbs(p, walkT, moving, group = null, speedNorm = 0.6) {
  const now = performance.now();
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
    g.attackCd = Math.max(0, g.attackCd - dt);
    const pd = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
    const sight = 22 + wanted * 8;
    let moving = false;
    if (wanted > 0 && pd < sight && !player.dead) {
      g.state = 'chase';
      if (pd < 25) evadeT = 0;
      if (pd > 1.6) {
        moveEntity(g, player.pos.x, player.pos.z, g.speed, dt);
        moving = true;
      } else if (g.attackCd <= 0) {
        g.attackCd = 0.9;
        g.swingT = 0.35;
        damagePlayer(1);
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

function updateBandits(dt) {
  for (const b of bandits) {
    if (b.dead) continue;
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
      if (pd > 1.6) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) { b.attackCd = 1.0; b.swingT = 0.35; damagePlayer(b.dmg); }
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
    if (v.downT > 0) {
      v.downT -= dt;
      if (v.downT <= 0) v.group.rotation.x = 0;
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
    // 空中下马后自然回落地面
    if (h.pos.y > 0) h.pos.y = Math.max(0, h.pos.y - 22 * dt);
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

  // 攻击动画(三段式:蓄力→劈砍→收势)
  if (player.attackT > 0) {
    player.attackT -= dt;
    const t = 1 - player.attackT / 0.35;
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

  if (player.mounted) {
    const h = player.mounted;
    const speed = (keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11) * (h.fast ? 1.2 : 1);
    if (moving) {
      h.pos.x += mv.x * speed * dt;
      h.pos.z += mv.y * speed * dt;
      h.yaw = angleLerp(h.yaw, Math.atan2(mv.x, mv.y), dt * 6);
      h.walkT += dt * speed * 1.6;
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
        sfx.hoof();
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
    // 骑手随马起伏,疾驰时前倾
    player.group.position.set(h.pos.x, h.pos.y + 1.35 + (h.visBob || 0), h.pos.z);
    player.group.rotation.y = h.yaw;
    player.parts.legL.rotation.x = -1.1;
    player.parts.legR.rotation.x = -1.1;
    player.parts.body.rotation.x = galloping ? 0.3 : 0.1;
    player.parts.armL.rotation.x = -0.55;
    if (!player.parts._attackAnim) player.parts.armR.rotation.x = -0.55;
    return;
  }

  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 7.6 : 4.6;
  const prevYaw = player.yaw;
  if (moving) {
    player.pos.x += mv.x * speed * dt;
    player.pos.z += mv.y * speed * dt;
    player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * 12);
    player.walkT += dt * speed * 2.2;
  }
  moveState = moving ? (speed > 5 ? 2 : 1) : 0;
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
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.yaw;
  player.group.rotation.z = player.lean || 0;
  // 受伤闪烁
  player.group.visible = player.invulnT > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true;
  animateLimbs(player.parts, player.walkT, moving, player.group, speed / 7.6);
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
        spawnDust(e.pos.x, 0.3, e.pos.z, 6, 0.8, 1.6);
        toast(isGuard ? '踩晕了卫兵!' : '踩晕了敌人!', 1.5);
        if (isGuard) crime(1);
        return true;
      }
    }
    return false;
  };
  return tryStomp(guards, true) || tryStomp(bandits, false) || tryStomp(wolves, false);
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
function updateCamera(dt) {
  const dist = player.mounted ? 9 : 6.2;
  const ty = player.pos.y + (player.mounted ? 2.6 : 1.7);
  _camOff.set(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  ).multiplyScalar(dist);
  const target = _camTarget.set(player.pos.x, ty, player.pos.z);
  const desired = _camDesired.copy(target).add(_camOff);
  desired.y = Math.max(0.6, desired.y);
  camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
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
  const hearts = '❤️'.repeat(full) + (half ? '💔' : '') + '🖤'.repeat(5 - full - half);
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
  const timerType = quest.active && (missions[quest.idx].type === 'deliver' || missions[quest.idx].type === 'race');
  const timer = timerType ? `⏱ ${Math.ceil(quest.timer)} 秒` : '';
  if (timer) missionText = `${timer}${quest.timer < 12 ? ' ⚠️' : ''}\n${missionText}`;
  missionText += `\n🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`;
  const wIcon = { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' }[weather.state];
  const phaseIcon = { dawn: '🌅', day: '🌞', dusk: '🌇', night: '🌙' }[dayPhase()];
  const key = hearts + '|' + player.coins + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText + '|' + wIcon + phaseIcon;
  if (key === hudCache) return;
  hudCache = key;
  document.getElementById('weather').textContent = `${phaseIcon} ${wIcon}`;
  heartsEl.textContent = hearts;
  coinsEl.textContent = `🪙 ${player.coins}`;
  wantedEl.textContent = stars;
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.textContent = missionText;
  promptEl.textContent = promptText;
  promptEl.style.display = promptText ? 'block' : 'none';
}

function computePrompt() {
  promptText = '';
  if (!started || player.dead) return;
  if (player.mounted) { promptText = '按 E 下马'; return; }
  if (dialog.open) { promptText = ''; return; }
  for (const n of namedNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
    if (n.key === 'steward' && quest.idx < missions.length) { promptText = '按 E 与管家埃隆交谈(委托)'; return; }
    if (n.key === 'blacksmith' && player.swordLv === 1) { promptText = '按 E 找铁匠格罗姆(升级佩剑 50 金币)'; return; }
    if (n.key === 'trader' && !player.royalHorse) { promptText = '按 E 找马贩瑟尔玛(皇家骏马 80 金币)'; return; }
    if (n.key === 'innkeep' && player.hp < player.maxHp) { promptText = '按 E 住店休息,回满生命(10 金币)'; return; }
    if (n.key === 'king') {
      promptText = quest.idx >= missions.length && !n.rewarded ? '按 E 领取领主的重赏' : '按 E 谒见领主';
      return;
    }
    promptText = `按 E 与${n.def.name}交谈`;
    return;
  }
  for (const v of villagers) {
    if (v.downT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) <= 5.5) {
      promptText = `按 E 与${v.id.name}交谈`;
      return;
    }
  }
  for (const c of world.chests) {
    if (!c.opened && dist2(player.pos.x, player.pos.z, c.x, c.z) < 5) { promptText = '按 E 打开宝箱'; return; }
  }
  for (const h of horses) {
    if (dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z) < 7) {
      promptText = h.owned && !h.stolen ? '按 E 偷马 (会引来通缉!)' : '按 E 骑马';
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
  if (beacon.visible && Math.floor(performance.now() / 400) % 2 === 0) {
    const [mx, mz] = toMap(beacon.position.x, beacon.position.z);
    mm.fillStyle = '#ffd83d';
    mm.beginPath();
    mm.arc(Math.max(6, Math.min(S - 6, mx)), Math.max(6, Math.min(S - 6, mz)), 5, 0, 6.28);
    mm.fill();
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
}

// ================= 主循环 =================
// 调试/自动化测试句柄
window.__gtm = {
  player, quest, questRT, horses, guards, bandits, villagers, wolves, namedNPCs, steward,
  crime, weather, setWeather, talkQuestGiver, completeMission, missions, advanceDialog,
  getWanted: () => wanted,
  setTime: (t) => { dayTime = t; },
  getCrests: () => crestsFound.length,
  dialogOpen: () => dialog.open,
};

let last = performance.now();
let frameNo = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) { composer.render(); return; }

  updateToast(dt);
  updateHintFade(dt);

  updatePlayer(dt);
  updateGuards(dt);
  updateBandits(dt);
  updateWolves(dt);
  updateVillagers(dt);
  updateHorses(dt);
  updatePickups(dt);
  updateQuest(dt);
  updateWanted(dt);
  updateWeather(dt);
  updateRegion(dt);
  updateBubble(dt);
  villagerChatter();
  // 具名 NPC:按日程走位;到位后待机呼吸,玩家靠近时转身面对
  {
    const phase = dayPhase();
    for (const n of namedNPCs) {
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
  }
  updateRain(dt);
  updateDust(dt);
  updateDayNight(dt);
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
  computePrompt();
  updateHUD();
  if (frameNo++ % 2 === 0) drawMinimap(); // 小地图 30Hz 足够
  composer.render();
}
requestAnimationFrame(loop);
