// 相机系统:第三人称跟随、锁定时越肩取景、防穿墙(遮挡射线)/防穿岩(大碰撞圆)、震屏与动态视野。
// 共享的镜头状态放在 cam 对象里(鼠标改 yaw/pitch,战斗系统加 shake/fovKick),由 updateCamera 每帧消费。
import * as THREE from 'three';
import { camera } from '../gfx/core.js';
import { groundH } from '../terrain.js';
import { rand } from '../core/rng.js';
import { ctx } from '../core/ctx.js';
import { angleLerp } from '../entities.js';

export const cam = {
  yaw: 0, pitch: 0.35, // 鼠标控制的环绕角
  shake: 0,            // 受击/落地震屏(秒)
  fovKick: 0,          // 处决瞬间镜头急推
  moveState: 0,        // 0 静止 1 走 2 跑 3 疾驰(驱动速度感视野)
  snapNext: false,     // 传送后下一帧直接到位
};
const _camOff = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _camRay = new THREE.Raycaster();
const _camDir = new THREE.Vector3();
// 大碰撞圆(r≥1.4:岩石地标/塔基)按 32m 格索引,碰撞圆数量变化时重建
const camRockGrid = new Map();
let camRockLen = -1;
function rebuildCamRocks(colliders) {
  camRockGrid.clear();
  for (const c of colliders.circles) {
    if (c.r < 1.4) continue;
    const k = `${Math.floor(c.x / 32)},${Math.floor(c.z / 32)}`;
    if (!camRockGrid.has(k)) camRockGrid.set(k, []);
    camRockGrid.get(k).push(c);
  }
  camRockLen = colliders.circles.length;
}
function pullCameraFromRocks(target, colliders) {
  if (camRockLen !== colliders.circles.length) rebuildCamRocks(colliders);
  const cx = camera.position.x, cz = camera.position.z;
  const dx = cx - target.x, dz = cz - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  // 沿视线从人物往相机走,遇到第一块岩石就停在它外面
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const px = target.x + dx * t, pz = target.z + dz * t;
    const cell = camRockGrid.get(`${Math.floor(px / 32)},${Math.floor(pz / 32)}`);
    if (!cell) continue;
    for (const c of cell) {
      const rr = c.r * 1.35 + 0.4; // 岩石的轮廓比碰撞圆更大:相机要离得更远才不钻进去
      if ((px - c.x) * (px - c.x) + (pz - c.z) * (pz - c.z) < rr * rr) {
        const k = Math.max(0.18, (i - 1) / 6);
        camera.position.x = target.x + dx * k;
        camera.position.z = target.z + dz * k;
        camera.position.y = Math.max(camera.position.y, target.y + 0.4);
        return;
      }
    }
  }
}
export function updateCamera(dt) {
  const { player, world, colliders } = ctx;
  const lockFoe = ctx.getLockFoe();
  const dist = player.mounted ? (player.mounted.sheep ? 6 : 9) : 6.2;
  const ty = player.pos.y + groundH(player.pos.x, player.pos.z) +
    (player.mounted ? (player.mounted.sheep ? 1.7 : 2.6) : 1.7);
  // 醉酒:地平线跟着晃
  if (player.drunkT > 0) {
    camera.up.set(Math.sin(performance.now() * 0.0011) * 0.16, 1, 0).normalize();
  } else {
    camera.up.set(0, 1, 0);
  }
  // 锁定中:越肩取景——镜头偏到主角右后方约 26°,敌人的起手动作和脚下红圈不再被主角身体挡住
  if (lockFoe) {
    cam.yaw = angleLerp(cam.yaw,
      Math.atan2(player.pos.x - lockFoe.pos.x, player.pos.z - lockFoe.pos.z) + 0.45, Math.min(1, dt * 4));
    cam.pitch += (0.42 - cam.pitch) * Math.min(1, dt * 2.5);
  }
  _camOff.set(
    Math.sin(cam.yaw) * Math.cos(cam.pitch),
    Math.sin(cam.pitch),
    Math.cos(cam.yaw) * Math.cos(cam.pitch),
  ).multiplyScalar(dist);
  const target = _camTarget.set(player.pos.x, ty, player.pos.z);
  if (lockFoe) { // 视点偏向敌我中间
    target.x += (lockFoe.pos.x - player.pos.x) * 0.22;
    target.z += (lockFoe.pos.z - player.pos.z) * 0.22;
  }
  const desired = _camDesired.copy(target).add(_camOff);
  desired.y = Math.max(groundH(desired.x, desired.z) + 0.6, desired.y); // 镜头不钻进山坡
  camera.position.lerp(desired, cam.snapNext ? 1 : 1 - Math.pow(0.0001, dt)); // 传送后一帧到位
  cam.snapNext = false;
  // 相机防穿岩:大块地标(台地/玄武柱/露头/冰岩/断塔)没有遮挡网格,按碰撞圆把相机拉到岩石外侧
  pullCameraFromRocks(target, colliders);
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
  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt);
    camera.position.x += (rand() - 0.5) * cam.shake * 0.5;
    camera.position.y += (rand() - 0.5) * cam.shake * 0.35;
  }
  camera.lookAt(target);
  // 疾跑/疾驰时动态拉伸视野(速度感);处决瞬间反向急推(贴近感)
  if (cam.fovKick > 0) cam.fovKick -= dt;
  const fovTarget = 62 + [0, 0, 3.5, 9][cam.moveState] - (cam.fovKick > 0 ? 9 : 0);
  if (Math.abs(camera.fov - fovTarget) > 0.05) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * (cam.fovKick > 0 ? 14 : 5));
    camera.updateProjectionMatrix();
  }
}
