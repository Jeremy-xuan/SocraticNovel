# 实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.md · 行锚表（机核）

> **为什么有这份文件**：正文引用源码位置一律写锚点 `〔Axx〕`，行号只出现在本表。
> 源码一改，本表立刻过期 —— 但机核会**当场报 ERROR**（版本哈希 + 片段 + 行号三重核对），不会像散写行号那样悄悄失准。
>
> **机核命令**（工作区根执行）：
> ```
> /opt/homebrew/bin/node 开源线/DSH定制/code/tools/anchors/check-anchors.mjs \
>   开源线/DSH定制/实现报告_L2D-FIX-IDLE_Idle崩溃_2026-09-24.md --list
> ```
> 退出码 0 ＝ 全部成立。

---

## 版本表

| V | 文件 | sha256 前 16 位 |
|---|---|---|
| V1 | code/clients/live2d-host/src/host.js | af98c9d3fb845fb0 |
| V2 | code/clients/live2d-host/src/framework-entry.js | 9c6bc6c521e55f80 |
| V3 | code/clients/live2d-host/demo/demo.html | 5499baf616efbb18 |
| V4 | code/clients/live2d-host/vendor/CubismWebFramework/src/motion/cubismmotionmanager.ts | 7e88b825f99e4cbc |
| V5 | code/clients/live2d-host/vendor/CubismWebFramework/src/motion/cubismmotionqueuemanager.ts | 1aa0f6a39ffe9d83 |
| V6 | code/clients/live2d-host/vendor/CubismWebFramework/src/motion/cubismmotion.ts | eb3e8862f60feedd |
| V7 | code/clients/live2d-host/vendor/CubismWebFramework/src/motion/cubismmotionqueueentry.ts | 4619da4891829c7f |
| V8 | code/clients/live2d-host/vendor/CubismWebFramework/src/motion/acubismmotion.ts | 649524b171f1a3ab |
| V9 | code/clients/live2d-host/vendor/CubismWebFramework/CHANGELOG.md | 653e57d95d1f6374 |
| V10 | code/clients/live2d-host/tools/idle-motion-probe.cjs | f3f902b98ed1de49 |
| V11 | code/clients/live2d-host/tools/idle-rootcause-evidence.cjs | c2f527507887a3f4 |
| V12 | code/clients/live2d-host/tools/idle-failure-visibility.cjs | dd6ccc7d445ce735 |
| V13 | code/clients/live2d-host/tools/idle-argorder-ablation.cjs | 3f5f7933c08adf91 |

> 取数时刻：**2026-09-24**（本轮 L2D-FIX-IDLE 修复完成、`out/` 重建后）。
> V1～V3 是本轮**改后**的现盘；V4～V9 是 vendored 官方框架（本轮未改动，哈希即上游 commit 内容）；V10～V13 是本轮**新增**的工具。
> 🔴 修前的 `src/host.js` 是 `081d39edce8f6264`（留痕自上一路报告），已不在盘上 —— 所以正文里对「修前代码」的描述用的是**逐字引文**，不是锚点。

---

## 锚点表

| 锚点 | 说明 | 版本 | 行 | 片段 |
|---|---|---|---|---|
| A01 | 修后的 startMotion()：按官方签名补齐第三个参数的位置 | V1 | 420 | `  startMotion(groupName, index, priority = 2) {` |
| A02 | 真正下发给框架的那一行：autoDelete 明确传 false | V1 | 425 | `      .startMotionPriority(g.motions[index], false, priority);` |
| A03 | 检查框架返回值（被拒绝时是 -1），不再无条件 return true | V1 | 427 | `    return handle !== InvalidMotionQueueEntryHandleValue;` |
| A04 | 引入官方常量 InvalidMotionQueueEntryHandleValue | V1 | 33 | `  InvalidMotionQueueEntryHandleValue,` |
| A05 | update() 里「起 Idle」成功分支（返回值被检查了） | V1 | 461 | `      if (this.startRandomIdleMotion()) {` |
| A06 | 「起 Idle 失败」状态置位（只报一次，不刷屏） | V1 | 465 | `        this._idleStartFailure = true;` |
| A07 | 新增的宿主级错误出口 reportError() | V1 | 190 | `  reportError(err) {` |
| A08 | 失败标志的初始化（构造函数内） | V1 | 181 | `    /** 「起 Idle 失败」是否已报过（防每帧刷屏；恢复后自动复位） */⏎    this._idleStartFailure = false;` |
| A09 | load() 里把动作对象缓存进 this.motionGroups（为什么不能交给框架删） | V1 | 385 | `      this.motionGroups.push({ name: g, count: n, motions: list });` |
| A10 | startRandomIdleMotion()：idleGroup 为空时返回 false | V1 | 431 | `  startRandomIdleMotion() {` |
| A11 | framework-entry.js 新增的出口（给 A04 用） | V2 | 38 | `export { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';` |
| A12 | 演示页的取证钩子：window.__host（纯赋值） | V3 | 185 | `        window.__host = host;` |
| A13 | 演示页把宿主错误接进页面日志 | V3 | 179 | `          onError: (e) => log('[host-error] ' + e.message)` |
| A14 | 演示页「起 Idle 动作」按钮检查返回值并出声 | V3 | 210 | `        if (!host.startRandomIdleMotion()) log('[host-error] 起 Idle 动作失败：该模型没有可用的 Idle 动作');` |
| A15 | 官方签名 startMotionPriority(motion, autoDelete, priority) | V4 | 62 | `  public startMotionPriority(` |
| A16 | 它把 autoDelete 原样透传给 super.startMotion | V4 | 73 | `    return super.startMotion(motion, autoDelete);` |
| A17 | 条目播完即 release + 摘除（队列管理器的播完分支） | V5 | 274 | `      if (motionQueueEntry.isFinished()) {⏎        motionQueueEntry.release();⏎        motionQueueEntry = null;⏎        this._motions.splice(i, 1); // 削除` |
| A18 | release() 只在 autoDelete 为真时才删 motion 对象 | V7 | 39 | `    if (this._autoDelete && this._motion) {` |
| A19 | CubismMotion.release()：把 _motionData 置空（对象变空壳） | V6 | 801 | `  public release(): void {⏎    this._motionData = void 0;⏎    this._motionData = null;` |
| A20 | 崩溃那一行：读 _motionData.duration | V6 | 437 | `    let duration: number = this._motionData.duration;` |
| A21 | isFinished() 的定义：所有条目都播完才返回真 | V5 | 91 | `  public isFinished(): boolean {` |
| A22 | parse 只把 JSON 的 Loop 写进 _motionData.loop | V6 | 873 | `    this._motionData.loop = json.isMotionLoop();` |
| A23 | _isLoop 只在构造函数里被置 false，parse 不再改它 | V6 | 785 | `    this._isLoop = false; // trueから false へデフォルトを変更` |
| A24 | 框架提供的 setLoop()（要循环得应用自己调） | V8 | 255 | `  public setLoop(loop: boolean): void {` |
| A25 | CHANGELOG 记的 looping motion 播完判定修复 | V9 | 117 | `* Fix an issue with detecting the end of playback when looping motion.` |
| A26 | 探针的退出码契约 | V10 | 32 | ` *   0 = 起动作后画面在动，且零报错` |
| A27 | 探针收报错的三条通道之一（含页面日志通道） | V10 | 232 | `    // ⚠️ 三条报错通道全部收（只收 pageerror 会漏掉被页面 try/catch 吞掉的帧内异常）` |
| A28 | 探针的合取判据 | V10 | 285 | `    result.verdict.pass = result.verdict.movedAfterClick && errCount === 0;` |
| A29 | 取证脚本给队列条目发稳定编号（数「换过几次动作」） | V11 | 62 | `    if (!window.__rcEntryIds.has(e)) window.__rcEntryIds.set(e, ++window.__rcEntrySeq);` |
| A30 | doUpdateMotion() 签名：空队列只是循环 0 次 | V5 | 233 | `  public doUpdateMotion(model: CubismModel, userTimeSeconds: number): boolean {` |
| A31 | 故障注入：把 idleGroup 置空 | V12 | 82 | `      window.__host.idleGroup = null;` |
| A32 | 消融用：重放修前的两参数写法 | V13 | 116 | `        this.userModel.getMotionManager().startMotionPriority(g.motions[index], priority);` |

---

## 行号散写豁免

本次**没有豁免项**：正文不散写任何源码行号；`§1.2` 里那段崩溃栈是**逐字报错原文**（含打包产物偏移 `live2d-host.bundle.mjs:7446`），它是运行时段日志的一部分，不是对源码位置的引用。
