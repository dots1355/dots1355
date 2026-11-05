# 架构说明

浏览器端 three.js(r160,`lib/` 内置)游戏,无打包也能直接以 ES 模块运行;`tools/build-desktop.mjs` 用 esbuild 打成单文件 HTML。

`src/main.js` 只是**装配根**:按顺序把各模块装起来、定义有序的系统表、跑 rAF 主循环(约 340 行)。
玩法在 `src/systems/`,界面在 `src/ui/`,渲染底座在 `src/gfx/`,共享根对象与通用设施在 `src/core/`。
**没有任何模块导入 `main.js`**(`tools/check-modules.mjs` 守着)。

## 分层与依赖方向

```
main.js(装配根:启动顺序 + 系统表 + 主循环)
  │  只往下依赖
  ▼
systems/*  ui/*          玩法与界面(彼此可以互相调用,见下"循环依赖的规矩")
  │
  ▼
gfx/*  world.js terrain.js flora.js vegetation.js wilderness.js entities.js audio.js …   渲染与世界构建(叶子,不认识玩法)
  │
  ▼
core/state.js  core/frame.js  core/rng.js  core/timers.js  core/timefx.js  core/ctx.js  content-packs.js  story.js   (不导入任何玩法模块)
```

- **共享根对象** `core/state.js`:`world`(buildWorld 的产物)、`colliders`、`player`、`started`。main 在装配时各登记一次
  (`bindWorld` / `bindPlayer` / `markStarted`);系统模块从这里读,而不是从 main 读。
- **底层模块经 `core/ctx.js` 拿回调**:相机、天空、天气、地图这些不认识玩法的模块需要"玩家在哪、开局没有、心境如何"时,
  读 main 登记进 `ctx` 的活对象与回调(带安全缺省值),从而保持是叶子。
- **循环依赖的规矩**:systems/ui 之间互相导入是常态(战斗要通缉、通缉要卫兵 AI……),ES 模块允许循环,前提是
  **模块顶层"加载时就执行"的代码不读环里别的模块的绑定**(只在函数里读)。否则谁先求值取决于导入顺序——
  浏览器原生加载碰巧能跑,esbuild 打包版会把环排成另一个顺序,直接 TDZ 报错或读到 undefined。
  需要别的系统状态、或要往场景里加东西、要用人形模型(模型在 main 的 `await` 之后才就绪)的开局代码,
  一律写成 `initX()`,由 main 在装配序列里调用。`npm run lint` 里的 `tools/check-modules.mjs` 静态检查这一条
  (以及"具名导入必须真的被导出""没人导入 main.js")。
- **跨模块的可变状态**:导出的 `let` 只由声明它的模块赋值(ES 模块里给导入的绑定赋值本身就是错误,ESLint
  `no-import-assign` 也会拦);别的模块读它的活绑定,或调用所有者提供的函数(`setLockFoe`、`crime`、`resetEvade`、
  `startChickenRiot`、`setLakeBlessed`、`markStarted`……)。多个系统都要改的状态做成对象属性
  (`calendar.dailyEvents / letter / festGrantedDay`、`idle.t`、`frame.n`、`EVO.*`、`vendetta.stage`……)。
- **派生属性只在一处算**:生命上限 `recomputeMaxHp()`(护甲 + 湖神恩赐 + 屠龙者)、体力上限 `recomputeMaxSta()`
  (技艺等级 + 军旗),都在 `systems/player.js`;读档、买甲、奇遇、技艺升级、夺旗都调它们,不各自加减。

## 模块一览

### core/ —— 共享根对象与通用设施
| 模块 | 职责 / 对外接口 |
| --- | --- |
| `core/state.js` | 运行期共享根对象 `world / colliders / player / started` 与一次性登记 `bindWorld / bindPlayer / markStarted`;不导入任何东西 |
| `core/frame.js` | 帧时钟 `frame.now`(rAF 时间戳,动画相位用)与模拟帧计数 `frame.n`(隔帧系统按它错开) |
| `core/timers.js` | 游戏时钟 `simNow()` 与定时器 `later(sec, fn)`:按游戏 dt 结算,暂停即冻结、慢镜同步 |
| `core/timefx.js` | 打击停顿 `hitStop` / 处决慢镜 `slowMo`;`scaleDt` 在 tick 开头统一缩放 dt |
| `core/rng.js` | 可设种子的 `rand()`;玩法与世界生成的随机都走它,测试可复现 |
| `core/ctx.js` | 给底层模块(相机/天空/天气/地图)的回调与活对象登记处,带安全缺省值 |
| `core/save.js` | 存档格式的唯一定义处(带版本号 `v`,当前 v3);`saveGame`、分段 `loadGame`(任一段失败:停用自动存档、备份原档、提示)、`applyProgress`(读档后把进度落到世界里) |
| `core/aitext.js` | 运行时 AI 文本 `aiLine`(离线/`?noai=1` 回退)、`AI_TEXT_OFF`、各输出口的忙碌标记 `aiBusy` |
| `core/testhooks.js` | 测试/诊断句柄 `window.__gtm`(`step(n, dt)` 与主循环共用同一个 `tick`;`systems()` 列出系统表) |

### systems/ —— 玩法(每个模块开头写着职责、对外接口、要不要 init、主循环调哪些 update)
| 模块 | 职责 |
| --- | --- |
| `systems/actors.js` | 实体名单与生成(`addHorse/addGuard/addBandit/addWolf`)、开局常住人口与荒野生成钩子 `initActors`、退场 `retireEntity/retireProp`、远距休眠 `entFar`、通用移动与人形/马的动作 |
| `systems/player.js` | 玩家:`spawnPlayer`、每帧移动/骑乘/潜行/踩踏、翻滚、扒窃、人群软碰撞、挨打 `damagePlayer` 与倒下 `gameOver`、派生属性、脱战回血/庇佑倒计时/深水规则/落地回弹 |
| `systems/attack.js` | 玩家出招状态机:轻击/蓄力重击/弓/飞刀、输入缓冲、格挡;伤害在判定帧由 `combat.meleeSweep` 结算 |
| `systems/combat.js` | 统一伤害结算 `applyDamage(target, n, { source })` 与按身份的死亡结算、近战横扫、受击打断、起手预警扇形、锁定、士气、刀光、战斗音乐 |
| `systems/ai.js` | 卫兵/劫匪/盗贼/狼/村民/马的每帧行为 |
| `systems/projectiles.js` | 箭、魔光弹、火球、飞刀共用的投射物表与命中 |
| `systems/magic.js` | 法术、冰霜留痕、技艺熟练度、潜行、龙吼、体力花销 |
| `systems/gear.js` | 武器/护甲表与外观、铁匠铺商店 |
| `systems/mercs.js` | 旅店雇的佣兵(随行、升老兵、按日发饷) |
| `systems/warband.js` | 盗贼战团、攻城、枭首单挑 |
| `systems/dragon.js` | 霜龙终局 Boss |
| `systems/prologue.js` | 序章教学、教学卡、送马与唤马 |
| `systems/quests.js` | 领主委托链、委托人与目标光柱、城墙寻路 `initQuests` |
| `systems/law.js` | 通缉星、犯罪、无法无天、通缉衰减 |
| `systems/events.js` | 街头事件、悬赏板、角斗场 `initEvents` |
| `systems/director.js` | 事件导演与全部导演事件(含内容包事件与黑石劫掠战) |
| `systems/vendetta.js` | 黑石的报复(守城胜利后的剧情链) |
| `systems/npcs.js` | 具名 NPC(有日程)、管家、搞笑 NPC 与小赌局、喷泉许愿 `initNPCs` |
| `systems/fauna.js` | 鸡、羊、鹿、蘑菇、白狼「霜牙」`initFauna` |
| `systems/activities.js` | 篝火/温泉/教堂、梦、手账、拍照、湖心岛、赛马计时、地窖、村务、铭文、公告、钓鱼 `initActivities` |
| `systems/home.js` | 湖畔小屋、信箱、战利品墙、萤火 `initHome` |
| `systems/interact.js` | E 键交互的唯一来源 `tryInteract(probe)`;`computePrompt` 是它的试运行;交互目标标记 `initInteract` |
| `systems/input.js` | 输入入队 `queueInput` / tick 开头 `drainInput`;键鼠监听 `initInput` |
| `systems/calendar.js` | 季节与日子、节庆、来信、换日 `newDay`、时辰 `dayPhase`、环境氛围音 |
| `systems/mind.js` | 编年史、回响之镜 `initMirror`、全局工作空间、可塑心智、发呆低语、夜间巩固 |
| `systems/evo.js` | 内容自进化(传说、狼群世代、敌人战术、活语料) |
| `systems/achievements.js` | 成就表、`stats` 计数、`unlockAch` |
| `systems/camera.js` | 相机跟随、锁定越肩、防穿墙、震屏与速度感视野;共享镜头状态 `cam` |
| `systems/sky.js` | 天空与昼夜、群系氛围过渡、视距跟随雾距;`clock.time` 是一天的进度 |
| `systems/weather.js` | 天气轮换、雷电、雨雪粒子、地面湿润与水洼、扬尘 |
| `systems/scenery.js` | 布景每帧动画:远山环/远景垫底跟随、环境粒子、风车/符文立石/宝箱盖/云、水面、胶片颗粒 |

### ui/ —— 界面(只读玩法状态,或调用玩法提供的函数)
| 模块 | 职责 |
| --- | --- |
| `ui/toast.js` | 分档的顶部提示条队列(委托 > 一般 > 氛围,插队 `toastNow`) |
| `ui/dialog.js` | 对话组合引擎 `dbLine`、多页对话面板、追问、AI 肖像、闲聊气泡 |
| `ui/feedback.js` | 伤害数字与战斗浮字、连杀、倒地动画、实例级受击闪白、击退、残血红晕 |
| `ui/hudview.js` | HUD 刷新(签名串比对,没变不碰 DOM)、技能栏、操作说明、区域名 |
| `ui/hud.js` | HUD 图标(内联 SVG)与 `richText` |
| `ui/maps.js` | 小地图与 M 键全图(经 `ctx.mapView()` 取快照,不持有玩法状态) |
| `ui/pause.js` | 暂停菜单;`paused` / `setPaused` |
| `ui/title.js` | 标题画面、存档信息与清档确认、点击开局、标题/倒下画面背景图 |

### gfx/ 与世界构建(叶子,不认识玩法)
| 模块 | 职责 |
| --- | --- |
| `gfx/core.js` | 渲染器、场景、相机;后处理链(Render → GTAO → Bloom → Output → 调色 → 画风 → SMAA);8 种画风预设 |
| `gfx/quality.js` | 画质三档 `QUALITY`、`setQuality`、自动画质 `autoQuality`(p90 帧时 + 动态分辨率)、实体远近分级 `updateEntityLOD`、画风切换 `nextStyle`、`initQuality` |
| `gfx/snap.js` | 贴地 `unsnapScene / snapScene`(见约定 1) |
| `gfx/prepare.js` | 开局最后的渲染准备:点光入池、静态合批 + 小件远景剔除、着色器预热 |
| `gfx/pools.js` | 固定数量的点光池与特效材质池(不在游戏中途重编译着色器) |
| `gfx/skin.js` / `gfx/vpbr.js` | 实体刚体蒙皮合批与远近分级;顶点色 PBR 材质与烘焙 |
| `gfx/surface.js` / `gfx/facet.js` / `gfx/water.js` | 表面着色补丁(破平铺、雨天湿润、水洼)、静物刻面、统一水体着色器 |
| `world.js` / `terrain.js` / `waterbodies.js` | 王国手工布局与碰撞体;地形高度 `groundH`、群系权重、地表;水体布局 |
| `landmarks.js` | 核心王国的群系地标、树林、路灯与路牌(确定性撒点,实例化) |
| `flora.js` / `vegetation.js` / `ambient.js` / `batch.js` | 树石地标模板与实例化;流式草丛;环境粒子;静态合批 |
| `wilderness.js` | 王国之外的无尽荒野(按坐标哈希确定性生成区块,分帧装卸) |
| `entities.js` | 人形/马/狼/龙等模型构建、碰撞网格 `resolveCollisions`、实体资源回收 |
| `audio.js` | 程序化音效与音乐 |
| `story.js` / `dialogue-banks.js` / `content-packs.js` | 文本内容(内容包里的追加文本由各自的系统模块在加载时并进自己的表) |

## 启动装配(main.js,顺序即语义)

1. 点光池 → 预载 AI 贴图、解析内嵌 GLB 模板(`await`,之后人形模型才就绪)→ 本地标题图。
2. `bindWorld(buildWorld(scene))` → 平整蒙版与起伏地表、远景垫底 → 草丛与环境粒子 → `scatterCoreLandmarks()` → 后台 AI 贴图热替换。
3. `bindPlayer(spawnPlayer(…))`,然后各系统 init:`initActors → initFauna → initActivities → initQuests → initEvents →
   initHome → initNPCs → initQuality → initInteract → initMirror → initPickups`。这个顺序就是原来的建场顺序,
   **也决定了实体名单的顺序**(例如 `bandits` 里先是灰烬荒地匪帮、再是地窖守墓者;测试按名单取实体)。
4. `loadGame()`(分段读档)→ `applyProgress()` → `initTitle(hasSave)`(Delete 清档监听要先于玩法键盘监听)→
   `initInput()` → `initCombat()` → `initAttack()`。
5. 登记 `ctx`(底层模块的回调与地图快照)→ `installTestHooks` → `poolSceneLights → batchStaticWorld → warmShaders` →
   `requestAnimationFrame(loop)`。

## 主循环与系统表

```
loop(now) ── unsnapScene() → tick(dt, now) → autoQuality → snapScene() → fitViewDistance() → composer.render()
                              │
tick(dt, now) ── drainInput()          输入先入队,在这里按发生顺序生效(在 dt 缩放之前)
              ── dt = scaleDt(dt)      打击停顿 / 处决慢镜
              ── for (s of SYSTEMS) s.update(dt, now)
```
暂停或看地图时不调 `tick`,世界冻结、只渲染。`window.__gtm.step(n, dt)` 用同一个 `tick` 固定步长推进(不渲染)。

`SYSTEMS`(`main.js`)是有序的 `{ name, update(dt, now) }` 表,顺序就是语义——`tests/run.mjs` 的 `systems` 用例锁着它:

| 组 | 系统(按执行顺序) |
| --- | --- |
| 界面与通用计时 | toast · dialogRange · hitFlash · timers · interactMarker |
| 玩家 | player · regen · attackInput · knockback · buffs · rideMileage · deepWater |
| 同伴与场所 | frostfang · springs · timeTrial · cryptLights · altarGlow |
| 人与动物 | guards · bandits · wolves · chickens · villagers · horses · deer |
| 委托、王法、玩法事件 | pickups · quest · wanted · fishing · projectiles · damageNumbers · combo · falls · arena · director · streetEvent · bounty · armWrestle · home · firefly · vista |
| 法术与战斗 | magic · frostPatches · trails · telegraphs · lockOn · prologue · lawless · warband · dragon · combatMusic · squash · mercs · vendetta |
| 天气、氛围与人声 | weather · ambience · region · bubble · chatter · npcs · rain · ambientFX · dust · dayNight · lightPool · calendar · workspace · idle |
| 流式世界、镜头与布景 | wilderness · vegetation · underlay · camera · scenery · beacon · water · envLight |
| 画面反馈与 HUD | lowHp · coins · entityLOD · prompt(每 3 帧)· hud · actionBar · minimap(每 2 帧)· filmGrain · frameCount |

加新系统:在所属模块写一个命名的 `updateX(dt)`,在表里按语义插到合适位置,并同步 `systems` 用例与本表。

## 关键约定

### 1. 逻辑 y 是"离地高度"
玩法代码里实体的 `pos.y` 一律是离地高度(站在地上就是 0),碰撞与距离都在 XZ 平面算。
渲染前 `snapScene()` 给每个顶层对象加上 `groundH(x, z)`,下一帧更新前 `unsnapScene()` 再减掉;
位置没动就复用缓存高度。已经是绝对坐标的东西(地表网格、天空、粒子、合批网格)标 `userData.noSnap`。

### 2. 开局代码写进 initX()
模块顶层只放声明:常量、函数、自己的 THREE 几何/材质、DOM 查找与按钮接线、`rand()`。凡是要往场景里加东西
(`scene.add` 必须在 main 记下 `preWorldTops` 之后,否则小件远景剔除不认它)、要用人形模型、要读别的系统状态的,
写进 `initX()`,由 main 在装配序列里调用。读档在装配中途发生,所以存档要写的状态对象必须在模块加载时就已初始化。

### 3. 输入
键鼠事件只把玩法动作 `queueInput(fn)` 入队,`tick` 开头统一执行;暂停/看地图时清空并松开蓄力。
界面操作(对话翻页、菜单、画风切换)仍即时响应。

### 4. 战斗
- 出招:`tryAttack` 只"起手",伤害在**判定帧**由 `scheduleStrike` 结算,刀光与命中同帧;被打断则作废。
- 轻点/按住:`attackDown/attackUp/updateAttackInput`——松手出轻击,按住蓄力,松手重击。
- 伤害:**所有**对敌伤害走 `applyDamage(target, n, { source })`。`source` 决定算不算你的罪、进不进你的连杀
  (`player` / `companion` / `env` / `foe`);死亡按身份统一结算(`killWolf` / `slayBandit` / `downGuard`)。
- 受击:`flinch` 打断起手并给短暂霸体;精英只吃重击。处决基准伤害作为 `meleeSweep` 的参数传入。

### 5. 交互
`tryInteract(probe)` 是 E 键交互的唯一来源:每条分支自带提示文字;`probe=true` 时只返回提示不改状态。
`computePrompt` 就是它的试运行——提示与实际行为不可能再不一致。各玩法的状态留在各自模块
(例如教堂庇佑 `blessedToday / prayAtChapel`、墓志铭 `readEpitaph`),交互只调用。

### 6. 存档
`saveGame` 写带版本号(`v`)的 JSON;`loadGame` **分段**读取,每段独立 try。任一段失败:本局停用自动存档、
原档另存 `gth-save-v1-bak`,并提示玩家。版本迁移写在对应段里(例如 v3 的委托顺序调整)。

### 7. 性能
- 阴影图每帧只画一次(`shadowMap.autoUpdate=false`,渲染前置 `needsUpdate`),范围 ±70m(流畅档 ±36m、隔帧更新)。
- 相机远裁剪面跟随雾距(`fitViewDistance`),天穹/星空/远山环随之缩放;流畅档另有 250m 视距上限(雾随之收近)。
- 静态合批(`batch.js`,开局由 `gfx/prepare.js` 调用):材质签名 × 128m 格;颜色进顶点色,朴素材质的粗糙度/金属度进顶点属性(`gfx/vpbr.js`),
  贴图平铺烘进 UV。没并进去的开局小件按距离用 layers 剔除(`registerSmallProps/updatePropLOD`)。
- 实体(`gfx/skin.js`):每个人形/动物合成一个刚体蒙皮网格,共用骨骼调色板纹理。根节点是 `EntityGroup`,
  它的 `visible` = 玩法可见性 && 远近分级:远处整棵子树不画、不算矩阵,中距不投影且在阴影遍历里剪掉,
  再远一点隔帧更新矩阵。玩法代码只写 `group.visible`,不要读它判断逻辑状态。
- 实体退场一律走 `retireEntity(e, list)` / 一次性道具走 `retireProp(o)`:移出场景并释放独占几何与材质。
- 荒野区块(`wilderness.js`)按距离装卸,生成是分帧的生成器(每帧 2ms 预算),卸载每帧至多一块;
  树石与兴趣点烘成少量顶点色网格,地标走实例化,整块冻结矩阵。
- 着色器预热对着后处理的离屏目标编译(真实变体);点光池的灭灯在片元里整盏跳过,不改程序键。
- 画质三档(`gfx/quality.js` 的 `QUALITY` 表:视距、阴影框与频率、实体/小件/树林剔除距离、荒野装载距离、草密度……)。
  自动画质按 4 秒窗口的 p90 帧时升降档并调动态分辨率,带迟滞;自动选的档只记 24 小时(`gth-fx-auto`),
  手选的才永久记住(`gth-fx`,带 `!`)。

## 测试与检查
```bash
npm run lint   # ESLint(只开抓真 bug 的规则)+ tools/check-modules.mjs(导入/导出一致、无人导入 main、加载期无环内读取)
npm test       # tests/run.mjs:起静态服务器 + 无头 Chromium,用 __gtm.step 驱动
node tests/run.mjs boot save   # 只跑挑出来的用例
```
覆盖:启动、贴地、受击闪白隔离、远近分级与玩法可见性互不覆盖、环境伤害、近战结算、符文立石判定帧、后期链不黑屏、
出招时序/蓄力/打断、战斗规则(缓冲/朝向/挨打打断/弹反)、序章教学流程、伤害来源×目标矩阵、交互与提示同源、
上马优先/对话自动收起/光柱、生命上限、城墙寻路、存档往返与坏档保护、**主循环系统表顺序**、**单文件打包版能开局并存档往返**。
CI 见 `.github/workflows/ci.yml`。

## 资产
`tools/gen-*.py` 是 Blender(bpy)资产工厂,生成 `assets/models/*.glb`;`tools/bake-models.mjs` 把它们烘进
`src/models-data.js`(base64),单文件版与 `file://` 都能用。需要 Python 3.13 的 bpy:`/usr/bin/python3 tools/gen-camp.py`。
单文件打包在 `tools/bundle.mjs`(`build-desktop.mjs` 与 `bundle` 用例共用)。
