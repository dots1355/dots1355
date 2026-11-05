// 置业:苇岸边的湖畔小屋(200 金币)。门牌、信箱(有信时小红旗立起,calendar.letter)、战利品墙(成就长在外墙上)、
// 自家床安眠(换日 + 移动 +8%)、萤火相随(替这颗心实现三个心愿后的谢礼)。
// 对外:HOME(位置/价格)、homeRT(场景对象)、homeInteract()、paintHomeSign()/refreshTrophies()(读档与解锁成就时刷新);
// initHome() 启动装配调用一次;主循环调 updateHome()/updateFirefly()。
import * as THREE from 'three';
import { sfx } from '../audio.js';
import { frame } from '../core/frame.js';
import { saveGame } from '../core/save.js';
import { colliders, player } from '../core/state.js';
import { lambert } from '../entities.js';
import { scene } from '../gfx/core.js';
import { openDialog } from '../ui/dialog.js';
import { achUnlocked, stats, unlockAch } from './achievements.js';
import { queueDream } from './activities.js';
import { calendar, dayPhase, sleepToMorning } from './calendar.js';
import { wanted } from './law.js';
import { remember } from './mind.js';
import { crestG } from './pickups.js';

// ================= 置业:湖畔小屋(玩家自己的家) =================
export const HOME = { x: -82, z: 66, doorX: -82, doorZ: 68.6, price: 200 };
export const homeRT = { sign: null, signCtx: null };
export function paintHomeSign() {
  const c = homeRT.signCtx;
  c.fillStyle = '#d8c9a0';
  c.fillRect(0, 0, 128, 64);
  c.fillStyle = '#5a3a1a';
  c.textAlign = 'center';
  if (player.home) {
    c.font = 'bold 22px serif';
    c.fillText('林恩的小屋', 64, 40);
  } else {
    c.font = 'bold 20px serif';
    c.fillText('出售', 64, 28);
    c.font = '16px serif';
    c.fillText(`${HOME.price} 金币`, 64, 52);
  }
  homeRT.sign.material.map.needsUpdate = true;
}
// 战利品墙:成就长在自家外墙上——战徽挂门楣,大鱼上木牌,双剑交叉,狼牙成串
export function refreshTrophies() {
  if (!player.home) return;
  if (homeRT.trophies) scene.remove(homeRT.trophies);
  const t = new THREE.Group();
  const has = (k) => achUnlocked.includes(k);
  if (player.relic || has('unsealer')) {
    const m = new THREE.Mesh(crestG, new THREE.MeshStandardMaterial({
      color: 0xd4af37, emissive: 0x8a5c00, emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.3 }));
    m.position.set(0, 2.25, 2.06);
    t.add(m);
  }
  if (player.blackstoneToken) { // 黑石断刀徽记:报复之战的凭证
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.05), lambert(0x2a2a30, { roughness: 0.9 }));
    plaque.position.set(0.7, 2.3, 2.05);
    t.add(plaque);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.85, roughness: 0.3 }));
    blade.rotation.z = 0.5;
    blade.position.set(0.7, 2.3, 2.09);
    t.add(blade);
  }
  if (has('bigfish')) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.05), lambert(0x5a3a20, { roughness: 0.95 }));
    plank.position.set(-1.6, 1.75, 2.05);
    t.add(plank);
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x9ab8d0, metalness: 0.6, roughness: 0.35 }));
    fish.rotation.z = Math.PI / 2;
    fish.position.set(-1.6, 1.75, 2.1);
    t.add(fish);
  }
  if (has('gladiator')) {
    for (const s of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.0, 0.05),
        new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.3 }));
      sw.rotation.z = 0.65 * s;
      sw.position.set(1.6, 1.95, 2.05);
      t.add(sw);
    }
  }
  if (has('packmate')) {
    for (let i = 0; i < 5; i++) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 5),
        lambert(0xe8e4da, { roughness: 0.6 }));
      fang.rotation.x = Math.PI;
      fang.position.set(-0.5 + i * 0.25, 2.5, 2.05);
      t.add(fang);
    }
  }
  // 战团军旗:每面挂一杆,最多陈列六面——满墙都是别人的败绩
  if (stats.banners) {
    for (let i = 0; i < Math.min(6, stats.banners); i++) {
      const x = -2.3 + i * 0.92;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6),
        lambert(0x4a3826, { roughness: 0.9 }));
      pole.position.set(x, 2.62, 2.05);
      t.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34),
        lambert(0x6a1520, { roughness: 0.95 }));
      flag.position.set(x + 0.27, 2.88, 2.06);
      t.add(flag);
    }
  }
  t.position.set(HOME.x, 0, HOME.z);
  scene.add(t);
  homeRT.trophies = t;
}
export function updateHome() {
  if (!homeRT.mailbox) return;
  homeRT.mailbox.visible = !!player.home;
  homeRT.mailFlag.visible = !!calendar.letter;
}

// 萤火相随:替这颗心实现三个心愿后的谢礼——一点它自己的光,入夜后绕着你飞
export const fireflyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
  new THREE.MeshBasicMaterial({ color: 0xd8ffa0, transparent: true, opacity: 0.95 }));
export function updateFirefly() {
  const ph = dayPhase();
  const show = !!player.firefly && !player.dead && (ph === 'night' || ph === 'dusk');
  fireflyMesh.visible = show;
  if (!show) return;
  const t = frame.now * 0.001;
  fireflyMesh.position.set(
    player.pos.x + Math.cos(t * 1.3) * (0.9 + Math.sin(t * 0.7) * 0.25),
    1.55 + Math.sin(t * 2.1) * 0.28,
    player.pos.z + Math.sin(t * 1.3) * (0.9 + Math.cos(t * 0.9) * 0.25));
  fireflyMesh.material.opacity = 0.65 + Math.sin(t * 5.2) * 0.3; // 一明一灭地呼吸
}
export function homeInteract() {
  if (!player.home) {
    if (player.coins >= HOME.price) {
      player.coins -= HOME.price;
      player.home = true;
      paintHomeSign();
      refreshTrophies();
      sfx.fanfare();
      remember('买下了苇岸边的湖畔小屋,在艾尔德里亚安了家', 'home-buy');
      unlockAch('homeowner');
      openDialog([
        `(你数出 ${HOME.price} 枚金币,村长把一把黄铜钥匙放进你手心)`,
        '门轴吱呀一响——一张床、一扇窗、一整面湖,从今天起都是你的了。',
        '门口的木牌翻了个面:「林恩的小屋」。晚上回来睡一觉,第二天走路都带风。',
      ]);
    } else {
      openDialog([`(出售)湖畔小屋:一张床、一扇窗、一整面湖。售价 ${HOME.price} 金币,你还差 ${HOME.price - player.coins} 枚。`]);
    }
    return;
  }
  if (wanted > 0) {
    openDialog(['(你从门缝往外看)卫兵正在苇丛边晃悠。通缉犯睡不了安稳觉——先去摆平通缉再回家。']);
    return;
  }
  if (player.homeDay === calendar.day) {
    openDialog(['(床还带着体温)今天已经睡过了……再睡下去就要长进床里了。']);
    return;
  }
  sleepToMorning();
  queueDream();
  player.homeDay = calendar.day;
  sfx.heart();
  saveGame();
  openDialog(['(自己的床就是不一样)一觉睡到大天亮,窗外湖光正好。今天浑身是劲。(安眠:移动 +8%)']);
}

// 湖畔小屋、门牌、信箱与萤火立进场景(启动装配原位调用)
export function initHome() {
  {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 4), lambert(0xd8cbaa, { roughness: 0.92 }));
    wall.position.y = 1.3;
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.9, 4), lambert(0x8a4a2e, { roughness: 0.85 }));
    roof.position.y = 3.55;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.7), lambert(0x5a3a20, { roughness: 0.95 }));
    door.position.set(0, 0.85, 2.02);
    g.add(door);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x2a3a50, emissive: 0xffd27a, emissiveIntensity: 0.3, roughness: 0.4 }));
    win.position.set(1.6, 1.5, 2.02);
    g.add(win);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
    post.position.set(-1.9, 0.65, 2.6);
    g.add(post);
    const sc = document.createElement('canvas');
    sc.width = 128;
    sc.height = 64;
    homeRT.signCtx = sc.getContext('2d');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.DoubleSide, roughness: 0.95 }));
    sign.position.set(-1.9, 1.35, 2.6);
    g.add(sign);
    homeRT.sign = sign;
    g.position.set(HOME.x, 0, HOME.z);
    scene.add(g);
    colliders.boxes.push({ minX: HOME.x - 2.7, maxX: HOME.x + 2.7, minZ: HOME.z - 2.2, maxZ: HOME.z + 2.2 });
    // 信箱:买房后出现;有信时小红旗立起,信直接寄到家
    const mb = new THREE.Group();
    const mpost = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.1, 5), lambert(0x6b4a2f, { roughness: 0.9 }));
    mpost.position.y = 0.55;
    mb.add(mpost);
    const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.35), lambert(0x8a4a2e, { roughness: 0.8 }));
    mbox.position.y = 1.2;
    mbox.castShadow = true;
    mb.add(mbox);
    const mflag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xe83a4e, emissive: 0x7a0f1c, emissiveIntensity: 0.45 }));
    mflag.position.set(0.3, 1.45, 0);
    mb.add(mflag);
    mb.position.set(HOME.x + 3.4, 0, HOME.z + 3.2);
    mb.visible = false;
    scene.add(mb);
    homeRT.mailbox = mb;
    homeRT.mailFlag = mflag;
  }
  paintHomeSign();
  fireflyMesh.visible = false;
  scene.add(fireflyMesh);
}
