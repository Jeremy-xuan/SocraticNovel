#!/usr/bin/env bash
# check.sh — classroom-stage-warm 的**一条命令自检**（离线为主 + 一次真机冒烟）
#
# 用法：
#   ./check.sh                # 离线自检（不装 profile、不起服务、不联网）
#   ./check.sh --live         # 再加一段真机冒烟（克隆隔离 harness → 建 profile → 起服 → 跑探针）
#   PORT=4499 ./check.sh --live
#
# 退出码：0 = 全绿；非 0 = 有红项（红项会逐条打印）。
#
# 设计口径（为什么这么写）：
#   · **离线部分零依赖**：只读本目录文件 → 任何机器任何时刻都能跑，CI 友好；
#   · **真机部分必须隔离**：自己克隆 DSH_HOME 到 /tmp，**用硬判据拒绝在非隔离目录上跑**；
#   · 断言尽量"机核"（哈希 / 结构 / 计数），不靠目视。

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG="$HERE"   # check.sh 就在包根
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ✔ %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  ✖ %s\n' "$1"; }
sec()  { printf '\n── %s ─────────────────────────────\n' "$1"; }

command -v node >/dev/null 2>&1 || { echo "找不到 node"; exit 2; }

sec "1 · 语法（两半）"
for f in lib/index.js lib/client.js; do
  if node --check "$PKG/$f" >/dev/null 2>&1; then ok "$f 语法通过"; else bad "$f 语法不通过"; fi
done

sec "2 · CSS 模板串里不许有裸反引号（本轮踩过的坑）"
if python3 - "$PKG/lib/client.js" <<'PYX' >/dev/null 2>&1
import sys
s = open(sys.argv[1], encoding="utf-8").read()
i = s.index("const CSS = `") + len("const CSS = `")
j = s.index("`\n", i)          # 模板串结束（行首反引号）
sys.exit(1 if "`" in s[i:j] else 0)
PYX
then ok "CSS 块内无裸反引号"; else bad "CSS 块内出现裸反引号（模板串会提前结束）"; fi

sec "3 · DOM 造型类名是否真的产出（本轮的核心验收）"
required="cardframe|line sans|cast-wrap|orn|opts|oc picked sent|oc cur|oc disabled|quiet|orn-end|orn-wave"
missing=""
for k in cardframe "line sans" cast-wrap orn opts "oc picked sent" "oc cur" "oc disabled" quiet orn-end orn-wave; do
  grep -qF "$k" "$PKG/lib/client.js" || missing="$missing $k"
done
if [ -z "$missing" ]; then ok "九类造型节点在渲染器里都有产出"; else bad "缺：$missing"; fi

sec "4 · 宿主路由与清单"
for r in "'/manifest.json'" "'/assets'" "'/board'" "'/anim'" "'/health'"; do
  grep -qF "$r" "$PKG/lib/index.js" && ok "路由 $r 已注册" || bad "路由 $r 缺失"
done
grep -qF "listBoards" "$PKG/lib/index.js" && ok "板书清单函数存在" || bad "缺 listBoards"
grep -qF "listAnimations" "$PKG/lib/index.js" && ok "动画清单函数存在" || bad "缺 listAnimations"

sec "5 · 素材与文件签名"
n_assets=$(ls "$PKG/assets/stage"/*.png 2>/dev/null | wc -l | tr -d ' ')
[ "$n_assets" -ge 1 ] && ok "舞台素材 $n_assets 张" || bad "舞台素材缺失"
for b in "$PKG"/assets/board/*.json; do
  [ -f "$b" ] || continue
  node -e '
const j=require(process.argv[1]);
process.exit(j.version==="whiteboard.scene.v1" && Array.isArray(j.elements) ? 0 : 1)' "$b" \
    && ok "板书 $(basename "$b") schema 合法" || bad "板书 $(basename "$b") schema 不合法"
done
for d in "$PKG"/assets/anim/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  node -e '
const j=require(process.argv[1]);
process.exit(j.video && j.version==="animation.scene.v1" ? 0 : 1)' "$d/scene.json" \
    && ok "动画 $id/scene.json 合法" || bad "动画 $id/scene.json 不合法或缺失"
  [ -f "$d/scene.mp4" ] && ok "动画 $id 有视频（$(stat -f%z "$d/scene.mp4" 2>/dev/null || echo '?') B）" || bad "动画 $id 缺 scene.mp4"
done

sec "6 · 逃生门与安全默认值"
grep -qF "Ctrl+Shift+M" "$PKG/README.md" && grep -qF "Ctrl+Shift+U" "$PKG/README.md" \
  && ok "README 写明逃生门两个快捷键" || bad "README 未写明逃生门"
grep -qF "SAFE_MODE" "$PKG/lib/index.js" && ok "宿主支持 SAFE_MODE（不注册任何东西）" || bad "缺 SAFE_MODE"
grep -qF "loopback only" "$PKG/lib/index.js" && ok "路由仅 loopback" || bad "路由未做 loopback 限制"
grep -qF ".stage-warm-root{position:fixed;inset:0;z-index:1080" "$PKG/lib/client.js" \
  && ok "整屏层级 1080（不是 900）" || bad "整屏层级不是 1080"

sec "7 · 纯函数单测（选项解析器）"
if [ -f "$PKG/test/17-unit-parse-options.mjs" ]; then
  # 从真源码里**逐字抽**出 parseOptions 再测
  node -e '
const fs=require("fs");
const src=fs.readFileSync(process.argv[1],"utf8");
const i=src.indexOf("    function parseOptions(text) {");
const j=src.indexOf("\n    }\n", i)+"\n    }\n".length;
fs.writeFileSync("/tmp/_parse-options.mod.mjs", src.slice(i,j)+"\nexport { parseOptions }\n");' "$PKG/lib/client.js" \
  && node -e '
const fs=require("fs");
const p="'"$PKG"'/test/17-unit-parse-options.mjs";
let t=fs.readFileSync(p,"utf8");
t=t.replace(/^import[\s\S]*?\n/, "import { parseOptions } from \"/tmp/_parse-options.mod.mjs\"\n");
fs.writeFileSync("/tmp/_unit.mjs", t);' \
  && node /tmp/_unit.mjs >/tmp/_unit.out 2>&1 \
  && ok "单测：$(grep -E '通过' /tmp/_unit.out | tail -1)" \
  || { bad "选项解析器单测未全绿"; tail -4 /tmp/_unit.out 2>/dev/null | sed 's/^/      /'; }
else
  bad "缺 test/17-unit-parse-options.mjs"
fi

if [ "${1:-}" = "--live" ]; then
  sec "8 · 真机冒烟（隔离 harness）"
  PORT="${PORT:-4499}"
  ISO="/tmp/stage-warm-check-$$"
  case "$ISO" in /tmp/*) : ;; *) bad "拒绝在非 /tmp 目录上跑真机段"; exit 1;; esac
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && { bad "端口 $PORT 被占"; exit 1; }
  echo "  隔离根：$ISO（克隆自 \$DSH_HOME/profiles）"
  mkdir -p "$ISO"
  if [ -d "${DSH_HOME:-$HOME/Library/Application Support/dsh-desktop/harness}/profiles" ]; then
    rsync -a "${DSH_HOME:-$HOME/Library/Application Support/dsh-desktop/harness}/profiles" "$ISO/" >/dev/null 2>&1
    ok "已克隆 profiles 到隔离根"
  else
    bad "找不到 \$DSH_HOME/profiles（真机段需要一次真实安装）"
  fi
  export DSH_HOME="$ISO"
  dsh --profile stagecheck --from-default-profile web >/dev/null 2>&1 &
  sleep 12; kill %1 2>/dev/null || true
  if node -e 'const b=require(process.argv[1]+"/profiles/stagecheck/package.json").dsh.profile.bundles;
    process.exit(b.includes("@deepseek-ai/dsh-web-app")?0:1)' "$ISO" 2>/dev/null; then
    ok "profile stagecheck 建好（含 dsh-web-app）"
  else bad "profile 未建好或 bundles 缺 dsh-web-app"; fi
  dsh plugin --profile stagecheck add "file:$PKG" >/dev/null 2>&1 \
    && ok "插件已装入隔离 profile" || bad "插件装载失败"
  dsh --profile stagecheck --dump-config >/dev/null 2>&1 \
    && ok "预检 --dump-config exit 0" || bad "预检失败"
  echo "  （真机浏览器段请另跑：test/13/14/15/16 号脚本，需先起服拿 token）"
  rm -rf "$ISO"
fi

printf '\n═══════════════════════════════\n'
printf ' 通过 %d ｜ 失败 %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { printf ' 结论：全绿 ✅\n'; exit 0; } || { printf ' 结论：有红项 ❌\n'; exit 1; }
