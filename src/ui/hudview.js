// HUD 视图:每帧把玩法状态刷到屏幕(红心/金币/通缉星/任务栏/装备与法力/日期天气/交互提示/体力条/Boss 血条),
// 拼成一个签名串比对,没变就不碰 DOM(体力条例外,直刷);底部技能栏(按键 + 图标 + 冷却遮罩);H 键操作说明;区域名浮现。
// 图标本身(SVG)在 ui/hud.js。对外:updateHUD()、updateActionBar()、abHighlight(key)(教学卡高亮某个键)、
// toggleHint()/hintVisible、updateRegion(dt)。只读玩法状态,不改。
import { player, started, world } from '../core/state.js';
import { dist2 } from '../entities.js';
import { REGIONS } from '../story.js';
import { stats, unlockAch } from '../systems/achievements.js';
import {
  SEASONS, SEASON_ICON, dayPhase, isWinter, seasonDay, seasonIdx, todaySpecial,
} from '../systems/calendar.js';
import { lockFoe } from '../systems/combat.js';
import { dragonRT } from '../systems/dragon.js';
import { arenaRT } from '../systems/events.js';
import { ARMORS, WEAPONS } from '../systems/gear.js';
import { promptText } from '../systems/interact.js';
import { wanted } from '../systems/law.js';
import { SPELLS, shout } from '../systems/magic.js';
import { crestsFound } from '../systems/pickups.js';
import { prologue } from '../systems/prologue.js';
import { canAcceptRemotely, missions, quest, questRT, stewardWhere } from '../systems/quests.js';
import { playerFarFromTown, warband } from '../systems/warband.js';
import { weather } from '../systems/weather.js';
import { CORE, wildRegionName } from '../wilderness.js';
import { heartsHTML, iconHTML, manaHTML, richText, svgIcon, wantedHTML, weatherHTML } from './hud.js';

// ================= HUD 面板引用 =================
const $hud = (id) => document.getElementById(id);
const heartsEl = $hud('hearts'), coinsEl = $hud('coins'), wantedEl = $hud('wanted'),
  missionEl = $hud('mission'), promptEl = $hud('prompt'),
  weatherEl = $hud('weather'), equipEl = $hud('equip'),
  bosshpEl = $hud('bosshp'), bosshpFillEl = $hud('bosshp-fill'), bosshpLabelEl = bosshpEl.querySelector('.label'),
  staminaEl = $hud('stamina'), staminaFillEl = $hud('stamina-fill');

// ================= 操作说明:按 H 弹出的分组面板(不再常驻字墙) =================
const hintEl = document.getElementById('controls-hint');
export let hintVisible = false;
export function toggleHint() {
  hintVisible = !hintVisible;
  hintEl.style.opacity = hintVisible ? 1 : 0;
}

// ================= 技能栏:按键 + 图标 + 冷却遮罩(新玩家一眼看懂能干什么) =================
export const abEl = document.getElementById('actionbar');
export function abHighlight(key) {
  for (const sl of AB_SLOTS) if (sl.el) sl.el.classList.toggle('hint', !!key && sl.key === key);
}
const AB_SLOTS = [
  { key: 'F', name: '攻击', icon: () => WEAPONS[player.weapon].icon,
    cd: () => (player.attackT > 0 ? player.attackT / (player.attackDur || 0.3) : 0) },
  { key: '右键', name: '格挡', icon: () => '🛡️', on: () => player.blocking, off: () => player.weapon === 'bow' },
  { key: 'C', name: '翻滚', icon: () => '🌀', cd: () => Math.max(0, player.rollCd || 0) / 0.95 },
  { key: 'R', name: () => (player.spells.length ? SPELLS[player.spells[player.spellIdx]].name : '法术'),
    icon: () => (player.spells.length ? SPELLS[player.spells[player.spellIdx]].icon : '✴️'),
    cd: () => (player.spells.length ? Math.max(0, player.castT) / SPELLS[player.spells[player.spellIdx]].cd : 0),
    sub: () => `${Math.floor(player.mp)}`, off: () => !player.spells.length },
  { key: 'X', name: '战吼', icon: () => '🐉', show: () => shout.learned,
    cd: () => Math.max(0, shout.cd) / (stats.dragonSlain ? 22.5 : 45) },
  { key: 'Tab', name: '锁定', icon: () => '🎯', on: () => !!lockFoe },
  { key: 'Z', name: '潜行', icon: () => '🤫', on: () => player.sneaking },
  { key: 'Q', name: '换武器', icon: () => '🔄', show: () => player.weaponsOwned.length > 1 },
];
for (const sl of AB_SLOTS) {
  const d = document.createElement('div');
  d.className = 'ab-slot';
  d.innerHTML = '<div class="ab-icon"></div><div class="ab-cd"></div><div class="ab-key"></div>' +
    '<div class="ab-sub"></div><div class="ab-name"></div>';
  abEl.appendChild(d);
  sl.el = d;
  sl.iconEl = d.children[0]; sl.cdEl = d.children[1]; sl.subEl = d.children[3]; sl.nameEl = d.children[4];
  d.children[2].textContent = sl.key;
  sl.last = {};
}
export function updateActionBar() {
  abEl.style.display = started && !player.dead ? 'flex' : 'none';
  for (const sl of AB_SLOTS) {
    const L = sl.last;
    const show = !sl.show || sl.show();
    if (L.show !== show) { L.show = show; sl.el.style.display = show ? 'block' : 'none'; }
    if (!show) continue;
    const icon = sl.icon();
    if (L.icon !== icon) { L.icon = icon; sl.iconEl.innerHTML = iconHTML(icon); }
    const nm = typeof sl.name === 'function' ? sl.name() : sl.name;
    if (L.name !== nm) { L.name = nm; sl.nameEl.textContent = nm; }
    const cdv = sl.cd ? Math.round(Math.min(1, sl.cd()) * 20) * 5 : 0;
    if (L.cd !== cdv) { L.cd = cdv; sl.cdEl.style.height = `${cdv}%`; }
    const cls = `ab-slot${sl.on && sl.on() ? ' on' : ''}${sl.off && sl.off() ? ' off' : ''}`;
    if (L.cls !== cls) { L.cls = cls; sl.el.className = cls; }
    const sub = sl.sub ? sl.sub() : '';
    if (L.sub !== sub) { L.sub = sub; sl.subEl.textContent = sub; }
  }
}
// ================= 区域浮现(GTA 式) =================
const regionEl = document.getElementById('region');
let curRegion = '';
let regionCheckT = 0;
export function updateRegion(dt) {
  regionCheckT -= dt;
  if (regionCheckT > 0) return;
  regionCheckT = 0.5;
  let name = '艾尔德里亚原野';
  for (const r of REGIONS) {
    if (r.band !== undefined) { if (player.pos.z < r.band) { name = r.name; break; } continue; }
    if (dist2(player.pos.x, player.pos.z, r.x, r.z) < r.r * r.r) { name = r.name; break; }
  }
  // 核心之外:程序化荒野群系命名
  if ((name === '艾尔德里亚原野' || name === '北境群山') &&
      (Math.abs(player.pos.x) > CORE || Math.abs(player.pos.z) > CORE)) {
    name = wildRegionName(player.pos.x, player.pos.z);
    if (Math.max(Math.abs(player.pos.x), Math.abs(player.pos.z)) > 10000) unlockAch('navigator');
  }
  if (name !== curRegion) {
    curRegion = name;
    regionEl.textContent = name;
    regionEl.classList.remove('show');
    void regionEl.offsetWidth; // 重启 CSS 动画
    regionEl.classList.add('show');
  }
}
// ================= HUD 刷新 =================
let hudCache = '';
export function updateHUD() {
  // 体力条每帧直刷(绕过 hudCache):打斗中它一直在动
  if (started && !player.dead) {
    staminaEl.style.display = 'block';
    staminaFillEl.style.width = `${(player.sta / player.maxSta) * 100}%`;
    staminaFillEl.className = player.gaspT > 0 ? 'gasp' : '';
  } else staminaEl.style.display = 'none';
  const full = Math.floor(player.hp / 2);
  const half = player.hp % 2;
  const heartsMax = Math.ceil(player.maxHp / 2);
  const hearts = '❤️'.repeat(full) + (half ? '💔' : '') + '🖤'.repeat(Math.max(0, heartsMax - full - half));
  const stars = wanted > 0 ? '⭐'.repeat(wanted) + '✩'.repeat(5 - wanted) : '';
  let missionText;
  if (prologue.on) missionText = '⚔️ 序章:击退冲进村子的狼群';
  else if (quest.idx >= missions.length) missionText = '🏆 全部委托完成 — 去谒见领主,王国是你的了!';
  else if (!quest.active) {
    missionText = canAcceptRemotely()
      ? `📜 委托 ${quest.idx + 1}/${missions.length}:${missions[quest.idx].title} —— 按 E 原地接下(信使送来的委托书)`
      : `📜 委托 ${quest.idx + 1}/${missions.length}:去${stewardWhere()}找管家埃隆(按 E,光柱指路)`;
  }
  else {
    const m = missions[quest.idx];
    let prog = '';
    if (m.type === 'coins') prog = ` (${Math.min(quest.progress, m.goal)}/${m.goal})` + (quest.progress >= m.goal ? ' — 回去交任务!' : '');
    if (m.type === 'bandits' || m.type === 'wolves') prog = ` (${quest.progress}/${m.goal})`;
    if (m.type === 'race') prog = ` (金环 ${questRT.ringIdx}/${world.raceRoute.length})`;
    if (m.type === 'escort' && questRT.merchant) {
      prog = questRT.ambush ? ' —— 伏击!贴上去把伏兵引到自己身上' : ` (商人 ❤ ${Math.max(0, questRT.merchant.hp)}/${questRT.merchant.maxHp})`;
    }
    missionText = `📜 ${m.title}:${m.desc}${prog}`;
  }
  if (arenaRT.active) missionText = `🏟️ 竞技场:第 ${arenaRT.wave} 波(走出沙圈=认输)\n${missionText}`;
  const timerType = quest.active && (missions[quest.idx].type === 'deliver' || missions[quest.idx].type === 'race');
  const timer = timerType ? `⏱ ${Math.ceil(quest.timer)} 秒` : '';
  if (timer) missionText = `${timer}${quest.timer < 12 ? ' ⚠️' : ''}\n${missionText}`;
  if (dragonRT.on) missionText = `🐉 霜龙 ❤${Math.max(0, dragonRT.hp)}/${dragonRT.maxHp}` +
    `${dragonRT.phase === 'land' ? ' · 落地喘息:上刀!' : ' · 飞行中(弓/法术)'}\n` + missionText;
  if (warband.active) { // 战况横幅:战团还剩几个,一眼可知;人在 300 米外时改报"王都遭袭,离你多远"
    const wbAlive = warband.members.filter((b) => !b.dead);
    const lead = wbAlive[0];
    const far = playerFarFromTown() && lead;
    missionText = (far
      ? `${warband.siege ? '🚨 王都被围' : '⚔️ 王都遭袭'}(距你 ${Math.round(Math.hypot(lead.pos.x - player.pos.x, lead.pos.z - player.pos.z) / 10) * 10} 米):余 ${wbAlive.length}/${warband.members.length}`
      : `${warband.siege ? '🚨 攻城战' : '⚔️ 战团来袭'}:余 ${wbAlive.length}/${warband.members.length}` +
        `${warband.duelOn ? ' · 单挑中!' : ''}`) + '\n' + missionText;
  }
  missionText += `\n🛡️ 皇家纹章 ${crestsFound.length}/${world.crestSpots.length}`;
  const raining = weather.state === 'rain' || weather.state === 'storm';
  const wIcon = isWinter() && raining ? '🌨️' : { clear: '☀️', cloudy: '⛅', rain: '🌧️', storm: '⛈️' }[weather.state];
  const phaseIcon = { dawn: '🌅', day: '🌞', dusk: '🌇', night: '🌙' }[dayPhase()];
  const sp = todaySpecial();
  const calText = `${SEASON_ICON[seasonIdx()]}${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`;
  const bossHp = questRT.boss && !questRT.boss.dead && quest.active ? questRT.boss.hp : -1;
  const mcHp = questRT.merchant && quest.active ? questRT.merchant.hp : -1;
  const key = hearts + '|' + player.coins + '|' + player.weapon + player.armor + (player.relic ? 'R' : '') + '|' + stars + '|' + missionText + '|' + timer + '|' + promptText + '|' + wIcon + phaseIcon + calText + '|' + bossHp + '|' + mcHp + '|' + Math.floor(player.mp) + player.spellIdx + player.spells.length;
  if (key === hudCache) return;
  hudCache = key;
  weatherEl.innerHTML = weatherHTML(seasonIdx(), `${SEASONS[seasonIdx()]}·${seasonDay()}日${sp ? '·' + sp.name : ''}`,
    dayPhase(), weather.state, isWinter() && raining);
  heartsEl.innerHTML = heartsHTML(full, half, heartsMax - full - half);
  coinsEl.innerHTML = `${svgIcon('coin')}<span>${player.coins}</span>`;
  wantedEl.innerHTML = wantedHTML(wanted);
  wantedEl.style.display = wanted > 0 ? 'block' : 'none';
  missionEl.innerHTML = richText(missionText);
  const wDef = WEAPONS[player.weapon];
  equipEl.innerHTML = // 法术/冷却改由底部技能栏显示,这里只留装备与法力(统一 SVG 图标)
    `${iconHTML(wDef.icon, 'ico-s')}<span>${wDef.name}${player.swordLv >= 2 ? '+1' : ''}</span>${player.relic ? svgIcon('relic', 'ico-s') : ''}` +
    (player.armor ? `<span class="eq-sep">·</span>${svgIcon('armor', 'ico-s')}<span>${ARMORS[player.armor].name}</span>` : '') +
    (player.spells.length
      ? `<span class="eq-sep">·</span><span>法力</span>${manaHTML(Math.floor(player.mp), player.maxMp)}` : '');
  promptEl.innerHTML = richText(promptText);
  promptEl.style.display = promptText ? 'block' : 'none';
  // 顶部大血条:Boss 战期间是巴罗克;护送时是商人巴特(他倒下委托就失败,血量一眼可见)
  const boss = questRT.boss, mc = questRT.merchant;
  const bar = boss && !boss.dead && quest.active ? { name: '血斧巴罗克', hp: boss.hp, max: boss.maxHp || boss.hp }
    : mc && quest.active ? { name: '🧳 商人巴特', hp: mc.hp, max: mc.maxHp } : null;
  if (bar) {
    bosshpEl.style.display = 'block';
    bosshpLabelEl.innerHTML = richText(bar.name);
    bosshpFillEl.style.width = `${Math.max(0, Math.min(1, bar.hp / bar.max)) * 100}%`;
  } else {
    bosshpEl.style.display = 'none';
  }
}
