// 成就与统计:ACH_DEFS(无意义成就表)、stats(各系统累加的计数,随存档)、achUnlocked(已解锁)。
// 对外:unlockAch(key) —— 解锁即播报、记进编年史、挂上家里的战利品墙、存档。
// stats 的字段由各系统自己累加(stats.kills/stats.deer/…),这里只声明初值。
import { sfx } from '../audio.js';
import { player } from '../core/state.js';
import { toast } from '../ui/toast.js';
import { refreshTrophies } from './home.js';
import { remember } from './mind.js';
import { saveGame } from '../main.js';

// ================= 无意义成就(奖励瞎玩) =================
export const ACH_DEFS = {
  boot:     { name: '湖底时尚', desc: '钓上一只老靴子' },
  bigfish:  { name: '银月传说', desc: '钓上湖中大鱼' },
  hero:     { name: '见义勇为', desc: '阻止一次街头抢劫' },
  gladiator:{ name: '角斗新星', desc: '竞技场撑过 5 波' },
  chucker:  { name: '禽兽行为', desc: '扔出 10 次鸡' },
  pecked:   { name: '鸡下败将', desc: '被复仇鸡群啄中 5 次' },
  windmill: { name: '第二位风车骑士', desc: '对着风车挥剑' },
  wisher:   { name: '许愿池钉子户', desc: '许愿 10 次' },
  drunkard: { name: '酒中豪杰', desc: '醉倒 3 次' },
  loser:    { name: '赌怪', desc: '骰子连输 3 把' },
  shepherd: { name: '羊骑士', desc: '骑羊走过 100 米' },
  bouncer:  { name: '弹簧靴', desc: '2 秒内连环踩踏两个目标' },
  hunter:   { name: '荒野猎手', desc: '猎到 5 头鹿' },
  forager:  { name: '采菇人', desc: '采到 15 朵蘑菇' },
  scribe:   { name: '史官', desc: '读遍全部 12 处世界观铭文' },
  mirror:   { name: '照见自己', desc: '与北境边缘的回响之镜对视' },
  parry:    { name: '见招拆招', desc: '完成 5 次完美弹反' },
  lawless:  { name: '无法无天', desc: '把全城卫兵同时放倒' },
  warbreaker: { name: '破军', desc: '全歼一支盗贼战团' },
  wallkeeper: { name: '守城人', desc: '与卫兵并肩击退攻城大军' },
  champion:   { name: '阵前斩将', desc: '单挑斩落枭首,吓散整支战团' },
  dragonslayer: { name: '屠龙者', desc: '斩落龙骨之地的霜龙残魂' },
  rampage:  { name: '一骑当千', desc: '一场战斗内 8 连杀' },
  chef:     { name: '野炊大师', desc: '在篝火上烤 5 块鹿肉' },
  packmate: { name: '孤狼不再', desc: '驯服白狼「霜牙」' },
  soak:     { name: '泡汤客', desc: '在温泉里泡满 30 秒' },
  lakegift: { name: '湖神的恩赐', desc: '触碰湖心岛的月光祭坛(生命上限 +2)' },
  unsealer: { name: '开封者', desc: '走进被封印的王室地窖,请下先王战徽' },
  villagehero: { name: '村里的自己人', desc: '办妥 5 桩村务委托' },
  rider:    { name: '千里驹', desc: '骑行累计 5000 步' },
  fortune:  { name: '问卦者', desc: '找玛尔戈求 3 卦' },
  penpal:   { name: '有信之人', desc: '收到 3 封来信' },
  deept:    { name: '打破砂锅', desc: '追问 10 次(T 键)' },
  sailor:   { name: '摆渡客', desc: '乘小船往返湖心岛 6 趟' },
  slayer:   { name: '百战游侠', desc: '击败 100 个敌人' },
  ironarm:  { name: '铁臂之上', desc: '掰手腕赢下铁臂加隆 3 次' },
  homeowner:{ name: '置业成家', desc: '买下苇岸边的湖畔小屋' },
  wishkeeper:{ name: '代它看世界', desc: '替这颗心实现 3 个心愿(夜里有萤火谢你)' },
  mage:     { name: '半路出家的法师', desc: '施放 30 次法术' },
  dovah:    { name: '龙之传人', desc: '在龙骨之地的龙颅前学会冲击战吼' },
  cutpurse: { name: '三只手', desc: '扒窃得手 5 次' },
  walldef:  { name: '南门之盾', desc: '击退黑石兄弟会的劫掠' },
  executioner: { name: '断头台的同行', desc: '处决 10 个踉跄中的敌人' },
  vendetta:  { name: '斩草除根', desc: '了结黑石兄弟会的报复(斩杀刻刀维克)' },
  blackmkt:  { name: '黑市常客', desc: '向玛尔戈销赃 10 件' },
  elder:    { name: '长住者', desc: '在艾尔德里亚度过 30 日' },
  navigator:{ name: '远行者', desc: '走到离王都一万步之外' },
};
export const stats = { thrown: 0, pecks: 0, wishes: 0, drunks: 0, loseStreak: 0, sheepDist: 0, lastStomp: -99, deer: 0, mushrooms: 0 };
export const achUnlocked = [];
export function unlockAch(key) {
  if (achUnlocked.includes(key)) return;
  achUnlocked.push(key);
  sfx.fanfare();
  toast(`🏆 无意义成就:${ACH_DEFS[key].name} —— ${ACH_DEFS[key].desc}`, 4);
  remember(`做成了一件事,人称「${ACH_DEFS[key].name}」`, `ach-${key}`);
  if (player.home) refreshTrophies(); // 新战利品当场挂上外墙
  saveGame();
}

