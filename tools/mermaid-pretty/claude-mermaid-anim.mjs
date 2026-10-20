/**
 * claude-mermaid-anim.mjs —— 「克劳德那种一个节点一个节点长出来」的三种实现
 *
 * 零依赖。只操作 mermaid 渲染出来的 SVG DOM。
 * 只对 mermaid 11.17.2 的 DOM 结构验证过。
 *
 * 三档（对应报告里的候选 A / B / C）：
 *   'none'   —— 候选 A：不装动画，只换主题（静态更好看）
 *   'stagger'—— 候选 B：渲染是瞬时的，渲染完成后按「层」逐层出现、连线再画出来
 *   'stream' —— 候选 C：按源码增量重渲染，视觉上「边写边长」
 *
 * ── 为什么「分层」不靠解析源码 ────────────────────────────────
 * 层号直接从**渲染结果里元素的实际位置**推出来：
 *   · 先量整张 SVG 的 bbox 定主轴（TD/BT 用 y，LR/RL 用 x，其它图一律 y）
 *   · 把每个元素按主轴位置装桶（容差 = 半个节点高度量级）
 *   · 桶按位置排序 → 桶序号就是层号
 * 这样对 flowchart / state / class / er / sequence / gantt 一律通用，
 * 不需要为每种图写一个语法解析器，也不会因为源码写法怪而失效。
 * （同类做法见 neolivz/animated-mermaid-diagrams：state 图用 BFS 层序；
 *   我们换成几何分层，省掉解析器且跨图型通用。）
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 会被「当作一个整体」逐层出现的元素。
 * 🔴 不要放 `g.label`：mermaid 11 里节点内部和边标签内部都有 `g.label`，
 *    收进来会把单元数算成两倍（实测：20 节点的图会数出 44 个单元）。
 */
const UNIT_SELECTORS = [
  'g.node',            // flowchart / state / class
  'g.cluster',         // flowchart subgraph
  'g.statediagram-cluster',
  'g.classGroup',
  'g.er.entityBox',
  'g.actor',           // sequence 参与者（有的版本是包一层的 g.actor）
  'rect.actor',        // sequence 参与者盒子（11.17.2 实测是顶层 rect.actor）
  'text.actor',        // 参与者名字，和盒子同 x → 同层
  'g.note',
  'rect.note',
  'text.noteText',
  'g.task',            // gantt
  'g.section',
  'g.stateGroup',
  'g.mindmap-node',
  'g.pieCircle',
  'g.commit',
];

/**
 * 会被「画出来」的连线。
 * 🔴 时序图的消息线在 11.17.2 里是 `<line class="messageLine0">`，不是 `<path>`。
 * 🔴 生命线 `line.actor-line` 不在此列：它纵贯整张图，按 y 分层会算错，
 *    让它保持常显（结构线，不动反而干净）。
 */
const EDGE_SELECTORS = [
  'path.flowchart-link',
  'path.transition',
  'path.relation',
  'line.messageLine0',
  'line.messageLine1',
  'path.messageLine0',
  'path.messageLine1',
  'path.er.relationshipLine',
  'path.section-edge',
  '.edgePaths path',
  'path.edge-thickness-normal',
  'path.edge-thickness-thick',
  'path.edge-thickness-invisible',
];

/** 边上的文字标签 */
const EDGE_LABEL_SELECTORS = [
  'g.edgeLabel',
  'g.edgeLabels > g',
  'text.edgeLabel',
  'text.messageText',
];

function q(root, sels) {
  const out = [];
  const seen = new Set();
  for (const s of sels) {
    for (const el of root.querySelectorAll(s)) {
      if (seen.has(el)) continue;
      // 已经被更外层单元收走的后代，不重复收
      if (out.some((p) => p.contains(el))) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

/** 元素在 SVG 用户坐标系里的中心点 */
function centerOf(el) {
  try {
    const b = el.getBBox();
    if (b.width === 0 && b.height === 0) return null;
    // 把 getBBox（元素自身坐标系）通过 CTM 映射到 SVG 用户坐标系
    const svg = el.ownerSVGElement;
    const ctm = el.getCTM();
    if (!svg || !ctm) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const pt = svg.createSVGPoint();
    pt.x = b.x + b.width / 2;
    pt.y = b.y + b.height / 2;
    const p = pt.matrixTransform(ctm);
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

/** 整张图的主轴：flowchart 按长宽比判方向，其它图一律纵向（自上而下读） */
function pickAxis(svg, kind) {
  const isFlow = /^(flowchart|graph)/i.test(kind || '');
  if (!isFlow) return 'y';
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = (vb && vb.width) || svg.clientWidth || 1;
  const h = (vb && vb.height) || svg.clientHeight || 1;
  return h >= w ? 'y' : 'x';
}

/**
 * 按主轴位置把元素装桶分层。
 * @returns {{el: Element, layer: number, pos: number}[]}
 */
function layerize(els, axis, tolerance = 18) {
  const items = [];
  for (const el of els) {
    const c = centerOf(el);
    if (!c) continue;
    items.push({ el, pos: axis === 'x' ? c.x : c.y });
  }
  items.sort((a, b) => a.pos - b.pos);
  let layer = -1;
  let last = -Infinity;
  for (const it of items) {
    if (it.pos - last > tolerance) {
      layer += 1;
      last = it.pos;
    }
    it.layer = layer;
  }
  return items;
}

/**
 * 候选 B：渲染完成后逐层出现 + 连线生长。
 *
 * @param {SVGElement} svg    mermaid.render 出来的 <svg>
 * @param {object} [opts]
 * @param {string} [opts.kind]       图类型（源码首行关键字，用于判主轴）
 * @param {number} [opts.layerDelay] 层间隔 ms
 * @param {number} [opts.enterDur]   单个元素进场时长 ms
 * @param {number} [opts.edgeDur]    单条连线画出的时长 ms
 * @param {number} [opts.edgeDelay]  连线相对目标层再延后多少 ms
 * @param {boolean}[opts.edgeDraw]   连线是否用「画出」而不是淡入
 * @param {number} [opts.maxTotal]   整段动画的时长上限 ms（默认 2600）
 * @param {number} [opts.maxSteps]   把层合并成至多多少步（默认 26）
 * @returns {{total:number, play:()=>Promise<void>, finish:()=>void, cancel:()=>void}}
 */
export function animateStagger(svg, opts = {}) {
  const {
    kind = '',
    layerDelay: layerDelayIn = 130,
    enterDur = 460,
    edgeDur = 340,
    edgeDelay = 120,
    edgeDraw = true,
    maxTotal = 2600,
  } = opts;

  const axis = pickAxis(svg, kind);
  const units = q(svg, UNIT_SELECTORS);
  const edges = q(svg, EDGE_SELECTORS);
  const edgeLabels = q(svg, EDGE_LABEL_SELECTORS);

  const unitLayers = layerize(units, axis);
  const edgeLayers = layerize(edges, axis);

  const rawMaxLayer = Math.max(
    0,
    ...unitLayers.map((u) => u.layer),
    ...edgeLayers.map((e) => e.layer),
  );

  /*
   * 🔴 层间延迟必须「按总时长封顶」自适应压缩，而且必须真的封得住。
   *
   * 实测（160 节点链式流程图 N0→N1→…→N159）：
   *   · 层数 ≈ 节点数（211 层），固定 130ms/层 → 整段 ≈ 27 秒，用户早划走了；
   *   · 只压 layerDelay 不够：压到下限 24ms 时 211 层仍要 5.96 秒 —— 下限把预算捅穿了。
   *
   * 所以两步一起做：
   *   ① 把层**合并成至多 maxSteps 步**（长图里相邻几层并成一步）；
   *   ② 再把步间隔压进 maxTotal 预算。
   * 这样无论图多长，整段动画都落在 maxTotal 附近。
   */
  const maxSteps = Math.max(2, opts.maxSteps || 26);
  const layerCount = rawMaxLayer + 1;
  const group = Math.max(1, Math.ceil(layerCount / maxSteps));
  for (const list of [unitLayers, edgeLayers]) {
    for (const it of list) it.layer = Math.floor(it.layer / group);
  }
  const maxLayer = Math.max(0, ...unitLayers.map((u) => u.layer), ...edgeLayers.map((e) => e.layer));
  const stepCount = maxLayer + 1;

  const budget = Math.max(600, maxTotal - edgeDelay - edgeDur - enterDur);
  const layerDelay = Math.min(layerDelayIn, Math.max(24, budget / Math.max(1, stepCount - 1)));

  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = `
    .cma-hidden { opacity: 0; }
    /*
     * 🔴 关键：进场只许用「独立变换属性」translate / scale，
     *    绝不能用 transform。
     *    原因：mermaid 把节点位置写成 <g class="node" transform="translate(x,y)">，
     *    而 CSS 的 transform 属性**会整体覆盖**这个呈现属性 → 节点在动画期间
     *    全部跳到画布原点（实测踩到过，图会散架）。
     *    translate/scale/rotate 是独立属性，按规范排在 transform 之后复合，
     *    因此能叠在原有的 translate(x,y) 上，位置不丢。
     */
    .cma-enter {
      transform-box: fill-box;
      transform-origin: center;
      animation: cma-enter ${enterDur}ms cubic-bezier(.22,.9,.24,1) both;
    }
    @keyframes cma-enter {
      from { opacity: 0; translate: 0 5px; scale: .985; }
      to   { opacity: 1; translate: 0 0;   scale: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .cma-enter { animation: none; opacity: 1; }
      .cma-draw  { transition: none !important; stroke-dashoffset: 0 !important; }
    }
  `;
  svg.appendChild(style);

  // ── 节点：先藏起来，等轮到它再进场 ──
  for (const { el, layer } of unitLayers) {
    el.classList.add('cma-hidden');
    el.dataset.cmaDelay = String(layer * layerDelay);
  }

  // ── 连线：能「画出」的用 dashoffset，虚线（本身就是 dasharray）的退回淡入 ──
  const draws = [];
  for (const { el, layer } of edgeLayers) {
    el.classList.add('cma-hidden');
    const delay = layer * layerDelay + edgeDelay;
    el.dataset.cmaDelay = String(delay);
    if (!edgeDraw) continue;
    let len = 0;
    try {
      len = el.getTotalLength();
    } catch {
      len = 0;
    }
    if (!len || len < 4) continue;
    const cs = getComputedStyle(el);
    const isDashed = cs.strokeDasharray && cs.strokeDasharray !== 'none';
    if (isDashed) continue; // 本身是虚线（如时序图回信）→ 保持虚线，只淡入
    el.style.strokeDasharray = String(len);
    el.style.strokeDashoffset = String(len);
    el.style.transition = `stroke-dashoffset ${edgeDur}ms cubic-bezier(.3,.7,.3,1)`;
    draws.push({ el, len });
  }

  const edgeLabelLayers = layerize(edgeLabels, axis);
  for (const it of edgeLabelLayers) it.layer = Math.floor(it.layer / group);
  for (const { el, layer } of edgeLabelLayers) {
    el.classList.add('cma-hidden');
    el.dataset.cmaDelay = String(layer * layerDelay + edgeDelay + edgeDur * 0.5);
  }

  const total = maxLayer * layerDelay + edgeDelay + edgeDur + enterDur;
  let timers = [];
  let raf = null;

  function finish() {
    timers.forEach(clearTimeout);
    timers = [];
    if (raf) cancelAnimationFrame(raf);
    for (const el of [...units, ...edges, ...edgeLabels]) {
      el.classList.remove('cma-hidden');
      if (el.style && el.style.strokeDashoffset) el.style.strokeDashoffset = '0';
    }
  }

  function play() {
    return new Promise((resolve) => {
      // 用 rAF 起跑，保证上面的初始样式已经过一次 layout，transition 才会真的跑
      raf = requestAnimationFrame(() => {
        for (const { el, layer } of unitLayers) {
          timers.push(
            setTimeout(() => {
              el.classList.remove('cma-hidden');
              el.classList.add('cma-enter');
            }, layer * layerDelay),
          );
        }
        for (const { el, layer } of edgeLayers) {
          const delay = layer * layerDelay + edgeDelay;
          timers.push(
            setTimeout(() => el.classList.remove('cma-hidden'), delay),
          );
        }
        for (const { el } of draws) {
          const delay = Number(el.dataset.cmaDelay) + 20;
          timers.push(
            setTimeout(() => {
              el.style.strokeDashoffset = '0';
            }, delay),
          );
        }
        for (const { el, layer } of edgeLabelLayers) {
          timers.push(
            setTimeout(
              () => el.classList.remove('cma-hidden'),
              layer * layerDelay + edgeDelay + edgeDur * 0.5,
            ),
          );
        }
        timers.push(setTimeout(resolve, total));
      });
    });
  }

  return {
    total,
    layerDelay,
    units: units.length,
    edges: edges.length,
    rawLayers: layerCount,
    layers: stepCount,
    play,
    finish,
    cancel: finish,
  };
}

/**
 * 候选 C：按源码增量重渲染，视觉上「图还没写完就在长」。
 *
 * ⚠️ 老实说清楚：
 *   在**我们现在的链路**里，mermaid 源码是 `classroom_draw` 一次调用整体给出的，
 *   所以这里的「增量」是**按行把完整源码一点点喂进去**，模拟「模型正在写」的节奏——
 *   它是**真的在重渲染**（每次都是新的 mermaid.render），但不是真的在流式接收。
 *   真流式的唯一入口是「工具入参流」：把 partial argsRaw 里已经出现的 source 前缀
 *   交给同一个函数（sourceOf 换成返回实时前缀即可）。见报告 §4 接线说明。
 *
 * @param {HTMLElement} container  渲染目标
 * @param {string} fullSource      完整 mermaid 源码
 * @param {object} mermaidApi      mermaid 实例（globalThis.mermaid）
 * @param {object} [opts]
 * @param {(prefix:string, k:number, n:number)=>string} [opts.slice] 自定义分片
 * @param {number} [opts.interval] 两片之间的间隔 ms
 * @param {(src:string)=>Promise<{svg:string}>} [opts.render] 自定义渲染器（默认 mermaid.render）
 * @returns {Promise<{steps:number, ms:number, renders:number}>}
 */
export async function streamRender(container, fullSource, mermaidApi, opts = {}) {
  const { interval = 140, render } = opts;
  const t0 = performance.now();

  const lines = fullSource.replace(/\r\n/g, '\n').split('\n');
  // 头部（图类型声明 + frontmatter/指令行）永远保留，否则重渲染必报错
  let headEnd = 0;
  while (headEnd < lines.length) {
    const l = lines[headEnd].trim();
    if (l === '' || l.startsWith('%%')) { headEnd += 1; continue; }
    break;
  }
  headEnd += 1; // 含图类型那一行
  const head = lines.slice(0, headEnd);
  const body = lines
    .slice(headEnd)
    .filter((l) => l.trim() !== '');

  const slice = opts.slice || ((prefixLines) => [...head, ...prefixLines].join('\n'));

  let renders = 0;
  let lastGood = null;

  const step = async (k) => {
    const src = slice(body.slice(0, k), k, body.length);
    const id = `cma-stream-${Date.now()}-${k}`;
    try {
      const out = await (render
        ? render(src)
        : mermaidApi.render(id, src, undefined));
      renders += 1;
      lastGood = out.svg;
      container.innerHTML = out.svg;
      const svgEl = container.querySelector('svg');
      if (svgEl && typeof out.bindFunctions === 'function') out.bindFunctions(svgEl);
    } catch (err) {
      // 这一片语法不完整（很常见：写到一半的边）→ 保留上一张好图，继续
      if (!lastGood) throw err;
    }
  };

  for (let k = 1; k <= body.length; k += 1) {
    await step(k);
    if (k < body.length) await new Promise((r) => setTimeout(r, interval));
  }

  return { steps: body.length, ms: performance.now() - t0, renders };
}

/**
 * 统一入口：按 mode 给一个已经渲染好的 svg 装动画。
 * mode==='stream' 不走这里（它要重渲染，见 streamRender）。
 */
export function decorate(svg, mode, opts = {}) {
  if (mode === 'stagger') return animateStagger(svg, opts);
  return { total: 0, units: 0, edges: 0, layers: 0, play: async () => {}, finish() {}, cancel() {} };
}
