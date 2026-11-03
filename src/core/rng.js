// 可设种子的随机数(mulberry32):玩法里的随机都走这里,测试可 seed() 复现同一局
let state = (Date.now() ^ 0x9e3779b9) >>> 0;
export function seed(n) { state = n >>> 0; }
export function rand() {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
