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
    await page.click('#title');
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const g = window.__gtm; g.skipPrologue(true); g.setWeather('clear'); g.toastQueue.length = 0; });
  }
}

// 战斗用例的空场地:清走野外的狼和盗贼,玩家站在 (0,180) 面朝 +Z、镜头在身后;A.foes(n) 复用开局的盗贼当靶子
// (50 血、不出手,摆在玩家周围),A.reset() 把玩家和靶子都复位;学来的格挡/闪箭关掉,结果才可复现
async function installArena(page) {
  await page.evaluate(() => {
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
        g.step(1);
      },
    });
    A.reset();
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
  // 招式规则:跳劈要跳够高(早按进缓冲)、落地 0.6 秒硬直(跳不起滚不了)、正面 2 伤背后 1 伤最多两人、起跳 8 + 跳劈 22 体力;
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
      return out;
    });
    if (r.plungeEarly) throw new Error('起跳下一帧就出了跳劈(应等跳够高)');
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
    for (const [k, f] of Object.entries(r.facing)) {
      if (!f.hit || f.off === null || f.off > 15) throw new Error(`不锁定 ${k}+F 没砍中正前方目标:${JSON.stringify(f)}`);
    }
    if (r.rollCancels) throw new Error('判定帧前按翻滚直接取消了出招(应进缓冲)');
    if (!r.bufferedHit || !r.rolled) throw new Error(`缓冲翻滚不对:刀${r.bufferedHit ? '' : '没'}落下,${r.rolled ? '' : '没'}滚出去`);
    if (Math.abs(r.iframes - 0.25) > 0.02) throw new Error(`翻滚无敌帧应为 0.25 秒,实际 ${r.iframes}`);
    if (r.rollSta !== 20) throw new Error(`翻滚体力应为 20,实际 ${r.rollSta}`);
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
      // 6) 踉跄会晃
      A.reset(); const [w0] = A.foes(1); A.place(w0, 0, 2, Math.PI); w0.stunT = 1.5; w0.stunSrc = 'parry';
      let wob = 0; for (let i = 0; i < 20; i++) { g.step(1); wob = Math.max(wob, Math.abs(w0.group.rotation.z)); }
      out.wobble = wob;
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
    if (!(r.wobble > 0.05)) throw new Error('踉跄时身子不晃');
    if (!r.wolf.lat11 || r.wolf.lat13) throw new Error(`狼扑判定走廊应为两侧 1.2m:${JSON.stringify(r.wolf)}`);
    if (!r.wolfRect || Math.abs(r.wolfRect.len - 5.4) > 1e-6 || Math.abs(r.wolfRect.width - 2.4) > 1e-6) throw new Error(`狼扑预警应为 5.4×2.4 的长条:${JSON.stringify(r.wolfRect)}`);
    if (r.braceDmg !== 2) throw new Error(`疾驰冲进举刀扎马的盗贼应挨 2 下,实际 ${r.braceDmg}`);
  },
  // 序章教学:锁定 → 翻滚 → 格挡 → 出刀 → 魔光弹 → 清场;做到才进下一步,结束回满血并送马
  async prologue(page) {
    await boot(page, { start: false });
    await page.click('#title');
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
  // 城墙寻路:城内接到城外的限时快递,光柱先指向城门而不是顶着城墙
  async route(page) {
    await boot(page);
    const r = await page.evaluate(() => {
      const g = window.__gtm;
      const i = g.missions.findIndex((m) => m.type === 'deliver');
      g.quest.idx = i; g.quest.active = true; g.quest.timer = 60;
      g.player.pos.set(-30, 0, -30);
      g.step(2);
      const a = g.getBeacon();
      g.player.pos.set(72, 0, 0); // 走到东门外
      g.step(2);
      const b = g.getBeacon();
      return { a, b };
    });
    const atGate = (p) => Math.abs(p.x) <= 71 && Math.abs(p.z) <= 56 && (Math.abs(Math.abs(p.x) - 70) < 1 || Math.abs(Math.abs(p.z) - 55) < 1);
    if (!r.a.v || !atGate(r.a)) throw new Error(`城内时光柱应指向城门,实际 ${JSON.stringify(r.a)}`);
    if (atGate(r.b)) throw new Error(`出城后光柱应指向磨坊,实际 ${JSON.stringify(r.b)}`);
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
    await page.click('#title');
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
