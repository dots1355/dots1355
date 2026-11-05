// 回归测试:起一个静态服务器 + 无头 Chromium,用 window.__gtm 的固定步长 step() 驱动模拟。
// 用法:  node tests/run.mjs            (全部)
//        node tests/run.mjs save flash  (按名字挑)
// 需要 playwright-core;浏览器路径取 CHROMIUM_PATH,缺省 /opt/pw-browsers/chromium。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

const memRoutes = new Map(); // 内存里的页面(bundle 用例的单文件打包版)
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (memRoutes.has(u)) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(memRoutes.get(u)); return; }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const { chromium } = await import('playwright-core');
const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const srv = await serve();
const base = `http://127.0.0.1:${srv.address().port}/?noai=1&lowfx=1`;
const browser = await chromium.launch({ executablePath: exe,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function boot(page, { clear = true, start = true } = {}) {
  await page.goto(base);
  await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
  if (clear) {
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
  }
  if (start) {
    await page.click('#title', { timeout: 180000 }); // 机器很忙时标题动画迟迟不"稳定",别 30 秒就判失败
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const g = window.__gtm; g.skipPrologue(true); g.setWeather('clear'); g.toastQueue.length = 0; });
  }
}

// 战斗用例的空场地:清走野外的狼和盗贼,玩家站在 (0,180) 面朝 +Z、镜头在身后;A.foes(n) 复用开局的盗贼当靶子
// (50 血、不出手,摆在玩家周围),A.reset() 把玩家和靶子都复位、清掉残留的打击停顿/慢镜(开局跳过序章杀狼会留一段
// 时停,机器慢时它会拖到用例里,把"这一帧刀落下"拖成好几帧);学来的格挡/闪箭关掉,结果才可复现
async function installArena(page) {
  await page.evaluate(async () => {
    const { timeFX } = await import('/src/core/timefx.js');
    const g = window.__gtm, P = g.player, X = 0, Z = 180;
    g.seedRng(7);
    g.EVO.tactics.block = 0; g.EVO.tactics.dodge = 0;
    g.director.cd = 1e9; g.warband.cd = 1e9; if (g.streetEvent) g.streetEvent.cd = 1e9;
    const roster = g.bandits.filter((b) => !b.boss && !b.robber && !b.convict && !b.escort).slice(0, 4);
    const hide = (e) => { e.dead = true; e.respawnT = 1e9; e.group.visible = false; e.windupT = 0; e.biteT = 0; e.lunging = 0; };
    for (const e of [...g.bandits, ...g.wolves]) hide(e);
    const A = (window.__arena = {
      roster,
      foes: (n) => roster.slice(0, n).map((b) => {
        Object.assign(b, { dead: false, respawnT: 1e9, hp: 50, maxHp: 50, stunT: 0, stunSrc: '', hitStunT: 0, armorT: 0,
          windupT: 0, swingT: 0, heavyAtk: false, comboN: 0, fleeT: 0, attackCd: 99, kbT: 0, downT: 0, _trampleCd: 0, speed: 0,
          elite: false, duel: false, boss: false, warlord: false, bountyHead: false, warband: false, _truce: false });
        b.group.visible = true; b.group.rotation.set(0, 0, 0);
        return b;
      }),
      place: (b, dx, dz, yaw) => {
        b.pos.set(X + dx, 0, Z + dz);
        b.yaw = yaw ?? Math.atan2(P.pos.x - b.pos.x, P.pos.z - b.pos.z);
        b.group.position.copy(b.pos); b.group.rotation.y = b.yaw;
      },
      reset: () => {
        for (const b of roster) hide(b);
        if (g.getLock()) g.toggleLock();
        Object.assign(P, { dead: false, hp: P.maxHp, sta: P.maxSta, vy: 0, onGround: true, yaw: 0, attackT: 0, strike: null,
          atkBufT: 0, atkHeld: false, charging: false, chargeT: 0, rollT: 0, rollCd: 0, rollBufT: 0, staggerT: 0, gaspT: 0,
          invulnT: 0, blocking: false, blockHeld: false, parryReadyAt: 0, parryUntil: -1, lungeT: 0, landLagT: 0, plunging: false,
          chainN: 0, chainT: -1e9, sneaking: false, mounted: null, jumps: 0, airT: 0, hurtT: 0 });
        P.pos.set(X, 0, Z);
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) g.keys[k] = false;
        g.setCamView(Math.PI, 0.35);
        timeFX.hitStop = 0; timeFX.slowMo = 0;
        g.step(1);
      },
    });
    A.reset();
  });
}

// 只留第一个活着的普通盗贼当靶子:它的同伙和野狼都藏起来(否则会在测试中途冲上来砍人、打断蓄力,结果看运气);
// 随机数定种子,结果才可复现
async function soloBandit(page) {
  await page.evaluate(async () => {
    const { timeFX } = await import('/src/core/timefx.js');
    timeFX.hitStop = 0; timeFX.slowMo = 0; // 开局跳过序章杀狼留下的时停
    const g = window.__gtm;
    g.seedRng(7);
    const b = g.bandits.find((x) => !x.dead && !x.boss);
    for (const o of [...g.bandits, ...g.wolves]) {
      if (o === b || o.dead) continue;
      Object.assign(o, { dead: true, respawnT: 1e9, windupT: 0, biteT: 0, lunging: 0 });
      o.group.visible = false;
    }
  });
}

const TESTS = {
  // 启动无报错,核心地标与地形就位
  async boot(page, errors) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      g.step(30);
      return { landmarks: g.world.landmarks ? g.world.landmarks.children.length : 0, ground: !!g.world.ground };
    });
    if (r.landmarks < 5) throw new Error(`核心地标太少:${r.landmarks}`);
    if (!r.ground) throw new Error('没有地表网格');
    if (errors.length) throw new Error('页面报错:' + errors.join(' | '));
  },
  // 逻辑 y 是离地高度;渲染时人物贴着起伏地形
  async ground(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      let best = null; // 在丘陵群系里找一处明显高起的地面
      for (let x = 300; x <= 460; x += 8) for (let z = -20; z <= 140; z += 8) {
        const h = g.groundH(x, z);
        if (!best || h > best.h) best = { x, z, h };
      }
      g.player.pos.set(best.x, 0, best.z);
      g.step(20);
      return { rel: g.player.pos.y, abs: g.player.group.position.y, h: g.groundH(g.player.pos.x, g.player.pos.z), peak: best.h };
    });
    if (r.peak < 1.5) throw new Error(`丘陵区找不到起伏(最高 ${r.peak.toFixed(2)}m)`);
    if (Math.abs(r.rel) > 0.05) throw new Error(`逻辑高度应≈0,实际 ${r.rel}`);
    if (Math.abs(r.abs - r.h) > 0.05) throw new Error(`人物渲染高度 ${r.abs.toFixed(2)} 与地面 ${r.h.toFixed(2)} 不符`);
  },
  // 受击闪白只作用于被打的那一个(材质私有化),到时自动还原
  async flash(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const live = g.bandits.filter((b) => !b.dead);
      if (live.length < 2) return { skip: true };
      const [a, b] = live;
      const em = (e) => { let hex = null; e.group.traverse((o) => { if (hex === null && o.material && o.material.emissive) hex = o.material.emissive.getHex(); }); return hex; };
      const before = em(b);
      a.hp = 99;
      g.explodeAt(a.pos.x, a.pos.z, 0, 0.5); // 0 伤害:只触发受击表现
      const during = { a: em(a), b: em(b) };
      g.step(40);
      return { before, during, after: em(a), left: g.flashing.size };
    });
    if (r.skip) return;
    if (r.during.a !== 0xffffff) throw new Error('被打的没有闪白');
    if (r.during.b !== r.before) throw new Error('旁人跟着闪白了(共享材质被改)');
    if (r.after === 0xffffff || r.left !== 0) throw new Error('闪白没有还原');
  },
  // 远近分级与玩法可见性互不覆盖:远处的实体整个不画,走回来又出现;
  // 玩法自己藏起来的(死了收尸、隐身),走远再回来也不会被分级翻出来
  async lodVisibility(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const v = g.villagers.find((x) => x.group && x.group._skin);
      if (!v) return { skip: true };
      const vx = v.pos.x, vz = v.pos.z;
      const at = (x, z) => { g.player.pos.set(x, 0, z); g.step(40); return v.group.visible; };
      const near0 = at(vx + 3, vz + 3);
      const far = at(vx + 420, vz);
      const near1 = at(vx + 3, vz + 3);
      v.group.visible = false;
      const far2 = at(vx + 420, vz);
      const near2 = at(vx + 3, vz + 3);
      v.group.visible = true;
      return { near0, far, near1, far2, near2, back: at(vx + 3, vz + 3) };
    });
    if (r.skip) return;
    if (!r.near0 || !r.near1 || !r.back) throw new Error('近处的实体被藏起来了');
    if (r.far || r.far2) throw new Error('远处的实体没有被分级剔除');
    if (r.near2) throw new Error('玩法藏起来的实体被远近分级翻出来了');
  },
  // 龙息等环境伤害:不算玩家罪行,不进玩家连杀
  async envDamage(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const gd = g.guards.find((x) => !x.dead && !(x.downT > 0));
      const hp0 = gd.hp, kills0 = g.stats.kills || 0;
      g.explodeAt(gd.pos.x, gd.pos.z, 2, 3, 'dragon');
      const w = g.wolves.find((x) => !x.dead);
      if (w) { w.hp = 1; g.explodeAt(w.pos.x, w.pos.z, 2, 2, 'dragon'); }
      return { wanted: g.getWanted(), hp: gd.hp, hp0, killsDelta: (g.stats.kills || 0) - kills0, wolfDead: w ? w.dead : true };
    });
    if (r.wanted !== 0) throw new Error(`龙息炸到卫兵却通缉了玩家(${r.wanted})`);
    if (r.hp !== r.hp0) throw new Error('卫兵不该被环境爆炸伤到');
    if (!r.wolfDead) throw new Error('龙息应能炸死狼');
    if (r.killsDelta !== 0) throw new Error('环境击杀不该进玩家连杀');
  },
  // 近战击杀盗贼走统一结算(连杀计数 + 掉落)
  async melee(page) {
    await boot(page);
    await soloBandit(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const b = g.bandits.find((x) => !x.dead && !x.boss);
      if (!b) return { skip: true };
      g.player.pos.set(b.pos.x, 0, b.pos.z - 1.2);
      g.player.yaw = 0;
      b.hp = 1; b.stunT = 2;
      const kills0 = g.stats.kills || 0;
      g.tryAttack();
      g.step(60);
      return { dead: b.dead, killsDelta: (g.stats.kills || 0) - kills0 };
    });
    if (r.skip) return;
    if (!r.dead) throw new Error('贴脸一刀没砍死 1 血的盗贼');
    if (r.killsDelta < 1) throw new Error('近战击杀没有计入连杀/击杀数');
  },
  // 符文立石:刀落下的判定帧才劈中(起手不算),劈中后熄灭并撒出金币;背对着砍不中
  async runestone(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      for (const gd of g.guards) gd.pos.x += 400; // 别让攻击磁吸转向卫兵
      const [a, b] = g.world.qBlocks;
      g.player.pos.set(a.x, 0, a.z + 1.6);
      g.player.yaw = 0; // 背对立石
      g.tryAttack();
      g.step(60);
      const back = a.used;
      g.player.pos.set(b.x, 0, b.z + 1.6);
      g.player.yaw = Math.PI; // 面朝立石
      const coins0 = g.player.coins;
      g.tryAttack();
      const early = b.used;
      g.step(60);
      g.step(120); // 走过去捡不到也没关系:金币要么已被吸走,要么散在地上
      return { back, early, hit: b.used, glow: b.mat.emissiveIntensity, coins: g.player.coins - coins0 };
    });
    if (r.back) throw new Error('背对立石也劈中了');
    if (r.early) throw new Error('起手就判定劈中(应在刀落下的判定帧)');
    if (!r.hit) throw new Error('面朝立石挥刀没有劈中');
    if (r.glow !== 0) throw new Error('劈中后符文没有熄灭');
  },
  // 后期链不黑屏:开着泛光,把王都广场、磨坊、雨夜几处常见取景完整渲一遍,画面中心不能是全黑
  // (场景里任何 NaN/Inf 像素都会被泛光糊满全屏;曾因材质端 flatShading 的导数法线在广场整帧全黑)
  async postfx(page) {
    await page.setViewportSize({ width: 960, height: 540 });
    await boot(page);
    const r = await page.evaluate(async () => {
      const g = window.__gtm;
      const core = await import('/src/gfx/core.js');
      core.bloom.enabled = true;
      const gl = g.renderer.getContext();
      const px = new Uint8Array(4 * 64);
      const views = [[0, 17, 0, -40, 0.42, 'clear'], [120, 40, 140, 20, 0.42, 'clear'], [0, 46, 0, 0, 0.88, 'rain'], [-130, -10, -170, -30, 0.72, 'clear']];
      const out = [];
      for (const [x, z, tx, tz, t, w] of views) {
        g.setTime(t); g.setWeather(w); g.weather.rain = g.weather.targetRain;
        g.player.pos.set(x, 0, z);
        g.player.yaw = Math.atan2(tx - x, tz - z);
        g.setCamView(g.player.yaw + Math.PI, 0.3);
        g.step(30);
        await new Promise((res) => requestAnimationFrame(res));
        core.composer.render();
        gl.readPixels((gl.drawingBufferWidth / 2) | 0, (gl.drawingBufferHeight / 2) | 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let s = 0;
        for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
        out.push(Math.round(s / 64));
      }
      return out;
    });
    if (r.some((b) => b < 3)) throw new Error(`后期链出黑屏(各取景中心亮度 ${r.join(' / ')})`);
  },
  // 出招时序:伤害在判定帧(刀落下)才结算;按住蓄力→松手重击 ≥3 倍;轻击打断敌人起手
  async combatTiming(page) {
    await boot(page);
    await soloBandit(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const b = g.bandits.find((x) => !x.dead && !x.boss);
      if (!b) return { skip: true };
      // 测试只看我方出招:让盗贼别还手(挨打会打断蓄力,那是另一个测试的事)
      const place = () => { g.player.pos.set(b.pos.x, 0, b.pos.z - 1.4); g.player.yaw = 0; g.player.sta = 100; g.player.attackT = 0; b.attackCd = 99; b.windupT = 0; };
      place();
      b.hp = 20; b.armorT = 0;
      g.tryAttack();
      g.step(1);
      const afterPress = b.hp;
      g.step(40);
      const afterLight = b.hp;
      // 蓄力重击
      place();
      b.hp = 20; b.armorT = 0; b.hitStunT = 0; b.stunT = 0;
      g.player.chainN = 0; g.player.chainT = 0;
      g.attackDown(); // 按下即出轻击,按住 0.2 秒、这刀落下后转入蓄力
      g.step(75); // 1.25 秒:满蓄
      const charging = g.player.charging;
      const hpBeforeHeavy = b.hp;
      b.stunT = 0; b.hitStunT = 0; b.armorT = 0;
      g.attackUp();
      g.step(60);
      const heavyDmg = hpBeforeHeavy - b.hp;
      // 打断:敌人起手中挨一刀,起手作废
      place();
      b.hp = 20; b.armorT = 0; b.hitStunT = 0; b.stunT = 0;
      b.windupT = 0.6; b.yaw = Math.PI; // 面朝玩家起手
      g.tryAttack();
      g.step(30);
      return { afterPress, afterLight, charging, heavyDmg, windup: b.windupT, hitStun: b.hitStunT };
    });
    if (r.skip) return;
    if (r.afterPress !== 20) throw new Error('按下当帧就扣了血(应在判定帧)');
    if (r.afterLight >= 20) throw new Error('轻击没有命中');
    if (!r.charging) throw new Error('按住没有进入蓄力');
    if (r.heavyDmg < 3) throw new Error(`满蓄重击伤害太低:${r.heavyDmg}`);
    if (r.windup > 0) throw new Error('轻击没有打断敌人的起手');
  },
  // 战斗规则:出招中按键进缓冲不吞;敌人的刀只砍正前方扇形;挨打打断自己的刀;弹反窗口按游戏时钟
  async combatRules(page) {
    await boot(page);
    await soloBandit(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      const b = g.bandits.find((x) => !x.dead && !x.boss);
      if (!b) return { skip: true };
      const reset = () => {
        b.hp = 50; b.armorT = 0; b.hitStunT = 0; b.stunT = 0; b.windupT = 0; b.attackCd = 9; b.yaw = 0;
        g.player.sta = 100; g.player.attackT = 0; g.player.strike = null; g.player.atkBufT = 0;
        g.player.staggerT = 0; g.player.invulnT = 0; g.player.hp = g.player.maxHp; g.player.chainN = 0;
      };
      // 1) 缓冲:第一刀出手 0.17 秒后再按,收刀即接出第二刀
      reset();
      g.player.pos.set(b.pos.x, 0, b.pos.z - 1.4); g.player.yaw = 0;
      const s0 = g.stats.swings || 0;
      g.attackDown(); g.attackUp();
      g.step(10);
      g.attackDown(); g.attackUp();
      g.step(45);
      out.swings = (g.stats.swings || 0) - s0;
      // 2) 朝向:敌人面朝 +Z,人站在它身后 1.5m——锁定方向后出手砍不到
      reset();
      g.player.pos.set(b.pos.x, 0, b.pos.z - 1.5);
      b.windupT = 0.15;
      g.step(20);
      out.behindHp = g.player.hp;
      // 正前方 1.5m:挨刀
      reset();
      g.player.pos.set(b.pos.x, 0, b.pos.z + 1.5);
      b.windupT = 0.15;
      g.step(20);
      out.frontHp = g.player.hp;
      out.max = g.player.maxHp;
      // 3) 挨打打断自己的刀:起手中被砍,判定帧作废
      reset();
      g.player.pos.set(b.pos.x, 0, b.pos.z + 1.5); g.player.yaw = Math.PI;
      g.tryAttack();
      g.damagePlayer(1, b);
      out.strikeAfterHit = !!(g.player.strike && !g.player.strike.done);
      out.stagger = g.player.staggerT;
      // 4) 弹反窗口用游戏时钟:举盾当刻挨刀 = 弹反
      reset();
      g.step(20);
      g.player.pos.set(b.pos.x, 0, b.pos.z + 1.5); g.player.yaw = Math.PI;
      g.player.blockHeld = true;
      g.step(1);
      g.damagePlayer(1, b);
      out.parried = b.stunSrc === 'parry';
      g.player.blockHeld = false;
      g.step(1);
      return out;
    });
    if (r.skip) return;
    if (r.swings !== 2) throw new Error(`出招中按键被吞:两次按键只出了 ${r.swings} 刀`);
    if (r.behindHp !== r.max) throw new Error('站在敌人背后也挨了刀(出刀没看朝向)');
    if (!(r.frontHp < r.max)) throw new Error('站在敌人正前方却没挨刀');
    if (r.strikeAfterHit) throw new Error('挨打后自己的刀还会落下');
    if (!(r.stagger > 0)) throw new Error('挨打没有硬直');
    if (!r.parried) throw new Error('举盾当刻挨刀没有判成弹反');
  },
  // 招式规则:跳劈要跳够高(早按进缓冲)、半空顿一下再砸、挨打作废、落地 0.6 秒硬直(跳不起滚不了)、
  // 正面最近一人 2 伤其余溅 1(2.6 米、最多两人)、起跳 8 + 跳劈 22 体力;
  // 不锁定时 S/A/D+F 砍向正前方的目标(出刀后不再跟着脚步转身);判定帧前按翻滚进缓冲(刀照样落下),无敌帧 0.25 秒、翻滚 20 体力
  async moveset(page) {
    await boot(page);
    await installArena(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, A = window.__arena, P = g.player, out = {};
      // 1) 跳劈:起跳后下一帧就按 F → 先进缓冲,跳够高才砸
      A.reset(1);
      const [front, back, side] = A.foes(3);
      A.place(front, 0, 1.6); A.place(back, 0, -1.6); A.place(side, 1.4, 0.9);
      P.sta = 100;
      g.keys['Space'] = true; g.step(1);
      out.jumpSta = 100 - P.sta; // 8,减去这一帧的自然回复
      g.attackDown(); g.attackUp();
      out.plungeEarly = !!P.plunging;
      let n = 1, sta0 = P.sta;
      while (!P.plunging && n < 60) { sta0 = P.sta; g.step(1); n++; }
      out.plungeAt = n / 60; out.plungeH = P.pos.y; out.plungeSta = sta0 - P.sta;
      // 前摇:出手后在半空顿住约 0.12 秒(举剑),之后才砸下去
      const y0 = P.pos.y; let hang = 0, yHang = y0;
      for (let i = 0; i < 30 && !P.onGround; i++) { g.step(1); n++; if (P.vy !== 0) break; hang++; yHang = P.pos.y; }
      out.hangFrames = hang; out.hangDrift = Math.abs(yHang - y0);
      while (!P.onGround && n < 120) { g.step(1); n++; }
      out.landLag = P.landLagT;
      out.frontDmg = 50 - front.hp; out.backDmg = 50 - back.hp; out.sideDmg = 50 - side.hp;
      out.hitCount = [front, back, side].filter((b) => b.hp < 50).length;
      // 硬直中:跳不起、滚不了(快缓过来时按的翻滚进缓冲,缓过来就滚)
      const staLag = P.sta;
      g.keys['Space'] = true; g.step(1);
      out.jumpInLag = !P.onGround;
      g.step(14);
      out.staRegenInLag = P.sta - staLag;
      g.doRoll();
      out.rollInLag = P.rollT > 0;
      g.step(40);
      out.rollAfterLag = P.rollT > 0 || P.rollCd > 0;
      // 跳劈在半空挨了一刀:砸不下去(和地面出刀挨打作废同一条规矩),落地没有冲击波、也没有落地硬直
      A.reset(1);
      const [pf] = A.foes(1);
      A.place(pf, 0, 1.6);
      P.sta = 100;
      g.keys['Space'] = true; g.step(1);
      g.attackDown(); g.attackUp();
      let pq = 0;
      while (!P.plunging && pq < 60) { g.step(1); pq++; }
      P.blockHeld = true; g.step(2); // 砸落途中举不起盾(出招承诺)
      out.blockInPlunge = P.blocking; P.blockHeld = false;
      g.damagePlayer(1, pf);
      while (!P.onGround && pq < 150) { g.step(1); pq++; }
      g.step(2);
      out.plungeHitCancel = { dmg: 50 - pf.hp, lag: P.landLagT, plunging: P.plunging };
      // 跳劈的冲击:正面两人只有最近的那个吃 2(实打实的一砸),另一个溅到 1;冲击波 2.6 米,再远够不着
      A.reset();
      const [s1, s2, s3] = A.foes(3);
      A.place(s1, -0.6, 1.4); A.place(s2, 0.7, 1.9); A.place(s3, 0, -3.0);
      P.sta = 100;
      g.keys['Space'] = true; g.step(1);
      g.attackDown(); g.attackUp();
      for (let i = 0; i < 150 && !P.onGround; i++) g.step(1);
      g.step(2);
      out.splash = [50 - s1.hp, 50 - s2.hp, 50 - s3.hp];
      // 2) 不锁定:按住 S/A/D 再按 F,砍正前方 1.8m 的目标
      out.facing = {};
      for (const key of ['KeyS', 'KeyA', 'KeyD']) {
        A.reset(1);
        const [b] = A.foes(1);
        A.place(b, 0, 1.8);
        g.keys[key] = true; g.step(1);
        g.attackDown(); g.attackUp();
        let off = null;
        for (let i = 0; i < 40; i++) {
          const pend = P.strike && !P.strike.done;
          g.step(1);
          if (pend && !(P.strike && !P.strike.done) && off === null) {
            const want = Math.atan2(b.pos.x - P.pos.x, b.pos.z - P.pos.z);
            off = Math.abs(((P.yaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180 / Math.PI;
          }
        }
        g.keys[key] = false;
        out.facing[key] = { hit: b.hp < 50, off: off === null ? null : Math.round(off) };
      }
      // 3) 翻滚缓冲:出刀后立刻按翻滚 → 刀照样落下,落下后才滚;无敌帧 0.25 秒;20 体力
      A.reset(1);
      const [t] = A.foes(1);
      A.place(t, 0, 1.6);
      P.sta = 100;
      g.tryAttack(); g.step(1);
      g.doRoll();
      out.rollCancels = P.rollT > 0;
      let m = 0;
      while (!(P.rollT > 0) && m < 40) { g.step(1); m++; }
      out.bufferedHit = t.hp < 50;
      out.rolled = P.rollT > 0;
      out.iframes = P.invulnT;
      out.rollSta = 100 - 12 - P.sta; // 轻斩 12 + 翻滚
      // 4) 蓄力不足 0.3 秒就松手:只有先出的那一记轻击,重击不出手("轻 + 秒放重击"不再白赚一刀)
      A.reset(1);
      const [q] = A.foes(1);
      A.place(q, 0, 1.6);
      P.sta = 100;
      g.attackDown();
      let c = 0;
      while (!P.charging && c < 40) { g.step(1); c++; }
      out.quickCharged = P.charging;
      g.step(6); g.attackUp(); g.step(40);
      out.quickDmg = 50 - q.hp;
      return out;
    });
    if (r.plungeEarly) throw new Error('起跳下一帧就出了跳劈(应等跳够高)');
    if (!(r.hangFrames >= 6 && r.hangFrames <= 8) || r.hangDrift > 0.01) throw new Error(`跳劈前摇应在半空顿住约 0.12 秒:${r.hangFrames} 帧,漂移 ${r.hangDrift}`);
    if (!(r.plungeAt >= 0.14 && r.plungeAt <= 0.3)) throw new Error(`跳劈起手时刻不对:${r.plungeAt.toFixed(2)}s(缓冲应在够高时自动出手)`);
    if (!(r.plungeH >= 0.99)) throw new Error(`跳劈起手高度不够:${r.plungeH.toFixed(2)}m`);
    if (!(r.landLag > 0.5)) throw new Error(`跳劈落地没有硬直:${r.landLag}`);
    if (Math.abs(r.jumpSta - 8) > 0.5 || r.plungeSta !== 22) throw new Error(`起跳/跳劈体力应为 8/22,实际 ${r.jumpSta}/${r.plungeSta}`);
    if (r.staRegenInLag > 0) throw new Error('跳劈落地硬直中体力还在回');
    if (r.frontDmg !== 2 || r.backDmg !== 1) throw new Error(`跳劈伤害:正面应 2、背后应 1,实际 ${r.frontDmg}/${r.backDmg}`);
    if (r.hitCount !== 2) throw new Error(`跳劈最多砸中两人,实际 ${r.hitCount}`);
    if (r.jumpInLag) throw new Error('跳劈落地硬直中还能起跳');
    if (r.rollInLag) throw new Error('跳劈落地硬直中还能翻滚');
    if (!r.rollAfterLag) throw new Error('硬直中按的翻滚没有进缓冲');
    if (r.splash.join() !== '2,1,0') throw new Error(`跳劈应只有正面最近一人吃 2、旁人溅 1、2.6 米外不中:${r.splash}`);
    if (r.blockInPlunge) throw new Error('跳劈砸落途中还能举盾');
    const pc = r.plungeHitCancel;
    if (pc.dmg !== 0 || pc.lag > 0 || pc.plunging) throw new Error(`半空挨打的跳劈不该再砸下来:${JSON.stringify(pc)}`);
    for (const [k, f] of Object.entries(r.facing)) {
      if (!f.hit || f.off === null || f.off > 15) throw new Error(`不锁定 ${k}+F 没砍中正前方目标:${JSON.stringify(f)}`);
    }
    if (r.rollCancels) throw new Error('判定帧前按翻滚直接取消了出招(应进缓冲)');
    if (!r.bufferedHit || !r.rolled) throw new Error(`缓冲翻滚不对:刀${r.bufferedHit ? '' : '没'}落下,${r.rolled ? '' : '没'}滚出去`);
    if (Math.abs(r.iframes - 0.25) > 0.02) throw new Error(`翻滚无敌帧应为 0.25 秒,实际 ${r.iframes}`);
    if (r.rollSta !== 20) throw new Error(`翻滚体力应为 20,实际 ${r.rollSta}`);
    if (!r.quickCharged) throw new Error('按住没有转入蓄力');
    if (r.quickDmg !== 1) throw new Error(`蓄力不足 0.3 秒松手不该出重击:总伤害 ${r.quickDmg}(应只有轻击的 1)`);
  },
  // 防御规则:弹反窗 150ms;松盾 0.4 秒内再举不重开弹反窗、举了 0.3 秒没等到刀 = 落空冷却 0.6 秒(连点右键换不来弹反);
  // 一次弹反只换一次处决;精英处决封顶最大血量 35%;紫圈(破盾)弹不开、挡下也吃满伤害 + 0.6 秒硬直
  async defense(page) {
    await boot(page);
    await installArena(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, A = window.__arena, P = g.player, out = {};
      let b = null;
      const fresh = () => { A.reset(); [b] = A.foes(1); A.place(b, 0, 1.5, Math.PI); P.yaw = 0; g.step(40); };
      const raise = () => { P.blockHeld = true; g.step(1); };
      const lower = () => { P.blockHeld = false; g.step(1); };
      const parried = () => { const ok = b.stunSrc === 'parry'; b.stunT = 0; b.stunSrc = ''; return ok; };
      // 1) 窗口:举盾后 7 帧(117ms)挨刀 = 弹反;10 帧(167ms)= 普通格挡(扣体力)
      fresh(); raise(); g.step(7); g.damagePlayer(1, b); out.win133 = parried();
      fresh(); raise(); g.step(10); P.sta = 100; g.damagePlayer(1, b); out.win167 = parried(); out.blockSta = 100 - P.sta;
      // 2) 连点:松盾 0.1 秒就再举 → 不重开弹反窗
      fresh(); raise(); g.step(5); lower(); g.step(5); raise(); g.damagePlayer(1, b); out.mash = parried();
      // 3) 落空冷却:举 0.35 秒没等到刀 → 松开等 0.45 秒再举(还在冷却里)→ 弹不了;再等够了 → 能弹
      fresh(); raise(); g.step(21); lower(); g.step(27); raise(); g.damagePlayer(1, b); out.afterFail = parried();
      lower(); g.step(60); raise(); g.damagePlayer(1, b); out.cleanRaise = parried();
      // 4) 一次弹反只换一次处决:弹反后连砍三刀,只有第一刀是 ×5
      fresh(); b.hp = 50; b.maxHp = 50; raise(); g.damagePlayer(1, b); lower();
      const hits = [];
      for (let i = 0; i < 3; i++) {
        const hp0 = b.hp; P.attackT = 0; P.strike = null; g.tryAttack(); g.step(40); hits.push(hp0 - b.hp);
        b.hitStunT = 0; b.armorT = 0; b.fleeT = 0; A.place(b, 0, 1.5, Math.PI);
      }
      out.execHits = hits;
      // 5) 精英处决封顶:16 血的精英,高基础伤害的处决也只掉 35%(6)
      fresh(); b.hp = 16; b.maxHp = 16; b.duel = true; P.relic = true; P.swordLv = 2;
      raise(); g.damagePlayer(1, b); lower();
      P.attackT = 0; P.strike = null; g.tryAttack(); g.step(40);
      out.eliteExec = 16 - b.hp;
      b.duel = false; P.relic = false; P.swordLv = 1;
      // 6) 紫圈:正面举盾(弹反窗内)也弹不开,吃满 3 伤 + 0.6 秒硬直
      fresh(); raise(); const hp0 = P.hp; g.damagePlayer(3, b, true);
      out.pierceParried = b.stunSrc === 'parry'; out.pierceDmg = hp0 - P.hp; out.pierceStagger = P.staggerT;
      // 7) 盾击:面前的人撞个踉跄(约 0.8 秒、不开处决:接着砍只是普通一刀),身后的不受影响
      fresh(); const [, back] = A.foes(2); A.place(back, 0, -1.5, 0); A.place(b, 0, 1.5, Math.PI);
      raise(); g.step(2);
      P.attackT = 0; g.tryAttack(); g.step(1);
      out.bash = { front: +b.stunT.toFixed(2), src: b.stunSrc, back: back.stunT, hp: b.hp };
      lower(); g.step(10); A.place(b, 0, 1.5, Math.PI); // 盾击的大击退把人撞出了刀长:摆回面前再砍
      P.attackT = 0; P.strike = null; g.tryAttack(); g.step(40);
      out.bash.afterHit = out.bash.hp - b.hp;
      return out;
    });
    if (!r.win133) throw new Error('举盾 133ms 内挨刀没判成弹反');
    if (r.win167) throw new Error('举盾 167ms 后挨刀还判成弹反(窗口应为 150ms)');
    if (r.blockSta !== 14) throw new Error(`普通格挡应扣 14 体力,实际 ${r.blockSta}`);
    if (r.mash) throw new Error('松盾 0.1 秒再举仍能弹反(连点右键不该重开弹反窗)');
    if (r.afterFail) throw new Error('弹反落空后的冷却里仍能弹反');
    if (!r.cleanRaise) throw new Error('冷却过后干净地举盾却弹不了');
    if (r.execHits[0] !== 5 || r.execHits[1] >= 5 || r.execHits[2] >= 5) throw new Error(`一次弹反应只换一次处决:${r.execHits}`);
    if (r.eliteExec !== 6) throw new Error(`16 血精英的处决应封顶 6(35%),实际 ${r.eliteExec}`);
    if (r.pierceParried) throw new Error('紫圈破盾重击被弹反了');
    if (r.pierceDmg !== 3) throw new Error(`举盾挡紫圈应吃满 3 伤,实际 ${r.pierceDmg}`);
    if (!(r.pierceStagger > 0.55)) throw new Error(`挡紫圈应有 0.6 秒硬直,实际 ${r.pierceStagger}`);
    const bs = r.bash;
    if (!(bs.front > 0.7 && bs.front <= 0.8) || bs.src !== 'bash' || bs.back > 0) throw new Error(`盾击应只撞晕面前的人约 0.8 秒:${JSON.stringify(bs)}`);
    if (bs.afterHit !== 1) throw new Error(`盾击的踉跄不开处决,接着砍应只掉 1:${JSON.stringify(bs)}`);
  },
  // 敌人出招:预警 = 判定(锚在起手站位,半径 = 刀长 + 跟步突进,±60°);起手末段真的往前冲;起手后 40% 轻击打不断;
  // 紫圈是双手过顶的独立架势;吓跑即收刀(扇形熄灭);踉跄会晃;狼扑画 5.4×2.4 的走廊且与判定一致;举刀扎马能扎到疾驰的骑手
  async foeAttacks(page) {
    await boot(page);
    await installArena(page);
    const r = await page.evaluate(async () => {
      const g = window.__gtm, A = window.__arena, P = g.player, out = {};
      const ai = await import('/src/systems/ai.js');
      const S = ai.FOE_MOVES.slash, R = S.reach + S.lunge;
      // 1) 几何:起手最后一帧把人放到(角度, 距离),看挨不挨(锚点 = 起手站位,还没冲)
      const probe = (angDeg, dist) => {
        A.reset(); const [b] = A.foes(1); A.place(b, 0, 4, Math.PI);
        ai.startFoeMove(b, 'slash'); b.windupT = 0.008;
        const a = b.yaw + angDeg * Math.PI / 180;
        P.pos.set(b.pos.x + Math.sin(a) * dist, 0, b.pos.z + Math.cos(a) * dist); P.invulnT = 0;
        const hp0 = P.hp; g.step(1); return hp0 - P.hp > 0;
      };
      out.geo = { in: probe(0, R - 0.1), out: probe(0, R + 0.15), edgeIn: probe(57, 2.5), edgeOut: probe(63, 2.5) };
      // 预警扇形的尺寸就是判定尺寸
      A.reset(); const [t] = A.foes(1); A.place(t, 0, 4, Math.PI); ai.startFoeMove(t, 'slash');
      const sec = g.dangerFX.find((f) => f.e === t);
      out.sector = sec ? { range: sec.range, anchored: sec.anchored } : null;
      // 2) 起手末段跟步突进:站在 R-0.2 处不动,敌人往前冲约 1 米、照样砍中
      A.reset(); const [c] = A.foes(1); A.place(c, 0, R - 0.2, Math.PI);
      const z0 = c.pos.z, hp0 = P.hp; ai.startFoeMove(c, 'slash');
      for (let i = 0; i < 45; i++) { g.step(1); P.pos.set(0, 0, 180); }
      out.lunge = +(z0 - c.pos.z).toFixed(2); out.lungeHit = hp0 - P.hp;
      // 3) 起手后段霸体:前 60% 砍中 = 打断;后 40% 砍中 = 打不断(刀照样落下)
      const interrupt = (waitF) => {
        A.reset(); const [d] = A.foes(1); A.place(d, 0, 1.6, Math.PI);
        ai.startFoeMove(d, 'slash'); g.step(waitF);
        P.attackT = 0; g.tryAttack(); g.step(12);
        return { interrupted: !(d.windupT > 0) && d.hitStunT > 0 };
      };
      out.early = interrupt(4); out.late = interrupt(15);
      // 4) 紫圈:双手举过头顶(左臂也举起来);红圈只举右手
      A.reset(); const [h] = A.foes(1); A.place(h, 0, 3, Math.PI); h.duel = true;
      ai.startFoeMove(h, 'heavy'); g.step(20);
      out.heavyArmL = h.parts.armL.rotation.x; out.heavyPurple = !!g.dangerFX.find((f) => f.e === h && f.zone.material.color.getHex() === 0xb040ff);
      A.reset(); const [s] = A.foes(1); A.place(s, 0, 3, Math.PI);
      ai.startFoeMove(s, 'slash'); g.step(20);
      out.slashArmL = s.parts.armL.rotation.x;
      // 5) 吓跑即收刀,扇形熄灭
      A.reset(); const [f] = A.foes(1); A.place(f, 0, 2, Math.PI); f.hp = 1;
      ai.startFoeMove(f, 'slash'); g.step(5); g.frightenBandits(14); g.step(1);
      out.fleeWindup = f.windupT; out.fleeSector = g.dangerFX.filter((x) => x.e === f).length;
      // 别的路子直接把它吓跑(战团溃散直接设 fleeT):起手同样作废,跑完回头不会凭空补一刀
      A.reset(); const [f2] = A.foes(1); A.place(f2, 0, 2, Math.PI);
      ai.startFoeMove(f2, 'slash'); g.step(5); f2.fleeT = 0.5; g.step(1);
      out.fleeWindup2 = f2.windupT; out.fleeSector2 = g.dangerFX.filter((x) => x.e === f2).length;
      // 6) 踉跄会晃
      A.reset(); const [w0] = A.foes(1); A.place(w0, 0, 2, Math.PI); w0.stunT = 1.5; w0.stunSrc = 'parry';
      let wob = 0; for (let i = 0; i < 20; i++) { g.step(1); wob = Math.max(wob, Math.abs(w0.group.rotation.z)); }
      out.wobble = wob;
      w0.stunT = 0; w0.stunSrc = ''; g.step(1); // 踉跄被处决用掉:身子要扶正
      out.wobbleAfter = Math.abs(w0.group.rotation.z);
      // 7) 狼扑:走廊判定(侧偏 1.1 米咬中、1.3 米落空),自然起扑时画 5.4×2.4 的长条
      A.reset();
      const wolf = g.wolves.find((x) => !x._prol);
      const revive = () => Object.assign(wolf, { dead: false, hp: 50, stunT: 0, hitStunT: 0, armorT: 0, biteT: 0, lunging: 0,
        lungeHit: false, attackCd: 99, lungeCd: 99, raidTarget: null, arena: false, _hold: false, respawnT: 1e9 });
      const lat = (dx) => {
        A.reset(); revive(); wolf.group.visible = true;
        wolf.pos.set(0, 0, 184); wolf.yaw = Math.PI; wolf.lunging = 0.78; wolf.lungeX = 0; wolf.lungeZ = -1;
        const hp0 = P.hp;
        for (let i = 0; i < 60; i++) { g.step(1); P.pos.set(dx, 0, 182); P.invulnT = Math.min(P.invulnT, 0); }
        return hp0 - P.hp > 0;
      };
      out.wolf = { lat11: lat(1.1), lat13: lat(1.3) };
      A.reset(); revive(); wolf.group.visible = true; wolf.pos.set(0, 0, 184.5); wolf.lungeCd = 0; wolf.attackCd = 9;
      let rect = null;
      for (let i = 0; i < 60 && !rect; i++) { g.step(1); rect = g.dangerFX.find((x) => x.e === wolf && x.rect); }
      out.wolfRect = rect ? { len: rect.range, width: rect.width } : null;
      wolf.dead = true; wolf.group.visible = false;
      // 8) 举刀扎马:疾驰冲进正面 2.4 米就挨 2 下
      A.reset(); const [m] = A.foes(1); A.place(m, 0, 14, Math.PI);
      const horse = P.horse; horse.pos.set(0, 0, 180); P.mounted = horse;
      m.braceT = 1.2; m._cavCd = 9;
      g.keys['KeyW'] = true; g.keys['ShiftLeft'] = true;
      const hpM = P.hp;
      for (let i = 0; i < 50 && P.hp === hpM; i++) g.step(1);
      g.keys['KeyW'] = false; g.keys['ShiftLeft'] = false;
      out.braceDmg = hpM - P.hp;
      if (P.mounted) P.mounted = null;
      return out;
    });
    const R = 3.3;
    if (!r.geo.in || r.geo.out) throw new Error(`判定半径应为刀长+突进 ${R}m:${JSON.stringify(r.geo)}`);
    if (!r.geo.edgeIn || r.geo.edgeOut) throw new Error(`判定张角应为 ±60°:${JSON.stringify(r.geo)}`);
    if (!r.sector || Math.abs(r.sector.range - R) > 1e-6 || !r.sector.anchored) throw new Error(`预警扇形与判定不一致:${JSON.stringify(r.sector)}`);
    if (!(r.lunge > 0.8 && r.lunge < 1.1)) throw new Error(`起手末段应向前突进约 1m,实际 ${r.lunge}`);
    if (!(r.lungeHit > 0)) throw new Error('站在突进后的刀长里却没挨刀');
    if (!r.early.interrupted) throw new Error('起手前段轻击没有打断');
    if (r.late.interrupted) throw new Error('起手后段(霸体)被轻击打断了');
    if (!(r.heavyArmL < -2) || !r.heavyPurple) throw new Error(`紫圈重击应双手过顶、扇形发紫:左臂 ${r.heavyArmL}`);
    if (r.slashArmL < -1) throw new Error('红圈劈砍不该双手举刀(和紫圈分不开)');
    if (r.fleeWindup > 0 || r.fleeSector > 0) throw new Error(`吓跑后起手没收(windup ${r.fleeWindup},扇形 ${r.fleeSector})`);
    if (r.fleeWindup2 > 0 || r.fleeSector2 > 0) throw new Error(`直接设溃逃后起手没收(windup ${r.fleeWindup2},扇形 ${r.fleeSector2})`);
    if (!(r.wobble > 0.05)) throw new Error('踉跄时身子不晃');
    if (r.wobbleAfter > 1e-6) throw new Error(`踉跄被用掉后身子还歪着:${r.wobbleAfter}`);
    if (!r.wolf.lat11 || r.wolf.lat13) throw new Error(`狼扑判定走廊应为两侧 1.2m:${JSON.stringify(r.wolf)}`);
    if (!r.wolfRect || Math.abs(r.wolfRect.len - 5.4) > 1e-6 || Math.abs(r.wolfRect.width - 2.4) > 1e-6) throw new Error(`狼扑预警应为 5.4×2.4 的长条:${JSON.stringify(r.wolfRect)}`);
    if (r.braceDmg !== 2) throw new Error(`疾驰冲进举刀扎马的盗贼应挨 2 下,实际 ${r.braceDmg}`);
  },
  // 霜龙:俯冲的贴地航线长条 = 判定(头 5 米半空段不判、横偏出 2.6 米不判);冰息追着人砸(站着不动必挨);
  // 空中两招间隔 3~5 秒;落地爪击能用盾挡、龙尾横扫(紫环)挡不住
  async dragon(page) {
    await boot(page);
    await installArena(page);
    const r = await page.evaluate(async () => {
      const g = window.__gtm, P = g.player, d = g.dragonRT, out = {};
      const dm = await import('/src/systems/dragon.js');
      g.setTime(0.9);
      const SX = g.DRAGON_SKULL.x, SZ = g.DRAGON_SKULL.z;
      const fresh = () => {
        if (d.on && d.ent) g.scene.remove(d.ent.group);
        d.on = false; g.awakenDragon();
        Object.assign(P, { hp: P.maxHp, invulnT: 0, blocking: false, blockHeld: false, staggerT: 0, sta: P.maxSta, dead: false });
      };
      // 1) 俯冲:龙从 (SX-20, SZ) 沿 +X 扑向 (SX, SZ),冲过 6 米
      const swoop = (along, lat) => {
        fresh();
        d.ent.group.position.set(SX - 20, 10, SZ); d.phase = 'circle';
        P.pos.set(SX, 0, SZ);
        d.swoopsLeft = 1; dm.beginSwoopWind(0.05);
        const strip = g.dangerFX.find((f) => f.rect && !f.watch);
        const hp0 = P.hp;
        for (let i = 0; i < 120 && d.phase !== 'circle'; i++) { P.pos.set(SX - 20 + along, 0, SZ + lat); P.invulnT = 0; g.step(1); }
        return { hit: hp0 - P.hp > 0, strip: strip ? { x: +(strip.e.pos.x - SX).toFixed(2), len: +strip.range.toFixed(2), w: strip.width } : null };
      };
      out.swoop = { on10: swoop(10, 0), side29: swoop(10, 2.9), side24: swoop(10, 2.4), dive3: swoop(3, 0), past24: swoop(24, 0), past29: swoop(29, 0) };
      // 外部直接设落点、直接进蓄势(调试/评审脚本的做法,不走 beginSwoopWind):按龙此刻的位置定航线,
      // 不沿用上一趟(上面那几趟沿 +X,这一趟沿 +Z)
      const direct = (lat) => {
        fresh();
        d.ent.group.position.set(SX, 10, SZ - 20); d.phase = 'swoopWind'; d.t = 0.01; d.swX = SX; d.swZ = SZ; d._sw = false; d.swoopsLeft = 1;
        const hp0 = P.hp;
        for (let i = 0; i < 120 && d.phase !== 'circle'; i++) { P.pos.set(SX + lat, 0, SZ - 10); P.invulnT = 0; g.step(1); }
        return hp0 - P.hp > 0;
      };
      out.direct = { on: direct(0), side: direct(2.9) };
      // 2) 冰息:人站着不动 → 至少挨一下;第二团的圈跟到人挪过去的新位置
      fresh();
      d.ent.group.position.set(SX, 9, SZ - 15); d.phase = 'breath'; d.t = 2; d.breathN = 0; d.breathT = 0;
      P.pos.set(SX, 0, SZ); const hp1 = P.hp;
      g.step(2);
      const ring1 = g.dangerFX.filter((f) => f.fixed).map((f) => [f.e.pos.x, f.e.pos.z]).pop();
      P.pos.set(SX + 8, 0, SZ); g.step(1);
      let ring2 = null;
      for (let i = 0; i < 40 && !ring2; i++) { g.step(1); P.pos.set(SX + 8, 0, SZ); const rs = g.dangerFX.filter((f) => f.fixed); if (rs.length >= 2) ring2 = [rs[rs.length - 1].e.pos.x, rs[rs.length - 1].e.pos.z]; }
      P.pos.set(SX, 0, SZ);
      for (let i = 0; i < 90; i++) { g.step(1); }
      out.breath = { ring1: ring1 && [+(ring1[0] - SX).toFixed(1), +(ring1[1] - SZ).toFixed(1)], ring2: ring2 && [+(ring2[0] - SX).toFixed(1), +(ring2[1] - SZ).toFixed(1)], hurtStanding: hp1 - P.hp };
      for (let i = 0; i < 120 && d.phase === 'breath'; i++) g.step(1);
      out.gap = d.phase === 'circle' ? +d.t.toFixed(2) : null;
      // 3) 落地:爪击正面举盾挡得住(只扣体力);龙尾横扫举盾也挡不住
      const landHit = (claw) => {
        fresh();
        d.ent.group.position.set(SX, 0, SZ); d.ent.group.rotation.set(0, 0, 0);
        d.phase = 'land'; d.t = 7; d.landDmg = 0; d.atkT = 0; d.landAtk = null; d.nextClaw = claw;
        P.pos.set(SX, 0, SZ + 3); P.yaw = Math.PI; P.blockHeld = true; P.parryReadyAt = 1e12; // 只举盾,不弹反
        const hp0 = P.hp, sta0 = P.sta;
        for (let i = 0; i < 70; i++) { P.pos.set(SX, 0, SZ + 3); P.yaw = Math.PI; g.step(1); }
        P.blockHeld = false;
        return { hurt: hp0 - P.hp, sta: +(sta0 - P.sta).toFixed(1) };
      };
      out.claw = landHit(true); out.tail = landHit(false);
      if (d.on && d.ent) g.scene.remove(d.ent.group);
      d.on = false;
      return out;
    });
    const s = r.swoop;
    if (!s.on10.hit || !s.side24.hit || !s.past24.hit) throw new Error(`站在俯冲航线长条里没挨:${JSON.stringify(s)}`);
    if (s.side29.hit || s.dive3.hit || s.past29.hit) throw new Error(`长条外(横偏 2.9 / 半空段 / 航线尽头外)也挨了:${JSON.stringify(s)}`);
    if (!r.direct.on || r.direct.side) throw new Error(`直接设落点进蓄势的俯冲没按新航线判伤:${JSON.stringify(r.direct)}`);
    const st = s.on10.strip;
    if (!st || Math.abs(st.x - -15) > 0.01 || Math.abs(st.len - 23.6) > 0.01 || st.w !== 5.2) throw new Error(`俯冲预警长条尺寸不对:${JSON.stringify(st)}`);
    const b = r.breath;
    if (!(b.hurtStanding >= 2)) throw new Error(`站着不动没挨冰息:${JSON.stringify(b)}`);
    if (!b.ring2 || Math.abs(b.ring2[0] - 8) > 1.5) throw new Error(`冰息没有追着人砸:${JSON.stringify(b)}`);
    if (!(r.gap >= 2.4 && r.gap <= 5)) throw new Error(`空中两招间隔应为 3~5 秒(半血后 ×0.8),实际 ${r.gap}`);
    if (r.claw.hurt !== 0 || !(r.claw.sta > 0)) throw new Error(`龙爪应能被正面举盾挡下:${JSON.stringify(r.claw)}`);
    if (!(r.tail.hurt >= 2)) throw new Error(`龙尾横扫(紫环)不该被盾挡住:${JSON.stringify(r.tail)}`);
  },
  // 序章教学:锁定 → 翻滚 → 格挡 → 出刀 → 魔光弹 → 清场;做到才进下一步,结束回满血并送马
  async prologue(page) {
    await boot(page, { start: false });
    await page.click('#title', { timeout: 180000 }); // 机器很忙时标题动画迟迟不"稳定",别 30 秒就判失败
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const g = window.__gtm, P = g.prologue, log = [];
      if (!P.on) return { err: '新档没有进入序章' };
      const until = (fn, max = 900) => { for (let i = 0; i < max && !fn(); i++) g.step(1); return fn(); };
      until(() => P.step >= 1, 200); log.push(P.step);
      g.toggleLock();
      until(() => P.step >= 2, 30); log.push(P.step);
      const w0 = P.wolves[0];
      if (!until(() => w0.lunging > 0 || w0.biteT > 0, 900)) return { err: '第一只狼迟迟不出手', log };
      g.doRoll();
      until(() => P.step >= 3, 60); log.push(P.step);
      g.player.blockHeld = true; g.player.blocking = true; g.player.blockStart = g.simNow() - 5000;
      until(() => P.step >= 4, 1200); log.push(P.step);
      g.player.blockHeld = false; g.player.blocking = false;
      g.killWolf(w0);
      until(() => P.step >= 5, 30); log.push(P.step);
      g.player.castT = 0; g.player.mp = 6;
      g.castSpell();
      until(() => P.step >= 6, 90); log.push(P.step);
      for (const w of P.wolves) if (!w.dead) g.killWolf(w);
      until(() => P.step >= 7, 30); log.push(P.step);
      until(() => !P.on, 400);
      return { on: P.on, log, hp: g.player.hp, maxHp: g.player.maxHp, horse: !!g.player.horse };
    });
    if (r.err) throw new Error(r.err + ' ' + JSON.stringify(r.log || []));
    if (r.on) throw new Error(`序章没有走完:${JSON.stringify(r.log)}`);
    if (r.log.join(',') !== '1,2,3,4,5,6,7') throw new Error(`步骤不对:${r.log}`);
    if (r.hp !== r.maxHp) throw new Error('序章结束没有回满血');
    if (!r.horse) throw new Error('序章结束没有送马');
  },
  // 序章出刀练习(第 4 步):弹反后的处决不算数;轻击打中 3 下 + 蓄力重击打中 1 下才练成,练成那一刀狼倒下、进下一步
  async prologueDrill(page) {
    await boot(page, { start: false });
    await page.click('#title');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const g = window.__gtm, P = g.prologue, pl = g.player, out = {};
      if (!P.on) return { err: '新档没有进入序章' };
      const w0 = P.wolves[0];
      w0._hold = false;
      P.step = 3; P.flags.blocked = true; P.t = 0;
      g.step(1);
      out.step = P.step; out.hp0 = w0.hp;
      const pin = () => { w0.pos.set(pl.pos.x, 0, pl.pos.z + 1.6); w0.yaw = Math.PI; w0.attackCd = 99; w0.lungeCd = 99; w0.biteT = 0; w0.lunging = 0; };
      const hit = () => { pl.yaw = 0; pl.attackT = 0; pl.strike = null; pl.sta = pl.maxSta; pin(); g.tryAttack(); for (let i = 0; i < 40; i++) { pin(); g.step(1); } w0.hitStunT = 0; w0.armorT = 0; };
      // 弹反后的处决:狼只是晃一下,不算练刀
      pin(); w0.stunT = 2; w0.stunSrc = 'parry';
      hit();
      out.afterExec = { light: P.flags.light, dead: w0.dead, step: P.step };
      for (let i = 0; i < 3; i++) hit();
      out.afterLight = { light: P.flags.light, heavy: P.flags.heavy, dead: w0.dead, step: P.step };
      // 蓄力重击:按住 1.2 秒满蓄,松手
      pl.attackT = 0; pl.strike = null; pl.sta = pl.maxSta; pl.chainN = 0;
      pin(); g.attackDown();
      for (let i = 0; i < 72; i++) { pin(); g.step(1); }
      g.attackUp();
      for (let i = 0; i < 40 && !w0.dead; i++) { pin(); g.step(1); }
      g.step(2);
      out.afterHeavy = { heavy: P.flags.heavy, dead: w0.dead, step: P.step };
      return out;
    });
    if (r.err) throw new Error(r.err);
    if (r.step !== 4 || !(r.hp0 >= 30)) throw new Error(`进入出刀练习时狼应扛得住(hp ${r.hp0},step ${r.step})`);
    if (r.afterExec.light !== 0 || r.afterExec.dead || r.afterExec.step !== 4) throw new Error(`弹反处决不该算练刀:${JSON.stringify(r.afterExec)}`);
    if (r.afterLight.light !== 3 || r.afterLight.dead || r.afterLight.step !== 4) throw new Error(`轻击 3 下后还差重击:${JSON.stringify(r.afterLight)}`);
    if (r.afterHeavy.heavy !== 1 || !r.afterHeavy.dead || r.afterHeavy.step !== 5) throw new Error(`重击打中后应练成并进下一步:${JSON.stringify(r.afterHeavy)}`);
  },
  // 伤害来源 × 目标矩阵:谁打的决定算不算你的罪、进不进你的连杀
  async damageMatrix(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      const gd = () => g.guards.find((x) => !x.dead && !(x.downT > 0));
      const bd = () => g.bandits.find((x) => !x.dead && !x.boss && !x.duel);
      // 敌人互殴/伙伴伤到卫兵:不算你的罪
      let x = gd(); x.hp = 5; g.applyDamage(x, 1, { source: 'foe' }); out.foeWanted = g.getWanted();
      x = gd(); x.hp = 5; g.applyDamage(x, 1, { source: 'companion' }); out.compWanted = g.getWanted();
      // 伙伴击杀盗贼:不进你的连杀
      let b = bd(); const k0 = g.stats.kills || 0; b.hp = 1; g.applyDamage(b, 1, { source: 'companion', credit: '测试' });
      out.compKill = (g.stats.kills || 0) - k0; out.compDead = b.dead;
      // 你亲手击杀:进连杀
      b = bd(); const k1 = g.stats.kills || 0; b.hp = 1; g.applyDamage(b, 1); out.playerKill = (g.stats.kills || 0) - k1;
      // 你伤到卫兵:通缉
      x = gd(); x.hp = 5; x.wantedHit = false; g.applyDamage(x, 1); out.playerWanted = g.getWanted();
      return out;
    });
    if (r.foeWanted !== 0 || r.compWanted !== 0) throw new Error(`非玩家来源伤到卫兵却通缉了你:${JSON.stringify(r)}`);
    if (!r.compDead || r.compKill !== 0) throw new Error(`伙伴击杀结算不对:${JSON.stringify(r)}`);
    if (r.playerKill !== 1) throw new Error('亲手击杀没有进连杀');
    if (!(r.playerWanted > 0)) throw new Error('你伤到卫兵却没有通缉');
  },
  // 受击目标注册表:近战/箭/爆炸/踩踏 × 卫兵/盗贼/狼/鹿/鸡/村民,每一格都打得到,副作用(犯罪、连杀、任务进度)锁死
  async hitMatrix(page) {
    await boot(page);
    await installArena(page);
    const r = await page.evaluate(async () => {
      const g = window.__gtm, A = window.__arena, P = g.player;
      const law = await import('/src/systems/law.js'), fauna = await import('/src/systems/fauna.js');
      const X = 0, Z = 180;
      const wolf = g.wolves.find((w) => !w._prol), deer = g.deers[0], hen = g.chickens.find((c) => !c.extra);
      const vil = g.villagers[0], gd = g.guards[0];
      g.setTime(0.45); // 白天:村民不回家睡觉
      const qi = g.missions.findIndex((m) => m.type === 'bandits');
      // 每一格:把目标摆在玩家正前方(每帧钉住,免得走开/逃开),施加伤害源,看结果
      const setups = {
        guard: () => { Object.assign(gd, { downT: 0, stunT: 0, hp: 3, wantedHit: false, windupT: 0, state: 'patrol' }); return gd; },
        bandit: () => { const [b] = A.foes(1); b.hp = 1; b.ambient = false; return b; },
        wolf: () => { Object.assign(wolf, { dead: false, hp: 1, stunT: 0, hitStunT: 0, biteT: 0, lunging: 0, attackCd: 99, lungeCd: 99, respawnT: 1e9, raidTarget: null, _hold: false }); wolf.group.visible = true; return wolf; },
        deer: () => { Object.assign(deer, { dead: false, hp: 1, fleeT: 0 }); deer.group.visible = true; return deer; },
        chicken: () => { Object.assign(hen, { state: 'idle', timer: 99 }); return hen; },
        villager: () => { Object.assign(vil, { downT: 0, sleeping: false, fleeT: 0, timer: 99 }); vil.group.visible = true; vil.group.rotation.x = 0; return vil; },
      };
      const outcome = (kind, e) => kind === 'chicken' ? e.state === 'flee'
        : kind === 'deer' ? (e.dead || e.fleeT > 1.5)
          : kind === 'villager' ? e.downT > 0
            : kind === 'guard' ? (e.hp < 3 || e.stunT > 0 || e.downT > 0)
              : (e.dead || e.stunT > 0);
      const sources = {
        melee: () => { P.weapon = 'sword'; P.attackT = 0; P.strike = null; g.tryAttack(); return 30; },
        arrow: () => { P.weapon = 'bow'; P.attackT = 0; g.tryAttack(); return 50; },
        blast: (e) => { g.explodeAt(e.pos.x, e.pos.z, 2, 1.5); return 2; },
        stomp: () => { P.pos.set(X, 1.2, Z + 1.6); P.vy = -6; P.onGround = false; return 20; },
      };
      const out = {};
      for (const [src, fire] of Object.entries(sources)) {
        for (const [kind, setup] of Object.entries(setups)) {
          A.reset(); law.clearWanted();
          g.quest.active = true; g.quest.idx = qi; g.quest.progress = 0; g.quest.timer = 0;
          const e = setup();
          const at = src !== 'arrow' ? 1.6 : kind === 'chicken' ? 16 : 3.5; // 箭要飞出十五六米才掉到鸡的高度
          const pin = () => { e.pos.set(X, 0, Z + at); if (e.group) e.group.position.copy(e.pos); };
          pin(); P.yaw = 0; g.step(1); pin();
          const k0 = g.stats.kills || 0;
          const n = fire(e);
          for (let i = 0; i < n; i++) { g.step(1); if (!(e.dead || e.downT > 0)) pin(); }
          out[`${src}:${kind}`] = { hit: outcome(kind, e), wanted: g.getWanted(), kills: (g.stats.kills || 0) - k0, quest: g.quest.progress };
          P.weapon = 'sword';
          e.pos.set(X + 80 + Object.keys(out).length * 3, 0, Z + 80); // 挪开,别让下一格的刀/箭/爆炸顺带打到它
          if (e.group) e.group.position.copy(e.pos);
          if (kind === 'chicken') { fauna.startChickenRiot(0.001); g.step(1); } // 鸡记的仇清零(连戳三次会招来复仇鸡群,混进下一格)
        }
      }
      g.quest.active = false;
      law.clearWanted();
      return out;
    });
    const bad = [];
    for (const [cell, o] of Object.entries(r)) {
      const [src, kind] = cell.split(':');
      const reach = cell !== 'stomp:deer'; // 鹿是大个子,踩不上去
      if (o.hit !== reach) bad.push(`${cell} ${reach ? '没打到' : '不该踩得到'}`);
      const wantCrime = kind === 'guard' || kind === 'villager';
      if (wantCrime !== (o.wanted > 0)) bad.push(`${cell} 犯罪不对(通缉 ${o.wanted})`);
      const kills = src !== 'stomp' && (kind === 'bandit' || kind === 'wolf') ? 1 : 0;
      if (o.kills !== kills) bad.push(`${cell} 连杀计数应 +${kills},实际 +${o.kills}`);
      const quest = src !== 'stomp' && kind === 'bandit' ? 1 : 0;
      if (o.quest !== quest) bad.push(`${cell} 委托进度应 +${quest},实际 +${o.quest}`);
    }
    if (bad.length) throw new Error(bad.join(';'));
  },
  // 交互与提示同源:提示说什么,按 E 就做什么(且提示本身不产生副作用)
  async interact(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      g.player.pos.set(g.steward.pos.x + 1.2, 0, g.steward.pos.z);
      g.step(2);
      out.stewardPrompt = g.getPrompt();
      const coins0 = g.player.coins;
      for (let i = 0; i < 5; i++) g.getPrompt(); // 反复试运行不能改状态
      out.sideEffect = g.player.coins !== coins0 || g.dialogOpen();
      g.tryInteract();
      out.dialog = g.dialogOpen();
      while (g.dialogOpen()) g.advanceDialog();
      const ch = g.world.chests.find((c) => !c.opened);
      g.player.pos.set(ch.x + 1, 0, ch.z);
      g.step(2);
      out.chestPrompt = g.getPrompt();
      g.tryInteract();
      out.chestOpened = ch.opened;
      return out;
    });
    if (!/埃隆/.test(r.stewardPrompt)) throw new Error(`管家旁的提示不对:${r.stewardPrompt}`);
    if (r.sideEffect) throw new Error('试运行提示产生了副作用');
    if (!r.dialog) throw new Error('按 E 没有和管家对话');
    if (!/宝箱/.test(r.chestPrompt)) throw new Error(`宝箱旁的提示不对:${r.chestPrompt}`);
    if (!r.chestOpened) throw new Error('按 E 没有打开宝箱');
  },
  // E 键找人:2.65 米内最近的那位;有委托可接时管家优先(夜里他和领主站在一起);信使的委托书骑在马上也能直接接
  async ekey(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      const king = g.namedNPCs.find((n) => n.key === 'king');
      g.steward.pos.set(0, 0, -29.5); king.pos.set(0, 0, -30.6);
      g.player.pos.set(0.3, 0, -31.4); // 领主 0.9 米、管家 1.9 米
      g.quest.active = false;
      g.step(1);
      out.offer = g.getPrompt();
      g.quest.active = true;
      g.step(1);
      out.busy = g.getPrompt();
      g.quest.active = false;
      // 信使:办完一单(下一单不计时)后骑在马上直接 E
      g.quest.idx = g.missions.findIndex((m) => m.type === 'losthorse');
      g.quest.active = true;
      g.completeMission();
      while (g.dialogOpen()) g.advanceDialog();
      g.player.pos.set(30, 0, 40);
      g.player.mounted = g.player.horse;
      g.step(1);
      out.remotePrompt = g.getPrompt();
      g.tryInteract();
      while (g.dialogOpen()) g.advanceDialog();
      out.accepted = g.quest.active;
      out.stillMounted = !!g.player.mounted;
      return out;
    });
    if (!/埃隆/.test(r.offer)) throw new Error(`有委托可接时应先找管家,提示却是:${r.offer}`);
    if (!/领主/.test(r.busy)) throw new Error(`委托在办时应找最近的人(领主),提示却是:${r.busy}`);
    if (!/接下一单/.test(r.remotePrompt)) throw new Error(`骑在马上没给出接信使委托的提示:${r.remotePrompt}`);
    if (!r.accepted || !r.stillMounted) throw new Error(`骑在马上按 E 没接下信使的委托:${JSON.stringify(r)}`);
  },
  // 流程:自己的马比 NPC 近时 E=上马;走远对话自动收;城外穿城的光柱绕墙角;没委托时光柱指埃隆
  async playFlow(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      // 1) 上马优先
      const h = g.player.horse;
      const v = g.villagers.find((x) => !x.sleeping && !(x.downT > 0));
      if (h && v) {
        // 挪到一片空地上再摆(村民原地的墙角/人堆会把玩家挤开、或有别人更近,结果就随开局而变)
        v.pos.set(0, 0, 60); v.group.position.copy(v.pos); v.target = null; v.timer = 99; v.fleeT = 0;
        h.target = null; h.timer = 99;
        g.player.pos.set(v.pos.x + 2.4, 0, v.pos.z);
        h.pos.set(v.pos.x + 3.6, 0, v.pos.z); h.group.position.copy(h.pos);
        g.step(1);
        out.prompt = g.getPrompt();
      }
      // 2) 对话走远自动收起
      g.player.pos.set(v.pos.x + 1.5, 0, v.pos.z);
      g.step(1);
      g.tryInteract();
      out.opened = g.dialogOpen();
      g.player.pos.set(v.pos.x + 20, 0, v.pos.z);
      g.step(2);
      out.closed = !g.dialogOpen();
      // 3) 没委托时光柱在埃隆身上
      g.quest.active = false;
      g.player.pos.set(g.steward.pos.x + 30, 0, g.steward.pos.z + 3);
      g.step(2);
      const b0 = g.getBeacon();
      out.stewardBeacon = b0.v && Math.hypot(b0.x - g.steward.pos.x, b0.z - g.steward.pos.z) < 2;
      // 4) 城外西侧去东边磨坊:光柱先指墙角,不是直穿城墙
      const i = g.missions.findIndex((m) => m.type === 'deliver');
      g.quest.idx = i; g.quest.active = true; g.quest.timer = 99;
      g.player.pos.set(-90, 0, 4);
      g.step(2);
      out.beacon = g.getBeacon();
      return out;
    });
    if (r.prompt !== undefined && !/马/.test(r.prompt)) throw new Error(`自己的马更近,提示却是:${r.prompt}`);
    if (!r.opened) throw new Error('贴着村民按 E 没开对话');
    if (!r.closed) throw new Error('走出 20 米对话还挂着');
    if (!r.stewardBeacon) throw new Error('没有委托时光柱没指向埃隆');
    const b = r.beacon;
    if (!(Math.abs(Math.abs(b.x) - 79) < 1 && Math.abs(Math.abs(b.z) - 64) < 1)) throw new Error(`城外穿城的光柱应先指墙角,实际 ${JSON.stringify(b)}`);
  },
  // 生命上限只有一个来源:护甲 + 湖神 + 屠龙
  async maxhp(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      g.player.armor = 2;
      const a = g.recomputeMaxHp();
      g.prayAltar();
      g.advanceDialog && g.advanceDialog();
      const b = g.player.maxHp;
      g.stats.dragonSlain = true;
      const c = g.recomputeMaxHp();
      return { a, b, c };
    });
    if (r.a !== 14 || r.b !== 16 || r.c !== 18) throw new Error(`生命上限计算不对:${JSON.stringify(r)}`);
  },
  // 城墙寻路:城内接到城外的限时快递,光柱先指向城门(门内/门外点)而不是顶着城墙;出了城门直指磨坊
  async route(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const i = g.missions.findIndex((m) => m.type === 'deliver');
      g.quest.idx = i; g.quest.active = true; g.quest.timer = 60;
      g.player.pos.set(-40, 0, 30); // 城里西南,直线去磨坊会顶着东墙
      g.step(2);
      const a = g.getBeacon();
      g.player.pos.set(72, 0, 0); // 走到东门外
      g.step(2);
      const b = g.getBeacon();
      return { a, b, mill: { x: g.world.windmillPos.x, z: g.world.windmillPos.z } };
    });
    const nearGate = (p) => Math.hypot(p.x, p.z - 55) < 8 || Math.hypot(p.x - 70, p.z) < 8;
    if (!r.a.v || !nearGate(r.a)) throw new Error(`城内时光柱应指向城门,实际 ${JSON.stringify(r.a)}`);
    if (Math.hypot(r.b.x - r.mill.x, r.b.z - r.mill.z) > 2) throw new Error(`出城后光柱应指向磨坊,实际 ${JSON.stringify(r.b)}`);
  },
  // 光柱寻路(航点图):顺着光柱一段段走——城外西侧去东边磨坊不穿城墙;去河西的营地必经木桥;
  // 城门口:门外直指城里的目标,门内要出城给门外点(不再指 80 米外的城角、也不再原地翻转)
  async nav(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      // 每帧朝光柱迈 1.5 米(相当于骑马疾驰),记下轨迹;到目标 7.5 米内算到达(快递 7 米内就交差了)
      const walk = (x, z, goal) => {
        const pts = [[x, z]];
        g.player.pos.set(x, 0, z);
        for (let i = 0; i < 700; i++) {
          g.step(1);
          if (Math.hypot(goal.x - g.player.pos.x, goal.z - g.player.pos.z) < 7.5) return { pts, ok: true };
          const b = g.getBeacon();
          const dx = b.x - g.player.pos.x, dz = b.z - g.player.pos.z, d = Math.hypot(dx, dz) || 1;
          const s = Math.min(1.5, d);
          g.player.pos.x += (dx / d) * s; g.player.pos.z += (dz / d) * s;
          pts.push([g.player.pos.x, g.player.pos.z]);
        }
        return { pts, ok: false };
      };
      g.player.hp = g.player.maxHp = 999; // 只看路线,别被半路的伏兵打断
      const di = g.missions.findIndex((m) => m.type === 'deliver');
      g.quest.idx = di; g.quest.active = true; g.quest.timer = 999;
      out.mill = walk(-85, 4, g.world.windmillPos);
      g.quest.active = false;
      const bi = g.missions.findIndex((m) => m.type === 'bandits');
      g.quest.idx = bi; g.quest.active = true; g.quest.progress = 0;
      out.camp = walk(4, 10, g.world.banditCamp);
      // 城门口
      g.quest.active = false; g.quest.idx = 0;
      g.player.pos.set(0, 0, 63); g.step(2);
      out.southFront = g.getBeacon();
      g.quest.idx = bi; g.quest.active = true;
      g.player.pos.set(0, 0, 50); g.step(2);
      out.southInside = g.getBeacon();
      out.steward = { x: g.steward.pos.x, z: g.steward.pos.z };
      return out;
    });
    // 一步穿过城墙线(门洞除外)= 穿墙
    const wallCross = (pts) => {
      for (let i = 1; i < pts.length; i++) {
        const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
        for (const zw of [-55, 55]) {
          if ((z0 - zw) * (z1 - zw) < 0) {
            const x = x0 + ((x1 - x0) * (zw - z0)) / (z1 - z0);
            if (Math.abs(x) < 70 && !(zw === 55 && Math.abs(x) < 3.6)) return `z=${zw} @x=${x.toFixed(1)}`;
          }
        }
        for (const xw of [-70, 70]) {
          if ((x0 - xw) * (x1 - xw) < 0) {
            const z = z0 + ((z1 - z0) * (xw - x0)) / (x1 - x0);
            if (Math.abs(z) < 55 && !(xw === 70 && Math.abs(z) < 3.6)) return `x=${xw} @z=${z.toFixed(1)}`;
          }
        }
      }
      return null;
    };
    if (!r.mill.ok) throw new Error(`顺着光柱没走到磨坊,停在 ${r.mill.pts.at(-1)}`);
    const wm = wallCross(r.mill.pts);
    if (wm) throw new Error(`去磨坊的光柱路线穿墙:${wm}`);
    if (!r.camp.ok) throw new Error(`顺着光柱没走到营地,停在 ${r.camp.pts.at(-1)}`);
    const wc = wallCross(r.camp.pts);
    if (wc) throw new Error(`去营地的光柱路线穿墙:${wc}`);
    // 银月河在 x≈-101..-90 一带;走在河带里时必须是在木桥(z -41..-27)上
    const wet = r.camp.pts.find(([x, z]) => x > -100.5 && x < -90.5 && (z < -41 || z > -27));
    if (wet) throw new Error(`去营地的光柱路线下了河(不是走木桥):${wet}`);
    if (!r.camp.pts.some(([x, z]) => Math.hypot(x + 95, z + 34) < 4)) throw new Error('去河西的光柱路线没经过木桥');
    if (Math.hypot(r.southFront.x - r.steward.x, r.southFront.z - r.steward.z) > 2) throw new Error(`南门外光柱应直指城里的埃隆,实际 ${JSON.stringify(r.southFront)}`);
    if (Math.hypot(r.southInside.x, r.southInside.z - 62) > 2) throw new Error(`南门内要出城时光柱应给门外点,实际 ${JSON.stringify(r.southInside)}`);
  },
  // 护送:伏兵没被缠住时扑商人,但同一时间最多一人下手、先亮红扇形、两刀至少隔 1.6 秒;每波伏击前商人回满、原地蹲下;
  // 你走进 10 米,或者打它一下(哪怕隔得老远),它就转来打你
  async escort(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      g.quest.idx = g.missions.findIndex((m) => m.type === 'escort');
      g.quest.active = false;
      g.talkQuestGiver();
      while (g.dialogOpen()) g.advanceDialog();
      const mc = g.questRT.merchant;
      mc.hp = 2; // 伏击前回满要看得出来
      mc.pos.set(39.5, 0, 0.2); mc.wp = 1; // 第一个伏击点跟前
      g.player.pos.set(40, 0, 45); // 离得远远的:伏兵只会去扑商人
      g.step(2);
      out.ambush = g.questRT.ambush;
      out.healed = mc.hp === mc.maxHp;
      const foes = g.bandits.filter((b) => b.escort && !b.dead);
      out.n = foes.length;
      let maxStrikers = 0, lastHit = null, minGap = Infinity, hits = 0, hp0 = mc.hp, sawTele = false, crouch = 0;
      for (let i = 0; i < 60 * 12 && mc.hp > 1; i++) {
        g.step(1);
        maxStrikers = Math.max(maxStrikers, foes.filter((b) => b.mcStrike && b.windupT > 0).length);
        if (g.dangerFX.some((f) => foes.includes(f.e))) sawTele = true;
        crouch = Math.max(crouch, mc.crouch);
        if (mc.hp < hp0) {
          const t = g.simNow();
          if (lastHit !== null) minGap = Math.min(minGap, t - lastHit);
          lastHit = t; hits++; hp0 = mc.hp;
        }
      }
      Object.assign(out, { maxStrikers, minGap, hits, sawTele, crouch });
      // 走进 10 米:这个伏兵转来打你
      const a = foes[0];
      g.player.pos.set(a.pos.x + 7, 0, a.pos.z);
      g.step(30);
      out.aggroNear = a.aggroT > 0 && !a.mcStrike;
      out.closing = Math.hypot(a.pos.x - g.player.pos.x, a.pos.z - g.player.pos.z) < 6.5;
      // 隔着 40 米打另一个一下:它也转来追你
      const b = foes[1];
      g.player.pos.set(b.pos.x + 40, 0, b.pos.z);
      g.step(200); // 先让第一个伏兵的仇恨散掉
      g.applyDamage(b, 1, { source: 'player' });
      g.step(2);
      out.aggroHit = b.aggroT > 0 && !b.mcStrike;
      return out;
    });
    if (!r.ambush || r.n < 2) throw new Error(`没有触发伏击:${JSON.stringify(r)}`);
    if (!r.healed) throw new Error('伏击前商人没有回满');
    if (r.crouch < 0.9) throw new Error('伏击中商人没有蹲下');
    if (r.hits < 2) throw new Error(`12 秒里伏兵只砍了商人 ${r.hits} 刀,测不出间隔`);
    if (r.maxStrikers > 1) throw new Error(`同时有 ${r.maxStrikers} 个伏兵在砍商人`);
    if (r.minGap < 1580) throw new Error(`砍商人的两刀只隔了 ${r.minGap} 毫秒`);
    if (!r.sawTele) throw new Error('砍商人前没有亮预警扇形');
    if (!r.aggroNear || !r.closing) throw new Error(`走进 10 米伏兵没转来打你:${JSON.stringify(r)}`);
    if (!r.aggroHit) throw new Error('远远打了伏兵一下,它没转来追你');
  },
  // 战团行军走航点图:从正北来的战团绕过城角走到东门,不再贴着北墙横移;玩家远在 300 米外时横幅改报距离
  async warband(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, wb = g.warband;
      g.player.pos.set(0, 0, 200); g.player.hp = g.player.maxHp = 999;
      g.quest.idx = 3;
      g.spawnWarband();
      wb.ax = 0; wb.az = -120; // 摆到正北 120 米,目标东门(北面来离它最近)
      wb.path = [[82, 0], [70, 0], [0, 10]]; wb.wp = 0; wb.hop = null;
      for (const b of wb.members) { b.pos.set(b._ox, 0, -120 + b._oz); b.home.set(b.pos.x, 0, b.pos.z); }
      let minGateD = Infinity, crossed = false, prevZ = wb.az;
      for (let i = 0; i < 300 && wb.active && minGateD > 10; i++) {
        g.step(15, 1 / 30); // 0.5 秒
        for (const b of wb.members) if (!b.dead) minGateD = Math.min(minGateD, Math.hypot(b.pos.x - 70, b.pos.z));
        if (Math.abs(wb.ax) < 69 && prevZ < -56 && wb.az >= -54) crossed = true;
        prevZ = wb.az;
      }
      const out = { minGateD, crossed, active: wb.active, ax: wb.ax, az: wb.az, wp: wb.wp };
      g.player.pos.set(700, 0, 700);
      g.step(2);
      out.banner = document.getElementById('mission').textContent;
      return out;
    });
    if (r.crossed) throw new Error('战团锚点直接穿过了北墙');
    if (r.minGateD > 10) throw new Error(`北面来的战团 150 秒内没走到东门:${JSON.stringify(r)}`);
    if (r.active && !/距你/.test(r.banner)) throw new Error(`人在 300 米外,战团横幅没报距离:${r.banner}`);
  },
  // 委托难度与剧情:④信使会逃(贴近才按倒)、⑤高环要跳、⑥白马见了奔马会跑(慢慢走近才认你)、⑧头狼不死不算完、
  // ②路上有骑马的追兵、磨坊主在磨坊门口;旧档(v3)过了竞速的顺延一位
  async missions(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = {};
      g.player.hp = g.player.maxHp = 999;
      const take = (type) => {
        g.quest.idx = g.missions.findIndex((m) => m.type === type);
        g.quest.active = false;
        g.talkQuestGiver();
        while (g.dialogOpen()) g.advanceDialog();
      };
      // ④ 内鬼的信使
      take('courier');
      const idx4 = g.quest.idx;
      g.player.pos.set(80, 0, -80); g.step(2);
      out.runner = !!g.questRT.runner;
      const r0 = g.questRT.runner && { x: g.questRT.runner.pos.x, z: g.questRT.runner.pos.z };
      g.step(60);
      out.fled = r0 && Math.hypot(g.questRT.runner.pos.x - r0.x, g.questRT.runner.pos.z - r0.z) > 4;
      g.player.pos.set(g.questRT.runner.pos.x + 1, 0, g.questRT.runner.pos.z); g.step(1);
      out.caught = g.quest.idx === idx4 + 1 && /霍布/.test((g.getDialog().page || ''));
      while (g.dialogOpen()) g.advanceDialog();
      // ⑤ 高环
      take('race');
      const hi = g.missions[g.quest.idx].high[0];
      g.questRT.ringIdx = hi;
      const [hx, hz] = g.world.raceRoute[hi];
      g.player.pos.set(hx, 0, hz); g.step(1);
      out.lowPass = g.questRT.ringIdx;
      g.player.pos.set(hx, 1, hz); g.player.vy = 0; g.step(1);
      out.jumpPass = g.questRT.ringIdx;
      g.quest.active = false;
      // ⑥ 白马
      take('losthorse');
      const sh = g.questRT.specialHorse;
      g.player.mounted = g.player.horse;
      g.player.pos.set(sh.pos.x + 10, 0, sh.pos.z); g.player.horse.pos.copy(g.player.pos);
      g.step(3);
      out.spooked = sh.fleeT > 0;
      g.player.mounted = null;
      sh.fleeT = 0;
      g.player.pos.set(sh.pos.x + 3.5, 0, sh.pos.z);
      g.questRT.lastPX = g.player.pos.x; g.questRT.lastPZ = g.player.pos.z; g.questRT.pSpeed = 0;
      g.step(2);
      out.calm = !!sh.calm;
      g.quest.active = false;
      // ⑧ 头狼
      take('wolves');
      const alpha = g.questRT.alpha;
      const idx8 = g.quest.idx;
      for (const w of g.wolves.filter((x) => !x.dead && x !== alpha).slice(0, 4)) g.killWolf(w);
      out.wolvesDoneEarly = g.quest.idx !== idx8;
      out.progressCap = g.quest.progress;
      g.killWolf(alpha);
      out.alphaDone = g.quest.idx === idx8 + 1;
      // ② 骑马的追兵 + 磨坊主
      take('deliver');
      g.quest.timer = 99;
      g.player.pos.set(92, 0, 2); g.step(2);
      out.riders = g.questRT.riders.length;
      out.riderSpeed = g.questRT.riders[0] && g.questRT.riders[0].b.speed;
      g.player.pos.set(g.world.windmillPos.x - 5, 0, g.world.windmillPos.z); g.step(2);
      out.ridersCleared = g.questRT.riders.length === 0;
      const miller = g.villagers.find((v) => v.id.name === '磨坊主卢卡斯');
      out.millerAtMill = miller && Math.hypot(miller.pos.x - 136.5, miller.pos.z - 25) < 10 && !miller.sleeping; // group.visible 含远近分级,不能当逻辑状态读
      out.millerLine = g.getDialog().page || '';
      while (g.dialogOpen()) g.advanceDialog();
      g.saveNow();
      return out;
    });
    if (!r.runner || !r.fled) throw new Error(`走近哨塔遗迹,信使没现身或没逃:${JSON.stringify(r)}`);
    if (!r.caught) throw new Error('贴近信使没按倒他(或没招出霍布)');
    if (r.lowPass !== r.jumpPass - 1) throw new Error(`高环:不跳 ${r.lowPass},跳 ${r.jumpPass}(应只有跳过去才算)`);
    if (!r.spooked) throw new Error('骑马冲到白马跟前,它没受惊');
    if (!r.calm) throw new Error('下马慢慢走近,白马没认你');
    if (r.wolvesDoneEarly || r.progressCap !== 3) throw new Error(`头狼还活着,狼灾就算完了:${JSON.stringify(r)}`);
    if (!r.alphaDone) throw new Error('杀了头狼,狼灾没完成');
    if (r.riders !== 2 || !(r.riderSpeed > 11)) throw new Error(`快递路上没有骑马的追兵:${JSON.stringify(r)}`);
    if (!r.ridersCleared) throw new Error('快递完成后追兵(和马)没撤');
    if (!r.millerAtMill || !/卢卡斯/.test(r.millerLine)) throw new Error(`磨坊主没在磨坊门口收包裹:${JSON.stringify(r)}`);
    // 旧档迁移:v3 存的 idx 4(旧序做完了竞速、下一单白马),新序里白马是 idx 5
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('gth-save-v1'));
      s.v = 3; s.questIdx = 4;
      localStorage.setItem('gth-save-v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    const m = await page.evaluate(() => ({ idx: window.__gtm.quest.idx, type: window.__gtm.missions[window.__gtm.quest.idx].type,
      blocked: window.__gtm.getSaveBlocked() }));
    if (m.blocked || m.type !== 'losthorse') throw new Error(`v3 旧档(下一单白马)迁移后应仍是白马,实际 ${JSON.stringify(m)}`);
  },
  // 文案:闲聊拼句没有"。。"、没有"……汉娜……,说的就是面包师汉娜";通关并领完赏后任务栏写自由探索;
  // 败给流浪剑客时死因写剑客;H 面板的弹反说法与教学卡一致(红扇形快长满时举盾 → 处决)
  async texts(page) {
    await boot(page);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    if (!/红扇形快长满时举盾/.test(html) || /还击 ×2\.5/.test(html)) throw new Error('H 面板的弹反文案还是旧的');
    const r = await page.evaluate(() => {
      const g = window.__gtm, out = { bad: [] };
      const keys = Object.keys(g.villagers.reduce((m, v) => (m[v.dbKey] = 1, m), {}));
      for (let i = 0; i < 1500; i++) {
        const t = g.dbLine(keys[i % keys.length]);
        if (!t) continue;
        const m = t.match(/说的就是(.+?)。/);
        if (/。。|!。|\?。|。,/.test(t) || (m && t.indexOf(m[1].slice(-2)) < t.indexOf('说的就是'))) out.bad.push(t);
      }
      g.quest.idx = g.missions.length; g.stats.starTaken = true;
      g.namedNPCs.find((n) => n.key === 'king').rewarded = true;
      g.step(2);
      out.hud = document.getElementById('mission').textContent;
      const b = g.bandits.find((x) => !x.dead);
      b.duel = true; b.pos.set(g.player.pos.x + 1, 0, g.player.pos.z);
      g.damagePlayer(999, b);
      out.death = document.querySelector('#gameover h1').textContent;
      return out;
    });
    if (r.bad.length) throw new Error(`闲聊拼句有坏句:${r.bad.slice(0, 3).join(' | ')}`);
    if (!/太平/.test(r.hud)) throw new Error(`通关领赏后任务栏还在催人:${r.hud}`);
    if (!/流浪剑客/.test(r.death)) throw new Error(`败给流浪剑客,死因却写:${r.death}`);
  },
  // 提示分级:同 key 的进度只留最新一条;同一句不排两遍;委托完成/失败/重接时排队的委托提示作废;插队的排最前
  async toasts(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm, q = g.toastQueue, out = {};
      q.length = 0;
      g.toastQuest('金环 1/6', 1.2, 'ring'); g.toastQuest('金环 2/6', 1.2, 'ring');
      g.toast('一句闲话'); g.toast('一句闲话');
      out.rings = q.filter((e) => e.key === 'ring').map((e) => e.msg);
      out.dups = q.filter((e) => e.msg === '一句闲话').length;
      g.toastNow('委托失败!');
      out.front = q[0].msg;
      g.dropQuestToasts();
      out.after = q.map((e) => e.msg);
      return out;
    });
    if (r.rings.join() !== '金环 2/6') throw new Error(`同 key 的进度提示应只留最新一条:${r.rings}`);
    if (r.dups !== 1) throw new Error(`同一句话排了 ${r.dups} 遍`);
    if (r.front !== '委托失败!') throw new Error(`插队提示没排到最前:${r.front}`);
    if (r.after.some((m) => m.startsWith('金环'))) throw new Error(`作废后还留着委托进度:${r.after}`);
  },
  // 存档往返 + 坏档保护
  async save(page) {
    await boot(page);
    await page.evaluate(() => { const g = window.__gtm; g.player.coins = 123; g.player.armor = 1; g.saveNow(); });
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    const r = await page.evaluate(() => ({ coins: window.__gtm.player.coins, maxHp: window.__gtm.player.maxHp,
      blocked: window.__gtm.getSaveBlocked(), v: JSON.parse(localStorage.getItem('gth-save-v1')).v }));
    if (r.coins !== 123) throw new Error(`读档金币不对:${r.coins}`);
    if (r.maxHp !== 12) throw new Error(`皮甲读档后生命上限应为 12,实际 ${r.maxHp}`);
    if (r.blocked) throw new Error('正常存档不该被锁');
    if (!(r.v >= 3)) throw new Error('存档缺版本号');
    // 坏档:不读、不覆盖、留备份
    await page.evaluate(() => localStorage.setItem('gth-save-v1', '{坏掉的存档'));
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    const k = await page.evaluate(() => {
      window.__gtm.saveNow();
      return { blocked: window.__gtm.getSaveBlocked(), raw: localStorage.getItem('gth-save-v1'), bak: localStorage.getItem('gth-save-v1-bak') };
    });
    if (!k.blocked) throw new Error('坏档没有锁定自动存档');
    if (k.raw !== '{坏掉的存档') throw new Error('坏档被覆盖了');
    if (k.bak !== '{坏掉的存档') throw new Error('坏档没有备份');
  },
  // 主循环系统表:tick 只做 dt 缩放 + 按序遍历;顺序就是语义(先计时器、再玩家、再 AI,HUD 最后读状态)。
  // 改了顺序请同步改这里与 docs/ARCHITECTURE.md
  async systems(page) {
    await boot(page);
    const names = await page.evaluate(() => window.__gtm.systems());
    const want = ['toast', 'dialogRange', 'hitFlash', 'timers', 'interactMarker',
      'player', 'regen', 'attackInput', 'knockback', 'buffs', 'rideMileage', 'deepWater',
      'frostfang', 'springs', 'timeTrial', 'cryptLights', 'altarGlow',
      'guards', 'bandits', 'wolves', 'chickens', 'villagers', 'horses', 'deer',
      'pickups', 'quest', 'wanted', 'fishing', 'projectiles', 'damageNumbers', 'combo', 'falls',
      'arena', 'director', 'streetEvent', 'bounty', 'armWrestle', 'home', 'firefly', 'vista',
      'magic', 'frostPatches', 'trails', 'telegraphs', 'lockOn', 'prologue', 'lawless', 'warband',
      'dragon', 'combatMusic', 'squash', 'mercs', 'vendetta',
      'weather', 'ambience', 'region', 'bubble', 'chatter', 'npcs', 'rain', 'ambientFX', 'dust',
      'dayNight', 'lightPool', 'calendar', 'workspace', 'idle',
      'wilderness', 'vegetation', 'underlay', 'camera', 'scenery', 'beacon', 'water', 'envLight',
      'lowHp', 'coins', 'entityLOD', 'prompt', 'hud', 'actionBar', 'minimap', 'filmGrain', 'frameCount'];
    if (names.join(',') !== want.join(',')) {
      const i = names.findIndex((n, k) => n !== want[k]);
      throw new Error(`系统表顺序变了(第 ${i} 项:${names[i]} ≠ ${want[i]})`);
    }
    // E 键交互规则表:顺序就是优先级
    const rules = await page.evaluate(() => window.__gtm.interactionRules());
    const wantRules = ['duel', 'remoteQuest', 'reelIn', 'throwCarried', 'dismount', 'mountFirst', 'namedNPCs',
      'mysticTrader', 'wiseCow', 'wishThief', 'eventChicken', 'arenaHost', 'funnyNPCs', 'mailbox', 'dragonSkull', 'home',
      'bountyBoard', 'noticeBoard', 'choreBoard', 'loreStones', 'cryptHatch', 'crypt', 'ferryPier', 'ferryIsle', 'moonAltar',
      'fishPier', 'fishIsle', 'timeTrial', 'tameFrostfang', 'campfire', 'chapel', 'mirror', 'mushrooms', 'pickChicken',
      'villagers', 'fountain', 'chests'];
    if (rules.join(',') !== wantRules.join(',')) throw new Error(`交互规则表顺序变了:${rules.join(',')}`);
    // 隔帧系统按帧计数错开:一步 = 一帧
    const r = await page.evaluate(() => { const g = window.__gtm; const n0 = g.frameNo(); g.step(5); return g.frameNo() - n0; });
    if (r !== 5) throw new Error(`帧计数不对:5 步走了 ${r}`);
  },
  // 单文件打包版(esbuild):模块求值顺序与浏览器原生加载不同,加载期读到循环依赖里没初始化的绑定会直接报错;
  // 能开局、能推进、存档往返不被锁(读档分段失败会锁存档)
  async bundle(page, errors) {
    const { bundleHtml } = await import('../tools/bundle.mjs');
    memRoutes.set('/__bundle.html', await bundleHtml());
    const url = `http://127.0.0.1:${srv.address().port}/__bundle.html?noai=1&lowfx=1`;
    await page.goto(url);
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    await page.click('#title', { timeout: 180000 }); // 机器很忙时标题动画迟迟不"稳定",别 30 秒就判失败
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const g = window.__gtm; g.skipPrologue(true); g.step(120); g.player.coins = 77; g.saveNow(); });
    await page.reload();
    await page.waitForFunction(() => window.__gtm, null, { timeout: 240000 });
    const r = await page.evaluate(() => ({ coins: window.__gtm.player.coins, blocked: window.__gtm.getSaveBlocked() }));
    if (r.blocked) throw new Error('打包版读档有段失败(存档被锁)');
    if (r.coins !== 77) throw new Error(`打包版存档往返不对:${r.coins}`);
    if (errors.length) throw new Error('打包版页面报错:' + errors.join(' | '));
  },
};

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(TESTS);
let failed = 0;
for (const name of names) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  try {
    await TESTS[name](page, errors);
    if (errors.length) throw new Error('页面报错:' + errors.slice(0, 3).join(' | '));
    console.log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  } catch (e) {
    failed++;
    console.log(`✘ ${name}: ${e.message}`);
  }
  await page.close();
}
await browser.close();
srv.close();
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
