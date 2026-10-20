# A2 · Live2D Cubism Web Framework 关键 API 一手取证（源码级）

> **产出人**：技术取证子代理（A2）
> **产出时间**：2026-09-24
> **纪律**：类名／方法名／函数签名**只来自实际抓到的官方源码原文**。抓不到即写「未找到」并列出试过的 URL/检索词。**不含任何凭记忆写的 API 签名。**
> **每条证据四要素**：① 逐字签名（代码块）② 来源 URL（含文件路径与行号）③ 抓取时间 ④ 标注「官方源码原文」或「我的概括」

---

## 0. 取证基座（版本与来源，先定锚）

### 0.1 本报告依据的仓库与 commit

**取证方式**：`git clone --depth 1` 官方仓库到本地 `/tmp/CubismWebFramework`，用 `read`/`grep` 读取带行号的文件内容。行号即本地 clone 中该文件的真实行号，与 GitHub 网页同一 commit 的行号一致。

**官方仓库**：`https://github.com/Live2D/CubismWebFramework`

**抓取时间**：2026-09-24 09:41～09:52 CST

**commit**（官方源码原文，`git log -1` 输出）：

```
commit d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b
AuthorDate Thu Apr 2 11:12:40 2026 +0900
Subject Update to Cubism 5 SDK for Web R5
```

**默认分支**：`develop`（`remotes/origin/HEAD -> origin/develop`）

**`git describe --tags`**：`fatal: No names found, cannot describe anything.`（shallow clone 未取 tag，属 clone 参数所致，不代表仓库无 tag）

🔴 **版本前提**：本仓库当前内容 = **Cubism 5 SDK for Web R5**。

### 0.2 ⚠️ 与常见教程/旧版本的重大结构差异

本次抓到的 R5 有三个**会直接改变接线方式**的结构差异：

1. **物理目录是 `src/physics/`，不是 `src/effect/`**。`src/effect/cubismphysics.ts` **不存在**。
2. 🔴 **R5 取消了「在 `update()` 里手写组件调用序列」的写法，改为 `CubismUpdateScheduler`**。外部组件（眨眼/表情/物理/姿势/呼吸/拖拽/口型）不再由你按顺序手调，而是各自包成 `ICubismUpdater`，**按 `executionOrder` 数值排序后统一调用**。这是本次取证最重要的发现，详见 §5。
3. **`src/type/csmvector.ts` 不存在**——R5 改用原生 `Array`（如 `updateParameters` 里用 `Array<CubismIdHandle>`）。

→ 凡下文标「未找到」的项，请优先怀疑**版本差异**而非「该 API 不存在于 Cubism 生态」。**本报告不外推到 R1–R4。**

### 0.3 辅助源（官方 sample 仓库）

**官方 sample 仓库**：`https://github.com/Live2D/CubismWebSamples`
**抓取时间**：2026-09-24 09:42 CST
**关键文件**：`Samples/TypeScript/Demo/src/lappmodel.ts`（1075 行）
**主循环文件**：`Samples/TypeScript/Demo/src/lapplive2dmanager.ts`

> sample 是官方的但**不是 framework 本体**。凡引用 sample 处，下文均标注「官方 sample 源码原文」。

---

## 1. 模型加载 / 解析 `model3.json`

### 1.1 `CubismModelSettingJson` —— 构造签名

**来源**：`src/cubismmodelsettingjson.ts` 第 36 行
**URL**：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/cubismmodelsettingjson.ts#L36
**抓取时间**：2026-09-24 09:41 CST ｜ **性质**：官方源码原文

```typescript
export class CubismModelSettingJson extends ICubismModelSetting {
  public constructor(buffer: ArrayBuffer, size: number) {
```

**同处官方注释（逐字，第 27–35 行）**：

```typescript
/**
 * Model3Jsonパーサー
 *
 * model3.jsonファイルをパースして値を取得する
 */
export class CubismModelSettingJson extends ICubismModelSetting {
  /**
   * 引数付きコンストラクタ
   *
   * @param buffer    Model3Jsonをバイト配列として読み込んだデータバッファ
   * @param size      Model3Jsonのデータサイズ
   */
```

✅ **要点**：构造参数是 **`(buffer: ArrayBuffer, size: number)`** —— 传入**整个 ArrayBuffer 加字节长度**，**不是 URL 字符串**。文件读取（fetch）由调用方负责。这是最易记错的一点。

### 1.2 `CubismModelSettingJson` 全部 getter —— 逐字清单（含行号）

以下**全部**为 `src/cubismmodelsettingjson.ts` 中的**官方源码原文**逐字摘录，抓取时间 2026-09-24 09:41 CST。
URL 前缀：`https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/cubismmodelsettingjson.ts#L<行号>`

| # | 行号 | 逐字签名（官方源码原文） |
|---|---|---|
| 1 | 76 | `public release(): void {` |
| 2 | 87 | `public getJson(): CubismJson {` |
| 3 | 95 | `public getModelFileName(): string {` |
| 4 | 106 | `public getTextureCount(): number {` |
| 5 | 118 | `public getTextureDirectory(): string {` |
| 6 | 144 | `public getTextureFileName(index: number): string {` |
| 7 | 154 | `public getHitAreasCount(): number {` |
| 8 | 168 | `public getHitAreaId(index: number): CubismIdHandle {` |
| 9 | 182 | `public getHitAreaName(index: number): string {` |
| 10 | 193 | `public getPhysicsFileName(): string {` |
| 11 | 205 | `public getPoseFileName(): string {` |
| 12 | 217 | `public getExpressionCount(): number {` |
| 13 | 230 | `public getExpressionName(index: number): string {` |
| 14 | 242 | `public getExpressionFileName(index: number): string {` |
| 15 | 253 | `public getMotionGroupCount(): number {` |
| 16 | 266 | `public getMotionGroupName(index: number): string {` |
| 17 | 279 | `public getMotionCount(groupName: string): number {` |
| 18 | 295 | `public getMotionFileName(groupName: string, index: number): string {` |
| 19 | 313 | `public getMotionSoundFileName(groupName: string, index: number): string {` |
| 20 | 331 | `public getMotionFadeInTimeValue(groupName: string, index: number): number {` |
| 21 | 349 | `public getMotionFadeOutTimeValue(groupName: string, index: number): number {` |
| 22 | 365 | `public getUserDataFile(): string {` |
| 23 | 383 | `public getLayoutMap(outLayoutMap: Map<string, number>): boolean {` |
| 24 | 408 | `public getEyeBlinkParameterCount(): number {` |
| 25 | 439 | `public getEyeBlinkParameterId(index: number): CubismIdHandle {` |
| 26 | 468 | `public getLipSyncParameterCount(): number {` |
| 27 | 499 | `public getLipSyncParameterId(index: number): CubismIdHandle {` |

> 取证方法：本表由 `grep -n "public get\|public constructor\|public function\|public [a-zA-Z]" src/cubismmodelsettingjson.ts` 的完整输出**逐行照抄**得到。性质：**官方源码原文**。

### 1.3 🔴 任务书点名的 getter —— 存在性逐条裁定

| 任务书里写的名字 | 裁定 | 依据 |
|---|---|---|
| `getModelFileName()` | ✅ 存在 | #3，行 95，`(): string` |
| `getTextureCount()` | ✅ 存在 | #4，行 106，`(): number` |
| `getMotionGroupCount()` | ✅ 存在 | #15，行 253 |
| `getMotionGroupName(i)` | ✅ 存在，参数名 **`index`** | #16，行 266 |
| `getMotionCount(group)` | ✅ 存在，参数名 **`groupName: string`** | #17，行 279 |
| `getMotionFileName(group, i)` | ✅ 存在，**`(groupName: string, index: number)`** | #18，行 295 |
| `getExpressionCount()` | ✅ 存在 | #12，行 217 |
| `getExpressionName(i)` | ✅ 存在，参数名 **`index`** | #13，行 230 |
| `getExpressionFileName(i)` | ✅ 存在，参数名 **`index`** | #14，行 242 |
| `getPhysicsFileName()` | ✅ 存在 | #10，行 193 |
| `getPoseFileName()` | ✅ 存在 | #11，行 205 |
| `getEyeBlinkParameterCount()` | ✅ 存在 | #24，行 408 |
| `getEyeBlinkParameterId(i)` | ✅ 存在，参数名 **`index`** | #25，行 439 |
| `getLipSyncParameterCount()` | ✅ 存在 | #26，行 468 |
| `getLipSyncParameterId(i)` | ✅ 存在，参数名 **`index`** | #27，行 499 |
| `getHitAreaCount(i)` | ❌ **不存在** | 真名是 **`getHitAreasCount()`**（#7，行 154） |
| `getHitAreaName(i)` | ✅ 存在，参数名 **`index`** | #9，行 182 |

🔴 **两个「名字坑」**：

1. **`getHitAreasCount()` —— 是 `Areas` 不是 `Area`**。任务书写的 `getHitAreaCount` 在本版本**不存在**，写错直接编译/运行报错。
2. **命中区域除 `getHitAreaName` 外还有 `getHitAreaId(index): CubismIdHandle`**（#8，行 168）—— 返回**句柄对象**而非字符串；要用按 Id 接口查命中区域就走这个。

**任务书未点名但实际存在的 6 个**：`getTextureDirectory()`(118)、`getMotionSoundFileName()`(313)、`getMotionFadeInTimeValue()`(331)、`getMotionFadeOutTimeValue()`(349)、`getUserDataFile()`(365)、`getLayoutMap()`(383)。

---

## 2. 模型创建与 `CubismUserModel`

### 2.1 `CubismMoc.create` / `delete`

**来源**：`src/model/cubismmoc.ts` 第 20 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/model/cubismmoc.ts#L20

```typescript
  public static create(
    mocBytes: ArrayBuffer,
    shouldCheckMocConsistency: boolean
  ): CubismMoc {
```

第 54 行：

```typescript
  public static delete(moc: CubismMoc): void {
```

同文件另有：`release(): void`(105)、`getLatestMocVersion(): number`(115)、`getMocVersion(): number`(122)、`static getMocVersionFromBuffer(mocBytes: ArrayBuffer): number`(131)、`static hasMocConsistency(mocBytes: ArrayBuffer): boolean`(138)。

✅ **要点**：`shouldCheckMocConsistency` 是**必填位置参数**（无默认值）。为 `true` 时内部会调 `hasMocConsistency`，不通过则 `CubismLogError('Inconsistent MOC3.')` 并**返回 null**（第 30–34 行原文）。

### 2.2 `CubismModel` 构造与生命周期

**来源**：`src/model/cubismmodel.ts` 第 1797 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/model/cubismmodel.ts#L1797

```typescript
  public constructor(model: Live2DCubismCore.Model) {
```

同文件关键成员：

| 行号 | 逐字签名 |
|---|---|
| 196 | `public update(): void {` |
| 244 | `public saveParameters(): void {` |
| 1523 | `public loadParameters(): void {` |
| 1539 | `public initialize(): void {` |
| 1856 | `public release(): void {` |
| 207 | `public getPixelsPerUnit(): number {` |
| 218 | `public getCanvasWidth(): number {` |
| 231 | `public getCanvasHeight(): number {` |

✅ **回答任务书的问题**：**`CubismModel` 上确实同时有 `saveParameters()` 和 `loadParameters()`**（行 244 与 1523）—— 这正是「待机/参数覆盖」机制：每帧先 `loadParameters()` 回到上次保存态，再叠加当帧动作，最后 `saveParameters()` 存回。见 §5 的逐字调用序列。

### 2.3 `CubismUserModel` 全部公开方法（逐字）

**来源**：`src/model/cubismusermodel.ts` ｜ **性质**：官方源码原文
URL 前缀：`https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/model/cubismusermodel.ts#L<行号>`

| 行号 | 逐字签名 |
|---|---|
| 47 | `public isInitialized(): boolean {` |
| 58 | `public setInitialized(v: boolean): void {` |
| 70 | `public isUpdating(): boolean {` |
| 81 | `public setUpdating(v: boolean): void {` |
| 91 | `public setDragging(x: number, y: number): void {` |
| 99 | `public getModelMatrix(): CubismModelMatrix {` |
| 109 | `public setRenderTargetSize(width: number, height: number): void {` |
| 120 | `public setOpacity(a: number): void {` |
| 129 | `public getOpacity(): number {` |
| 286 | `public isHit(` |
| 336 | `public getModel(): CubismModel {` |
| 345 | `public getMocVersionFromBuffer(mocBytes: ArrayBuffer): number {` |
| 353 | `public getRenderer(): CubismRenderer_WebGL {` |
| 363 | `public createRenderer(` |
| 379 | `public deleteRenderer(): void {` |
| 395 | `public motionEventFired(eventValue: string): void {` |
| 409 | `public static cubismDefaultMotionEventCallback(` |
| 424 | `public constructor() {` |
| 461 | `public release() {` |

### 2.4 `loadModel` —— 🔴 无返回类型标注

**来源**：`src/model/cubismusermodel.ts` 第 138 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/model/cubismusermodel.ts#L138

```typescript
  public loadModel(buffer: ArrayBuffer, shouldCheckMocConsistency = false) {
```

**官方注释（逐字，第 133–137 行）**：

```typescript
  /**
   * モデルデータを読み込む
   *
   * @param buffer    moc3ファイルが読み込まれているバッファ
   */
```

✅ **要点**：`shouldCheckMocConsistency` **有默认值 `false`**（与 `CubismMoc.create` 的必填不同）。
⚠️ **注意**：此处源码**确实没有写返回类型标注**（`{` 紧跟参数表）。内部逻辑：`CubismMoc.create` → `this._moc.createModel()` → `this._model.saveParameters()` → `new CubismModelMatrix(...)`。**不要把它的返回值当有效值用**。

### 2.5 `loadMotion` / `loadExpression` / `loadPhysics` / `loadPose` / `loadUserData`（逐字）

**性质**：官方源码原文 ｜ 行号见下

**`loadMotion`** —— 第 173 行（**9 个参数，全部逐字**）：
URL：.../cubismusermodel.ts#L173

```typescript
  public loadMotion(
    buffer: ArrayBuffer,
    size: number,
    name: string,
    onFinishedMotionHandler?: FinishedMotionCallback,
    onBeganMotionHandler?: BeganMotionCallback,
    modelSetting?: ICubismModelSetting,
    group?: string,
    index?: number,
    shouldCheckMotionConsistency: boolean = false
  ): CubismMotion {
```

**`loadExpression`** —— 第 227 行：

```typescript
  public loadExpression(
    buffer: ArrayBuffer,
    size: number,
    name: string
  ): ACubismMotion {
```

**`loadPose`** —— 第 244 行：

```typescript
  public loadPose(buffer: ArrayBuffer, size: number): void {
```

**`loadUserData`** —— 第 257 行：

```typescript
  public loadUserData(buffer: ArrayBuffer, size: number): void {
```

**`loadPhysics`** —— 第 270 行：

```typescript
  public loadPhysics(buffer: ArrayBuffer, size: number): void {
```

✅ **关键点**：`loadMotion` 会**用 modelSetting 里的 fade 值覆盖 motion 自身的 fade**（第 203–216 行原文：`if (modelSetting) { const fadeInTime = modelSetting.getMotionFadeInTimeValue(group, index); if (fadeInTime >= 0.0) motion.setFadeInTime(fadeInTime); ... }`）。即 **model3.json 里的 fade 优先**。

---

## 3. 播放动作（Motion）

### 3.1 🔴 `startMotion` —— 定义在**基类** `CubismMotionQueueManager`

**来源**：`src/motion/cubismmotionqueuemanager.ts` 第 56–60 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/motion/cubismmotionqueuemanager.ts#L56

```typescript
  public startMotion(
    motion: ACubismMotion,
    autoDelete: boolean,
    userTimeSeconds?: number
  ): CubismMotionQueueEntryHandle {
```

**官方注释（逐字，第 46–55 行）**：

```typescript
  /**
   * 指定したモーションの開始
   *
   * 指定したモーションを開始する。同じタイプのモーションが既にある場合は、既存のモーションに終了フラグを立て、フェードアウトを開始させる。
   *
   * @param   motion          開始するモーション
   * @param   autoDelete      再生が終了したモーションのインスタンスを削除するなら true
   * @param   userTimeSeconds Deprecated: デルタ時間の積算値[秒] 関数内で参照していないため使用は非推奨。
   * @return                      開始したモーションの識別番号を返す。個別のモーションが終了したか否かを判定するIsFinished()の引数で使用する。開始できない時は「-1」
   */
```

🔴 **三个必须记住的点**：

1. **参数名是 `motion` / `autoDelete` / `userTimeSeconds`** —— 任务书猜的形式正确。
2. 🔴 **`userTimeSeconds` 已被官方标注 Deprecated**，原文逐字：*"Deprecated: デルタ時間の積算値[秒] 関数内で参照していないため使用は非推奨。"*（函数内不引用，不推荐使用）。→ **调用时只传两个参数即可**（源码第 73 行 `return super.startMotion(motion, autoDelete);` 就是只传两个）。
3. **返回 `-1` 表示开始失败**，对应常量 `InvalidMotionQueueEntryHandleValue`。

### 3.2 `startMotionPriority` —— 定义在**子类** `CubismMotionManager`

**来源**：`src/motion/cubismmotionmanager.ts` 第 62–66 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/motion/cubismmotionmanager.ts#L62

```typescript
  public startMotionPriority(
    motion: ACubismMotion,
    autoDelete: boolean,
    priority: number
  ): CubismMotionQueueEntryHandle {
```

**类声明（第 20 行）**：

```typescript
export class CubismMotionManager extends CubismMotionQueueManager {
```

🔴 **继承关系要点**：`startMotion`（无优先级）在**基类**；`startMotionPriority`（带优先级）在**子类**。`CubismMotionManager` 两者都有；`CubismExpressionMotionManager` 也继承同一基类，故**它也有 `startMotion`**（这就是 §4 里表情用 `startMotion` 的原因）。

### 3.3 `CubismMotionManager` 其余成员（逐字）

**来源**：`src/motion/cubismmotionmanager.ts` ｜ **性质**：官方源码原文

| 行号 | 逐字签名 |
|---|---|
| 24 | `public constructor() {` |
| 34 | `public getCurrentPriority(): number {` |
| 42 | `public getReservePriority(): number {` |
| 50 | `public setReservePriority(val: number): void {` |
| 62 | `public startMotionPriority(` （见上） |
| 84 | `public updateMotion(model: CubismModel, deltaTimeSeconds: number): boolean {` |
| 103 | `public reserveMotion(priority: number): boolean {` |

**⚠️ 任务书问的 `updateMotion(...)` 签名逐字如上**（第 84 行）：`(model: CubismModel, deltaTimeSeconds: number): boolean`。

**`updateMotion` 官方注释（逐字，第 76–83 行）**：

```typescript
  /**
   * モーションを更新して、モデルにパラメータ値を反映する。
   *
   * @param model   対象のモデル
   * @param deltaTimeSeconds    デルタ時間[秒]
   * @return  true    更新されている
   * @return  false   更新されていない
   */
```

### 3.4 `CubismMotionQueueManager` 其余成员（逐字）

**来源**：`src/motion/cubismmotionqueuemanager.ts` ｜ **性质**：官方源码原文

| 行号 | 逐字签名 |
|---|---|
| 25 | `public constructor() {` |
| 35 | `public release(): void {` |
| 56 | `public startMotion(` （见 §3.1） |
| 91 | `public isFinished(): boolean {` |
| 129 | `public isFinishedByHandle(` |
| 152 | `public stopAllMotions(): void {` |
| 180 | `public getCubismMotionQueueEntries(): Array<CubismMotionQueueEntry> {` |
| 191 | `public getCubismMotionQueueEntry(` |
| 217 | `public setEventCallback(` |
| 233 | `public doUpdateMotion(model: CubismModel, userTimeSeconds: number): boolean {` |
| 306 | `export interface CubismMotionEventFunction {` |

**`isFinished()` 官方注释（逐字，第 86–90 行）**：

```typescript
  /**
   * 全てのモーションの終了の確認
   * @return true 全て終了している
   * @return false 終了していない
   */
```

### 3.5 🔴 `CubismMotionQueueEntryHandle` 的真实定义

**来源**：`src/motion/cubismmotionqueuemanager.ts` 第 315–317 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/motion/cubismmotionqueuemanager.ts#L315

```typescript
export declare type CubismMotionQueueEntryHandle = any;
export const InvalidMotionQueueEntryHandleValue: CubismMotionQueueEntryHandle =
  -1;
```

🔴 **语义（这是本次最反直觉的发现之一）**：**`CubismMotionQueueEntryHandle` 的类型别名就是 `any`**，**不是 number**，也不是接口。而失败哨兵值 `InvalidMotionQueueEntryHandleValue = -1`。

**它实际装的是什么**——`src/motion/cubismmotionqueueentry.ts` 第 30 行（官方源码原文）：

```typescript
    this._motionQueueEntryHandle = this;
```

即 **句柄实际是 `CubismMotionQueueEntry` 实例自身的引用**。（原 C++ 版是整数序号，TS 版直接用对象引用。）

**因此正确判失败写法是 `=== InvalidMotionQueueEntryHandleValue`（`== -1`），不要假设它是数字去做算术。** 本判定依据行 62 与行 316：`return InvalidMotionQueueEntryHandleValue;` / `= -1`。

### 3.6 `ACubismMotion` —— 动作基类（fade / loop / weight）

**来源**：`src/motion/acubismmotion.ts` ｜ **性质**：官方源码原文

第 24 行类声明：

```typescript
export abstract class ACubismMotion {
```

| 行号 | 逐字签名 |
|---|---|
| 175 | `public setFadeInTime(fadeInSeconds: number): void {` |
| 183 | `public setFadeOutTime(fadeOutSeconds: number): void {` |
| 191 | `public getFadeOutTime(): number {` |
| 199 | `public getFadeInTime(): number {` |
| 207 | `public setWeight(weight: number): void {` |
| 215 | `public getWeight(): number {` |
| 228 | `public getDuration(): number {` |
| 239 | `public getLoopDuration(): number {` |
| 247 | `public setOffsetTime(offsetSeconds: number): void {` |
| 255 | `public setLoop(loop: boolean): void {` |
| 264 | `public getLoop(): boolean {` |
| 272 | `public setLoopFadeIn(loopFadeIn: boolean) {` |
| 282 | `public getLoopFadeIn(): boolean {` |
| 295 | `public getFiredEvent(` |
| 60 | `public updateParameters(` |
| 99 | `public setupMotionQueueEntry(` |
| 134 | `public updateFadeWeight(` |
| 311 | `public abstract doUpdateParameters(` |
| 370 | `public isExistModelOpacity(): boolean {` |
| 379 | `public getModelOpacityIndex(): number {` |
| 389 | `public getModelOpacityId(index: number): CubismIdHandle {` |

✅ **任务书点名三个全部确认存在**：`setLoop`(255)、`setFadeInTime`(175)、`setFadeOutTime`(183)。

**但 `setEffectIds` 不在 `ACubismMotion` 上** —— 逐字搜索结果：`grep -rn "setEffectIds" src/motion/` **只命中一处**：`src/motion/cubismmotion.ts:770`。即：

```typescript
  public setEffectIds(
    eyeBlinkParameterIds: Array<CubismIdHandle>,
    lipSyncParameterIds: Array<CubismIdHandle>
  ): void {
```

⚠️ **推断（待确认）**：这说明 `setEffectIds` **只在 `CubismMotion` 上**（不是所有 `ACubismMotion`）。`CubismExpressionMotion` 上是否有需单独确认——本次**未取该文件该方法的证据**，**不填**。

---

## 4. 设置表情（Expression）—— 🔴 明确回答「两套 manager」

### 4.1 🔴 结论：**是，表情与动作是两套并行的独立 manager**

**证据一｜类继承关系**（官方源码原文）：

- `src/motion/cubismmotionmanager.ts` 第 20 行：
  ```typescript
  export class CubismMotionManager extends CubismMotionQueueManager {
  ```
- `src/motion/cubismexpressionmotionmanager.ts` 第 30 行：
  ```typescript
  export class CubismExpressionMotionManager extends CubismMotionQueueManager {
  ```

→ **两者是同级的兄弟类，都继承同一基类 `CubismMotionQueueManager`**，互不隶属。

**证据二｜sample 里是两个独立字段**（官方 sample 源码原文，`lappmodel.ts`）：`this._motionManager` 与 `this._expressionManager` 分别独立操作——

- 第 606–617 行：`this._motionManager.isFinished()` / `this._motionManager.updateMotion(...)`（动作）
- 第 759 行：`this._expressionManager.startMotion(motion, false);`（表情）
- 第 513 行：`this._motionManager.stopAllMotions();`（**只停动作，不动表情**）
- 第 194 行：`if (this._expressionManager != null) {`（表情单独注册 updater）

✅ **所以：各自独立播放、各自的队列、各自的 isFinished**。停止动作**不会**停止表情。

### 4.2 `CubismExpressionMotion.create` —— 构造签名

**来源**：`src/motion/cubismexpressionmotion.ts` 第 42–45 行 ｜ **性质**：官方源码原文
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/motion/cubismexpressionmotion.ts#L42

```typescript
  public static create(
    buffer: ArrayBuffer,
    size: number
  ): CubismExpressionMotion {
```

**官方注释（逐字，第 36–41 行）**：

```typescript
  /**
   * インスタンスを作成する。
   * @param buffer expファイルが読み込まれているバッファ
   * @param size バッファのサイズ
   * @return 作成されたインスタンス
   */
```

**类声明（第 32 行）**：`export class CubismExpressionMotion extends ACubismMotion {`

同文件两个静态常量（第 33–34 行，官方源码原文）：
```typescript
  static readonly DefaultAdditiveValue = 0.0; // 加算適用の初期値
  static readonly DefaultMultiplyValue = 1.0; // 乗算適用の初期値
```

**同文件其他公开成员**：`doUpdateParameters(`(58)、`calculateExpressionParameters(`(111)、`getExpressionParameters()`(232)、`calculateValue(`(316)；另有 `export class ExpressionParameter {`(347)。

⚠️ **`getFadeInTime()` / `getFadeOutTime()` 在 `CubismExpressionMotion` 上未单独取证** —— 但它们在**父类 `ACubismMotion`** 上确认存在（§3.6 行 199 / 191），**继承可得**。这一点是**我的推断**（基于第 32 行的 `extends ACubismMotion`），**非该文件原文**。

### 4.3 `CubismExpressionMotionManager` 成员（逐字）

**来源**：`src/motion/cubismexpressionmotionmanager.ts` ｜ **性质**：官方源码原文

第 18 行：
```typescript
export class ExpressionParameterValue {
```
第 19–22 行（逐字字段）：
```typescript
  parameterId: CubismIdHandle; // パラメーターID
  additiveValue: number; // 加算値
  multiplyValue: number; // 乗算値
  overwriteValue: number; // 上書き値
```

第 30 行类声明见 §4.1。成员：

| 行号 | 逐字签名 |
|---|---|
| 34 | `public constructor() {` |
| 43 | `public release(): void {` |
| 61 | `public getFadeWeight(index: number): number {` |
| 82 | `public setFadeWeight(index: number, expressionFadeWeight: number): void {` |
| 107 | `public updateMotion(model: CubismModel, deltaTimeSeconds: number): boolean {` |

🔴 **回答任务书的 `startMotion(expression, ...)`**：**`CubismExpressionMotionManager` 本身没有重写 `startMotion`**（逐字 grep 该文件全部 public 成员即上表 5 个，无 `startMotion`）。它**继承基类**的 `startMotion(motion, autoDelete, userTimeSeconds?)`（§3.1）。

**官方 sample 的实际调用写法（逐字，`lappmodel.ts` 第 759 行）**：

```typescript
      this._expressionManager.startMotion(motion, false);
```

✅ 即**两个参数**：motion 对象 + `autoDelete=false`。**注意 sample 传的是 `false`**——表情不随播放结束自动删除（因为表情被存在 `this._expressions` Map 里复用）。

**sample 里表情完整设置流程（逐字，`lappmodel.ts` 第 746–765 行）**：
```typescript
  /**
   * 引数で指定した表情モーションをセットする
   *
   * @param expressionId 表情モーションのID
   */
  public setExpression(expressionId: string): void {
    const motion: ACubismMotion = this._expressions.get(expressionId);

    if (this._debugMode) {
      LAppPal.printMessage(`[APP]expression: [${expressionId}]`);
    }

    if (motion != null) {
      this._expressionManager.startMotion(motion, false);
    } else {
      if (this._debugMode) {
        LAppPal.printMessage(`[APP]expression[${expressionId}] is null`);
      }
    }
  }
```

（⚠️ `setExpression` 是 **sample 的 `LAppModel` 方法**，**不是 framework 的 API**。）

**表情更新（逐字，第 107–108 行）**：
```typescript
  public updateMotion(model: CubismModel, deltaTimeSeconds: number): boolean {
    this._userTimeSeconds += deltaTimeSeconds;
```

---

## 5. 🔴 外部组件的调用顺序（本次最重要发现）

### 5.1 官方 sample 的 `LAppModel.update()` —— 逐字全文

**来源**：`Samples/TypeScript/Demo/src/lappmodel.ts` 第 591–625 行
**URL**：https://github.com/Live2D/CubismWebSamples/blob/develop/Samples/TypeScript/Demo/src/lappmodel.ts#L591
**抓取时间**：2026-09-24 09:47 CST ｜ **性质**：官方 sample 源码原文

```typescript
  /**
   * 更新
   */
  public update(): void {
    if (this._state != LoadStep.CompleteSetup) return;

    const deltaTimeSeconds: number = LAppPal.getDeltaTime();
    this._userTimeSeconds += deltaTimeSeconds;

    //--------------------------------------------------------------------------
    this._model.loadParameters(); // 前回セーブされた状態をロード

    // Reset motion updated flag each frame
    this._motionUpdated = false;

    if (this._motionManager.isFinished()) {
      // モーションの再生がない場合、待機モーションの中からランダムで再生する
      this.startRandomMotion(
        LAppDefine.MotionGroupIdle,
        LAppDefine.PriorityIdle
      );
    } else {
      this._motionUpdated = this._motionManager.updateMotion(
        this._model,
        deltaTimeSeconds
      ); // モーションを更新
    }
    this._model.saveParameters(); // 状態を保存
    //--------------------------------------------------------------------------

    // UpdateSchedulerによる一括エフェクト更新
    this._updateScheduler.onLateUpdate(this._model, deltaTimeSeconds);

    this._model.update();
  }
```

🔴 **这段决定了接线顺序，逐条拆解**：

| 阶 | 逐字调用 | 说明 |
|---|---|---|
| 1 | `this._model.loadParameters();` | 回到上一帧保存的参数态 |
| 2 | `this._motionManager.isFinished()` | 判断动作是否播完 |
| 3 | `this.startRandomMotion(LAppDefine.MotionGroupIdle, LAppDefine.PriorityIdle);` | 空闲则随机播 idle 动作 |
| 4 | 否则 `this._motionManager.updateMotion(this._model, deltaTimeSeconds)` | 否则更新动作 |
| 5 | `this._model.saveParameters();` | 保存参数态 |
| 6 | `this._updateScheduler.onLateUpdate(this._model, deltaTimeSeconds);` | **全部外部组件（眨眼/表情/物理/姿势/呼吸/拖拽/口型）统一更新** |
| 7 | `this._model.update();` | **最后才 update 模型** |

🔴 **关键点**：**步骤 6 是 R5 新写法**。旧版本教程里那种「`_physics.evaluate()` → `_pose.updateParameters()` → `_eyeBlink.updateParameters()` → ...」逐行手写的序列，**在 R5 已被 `_updateScheduler.onLateUpdate()` 一行取代**。

### 5.2 🔴 组件执行顺序 = `CubismUpdateOrder` 枚举（官方源码原文）

**来源**：`src/motion/icubismupdater.ts` 第 22–31 行
**URL**：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/motion/icubismupdater.ts#L22
**抓取时间**：2026-09-24 09:49 CST ｜ **性质**：官方源码原文

```typescript
export enum CubismUpdateOrder {
  CubismUpdateOrder_EyeBlink = 200,
  CubismUpdateOrder_Expression = 300,
  CubismUpdateOrder_Drag = 400,
  CubismUpdateOrder_Breath = 500,
  CubismUpdateOrder_Physics = 600,
  CubismUpdateOrder_LipSync = 700,
  CubismUpdateOrder_Pose = 800,
  CubismUpdateOrder_Max = Number.MAX_SAFE_INTEGER
}
```

✅ **这就是「我们自己绑定时的接线顺序」的权威答案**，按数值升序：

**眨眼(200) → 表情(300) → 拖拽(400) → 呼吸(500) → 物理(600) → 口型(700) → 姿势(800)**

**排序机制（官方源码原文，第 48–55 行）**：

```typescript
  static sortFunction(left: ICubismUpdater, right: ICubismUpdater): number {
    if (!left || !right) {
      if (!left && !right) return 0;
      if (!left) return 1; // null/undefined elements go to end
      if (!right) return -1;
    }
    return left.getExecutionOrder() - right.getExecutionOrder();
  }
```

**执行机制（官方源码原文，`cubismupdatescheduler.ts` 第 99–115 行）**：

```typescript
  public onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void {
    if (!model) {
      return;
    }

    // Automatically sort if needed to ensure execution order
    if (this._needsSort) {
      this.sortUpdatableList();
    }

    for (let i = 0; i < this._cubismUpdatableList.length; ++i) {
      const updater = this._cubismUpdatableList[i];
      if (updater) {
        updater.onLateUpdate(model, deltaTimeSeconds);
      }
    }
  }
```

**基类（官方源码原文，`icubismupdater.ts` 第 63–65、73 行）**：

```typescript
  constructor(executionOrder: number = 0) {
    this._executionOrder = executionOrder;
  }
```
```typescript
  abstract onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void;
```

### 5.3 各 updater「默认使用的 order 值」（逐字——证明枚举真被用作默认值）

**性质**：官方源码原文（逐文件 grep `executionOrder ??`）

| 文件:行 | 逐字 |
|---|---|
| `src/motion/cubismeyeblinkupdater.ts`:46 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_EyeBlink);` |
| `src/motion/cubismexpressionupdater.ts`:41 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Expression);` |
| `src/motion/cubismlookupdater.ts`:47 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Drag);` |
| `src/motion/cubismbreathupdater.ts`:35 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Breath);` |
| `src/motion/cubismphysicsupdater.ts`:35 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Physics);` |
| `src/motion/cubismlipsyncupdater.ts`:50 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_LipSync);` |
| `src/motion/cubismposeupdater.ts`:35 | `super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Pose);` |

**构造器重载写法（以 physics 为例，逐字，`cubismphysicsupdater.ts` 第 32–35 行）**：
```typescript
  constructor(physics: CubismPhysics, executionOrder: number);
  constructor(physics: CubismPhysics, executionOrder?: number) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Physics);
```

**sample 里的注册调用（逐字，`lappmodel.ts`）**：

- 第 195–198 行（表情）：`const expressionUpdater = new CubismExpressionUpdater(this._expressionManager); this._updateScheduler.addUpdatableList(expressionUpdater);`
- 第 238–239 行（物理）：`const physicsUpdater = new CubismPhysicsUpdater(this._physics); this._updateScheduler.addUpdatableList(physicsUpdater);`
- 第 277–278 行（姿势）：`const poseUpdater = new CubismPoseUpdater(this._pose); this._updateScheduler.addUpdatableList(poseUpdater);`
- 第 299–303 行（眨眼）：`const eyeBlinkUpdater = new CubismEyeBlinkUpdater(...); this._updateScheduler.addUpdatableList(eyeBlinkUpdater);`
- 第 340–341 行（呼吸）：`const breathUpdater = new CubismBreathUpdater(this._breath); this._updateScheduler.addUpdatableList(breathUpdater);`
- 第 410–414 行（口型）：`const lipSyncUpdater = new CubismLipSyncUpdater(...); this._updateScheduler.addUpdatableList(lipSyncUpdater);`
- 第 452–453 行（拖拽）：`const lookUpdater = new CubismLookUpdater(this._look, this._dragManager); this._updateScheduler.addUpdatableList(lookUpdater);`
- 第 460–462 行（收尾排序，逐字）：
  ```typescript
    const finalizeUpdaters = (): void => {
      // 全てのUpdaterが追加されたのでUpdateSchedulerを最終ソート
      this._updateScheduler.sortUpdatableList();
  ```

### 5.4 `CubismPhysics`

**来源**：`src/physics/cubismphysics.ts`（🔴 **注意目录是 `physics/`**）｜ **性质**：官方源码原文

第 44 行类声明：`export class CubismPhysics {`

| 行号 | 逐字签名 |
|---|---|
| 51 | `public static create(buffer: ArrayBuffer, size: number): CubismPhysics {` |
| 64 | `public static delete(physics: CubismPhysics): void {` |
| 76 | `public parse(physicsJson: ArrayBuffer, size: number): void {` |
| 281 | `public stabilization(model: CubismModel): void {` |
| 485 | `public evaluate(model: CubismModel, deltaTimeSeconds: number): void {` |
| 701 | `public interpolate(model: CubismModel, weight: number): void {` |
| 762 | `public setOptions(options: Options): void {` |
| 770 | `public getOption(): Options {` |
| 777 | `public constructor() {` |
| 796 | `public release(): void {` |
| 804 | `public initialize(): void {` |
| 869 | `export class Options {` |
| 882 | `export class PhysicsOutput {` |

✅ **任务书点名两个全部确认**：`CubismPhysics.create(buffer, size)`（第 51 行）、`evaluate(model, deltaTimeSeconds)`（第 485 行，**返回 `void`**）。

### 5.5 `CubismEyeBlink`

**来源**：`src/effect/cubismeyeblink.ts` ｜ **性质**：官方源码原文

第 17 行类声明：`export class CubismEyeBlink {`

| 行号 | 逐字签名 |
|---|---|
| 24 | `public static create(` |
| 34 | `public static delete(eyeBlink: CubismEyeBlink): void {` |
| 44 | `public setBlinkingInterval(blinkingInterval: number): void {` |
| 54 | `public setBlinkingSetting(` |
| 68 | `public setParameterIds(parameterIds: Array<CubismIdHandle>): void {` |
| 76 | `public getParameterIds(): Array<CubismIdHandle> {` |
| 85 | `public updateParameters(model: CubismModel, deltaTimeSeconds: number): void {` |
| 164 | `public constructor(modelSetting: ICubismModelSetting) {` |
| 190 | `public determinNextBlinkingTiming(): number {` |
| 210 | `static readonly CloseIfZero: boolean = true;` |

🔴 **注意参数名**：任务书写的 `updateParameters(model, userTimeSeconds)`，**源码里第二个参数名是 `deltaTimeSeconds`**（第 85 行），**不是 `userTimeSeconds`**。

**`create` 逐字（第 24–26 行）**：
```typescript
  public static create(
    modelSetting: ICubismModelSetting = null
  ): CubismEyeBlink {
```

**`setBlinkingSetting` 逐字（第 54–58 行）**：
```typescript
  public setBlinkingSetting(
    closing: number,
    closed: number,
    opening: number
  ): void {
```

**官方注释（逐字，第 48–53 行）**：
```typescript
  /**
   * まばたきのモーションの詳細設定
   * @param closing   まぶたを閉じる動作の所要時間[秒]
   * @param closed    まぶたを閉じている動作の所要時間[秒]
   * @param opening   まぶたを開く動作の所要時間[秒]
   */
```

### 5.6 `CubismPose`

**来源**：`src/effect/cubismpose.ts` ｜ **性质**：官方源码原文

第 27 行类声明：`export class CubismPose {`

| 行号 | 逐字签名 |
|---|---|
| 34 | `public static create(pose3json: ArrayBuffer, size: number): CubismPose {` |
| 108 | `public static delete(pose: CubismPose): void {` |
| 119 | `public updateParameters(model: CubismModel, deltaTimeSeconds: number): void {` |
| 151 | `public reset(model: CubismModel): void {` |
| 184 | `public copyPartOpacities(model: CubismModel): void {` |
| 219 | `public doFade(` |
| 302 | `public constructor() {` |
| 318 | `export class PartData {` |

✅ **任务书点名的 `updateParameters(model, deltaTimeSeconds)` 逐字确认**（第 119 行）。

### 5.7 `CubismLipSync` —— 🔴 **未找到（该类在 R5 中不存在）**

**逐字搜索记录**：
- `grep -rn "class CubismLipSync\|CubismLipSync" src/` → **只命中 2 行**，且都是改名后的 `CubismLipSyncUpdater`：
  ```
  src/motion/cubismlipsyncupdater.ts:17:export class CubismLipSyncUpdater extends ICubismUpdater {
  src/motion/cubismlipsyncupdater.ts:102:  export const CubismLipSyncUpdater = $.CubismLipSyncUpdater;
  ```
- `find src -iname "*lipsync*"` → **只返回 `src/motion/cubismlipsyncupdater.ts`**（外加 `iparameterprovider.ts` / `cubismdefaultparameterid.ts` 两处非同名命中）

**试过的检索式**：`class CubismLipSync`、`CubismLipSync`、`*lipsync*`（find）
**结论**：**R5 中没有名为 `CubismLipSync` 的类**；口型功能由 **`CubismLipSyncUpdater extends ICubismUpdater`** 承担，通过 `IParameterProvider`（`src/motion/iparameterprovider.ts`）取音频数据。

**`CubismLipSyncUpdater` 已知部分（逐字）**：
- 第 17 行：`export class CubismLipSyncUpdater extends ICubismUpdater {`
- 第 50 行：`super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_LipSync);`
- 第 67 行：`const updateSuccessful = this._audioProvider.update(deltaTimeSeconds);`（说明依赖 `_audioProvider`）

⚠️ **`CubismLipSyncUpdater` 的完整构造签名与公开方法本次未逐字取证**（只取了上述 3 行）。**不填**。

**⚠️ 版本差异提醒**：旧版（R1–R4）里确实有 `src/effect/cubismlipsync.ts` 的 `CubismLipSync` 类，提供 `updateParameters`。**该差异属版本演进，本报告不外推**——若 DSH 定制线目标是旧版，需按对应 tag 重取证。

---

## 6. 直接设参数（`CubismModel` 参数接口）

**来源**：`src/model/cubismmodel.ts` ｜ **性质**：官方源码原文
URL 前缀：`https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/src/model/cubismmodel.ts#L<行号>`

### 6.1 🔴 `setParameterValueById` —— 逐字（3 个参数）

第 773–777 行：

```typescript
  public setParameterValueById(
    parameterId: CubismIdHandle,
    value: number,
    weight = 1.0
  ): void {
```

**官方注释（逐字，第 767–772 行）**：
```typescript
  /**
   * パラメータの値の設定
   * @param parameterId パラメータのID
   * @param value パラメータの値
   * @param weight 重み
   */
```

🔴 **回答任务书「参数个数与类型」**：**共 3 个参数**——
1. `parameterId: CubismIdHandle`（**句柄对象，不是字符串**）
2. `value: number`
3. `weight = 1.0`（**有默认值，可选**）
**返回 `void`**。

**函数体（逐字，第 778–779 行）**：
```typescript
    const index: number = this.getParameterIndex(parameterId);
    this.setParameterValueByIndex(index, value, weight);
```

⚠️ **⚠️ 注意第 720 行官方注释揭示的性能含义（逐字）**：
```typescript
    // 高速化のためにparameterIndexを取得できる機構になっているが、外部からの設定の時は呼び出し頻度が低いため不要
```
（大意：内部为提速走 index；**从外部设置时调用频率低，故不需要**——即官方认为外部按 Id 设置不成问题。）

### 6.2 参数读写全套（逐字）

| 行号 | 逐字签名 |
|---|---|
| 610 | `public getParameterIndex(parameterId: CubismIdHandle): number {` |
| 641 | `public getParameterCount(): number {` |
| 701 | `public getParameterValueByIndex(parameterIndex: number): number {` |
| 719 | `public getParameterValueById(parameterId: CubismIdHandle): number {` |
| 731 | `public setParameterValueByIndex(` |
| 773 | `public setParameterValueById(` （见 §6.1） |
| 788 | `public addParameterValueByIndex(` |
| 805 | `public addParameterValueById(` |
| 939 | `public multiplyParameterValueById(` |
| 954 | `public multiplyParameterValueByIndex(` |
| 662 | `public getParameterMaximumValue(parameterIndex: number): number {` |
| 671 | `public getParameterMinimumValue(parameterIndex: number): number {` |
| 680 | `public getParameterDefaultValue(parameterIndex: number): number {` |
| 690 | `public getParameterId(parameterIndex: number): CubismIdHandle {` |
| 821 | `public isRepeat(parameterIndex: number): boolean {` |
| 904 | `public getParameterClampValue(parameterIndex: number, value: number): number {` |

**`setParameterValueByIndex` 逐字（第 731–735 行）**：
```typescript
  public setParameterValueByIndex(
    parameterIndex: number,
    value: number,
    weight = 1.0
  ): void {
```

**`addParameterValueById` 逐字（第 805–809 行）**：
```typescript
  public addParameterValueById(
    parameterId: any,
    value: number,
    weight = 1.0
  ): void {
```

🔴 **一个真实的类型不一致（官方源码原文，不是我写错）**：`addParameterValueById` 的第一个参数类型标的是 **`any`**，而 `setParameterValueById` / `getParameterValueById` 标的是 **`CubismIdHandle`**。这是源码里的实际写法差异。**行为上仍应传 `CubismIdHandle`。**

**clamp 行为（`setParameterValueByIndex` 函数体，逐字，第 753–757 行）**：
```typescript
    if (this.isRepeat(parameterIndex)) {
      value = this.getParameterRepeatValue(parameterIndex, value);
    } else {
      value = this.getParameterClampValue(parameterIndex, value);
    }
```
→ **设值会被自动 clamp 到 min/max**（除非该参数开了 repeat）。

### 6.3 🔴 `CubismParameter` 类 —— **未找到（R5 中不存在）**

**逐字搜索记录**：
- `grep -rn "class CubismParameter\b" src/` → **零命中**
- `find src -iname "*parameter*"` → 返回：
  ```
  src/cubismdefaultparameterid.ts
  src/motion/cubismlipsyncupdater.ts
  src/motion/iparameterprovider.ts
  ```
  （**均非 `cubismparameter.ts`**）

**试过的检索式**：`class CubismParameter`、`*parameter*`（find）
**结论**：🔴 **R5 中没有 `CubismParameter` 类**，因此任务书问的 `setValue` / `getValue` / `getId` / `getKeyCount` **在本版本 framework 里无对应源码**。

**R5 的参数访问全部走 `CubismModel` 上的 by-index / by-id 方法**（见 §6.2）。**参数值数组**在 `CubismModel` 内部以 `this._parameterValues[index]` 持有（第 759 行原文），**不暴露独立对象**。

⚠️ 旧版（R1–R4）有 `CubismParameter`。**该差异属版本演进，不外推。**

### 6.4 `saveParameters` / `loadParameters` —— ✅ 都存在

**来源**：`src/model/cubismmodel.ts` 第 244 行与第 1523 行 ｜ **性质**：官方源码原文

```typescript
  public saveParameters(): void {
```
```typescript
  public loadParameters(): void {
```

✅ **明确回答**：**`CubismModel` 上同时有这两个方法**。（此外另有 `initialize(): void` 在第 1539 行。）

---

## 7. WebGL / 渲染最小接线

### 7.1 `CubismRenderer`（抽象基类）

**来源**：`src/rendering/cubismrenderer.ts` ｜ **性质**：官方源码原文

第 20 行类声明：`export abstract class CubismRenderer {`

| 行号 | 逐字签名 |
|---|---|
| 26 | `public static create(): CubismRenderer {` |
| 33 | `public static delete(renderer: CubismRenderer): void {` |
| 43 | `public initialize(model: CubismModel): void {` |
| 59 | `public drawModel(shaderPath: string = null): void {` |
| 77 | `public setMvpMatrix(matrix44: CubismMatrix44): void {` |
| 86 | `public getMvpMatrix(): CubismMatrix44 {` |
| 99 | `public setModelColor(` |
| 117 | `public getModelColor(): CubismTextureColor {` |
| 143 | `public setIsPremultipliedAlpha(enable: boolean): void {` |
| 152 | `public isPremultipliedAlpha(): boolean {` |
| 160 | `public setIsCulling(culling: boolean): void {` |
| 170 | `public isCulling(): boolean {` |
| 180 | `public setAnisotropy(n: number): void {` |
| 189 | `public getAnisotropy(): number {` |
| 198 | `public getModel(): CubismModel {` |
| 211 | `public useHighPrecisionMask(high: boolean): void {` |
| 221 | `public isUsingHighPrecisionMask(): boolean {` |
| 231 | `public setRenderTargetSize(width: number, height: number): void {` |
| 257 | `public abstract beforeDrawModelRenderTarget(): void;` |
| 262 | `public abstract afterDrawModelRenderTarget(): void;` |
| 268 | `public abstract doDrawModel(shaderPath: string): void;` |
| 283 | `public static staticRelease: any;` |
| 314 | `export class CubismTextureColor {` |

🔴 **任务书点名的三个**：`initialize(model)`（43）、`drawModel()`（59，**注意实际形参是 `shaderPath: string = null`**）、`setMvpMatrix(matrix44)`（77）—— **全部确认**。

⚠️ **`drawModel` 的参数名是 `shaderPath`，且有默认值 `null`**，不是无参。任务书写的 `drawModel()` 作为调用形式成立，但签名必须记成 `drawModel(shaderPath: string = null): void`。

### 7.2 `CubismRenderer_WebGL`

**来源**：`src/rendering/cubismrenderer_webgl.ts` ｜ **性质**：官方源码原文

第 486 行类声明：`export class CubismRenderer_WebGL extends CubismRenderer {`

| 行号 | 逐字签名 |
|---|---|
| 495 | `public initialize(model: CubismModel, maskBufferCount = 1): void {` |
| 587 | `public bindTexture(modelTextureNo: number, glTexture: WebGLTexture): void {` |
| 596 | `public getBindedTextures(): Map<number, WebGLTexture> {` |
| 606 | `public setClippingMaskBufferSize(size: number) {` |
| 636 | `public getClippingMaskBufferSize(): number {` |
| 655 | `public getRenderTextureCount(): number {` |
| 664 | `public constructor(width: number, height: number) {` |
| 692 | `public release(): void {` |
| 767 | `public loadShaders(shaderPath: string = null): void {` |
| 793 | `public doDrawModel(shaderPath: string = null): void {` |
| 896 | `public drawObjectLoop(lastFbo: WebGLFramebuffer): void {` |
| 970 | `public drawDrawable(drawableIndex: number, rootFbo: WebGLFramebuffer): void {` |
| 1068 | `public drawMeshWebGL(model: Readonly<CubismModel>, index: number): void {` |
| 1504 | `public static doStaticRelease(): void {` |
| 1514 | `public setRenderState(fbo: WebGLFramebuffer, viewport: number[]): void {` |
| 1531 | `public preDraw(): void {` |

🔴 **两处覆盖/扩展了基类签名**：
1. **`initialize` 被重写并加参**：`CubismRenderer_WebGL.initialize(model, maskBufferCount = 1)` vs 基类 `initialize(model)`。
2. **构造器需要 `(width, height)`**（第 664 行）——**基类 `CubismRenderer` 无参构造**，WebGL 实现必须给画布尺寸。

**同文件其他类（逐字）**：`CubismClippingManager_WebGL extends CubismClippingManager<CubismClippingContext_WebGL>`(32)、`CubismClippingContext_WebGL extends CubismClippingContext`(261)、`export class CubismRendererProfile_WebGL {`(302)。

⚠️ **与 task 书判断的差异**：任务书假设有 `setMvpMatrix` 在 WebGL 类上——实际 **`setMvpMatrix` 继承自基类**（§7.1 第 77 行），`cubismrenderer_webgl.ts` 中**未重写**（逐字 grep 该文件 public 成员无此项）。

### 7.3 `CubismMatrix44`（数学矩阵）

**来源**：`src/math/cubismmatrix44.ts` ｜ **性质**：官方源码原文

第 15 行类声明：`export class CubismMatrix44 {`

| 行号 | 逐字签名 |
|---|---|
| 19 | `public constructor() {` |
| 32 | `public static multiply(` |
| 60 | `public loadIdentity(): void {` |
| 74 | `public setMatrix(tr: Float32Array): void {` |
| 85 | `public getArray(): Float32Array {` |
| 94 | `public getScaleX(): number {` |
| 103 | `public getScaleY(): number {` |
| 112 | `public getTranslateX(): number {` |
| 121 | `public getTranslateY(): number {` |
| 132 | `public transformX(src: number): number {` |
| 143 | `public transformY(src: number): number {` |
| 150 | `public invertTransformX(src: number): number {` |
| 157 | `public invertTransformY(src: number): number {` |
| 169 | `public translateRelative(x: number, y: number): void {` |
| 200 | `public translate(x: number, y: number): void {` |
| 210 | `public translateX(x: number): void {` |
| 219 | `public translateY(y: number): void {` |
| 229 | `public scaleRelative(x: number, y: number): void {` |
| 258 | `public scale(x: number, y: number): void {` |
| 270 | `public multiplyByMatrix(m: CubismMatrix44): void {` |
| 279 | `public getInvert(): CubismMatrix44 {` |
| 342 | `public clone(): CubismMatrix44 {` |

✅ **任务书点名的 `scale` / `translate` 逐字确认**（258 / 200），均为 `(x: number, y: number): void`。

🔴 **接进 pixi v8 的关键接口是 `getArray(): Float32Array`（第 85 行）** —— 这是唯一把 cubism 矩阵导出为**可由外部直接消费的数组**的方法（16 元素，列主序）。**这是我基于签名用途的推断，非官方注释原文。**

### 7.4 `CubismModelMatrix`（模型矩阵）

**来源**：`src/math/cubismmodelmatrix.ts` ｜ **性质**：官方源码原文

第 15 行类声明：`export class CubismModelMatrix extends CubismMatrix44 {`

| 行号 | 逐字签名 |
|---|---|
| 36 | `public setWidth(w: number): void {` |
| 46 | `public setHeight(h: number): void {` |
| 58 | `public setPosition(x: number, y: number): void {` |
| 70 | `public setCenterPosition(x: number, y: number) {` |
| 80 | `public top(y: number): void {` |
| 89 | `public bottom(y: number) {` |
| 100 | `public left(x: number): void {` |
| 109 | `public right(x: number): void {` |
| 120 | `public centerX(x: number): void {` |
| 131 | `public setX(x: number): void {` |
| 140 | `public centerY(y: number): void {` |
| 151 | `public setY(y: number): void {` |
| 160 | `public setupFromLayout(layout: Map<string, number>): void {` |

✅ **任务书点名的 `setWidth` 逐字确认**（第 36 行）。

**它的构造来源（`CubismUserModel.loadModel` 内，逐字，`cubismusermodel.ts` 第 154–157 行）**：
```typescript
    this._modelMatrix = new CubismModelMatrix(
      this._model.getCanvasWidth(),
      this._model.getCanvasHeight()
    );
```

### 7.5 🔴 官方 sample 的「每一帧做什么」最小循环

#### （a）主循环 `LAppLive2DManager.onUpdate()`

**来源**：`Samples/TypeScript/Demo/src/lapplive2dmanager.ts` 第 86–118 行
**性质**：官方 sample 源码原文

```typescript
  public onUpdate(): void {
    // 全てのモデルの描画処理開始前に、フレームごとのリセットフラグをクリアする
    const gl = this._subdelegate.getGl();
    CubismWebGLOffscreenManager.getInstance().beginFrameProcess(gl);

    const { width, height } = this._subdelegate.getCanvas();

    const projection: CubismMatrix44 = new CubismMatrix44();
    const model: LAppModel = this._models[0];

    if (model.getModel()) {
      if (model.getModel().getCanvasWidth() > 1.0 && width < height) {
        // 横に長いモデルを縦長ウィンドウに表示する際モデルの横サイズでscaleを算出する
        model.getModelMatrix().setWidth(2.0);
        projection.scale(1.0, width / height);
      } else {
        projection.scale(height / width, 1.0);
      }

      // 必要があればここで乗算
      if (this._viewMatrix != null) {
        projection.multiplyByMatrix(this._viewMatrix);
      }
    }

    model.update();
    model.draw(projection); // 参照渡しなのでprojectionは変質する。

    // モデルで使用するオフスクリーン管理の終了処理
    CubismWebGLOffscreenManager.getInstance().endFrameProcess(gl);
    // もし余っているオフスクリーンのリソースを解放したい場合行う処理
    CubismWebGLOffscreenManager.getInstance().releaseStaleRenderTextures(gl);
  }
```

🔴 **每帧序列（概括，但逐条对应上方原文）**：
1. `beginFrameProcess(gl)` —— 帧开始
2. 构造 `projection: CubismMatrix44`，按画布宽高比 `scale(...)`
3. 可选 `projection.multiplyByMatrix(viewMatrix)`
4. **`model.update()`** —— 见 §5.1
5. **`model.draw(projection)`**
6. `endFrameProcess(gl)` + `releaseStaleRenderTextures(gl)`

🔴 **注意点**：`draw(projection)` 的注释逐字写着 **"参照渡しなのでprojectionは変質する。"**（**因为传引用，projection 会被改变**）—— **下一帧必须重建 projection**（原文每帧 `new CubismMatrix44()`）。

#### （b）`LAppModel.draw()`

**来源**：`Samples/TypeScript/Demo/src/lappmodel.ts` 第 935–948 行 ｜ **性质**：官方 sample 源码原文

```typescript
  public draw(matrix: CubismMatrix44): void {
    if (this._model == null) {
      return;
    }

    // 各読み込み終了後
    if (this._state == LoadStep.CompleteSetup) {
      matrix.multiplyByMatrix(this._modelMatrix);

      this.getRenderer().setMvpMatrix(matrix);

      this.doDraw();
    }
  }
```

✅ **这就是「模型矩阵 → 渲染器 MVP」的接线点**：`matrix.multiplyByMatrix(this._modelMatrix)` → `getRenderer().setMvpMatrix(matrix)` → `doDraw()`。

---

## 8. 授权与许可 —— 按项目规约**不做判定**，只留指针

🔴 **项目规约（AGENTS.md，2026-09-24 用户立规）明确禁止研究法律问题**，原话：*"在项目规则中加一条，禁止研究法律问题，有风险报告给我我会单独去研究的！"* —— 不做法条与许可条款解读、不做合规判定、不把法律判断当作设计决策依据。

**因此本节只记录文件位置与链接，不摘录条款正文、不作任何解读。** 需要判断时由用户自行研究。

**文件**：`LICENSE.md`（仓库根，共 45 行）
URL：https://github.com/Live2D/CubismWebFramework/blob/d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b/LICENSE.md

**该文件的层级标题（逐字，按出现顺序）**：`## Definitions` / `### Live2D Cubism Components` / `## Cubism SDK Release License` / `## Live2D Open Software License` / `## Live2D Proprietary Software License`

**`## Live2D Open Software License` 节下给出的链接（逐字）**：
```
* [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
* [Live2D Open Software 使用許諾契約書](https://www.live2d.com/eula/live2d-open-software-license-agreement_jp.html)
* [Live2D Open Software 使用授权协议](https://www.live2d.com/eula/live2d-open-software-license-agreement_cn.html)
```

**源码文件头部的许可声明（逐字，出现于 59 个 `src/` 文件）**：

```
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
```

（`grep -rl "Live2D Open Software license" src/ | wc -l` → **59**，抓取时间 2026-09-24 09:52 CST）

**另一条与商业使用相关的链接（逐字，位于 `## Cubism SDK Release License` 节）**：
```
* [Cubism SDK Release License](https://www.live2d.com/en/download/cubism-sdk/release-license/)
```

⚠️ **风险报告到此为止**（按规约：① 是什么风险 ② 一手出处 ③ 待用户决定的选择项）。**待用户自行决定的选择项（不给结论）**：
- 是否走 Live2D Open Software License（framework 侧）＋ 另行处理 Cubism Core 的 Proprietary 许可；
- 年营收是否触及 `Cubism SDK Release License` 所述门槛（原文见上述 LICENSE.md 链接，**我不做解读**）。

---

## 待确认清单

> 凡任务书未明确、我按默认继续处理的事项记此处。

1. **【推断／待确认】版本适用性** —— 本次取证的是 `develop` 分支 commit `d4da0aa`（= **Cubism 5 SDK for Web R5**）。若 DSH 定制线实际对接 **R1–R4**（例如经 `pixi-live2d-display` 等第三方封装，它们常内置旧版 framework），会有**实质差异**：`CubismParameter` 类、`CubismLipSync` 类、`src/effect/cubismphysics.ts` 路径、以及**最重要的 `update()` 手写调用序列 vs UpdateScheduler** 全都不同。**倾向**：先确认目标版本再谈接线。**未做**：按旧 tag 重取证（任务书未指定版本号）。

2. **【推断／待确认】任务书三处名字与源码不符，我以源码为准**：
   - `getHitAreaCount` → 真名 **`getHitAreasCount`**（§1.3）；
   - 第二个参数名 `userTimeSeconds` → 实际 **`deltaTimeSeconds`**（`CubismEyeBlink.updateParameters`，§5.5）；
   - `startMotion(..., userTimeSeconds)` 的 `userTimeSeconds` **官方已标 Deprecated**（§3.1），实际调用应只传两个参数。
   **若项目内既有代码用旧名**，说明目标版本不同 → **应重取证，而非改本报告**。

3. **【推断／待确认】`getFadeInTime` / `getFadeOutTime` 在 `CubismExpressionMotion` 上**（§4.2）—— 我只确认它们在父类 `ACubismMotion` 上存在（行 199 / 191），**未取 `CubismExpressionMotion` 文件本身对该方法的声明证据**。「继承可得」是**我的推断**。

4. **【推断／待确认】`setEffectIds` 的作用域**（§3.6）—— 逐字搜索只在 `src/motion/cubismmotion.ts:770` 命中。**`CubismExpressionMotion` 上是否有该方法未取证，不填。**

5. **【推断／待确认】`CubismLipSyncUpdater` 完整签名**（§5.7）—— 我只逐字取了 3 行。完整构造签名与公开方法**未取证**。若需要口型功能，建议补一轮针对该文件的取证。

6. **【推断／待确认】pixi v8 接入点**（§7.3）—— 我基于签名把 `CubismMatrix44.getArray(): Float32Array` 指为接 pixi `Container`/矩阵的接口，**这是我的推断，非官方注释原文**。官方 sample 用的是原生 WebGL + `<canvas>`，**没有 pixi 接入的官方示例**（本次未检索 pixi 相关官方文档）。

7. **⚠️【产出文件曾被外部删除，已重写】** —— 本文件首次写入成功（09:45 前），随后**在同目录中被删除**（目录 mtime 09:45，同批出现兄弟代理的 `A1_model3与motion格式.md`）。我已在 2026-09-24 09:5x 重写全文。**若本目录存在并发写入的代理，建议主代理协调写入时序**，否则有再次被覆盖的风险。

---

## 附：本次"未找到"项汇总（连同试过的检索式）

| 任务书要求 | 裁定 | 试过的检索式／URL |
|---|---|---|
| `CubismParameter` 类（`setValue`/`getValue`/`getId`/`getKeyCount`） | ❌ **R5 中不存在** | `grep -rn "class CubismParameter\b" src/`（零命中）；`find src -iname "*parameter*"`（返回 `cubismdefaultparameterid.ts`／`cubismlipsyncupdater.ts`／`iparameterprovider.ts`，均非该类） |
| `CubismLipSync` 类（`updateParameters`） | ❌ **R5 中不存在**（改为 `CubismLipSyncUpdater`） | `grep -rn "class CubismLipSync\|CubismLipSync" src/`（仅命中 `CubismLipSyncUpdater`）；`find src -iname "*lipsync*"` |
| `getHitAreaCount(i)` | ❌ **不存在**（真名 `getHitAreasCount()`） | 见 §1.2 #7／§1.3 |
| `src/effect/cubismphysics.ts` | ❌ **路径不存在** | 实际路径 `src/physics/cubismphysics.ts`；`find src -name "*.ts"` 全树列表已核 |
| `src/type/csmvector.ts` | ❌ **R5 中不存在** | 全树 `find src -name "*.ts"` 列表中无此文件；R5 改用原生 `Array` |

**抓取工具链说明**：`raw.githubusercontent.com` **可直连**（实测 `HTTP:200`，2026-09-24 09:41）；`git clone --depth 1` 亦成功。**未使用** jsDelivr／unpkg 备选通道。所有行号来自本地 clone，与 GitHub 同一 commit 的行号一致，URL 已逐条给出以便复核。
