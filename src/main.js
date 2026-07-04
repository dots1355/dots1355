// 《侠盗猎马人:中世纪王国》主逻辑
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { makeHumanoid, makeHorse, resolveCollisions, angleLerp, dist2, lambert } from './entities.js';
import { initAudio, sfx, startMusic, toggleMusic } from './audio.js';
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
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// 环境光遮蔽:让物体接触处产生柔和阴影,大幅提升体积感
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 0.85, samples: 12 });
composer.addPass(gtao);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.6, 0.85);
composer.addPass(bloom);
const smaa = new SMAAPass(window.innerWidth, window.innerHeight);
composer.addPass(smaa);
composer.addPass(new OutputPass());

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
sun.shadow.mapSize.set(4096, 4096);
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
      uniform float sunGlow, time, dayMix;
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
          float cloud = smoothstep(0.6, 0.8, cov);
          float wispy = smoothstep(0.52, 0.62, cov) * 0.22;
          float fade = smoothstep(0.04, 0.22, d.y);
          vec3 cloudBright = mix(vec3(0.045, 0.05, 0.08), vec3(1.06, 1.03, 0.99), dayMix);
          vec3 cloudDark  = mix(vec3(0.03, 0.035, 0.06), vec3(0.72, 0.74, 0.8), dayMix);
          // 朝阳一侧的云染上太阳色
          float sunTint = pow(s, 3.0) * 0.5;
          vec3 ccol = mix(cloudDark, cloudBright, smoothstep(0.5, 0.95, cov)) + sunColor * sunTint * 0.35;
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
const world = buildWorld(scene);
const { colliders } = world;

// ================= HUD 引用 =================
const $ = (id) => document.getElementById(id);
const heartsEl = $('hearts'), coinsEl = $('coins'), wantedEl = $('wanted'),
  missionEl = $('mission'), timerEl = $('timer'), promptEl = $('prompt'),
  toastEl = $('toast'), flashEl = $('flash'), titleEl = $('title'),
  gameoverEl = $('gameover'), gameoverText = $('gameover-text'),
  minimap = $('minimap'), mm = minimap.getContext('2d');

let toastTimer = 0;
function toast(msg, dur = 3) {
  toastEl.textContent = msg;
  toastEl.style.opacity = 1;
  toastTimer = dur;
}

// ================= 玩家 =================
const player = {
  ...makeHumanoid({ shirt: 0x2f8f4e, pants: 0x6b4a2f, cap: true, sword: true }),
  pos: world.playerSpawn.clone(),
  vy: 0, yaw: 0, onGround: true, jumps: 0,
  hp: 10, maxHp: 10, coins: 0,
  walkT: 0, attackT: 0, invulnT: 0, mounted: null, dead: false,
  parcel: null,
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
}
addHorse(50, 6, 0x8b5a2b, true);
addHorse(54, 5, 0x4a3a30, true);
addHorse(30, 90, 0xc4a35a, false);
addHorse(-40, 78, 0x9b7653, false);
addHorse(100, -25, 0x6e5240, false);

// ================= 卫兵 / 村民 / 盗贼 =================
const guards = [], villagers = [], bandits = [];

function addGuard(x, z, waypoints, knight = false) {
  const g = { ...makeHumanoid({ shirt: knight ? 0x5a1c1c : 0x8f2f35, pants: 0x3a3a44, helmet: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: 3, speed: knight ? 8.3 : 5.2,
    state: 'patrol', waypoints, wp: 0, attackCd: 0, stunT: 0, downT: 0, walkT: 0,
    extra: knight, home: new THREE.Vector3(x, 0, z), wantedHit: false };
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

const villagerColors = [0x7a5c8f, 0x4a7a9f, 0xa06a3a, 0x5f7a3a, 0x9f4a6a, 0x6a6a7a];
function addVillager(x, z) {
  const v = { ...makeHumanoid({ shirt: villagerColors[villagers.length % villagerColors.length], pants: 0x50412e }),
    pos: new THREE.Vector3(x, 0, z), yaw: Math.random() * 6.28, home: new THREE.Vector3(x, 0, z),
    state: 'idle', timer: Math.random() * 3, walkT: 0, fleeT: 0, downT: 0 };
  v.group.position.copy(v.pos);
  scene.add(v.group);
  villagers.push(v);
}
[[-20, 20], [22, 20], [8, 8], [-8, 0], [30, 5], [-30, 10], [15, 35], [-15, 35], [40, -20], [-35, -25], [0, 30], [48, 30]]
  .forEach(([x, z]) => addVillager(x, z));

function addBandit(x, z) {
  const b = { ...makeHumanoid({ shirt: 0x3b3b46, pants: 0x26262e, hood: true, sword: true }),
    pos: new THREE.Vector3(x, 0, z), yaw: 0, hp: 3, speed: 5.8,
    state: 'patrol', home: new THREE.Vector3(x, 0, z), attackCd: 0, stunT: 0, walkT: 0, dead: false };
  b.group.position.copy(b.pos);
  scene.add(b.group);
  bandits.push(b);
}

// ================= 任务系统 =================
const missions = [
  { title: '① 金币税', desc: '为领主收集 8 枚金币', type: 'coins', goal: 8, reward: 20 },
  { title: '② 皇家快递', desc: '60 秒内把包裹送到东边的风车磨坊(骑马更快!)', type: 'deliver', time: 60, reward: 30 },
  { title: '③ 剿灭盗贼', desc: '前往西部森林,击败盗贼营地的 3 名盗贼', type: 'bandits', goal: 3, reward: 60 },
];
const quest = { idx: 0, active: false, progress: 0, timer: 0 };

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

function addPickup(type, x, z, ttl = Infinity) {
  let mesh;
  if (type === 'coin') mesh = new THREE.Mesh(coinGeo, coinMat);
  else if (type === 'heart') mesh = new THREE.Mesh(heartG, heartMat);
  else mesh = new THREE.Mesh(starGeoBig(), new THREE.MeshStandardMaterial({
    color: 0xffd83d, emissive: 0xaa7700, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.25 }));
  mesh.position.set(x, type === 'star' ? 1.4 : 0.65, z);
  if (type === 'star') mesh.scale.setScalar(1.4);
  mesh.castShadow = true;
  scene.add(mesh);
  pickups.push({ mesh, type, x, z, ttl, t: Math.random() * 6 });
}
for (const [x, z] of world.coinSpots) addPickup('coin', x, z);

// ================= 输入 =================
const keys = {};
let camYaw = 0, camPitch = 0.35, locked = false;
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyE') tryInteract();
  if (e.code === 'KeyF') tryAttack();
  if (e.code === 'KeyM') toast(toggleMusic() ? '♪ 音乐开' : '♪ 音乐关', 1.5);
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started) return;
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
  toast('去喷泉广场找金衣老者接取委托吧!(E 互动)', 5);
});

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
        [[gate.x, gate.z]], wanted >= 3);
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
  // 委托人
  if (dist2(player.pos.x, player.pos.z, world.questGiverPos.x, world.questGiverPos.z) < 8) {
    talkQuestGiver();
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

function talkQuestGiver() {
  if (quest.idx >= missions.length) {
    toast('老者:王国感谢你,勇者!尽情享受这片土地吧。', 3.5);
    return;
  }
  const m = missions[quest.idx];
  if (!quest.active) {
    quest.active = true;
    quest.progress = 0;
    quest.timer = m.time || 0;
    sfx.accept();
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
  if (quest.idx >= missions.length) {
    addPickup('star', 0, 13);
    toast('全部委托完成!去广场领取你的 ★ 力量之星 ★', 5);
  }
}

// ================= 攻击 =================
function tryAttack() {
  if (!started || player.dead || player.attackT > 0 || player.mounted) return;
  player.attackT = 0.35;
  sfx.sword();
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
    g.hp--; sfx.hit();
    if (!g.wantedHit) { g.wantedHit = true; crime(1, '你袭击了卫兵!'); }
    if (g.hp <= 0) {
      g.downT = 14; g.group.rotation.x = -Math.PI / 2; g.wantedHit = false;
      dropCoins(g.pos, 3);
    } else g.state = 'chase';
  });
  hitOne(bandits, (b) => {
    b.hp--; sfx.hit();
    if (b.hp <= 0) {
      b.dead = true; b.group.rotation.x = -Math.PI / 2;
      dropCoins(b.pos, 5);
      addPickup('heart', b.pos.x, b.pos.z + 1, 30);
      if (quest.active && missions[quest.idx].type === 'bandits') {
        quest.progress++;
        toast(`击败盗贼 ${quest.progress}/3`, 2);
        if (quest.progress >= 3) completeMission();
      }
    }
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

function animateLimbs(p, walkT, moving) {
  const a = moving ? Math.sin(walkT) * 0.65 : 0;
  p.legL.rotation.x = a;
  p.legR.rotation.x = -a;
  if (p.armL) p.armL.rotation.x = -a * 0.8;
  if (p.armR && !p._attackAnim) p.armR.rotation.x = a * 0.8;
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
    animateLimbs(g.parts, g.walkT, moving);
  }
}

function updateBandits(dt) {
  for (const b of bandits) {
    if (b.dead) continue;
    if (b.stunT > 0) { b.stunT -= dt; continue; }
    b.attackCd = Math.max(0, b.attackCd - dt);
    const pd = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
    let moving = false;
    if (pd < 28 && !player.dead) {
      if (pd > 1.6) { moveEntity(b, player.pos.x, player.pos.z, b.speed, dt); moving = true; }
      else if (b.attackCd <= 0) { b.attackCd = 1.0; damagePlayer(2); }
    } else {
      const a = performance.now() * 0.0003 + b.home.x;
      moveEntity(b, b.home.x + Math.cos(a) * 5, b.home.z + Math.sin(a) * 5, b.speed * 0.3, dt);
      moving = true;
    }
    b.group.position.copy(b.pos);
    b.group.rotation.y = b.yaw;
    animateLimbs(b.parts, b.walkT, moving);
  }
}

function updateVillagers(dt) {
  for (const v of villagers) {
    if (v.downT > 0) {
      v.downT -= dt;
      if (v.downT <= 0) v.group.rotation.x = 0;
      continue;
    }
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
      v.timer -= dt;
      if (v.timer <= 0) {
        v.timer = 2 + Math.random() * 4;
        const a = Math.random() * 6.28;
        v.target = [v.home.x + Math.cos(a) * 7, v.home.z + Math.sin(a) * 7];
      }
      if (v.target && !moveEntity(v, v.target[0], v.target[1], 1.6, dt)) moving = true;
    }
    v.group.position.copy(v.pos);
    v.group.rotation.y = v.yaw;
    animateLimbs(v.parts, v.walkT, moving);
  }
}

function updateHorses(dt) {
  for (const h of horses) {
    if (h === player.mounted) continue;
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
function animHorseLegs(h, intensity) {
  const a = Math.sin(h.walkT) * 0.55 * intensity;
  h.parts.legs[0].rotation.x = a;
  h.parts.legs[1].rotation.x = -a;
  h.parts.legs[2].rotation.x = -a;
  h.parts.legs[3].rotation.x = a;
}

// ================= 玩家更新 =================
function updatePlayer(dt) {
  if (player.dead) return;
  player.invulnT = Math.max(0, player.invulnT - dt);

  // 攻击动画
  if (player.attackT > 0) {
    player.attackT -= dt;
    const t = 1 - player.attackT / 0.35;
    player.parts._attackAnim = true;
    player.parts.armR.rotation.x = -Math.sin(t * Math.PI) * 2.2;
    if (player.attackT <= 0) player.parts._attackAnim = false;
  }

  const f = new THREE.Vector2(-Math.sin(camYaw), -Math.cos(camYaw));
  const r = new THREE.Vector2(-f.y, f.x);
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz += 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  const mv = new THREE.Vector2(f.x * iz + r.x * ix, f.y * iz + r.y * ix);
  const moving = mv.lengthSq() > 0;
  if (moving) mv.normalize();

  if (player.mounted) {
    const h = player.mounted;
    const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 17 : 11;
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
    player.vy -= 22 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
    resolveCollisions(h.pos, 0.85, colliders);
    h.pos.y = player.pos.y;
    h.group.position.copy(h.pos);
    h.group.rotation.y = h.yaw;
    animHorseLegs(h, moving ? 1.4 : 0);
    player.pos.x = h.pos.x;
    player.pos.z = h.pos.z;
    player.yaw = h.yaw;
    player.group.position.set(h.pos.x, h.pos.y + 1.35, h.pos.z);
    player.group.rotation.y = h.yaw;
    // 骑姿
    player.parts.legL.rotation.x = -1.1;
    player.parts.legR.rotation.x = -1.1;
    return;
  }

  const speed = keys['ShiftLeft'] || keys['ShiftRight'] ? 7.6 : 4.6;
  if (moving) {
    player.pos.x += mv.x * speed * dt;
    player.pos.z += mv.y * speed * dt;
    player.yaw = angleLerp(player.yaw, Math.atan2(mv.x, mv.y), dt * 12);
    player.walkT += dt * speed * 2.2;
  }

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
    if (wasAirborne && fallSpeed < -3) checkStomp();
    player.onGround = true;
    player.jumps = 0;
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
  // 受伤闪烁
  player.group.visible = player.invulnT > 0 ? Math.floor(performance.now() / 80) % 2 === 0 : true;
  animateLimbs(player.parts, player.walkT, moving);
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
        toast(isGuard ? '踩晕了卫兵!' : '踩晕了敌人!', 1.5);
        if (isGuard) crime(1);
        return true;
      }
    }
    return false;
  };
  if (!tryStomp(guards, true)) tryStomp(bandits, false);
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
    p.mesh.position.y = (p.type === 'star' ? 1.4 : 0.65) + Math.sin(p.t * 3) * 0.12;
    if (!player.dead && dist2(player.pos.x, player.pos.z, p.x, p.z) < radius * radius &&
        player.pos.y < 1.5) {
      if (p.type === 'coin') {
        player.coins++;
        sfx.coin();
        if (quest.active && missions[quest.idx].type === 'coins') quest.progress++;
      } else if (p.type === 'heart') {
        player.hp = Math.min(player.maxHp, player.hp + 2);
        sfx.heart();
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
  exGroup.position.y = 2.1 + Math.sin(performance.now() * 0.003) * 0.15;
  exGroup.rotation.y += dt * 2;

  beacon.visible = false;
  if (!quest.active) return;
  const m = missions[quest.idx];
  if (m.type === 'deliver') {
    quest.timer -= dt;
    beacon.visible = true;
    beacon.position.x = world.windmillPos.x;
    beacon.position.z = world.windmillPos.z;
    if (dist2(player.pos.x, player.pos.z, world.windmillPos.x, world.windmillPos.z) < 49) {
      completeMission();
    } else if (quest.timer <= 0) {
      quest.active = false;
      if (player.parcel) { player.group.remove(player.parcel); player.parcel = null; }
      toast('投递超时!回去找委托人重新接取…', 3.5);
    }
  } else if (m.type === 'coins') {
    beacon.visible = quest.progress >= m.goal;
    beacon.position.x = world.questGiverPos.x;
    beacon.position.z = world.questGiverPos.z;
  } else if (m.type === 'bandits') {
    beacon.visible = quest.progress < m.goal;
    beacon.position.x = world.banditCamp.x;
    beacon.position.z = world.banditCamp.z;
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
  sun.position.set(player.pos.x + sx * 0.4, Math.max(20, sy), player.pos.z + sz * 0.4);
  sun.target.position.set(player.pos.x, 0, player.pos.z);
  sun.intensity = 3.2 * day;
  sun.color.copy(C_SUN_DUSK).lerp(C_SUN_DAY, Math.min(1, Math.max(0, elev * 2.2)));
  moon.position.set(-sx, Math.max(30, -sy), -sz);
  moon.intensity = 0.3 * night;
  hemi.intensity = 0.12 + 0.38 * day;
  envIntensity = 0.05 + 0.3 * day;

  // 天空穹顶
  const sunDirV = new THREE.Vector3(sx, sy, sz).normalize();
  skyUniforms.sunDir.value.copy(sunDirV);
  skyUniforms.sunColor.value.copy(sun.color);
  skyUniforms.sunGlow.value = 0.4 + day;
  let top, hor;
  if (elev > 0.25) { top = C_DAY_TOP; hor = C_DAY_HOR; }
  else if (elev > -0.08) {
    const t = (elev + 0.08) / 0.33;
    top = C_DUSK_TOP.clone().lerp(C_DAY_TOP, t);
    hor = C_DUSK_HOR.clone().lerp(C_DAY_HOR, t);
  } else {
    const t = Math.max(0, (elev + 0.3) / 0.22);
    top = C_NIGHT_TOP.clone().lerp(C_DUSK_TOP, t);
    hor = C_NIGHT_HOR.clone().lerp(C_DUSK_HOR, t);
  }
  skyUniforms.topColor.value.copy(top);
  skyUniforms.horizonColor.value.copy(hor);
  skyUniforms.time.value = performance.now() * 0.001;
  skyUniforms.dayMix.value = day;
  scene.fog.color.copy(hor);
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
  for (const m of envMats) m.envMapIntensity = envIntensity;
}

// ================= 相机 =================
function updateCamera(dt) {
  const dist = player.mounted ? 9 : 6.2;
  const ty = player.pos.y + (player.mounted ? 2.6 : 1.7);
  const off = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch),
    Math.sin(camPitch),
    Math.cos(camYaw) * Math.cos(camPitch),
  ).multiplyScalar(dist);
  const target = new THREE.Vector3(player.pos.x, ty, player.pos.z);
  const desired = target.clone().add(off);
  desired.y = Math.max(0.6, desired.y);
  camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
  camera.lookAt(target);
}

// ================= HUD =================
let hudCache = '';
function updateHUD() {
  const full = Math.floor(player.hp / 2);
  const half = player.hp % 2;
  const hearts = '❤️'.repeat(full) + (half ? '💔' : '') + '🖤'.repeat(5 - full - half);
  const stars = wanted > 0 ? '⭐'.repeat(wanted) + '✩'.repeat(5 - wanted) : '';
  let missionText;
  if (quest.idx >= missions.length) missionText = '🏆 自由模式 — 王国是你的了!';
  else if (!quest.active) missionText = '📜 去喷泉广场找金衣老者(按 E 交谈)';
  else {
    const m = missions[quest.idx];
    let prog = '';
    if (m.type === 'coins') prog = ` (${Math.min(quest.progress, m.goal)}/${m.goal})` + (quest.progress >= m.goal ? ' — 回去交任务!' : '');
    if (m.type === 'bandits') prog = ` (${quest.progress}/${m.goal})`;
    missionText = `📜 ${m.title}:${m.desc}${prog}`;
  }
  const timer = quest.active && missions[quest.idx].type === 'deliver' ? `⏱ ${Math.ceil(quest.timer)}s` : '';
  const key = hearts + '|' + player.coins + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText;
  if (key === hudCache) return;
  hudCache = key;
  heartsEl.textContent = hearts;
  coinsEl.textContent = `🪙 ${player.coins}`;
  wantedEl.textContent = stars;
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.textContent = missionText;
  timerEl.textContent = timer;
  timerEl.style.color = quest.timer < 12 ? '#ff5555' : '#fff';
  promptEl.textContent = promptText;
  promptEl.style.display = promptText ? 'block' : 'none';
}

function computePrompt() {
  promptText = '';
  if (!started || player.dead) return;
  if (player.mounted) { promptText = '按 E 下马'; return; }
  if (dist2(player.pos.x, player.pos.z, world.questGiverPos.x, world.questGiverPos.z) < 8) {
    promptText = '按 E 与委托人交谈'; return;
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
}

// ================= 小地图 =================
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
    const cols = {
      wall: '#9d9486', tower: '#8d8476', keep: '#7d7466', house: '#a3703f',
      tree: '#295c33', water: '#3f8fc4', field: '#9a7444', plaza: '#cdb891',
      stall: '#c05a3a', windmill: '#e8dcc0', tent: '#5d4a33',
    };
    mm.fillStyle = cols[f.type] || '#888';
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
  player, quest, horses, guards, bandits, villagers, crime,
  getWanted: () => wanted,
  setTime: (t) => { dayTime = t; },
};

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) { composer.render(); return; }

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.style.opacity = 0;
  }

  updatePlayer(dt);
  updateGuards(dt);
  updateBandits(dt);
  updateVillagers(dt);
  updateHorses(dt);
  updatePickups(dt);
  updateQuest(dt);
  updateWanted(dt);
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
  drawMinimap();
  composer.render();
}
requestAnimationFrame(loop);
