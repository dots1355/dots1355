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

export const sfx = {
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
