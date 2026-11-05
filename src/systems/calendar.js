// 历法:季节与日子、定日节庆、来信、换日(newDay)、时辰(dayPhase)、环境氛围音。
// 对外:calendar{day,lastPhase,dailyEvents,festGrantedDay,letter}(随存档)、seasonIdx/seasonDay/isWinter/todaySpecial、
// dayPhase()、applySeason()、newDay()/sleepToMorning()、composeLetter();主循环每帧调 updateCalendar() 与 updateAmbience(dt)。
// 换日时按序驱动别的系统:节庆彩头、公告、来信、心愿、传说演化、狼群换代、敌人战术、语料、佣兵饷钱、存档。
import { setAmbience } from '../audio.js';
import { aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { player, started, world } from '../core/state.js';
import { toast } from '../ui/toast.js';
import { setVegetationSeason } from '../vegetation.js';
import { unlockAch } from './achievements.js';
import { MIND, consolidate, mindMakeWish, recallLine, remember } from './mind.js';
import { clock } from './sky.js';
import { weather } from './weather.js';
import {
  EVO, addPickup, evolveLegends, evolveTactics, growCorpus, paused, payMercs, refreshProclaim,
  respawnMushrooms, saveGame, vendetta, vendettaLetter,
} from '../main.js';

// ================= 历法:季节与日子 =================
export const SEASONS = ['春', '夏', '秋', '冬'];
export const SEASON_ICON = ['🌸', '☀️', '🍂', '❄️'];
const SEASON_DAYS = 6; // 一日约 230 秒(夜里过得快),六日为一季
// day:第几日;dailyEvents:每日事件限额(导演事件与街头事件共享,免得此起彼伏乱成一锅粥);
// festGrantedDay:已发过节庆彩头的游戏日(存档携带,防读档反复刷金币);letter:今天有人写给你的信
export const calendar = { day: 1, lastPhase: 'dawn', dailyEvents: 4, festGrantedDay: 0, letter: null };

export function seasonIdx() { return Math.floor((calendar.day - 1) / SEASON_DAYS) % 4; }
export function seasonDay() { return ((calendar.day - 1) % SEASON_DAYS) + 1; }
export function isWinter() { return seasonIdx() === 3; }

// 定日事件:村庄的日子按历法过,而不是随机砸下来
export function todaySpecial() {
  const s = seasonIdx(), d = seasonDay();
  if (s === 2 && d === 1) return { key: 'harvest', name: '丰收节', desc: '田里落满了金币!' };
  if (d === 2) return { key: 'market', name: '集市日', desc: '喷泉广场满地是赶集人掉的金币' };
  if (d === 3) return { key: 'fullmoon', name: '满月夜', desc: '今日鱼获双倍,入夜亡魂徘徊' };
  if (d === 5) return { key: 'wolfmoon', name: '狼月', desc: '入夜后狼群嗜血,荒野勿独行' };
  return null;
}

// 季节换装:地表与草皮随季节改色,冬季积雪盖地
const SEASON_GROUND = [0xffffff, 0xf6f3e6, 0xf3d9a6, 0xf2f6fb]; // 乘在群系顶点色上的季节色调
export function applySeason() {
  const s = seasonIdx();
  const gm = world.ground.material;
  gm.color.setHex(SEASON_GROUND[s]);
  if (gm.userData.uSnow) gm.userData.uSnow.value = s === 3 ? 0.88 : 0; // 冬:平地积雪,陡坡露土
  setVegetationSeason(s);
}

export function startSpecialDay(key) {
  if (calendar.festGrantedDay === calendar.day) return;
  calendar.festGrantedDay = calendar.day;
  if (key === 'market') {
    for (let i = 0; i < 14; i++) {
      const a = rand() * 6.28, r = 4 + rand() * 9;
      addPickup('coin', Math.cos(a) * r, 5 + Math.sin(a) * r, 220);
    }
  } else if (key === 'harvest') {
    for (const [fx, fz, w, d] of [[24, 88, 24, 14], [-18, 92, 20, 12], [52, 96, 18, 10]]) {
      for (let i = 0; i < 8; i++) {
        addPickup('coin', fx + (rand() - 0.5) * (w - 2), fz + (rand() - 0.5) * (d - 2), 220);
      }
    }
  }
}

// 来信:隔三差五,城里有人给你写信(AI 执笔,引用你的事迹);信放在 calendar.letter
const LETTER_SENDERS = ['管家埃隆', '老板娘罗莎', '渔夫老周', '抄写员薇拉', '铁匠格罗姆', '牧羊女米娅'];
const LETTER_FALLBACK = [
  '见字如面。城里近来还算太平,你在外头也照顾好自己。汤永远给你留着。',
  '听说了你的事迹,写下来给后人看之前,想先谢谢你本人。',
  '没什么事,就是想起你了。路过时进来坐坐,别客气。',
];
export function composeLetter() {
  const from = LETTER_SENDERS[Math.floor(rand() * LETTER_SENDERS.length)];
  calendar.letter = { from, text: LETTER_FALLBACK[Math.floor(rand() * LETTER_FALLBACK.length)] };
  const deed = recallLine();
  aiLine(
    `你是中世纪王国的「${from}」,给绿衣游侠林恩写一封短信(40~70字)` +
    `${deed ? `,可以提到他:${deed}` : ''}。语气符合身份,家常、真挚,可带一点小事相托或小牢骚。只输出信的正文。`,
    null, 9000,
  ).then((t) => { if (t && calendar.letter && calendar.letter.from === from) calendar.letter.text = t; });
  toast(player.home ? '📮 家门口的信箱插上了一封新信,小红旗立起来了。' : '📮 罗莎那儿好像有你的一封信。', 3.5);
}

export function newDay() {
  consolidate();
  calendar.day++;
  calendar.dailyEvents = 4;
  if (calendar.day >= 30) unlockAch('elder');
  applySeason();
  respawnMushrooms();
  const sp = todaySpecial();
  if (started) {
    const sd = seasonDay();
    toast(`🌅 ${SEASON_ICON[seasonIdx()]} ${SEASONS[seasonIdx()]}·第 ${sd} 日` +
      (sd === 1 ? `,${SEASONS[seasonIdx()]}天来了` : '') +
      (sp ? ` — 今日${sp.name}:${sp.desc}` : ''), sp ? 5.5 : 3.2);
    if (sp) startSpecialDay(sp.key);
    refreshProclaim();
    if (vendetta.stage === 1 && !calendar.letter) vendettaLetter(); // 黑石的恐吓信,天不亮就塞进来了
    if (!calendar.letter && rand() < 0.35) composeLetter();
    if (!MIND.wish && rand() < 0.6) mindMakeWish(); // 新的一天,新的好奇
    evolveLegends(); // 谣言过了一夜,又长出新枝节
    if (EVO.wolfPressure >= 4) { // 猎杀压力够大:狼群换代
      EVO.wolfGen++;
      EVO.wolfPressure = 0;
      EVO.wolfSpeed = Math.min(2.4, EVO.wolfSpeed + 0.35);
      toast(`🐺 猎户们说,这一带的狼一代比一代精了(第 ${EVO.wolfGen} 代)。`, 4.5);
      remember('狼群换了一代,比从前更快更警觉', `wolfgen-${EVO.wolfGen}`);
    } else if (EVO.wolfPressure === 0 && EVO.wolfSpeed > 0) {
      EVO.wolfSpeed = Math.max(0, EVO.wolfSpeed - 0.12); // 没人猎狼,狼又懒散回去
    } else {
      EVO.wolfPressure = Math.max(0, EVO.wolfPressure - 1); // 压力隔夜消退
    }
    evolveTactics(); // 匪帮复盘昨天的死法,学出反制
    growCorpus();    // 世界自己给自己写一句新台词,永久入库
    payMercs();      // 佣兵饷钱,发不出就散伙
    saveGame();
  }
}

// 睡到天亮:换日 + 回满生命(旅店过夜用)
export function sleepToMorning() {
  clock.time = 0.27;
  calendar.lastPhase = 'dawn';
  player.hp = player.maxHp;
  newDay();
}

// 天亮换日:昼夜相位从 night 跨入 dawn 时 day++
export function updateCalendar() {
  const phase = dayPhase();
  if (phase === calendar.lastPhase) return;
  const from = calendar.lastPhase;
  calendar.lastPhase = phase;
  if (phase === 'dawn' && from === 'night') {
    newDay();
  } else if (phase === 'dusk' && started && todaySpecial()?.key === 'wolfmoon') {
    toast('🌕 狼月将升……天黑后狼群会变得凶猛,备好武器', 4);
  } else if (phase === 'night' && started && todaySpecial()?.key === 'fullmoon') {
    toast('🌕 满月高悬,湖面泛着银光……', 3.5);
  }
}
// 一天的时辰(驱动 NPC 日程)
export function dayPhase() {
  if (clock.time >= 0.25 && clock.time < 0.33) return 'dawn';
  if (clock.time >= 0.33 && clock.time < 0.62) return 'day';
  if (clock.time >= 0.62 && clock.time < 0.72) return 'dusk';
  return 'night';
}
// 环境氛围音:按季节 × 时辰 × 天气切换(4 秒判一次)
let ambienceT = 2;
export function updateAmbience(dt) {
  ambienceT -= dt;
  if (ambienceT > 0) return;
  ambienceT = 4;
  const ph = dayPhase();
  let kind = null;
  if (weather.rain > 0.25) kind = null; // 雨雪声自己就是氛围
  else if (isWinter()) kind = 'wind';
  else if (ph === 'night' && seasonIdx() >= 1) kind = 'crickets'; // 夏秋夜
  else if ((ph === 'day' || ph === 'dawn') && seasonIdx() <= 1) kind = 'birds'; // 春夏白天
  setAmbience(started && !paused ? kind : null);
}

