// HUD 图标:统一风格的内联 SVG(24×24,圆头描边 + 少量填色,羊皮纸金色系),替掉 emoji——
// 红心、金币、技能栏、装备栏、日期/时辰/天气、通缉星、任务栏/提示条共用一套。iconHTML 接受图标名或旧 emoji
// (未收录的原样返回);richText 把一段文字里的 emoji 换成图标(认不得的装饰 emoji 去掉)。
// 另含 HUD 小部件:红心条、日期天气条、按键提示自动淡出、操作说明标题图标。
const P = {
  heart: 'M12 20.4C9.6 18.7 3.6 14.2 3.6 9a4.2 4.2 0 0 1 8.4-1.6A4.2 4.2 0 0 1 20.4 9c0 5.2-6 9.7-8.4 11.4z',
};
const S = (inner, extra = '') => `<svg class="ico${extra}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  heart: `<path d="${P.heart}" fill="#c94436" stroke="#3a120c" stroke-width="1.4"/><path d="M7.4 7.2a2.4 2.4 0 0 1 2.6-.9" stroke="#f3a597" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  heartHalf: `<defs><clipPath id="hhL"><rect x="0" y="0" width="12" height="24"/></clipPath></defs><path d="${P.heart}" fill="#2e2421" stroke="#3a120c" stroke-width="1.4"/><path d="${P.heart}" fill="#c94436" clip-path="url(#hhL)"/><path d="${P.heart}" fill="none" stroke="#3a120c" stroke-width="1.4"/>`,
  heartEmpty: `<path d="${P.heart}" fill="#2e2421" fill-opacity="0.7" stroke="#8a6a4a" stroke-width="1.4"/>`,
  coin: '<circle cx="12" cy="12" r="8.2" fill="#e2b13c" stroke="#5a3d0c" stroke-width="1.4"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="#9a6a14" stroke-width="1.2"/><path d="M12 8.6v6.8M9.8 10.2h4.4" stroke="#7a4f0c" stroke-width="1.4" stroke-linecap="round"/>',
  sword: '<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M19.6 4.4 9.8 14.2"/><path d="M19.6 4.4l-3.3.5M19.6 4.4l-.5 3.3"/><path d="M7.4 11.8l4.8 4.8"/><path d="M8.6 15.4 4.8 19.2"/></g><circle cx="4.4" cy="19.6" r="1.4" fill="currentColor"/>',
  dagger: '<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M17.6 6.4l-6 6"/><path d="M17.6 6.4l-2.2.3M17.6 6.4l-.3 2.2"/><path d="M9.6 10.6l3.8 3.8"/><path d="M10.6 13.4 6.6 17.4"/></g><circle cx="6.2" cy="17.8" r="1.3" fill="currentColor"/>',
  greatsword: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M5 4.6l10.4 10.4M19 4.6 8.6 15"/><path d="M13.6 17.6l4-4M10.4 17.6l-4-4"/><path d="M16.2 16.2l2.8 2.8M7.8 16.2 5 19"/></g>',
  bow: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M6.2 3.8c7.6 1.8 13.8 8 14 14"/><path d="M6.2 3.8 20.2 17.8" stroke-width="1.1"/><path d="M4 20 15.6 8.4"/><path d="M15.6 8.4l-3 .3M15.6 8.4l-.3 3"/><path d="M4 20l1.6-3.2M4 20l3.2-1.6"/></g>',
  fleur: '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M12 3.4c-2.6 3-2.6 6.4 0 9.4 2.6-3 2.6-6.4 0-9.4z"/><path d="M12 12.8c-1.8-3.2-6.6-3.6-7.6-.6-.8 2.4 1.8 4 3.6 2.6"/><path d="M12 12.8c1.8-3.2 6.6-3.6 7.6-.6.8 2.4-1.8 4-3.6 2.6"/><path d="M8.4 15.2h7.2M12 15.2v5.4"/></g>',
  shield: '<path d="M12 3.2 19 6v5.2c0 4.4-3 7.8-7 9.6-4-1.8-7-5.2-7-9.6V6z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v12M8 10.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  roll: '<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"><path d="M18.4 9.2A7 7 0 1 0 19 14.4"/><path d="M18.8 4.8l-.4 4.4-4.4-.4"/></g><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  spark: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.2 3.2M15.2 15.2l3.2 3.2M18.4 5.6l-3.2 3.2M8.8 15.2l-3.2 3.2"/></g><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  fire: '<path d="M12 21c-3.9 0-6.4-2.6-6.4-6 0-3.6 3-5.6 3.8-9.2 1.6 1.2 2.2 3 2 4.6 1.4-.8 2.4-2.6 2.4-4.6 3 2.2 4.6 5.4 4.6 9.2 0 3.4-2.5 6-6.4 6z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 19c-1.6 0-2.6-1-2.6-2.4 0-1.6 1.4-2.4 1.8-4 1.8 1.2 3.4 2.6 3.4 4 0 1.4-1 2.4-2.6 2.4z" fill="currentColor"/>',
  heal: '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M10 4.5c.4 3.4 1.8 4.8 5.2 5.2-3.4.4-4.8 1.8-5.2 5.2-.4-3.4-1.8-4.8-5.2-5.2 3.4-.4 4.8-1.8 5.2-5.2z"/><path d="M17.2 13.8c.2 1.8 1 2.6 2.8 2.8-1.8.2-2.6 1-2.8 2.8-.2-1.8-1-2.6-2.8-2.8 1.8-.2 2.6-1 2.8-2.8z"/></g>',
  frost: '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.8 4.6 12 6.6l2.2-2M9.8 19.4l2.2-2 2.2 2M4.6 10.6l2.9-.6-1-2.8M19.4 13.4l-2.9.6 1 2.8M17.4 7.2l-1 2.8 2.9.6M6.6 16.8l1-2.8-2.9-.6"/></g>',
  blink: '<g stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"><path d="M12 3 19.6 12 12 21 4.4 12z"/><path d="M12 8.2 15.2 12 12 15.8 8.8 12z" fill="currentColor" fill-opacity="0.35"/></g>',
  shout: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M4 9.4h3.2L12 5.6v12.8l-4.8-3.8H4z" fill="currentColor" fill-opacity="0.2" stroke-linejoin="round"/><path d="M15.2 9a4 4 0 0 1 0 6M17.8 6.6a7.4 7.4 0 0 1 0 10.8"/></g>',
  lock: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><circle cx="12" cy="12" r="6.6"/><path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4"/></g><circle cx="12" cy="12" r="1.8" fill="currentColor"/>',
  sneak: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M3.6 11.2c2.4 3.2 5.2 4.8 8.4 4.8s6-1.6 8.4-4.8"/><path d="M6.4 14.6 5 16.6M12 16v2.6M17.6 14.6l1.4 2"/></g>',
  swap: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M5 9.4h12.4l-3-3M19 14.6H6.6l3 3"/></g>',
  // 天气 / 时辰 / 季节
  sun: '<circle cx="12" cy="12" r="4.2" fill="#f2c55a" stroke="#7a5214" stroke-width="1.2"/><g stroke="#f2c55a" stroke-width="1.7" stroke-linecap="round"><path d="M12 2.6v2.4M12 19v2.4M2.6 12h2.4M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7"/></g>',
  cloud: '<path d="M7.2 18.4a3.8 3.8 0 0 1-.4-7.6 5.2 5.2 0 0 1 10-1.2 4.4 4.4 0 0 1 .6 8.8z" fill="#cfd6dc" stroke="#4a5560" stroke-width="1.3" stroke-linejoin="round"/>',
  partly: '<circle cx="9" cy="8.6" r="3.6" fill="#f2c55a" stroke="#7a5214" stroke-width="1.1"/><g stroke="#f2c55a" stroke-width="1.5" stroke-linecap="round"><path d="M9 2.2v1.6M2.6 8.6h1.6M4.4 4l1.1 1.1M13.6 4l-1.1 1.1"/></g><path d="M9.6 19.4a3.4 3.4 0 0 1-.3-6.8 4.6 4.6 0 0 1 8.8-1 3.9 3.9 0 0 1 .5 7.8z" fill="#cfd6dc" stroke="#4a5560" stroke-width="1.3" stroke-linejoin="round"/>',
  rain: '<path d="M7.2 14.4a3.6 3.6 0 0 1-.4-7.2 5 5 0 0 1 9.6-1.2 4.2 4.2 0 0 1 .6 8.4z" fill="#aeb8c2" stroke="#3e4a56" stroke-width="1.3" stroke-linejoin="round"/><g stroke="#7fb0e0" stroke-width="1.7" stroke-linecap="round"><path d="M8.4 16.6l-1 3M12.4 16.6l-1 3M16.4 16.6l-1 3"/></g>',
  storm: '<path d="M7.2 13.8a3.6 3.6 0 0 1-.4-7.2 5 5 0 0 1 9.6-1.2 4.2 4.2 0 0 1 .6 8.4z" fill="#8a94a0" stroke="#2e3640" stroke-width="1.3" stroke-linejoin="round"/><path d="M12.6 12.6 9.8 17h3l-1.6 4.4 4.6-5.8h-3.2l1.6-3z" fill="#f2d35a" stroke="#6a4a0c" stroke-width="1" stroke-linejoin="round"/>',
  snow: '<path d="M7.2 13.6a3.6 3.6 0 0 1-.4-7.2 5 5 0 0 1 9.6-1.2 4.2 4.2 0 0 1 .6 8.4z" fill="#d8e0e8" stroke="#4a5560" stroke-width="1.3" stroke-linejoin="round"/><g fill="#eef4fa" stroke="#6a7a8a" stroke-width="0.8"><circle cx="8.2" cy="17" r="1.2"/><circle cx="12.2" cy="19.4" r="1.2"/><circle cx="16.2" cy="17" r="1.2"/></g>',
  dawn: '<path d="M6.6 16.6a5.4 5.4 0 0 1 10.8 0" fill="#f2b05a" stroke="#7a4a14" stroke-width="1.2"/><g stroke="#f2b05a" stroke-width="1.6" stroke-linecap="round"><path d="M12 6.6v2.4M5.2 9.6l1.6 1.6M18.8 9.6l-1.6 1.6"/></g><path d="M3 16.6h18M6 19.6h12" stroke="#cfa060" stroke-width="1.5" stroke-linecap="round"/>',
  dusk: '<path d="M6.6 16.6a5.4 5.4 0 0 1 10.8 0" fill="#e07a40" stroke="#6a2a10" stroke-width="1.2"/><path d="M3 16.6h18M6 19.6h12" stroke="#c07a50" stroke-width="1.5" stroke-linecap="round"/><path d="M12 6v3.4M10.2 7.8 12 9.6l1.8-1.8" stroke="#e07a40" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  moon: '<path d="M15.4 3.8a8.4 8.4 0 1 0 4.8 13.4 6.8 6.8 0 0 1-4.8-13.4z" fill="#e8e4cf" stroke="#6a6450" stroke-width="1.3" stroke-linejoin="round"/><circle cx="18.6" cy="5.6" r="0.9" fill="#e8e4cf"/>',
  spring: '<g fill="#f0b8c8" stroke="#7a3a4a" stroke-width="1"><circle cx="12" cy="7.2" r="3"/><circle cx="16.6" cy="10.6" r="3"/><circle cx="14.8" cy="16" r="3"/><circle cx="9.2" cy="16" r="3"/><circle cx="7.4" cy="10.6" r="3"/></g><circle cx="12" cy="12" r="2.2" fill="#f2d35a" stroke="#7a5214" stroke-width="0.9"/>',
  autumn: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" fill="#d07a34" stroke="#6a3410" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 19 14.6 9.4M9.4 14.6v-3M12 12h3" stroke="#6a3410" stroke-width="1.2" stroke-linecap="round"/>',
  winter: '<g stroke="#cfe4f4" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M9.8 4.6 12 6.6l2.2-2M9.8 19.4l2.2-2 2.2 2"/></g>',
  armor: '<path d="M8 4h8l3 3-2 3v9H7v-9L5 7z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.6 4.2c.6 1.8 4.2 1.8 4.8 0M7 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  relic: '<circle cx="12" cy="12" r="3.8" fill="#f2c55a" stroke="#7a5214" stroke-width="1.2"/><g stroke="#f2c55a" stroke-width="1.6" stroke-linecap="round"><path d="M12 3.6v2.6M12 17.8v2.6M3.6 12h2.6M17.8 12h2.6"/></g>',
  mana: '<path d="M12 4.2 17.6 12 12 19.8 6.4 12z" fill="#6aa8e8" stroke="#1e3e66" stroke-width="1.3" stroke-linejoin="round"/>',
  // 任务栏 / 提示条里的小图标(同一套线稿风格)
  scroll: '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M7 4.5h10.5a1.8 1.8 0 0 1 1.8 1.8V18a1.8 1.8 0 0 1-1.8 1.8H8.8A1.8 1.8 0 0 1 7 18z" fill="currentColor" fill-opacity="0.16"/><path d="M7 4.5a2 2 0 0 0-2.2 2v1.6H7M10 9h6.5M10 12h6.5M10 15h4.5"/></g>',
  trophy: '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M8 4h8v5.2a4 4 0 0 1-8 0z" fill="currentColor" fill-opacity="0.2"/><path d="M8 6H5.2a3.2 3.2 0 0 0 3.4 4.2M16 6h2.8a3.2 3.2 0 0 1-3.4 4.2M12 13.2v3.6M8.6 20h6.8M10 16.8h4"/></g>',
  hourglass: '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M7 3.6h10M7 20.4h10"/><path d="M8.2 3.6c0 4.2 3.8 5 3.8 8.4s-3.8 4.2-3.8 8.4M15.8 3.6c0 4.2-3.8 5-3.8 8.4s3.8 4.2 3.8 8.4"/><path d="M9.6 19.2h4.8L12 16.4z" fill="currentColor"/></g>',
  warn: '<path d="M12 3.6 21 19.6H3z" fill="#e2b13c" fill-opacity="0.25" stroke="#e2b13c" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.4v5M12 17.1v.4" stroke="#f3d27a" stroke-width="2" stroke-linecap="round"/>',
  dragon: '<path d="M2.8 15.6c3.2-.6 5.4-3.6 6.2-8.6 1.4 2.2 2 4 2 6 1.6-1.6 3.4-2.2 5.6-2.2-1 1.4-1.2 3-.4 4.4 1.6-.6 3.4-.4 5.4.4-3.2.8-6.4 2.8-9.4 5.8-3.4-1-6.6-2.6-9.4-5.8z" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  paw: '<g fill="currentColor"><ellipse cx="6.8" cy="9.6" rx="1.7" ry="2.1"/><ellipse cx="10.2" cy="6.4" rx="1.7" ry="2.2"/><ellipse cx="13.8" cy="6.4" rx="1.7" ry="2.2"/><ellipse cx="17.2" cy="9.6" rx="1.7" ry="2.1"/><path d="M12 11.2c-3 0-5.2 3.2-5.2 5.4 0 1.6 1.4 2.4 2.8 2.1 1-.2 1.6-.6 2.4-.6s1.4.4 2.4.6c1.4.3 2.8-.5 2.8-2.1 0-2.2-2.2-5.4-5.2-5.4z"/></g>',
  flag: '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.6V3.8"/><path d="M6 4.6h11.4l-2.6 4 2.6 4H6" fill="currentColor" fill-opacity="0.25"/></g>',
  horseshoe: '<g stroke="currentColor" stroke-linecap="round" fill="none"><path d="M7.2 20V12a4.8 4.8 0 0 1 9.6 0v8" stroke-width="3"/></g><g fill="#2a1a0c"><circle cx="7.2" cy="13" r="0.7"/><circle cx="16.8" cy="13" r="0.7"/><circle cx="8.4" cy="8.6" r="0.7"/><circle cx="15.6" cy="8.6" r="0.7"/></g>',
  star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.7l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z" fill="#f2c55a" stroke="#6a4a0c" stroke-width="1.2" stroke-linejoin="round"/>',
  starEmpty: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.7l-5.3 2.8 1.1-5.9-4.4-4.1 6-.8z" fill="#2e2421" fill-opacity="0.6" stroke="#8a6a4a" stroke-width="1.2" stroke-linejoin="round"/>',
  crown: '<g stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4.2 17.4 3.6 7.2l5 4.4L12 5.2l3.4 6.4 5-4.4-.6 10.2z" fill="currentColor" fill-opacity="0.22"/><path d="M4.6 20.2h14.8"/></g>',
  castle: '<g stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 20.4V9h2.8v2h2.4V9h1.6v2h2.4V9h1.6v2h2.4V9H20v11.4z" fill="currentColor" fill-opacity="0.2"/><path d="M10.4 20.4v-3.6a1.6 1.6 0 0 1 3.2 0v3.6" fill="none"/></g>',
  feather: '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"><path d="M19.4 4.2C12.6 4.6 7.8 9.6 7.4 16.4l-.2 4"/><path d="M19.4 4.2c-.6 7-4.6 11.2-12 12.2" fill="currentColor" fill-opacity="0.2"/><path d="M11 13l4-4"/></g>',
  manaEmpty: '<path d="M12 4.2 17.6 12 12 19.8 6.4 12z" fill="#2a3440" fill-opacity="0.6" stroke="#6a7a8a" stroke-width="1.2" stroke-linejoin="round"/>',
};
// 旧 emoji → 图标名(数据表、任务与提示文字里的 icon 沿用 emoji,渲染时换成 SVG);键里不带 U+FE0F
const EMOJI = {
  '🗡': 'sword', '🔪': 'dagger', '⚔': 'greatsword', '🏹': 'bow', '⚜': 'fleur', '🛡': 'shield', '🌀': 'roll',
  '✴': 'spark', '🔥': 'fire', '✨': 'heal', '❄': 'frost', '💠': 'blink', '🐉': 'dragon', '🎯': 'lock', '🤫': 'sneak',
  '🔄': 'swap', '☀': 'sun', '🌞': 'sun', '⛅': 'partly', '🌧': 'rain', '⛈': 'storm', '🌨': 'snow', '🌅': 'dawn',
  '🌇': 'dusk', '🌙': 'moon', '🌕': 'moon', '🌘': 'moon', '🌸': 'spring', '🍂': 'autumn', '🪙': 'coin', '💰': 'coin',
  '💸': 'coin', '❤': 'heart', '📜': 'scroll', '📋': 'scroll', '🏆': 'trophy', '🎖': 'trophy', '⏱': 'hourglass',
  '⏳': 'hourglass', '⚠': 'warn', '🚨': 'warn', '🐺': 'paw', '📣': 'shout', '🏁': 'flag', '🚩': 'flag', '🏟': 'flag',
  '🐴': 'horseshoe', '🐎': 'horseshoe', '★': 'star', '⭐': 'star', '✩': 'starEmpty', '👑': 'crown', '🏰': 'castle',
  '🐔': 'feather',
};
export function svgIcon(name, cls = '') {
  const inner = ICONS[name];
  return inner ? S(inner, cls ? ' ' + cls : '') : '';
}
export function iconHTML(key, cls = '') {
  const name = ICONS[key] ? key : EMOJI[String(key || '').replace(/\uFE0F/g, '')];
  if (name) return svgIcon(name, cls);
  const span = document.createElement('span');
  span.textContent = key || '';
  return span.innerHTML;
}
// 红心条:满 / 半 / 空
export function heartsHTML(full, half, empty) {
  return svgIcon('heart').repeat(full) + (half ? svgIcon('heartHalf') : '') + svgIcon('heartEmpty').repeat(Math.max(0, empty));
}
const SEASON_ICONS = ['spring', 'sun', 'autumn', 'winter'];
const PHASE_ICONS = { dawn: 'dawn', day: 'sun', dusk: 'dusk', night: 'moon' };
const WEATHER_ICONS = { clear: 'sun', cloudy: 'partly', rain: 'rain', storm: 'storm' };
// 日期天气条:季节图标 + 「春·1日」 + 时辰图标 + 天气图标(深色底的小牌子,夜里也看得清)
export function weatherHTML(seasonIdx, dateText, phase, weatherState, winterSnow) {
  const span = document.createElement('span');
  span.textContent = dateText;
  return svgIcon(SEASON_ICONS[seasonIdx] || 'spring') + `<span class="wx-date">${span.innerHTML}</span>` +
    svgIcon(PHASE_ICONS[phase] || 'sun') + svgIcon(winterSnow ? 'snow' : WEATHER_ICONS[weatherState] || 'sun');
}
// 任务栏 / 提示条 / 交互提示的文字:转义后把认得的 emoji 换成同风格 SVG,认不得的装饰 emoji 直接去掉
// (箭头与几何符号 ▶◀▪ 之类保留)
const PICTO = /\p{Extended_Pictographic}/gu;
export function richText(msg) {
  const span = document.createElement('span');
  span.textContent = msg == null ? '' : String(msg);
  return span.innerHTML.replace(/[\uFE0F\u200D]/g, '').replace(PICTO, (ch) => {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x25a0 && cp <= 0x25ff)) return ch;
    const n = EMOJI[ch];
    return n ? svgIcon(n, 'ico-t') : '';
  }).replace(/^ +/gm, '').replace(/ {2,}/g, ' ');
}
// 通缉星:实心 / 空心各一套
export function wantedHTML(n) {
  return n > 0 ? svgIcon('star').repeat(n) + svgIcon('starEmpty').repeat(Math.max(0, 5 - n)) : '';
}
export function manaHTML(cur, max) {
  return svgIcon('mana', 'ico-s').repeat(cur) + svgIcon('manaEmpty', 'ico-s').repeat(Math.max(0, max - cur));
}
// 操作说明(H)各栏标题的 emoji 换成同风格图标
for (const h of document.querySelectorAll('#controls-hint h4')) {
  const t = h.textContent.replace(/[\uFE0F\u200D]/g, '');
  const m = t.match(PICTO);
  const head = { '🏃': 'roll', '⚔': 'greatsword', '✨': 'spark', '👁': 'lock', '🗺': 'flag' }[m ? m[0] : ''];
  h.innerHTML = (head ? svgIcon(head, 'ico-t') : '') + richText(t.replace(PICTO, '').trim());
}
// 按键提示:开局后 12 秒淡出(H 键的完整操作说明不受影响)
const titleEl = document.getElementById('title');
const keyhintEl = document.getElementById('keyhint');
if (titleEl && keyhintEl) {
  titleEl.addEventListener('click', () => {
    keyhintEl.classList.remove('kh-fade');
    void keyhintEl.offsetWidth; // 重新触发动画
    keyhintEl.classList.add('kh-fade');
  });
}
