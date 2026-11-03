// ESLint(扁平配置):`npm run lint`。只开能抓真 bug 的规则——未定义变量、重复声明/键、
// 不可达代码、自赋值等;风格类交给编辑器。
import globals from 'globals';

export default [
  { ignores: ['lib/**', 'dist/**', 'node_modules/**', 'src/models-data.js', 'electron/**'] },
  {
    files: ['src/**/*.js', 'tests/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-const-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-unsafe-negation': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
];
