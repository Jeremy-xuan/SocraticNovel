/* ============================================================================
 * 教室舞台 STAGE-3 · 场景驱动（三方向共用同一份内容，只换设计逻辑）
 * ----------------------------------------------------------------------------
 * 用法：<dir>.html?scene=open|board|choice|cast
 *   · 供截图逐屏取景（改 URL 即可，无需点击）
 *   · 浏览器里也可用键盘 1/2/3/4 切换，或点左下角的小字
 *
 * 素材：默认**零第三方素材**，自包含。
 *   · 场景与立绘由本文件生成内联 SVG 占位（data: URI）→ 不发网络请求、
 *     不会出现破图图标、file:// 直接可开
 *   · 要换成真素材，只改 stage3.assets.js（唯一配置点）；加载失败会
 *     **显式报错 + 退回占位 + 显示「素材缺失」角标**，不静默忽略
 * ==========================================================================*/
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * 一 · 素材槽位与配置解析
   * -----------------------------------------------------------------------*/

  var SLOT_LABEL = {
    scene_night:   '场景 · 夜',
    scene_evening: '场景 · 傍晚',
    cast_a:        '立绘 1',
    cast_b:        '立绘 2',
    cast_c:        '立绘 3'
  };

  /* 占位色（每个槽位一色，便于一眼分清"这是哪一格"；与真实素材无对应关系） */
  var SLOT_HUE = {
    scene_night:   218,
    scene_evening: 26,
    cast_a:        190,
    cast_b:        300,
    cast_c:        152
  };

  function q(name) {
    var m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* 读配置：stage3.assets.js 提供 window.STAGE3_ASSETS_CONFIG；
     URL 的 ?assets= 优先于文件（用于不改文件地切换/验收）。
     槽位文件名与 stage3.assets.js 里填的路径同名（scene_night → scene_night.png），
     所以 ?assets=<目录>/ 能让全部 5 个槽位一起指向那个目录。 */
  var SLOT_FILE = {
    scene_night: 'scene_night.png',
    scene_evening: 'scene_evening.png',
    cast_a: 'cast_a.png',
    cast_b: 'cast_b.png',
    cast_c: 'cast_c.png'
  };

  function readConfig() {
    var file = window.STAGE3_ASSETS_CONFIG;
    var slots = (file && file.slots) || {};
    var mode = (file && file.mode) === 'external' ? 'external' : 'placeholder';
    var base = '';
    var override = q('assets');

    if (override === 'placeholder' || override === 'off' || override === 'none') {
      mode = 'placeholder';
    } else if (override) {
      mode = 'external';
      base = /\/$/.test(override) ? override : override + '/';
    }
    return { mode: mode, slots: slots, base: base };
  }

  var CFG = readConfig();

  /* 解析一个槽位：返回 { slot, url } —— url 为空串 ⇒ 用占位 */
  function resolveSlot(slot) {
    if (CFG.mode !== 'external') return { slot: slot, url: '' };
    if (CFG.base) return { slot: slot, url: CFG.base + SLOT_FILE[slot] };
    var raw = CFG.slots[slot];
    if (!raw) return { slot: slot, url: '' };
    return { slot: slot, url: raw };
  }

  /* -------------------------------------------------------------------------
   * 二 · 自包含占位（内联 SVG → data: URI）
   * -----------------------------------------------------------------------*/

  function dataURI(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* 场景占位：与舞台同尺寸（1920×1080）的渐变，两条地平线 + 光斑 */
  function scenePlaceholder(slot) {
    var h = SLOT_HUE[slot];
    return dataURI(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">' +
        '<defs>' +
          '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="hsl(' + h + ',32%,9%)"/>' +
            '<stop offset="55%" stop-color="hsl(' + h + ',26%,15%)"/>' +
            '<stop offset="100%" stop-color="hsl(' + (h + 8) + ',22%,7%)"/>' +
          '</linearGradient>' +
          '<radialGradient id="v" cx="50%" cy="46%" r="62%">' +
            '<stop offset="0" stop-color="rgba(255,255,255,.10)"/>' +
            '<stop offset="100%" stop-color="rgba(0,0,0,0)"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<rect width="1920" height="1080" fill="url(#g)"/>' +
        '<rect width="1920" height="1080" fill="url(#v)"/>' +
        '<g stroke="rgba(174,249,252,.16)" stroke-width="1.5" fill="none">' +
          '<path d="M0 760H1920"/>' +
          '<path d="M0 812H1920" stroke-dasharray="14 18"/>' +
        '</g>' +
        '<text x="60" y="1010" fill="rgba(255,255,255,.30)" ' +
          'font-family="ui-monospace,Menlo,monospace" font-size="34" letter-spacing="4">' +
          '占位 · ' + SLOT_LABEL[slot] +
        '</text>' +
      '</svg>');
  }

  /* 立绘占位：透明底 + 一个角色剪影。
     🔴 画布只用 300×1080（≈真立绘的窄长比例），**不在图里写任何文字**——
        图上的文字会跟着立绘的层高跑进正文区、把台词压住（实测踩过）。
        槽位名改由页面上一枚 15px 角标承担（见 CSS 的 .cast-badge）。 */
  function castPlaceholder(slot) {
    var h = SLOT_HUE[slot];
    var ink = 'hsl(' + h + ',46%,76%)';
    var dim = 'hsl(' + h + ',32%,46%)';
    var body = 'hsl(' + h + ',30%,16%)';
    return dataURI(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1080" viewBox="0 0 300 1080">' +
        '<g fill="none" stroke-linejoin="round" stroke-linecap="round" stroke-width="3">' +
          /* 躯干（肩→腰→裙摆）：只占画布下部，上部留空给舞台。
             起笔 y 与头部圆（cy=440 / r=44）重叠，避免"头身分离" */
          '<path d="M150 462c-24 0-40 12-46 32l-14 56c-8 30-16 68-19 108l-6 66h170l-6-66' +
            'c-3-40-11-78-19-108l-14-56c-6-20-22-32-46-32z" ' +
            'fill="' + body + '" stroke="' + ink + '"/>' +
          /* 头 */
          '<circle cx="150" cy="440" r="44" fill="' + dim + '" stroke="' + ink + '"/>' +
          /* 肩线（把剪影和"一块色块"区分开） */
          '<path d="M104 500c14 8 29 12 46 12s32-4 46-12" stroke="' + ink + '" opacity=".55"/>' +
        '</g>' +
      '</svg>');
  }

  function placeholderFor(slot) {
    return /^scene_/.test(slot) ? scenePlaceholder(slot) : castPlaceholder(slot);
  }

  /* -------------------------------------------------------------------------
   * 三 · 素材解析（占位 / 外挂 / 失败退回）
   * -----------------------------------------------------------------------*/

  var ASSET_LOG = [];   /* 供验收脚本读：每个槽位最终用了什么 */

  /* 给容器挂上「素材缺失」角标（明确可见，不静默忽略） */
  function markMissing(host, slot, url, why) {
    var old = host.querySelector(':scope > .asset-missing');
    if (old) old.parentNode.removeChild(old);
    var b = document.createElement('span');
    b.className = 'asset-missing';
    b.setAttribute('role', 'note');
    b.textContent = '素材缺失：' + url + '（' + SLOT_LABEL[slot] + '，已退回占位）';
    host.appendChild(b);
    if (window.console && console.error) {
      console.error('[stage3] 素材加载失败 → 退回占位：槽位=' + slot +
        ' 路径=' + url + ' 原因=' + why);
    }
  }

  function clearMissing(host) {
    var old = host.querySelector(':scope > .asset-missing');
    if (old) old.parentNode.removeChild(old);
  }

  /* 把一个 <img> 绑到某个槽位。
     host = 用来挂角标的容器（figure / .scene） */
  function bindImage(img, host, slot) {
    var r = resolveSlot(slot);
    var ph = placeholderFor(slot);
    var state = { slot: slot, url: r.url || null, used: 'placeholder', fallback: false };
    ASSET_LOG.push(state);

    clearMissing(host);
    img.onerror = null;

    if (!r.url) {                       /* 占位模式 / 该槽位留空 */
      img.src = ph;
      return state;
    }

    img.onerror = function () {         /* 外挂了但加载失败 → 显式报错 + 退回占位 */
      state.used = 'placeholder';
      state.fallback = true;
      img.onerror = null;
      img.src = ph;
      markMissing(host, slot, r.url, 'load-error');
    };
    img.onload = function () { state.used = 'external'; };
    img.src = r.url;
    return state;
  }

  /* -------------------------------------------------------------------------
   * 四 · 内容（三方向共用；同一份内容只换设计逻辑，方便横向对比）
   * -----------------------------------------------------------------------*/

  var CAST = [
    { id: 'komari', name: '小鞠知花', role: '教师', slot: 'cast_a' },
    { id: 'kishi',  name: '岸',       role: '学生', slot: 'cast_b' },
    { id: 'masumi', name: '真澄',     role: '学生', slot: 'cast_c' }
  ];

  var SCENES = {
    /* ① 开场：无框直排、旧行压暗、当前行亮白、末行末尾跟青色推进指示器 */
    open: {
      kind: 'adv',
      sceneSlot: 'scene_night',
      who: 'komari',
      lines: [
        { t: '「今天不讲新东西——先把上一讲的『进程』两个字，拆开看看它到底是什么。」', s: 'say' },
        { t: '她把手里的粉笔放回槽里，屏幕上的命令行停在一行没有回车的提示符后面。', s: 'narr' },
        { t: '「谁先说说：一个正在运行的程序，和一段躺在硬盘上的代码，差在哪？」', s: 'say' },
        { t: '教室里安静了两秒。', s: 'narr' }
      ]
    },

    /* ② 板书 / 投影 */
    board: {
      kind: 'board',
      sceneSlot: 'scene_evening',
      who: 'komari',
      title: '进程 ＝ 程序 ＋ 运行环境',
      items: [
        '程序：磁盘上的静态指令与数据，只读、可共享',
        '进程：被加载进内存、持有 PC 与寄存器现场的执行实体',
        '内核视角：PCB —— pid / 状态 / 页表 / 打开的文件表',
        '数量关系：同一份程序，可以有 N 个互不干扰的进程'
      ],
      lines: [
        { t: '「看清楚这条线——左边是硬盘，右边是内存。进程只活在右边。」', s: 'say' },
        { t: '板书上的四个词，等下每一个都要你亲手碰一遍。', s: 'narr' }
      ]
    },

    /* ③ 选择肢：单列 6 条、占屏 89.6%、两端卷草花饰、选中整条填充 */
    choice: {
      kind: 'choice',
      sceneSlot: 'scene_night',
      who: 'komari',
      title: '～ 选 项 ～',
      items: [
        '先把 PCB 拆给我看。',
        '进程和线程，到底差在哪？',
        '画一张状态迁移图。',
        '举一个我身边能看见的例子。',
        '我自己写一段 fork 试试。',
        '先停一下，我把上一讲再看一遍。'
      ],
      sel: 0
    },

    /* ④ 多角色同台（用户点名必须的一屏） */
    cast: {
      kind: 'adv',
      sceneSlot: 'scene_night',
      who: 'kishi',
      roster: ['komari', 'kishi', 'masumi'],
      lines: [
        { t: '岸：「那……我开两个终端跑同一个程序，算几个进程？」', s: 'say', who: 'kishi' },
        { t: '真澄：「两个吧。它们各自的变量都不一样。」', s: 'say', who: 'masumi' },
        { t: '「两个。而且它们看不见对方的内存——这就是进程给的隔离。」', s: 'say', who: 'komari' },
        { t: '小鞠知花在白板上画了两个方框，中间留了一道很宽的空隙。', s: 'narr', who: 'komari' }
      ]
    }
  };

  var SCENE_ORDER = ['open', 'board', 'choice', 'cast'];
  var LABEL = { open: '① 开场', board: '② 板书／投影', choice: '③ 选择肢', cast: '④ 多角色同台' };

  function castOf(id) {
    for (var i = 0; i < CAST.length; i++) { if (CAST[i].id === id) return CAST[i]; }
    return CAST[0];
  }

  /* ---------------- 渲染 ---------------- */
  function renderLines(host, lines) {
    host.innerHTML = '';
    lines.forEach(function (ln, i) {
      var li = document.createElement('li');
      var isLast = (i === lines.length - 1);
      /* 旧行压暗、当前行亮白（U1 实测：字心亮度 221.2 vs 177.4，字号完全相同） */
      li.className = (isLast ? 'is-cur' : '') + (ln.s === 'narr' ? ' is-narr' : '');
      /* 段间距：U1 换段处行顶差 ≈160px ≈ 两倍行距 ⇒ 段间空一行 */
      if (i > 0 && lines[i - 1].s === 'narr' && ln.s === 'say') li.className += ' is-para';
      li.textContent = ln.t;
      if (isLast) {
        var adv = document.createElement('span');
        adv.className = 'adv';
        li.appendChild(adv);
      }
      host.appendChild(li);
    });
  }

  /* 卷草花饰（U6 选择肢两端各一枚，实测 ≈30/852 宽 ≈68px @1920；形态是西式卷草纹
     acanthus scroll：一条 C 形主藤 + 三片小叶 + 一个圆点花心） */
  function scrollSVG() {
    return '<svg viewBox="0 0 68 146" fill="none" stroke="#37DBF7" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M62 73C40 73 26 60 26 44C26 30 36 20 50 20C60 20 66 27 66 36C66 44 61 49 54 49"/>' +
      '<path d="M62 73C40 73 26 86 26 102C26 116 36 126 50 126C60 126 66 119 66 110C66 102 61 97 54 97"/>' +
      '<path d="M62 73H6"/>' +
      '<path d="M40 32C32 36 28 44 28 52"/><path d="M40 114C32 110 28 102 28 94"/>' +
      '<circle cx="11" cy="73" r="5"/>' +
      '<path d="M50 20C46 14 40 12 34 13"/><path d="M50 126C46 132 40 134 34 133"/>' +
      '</svg>';
  }

  function renderBoard(stage, sc) {
    var p = stage.querySelector('.podium');
    if (!p) return;
    var isB = stage.classList.contains('v-b');
    var isC = stage.classList.contains('v-c');
    /* 方向 B 的「黑板位」是常驻的：四屏都在，只是「板书屏」时它被点亮成焦点。
       方向 A/C 只在板书屏出现。 */
    var content = (sc.kind === 'board') ? sc : (isB ? SCENES.board : null);
    if (!content) { p.innerHTML = ''; return; }
    if (isC) {
      p.innerHTML = '<h3>' + content.title + '</h3><ul>' +
        content.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    } else if (isB) {
      p.innerHTML = '<h3 style="margin:0 0 .7em;font-size:calc(var(--fs-body)*.72);letter-spacing:.08em;color:#8fe3f2;font-weight:400">' +
        content.title + '</h3><ul style="margin:0;padding:0 0 0 1.1em;font-size:calc(var(--fs-body)*.62);line-height:2;color:#cfe6ec">' +
        content.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    } else {
      /* 方向 A：投影＝「无底板的图」——真实界面语汇里，图直接浮在场景上，不带卡片、
         不带底板、不带投影（U1 实测：文字带内外亮度差在噪声级 ⇒ 没有底板层）。
         这里画一张线描关系图（细青线），不是第三方素材。 */
      p.innerHTML =
        '<svg viewBox="0 0 900 420" fill="none" stroke="#AEF9FC" stroke-width="1.6" ' +
        'style="width:100%;height:100%;overflow:visible">' +
        '<rect x="30" y="120" width="300" height="180" rx="4"/>' +
        '<text x="180" y="215" fill="#EAF7FA" stroke="none" font-size="34" text-anchor="middle" ' +
        'font-family="PingFang SC,Hiragino Sans GB,sans-serif">硬盘 · 只读</text>' +
        '<rect x="570" y="90" width="300" height="240" rx="4"/>' +
        '<text x="720" y="215" fill="#EAF7FA" stroke="none" font-size="34" text-anchor="middle" ' +
        'font-family="PingFang SC,Hiragino Sans GB,sans-serif">内存 · 可写</text>' +
        '<path d="M330 210H560" stroke-dasharray="8 8"/>' +
        '<path d="M548 198L566 210L548 222"/>' +
        '<text x="445" y="188" fill="#8FE3F2" stroke="none" font-size="26" text-anchor="middle" ' +
        'font-family="PingFang SC,Hiragino Sans GB,sans-serif">装载</text>' +
        '<text x="180" y="345" fill="#8FE3F2" stroke="none" font-size="26" text-anchor="middle" ' +
        'font-family="PingFang SC,Hiragino Sans GB,sans-serif">程序 · 一份</text>' +
        '<text x="720" y="368" fill="#8FE3F2" stroke="none" font-size="26" text-anchor="middle" ' +
        'font-family="PingFang SC,Hiragino Sans GB,sans-serif">进程 · 可以有 N 份</text>' +
        '</svg>';
    }
  }

  function renderChoices(stage, sc) {
    var list = stage.querySelector('.choices__list');
    var title = stage.querySelector('.choices__title');
    if (!list) return;
    if (sc.kind !== 'choice') { list.innerHTML = ''; if (title) title.textContent = ''; return; }
    if (title) title.textContent = sc.title;
    list.innerHTML = sc.items.map(function (t, i) {
      return '<div class="choice' + (i === sc.sel ? ' is-sel' : '') + '">' +
        '<span class="choice__orn choice__orn--l">' + scrollSVG() + '</span>' +
        '<span class="choice__txt">' + t + '</span>' +
        '<span class="choice__orn choice__orn--r">' + scrollSVG() + '</span></div>';
    }).join('');
  }

  function renderCast(stage, sc) {
    /* 立绘固定按 CAST 顺序放：左＝小鞠知花、中＝岸、右＝真澄；
       说话者 is-on，其余 is-off（真实界面：立绘不带投影，靠亮度差区分） */
    var figs = stage.querySelectorAll('.cast figure');
    for (var i = 0; i < figs.length && i < CAST.length; i++) {
      var img = figs[i].querySelector('img');
      figs[i].className = (CAST[i].id === sc.who) ? 'is-on' : 'is-off';
      figs[i].setAttribute('data-who', CAST[i].id);
      if (img) bindImage(img, figs[i], CAST[i].slot);
      /* 槽位名不再画在立绘图里（会跟着层高压住正文），改挂一枚角标；
         角标**只有外挂素材时才显示**——占位模式下三个剪影本身已够辨识，
         而占位模式下它正好落在正文区，只会变成噪声。 */
      var oldBadge = figs[i].querySelector('.cast-badge');
      if (oldBadge) oldBadge.parentNode.removeChild(oldBadge);
      if (CFG.mode === 'external') {
        var badge = document.createElement('span');
        badge.className = 'cast-badge';
        badge.textContent = SLOT_LABEL[CAST[i].slot];
        figs[i].appendChild(badge);
      }
    }
    /* 在场者栏（方向 B）：谁在说，一眼看出来 */
    var roster = stage.querySelector('.roster');
    if (roster && sc.roster) {
      roster.innerHTML = sc.roster.map(function (id) {
        var c = castOf(id);
        return '<div class="' + (id === sc.who ? 'is-on' : '') + '"><i></i>' + c.name + '</div>';
      }).join('');
    }
  }

  /* 方向 C 的常驻元素：章节书脊条（语汇来自 U12 書庫：每章一条书脊 + 既读圆点） */
  var SPINE_COLORS = ['#8a6b3f', '#a8a05a', '#3f6f8f', '#9c4a3c', '#d8cfae', '#2f4a6b',
                      '#b0763a', '#6d7f5a', '#8f3f4a', '#4a6b7a', '#c9a86a', '#7a4a2a',
                      '#5a6b8f', '#a89070'];
  function renderSpines(stage, cur) {
    var host = stage.querySelector('.spines');
    if (!host) return;
    var out = '';
    for (var i = 0; i < 14; i++) {
      var cls = i < cur - 1 ? 'done' : (i === cur - 1 ? 'cur' : 'todo');
      out += '<i class="' + cls + '" style="background:' + SPINE_COLORS[i] + '"></i>';
    }
    host.innerHTML = out;
  }

  /* 运行期事实（验收脚本读这里，不靠 console 输出） */
  window.__stage3 = {
    applyScene: null, SCENES: SCENES, CAST: CAST, SLOT_LABEL: SLOT_LABEL,
    state: { mode: CFG.mode, scene: null, assets: [] }
  };

  function applyScene(name) {
    var stage = document.getElementById('stage');
    if (!stage || !SCENES[name]) return;
    var sc = SCENES[name];
    stage.className = stage.className.replace(/\bis-(open|board|choice|cast)\b/g, '').trim();
    stage.classList.add('is-' + name);
    stage.classList.toggle('is-menu', name === 'choice');

    ASSET_LOG.length = 0;

    var scene = stage.querySelector('.scene');
    var img = stage.querySelector('.scene__img');
    if (img && scene) bindImage(img, scene, sc.sceneSlot);

    var band = stage.querySelector('.band__inner');
    if (band) {
      if (sc.kind === 'choice') { band.innerHTML = ''; }
      else { renderLines(band, sc.lines); }
    }
    /* 姓名条（默认关闭；v-b 启用）——姓名直接取自内容，不是另编 */
    var nb = stage.querySelector('.namebar');
    if (nb) {
      var cur = sc.who ? castOf(sc.who).name : '';
      nb.textContent = cur;
      nb.style.display = (sc.kind === 'choice') ? 'none' : '';
    }
    renderBoard(stage, sc);
    renderChoices(stage, sc);
    renderCast(stage, sc);
    renderSpines(stage, 3);   /* 本讲＝第 3 讲（与教室 cs-os 的进度口径一致：current_lesson） */

    var tag = document.getElementById('tag');
    if (tag) tag.textContent = LABEL[name] + ' ｜ ' + (q('v') || '');

    /* 给验收脚本留一份可读的运行期事实（不写 console，避免污染零报错断言） */
    document.documentElement.setAttribute('data-stage3-mode', CFG.mode);
    document.documentElement.setAttribute('data-stage3-scene', name);
    window.__stage3.state = { mode: CFG.mode, scene: name, assets: ASSET_LOG.slice() };
  }

  /* ---------------- 自适应缩放（固定 1920×1080 舞台 + letterbox）---------------- */
  function fit() {
    var k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.getElementById('stage').style.setProperty('--k', k);
    document.getElementById('fit').style.height = '100vh';
  }
  window.addEventListener('resize', fit);

  /* ---------------- 启动 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    fit();
    var name = q('scene') || 'open';
    if (SCENE_ORDER.indexOf(name) < 0) name = 'open';
    applyScene(name);

    /* 浏览器里手动切换用（截图不用它） */
    document.addEventListener('keydown', function (e) {
      var idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= 4) applyScene(SCENE_ORDER[idx - 1]);
    });
  });

  window.__stage3.applyScene = applyScene;
})();
