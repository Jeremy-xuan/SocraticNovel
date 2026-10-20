/**
 * claude-mermaid-theme.mjs —— 一套可整段抄走的 mermaid 11.x 主题配置
 *
 * 用途：把 mermaid 默认外观换成「克劳德那种」的观感（暖象牙底、发丝线描边、
 *       低饱和配色、大圆角、无投影、字重一致）。
 *
 * ⚠️ 事实边界（不许含糊）：
 *   · 本文件里的**具体色值/圆角/字号是我按 Claude 界面观感定的**，
 *     证据是 Anthropic 官方博客截图（暖米底 + 极低饱和色块 + 发丝描边 + 大圆角 + 无投影），
 *     见 out/evidence-claude-blog/。**没有任何一手证据表明 Anthropic 的 mermaid 渲染器
 *     用了这组色值**——公开资料里找不到 Claude 的 mermaid 主题配置（见报告 §1）。
 *     所以：**配色＝外观证据 + 我的设计推断，不是"Claude 就是这么实现的"。**
 *   · 变量名全部**对着我们仓库里那份 mermaid 11.17.2 产物逐个核过**
 *     （`vendor/mermaid-11.17.2/mermaid.min.js`，sha256 581ed7d7…90eb8），
 *     不是照文档抄的。核过的变量清单见 README §3。
 *
 * 版本：只对 mermaid 11.17.2 验证过。换版本＝重新验证，不得外推。
 */

/** 暖色浅色系（默认） */
export const CLAUDE_LIGHT = {
  darkMode: false,

  // —— 画布与字体 ——
  background: '#FAF9F5',
  fontFamily:
    '"Styrene B", "Styrene A", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  fontSize: '15px',

  // —— 节点 ——
  primaryColor: '#FFFFFF',
  primaryTextColor: '#3D3D3A',
  primaryBorderColor: '#D9D4C8',
  mainBkg: '#FFFFFF',
  nodeBorder: '#D9D4C8',
  nodeTextColor: '#3D3D3A',
  secondaryColor: '#F5F4EF',
  tertiaryColor: '#F0EEE6',

  // —— 连线与文字 ——
  lineColor: '#B9B4A9',
  textColor: '#3D3D3A',
  titleColor: '#3D3D3A',
  edgeLabelBackground: '#FAF9F5',
  defaultLinkColor: '#B9B4A9',

  // —— 子图（subgraph）——
  clusterBkg: '#F5F4EF',
  clusterBorder: '#E3DFD4',

  // —— 时序图 ——
  actorBkg: '#FFFFFF',
  actorBorder: '#D9D4C8',
  actorTextColor: '#3D3D3A',
  actorLineColor: '#D9D4C8',
  signalColor: '#3D3D3A',
  signalTextColor: '#3D3D3A',
  labelBoxBkgColor: '#F5F4EF',
  labelBoxBorderColor: '#D9D4C8',
  labelTextColor: '#3D3D3A',
  loopTextColor: '#6B6862',
  noteBkgColor: '#F7F1E4',
  noteTextColor: '#3D3D3A',
  noteBorderColor: '#E4D9BF',
  activationBkgColor: '#EFE9DC',
  activationBorderColor: '#D9D4C8',
  sequenceNumberColor: '#FFFFFF',

  // —— 类图 ——
  classText: '#3D3D3A',

  // —— 状态图 ——
  stateBkg: '#FFFFFF',
  stateBorder: '#D9D4C8',
  labelBackgroundColor: '#FAF9F5',
  compositeBackground: '#F5F4EF',
  compositeBorder: '#E3DFD4',
  transitionColor: '#B9B4A9',
  transitionLabelColor: '#6B6862',

  // —— ER 图 ——
  attributeBackgroundColorOdd: '#FFFFFF',
  attributeBackgroundColorEven: '#F5F4EF',

  // —— 饼图 / 甘特 ——
  pie1: '#D97757',
  pie2: '#C7B9A1',
  pie3: '#8FA08C',
  pie4: '#B6A8C9',
  pie5: '#D9C27A',
  pie6: '#9BB0C4',
  pie7: '#C99A9A',
  pie8: '#A9B6A0',
  pieTitleTextColor: '#3D3D3A',
  pieSectionTextColor: '#3D3D3A',
  pieLegendTextColor: '#6B6862',
  pieStrokeColor: '#FAF9F5',
  pieOuterStrokeColor: '#E3DFD4',
  sectionBkgColor: '#F5F4EF',
  altSectionBkgColor: '#FFFFFF',
  sectionBkgColor2: '#F0EEE6',
  taskBkgColor: '#E3DFD4',
  taskTextColor: '#3D3D3A',
  taskTextOutsideColor: '#6B6862',
  taskTextLightColor: '#3D3D3A',
  taskBorderColor: '#D9D4C8',
  activeTaskBkgColor: '#D97757',
  activeTaskBorderColor: '#C96447',
  doneTaskBkgColor: '#EDEAE3',
  doneTaskBorderColor: '#D9D4C8',
  gridColor: '#E9E6DE',
  todayLineColor: '#D97757',

  // —— 其它 ——
  errorBkgColor: '#F7F1E4',
  errorTextColor: '#3D3D3A',
  radius: 8,
  strokeWidth: 1,
  useGradient: false,
  dropShadow: 'none',
};

/** 暖色深色系（对应 Claude 深色界面：近黑 + 暖灰字，不发蓝） */
export const CLAUDE_DARK = {
  ...CLAUDE_LIGHT,
  darkMode: true,
  background: '#262624',
  primaryColor: '#30302E',
  primaryTextColor: '#F0EEE6',
  primaryBorderColor: '#45443F',
  mainBkg: '#30302E',
  nodeBorder: '#45443F',
  nodeTextColor: '#F0EEE6',
  secondaryColor: '#333330',
  tertiaryColor: '#3A3A36',
  lineColor: '#6E6C66',
  textColor: '#F0EEE6',
  titleColor: '#F0EEE6',
  edgeLabelBackground: '#262624',
  defaultLinkColor: '#6E6C66',
  clusterBkg: '#2E2E2B',
  clusterBorder: '#45443F',
  actorBkg: '#30302E',
  actorBorder: '#45443F',
  actorTextColor: '#F0EEE6',
  actorLineColor: '#45443F',
  signalColor: '#F0EEE6',
  signalTextColor: '#F0EEE6',
  labelBoxBkgColor: '#333330',
  labelBoxBorderColor: '#45443F',
  labelTextColor: '#F0EEE6',
  loopTextColor: '#B8B4AB',
  noteBkgColor: '#3A3630',
  noteTextColor: '#F0EEE6',
  noteBorderColor: '#4E4839',
  activationBkgColor: '#3A3A36',
  activationBorderColor: '#45443F',
  classText: '#F0EEE6',
  stateBkg: '#30302E',
  stateBorder: '#45443F',
  labelBackgroundColor: '#262624',
  compositeBackground: '#2E2E2B',
  compositeBorder: '#45443F',
  transitionColor: '#6E6C66',
  transitionLabelColor: '#B8B4AB',
  attributeBackgroundColorOdd: '#30302E',
  attributeBackgroundColorEven: '#333330',
  pieStrokeColor: '#262624',
  pieOuterStrokeColor: '#45443F',
  sectionBkgColor: '#333330',
  altSectionBkgColor: '#262624',
  sectionBkgColor2: '#3A3A36',
  taskBkgColor: '#45443F',
  taskTextColor: '#F0EEE6',
  taskTextOutsideColor: '#B8B4AB',
  taskTextLightColor: '#F0EEE6',
  taskBorderColor: '#45443F',
  doneTaskBkgColor: '#3A3A36',
  doneTaskBorderColor: '#45443F',
  gridColor: '#3A3A36',
  errorBkgColor: '#3A3630',
  errorTextColor: '#F0EEE6',
};

/**
 * 主题 CSS —— 整段注入 mermaid 的 `themeCSS`。
 * 只做「默认主题做不到的静态修饰」；动画不在这里（见 claude-mermaid-anim.mjs）。
 */
export const CLAUDE_THEME_CSS = `
  /* 画布：去掉默认投影，统一字重 */
  & .node rect, & .node circle, & .node ellipse, & .node polygon, & .node path {
    stroke-width: 1px;
    filter: none;
    rx: 8px;
    ry: 8px;
  }
  & .label, & .nodeLabel, & .edgeLabel, & text {
    font-weight: 400;
    letter-spacing: 0.005em;
  }

  /* 节点内边距：默认偏挤，撑开一点（mermaid 的 label-container 是 rect） */
  & .node .label-container { padding: 2px; }

  /* 连线：发丝、圆头、低对比 */
  & .edgePaths path, & .flowchart-link, & .messageLine0, & .messageLine1, & .transition {
    stroke-width: 1.1px;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  & marker path, & .arrowheadPath { fill: #B9B4A9; stroke: none; }

  /* 边标签：给一点底色留白，别压在线上 */
  & .edgeLabel rect, & .edgeLabel foreignObject > div {
    background: #FAF9F5;
    border-radius: 5px;
  }
  & .edgeLabel foreignObject > div {
    padding: 1px 6px !important;
    color: #6B6862 !important;
    font-size: 13px;
  }

  /* 子图标题：小、灰、不抢戏 */
  & .cluster-label .nodeLabel, & .cluster text {
    fill: #8A8781;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  & .cluster rect { rx: 10px; ry: 10px; stroke-dasharray: none; }

  /* 时序图：生命线细虚线，参与者盒子大圆角 */
  & .actor-line { stroke-width: 1px; stroke-dasharray: 3 4; }
  & rect.actor { rx: 8px; ry: 8px; }
  & .note { rx: 8px; ry: 8px; }
  & .loopLine { stroke-dasharray: 3 4; }

  /* 状态图：圆角 + 起止点的软边 */
  & .stateGroup rect, & .stateGroup .state-title { rx: 8px; }
  & .statediagram-cluster rect { rx: 10px; ry: 10px; }

  /* 类图 / ER：表头浅底，行分隔发丝 */
  & .classGroup rect { rx: 8px; ry: 8px; }
  & .classGroup .divider { stroke: #EDEAE3; }
  & .er.entityBox { rx: 8px; ry: 8px; }
  & .er.attributeBoxOdd, & .er.attributeBoxEven { stroke: #EDEAE3; }

  /* 去掉 mermaid 默认给节点加的投影类 */
  & .drop-shadow, & .node .drop-shadow { filter: none; }
`;

/**
 * 生成一份可以直接交给 `mermaid.initialize()` 的配置。
 * @param {{dark?: boolean, themeCSS?: string}} [opts]
 */
export function claudeMermaidConfig(opts = {}) {
  const dark = !!opts.dark;
  return {
    startOnLoad: false,
    securityLevel: 'loose',
    // 关掉默认的 htmlLabels 之外的一切噪音
    theme: 'base', // ← 必须 base：只有 base 主题会完整吃 themeVariables
    themeVariables: dark ? { ...CLAUDE_DARK } : { ...CLAUDE_LIGHT },
    themeCSS: CLAUDE_THEME_CSS + (opts.themeCSS || ''),
    flowchart: {
      curve: 'basis', // 圆角折线，比默认 linear 柔和
      padding: 14,
      nodeSpacing: 44,
      rankSpacing: 52,
      useMaxWidth: true,
      htmlLabels: true,
    },
    sequence: {
      actorMargin: 56,
      boxMargin: 12,
      messageMargin: 38,
      mirrorActors: false,
      useMaxWidth: true,
    },
    state: { useMaxWidth: true },
    class: { useMaxWidth: true },
    er: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    pie: { useMaxWidth: true },
  };
}
