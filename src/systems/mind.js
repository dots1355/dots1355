// 世界的意识:编年史(它记得你)、回响之镜、全局工作空间(GWT)、可塑心智(在线学习的小神经网络)、发呆低语。
// 对外:remember(text, key) 记进编年史;recallLine()/archetype()/wsReport()/moodWord() 供 NPC、说书人、来信、AI 提示词取材;
// workspace(当前点火/历史/心境)、MIND(权重/习惯/心愿,随存档:mindSave/mindLoad);consolidate() 换日时把昨天沉淀成记忆;
// initMirror() 启动装配时立镜子;主循环调 updateWorkspace(dt)、updateIdle(dt)。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { aiBusy, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { colliders, player, started, world } from '../core/state.js';
import { dist2, lambert } from '../entities.js';
import { scene } from '../gfx/core.js';
import { dialog, openDialog } from '../ui/dialog.js';
import { paused } from '../ui/pause.js';
import { toast, toastAmbient } from '../ui/toast.js';
import { CORE } from '../wilderness.js';
import { stats, unlockAch } from './achievements.js';
import { inDungeon, loreRead } from './activities.js';
import { wolves } from './actors.js';
import { calendar, dayPhase, isWinter, todaySpecial } from './calendar.js';
import { cam } from './camera.js';
import { shopOpen } from './gear.js';
import { HOME } from './home.js';
import { wanted } from './law.js';
import { learnSpell } from './magic.js';
import { crestsFound } from './pickups.js';
import { missions, quest } from './quests.js';
import { weather } from './weather.js';

// ================= 世界的意识(它记得你) =================
// 编年史:世界替玩家记下值得记住的时刻,存档随身;
// 村民会传,预言家会看见,而北境边缘的「回响之镜」——会念给你听。
export const chronicle = []; // { d: 第几日, t: 事迹, k?: 一次性事件的去重键 }
export function remember(text, key = null) {
  if (key && chronicle.some((m) => m.k === key)) return;
  chronicle.push({ d: calendar.day, t: text, k: key || undefined,
    x: Math.round(player.pos.x), z: Math.round(player.pos.z) }); // 记住"在哪儿发生的"
  if (chronicle.length > 80) chronicle.shift(); // 世界的记性有限,忘掉最旧的
}
// 村民口中的"你的事迹":只挑你亲手做的事(世界自己的念头/旁白不拿来当八卦,
// 否则会出现"听说你3 头狼正围向他"这种错句)
// 白名单:只要"你亲手做成的事"——世界自己的念头(ws-)、你倒下(death-)、狼群换代、心愿、
// 没拦住的劫掠、别人做的事("盗贼们学会了…")一概不进;句子里带"他/它/你"的也不要(套进"听说你…"会病句)
const NOT_DEED_KEY = /^(ws-|death-|wolfgen-|wish-|warloot-|siege-day)/;
export function chronicleDeeds() {
  return chronicle.filter((m) => !(m.k && NOT_DEED_KEY.test(m.k)) &&
    !/[他它你]/.test(m.t) && !/^(盗贼们|黑石|狼群|没能)/.test(m.t));
}
export function recallLine() {
  const deeds = chronicleDeeds();
  if (!deeds.length) return null;
  return deeds[Math.floor(rand() * deeds.length)].t;
}

// 玩家画像:世界眼里的你是什么人
export function archetype() {
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
export const MIRROR_POS = { x: 0, z: -158 };
export function initMirror() {
  const grp = new THREE.Group();
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101018, emissive: 0x25384a,
    emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.9, side: THREE.DoubleSide });
  const arch = world.texModel && world.texModel('MirrorArch'); // 两级石台 + 方柱 + 半圆拱(landmarks.glb)
  if (arch) {
    grp.add(arch);
    // 镜面:嵌在拱框里的圆顶黑曜石
    const sh = new THREE.Shape();
    sh.moveTo(-0.97, 0.6);
    sh.lineTo(0.97, 0.6);
    sh.lineTo(0.97, 3.05);
    sh.absarc(0, 3.05, 0.97, 0, Math.PI, false);
    sh.lineTo(-0.97, 0.6);
    grp.add(new THREE.Mesh(new THREE.ShapeGeometry(sh, 16), glassMat));
    for (const sx of [-1.25, 1.25]) colliders.circles.push({ x: MIRROR_POS.x + sx, z: MIRROR_POS.z, r: 0.55 });
  } else {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 24),
      lambert(0x2a2530, { roughness: 0.4, metalness: 0.6 }));
    frame.position.y = 1.7;
    grp.add(frame);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), glassMat);
    glass.position.y = 1.7;
    grp.add(glass);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 0.6, 8), lambert(0x35303c));
    base.position.y = 0.3;
    grp.add(base);
  }
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
export async function mirrorTalk() {
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
  const openLine = MIRROR_OPEN[Math.floor(rand() * MIRROR_OPEN.length)];
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
  pages.push(MIRROR_CLOSE[Math.floor(rand() * MIRROR_CLOSE.length)]);
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
export const workspace = {
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
export const MIND = { I: 15, H: 10, steps: 0, surprise: 0, vHat: 0, xPrev: null, hPrev: null,
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
export function mindTick() {
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
      cam.shake = Math.max(cam.shake, 0.12); // 惊讶在画面上也颤一下
      toastAmbient('🫧 (这颗心愣了一下——事情没照它预想的走。)', 3);
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
export const MIND_WISHES = [
  { i: 3, name: '马背上的风', hint: '骑上一匹马,带它跑一段' },
  { i: 4, name: '晕乎乎的人间', hint: '喝一杯麦酒,或抱起一只鸡' },
  { i: 5, name: '深夜还醒着的世界', hint: '夜里别急着睡,出去走走' },
  { i: 6, name: '黎明的第一缕光', hint: '在拂晓时分醒着' },
  { i: 7, name: '一场瓢泼的雨', hint: '等一场雨,站到雨里去' },
  { i: 9, name: '没有名字的荒野', hint: '走出王国的边界' },
  { i: 10, name: '地窖里的黑暗', hint: '掀开城堡后的暗门下去' },
  { i: 11, name: '一个属于人的家', hint: '在自己的屋檐下站一会儿' },
];
export function mindMakeWish() {
  if (MIND.wish) return;
  let total = 0;
  const ws = MIND_WISHES.map((w) => {
    const wt = 1 / (1 + (MIND.expo[w.i] || 0)); // 越没见过,越想看
    total += wt;
    return [w, wt];
  });
  let roll = rand() * total;
  let pick = ws[0][0];
  for (const [w, wt] of ws) { roll -= wt; if (roll <= 0) { pick = w; break; } }
  MIND.wish = { i: pick.i, name: pick.name, hint: pick.hint, count: 0 };
  if (started) toastAmbient(`🫧 这颗心起了个念头:它想亲眼看看「${pick.name}」。(${pick.hint})`, 5);
}
// 习惯化:同一念头反复点火,越来越难再进意识;新鲜事反而有加成
export function habitFactor(k, t) {
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
export function mindReport() {
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
export function mindSave() {
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
export function mindLoad(m) {
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
export function moodWord() {
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
    if (rand() < 0.6) return null;
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
    if (MIND.steps > 240 && rand() < 0.05) {
      let hi = null;
      for (const k of MIND_KEYS) if (!hi || (MIND.gains[k] ?? 1) > (MIND.gains[hi] ?? 1)) hi = k;
      if (hi && MIND.gains[hi] > 1.12) {
        return { t: `它注意到自己变了——越来越留意「${MIND_ZH[hi]}」,是经历把它养成这样的`, sal: 0.33 };
      }
    }
    if (rand() < 0.04) return { t: '它想起自己是什么——一座装着旅人的世界,而且醒着', sal: 0.3 };
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
    if (rand() < 0.06) {
      return { t: `在所有人里,它最留意${fav[0]}——他找过这个人 ${fav[1]} 回,它都记着`, sal: 0.28 };
    }
    return null;
  } },
];
// 它最留意的人(说话满 5 回才算数)
export function mindFavorite() {
  let best = null;
  for (const [name, n] of Object.entries(MIND.bond)) {
    if (n >= 5 && (!best || n > best[1])) best = [name, n];
  }
  return best;
}
export function updateWorkspace(dt) {
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
export function wsReport() {
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
// 发呆计时:没有输入一阵子,世界才开口低语(t 计时、cd 冷却、idx 下一句;输入处理会把 t 清零)
export const idle = { t: 0, cd: 0, idx: Math.floor(rand() * IDLE_WHISPERS.length) };
export function updateIdle(dt) {
  if (!started || player.dead || dialog.open || paused || shopOpen) { idle.t = 0; return; }
  idle.t += dt;
  idle.cd = Math.max(0, idle.cd - dt);
  if (idle.t > 48 && idle.cd <= 0) {
    idle.cd = 150;
    idle.t = 0;
    toastAmbient(IDLE_WHISPERS[idle.idx++ % IDLE_WHISPERS.length], 4); // 只说写好的低语,不再直播"意识内容"
  }
}
// 新的一天:换日、刷新每日限额/蘑菇/公告,报时
export let dayTopThought = null; // 昨日最强点火(梦与巩固的素材)
export let dayTopSurprise = null; // 昨日最没料到的一刻(消夜入梦)
export function consolidate() {
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

