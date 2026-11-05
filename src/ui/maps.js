// 地图:小地图(以玩家为中心、群系底色、道路建筑、人物、任务目标与来袭方向)与 M 键王国全图。
// 地形底图是一张平滑的"羊皮纸地形图":群系底色双线性过渡 + 西北光的山体晕渲 + 群系边界 + 山峰符号 + 纸纹。
// 小地图与大地图各用各的底图:
//  - 小地图:中心对齐 120m 格、±270m、5m 采样的小底图(450px,与小地图同比例)。生成是分帧的生成器
//    (每次绘制限时约 2ms),朝移动方向预取下一格;新底图做完之前继续用仍盖得住视野的旧底图。
//    采样点、群系描边、山峰符号、纸纹都钉在世界坐标上,换底图时画面不跳。
//  - 大地图(M,打开时世界暂停):±520m 一张,打开时一次画完(王国那张合成后留着复用)。
// 高度直接采 terrainH(不经过 groundH 和它的格点缓存)。
// 动态数据每次绘制时经 ctx.mapView() 取一份快照,本模块不持有任何玩法状态;每帧的绘制路径不分配对象。
import { mapRGB, dominantBiome, terrainH } from '../terrain.js';
import { REGIONS } from '../story.js';
import { player, world } from '../core/state.js';
import { ctx } from '../core/ctx.js';
import { wildMarks, wildRegionName } from '../wilderness.js';
import { NAV_BRIDGE } from '../systems/nav.js';

const mm = document.getElementById('minimap').getContext('2d');
// ================= 地形底图 =================
// 一张底图 = 画布 + 复用的采样缓冲;以 (cx,cz) 为中心 ±R 米、P 像素见方。hs/cs:高度/底色的采样间距(cs = 2·hs)
const K0 = 720 / 1040; // 旧版底图的比例(像素/米):线宽、纸纹、山峰符号的大小按它换算,两种底图观感一致
function makeBase(R, P, hs) {
  const cs = hs * 2;
  const m = Math.round((2 * R) / hs) + 1, n = Math.round((2 * R) / cs) + 1;
  const mk = (w) => { const c = document.createElement('canvas'); c.width = c.height = w; return c; };
  const canvas = mk(P), col = mk(n), shade = mk(m);
  const cg = col.getContext('2d'), sg = shade.getContext('2d');
  return { R, P, hs, cs, m, n, k: P / (2 * R), cx: 0, cz: 0, ready: false, used: 0,
    canvas, g: canvas.getContext('2d'), col, cg, colImg: cg.createImageData(n, n), shade, sg, shadeImg: sg.createImageData(m, m),
    H: new Float32Array((m + 2) * (m + 2)) };
}
const _rgb = [0, 0, 0];
const L = [-0.55, 0.62, -0.55], LL = Math.hypot(L[0], L[1], L[2]);
// 分帧生成器:每个 yield 都是一个可以停下来等下一次的点(单步远小于 1ms)
function* paintBase(b, cx, cz) {
  b.ready = false;
  b.cx = cx; b.cz = cz;
  const { R, hs, cs, m, n, k, H } = b;
  const x0 = cx - R, z0 = cz - R, W = m + 2;
  // 1) 高度:hs 一格,外加一圈边(算坡度用)
  for (let j = -1; j <= m; j++) {
    const z = z0 + j * hs, row = (j + 1) * W + 1;
    for (let i = -1; i <= m; i++) H[row + i] = terrainH(x0 + i * hs, z);
    yield;
  }
  // 2) 群系底色:cs 一格(正好落在高度网格的偶数点上,高度直接取网格)
  const cd = b.colImg.data, st = cs / hs;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      mapRGB(x0 + i * cs, z0 + j * cs, H[(j * st + 1) * W + i * st + 1], _rgb);
      const o = (j * n + i) * 4;
      cd[o] = _rgb[0]; cd[o + 1] = _rgb[1]; cd[o + 2] = _rgb[2]; cd[o + 3] = 255;
    }
    if (j % 6 === 5) yield;
  }
  b.cg.putImageData(b.colImg, 0, 0);
  yield;
  // 3) 山体晕渲:西北上方的光;亮面提白、背光面压暗(半透明叠在底色上)
  const sd = b.shadeImg.data, inv = 1 / (2 * hs);
  for (let j = 0; j < m; j++) {
    const r0 = (j + 1) * W + 1;
    for (let i = 0; i < m; i++) {
      const c = r0 + i;
      const gx = (H[c + 1] - H[c - 1]) * inv, gz = (H[c + W] - H[c - W]) * inv;
      const nl = Math.hypot(gx * 1.6, 1, gz * 1.6);
      const d = ((-gx * 1.6) * L[0] + L[1] - (gz * 1.6) * L[2]) / (nl * LL) - L[1] / LL; // 相对平地的明暗
      const o = (j * m + i) * 4;
      const v = d > 0 ? 255 : 30; // 背光面压成暖褐而不是纯黑,陡峭的雪山不至于糊成黑斑
      sd[o] = v; sd[o + 1] = v * 0.94; sd[o + 2] = v * 0.86;
      sd[o + 3] = Math.min(105, Math.abs(d) * (d > 0 ? 280 : 300));
    }
    if (j % 24 === 23) yield;
  }
  b.sg.putImageData(b.shadeImg, 0, 0);
  yield;
  // 4) 合成:采样点画在像素中心(双线性放大 → 柔和过渡而不是马赛克)
  const g = b.g;
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(b.col, 0, 0, n, n, -cs * k / 2, -cs * k / 2, n * cs * k, n * cs * k);
  yield;
  g.drawImage(b.shade, 0, 0, m, m, -hs * k / 2, -hs * k / 2, m * hs * k, m * hs * k);
  yield;
  const u = k / K0;
  paperGrain(g, x0, z0, x0 + 2 * R, z0 + 2 * R, k, u);
  yield;
  biomeEdges(g, x0, z0, x0 + 2 * R, z0 + 2 * R, 24, k, u, 'rgba(40,26,12,0.28)');
  yield;
  // 5) 高山画成羊皮纸地图的山峰符号:亮面留白、背光面描褐,山越高符号越大(错行排开,不成棋盘)
  const x1 = x0 + 2 * R, z1 = z0 + 2 * R;
  for (let j = Math.floor((z0 - 8) / 30); j * 30 + 8 <= z1; j++) {
    const wz = j * 30 + 8, jj = Math.round((wz - z0) / hs);
    if (jj < 0 || jj >= m) continue;
    for (let i = Math.floor((x0 - 25) / 34); i * 34 <= x1; i++) {
      const wx = i * 34 + (j & 1) * 17 + 8, ii = Math.round((wx - x0) / hs);
      if (ii < 0 || ii >= m) continue;
      const h = H[(jj + 1) * W + ii + 1];
      if (!(h > 24)) continue;
      const px = (wx - x0) * k, pz = (wz - z0) * k, sz = Math.min(15, 5 + (h - 24) * 0.16) * u;
      g.beginPath(); g.moveTo(px - sz, pz + sz * 0.55); g.lineTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55); g.closePath();
      g.fillStyle = 'rgba(238,232,218,0.9)'; g.fill();
      g.beginPath(); g.moveTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55); g.lineTo(px + sz * 0.15, pz + sz * 0.55); g.closePath();
      g.fillStyle = 'rgba(110,92,72,0.75)'; g.fill();
      g.beginPath(); g.moveTo(px - sz, pz + sz * 0.55); g.lineTo(px, pz - sz * 0.75); g.lineTo(px + sz, pz + sz * 0.55);
      g.strokeStyle = 'rgba(60,44,30,0.85)'; g.lineWidth = 1.2 * u; g.stroke();
    }
    yield;
  }
  b.ready = true;
}
// 羊皮纸颗粒:一点点纸纹,地图像画出来的(每 20m 一格一个点,位置按格子哈希,钉在世界坐标上)
function paperGrain(g, x0, z0, x1, z1, k, u) {
  const sz = 2 * u;
  g.globalAlpha = 0.06;
  for (let pass = 0; pass < 2; pass++) {
    g.beginPath();
    for (let iz = Math.floor(z0 / 20); iz * 20 < z1; iz++) {
      for (let ix = Math.floor(x0 / 20); ix * 20 < x1; ix++) {
        let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
        h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
        h ^= h >>> 13;
        if (((h >>> 20) & 1) !== pass) continue;
        g.rect((ix * 20 + (h & 1023) * (20 / 1024) - x0) * k, (iz * 20 + ((h >>> 10) & 1023) * (20 / 1024) - z0) * k, sz, sz);
      }
    }
    g.fillStyle = pass ? '#000' : '#fff';
    g.fill();
  }
  g.globalAlpha = 1;
}
// 群系边界:相邻两格主群系不同就沿公共边描一道细线(按 cell 米的世界格缓存主群系)
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
function biomeEdges(g, x0, z0, x1, z1, cell, k, u, color) {
  g.strokeStyle = color;
  g.lineWidth = u;
  g.beginPath();
  for (let x = Math.floor(x0 / cell) * cell; x < x1; x += cell) {
    for (let z = Math.floor(z0 / cell) * cell; z < z1; z += cell) {
      const b = biomeAt(x, z, cell);
      if (biomeAt(x + cell, z, cell) !== b) { g.moveTo((x + cell - x0) * k, (z - z0) * k); g.lineTo((x + cell - x0) * k, (z + cell - z0) * k); }
      if (biomeAt(x, z + cell, cell) !== b) { g.moveTo((x - x0) * k, (z + cell - z0) * k); g.lineTo((x + cell - x0) * k, (z + cell - z0) * k); }
    }
  }
  g.stroke();
}

// ---- 小地图底图:最多 3 张(在用 / 预取 / 刚换下来),画布与缓冲复用;一次只做一张 ----
const MINI_R = 270, MINI_P = 450, MINI_HS = 5, MINI_G = 120; // 450px / 540m = 小地图的 200px / 240m
const miniBases = [];
let job = null; // { base, it }
let useTick = 0;
function miniReady(cx, cz) {
  for (const b of miniBases) if (b.ready && b.cx === cx && b.cz === cz) return b;
  return null;
}
// 已做好、且盖得住以 (px,pz) 为中心的视野的底图(换格时新底图还没好就先用它)
function miniCovering(px, pz, half) {
  let best = null;
  for (const b of miniBases) {
    if (!b.ready || Math.abs(px - b.cx) + half > b.R || Math.abs(pz - b.cz) + half > b.R) continue;
    if (!best || b.used > best.used) best = b;
  }
  return best;
}
function startMiniJob(cx, cz, keep) {
  if (job && job.base.cx === cx && job.base.cz === cz) return;
  let slot = null;
  if (miniBases.length < 3) { slot = makeBase(MINI_R, MINI_P, MINI_HS); miniBases.push(slot); }
  else for (const b of miniBases) if (b !== keep && (!slot || b.used < slot.used)) slot = b; // 最久没用的那张
  slot.used = ++useTick;
  slot.ready = false;
  job = { base: slot, it: paintBase(slot, cx, cz) };
}
function runJob(budgetMs) {
  const t0 = performance.now();
  while (job && performance.now() - t0 < budgetMs) {
    if (job.it.next().done) job = null;
  }
}

// ================= 大地图(M) =================
// 王国 ±520m 全图:群系底色 + 道路建筑 + 地名 + 你/任务目标/管家;打开时世界暂停
const bigmapEl = document.getElementById('bigmap');
const bigmapCv = document.getElementById('bigmap-c');
export const mapState = { open: false };
let bigBase = null, bigTerr = null;
const BIG_R = 520;
// 大地图的地形底图(一张画布复用):王国那张合成进 bigBase 后,这张画布再给荒野图用
function bigTerrain(cx, cz) {
  if (!bigTerr) bigTerr = makeBase(BIG_R, 720, 10);
  const it = paintBase(bigTerr, cx, cz);
  while (!it.next().done);
  return bigTerr.canvas;
}
// 王国全图 = 地形底图 + 道路建筑 + 大地名;分步合成(每个 yield 都可以停下来等下一帧)
function* composeBigBase(terr, c) {
  c.width = c.height = 720;
  const g = c.getContext('2d');
  const k = 720 / (BIG_R * 2);
  g.drawImage(terr, 0, 0);
  const feats = world.features;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i];
    if (i % 64 === 63) yield;
    setBig(0, 0, k);
    if (f.type === 'road') {
      const p = toBig(f.x, f.z);
      g.save(); g.translate(p[0], p[1]); g.rotate(-f.rot);
      g.fillStyle = 'rgba(214,196,150,0.9)';
      g.fillRect((-f.w / 2) * k - 0.5, (-f.h / 2) * k, f.w * k + 1, f.h * k);
      g.restore();
      continue;
    }
    if (f.type === 'tree' || f.type === 'dome' || ZONE_FEATS.has(f.type)) continue;
    g.fillStyle = MM_COLS[f.type] || '#888';
    if (drawShaped(g, f, toBig, k)) continue;
    const p = toBig(f.x, f.z);
    g.fillRect(p[0] - (f.w * k) / 2, p[1] - (f.h * k) / 2, Math.max(1.5, f.w * k), Math.max(1.5, f.h * k));
  }
  for (const r of REGIONS) {
    if (r.r < 18) continue; // 小地名留给小地图
    yield;
    const mx = (r.x + BIG_R) * k, mz = (r.z + BIG_R) * k;
    // 全图画布 720px,小窗口下只显示一半大小:地名按 19/22px 画,960×540 下看到的仍有 10~12px,描边加粗
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 4.5;
    g.strokeStyle = 'rgba(20,14,8,0.85)';
    g.strokeText(r.name, mx, mz);
    g.fillStyle = '#f3e7cc';
    g.fillText(r.name, mx, mz);
  }
}
// 荒野图:玩家在王国之外时,以玩家所在 256m 格为中心画 ±520m(地形底图 + 群系地名 + 已探到的营地/遗迹)
let wildBase = null, wildKey = '';
function buildWildBase(cx, cz) {
  const c = wildBase || document.createElement('canvas');
  c.width = c.height = 720;
  const g = c.getContext('2d');
  const k = 720 / (BIG_R * 2);
  g.drawImage(bigTerrain(cx, cz), 0, 0);
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center';
  for (let x = -BIG_R + 130; x < BIG_R; x += 260) { // 群系地名
    for (let z = -BIG_R + 130; z < BIG_R; z += 260) {
      const name = wildRegionName(cx + x, cz + z);
      const mx = (x + BIG_R) * k, mz = (z + BIG_R) * k;
      g.lineWidth = 5; g.strokeStyle = 'rgba(20,14,8,0.8)'; g.strokeText(name, mx, mz);
      g.fillStyle = '#efe2c4'; g.fillText(name, mx, mz);
    }
  }
  return c;
}
// 大地图的坐标换算(toBig 不夹边,atBig 夹在图内):结果写进复用的 _xy
let _box = 0, _boz = 0, _bk = 1;
const _xy = [0, 0];
function setBig(ox, oz, k) { _box = ox; _boz = oz; _bk = k; }
function toBig(x, z) { _xy[0] = (x - _box + BIG_R) * _bk; _xy[1] = (z - _boz + BIG_R) * _bk; return _xy; }
function atBig(x, z) {
  _xy[0] = (Math.max(-BIG_R, Math.min(BIG_R, x - _box)) + BIG_R) * _bk;
  _xy[1] = (Math.max(-BIG_R, Math.min(BIG_R, z - _boz)) + BIG_R) * _bk;
  return _xy;
}
function drawBigMap() {
  const V = ctx.mapView();
  const g = bigmapCv.getContext('2d');
  const k = 720 / (BIG_R * 2);
  const wild = Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > BIG_R;
  const ox = wild ? Math.round(player.pos.x / 256) * 256 : 0, oz = wild ? Math.round(player.pos.z / 256) * 256 : 0;
  if (wild) {
    const key = ox + ',' + oz;
    if (key !== wildKey) { wildBase = buildWildBase(ox, oz); wildKey = key; }
    g.drawImage(wildBase, 0, 0);
  } else {
    if (!bigBase) {
      const c = document.createElement('canvas'), it = composeBigBase(bigTerrain(0, 0), c);
      while (!it.next().done);
      bigBase = c;
    }
    g.drawImage(bigBase, 0, 0);
  }
  const titleEl = bigmapEl.querySelector('.bm-title');
  if (titleEl && titleEl.firstChild) titleEl.firstChild.textContent = wild ? '荒野图(以你所在一带为中心) ' : '王国全图 ';
  setBig(ox, oz, k);
  drawMarks(g, V, toBig, 1.3);
  for (const gd of V.guards) {
    if (gd.downT > 0) continue;
    const p = atBig(gd.pos.x, gd.pos.z);
    g.fillStyle = '#5588dd'; g.beginPath(); g.arc(p[0], p[1], 2.5, 0, 6.28); g.fill();
  }
  for (const b of V.bandits) {
    if (b.dead) continue;
    const p = atBig(b.pos.x, b.pos.z);
    g.fillStyle = '#e03030'; g.beginPath(); g.arc(p[0], p[1], b.warlord ? 4 : 2.5, 0, 6.28); g.fill();
  }
  if (V.questGiver) { // 埃隆所在(白天广场、夜里城堡):金底圆章 + 黑色"!",大地图上一眼找得到
    const p = atBig(V.questGiver.x, V.questGiver.z);
    questMark(g, p[0], p[1], 11);
  }
  if (V.beacon.visible) {
    const bx = V.beaconRouted ? V.beaconRouted.x : V.beacon.position.x, bz = V.beaconRouted ? V.beaconRouted.z : V.beacon.position.z;
    const p = atBig(bx, bz), x = p[0], z = p[1];
    const pulse = 5 + Math.sin(performance.now() * 0.008) * 2;
    g.strokeStyle = '#ffd75e'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, z, pulse + 4, 0, 6.28); g.stroke();
    g.fillStyle = '#ffd75e'; g.beginPath(); g.arc(x, z, 4, 0, 6.28); g.fill();
  }
  const p = atBig(player.pos.x, player.pos.z);
  g.save();
  g.translate(p[0], p[1]);
  g.rotate(-player.yaw + Math.PI);
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
// 委托人标记:金色圆章 + 深色描边 + 黑色叹号
const _qFont = {};
function questMark(g, x, z, r) {
  g.save();
  g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2);
  g.fillStyle = '#ffd83d'; g.fill();
  g.lineWidth = Math.max(1.5, r * 0.22); g.strokeStyle = 'rgba(40,24,6,0.9)'; g.stroke();
  g.fillStyle = '#2a1a06'; g.font = _qFont[r] || (_qFont[r] = `bold ${Math.round(r * 1.5)}px sans-serif`);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('!', x, z + r * 0.06);
  g.restore();
}
export const MM_COLS = {
  wall: '#9d9486', tower: '#8d8476', keep: '#7d7466', house: '#a3703f',
  tree: '#295c33', water: '#4f7f96', field: '#9a7444', plaza: '#cdb891',
  stall: '#c05a3a', windmill: '#e8dcc0', tent: '#5d4a33',
  sand: '#d9c48f', snow: '#e8edf2', swamp: '#44523a', ash: '#57524c',
  bone: '#e8e4da', dome: '#3f7a45', cactus: '#3f8a4f',
};
// 有真实轮廓(湖/塘/冰湖)的画多边形,带朝向的(河段)画旋转矩形;返回是否已画
// toXY(x,z) 返回复用的 [x,y] 数组:读完再调下一次
function drawShaped(g, f, toXY, k) {
  if (f.poly) {
    g.beginPath();
    for (let i = 0; i < f.poly.length; i++) {
      const p = toXY(f.poly[i][0], f.poly[i][1]);
      if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
    }
    g.closePath();
    g.fill();
    return true;
  }
  if (f.type === 'water' && f.rot) {
    const p = toXY(f.x, f.z);
    g.save(); g.translate(p[0], p[1]); g.rotate(-f.rot);
    g.fillRect((-f.w / 2) * k, (-f.h / 2) * k, Math.max(1.5, f.w * k), f.h * k + 0.6);
    g.restore();
    return true;
  }
  return false;
}
const S = 200, RANGE = 240, MK = S / RANGE;
let _mpx = 0, _mpz = 0;
function toMap(x, z) { _xy[0] = S / 2 + (x - _mpx) * MK; _xy[1] = S / 2 + (z - _mpz) * MK; return _xy; }
// 预取:按最近几次绘制之间的位移估计行进方向,往前看约 4 秒(最多 120m)
let _lastX = NaN, _lastZ = NaN, _vx = 0, _vz = 0;
export function drawMinimap() {
  const V = ctx.mapView();
  const k = MK;
  const px = player.pos.x, pz = player.pos.z;
  _mpx = px; _mpz = pz;
  // ---- 底图:当前格的做好了就用;没好就先用还盖得住视野的旧底图,同时把当前格排进生成 ----
  {
    const dx = px - _lastX, dz = pz - _lastZ;
    if (Math.abs(dx) + Math.abs(dz) < 30) { _vx = _vx * 0.9 + dx * 0.1; _vz = _vz * 0.9 + dz * 0.1; } else { _vx = 0; _vz = 0; } // 传送:不算速度
    _lastX = px; _lastZ = pz;
    const cx = Math.round(px / MINI_G) * MINI_G, cz = Math.round(pz / MINI_G) * MINI_G;
    let base = miniReady(cx, cz);
    if (!base) {
      base = miniCovering(px, pz, RANGE / 2);
      if (!job || job.base.cx !== cx || job.base.cz !== cz) startMiniJob(cx, cz, base);
    } else {
      // 预取行进方向前方那一格(30Hz 绘制,每次位移 × 120 ≈ 4 秒路程,封顶 120m)
      const look = Math.min(120, Math.hypot(_vx, _vz) * 120), vl = Math.hypot(_vx, _vz) || 1;
      const ax = px + (_vx / vl) * look, az = pz + (_vz / vl) * look;
      const nx = Math.round(ax / MINI_G) * MINI_G, nz = Math.round(az / MINI_G) * MINI_G;
      if (!job && (nx !== cx || nz !== cz) && !miniReady(nx, nz)) startMiniJob(nx, nz, base);
    }
    if (base) base.used = ++useTick;
    runJob(base ? 2 : 3);
    mm.fillStyle = '#6b7a52';
    mm.fillRect(0, 0, S, S);
    if (base) {
      mm.imageSmoothingEnabled = true;
      const bk = base.k;
      mm.drawImage(base.canvas, (px - RANGE / 2 - base.cx + base.R) * bk, (pz - RANGE / 2 - base.cz + base.R) * bk, RANGE * bk, RANGE * bk, 0, 0, S, S);
    }
  }
  mm.save();
  mm.beginPath();
  mm.rect(0, 0, S, S);
  mm.clip();
  const feats = world.features;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i];
    const p = toMap(f.x, f.z), mx = p[0], mz = p[1];
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
  mm.fillStyle = '#c49a5a';
  for (let i = 0; i < V.horses.length; i++) {
    const h = V.horses[i];
    const p = toMap(h.pos.x, h.pos.z);
    mm.fillRect(p[0] - 2, p[1] - 2, 4, 4);
  }
  // 卫兵
  mm.fillStyle = V.wanted > 0 ? '#ff3b30' : '#5588dd';
  for (let i = 0; i < V.guards.length; i++) {
    const g = V.guards[i];
    if (g.downT > 0) continue;
    const p = toMap(g.pos.x, g.pos.z);
    mm.beginPath();
    mm.arc(p[0], p[1], 2.5, 0, 6.28);
    mm.fill();
  }
  // 盗贼(战团成员标红,枭首加大加边;不在图内时沿边画来袭方向箭头)
  let wbOffMap = null;
  for (let i = 0; i < V.bandits.length; i++) {
    const b = V.bandits[i];
    if (b.dead) continue;
    const p = toMap(b.pos.x, b.pos.z), mx = p[0], mz = p[1];
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
    const p = toMap(V.questGiver.x, V.questGiver.z);
    questMark(mm, p[0], p[1], 7);
  }
  if (V.beacon.visible) {
    const bdx = V.beacon.position.x - px, bdz = V.beacon.position.z - pz;
    if (Math.hypot(bdx, bdz) > RANGE / 2 - 14) {
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
      const p = toMap(V.beacon.position.x, V.beacon.position.z);
      mm.fillStyle = '#ffd83d';
      mm.beginPath();
      mm.arc(p[0], p[1], 5, 0, 6.28);
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

// 地物标记:荒野区块里的营地/匪窝/断塔/遗迹/巨岩 + 篝火/温泉/小教堂(小地图与大地图共用)
const _marks = [];
function drawMark(g, kind, x, y, s) {
  if (x < -8 || y < -8 || x > g.canvas.width + 8 || y > g.canvas.height + 8) return;
  g.lineWidth = 1.2 * s;
  g.strokeStyle = 'rgba(20,12,6,0.9)';
  if (kind === 'camp' || kind === 'bandit') { // 帐篷:三角
    g.fillStyle = kind === 'bandit' ? '#c8382c' : '#d39a4a';
    g.beginPath(); g.moveTo(x, y - 5 * s); g.lineTo(x + 4.5 * s, y + 3.5 * s); g.lineTo(x - 4.5 * s, y + 3.5 * s); g.closePath();
    g.fill(); g.stroke();
  } else if (kind === 'tower') {
    g.fillStyle = '#b8b0a2';
    g.fillRect(x - 3 * s, y - 4.5 * s, 6 * s, 9 * s); g.strokeRect(x - 3 * s, y - 4.5 * s, 6 * s, 9 * s);
  } else if (kind === 'ruin' || kind === 'chapel') { // 遗迹/小教堂:十字
    g.strokeStyle = '#efe6d2'; g.lineWidth = 2 * s;
    g.beginPath(); g.moveTo(x, y - 4.5 * s); g.lineTo(x, y + 4.5 * s); g.moveTo(x - 3 * s, y - 1.5 * s); g.lineTo(x + 3 * s, y - 1.5 * s); g.stroke();
  } else if (kind === 'spring') {
    g.fillStyle = '#6ab8d8'; g.beginPath(); g.arc(x, y, 3.5 * s, 0, 6.28); g.fill(); g.stroke();
  } else if (kind === 'campfire') {
    g.fillStyle = '#ff9a3a'; g.beginPath(); g.arc(x, y, 2.8 * s, 0, 6.28); g.fill(); g.stroke();
  } else if (kind === 'rock') {
    g.fillStyle = 'rgba(60,56,50,0.75)'; g.beginPath(); g.arc(x, y, 2.4 * s, 0, 6.28); g.fill();
  }
}
function drawMarks(g, V, toXY, s) {
  wildMarks(_marks);
  for (let i = 0; i < _marks.length; i++) {
    const m = _marks[i], p = toXY(m.x, m.z);
    drawMark(g, m.kind, p[0], p[1], s);
  }
  const spots = V.wildSpots;
  if (spots) {
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i], p = toXY(sp.x, sp.z);
      drawMark(g, sp.type, p[0], p[1], s);
    }
  }
  bridgeMark(g, ...toXY(NAV_BRIDGE.x, NAV_BRIDGE.z), s);
}
// 木桥:银月河上唯一能过人的地方(光柱过河也走这里)——拱桥小图标:深色描边的木色拱 + 两根桥柱
function bridgeMark(g, x, y, s) {
  if (x < -12 || y < -12 || x > g.canvas.width + 12 || y > g.canvas.height + 12) return;
  g.save();
  g.lineCap = 'round';
  const arch = () => { g.beginPath(); g.moveTo(x - 7 * s, y + 2 * s); g.quadraticCurveTo(x, y - 5 * s, x + 7 * s, y + 2 * s); };
  g.strokeStyle = 'rgba(30,18,8,0.95)'; g.lineWidth = 4.6 * s; arch(); g.stroke();
  g.strokeStyle = '#d9a35f'; g.lineWidth = 2.4 * s; arch(); g.stroke();
  g.strokeStyle = 'rgba(30,18,8,0.9)'; g.lineWidth = 1.4 * s;
  g.beginPath(); g.moveTo(x - 4 * s, y - 0.6 * s); g.lineTo(x - 4 * s, y + 3.6 * s);
  g.moveTo(x + 4 * s, y - 0.6 * s); g.lineTo(x + 4 * s, y + 3.6 * s); g.stroke();
  g.restore();
}
