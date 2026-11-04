// 时间特效:打击停顿(hit-stop)与处决慢镜。任何系统都可以请求,tick 开头统一按它缩放 dt。
export const timeFX = { hitStop: 0, slowMo: 0 };
export function hitStop(t) { timeFX.hitStop = Math.max(timeFX.hitStop, t); }
export function slowMo(t) { timeFX.slowMo = Math.max(timeFX.slowMo, t); }
// 时停中模拟只走 12%,慢镜中走 40%;返回这一帧真正推进的 dt
export function scaleDt(dt) {
  if (timeFX.hitStop > 0) { timeFX.hitStop -= dt; return dt * 0.12; }
  if (timeFX.slowMo > 0) { timeFX.slowMo -= dt; return dt * 0.4; }
  return dt;
}
