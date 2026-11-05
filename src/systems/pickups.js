// 拾取物:金币(地上一小摞;全图金币汇总进一个 InstancedMesh + 一层闪光点,逻辑上每枚仍是个场景代理)、
// 红心、皇家纹章(crestsFound,随存档)、通关之星;落地、吸附、拾取与过期都在 updatePickups(dt)。
// 对外:pickups、addPickup(type, x, z, ttl, id, chunk)、dropCoins(pos, n)、crestsFound、crestG(战利品墙复用);
// initPickups() 启动装配调用一次;主循环调 updatePickups(dt)、updateCoinInstances(now)。
import * as THREE from 'three';
import { mergeGeometries } from '../../lib/jsm/utils/BufferGeometryUtils.js';
import { groundH } from '../terrain.js';
import { rand } from '../core/rng.js';
import { scene } from '../gfx/core.js';
import { world } from '../core/state.js';

// ================= 拾取物 =================
export const pickups = [];
export const crestsFound = [];
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
export const crestG = crestGeo();
const crestMat = new THREE.MeshStandardMaterial({
  color: 0x3f6fd0, emissive: 0x1a3a88, emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 });

// ---- 金币:落在地上的一小摞(实例化:全图几百枚金币只占一次绘制) + 一层闪光点 ----
// 逻辑上每枚金币仍是一个 Object3D 代理(进场景、可 scene.remove),渲染时汇总进 InstancedMesh
const COIN_MAX = 1024;
const coinStackGeo = (() => {
  const parts = [];
  for (const [x, y, z, rx, rz] of [[0, 0.018, 0, 0, 0], [0.05, 0.053, 0.03, 0.05, -0.04], [-0.02, 0.088, -0.01, -0.03, 0.06], [0.2, 0.1, -0.05, 1.2, 0.3]]) {
    const c = new THREE.CylinderGeometry(0.15, 0.15, 0.035, 14);
    c.rotateX(rx); c.rotateZ(rz);
    c.translate(x, y, z);
    parts.push(c);
  }
  return mergeGeometries(parts, false);
})();
const coinIM = new THREE.InstancedMesh(coinStackGeo, coinMat, COIN_MAX);
const glintTex = (() => { // 四芒星闪光
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,230,150,0.55)');
  grd.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,230,0.9)';
  g.fillRect(31, 4, 2, 56);
  g.fillRect(4, 31, 56, 2);
  return new THREE.CanvasTexture(c);
})();
const coinGlintPos = new Float32Array(COIN_MAX * 3);
const coinGlintGeo = new THREE.BufferGeometry();
const coinGlint = new THREE.Points(coinGlintGeo, new THREE.PointsMaterial({ size: 0.55, map: glintTex, color: 0xffe7a0,
  transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
const coinProxies = new Set();
const _cM = new THREE.Matrix4(), _cQ = new THREE.Quaternion(), _cV = new THREE.Vector3(), _cS = new THREE.Vector3(1, 1, 1);
const _cUp = new THREE.Vector3(0, 1, 0);
export function updateCoinInstances(now) {
  let i = 0;
  for (const p of coinProxies) {
    if (!p.parent) { coinProxies.delete(p); continue; }
    if (!p.visible || i >= COIN_MAX) continue;
    const u = p.userData;
    if (u.cx !== p.position.x || u.cz !== p.position.z) { u.cx = p.position.x; u.cz = p.position.z; u.cy = groundH(u.cx, u.cz); }
    _cQ.setFromAxisAngle(_cUp, u.yaw);
    _cM.compose(_cV.set(u.cx, u.cy + 0.01, u.cz), _cQ, _cS);
    coinIM.setMatrixAt(i, _cM);
    // 闪光点:各自错开相位地一闪一闪(高度随相位轻轻起伏)
    const ph = Math.sin(now * 0.004 + u.yaw * 7);
    coinGlintPos[i * 3] = u.cx;
    coinGlintPos[i * 3 + 1] = u.cy + 0.32 + ph * 0.06;
    coinGlintPos[i * 3 + 2] = u.cz;
    i++;
  }
  coinIM.count = i;
  coinIM.instanceMatrix.needsUpdate = true;
  coinGlintGeo.setDrawRange(0, i);
  coinGlintGeo.attributes.position.needsUpdate = true;
  coinGlint.material.size = 0.45 + 0.15 * Math.sin(now * 0.006);
}
export function addPickup(type, x, z, ttl = Infinity, id = -1, chunk = null) {
  let mesh;
  if (type === 'coin') {
    mesh = new THREE.Object3D(); // 代理:真正的绘制交给 coinIM
    mesh.userData.yaw = rand() * Math.PI * 2;
    // 代理只提供 x/z 与可见性:不贴地(地面高度在 updateCoinInstances 里算)、不更新矩阵,
    // 转动(拾取动画每帧改 rotation.y)也不必同步成四元数
    mesh.userData.noSnap = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.rotation._onChange(() => {});
    coinProxies.add(mesh);
  } else if (type === 'heart') mesh = new THREE.Mesh(heartG, heartMat);
  else if (type === 'crest') mesh = new THREE.Mesh(crestG, crestMat);
  else mesh = new THREE.Mesh(starGeoBig(), new THREE.MeshStandardMaterial({
    color: 0xffd83d, emissive: 0xaa7700, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.25 }));
  mesh.position.set(x, type === 'coin' ? 0 : type === 'star' ? 1.4 : type === 'crest' ? 1.0 : 0.65, z);
  if (type === 'star') mesh.scale.setScalar(1.4);
  mesh.castShadow = type !== 'coin';
  scene.add(mesh);
  pickups.push({ mesh, type, x, z, ttl, id, chunk, t: rand() * 6 });
}
export function dropCoins(pos, n) {
  for (let i = 0; i < n; i++) {
    const a = rand() * 6.28;
    addPickup('coin', pos.x + Math.cos(a) * (0.6 + rand()), pos.z + Math.sin(a) * (0.6 + rand()), 25);
  }
}
// 金币实例化网格与闪光点进场景,撒下开局的金币(启动装配原位调用)
export function initPickups() {
  coinIM.count = 0;
  coinIM.frustumCulled = false;
  coinIM.receiveShadow = true;
  coinIM.userData.noSnap = true;
  scene.add(coinIM);
  coinGlintGeo.setAttribute('position', new THREE.BufferAttribute(coinGlintPos, 3));
  coinGlint.frustumCulled = false;
  coinGlint.userData.noSnap = true;
  scene.add(coinGlint);
  for (const [x, z] of world.coinSpots) addPickup('coin', x, z);
}
