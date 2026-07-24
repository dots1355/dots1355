// 单文件桌面版构建:把整个游戏(three.js + 全部模块 + 对话语料)打进一个 HTML,
// 双击即玩,零安装、零服务器。存档走浏览器 localStorage,联网时 AI 功能自动可用。
// 用法: npm i -D esbuild && node tools/build-desktop.mjs
//   产物: dist/侠盗猎马人-中世纪王国.html
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { buildSync } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = buildSync({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'esm', // main.js 有顶层 await,esm 内联 <script type="module"> 正好支持
  alias: { three: path.join(ROOT, 'lib/three.module.js') },
  write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script>/g, '<\\/script>');

let html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
const tag = '<script type="module" src="./src/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html 里没找到模块脚本标签');
// 注意:第二参必须用函数——压缩产物里会出现 $& 之类的 replace 特殊序列
html = html.replace(tag, () => `<script type="module">\n${js}\n</script>`);

mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const dest = path.join(ROOT, 'dist', '侠盗猎马人-中世纪王国.html');
writeFileSync(dest, html);
console.log(`✅ ${dest} (${(html.length / 1024 / 1024).toFixed(2)} MB) — 双击即玩`);
