// 画质:三档 QUALITY(流畅/均衡/精致:视距上限、阴影框与频率、实体投影/隐藏/隔帧距离、小件与树林剔除、荒野装载、草密度)、
// setQuality(idx, manual)、自动画质 autoQuality(frameDt)(4 秒窗口 p90 帧时升降档 + 动态分辨率,带迟滞;主循环在模拟后、渲染前调用)、
// 实体远近分级 updateEntityLOD()(每 12 帧按画质档的距离给实体/小件/树林分级)、画风切换 nextStyle()。
// initQuality() 启动装配时读回上次的档位。
import { updatePropLOD } from '../batch.js';
import { started } from '../core/state.js';
import { updateNatureLOD } from '../flora.js';
import { bandits, guards, horses, villagers, wolves } from '../systems/actors.js';
import { chickens, deers } from '../systems/fauna.js';
import { mercs } from '../systems/mercs.js';
import { funnyNPCs, namedNPCs } from '../systems/npcs.js';
import { sun } from '../systems/sky.js';
import { mapState } from '../ui/maps.js';
import { paused } from '../ui/pause.js';
import { toast } from '../ui/toast.js';
import { setVegetationDensity } from '../vegetation.js';
import { setWildViewDistance } from '../wilderness.js';
import {
  LOWFX, STYLE_PRESETS, bloom, camera, composer, cycleStyle, gradePass, gtao, renderer, scene, smaa,
  styleKey, stylePass,
} from './core.js';
import { updateSkinLOD } from './skin.js';

// ================= 画质档位与自动画质 =================
let fxHigh = !LOWFX;
// 画质三档:流畅(集显/老机器)、均衡(默认)、精致(独显:环境光遮蔽 + 高分辨率)
// 流畅档省的不只是 GPU:视距上限(雾收近、远裁剪面随之收)、实体更早停投影/更早隐藏、小件地标更早剔除
// 且不投影、阴影框收窄并隔帧更新、荒野只装 3×3 块、草更稀——CPU 每帧要遍历/提交的东西一起变少。
// lodNear/lodHide:实体投影/整体隐藏的距离(米);halfD:实体隔帧更新的距离;propFar:小件(灌木/树桩/木箱、碑、牌…)
// 的可见距离;bigFar:树林/岩石实例块的可见距离;viewCap:视距上限(米);shadowBox:阴影正交框半宽;
// shadowEvery:阴影图每几帧更新一次;wildD:荒野区块加载距离(米)
export const QUALITY = [
  { key: 'lo', name: '流畅', gtao: false, bloom: false, smaa: false, pr: 0.8, veg: 0.3, shadow: 1024, shadowBox: 30,
    shadowEvery: 2, lodNear: 14, lodHide: 56, halfD: 14, propFar: 40, bigFar: 140, propShadow: false, viewCap: 250, wildD: 160 },
  { key: 'mid', name: '均衡', gtao: false, bloom: true, smaa: true, pr: 1, veg: 0.65, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 40, lodHide: 160, halfD: 30, propFar: 150, bigFar: Infinity, propShadow: true, viewCap: 1600, wildD: 256 },
  { key: 'hi', name: '精致', gtao: true, bloom: true, smaa: true, pr: 1.5, veg: 1, shadow: 2048, shadowBox: 70,
    shadowEvery: 1, lodNear: 50, lodHide: 220, halfD: 40, propFar: 220, bigFar: Infinity, propShadow: true, viewCap: 1600, wildD: 256 },
];
export let qualityIdx = LOWFX ? 0 : 1;
let qualityManual = false;
let dynRes = 1; // 最低档仍然卡时的动态分辨率(0.6~1)
let shadowTick = 0;
export function setQuality(idx, manual = false) {
  qualityIdx = Math.max(0, Math.min(QUALITY.length - 1, idx));
  if (manual) qualityManual = true;
  const q = QUALITY[qualityIdx];
  fxHigh = q.smaa;
  setVegetationDensity(q.veg);
  setWildViewDistance(q.wildD);
  gtao.enabled = q.gtao;
  bloom.enabled = q.bloom;
  smaa.enabled = q.smaa && STYLE_PRESETS[styleKey].mode !== 4; // 像素风不要抗锯齿糊掉方块
  gradePass.enabled = true; // 调色很便宜,三档都保留画风
  const pr = Math.min(window.devicePixelRatio || 1, q.pr) * dynRes;
  if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) {
    renderer.setPixelRatio(pr);
    composer.setPixelRatio(pr);
    stylePass.uniforms.uRes.value.set(window.innerWidth * pr, window.innerHeight * pr);
  }
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const sc = sun.shadow.camera; // 框收窄后纹素密度不降(30m/1024 比 70m/2048 还密);sky.js 的纹素对齐按框宽自适应
  if (sc.right !== q.shadowBox) {
    sc.left = sc.bottom = -q.shadowBox;
    sc.right = sc.top = q.shadowBox;
    sc.updateProjectionMatrix();
  }
  sun.shadow.autoUpdate = q.shadowEvery <= 1;
  sun.shadow.needsUpdate = true;
  document.getElementById('btn-quality').textContent = `画质:${q.name}`;
  try {
    // 只有手选的档永久记住;自动档只当下次开局的起点,记 24 小时
    if (qualityManual) localStorage.setItem('gth-fx', q.key + '!');
    else localStorage.setItem('gth-fx-auto', JSON.stringify({ i: qualityIdx, r: dynRes, t: Date.now() }));
  } catch { /* 忽略 */ }
}
// ---- 自动画质 ----
// 每个观察窗(≥4 秒且 ≥12 帧,或满 10 秒)取帧间隔的 p90。超长帧也算(单帧按 1 秒封顶),
// 跑不动的机器(每帧几百毫秒)照样能降下来;切后台回来的那一帧、暂停与看地图期间不计。
//  - p90 > 36ms(慢于 ~28fps 的帧超过一成):降一档;已是最低档就降渲染分辨率(1 → 0.85 → 0.7 → 0.6)
//  - p90 < 21ms:先把分辨率一级级升回去(每个好窗口一级),再连续 upNeed 个好窗口升一档(自动最多升到默认档"均衡";精致只能手选)
//  - 迟滞:刚升档的 15 秒内门槛收紧到 26ms(升上去掉到 30fps 就退回),退回一次 upNeed 翻倍(2 → 4 → … → 16)
const AUTO_TOP = LOWFX ? 0 : 1;
const PW_CAP = 900;
const pwBuf = new Float32Array(PW_CAP);
const perfWin = { n: 0, t: 0, cool: 6, good: 0, upNeed: 2, upAt: -1e9, clock: 0 };
// 切换画风(K 键与暂停菜单共用):像素风关掉抗锯齿,免得糊掉方块;菜单按钮上的名字跟着换
export function nextStyle() {
  const nm = cycleStyle();
  smaa.enabled = fxHigh && STYLE_PRESETS[styleKey].mode !== 4;
  document.getElementById('btn-style').textContent = `画风:${nm}`;
  return nm;
}
function autoNote() { toast(`⚙️ 画质已自动调为「${QUALITY[qualityIdx].name}」(暂停菜单可手动改)`, 3); }
export function autoQuality(frameDt) {
  const q = QUALITY[qualityIdx];
  // 每帧都要落实的档位细节(主循环在模拟之后、渲染之前调用):视距上限、阴影隔帧更新
  if (scene.fog && scene.fog.far > q.viewCap - 30) { // 雾每帧由天色重设;这里只往近收,幂等
    scene.fog.far = q.viewCap - 30;
    scene.fog.near = Math.min(scene.fog.near, scene.fog.far * 0.45);
  }
  if (q.shadowEvery > 1) sun.shadow.needsUpdate = ++shadowTick % q.shadowEvery === 0;
  // 自动升降档
  if (qualityManual || !started || paused || mapState.open || document.hidden) return;
  if (frameDt > 2) { perfWin.n = 0; perfWin.t = 0; return; } // 切后台回来:这一帧不算,窗口重开
  perfWin.clock += frameDt;
  if (perfWin.cool > 0) { perfWin.cool -= frameDt; return; }
  if (perfWin.n < PW_CAP) pwBuf[perfWin.n++] = Math.min(1, frameDt);
  perfWin.t += frameDt;
  if (!((perfWin.t >= 4 && perfWin.n >= 12) || perfWin.t >= 10)) return;
  const n = perfWin.n;
  const p90 = pwBuf.subarray(0, n).sort()[Math.min(n - 1, Math.floor(n * 0.9))];
  perfWin.n = 0;
  perfWin.t = 0;
  const justUp = perfWin.clock - perfWin.upAt < 15;
  if (p90 > (justUp ? 0.026 : 0.036)) {
    perfWin.good = 0;
    if (justUp) perfWin.upNeed = Math.min(16, perfWin.upNeed * 2);
    perfWin.upAt = -1e9;
    if (qualityIdx > 0) { setQuality(qualityIdx - 1); autoNote(); }
    else if (dynRes > 0.6) { dynRes = Math.max(0.6, +(dynRes - 0.15).toFixed(2)); setQuality(0); }
    else return;
    perfWin.cool = 3;
  } else if (p90 < 0.021) {
    perfWin.good++;
    // 分辨率一个好窗口就往回升一级(升错了代价小);升档要连续 upNeed 个好窗口
    const tierUp = dynRes >= 1 && qualityIdx < AUTO_TOP && perfWin.good >= perfWin.upNeed;
    if (dynRes < 1) dynRes = Math.min(1, +(dynRes + 0.15).toFixed(2));
    else if (!tierUp) return;
    perfWin.good = 0;
    setQuality(qualityIdx + (tierUp ? 1 : 0));
    if (tierUp) autoNote();
    perfWin.upAt = perfWin.clock;
    perfWin.cool = 3;
  } else perfWin.good = 0;
}

// ================= 实体远近分级(LOD) =================
// 合并成蒙皮网格的实体(gfx/skin.js,覆盖所有人形/动物,含任务 NPC、导演事件路人):
// lodNear 内投影,之外不投影,lodHide 外整个不画(距离随画质档)。每 12 帧扫一遍,级别变了才改。
// 没能合并的实体(兜底)仍走旧规则:近处投影、远处收起眼珠/腰带等细件。
let lodScan = 0;
const _lodSeen = new Set();
function applyEntityLOD(e, lv) {
  e._lod = lv;
  e.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.cast0 === undefined) o.userData.cast0 = o.castShadow;
    o.castShadow = lv === 0 && o.userData.cast0;
    if (o.userData.lodDetail) o.visible = lv === 0;
  });
}
export function updateEntityLOD() {
  if (lodScan-- > 0) return;
  lodScan = 12;
  const q = QUALITY[qualityIdx];
  const cx = camera.position.x, cz = camera.position.z;
  updateSkinLOD(cx, cz, q.lodNear, q.lodHide, q.halfD);
  updateNatureLOD(cx, cz, q.propFar, q.propShadow, q.bigFar);
  updatePropLOD(cx, cz, q.propFar);
  _lodSeen.clear();
  const lists = [villagers, guards, bandits, wolves, horses, namedNPCs, chickens, deers, funnyNPCs, mercs];
  for (const list of lists) {
    for (const e of list) {
      if (!e || !e.group || e.group._skin || _lodSeen.has(e)) continue;
      _lodSeen.add(e);
      const d = Math.hypot(e.group.position.x - cx, e.group.position.z - cz);
      const lv = d < q.lodNear ? 0 : d < q.lodNear + 6 && e._lod === 0 ? 0 : 1; // 6m 回差,免得边界上来回切
      if (e._lod !== lv) applyEntityLOD(e, lv);
    }
  }
}
// 读回上次的画质:手选的档永久记住(gth-fx 带 !);自动档只记 24 小时(gth-fx-auto)。启动装配原位调用
export function initQuality() {
  try {
    const sv = localStorage.getItem('gth-fx') || '';
    const k = QUALITY.findIndex((q) => sv.startsWith(q.key));
    if (k >= 0 && sv.endsWith('!')) { qualityManual = true; setQuality(k); }
    else {
      if (sv) localStorage.removeItem('gth-fx'); // 旧版把自动降的档也永久写在这里:作废,交给自动档重新判断
      const a = JSON.parse(localStorage.getItem('gth-fx-auto') || 'null');
      if (a && Date.now() - a.t < 864e5 && a.i >= 0 && a.i <= qualityIdx) {
        dynRes = Math.max(0.6, Math.min(1, +a.r || 1));
        setQuality(a.i);
      } else setQuality(qualityIdx);
    }
  } catch { setQuality(qualityIdx); }
}
