// 把 assets/models/*.glb 烘焙成 base64 ESM 模块(file:// 与单文件版可用)
import { readFileSync, writeFileSync, readdirSync } from 'fs';
const dir = '/home/user/dots1355/assets/models';
const out = {};
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.glb')) continue;
  out[f.replace('.glb', '')] = readFileSync(`${dir}/${f}`).toString('base64');
}
writeFileSync('/home/user/dots1355/src/models-data.js',
  '// Blender 资产工厂产物(tools/gen-assets.py → tools 里的 bake):写实树木 GLB,base64 内嵌\n' +
  'export const MODELS_B64 = ' + JSON.stringify(out) + ';\n');
console.log('OK', Object.keys(out), (JSON.stringify(out).length / 1024).toFixed(0) + 'KB');
