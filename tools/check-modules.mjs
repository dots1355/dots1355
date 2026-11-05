// 模块依赖检查(npm run lint 的一部分,不需要浏览器):
//  1. 具名导入必须真的被目标模块导出(ESLint 查不到这一类错,浏览器里是模块加载失败、白屏)。
//  2. 没有模块反过来导入 src/main.js:main 是启动装配的根,只往下依赖。
//  3. 加载期安全:模块顶层"加载时就执行"的代码(不在函数体里的部分)不得读取同一个循环依赖环里
//     别的模块的绑定——环里谁先求值取决于导入顺序,打包版(esbuild 会把环排成一个固定顺序)里
//     这就是 TDZ 报错或读到 undefined。需要别的系统的状态时,把代码包进 initX(),由 main 在装配时调用。
// 用法:node tools/check-modules.mjs [--rings]   (有问题时退出码 1;--rings 列出各个循环依赖环)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import * as eslintScope from 'eslint-scope';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const MAIN = path.join(SRC, 'main.js');
const SKIP = new Set([path.join(SRC, 'models-data.js')]); // 纯数据(几 MB 的 base64),只导出常量

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(SRC);

const mods = new Map(); // file -> { ast, scope, imports: [{ local, imported, from }], exports: Set, deps: Set }
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (SKIP.has(f)) {
    mods.set(f, { exports: new Set([...src.matchAll(/export const (\w+)/g)].map((m) => m[1])), deps: new Set(), imports: [] });
    continue;
  }
  const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true });
  const m = { ast, imports: [], exports: new Set(), deps: new Set() };
  for (const st of ast.body) {
    if (st.type === 'ImportDeclaration') {
      const spec = st.source.value;
      const from = spec.startsWith('.') ? path.resolve(path.dirname(f), spec) : null;
      if (from && from.startsWith(SRC + path.sep)) m.deps.add(from);
      for (const sp of st.specifiers) {
        m.imports.push({ local: sp.local.name, from, line: st.loc.start.line,
          imported: sp.type === 'ImportSpecifier' ? sp.imported.name : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*' });
      }
    } else if (st.type === 'ExportNamedDeclaration') {
      const d = st.declaration;
      if (d && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration')) m.exports.add(d.id.name);
      if (d && d.type === 'VariableDeclaration') for (const x of d.declarations) if (x.id.type === 'Identifier') m.exports.add(x.id.name);
      for (const sp of st.specifiers || []) m.exports.add(sp.exported.name);
    } else if (st.type === 'ExportDefaultDeclaration') m.exports.add('default');
  }
  m.scope = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  mods.set(f, m);
}

const problems = [];
const rel = (f) => path.relative(ROOT, f);

// 1 + 2:导入对得上导出;没人导入 main.js
for (const [f, m] of mods) {
  for (const im of m.imports) {
    if (!im.from || !im.from.startsWith(SRC + path.sep)) continue;
    if (im.from === MAIN) { problems.push(`${rel(f)}:${im.line} 导入了 src/main.js(main 是装配根,不应被依赖)`); continue; }
    const target = mods.get(im.from);
    if (!target) { problems.push(`${rel(f)}:${im.line} 找不到模块 ${rel(im.from)}`); continue; }
    if (im.imported !== '*' && !target.exports.has(im.imported)) {
      problems.push(`${rel(f)}:${im.line} 导入的 ${im.imported} 不是 ${rel(im.from)} 的导出`);
    }
  }
}

// 3:强连通分量(Tarjan),同一个环里的模块加载期不能互读
const index = new Map(), low = new Map(), onStack = new Set(), stack = [], comp = new Map();
let idx = 0, compId = 0;
function strong(v) {
  index.set(v, idx); low.set(v, idx); idx++;
  stack.push(v); onStack.add(v);
  for (const w of mods.get(v).deps) {
    if (!mods.has(w)) continue;
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.set(w, compId); } while (w !== v);
    compId++;
  }
}
for (const f of mods.keys()) if (!index.has(f)) strong(f);

for (const [f, m] of mods) {
  if (!m.scope) continue;
  const moduleScope = m.scope.globalScope.childScopes.find((s) => s.type === 'module');
  if (!moduleScope) continue;
  const byLocal = new Map(m.imports.map((im) => [im.local, im]));
  for (const v of moduleScope.variables) {
    const im = byLocal.get(v.name);
    if (!im || !im.from || !mods.has(im.from) || comp.get(im.from) !== comp.get(f)) continue;
    for (const ref of v.references) {
      // 引用发生在哪个作用域:往上走,遇到函数作用域 = 运行期(调用时才读),一路到模块作用域 = 加载期
      let s = ref.from, inFn = false;
      while (s && s !== moduleScope) { if (s.type === 'function') { inFn = true; break; } s = s.upper; }
      if (!inFn) {
        problems.push(`${rel(f)}:${ref.identifier.loc.start.line} 加载期读取了 ${im.local}(来自 ${rel(im.from)},与本模块在同一个循环依赖环里;请移进 initX())`);
      }
    }
  }
}

if (problems.length) {
  console.error(`模块检查发现 ${problems.length} 处问题:\n  ` + problems.join('\n  '));
  process.exit(1);
}
const cycles = new Map();
for (const [f, c] of comp) if (mods.get(f).scope) (cycles.get(c) || cycles.set(c, []).get(c)).push(rel(f));
const rings = [...cycles.values()].filter((v) => v.length > 1).sort((a, b) => b.length - a.length);
console.log(`模块检查通过:${mods.size} 个模块,导入/导出一致,无人导入 main.js,加载期无环内读取` +
  `(循环依赖环 ${rings.length} 个,最大 ${rings[0] ? rings[0].length : 0} 个模块)`);
if (process.argv.includes('--rings')) for (const r of rings) console.log(`  环(${r.length}):${r.sort().join(' ')}`);
