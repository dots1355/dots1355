// E 键交互的唯一来源:tryInteract(probe) 按优先级逐条试有序规则表 INTERACTIONS(单挑、委托书、收杆、扔鸡、下马/上马优先、
// 具名 NPC 与委托、事件人物、搞笑 NPC、信箱、小屋、各处告示板与玩法点、村民、喷泉、宝箱……最后才是墓志铭与上马)。
// 每条规则 { name, run(probe) } 自带提示文字:probe=true 时只返回提示 {text,x,z,h} 不改状态,不归它管就返回 PASS。
// computePrompt() 就是 tryInteract 的试运行(提示与实际行为不可能不一致)。
// 也在这里:头顶的交互目标标记(initInteract / updateInteractMarker)、updatePrompt(每 3 帧试运行一次)、墓志铭 readEpitaph。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { COMEDY_LINES, EPITAPHS } from '../content-packs.js';
import { AI_TEXT_OFF, aiBusy, aiLine } from '../core/aitext.js';
import { frame } from '../core/frame.js';
import { rand } from '../core/rng.js';
import { saveGame } from '../core/save.js';
import { colliders, player, started, world } from '../core/state.js';
import { dist2, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { DIALOGS, LORE } from '../story.js';
import {
  NPC_DESC_EN, VILLAGER_DESC_EN, dbLine, dialog, npcTalk, openDialog, witchFortune,
} from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import {
  BOAT_ISLE, BOAT_PIER, CHORE_POS, DGN, FISH_SPOT, FISH_SPOT_ISLE, NOTICE_POS, TRIAL_FLAG,
  blessedToday, choreBoard, choreProgress, choreReady, composeProclaimOffline, endTrial, enterDungeon,
  exitDungeon, fishing, fishingReel, inDungeon, lakeBlessed, loreRead, loreStones, nearestSpot,
  prayAltar, prayAtChapel, proclaimText, queueDream, readLore, refreshProclaim, rowTo, sideQuest,
  startFishing, startTrial, takeRelic, trialRT,
} from './activities.js';
import { addHorse, horses, villagers } from './actors.js';
import {
  SEASONS, calendar, dayPhase, seasonDay, seasonIdx, sleepToMorning, todaySpecial,
} from './calendar.js';
import { setLockFoe } from './combat.js';
import { director } from './director.js';
import { HOST_LINES, arenaHost, arenaRT, bountyRT, takeBounty, wantedPosterSpeaker } from './events.js';
import { EVO, legendText } from './evo.js';
import { chickens, frostfang, mushrooms, tameFrostfang } from './fauna.js';
import { openShop } from './gear.js';
import { HOME, homeInteract } from './home.js';
import { locked } from './input.js';
import { clearWanted, crime, wanted } from './law.js';
import { DRAGON_SKULL, learnShout, learnSpell, shout } from './magic.js';
import { hireMerc, mercs } from './mercs.js';
import { MIRROR_POS, chronicleDeeds, mirrorTalk, recallLine, remember, workspace, wsReport } from './mind.js';
import {
  EXTRA_NPCS, armRT, armWrestle, bardSong, fountainWish, funnyNPCs, gamble, namedNPCs, tellStory,
} from './npcs.js';
import { addPickup } from './pickups.js';
import { canAcceptRemotely, missions, quest, questRT, talkQuestGiver } from './quests.js';
import { vendettaRead } from './vendetta.js';
import { warband } from './warband.js';
import { weather } from './weather.js';

// ================= 交互目标标记(头顶金色小箭头) =================
const interactMarker = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 4),
  new THREE.MeshBasicMaterial({ color: 0xffd83d, transparent: true, opacity: 0.85 }));
let promptTargetPos = null;
export function initInteract() {
  interactMarker.rotation.x = Math.PI;
  interactMarker.visible = false;
  scene.add(interactMarker);
}
// 金色小箭头悬在当前交互目标头顶,上下浮动、慢慢转
export function updateInteractMarker(dt, now) {
  if (promptTargetPos && !dialog.open) {
    interactMarker.visible = true;
    interactMarker.position.set(
      promptTargetPos.x,
      promptTargetPos.y + 0.35 + Math.sin(now * 0.005) * 0.1,
      promptTargetPos.z);
    interactMarker.rotation.y += dt * 3;
  } else {
    interactMarker.visible = false;
  }
}

// ================= 交互 =================
export let promptText = '';
// E 键交互的唯一来源:同一套判定既执行动作,也给出提示文字与目标位置。
// probe=true 时只"试运行":命中哪条就返回 { text, x, z, h },不改任何状态(computePrompt 用它显示提示)。
// 以前提示与交互是两份手抄的判定,顺序和条件早已分叉(比如单挑没有提示);现在不可能再对不上。
// 能骑的坐骑:2.65 米内最近的一匹;任务马(雪影)在场时优先它
function nearestMountable() {
  let best = null, bd = 7;
  for (const h of horses) {
    const d = dist2(player.pos.x, player.pos.z, h.pos.x, h.pos.z) - (h === questRT.specialHorse ? 3 : 0);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
// 身边最近一个能说话的人(具名 NPC / 村民 / 趣味 NPC)的距离平方
function nearestTalkerD2() {
  let d = Infinity;
  for (const n of namedNPCs) d = Math.min(d, dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z));
  for (const v of villagers) if (!(v.downT > 0) && !v.sleeping) d = Math.min(d, dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z));
  for (const f of funnyNPCs) if (f && f.pos) d = Math.min(d, dist2(player.pos.x, player.pos.z, f.pos.x, f.pos.z));
  return d;
}
function mountHorse(h, probe) {
  if (probe) {
    return promptAt(h.sheep ? '按 E 骑羊(为什么不呢)' : h.playerHorse ? '按 E 骑上你的马'
      : h.owned && !h.stolen ? '按 E 偷马 (会引来通缉!)' : '按 E 骑马', h.pos.x, h.pos.z, h.sheep ? 1.4 : 2.7);
  }
  if (player.carrying) { player.carrying.state = 'idle'; player.carrying = null; }
  player.mounted = h;
  player.jumps = 0;
  if (h.sheep) remember('骑上了一头羊。羊没同意', 'firstsheep');
  else if (h.chunk) {
    remember('在无尽荒野驯服了一匹无主的野马', 'wildhorse');
    if (!h.aiName && !AI_TEXT_OFF) {
      h.aiName = true;
      aiLine('给一匹中世纪奇幻世界里刚被驯服的野马起一个两字中文名,只输出名字,不要引号和解释。', null, 6000)
        .then((t) => {
          if (t && t.trim().length <= 4) {
            const nm = t.trim();
            toast(`🐴 你给它取名「${nm}」。它甩了甩鬃毛,大概是同意了。`, 3.5);
            remember(`给驯服的野马取名「${nm}」`);
          }
        });
    }
  } else remember('第一次翻身上马', 'firstride');
  if (h.sheep) {
    sfx.baa();
    toast(rand() < 0.4 ? `🐑 ${COMEDY_LINES[Math.floor(rand() * COMEDY_LINES.length)]}` : '🐑 咩?!(它似乎认命了)', 2.5);
  } else {
    sfx.mount();
  }
  if (h.owned && !h.stolen) {
    h.stolen = true;
    crime(1, '你偷了一匹马!卫兵被惊动了!');
  }
}
// 规则"不归我管"时返回 PASS,交给下一条;其余返回值(probe 时的提示 {text,x,z,h},或已执行时的 undefined)
// 原样作为 tryInteract 的结果。表的顺序就是 E 键的优先级(越靠前越优先),改顺序要当心——interact/playFlow 用例在测。
const PASS = Symbol('pass');
// 交互提示:文字 + 头顶标记的位置(x/z 缺省 = 不标记)
function promptAt(text, x, z, h) { return { text, x, z, h }; }
const INTERACTIONS = [
  // 阵前单挑:攻城时冲到枭首面前按 E 应战
  { name: 'duel', run(probe) {
    if (warband.active && warband.siege && !warband.duelOn) {
      const lead = warband.members.find((b) => b.warlord && !b.dead);
      if (lead && dist2(player.pos.x, player.pos.z, lead.pos.x, lead.pos.z) < 81) {
        if (probe) return promptAt('按 E 向枭首发起单挑(赢了他带人撤走)', lead.pos.x, lead.pos.z, 2.6);
        warband.duelOn = true;
        for (const b of warband.members) if (!b.warlord) b._truce = true;
        setLockFoe(lead); // 镜头直接咬住对手
        toast('⚔️ 枭首狞笑:「有胆!就你我二人——赢了,我带人走;输了,城归我!」', 5);
        sfx.wanted();
        return;
      }
    }
    return PASS;
  } },
  // 信使送来的委托书:完成一单后 12 秒内按 E 原地接下一单(不计时的委托)
  { name: 'remoteQuest', run(probe) {
    if (canAcceptRemotely() && !player.mounted) {
      if (probe) return promptAt(`按 E 接下一单:${missions[quest.idx].title}(信使送来的委托书)`);
      quest.offerT = 0;
      talkQuestGiver(true);
      return;
    }
    return PASS;
  } },
  // 钓鱼中:收杆
  { name: 'reelIn', run(probe) {
    if (fishing.active) {
      if (probe) return promptAt(fishing.phase === 'bite' ? '‼️ 咬钩了!按 E 收杆!!' : '🎣 等鱼上钩……(走动收竿)');
      fishingReel();
      return;
    }
    return PASS;
  } },
  // 扔鸡(抱着鸡时 E 投掷)
  { name: 'throwCarried', run(probe) {
    if (player.carrying) {
      if (probe) return promptAt('按 E 扔鸡!');
      const c = player.carrying;
      player.carrying = null;
      c.state = 'thrown';
      c.pos.set(player.pos.x, player.pos.y + 1.9, player.pos.z);
      c.vel.set(Math.sin(player.yaw) * 8, 3.5, Math.cos(player.yaw) * 8);
      sfx.cluck();
      choreProgress('throw');
    if (++stats.thrown >= 10) unlockAch('chucker');
      return;
    }
    return PASS;
  } },
  // 下马
  { name: 'dismount', run(probe) {
    if (player.mounted) {
      if (probe) return promptAt(player.mounted.sheep ? '按 E 下羊(它松了口气)' : '按 E 下马');
      const h = player.mounted;
      player.mounted = null;
      player.pos.set(h.pos.x + Math.cos(h.yaw) * 1.3, 0, h.pos.z - Math.sin(h.yaw) * 1.3);
      resolveCollisions(player.pos, 0.45, colliders);
      return;
    }
    return PASS;
  } },
  // 上马优先:自己的马/任务马在 2.6 米内、而且比身边能说话的人更近——E 就是上马(限时委托中闲聊一律让位)
  { name: 'mountFirst', run(probe) {
    {
      const mh = nearestMountable();
      if (mh) {
        const hd = dist2(player.pos.x, player.pos.z, mh.pos.x, mh.pos.z);
        const mine = mh.playerHorse || mh === questRT.specialHorse;
        const timed = quest.active && (quest.timer || 0) > 0;
        const legal = !(mh.owned && !mh.stolen) && !mh.sheep; // 别因为赶时间顺手偷了马厩的马
        if ((mine || (timed && legal)) && (timed || hd < nearestTalkerD2())) return mountHorse(mh, probe);
      }
    }
    return PASS;
  } },
  // 具名 NPC(委托/商店/领主/故事对话)
  { name: 'namedNPCs', run(probe) {
    for (const n of namedNPCs) {
      if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
      const NP = (text) => promptAt(text, n.pos.x, n.pos.z, 2.15);
      // 管家埃隆:委托优先;没读过的人物章节先讲(讲完接着派委托)
      if (n.key === 'steward' && quest.idx < missions.length) {
        if (probe) return NP(quest.active ? `按 E 与管家埃隆交谈(进行中:${missions[quest.idx].title})` : '按 E 与管家埃隆交谈(接委托)');
        const d = DIALOGS.steward;
        const arcIdx = d ? d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1) : -1;
        if (!quest.active && arcIdx >= 0 && !(n.readArcs && n.readArcs.has(arcIdx))) {
          npcTalk(n, () => talkQuestGiver());
          return;
        }
        talkQuestGiver();
        return;
      }
      // 未读的故事章节优先
      const d = DIALOGS[n.key];
      if (d) {
        const arcIdx = d.arcs.reduce((best, a, i) => (quest.idx >= a.min ? i : best), -1);
        if (arcIdx >= 0 && !(n.readArcs && n.readArcs.has(arcIdx))) {
          if (probe) return NP(n.key === 'king' && quest.idx >= missions.length && !n.rewarded ? '按 E 领取领主的重赏' : `按 E 听${n.def.name}说说心里话`);
          n.readArcs = n.readArcs || new Set();
          // 领主终章附带赏金
          const grantKing = n.key === 'king' && quest.idx >= missions.length && !n.rewarded;
          npcTalk(n, grantKing ? () => {
            n.rewarded = true;
            player.coins += 100;
            sfx.fanfare();
            toast('💰 领主赏赐 100 金币!', 4);
            saveGame();
          } : null);
          return;
        }
      }
      // 商店行为
      if (n.key === 'blacksmith') {
        if (probe) return NP(wanted > 0 ? '按 E 找铁匠(他不和通缉犯做生意)' : '按 E 打开铁匠铺(武器/护甲)');
        if (wanted > 0) { openDialog(['格罗姆:(把铁钳一横)通缉犯?我不做黑生意。洗白了再来。']); return; }
        openShop();
        return;
      }
      if (n.key === 'trader' && !player.royalHorse) {
        if (probe) return NP('按 E 找马贩瑟尔玛(皇家骏马 80 金币)');
        if (wanted > 0) { openDialog(['瑟尔玛:(挡在马厩前)带着通缉令买马?马会被连坐充公的,快走!']); return; }
        if (player.coins >= 80) {
          player.coins -= 80;
          player.royalHorse = true;
          const rh = addHorse(world.stablePos.x - 3, world.stablePos.z - 3, 0xe8d9b0, false);
          rh.fast = true;
          rh.home.set(world.stablePos.x - 3, 0, world.stablePos.z - 3);
          sfx.fanfare();
          openDialog(['瑟尔玛:「疾风」交给你了。记住,喂它苹果时手要摊平——好了去吧,它等你等得直刨蹄子。']);
          saveGame();
        } else {
          openDialog(['瑟尔玛:80 金币,皇家骏马。分期?马又不能分期长大。']);
        }
        return;
      }
      if (n.key === 'innkeep' && calendar.letter && !player.home) { // 有房后信直接寄到家门口信箱
        if (probe) return NP('按 E 取信(有人写给你的)');
        const L = calendar.letter;
        calendar.letter = null;
        stats.letters = (stats.letters || 0) + 1;
        if (stats.letters >= 3) unlockAch('penpal');
        remember(`收到了${L.from}的一封信`);
        openDialog([
          '罗莎:(在围裙上擦了擦手,从兜里掏出一封信)喏,有人留给你的。',
          `(${L.from}的信)${L.text}`,
        ], null, { key: 'innkeep', name: '老板娘罗莎', desc: NPC_DESC_EN.innkeep, ent: n });
        if (L.from === '黑石兄弟会') vendettaRead();
        return;
      }
      if (n.key === 'innkeep' && player.venison > 0) {
        if (probe) return NP(`按 E 卖鹿肉 ×${player.venison}(每块 5 金币)`);
        const pay = player.venison * 5;
        openDialog([`罗莎:(眼睛一亮)新鲜鹿肉?!今晚炖肉管够了!${player.venison} 块,一共 ${pay} 金币,拿好!`]);
        player.coins += pay;
        player.venison = 0;
        sfx.coin();
        return;
      }
      if (n.key === 'innkeep' && (player.hp < player.maxHp || dayPhase() === 'night')) {
        if (probe) return NP(player.hp < player.maxHp ? '按 E 住店休息,回满生命(10 金币)' : '按 E 住店过夜,睡到天亮(10 金币)');
        if (wanted > 0) { openDialog(['罗莎:(压低声音)后门快走!卫兵刚搜过一轮,我可藏不住你。']); return; }
        if (player.coins >= 10) {
          player.coins -= 10;
          sfx.heart();
          sleepToMorning();
          queueDream();
          openDialog(['罗莎:(掀开门帘)天亮了,汤在灶上。伤都歇利索了吧?路上小心。']);
        } else {
          openDialog(['罗莎:住店 10 金币……先坐着喝口水吧,看你风尘仆仆的。']);
        }
        return;
      }
      if (n.key === 'innkeep' && player.drunkT <= 0) {
        if (probe) return NP('按 E 来一杯麦酒(2 金币)');
        // 满血就来一杯?
        if (player.coins >= 2) {
          player.coins -= 2;
          player.drunkT = 25;
          sfx.hiccup();
          if (++stats.drunks >= 3) unlockAch('drunkard');
          openDialog(['罗莎:(推来一大杯麦酒)自家酿的,后劲儿足——哎哎哎,你别一口闷啊!']);
        } else {
          openDialog(['罗莎:麦酒 2 金币。赊账?上一个赊账的还在后院劈柴呢。']);
        }
        return;
      }
      if (n.key === 'witch') {
        if (probe) {
          return NP(!player.spells.includes('fire') && player.coins >= 30 ? '按 E 买《火球术》卷轴(30 金币)'
            : player.loot > 0 ? `按 E 销赃 ×${player.loot}(每件 8 金币,不问来路)`
            : player.hp < player.maxHp ? '按 E 买回魂汤(8 金币)'
            : player.herbs > 0 ? `按 E 卖蘑菇 ×${player.herbs}(每朵 3 金币)`
            : player.coins >= 5 ? '按 E 求一卦(5 金币,她真算得准)' : '按 E 与沼泽女巫玛尔戈交谈');
        }
        if (!player.spells.includes('fire') && player.coins >= 30) {
          player.coins -= 30;
          sfx.chest();
          openDialog(['玛尔戈:(从袖子里抽出一卷焦边的羊皮纸)《火球术》。三十金币,童叟无欺。',
            '玛尔戈:念的时候手别抖——上一个手抖的,眉毛长了半年。'],
          () => learnSpell('fire'));
          return;
        }
        if (player.loot > 0) { // 销赃:她掂了掂,不问来路
          const pay = player.loot * 8;
          stats.fenced = (stats.fenced || 0) + player.loot;
          if (stats.fenced >= 10) unlockAch('blackmkt');
          player.coins += pay;
          sfx.coin();
          openDialog([`玛尔戈:(把${player.loot}件东西逐一对着月光掂了掂,金币从袖口滑出来)${pay} 枚。东西哪来的,我不问;钱哪去了,你也别说。`]);
          player.loot = 0;
          saveGame();
          return;
        }
        if (player.hp < player.maxHp) {
          if (player.coins >= 8) {
            player.coins -= 8;
            player.hp = player.maxHp;
            sfx.heart();
            openDialog(['玛尔戈:(舀了一勺冒泡的绿汤)喝。别问是什么,问了就不灵了。……看,好全了吧?']);
          } else {
            openDialog(['玛尔戈:一勺回魂汤,8 个金币。穷?那就去湖里洗把脸,精神精神。']);
          }
        } else if (player.herbs > 0) {
          const pay = player.herbs * 3;
          openDialog([`玛尔戈:(扒拉着你的蘑菇篓)成色不错……${player.herbs} 朵,${pay} 金币。别问进了哪口锅。`]);
          player.coins += pay;
          player.herbs = 0;
          sfx.coin();
        } else if (player.coins >= 5 && !aiBusy.fortune) {
          witchFortune(n);
        } else {
          openDialog([`玛尔戈:${EXTRA_NPCS.witch.lines[n.lineIdx++ % EXTRA_NPCS.witch.lines.length]}`], null,
            { key: null, name: '沼泽女巫玛尔戈', desc: NPC_DESC_EN.witch, ent: n });
        }
        return;
      }
      // 闲聊
      if (probe) return NP(n.key === 'king' ? '按 E 谒见领主' : `按 E 与${n.def.name}交谈`);
      npcTalk(n);
      return;
    }
    return PASS;
  } },
  // 神秘商人
  { name: 'mysticTrader', run(probe) {
    if (director.mystic && dist2(player.pos.x, player.pos.z, director.mystic.pos.x, director.mystic.pos.z) < 6) {
      if (probe) return promptAt('按 E 与兜帽商人交易(灵药 5 金币)', director.mystic.pos.x, director.mystic.pos.z, 2.15);
      if (player.hp < player.maxHp && player.coins >= 5) {
        player.coins -= 5;
        player.hp = player.maxHp;
        sfx.heart();
        openDialog(['兜帽商人:(递来一小瓶)喝吧。别问来路,好东西都没有来路。(生命全满)']);
      } else if (player.hp < player.maxHp) {
        openDialog(['兜帽商人:灵药 5 枚金币。没钱?缘分未到。']);
      } else {
        openDialog(['兜帽商人:你气色好得很,不需要我。有缘再会。(他朝虚空看了一眼)']);
      }
      return;
    }
    return PASS;
  } },
  // 智慧牛:提问
  { name: 'wiseCow', run(probe) {
    if (director.cow && dist2(player.pos.x, player.pos.z, director.cow.pos.x, director.cow.pos.z) < 8) {
      if (probe) return promptAt(`按 E 向牛提问(还能问 ${Math.max(0, 5 - director.cow.asked)} 次)`, director.cow.pos.x, director.cow.pos.z, 1.8);
      const cow = director.cow;
      cow.asked++;
      cow.nodT = 1.4;
      cow.nodYes = rand() < 0.5;
      const lines = [cow.nodYes ? '「哞——」它缓缓地、郑重地点了点头。' : '「哞?」它把头摇得像磨坊的风车。'];
      if (cow.asked === 1) lines.unshift('(你凑到牛耳边,问了一个藏在心里的问题)');
      if (cow.asked === 3) lines.push('农夫汉克远远喊道:「别信它!上回它点头说不下雨,结果淹了我半亩地!」');
      if (cow.asked >= 5) lines.push('牛嚼了口草,似乎不打算再回答任何问题了。');
      openDialog(lines);
      return;
    }
    return PASS;
  } },
  // 许愿池捞币人
  { name: 'wishThief', run(probe) {
    if (director.thief && dist2(player.pos.x, player.pos.z, director.thief.pos.x, director.thief.pos.z) < 6) {
      if (probe) return promptAt('按 E 咳嗽一声', director.thief.pos.x, director.thief.pos.z, 2.15);
      player.coins += 2;
      sfx.coin();
      openDialog([
        '你重重咳嗽了一声。捞币人吓得原地蹦起,塞给你 2 枚湿漉漉的金币:「嘘——我在帮湖神清点!对,清点!」',
        '(他一步三滑地溜进了夜色。喷泉里的愿望们松了口气。)',
      ]);
      if (director.handle) director.handle.t = Math.min(director.handle.t, 0.01);
      return;
    }
    return PASS;
  } },
  // 事件鸡优先(金鸡/越狱鸡:比旅店人群的交互更贴身优先)
  { name: 'eventChicken', run(probe) {
    for (const c of chickens) {
      if (!c.extra || c.state === 'thrown' || c === player.carrying) continue;
      if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
        if (probe) return promptAt(c.golden ? '按 E 抱住金鸡!!' : '按 E 抱住它!', c.pos.x, c.pos.z, 1.0);
        player.carrying = c;
        c.state = 'carried';
        sfx.cluck();
        toast('你一把抱住了它!', 2);
        return;
      }
    }
    return PASS;
  } },
  // 竞技场主持人
  { name: 'arenaHost', run(probe) {
    if (!arenaRT.active && dist2(player.pos.x, player.pos.z, arenaHost.pos.x, arenaHost.pos.z) < 7) {
      if (probe) return promptAt(`按 E 参加角斗(最佳纪录:${stats.arenaBest || 0} 波)`, arenaHost.pos.x, arenaHost.pos.z, 2.15);
      openDialog([
        `血牙:${HOST_LINES[arenaHost.lineIdx++ % HOST_LINES.length]}`,
        '血牙:想下场?站进沙圈,我一声锣响就开打。每清一波,赏金翻着涨。',
      ], () => {
        arenaRT.active = true;
        arenaRT.wave = 0;
        arenaRT.betweenT = 1.2;
        toast('🏟️ 角斗开始!站稳了!', 2.5);
      });
      return;
    }
    return PASS;
  } },
  // 搞笑 NPC
  { name: 'funnyNPCs', run(probe) {
    for (const n of funnyNPCs) {
      if (dist2(player.pos.x, player.pos.z, n.pos.x, n.pos.z) > 7) continue;
      if (probe) {
        return promptAt({
          gambler: '按 E 掷骰子(赌 10 金币)',
          bard: '按 E 点一首《你自己的歌》',
          prophet: '按 E 听老糊涂的预言(?)',
          quixote: '按 E 与风车骑士交谈',
          storyteller: '按 E 听苟叔说书',
          strongman: `按 E 掰手腕(赌 15 赢 30${stats.arms ? `,战绩 ${stats.arms} 胜` : ''})`,
          merccap: `按 E 雇佣剑士(40 金币+每日 5 饷,随行 ${mercs.length}/2)`,
        }[n.key] || `按 E 与${n.def.name}交谈`, n.pos.x, n.pos.z, 2.15);
      }
      if (n.key === 'gambler') { gamble(); return; }
      if (n.key === 'strongman') { armWrestle(); return; }
      if (n.key === 'merccap') { hireMerc(); return; }
      if (n.key === 'bard') { bardSong(); return; }
      if (n.key === 'storyteller') { tellStory(); return; }
      if (n.key === 'prophet') {
        if (aiBusy.prophet) return;
        aiBusy.prophet = true;
        const fb = n.def.idle[n.lineIdx++ % n.def.idle.length];
        const seen = recallLine();
        aiLine(
          '你是中世纪疯预言家老糊涂,总说些打破第四面墙的怪话(比如怀疑世界是个游戏)。' +
          (seen ? `你还"看见"了眼前这人的过去:${seen}。` : '') + wsReport() +
          '用中文说一句50字以内的疯预言,可以拿以上内容做文章。只输出预言本身。', fb, 5000)
          .then((line) => {
            aiBusy.prophet = false;
            if (!dialog.open && !player.dead) openDialog([`疯子老糊涂:${line}`]);
          });
        return;
      }
      openDialog([`${n.def.name}:${n.def.idle[n.lineIdx++ % n.def.idle.length]}`], null,
        { key: null, name: n.def.name, desc: NPC_DESC_EN[n.key], ent: n });
      return;
    }
    return PASS;
  } },
  // 自家信箱:有信时优先取信
  { name: 'mailbox', run(probe) {
    if (player.home && calendar.letter && dist2(player.pos.x, player.pos.z, HOME.x + 3.4, HOME.z + 3.2) < 5) {
      if (probe) return promptAt('按 E 开信箱(小红旗立着——有信!)', HOME.x + 3.4, HOME.z + 3.2, 1.8);
      const L = calendar.letter;
      calendar.letter = null;
      stats.letters = (stats.letters || 0) + 1;
      if (stats.letters >= 3) unlockAch('penpal');
      remember(`在自家信箱收到了${L.from}的一封信`);
      sfx.chest();
      openDialog(['(你掀开自家信箱的盖子,把小红旗放平——里面躺着一封信)', `(${L.from}的信)${L.text}`]);
      if (L.from === '黑石兄弟会') vendettaRead();
      return;
    }
    return PASS;
  } },
  // 龙骨之地的龙颅:习得战吼
  { name: 'dragonSkull', run(probe) {
    if (dist2(player.pos.x, player.pos.z, DRAGON_SKULL.x, DRAGON_SKULL.z) < 9) {
      if (probe) return promptAt(shout.learned ? '(龙颅无话可教了。去吼吧——X 键)' : '按 E 把手放上龙颅', DRAGON_SKULL.x, DRAGON_SKULL.z, 2.5);
      learnShout();
      return;
    }
    return PASS;
  } },
  // 湖畔小屋:买房 / 回家安眠
  { name: 'home', run(probe) {
    if (dist2(player.pos.x, player.pos.z, HOME.doorX, HOME.doorZ) < 6) {
      if (probe) {
        return promptAt(!player.home
          ? (player.coins >= HOME.price ? `按 E 买下湖畔小屋(${HOME.price} 金币)` : `(出售)湖畔小屋 ${HOME.price} 金币,还差 ${HOME.price - player.coins}`)
          : player.homeDay === calendar.day ? '(安眠中:移动 +8%。明天再睡)' : '按 E 回屋睡一觉(安眠:移动 +8%)', HOME.x, HOME.z, 3.2);
      }
      homeInteract();
      return;
    }
    return PASS;
  } },
  // 悬赏板
  { name: 'bountyBoard', run(probe) {
    if (dist2(player.pos.x, player.pos.z, 8, 46) < 8) {
      if (probe) {
        return promptAt(wanted > 0 ? `按 E 缴罚金撤销通缉(${wanted * 20} 金币)` : bountyRT.target ? '按 E 查看悬赏令' : '按 E 揭悬赏令(赏金 30)', 8, 46, 2.4);
      }
      if (wanted > 0) {
        const fine = wanted * 20;
        if (player.coins >= fine) {
          player.coins -= fine;
          clearWanted();
          sfx.clear();
          openDialog([`(你把 ${fine} 枚金币塞进告示板下的罚金箱)卫兵把你的通缉令撕了下来。你自由了——暂时。`]);
        } else {
          openDialog([`(告示板)你的通缉罚金是 ${fine} 金币,兜里不够。要么凑钱,要么躲风头。`]);
        }
        return;
      }
      if (bountyRT.target) openDialog([`(告示板)悬赏令仍在追缉中——「${bountyRT.name}」,${bountyRT.crime ? `罪状:${bountyRT.crime}` : '生死不论'}。`], null, wantedPosterSpeaker());
      else if (bountyRT.cooldown > 0) openDialog(['(告示板)新的悬赏令还没贴出来,过一会儿再来看看。']);
      else takeBounty();
      return;
    }
    return PASS;
  } },
  // 王国公告牌(每日 AI 撰写;日期对不上就重写,防陈旧)
  { name: 'noticeBoard', run(probe) {
    if (dist2(player.pos.x, player.pos.z, NOTICE_POS.x, NOTICE_POS.z) < 6) {
      if (probe) return promptAt('按 E 看今日王国公告', NOTICE_POS.x, NOTICE_POS.z, 2.2);
      if (!proclaimText || !proclaimText.includes(`第 ${seasonDay()} 日`)) refreshProclaim();
      openDialog([proclaimText || composeProclaimOffline()]);
      return;
    }
    return PASS;
  } },
  // 村务板(无限支线)
  { name: 'choreBoard', run(probe) {
    if (dist2(player.pos.x, player.pos.z, CHORE_POS.x, CHORE_POS.z) < 6) {
      if (probe) {
        return promptAt(!sideQuest.active ? '按 E 接一桩村务(无限)'
          : choreReady() ? '按 E 交差领赏!' : `按 E 看村务进度(${sideQuest.giver})`, CHORE_POS.x, CHORE_POS.z, 2.2);
      }
      choreBoard();
      return;
    }
    return PASS;
  } },
  // 世界观铭文
  { name: 'loreStones', run(probe) {
    for (const s of loreStones) {
      if (dist2(player.pos.x, player.pos.z, s.def.x, s.def.z) < 8) {
        if (probe) {
          return promptAt(loreRead.includes(LORE.indexOf(s.def))
            ? `按 E 重读铭文《${s.def.title}》` : `按 E 阅读铭文(${loreRead.length}/${LORE.length})`, s.def.x, s.def.z, 2.0);
        }
        readLore(s);
        return;
      }
    }
    return PASS;
  } },
  // 王室地窖:暗门进出与圣坛
  { name: 'cryptHatch', run(probe) {
    if (dist2(player.pos.x, player.pos.z, DGN.hatch.x, DGN.hatch.z) < 6) {
      if (probe) return promptAt('按 E 掀开暗门(被封印的地窖)', DGN.hatch.x, DGN.hatch.z, 1.2);
      enterDungeon();
      return;
    }
    return PASS;
  } },
  { name: 'crypt', run(probe) {
    if (inDungeon()) {
      if (dist2(player.pos.x, player.pos.z, DGN.exit.x, DGN.exit.z) < 6) {
        if (probe) return promptAt('按 E 爬回地面', DGN.exit.x, DGN.exit.z, 1.2);
        exitDungeon();
        return;
      }
      if (dist2(player.pos.x, player.pos.z, DGN.relic.x, DGN.relic.z) < 6) {
        if (probe) return promptAt(player.relic ? '(空了的圣坛)' : '按 E 请下「先王战徽」', DGN.relic.x, DGN.relic.z, 1.6);
        takeRelic();
        return;
      }
    }
    return PASS;
  } },
  // 湖上摆渡与月光祭坛
  { name: 'ferryPier', run(probe) {
    if (dist2(player.pos.x, player.pos.z, BOAT_PIER.x, BOAT_PIER.z) < 8) {
      if (probe) return promptAt('按 E 划船去湖心岛', BOAT_PIER.x, BOAT_PIER.z, 1.2);
      rowTo({ x: -100, z: 102.5 }, '🏝️ 湖心岛。断柱与祭坛都在水声里等你。');
      return;
    }
    return PASS;
  } },
  { name: 'ferryIsle', run(probe) {
    if (dist2(player.pos.x, player.pos.z, BOAT_ISLE.x, BOAT_ISLE.z) < 6) {
      if (probe) return promptAt('按 E 划船回栈桥', BOAT_ISLE.x, BOAT_ISLE.z, 1.2);
      rowTo({ x: -99.4, z: 83 }); // 落在栈桥桥面上(桥面宽 2.2m,两侧是水)
      return;
    }
    return PASS;
  } },
  { name: 'moonAltar', run(probe) {
    if (dist2(player.pos.x, player.pos.z, -100, 100.5) < 5) {
      if (probe) return promptAt(lakeBlessed ? '(祭坛记得你)' : '按 E 触碰月光祭坛', -100, 100.5, 1.6);
      prayAltar();
      return;
    }
    return PASS;
  } },
  // 栈桥垂钓 / 湖心岛深水垂钓
  { name: 'fishPier', run(probe) {
    if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT.x, FISH_SPOT.z) < 10) {
      if (probe) return promptAt('按 E 垂钓', FISH_SPOT.x, FISH_SPOT.z, 1.6);
      startFishing();
      return;
    }
    return PASS;
  } },
  { name: 'fishIsle', run(probe) {
    if (!player.mounted && dist2(player.pos.x, player.pos.z, FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z) < 7) {
      if (probe) return promptAt('按 E 深水垂钓(岛边的鱼更肥)', FISH_SPOT_ISLE.x, FISH_SPOT_ISLE.z, 1.4);
      startFishing(true);
      return;
    }
    return PASS;
  } },
  // 赛马计时赛
  { name: 'timeTrial', run(probe) {
    if (dist2(player.pos.x, player.pos.z, TRIAL_FLAG.x, TRIAL_FLAG.z) < 8) {
      if (probe) {
        return promptAt(trialRT.active ? '按 E 放弃计时赛'
          : `按 E 开始赛马计时赛${stats.raceBest ? `(纪录 ${stats.raceBest.toFixed(1)}s)` : ''}`, TRIAL_FLAG.x, TRIAL_FLAG.z, 3.0);
      }
      if (trialRT.active) endTrial(false);
      else startTrial();
      return;
    }
    return PASS;
  } },
  // 白狼霜牙:喂鹿肉驯服
  { name: 'tameFrostfang', run(probe) {
    if (!frostfang.tamed && frostfang.wary &&
        dist2(player.pos.x, player.pos.z, frostfang.wary.pos.x, frostfang.wary.pos.z) < 26) {
      if (probe) {
        return promptAt(player.venison > 0 ? `按 E 喂鹿肉给白狼(驯服 ${frostfang.feed}/3)` : '🐺 白狼想要鹿肉(去猎一头鹿)',
          frostfang.wary.pos.x, frostfang.wary.pos.z, 1.3);
      }
      if (player.venison > 0) {
        player.venison--;
        frostfang.feed++;
        sfx.heart();
        if (frostfang.feed >= 3) tameFrostfang();
        else toast(`🐺 白狼叼走了鹿肉,退开两步,眼神软了一点(${frostfang.feed}/3)`, 3.5);
      } else {
        toast('🐺 白狼盯着你的手——它想要的是鹿肉。', 2.5);
      }
      return;
    }
    return PASS;
  } },
  // 篝火烤肉
  { name: 'campfire', run(probe) {
    {
      const cf = nearestSpot('campfire', 30);
      if (cf && player.venison > 0) {
        if (probe) return promptAt(`按 E 烤鹿肉(回 ❤×1.5,剩 ×${player.venison})`, cf.x, cf.z, 1.2);
        player.venison--;
        player.hp = Math.min(player.maxHp, player.hp + 3);
        sfx.heart();
        stats.cooked = (stats.cooked || 0) + 1;
        choreProgress('cook');
        if (stats.cooked >= 5) unlockAch('chef');
        toast(`🍖 烤鹿肉滋滋作响……回复 ❤×1.5(剩余鹿肉 ×${player.venison})`, 3);
        return;
      }
    }
    return PASS;
  } },
  // 遗迹教堂:祈祷得庇佑(每日一次)
  { name: 'chapel', run(probe) {
    {
      const ch = nearestSpot('chapel', 30);
      if (ch) {
        if (probe) return promptAt(!blessedToday() ? '按 E 在石坛前祈祷(获得庇佑)' : '(神明今日已听过你的祷告)', ch.x, ch.z, 2.0);
        prayAtChapel();
        return;
      }
    }
    return PASS;
  } },
  // 回响之镜:与世界的意识对话
  { name: 'mirror', run(probe) {
    if (dist2(player.pos.x, player.pos.z, MIRROR_POS.x, MIRROR_POS.z) < 9) {
      if (probe) return promptAt('按 E 凝视回响之镜', MIRROR_POS.x, MIRROR_POS.z, 2.3);
      mirrorTalk();
      return;
    }
    return PASS;
  } },
  // 采蘑菇
  { name: 'mushrooms', run(probe) {
    for (const m of mushrooms) {
      if (!m.picked && dist2(player.pos.x, player.pos.z, m.x, m.z) < 4) {
        if (probe) return promptAt('按 E 采蘑菇', m.x, m.z, 0.8);
        m.picked = true;
        m.group.visible = false;
        player.herbs++;
        stats.mushrooms = (stats.mushrooms || 0) + 1;
        if (stats.mushrooms >= 15) unlockAch('forager');
        sfx.coin();
        toast(`🍄 采到一朵伞菇(篓里 ×${player.herbs},女巫玛尔戈按 3 金币收)`, 2.5);
        return;
      }
    }
    return PASS;
  } },
  // 抱鸡(半径小,贴身优先)
  { name: 'pickChicken', run(probe) {
    for (const c of chickens) {
      if (c.state === 'thrown') continue;
      if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) < 3.5) {
        if (probe) return promptAt('按 E 抱起鸡(为什么?)', c.pos.x, c.pos.z, 1.0);
        player.carrying = c;
        c.state = 'carried';
        sfx.cluck();
        toast(rand() < 0.4 ? `🐔 ${COMEDY_LINES[Math.floor(rand() * COMEDY_LINES.length)]}` : '你抱起了一只鸡。它一脸问号。', 2.5);
        return;
      }
    }
    return PASS;
  } },
  // 村民对话(优先 100 万字对话库,按情境选行;AI 情境台词后台预取,下次开口就用)
  { name: 'villagers', run(probe) {
    for (const v of villagers) {
      if (v.downT > 0 || v.sleeping) continue;
      if (dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) > 5.5) continue;
      if (probe) return promptAt(`按 E 与${v.id.name}交谈`, v.pos.x, v.pos.z, 2.05);
      const l1 = v.aiNext || dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
      v.aiNext = null;
      // 你的事迹在村里口口相传(编年史)
      const deed = recallLine();
      let l2;
      const deedsV = v.dbKey === 'v11' ? chronicleDeeds() : [];
      if (deedsV.length && rand() < 0.4) {
        // 抄写员薇拉:你的事迹被写进编年史正文(同一套白名单,只录你亲手做的事)
        const m = deedsV[Math.floor(rand() * deedsV.length)];
        l2 = `(翻开编年史,蘸了蘸墨)「历第 ${m.d} 日,绿衣游侠林恩${m.t}。」——已录入正史,后人会读到的。`;
      } else if (EVO.legends.length && rand() < 0.3) {
        // 传说演化:村民复述最热的那条(复述本身就是传播 → 热度自增,被自然选择留下)
        const l = EVO.legends.reduce((b, x) => (x.heat > b.heat ? x : b));
        l.heat++;
        l2 = `街坊传得有鼻子有眼:「${legendText(l)}」——这话都传到第 ${l.gen} 种说法了,越传越神。`;
      } else {
        l2 = deed && rand() < 0.25
          ? ['听说你', '有人瞧见你', '街坊都在传,说你'][Math.floor(rand() * 3)] + deed + '。真有你的。'
          : dbLine(v.dbKey) || v.id.lines[v.lineIdx++ % v.id.lines.length];
      }
      openDialog([`${v.id.name}:${l1}`, `${v.id.name}:${l2}`], null,
        { key: v.dbKey, name: v.id.name, desc: VILLAGER_DESC_EN[villagers.indexOf(v)] || 'villager', ent: v });
      if (!AI_TEXT_OFF && !v.aiPending && rand() < 0.35) {
        v.aiPending = true;
        const sp = todaySpecial();
        aiLine(
          `你是中世纪王国的村民「${v.id.name}」。现在是${SEASONS[seasonIdx()]}季` +
          `${sp ? '·' + sp.name : ''},${{ dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜里' }[dayPhase()]},` +
          `天气${{ clear: '晴', cloudy: '多云', rain: '下雨', storm: '雷暴' }[weather.state]}。` +
          (workspace.current ? `眼前这位客人的近况:${workspace.current.t}。` : '') +
          '用中文说一句40字以内、符合你身份的闲聊,口语化,不要引号不要名字前缀。', null, 9000,
        ).then((t) => { v.aiPending = false; if (t) v.aiNext = t; });
      }
      return;
    }
    return PASS;
  } },
  // 喷泉许愿
  { name: 'fountain', run(probe) {
    if (player.coins > 0 && dist2(player.pos.x, player.pos.z, 0, 5) < 20) {
      if (probe) return promptAt('按 E 向喷泉许愿(1 金币)', 0, 5, 3);
      fountainWish();
      return;
    }
    return PASS;
  } },
  // 宝箱
  { name: 'chests', run(probe) {
    for (const c of world.chests) {
      if (!c.opened && dist2(player.pos.x, player.pos.z, c.x, c.z) < 5) {
        if (probe) return promptAt('按 E 打开宝箱', c.group.position.x, c.group.position.z, 1.5);
        c.opened = true;
        sfx.chest();
        const wx = c.group.position.x, wz = c.group.position.z;
        for (let i = 0; i < 8; i++) {
          const a = rand() * 6.28;
          addPickup('coin', wx + Math.cos(a) * (1 + rand() * 1.5), wz + Math.sin(a) * (1 + rand() * 1.5), 40);
        }
        addPickup('heart', wx, wz + 1.2, 40);
        toast('打开了宝箱!', 2);
        return;
      }
    }
    return PASS;
  } },
];
export const interactionRules = () => INTERACTIONS.map((r) => r.name);

// E 键交互的唯一入口;probe=true 时只试运行(返回提示,不改状态)
export function tryInteract(probe = false) {
  if (!started || player.dead) return null;
  for (let i = 0; i < INTERACTIONS.length; i++) {
    const r = INTERACTIONS[i].run(probe);
    if (r !== PASS) return r;
  }
  // 最低优先级:附近没有可骑的坐骑时读墓志铭;有就上马
  const best = nearestMountable();
  // 墓园漫步:读一块墓志铭(最低优先级,别挡着上马;AI 后台补写新碑文)
  if (!best && dist2(player.pos.x, player.pos.z, -40, -120) < 400) {
    if (probe) return promptAt('按 E 读一块墓志铭');
    readEpitaph();
    return;
  }
  if (best) return mountHorse(best, probe);
  return null;
}

export function computePrompt() {
  promptText = '';
  promptTargetPos = null;
  if (!started || player.dead || dialog.open) return; // 对话/手账开着时 E 是翻页,不显示交互提示
  if (armRT.active) { // 掰手腕:状态条而不是交互
    const filled = Math.round(Math.max(0, Math.min(1, armRT.meter)) * 10);
    promptText = `💪 ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} 狂按 E!!`;
    return;
  }
  if (dialog.open && !fishing.active) return;
  // 与 E 键共用同一套判定:试运行 tryInteract,命中哪条就显示哪条
  const it = tryInteract(true);
  if (it) {
    promptText = it.text;
    if (it.x !== undefined) promptTargetPos = { x: it.x, y: it.h || 2, z: it.z };
    return;
  }
  // 兜底:视角未锁定时提示
  if (!locked) promptText = '点击画面锁定视角 · H 查看操作';
}
// 交互提示每 3 帧试运行一次;钓鱼、抱着东西、骑马时每帧(提示跟着状态变得快)
export function updatePrompt() {
  if (frame.n % 3 === 0 || fishing.active || player.carrying || player.mounted) computePrompt();
}

// 墓园墓志铭:按序轮读,AI 在后台补写下一条
let epitaphIdx = Math.floor(rand() * EPITAPHS.length);
let epitaphAI = null; // AI 补写的下一条墓志铭
function readEpitaph() {
  const text = epitaphAI || EPITAPHS[epitaphIdx++ % EPITAPHS.length];
  epitaphAI = null;
  openDialog(['(你拂去一块墓碑上的落叶)', `「${text}」`]);
  if (!AI_TEXT_OFF && !aiBusy.epitaph) {
    aiBusy.epitaph = true;
    aiLine('为中世纪村庄墓园写一条墓志铭,15~40字,可庄重可幽默可温柔,只输出铭文本身,不要引号。', null, 9000)
      .then((t) => { aiBusy.epitaph = false; if (t) epitaphAI = t; });
  }
}
