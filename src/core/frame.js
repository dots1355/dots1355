// 帧时钟:主循环每帧写入 rAF 时间戳(测试步进 __gtm.step 按 dt 推进),
// 动画相位(四肢摆动、萤火、蓄力光)统一读 frame.now,免得几十个实体各查一次时钟。
// 玩法计时(冷却、弹反窗口)请用 core/timers.js 的 simNow():暂停冻结、慢镜同步。
export const frame = { now: performance.now() };
