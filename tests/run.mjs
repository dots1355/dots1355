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

function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
    if (r.v !== 2) throw new Error('存档缺版本号');
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
