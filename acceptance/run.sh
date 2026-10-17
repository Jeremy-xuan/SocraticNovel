#!/usr/bin/env bash
# run.sh — 验收流水线的**唯一入口**：一条命令跑完「冻结 → 装载 → 真实课堂 → 六条断言 → 归档」
#
# 用法（**从仓库任意位置调用都可以**；所有路径都按仓库根解析，见下）：
#   ./acceptance/run.sh                 # 完整跑（含真实会话，会花钱，约 2–3 轮）
#   ./acceptance/run.sh --skip-session  # 只验阶段①②（冻结 + 装载 + 逐文件哈希复核），不跑会话、不花钱
#   ./acceptance/run.sh --keep-profile  # 复用已有专用 profile（默认每次从 shipped 模板重建，保证干净起点）
#   ./acceptance/run.sh --turns 2       # 改轮数（1..4）
#
# ═══════════════════════════════════════════════════════════════════════════════
# 🔴 本仓库版相对原始工作树版改了什么（只改"怎么找到东西"，不改判据）
# ═══════════════════════════════════════════════════════════════════════════════
#   ① **所有路径从仓库根解析**：被测对象＝`plugins/socratic-engine`、`classrooms/cs-os`、
#      `skills/socratic-classroom`；本流水线的产物全在 `acceptance/` 下。**没有任何绝对路径**。
#   ② **DSH_HOME 强制隔离**（本节下面那一段就是它）：绝不在用户真实 harness 上跑。
#      `DSH_HOME` 环境变量在本环境里**本来**就指向真 harness，所以这里**硬判**、不靠 `??`。
#   ③ node / dsh CLI 用**探测＋环境变量覆盖**，不再写死某台机器的路径。
#   ④ 教学动画的渲染环境改由环境变量给出（`SOCRATIC_ANIMATION_ENV_DIR`／`SOCRATIC_ANIMATION_GATE`）：
#      渲染环境是**部署侧的事实**（一个装了 manim 的 venv），不进本仓库。
#      🔴 而且**只有教室声明了 `animation:` 段时**才要求它 —— 教室没声明＝引擎不做那条自检＝本项不适用。
#
# 🔴 隔离 DSH_HOME（**硬判，不是默认值兜底**）：
#   · `ACCEPT_DSH_HOME_ROOT`（默认 `$TMPDIR/socratic-accept-dsh`）＝本次运行的隔离根；
#   · `DSH_HOME` 必须落在隔离根**之下**，否则本脚本**拒绝运行**（exit 2）；
#   · 想换根就设 `ACCEPT_DSH_HOME_ROOT=<另一个隔离目录>`；想用一个已经在别处的隔离目录，
#     就同时设 `ACCEPT_DSH_HOME_ROOT` 与 `DSH_HOME`（两者必须相容）。
#   ⚠️ 为什么必须这么硬：`DSH_HOME ?? 默认值` 这种写法在本机是**无效**的（环境变量本来就指向
#      真 harness），会静默在真 harness 上建 profile、装插件、跑会话。
#
# 🔴 教学动画（ACCEPT-3）：
#   引擎的设计是"教室声明了动画、但部署没配渲染环境 → **装载时报错**"（有意为之，不静默降级）。
#   → 本流水线在阶段①**问教室有没有声明**，声明了才要求渲染环境，**配不上就大声失败**
#     并打印"怎么把它指过来"。
#   → 唯一允许的降级是**人显式关掉教室的 animation 段**（会留痕，不是静默跳过）：
#       ./acceptance/run.sh --disable-classroom-animation --animation-disable-reason "<为什么关>"
#     它只改**工作副本**教室，`classrooms/**` 一个字都不动。
#
# 🔴 零接触守卫的归因＝**写足迹**（`lib/footprint.mjs`）：
#   先列"允许写的位置"（`05-conclusion/write-footprint-whitelist.md`），再判"被改的东西在不在里面"；
#   `--skip-session` 这条省钱路径也照判。
#   🔴 负向对照（**只用来证明守卫不是永远绿**，跑它本来就该判红、退出码非零）：
#       ACCEPT4_NEGATIVE_CONTROL=outside-write ./acceptance/run.sh --skip-session
#
# 🔴 技能包自检两份都跑：源包判**内容**（①–④ 必须全绿）＋ 已装副本（`$DSH_HOME/skills/…`）
#   判**发现链路**（应当 exit 0 全绿；**本机没装就明确报"未安装、该检查跳过"**，不静默）。
#
# 🔴 不花钱的机核（都可直接跑，退出码 0＝一致）：
#   node acceptance/footprint-self-test.mjs   # 写足迹守卫自检
#   node acceptance/whitelist-self-test.mjs   # 宿主告警白名单自检
#   node acceptance/frequency-parity.mjs      # 频率语义"两处实现"逐格比对（生产侧 ↔ 验收侧）
#   node acceptance/dynamic-blocks.test.mjs   # A2 运行期动态块的折算与推导模型单测
#
# 退出码：六条断言全通过 → 0；任何一条失败或流程致命错误 → 非零。
#         `--skip-session`：完整性守卫（含零接触写足迹）全通过 → 0，否则非零。
#         环境不成立（找不到 node/dsh、DSH_HOME 没隔离）→ 2。
#
# 🔴 纪律：
#   · 只写 acceptance/** 与报告；不改 plugins/**、classrooms/**、skills/**、clients/**
#   · 绝不碰用户真实 DSH profile；web／桌面 profile 只在运行前后做只读哈希快照比对
#   · 绝不把任何 @deepseek-ai/* 包装进 profile 或插件 node_modules

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

# ── ① 隔离根：本次运行只许写它下面 ────────────────────────────────────────────
# $TMPDIR 常以 `/` 收尾（macOS 如此）→ 先去掉，免得打印出 `T//…` 这种双斜杠
TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
ACCEPT_DSH_HOME_ROOT="${ACCEPT_DSH_HOME_ROOT:-$TMP_BASE/socratic-accept-dsh}"
export ACCEPT_DSH_HOME_ROOT
DSH_HOME="${DSH_HOME:-$ACCEPT_DSH_HOME_ROOT/harness}"
export DSH_HOME

# 🔴 硬判：把两边都规范化（realpath）后按**路径段**判前缀。
#    用 realpath 是因为 macOS 的 $TMPDIR 是 /var/folders/…，真实路径是 /private/var/folders/…
canon() {
  if [ -e "$1" ]; then (cd "$1" 2>/dev/null && pwd -P) || printf '%s' "$1"; else printf '%s' "$1"; fi
}
ISO_ROOT_CANON="$(canon "$ACCEPT_DSH_HOME_ROOT")"
DSH_HOME_CANON="$(canon "$(dirname "$DSH_HOME")")/$(basename "$DSH_HOME")"

case "$DSH_HOME_CANON" in
  "$ISO_ROOT_CANON"|"$ISO_ROOT_CANON"/*) ;;
  *)
    echo "[run.sh] ✖ 拒绝运行：DSH_HOME 不在本次运行的隔离根之下。" >&2
    echo "[run.sh]   DSH_HOME             = $DSH_HOME" >&2
    echo "[run.sh]   ACCEPT_DSH_HOME_ROOT = $ACCEPT_DSH_HOME_ROOT" >&2
    echo "[run.sh]   本流水线会建 profile、装插件、跑会话 —— 只许写隔离目录。" >&2
    echo "[run.sh]   改法二选一：① unset DSH_HOME（自动用 \$ACCEPT_DSH_HOME_ROOT/harness）；" >&2
    echo "[run.sh]              ② ACCEPT_DSH_HOME_ROOT=<包含它的那个隔离目录> DSH_HOME=<...> ./acceptance/run.sh" >&2
    exit 2
    ;;
esac
case "$DSH_HOME_CANON" in
  *"/Library/Application Support/"*|*dsh-desktop*)
    echo "[run.sh] ✖ 拒绝运行：DSH_HOME 看起来是用户的真实 harness：$DSH_HOME" >&2
    exit 2
    ;;
esac

mkdir -p "$DSH_HOME" || { echo "[run.sh] ✖ 建不出隔离的 DSH_HOME：$DSH_HOME" >&2; exit 2; }
echo "[run.sh] 隔离根 ACCEPT_DSH_HOME_ROOT=$ACCEPT_DSH_HOME_ROOT"
echo "[run.sh] DSH_HOME=$DSH_HOME（已隔离；**不是**用户真实 harness）"

# ── ② node：环境变量 → 真实 node（绕开 DSH Desktop 的 Electron 壳）───────────
NODE="${ACCEPT_NODE:-}"
if [ -z "$NODE" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  else
    echo "[run.sh] ✖ 找不到 node（用 ACCEPT_NODE=<node 路径> 覆盖）" >&2
    exit 2
  fi
fi
if ! "$NODE" --version >/dev/null 2>&1; then
  echo "[run.sh] ✖ 这个 node 跑不起来：$NODE（用 ACCEPT_NODE= 覆盖）" >&2
  exit 2
fi
export ACCEPT_NODE="$NODE"

# ── ③ dsh CLI 入口：环境变量 → PATH → 已知安装位置（探测，不写死）────────────
DSH_BIN="${DSH_BIN:-}"
if [ -z "$DSH_BIN" ]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_BIN="$(command -v dsh)"
  else
    for c in \
      "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js" \
      "$HOME/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js"; do
      if [ -f "$c" ]; then DSH_BIN="$c"; break; fi
    done
  fi
fi
if [ -z "$DSH_BIN" ] || [ ! -f "$DSH_BIN" ]; then
  echo "[run.sh] ✖ 找不到 dsh CLI 入口（用 DSH_BIN=<…/@deepseek-ai/dsh/lib/bin.js> 指过来）" >&2
  exit 2
fi
export DSH_BIN

echo "[run.sh] REPO_ROOT=$REPO_ROOT"
echo "[run.sh] DSH_BIN=$DSH_BIN"
echo "[run.sh] NODE=$NODE"

# 🔴 不接受 web / 桌面 profile 作为验收目标
export ACCEPT_PROFILE="${ACCEPT_PROFILE:-socratic-accept}"
case "$ACCEPT_PROFILE" in
  web|desktop|desktop-safe-mode)
    echo "[run.sh] ✖ 拒绝把受保护 profile 当作验收目标：$ACCEPT_PROFILE" >&2
    exit 2
    ;;
esac
echo "[run.sh] ACCEPT_PROFILE=$ACCEPT_PROFILE"

# 🔴 教学动画渲染环境（可选；只有教室声明了 animation 段时才必需）。
#    这里只**透传**，不猜路径：配不上时流水线自己会大声失败并打印怎么配。
echo "[run.sh] SOCRATIC_ANIMATION_ENV_DIR=${SOCRATIC_ANIMATION_ENV_DIR:-<未设置>}"
echo "[run.sh] SOCRATIC_ANIMATION_GATE=${SOCRATIC_ANIMATION_GATE:-<未设置>}"

exec "$NODE" "$HERE/accept.mjs" "$@"
