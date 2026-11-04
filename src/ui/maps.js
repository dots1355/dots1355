// 地图:小地图(以玩家为中心、群系底色、道路建筑、人物、任务目标与来袭方向)与 M 键王国全图。
// 地形底图是一张平滑的"羊皮纸地形图":群系底色双线性过渡 + 西北光的山体晕渲 + 群系边界,
// 王国全图、荒野图、小地图共用(按 ±520m 一张缓存)。
// 动态数据每次绘制时经 ctx.mapView() 取一份快照,本模块不持有任何玩法状态。
import { mapColor, dominantBiome, groundH } from '../terrain.js';
import { REGIONS } from '../story.js';
import { ctx } from '../core/ctx.js';
import { wildMarks, wildRegionName } from '../wilderness.js';

const mm = document.getElementById('minimap').getContext('2d');
// ================= 大地图(M) =================
// 王国 ±520m 全图:群系底色 + 道路建筑 + 地名 + 你/任务目标/管家;打开时世界暂停
const bigmapEl = document.getElementById('bigmap');
const bigmapCv = document.getElementById('bigmap-c');
export const mapState = { open: false };
let bigBase = null;
const BIG_R = 520;
// 地形底图:以 (cx,cz) 为中心 ±BIG_R,720px 见方
const TERR_PX = 720;
const terrCache = new Map();
function terrainCanvas(cx, cz) {
  const key = cx + ',' + cz;
  let c = terrCache.get(key);
  if (c) return c;
  if (terrCache.size > 3) terrCache.delete(terrCache.keys().next().value);
  // 1) 群系底色:16m 一格采样进小画布,放大时双线性插值 → 柔和过渡而不是马赛克
  const n = Math.ceil((BIG_R * 2) / 16) + 1;
  const col = document.createElement('canvas');
  col.width = col.height = n;
  const cg = col.getContext('2d');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cg.fillStyle = mapColor(cx - BIG_R + i * 16 + 0.5, cz - BIG_R + j * 16 + 0.5);
      cg.fillRect(i, j, 1, 1);
    }
  }
  // 2) 山体晕渲:10m 一格采高度,西北上方的光;亮面提白、背光面压暗(半透明叠在底色上)
  const m = Math.ceil((BIG_R * 2) / 10) + 1;
  const H = new Float32Array((m + 2) * (m + 2));
  for (let j = -1; j <= m; j++) {
    for (let i = -1; i <= m; i++) H[(j + 1) * (m + 2) + i + 1] = groundH(cx - BIG_R + i * 10, cz - BIG_R + j * 10);
  }
  const shade = document.createElement('canvas');
  shade.width = shade.height = m;
  const sg = shade.getContext('2d');
  const img = sg.createImageData(m, m);
  const L = [-0.55, 0.62, -0.55], ll = Math.hypot(...L);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const at = (di, dj) => H[(j + 1 + dj) * (m + 2) + i + 1 + di];
      const gx = (at(1, 0) - at(-1, 0)) / 20, gz = (at(0, 1) - at(0, -1)) / 20;
      const nl = Math.hypot(gx * 1.6, 1, gz * 1.6);
      const d = ((-gx * 1.6) * L[0] + L[1] - (gz * 1.6) * L[2]) / (nl * ll) - L[1] / ll; // 相对平地的明暗
      const o = (j * m + i) * 4;
      const v = d > 0 ? 255 : 30; // 背光面压成暖褐而不是纯黑,陡峭的雪山不至于糊成黑斑
      img.data[o] = v; img.data[o + 1] = v * 0.94; img.data[o + 2] = v * 0.86;
      img.data[o + 3] = Math.min(105, Math.abs(d) * (d > 0 ? 280 : 300));
    }
  }
  sg.putImageData(img, 0, 0);
  c = document.createElement('canvas');
  c.width = c.height = TERR_PX;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const k = TERR_PX / (BIG_R * 2);
  g.drawImage(col, 0, 0, n, n, -8 * k, -8 * k, n * 16 * k, n * 16 * k);
  g.drawImage(shade, 0, 0, m, m, -5 * k, -5 * k, m * 10 * k, m * 10 * k);
  // 3) 羊皮纸颗粒:一点点纸纹,地图像画出来的
  g.globalAlpha = 0.06;
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = (i & 1) ? '#000' : '#fff';
    g.fillRect(((i * 7919) % TERR_PX), ((i * 104729) % TERR_PX), 2, 2);
  }
  g.globalAlpha = 1;
  biomeEdges(g, cx - BIG_R, cz - BIG_R, cx + BIG_R, cz + BIG_R, 24,
    (x, z) => [(x - cx + BIG_R) * k, (z - cz + BIG_R) * k], 'rgba(40,26,12,0.28)');
  // 4) 高山画成羊皮纸地图的山峰符号:亮面留白、背光面描褐,山越高符号越大(错行排开,不成棋盘)
  for (let j = 0; j * 30 < BIG_R * 2; j++) {
    for (let i = 0; i * 34 < BIG_R * 2; i++) {
      const wx = cx - BIG_R + i * 34 + (j % 2) * 17 + 8, wz = cz - BIG_R + j * 30 + 8;
      const h = H[(Math.round((wz - cz + BIG_R) / 10) + 1) * (m + 2) + Math.round((wx - cx + BIG_R) / 10) + 1];
      if (!(h > 24)) continue;
      const px = (wx - cx + BIG_R) * k, pz = (wz - cz + BIG_R) * k, sz = Math.min(15, 5 + (h - 24) * 0.16);
      g.beginPath(); g.moveTo(px - sz, pz + sz * 0.55); g.lineTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55); g.closePath();
      g.fillStyle = 'rgba(238,232,218,0.9)'; g.fill();
      g.beginPath(); g.moveTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55); g.lineTo(px + sz * 0.15, pz + sz * 0.55); g.closePath();
      g.fillStyle = 'rgba(110,92,72,0.75)'; g.fill();
      g.beginPath(); g.moveTo(px - sz, pz + sz * 0.55); g.lineTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55);
      g.strokeStyle = 'rgba(60,44,30,0.85)'; g.lineWidth = 1.2; g.stroke();
    }
  }
  terrCache.set(key, c);
  return c;
}
function buildBigBase() {
  const c = document.createElement('canvas');
  c.width = c.height = 720;
  const g = c.getContext('2d');
  const k = 720 / (BIG_R * 2);
  g.drawImage(terrainCanvas(0, 0), 0, 0);
  for (const f of ctx.world.features) {
    const mx = (f.x + BIG_R) * k, mz = (f.z + BIG_R) * k;
    if (f.type === 'road') {
      g.save(); g.translate(mx, mz); g.rotate(-f.rot);
      g.fillStyle = 'rgba(214,196,150,0.9)';
      g.fillRect((-f.w / 2) * k - 0.5, (-f.h / 2) * k, f.w * k + 1, f.h * k);
      g.restore();
      continue;
    }
    if (f.type === 'tree' || f.type === 'dome' || ZONE_FEATS.has(f.type)) continue;
    g.fillStyle = MM_COLS[f.type] || '#888';
    if (drawShaped(g, f, (x, z) => [(x + BIG_R) * k, (z + BIG_R) * k], k)) continue;
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
// 荒野图:玩家在王国之外时,以玩家所在 256m 格为中心画 ±520m(地形底图 + 群系地名 + 已探到的营地/遗迹)
let wildBase = null, wildKey = '';
function buildWildBase(cx, cz) {
  const c = document.createElement('canvas');
  c.width = c.height = 720;
  const g = c.getContext('2d');
  const k = 720 / (BIG_R * 2);
  g.drawImage(terrainCanvas(cx, cz), 0, 0);
  g.font = 'bold 13px sans-serif';
  g.textAlign = 'center';
  for (let x = -BIG_R + 130; x < BIG_R; x += 260) { // 群系地名
    for (let z = -BIG_R + 130; z < BIG_R; z += 260) {
      const name = wildRegionName(cx + x, cz + z);
      const mx = (x + BIG_R) * k, mz = (z + BIG_R) * k;
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,14,8,0.8)'; g.strokeText(name, mx, mz);
      g.fillStyle = '#efe2c4'; g.fillText(name, mx, mz);
    }
  }
  return c;
}
function drawBigMap() {
  const V = ctx.mapView();
  const g = bigmapCv.getContext('2d');
  const k = 720 / (BIG_R * 2);
  const wild = Math.max(Math.abs(ctx.player.pos.x), Math.abs(ctx.player.pos.z)) > BIG_R;
  const ox = wild ? Math.round(ctx.player.pos.x / 256) * 256 : 0, oz = wild ? Math.round(ctx.player.pos.z / 256) * 256 : 0;
  if (wild) {
    const key = ox + ',' + oz;
    if (key !== wildKey) { wildBase = buildWildBase(ox, oz); wildKey = key; }
    g.drawImage(wildBase, 0, 0);
  } else {
    if (!bigBase) bigBase = buildBigBase();
    g.drawImage(bigBase, 0, 0);
  }
  const titleEl = bigmapEl.querySelector('.bm-title');
  if (titleEl && titleEl.firstChild) titleEl.firstChild.textContent = wild ? '荒野图(以你所在一带为中心) ' : '王国全图 ';
  const at = (x, z) => [(Math.max(-BIG_R, Math.min(BIG_R, x - ox)) + BIG_R) * k, (Math.max(-BIG_R, Math.min(BIG_R, z - oz)) + BIG_R) * k];
  drawMarks(g, V, (x, z) => [(x - ox + BIG_R) * k, (z - oz + BIG_R) * k], 1.3);
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
}
let bigMapTimer = 0;
export function toggleBigMap(force) {
  mapState.open = force ?? !mapState.open;
  bigmapEl.style.display = mapState.open ? 'flex' : 'none';
  clearInterval(bigMapTimer);
  if (mapState.open) { drawBigMap(); bigMapTimer = setInterval(drawBigMap, 250); }
}
// 群系片区(荒漠/沼泽/焦土/雪原的圆盘标记):地形底图已按群系上色,地图上不再叠一块方色板
const ZONE_FEATS = new Set(['sand', 'snow', 'swamp', 'ash']);
// ================= 小地图 =================
export const MM_COLS = {
  wall: '#9d9486', tower: '#8d8476', keep: '#7d7466', house: '#a3703f',
  tree: '#295c33', water: '#4f7f96', field: '#9a7444', plaza: '#cdb891',
  stall: '#c05a3a', windmill: '#e8dcc0', tent: '#5d4a33',
  sand: '#d9c48f', snow: '#e8edf2', swamp: '#44523a', ash: '#57524c',
  bone: '#e8e4da', dome: '#3f7a45', cactus: '#3f8a4f',
};
// 有真实轮廓(湖/塘/冰湖)的画多边形,带朝向的(河段)画旋转矩形;返回是否已画
function drawShaped(g, f, toXY, k) {
  if (f.poly) {
    g.beginPath();
    f.poly.forEach(([x, z], i) => { const [px, pz] = toXY(x, z); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
    g.closePath();
    g.fill();
    return true;
  }
  if (f.type === 'water' && f.rot) {
    const [mx, mz] = toXY(f.x, f.z);
    g.save(); g.translate(mx, mz); g.rotate(-f.rot);
    g.fillRect((-f.w / 2) * k, (-f.h / 2) * k, Math.max(1.5, f.w * k), f.h * k + 0.6);
    g.restore();
    return true;
  }
  return false;
}
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
  // 底图:从共用的地形底图里裁一块(王国内用王国那张,荒野里按 256m 格换中心)——平滑过渡 + 山体晕渲
  {
    const inCore = Math.max(Math.abs(px), Math.abs(pz)) < BIG_R - range * 0.75;
    const ox = inCore ? 0 : Math.round(px / 256) * 256, oz = inCore ? 0 : Math.round(pz / 256) * 256;
    const tc = terrainCanvas(ox, oz), tk = TERR_PX / (BIG_R * 2);
    mm.fillStyle = '#6b7a52';
    mm.fillRect(0, 0, S, S);
    mm.imageSmoothingEnabled = true;
    mm.drawImage(tc, (px - range / 2 - ox + BIG_R) * tk, (pz - range / 2 - oz + BIG_R) * tk, range * tk, range * tk, 0, 0, S, S);
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
    if (ZONE_FEATS.has(f.type) || f.type === 'dome') continue; // 群系片区已画在地形底图里
    mm.fillStyle = MM_COLS[f.type] || '#888';
    if (f.type === 'tree') { mm.beginPath(); mm.arc(mx, mz, Math.max(1.6, (f.w * k) / 2), 0, 6.28); mm.fill(); continue; }
    if (drawShaped(mm, f, toMap, k)) continue;
    mm.fillRect(mx - (f.w * k) / 2, mz - (f.h * k) / 2, Math.max(2, f.w * k), Math.max(2, f.h * k));
  }
  drawMarks(mm, V, toMap, 1);
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


// 群系边界:相邻两格主群系不同就沿公共边描一道细线(按 16m 格缓存主群系)
const _biomeCache = new Map();
function biomeAt(x, z, cell) {
  const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
  const key = ix * 100003 + iz + cell * 7;
  let b = _biomeCache.get(key);
  if (b === undefined) {
    b = dominantBiome(ix * cell + cell / 2, iz * cell + cell / 2);
    if (_biomeCache.size > 40000) _biomeCache.clear();
    _biomeCache.set(key, b);
  }
  return b;
}
function biomeEdges(g, x0, z0, x1, z1, cell, toXY, color) {
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.floor(x0 / cell) * cell; x < x1; x += cell) {
    for (let z = Math.floor(z0 / cell) * cell; z < z1; z += cell) {
      const b = biomeAt(x, z, cell);
      if (biomeAt(x + cell, z, cell) !== b) {
        const [ax, az] = toXY(x + cell, z), [bx, bz] = toXY(x + cell, z + cell);
        g.moveTo(ax, az); g.lineTo(bx, bz);
      }
      if (biomeAt(x, z + cell, cell) !== b) {
        const [ax, az] = toXY(x, z + cell), [bx, bz] = toXY(x + cell, z + cell);
        g.moveTo(ax, az); g.lineTo(bx, bz);
      }
    }
  }
  g.stroke();
}
// 地物标记:荒野区块里的营地/匪窝/断塔/遗迹/巨岩 + 篝火/温泉/小教堂(小地图与大地图共用)
function drawMarks(g, V, toXY, s) {
  const marks = wildMarks();
  for (const sp of V.wildSpots || []) marks.push({ kind: sp.type, x: sp.x, z: sp.z });
  for (const m of marks) {
    const [x, y] = toXY(m.x, m.z);
    if (x < -8 || y < -8 || x > g.canvas.width + 8 || y > g.canvas.height + 8) continue;
    g.lineWidth = 1.2 * s;
    g.strokeStyle = 'rgba(20,12,6,0.9)';
    if (m.kind === 'camp' || m.kind === 'bandit') { // 帐篷:三角
      g.fillStyle = m.kind === 'bandit' ? '#c8382c' : '#d39a4a';
      g.beginPath(); g.moveTo(x, y - 5 * s); g.lineTo(x + 4.5 * s, y + 3.5 * s); g.lineTo(x - 4.5 * s, y + 3.5 * s); g.closePath();
      g.fill(); g.stroke();
    } else if (m.kind === 'tower') {
      g.fillStyle = '#b8b0a2';
      g.fillRect(x - 3 * s, y - 4.5 * s, 6 * s, 9 * s); g.strokeRect(x - 3 * s, y - 4.5 * s, 6 * s, 9 * s);
    } else if (m.kind === 'ruin' || m.kind === 'chapel') { // 遗迹/小教堂:十字
      g.strokeStyle = '#efe6d2'; g.lineWidth = 2 * s;
      g.beginPath(); g.moveTo(x, y - 4.5 * s); g.lineTo(x, y + 4.5 * s); g.moveTo(x - 3 * s, y - 1.5 * s); g.lineTo(x + 3 * s, y - 1.5 * s); g.stroke();
    } else if (m.kind === 'spring') {
      g.fillStyle = '#6ab8d8'; g.beginPath(); g.arc(x, y, 3.5 * s, 0, 6.28); g.fill(); g.stroke();
    } else if (m.kind === 'campfire') {
      g.fillStyle = '#ff9a3a'; g.beginPath(); g.arc(x, y, 2.8 * s, 0, 6.28); g.fill(); g.stroke();
    } else if (m.kind === 'rock') {
      g.fillStyle = 'rgba(60,56,50,0.75)'; g.beginPath(); g.arc(x, y, 2.4 * s, 0, 6.28); g.fill();
    }
  }
}
