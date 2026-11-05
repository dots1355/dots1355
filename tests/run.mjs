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
