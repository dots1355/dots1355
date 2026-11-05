// 城里的人:具名 NPC(铁匠/马贩/老板娘/渔夫/国王/女巫……,有日程:白天守铺 → 黄昏去旅店 → 夜里回家)、
// 管家埃隆(复用委托人的身体)、搞笑 NPC(赌鬼豆子的骰子、吟游诗人皮波的即兴打油诗、说书人苟叔的话本、
// 铁臂加隆的掰手腕、风车骑士唐豆、疯子老糊涂)、喷泉许愿。
// 对外:namedNPCs/funnyNPCs/steward/EXTRA_NPCS;gamble/armWrestle/armPress/bardSong/tellStory/fountainWish;
// initNPCs() 启动装配调用一次(须在 initQuests 之后);主循环调 updateNPCs(dt)、updateArm(dt)。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import {
  BARD_COUPLETS, PACK_PROPHET_IDLE, PACK_TALES, PACK_WISHES, PACK_WITCH_LINES,
} from '../content-packs.js';
import { AI_TEXT_OFF, aiBusy, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import { player, world } from '../core/state.js';
import { angleLerp, dist2, makeHumanoid } from '../entities.js';
import { scene } from '../gfx/core.js';
import { NPCS } from '../story.js';
import { NPC_DESC_EN, dialog, openDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import { choreProgress } from './activities.js';
import { animateLimbs, entFar, horses, meleeSwing, moveEntity } from './actors.js';
import { SEASONS, dayPhase, seasonIdx, todaySpecial } from './calendar.js';
import { wolfKills } from './combat.js';
import { arenaHost } from './events.js';
import { wanted } from './law.js';
import { remember, wsReport } from './mind.js';
import { addPickup, crestsFound } from './pickups.js';
import { missions, quest, questGiver } from './quests.js';

// ================= 具名 NPC =================
const npcStyles = {
  witch: { shirt: 0x3a2a4a, pants: 0x261a30, hood: true, hair: 0x888888 },
  king: { shirt: 0x7a1f8a, pants: 0x3a2a4a, hair: 0xd8d8d8 },
  blacksmith: { shirt: 0x5a4632, pants: 0x33261a, hair: 0x2a1a10 },
  trader: { shirt: 0x2a6a5a, pants: 0x4a3a26, hair: 0x6a4a2a },
  innkeep: { shirt: 0xa04a5a, pants: 0x4a3320, hair: 0x8a3a1a },
  fisher: { shirt: 0x3a5a7a, pants: 0x33301c, hair: 0xbababa, straw: true },
};
export const namedNPCs = [];
export const EXTRA_NPCS = {
  witch: { name: '沼泽女巫玛尔戈', lines: [
    '汤锅里炖的?蘑菇、蛙腿、还有一点点秘密。',
    '乌拉那丫头又来讨药方了。告诉她,桦树皮我收着呢。',
    '沼泽认得善人的脚印。你的脚印……还行。',
  ] },
};
EXTRA_NPCS.witch.lines.push(...PACK_WITCH_LINES); // 内容包里玛尔戈的闲话
// 管家埃隆(委托人)也是有日程的活人
export let steward = null; // 启动装配时随委托人一起就位

// ================= 搞笑 NPC(无意义但快乐) =================
const FUNNY = {
  gambler: {
    name: '赌鬼豆子', spot: [8, 74.5, 2.6],
    style: { shirt: 0x8a6a1a, pants: 0x3a3026, hair: 0x1a1a14 },
    idle: [
      '手气这东西,越没有越想要。',
      '我戒赌了。从今天中午开始。',
      '这对骰子跟了我十年,输了我八年。',
      '别信什么必胜法,信我——也别信。',
    ],
  },
  bard: {
    name: '吟游诗人皮波', spot: [-5, 9.5, 2.8],
    style: { shirt: 0x9a3aa0, pants: 0x2a2a3a, hair: 0xd0b040 },
    idle: [
      '琴弦一响,金币作响……最好是。',
      '我给巨龙写过歌。它没来听,万幸。',
      '灵感这东西,和跳蚤一样,痒的时候抓不着。',
      '想听你自己的歌吗?我出词,你出事迹。',
    ],
  },
  prophet: {
    name: '疯子老糊涂', spot: [-11, 1.5, 1.2],
    style: { shirt: 0x5a5a52, pants: 0x4a4640, hair: 0xcccccc },
    idle: [
      '我看见了!头顶的太阳每四分钟绕一圈——这合理吗?!',
      '世界的尽头有一堵看不见的墙。我走过去,鼻子撞扁了。',
      '雨不是云下的!是有人在天上倒水!我数过,每次都是一千一百条雨丝!',
      '金币会自己转圈圈,你没发现吗?没有风!它们自己在转!',
      '我梦见我们都是一堆会走路的方块……醒来后我看了看我的手,不敢再想。',
      '每天清晨,面包师都从同一个位置出现。时间是个圈!圈!',
      '月亮和太阳从来不同时出现超过一炷香——有人在换布景!',
      '你走路的样子……腿的摆动像被人操纵着。你自己知道吗?!',
    ],
  },
  storyteller: {
    name: '盲眼说书人苟叔', spot: [17, 73, -2.2],
    style: { shirt: 0x4a4038, pants: 0x33302a, hair: 0xd8d8d8 },
    idle: [
      '(敲了敲烟杆)故事嘛,得等火候。',
      '我眼睛瞎了,故事反倒看得更清了。',
      '旅店的酒是引子,故事才是正菜。',
      '想听哪段?龙骨?湖底?还是……你自己的?',
    ],
  },
  merccap: {
    name: '佣兵队长布兰', spot: [20, 84, -2.2],
    style: { shirt: 0x4a4f58, pants: 0x2e3138, hair: 0x3a2e20, helmet: true, sword: true },
    idle: [
      '刀口上讨生活,讲的就是个明码标价。',
      '我的人不问雇主要去哪,只问多少钱。',
      '狼牙关那仗以后,我就再没为"大义"两个字拔过刀。',
      '想雇人?40 金币一位,每天 5 金币饷。战场上见真章。',
    ],
  },
  strongman: {
    name: '铁臂加隆', spot: [24, 81, -1.4],
    style: { shirt: 0x7a3a2a, pants: 0x3a3026, hair: 0x2a2018 },
    idle: [
      '这条胳膊掰弯过马蹄铁。马当时也在。',
      '旅店的桌子换了三张,都是被我掰坏的。',
      '有人说我靠蛮力。胡说,我还靠体重。',
      '祖传的手艺:我爷爷掰赢过一头熊。熊自己承认的。',
    ],
  },
  quixote: {
    name: '风车骑士唐豆', spot: [133.5, 14.5, 1.0],
    style: { shirt: 0x7a7a86, pants: 0x3a3a44, helmet: true, sword: true },
    idle: [
      '退后!那个挥舞四条巨臂的巨人是我的对手!',
      '我叫唐豆,风车骑士!已与此巨人激战三年,不分胜负!',
      '它转一圈,我砍一剑。公平的决斗!',
      '别被它温和的外表骗了——它在积蓄力量,我看得出来!',
      '等我打败它,磨坊主会把它的四条手臂送给我做纪念。他亲口答应的!',
    ],
  },
};
FUNNY.prophet.idle.push(...PACK_PROPHET_IDLE); // 内容包里老糊涂的胡话
export const funnyNPCs = [];
let quixote = null; // 风车骑士唐豆(启动装配时从名单里认出来)
let quixoteT = 2;

// 骰子赌局
export function gamble() {
  sfx.dice();
  if (player.coins < 10) {
    openDialog(['豆子:(把骰子一收)兜里连十个金币都没有?去去去,赚够了再来坐庄家对面。']);
    return;
  }
  const a = 1 + Math.floor(rand() * 6), b = 1 + Math.floor(rand() * 6);
  const c = 1 + Math.floor(rand() * 6), d = 1 + Math.floor(rand() * 6);
  const my = a + b, his = c + d;
  let result;
  if (my > his) { player.coins += 10; stats.loseStreak = 0; result = '豆子:(肉痛地推来金币)哎哟!拿走拿走,今晚喝西北风的是我。'; }
  else if (my < his) {
    player.coins -= 10;
    if (++stats.loseStreak >= 3) unlockAch('loser');
    result = '豆子:(笑眯眯地扒拉金币)承让承让——骰子亲我,不亲你。';
  }
  else { result = '豆子:平局!钱各回各家……真没意思,再来?'; }
  openDialog([
    '豆子:(搓了搓骰子)十个金币,买定离手——',
    `豆子:(哗啦一掷)你 ${a}+${b}=${my} 点,我 ${c}+${d}=${his} 点!`,
    result,
  ]);
}

// 掰手腕:酒馆前的力量赌局——狂按 E 把加隆的手压下去
const ARM_SPOT = { x: 24, z: 81 };
export const armRT = { active: false, meter: 0.5, t: 0, cooldown: 0 };
export function armWrestle() {
  if (armRT.active) return;
  if (armRT.cooldown > 0) {
    openDialog(['加隆:(甩着胳膊)让我缓缓……你这细胳膊哪来这么大的劲。']);
    return;
  }
  if (player.coins < 15) {
    openDialog(['加隆:(把蒲扇大的手一摊)赌注 15 金币。没钱?先去搬一天砖,练练再来。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
    return;
  }
  player.coins -= 15;
  armRT.active = true;
  armRT.meter = 0.5;
  armRT.t = 0;
  sfx.accept();
  toast('💪 掰手腕开始!狂按 E 把他的手压下去!!', 2.5);
  if (!AI_TEXT_OFF) {
    aiLine('你是中世纪酒馆大力士铁臂加隆,自称掰弯过马蹄铁。开赛瞬间对挑战者喊一句25字以内的垃圾话,越具体越好笑越好,只输出那句话。', null, 5000)
      .then((t) => { if (t && armRT.active) toast(`💪 加隆:${t}`, 2.5); });
  }
}
export function armPress() {
  armRT.meter = Math.min(1.05, armRT.meter + 0.055);
  sfx.clank();
}
function endArm(win, note) {
  armRT.active = false;
  armRT.cooldown = 6;
  if (win) {
    player.coins += 30;
    stats.arms = (stats.arms || 0) + 1;
    sfx.fanfare();
    remember('掰手腕赢了铁臂加隆,赢走 30 金币');
    if (stats.arms >= 3) unlockAch('ironarm');
    openDialog(['加隆:(不可置信地盯着自己被按平的手)……我输了?我输了!!好小子,30 金币拿走——下回我可不让你了!'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  } else {
    sfx.hit();
    openDialog([note || '加隆:(啪的一声把你的手背按在桌上)哈——!承让承让,15 金币进了今晚的酒钱。'], null,
      { key: null, name: '铁臂加隆', desc: NPC_DESC_EN.strongman });
  }
  saveGame();
}
export function updateArm(dt) {
  if (armRT.cooldown > 0) armRT.cooldown -= dt;
  if (!armRT.active) return;
  armRT.t += dt;
  if (dist2(player.pos.x, player.pos.z, ARM_SPOT.x, ARM_SPOT.z) > 30) {
    endArm(false, '加隆:(冲你的背影喊)哎——手都没松你人先跑了?!赌注归我啦!');
    return;
  }
  armRT.meter -= (0.16 + Math.min(0.18, armRT.t * 0.022)) * dt; // 拖得越久他劲越大
  if (armRT.meter >= 1) endArm(true);
  else if (armRT.meter <= 0 || armRT.t > 15) endArm(false);
}

// 吟游诗人:按你的真实事迹即兴打油诗(联网时由 AI 现场作词)
export async function bardSong() {
  if (aiBusy.bard) return;
  aiBusy.bard = true;
  try {
    await bardSongInner();
  } finally {
    aiBusy.bard = false;
  }
}
async function bardSongInner() {
  sfx.lute();
  const deedsForAI = [];
  if (wanted > 0) deedsForAI.push(`被通缉${wanted}星`);
  if (player.royalHorse) deedsForAI.push('有一匹皇家骏马');
  if (wolfKills > 0) deedsForAI.push(`猎杀了${wolfKills}头恶狼`);
  if (quest.idx > 0) deedsForAI.push(`完成了${quest.idx}件领主委托`);
  deedsForAI.push(`身上有${player.coins}枚金币`);
  toast('🎵 皮波拨了拨琴弦,正在酝酿……', 2);
  const ai = await aiLine(
    `你是中世纪吟游诗人皮波。用中文写一首恰好4行的幽默打油诗,歌颂绿帽游侠林恩:` +
    `${deedsForAI.join(',')}。要押韵、要俏皮。只输出四行诗,不要任何解释。`, null);
  if (dialog.open || player.dead) return; // 等歌期间玩家已在别的对话里/倒下了,别打断
  if (ai) {
    const lines = ai.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4);
    openDialog([
      '皮波:(拨响鲁特琴)咳咳——AI……啊不,缪斯女神刚给了我灵感!',
      ...lines.map((l) => `皮波:♪ ${l} ♪`),
      '皮波:(潇洒收弦)……打赏随意,掌声免费!',
    ]);
    return;
  }
  bardSongOffline();
}
function bardSongOffline() {
  const deeds = [];
  if (wanted > 0) deeds.push(`通缉星星头上飘,卫兵追他满城跑`);
  if (horses.some((h) => h.stolen)) deeds.push('顺过人家一匹马(嘘——)');
  if (player.royalHorse) deeds.push('胯下疾风踏烟尘');
  if (wolfKills > 0) deeds.push(`林中恶狼${wolfKills}头倒`);
  if (crestsFound.length > 0) deeds.push(`皇家纹章寻得${crestsFound.length}枚`);
  if (quest.idx >= missions.length) deeds.push('血斧授首,要塞已平');
  else if (quest.idx > 0) deeds.push(`领主的委托办完${quest.idx}件`);
  if (rand() < 0.6) deeds.push(BARD_COUPLETS[Math.floor(rand() * BARD_COUPLETS.length)]);
  deeds.push(`腰间金币${player.coins}枚,叮当作响赛铃铛`);
  if (deeds.length < 3) deeds.push('初来乍到名声浅,且看来日翻波澜');
  const pages = ['皮波:(拨响鲁特琴)咳咳——《绿帽游侠之歌》,即兴版,走你!'];
  for (let i = 0; i < deeds.length; i += 2) {
    pages.push(`皮波:♪ ${deeds.slice(i, i + 2).join(';')} ♪`);
  }
  pages.push('皮波:(潇洒收弦)……打赏随意,掌声免费!');
  openDialog(pages);
}

// 盲眼说书人:AI 现场编故事,离线用内置话本
const TALES = [
  '说是龙骨之地的龙啊,不是死的,是睡的。有个牧童在龙头骨里躲雨,听见了呼噜声——他发誓那不是风。第二天他把羊都数了三遍,一只没少,就是每只羊看他的眼神都变了。',
  '银月湖底的神殿,每逢月圆就亮一盏灯。老辈渔夫说,那是守殿人还在换灯油。有人问守了多少年,老渔夫掰着指头数了半天说:比湖里的鱼加起来还老。',
  '先祖石环立石那晚,天上的星星多得挤不下。立石的人说:我们数过星星,星星也在数我们。后来星星数累了,掉下来一颗,就成了如今许愿的喷泉。',
  '迷途丘陵里有个货郎,转了七天七夜出不来。最后他把担子一撂,坐地上骂了半个时辰——骂完抬头,路就在眼前。所以老话讲:丘陵认怂不认路。',
  '灰烬荒地那一仗,两边打到最后发现军旗上绣的是同一句家训。停手那天,活下来的人凑了一锅粥,一人一碗,喝完各自回家。从那以后那地方长不出草,倒年年长出野葱。',
  '狼月之夜,猎人罗尔夫的爷爷跟一头老狼在雪地里对坐了一宿。天亮时老狼起身走了,留下一只兔子。他爷爷说:那是狼在还二十年前的一箭之情。',
  '许愿池里住着个数钱的湖神。有年发大水,金币冲出来铺了半条街,湖神心疼得三天没显灵。后来它学乖了,愿望办不办另说,钱先沉到最底下。',
  '三石村有头驴,学会了拿嘴开门栓。村长把门栓换了三次,驴学了三次。第四次村长服了,给驴配了把钥匙——挂脖子上那种。驴现在见了村长还点头。',
];
let taleIdx = Math.floor(rand() * TALES.length);
TALES.push(...PACK_TALES); // 内容包里的话本(起始序号按内置话本取,与原先一致)
export async function tellStory() {
  if (aiBusy.tale) return;
  aiBusy.tale = true;
  try {
    await tellStoryInner();
  } finally {
    aiBusy.tale = false;
  }
}
async function tellStoryInner() {
  sfx.chest();
  toast('🎙️ 苟叔捋了捋胡子,烟杆在桌沿磕了磕……', 2);
  const sp = todaySpecial();
  const ai = await aiLine(
    `你是中世纪王国旅店里的盲眼说书人苟叔。现在是${SEASONS[seasonIdx()]}季${sp ? '·' + sp.name : ''}。${wsReport()}` +
    '用中文讲一个三句话的小故事,关于艾尔德里亚王国(可用素材:龙骨之地的老龙、银月湖底神殿、先祖石环、迷途丘陵、狼月、许愿池湖神、会开门的驴;若上面给了"此刻意识里的内容",可让故事悄悄偏向它)。' +
    '要有起承转合和一个妙尾,三分怪谈七分人味。只输出故事正文,不要引号。', null, 8000);
  if (dialog.open || player.dead) return; // 等故事期间玩家已在别的对话里/倒下了,别打断
  const text = ai || TALES[taleIdx++ % TALES.length];
  const parts = text.split(/(?<=[。!?])/).filter((p) => p.trim());
  const pages = ['苟叔:(压低嗓子)听好了——'];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 55) { pages.push(`苟叔:${cur}`); cur = p; } else cur += p;
  }
  if (cur) pages.push(`苟叔:${cur}`);
  pages.push('苟叔:(烟杆一点)欲知后事——明儿,还是这张桌。');
  openDialog(pages);
}

// 喷泉许愿
const WISHES = [
  ['水花溅了你一脸。愿望大概是收到了。', null],
  ['一条鱼吐了个泡,像是在嘲笑你。', null],
  ['你听见硬币落底的声音……它去和另外三百枚作伴了。', null],
  ['什么都没发生。这就是人生。', null],
  ['水面映出你的绿帽子。真好看。就这样。', null],
  ['一只青蛙浮上来看了你一眼,又沉下去了。', null],
  ['你许愿的瞬间打了个喷嚏。愿望作废,金币不退。', null],
  ['湖神打了个喷嚏——十枚金币喷了出来?!', 'coins'],
  ['一颗心从水里浮了上来?!别问,快捡!', 'heart'],
];
WISHES.push(...PACK_WISHES); // 内容包里的许愿回应
export function fountainWish() {
  player.coins--;
  sfx.splash();
  choreProgress('wish');
  if (++stats.wishes >= 10) unlockAch('wisher');
  const [text, effect] = WISHES[Math.floor(rand() * WISHES.length)];
  if (effect === 'coins') { player.coins += 10; sfx.coin(); }
  if (effect === 'heart') addPickup('heart', player.pos.x + 1, player.pos.z + 1, 20);
  openDialog([`(叮——金币入水)${text}`]);
}

// 具名 NPC 的一天:白天守铺 → 黄昏去旅店 → 夜里回家
const NPC_SCHEDULE = {
  steward:    { dawn: [4, 10], day: [4, 10], dusk: [4, 10], night: [0, -29.5] },
  blacksmith: { dawn: [24.8, -8], day: [24.8, -8], dusk: [10, 73.5], night: [27, -9] },
  trader:     { dawn: [48, 10], day: [48, 10], dusk: [11.5, 73.5], night: [43, 20] },
  fisher:     { dawn: [-100, 72], day: [-100, 72], dusk: [-100, 58], night: [-108, 60] },
};
// 具名/搞笑 NPC 每帧:按日程走位,到位后待机呼吸,玩家靠近时转身面对;风车骑士唐豆每 3 秒向"巨人"冲锋一次
export function updateNPCs(dt) {
  const phase = dayPhase();
  for (const n of namedNPCs) {
    if (entFar(n)) continue;
    const sched = NPC_SCHEDULE[n.key];
    const spot = sched ? sched[phase] : null;
    if (spot && Math.hypot(n.pos.x - spot[0], n.pos.z - spot[1]) > 1.2) {
      moveEntity(n, spot[0], spot[1], 2.2, dt);
      n.group.position.copy(n.pos);
      n.group.rotation.y = n.yaw;
      animateLimbs(n.parts, n.walkT, true, n.group, 0.45);
    } else {
      animateLimbs(n.parts, 0, false);
      if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
        n.group.rotation.y = angleLerp(n.group.rotation.y,
          Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
      }
    }
  }
  animateLimbs(arenaHost.parts, 0, false);
  if (dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 30) {
    arenaHost.group.rotation.y = angleLerp(arenaHost.group.rotation.y,
      Math.atan2(player.pos.x - arenaHost.pos.x, player.pos.z - arenaHost.pos.z), dt * 4);
  }
  for (const n of funnyNPCs) {
    if (n.key === 'quixote') continue; // 他忙着决斗
    if (entFar(n)) continue;
    animateLimbs(n.parts, 0, false);
    if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) < 30) {
      n.group.rotation.y = angleLerp(n.group.rotation.y,
        Math.atan2(player.pos.x - n.pos.x, player.pos.z - n.pos.z), dt * 4);
    }
  }
  // 风车骑士唐豆:每 3 秒向"巨人"发起冲锋
  quixoteT -= dt;
  if (quixoteT <= 0) {
    quixoteT = 3;
    quixote.swingT = 0.35;
    quixote.yaw = Math.atan2(140 - quixote.pos.x, 20 - quixote.pos.z);
    quixote.group.rotation.y = quixote.yaw;
    if (dist2(player.pos.x, player.pos.z, quixote.pos.x, quixote.pos.z) < 900) sfx.sword();
  }
  animateLimbs(quixote.parts, 0, false);
  if (quixote.swingT > 0) {
    quixote.swingT -= dt;
    quixote.parts._attackAnim = true;
    meleeSwing(quixote.parts, Math.min(1, 1 - quixote.swingT / 0.35));
  } else {
    quixote.parts._attackAnim = false;
  }
}

// 具名 NPC、管家埃隆(复用委托人的身体)、搞笑 NPC 立进场景(启动装配原位调用,须在 initQuests 之后)
export function initNPCs() {
  for (const [key, [nx, nz, nyaw]] of Object.entries(world.npcSpots)) {
    const n = { ...makeHumanoid(npcStyles[key]), key, def: NPCS[key] || EXTRA_NPCS[key],
      pos: new THREE.Vector3(nx, 0, nz), yaw: nyaw, lineIdx: 0, rewarded: false, walkT: 0 };
    n.group.position.copy(n.pos);
    n.group.rotation.y = nyaw;
    scene.add(n.group);
    namedNPCs.push(n);
  }
  steward = { group: questGiver.group, parts: questGiver.parts, key: 'steward',
    def: NPCS.steward, pos: world.questGiverPos.clone(), yaw: Math.PI, lineIdx: 0, walkT: 0 };
  namedNPCs.push(steward);
  for (const [key, def] of Object.entries(FUNNY)) {
    const n = { ...makeHumanoid(def.style), key, def,
      pos: new THREE.Vector3(def.spot[0], 0, def.spot[1]), yaw: def.spot[2],
      lineIdx: 0, walkT: 0, swingT: 0 };
    n.group.position.copy(n.pos);
    n.group.rotation.y = n.yaw;
    scene.add(n.group);
    funnyNPCs.push(n);
  }
  quixote = funnyNPCs.find((n) => n.key === 'quixote');
}
