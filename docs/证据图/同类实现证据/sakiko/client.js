window.__ModuleLoader__.load({ id: "sakiko-for-dsh", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// package/client.mjs
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react = __toESM(require("react"), 1);
var inject = ["timer", "slots"];
function apply(ctx) {
  const slots = ctx.get("slots");
  if (slots === void 0) return;
  const layout = ctx.get("layout");
  const hostLocal = {
    call: async (m, args) => {
      const res = await fetch("/sakiko/rpc?m=" + encodeURIComponent(m) + "&args=" + encodeURIComponent(JSON.stringify(args || {})), { cache: "no-store" });
      return await res.json();
    }
  };
  function domCss(css) {
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    return () => {
      try {
        st.remove();
      } catch (e) {
      }
    };
  }
  const removeCss = domCss(
    ".amad-col{display:flex;flex-direction:column;height:100%;min-height:440px;background:var(--dsw-alias-bg-base,transparent);border-left:1px solid var(--dsw-alias-border-l1,transparent);}.amad-header{display:flex;align-items:center;gap:6px;padding:8px 10px;user-select:none;background:linear-gradient(90deg,rgba(19,32,63,.55),rgba(20,33,60,.22));border-bottom:1px solid rgba(255,255,255,.1);flex:none;}.amad-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;}.amad-title{font-weight:700;letter-spacing:2px;color:var(--dsw-alias-label-primary,#eef2fb);font-size:13px;}.amad-sub{font-size:10px;color:var(--dsw-alias-label-secondary,#a8b6d8);margin-right:auto;}.amad-btn{border:0;background:rgba(255,255,255,.08);color:inherit;width:24px;height:24px;border-radius:6px;font-size:12px;cursor:pointer;line-height:1;padding:0;flex:none;}.amad-btn:hover{background:rgba(255,255,255,.18);}.amad-frame{flex:1;min-height:300px;width:100%;border:0;display:block;background:transparent;}.amad-footer{padding:4px 10px;font-size:10px;color:var(--dsw-alias-label-secondary,#7688ad);border-top:1px solid rgba(255,255,255,.08);flex:none;}.amad-settings-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 4px;border-bottom:1px solid rgba(128,128,128,.18);}.amad-settings-label{font-weight:600;}.amad-settings-desc{font-size:12px;color:#a8b6d8;margin-top:2px;}.amad-settings select{border:1px solid rgba(128,128,128,.4);border-radius:6px;padding:4px 8px;background:transparent;color:inherit;}.amad-settings-btn{border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;border-radius:6px;padding:5px 12px;cursor:pointer;margin-right:8px;}.amad-settings-btn:hover{background:rgba(128,128,128,.15);}.amad-sb-btn{border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:6px;display:flex;align-items:center;gap:6px;}.amad-sb-btn:hover{background:rgba(128,128,128,.15);}.amad-warn{margin-top:14px;font-size:12px;color:#e0a06a;}.amad-float-shell{pointer-events:auto;position:fixed;display:block;border:0;border-radius:36px;background:#0c1428;box-shadow:0 8px 28px rgba(0,0,0,.5),0 0 40px rgba(0,0,0,.38);overflow:hidden;user-select:none;}.amad-float-body{position:absolute;inset:0;display:block;}.amad-float-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent;pointer-events:auto;-webkit-mask-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' rx='36' ry='36' fill='%23fff'/></svg>\");-webkit-mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' rx='36' ry='36' fill='%23fff'/></svg>\");mask-size:100% 100%;mask-repeat:no-repeat;}.amad-float-strip{position:absolute;top:0;left:0;right:0;height:10px;cursor:move;touch-action:none;z-index:6;pointer-events:auto;}.amad-float-strip:hover{background:rgba(255,255,255,.08);}.amad-float-chrome{position:absolute;top:16px;left:10px;display:flex;gap:6px;z-index:7;opacity:0;transition:opacity .15s;pointer-events:none;}.amad-float-shell:hover .amad-float-chrome{opacity:1;pointer-events:auto;}.amad-float-btn{width:20px;height:20px;border-radius:50%;border:1px solid rgba(238,242,251,.28);background:rgba(10,16,32,.6);color:#eef2fb;font-size:12px;line-height:1;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);}.amad-float-btn:hover{background:rgba(143,179,255,.35);color:#fff;}@media (hover: hover){.amad-float-shell:hover .amad-float-chrome{opacity:1;pointer-events:auto;}.amad-float-shell:hover .amad-float-grip{opacity:1;pointer-events:auto;}}@media (hover: none){.amad-float-chrome{opacity:.55;pointer-events:auto;}.amad-float-grip{opacity:.5;pointer-events:auto;}}.amad-float-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;touch-action:none;z-index:6;opacity:0;transition:opacity .15s;pointer-events:none;background:linear-gradient(135deg,rgba(255,255,255,0) 55%,rgba(255,255,255,.6) 55%);border-bottom-right-radius:8px;}.amad-float-grip:hover{opacity:1;background:linear-gradient(135deg,rgba(255,255,255,0) 45%,rgba(255,255,255,.9) 45%);}.amad-float-dot{pointer-events:auto;position:fixed;right:24px;bottom:24px;width:48px;height:48px;border-radius:50%;border:1px solid rgba(143,179,255,.55);background:linear-gradient(160deg,rgba(30,46,92,.95),rgba(15,24,48,.98));color:#8fb3ff;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);user-select:none;}.amad-float-dot:hover{background:linear-gradient(160deg,rgba(45,66,122,.95),rgba(22,36,70,.98));color:#eef2fb;}"
  );
  ctx.effect(() => removeCss);
  const theme = ctx.get("theme");
  const SAKIKO_TOKENS = {
    "--dsw-alias-bg-base": { light: "#0a1020", dark: "#0a1020" },
    "--dsw-alias-bg-layer-1": { light: "#0f1830", dark: "#0f1830" },
    "--dsw-alias-bg-layer-2": { light: "#141f3a", dark: "#141f3a" },
    "--dsw-alias-bg-overlay": { light: "#1a2747", dark: "#1a2747" },
    "--dsw-alias-border-l1": { light: "#26365c", dark: "#26365c" },
    "--dsw-alias-border-l2": { light: "#3a4f7f", dark: "#3a4f7f" },
    "--dsw-alias-brand-primary": { light: "#8fb3ff", dark: "#8fb3ff" },
    "--dsw-alias-label-primary": { light: "#eef2fb", dark: "#eef2fb" },
    "--dsw-alias-label-secondary": { light: "#a8b6d8", dark: "#a8b6d8" },
    "--dsw-alias-state-error-primary": { light: "#ff7b6b", dark: "#ff7b6b" },
    "--dsw-alias-state-success-primary": { light: "#7fd47f", dark: "#7fd47f" },
    "--dsw-alias-state-warn-primary": { light: "#e0a06a", dark: "#e0a06a" },
    "--dsw-specific-sidebar-fill": { light: "#080d1a", dark: "#080d1a" }
  };
  let themeLayer = null;
  function applyTheme(on) {
    if (theme === void 0) return;
    if (on && themeLayer === null) {
      try {
        themeLayer = theme.overrideTokens("sakiko-theme", SAKIKO_TOKENS);
      } catch (e) {
        console.error("[sakiko] \u4E3B\u9898\u8986\u76D6\u5931\u8D25", e);
        themeLayer = null;
      }
    } else if (!on && themeLayer !== null) {
      try {
        themeLayer();
      } catch (e) {
      }
      themeLayer = null;
    }
  }
  function createStore(initial) {
    let value = initial;
    const subs = [];
    return {
      get: () => value,
      set: (next) => {
        if (next === value) return;
        value = next;
        for (let i = 0; i < subs.length; i++) subs[i]();
      },
      subscribe: (fn) => {
        subs.push(fn);
        return () => {
          const i = subs.indexOf(fn);
          if (i >= 0) subs.splice(i, 1);
        };
      }
    };
  }
  function useStore(store) {
    const [v, setV] = import_react.default.useState(store.get());
    import_react.default.useEffect(() => store.subscribe(() => setV(store.get())), []);
    return v;
  }
  const configStore = createStore(null);
  const statusStore = createStore({ tts: "", queue: 0, cache: 0, error: "", callPending: false, pendingClose: null });
  function encURI(s) {
    const bytes = new TextEncoder().encode(String(s));
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      const c = String.fromCharCode(b);
      if (c >= "A" && c <= "Z" || c >= "a" && c <= "z" || c >= "0" && c <= "9" || c === "-" || c === "_" || c === "." || c === "~") out += c;
      else out += "%" + (b < 16 ? "0" : "") + b.toString(16).toUpperCase();
    }
    return out;
  }
  let lastConfigJson = "";
  let lastStatusJson = "";
  let lastCallPending = false;
  let lastPendingClose = null;
  async function refreshStatus() {
    try {
      const res = await hostLocal.call("getStatus", {});
      if (res && typeof res === "object") {
        const cfg = res.config || null;
        let cfgJson = "";
        try {
          cfgJson = cfg ? JSON.stringify(cfg) : "";
        } catch (e) {
          cfgJson = "";
        }
        if (cfgJson !== lastConfigJson) {
          lastConfigJson = cfgJson;
          configStore.set(cfg);
          applyTheme(cfg ? cfg.themeOn !== false : true);
          layoutModeSync(cfg);
        }
        const st = { tts: res.tts || "", queue: res.queue || 0, cache: res.cache || 0, error: "", callPending: res.callPending === true, pendingClose: typeof res.pendingClose === "number" ? res.pendingClose : null };
        const stJson = JSON.stringify(st);
        if (stJson !== lastStatusJson) {
          lastStatusJson = stJson;
          statusStore.set(st);
        }
        if (res.callPending === true && !lastCallPending) {
          lastCallPending = true;
          if (isFloatOn()) {
            if (floatStore.get().collapsed) expandFloatShell();
          } else {
            openDetailsSafe();
          }
        }
        if (res.callPending !== true) lastCallPending = false;
        if (typeof res.pendingClose === "number" && res.pendingClose !== lastPendingClose) {
          lastPendingClose = res.pendingClose;
          if (isFloatOn()) {
            if (!floatStore.get().collapsed) collapseFloatShell();
          } else {
            try {
              if (layout) layout.closeDetails();
            } catch (e) {
            }
          }
          hostLocal.call("ackClose", {}).catch(() => {
          });
        }
        if (typeof res.pendingClose !== "number") lastPendingClose = null;
      }
    } catch (e) {
      const st = { tts: "", queue: 0, cache: 0, error: String(e && e.message ? e.message : e) };
      const stJson = JSON.stringify(st);
      if (stJson !== lastStatusJson) {
        lastStatusJson = stJson;
        statusStore.set(st);
      }
    }
  }
  async function patchConfig(patch) {
    try {
      const next = await hostLocal.call("setConfig", patch);
      if (next && typeof next === "object") {
        configStore.set(next);
        layoutModeSync(next);
      }
      return next;
    } catch (e) {
      console.error("[sakiko] setConfig failed", e);
      return null;
    }
  }

  function hexDarken(hex, f) {
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "#0c1428";
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * f);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * f);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * f);
    return "#" + [r, g, b].map((v) => ("0" + Math.max(0, Math.min(255, v)).toString(16)).slice(-2)).join("");
  }
  async function rpcSay(text) {
    try {
      return await hostLocal.call("say", { text });
    } catch (e) {
      return { ok: false };
    }
  }
  async function rpcRepeat() {
    try {
      return await hostLocal.call("repeat", {});
    } catch (e) {
      return { ok: false };
    }
  }
  async function rpcClear() {
    try {
      return await hostLocal.call("clear", {});
    } catch (e) {
      return { ok: false };
    }
  }
  async function rpcTestChat() {
    try {
      return await hostLocal.call("testChat", {});
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
  async function rpcReport(msg) {
    try {
      await hostLocal.call("clientReport", { msg: String(msg).slice(0, 250) });
    } catch (e) {
    }
  }
  function openDetailsSafe() {
    if (layout === void 0) return;
    if (isFloatOn()) return;
    try {
      layout.openDetails();
    } catch (e) {
    }
  }
  let lastLayoutMode = null;
  function layoutModeSync(cfg) {
    if (!cfg) return;
    const floatMode = cfg.floatPanel !== false;
    if (floatMode === lastLayoutMode) return;
    lastLayoutMode = floatMode;
    if (floatMode) {
      try {
        if (layout) layout.closeDetails();
      } catch (e) {
      }
    } else {
      openDetailsSafe();
    }
  }
  rpcReport("client apply start");
  let iframeEl = null;
  let panelSrc = "/sakiko/panel.html";
  let panelSrcSet = false;
  let lastSentCfg = "";
  function notifyOpen() {
    if (!iframeEl || !iframeEl.contentWindow) return;
    try {
      iframeEl.contentWindow.postMessage({ type: "sakiko/open" }, "*");
    } catch (e) {
    }
  }
  function iframeSrc(config) {
    let q = "";
    try {
      q = encURI(JSON.stringify(config || {}));
    } catch (e) {
      q = "";
    }
    return "/sakiko/panel.html" + (q ? "?cfg=" + q : "");
  }
  function RootPoller() {
    import_react.default.useEffect(() => {
      refreshStatus().then(() => rpcReport("rpc getStatus ok"));
      const dispose = ctx.interval(refreshStatus, 2e3);
      return dispose;
    }, []);
    return null;
  }
  const FLOAT_KEY = "sakiko.float.v2";
  const FLOAT_KEY_LEGACY = "amadeus.float.v2";
  const FLOAT_DEF_W = 320;
  const FLOAT_DEF_H = 640;
  const FLOAT_MIN_W = 320;
  const FLOAT_MIN_H = 480;
  const FLOAT_GAP = 24;
  function floatViewport() {
    return { vw: window.innerWidth || 0, vh: window.innerHeight || 0 };
  }
  function clampFloatRect(rect) {
    const { vw, vh } = floatViewport();
    const minW = Math.min(FLOAT_MIN_W, vw);
    const minH = Math.min(FLOAT_MIN_H, vh);
    const w = Math.round(Math.min(Math.max(rect.w, minW), vw));
    const h = Math.round(Math.min(Math.max(rect.h, minH), vh));
    const x = Math.round(Math.min(Math.max(rect.x, 0), Math.max(0, vw - w)));
    const y = Math.round(Math.min(Math.max(rect.y, 0), Math.max(0, vh - h)));
    return { x: x, y: y, w: w, h: h };
  }
  function defaultFloatState() {
    const { vw, vh } = floatViewport();
    const w = Math.min(FLOAT_DEF_W, vw);
    const h = Math.min(FLOAT_DEF_H, vh);
    const r = clampFloatRect({ x: vw - w - FLOAT_GAP, y: vh - h - FLOAT_GAP, w: w, h: h });
    return { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: false };
  }
  function loadFloatState() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(FLOAT_KEY) || "null");
      if (!raw) raw = JSON.parse(localStorage.getItem(FLOAT_KEY_LEGACY) || "null");
    } catch (e) {
      raw = null;
    }
    const fallback = defaultFloatState();
    let state = fallback;
    if (raw && typeof raw === "object") {
      const num = (v) => typeof v === "number" && Number.isFinite(v);
      if (num(raw.x) && num(raw.y) && num(raw.w) && num(raw.h) && raw.w >= FLOAT_MIN_W && raw.h >= FLOAT_MIN_H) {
        const r = clampFloatRect({ x: raw.x, y: raw.y, w: raw.w, h: raw.h });
        state = { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: raw.collapsed === true };
      }
    }
    // P6 tail (5i): v1 legacy key amadeus.float (400x700 + old viewport pos) is ignored -
    // fresh default 320x640 anchored bottom-right 24 to current viewport; remove legacy key and persist v2 now.
    // NOTE: the v2 key was renamed with the plugin (amadeus.float.v2 -> sakiko.float.v2); migrated above.
    try {
      localStorage.removeItem("amadeus.float");
    } catch (e) {
    }
    saveFloatState(state);
    return state;
  }
  function saveFloatState(state) {
    try {
      localStorage.setItem(FLOAT_KEY, JSON.stringify({ x: state.x, y: state.y, w: state.w, h: state.h, collapsed: state.collapsed === true }));
    } catch (e) {
    }
  }
  const floatStore = createStore(loadFloatState());
  function setFloatState(patch) {
    const cur = floatStore.get();
    const merged = Object.assign({}, cur, patch);
    const r = clampFloatRect(merged);
    const next = { x: r.x, y: r.y, w: r.w, h: r.h, collapsed: merged.collapsed === true };
    floatStore.set(next);
    return next;
  }
  function isFloatOn() {
    const cfg = configStore.get();
    return !cfg || cfg.floatPanel !== false;
  }
  function expandFloatShell() {
    const s = setFloatState({ collapsed: false });
    saveFloatState(s);
  }
  function collapseFloatShell() {
    const s = setFloatState({ collapsed: true });
    saveFloatState(s);
  }
  function SakikoFrame(props) {
    const config = useStore(configStore);
    const own = import_react.default.useRef(null);
    if (config && !panelSrcSet) {
      panelSrcSet = true;
      panelSrc = iframeSrc(config);
    }
    import_react.default.useEffect(() => {
      if (!config) return;
      let s = "";
      try {
        s = JSON.stringify(config);
      } catch (e) {
        return;
      }
      if (s === lastSentCfg) return;
      lastSentCfg = s;
      if (iframeEl && iframeEl.contentWindow) {
        try {
          iframeEl.contentWindow.postMessage({ type: "sakiko/config", value: config }, "*");
        } catch (e) {
        }
      }
    }, [config]);
    const onLoad = () => {
      const cfg = configStore.get();
      if (!cfg || !own.current || !own.current.contentWindow) return;
      let s = "";
      try {
        s = JSON.stringify(cfg);
      } catch (e) {
        return;
      }
      lastSentCfg = s;
      try {
        own.current.contentWindow.postMessage({ type: "sakiko/config", value: cfg }, "*");
      } catch (e) {
      }
    };
    if (!config && !panelSrcSet) return null;
    return import_react.default.createElement("iframe", {
      className: props.cls || "amad-frame",
      src: panelSrc,
      title: "Sakiko Live2D",
      allow: "microphone; camera; autoplay",
      onLoad: onLoad,
      ref: (el) => {
        if (el) {
          own.current = el;
          iframeEl = el;
        } else {
          if (iframeEl === own.current) iframeEl = null;
          own.current = null;
        }
      }
    });
  }
  function SakikoColumn() {
    const config = useStore(configStore);
    const status = useStore(statusStore);
    import_react.default.useEffect(() => {
      rpcReport("column mounted");
      return () => rpcReport("column unmounted");
    }, []);
    if (!config || config.floatPanel !== false) return null;
    return import_react.default.createElement(
      "div",
      { className: "amad-col" },
      import_react.default.createElement(SakikoFrame, null),
      import_react.default.createElement(
        "div",
        { className: "amad-footer" },
        import_react.default.createElement("span", null, status.error ? "\u26A0 host \u4E0D\u53EF\u8FBE" : "\u25CF " + (status.tts || "\u2026") + " \xB7 \u961F\u5217 " + status.queue + (status.callPending ? " \xB7 \u{1F4DE} \u6765\u7535\u4E2D" : ""))
      )
    );
  }
  const FLOAT_Z = 2147483000;
  function FloatShell() {
    const f = useStore(floatStore);
    const config = useStore(configStore);
    const dragRef = import_react.default.useRef(null);
    const [interacting, setInteracting] = import_react.default.useState(null);
    import_react.default.useEffect(() => {
      if (!interacting) return;
      const base = dragRef.current;
      if (!base) return;
      const onMove = (ev) => {
        const dx = ev.clientX - base.sx;
        const dy = ev.clientY - base.sy;
        if (base.kind === "move") {
          setFloatState({ x: base.x + dx, y: base.y + dy });
        } else {
          const vw = window.innerWidth || 0;
          const vh = window.innerHeight || 0;
          const minW = Math.min(FLOAT_MIN_W, vw);
          const minH = Math.min(FLOAT_MIN_H, vh);
          const x0 = Math.min(base.x, Math.max(0, vw - minW));
          const y0 = Math.min(base.y, Math.max(0, vh - minH));
          const w = Math.round(Math.min(Math.max(base.w + dx, minW), Math.max(minW, vw - x0)));
          const h = Math.round(Math.min(Math.max(base.h + dy, minH), Math.max(minH, vh - y0)));
          setFloatState({ x: x0, y: y0, w: w, h: h });
        }
      };
      const onUp = () => {
        setInteracting(null);
        dragRef.current = null;
        saveFloatState(floatStore.get());
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      return () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
    }, [interacting]);
    const startDrag = (kind, ev) => {
      if (ev.button !== 0 && ev.pointerType === "mouse") return;
      const s = floatStore.get();
      dragRef.current = { kind: kind, sx: ev.clientX, sy: ev.clientY, x: s.x, y: s.y, w: s.w, h: s.h };
      setInteracting(kind);
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch (e) {
      }
      ev.preventDefault();
    };
    const onHide = () => {
      const s = setFloatState({ collapsed: true });
      saveFloatState(s);
    };
    const onExpand = () => {
      const s = setFloatState({ collapsed: false });
      saveFloatState(s);
      notifyOpen();
    };
    const onReset = () => {
      const d = defaultFloatState();
      const s = setFloatState({ x: d.x, y: d.y, w: d.w, h: d.h, collapsed: false });
      saveFloatState(s);
    };
    // 2026-09-15「浮窗四角白边」修复（黑底矩阵实测，逐条排除后唯一有效机制）：
    //   Chrome 给子框架文档画布填**不透明白**（html/body 的 background:transparent 只作用于元素、
    //   不作用于画布 —— 实测清空面板内容后整块 iframe 呈纯白 255,255,255），且
    //   **composited iframe 会逃逸祖先的 overflow:hidden + border-radius 圆角裁切**。
    //   所以下面这些手段全都无效（黑底实测，圆角外白像素 12400~28651，一个都没消掉）：
    //   壳的圆角边框 / 同色 border / 同色画布 / clip-path（壳·body·root）/ contain:paint /
    //   transform / filter / isolation / iframe 自身 border-radius。
    //   唯一有效的是给 **iframe 自身**加圆角遮罩（见上面 .amad-float-frame 的 mask-image）：
    //   mask 由合成器作用在 iframe 自己的层上，圆角 36px 与 #phone、外壳的 36px 同 rect 同心，
    //   白边被彻底裁掉、轮廓完全对齐。
    //   ⚠ 本文件（client.js）是构建产物，client.mjs 是源码，**两者必须一致**：曾因为只改了产物、
    //   源码里还留着「同色 border + box-sizing」的旧 hack，险些在下次同步时把已修好的白边带回来。
    const shellCornerFill = hexDarken((config && config.colorBezel) || "#223058", 0.41);
    const shellStyle = {
      left: f.x + "px",
      top: f.y + "px",
      width: f.w + "px",
      height: f.h + "px",
      zIndex: FLOAT_Z,
      display: f.collapsed ? "none" : "block",
      background: shellCornerFill
    };
    return import_react.default.createElement(
      "div",
      { className: "amad-float-root" },
      import_react.default.createElement(
        "div",
        { className: "amad-float-shell", style: shellStyle },
        import_react.default.createElement("div", {
          className: "amad-float-strip",
          onPointerDown: (ev) => startDrag("move", ev)
        }),
        import_react.default.createElement(
          "div",
          { className: "amad-float-body" },
          import_react.default.createElement(SakikoFrame, { cls: "amad-float-frame" })
        ),
        import_react.default.createElement(
          "div",
          { className: "amad-float-chrome" },
          import_react.default.createElement(
            "button",
            {
              className: "amad-float-btn",
              title: "\u6536\u8D77 SAKIKO",
              "aria-label": "\u6536\u8D77 SAKIKO",
              onPointerDown: (ev) => ev.stopPropagation(),
              onClick: onHide
            },
            "\u2014"
          ),
          import_react.default.createElement(
            "button",
            {
              className: "amad-float-btn",
              title: "\u8FD8\u539F\u9ED8\u8BA4\u5927\u5C0F\u4E0E\u4F4D\u7F6E",
              "aria-label": "\u8FD8\u539F\u9ED8\u8BA4\u5927\u5C0F\u4E0E\u4F4D\u7F6E",
              onPointerDown: (ev) => ev.stopPropagation(),
              onClick: onReset
            },
            "\u2922"
          )
        ),
        import_react.default.createElement("div", {
          className: "amad-float-grip",
          onPointerDown: (ev) => startDrag("resize", ev)
        })
      ),
      f.collapsed
        ? import_react.default.createElement(
            "button",
            {
              className: "amad-float-dot",
              title: "\u5C55\u5F00 SAKIKO",
              "aria-label": "\u5C55\u5F00 SAKIKO",
              onClick: onExpand
            },
            "S"
          )
        : null
    );
  }
  function FloatHost() {
    const config = useStore(configStore);
    const floatOn = !config || config.floatPanel !== false;
    return import_react.default.createElement(
      "div",
      { className: "amad-float-host", style: { pointerEvents: "none" } },
      import_react.default.createElement(RootPoller),
      floatOn ? import_react.default.createElement(FloatShell) : null
    );
  }
  const VOICES = [
    ["ja-JP-NanamiNeural", "Nanami\uFF08\u5973\u58F0\uFF0C\u9ED8\u8BA4\uFF09"],
    ["ja-JP-KeitaNeural", "Keita\uFF08\u7537\u58F0\uFF09"],
    ["ja-JP-AoiNeural", "Aoi\uFF08\u5973\u58F0\uFF09"],
    ["ja-JP-MayuNeural", "Mayu\uFF08\u5973\u58F0\uFF09"],
    ["ja-JP-ShioriNeural", "Shiori\uFF08\u5973\u58F0\uFF09"],
    ["ja-JP-NaokiNeural", "Naoki\uFF08\u7537\u58F0\uFF09"],
    ["ja-JP-DaichiNeural", "Daichi\uFF08\u7537\u58F0\uFF09"]
  ];
  const RATES = ["-20%", "-10%", "+0%", "+10%", "+20%"];
  const PITCHES = ["-20Hz", "-10Hz", "+0Hz", "+10Hz", "+20Hz"];
  function Row(props) {
    return import_react.default.createElement(
      "div",
      { className: "amad-settings-row" },
      import_react.default.createElement(
        "div",
        null,
        import_react.default.createElement("div", { className: "amad-settings-label" }, props.label),
        props.desc ? import_react.default.createElement("div", { className: "amad-settings-desc" }, props.desc) : null
      ),
      props.control
    );
  }
  function Check(props) {
    return import_react.default.createElement("input", {
      type: "checkbox",
      checked: !!props.checked,
      onChange: (e) => props.onChange(!!e.target.checked)
    });
  }
  function Select(props) {
    const options = props.options.map((o) => import_react.default.createElement("option", { key: o[0], value: o[0] }, o[1]));
    return import_react.default.createElement("select", {
      value: props.value,
      onChange: (e) => props.onChange(e.target.value)
    }, options);
  }
  function TextInput(props) {
    return import_react.default.createElement("input", {
      type: props.type || "text",
      value: props.value || "",
      placeholder: props.placeholder || "",
      onChange: (e) => props.onChange(e.target.value),
      style: { flex: 1, minWidth: 0, border: "1px solid rgba(128,128,128,.4)", borderRadius: "6px", padding: "4px 8px", background: "transparent", color: "inherit" }
    });
  }

  function ColorControl(props) {
    return import_react.default.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px" } },
      import_react.default.createElement("input", {
        type: "color",
        value: props.value || "#000000",
        onChange: (e) => props.onChange(e.target.value),
        style: { width: "28px", height: "28px", border: "none", background: "transparent", padding: 0, cursor: "pointer" }
      }),
      import_react.default.createElement("span", { style: { fontSize: "11px", fontFamily: "monospace", color: "inherit", opacity: 0.75, minWidth: "52px" } }, String(props.value || "").toUpperCase())
    );
  }
  function SakikoSettings() {
    const config = useStore(configStore);
    const status = useStore(statusStore);
    if (!config) {
      return import_react.default.createElement(
        "div",
        null,
        import_react.default.createElement("div", { className: "amad-settings-row" }, import_react.default.createElement("span", null, status.error ? "\u26A0 \u65E0\u6CD5\u8FDE\u63A5 SAKIKO Host\uFF1A" + status.error : "\u6B63\u5728\u8FDE\u63A5 SAKIKO Host\u2026"))
      );
    }
    const group = (title) => import_react.default.createElement("div", { style: { marginTop: "18px", marginBottom: "4px", fontSize: "12px", fontWeight: 700, letterSpacing: "1px", color: "#c9a86a", textTransform: "uppercase" } }, title);
    const idleOptions = [[3e5, "5 \u5206\u949F"], [6e5, "10 \u5206\u949F"], [12e5, "20 \u5206\u949F\uFF08\u9ED8\u8BA4\uFF09"], [18e5, "30 \u5206\u949F"], [36e5, "60 \u5206\u949F"]];
    const pickIdle = (v) => idleOptions.find((o) => o[0] === v) ? v : 12e5;
    const humOptions = [[3e5, "5 \u5206\u949F"], [6e5, "10 \u5206\u949F"], [12e5, "20 \u5206\u949F\uFF08\u9ED8\u8BA4\uFF09"], [18e5, "30 \u5206\u949F"], [36e5, "60 \u5206\u949F"]];
    const pickHum = (v) => humOptions.find((o) => o[0] === v) ? v : 12e5;
    const narratorOptions = [[12e4, "2 \u5206\u949F"], [24e4, "4 \u5206\u949F\uFF08\u9ED8\u8BA4\uFF09"], [36e4, "6 \u5206\u949F"], [6e5, "10 \u5206\u949F"]];
    const pickNarr = (v) => narratorOptions.find((o) => o[0] === v) ? v : 24e4;
    // 里程碑「步数型」周期（与 narratorOptions 同款：Select + 兜底 pickSteps；非法/未知值一律显示 50）。
    // 5 个档位都落在 sanitize 可用区间（host.mjs 里 narratorMilestoneSteps 的 3~200；默认 50）之内；区间内其它合法值无档位、显示为兜底的 50。
    const stepOptions = [[10, "10 \u6B65"], [20, "20 \u6B65"], [50, "50 \u6B65\uFF08\u9ED8\u8BA4\uFF09"], [100, "100 \u6B65"], [200, "200 \u6B65"]];
    const pickSteps = (v) => stepOptions.find((o) => o[0] === v) ? v : 50;
    const narrCharsOptions = [[0, "\u4E0D\u6CE8\u5165\uFF08\u5173\u95ED\uFF09"], [200, "200 \u5B57"], [400, "400 \u5B57\uFF08\u9ED8\u8BA4\uFF09"], [600, "600 \u5B57"], [800, "800 \u5B57"], [1200, "1200 \u5B57"], [2000, "2000 \u5B57"]];
    const pickNarrChars = (v) => narrCharsOptions.find((o) => o[0] === v) ? v : 400;
    return import_react.default.createElement(
      "div",
      null,
      group("\u57FA\u672C\u5F00\u5173"),
      Row({ label: "\u8BED\u97F3\u6717\u8BFB", desc: "\u52A9\u624B\u56DE\u590D\u81EA\u52A8\u7531 SAKIKO \u6717\u8BFB", control: Check({ checked: config.voiceOn !== false, onChange: (v) => patchConfig({ voiceOn: v }) }) }),
      Row({ label: "AI \u804A\u5929", desc: "\u53F3\u680F\u5E95\u90E8\u4E0E SAKIKO \u76F4\u63A5\u5BF9\u8BDD\uFF08\u65E5\u8BED\u97F3\u9891 + \u4E2D\u6587\u6587\u5B57\uFF0C\u5E26\u957F\u671F\u8BB0\u5FC6\uFF09", control: Check({ checked: config.chatOn !== false, onChange: (v) => patchConfig({ chatOn: v }) }) }),
      Row({ label: "\u7A7A\u95F2\u95F2\u804A", desc: "\u957F\u65F6\u95F4\u4E0D\u4E92\u52A8\u65F6\uFF0C\u5979\u4E3B\u52A8\u627E\u8BDD\u9898\u5F00\u53E3\u8BF4\u8BDD", control: Check({ checked: config.idleChatOn !== false, onChange: (v) => patchConfig({ idleChatOn: v }) }) }),
      Row({ label: "\u7965\u5B50\u4EBA\u683C\u6CE8\u5165", desc: "\u8BA9 Agent \u4EE5\u7965\u5B50\u53E3\u543B\u56DE\u7B54\uFF0C\u4F5C\u7528\u4E8E\u6240\u6709\u4F1A\u8BDD", control: Check({ checked: config.personaOn === true, onChange: (v) => patchConfig({ personaOn: v }) }) }),
      Row({ label: "SAKIKO \u5168\u5C40\u4E3B\u9898", desc: "\u6574\u5957 GUI \u5F3A\u5236\u6DF1\u84DD SAKIKO \u914D\u8272\uFF08\u63D2\u4EF6\u505C\u6B62\u540E\u81EA\u52A8\u8FD8\u539F\uFF09", control: Check({ checked: config.themeOn !== false, onChange: (v) => patchConfig({ themeOn: v }) }) }),
      group("AI \u804A\u5929\uFF08\u72EC\u7ACB API\uFF0C\u7559\u7A7A\u5219\u7528 DSH \u9ED8\u8BA4\u6A21\u578B\uFF09"),
      Row({ label: "API \u5730\u5740", desc: "OpenAI \u517C\u5BB9\u683C\u5F0F", control: TextInput({ value: config.chatBaseUrl, placeholder: "https://api.deepseek.com/v1", onChange: (v) => patchConfig({ chatBaseUrl: v }) }) }),
      Row({ label: "\u6A21\u578B\u540D", control: TextInput({ value: config.chatModel, placeholder: "deepseek-chat", onChange: (v) => patchConfig({ chatModel: v }) }) }),
      Row({ label: "API Key", desc: "\u7559\u7A7A = \u4F7F\u7528 DSH \u9ED8\u8BA4\u6A21\u578B\u901A\u9053", control: TextInput({ type: "password", value: config.chatApiKey, placeholder: "sk-\u2026", onChange: (v) => patchConfig({ chatApiKey: v }) }) }),
      group("\u8BED\u97F3\u5408\u6210"),
      Row({ label: "TTS \u901A\u9053", desc: "\u4E3A\u4FDD\u8BC1\u58F0\u7EBF\u7EDF\u4E00\uFF0C\u9ED8\u8BA4\u4E0D\u81EA\u52A8\u5207\u6362\u97F3\u8272", control: Select({ value: config.provider, options: [["edge", "Edge TTS\uFF08\u9ED8\u8BA4\uFF0C\u7A33\u5B9A\uFF09"], ["voicevox", "\u672C\u5730 VOICEVOX"], ["quest", "VOICEVOX \u516C\u5171 API"], ["aqua", "\u672C\u5730 Aqua-TTS / GPT-SoVITS"], ["openai", "OpenAI \u517C\u5BB9 TTS"], ["auto", "\u81EA\u52A8\uFF08Aqua\u2192VOICEVOX\uFF0C\u4EC5\u5728\u663E\u5F0F\u5F00\u542F\u65F6\u5207\u516C\u5171\uFF09"]], onChange: (v) => patchConfig({ provider: v }) }) }),
      Row({ label: "\u97F3\u8272", control: Select({ value: config.voiceName, options: VOICES, onChange: (v) => patchConfig({ voiceName: v }) }) }),
      Row({ label: "\u5408\u6210\u6863\u4F4D\uFF08aqua\uFF09", desc: "\u672C\u5730\u7965\u5B50\u97F3\u8272\u7684\u91C7\u6837\u6B65\u6570\uFF1A\u6781\u901F\u66F4\u5FEB\uFF0C\u7CBE\u7EC6\u66F4\u7A33\uFF08\u5F53\u524D\u97F3\u8272: " + (config.aquaVoice || "sakiko") + "\uFF09", control: Select({ value: config.aquaPreset || "balanced", options: [["fast", "\u6781\u901F\uFF086\u6B65\uFF09"], ["balanced", "\u6807\u51C6\uFF0810\u6B65\uFF09"], ["quality", "\u7CBE\u7EC6\uFF0816\u6B65\uFF09"]], onChange: (v) => patchConfig({ aquaPreset: v }) }) }),
      Row({ label: "\u8BED\u901F", control: Select({ value: config.rate, options: RATES.map((r) => [r, r]), onChange: (v) => patchConfig({ rate: v }) }) }),
      Row({ label: "\u97F3\u8C03", control: Select({ value: config.pitch, options: PITCHES.map((p) => [p, p]), onChange: (v) => patchConfig({ pitch: v }) }) }),
      Row({ label: "\u60C5\u7EEA\u5F3A\u5EA6", desc: "\u653E\u5927/\u51CF\u5F31\u60C5\u7EEA prosody\uFF080.5~2.0\uFF0C\u9ED8\u8BA4 1.0\uFF09", control: Select({ value: String(config.emotionIntensity || 1), options: [["0.5", "0.5\uFF08\u514B\u5236\uFF09"], ["0.75", "0.75"], ["1", "1.0\uFF08\u9ED8\u8BA4\uFF09"], ["1.2", "1.2\uFF08\u7A0D\u5938\u5F20\uFF09"], ["1.5", "1.5\uFF08\u5938\u5F20\uFF09"], ["2", "2.0\uFF08\u6781\u5938\u5F20\uFF09"]], onChange: (v) => patchConfig({ emotionIntensity: Number(v) }) }) }),
      Row({ label: "\u4FDD\u6301\u58F0\u7EBF\u7A33\u5B9A", desc: "\u5F00\u542F\u540E TTS \u5931\u8D25\u4E5F\u4E0D\u5207\u5230\u5176\u5B83\u97F3\u8272\uFF08\u63A8\u8350\uFF09", control: Check({ checked: config.voiceStability !== false, onChange: (v) => patchConfig({ voiceStability: v }) }) }),
      Row({ label: "\u5931\u8D25\u5207\u516C\u5171 API", desc: "\u4EC5\u5F53\u201C\u4FDD\u6301\u58F0\u7EBF\u7A33\u5B9A\u201D\u5173\u95ED\u65F6\u751F\u6548", control: Check({ checked: config.fallbackToQuest === true, onChange: (v) => patchConfig({ fallbackToQuest: v }) }) }),
      group("\u8BED\u97F3\u8F93\u5165"),
      Row({ label: "\u8BC6\u522B\u65B9\u5F0F", control: Select({ value: config.sttProvider || "auto", options: [["auto", "\u81EA\u52A8\uFF08\u4F18\u5148\u6D4F\u89C8\u5668\u8BC6\u522B\uFF09"], ["browser", "\u4EC5\u6D4F\u89C8\u5668\u8BC6\u522B"], ["api", "\u540E\u7AEF Whisper API"]], onChange: (v) => patchConfig({ sttProvider: v }) }) }),
      Row({ label: "STT API \u5730\u5740", desc: "\u7559\u7A7A\u4F7F\u7528 AI API \u5730\u5740", control: TextInput({ value: config.sttApiUrl, placeholder: "https://api.openai.com/v1", onChange: (v) => patchConfig({ sttApiUrl: v }) }) }),
      Row({ label: "STT API Key", desc: "\u7559\u7A7A\u4F7F\u7528 AI API Key", control: TextInput({ type: "password", value: config.sttApiKey, placeholder: "sk-\u2026", onChange: (v) => patchConfig({ sttApiKey: v }) }) }),
      Row({ label: "STT \u6A21\u578B", control: TextInput({ value: config.sttModel || "whisper-1", placeholder: "whisper-1", onChange: (v) => patchConfig({ sttModel: v }) }) }),
      group("\u4E3B\u52A8\u4E92\u52A8\u8282\u594F"),
      Row({ label: "\u7A7A\u95F2\u591A\u4E45\u5F00\u53E3", control: Select({ value: pickIdle(config.idleChatMs), options: idleOptions, onChange: (v) => patchConfig({ idleChatMs: Number(v) }) }) }),
      Row({ label: "\u968F\u673A\u54FC\u6B4C", desc: "\u5979\u5FC3\u60C5\u597D\u65F6\u4F1A\u968F\u673A\u54FC\u4E00\u6BB5\u5C0F\u66F2\uFF08\u5F69\u86CB\uFF09", control: Check({ checked: config.humOn !== false, onChange: (v) => patchConfig({ humOn: v }) }) }),
      Row({ label: "\u54FC\u6B4C\u95F4\u9694", control: Select({ value: pickHum(config.humIntervalMs), options: humOptions, onChange: (v) => patchConfig({ humIntervalMs: Number(v) }) }) }),
      group("\u8FDB\u5EA6\u64AD\u62A5"),
      Row({ label: "\u8FDB\u5EA6\u64AD\u62A5", desc: "\u7965\u5B50\u64AD\u62A5\u4EFB\u52A1\u8FDB\u5C55\uFF1A\u5F00\u5DE5\u3001\u5B8C\u6210\u3001\u91CC\u7A0B\u7891\u4E0E\u963B\u585E", control: Check({ checked: config.narratorOn !== false, onChange: (v) => patchConfig({ narratorOn: v }) }) }),
      Row({ label: "LLM \u56DE\u5408\u603B\u7ED3", desc: "\u6BCF\u56DE\u5408\u5B8C\u6210\u65F6\u7531 LLM \u603B\u7ED3\u505A\u4E86\u4EC0\u4E48+\u4E0B\u4E00\u6B65\uFF08\u5931\u8D25\u81EA\u52A8\u9000\u56DE\u6A21\u677F\u53E5\uFF09", control: Check({ checked: config.narratorLLMSummary !== false, onChange: (v) => patchConfig({ narratorLLMSummary: v }) }) }),
      Row({ label: "\u6BCF\u56DE\u5408\u5B8C\u6210\u64AD\u62A5", desc: "\u5173\u95ED\u540E\u53EA\u4FDD\u7559\u91CC\u7A0B\u7891\u4E0E\u963B\u585E\u7B49\u5173\u952E\u8282\u70B9", control: Check({ checked: config.narratorDone !== false, onChange: (v) => patchConfig({ narratorDone: v }) }) }),
      Row({ label: "\u64AD\u62A5\u5B50\u4EE3\u7406\u4F1A\u8BDD", desc: "\u5B50\u4EE3\u7406/\u540E\u53F0\u4F1A\u8BDD\u7684\u5F00\u5DE5\u4E0E\u5B8C\u6210\u4E5F\u4F1A\u64AD\u62A5\uFF1B\u5173\u95ED\u540E\u4E0D\u518D\u64AD\u62A5\uFF08\u5B50\u4EE3\u7406\u5B8C\u6210\u63D0\u793A\u4ECD\u4F1A\u4FDD\u7559\uFF09", control: Check({ checked: config.narrateSubagents !== false, onChange: (v) => patchConfig({ narrateSubagents: v }) }) }),
      Row({ label: "\u91CC\u7A0B\u7891\u95F4\u9694", desc: "\u5355\u56DE\u5408\u8DD1\u6EE1\u8BE5\u65F6\u957F\u5373\u64AD\u62A5\u4E00\u6B21\u8FDB\u5C55", control: Select({ value: pickNarr(config.narratorMilestoneMs), options: narratorOptions, onChange: (v) => patchConfig({ narratorMilestoneMs: Number(v) }) }) }),
      Row({ label: "\u91CC\u7A0B\u7891\u6B65\u6570", desc: "\u5355\u56DE\u5408\u5185\u6BCF\u6EE1\u8FD9\u4E48\u591A\u6B65\uFF08\u5DE5\u5177\u8C03\u7528\uFF09\u5C31\u518D\u64AD\u4E00\u6761\uFF1B\u4E0E\u300C\u91CC\u7A0B\u7891\u95F4\u9694\u300D\u4EFB\u4E00\u5148\u5230\u5373\u89E6\u53D1", control: Select({ value: pickSteps(config.narratorMilestoneSteps), options: stepOptions, onChange: (v) => patchConfig({ narratorMilestoneSteps: Number(v) }) }) }),
      Row({ label: "\u52A9\u624B\u6587\u672C\u9884\u7B97", desc: "\u603B\u7ED3\u65F6\u5582\u7ED9 LLM \u7684\u300C\u672C\u8F6E\u52A9\u624B\u56DE\u590D\u300D\u5B57\u7B26\u4E0A\u9650\uFF1B\u8D85\u51FA\u65F6\u4FDD\u7559\u9996\u5C3E\u5404\u4E00\u6BB5\uFF08\u4E2D\u95F4\u7701\u7565\uFF09\uFF1B0 = \u4E0D\u6CE8\u5165\u8BE5\u884C", control: Select({ value: pickNarrChars(config.narratorAssistantChars), options: narrCharsOptions, onChange: (v) => patchConfig({ narratorAssistantChars: Number(v) }) }) }),
      group("\u5916\u89C2\u4E0E\u5E03\u5C40"),
      Row({ label: "\u4E3B\u9898\u9884\u8BBE", control: Select({ value: config.themePreset || "sakiko-blue", options: [["sakiko-blue", "\u6DF1\u84DD\u6708\u767D\u91D1\uFF08\u9ED8\u8BA4\uFF09"], ["midnight-gold", "\u66AE\u84DD\u938F\u91D1"], ["sakura-pink", "\u6A31\u7C89\u6708\u767D"], ["mono", "\u6708\u7070\u5355\u8272"]], onChange: (v) => patchConfig({ themePreset: v }) }) }),
      Row({ label: "\u4E3B\u5E95\u6E10\u53D81", control: ColorControl({ value: config.colorBg1, onChange: (v) => patchConfig({ colorBg1: v }) }) }),
      Row({ label: "\u4E3B\u5E95\u6E10\u53D82", control: ColorControl({ value: config.colorBg2, onChange: (v) => patchConfig({ colorBg2: v }) }) }),
      Row({ label: "\u673A\u8EAB/\u5916\u6846", control: ColorControl({ value: config.colorBezel, onChange: (v) => patchConfig({ colorBezel: v }) }) }),
      Row({ label: "\u6807\u9898\u6587\u5B57", control: ColorControl({ value: config.colorTitle, onChange: (v) => patchConfig({ colorTitle: v }) }) }),
      Row({ label: "\u6211\u65B9\u6C14\u6CE1", control: ColorControl({ value: config.colorBubbleMe, onChange: (v) => patchConfig({ colorBubbleMe: v }) }) }),
      Row({ label: "\u7965\u5B50\u6C14\u6CE1", control: ColorControl({ value: config.colorBubbleHer, onChange: (v) => patchConfig({ colorBubbleHer: v }) }) }),
      Row({ label: "\u6C14\u6CE1\u6587\u5B57", control: ColorControl({ value: config.colorBubbleText, onChange: (v) => patchConfig({ colorBubbleText: v }) }) }),
      Row({ label: "\u6309\u94AE\u5F3A\u8C03", control: ColorControl({ value: config.colorBtn, onChange: (v) => patchConfig({ colorBtn: v }) }) }),
      Row({ label: "\u9AD8\u4EAE\u6587\u5B57", control: ColorControl({ value: config.colorHi, onChange: (v) => patchConfig({ colorHi: v }) }) }),
      Row({ label: "\u72B6\u6001\u70B9", control: ColorControl({ value: config.colorDot, onChange: (v) => patchConfig({ colorDot: v }) }) }),
      Row({ label: "\u804A\u5929\u80CC\u666F\u56FE", desc: "\u7559\u7A7A = \u9ED8\u8BA4\u80CC\u666F\uFF1B\u4EC5\u652F\u6301 http(s)://", control: TextInput({ value: config.chatBgUrl || "", placeholder: "https://\u2026", onChange: (v) => patchConfig({ chatBgUrl: v.trim() }) }) }),
      Row({ label: "\u754C\u9762\u5E03\u5C40", desc: "\u5207\u6362\u4E3A\u53F3\u4FA7\u680F\u65F6\u6D6E\u7A97\u6D88\u5931\u5C5E\u9884\u671F", control: Select({ value: String(config.floatPanel !== false), options: [["true", "\u6D6E\u7A97"], ["false", "\u53F3\u4FA7\u680F"]], onChange: (v) => patchConfig({ floatPanel: v === "true" }) }) }),
      import_react.default.createElement("div", { style: { fontSize: "12px", color: "#a8b6d8", padding: "8px 4px 0" } }, "\u8BBE\u7F6E\u5373\u65F6\u751F\u6548\uFF0C\u53EF\u8FB9\u8C03\u8FB9\u770B\u53F3\u4E0B\u89D2\u6D6E\u7A97\u3002"),
      import_react.default.createElement("div", { style: { marginTop: "6px" } },
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: () => patchConfig({ themePreset: "sakiko-blue", colorBg1: "#101a33", colorBg2: "#0b1224", colorTitle: "#eef2fb", colorBubbleMe: "#3b6fd4", colorBubbleHer: "#eef2fb", colorBubbleText: "#ffffff", colorBtn: "#c9a86a", colorHi: "#8fb3ff", colorDot: "#a8b6d8", chatBgUrl: "" }) }, "\u91CD\u7F6E\u4E3A\u9ED8\u8BA4\u5916\u89C2")
      ),

      import_react.default.createElement(
        "div",
        { style: { marginTop: "16px" } },
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: () => rpcSay("\u7533\u3057\u9045\u308C\u307E\u3057\u305F \u79C1 \u8C4A\u5DDD\u7965\u5B50\u3068\u7533\u3057\u307E\u3059") }, "\u{1F4AC} \u6D4B\u8BD5\u8BED\u97F3"),
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: async () => {
          const r = await rpcTestChat();
          window.alert(r && r.ok ? "AI API OK: " + r.content : "AI API Error: " + (r && r.error ? r.error : "unknown"));
        } }, "\u{1F50C} \u6D4B\u8BD5 AI API"),
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: rpcRepeat }, "\u21BA \u91CD\u64AD\u4E0A\u4E00\u6761"),
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: rpcClear }, "\u{1F9F9} \u6E05\u7A7A\u961F\u5217"),
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: () => {
          notifyOpen();
          if (layout) layout.openDetails();
        } }, "\u{1F441} \u6253\u5F00\u53F3\u4FA7\u680F"),
        import_react.default.createElement("button", { className: "amad-settings-btn", onClick: () => {
          if (layout) layout.closeDetails();
        } }, "\u{1F6AB} \u5173\u95ED\u53F3\u4FA7\u680F")
      ),
      import_react.default.createElement(
        "div",
        { className: "amad-settings-row", style: { marginTop: "10px" } },
        import_react.default.createElement(
          "span",
          { style: { fontSize: "12px", color: "#a8b6d8" } },
          status.error ? "\u26A0 host \u4E0D\u53EF\u8FBE" : "\u25CF " + (status.tts || "\u2026") + " \xB7 \u961F\u5217 " + status.queue + (status.callPending ? " \xB7 \u{1F4DE} \u6765\u7535\u4E2D" : "")
        )
      ),
      import_react.default.createElement("div", { className: "amad-warn" }, "\u6CE8\u610F\uFF1A\u53F3\u4FA7\u680F\u4E3A SAKIKO\uFF08\u4E30\u5DDD\u7965\u5B50\uFF09\u4E13\u7528\uFF0C\u539F\u300C\u5DE5\u5177\u8BE6\u60C5\u300D\u9762\u677F\u5728\u63D2\u4EF6\u8FD0\u884C\u671F\u95F4\u88AB\u66FF\u4EE3\uFF0C\u505C\u6B62\u63D2\u4EF6\u540E\u6062\u590D\u3002\u89D2\u8272\u7248\u6743\u5F52 Bushiroad/BanG Dream! \u9879\u76EE\uFF1BLive2D \u6A21\u578B\u4E3A\u7C89\u4E1D\u5236\u4F5C\uFF0C\u4EC5\u4F9B\u4E2A\u4EBA\u5B66\u4E60\uFF0C\u7981\u6B62\u5546\u7528\u3002")
    );
  }
  function SidebarToggle(props) {
    const config = useStore(configStore);
    const wide = !!(props && props.wide);
    if (!config || config.floatPanel !== false) return null;
    return import_react.default.createElement("button", {
      className: "amad-sb-btn",
      title: "\u6253\u5F00 SAKIKO \u53F3\u4FA7\u680F",
      onClick: () => {
        notifyOpen();
        if (layout) layout.openDetails();
      }
    }, wide ? "SAKIKO" : "S");
  }
  slots.inject("details", () => slots.register(
    { name: "details", priority: -1 },
    () => import_react.default.createElement(SakikoColumn)
  ));
  slots.inject("sidebar.footer.action", () => slots.register(
    { name: "sidebar.footer.action", id: "sakiko", order: 50, label: "SAKIKO" },
    (props) => import_react.default.createElement(SidebarToggle, props)
  ));
  slots.inject("shell.overlay", () => slots.register(
    { name: "shell.overlay", id: "sakiko", order: 60, label: "SAKIKO" },
    () => import_react.default.createElement(FloatHost)
  ));
  slots.inject("settings.section", () => slots.register(
    { name: "settings.section", id: "sakiko", order: 90, label: "SAKIKO" },
    () => import_react.default.createElement(
      "div",
      null,
      import_react.default.createElement("h2", null, "SAKIKO"),
      import_react.default.createElement(SakikoSettings)
    )
  ));
  applyTheme(true);
  openDetailsSafe();
  rpcReport("openDetails called (immediate)");
  ctx.timeout(() => {
    openDetailsSafe();
    rpcReport("openDetails retry (2s)");
  }, 2e3);
  ctx.on("connection/reset", () => {
    rpcReport("connection/reset -> openDetails");
    openDetailsSafe();
  });
}
return module.exports; } });
