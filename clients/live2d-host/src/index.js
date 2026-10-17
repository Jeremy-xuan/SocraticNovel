/**
 * index.js —— 打包入口：把「渲染宿主 + 能力发现 + 两个 provider」一起暴露出去。
 *
 * 上层（含未来的 DSH 客户端插件）只需要：
 *   import { Live2DHost, renderFirstFrame, parseCapability, TextRhythmProvider, WriteChannelProvider } from '.../live2d-host.bundle.mjs'
 */

export {
  Live2DHost,
  renderFirstFrame,
  initCubismFramework
} from './host.js';

export {
  parseCapability,
  resolveMouthParameter,
  resolveEyeBlinkParameters,
  discoverFromDir,
  KNOWN_MOUTH_PARAM_STYLES,
  LIPSYNC_SOURCE
} from './capability.js';

export {
  TextRhythmProvider,
  WriteChannelProvider,
  createProvider,
  DEFAULT_RHYTHM_CONFIG
} from './text-rhythm-provider.js';

export {
  IdleDirector,
  DEFAULT_IDLE_CONFIG,
  makeRng
} from './idle-director.js';
