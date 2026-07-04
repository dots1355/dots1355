/* =========================================================================
   ASHVALE — A Medieval Tale of Crime & Sorcery
   Open-world third-person action game (GTA-style controls) set in a
   medieval walled city. Pure Three.js, no build step: open index.html.
   ========================================================================= */
'use strict';

// ------------------------------------------------------------------ helpers
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d >  Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ------------------------------------------------------------------ renderer
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x87b5e0, 90, 520);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x50663a, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffeec8, 1.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 500;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// ------------------------------------------------------------------ canvas textures
function makeCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const grassTex = makeCanvas(256, (g, s) => {
  g.fillStyle = '#5a7a3a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${randi(60, 100)},${randi(105, 140)},${randi(40, 62)},.5)`;
    g.fillRect(rand(0, s), rand(0, s), rand(1, 3), rand(1, 3));
  }
});
grassTex.repeat.set(90, 90);

const cobbleTex = makeCanvas(256, (g, s) => {
  g.fillStyle = '#6f6a62'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const px = x * 32 + (y % 2) * 16, py = y * 32;
    const v = randi(98, 126);
    g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    g.beginPath();
    g.ellipse((px + 16) % s, py + 16, 14, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
});

function wallTexture(base, timber) {
  return makeCanvas(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(0,0,0,.045)';
      g.fillRect(rand(0, s), rand(0, s), rand(2, 8), rand(2, 8));
    }
    g.strokeStyle = timber; g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath();
    g.moveTo(s / 2, 5); g.lineTo(s / 2, s - 5);
    g.moveTo(5, s * 0.55); g.lineTo(s - 5, s * 0.55);
    g.moveTo(5, s * 0.55); g.lineTo(s / 2, 5);
    g.moveTo(s - 5, s * 0.55); g.lineTo(s / 2, 5);
    g.stroke();
    // windows
    g.fillStyle = '#2b2318';
    g.fillRect(s * 0.17, s * 0.2, 34, 42);
    g.fillRect(s * 0.68, s * 0.2, 34, 42);
    g.fillStyle = 'rgba(255,214,120,.75)';
    g.fillRect(s * 0.17 + 4, s * 0.2 + 4, 11, 15); g.fillRect(s * 0.17 + 19, s * 0.2 + 4, 11, 15);
    g.fillRect(s * 0.68 + 4, s * 0.2 + 4, 11, 15); g.fillRect(s * 0.68 + 19, s * 0.2 + 4, 11, 15);
    // door
    g.fillStyle = '#4a3319';
    g.fillRect(s * 0.42, s * 0.62, 42, s * 0.36);
  });
}

const roofTex = makeCanvas(128, (g, s) => {
  g.fillStyle = '#7d3b28'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 12) {
    g.fillStyle = `rgba(0,0,0,${rand(.12, .28)})`;
    g.fillRect(0, y, s, 4);
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = 'rgba(0,0,0,.08)';
    g.fillRect(rand(0, s), rand(0, s), rand(2, 6), 2);
  }
});
roofTex.repeat.set(2, 2);

const stoneTex = makeCanvas(256, (g, s) => {
  g.fillStyle = '#8c8579'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const v = randi(118, 150);
    g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
    g.fillRect(x * 64 + (y % 2) * 32 - 16, y * 32, 60, 28);
  }
});
stoneTex.repeat.set(3, 2);

// ------------------------------------------------------------------ materials
const MAT = {
  plasterA: new THREE.MeshLambertMaterial({ map: wallTexture('#d8cbae', '#5a4326') }),
  plasterB: new THREE.MeshLambertMaterial({ map: wallTexture('#cdb694', '#4a3722') }),
  plasterC: new THREE.MeshLambertMaterial({ map: wallTexture('#ded8c4', '#63513a') }),
  roofA:    new THREE.MeshLambertMaterial({ map: roofTex }),
  roofB:    new THREE.MeshLambertMaterial({ color: 0x5f4632 }),
  stone:    new THREE.MeshLambertMaterial({ map: stoneTex }),
  stoneDark:new THREE.MeshLambertMaterial({ color: 0x6f695e }),
  wood:     new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
  woodDark: new THREE.MeshLambertMaterial({ color: 0x4a3018 }),
  leaf:     new THREE.MeshLambertMaterial({ color: 0x4a7233 }),
  leafDark: new THREE.MeshLambertMaterial({ color: 0x3d6129 }),
  banner:   new THREE.MeshLambertMaterial({ color: 0x8c1f1f, side: THREE.DoubleSide }),
  gold:     new THREE.MeshLambertMaterial({ color: 0xffcf4a, emissive: 0x664d00 }),
  water:    new THREE.MeshLambertMaterial({ color: 0x3f6f9e }),
  awningR:  new THREE.MeshLambertMaterial({ color: 0xa03636 }),
  awningB:  new THREE.MeshLambertMaterial({ color: 0x365f9e }),
  awningG:  new THREE.MeshLambertMaterial({ color: 0x3f7a3a }),
  hay:      new THREE.MeshLambertMaterial({ color: 0xc9a94f }),
};

// ------------------------------------------------------------------ collision world
// axis-aligned boxes: {x, z, hw, hd, kind}
const colliders = [];
const roadRects = [];   // for minimap: {x, z, hw, hd}
function addCollider(x, z, hw, hd, kind) {
  colliders.push({ x, z, hw, hd, kind: kind || 'building' });
}
function collide(pos, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const px = c.hw + r - Math.abs(dx), pz = c.hd + r - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) pos.x += (dx > 0 ? px : -px);
      else         pos.z += (dz > 0 ? pz : -pz);
    }
  }
  pos.x = clamp(pos.x, -470, 470);
  pos.z = clamp(pos.z, -470, 470);
}
function insideAnyBuilding(x, z, pad) {
  pad = pad || 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (Math.abs(x - c.x) < c.hw + pad && Math.abs(z - c.z) < c.hd + pad) return true;
  }
  return false;
}

// ------------------------------------------------------------------ static geometry batching
const batches = {};  // matKey -> geometry list
function pushGeo(matKey, geo, x, y, z, ry) {
  const m = new THREE.Matrix4();
  if (ry) {
    m.makeRotationY(ry);
    m.setPosition(x, y, z);
  } else {
    m.makeTranslation(x, y, z);
  }
  geo.applyMatrix4(m);
  (batches[matKey] = batches[matKey] || []).push(geo);
}
function pushBox(matKey, w, h, d, x, y, z, ry) {
  pushGeo(matKey, new THREE.BoxGeometry(w, h, d), x, y, z, ry);
}
function flushBatches() {
  for (const key in batches) {
    const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(batches[key]);
    const mesh = new THREE.Mesh(merged, MAT[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// ------------------------------------------------------------------ ground & roads
{
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshLambertMaterial({ map: grassTex })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function cobbleMat(rx, ry) {
  const tex = cobbleTex.clone();
  tex.needsUpdate = true;
  tex.repeat.set(rx, ry);
  return new THREE.MeshLambertMaterial({ map: tex });
}
function addRoad(x, z, w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), cobbleMat(w / 7, d / 7));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  m.receiveShadow = true;
  scene.add(m);
  roadRects.push({ x, z, hw: w / 2, hd: d / 2 });
}

// city extents: walls at ±150; main roads through gates run to map edge
addRoad(0, 0, 12, 300);          // main N-S
addRoad(0, 0, 300, 12);          // main E-W
addRoad(-75, 0, 8, 300); addRoad(75, 0, 8, 300);   // secondary N-S
addRoad(0, -75, 300, 8); addRoad(0, 75, 300, 8);   // secondary E-W
addRoad(0, 320, 10, 340);        // south gate road out
addRoad(0, -320, 10, 340);       // north road out
addRoad(320, 0, 340, 10);        // east road out
addRoad(-320, 0, 340, 10);       // west road out

// market plaza
{
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(26, 36), cobbleMat(7, 7));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.03;
  plaza.receiveShadow = true;
  scene.add(plaza);
  roadRects.push({ x: 0, z: 0, hw: 26, hd: 26 });
}

// ------------------------------------------------------------------ houses
function addHouse(x, z, w, d, ry) {
  const h = rand(4.5, 7);
  const matKey = pick(['plasterA', 'plasterB', 'plasterC']);
  pushBox(matKey, w, h, d, x, h / 2, z, ry);
  // hip roof: 4-sided cone scaled to footprint
  const roofH = rand(2.2, 3.4);
  const roof = new THREE.ConeGeometry(0.72, 1, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(w + 1.2, roofH, d + 1.2);
  pushGeo(pick(['roofA', 'roofA', 'roofB']), roof, x, h + roofH / 2 - 0.2, z, ry);
  // chimney sometimes
  if (Math.random() < 0.4) {
    pushBox('stoneDark', 0.9, h * 0.5 + 3, 0.9, x + w * 0.28, h * 0.75 + 1.5, z + d * 0.2, ry);
  }
  // collision (ry is 0 or Math.PI/2)
  const rot = Math.abs(Math.sin(ry || 0)) > 0.5;
  addCollider(x, z, (rot ? d : w) / 2 + 0.3, (rot ? w : d) / 2 + 0.3);
}

// fill city blocks between roads (skip plaza & castle grounds)
{
  const blockCenters = [];
  const lanes = [-112, -38, 38, 112];
  for (const bx of lanes) for (const bz of lanes) blockCenters.push([bx, bz]);
  for (const [bx, bz] of blockCenters) {
    if (bz === -112 && Math.abs(bx) <= 38) continue;       // castle grounds (north center)
    // 2x2 sub-lots per block
    for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2) {
      if (Math.random() < 0.16) continue;                  // leave some yards
      const hx = bx + ix * rand(11, 15);
      const hz = bz + iz * rand(11, 15);
      if (Math.hypot(hx, hz) < 34) continue;               // keep plaza clear
      addHouse(hx, hz, rand(8, 13), rand(7, 11), Math.random() < 0.5 ? 0 : Math.PI / 2);
    }
  }
}

// ------------------------------------------------------------------ city walls & gates
{
  const W = 150, T = 3, H = 9;
  // wall segments with 14-wide gate gaps at each side's middle
  const segs = [];
  for (const side of ['N', 'S', 'E', 'W']) {
    // two segments per side: from corner to gate edge
    const a = -W, b = -7, c = 7, d = W;
    if (side === 'N' || side === 'S') {
      const z = side === 'N' ? -W : W;
      segs.push({ x: (a + b) / 2, z, hw: (b - a) / 2, hd: T });
      segs.push({ x: (c + d) / 2, z, hw: (d - c) / 2, hd: T });
    } else {
      const x = side === 'W' ? -W : W;
      segs.push({ x, z: (a + b) / 2, hw: T, hd: (b - a) / 2 });
      segs.push({ x, z: (c + d) / 2, hw: T, hd: (d - c) / 2 });
    }
  }
  for (const s of segs) {
    pushBox('stone', s.hw * 2, H, s.hd * 2, s.x, H / 2, s.z);
    addCollider(s.x, s.z, s.hw, s.hd, 'wall');
    // crenellations
    const len = Math.max(s.hw, s.hd) * 2, horiz = s.hw > s.hd;
    for (let off = -len / 2 + 1.5; off < len / 2; off += 4) {
      pushBox('stone', horiz ? 1.6 : T * 2 + 0.4, 1.2, horiz ? T * 2 + 0.4 : 1.6,
        s.x + (horiz ? off : 0), H + 0.6, s.z + (horiz ? 0 : off));
    }
  }
  // corner + gate towers
  const towers = [
    [-W, -W], [W, -W], [-W, W], [W, W],
    [-11, -W], [11, -W], [-11, W], [11, W],
    [-W, -11], [-W, 11], [W, -11], [W, 11],
  ];
  for (const [tx, tz] of towers) {
    const th = 13;
    pushGeo('stone', new THREE.CylinderGeometry(4, 4.6, th, 8), tx, th / 2, tz);
    pushGeo('roofA', new THREE.ConeGeometry(5, 5, 8), tx, th + 2.5, tz);
    addCollider(tx, tz, 4.2, 4.2, 'wall');
  }
}

// ------------------------------------------------------------------ castle
{
  const cx = 0, cz = -112;
  // keep
  pushBox('stone', 26, 22, 22, cx, 11, cz);
  addCollider(cx, cz, 13.4, 11.4, 'wall');
  pushBox('stone', 28, 2, 24, cx, 22.6, cz);
  for (let off = -13; off <= 13; off += 3.2) {
    pushBox('stone', 1.4, 1.6, 1.4, cx + off, 24.2, cz - 11.5);
    pushBox('stone', 1.4, 1.6, 1.4, cx + off, 24.2, cz + 11.5);
  }
  // corner towers
  for (const [ix, iz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = cx + ix * 15, tz = cz + iz * 13, th = 30;
    pushGeo('stone', new THREE.CylinderGeometry(4.4, 5, th, 10), tx, th / 2, tz);
    pushGeo('roofA', new THREE.ConeGeometry(5.4, 7, 10), tx, th + 3.5, tz);
    addCollider(tx, tz, 4.6, 4.6, 'wall');
    // banner
    const bn = new THREE.PlaneGeometry(2.2, 4);
    pushGeo('banner', bn, tx, th - 3, tz + (iz > 0 ? 5.5 : -5.5));
  }
  // gatehouse arch (two pillars so you can walk in)
  pushBox('stone', 4, 12, 4, cx - 6, 6, cz + 15);
  pushBox('stone', 4, 12, 4, cx + 6, 6, cz + 15);
  pushBox('stone', 16, 3, 4, cx, 13.5, cz + 15);
  addCollider(cx - 6, cz + 15, 2.2, 2.2, 'wall');
  addCollider(cx + 6, cz + 15, 2.2, 2.2, 'wall');
}

// ------------------------------------------------------------------ market square props
{
  // fountain
  pushGeo('stone', new THREE.CylinderGeometry(4.4, 4.8, 1.2, 14), 0, 0.6, 0);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.3, 14), MAT.water);
  water.position.set(0, 1.15, 0);
  scene.add(water);
  pushGeo('stone', new THREE.CylinderGeometry(0.7, 0.9, 3.4, 8), 0, 2.2, 0);
  addCollider(0, 0, 4.9, 4.9, 'wall');

  // stalls in a ring
  const awn = ['awningR', 'awningB', 'awningG'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const sx = Math.cos(a) * 17, sz = Math.sin(a) * 17, ry = -a + Math.PI / 2;
    pushBox('wood', 3.6, 1.1, 1.8, sx, 0.55, sz, ry);
    pushBox('woodDark', 0.25, 3, 0.25, sx - 1.5 * Math.sin(ry + Math.PI / 2), 1.5, sz - 1.5 * Math.cos(ry + Math.PI / 2), ry);
    pushBox('woodDark', 0.25, 3, 0.25, sx + 1.5 * Math.sin(ry + Math.PI / 2), 1.5, sz + 1.5 * Math.cos(ry + Math.PI / 2), ry);
    const roof = new THREE.BoxGeometry(4.4, 0.18, 2.8);
    roof.rotateZ(0.16);
    pushGeo(awn[i % 3], roof, sx, 3.1, sz, ry);
    addCollider(sx, sz, 2, 1.2);
  }

  // hay carts near gates
  for (const [hx, hz] of [[14, 132], [-18, 128], [126, 8], [-130, -12]]) {
    pushBox('wood', 3.4, 1, 2, hx, 0.9, hz);
    pushGeo('hay', new THREE.SphereGeometry(1.25, 8, 6), hx, 2, hz);
    addCollider(hx, hz, 1.9, 1.3);
  }
}

// ------------------------------------------------------------------ trees & hamlet outside walls
{
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 3.4, 6);
  const leafGeo = new THREE.ConeGeometry(2.6, 5.5, 7);
  for (let i = 0; i < 130; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(175, 460);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;    // keep roads clear
    const s = rand(0.8, 1.7);
    const t = trunkGeo.clone(); t.scale(s, s, s);
    pushGeo('wood', t, x, 1.7 * s, z);
    const l = leafGeo.clone(); l.scale(s, s, s);
    pushGeo(Math.random() < 0.5 ? 'leaf' : 'leafDark', l, x, (3.2 + 2.4) * s * 0.9, z);
    addCollider(x, z, 0.6 * s, 0.6 * s, 'tree');
  }
  // small farm hamlet south-east
  for (const [hx, hz, w, d] of [[60, 250, 9, 8], [80, 262, 8, 7], [52, 272, 10, 8]]) {
    addHouse(hx, hz, w, d, Math.random() < 0.5 ? 0 : Math.PI / 2);
  }
  // wheat field
  const wheat = new THREE.Mesh(new THREE.PlaneGeometry(46, 30), new THREE.MeshLambertMaterial({ color: 0xc9b04f }));
  wheat.rotation.x = -Math.PI / 2;
  wheat.position.set(96, 0.04, 258);
  scene.add(wheat);
}

// ------------------------------------------------------------------ torches (night lighting)
const torches = [];
{
  const spots = [
    [8, 8], [-8, -8], [8, -8], [-8, 8],
    [10, 146], [-10, 146], [10, -146], [-10, -146],
    [146, 10], [146, -10], [-146, 10], [-146, -10],
    [0, -95],
  ];
  for (const [tx, tz] of spots) {
    pushBox('woodDark', 0.3, 3.4, 0.3, tx, 1.7, tz);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa030 })
    );
    flame.position.set(tx, 3.7, tz);
    scene.add(flame);
    const light = new THREE.PointLight(0xff9540, 0, 22);
    light.position.set(tx, 3.9, tz);
    scene.add(light);
    torches.push({ flame, light, seed: rand(0, 9) });
  }
}

flushBatches();

// ------------------------------------------------------------------ characters
const SKIN = [0xd9a877, 0xc98f62, 0xb07a50, 0xe8c095];

function limb(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

// A humanoid ~1.8 units tall. Facing +Z when rotation.y = 0.
function makeHumanoid(opt) {
  const g = new THREE.Group();
  const skin = opt.skin || pick(SKIN);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34),
    new THREE.MeshLambertMaterial({ color: opt.shirt }));
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32),
    new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.64;
  head.castShadow = true;
  g.add(head);

  if (opt.helmet) {
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.24, 8),
      new THREE.MeshLambertMaterial({ color: 0x9aa2ad }));
    helm.position.y = 1.86;
    g.add(helm);
    const plume = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.3),
      new THREE.MeshLambertMaterial({ color: 0xb02020 }));
    plume.position.y = 2.02;
    g.add(plume);
  } else if (opt.hood) {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 6),
      new THREE.MeshLambertMaterial({ color: opt.hood }));
    hood.position.y = 1.9;
    g.add(hood);
  } else {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.34),
      new THREE.MeshLambertMaterial({ color: pick([0x33261a, 0x554433, 0x1e1a14, 0x777060]) }));
    hair.position.y = 1.86;
    g.add(hair);
  }

  const armL = limb(0.18, 0.66, 0.18, opt.sleeves || opt.shirt);
  armL.position.set(-0.42, 1.38, 0);
  const armR = limb(0.18, 0.66, 0.18, opt.sleeves || opt.shirt);
  armR.position.set(0.42, 1.38, 0);
  const legL = limb(0.2, 0.7, 0.2, opt.pants);
  legL.position.set(-0.16, 0.7, 0);
  const legR = limb(0.2, 0.7, 0.2, opt.pants);
  legR.position.set(0.16, 0.7, 0);
  g.add(armL, armR, legL, legR);

  if (opt.cape) {
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95),
      new THREE.MeshLambertMaterial({ color: opt.cape, side: THREE.DoubleSide }));
    cape.position.set(0, 1.0, -0.21);
    g.add(cape);
  }

  let weapon = null;
  if (opt.sword) {
    weapon = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.16),
      new THREE.MeshLambertMaterial({ color: 0xcfd6dd, emissive: 0x222831 }));
    blade.position.y = -0.75;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), MAT.gold);
    guard.position.y = -0.28;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), MAT.woodDark);
    grip.position.y = -0.16;
    weapon.add(blade, guard, grip);
    weapon.position.set(0, -0.62, 0);
    armR.add(weapon);
  } else if (opt.spear) {
    weapon = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3, 6), MAT.wood);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 6),
      new THREE.MeshLambertMaterial({ color: 0xcfd6dd }));
    tip.position.y = 1.3;
    weapon.add(shaft, tip);
    weapon.position.set(0, -0.55, 0.1);
    armR.add(weapon);
  }

  return { group: g, torso, head, armL, armR, legL, legR, weapon, phase: rand(0, 6) };
}

function animateWalk(ch, speed, dt) {
  if (speed > 0.2) {
    ch.phase += dt * speed * 2.4;
    const s = Math.sin(ch.phase), amp = Math.min(0.65, speed * 0.09 + 0.25);
    ch.legL.rotation.x = s * amp;
    ch.legR.rotation.x = -s * amp;
    ch.armL.rotation.x = -s * amp * 0.8;
    if (!ch.attacking) ch.armR.rotation.x = s * amp * 0.8;
    ch.group.position.y = Math.abs(Math.cos(ch.phase)) * 0.05;
  } else {
    ch.legL.rotation.x *= 0.8;
    ch.legR.rotation.x *= 0.8;
    ch.armL.rotation.x *= 0.8;
    if (!ch.attacking) ch.armR.rotation.x *= 0.8;
    ch.group.position.y *= 0.8;
  }
}

// ------------------------------------------------------------------ horses
function makeHorse() {
  const g = new THREE.Group();
  const color = pick([0x6b4a2f, 0x3d2c1c, 0x8a6a48, 0x555049, 0xd8cfc2]);
  const mat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2018 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.85, 2.1), mat);
  body.position.y = 1.25;
  body.castShadow = true;
  g.add(body);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.9, 0.45), mat);
  neck.position.set(0, 1.85, 0.95);
  neck.rotation.x = -0.5;
  neck.castShadow = true;
  g.add(neck);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.75), mat);
  head.position.set(0, 2.25, 1.35);
  head.castShadow = true;
  g.add(head);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.3), dark);
  mane.position.set(0, 2.05, 0.8);
  mane.rotation.x = -0.5;
  g.add(mane);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.16), dark);
  tail.position.set(0, 1.3, -1.1);
  tail.rotation.x = 0.5;
  g.add(tail);

  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x7a2e1d }));
  saddle.position.set(0, 1.74, -0.1);
  g.add(saddle);

  const legs = [];
  for (const [lx, lz] of [[-0.28, 0.75], [0.28, 0.75], [-0.28, -0.75], [0.28, -0.75]]) {
    const leg = limb(0.17, 0.95, 0.17, color);
    leg.position.set(lx, 0.92, lz);
    g.add(leg);
    legs.push(leg);
  }
  return { group: g, legs, phase: rand(0, 6) };
}

// ------------------------------------------------------------------ populate world
const npcs = [];      // peasants
const guards = [];
const horses = [];
const coins = [];
const projectiles = [];
const effects = [];
const dmgNums = [];

function randomCityPos() {
  for (let t = 0; t < 40; t++) {
    const x = rand(-140, 140), z = rand(-140, 140);
    if (!insideAnyBuilding(x, z, 1)) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 30);
}

const PEASANT_SHIRTS = [0x8a7a5c, 0x6d7f8a, 0x7d5f4a, 0x5d7a5a, 0x93685f, 0x777d55, 0x8f8570];
const PEASANT_PANTS = [0x4a4238, 0x3d3a30, 0x54483a, 0x3a4038];

function spawnNPC() {
  const ch = makeHumanoid({
    shirt: pick(PEASANT_SHIRTS),
    pants: pick(PEASANT_PANTS),
    hood: Math.random() < 0.25 ? pick(PEASANT_SHIRTS) : null,
  });
  const p = randomCityPos();
  ch.group.position.copy(p);
  ch.group.rotation.y = rand(0, Math.PI * 2);
  scene.add(ch.group);
  npcs.push({
    ch, pos: p, hp: 40, state: 'idle', timer: rand(1, 4),
    target: null, speed: 0, dead: false, deadTimer: 0,
  });
}

const GUARD_ROUTES = [
  [[0, 140], [0, 40], [40, 0], [140, 0]],
  [[0, -40], [0, -95], [-30, -95], [-30, -140]],
  [[-140, 0], [-75, 0], [-75, 75], [0, 75]],
  [[140, 0], [75, 0], [75, -75], [0, -75]],
  [[0, 140], [-40, 75], [-140, 0]],
  [[30, -95], [0, -95], [0, -140]],
  [[75, 75], [0, 75], [-75, 75]],
  [[-75, -75], [0, -75], [75, -75]],
];

function spawnGuard(nearPlayer) {
  const ch = makeHumanoid({
    shirt: 0x8e99a8, sleeves: 0x707a88, pants: 0x4c525c,
    helmet: true, spear: true, skin: pick(SKIN),
  });
  const route = pick(GUARD_ROUTES).map(([x, z]) => new THREE.Vector3(x, 0, z));
  let p;
  if (nearPlayer) {
    const a = rand(0, Math.PI * 2);
    p = player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 55, 0, Math.sin(a) * 55));
    p.x = clamp(p.x, -145, 145); p.z = clamp(p.z, -145, 145);
  } else {
    p = route[0].clone().add(new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4)));
  }
  ch.group.position.copy(p);
  scene.add(ch.group);
  guards.push({
    ch, pos: p, hp: 70, route, wp: randi(0, route.length - 1),
    state: 'patrol', atkTimer: 0, dead: false, deadTimer: 0, speed: 0,
  });
}

function spawnHorse(x, z) {
  const h = makeHorse();
  h.group.position.set(x, 0, z);
  h.group.rotation.y = rand(0, Math.PI * 2);
  scene.add(h.group);
  horses.push({ h, pos: h.group.position, timer: rand(2, 6), heading: rand(0, Math.PI * 2), speed: 0, ridden: false });
}

for (let i = 0; i < 34; i++) spawnNPC();
for (let i = 0; i < 12; i++) spawnGuard(false);
for (const [hx, hz] of [[20, 108], [24, 114], [-30, 40], [40, -40], [-108, 20], [12, 250], [-16, 220], [230, 6], [-240, -8], [90, 240]]) {
  spawnHorse(hx, hz);
}

function spawnCoin(pos, value) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10), MAT.gold);
  m.position.set(pos.x, 0.5, pos.z);
  m.rotation.x = Math.PI / 2;
  scene.add(m);
  coins.push({ mesh: m, value, t: rand(0, 6) });
}

// ------------------------------------------------------------------ player
const player = {
  ch: makeHumanoid({ shirt: 0x2f4f8a, sleeves: 0x263f6e, pants: 0x3a332a, cape: 0x7a1f1f, sword: true, skin: 0xd9a877 }),
  pos: new THREE.Vector3(6, 0, 40),
  vel: new THREE.Vector3(),
  vy: 0, grounded: true, heading: 0,
  hp: 100, maxHp: 100, mana: 100, maxMana: 100, stamina: 100, gold: 0,
  attackTimer: 0, attackCd: 0, dead: false,
  mount: null,
};
player.ch.group.position.copy(player.pos);
scene.add(player.ch.group);

// ------------------------------------------------------------------ input
const keys = {};
let camYaw = 0.5, camPitch = 0.32;
let pointerLocked = false;
let started = false;

const menuEl = document.getElementById('menu');

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (started && pointerLocked) {
    if (e.code === 'Digit1') castSkill(0);
    if (e.code === 'Digit2') castSkill(1);
    if (e.code === 'Digit3') castSkill(2);
    if (e.code === 'Digit4') castSkill(3);
    if (e.code === 'KeyE') tryMount();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

menuEl.addEventListener('click', () => {
  initAudio();
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (pointerLocked) {
    started = true;
    menuEl.style.display = 'none';
  } else {
    menuEl.style.display = 'flex';
    document.getElementById('clicktext').textContent = 'CLICK TO RESUME';
  }
});
document.addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  camYaw   -= e.movementX * 0.0026;
  camPitch += e.movementY * 0.0022;
  camPitch = clamp(camPitch, -0.5, 1.15);
});
document.addEventListener('mousedown', e => {
  if (pointerLocked && e.button === 0) tryAttack();
});

// ------------------------------------------------------------------ audio (tiny synth sfx)
let AC = null, noiseBuf = null;
function initAudio() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { /* no audio */ }
}
function sfxNoise(dur, freq, vol, slide) {
  if (!AC) return;
  const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), AC.currentTime + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  src.connect(f).connect(g).connect(AC.destination);
  src.start(); src.stop(AC.currentTime + dur);
}
function sfxTone(dur, f0, f1, vol, type) {
  if (!AC) return;
  const o = AC.createOscillator(); o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), AC.currentTime + dur);
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
  o.connect(g).connect(AC.destination);
  o.start(); o.stop(AC.currentTime + dur);
}
const sfx = {
  swing:   () => sfxNoise(0.18, 1800, 0.25, 0.3),
  hit:     () => { sfxNoise(0.12, 500, 0.4, 0.5); sfxTone(0.1, 160, 70, 0.3, 'square'); },
  hurt:    () => sfxTone(0.25, 220, 90, 0.35, 'sawtooth'),
  fire:    () => sfxNoise(0.5, 900, 0.35, 0.25),
  boom:    () => { sfxNoise(0.7, 300, 0.6, 0.15); sfxTone(0.5, 90, 35, 0.5, 'sine'); },
  heal:    () => { sfxTone(0.4, 420, 840, 0.25, 'sine'); sfxTone(0.5, 520, 1040, 0.18, 'sine'); },
  blink:   () => sfxTone(0.3, 900, 200, 0.3, 'triangle'),
  thunder: () => { sfxNoise(1.1, 180, 0.7, 0.1); sfxTone(0.2, 1400, 100, 0.3, 'sawtooth'); },
  coin:    () => { sfxTone(0.09, 1100, 1100, 0.25, 'square'); setTimeout(() => sfxTone(0.18, 1500, 1500, 0.22, 'square'), 70); },
  mount:   () => sfxTone(0.2, 300, 500, 0.2, 'triangle'),
  slain:   () => sfxTone(1.2, 200, 45, 0.5, 'sawtooth'),
};

// ------------------------------------------------------------------ skills
const SKILLS = [
  { name: 'FIREBALL', icon: '🔥', mana: 25, cd: 3.0, t: 0 },
  { name: 'HEAL',     icon: '💚', mana: 30, cd: 9.0, t: 0 },
  { name: 'SHADOW',   icon: '💨', mana: 20, cd: 5.0, t: 0 },
  { name: 'THUNDER',  icon: '⚡', mana: 50, cd: 14 , t: 0 },
];

const skillsEl = document.getElementById('skills');
const skillDivs = SKILLS.map((s, i) => {
  const d = document.createElement('div');
  d.className = 'skill';
  d.innerHTML = `<div class="key">${i + 1}</div><div class="ico">${s.icon}</div><div class="nm">${s.name}</div><div class="cd"></div>`;
  skillsEl.appendChild(d);
  return d;
});

function castSkill(i) {
  const s = SKILLS[i];
  if (player.dead || s.t > 0 || player.mana < s.mana) return;
  s.t = s.cd;
  player.mana -= s.mana;
  const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));

  if (i === 0) { // fireball
    const orig = player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)).add(fwd.clone().multiplyScalar(0.9));
    // aim with camera direction
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = clamp(dir.y, -0.25, 0.35);
    dir.normalize();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7722 }));
    const light = new THREE.PointLight(0xff8830, 1.6, 14);
    ball.add(light);
    ball.position.copy(orig);
    scene.add(ball);
    projectiles.push({ mesh: ball, vel: dir.multiplyScalar(34), life: 2.4 });
    swingArm();
    sfx.fire();
  }
  if (i === 1) { // heal
    player.hp = Math.min(player.maxHp, player.hp + 45);
    burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x55ff77, 18, 4, 0.9);
    sfx.heal();
  }
  if (i === 2) { // shadow step
    burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x333355, 14, 3, 0.5);
    const dir = new THREE.Vector3(Math.sin(camYaw + Math.PI), 0, Math.cos(camYaw + Math.PI));
    const dest = player.pos.clone().add(dir.multiplyScalar(15));
    collide(dest, 0.6);
    player.pos.x = dest.x; player.pos.z = dest.z;
    if (player.mount) { player.mount.pos.x = dest.x; player.mount.pos.z = dest.z; }
    burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x8888ff, 14, 3, 0.5);
    sfx.blink();
  }
  if (i === 3) { // thunder
    let hits = 0;
    const all = [...npcs, ...guards];
    for (const e of all) {
      if (e.dead) continue;
      const d = e.ch.group.position.distanceTo(player.pos);
      if (d < 20) {
        boltAt(e.ch.group.position.clone());
        damageEnemy(e, 85, guards.includes(e));
        hits++;
      }
    }
    if (!hits) boltAt(player.pos.clone().add(fwd.multiplyScalar(8)));
    flash(0xcfe0ff, 0.35);
    sfx.thunder();
  }
  updateHUD();
}

function boltAt(p) {
  const g = new THREE.Group();
  let y = 42, x = p.x, z = p.z;
  while (y > 0) {
    const seg = rand(4, 9);
    const nx = x + rand(-1.4, 1.4), nz = z + rand(-1.4, 1.4);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, seg, 4),
      new THREE.MeshBasicMaterial({ color: 0xd8e8ff }));
    m.position.set((x + nx) / 2, y - seg / 2, (z + nz) / 2);
    m.lookAt(nx, y - seg, nz);
    m.rotateX(Math.PI / 2);
    g.add(m);
    x = nx; z = nz; y -= seg;
  }
  scene.add(g);
  effects.push({ obj: g, life: 0.22, fade: false });
  burst(p.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xaaccff, 16, 6, 0.5);
}

// screen flash
const dmgEl = document.getElementById('dmg');
let flashTimer = 0;
function flash(color, dur) {
  // simple white flash by boosting exposure briefly
  flashTimer = dur;
}

// ------------------------------------------------------------------ particles
const sphereGeo = new THREE.SphereGeometry(0.14, 6, 5);
function burst(pos, color, n, speed, life) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    const a = rand(0, Math.PI * 2), b = rand(-1, 1);
    effects.push({
      obj: m, life: rand(life * 0.5, life),
      vel: new THREE.Vector3(Math.cos(a) * rand(1, speed), rand(0.5, speed), Math.sin(a) * rand(1, speed)),
      grav: true, fade: true,
    });
  }
}

// ------------------------------------------------------------------ damage numbers
function showDamage(worldPos, text, color) {
  const v = worldPos.clone().add(new THREE.Vector3(0, 2, 0)).project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div');
  el.className = 'dmgnum';
  el.textContent = text;
  el.style.color = color || '#fff';
  el.style.left = ((v.x * 0.5 + 0.5) * 100) + '%';
  el.style.top = ((-v.y * 0.5 + 0.5) * 100) + '%';
  document.getElementById('hud').appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translateY(${rand(-70, -45)}px) translateX(${rand(-25, 25)}px)`;
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 850);
}

// ------------------------------------------------------------------ combat
function swingArm() {
  player.ch.attacking = true;
  player.attackTimer = 0.32;
}

function tryAttack() {
  if (player.dead || player.attackCd > 0) return;
  player.attackCd = 0.48;
  swingArm();
  sfx.swing();
  // resolve hit slightly after swing starts
  setTimeout(() => {
    if (player.dead) return;
    const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
    const reach = player.mount ? 3.2 : 2.6;
    const all = [...npcs.map(n => ({ e: n, guard: false })), ...guards.map(g => ({ e: g, guard: true }))];
    let hitSomething = false;
    for (const { e, guard } of all) {
      if (e.dead) continue;
      const to = e.ch.group.position.clone().sub(player.pos); to.y = 0;
      const d = to.length();
      if (d < reach && to.normalize().dot(fwd) > 0.45) {
        damageEnemy(e, randi(28, 40), guard);
        // knockback
        e.ch.group.position.add(to.multiplyScalar(0.7));
        hitSomething = true;
      }
    }
    if (hitSomething) sfx.hit();
  }, 130);
}

function damageEnemy(e, dmg, isGuard) {
  if (e.dead) return;
  e.hp -= dmg;
  showDamage(e.ch.group.position, String(dmg), isGuard ? '#ffb060' : '#ffffff');
  burst(e.ch.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 0xcc3333, 6, 2.5, 0.4);
  if (isGuard) {
    e.state = 'chase';
    raiseWanted(1);
  } else {
    e.state = 'flee';
    e.timer = rand(4, 7);
    raiseWanted(0.5);
  }
  if (e.hp <= 0) {
    e.dead = true;
    e.deadTimer = 5;
    spawnCoin(e.ch.group.position, isGuard ? 25 : randi(4, 14));
    raiseWanted(isGuard ? 1.5 : 1);
    kills++;
  }
}

// ------------------------------------------------------------------ wanted system
let wanted = 0;        // 0..5 float, stars = ceil
let heatTimer = 0;     // time since last guard contact
let kills = 0;
const starsEl = document.getElementById('stars');
starsEl.innerHTML = '★★★★★'.split('').map(s => `<span>${s}</span>`).join('');

function raiseWanted(amt) {
  wanted = clamp(wanted + amt, 0, 5);
  heatTimer = 0;
  if (wanted >= 1 && guards.filter(g => !g.dead).length < 4 + wanted * 2) {
    spawnGuard(true);
  }
}

// ------------------------------------------------------------------ mount / horse
const promptEl = document.getElementById('prompt');
function nearestHorse() {
  let best = null, bd = 3.4;
  for (const h of horses) {
    if (h.ridden) continue;
    const d = h.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function tryMount() {
  if (player.dead) return;
  if (player.mount) {
    // dismount
    player.mount.ridden = false;
    const side = new THREE.Vector3(Math.cos(player.heading), 0, -Math.sin(player.heading));
    player.pos.copy(player.mount.pos).add(side.multiplyScalar(1.4));
    collide(player.pos, 0.6);
    player.mount = null;
    sfx.mount();
    return;
  }
  const h = nearestHorse();
  if (h) {
    player.mount = h;
    h.ridden = true;
    sfx.mount();
  }
}

// ------------------------------------------------------------------ messages
const msgEl = document.getElementById('msg');
let msgTimer = 0;
function showMsg(t, dur) {
  msgEl.textContent = t;
  msgEl.style.opacity = 1;
  msgTimer = dur || 3;
}

// ------------------------------------------------------------------ minimap
const MAP_W = 512;         // world half-extent covered by the static map image
const mapImg = document.createElement('canvas');
mapImg.width = mapImg.height = 1024;
{
  const g = mapImg.getContext('2d');
  const w2i = v => (v + MAP_W) / (2 * MAP_W) * 1024;
  const s2i = v => v / (2 * MAP_W) * 1024;
  g.fillStyle = '#2c4423'; g.fillRect(0, 0, 1024, 1024);
  // roads
  g.fillStyle = '#8d867a';
  for (const r of roadRects) {
    g.fillRect(w2i(r.x - r.hw), w2i(r.z - r.hd), s2i(r.hw * 4), s2i(r.hd * 4));
  }
  // buildings / walls / trees
  for (const c of colliders) {
    g.fillStyle = c.kind === 'wall' ? '#5d5951' : c.kind === 'tree' ? '#1f3318' : '#4a423a';
    g.fillRect(w2i(c.x - c.hw), w2i(c.z - c.hd), Math.max(2, s2i(c.hw * 4)), Math.max(2, s2i(c.hd * 4)));
  }
}
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');

function drawMinimap() {
  const W = mmCanvas.width, H = mmCanvas.height;
  const scale = 1.35;   // px per world unit
  mmCtx.save();
  mmCtx.beginPath(); mmCtx.rect(0, 0, W, H); mmCtx.clip();
  mmCtx.fillStyle = '#22331b'; mmCtx.fillRect(0, 0, W, H);
  mmCtx.translate(W / 2, H / 2 + 18);
  mmCtx.rotate(camYaw);
  mmCtx.drawImage(mapImg,
    -(player.pos.x + MAP_W) * scale,
    -(player.pos.z + MAP_W) * scale,
    2 * MAP_W * scale, 2 * MAP_W * scale);

  // blips (world-aligned coords inside rotated ctx)
  const blip = (wx, wz, color, r) => {
    const dx = (wx - player.pos.x) * scale, dz = (wz - player.pos.z) * scale;
    if (dx * dx + dz * dz > 130 * 130) return;
    mmCtx.fillStyle = color;
    mmCtx.beginPath();
    mmCtx.arc(dx, dz, r, 0, Math.PI * 2);
    mmCtx.fill();
  };
  for (const n of npcs) if (!n.dead) blip(n.ch.group.position.x, n.ch.group.position.z, 'rgba(240,240,240,.8)', 2);
  for (const h of horses) if (!h.ridden) blip(h.pos.x, h.pos.z, '#c8893a', 2.5);
  for (const g of guards) if (!g.dead) blip(g.ch.group.position.x, g.ch.group.position.z, wanted >= 1 ? '#ff4444' : '#6fa8ff', 3);
  for (const c of coins) blip(c.mesh.position.x, c.mesh.position.z, '#ffd54a', 2);
  // castle marker
  blip(0, -112, '#e8d9a0', 4);

  // north indicator
  mmCtx.save();
  mmCtx.translate(0, -58);
  mmCtx.rotate(-camYaw);
  mmCtx.fillStyle = '#fff';
  mmCtx.font = 'bold 12px Verdana';
  mmCtx.textAlign = 'center';
  mmCtx.fillText('N', 0, 4);
  mmCtx.restore();

  // player arrow
  mmCtx.rotate(Math.PI - player.heading);
  mmCtx.fillStyle = '#fff';
  mmCtx.strokeStyle = '#000';
  mmCtx.lineWidth = 1.5;
  mmCtx.beginPath();
  mmCtx.moveTo(0, -7); mmCtx.lineTo(5, 6); mmCtx.lineTo(0, 3); mmCtx.lineTo(-5, 6);
  mmCtx.closePath();
  mmCtx.fill(); mmCtx.stroke();
  mmCtx.restore();
}

// ------------------------------------------------------------------ HUD
const hpEl = document.getElementById('hpfill');
const mpEl = document.getElementById('mpfill');
const stEl = document.getElementById('stfill');
const goldEl = document.getElementById('gold');
const zoneEl = document.getElementById('zone');
let lastZone = '';
let zoneTimer = 0;

function updateHUD() {
  hpEl.style.width = (player.hp / player.maxHp * 100) + '%';
  mpEl.style.width = (player.mana / player.maxMana * 100) + '%';
  stEl.style.width = player.stamina + '%';
  goldEl.innerHTML = '<span>$</span> ' + player.gold;
  const stars = Math.ceil(wanted - 0.01);
  const spans = starsEl.children;
  for (let i = 0; i < 5; i++) spans[i].className = i < stars ? 'on' : '';
  starsEl.classList.toggle('flash', stars > 0 && heatTimer < 1);
  for (let i = 0; i < 4; i++) {
    const s = SKILLS[i];
    skillDivs[i].querySelector('.cd').style.height = (s.t / s.cd * 100) + '%';
    skillDivs[i].classList.toggle('nomana', player.mana < s.mana);
  }
}

function currentZone() {
  const p = player.pos;
  if (Math.abs(p.x) < 30 && Math.abs(p.z + 112) < 32) return 'CASTLE ASHVALE';
  if (Math.hypot(p.x, p.z) < 30) return 'MARKET SQUARE';
  if (Math.abs(p.x) < 150 && Math.abs(p.z) < 150) return 'CITY OF ASHVALE';
  if (p.z > 200 && p.x > 30 && p.x < 130) return 'MILLBROOK FARM';
  return 'ASHVALE COUNTRYSIDE';
}

// ------------------------------------------------------------------ death
const deadEl = document.getElementById('dead');
function killPlayer() {
  if (player.dead) return;
  player.dead = true;
  sfx.slain();
  deadEl.style.display = 'flex';
  if (player.mount) { player.mount.ridden = false; player.mount = null; }
  setTimeout(() => {
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    player.stamina = 100;
    player.gold = Math.floor(player.gold / 2);
    wanted = 0;
    player.pos.set(6, 0, 40);
    player.vy = 0;
    for (const g of guards) if (g.state !== 'patrol') g.state = 'patrol';
    player.dead = false;
    deadEl.style.display = 'none';
    showMsg('You wake up by the fountain, pockets lighter...', 4);
  }, 3200);
}

// ------------------------------------------------------------------ day / night
let dayTime = 0.32;            // 0..1, 0.25 = noon-ish
const DAY_LENGTH = 300;        // seconds per full cycle
const skyDay = new THREE.Color(0x87b5e0);
const skyDusk = new THREE.Color(0xd88a4a);
const skyNight = new THREE.Color(0x0d1526);
const tmpColor = new THREE.Color();

function updateDayNight(dt) {
  dayTime = (dayTime + dt / DAY_LENGTH) % 1;
  const ang = dayTime * Math.PI * 2;         // 0 = sunrise
  const elev = Math.sin(ang);                 // >0 day
  const sunDir = new THREE.Vector3(Math.cos(ang) * 0.6, elev, 0.35).normalize();
  sun.position.copy(player.pos).add(sunDir.clone().multiplyScalar(180));
  sun.target.position.copy(player.pos);

  const dayAmt = clamp(elev * 3, 0, 1);
  const duskAmt = clamp(1 - Math.abs(elev) * 4, 0, 1);
  tmpColor.copy(skyNight).lerp(skyDay, dayAmt);
  tmpColor.lerp(skyDusk, duskAmt * 0.7);
  scene.background = tmpColor;
  scene.fog.color.copy(tmpColor);

  sun.intensity = elev > 0 ? lerp(0.25, 1.35, dayAmt) : 0.12;
  sun.color.setHSL(0.1, 0.5, elev > 0 ? lerp(0.6, 0.92, dayAmt) : 0.7);
  hemi.intensity = lerp(0.18, 0.85, dayAmt);

  const night = 1 - dayAmt;
  for (const t of torches) {
    const on = night > 0.5;
    t.light.intensity = on ? 1.1 + Math.sin(perfTime * 9 + t.seed) * 0.25 : 0;
    t.flame.visible = true;
    t.flame.scale.setScalar(on ? 1 + Math.sin(perfTime * 11 + t.seed) * 0.15 : 0.55);
  }
}

// ------------------------------------------------------------------ AI updates
function updateNPCs(dt) {
  for (const n of npcs) {
    const g = n.ch.group;
    if (n.dead) {
      n.deadTimer -= dt;
      g.rotation.z = lerp(g.rotation.z, Math.PI / 2, dt * 6);
      if (n.deadTimer < 1) g.position.y -= dt * 0.8;
      if (n.deadTimer <= 0) {
        // respawn elsewhere
        n.dead = false; n.hp = 40; n.state = 'idle'; n.timer = rand(1, 4);
        g.rotation.z = 0;
        g.position.copy(randomCityPos());
      }
      continue;
    }
    n.timer -= dt;
    const distP = g.position.distanceTo(player.pos);

    if (n.state === 'flee') {
      const away = g.position.clone().sub(player.pos); away.y = 0; away.normalize();
      moveChar(n, away, 6.2, dt);
      if (n.timer <= 0 || distP > 45) { n.state = 'idle'; n.timer = rand(1, 3); }
    } else if (n.state === 'walk') {
      const to = n.target.clone().sub(g.position); to.y = 0;
      if (to.length() < 1.5 || n.timer <= 0) { n.state = 'idle'; n.timer = rand(2, 6); }
      else moveChar(n, to.normalize(), 1.9, dt);
    } else { // idle
      n.speed = 0;
      if (n.timer <= 0) {
        n.state = 'walk';
        n.timer = rand(6, 14);
        n.target = randomCityPos();
      }
      // panic if fighting nearby
      if (wanted >= 1 && distP < 14) { n.state = 'flee'; n.timer = rand(3, 6); }
    }
    animateWalk(n.ch, n.speed, dt);
  }
}

function moveChar(n, dir, speed, dt) {
  const g = n.ch.group;
  g.position.x += dir.x * speed * dt;
  g.position.z += dir.z * speed * dt;
  const p2 = { x: g.position.x, z: g.position.z };
  collide(p2, 0.5);
  g.position.x = p2.x; g.position.z = p2.z;
  g.rotation.y = angleLerp(g.rotation.y, Math.atan2(dir.x, dir.z), dt * 8);
  n.speed = speed;
}

function updateGuards(dt) {
  for (const gd of guards) {
    const g = gd.ch.group;
    if (gd.dead) {
      gd.deadTimer -= dt;
      g.rotation.z = lerp(g.rotation.z, -Math.PI / 2, dt * 6);
      if (gd.deadTimer < 1) g.position.y -= dt * 0.8;
      if (gd.deadTimer <= 0) {
        scene.remove(g);
        guards.splice(guards.indexOf(gd), 1);
        // keep patrol density up
        if (guards.length < 10) spawnGuard(false);
      }
      continue;
    }
    const distP = g.position.distanceTo(player.pos);
    gd.atkTimer -= dt;

    // aggro check
    if (wanted >= 1 && distP < 42 + wanted * 14 && !player.dead) gd.state = 'chase';
    if (gd.state === 'chase' && (wanted < 1 || player.dead)) gd.state = 'patrol';

    if (gd.state === 'chase') {
      heatTimer = Math.min(heatTimer, 0.5);
      if (distP > 2.1) {
        const to = player.pos.clone().sub(g.position); to.y = 0;
        moveChar(gd, to.normalize(), 6.6 + wanted * 0.5, dt);
      } else {
        gd.speed = 0;
        g.rotation.y = angleLerp(g.rotation.y, Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z), dt * 10);
        if (gd.atkTimer <= 0) {
          gd.atkTimer = 1.1;
          gd.ch.attacking = true;
          gd.ch.armR.rotation.x = -2.2;
          setTimeout(() => { if (gd.ch) { gd.ch.attacking = false; } }, 250);
          if (!player.dead && g.position.distanceTo(player.pos) < 2.8) {
            hurtPlayer(randi(8, 14));
          }
        }
      }
      if (distP > 90) gd.state = 'patrol';
    } else { // patrol
      const wp = gd.route[gd.wp];
      const to = wp.clone().sub(g.position); to.y = 0;
      if (to.length() < 2.5) gd.wp = (gd.wp + 1) % gd.route.length;
      else moveChar(gd, to.normalize(), 2.4, dt);
    }
    animateWalk(gd.ch, gd.speed, dt);
  }
}

function hurtPlayer(dmg) {
  if (player.dead) return;
  player.hp -= dmg;
  sfx.hurt();
  dmgEl.style.opacity = 1;
  setTimeout(() => dmgEl.style.opacity = 0, 250);
  showDamage(player.pos, String(dmg), '#ff6060');
  if (player.hp <= 0) killPlayer();
}

function updateHorses(dt) {
  for (const h of horses) {
    if (h.ridden) {
      animateHorse(h, player.mount === h ? h.speed : 0, dt);
      continue;
    }
    h.timer -= dt;
    if (h.timer <= 0) {
      h.timer = rand(3, 9);
      h.heading = rand(0, Math.PI * 2);
      h.moving = Math.random() < 0.5;
    }
    if (h.moving) {
      h.pos.x += Math.sin(h.heading) * 1.4 * dt;
      h.pos.z += Math.cos(h.heading) * 1.4 * dt;
      collide(h.pos, 0.9);
      h.h.group.rotation.y = angleLerp(h.h.group.rotation.y, h.heading, dt * 4);
      h.speed = 1.4;
    } else h.speed = 0;
    animateHorse(h, h.speed, dt);
  }
}
function animateHorse(h, speed, dt) {
  if (speed > 0.2) {
    h.h.phase += dt * speed * 1.6;
    const s = Math.sin(h.h.phase);
    h.h.legs[0].rotation.x = s * 0.6;
    h.h.legs[1].rotation.x = -s * 0.6;
    h.h.legs[2].rotation.x = -s * 0.6;
    h.h.legs[3].rotation.x = s * 0.6;
  } else {
    for (const l of h.h.legs) l.rotation.x *= 0.85;
  }
}

// ------------------------------------------------------------------ projectiles & effects
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    const pos = p.mesh.position;
    let explode = p.life <= 0 || pos.y < 0.1;
    if (!explode && insideAnyBuilding(pos.x, pos.z, -0.1) && pos.y < 10) explode = true;
    if (!explode) {
      for (const e of [...npcs, ...guards]) {
        if (e.dead) continue;
        if (e.ch.group.position.distanceTo(pos) < 1.4) { explode = true; break; }
      }
    }
    if (explode) {
      burst(pos, 0xff8830, 22, 8, 0.7);
      burst(pos, 0xffcf3a, 12, 5, 0.5);
      sfx.boom();
      for (const e of [...npcs, ...guards]) {
        if (e.dead) continue;
        const d = e.ch.group.position.distanceTo(pos);
        if (d < 5.5) damageEnemy(e, Math.round(lerp(70, 25, d / 5.5)), guards.includes(e));
      }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.vel) {
      if (e.grav) e.vel.y -= 14 * dt;
      e.obj.position.addScaledVector(e.vel, dt);
    }
    if (e.fade && e.obj.material) e.obj.material.opacity = Math.max(0, e.life);
    if (e.life <= 0) {
      scene.remove(e.obj);
      if (e.obj.material && e.obj.material.dispose) e.obj.material.dispose();
      effects.splice(i, 1);
    }
  }
}

function updateCoins(dt) {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.t += dt;
    c.mesh.rotation.z = c.t * 3;
    c.mesh.position.y = 0.5 + Math.sin(c.t * 4) * 0.12;
    if (c.mesh.position.distanceTo(player.pos) < 1.8) {
      player.gold += c.value;
      sfx.coin();
      showDamage(c.mesh.position, '+$' + c.value, '#ffd54a');
      scene.remove(c.mesh);
      coins.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ player update
function updatePlayer(dt) {
  if (player.dead) {
    player.ch.group.rotation.z = lerp(player.ch.group.rotation.z, Math.PI / 2, dt * 6);
    return;
  }
  player.ch.group.rotation.z = 0;

  // input direction in camera space
  let ix = 0, iz = 0;
  if (keys['KeyW']) iz += 1;
  if (keys['KeyS']) iz -= 1;
  if (keys['KeyA']) ix += 1;
  if (keys['KeyD']) ix -= 1;
  const hasInput = (ix !== 0 || iz !== 0) && pointerLocked;
  const sprinting = keys['ShiftLeft'] && player.stamina > 1 && hasInput;

  let dir = new THREE.Vector3();
  if (hasInput) {
    const f = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    dir.addScaledVector(f, iz).addScaledVector(r, -ix).normalize();
  }

  if (player.mount) {
    // horse riding
    const h = player.mount;
    const maxSpeed = sprinting ? 24 : 15;
    const target = hasInput ? maxSpeed : 0;
    h.speed = lerp(h.speed || 0, target, dt * (hasInput ? 2.2 : 3.5));
    if (hasInput) h.heading = angleLerp(h.heading, Math.atan2(dir.x, dir.z), dt * 3.2);
    h.pos.x += Math.sin(h.heading) * h.speed * dt;
    h.pos.z += Math.cos(h.heading) * h.speed * dt;
    collide(h.pos, 1.0);
    h.h.group.rotation.y = h.heading;
    player.heading = h.heading;
    player.pos.copy(h.pos);
    animateHorse(h, h.speed, dt);
    // trample: knock peasants at speed
    if (h.speed > 12) {
      for (const n of npcs) {
        if (n.dead) continue;
        if (n.ch.group.position.distanceTo(h.pos) < 1.6) damageEnemy(n, 50, false);
      }
    }
    // seat the player
    player.ch.group.position.set(h.pos.x, 1.62, h.pos.z);
    player.ch.group.rotation.y = h.heading;
    player.ch.legL.rotation.x = -1.15;
    player.ch.legR.rotation.x = -1.15;
    player.ch.armL.rotation.x = -0.55;
    if (!player.ch.attacking) player.ch.armR.rotation.x = -0.55;
    if (sprinting) player.stamina = Math.max(0, player.stamina - 6 * dt);
    else player.stamina = Math.min(100, player.stamina + 10 * dt);
  } else {
    // on foot
    const speed = sprinting ? 10 : 5.6;
    player.vel.x = lerp(player.vel.x, dir.x * speed, dt * 10);
    player.vel.z = lerp(player.vel.z, dir.z * speed, dt * 10);
    if (keys['Space'] && player.grounded) { player.vy = 8.2; player.grounded = false; }
    player.vy -= 24 * dt;
    player.y = (player.y || 0) + player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; }
    player.pos.x += player.vel.x * dt;
    player.pos.z += player.vel.z * dt;
    collide(player.pos, 0.55);
    if (hasInput) player.heading = angleLerp(player.heading, Math.atan2(dir.x, dir.z), dt * 10);
    const spd = Math.hypot(player.vel.x, player.vel.z);
    player.ch.group.position.set(player.pos.x, 0, player.pos.z);
    if (player.grounded) {
      animateWalk(player.ch, spd, dt);   // sets a small walk bob on group.y
    } else {
      player.ch.legL.rotation.x = 0.5;
      player.ch.legR.rotation.x = -0.4;
    }
    player.ch.group.position.y += player.y;
    player.ch.group.rotation.y = player.heading;

    if (sprinting && spd > 1) player.stamina = Math.max(0, player.stamina - 16 * dt);
    else player.stamina = Math.min(100, player.stamina + 11 * dt);
  }

  // attack animation
  if (player.attackTimer > 0) {
    player.attackTimer -= dt;
    const t = 1 - player.attackTimer / 0.32;
    player.ch.armR.rotation.x = t < 0.4 ? lerp(0, -2.4, t / 0.4) : lerp(-2.4, 0, (t - 0.4) / 0.6);
    if (player.attackTimer <= 0) player.ch.attacking = false;
  }
  player.attackCd -= dt;

  // regen
  player.mana = Math.min(player.maxMana, player.mana + 5.5 * dt);
}

// ------------------------------------------------------------------ camera
const camTargetPos = new THREE.Vector3();
function updateCamera(dt) {
  if (!started) {
    // menu: slow cinematic orbit of the market square
    const t = perfTime * 0.08;
    camera.position.set(Math.cos(t) * 55, 26, Math.sin(t) * 55);
    camera.lookAt(0, 6, 0);
    return;
  }
  const dist = player.mount ? 9.5 : 6.8;
  const head = player.mount ? 2.6 : 1.7;
  const cp = Math.max(camPitch, -0.4);
  const off = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(cp) * dist,
    Math.sin(cp) * dist + head,
    Math.cos(camYaw) * Math.cos(cp) * dist
  );
  camTargetPos.copy(player.pos).add(off);
  if (camTargetPos.y < 0.6) camTargetPos.y = 0.6;
  camera.position.lerp(camTargetPos, 1 - Math.pow(0.0001, dt));
  camera.lookAt(player.pos.x, player.pos.y + head, player.pos.z);
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let perfTime = 0;
let hudTick = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  perfTime += dt;

  if (started && pointerLocked) {
    updatePlayer(dt);
    updateNPCs(dt);
    updateGuards(dt);
    updateHorses(dt);
    updateProjectiles(dt);
    updateCoins(dt);

    // skill cooldowns
    for (const s of SKILLS) s.t = Math.max(0, s.t - dt);

    // wanted decay
    if (wanted > 0) {
      heatTimer += dt;
      if (heatTimer > 12) wanted = Math.max(0, wanted - dt * 0.15);
      if (wanted <= 0) for (const g of guards) if (g.state === 'chase') g.state = 'patrol';
    }

    // prompts
    if (player.mount) {
      promptEl.style.display = 'block';
      promptEl.innerHTML = 'Press <b>E</b> to dismount';
    } else if (nearestHorse()) {
      promptEl.style.display = 'block';
      promptEl.innerHTML = 'Press <b>E</b> to mount horse';
    } else promptEl.style.display = 'none';

    // zone title
    const z = currentZone();
    if (z !== lastZone) { lastZone = z; zoneEl.textContent = z; zoneEl.style.opacity = 1; zoneTimer = 3.5; }
    if (zoneTimer > 0) { zoneTimer -= dt; if (zoneTimer <= 0) zoneEl.style.opacity = 0; }

    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msgEl.style.opacity = 0; }
  }

  updateEffects(dt);
  updateDayNight(dt);
  updateCamera(dt);

  if (flashTimer > 0) {
    flashTimer -= dt;
    renderer.toneMappingExposure = 1.05 + flashTimer * 4;
  } else renderer.toneMappingExposure = 1.05;

  hudTick += dt;
  if (hudTick > 0.08) {
    hudTick = 0;
    updateHUD();
    drawMinimap();
  }

  renderer.render(scene, camera);
}

// screenshot/demo mode: skip the menu so the world simulates without pointer lock
if (location.hash === '#demo') {
  started = true;
  pointerLocked = true;
  menuEl.style.display = 'none';
}

showMsg('Welcome to Ashvale. Cause trouble, and the watch will come for you...', 5);
animate();
