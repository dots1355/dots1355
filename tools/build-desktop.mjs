// 单文件桌面版构建:把整个游戏(three.js + 全部模块 + 对话语料)打进一个 HTML,
// 双击即玩,零安装、零服务器。存档走浏览器 localStorage,联网时 AI 功能自动可用。
// 用法: npm i -D esbuild && node tools/build-desktop.mjs
//   产物: dist/侠盗猎马人-中世纪王国.html
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { bundleHtml } from './bundle.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await bundleHtml();

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const dest = path.join(ROOT, 'dist', '侠盗猎马人-中世纪王国.html');
writeFileSync(dest, html);
console.log(`✅ ${dest} (${(html.length / 1024 / 1024).toFixed(2)} MB) — 双击即玩`);
