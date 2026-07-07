// 把 content-packs.json 与 SMALLTALK 合并进语料库,重写 src/dialogue-banks.js 为纯数据 ESM
import { writeFileSync, readFileSync } from 'fs';
import * as B from '../src/dialogue-banks.js';

const PACKS = JSON.parse(readFileSync(new URL('./content-packs.json', import.meta.url), 'utf8'));
// 深拷贝一份可变数据
const D = JSON.parse(JSON.stringify({
  VOICES: B.VOICES, OPENERS: B.OPENERS, FACTS: B.FACTS, NAMES: B.NAMES,
  GOSSIP_FRAMES: B.GOSSIP_FRAMES, RUMORS: B.RUMORS, RUMOR_FRAMES: B.RUMOR_FRAMES,
  PLACES: B.PLACES, PLACE_FRAMES: B.PLACE_FRAMES, STAGE_TOPICS: B.STAGE_TOPICS,
  STAGE_FRAMES: B.STAGE_FRAMES, WHO: B.WHO, PROVERBS: B.PROVERBS, PROVERB_FRAMES: B.PROVERB_FRAMES,
  WEATHER_TALK: B.WEATHER_TALK, SEASON_TALK: B.SEASON_TALK, FESTIVAL_TALK: B.FESTIVAL_TALK,
  JOB_EXTRA: B.JOB_EXTRA, MEMORIES: B.MEMORIES,
}));
D.RUMORS.push(...(PACKS.rumors?.lines || []));
D.PROVERBS.push(...(PACKS.proverbs?.lines || []));
for (const e of PACKS.seasonExtra?.entries || []) D.SEASON_TALK[e.key]?.push(...e.lines);
for (const e of PACKS.festivalExtra?.entries || []) D.FESTIVAL_TALK[e.key]?.push(...e.lines);
for (const pk of ['facts1', 'facts2', 'facts3', 'facts4']) {
  for (const e of PACKS[pk]?.entries || []) if (D.FACTS[e.key]) D.FACTS[e.key].push(...e.lines);
}
for (const pk of ['mem1', 'mem2', 'memNamed']) {
  for (const e of PACKS[pk]?.entries || []) if (D.MEMORIES[e.key]) D.MEMORIES[e.key].push(...e.lines);
}
if (PACKS.guards?.lines) D.JOB_EXTRA.guard.push(...PACKS.guards.lines);
for (const e of PACKS.shopTalk?.entries || []) if (D.JOB_EXTRA[e.key]) D.JOB_EXTRA[e.key].push(...e.lines);
D.SMALLTALK = PACKS.smalltalk?.lines || [];

// 去重
for (const k of Object.keys(D)) {
  const v = D[k];
  if (Array.isArray(v)) D[k] = [...new Set(v)];
  else if (v && typeof v === 'object') {
    for (const kk of Object.keys(v)) if (Array.isArray(v[kk])) v[kk] = [...new Set(v[kk])];
  }
}

let out = '// 对话语料库(纯数据,由 tools/bake-banks.mjs 生成;内容包已烘焙)\n' +
  '// 浏览器运行时组合引擎(src/main.js composeLine)与 node 统计工具共用\n';
for (const [k, v] of Object.entries(D)) {
  out += `export const ${k} = ${JSON.stringify(v)};\n`;
}
writeFileSync(new URL('../src/dialogue-banks.js', import.meta.url), out);
console.log('baked', out.length, 'chars;', 'RUMORS', D.RUMORS.length, 'PROVERBS', D.PROVERBS.length,
  'SMALLTALK', D.SMALLTALK.length);
