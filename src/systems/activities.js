// 野外与城中的小玩法:篝火/温泉/教堂庇佑(wildSpots,荒野区块也往里登记)、旅店过夜的梦、旅程手账(J)、拍照模式(P)、
// 湖心岛摆渡与月光祭坛(湖神恩赐 lakeBlessed)、赛马计时赛、王室地窖(inDungeon/DGN)、村务委托(sideQuest)、
// 世界观铭文(loreRead,随存档)、每日王国公告、栈桥钓鱼。
// initActivities() 启动装配调用一次;主循环调 updateRideMileage/updateSprings/updateTrial/updateCryptLights/
// updateAltarGlow/updateFishing。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { PACK_PROCLAIM } from '../content-packs.js';
import { AI_TEXT_OFF, aiBusy, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { player, started, world } from '../core/state.js';
import { dist2, lambert } from '../entities.js';
import { scene } from '../gfx/core.js';
import { LORE, VILLAGERS } from '../story.js';
import { toast } from '../ui/toast.js';
import { ACH_DEFS, achUnlocked, stats, unlockAch } from './achievements.js';
import { addBandit } from './actors.js';
import { SEASONS, calendar, dayPhase, seasonDay, seasonIdx, todaySpecial } from './calendar.js';
import { EVO, legendText } from './evo.js';
import { frostfang } from './fauna.js';
import { recomputeMaxHp } from './gear.js';
import { SKILL_DEFS, learnSpell, shout } from './magic.js';
import { mercs } from './mercs.js';
import {
  archetype, chronicle, dayTopSurprise, dayTopThought, recallLine, remember, workspace,
} from './mind.js';
import { spawnDust, weather } from './weather.js';
import {
  crestsFound, dialog, missions, openDialog, quest, saveGame, stewardWhere, wolfKills,
} from '../main.js';

// ================= 野外热点:篝火(烤肉)/温泉(泡汤)/教堂(庇佑) =================
export const wildSpots = [];
export function nearestSpot(type, r2) {
  for (const sp of wildSpots) {
    if (sp.type === type && dist2(player.pos.x, player.pos.z, sp.x, sp.z) < r2) return sp;
  }
  return null;
}
let springTick = 0, blessDay = 0;
// 遗迹教堂的石坛:每日一次庇佑(脚下生风 120 秒),初次祈祷授治愈术
export function blessedToday() { return blessDay === calendar.day; }
export function prayAtChapel() {
  if (blessDay !== calendar.day) {
    blessDay = calendar.day;
    player.blessT = 120;
    choreProgress('pray');
    sfx.fanfare();
    openDialog(['(你在断壁间的石坛前低头片刻。风从缺了顶的殿堂穿过,像一声很轻的应答。)',
      '✨ 获得庇佑:脚下生风(移动加速,120 秒)'],
    () => learnSpell('heal'));
  } else {
    openDialog(['(石坛安静。神明今日已听过你的祷告——祂也需要歇一歇。)']);
  }
}
export function updateSprings(dt) {
  if (!started || player.dead) return;
  const sp = nearestSpot('spring', 14);
  if (!sp) { springTick = 0; return; }
  springTick += dt;
  if (springTick >= 2) {
    springTick = 0;
    spawnDust(player.pos.x, 0.6, player.pos.z, 3, 1.2, 1.6);
    stats.soak = (stats.soak || 0) + 2;
    choreProgress('soak');
    choreProgress('soak');
    if (stats.soak >= 30) unlockAch('soak');
    if (player.hp < player.maxHp) {
      player.hp++;
      sfx.heart();
    }
  }
}

// ================= 梦境(旅店过夜时,AI 把编年史揉进梦里) =================
const DREAMS = [
  '你梦见自己站在麦田中央,每一穗麦子都朝着你弯腰,像在行礼,又像在偷笑。',
  '你梦见银月湖底亮着一盏灯,守灯人背对着你,肩膀很像你自己。',
  '你梦见那只鸡。它坐在王座上,神情威严。你醒来前,它点了点头。',
  '你梦见风车转得越来越慢,最后停住——整个世界都在等它,谁也不敢先动。',
  '你梦见一枚金币掉进许愿池,沉了很久很久,久到你在梦里睡着了。',
  '你梦见雪落进炉火,没有熄,反而烧得更旺。有人在你身后轻轻说:记住这个。',
];
let dreamIdx = Math.floor(rand() * DREAMS.length);
export function queueDream() {
  if (rand() < 0.45) return; // 不是每晚都做梦
  const mem = [dayTopThought,
    dayTopSurprise ? `它最没料到的一刻:${dayTopSurprise}` : null,
  ].filter(Boolean).join(';') || recallLine();
  if (!AI_TEXT_OFF && !aiBusy.dream) {
    aiBusy.dream = true;
    aiLine(
      `你是梦本身。给一个中世纪游侠写一段40字以内的梦境,素材(他昨天最挂心的事):${mem || '空旷的原野与一面镜子'}。` +
      '要有画面感,微微超现实,不解释,不加引号。只输出梦境。', null, 9000,
    ).then((t) => {
      aiBusy.dream = false;
      if (t && !dialog.open && !player.dead) openDialog([`(昨夜的梦)${t}`]);
    });
  } else {
    setTimeout(() => {
      if (!dialog.open && !player.dead) openDialog([`(昨夜的梦)${DREAMS[dreamIdx++ % DREAMS.length]}`]);
    }, 4000);
  }
}

// 任务日志:当前委托、目标与进度、去哪做
function questLogLine() {
  if (quest.idx >= missions.length) return '📜 委托:全部完成——去见领主领赏。';
  const m = missions[quest.idx];
  if (!quest.active) return `📜 下一单:${m.title}(回${stewardWhere()}找管家埃隆接取)`;
  const prog = m.goal ? `(进度 ${quest.progress}/${m.goal})` : '';
  const tm = quest.timer > 0 && (m.type === 'deliver' || m.type === 'race') ? ` · 剩 ${Math.ceil(quest.timer)} 秒` : '';
  return `📜 进行中:${m.title} —— ${m.desc}${prog}${tm}`;
}
// ================= 旅程手账(J 键:一册在手,战绩全有) =================
export function openJournal() {
  if (dialog.open) return;
  const bestRace = stats.raceBest ? `${stats.raceBest.toFixed(1)} 秒` : '——';
  const pages = [
    `📖 旅程手账 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日(在这世上第 ${calendar.day} 天)`,
    questLogLine(),
    `世界眼里的你:「${archetype()}」 · 🪙 ${player.coins} · ❤ 上限 ${player.maxHp / 2} 心` +
      `${player.relic ? ' · ☀️ 先王战徽' : ''}${frostfang.tamed ? ' · 🐺 霜牙同行' : ''}`,
    `📜 委托 ${Math.min(quest.idx, missions.length)}/${missions.length} · 🛡️ 纹章 ${crestsFound.length}/${world.crestSpots.length} · 📖 铭文 ${loreRead.length}/${LORE.length} · 🏆 成就 ${achUnlocked.length}/${Object.keys(ACH_DEFS).length}`,
    `🐺 猎狼 ${wolfKills} · 🦌 猎鹿 ${stats.deer || 0} · 🍄 采菇 ${stats.mushrooms || 0} · 🎣 钓鱼 ${stats.fishCaught || 0} · ⚡ 弹反 ${stats.parries || 0}`,
    `🏟️ 竞技场最佳 ${stats.arenaBest || 0} 波 · 🏁 赛马纪录 ${bestRace} · 💀 倒下 ${stats.deaths || 0} 次`,
    `⚔️ 战团覆灭 ${stats.warbandsWiped || 0} 支 · 🏰 攻城击退 ${stats.siegesHeld || 0} 次 · 🚩 军旗 ${stats.banners || 0} 面`,
    `📈 技艺(用什么涨什么):${Object.entries(SKILL_DEFS).map(([k, d]) =>
      `${d.icon}${d.name} ${player.skills[k].lv} 级`).join(' · ')}` +
      `${shout.learned ? ' · 🐉 冲击战吼' : ''}${mercs.length ? ` · 🪖 佣兵 ×${mercs.length}` : ''}`,
  ];
  const mems = chronicle.filter((m) => !(m.k && /^(ws-|death-)/.test(m.k)) && !/[他它]/.test(m.t)).slice(-3);
  if (mems.length) {
    pages.push(`📝 最近的经历:${mems.map((m) => `第${m.d}日,${m.t}`).join(';')}。`);
  }
  {
    const topLeg = EVO.legends.reduce((b, x) => (!b || x.heat > b.heat ? x : b), null);
    const bits = [];
    if (EVO.wolfGen > 1) bits.push(`狼群一代比一代凶(第 ${EVO.wolfGen} 代)`);
    if (EVO.tactics.block >= 0.25) bits.push('盗贼学会了举盾');
    if (EVO.tactics.dodge >= 0.25) bits.push('盗贼学会了闪箭');
    if (topLeg && topLeg.gen > 1) bits.push(`酒馆里流传着你的故事:「${legendText(topLeg)}」`);
    if (bits.length) pages.push(`🌍 世界的变化:${bits.join(' · ')}`);
  }
  openDialog(pages);
}

// ================= 拍照模式(P 键隐藏全部 HUD) =================
let photoMode = false;
const PHOTO_HIDE = ['hearts', 'coins', 'equip', 'wanted', 'mission', 'region', 'minimap',
  'prompt', 'controls-hint', 'combo', 'weather', 'bubble', 'toast',
  'stamina', 'lockhp', 'bosshp', 'save-icon', 'actionbar', 'keyhint'];
export function togglePhoto() {
  photoMode = !photoMode;
  for (const id of PHOTO_HIDE) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = photoMode ? 'hidden' : '';
  }
  if (!photoMode) toast('📷 已退出拍照模式', 1.5);
}

// ================= 银月湖心岛:摆渡小船与月光祭坛 =================
export const BOAT_PIER = { x: -96.5, z: 86 };
export const BOAT_ISLE = { x: -100, z: 106.2 };
export let lakeBlessed = false;
export function setLakeBlessed(v) { lakeBlessed = !!v; } // 读档用:恩赐状态只在本段改写
export function rowTo(dst, msg) {
  sfx.splash();
  stats.rows = (stats.rows || 0) + 1;
  if (stats.rows >= 6) unlockAch('sailor');
  toast('🚣 你摇着小船,桨声把湖面剪开一道纹……', 2.5);
  player.pos.set(dst.x, 0, dst.z);
  player.vy = 0;
  if (msg) setTimeout(() => toast(msg, 3), 900);
}
export function prayAltar() {
  if (lakeBlessed) {
    openDialog(['(祭坛安静地泛着微光。湖神的恩赐一生只有一次——它记得你来过。)']);
    return;
  }
  lakeBlessed = true;
  recomputeMaxHp();
  player.hp = player.maxHp;
  sfx.fanfare();
  remember('在湖心沉没神殿的祭坛前,得到了湖神的恩赐', 'lakegift');
  unlockAch('lakegift');
  openDialog([
    '(你把手放上月光祭坛。水下极深处,有什么东西缓缓睁开了眼,又缓缓阖上。)',
    '(一股凉意顺着掌心漫上来,像月光灌进了骨头——却并不冷。)',
    '💙 湖神的恩赐:生命上限 +2!',
  ], () => { learnSpell('frost'); saveGame(); });
}
// 湖心祭坛:满月夜里亮起来,平时只是微光(缓动过去)
export function updateAltarGlow(dt) {
  if (!world.islandAltarMat) return;
  const glow = todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night' ? 2.2 : 0.5;
  if (Math.abs(world.islandAltarMat.emissiveIntensity - glow) > 0.01) {
    world.islandAltarMat.emissiveIntensity += (glow - world.islandAltarMat.emissiveIntensity) * dt;
  }
}

// ================= 赛马计时赛(马厩旁的赛旗,无限重复) =================
export const TRIAL_FLAG = { x: 57, z: 13 };
export const trialRT = { active: false, idx: 0, t: 0, rings: [] };
export function startTrial() {
  if (quest.active && missions[quest.idx].type === 'race') {
    toast('🏁 正赛进行中——先跑完领主的委托,再来刷纪录!', 3);
    return;
  }
  trialRT.active = true;
  trialRT.idx = 0;
  trialRT.t = 0;
  for (const [rx, rz] of world.raceRoute) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.22, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x7ad4ff, emissive: 0x1a5588, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
    ring.position.set(rx, 2.4, rz);
    scene.add(ring);
    trialRT.rings.push(ring);
  }
  sfx.accept();
  toast(`🏁 计时赛开始!穿过全部 ${world.raceRoute.length} 个蓝环${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)} 秒)` : ''}`, 3.5);
}
export function endTrial(finished) {
  for (const r of trialRT.rings) scene.remove(r);
  trialRT.rings = [];
  trialRT.active = false;
  if (!finished) { toast('🏁 计时赛作废。旗子下再来!', 2.5); return; }
  choreProgress('race');
  const t = trialRT.t;
  const best = stats.raceBest || 0;
  if (!best || t < best) {
    stats.raceBest = t;
    player.coins += 10;
    sfx.fanfare();
    remember(`赛马计时赛跑出 ${t.toFixed(1)} 秒的新纪录`);
    toast(`🏁 新纪录 ${t.toFixed(1)} 秒!赏金 10 枚!`, 4);
    saveGame();
  } else {
    toast(`🏁 用时 ${t.toFixed(1)} 秒(纪录 ${best.toFixed(1)} 秒)。再练练!`, 3.5);
  }
}
export function updateTrial(dt) {
  if (!trialRT.active) return;
  trialRT.t += dt;
  const [rx, rz] = world.raceRoute[trialRT.idx];
  for (let i = 0; i < trialRT.rings.length; i++) {
    trialRT.rings[i].rotation.y += dt * (i === trialRT.idx ? 3 : 0.6);
    trialRT.rings[i].material.emissiveIntensity = i < trialRT.idx ? 0.1 : i === trialRT.idx ? 1.2 : 0.4;
  }
  if (dist2(player.pos.x, player.pos.z, rx, rz) < 9) {
    trialRT.idx++;
    sfx.coin();
    if (trialRT.idx >= world.raceRoute.length) endTrial(true);
    else toast(`蓝环 ${trialRT.idx}/${world.raceRoute.length} · ${trialRT.t.toFixed(1)}s`, 1);
  }
  if (trialRT.t > 120) endTrial(false); // 两分钟没跑完自动作废
}

// ================= 封印的王室地窖 =================
export let DGN = null; // world.dungeon(地窖布局),initActivities 时取
export function inDungeon() {
  return player.pos.x > DGN.inX0 && player.pos.x < DGN.inX0 + DGN.inW &&
    player.pos.z > DGN.inZ0 && player.pos.z < DGN.inZ0 + DGN.inD;
}
export function enterDungeon() {
  sfx.chest();
  player.pos.set(DGN.spawn.x, 0, DGN.spawn.z);
  player.vy = 0;
  toast('🕯️ 石阶向下,霉味和很久以前的香火味……这就是被封起来的那一层。', 4);
  remember('掀开了城堡后的暗门,走进被封印的王室地窖', 'crypt');
}
export function exitDungeon() {
  sfx.chest();
  player.pos.set(DGN.hatch.x, 0, DGN.hatch.z + 2);
  player.vy = 0;
  toast('你爬回地面。阳光重得像一床棉被。', 3);
}
export function takeRelic() {
  if (player.relic) {
    openDialog(['(圣坛空了。战徽在你身上——它记得回家的路,也认得新的主人。)']);
    return;
  }
  player.relic = true;
  sfx.fanfare();
  unlockAch('unsealer');
  remember('从王室地窖的圣坛上请下了「先王战徽」', 'relic');
  openDialog([
    '(圣坛上安放着一枚乌金战徽,八百年的灰尘盖不住它的锋利。)',
    '(你把它别上胸口。掌心的剑柄忽然顺手了许多——像有位老兵扶了一把。)',
    '☀️ 获得「先王战徽」:近战伤害 +1(永久)',
  ], () => saveGame());
}
// 地窖烛台:人在地窖里才点亮(进出时切换一次)
let cryptLit;
export function updateCryptLights() {
  const dIn = inDungeon();
  if (dIn === cryptLit) return;
  cryptLit = dIn;
  for (const pl of world.cryptLights) pl.visible = dIn;
}

// ================= 村务委托(无限支线:AI 写求助告示,离线用模板) =================
export const CHORE_POS = { x: -9, z: 18 };
export const sideQuest = { active: false, type: null, goal: 0, progress: 0, reward: 0, text: '', giver: '' };
const CHORE_TYPES = [
  { key: 'wolves', label: '猎狼', goalMin: 2, goalMax: 4, reward: 14,
    tpl: (g, who) => `${who}求助:狼群夜里扒我家羊圈,好汉行行好,猎 ${g} 头恶狼,赏钱在村务板下。` },
  { key: 'herbs', label: '采蘑菇', goalMin: 3, goalMax: 5, reward: 11, consume: true,
    tpl: (g, who) => `${who}求助:家里病人等药引,求 ${g} 朵林间伞菇,采到放板下即可,谢过!` },
  { key: 'venison', label: '送鹿肉', goalMin: 2, goalMax: 3, reward: 13, consume: true,
    tpl: (g, who) => `${who}求助:办席短了硬菜,求 ${g} 块鲜鹿肉,价钱好说,板下自取。` },
  { key: 'fish', label: '钓鱼', goalMin: 2, goalMax: 3, reward: 10,
    tpl: (g, who) => `${who}求助:馋鱼了,腿脚又不便。替我钓 ${g} 条上来,赏钱压在石头底下。` },
  { key: 'bandits', label: '清匪', goalMin: 2, goalMax: 3, reward: 16,
    tpl: (g, who) => `${who}求助:路上又有劫道的了,哪位好汉料理掉 ${g} 个,让我进趟货?` },
  { key: 'ride', label: '骑行', goalMin: 400, goalMax: 700, reward: 12,
    tpl: (g, who) => `${who}求助:我那匹马缺操练,替我遛 ${g} 步(骑任意坐骑跑够里程即可)。` },
  { key: 'cook', label: '烤肉', goalMin: 1, goalMax: 2, reward: 9,
    tpl: (g, who) => `${who}求助:想念篝火烤肉的香味了,替我在野外篝火烤 ${g} 块,替我闻闻就行。` },
  { key: 'pray', label: '代祷', goalMin: 1, goalMax: 1, reward: 10,
    tpl: (g, who) => `${who}求助:腿脚不便,替我去荒野的小教堂石坛前祷告一回,心意板下奉上。` },
  { key: 'soak', label: '试泉', goalMin: 6, goalMax: 10, reward: 11,
    tpl: (g, who) => `${who}求助:听说荒野温泉能治腰,替我去泡 ${g} 息,回来告诉我烫不烫。` },
  { key: 'race', label: '跑圈', goalMin: 1, goalMax: 1, reward: 12,
    tpl: (g, who) => `${who}求助:跟人打赌说你能跑完赛旗全程,替我赢回这口气(完成一次计时赛)!` },
  { key: 'wish', label: '许愿', goalMin: 2, goalMax: 3, reward: 8,
    tpl: (g, who) => `${who}求助:我不敢见湖神,替我往喷泉里投 ${g} 枚金币许个愿,愿望内容我写好了压在板下。` },
  { key: 'throw', label: '扔鸡', goalMin: 2, goalMax: 3, reward: 9,
    tpl: (g, who) => `${who}求助:别问原因。把鸡扔出去 ${g} 次,要抛物线漂亮的。真的别问。` },
];
let choreSeq = 0;
function rollChore() {
  const myId = ++choreSeq;
  const t = CHORE_TYPES[Math.floor(rand() * CHORE_TYPES.length)];
  const goal = t.goalMin + Math.floor(rand() * (t.goalMax - t.goalMin + 1));
  const giver = VILLAGERS[Math.floor(rand() * VILLAGERS.length)].name;
  sideQuest.active = true;
  sideQuest.type = t.key;
  sideQuest.goal = goal;
  sideQuest.progress = 0;
  sideQuest._rideDone = false;
  sideQuest.reward = t.reward + (t.key === 'ride' ? Math.round(goal / 50) : goal * 2); // 骑行按里程折算,别按步数发钱
  sideQuest.giver = giver;
  sideQuest.text = t.tpl(goal, giver);
  // AI 把告示重写得更有生活气(异步替换,离线保持模板)
  aiLine(
    `你是中世纪村民「${giver}」。你在村务板贴一则求助告示:需要${goal}份「${t.label}」相关的东西` +
    `(${t.key === 'wolves' ? '猎除恶狼' : t.key === 'herbs' ? '林间伞菇' : t.key === 'venison' ? '鲜鹿肉' : '鲜鱼'})。` +
    '用中文写这则告示,40~70字,原因要具体、生活化、带点小情绪。只输出告示正文。', null, 9000,
  ).then((t2) => { if (t2 && sideQuest.active && choreSeq === myId) sideQuest.text = `${giver}求助:${t2}`; });
}
export function choreProgress(kind) {
  if (!sideQuest.active || sideQuest.type !== kind) return;
  sideQuest.progress++;
  if (sideQuest.progress <= sideQuest.goal) {
    toast(`📋 村务【${sideQuest.giver}】:${sideQuest.progress}/${sideQuest.goal}`, 2);
  }
}
export function choreReady() {
  if (!sideQuest.active) return false;
  if (sideQuest.type === 'herbs') return player.herbs >= sideQuest.goal;
  if (sideQuest.type === 'venison') return player.venison >= sideQuest.goal;
  return sideQuest.progress >= sideQuest.goal;
}
export function choreBoard() {
  if (!sideQuest.active) {
    rollChore();
    sfx.accept();
    saveGame();
    openDialog([`(村务板贴着一张新告示)`, sideQuest.text,
      `(接下了。完成后回到村务板交差,赏钱 ${sideQuest.reward} 金币。)`]);
    return;
  }
  if (choreReady()) {
    if (sideQuest.type === 'herbs') player.herbs -= sideQuest.goal;
    if (sideQuest.type === 'venison') player.venison -= sideQuest.goal;
    player.coins += sideQuest.reward;
    sfx.fanfare();
    stats.chores = (stats.chores || 0) + 1;
    if (stats.chores >= 5) unlockAch('villagehero');
    remember(`替${sideQuest.giver}办妥了一桩村务`);
    openDialog([`(你把东西放在板下,拿走了压着的 ${sideQuest.reward} 枚金币。)`,
      `(${sideQuest.giver}不知何时在告示边添了一行小字:谢过恩公。)`]);
    sideQuest.active = false;
    saveGame();
    return;
  }
  const need = sideQuest.type === 'herbs' ? `${player.herbs}/${sideQuest.goal} 朵伞菇`
    : sideQuest.type === 'venison' ? `${player.venison}/${sideQuest.goal} 块鹿肉`
    : `${sideQuest.progress}/${sideQuest.goal}`;
  openDialog([sideQuest.text, `(进度:${need}。办妥了回来交差。)`]);
}
// 骑行里程:村务「骑行」与「千里驹」成就都按它算(和上一帧比位移,传送/瞬移的大跳不算)
export function updateRideMileage() {
  if (player.mounted && !player.dead) {
    const mv = Math.hypot(player.pos.x - (player._lastRX ?? player.pos.x), player.pos.z - (player._lastRZ ?? player.pos.z));
    if (mv > 0.02 && mv < 5) {
      stats.rideDist = (stats.rideDist || 0) + mv;
      if (sideQuest.active && sideQuest.type === 'ride') {
        sideQuest.progress += mv;
        if (sideQuest.progress >= sideQuest.goal && !sideQuest._rideDone) {
          sideQuest._rideDone = true;
          toast(`📋 村务【${sideQuest.giver}】:里程够了,回村务板交差!`, 3);
        }
      }
      if (stats.rideDist >= 5000) unlockAch('rider');
    }
  }
  player._lastRX = player.pos.x;
  player._lastRZ = player.pos.z;
}

// ================= 世界观铭文(可阅读的石碑,集齐 12 处) =================
export const loreRead = [];
export const loreStones = [];
export function readLore(s) {
  const idx = LORE.indexOf(s.def);
  const isNew = !loreRead.includes(idx);
  if (isNew) {
    loreRead.push(idx);
    sfx.chest();
    saveGame();
  }
  // 长文按句切页,读起来不挤
  const parts = s.def.text.split(/(?<=[。」])/).filter(Boolean);
  const pages = [`【铭文 · ${s.def.title}】`];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 60) { pages.push(cur); cur = p; } else cur += p;
  }
  if (cur) pages.push(cur);
  if (isNew) pages.push(`(📜 已收录铭文 ${loreRead.length}/${LORE.length}${loreRead.length >= LORE.length ? ' —— 全部集齐!' : ''})`);
  openDialog(pages, isNew && loreRead.length >= LORE.length ? () => unlockAch('scribe') : null);
}

// ================= 王国公告牌(每日 AI 撰写,离线用内置文风) =================
export const NOTICE_POS = { x: -5, z: 12 };
export let proclaimText = null;
const PROCLAIM_STOCK = [
  '城中井水甘冽如常,巡逻如常,税吏比巡逻更如常。',
  '南门吊桥的响声已聆听半年,领主府表示:再听听。',
  '风车、面包与告示,是王都每天醒来的三件事。',
  '卫兵队提醒:抱着鸡奔跑不犯法,但很可疑。',
  '喷泉许愿池本月捞出金币三百枚,愿望办理进度:排队中。',
];
PROCLAIM_STOCK.push(...PACK_PROCLAIM); // 内容包里的公告文风
export function composeProclaimOffline() {
  const sp = todaySpecial();
  const head = `${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日`;
  const fest = sp ? `今日${sp.name}——${sp.desc}。` : '';
  const stage = quest.idx >= missions.length ? '王国大患已除,领主嘉许全城同庆。'
    : quest.idx > 0 ? `绿衣游侠已为王国办结 ${quest.idx} 件委托,领主府记功在案。` : '领主府招募能人异士,详情垂询管家埃隆。';
  return `【王国公告 · ${head}】${fest}${stage}${PROCLAIM_STOCK[calendar.day % PROCLAIM_STOCK.length]}`;
}
export function refreshProclaim() {
  proclaimText = composeProclaimOffline();
  const sp = todaySpecial();
  aiLine(
    `你是中世纪王国艾尔德里亚的王室传令官。今天是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
    `${sp ? ',逢' + sp.name : ''},天气${{ clear: '晴', cloudy: '多云', rain: '雨', storm: '雷暴' }[weather.state]}。` +
    (workspace.history.length ? `城中近事:${workspace.history[workspace.history.length - 1].t}。` : '') +
    '用中文写一则60字以内的每日公告,口吻庄重里带点冷幽默,只输出公告正文,不要引号。', null, 8000,
  ).then((t) => { if (t) proclaimText = `【王国公告 · ${SEASONS[seasonIdx()]}季第 ${seasonDay()} 日】${t}`; });
}
// ================= 钓鱼(栈桥尽头) =================
export const FISH_SPOT = { x: -100, z: 82 };
export const FISH_SPOT_ISLE = { x: -103.5, z: 101.5 }; // 湖心岛深水钓点(渔获更肥)
export const fishing = { active: false, phase: 'wait', t: 0 };
const CATCHES_DEEP = [
  { w: 34, text: '一条神殿银鱼!鳞片亮得像月光淬过——12 金币。', coins: 12 },
  { w: 26, text: '月光鲤!尾鳍拖着一道银线,渔村得供起来——20 金币!', coins: 20 },
  { w: 18, text: '一盏沉底铜灯,灯芯居然是干的。古董贩子给了 8 金币。', coins: 8 },
  { w: 14, text: '你钓到了湖神的一个呵欠。水面荡了三圈,什么也没留下。', coins: 0 },
  { w: 8,  text: '深水巨物!!差点把你拽下水——25 金币,够吹一年!', coins: 25, ach: 'bigfish' },
];
const CATCHES = [
  { w: 45, text: '一条小鲫鱼!老周按行价收了 3 金币。', coins: 3 },
  { w: 30, text: '一条肥鲤鱼!老周眼睛都亮了,给了 6 金币。', coins: 6 },
  { w: 12, text: '一只老靴子……老周说他找这只鞋找了十年,硬塞给你 2 金币。', coins: 2, ach: 'boot' },
  { w: 8,  text: '水草一团。人生就是这样。', coins: 0 },
  { w: 5,  text: '银月湖大鱼!!鱼尾拍得水花四溅——15 金币,今晚渔村有故事讲了!', coins: 15, ach: 'bigfish' },
];
export function startFishing(deep = false) {
  fishing.active = true;
  fishing.deep = deep;
  fishing.phase = 'wait';
  fishing.t = 2.5 + rand() * 4;
  player.yaw = Math.PI; // 面向湖心
  toast(deep ? '🎣 深水抛竿……岛边的鱼更大,咬钩也更狠!' : '🎣 抛竿……盯紧浮漂,咬钩时按 E!', 3);
}
export function fishingReel() {
  if (fishing.phase === 'bite') {
    const table = fishing.deep ? CATCHES_DEEP : CATCHES;
    const total = table.reduce((s, c) => s + c.w, 0);
    let roll = rand() * total;
    let got = table[0];
    for (const c of table) { roll -= c.w; if (roll <= 0) { got = c; break; } }
    const moonX2 = todaySpecial()?.key === 'fullmoon' && got.coins > 0;
    if (got.coins > 0) stats.fishCaught = (stats.fishCaught || 0) + 1;
    if (got.coins > 0) choreProgress('fish');
    player.coins += moonX2 ? got.coins * 2 : got.coins;
    if (got.coins > 0) sfx.coin();
    sfx.splash();
    if (got.ach) unlockAch(got.ach);
    openDialog([`(收杆!)${got.text}` + (moonX2 ? '(🌕 满月夜,鱼获双倍!)' : '')]);
  } else {
    sfx.splash();
    toast('收早了,鱼吐着泡跑了。', 2);
  }
  fishing.active = false;
}
export function updateFishing(dt) {
  if (!fishing.active) return;
  fishing.t -= dt;
  if (fishing.phase === 'wait' && fishing.t <= 0) {
    fishing.phase = 'bite';
    fishing.t = 0.9;
    sfx.splash();
  } else if (fishing.phase === 'bite' && fishing.t <= 0) {
    fishing.phase = 'wait';
    fishing.t = 2.5 + rand() * 4;
    toast('浮漂动了一下又静了……鱼跑了。', 2);
  }
}

// 开局的玩法场景:猎人篝火与温泉、赛旗、地窖与守墓者、村务板、铭文石碑、公告牌(启动装配原位调用)
export function initActivities() {
  // 核心区固定热点:幽暗森林边的猎人篝火 + 霜风隘口温泉
  {
    const cf = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert(0x66625c));
      st.position.set(Math.cos(a) * 0.7, 0.12, Math.sin(a) * 0.7);
      cf.add(st);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0xff9a3d, emissive: 0xcc5500, emissiveIntensity: 1.4 }));
    flame.position.y = 0.4;
    cf.add(flame);
    cf.position.set(-118, 0, -32);
    scene.add(cf);
    wildSpots.push({ type: 'campfire', x: -118, z: -32, chunk: null });

    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
      new THREE.MeshStandardMaterial({ color: 0x7ad4d8, emissive: 0x1a5a5e, emissiveIntensity: 0.4, roughness: 0.15 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(-272, 0.03, -122);
    scene.add(pool);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), lambert(0x8a857e));
      st.position.set(-272 + Math.cos(a) * 2.8, 0.22, -122 + Math.sin(a) * 2.8);
      scene.add(st);
    }
    wildSpots.push({ type: 'spring', x: -272, z: -122, chunk: null });
  }
  {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), lambert(0x6b4a2f));
    pole.position.set(TRIAL_FLAG.x, 1.6, TRIAL_FLAG.z);
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xffd83d, emissive: 0x885500, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
    flag.position.set(TRIAL_FLAG.x + 0.58, 2.7, TRIAL_FLAG.z);
    scene.add(flag);
  }
  DGN = world.dungeon;
  // 守墓者:地窖常驻,黑暗中巡游(死后重生,不计任务)
  for (const [gx, gz] of [[336, -296], [352, -272], [368, -300], [344, -252], [376, -276]]) {
    const b = addBandit(gx, gz, { hp: 2, speed: 6.2 });
    b.ambient = true;
    b.keeper = true;
  }
  {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), lambert(0x6b4a2f));
    post.position.set(CHORE_POS.x, 1.2, CHORE_POS.z);
    scene.add(post);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.08), lambert(0x9a7a4f, { roughness: 0.9 }));
    plank.position.set(CHORE_POS.x, 1.7, CHORE_POS.z);
    plank.rotation.y = 0.4;
    plank.castShadow = true;
    scene.add(plank);
  }
  {
    const slabG = new THREE.BoxGeometry(1.0, 1.5, 0.26);
    const baseG = new THREE.BoxGeometry(1.3, 0.3, 0.5);
    for (const L of LORE) {
      const grp = new THREE.Group();
      const slab = new THREE.Mesh(slabG, lambert(0x8d8a84, { roughness: 0.9 }));
      slab.position.y = 0.95;
      slab.castShadow = true;
      grp.add(slab);
      const base = new THREE.Mesh(baseG, lambert(0x6f6c66));
      base.position.y = 0.15;
      grp.add(base);
      const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x9adcc8, emissive: 0x1a5548, emissiveIntensity: 0.5, roughness: 0.6 }));
      rune.position.set(0, 0.98, 0.14);
      grp.add(rune);
      grp.position.set(L.x, 0, L.z);
      grp.rotation.y = rand() * 6.28;
      scene.add(grp);
      loreStones.push({ group: grp, def: L });
    }
  }
  {
    const grp = new THREE.Group();
    const postG = new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6);
    for (const sx of [-0.8, 0.8]) {
      const post = new THREE.Mesh(postG, lambert(0x6b4a2f));
      post.position.set(sx, 1.1, 0);
      grp.add(post);
    }
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.2, 0.1), lambert(0x8a6a45, { roughness: 0.9 }));
    panel.position.y = 1.55;
    panel.castShadow = true;
    grp.add(panel);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85),
      new THREE.MeshStandardMaterial({ color: 0xe8ddc2, roughness: 0.95 }));
    paper.position.set(0, 1.55, 0.06);
    grp.add(paper);
    grp.position.set(NOTICE_POS.x, 0, NOTICE_POS.z);
    grp.rotation.y = 2.4;
    scene.add(grp);
  }
}
