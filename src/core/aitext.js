// 运行时 AI 文本:免费文本接口(pollinations),离线或 ?noai=1 时直接回退。
// 对外:AI_TEXT_OFF(是否停用)、aiLine(prompt, fallback, 超时毫秒) → Promise<文本|fallback>、
// aiBusy(各输出口的忙碌标记:等待期间重复按 E 不再重复请求/重复开对话)。
// 不依赖任何玩法模块。

// ================= 运行时 AI 文本(免费接口,离线回退) =================
export const AI_TEXT_OFF = new URLSearchParams(location.search).has('noai');
export async function aiLine(prompt, fallback, timeoutMs = 7000) {
  if (AI_TEXT_OFF) return fallback;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let t;
    try {
      const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
        { signal: ctrl.signal });
      if (!r.ok) return fallback;
      t = (await r.text()).trim(); // 计时器覆盖响应体读取:卡住的流也会被中止
    } finally {
      clearTimeout(timer);
    }
    if (!t || t.length > 400) return fallback;
    return t;
  } catch {
    return fallback;
  }
}
// AI 输出口的忙碌标记:等待期间重复按 E 不再重复请求/重复开对话
export const aiBusy = { mirror: false, tale: false, bard: false, prophet: false, dream: false, deep: false, epitaph: false, fortune: false };

