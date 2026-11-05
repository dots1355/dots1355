// 事件导演:每 90~160 秒按权重与条件(时辰/位置/进度)抽一个事件在玩家附近上演,每日限额与街头事件共享。
// 权重随世界心境(喜剧/阴郁)、心智学出的注意增益与排片适应度(EVO.eventFit:玩家真参与了就加分)浮动。
// DIRECTOR_EVENTS:{key, w, cond(), start() → {t, update(), end()}};末尾是内容包设计的新事件与黑石劫掠战(守城)。
// 对外:director(当前事件句柄与冷却)、DIRECTOR_EVENTS、updateDirector(dt)。
import * as THREE from 'three';
import { sfx, weatherAudio } from '../audio.js';
import { GHOST_LINES } from '../content-packs.js';
import { rand } from '../core/rng.js';
import { colliders, player, started } from '../core/state.js';
import { angleLerp, dist2, lambert, makeHumanoid, makeSheep, resolveCollisions } from '../entities.js';
import { scene } from '../gfx/core.js';
import { addLightSource, removeLightSource } from '../gfx/pools.js';
import { dialog, showBubble } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { stats, unlockAch } from './achievements.js';
import {
  addBandit, addWolf, animateLimbs, bandits, moveEntity, retireEntity, retireProp, villagers, wolves,
} from './actors.js';
import { calendar, dayPhase, todaySpecial } from './calendar.js';
import { cam } from './camera.js';
import { arenaRT } from './events.js';
import { EVO, seedLegend } from './evo.js';
import { addChicken, chickens, revengeT, startChickenRiot } from './fauna.js';
import { MIND, remember, workspace } from './mind.js';
import { quest } from './quests.js';
import { vendetta } from './vendetta.js';
import { spawnDust, weather } from './weather.js';
import { addPickup, dropCoins } from '../main.js';

// ================= 事件导演:永无止境的随机事件 =================
// 每 45~105 秒按权重与条件(时辰/位置/进度)抽取一个事件在玩家附近上演
export const director = { handle: null, cd: 90 };

function spawnNearPlayer(minR, maxR) {
  const a = rand() * Math.PI * 2;
  const r = minR + rand() * (maxR - minR);
  const p = { x: player.pos.x + Math.cos(a) * r, z: player.pos.z + Math.sin(a) * r };
  resolveCollisions(p, 1, colliders);
  return p;
}
function makeWanderer(style, x, z) {
  const n = { ...makeHumanoid(style), pos: new THREE.Vector3(x, 0, z), yaw: 0, walkT: 0 };
  n.group.position.copy(n.pos);
  scene.add(n.group);
  return n;
}

const meteorCraters = []; // 陨石事件留下的坑(只留最近两个)
export const DIRECTOR_EVENTS = [
  {
    key: 'wolfRaid', w: 10,
    cond: () => quest.idx >= 2 && villagers.some((v) => !v.sleeping &&
      dist2(player.pos.x, player.pos.z, v.pos.x, v.pos.z) < 3600),
    start() {
      const v = villagers.find((x) => !x.sleeping && dist2(player.pos.x, player.pos.z, x.pos.x, x.pos.z) < 3600);
      const pack = [];
      for (let i = 0; i < 3; i++) {
        const p = spawnNearPlayer(24, 34);
        const w = addWolf(p.x, p.z);
        w.raidTarget = v;
        pack.push(w);
      }
      toast('📣 狼群袭击了居民!快去救人!', 3.5);
      sfx.wanted();
      return {
        t: 60,
        update() {
          if (pack.every((w) => w.dead)) {
            player.coins += 20;
            sfx.fanfare();
            toast('🐺 狼群被击退!居民凑了 20 金币谢你。', 4);
            this.t = 0;
          }
        },
        end() { // 事件狼不留后患:活的散场,死的收尸,谁也别在村口安家
          for (const w of pack) {
            w.raidTarget = null;
            retireEntity(w, wolves);
          }
        },
      };
    },
  },
  {
    key: 'tollAmbush', w: 9,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 0) > 8100,
    start() {
      const thugs = [];
      for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
        const p = spawnNearPlayer(12, 18);
        thugs.push(addBandit(p.x, p.z, { hp: 3 }));
      }
      for (const b of thugs) b.eventFoe = true;
      toast('📣 「站住!留下买路钱!」——路霸现身!', 3.5);
      sfx.wanted();
      return {
        t: 70,
        update() {
          if (thugs.every((b) => b.dead)) {
            player.coins += 15;
            toast('💰 路霸被清剿,+15 金币。', 3);
            sfx.coin();
            this.t = 0;
          }
        },
        end() {
          for (const b of thugs) {
            if (!b.dead) retireEntity(b, bandits);
          }
        },
      };
    },
  },
  {
    key: 'duelist', w: 7,
    cond: () => quest.idx >= 2,
    start() {
      const p = spawnNearPlayer(10, 15);
      const d = addBandit(p.x, p.z, { hp: 5, dmg: 1, speed: 6 });
      d.duel = true;
      d.eventFoe = true;
      toast('📣 流浪剑客卡洛拔剑相向:「久仰!让我看看你的剑!」', 4);
      return {
        t: 90,
        update() {
          if (d.dead) {
            player.coins += 20;
            sfx.fanfare();
            toast('🤺 卡洛抱拳认负:「好剑法!」(+20 金币)', 4);
            this.t = 0;
          }
        },
        end() {
          if (!d.dead) {
            toast('🤺 卡洛收剑离去:「下次再切磋。」', 3);
            retireEntity(d, bandits);
          }
        },
      };
    },
  },
  {
    key: 'brawl', w: 7,
    cond: () => quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 12, 76) < 4900,
    start() {
      const rowdies = [];
      for (let i = 0; i < 3; i++) {
        const b = addBandit(17 + i * 2.2, 78.5 + (i % 2) * 2.4, { hp: 2, dmg: 1, speed: 4.6 });
        b.eventFoe = true;
        rowdies.push(b);
      }
      toast('📣 旅店门口打起来了!罗莎喊:「谁把这几个醉鬼放倒,今晚酒钱全免!」', 4);
      sfx.wanted();
      return {
        t: 75,
        update() {
          if (rowdies.every((b) => b.dead)) {
            player.coins += 15;
            player.drunkT = Math.max(player.drunkT, 18); // 罗莎说到做到,真按来一大杯
            sfx.fanfare();
            remember('替罗莎撂倒了三个闹事的醉鬼');
            toast('🍺 醉鬼全被撂倒!罗莎塞来 15 金币,还真端来一大杯麦酒。', 4);
            this.t = 0;
          }
        },
        end() {
          for (const b of rowdies) {
            if (!b.dead) retireEntity(b, bandits);
          }
        },
      };
    },
  },
  {
    key: 'convict', w: 8,
    cond: () => quest.idx >= 1,
    start() {
      const p = spawnNearPlayer(14, 20);
      const c = addBandit(p.x, p.z, { hp: 4, speed: 6.4 });
      c.convict = true;
      c.eventFoe = true;
      toast('📣 有逃犯越狱!活捉或击倒都有赏!', 3.5);
      sfx.wanted();
      return {
        t: 80,
        update() {
          if (c.dead) {
            player.coins += 25;
            sfx.fanfare();
            toast('⛓️ 逃犯归案,+25 金币赏金!', 3.5);
            this.t = 0;
          } else if (dist2(player.pos.x, player.pos.z, c.pos.x, c.pos.z) > 32400) {
            toast('⛓️ 逃犯跑远了……', 2.5);
            this.t = 0;
          }
        },
        end() {
          if (!c.dead) retireEntity(c, bandits);
        },
      };
    },
  },
  {
    key: 'meteor', w: 6,
    cond: () => dayPhase() === 'night' || dayPhase() === 'dusk',
    start() {
      const p = spawnNearPlayer(28, 50);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
      const glow = new THREE.PointLight(0xffaa44, 30, 60, 2);
      ball.position.set(p.x + 40, 90, p.z - 30);
      glow.position.copy(ball.position);
      scene.add(ball);
      addLightSource(glow); // 走点光池:不往场景里加新灯(加灯=全场着色器重编译)
      toast('☄️ 夜空中有什么东西坠落了!', 3);
      let landed = false;
      return {
        t: 40,
        update(dt2) {
          if (!landed) {
            ball.position.x -= 40 * dt2 * 0.55;
            ball.position.y -= 90 * dt2 * 0.55;
            ball.position.z += 30 * dt2 * 0.55;
            glow.position.copy(ball.position);
            if (ball.position.y <= 0.5) {
              landed = true;
              scene.remove(ball);
              weatherAudio.thunder();
              cam.shake = Math.max(cam.shake, 0.5);
              spawnDust(p.x, 0.3, p.z, 20, 4, 2.5);
              const crater = new THREE.Mesh(new THREE.CircleGeometry(3.2, 12),
                lambert(0x4a4038, { roughness: 1 }));
              crater.rotation.x = -Math.PI / 2;
              crater.position.set(p.x, 0.04, p.z);
              scene.add(crater);
              this.crater = crater;
              for (let i = 0; i < 10; i++) {
                const a2 = rand() * 6.28;
                addPickup('coin', p.x + Math.cos(a2) * (1 + rand() * 2.5),
                  p.z + Math.sin(a2) * (1 + rand() * 2.5), 60);
              }
              toast('☄️ 陨石坠地!坑里散着灼热的金币!', 4);
            }
          } else {
            glow.intensity = Math.max(0, glow.intensity - dt2 * 15);
          }
        },
        end() {
          retireProp(ball);
          removeLightSource(glow);
          if (this.crater) { // 陨坑留在原地,但只留最近两个(每个都是独立的几何/材质)
            meteorCraters.push(this.crater);
            while (meteorCraters.length > 2) retireProp(meteorCraters.shift());
          }
        },
      };
    },
  },
  {
    key: 'mysticMerchant', w: 6,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(12, 16);
      const m = makeWanderer({ shirt: 0x2a3a5a, pants: 0x1a2438, hood: true }, p.x, p.z);
      toast('📣 一位兜帽商人不知从哪儿冒了出来……', 3);
      const h = {
        t: 45,
        merchant: m,
        update() {
          if (dist2(player.pos.x, player.pos.z, m.pos.x, m.pos.z) < 30) {
            m.group.rotation.y = angleLerp(m.group.rotation.y,
              Math.atan2(player.pos.x - m.pos.x, player.pos.z - m.pos.z), 0.1);
          }
        },
        end() {
          spawnDust(m.pos.x, 0.5, m.pos.z, 8, 0.8, 1.5);
          retireEntity(m);
          if (director.mystic === m) director.mystic = null;
        },
      };
      director.mystic = m;
      return h;
    },
  },
  {
    key: 'ghost', w: 5,
    cond: () => dayPhase() === 'night',
    start() {
      const p = spawnNearPlayer(15, 22);
      const g = makeWanderer({ shirt: 0xeeeeff, pants: 0xddddee, hair: 0xffffff }, p.x, p.z);
      g.group.traverse((o) => { // 克隆后再改:共享材质缓存动不得,不然全城人跟着变半透明
        if (o.material) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.4;
        }
      });
      toast('👻 夜色里飘着一个苍白的身影……', 3);
      let t0 = 0;
      return {
        t: 50,
        update(dt2) {
          t0 += dt2;
          g.group.position.y = 0.3 + Math.sin(t0 * 2) * 0.15;
          if (dist2(player.pos.x, player.pos.z, g.pos.x, g.pos.z) < 16) {
            sfx.hurt();
            spawnDust(g.pos.x, 1, g.pos.z, 10, 1, 1.2);
            for (let i = 0; i < 12; i++) {
              const a2 = rand() * 6.28;
              addPickup('coin', g.pos.x + Math.cos(a2) * 2, g.pos.z + Math.sin(a2) * 2, 40);
            }
            toast(`👻 「${GHOST_LINES[Math.floor(rand() * GHOST_LINES.length)]}」——幽灵消散了,留下一把冰凉的古币`, 4.5);
            this.t = 0;
          }
        },
        end() { retireEntity(g); }, // 半透明是克隆的私有材质,随实体一起释放
      };
    },
  },
  {
    key: 'goldenChicken', w: 5,
    cond: () => true,
    start() {
      const p = spawnNearPlayer(10, 14);
      const c = addChicken(p.x, p.z);
      c.golden = true;
      c.extra = true;
      c.eventKeep = true;
      c.group.traverse((o) => {
        if (o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.setHex(0xffd83d);
          if (o.material.emissive) { o.material.emissive.setHex(0x8a5c00); o.material.emissiveIntensity = 0.5; }
        }
      });
      toast('🐔✨ 一只金鸡出没!抱住它!', 3.5);
      return {
        t: 45,
        update() {
          // 金鸡永远想逃离玩家
          if (c.state !== 'carried' && c !== player.carrying) {
            c.state = 'flee';
            c.timer = 1;
          }
          if (player.carrying === c) {
            player.coins += 30;
            sfx.fanfare();
            remember('追到了传说中的金鸡,它在怀里化成了金币', 'goldhen');
            toast('🐔✨ 金鸡在你怀里化作 30 枚金币!!', 4);
            player.carrying = null;
            this.t = 0;
          }
        },
        end() {
          if (chickens.includes(c)) retireEntity(c, chickens); // 金色是克隆的私有材质
        },
      };
    },
  },
  {
    key: 'chickenRiot', w: 3,
    cond: () => revengeT <= 0 && dist2(player.pos.x, player.pos.z, 20, 85) < 14400,
    start() {
      startChickenRiot(15);
      toast('🐔 鸡群今天心情不好——暴动了!!', 3.5);
      sfx.wanted();
      for (let i = 0; i < 4; i++) {
        const p = spawnNearPlayer(10, 14);
        const rc = addChicken(p.x, p.z);
        rc.extra = true;
      }
      return { t: 16, update() {}, end() {} };
    },
  },
  {
    key: 'coinRain', w: 4,
    cond: () => true,
    start() {
      toast('💨 一阵怪风卷来了谁家的钱袋!', 3);
      sfx.coin();
      for (let i = 0; i < 10; i++) {
        const a = rand() * 6.28;
        addPickup('coin', player.pos.x + Math.cos(a) * (3 + rand() * 6),
          player.pos.z + Math.sin(a) * (3 + rand() * 6), 30);
      }
      return { t: 5, update() {}, end() {} };
    },
  },
];

// ---- 创作代理设计的新导演事件 ----
DIRECTOR_EVENTS.push({
  key: 'wiseCow', w: 6,
  cond: () => dayPhase() !== 'night' && !director.cow,
  start() {
    const p = spawnNearPlayer(10, 16);
    const cow = { ...makeSheep(), pos: new THREE.Vector3(p.x, 0, p.z), asked: 0, nodYes: false, nodT: 0 };
    cow.group.scale.set(1.6, 1.35, 1.6);
    cow.group.traverse((o) => {
      if (o.material && o.material.color) { o.material = o.material.clone(); o.material.color.setHex(0x8a6a4a); }
    });
    cow.group.position.copy(cow.pos);
    scene.add(cow.group);
    director.cow = cow;
    toast('🐄 一头牛正盯着你,眼神里透着一股不寻常的智慧……(按 E 提问)', 4);
    let bobT = 0;
    return {
      t: 60,
      update(dt2) {
        bobT += dt2;
        cow.group.rotation.y = Math.atan2(player.pos.x - cow.pos.x, player.pos.z - cow.pos.z);
        if (cow.nodT > 0) {
          cow.nodT -= dt2;
          cow.group.rotation.x = cow.nodYes ? Math.sin(bobT * 9) * 0.09 : 0;
          cow.group.rotation.z = cow.nodYes ? 0 : Math.sin(bobT * 9) * 0.09;
        } else { cow.group.rotation.x = 0; cow.group.rotation.z = 0; }
        if (cow.asked >= 5 && !dialog.open) this.t = Math.min(this.t, 0.01);
      },
      end() {
        if (cow.asked >= 5) {
          dropCoins(cow.pos, 5);
          toast('🐄 牛心满意足地走了。蹄印里……踩着几枚金币?!', 4);
        }
        retireEntity(cow);
        director.cow = null;
      },
    };
  },
});
DIRECTOR_EVENTS.push({
  key: 'starShower', w: 4,
  cond: () => dayPhase() === 'night' && weather.state === 'clear',
  start() {
    toast('🌠 流星雨!星屑正落向四野,趁它们熄灭前拾取!', 4.5);
    sfx.fanfare();
    for (let i = 0; i < 10; i++) {
      const a = rand() * 6.28, r = 8 + rand() * 30;
      addPickup('coin', player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r, 30);
    }
    return { t: 32, update() {}, end() {} };
  },
});
DIRECTOR_EVENTS.push({
  key: 'roastRunaway', w: 5,
  cond: () => dayPhase() !== 'night' && dist2(player.pos.x, player.pos.z, 12, 72) < 8100,
  start() {
    const c = addChicken(12, 70);
    c.extra = true;
    c.eventKeep = true;
    c.state = 'flee';
    c.timer = 4;
    toast('🐔💨 旅店后厨的鸡越狱了!伙计小马在后面喊:抓住它!!', 4);
    const h = {
      t: 45,
      update() {
        if (player.carrying === c) {
          const boy = villagers[13];
          if (boy && dist2(player.pos.x, player.pos.z, boy.pos.x, boy.pos.z) < 9) {
            player.carrying = null;
            if (chickens.includes(c)) retireEntity(c, chickens);
            player.coins += 3;
            sfx.coin();
            toast('🐔 小马接过鸡塞给你 3 金币:「多谢!今晚的烤鸡有着落了——哦,它好像听懂了。」', 4.5);
            h.t = 0.01;
          }
        } else if (c.state !== 'carried' && c.timer < 0.5) { c.state = 'flee'; c.timer = 2; }
      },
      end() {
        if (player.carrying !== c && chickens.includes(c)) retireEntity(c, chickens);
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'wishThief', w: 5,
  cond: () => dayPhase() === 'night' && !director.thief && dist2(player.pos.x, player.pos.z, 0, 5) < 3600,
  start() {
    const g = makeWanderer({ shirt: 0x3a3a2e, pants: 0x2a2a22, hood: true }, -5, 2);
    director.thief = g;
    toast('🤫 喷泉边有个鬼祟的身影,袖子一直湿到肩膀……(按 E 咳嗽一声)', 4);
    return {
      t: 40,
      update() {},
      end() { retireEntity(g); director.thief = null; },
    };
  },
});

DIRECTOR_EVENTS.push({
  key: 'wedding', w: 5,
  cond: () => dayPhase() === 'day' && quest.idx >= 1 && dist2(player.pos.x, player.pos.z, 0, 5) < 4900,
  start() {
    const groom = makeWanderer({ shirt: 0x3a5a8a, pants: 0x2a2a3a, hair: 0x3a2a1a }, 4, 12);
    const bride = makeWanderer({ shirt: 0xe8dce8, pants: 0xd8ccd8, hair: 0x8a5a2a }, 5.2, 12);
    toast('💒 有人在喷泉广场成亲!全城都来讨喜糖啦!', 4);
    sfx.fanfare();
    let t0 = 0, greeted = false;
    const h = {
      t: 40,
      update(dt2) {
        t0 += dt2;
        // 新人绕喷泉慢慢走一圈
        const a = t0 * 0.25;
        moveEntity(groom, Math.cos(a) * 8, 5 + Math.sin(a) * 8, 2.2, dt2);
        moveEntity(bride, Math.cos(a + 0.15) * 8, 5 + Math.sin(a + 0.15) * 8, 2.2, dt2);
        for (const n of [groom, bride]) {
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, true, n.group, 0.4);
        }
        // 沿途撒喜钱
        if (rand() < dt2 * 0.5) {
          addPickup('coin', groom.pos.x + (rand() - 0.5) * 4, groom.pos.z + (rand() - 0.5) * 4, 30);
        }
        // 玩家凑近道贺(一次)
        if (!greeted && dist2(player.pos.x, player.pos.z, groom.pos.x, groom.pos.z) < 9) {
          greeted = true;
          player.coins += 2;
          sfx.coin();
          showBubble(bride, '新娘', '沾沾喜气!喜糖……换成金币啦,拿好!', 4);
          remember('在喷泉广场赶上一场婚礼,讨到了喜钱');
        }
      },
      end() {
        retireEntity(groom);
        retireEntity(bride);
      },
    };
    return h;
  },
});
DIRECTOR_EVENTS.push({
  key: 'funeral', w: 4,
  cond: () => dayPhase() === 'dusk' && quest.idx >= 2,
  start() {
    // 四人抬棺,从西门缓缓走向静眠墓园
    const bearers = [];
    for (let i = 0; i < 4; i++) {
      bearers.push(makeWanderer({ shirt: 0x2e2e34, pants: 0x222228, hair: 0x3a3a3a },
        -66 + (i % 2) * 2, -6 + Math.floor(i / 2) * 2.4));
    }
    const coffin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 2.4), lambert(0x4a3a28, { roughness: 0.95 }));
    coffin.castShadow = true;
    scene.add(coffin);
    toast('🕯️ 一支送葬的队伍朝墓园去了。城里安静了一瞬。', 4);
    let paid = false;
    const h = {
      t: 70,
      update(dt2) {
        let arrived = true;
        bearers.forEach((n, i) => {
          const done = moveEntity(n, -44 + (i % 2) * 2, -114 + Math.floor(i / 2) * 2.4, 1.6, dt2);
          if (!done) arrived = false;
          n.group.position.copy(n.pos);
          n.group.rotation.y = n.yaw;
          animateLimbs(n.parts, n.walkT, !done, n.group, 0.3);
        });
        coffin.position.set(
          (bearers[0].pos.x + bearers[3].pos.x) / 2,
          1.3,
          (bearers[0].pos.z + bearers[3].pos.z) / 2);
        coffin.rotation.y = bearers[0].yaw;
        if (!paid && dist2(player.pos.x, player.pos.z, coffin.position.x, coffin.position.z) < 36 &&
            !player.mounted && player.weapon !== 'bow') {
          paid = true;
          remember('在路边驻足,为一位陌生人送了最后一程');
          toast('(你摘下帽子,站到了路边。抬棺人朝你微微颔首。)', 3.5);
        }
        if (arrived) this.t = Math.min(this.t, 0.01);
      },
      end() {
        for (const n of bearers) retireEntity(n);
        retireProp(coffin);
      },
    };
    return h;
  },
});
// 黑石劫掠战:骑砍式守城——战鼓一响,匪帮成波扑向南门,佣兵与你并肩守到底
DIRECTOR_EVENTS.push({
  key: 'siege', w: 4,
  cond: () => quest.idx >= 3 && dist2(player.pos.x, player.pos.z, 0, 40) < 8100,
  start() {
    const raiders = [];
    const spawnWave = (n, zBase) => {
      for (let i = 0; i < n; i++) {
        const b = addBandit(-8 + i * 4 + (rand() * 2 - 1), zBase + rand() * 4, { hp: 3, dmg: 1 });
        b.eventFoe = true;
        raiders.push(b);
      }
    };
    spawnWave(4, 74);
    sfx.wanted();
    sfx.stomp();
    cam.shake = 0.4;
    toast('🥁 战鼓!!黑石兄弟会大举攻打南门——守住!!', 5);
    remember('黑石兄弟会攻打南门那天,你在城墙下', 'siege-day');
    let wave2 = false;
    return {
      t: 130,
      update() {
        if (!wave2 && this.t < 95) {
          wave2 = true;
          spawnWave(3, 78);
          sfx.wanted();
          toast('🥁 第二波!他们从苇丛里又冒出来一队!', 3.5);
        }
        if (wave2 && raiders.every((b) => b.dead)) {
          player.coins += 40;
          sfx.fanfare();
          stats.sieges = (stats.sieges || 0) + 1;
          unlockAch('walldef');
          remember('打退了黑石兄弟会对南门的劫掠,全城都看见了');
          seedLegend(); // 守城之战当场进传说基因池
          if (vendetta.stage === 0) vendetta.stage = 1; // 黑石记仇了:报复的种子就此埋下
          toast('🏰 劫掠被击退!罗莎在旅店门口带头喝彩——赏金 40 枚,全城记你一功!', 6);
          this.t = 0;
        }
      },
      end() {
        for (const b of raiders) {
          if (!b.dead) retireEntity(b, bandits);
        }
      },
    };
  },
});
export function updateDirector(dt) {
  if (!started || player.dead || arenaRT.active) return;
  if (director.handle) {
    const h = director.handle;
    h.t -= dt;
    director.ageT = (director.ageT || 0) + dt;
    if (h.update) h.update(dt);
    if (h.t <= 0) {
      if (h.end) h.end();
      // 排片演化:提前收场 = 玩家真参与了,这类戏加分;演满全场没人理,减分
      if (director.key) {
        const engaged = director.ageT < (director.dur || 0) - 0.5;
        EVO.eventFit[director.key] = Math.max(-2, Math.min(4,
          (EVO.eventFit[director.key] || 0) + (engaged ? 1 : -0.3)));
      }
      director.handle = null;
      director.cd = 90 + rand() * 70;
    }
    return;
  }
  director.cd -= dt;
  if (director.cd > 0) return;
  if (calendar.dailyEvents <= 0) { director.cd = 45; return; } // 今日限额已满,明天再说
  const pool = DIRECTOR_EVENTS.filter((e) => e.cond());
  if (!pool.length) { director.cd = 30; return; }
  // 满月夜里亡魂更容易现身;世界的心境挑它爱看的戏(意识 → 行为的闭环)
  const COMIC = ['goldenChicken', 'chickenRiot', 'coinRain', 'wiseCow', 'roastRunaway', 'wedding', 'starShower', 'brawl'];
  const SOMBER = ['wolfRaid', 'ghost', 'funeral', 'tollAmbush', 'convict', 'wishThief'];
  const wOf = (e) => {
    let w2 = e.w;
    if (e.key === 'ghost' && todaySpecial()?.key === 'fullmoon' && dayPhase() === 'night') w2 *= 4;
    const v = workspace.mood.v;
    if (COMIC.includes(e.key)) w2 *= 1 + Math.max(0, v) * 1.2 - Math.max(0, -v) * 0.5;
    if (SOMBER.includes(e.key)) w2 *= 1 + Math.max(0, -v) * 0.9;
    // 学出来的性情也挑戏:盯着危险长大的心多排阴郁戏,恋着人间烟火的心多排喜剧
    if (SOMBER.includes(e.key)) w2 *= 0.5 + 0.5 * (MIND.gains.threat ?? 1);
    if (COMIC.includes(e.key)) w2 *= 0.5 + 0.25 * ((MIND.gains.body ?? 1) + (MIND.gains.wealth ?? 1));
    w2 *= 1 + 0.12 * (EVO.eventFit[e.key] || 0); // 排片演化:观众用脚投票
    return Math.max(0.1, w2);
  };
  let total = pool.reduce((s, e) => s + wOf(e), 0);
  let roll = rand() * total;
  let ev = pool[0];
  for (const e of pool) { roll -= wOf(e); if (roll <= 0) { ev = e; break; } }
  calendar.dailyEvents--;
  director.handle = ev.start();
  director.key = ev.key;
  director.dur = director.handle ? director.handle.t : 0;
  director.ageT = 0;
}

