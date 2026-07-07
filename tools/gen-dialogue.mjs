// 组合空间统计:语料已移入 src/dialogue-banks.js,游戏运行时现场组合(见 main.js dbLine)
// 运行: node tools/gen-dialogue.mjs → 打印当前语料的组合空间估算
import * as B from '../src/dialogue-banks.js';

const speakers = Object.keys(B.VOICES);
const avg = (o) => Object.values(o).reduce((s, a) => s + a.length, 0) / Math.max(1, Object.keys(o).length);
let perSpeaker = 0;
const moodVar = 3;   // 无前缀 + 两种语气
const tailVar = 4;   // 无尾 + 三种口头禅
const openVar = 6;   // 无开场 + 时辰开场均值
perSpeaker += avg(B.JOB_EXTRA) * openVar * moodVar * tailVar;                              // 职业日常
perSpeaker += Object.values(B.WEATHER_TALK).flat().length * openVar * moodVar * tailVar;   // 天气
perSpeaker += Object.values(B.SEASON_TALK).flat().length * openVar * moodVar * tailVar;    // 季节
perSpeaker += Object.values(B.FESTIVAL_TALK).flat().length * moodVar * tailVar;            // 节庆
perSpeaker += (speakers.length - 1) * avg(B.FACTS) * B.GOSSIP_FRAMES.length * moodVar * tailVar; // 八卦
perSpeaker += B.RUMORS.length * B.RUMOR_FRAMES.length * moodVar * tailVar;                 // 传闻
perSpeaker += Object.values(B.PLACES).flat().length * B.PLACE_FRAMES.length * tailVar;     // 地点
perSpeaker += B.STAGE_TOPICS.flat().length * B.STAGE_FRAMES.length * B.WHO.length * moodVar * tailVar; // 时事
perSpeaker += B.PROVERBS.length * B.PROVERB_FRAMES.length * moodVar * tailVar;             // 谚语
perSpeaker += avg(B.MEMORIES) * 4 * moodVar * tailVar;                                     // 回忆
perSpeaker += B.SMALLTALK.length * openVar * moodVar * tailVar;                            // 寒暄
const totalLines = Math.round(perSpeaker * speakers.length);
const avgLen = 30;
console.log(`角色数 ${speakers.length}`);
console.log(`每角色组合空间 ≈ ${Math.round(perSpeaker).toLocaleString()} 种不同的话`);
console.log(`全体组合空间 ≈ ${totalLines.toLocaleString()} 行 ≈ ${(totalLines * avgLen / 1e8).toFixed(1)} 亿字`);
