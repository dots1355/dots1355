// 单文件打包:把整个游戏(three.js + 全部模块 + 对话语料)用 esbuild 打成一段 ESM,内联进 index.html。
// tools/build-desktop.mjs 用它出 dist/;tests/run.mjs 的 bundle 用例用它在内存里打一份来跑(打包版的模块求值顺序
// 与浏览器原生加载不同,加载期读到环里还没初始化的绑定会直接报错,所以单独测一遍)。
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function bundleHtml() {
  const { buildSync } = await import('esbuild');
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
  return html.replace(tag, () => `<script type="module">\n${js}\n</script>`);
}
