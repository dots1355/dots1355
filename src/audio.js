// 8-bit 芯片音效与背景音乐(WebAudio 合成,无外部资源)
let ctx = null;
let musicTimer = null;
let musicOn = false;

export function initAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, type = 'square', vol = 0.12, when = 0, slide = 0) {
  if (!ctx || freq <= 0) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// 共享噪声缓冲(雨声/雷声)
let noiseBuf = null;
function getNoise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

let rainNodes = null;
export const weatherAudio = {
  // intensity 0..1;0 时自动停止
  setRain(intensity) {
    if (!ctx) return;
    if (intensity > 0.03 && !rainNodes) {
      const src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 950;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g).connect(ctx.destination);
      src.start();
      rainNodes = { src, g };
    }
    if (rainNodes) {
      rainNodes.g.gain.setTargetAtTime(0.05 * intensity, ctx.currentTime, 0.6);
      if (intensity <= 0.03) {
        const n = rainNodes;
        rainNodes = null;
        try { n.src.stop(ctx.currentTime + 1.5); } catch { /* 已停止 */ }
      }
    }
  },
  thunder() {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(240, ctx.currentTime);
    filt.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.4);
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 2.5);
  },
};

// ---- 环境氛围音:鸟鸣(春夏白天)/ 蟋蟀(夏秋夜)/ 寒风(冬) ----
let ambKind = null, ambTimer = null, windNodes = null;
function stopWind() {
  if (!windNodes) return;
  const n = windNodes;
  windNodes = null;
  n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
  try { n.src.stop(ctx.currentTime + 2.5); } catch { /* 已停止 */ }
}
export function setAmbience(kind) {
  if (!ctx || kind === ambKind) return;
  ambKind = kind;
  if (ambTimer) { clearInterval(ambTimer); ambTimer = null; }
  if (kind !== 'wind') stopWind();
  if (kind === 'birds') {
    // 稀疏鸟鸣:随机双音上滑
    ambTimer = setInterval(() => {
      if (Math.random() < 0.55) return;
      const f = 1800 + Math.random() * 1400;
      tone(f, 0.09, 'sine', 0.035, 0, f * 0.3);
      tone(f * 1.2, 0.07, 'sine', 0.028, 0.12, -f * 0.2);
      if (Math.random() < 0.3) tone(f * 0.9, 0.08, 'sine', 0.025, 0.26, f * 0.25);
    }, 2200);
  } else if (kind === 'crickets') {
    // 蟋蟀:高频短脉冲三连
    ambTimer = setInterval(() => {
      if (Math.random() < 0.35) return;
      for (let i = 0; i < 3; i++) tone(4200 + Math.random() * 300, 0.04, 'triangle', 0.02, i * 0.09);
    }, 1400);
  } else if (kind === 'wind') {
    if (!windNodes) {
      const src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 320;
      filt.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.13;
      lfoG.gain.value = 0.012;
      lfo.connect(lfoG).connect(g.gain);
      lfo.start();
      src.connect(filt).connect(g).connect(ctx.destination);
      src.start();
      g.gain.setTargetAtTime(0.028, ctx.currentTime, 1.2);
      windNodes = { src, g, lfo };
    }
  }
}

export const sfx = {
  hoof()    { tone(300 + Math.random() * 80, 0.045, 'triangle', 0.06, 0, -140); },
  cluck()   { const f = 900 + Math.random() * 500; tone(f, 0.05, 'square', 0.07, 0, 300); tone(f * 0.8, 0.06, 'square', 0.06, 0.06, -200); },
  baa()     { tone(360, 0.28, 'sawtooth', 0.09, 0, -140); tone(300, 0.18, 'sawtooth', 0.06, 0.12, -80); },
  dice()    { tone(2000, 0.02, 'square', 0.08); tone(1600, 0.02, 'square', 0.08, 0.06); tone(1800, 0.03, 'square', 0.08, 0.13); },
  splash()  { tone(500, 0.12, 'sine', 0.1, 0, -350); tone(900, 0.08, 'sine', 0.05, 0.05, -500); },
  lute()    { [392, 494, 587].forEach((f, i) => tone(f, 0.2, 'triangle', 0.09, i * 0.09)); },
  hiccup()  { tone(300, 0.07, 'square', 0.09, 0, 500); },
  arrow()   { tone(1400, 0.12, 'sawtooth', 0.06, 0, -900); },
  whoosh(p = 1) { tone(320 * p, 0.09, 'sawtooth', 0.05, 0, -160 * p); tone(1100 * p, 0.06, 'triangle', 0.035, 0.02, -600 * p); },
  warn()    { tone(660, 0.07, 'square', 0.07, 0, 300); tone(1180, 0.09, 'square', 0.05, 0.07); },
  hitMetal() { tone(1500, 0.05, 'square', 0.11, 0, -420); tone(620, 0.1, 'triangle', 0.08, 0.02, -180); },
  hitFlesh() { tone(150, 0.09, 'sine', 0.17, 0, -55); tone(85, 0.12, 'sine', 0.12, 0.03); },
  clank()   { tone(1800, 0.04, 'square', 0.12, 0, -300); tone(900, 0.09, 'triangle', 0.1, 0.03, -200); },
  roll()    { tone(220, 0.12, 'triangle', 0.08, 0, 150); },
  equip()   { tone(700, 0.06, 'triangle', 0.1); tone(1000, 0.08, 'triangle', 0.1, 0.06); },
  heartbeat() { tone(70, 0.1, 'sine', 0.25); tone(55, 0.14, 'sine', 0.2, 0.14); },
  combo(n)  { tone(520 + n * 90, 0.09, 'square', 0.12); tone(660 + n * 90, 0.14, 'square', 0.12, 0.08); },
  kill()    { tone(200, 0.08, 'sawtooth', 0.14, 0, -80); tone(420, 0.1, 'square', 0.1, 0.05, 200); },
  coin()    { tone(988, 0.08, 'square', 0.1); tone(1319, 0.22, 'square', 0.1, 0.08); },
  jump()    { tone(300, 0.16, 'square', 0.09, 0, 420); },
  stomp()   { tone(220, 0.14, 'square', 0.14, 0, -160); tone(440, 0.1, 'square', 0.1, 0.1, 300); },
  hurt()    { tone(190, 0.25, 'sawtooth', 0.16, 0, -130); },
  sword()   { tone(760, 0.07, 'sawtooth', 0.07, 0, -500); },
  hit()     { tone(140, 0.1, 'square', 0.14, 0, -60); },
  mount()   { tone(392, 0.1, 'triangle', 0.14); tone(523, 0.16, 'triangle', 0.14, 0.1); },
  chest()   { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, 'square', 0.11, i * 0.1)); },
  fanfare() { [523, 523, 523, 659, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.5 : 0.14, 'square', 0.12, i * 0.135)); },
  wanted()  { tone(880, 0.18, 'sawtooth', 0.11); tone(622, 0.3, 'sawtooth', 0.11, 0.18); },
  clear()   { tone(659, 0.12, 'triangle', 0.12); tone(880, 0.25, 'triangle', 0.12, 0.12); },
  gameover(){ [392, 370, 349, 311].forEach((f, i) => tone(f, 0.32, 'triangle', 0.15, i * 0.28)); },
  heart()   { tone(659, 0.1, 'sine', 0.15); tone(880, 0.22, 'sine', 0.15, 0.1); },
  block()   { tone(523, 0.06, 'square', 0.12); tone(784, 0.1, 'square', 0.12, 0.06); },
  accept()  { tone(440, 0.1, 'triangle', 0.13); tone(659, 0.18, 'triangle', 0.13, 0.1); },
};

// 中世纪风格 8-bit 小调旋律(A 小调,吟游诗人风)
const MELODY = [
  440, 0, 523, 0, 659, 587, 523, 0, 494, 0, 523, 0, 440, 0, 0, 0,
  440, 0, 523, 0, 659, 587, 659, 0, 784, 0, 659, 0, 587, 0, 0, 0,
  523, 0, 587, 0, 659, 0, 523, 0, 494, 0, 392, 0, 440, 0, 0, 0,
  659, 587, 523, 0, 494, 523, 440, 0, 440, 0, 0, 0, 0, 0, 0, 0,
];
const BASS = [110, 110, 131, 131, 98, 98, 110, 110, 87, 87, 98, 98, 110, 110, 110, 110];

let step = 0;
function musicTick() {
  const m = MELODY[step % MELODY.length];
  if (m) tone(m, 0.16, 'triangle', 0.05);
  if (step % 4 === 0) {
    const b = BASS[Math.floor(step / 4) % BASS.length];
    tone(b, 0.4, 'sine', 0.07);
  }
  step++;
}

export function startMusic() {
  if (musicTimer) return;
  musicOn = true;
  musicTimer = setInterval(musicTick, 145);
}

export function toggleMusic() {
  if (musicOn) {
    clearInterval(musicTimer);
    musicTimer = null;
    musicOn = false;
  } else {
    startMusic();
  }
  return musicOn;
}
