// 把 assets/models/*.glb 烘焙成 base64 ESM 模块(file:// 与单文件版可用)
// 路径相对仓库根(本脚本所在目录的上一级),在任何检出/工作树里都能跑
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'assets', 'models');
const out = {};
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith('.glb')) continue;
  out[f.replace('.glb', '')] = readFileSync(path.join(dir, f)).toString('base64');
}
writeFileSync(path.join(ROOT, 'src', 'models-data.js'),
  '// Blender 资产工厂产物(tools/gen-assets.py → tools 里的 bake):写实树木 GLB,base64 内嵌\n' +
  'export const MODELS_B64 = ' + JSON.stringify(out) + ';\n');
console.log('OK', Object.keys(out), (JSON.stringify(out).length / 1024).toFixed(0) + 'KB');
