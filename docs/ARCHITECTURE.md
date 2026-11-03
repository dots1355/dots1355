# 架构说明

浏览器端 three.js(r160,`lib/` 内置)游戏,无打包也能直接以 ES 模块运行;`tools/build-desktop.mjs` 用 esbuild 打成单文件 HTML。

## 模块一览

| 模块 | 职责 |
| --- | --- |
| `src/gfx/core.js` | 渲染器、场景、相机;后处理链(Render → GTAO → Bloom → Output → 调色 → 画风 → SMAA);8 种画风预设 `applyStyle/cycleStyle` |
| `src/gfx/pools.js` | 固定数量的**点光池**(光源只登记,按远近"附身")与**特效材质池**——两者都为了不在游戏中途重编译着色器 |
| `src/core/ctx.js` | 共享上下文:main.js 启动时登记玩家/世界/碰撞体与少量回调,拆出的系统模块经它访问(带安全缺省值) |
| `src/systems/camera.js` | 相机:跟随、锁定越肩、防穿墙/穿岩、震屏与速度感视野;共享镜头状态 `cam` |
| `src/systems/weather.js` | 天气轮换、雷电、雨/雪线段粒子、地面扬尘 |
| `src/core/timers.js` | 游戏时钟定时器 `later(sec, fn)`:按游戏 dt 结算,暂停即冻结 |
| `src/core/rng.js` | 可设种子的 `rand()`;玩法与世界生成的随机都走它,测试可复现 |
| `src/terrain.js` | 群系权重、地形高度 `terrainH`、压平蒙版、`groundH`(与网格三角化逐三角一致)、地表网格与材质、地图配色 |
| `src/world.js` | 王国手工布局(城墙、建筑、道路、兴趣点、碰撞体、小地图要素) |
| `src/batch.js` | 静态合批:世界里不会动的网格按"材质签名 × 64m 格"合并,剩余静态物冻结矩阵 |
| `src/flora.js` | 树/岩石/地标模板与实例化(`buildNatureInstances`:160m 格分块,可整块剔除) |
| `src/vegetation.js` | 围绕玩家流式散布的草/花/蕨/芦苇/碎石(实例化 + 风摆 + 远处渐隐) |
| `src/ambient.js` | 群系环境粒子(雪/沙/余烬/落叶/萤火/花粉),运动全在着色器 |
| `src/wilderness.js` | 王国之外的无尽荒野:按坐标哈希确定性生成区块 |
| `src/entities.js` | 人形/马/狼/龙等模型构建,碰撞网格 `resolveCollisions`,实体资源回收 `disposeEntityGroup` |
| `src/audio.js` | 程序化音效与音乐 |
| `src/story.js` / `dialogue-banks.js` | 文本内容 |
| `src/main.js` | 玩法系统与主循环(玩家、战斗、AI、任务、交互、HUD、存档……) |

## 关键约定

### 1. 逻辑 y 是"离地高度"
玩法代码里实体的 `pos.y` 一律是离地高度(站在地上就是 0),碰撞与距离都在 XZ 平面算。
渲染前 `snapScene()` 给每个顶层对象加上 `groundH(x, z)`,下一帧更新前 `unsnapScene()` 再减掉;
位置没动就复用缓存高度。已经是绝对坐标的东西(地表网格、天空、粒子、合批网格)标 `userData.noSnap`。

### 2. 一帧的顺序
```
loop(now) ── tick(dt) ──┬─ drainInput()        输入先入队,在这里按顺序生效
                        ├─ 各系统 update(dt)   玩家/战斗/AI/任务/天气/昼夜……
                        └─ HUD / 小地图
          ── snapScene() → fitViewDistance() → composer.render()
```
`window.__gtm.step(n, dt)` 用同一个 `tick` 固定步长推进模拟(不渲染),测试靠它又快又稳。

### 3. 输入
键鼠事件只把玩法动作 `queueInput(fn)` 入队,`tick` 开头统一执行;暂停/看地图时清空并松开蓄力。
界面操作(对话翻页、菜单、画风切换)仍即时响应。

### 4. 战斗
- 出招:`tryAttack` 只"起手",伤害在**判定帧**由 `scheduleStrike` 结算,刀光与命中同帧;被打断则作废。
- 轻点/按住:`attackDown/attackUp/updateAttackInput`——松手出轻击,按住蓄力,松手重击。
- 伤害:**所有**对敌伤害走 `applyDamage(target, n, { source })`。`source` 决定算不算你的罪、进不进你的连杀
  (`player` / `companion` / `env` / `foe`);死亡按身份统一结算(`killWolf` / `slayBandit` / `downGuard`)。
- 受击:`flinch` 打断起手并给短暂霸体;精英只吃重击。

### 5. 交互
`tryInteract(probe)` 是 E 键交互的唯一来源:每条分支自带提示文字;`probe=true` 时只返回提示不改状态。
`computePrompt` 就是它的试运行——提示与实际行为不可能再不一致。

### 6. 存档
`saveGame` 写带版本号(`v`)的 JSON;`loadGame` **分段**读取,每段独立 try。任一段失败:本局停用自动存档、
原档另存 `gth-save-v1-bak`,并提示玩家。版本迁移写在对应段里(例如 v3 的委托顺序调整)。
派生属性(如生命上限)只在 `recomputeMaxHp` 里算。

### 7. 性能
- 阴影图每帧只画一次(`shadowMap.autoUpdate=false`,渲染前置 `needsUpdate`),范围 ±70m。
- 相机远裁剪面跟随雾距(`fitViewDistance`),天穹/星空/远山环随之缩放。
- 静态合批(`batch.js`)、实例化地标/树林/金币、实体远近分级(`updateEntityLOD`)。
- 画质三档 + 按帧时自动降档 + 动态分辨率(`setQuality/autoQuality`)。

## 测试与检查
```bash
npm run lint   # ESLint(只开抓真 bug 的规则)
npm test       # tests/run.mjs:起静态服务器 + 无头 Chromium,用 __gtm.step 驱动
```
覆盖:启动、贴地、受击闪白隔离、环境伤害、近战结算、出招时序/蓄力/打断、序章教学流程、交互与提示同源、
伤害来源×目标矩阵、生命上限、城墙寻路、存档往返与坏档保护。CI 见 `.github/workflows/ci.yml`。

## 资产
`tools/gen-*.py` 是 Blender(bpy)资产工厂,生成 `assets/models/*.glb`;`tools/bake-models.mjs` 把它们烘进
`src/models-data.js`(base64),单文件版与 `file://` 都能用。需要 Python 3.13 的 bpy:`/usr/bin/python3 tools/gen-camp.py`。
