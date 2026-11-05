// 内容自进化:传说基因池(事迹像谣言一样代代变异)、狼群世代(猎杀压力)、敌人战术(被砍学格挡、被射学闪箭)、
// 导演排片适应度、活语料。状态全在 EVO(随存档)。
// 对外:seedLegend/mutateLegend/evolveLegends/legendText、evolveTactics、growCorpus —— 换日时由 calendar.newDay 依次调用;
// 狼群换代的数值读 EVO.wolfGen/wolfSpeed(actors.addWolf、ai.updateWolves)。
import { AI_TEXT_OFF, aiLine } from '../core/aitext.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import * as BANKS from '../dialogue-banks.js';
import { toast } from '../ui/toast.js';
import { SEASONS, seasonDay, seasonIdx, todaySpecial } from './calendar.js';
import { chronicle, remember, wsReport } from './mind.js';

// ================= 内容自进化:传说 × 生态 × 导演 =================
// 游戏内容自己长:你的事迹像谣言一样代代变异(文化演化);狼群在猎杀压力下
// 一代比一代精(生态演化);事件导演按你真正参与过什么自然选择戏码(排片演化)。
// 全部随存档持久化——这个世界离开你也在长,回来时已不是你走时的样子。
export const EVO = {
  legends: [],                 // 传说基因池:{src, base, extra, gen, heat}
  wolfGen: 1, wolfPressure: 0, wolfSpeed: 0, // 狼群世代/猎杀压力/累计提速
  eventFit: {},                // 导演事件适应度:参与 +1,冷场 -0.3
  tactics: { block: 0, dodge: 0 }, // 敌人战术演化:被砍多了学格挡,被射多了学闪身
  kills: { melee: 0, arrow: 0 },   // 当日击杀方式统计(选择压力的原料)
  corpus: [],                  // 活语料:世界自己写的新台词,永久入库(上限 40)
};
const LEGEND_EMBELLISH = ['——亲眼所见的人都这么说', ',连卫兵都点了头', ',那天风都停了半刻',
  ',据说月亮探出头看了一眼', ',酒馆里为这个干了三杯', ',吟游诗人已经在编曲子了'];
const LEGEND_SWAPS = [['独自', '单枪匹马'], ['赢了', '不费吹灰之力赢了'], ['救回', '徒手救回'],
  ['击退', '一声吼就击退'], ['缉拿', '谈笑间缉拿'], ['钓上', '赤手抓上'], ['买下', '一掷千金买下'],
  ['猎到', '闭着眼猎到'], ['撂倒', '用小拇指撂倒'], ['掰手腕', '隔着桌子掰手腕']];
export function legendText(l) { return l.base + (l.extra || ''); }
export function seedLegend() {
  const cands = chronicle.filter((m) => !m.t.startsWith('它') && !EVO.legends.some((L) => L.src === m.t));
  if (!cands.length) return;
  const m = cands[Math.floor(rand() * cands.length)];
  EVO.legends.push({ src: m.t, base: `绿衣游侠${m.t}`, extra: '', gen: 1, heat: 1 });
  if (EVO.legends.length > 10) { // 选择:热度垫底的传说被人遗忘
    EVO.legends.sort((a, b) => b.heat - a.heat);
    EVO.legends.length = 10;
  }
}
export function mutateLegend(l) {
  l.gen++;
  l.base = l.base.replace(/\d+/g, (n) => String(Math.min(999, Math.ceil(+n * (1.4 + rand()))))); // 数字越传越大
  const sw = LEGEND_SWAPS[Math.floor(rand() * LEGEND_SWAPS.length)];
  if (l.base.includes(sw[0]) && !l.base.includes(sw[1])) l.base = l.base.replace(sw[0], sw[1]);
  l.extra = LEGEND_EMBELLISH[Math.floor(rand() * LEGEND_EMBELLISH.length)];
  if (!AI_TEXT_OFF && rand() < 0.5) { // 联网时让 AI 来当"以讹传讹"的那张嘴
    aiLine(`把这句关于绿衣游侠林恩的传闻再夸张一点点,像民间以讹传讹又传了一代:「${l.base}」。25字以内,只输出新传闻本身。`, null, 7000)
      .then((t) => { if (t && t.length < 60) l.base = t.replace(/[「」"']/g, ''); });
  }
}
export function evolveLegends() { // 每过一夜,总有一条传闻长出新的枝节
  if (EVO.legends.length < 3) seedLegend();
  if (!EVO.legends.length) return;
  mutateLegend(EVO.legends[Math.floor(rand() * EVO.legends.length)]);
}
// 敌人战术演化:匪帮复盘自己怎么死的,学出针对性的反制(智能自进化)
export function evolveTactics() {
  const { melee, arrow } = EVO.kills;
  const total = melee + arrow;
  if (total >= 3) {
    const b0 = EVO.tactics.block, d0 = EVO.tactics.dodge;
    EVO.tactics.block = Math.min(0.6, EVO.tactics.block + 0.1 * (melee / total));
    EVO.tactics.dodge = Math.min(0.6, EVO.tactics.dodge + 0.1 * (arrow / total));
    if (b0 < 0.25 && EVO.tactics.block >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始格挡刀剑!(重击和跳劈可以破防)', 5);
      remember('盗贼们学会了格挡,和从前不一样了');
    }
    if (d0 < 0.25 && EVO.tactics.dodge >= 0.25) {
      toast('🧠 黑石兄弟会学乖了——他们开始侧身闪箭!(贴近了射,或换法术)', 5);
      remember('盗贼们学会了闪箭,和从前不一样了');
    }
  } else {
    EVO.tactics.block = Math.max(0, EVO.tactics.block - 0.02); // 没人打他们,手艺也会生疏
    EVO.tactics.dodge = Math.max(0, EVO.tactics.dodge - 0.02);
  }
  EVO.kills = { melee: 0, arrow: 0 };
}
// 语料自生长:世界每天给自己写一句新传闻,写进永久语料库(联网 AI 执笔;离线拼接变异)
export function growCorpus() {
  const push = (t) => {
    if (!t || t.length < 6 || t.length > 60 || EVO.corpus.includes(t)) return;
    EVO.corpus.push(t);
    if (EVO.corpus.length > 40) EVO.corpus.shift();
  };
  if (!AI_TEXT_OFF) {
    const sp = todaySpecial();
    aiLine(
      `你是中世纪王国艾尔德里亚的市井谣言本身。现在是${SEASONS[seasonIdx()]}季第${seasonDay()}日` +
      `${sp ? '·' + sp.name : ''}。${wsReport().slice(0, 60)}` +
      `写一条25字以内全新的市井传闻(不要提绿衣游侠),要有画面感。只输出传闻本身。`, null, 8000,
    ).then((t) => { if (t) { push(t.replace(/[「」"']/g, '')); saveGame(); } });
  } else {
    // 离线:从写好的传闻里挑一整条流传开(以前把两句剪开重新缝,缝出来的多是病句)
    push(BANKS.RUMORS[Math.floor(rand() * BANKS.RUMORS.length)]);
  }
}





