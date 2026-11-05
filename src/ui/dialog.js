// 对话:运行时对话组合引擎 dbLine(情境开场 × 语气 × 12 类语料 × 口头禅,按角色声线现场拼装,近期说过的不复读)、
// RDR2 式多页对话面板(打字机效果、E 翻页、T 追问 deepTalk、AI 肖像、走开 6 米自动收起)、具名 NPC 的剧情章节 npcTalk、
// 女巫占卜 witchFortune、头顶闲聊气泡(showBubble/villagerChatter)。
// 对外:dialog(状态)、openDialog(pages, onDone, speaker)、advanceDialog()、dismissDialog();
// 主循环调 updateDialogRange()、updateBubble(dt)、villagerChatter()。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { AI_TEXT_OFF, aiBusy, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { player } from '../core/state.js';
import * as BANKS from '../dialogue-banks.js';
import { dist2 } from '../entities.js';
import { camera } from '../gfx/core.js';
import { DIALOGS, GUARD_LINES, TIME_GREETINGS, VILLAGERS } from '../story.js';
import { stats, unlockAch } from '../systems/achievements.js';
import { guards, villagers } from '../systems/actors.js';
import { calendar, dayPhase, seasonIdx, todaySpecial } from '../systems/calendar.js';
import { EVO } from '../systems/evo.js';
import { wanted } from '../systems/law.js';
import { MIND, archetype, recallLine, remember, workspace, wsReport } from '../systems/mind.js';
import { funnyNPCs } from '../systems/npcs.js';
import { quest } from '../systems/quests.js';
import { weather } from '../systems/weather.js';
import { groundH } from '../terrain.js';
import { abEl } from './hudview.js';
import { toast } from './toast.js';

// ================= 运行时对话组合引擎(数亿字组合空间,零加载) =================
// 情境开场 × 语气前缀 × 内容主体(12 类语料)× 口头禅收尾,按角色声线现场拼装;
// 类目按当下情境加权(下雨多聊雨,节庆多聊节,主线推进聊时事),近期说过的不复读。
const lineRecent = new Map();
export function dbLine(key) {
  const V = BANKS.VOICES[key];
  if (!V) return null;
  const phase = dayPhase();
  const w = weather.state === 'cloudy' ? 'clear' : weather.state;
  const seasonKey = ['spring', 'summer', 'autumn', 'winter'][seasonIdx()];
  const sp = todaySpecial();
  const rnd = rand;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const tail = () => (rnd() < 0.5 ? pick(V.tails) : '');
  const mood = () => (rnd() < 0.3 ? pick(V.mood) : '');
  const opener = (ctx) => (rnd() < 0.6 && BANKS.OPENERS[ctx] ? pick(BANKS.OPENERS[ctx]) : '');
  const clean = (t) => t.replace(/[。!?…]+$/, ''); // 语料自带句号时避免"。。"
  const cats = [
    ['job', 3], ['weather', w !== 'clear' ? 3 : 1], ['season', 2],
    ['festival', sp ? 3 : 0], ['gossip', 2.2], ['rumor', 2.2], ['place', 1.4],
    ['stage', 1.6], ['proverb', 1], ['memory', 1.2], ['smalltalk', 1.6], ['greet', 0.8],
  ].filter(([, wgt]) => wgt > 0);
  const total = cats.reduce((s2, c) => s2 + c[1], 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    let roll = rnd() * total;
    let cat = cats[0][0];
    for (const [c, wgt] of cats) { roll -= wgt; if (roll <= 0) { cat = c; break; } }
    let text = null;
    if (cat === 'job') {
      const jobs = [...(BANKS.JOB_EXTRA[key] || [])];
      if (key.startsWith('v')) {
        const vi = +key.slice(1);
        if (VILLAGERS[vi]) jobs.push(...VILLAGERS[vi].lines.map((l) => l.replace(/[。!?]$/, '')));
      }
      if (jobs.length) text = `${opener(phase)}${mood()}${clean(pick(jobs))}。${tail()}`;
    } else if (cat === 'weather') {
      const bank = BANKS.WEATHER_TALK[w];
      if (bank) text = `${opener(w)}${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'season') {
      text = `${opener(phase)}${mood()}${clean(pick(BANKS.SEASON_TALK[seasonKey]))}。${tail()}`;
    } else if (cat === 'festival') {
      const bank = BANKS.FESTIVAL_TALK[sp.key];
      if (bank) text = `${mood()}${clean(pick(bank))}。${tail()}`;
    } else if (cat === 'gossip') {
      const others = Object.keys(BANKS.FACTS).filter((k2) => k2 !== key);
      const other = pick(others);
      text = `${mood()}${pick(BANKS.GOSSIP_FRAMES).replace('{name}', BANKS.NAMES[other]).replace('{fact}', pick(BANKS.FACTS[other]))}${tail()}`;
    } else if (cat === 'rumor') {
      // 活语料:世界自己写的传闻混进既有语料一起流传
      const rpool = EVO.corpus.length && rnd() < 0.35 ? EVO.corpus : BANKS.RUMORS;
      text = `${mood()}${pick(BANKS.RUMOR_FRAMES).replace('{r}', clean(pick(rpool)))}${tail()}`;
    } else if (cat === 'place') {
      const p = pick(Object.keys(BANKS.PLACES));
      text = `${pick(BANKS.PLACE_FRAMES).replace('{p}', p).replace('{f}', pick(BANKS.PLACES[p]))}${tail()}`;
    } else if (cat === 'stage') {
      const q = Math.min(quest.idx, BANKS.STAGE_TOPICS.length - 1);
      text = `${mood()}${pick(BANKS.STAGE_FRAMES).replace('{t}', pick(BANKS.STAGE_TOPICS[q])).replace('{who}', pick(BANKS.WHO))}${tail()}`;
    } else if (cat === 'proverb') {
      text = `${mood()}${pick(BANKS.PROVERB_FRAMES).replace('{p}', pick(BANKS.PROVERBS))}${tail()}`;
    } else if (cat === 'memory') {
      const mems = BANKS.MEMORIES[key];
      if (mems && mems.length) {
        text = `${mood()}${pick(['说起来,{m}……', '有时想起,{m}。', '{m}——一晃这么多年了。', '跟你说件旧事:{m}。']).replace('{m}', clean(pick(mems)))}${tail()}`;
      }
    } else if (cat === 'smalltalk') {
      if (BANKS.SMALLTALK.length) text = `${rnd() < 0.4 ? opener(phase) : ''}${mood()}${pick(BANKS.SMALLTALK)}${tail()}`;
    } else if (cat === 'greet') {
      text = `${pick(BANKS.OPENERS[phase])}${V.addr},${pick(['又见面了', '有何贵干', '今天气色不错', '路上顺利吗', '别来无恙'])}。${tail()}`;
    }
    if (!text) continue;
    let recent = lineRecent.get(key);
    if (!recent) { recent = []; lineRecent.set(key, recent); }
    if (recent.includes(text)) continue; // 近期说过,换一句
    recent.push(text);
    if (recent.length > 40) recent.shift();
    return text;
  }
  return null;
}

// ================= 对话面板(RDR2 式多页对话) =================
const dialogEl = document.getElementById('dialog');
const dialogNameEl = document.getElementById('dialog-name');
const dialogTextEl = document.getElementById('dialog-text');
export const dialog = { open: false, pages: [], idx: 0, onDone: null };

let typeTimer = null;
function renderDialogPage() {
  const page = dialog.pages[dialog.idx];
  const ci = page.indexOf(':');
  let text;
  if (ci > 0 && ci < 8) {
    dialogNameEl.textContent = page.slice(0, ci);
    text = page.slice(ci + 1);
  } else {
    dialogNameEl.textContent = '';
    text = page;
  }
  // 打字机效果:E 先跳字,再翻页
  dialog.fullText = text;
  dialog.typing = true;
  dialogTextEl.textContent = '';
  clearInterval(typeTimer);
  let i = 0;
  typeTimer = setInterval(() => {
    i += 2;
    dialogTextEl.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(typeTimer);
      dialog.typing = false;
    }
  }, 22);
  const deepHint = dialog.speaker ? ' · T 追问' : '';
  document.getElementById('dialog-hint').textContent =
    (dialog.idx < dialog.pages.length - 1 ? `▼ E (${dialog.idx + 1}/${dialog.pages.length})` : '▼ E 结束') + deepHint;
}

export function openDialog(pages, onDone = null, speaker = null) {
  if (!pages.length) return;
  dialog.open = true;
  dialog.openX = player.pos.x;
  dialog.openZ = player.pos.z;
  dialog.pages = pages;
  dialog.idx = 0;
  dialog.onDone = onDone;
  dialog.speaker = speaker;
  if (speaker && speaker.name && !player.dead) { // 羁绊:它记着你最常找谁说话
    MIND.bond[speaker.name] = Math.min(999, (MIND.bond[speaker.name] || 0) + 1);
  }
  bubble.timer = 0; // 对话时收起闲聊气泡
  dialogEl.style.display = 'block';
  setPortrait(speaker);
  renderDialogPage();
}

export const VILLAGER_DESC_EN = [
  'baker woman', 'cloth merchant', 'fruit seller woman', 'spice merchant', 'carpenter',
  'washerwoman gossip', 'farmer', 'farm wife', 'hunter with bow', 'old one-legged soldier',
  'blacksmith apprentice boy', 'scribe woman with ink', 'shepherd girl', 'inn serving boy', 'old lamplighter',
  'fisher girl', 'boat builder', 'old miller', 'gravekeeper with shovel', 'stubborn village chief with pipe',
  'lame scythe grinder', 'old herbalist woman'];
export const NPC_DESC_EN = {
  steward: 'royal steward with ledger', king: 'melancholy old king', blacksmith: 'scarred master blacksmith',
  trader: 'horse trader woman', innkeep: 'warm innkeeper woman', fisher: 'old fisherman with straw hat',
  witch: 'swamp witch stirring a pot', gambler: 'grinning dice gambler', bard: 'flamboyant lute bard',
  prophet: 'wild-eyed mad prophet', quixote: 'rusty windmill knight', storyteller: 'blind old storyteller with pipe',
  strongman: 'burly bald tavern strongman with huge arms',
};
// ---- AI 肖像:每位说话人一张(pollinations 生成,种子固定,浏览器缓存;离线自动隐藏) ----
const portraitEl = document.getElementById('dialog-portrait');
function strSeed(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 100000;
}
function setPortrait(speaker) {
  if (!portraitEl) return;
  if (!speaker || !speaker.desc || AI_TEXT_OFF) {
    portraitEl.style.display = 'none';
    return;
  }
  const prompt = `storybook watercolor bust portrait of a medieval ${speaker.desc}, warm candlelight, parchment background, no text`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=128&height=128&nologo=true&seed=${strSeed(speaker.name)}`;
  if (portraitEl.dataset.url !== url) {
    portraitEl.style.display = 'none';
    portraitEl.dataset.url = url;
    portraitEl.onload = () => { if (portraitEl.dataset.url === url) portraitEl.style.display = 'block'; };
    portraitEl.onerror = () => { portraitEl.style.display = 'none'; };
    portraitEl.src = url;
  } else if (portraitEl.complete && portraitEl.naturalWidth > 0) {
    portraitEl.style.display = 'block';
  }
}

// ---- 女巫占卜:5 金币一卦。她算得准——因为明日的历法本来就是定数 ----
export async function witchFortune(n) {
  aiBusy.fortune = true;
  sfx.dice();
  const tday = calendar.day + 1;
  const ts = (() => {
    const save = calendar.day;
    calendar.day = tday;
    const sp = todaySpecial();
    calendar.day = save;
    return sp;
  })();
  const truth = ts ? `明日恰逢「${ts.name}」(${ts.desc})` : '明日无节无庆,是寻常的一天';
  const who = archetype();
  const fb = ts
    ? `玛尔戈:(汤勺搅出一个旋)水里翻出字来了……明日${ts.name}。${ts.desc}。信不信由你,反正水不骗人。`
    : `玛尔戈:(盯着汤面)明日无风无浪。对你这样的「${who}」来说,没消息就是好消息。`;
  toast('🔮 玛尔戈往锅里撒了一撮灰……', 2);
  const ai = await aiLine(
    `你是中世纪沼泽女巫玛尔戈,收了5金币给玩家占卜。已知天机:${truth};玩家在世界眼里是个「${who}」` +
    `${recallLine() ? `;他做过:${recallLine()}` : ''}。用中文说一段40~70字的卦辞:神叨、准确(必须把明日的天机说进去)、结尾带一句似是而非的忠告。只输出卦辞。`,
    null, 9000);
  aiBusy.fortune = false;
  if (dialog.open || player.dead) return; // 半路走开:卦不开,钱不收
  player.coins -= 5;
  stats.fortunes = (stats.fortunes || 0) + 1;
  if (stats.fortunes >= 3) unlockAch('fortune');
  openDialog([ai ? `玛尔戈:${ai}` : fb], null,
    { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
  remember('花五枚金币,听沼泽女巫算了一卦');
}

// ---- T 键追问:让 AI 顺着刚才的话往深里说(离线回退对话库) ----
export async function deepTalk() {
  const sp = dialog.speaker;
  if (!sp || aiBusy.deep || dialog.typing) return;
  aiBusy.deep = true;
  stats.deepTalks = (stats.deepTalks || 0) + 1;
  if (stats.deepTalks >= 10) unlockAch('deept');
  const lastLine = (dialog.fullText || '').slice(0, 70);
  const ent = sp.ent || sp;
  const hist = ent.deepHist || [];
  toast('(对方想了想……)', 1.2);
  const fb = (sp.key && dbLine(sp.key)) || '这话说来就长了……改天,改天一定跟你细说。';
  const t = await aiLine(
    `你是中世纪王国艾尔德里亚的${sp.name}${sp.desc ? `(${sp.desc}的身份)` : ''}。你刚对玩家说:"${lastLine}"。` +
    `${hist.length ? `此前你还提过:${hist.join(';')}。` : ''}${wsReport()}` +
    '玩家追问了一句,请顺着话头往深里再说一句(60字以内),口语化、符合身份、带点没说完的余味。不要引号,不要名字前缀。', fb, 9000);
  aiBusy.deep = false;
  if (!dialog.open || dialog.speaker !== sp) return; // 对话已换场,别插话
  ent.deepHist = [...hist.slice(-1), t.slice(0, 50)];
  dialog.pages.push(`${sp.name}:${t}`);
  dialog.idx = dialog.pages.length - 1;
  renderDialogPage();
}

// 走开了话就不说了:离说话人(或开口处)超过 6 米自动收起;带回调的对话照样结算(委托、赏金不会丢)
export function updateDialogRange() {
  abEl.style.visibility = dialog.open ? 'hidden' : ''; // 对话框不被操作栏压住
  if (!dialog.open) return;
  const ref = dialog.speaker && dialog.speaker.ent && dialog.speaker.ent.pos;
  const x = ref ? ref.x : dialog.openX, z = ref ? ref.z : dialog.openZ;
  if (x === undefined || dist2(player.pos.x, player.pos.z, x, z) < 36) return;
  clearInterval(typeTimer);
  dialog.typing = false;
  dialog.open = false;
  dialogEl.style.display = 'none';
  const f = dialog.onDone;
  dialog.onDone = null;
  if (f) f();
}
// 强制收起对话(不结算 onDone):玩家倒下时用
export function dismissDialog() {
  if (!dialog.open) return;
  dialog.open = false;
  dialogEl.style.display = 'none';
  dialog.onDone = null;
}
export function advanceDialog() {
  if (dialog.typing) {
    // 第一次按键:直接显示整页
    clearInterval(typeTimer);
    dialog.typing = false;
    dialogTextEl.textContent = dialog.fullText;
    return;
  }
  dialog.idx++;
  if (dialog.idx >= dialog.pages.length) {
    dialog.open = false;
    dialogEl.style.display = 'none';
    const f = dialog.onDone;
    dialog.onDone = null;
    if (f) f();
  } else {
    renderDialogPage();
  }
}

// 具名 NPC 对话:优先播当前阶段未读的故事章节,读完只剩闲聊
export function npcTalk(n, onDone = null) {
  const d = DIALOGS[n.key];
  if (!d) return;
  const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
  n.readArcs = n.readArcs || new Set();
  const sp = { key: n.key, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n };
  if (arcIdx >= 0 && !n.readArcs.has(arcIdx)) {
    n.readArcs.add(arcIdx);
    const greet = TIME_GREETINGS[dayPhase()];
    openDialog([
      `${n.def.name}:${greet[Math.floor(rand() * greet.length)]}`,
      ...d.arcs[arcIdx].pages,
    ], onDone, sp);
  } else {
    // 故事读完后:手写闲聊与对话库轮换
    const line = rand() < 0.4
      ? d.small[n.lineIdx++ % d.small.length]
      : `${n.def.name}:${dbLine(n.key) || d.small[n.lineIdx++ % d.small.length]}`;
    openDialog([line], onDone, sp);
  }
}

// ================= 对话气泡 =================
const bubbleEl = document.getElementById('bubble');
const bubble = { timer: 0, anchor: null, cooldowns: new Map() };
export function showBubble(anchor, name, text, dur = 3.2) {
  bubbleEl.innerHTML = name ? `<b>${name}</b><br>${text}` : text;
  bubble.anchor = anchor;
  bubble.timer = dur;
}
const _bubbleV = new THREE.Vector3();
export function updateBubble(dt) {
  if (bubble.timer <= 0) { bubbleEl.style.display = 'none'; return; }
  bubble.timer -= dt;
  // 走远了自动收起
  if (dist2(player.pos.x, player.pos.z, bubble.anchor.pos.x, bubble.anchor.pos.z) > 240) {
    bubble.timer = 0;
    bubbleEl.style.display = 'none';
    return;
  }
  _bubbleV.copy(bubble.anchor.pos).y += 2.1 + groundH(bubble.anchor.pos.x, bubble.anchor.pos.z); // 逻辑 y 是离地高度
  _bubbleV.project(camera);
  if (_bubbleV.z > 1) { bubbleEl.style.display = 'none'; return; }
  bubbleEl.style.display = 'block';
  bubbleEl.style.left = `${(_bubbleV.x * 0.5 + 0.5) * window.innerWidth}px`;
  bubbleEl.style.top = `${(-_bubbleV.y * 0.5 + 0.5) * window.innerHeight}px`;
  // 村民闲聊触发
}
export function villagerChatter() {
  if (bubble.timer > 0 || dialog.open) return;
  const now = performance.now();
  for (const v of villagers) {
    if (v.downT > 0 || v.fleeT > 0 || v.sleeping) continue;
    if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(v) || 0;
    if (now - last < 25000 * (workspace.mood.v > 0.2 ? 0.6 : workspace.mood.v < -0.2 ? 1.5 : 1)) continue;
    bubble.cooldowns.set(v, now);
    showBubble(v, v.id.name, dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length]);
    return;
  }
  for (const g of guards) {
    if (g.downT > 0 || wanted > 0) continue;
    if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) > 8) continue;
    const last = bubble.cooldowns.get(g) || 0;
    if (now - last < 30000) continue;
    bubble.cooldowns.set(g, now);
    showBubble(g, null, dbLine('guard') || GUARD_LINES[Math.floor(rand() * GUARD_LINES.length)]);
    return;
  }
  for (const n of funnyNPCs) {
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 12) continue;
    const last = bubble.cooldowns.get(n) || 0;
    if (now - last < 20000) continue;
    bubble.cooldowns.set(n, now);
    showBubble(n, n.def.name, n.def.idle[Math.floor(rand() * n.def.idle.length)]);
    return;
  }
}

