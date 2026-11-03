// 地图:小地图(以玩家为中心、群系底色、道路建筑、人物、任务目标与来袭方向)与 M 键王国全图。
// 动态数据每次绘制时经 ctx.mapView() 取一份快照,本模块不持有任何玩法状态。
import { mapColor } from '../terrain.js';
import { REGIONS } from '../story.js';
import { ctx } from '../core/ctx.js';

const mm = document.getElementById('minimap').getContext('2d');
// ================= 大地图(M) =================
// 王国 ±520m 全图:群系底色 + 道路建筑 + 地名 + 你/任务目标/管家;打开时世界暂停
const bigmapEl = document.getElementById('bigmap');
const bigmapCv = document.getElementById('bigmap-c');
export const mapState = { open: false };
let bigBase = null;
const BIG_R = 520;
function buildBigBase() {
  const c = document.createElement('canvas');
  c.width = c.height = 720;
  const g = c.getContext('2d');
  const k = 720 / (BIG_R * 2);
  const cell = 12;
  for (let x = -BIG_R; x < BIG_R; x += cell) {
    for (let z = -BIG_R; z < BIG_R; z += cell) {
      g.fillStyle = mapColor(x, z);
      g.fillRect((x + BIG_R) * k, (z + BIG_R) * k, cell * k + 0.7, cell * k + 0.7);
    }
  }
  for (const f of ctx.world.features) {
    const mx = (f.x + BIG_R) * k, mz = (f.z + BIG_R) * k;
    if (f.type === 'road') {
      g.save(); g.translate(mx, mz); g.rotate(-f.rot);
      g.fillStyle = 'rgba(214,196,150,0.9)';
      g.fillRect((-f.w / 2) * k - 0.5, (-f.h / 2) * k, f.w * k + 1, f.h * k);
      g.restore();
      continue;
    }
    if (f.type === 'tree' || f.type === 'dome') continue;
    g.fillStyle = MM_COLS[f.type] || '#888';
    g.fillRect(mx - (f.w * k) / 2, mz - (f.h * k) / 2, Math.max(1.5, f.w * k), Math.max(1.5, f.h * k));
  }
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  for (const r of REGIONS) {
    if (r.r < 18) continue; // 小地名留给小地图
    const mx = (r.x + BIG_R) * k, mz = (r.z + BIG_R) * k;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(20,14,8,0.85)';
    g.strokeText(r.name, mx, mz);
    g.fillStyle = '#f3e7cc';
    g.fillText(r.name, mx, mz);
  }
  return c;
}
function drawBigMap() {
  const V = ctx.mapView();
  if (!bigBase) bigBase = buildBigBase();
  const g = bigmapCv.getContext('2d');
  const k = 720 / (BIG_R * 2);
  g.drawImage(bigBase, 0, 0);
  const at = (x, z) => [(Math.max(-BIG_R, Math.min(BIG_R, x)) + BIG_R) * k, (Math.max(-BIG_R, Math.min(BIG_R, z)) + BIG_R) * k];
  for (const gd of V.guards) {
    if (gd.downT > 0) continue;
    const [x, z] = at(gd.pos.x, gd.pos.z);
    g.fillStyle = '#5588dd'; g.beginPath(); g.arc(x, z, 2.5, 0, 6.28); g.fill();
  }
  for (const b of V.bandits) {
    if (b.dead) continue;
    const [x, z] = at(b.pos.x, b.pos.z);
    g.fillStyle = '#e03030'; g.beginPath(); g.arc(x, z, b.warlord ? 4 : 2.5, 0, 6.28); g.fill();
  }
  if (V.questGiver) {
    const [x, z] = at(ctx.world.questGiverPos.x, ctx.world.questGiverPos.z);
    g.fillStyle = '#ffd83d'; g.font = 'bold 18px sans-serif'; g.fillText('!', x, z + 6);
  }
  if (V.beacon.visible) {
    const bx = V.beaconRouted ? V.beaconRouted.x : V.beacon.position.x, bz = V.beaconRouted ? V.beaconRouted.z : V.beacon.position.z;
    const [x, z] = at(bx, bz);
    const pulse = 5 + Math.sin(performance.now() * 0.008) * 2;
    g.strokeStyle = '#ffd75e'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, z, pulse + 4, 0, 6.28); g.stroke();
    g.fillStyle = '#ffd75e'; g.beginPath(); g.arc(x, z, 4, 0, 6.28); g.fill();
  }
  const [px, pz] = at(ctx.player.pos.x, ctx.player.pos.z);
  g.save();
  g.translate(px, pz);
  g.rotate(-ctx.player.yaw + Math.PI);
  g.fillStyle = '#ffd75e'; g.strokeStyle = '#1a120a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath();
  g.stroke(); g.fill();
  g.restore();
  if (Math.max(Math.abs(ctx.player.pos.x), Math.abs(ctx.player.pos.z)) > BIG_R) {
    g.fillStyle = 'rgba(20,14,8,0.8)'; g.fillRect(8, 8, 220, 24);
    g.fillStyle = '#f3e7cc'; g.font = '13px sans-serif'; g.textAlign = 'left';
    g.fillText('你在王国之外的荒野(箭头指向你的方位)', 14, 25);
    g.textAlign = 'center';
  }
}
let bigMapTimer = 0;
export function toggleBigMap(force) {
  mapState.open = force ?? !mapState.open;
  bigmapEl.style.display = mapState.open ? 'flex' : 'none';
  clearInterval(bigMapTimer);
  if (mapState.open) { drawBigMap(); bigMapTimer = setInterval(drawBigMap, 250); }
}
// ================= 小地图 =================
export const MM_COLS = {
  wall: '#9d9486', tower: '#8d8476', keep: '#7d7466', house: '#a3703f',
  tree: '#295c33', water: '#3f8fc4', field: '#9a7444', plaza: '#cdb891',
  stall: '#c05a3a', windmill: '#e8dcc0', tent: '#5d4a33',
  sand: '#d9c48f', snow: '#e8edf2', swamp: '#44523a', ash: '#57524c',
  bone: '#e8e4da', dome: '#3f7a45', cactus: '#3f8a4f',
};
export function drawMinimap() {
  const V = ctx.mapView();
  const S = 200, range = 240, k = S / range;
  mm.clearRect(0, 0, S, S);
  const px = ctx.player.pos.x, pz = ctx.player.pos.z;
  const toMap = (x, z) => [S / 2 + (x - px) * k, S / 2 + (z - pz) * k];
  mm.save();
  mm.beginPath();
  mm.rect(0, 0, S, S);
  mm.clip();
  // 底图:按群系/高度上色的 16m 格(荒野里不再是一块空绿板)
  {
    const cell = 16, x0 = Math.floor((px - range / 2) / cell) * cell, z0 = Math.floor((pz - range / 2) / cell) * cell;
    const cs = cell * k + 0.6;
    for (let x = x0; x < px + range / 2 + cell; x += cell) {
      for (let z = z0; z < pz + range / 2 + cell; z += cell) {
        mm.fillStyle = mapColor(x, z);
        const [mx, mz] = toMap(x, z);
        mm.fillRect(mx, mz, cs, cs);
      }
    }
  }
  for (const f of ctx.world.features) {
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
  for (const h of V.horses) {
    const [mx, mz] = toMap(h.pos.x, h.pos.z);
    mm.fillStyle = '#c49a5a';
    mm.fillRect(mx - 2, mz - 2, 4, 4);
  }
  // 卫兵
  for (const g of V.guards) {
    if (g.downT > 0) continue;
    const [mx, mz] = toMap(g.pos.x, g.pos.z);
    mm.fillStyle = V.wanted > 0 ? '#ff3b30' : '#5588dd';
    mm.beginPath();
    mm.arc(mx, mz, 2.5, 0, 6.28);
    mm.fill();
  }
  // 盗贼(战团成员标红,枭首加大加边;不在图内时沿边画来袭方向箭头)
  let wbOffMap = null;
  for (const b of V.bandits) {
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
  if (wbOffMap && V.warband.active) { // 战团尚在图外:红箭头指向来袭方向
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
  if (V.questGiver) {
    const [mx, mz] = toMap(ctx.world.questGiverPos.x, ctx.world.questGiverPos.z);
    mm.fillStyle = '#ffd83d';
    mm.font = 'bold 14px sans-serif';
    mm.fillText('!', mx - 2, mz + 5);
  }
  if (V.beacon.visible) {
    const bdx = V.beacon.position.x - px, bdz = V.beacon.position.z - pz;
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
      const [mx, mz] = toMap(V.beacon.position.x, V.beacon.position.z);
      mm.fillStyle = '#ffd83d';
      mm.beginPath();
      mm.arc(mx, mz, 5, 0, 6.28);
      mm.fill();
    }
  }
  // 玩家箭头
  mm.save();
  mm.translate(S / 2, S / 2);
  mm.rotate(-(ctx.player.mounted ? ctx.player.mounted.yaw : ctx.player.yaw) + Math.PI);
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

