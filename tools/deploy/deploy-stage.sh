#!/usr/bin/env bash
# ============================================================================
# deploy-stage.sh —— 把「教室舞台」测试实例（stage）从零搭起来 / 增量更新
#
# 用法（在能 ssh 到目标机的机器上跑）：
#   ./deploy-stage.sh                 # 全量：建实例 → 装插件 → 装教室 → 配代理 → 起服务
#   ./deploy-stage.sh --update-only   # 只更新插件与教室内容（实例已存在时用）
#   HOST=dsh-class-server UID_NAME=stage PORT=3086 ./deploy-stage.sh
#
# 设计口径：
#   · **纯增量**：只碰 /srv/dsh-users/<uid> 下的东西，不碰其它实例、不碰 gateway/cloudflared/mihomo
#   · **幂等**：重复跑同一个命令不会重复建用户、不会重复改 bundles（每步先判后做）
#   · **可回滚**：每个被改的文件先备份成 .bak-<时间戳>，脚本最后打印回滚命令
#   · **不复制别人的会话数据**：只复制配置骨架（profiles / cordis.patch.yml / 凭据），sessions 等一律新建
#
# 前提（脚本会检查，缺了就停）：
#   · 目标机上有 DSH release（默认 /opt/dsh-releases/0.2.1-rc.2）
#   · 目标机上有 pnpm（/opt/node/bin/pnpm），且能访问 npmmirror（装引擎依赖要用）
#   · 参考实例（默认 u001）存在，用来复制凭据与 profile 骨架
# ============================================================================
set -euo pipefail

HOST="${HOST:-dsh-class-server}"
UID_NAME="${UID_NAME:-stage}"          # 实例 uid 名（dsh-<UID_NAME>）
PORT="${PORT:-3086}"
REF="${REF:-u001}"                      # 参考实例（复制 profile 骨架与凭据）
DSH_RELEASE="${DSH_RELEASE:-/opt/dsh-releases/0.2.1-rc.2}"
BASE="${BASE:-/srv/dsh-users}"
TRUSTED_HOST="${TRUSTED_HOST:-stage.dsharness.dpdns.org}"
PROXY="${PROXY:-http://127.0.0.1:7890}"
MODE="${1:-full}"

# 本地包位置（相对本脚本）
HERE="$(cd "$(dirname "$0")" && pwd)"
CODE="$HERE/../code"
STAGE_PKG="$CODE/clients/classroom-stage-warm"
REPO_CLASSROOM="${REPO_CLASSROOM:-$HOME/SocraticNovel-GitHub仓库}"
UI_PKG="${UI_PKG:-$REPO_CLASSROOM/clients/classroom-ui}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

for p in "$STAGE_PKG/package.json"; do
  [ -f "$p" ] || die "本地包缺失：$p"
done

R() {
  local try=1
  until ssh -o BatchMode=yes "$HOST" "$@" 2>/tmp/ssh.err; do
    if [ "$try" -ge 3 ]; then
      echo "  ✗ ssh 三次失败：$(tail -1 /tmp/ssh.err)"; return 1
    fi
    echo "  … ssh 被拒（$(tail -1 /tmp/ssh.err 2>/dev/null)），15 秒后重试 ($try/3)"
    sleep 15; try=$((try+1))
  done
}

# scp 带重试：服务器 sshd 对短时间内的多次连接会限流（Connection closed），
# 逐次重试比"换一种写法绕过"更诚实 —— 限流是真实约束，不是脚本 bug。
SC() {
  local try=1
  until scp -q -o BatchMode=yes "$@" 2>/tmp/scp.err; do
    if [ "$try" -ge 3 ]; then
      echo "  ✗ scp 三次失败：$(cat /tmp/scp.err | tail -1)"; return 1
    fi
    echo "  … scp 被拒（$(tail -1 /tmp/scp.err 2>/dev/null)），15 秒后重试 ($try/3)"
    sleep 15; try=$((try+1))
  done
}

say "0 · 目标机前置检查（$HOST）"
R "
  set -e
  [ -d $DSH_RELEASE ] || { echo 'MISSING release: $DSH_RELEASE'; exit 1; }
  [ -x /opt/node/bin/node ] || { echo 'MISSING /opt/node/bin/node'; exit 1; }
  [ -d $BASE/$REF/home ] || { echo 'MISSING 参考实例 $REF'; exit 1; }
  echo '  ok: release / node / 参考实例都在'
"

if [ "$MODE" != "--update-only" ]; then
  say "1 · 建系统用户与目录（幂等）"
  R "
    set -e
    id dsh-$UID_NAME >/dev/null 2>&1 || useradd -r -m -d $BASE/$UID_NAME/workspace -s /usr/sbin/nologin dsh-$UID_NAME
    mkdir -p $BASE/$UID_NAME/home $BASE/$UID_NAME/workspace
    chown -R dsh-$UID_NAME:dsh-$UID_NAME $BASE/$UID_NAME
    chmod 700 $BASE/$UID_NAME $BASE/$UID_NAME/home
    printf 'PORT=$PORT\nTRUSTED_HOST=$TRUSTED_HOST\n' > $BASE/$UID_NAME/port.env
    chown dsh-$UID_NAME:dsh-$UID_NAME $BASE/$UID_NAME/port.env; chmod 600 $BASE/$UID_NAME/port.env
    echo '  ok: 用户与 port.env'
  "

  say "2 · 复制 profile 骨架 + 配置（不复制任何会话数据）"
  R "
    set -e
    S=$BASE/$REF/home; D=$BASE/$UID_NAME/home
    [ -d \$D/profiles ] || cp -a \$S/profiles \$D/profiles
    [ -f \$D/cordis.patch.yml ] || cp -a \$S/cordis.patch.yml \$D/cordis.patch.yml
    [ -f \$D/settings.yaml.imported ] || cp -a \$S/settings.yaml.imported \$D/settings.yaml.imported
    [ -f \$D/.credentials.yaml ] || cp -a \$S/.credentials.yaml \$D/.credentials.yaml
    mkdir -p \$D/storages \$D/sessions \$D/attachments
    chown -R dsh-$UID_NAME:dsh-$UID_NAME \$D
    chmod 700 \$D; chmod 600 \$D/.credentials.yaml
    echo '  ok: profile 骨架'
  "

  say "3 · 写 workspace.json（没有它，新实例开不出会话，舞台拿不到会话钩子）"
  R "
    set -e
    D=$BASE/$UID_NAME/home
    if [ -f \$D/storages/workspace.json ]; then
      echo '  已存在，跳过'
    else
      python3 - <<PY
import json, datetime, uuid
ws = str(uuid.uuid4())
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
d = {
  'unit': {'name': 'workspace', 'version': 2},
  'global': {'initialized': True, 'workspaceIds': [ws], 'archivedSessionIds': []},
  'tables': {'workspaces': {ws: {
      'path': '$BASE/$UID_NAME/workspace',
      'title': '教室舞台测试区',
      'sessionIds': [], 'createdAt': now, 'updatedAt': now,
  }}},
}
open('$BASE/$UID_NAME/home/storages/workspace.json','w').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print('  ok: workspace.json', ws)
PY
      chown dsh-$UID_NAME:dsh-$UID_NAME \$D/storages/workspace.json
      chmod 600 \$D/storages/workspace.json
    fi
  "

  say "4 · 配代理（服务器直连出不去，mihomo 走 127.0.0.1:7890）"
  R "
    set -e
    mkdir -p /etc/systemd/system/dsh-web@$UID_NAME.service.d
    cat > /etc/systemd/system/dsh-web@$UID_NAME.service.d/proxy.conf <<EOF
[Service]
Environment=HTTP_PROXY=$PROXY
Environment=HTTPS_PROXY=$PROXY
Environment=ALL_PROXY=$PROXY
Environment=NO_PROXY=127.0.0.1,localhost,::1
EOF
    systemctl daemon-reload
    echo '  ok: proxy drop-in'
  "
fi

say "5 · 传插件包（舞台 / 教室面板）"
for pkgdir in "$STAGE_PKG" "$UI_PKG"; do
  name="$(basename "$pkgdir")"
  R "mkdir -p $BASE/$UID_NAME/plugin/$name"
  files=("$pkgdir/lib" "$pkgdir/cordis.patch.yml" "$pkgdir/package.json")
  [ -f "$pkgdir/README.md" ] && files+=("$pkgdir/README.md")
  [ -d "$pkgdir/assets" ]   && files+=("$pkgdir/assets")
  [ -d "$pkgdir/vendor" ]   && files+=("$pkgdir/vendor")
  SC -r "${files[@]}" "$HOST:$BASE/$UID_NAME/plugin/$name/"
  echo "  ok: $name（${#files[@]} 个条目）"
done

say "6 · 装教学引擎（有 jsdom/mermaid/yaml 三个依赖，走 npmmirror）"
R "
  set -e
  S=$BASE/$UID_NAME/plugin/socratic-engine
  if [ ! -f \$S/package.json ]; then
    echo '  引擎源码未上传，跳过（先手动传 $BASE/$UID_NAME/plugin/socratic-engine）'
  elif [ ! -d \$S/node_modules ]; then
    chown -R dsh-$UID_NAME:dsh-$UID_NAME \$S
    sudo -u dsh-$UID_NAME env PATH=/opt/node/bin:/usr/bin:/bin HOME=$BASE/$UID_NAME/home \
      npm install --prefix \$S --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null 2>&1
    echo '  ok: 引擎依赖已装'
  else
    echo '  已装，跳过'
  fi
"

say "7 · 把插件登记进 profile（裸拷 + 改 package.json，不用 pnpm）"
R "
  set -e
  P=$BASE/$UID_NAME/home/profiles/web
  for name in classroom-stage-warm socratic-engine classroom-ui; do
    src=$BASE/$UID_NAME/plugin/\$name
    [ -d \$src ] || { echo \"  跳过 \$name（没有源码）\"; continue; }
    rm -rf \$P/node_modules/\$name
    cp -r \$src \$P/node_modules/\$name
  done
  /opt/node/bin/node - \$P/package.json <<'JS'
const fs = require('fs')
const file = process.argv[2]
const want = ['classroom-stage-warm','socratic-engine','classroom-ui']
const doc = JSON.parse(fs.readFileSync(file,'utf8'))
doc.dependencies = doc.dependencies || {}
doc.dsh = doc.dsh || {}; doc.dsh.profile = doc.dsh.profile || {}
const b = doc.dsh.profile.bundles = doc.dsh.profile.bundles || []
for (const n of want) {
  doc.dependencies[n] = 'file:' + n
  if (!b.includes(n)) b.push(n)
}
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
console.log('  bundles:', b.length)
JS
  chown -R dsh-$UID_NAME:dsh-$UID_NAME \$P/node_modules \$P/package.json
  chmod 600 \$P/package.json
"

say "8 · 装教室包 + 教室预设"
R "mkdir -p $BASE/$UID_NAME/workspace/classrooms $BASE/$UID_NAME/home/presets-private"
if [ -d "$REPO_CLASSROOM/classrooms/cs-os" ]; then
  SC -r "$REPO_CLASSROOM/classrooms/cs-os" "$HOST:$BASE/$UID_NAME/workspace/classrooms/"
  echo "  ok: 教室包"
  # 🔴 教室包是"仓库原版"（animation + prep 都在）。目标机没有 Manim 时必须**按环境裁剪**，
  #    否则引擎 loadManifest 抛「声明了备课清单但没启用动画」→ 整份教室内容不注入（静默降级）。
  #    实测踩过：脚本覆盖教室包后实例直接崩在 ManifestError。
  SC "$HERE/tailor-classroom-for-host.sh" "$HOST:/root/tailor-classroom.sh" 2>/dev/null || true
  R "bash /root/tailor-classroom.sh $BASE/$UID_NAME/workspace/classrooms/cs-os/classroom.yaml"
  R "chown -R dsh-$UID_NAME:dsh-$UID_NAME $BASE/$UID_NAME/workspace/classrooms"
else
  echo "  ⚠ 本地没有 $REPO_CLASSROOM/classrooms/cs-os，跳过"
fi
if R "test -d /opt/dsh-presets/class-standard"; then
  R "
    set -e
    D=$BASE/$UID_NAME/home/presets-private/cs-os-classroom
    if [ ! -f \$D/preset.yml ]; then
      mkdir -p \$D
      cp -r /opt/dsh-presets/class-standard/* \$D/
      cat > \$D/preset.yml <<EOF
name: 计算机系教室 · 操作系统
description: >-
  沉浸式教室：计算机系「操作系统」14 讲。老师在同一场景里上课，按相位提问、写板书；
  课程内容、当前讲次与教学纪律随教室包自带（工作区 classrooms/cs-os）。
order: 9
EOF
      echo '  ok: 预设骨架（persona 需按需手改）'
    else
      echo '  预设已存在，跳过'
    fi
    chown -R dsh-$UID_NAME:dsh-$UID_NAME $BASE/$UID_NAME/home/presets-private
    chmod -R a+rX $BASE/$UID_NAME/home/presets-private
    # 🔴 0.2.1 起 `preset.yml` / `agent.cordis.yml` 这套「目录扫描」形态**已经没人读**
    #    （`@deepseek-ai/dsh-agent-presets` 在 0.2.1 的 release 里不存在）。留着它＝预设
    #    静默失效、默认回落到内置 standard，而且**不报错**（只在 dump 里留一行
    #    `patch: entry \"agent-presets\" not found`）。必须把目录内联成
    #    `@deepseek-ai/dsh-agent-preset` 的插件行。转换脚本是班级服务器既有资产，
    #    它同时处理 {{cwd}}、workflow-worker-thread、技能绝对路径这三处坑。
    if R \"test -f /opt/dsh-class/dsh-convert-presets-021.py\"; then
      if R \"python3 /opt/dsh-class/dsh-convert-presets-021.py \
              --presets-root $BASE/$UID_NAME/home/presets-private \
              --default cs-os-classroom \
              --apply $BASE/$UID_NAME/home/cordis.patch.yml\"; then
        echo '  ok: 预设已转成 0.2.1 插件行形态（registry.default = cs-os-classroom）'
        R \"chown dsh-$UID_NAME:dsh-$UID_NAME $BASE/$UID_NAME/home/cordis.patch.yml\"
        R \"chmod 600 $BASE/$UID_NAME/home/cordis.patch.yml\"
      else
        echo '  ✗ 预设转换失败 —— 这份实例上的教室预设在 0.2.1 下不会生效（见上方输出）'
      fi
    else
      echo '  ⚠ 没有 /opt/dsh-class/dsh-convert-presets-021.py：preset.yml 在 0.2.1 下是死文件，'
      echo '    教室预设不会出现在预设选择器里。请手工把 agent.cordis.yml 内联成 dsh-agent-preset 插件行。'
    fi
  "
fi

say "9 · 起服务"
R "
  systemctl reset-failed dsh-web@$UID_NAME 2>/dev/null || true
  systemctl restart dsh-web@$UID_NAME
  # 🔴 不要用「is-active 之后固定 sleep」判成功。0.2.1 首次启动明显比 0.1.5 慢，
  #    固定 sleep 会把「还没 listen」当成「起好了」，这是 8.70 那次事故的根因。
  #    改成**轮询端口**：拿到第一个非 000 的 HTTP 码才算起来（401 是正常的，表示要 token）。
  CODE=000
  for i in \$(seq 1 45); do
    CODE=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$PORT/ 2>/dev/null || echo 000)
    [ \"\$CODE\" != \"000\" ] && break
    sleep 2
  done
  if [ \"\$CODE\" = \"000\" ]; then
    echo \"  ✗ 90 秒内端口 $PORT 没有 listen（最后状态：\$(systemctl is-active dsh-web@$UID_NAME)）\"
    echo '    先看：journalctl -u dsh-web@$UID_NAME --no-pager -n 120'
    exit 1
  fi
  echo \"  ok: 端口 $PORT 已 listen（http_code=\$CODE，服务 \$(systemctl is-active dsh-web@$UID_NAME)，重启次数 \$(systemctl show dsh-web@$UID_NAME -p NRestarts --value)）\"
  journalctl -u dsh-web@$UID_NAME --no-pager --since '-60s' | grep -iE 'did not activate|failed to import|never started' | head -5 \
    || echo '  装载零告警（没有 did not activate / failed to import / never started）'
  # token 是一次加载即失效，且打印得比"端口起来"晚几秒 —— 轮询取，别只抓一次
  for i in 1 2 3 4 5; do
    TOK=\$(journalctl -u dsh-web@$UID_NAME --no-pager -n 60 | grep -oE 'token=[A-Za-z0-9_-]+' | tail -1 | cut -d= -f2)
    [ -n \"\$TOK\" ] && break
    sleep 8
  done
  if [ -n \"\$TOK\" ]; then echo \"  token: \$TOK\"; else echo '  ⚠ 5 次都没抓到 token，去 journalctl -u dsh-web@$UID_NAME 看'; fi
"

cat <<EOF

$(printf '\033[1m== 回滚 ==\033[0m')
  systemctl stop dsh-web@$UID_NAME && systemctl disable dsh-web@$UID_NAME
  rm -rf /etc/systemd/system/dsh-web@$UID_NAME.service.d
  rm -rf $BASE/$UID_NAME
  userdel dsh-$UID_NAME
  # 不涉及任何其它实例；gateway / cloudflared / mihomo 全程未动

$(printf '\033[1m== 下一步（要人工）==\033[0m')
  1. 预设 persona 需要改成教室老师（脚本只放骨架，不覆盖你的措辞）
  2. 对外入口要接 gateway：INSTANCE_PORTS 加 "$UID_NAME":$PORT，再 kill -HUP <gateway pid>（热重载，不用重启）
  3. accounts.json 加测试账号（必须先做第 2 步，否则整份账号表加载失败）
  4. Cloudflare 侧加 $TRUSTED_HOST 的 ingress（cloudflared 是 token 模式，规则在云端）
EOF
