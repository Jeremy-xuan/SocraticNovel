/**
 * framework-entry.js —— 官方 Cubism Web Framework 的「出口清单」
 *
 * 作用：官方仓库 `src/` 内部全部用相对路径 import，外部示例用 `@framework/*` 别名。
 * 这个文件把我们需要用到的类**显式列一遍**，交给 esbuild 打包成单文件 ESM。
 * 好处：宿主（含未来的 DSH 客户端插件）只需要 import 一个 bundle，
 *       不需要知道官方框架的内部目录结构。
 *
 * 出处：Live2D/CubismWebFramework @ d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b
 * 许可：Live2D Open Software License Agreement（见 vendor/CubismWebFramework/LICENSE.md）
 */

// --- 框架启动 / 日志 ---
export { CubismFramework, Option, LogLevel } from '@framework/live2dcubismframework';
export { CubismLogError, CubismLogInfo, CubismLogWarning } from '@framework/utils/cubismdebug';

// --- 模型装载 ---
export { CubismMoc } from '@framework/model/cubismmoc';
export { CubismModel } from '@framework/model/cubismmodel';
export { CubismUserModel } from '@framework/model/cubismusermodel';
export { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
export { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
export { CubismId } from '@framework/id/cubismid';
export { CubismModelUserData } from '@framework/model/cubismmodeluserdata';

// --- 数学 / 矩阵 ---
export { CubismMatrix44 } from '@framework/math/cubismmatrix44';
export { CubismModelMatrix } from '@framework/math/cubismmodelmatrix';
export { CubismViewMatrix } from '@framework/math/cubismviewmatrix';

// --- 渲染 ---
export { CubismRenderer_WebGL } from '@framework/rendering/cubismrenderer_webgl';
export { CubismShaderManager_WebGL } from '@framework/rendering/cubismshader_webgl';

// --- 动作 / 表情 / 效果 ---
export { CubismMotion } from '@framework/motion/cubismmotion';
export { CubismMotionManager } from '@framework/motion/cubismmotionmanager';
export { InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';
export { CubismExpressionMotion } from '@framework/motion/cubismexpressionmotion';
export { CubismExpressionMotionManager } from '@framework/motion/cubismexpressionmotionmanager';
export { CubismUpdateScheduler } from '@framework/motion/cubismupdatescheduler';
export { CubismUpdateOrder } from '@framework/motion/icubismupdater';
export { IParameterProvider } from '@framework/motion/iparameterprovider';
export { CubismLipSyncUpdater } from '@framework/motion/cubismlipsyncupdater';
export { CubismBreathUpdater } from '@framework/motion/cubismbreathupdater';
export { CubismEyeBlinkUpdater } from '@framework/motion/cubismeyeblinkupdater';
export { CubismExpressionUpdater } from '@framework/motion/cubismexpressionupdater';
export { CubismLookUpdater } from '@framework/motion/cubismlookupdater';
export { CubismPhysicsUpdater } from '@framework/motion/cubismphysicsupdater';
export { CubismPoseUpdater } from '@framework/motion/cubismposeupdater';
export { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
export { CubismBreath, BreathParameterData } from '@framework/effect/cubismbreath';
export { CubismPose } from '@framework/effect/cubismpose';
export { CubismLook, LookParameterData } from '@framework/effect/cubismlook';
export { CubismPhysics } from '@framework/physics/cubismphysics';
