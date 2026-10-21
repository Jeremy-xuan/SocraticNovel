# B3 执行报告：stage 实例从 DSH 0.1.5-rc.1 升到 0.2.1-rc.2

- 执行时间：2026-10-20 23:16–23:35（本地 EDT）= 2026-10-21 03:16–03:35（服务器 UTC）
- 目标机：`dsh-class-server`（`frp-vps-13065-mtr8kimi-pcozqp`）
- 只动 `dsh-web@stage`；`u001–u005 / test`、模板单元、gateway、cloudflared、mihomo 全程未动
- 结论：**升级成功，三个教室插件装载零错误**；但**教室预设 `cs-os-classroom` 在 0.2.1 上失效**（详见第 4 节，这是本次唯一未达成项，且不是本次改动引起的）

---

## 1. 证据

### 1.1 升级前（现状）

```
$ systemctl status dsh-web@stage --no-pager
● dsh-web@stage.service - DSH Web - user stage
     Loaded: loaded (/etc/systemd/system/dsh-web@.service; disabled; vendor preset: enabled)
    Drop-In: /etc/systemd/system/dsh-web@stage.service.d
             └─proxy.conf
     Active: active (running) since Tue 2026-10-20 01:43:40 UTC; 1 day 1h ago
   Main PID: 691634 (node)
      Tasks: 11 (limit: 4556)
     Memory: 57.3M (high: 448.0M max: 768.0M available: 390.6M)
        CPU: 4min 50.689s
     CGroup: /system.slice/system-dsh\x2dweb.slice/dsh-web@stage.service
             └─691634 /opt/node/bin/node /opt/dsh-releases/0.1.5-rc.1/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port 3086 --trusted-host stage.dsharness.dpdns.org
```

```
$ journalctl -u dsh-web@stage -n 300 --no-pager | grep -nE "did not activate|failed to import|never started|ERR_MODULE_NOT_FOUND|requireSchemaProjection|Error|error"
(no matches)
```

```
$ curl -s -o /dev/null -w "http_code=%{http_code}\n" http://127.0.0.1:3086/
http_code=401
```

升级前没有装载报错——因为 0.1.5 有宿主侧解析兜底，三个插件在 0.1.5 上是正常的。故障只在 0.2.1 上出现。

### 1.2 升级后 6 条验收证据（原始输出）

**证据 1 — `systemctl status`**

```
$ systemctl status dsh-web@stage --no-pager
● dsh-web@stage.service - DSH Web - user stage
     Loaded: loaded (/etc/systemd/system/dsh-web@.service; disabled; vendor preset: enabled)
    Drop-In: /etc/systemd/system/dsh-web@stage.service.d
             └─proxy.conf, release.conf
     Active: active (running) since Wed 2026-10-21 03:23:17 UTC; 3min 18s ago
   Main PID: 2720587 (node)
      Tasks: 11 (limit: 4556)
     Memory: 254.2M (high: 448.0M max: 768.0M available: 193.7M)
        CPU: 11.404s
     CGroup: /system.slice/system-dsh\x2dweb.slice/dsh-web@stage.service
             └─2720587 /opt/node/bin/node /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port 3086 --trusted-host stage.dsharness.dpdns.org

Oct 21 03:23:17 ... systemd[1]: Started DSH Web - user stage.
Oct 21 03:23:30 ... node[2720587]: dsh web: http://127.0.0.1:3086/?token=kmeqHC96dVcV-yRbRm8cgKQ3cT1mw_aLauadmsHB97s
```

`NRestarts=0`、`ActiveState=active`、`SubState=running`、`ExecMainPID=2720587`（`systemctl show`）：

```
$ systemctl show dsh-web@stage -p NRestarts -p ActiveState -p SubState -p ExecMainPID --no-pager
NRestarts=0
ExecMainPID=2720587
ActiveState=active
SubState=running
```

**证据 2 — `journalctl --since -15min` 零命中**

```
$ journalctl -u dsh-web@stage --since "-15min" --no-pager | grep -cE "did not activate|failed to import|never started"
0
$ journalctl -u dsh-web@stage --since "-15min" --no-pager | grep -cE "did not activate|failed to import|never started|ERR_MODULE_NOT_FOUND|no create\(\) factory|Cannot find module"
0

$ journalctl -u dsh-web@stage --since "-15min" --no-pager
Oct 21 03:23:07 ... systemd[1]: dsh-web@stage.service: Current command vanished from the unit file, execution of the command list won't be resumed.
Oct 21 03:23:14 ... systemd[1]: Stopping DSH Web - user stage...
Oct 21 03:23:17 ... systemd[1]: dsh-web@stage.service: Deactivated successfully.
Oct 21 03:23:17 ... systemd[1]: Stopped DSH Web - user stage.
Oct 21 03:23:17 ... systemd[1]: dsh-web@stage.service: Consumed 4min 58.187s CPU time.
Oct 21 03:23:17 ... systemd[1]: Started DSH Web - user stage.
Oct 21 03:23:30 ... node[2720587]: dsh web: http://127.0.0.1:3086/?token=kmeqHC96dVcV-yRbRm8cgKQ3cT1mw_aLauadmsHB97s
```

> `Current command vanished from the unit file` 是 `daemon-reload` 时旧 ExecStart 被 drop-in 顶掉、systemd 对正在跑的旧进程的正常提示，发生在 stop 之前，不是故障。

**证据 3 — 插件资产 200，且名单里有三个包**

首页 roster（`curl -b cookie http://127.0.0.1:3086/` 里内联的插件清单 JSON）：

```
{"id":"classroom-stage-warm","url":"plugins/??classroom-stage-warm/client.js&rev=6ea196c5deaa","rev":"6ea196c5deaa"}
{"id":"classroom-ui","url":"plugins/??classroom-ui/client.js&rev=2dc54ae12890","rev":"2dc54ae12890","inject":["@deepseek-ai/dsh-api-remotes", ...]}
```

两个客户端插件的 bundle：

```
$ curl -b cookie "http://127.0.0.1:3086/plugins/??classroom-stage-warm/client.js&rev=6ea196c5deaa"
classroom-stage-warm/client.js -> http=200 size=96850B

$ curl -b cookie "http://127.0.0.1:3086/plugins/??classroom-ui/client.js&rev=2dc54ae12890"
classroom-ui/client.js         -> http=200 size=217603B
```

返回内容头部确认是各自包的产物：

```
/**
 * classroom-stage-warm —— SocraticNovel「教室舞台」· **浏览器半边**
 ...
/**
 * 教室面板（classroom-ui）· 浏览器半边。
```

`socratic-engine` 是纯宿主半边（无 `dsh.client` 声明），不会出现在浏览器 roster 里，用组合后的 profile 树与独立 import 证明（见证据 6）。

**证据 4 — 版本**

```
$ /opt/node/bin/node /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js --version
0.2.1-rc.2
```

**证据 5 — 预设文件仍在、`default` 行仍在**

```
$ ls -la /srv/dsh-users/stage/home/presets-private/cs-os-classroom/
-rw------- 1 dsh-stage dsh-stage 15861 Oct 19 11:33 agent.cordis.yml
-rw-r--r-- 1 dsh-stage dsh-stage 15131 Oct 17 17:49 agent.cordis.yml.bak-komari-persona
-rw------- 1 dsh-stage dsh-stage   323 Oct 17 17:49 preset.yml
drwxr-xr-x 3 dsh-stage dsh-stage  4096 Oct 17 17:49 skills

$ sed -n "1,12p" /srv/dsh-users/stage/home/cordis.patch.yml | cat -n
     1  - id: llm-deepseek
     2    disabled: true
     3  - id: agent-presets
     4    name: '@deepseek-ai/dsh-agent-presets'
     5    config:
     6      default: cs-os-classroom          ← 第 6 行，仍在
     7      roots:
     8      - path: /opt/dsh-presets
     9        trust: system
    10      - path: /srv/dsh-users/stage/home/presets-private
    11        trust: user
    12  - id: llm-pi-ai
```

⚠️ **文件在，但功能不生效** —— 见第 4 节。这两份文件我一个字节没动（sha256 与备份一致）：`cordis.patch.yml` = `bdab22e5…1995e`，profile `package.json` = `34ed8a81…bc18`。

**证据 6 — 三个插件的宿主半边都能 import（决定性证据）**

组合后的 profile 树（`--dump-config`，只读、不占端口，exit=0）：

```
$ node bin.js --profile web --dump-config | grep -nE "socratic-engine|classroom-ui|classroom-stage-warm"
1396:# == classroom-stage-warm
1397:- id: classroom-stage-warm
1398:  name: classroom-stage-warm
1399:# == socratic-engine
1400:- id: socratic-engine
1401:  name: socratic-engine
1402:# == classroom-ui
1403:- id: classroom-ui
1404:  name: classroom-ui
```

三个宿主半边逐个独立 import（正是当初 `ERR_MODULE_NOT_FOUND` 与 `no create() factory` 的失败点）：

```
=== socratic-engine/index.mjs ===
exports: ANIMATE_TEMPLATE_TOOL_DESCRIPTION,ANIMATE_TOOL_DESCRIPTION,ANIMATION_TEMPLATE_IDS,DRAW_TOOL_DESCRIPTION,apply,inject,name

=== classroom-ui/lib/index.js ===
exports: apply

=== classroom-ui/lib/typert.host.js（0.2.1 的 create() codec）===
TYPERT.package: classroom-ui | tables: [ 'package', 'face', 'schemas', 'invocations', 'model' ]

=== classroom-stage-warm/lib/index.js ===
exports: apply,default,inject,name
```

宿主包解析同样逐个验过（在各自插件目录里解析，走的是插件自己的 `node_modules`）：

```
=== socratic-engine ===
dsh-tools: 0.2.1-rc.2
dsh-llm: 0.2.1-rc.2
defineTool: function | createUserMessage: function

=== classroom-ui ===
zod: 4.6.7
dsh-typert-protocol: 0.2.1-rc.2
dsh-atomic-write: 0.2.1-rc.2
protocol exports: 16 | atomic-write exports: withFileLock,writeFileAtomic
```

**启动耗时（轮询，不用 `is-active` + `sleep 3`）**

```
  t+0s http_code=000
  t+2s http_code=000
  t+4s http_code=000
  t+6s http_code=401  <-- LISTEN
=== final http_code=401 after 6s ===
```

**范围核对：只动了 stage**

```
dsh-web@stage.service active running   ActiveEnter: Wed 2026-10-21 03:23:17 UTC   ← 本次
dsh-web@u001.service active running    ActiveEnter: Wed 2026-10-21 01:08:54 UTC
dsh-web@u002.service active running    ActiveEnter: Wed 2026-10-21 01:09:20 UTC
dsh-web@u003.service active running    ActiveEnter: Wed 2026-10-21 01:09:40 UTC
dsh-web@u004.service active running    ActiveEnter: Wed 2026-10-21 01:10:09 UTC
dsh-web@u005.service active running    ActiveEnter: Wed 2026-10-21 01:10:29 UTC
dsh-web@test.service active running    ActiveEnter: Tue 2026-10-20 13:53:39 UTC
cloudflared  753  STARTED Thu Oct 8 06:43:35 2026   ← 未重启
```

部署文件与本地仓库逐字节一致（7 个关键文件 sha256 全等，含 `typert.host.js`、三个 `lib/index.js`、`lib/client.js`、`socratic-engine/index.mjs`、`lib/manifest.mjs`）。`profile/package.json`、`cordis.patch.yml`、`classroom.yaml` 的 sha256/mtime 与备份完全相同 → 没被顺手改动。

---

## 2. 改过的服务器文件清单

### 2.1 systemd（唯一一处 unit 层改动）

| 文件 | 动作 | 备份 |
|---|---|---|
| `/etc/systemd/system/dsh-web@stage.service.d/release.conf` | **新建** | 无（原不存在） |

内容（`${PORT}` / `${TRUSTED_HOST}` 原样保留，空 `ExecStart=` 清空模板值）：

```ini
[Service]
ExecStart=
ExecStart=/opt/node/bin/node /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port ${PORT} --trusted-host ${TRUSTED_HOST}
```

`systemctl show` 确认生效：`ExecStart={ path=/opt/node/bin/node ; argv[]=…/0.2.1-rc.2/… }`。
`proxy.conf` 原样保留（status 的 Drop-In 行已显示 `proxy.conf, release.conf`）。

### 2.2 插件树（`/srv/dsh-users/stage/home/profiles/web/node_modules/`）

备份根：`/srv/dsh-users/stage/backup-b3-20261020/`

整份快照（用于完整回滚）：

```
node_modules_socratic-engine.tar.gz     38M
node_modules_classroom-ui.tar.gz        1.1M
node_modules_classroom-stage-warm.tar.gz 12M
presets-private_cs-os-classroom.tar.gz  （只读快照）
package.json.bak-20261020               （profile 的 package.json）
cordis.patch.yml.bak-20261020           （只读快照）
systemd-dropin/                         （proxy.conf 原件）
new-tree/                               （本次推上去的源树，便于比对）
```

被覆盖的 21 个文件，每个都留了 `<原名>.bak-20261020` 在同目录：

```
classroom-stage-warm/assets/stage/student_f.png.bak-20261020
classroom-stage-warm/lib/client.js.bak-20261020
classroom-stage-warm/lib/index.js.bak-20261020
classroom-stage-warm/README.md.bak-20261020
classroom-ui/lib/client.js.bak-20261020
classroom-ui/lib/index.js.bak-20261020
classroom-ui/lib/typert.host.js.bak-20261020
classroom-ui/package.json.bak-20261020
classroom-ui/README.md.bak-20261020
socratic-engine/lib/dedup.mjs.bak-20261020
socratic-engine/lib/discovery.mjs.bak-20261020
socratic-engine/lib/expression.mjs.bak-20261020
socratic-engine/lib/expression-table.json.bak-20261020
socratic-engine/lib/manifest.mjs.bak-20261020
socratic-engine/lib/postclass.mjs.bak-20261020
socratic-engine/package.json.bak-20261020
socratic-engine/package-lock.json.bak-20261020
socratic-engine/README.md.bak-20261020
socratic-engine/接线说明_S1.md.bak-20261020
socratic-engine/接线说明_S2.md.bak-20261020
socratic-engine/接线说明_S3.md.bak-20261020
```

新增（原本没有）：

```
classroom-ui/package-lock.json
classroom-ui/node_modules/            ← npm 装的 7 个包（zod 4.6.7 + dsh-typert-protocol + dsh-atomic-write + 4 个 peer）
socratic-engine/node_modules/@deepseek-ai/   ← npm 装的 21 个包（dsh-tools / dsh-llm 及 peer 树）
classroom-stage-warm/assets/stage/portrait-candidates/  ← 4 张候选图（仓库里有、线上原缺）
```

删除：三个插件目录下 71 个 macOS `._*` AppleDouble 残渣（163 字节元数据头，之前 scp/zip 带上去的）。它们既不是源码也不被引用，删掉是为了避免被静态路由当成资产。这一点属于我替主代理做的判断，如不认可可从 tarball 恢复。

`npm install` 没有改写任何 `package.json` / `package-lock.json`（四个文件 sha256 与本地仓库完全一致）。

---

## 3. 回滚命令（逐条可复制）

⚠️ **重要前提**：本次同时换了 release 和插件代码。新旧 codec 契约**互斥**——

- 0.1.5 的 `dsh-typert-loader`：要求 codec 里有 `schema`，且 `"_zod" in schema.schema`
  （`/opt/dsh-releases/0.1.5-rc.1/node_modules/@deepseek-ai/dsh-typert-loader/lib/index.js:87`）
- 0.2.1 的 `dsh-typert-loader`：要求 `typeof value.create === "function"`
  （`/opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/dsh-typert-loader/lib/index.js:219-234`）

所以**只回滚 release、不还原插件树，`classroom-ui` 会在 0.1.5 上报 codec 错误**。完整回滚必须两步都做。

### 3.1 只回滚 release（观察用，插件可能报 codec 错）

```bash
rm -f /etc/systemd/system/dsh-web@stage.service.d/release.conf
systemctl daemon-reload
systemctl restart dsh-web@stage
# 轮询端口（最长 90s；401 也算起来了）
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3086/); [ "$c" != "000" ] && { echo "UP http=$c"; break; }; sleep 2; done
```

### 3.2 完整回滚（release + 插件树，推荐）

```bash
# 1) 撤 release drop-in
rm -f /etc/systemd/system/dsh-web@stage.service.d/release.conf
systemctl daemon-reload

# 2) 还原三个插件目录（先停服务，避免边写边跑）
systemctl stop dsh-web@stage
P=/srv/dsh-users/stage/home/profiles/web/node_modules
B=/srv/dsh-users/stage/backup-b3-20261020
rm -rf "$P/socratic-engine" "$P/classroom-ui" "$P/classroom-stage-warm"
tar xzf "$B/node_modules_socratic-engine.tar.gz"    -C "$P"
tar xzf "$B/node_modules_classroom-ui.tar.gz"       -C "$P"
tar xzf "$B/node_modules_classroom-stage-warm.tar.gz" -C "$P"
chown -R dsh-stage:dsh-stage "$P/socratic-engine" "$P/classroom-ui" "$P/classroom-stage-warm"

# 3) 起服务并轮询
systemctl reset-failed dsh-web@stage || true
systemctl restart dsh-web@stage
for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3086/); [ "$c" != "000" ] && { echo "UP http=$c"; break; }; sleep 2; done
systemctl status dsh-web@stage --no-pager
```

### 3.3 只还原单个插件文件（万一某个 .bak 要回退）

```bash
P=/srv/dsh-users/stage/home/profiles/web/node_modules
mv "$P/classroom-ui/lib/typert.host.js" "$P/classroom-ui/lib/typert.host.js.failed"
cp -a "$P/classroom-ui/lib/typert.host.js.bak-20261020" "$P/classroom-ui/lib/typert.host.js"
systemctl restart dsh-web@stage
```

### 3.4 删掉本次备份（确认稳定后，腾 51MB）

```bash
rm -rf /srv/dsh-users/stage/backup-b3-20261020
```

---

## 4. 未完成 / 存疑

### 4.1 🔴 教室预设 `cs-os-classroom` 在 0.2.1 上**不可选也不默认**（唯一未达成项）

不是本次改动引起的，是 0.2.1 的破坏性接口变更。证据（同一条 `--dump-config` 命令，两个 release 对照）：

```
# 0.1.5-rc.1 stderr
dsh: [.../profiles/web/cordis.patch.yml] patch: entry "memento" not found

# 0.2.1-rc.2 stderr
dsh: [.../profiles/web/cordis.patch.yml] patch: entry "memento" not found
dsh: [.../home/cordis.patch.yml] patch: entry "agent-presets" not found   ← 新增
```

```
# 0.1.5 dump（patch 生效）
# == @deepseek-ai/dsh-web-app, patched by /srv/dsh-users/stage/home/cordis.patch.yml
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: cs-os-classroom
    roots:
      - path: /opt/dsh-presets
      - path: /srv/dsh-users/stage/home/presets-private

# 0.2.1 dump（同一段没了，变成内置的 standard）
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins: [ ...内联插件清单... ]
```

根因（机核，不是推测）：

```
$ ls -d /opt/dsh-releases/0.1.5-rc.1/node_modules/@deepseek-ai/dsh-agent-presets
/opt/dsh-releases/0.1.5-rc.1/node_modules/@deepseek-ai/dsh-agent-presets      ← 0.1.5 有

$ ls -d /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/dsh-agent-presets
ls: cannot access ...: No such file or directory                                ← 0.2.1 没了

$ ls /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/ | grep -i preset
dsh-agent-preset
dsh-agent-preset-registry
dsh-client-ui-agent-preset
dsh-client-ui-permission-presets
dsh-permission-presets
```

- 0.1.5 的 `dsh-agent-presets` 是**目录式预设加载器**：读 `roots` 下每个目录的 `preset.yml` + `agent.cordis.yml`（`grep -rl "preset.yml" …/dsh-agent-presets/lib` 命中 6 个文件）。
- 0.2.1 换成 `dsh-agent-preset`（config 键：`id / name / order / description / plugins`，**插件清单内联在 config 里**）+ `dsh-agent-preset-registry`（只认 `default`）。
- 全树 grep 确认 0.2.1 里**没有任何东西**读 `agent.cordis.yml` 或目录式预设：

```
$ grep -rln "preset.yml" /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/*/lib      → 无输出
$ grep -rln "agent.cordis" /opt/dsh-releases/0.2.1-rc.2/node_modules/@deepseek-ai/*/lib    → 无输出
$ grep -rl "presets-private" 同路径                                                          → 无输出
$ grep -c "presets-private" /tmp/b3-dump.txt   (0.2.1 dump)                                 → 0
```

**含义**：`presets-private/cs-os-classroom/`（`preset.yml` + `agent.cordis.yml` + `skills/`）这套东西在 0.2.1 上成了死文件；浏览器里不会出现「计算机系教室 · 操作系统」，也不会被当成默认预设（默认是内置 `standard`）。

**为什么没顺手改**：任务明确写「你不需要改它，只是核对」，而要让它在 0.2.1 上重新可选且默认，得做一次**配置形态迁移**（把 `agent.cordis.yml` 的插件清单内联成 `preset-cs-os-classroom` 条目，再把 `agent-preset-registry` 的 `default` 改成它），那是设计决策，不是核对。下面是我的建议方案，供主代理定夺。

**建议修法（我未执行）**：在 `/srv/dsh-users/stage/home/cordis.patch.yml` 里把

```yaml
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config: { default: cs-os-classroom, roots: [...] }
```

换成

```yaml
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: cs-os-classroom
- id: preset-cs-os-classroom
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: cs-os-classroom
    name: 计算机系教室 · 操作系统
    description: <preset.yml 的 description>
    order: 9
    plugins: [ ...从 presets-private/cs-os-classroom/agent.cordis.yml 内联搬过来... ]
```

搬 `agent.cordis.yml` 时要注意：它 15.8KB，里面可能引用了**只在 0.1.5 release 里存在**的包名（和 `dsh-agent-presets` 同类的风险）。搬完必须用 `--profile web --dump-config` 复查有没有新的 `patch: entry ... not found`，再真启动一次看 journal。**在 0.2.1 上跑通之前，别把这份 patch 复制到 u001–u005。**

### 4.2 其它

- **`memento` patch 警告是升级前就有的**（0.1.5 stderr 里同样存在），与本次无关，未动。
- **`tools/deploy/deploy-stage.sh` 第 9 步仍是「`sleep 30` + `is-active`」**，正是 8.70 事故的判据形态。任务要求「不要动其它逻辑」，所以我只改了版本号，这个判据留给主代理决定要不要换成端口轮询。
- **同一脚本第 8 步有一段坏代码**（同样没动，属「其它逻辑」）：`cat > $D/preset.yml <<EOF … EOF` 之后多了一行 `PY`（在 `set -e` 下会当命令执行失败）。只在 `--update-only` + 预设不存在时才会走到；stage 目前预设已存在，不会触发。
- **浏览器端未验**：`classroom-ui` 的 `whiteboardStore` Remote、Live2D 立绘、整屏舞台的实际渲染没在真浏览器里点过（本任务只做到「装载零错误 + 资产 200 + 宿主半边可 import」）。建议带 token 打开 `http://127.0.0.1:3086/?token=…` 过一次。
- **`classroom-stage-warm/lib/client.js` 掉了一处文档路径**：服务器旧版注释里是 ``出处：契约取证见 `开源线/DSH定制/` 下 …``，仓库版是 ``出处：契约取证见 `` 下 …``（反引号里空了，是文档迁移留下的）。在块注释里，不影响运行；要修是仓库侧的事，我没在服务器上做局部修补。
- **`classroom-ui/package-lock.json` 是本次新增的**（服务器原本没有）。它记录的是本地已验过的依赖树，方便以后 `npm ci` 复现；如觉得不该进运行目录，可删掉，不影响运行。

---

## 5. 仓库改动：`tools/deploy/deploy-stage.sh`

```diff
--- a/tools/deploy/deploy-stage.sh
+++ b/tools/deploy/deploy-stage.sh
@@ -14,7 +14,7 @@
 #   · **不复制别人的会话数据**：只复制配置骨架（profiles / cordis.patch.yml / 凭据），sessions 等一律新建
 #
 # 前提（脚本会检查，缺了就停）：
-#   · 目标机上有 DSH release（默认 /opt/dsh-releases/0.1.5-rc.1）
+#   · 目标机上有 DSH release（默认 /opt/dsh-releases/0.2.1-rc.2）
 #   · 目标机上有 pnpm（/opt/node/bin/pnpm），且能访问 npmmirror（装引擎依赖要用）
 #   · 参考实例（默认 u001）存在，用来复制凭据与 profile 骨架
 # ============================================================================
@@ -24,7 +24,7 @@ HOST="${HOST:-dsh-class-server}"
 UID_NAME="${UID_NAME:-stage}"          # 实例 uid 名（dsh-<UID_NAME>）
 PORT="${PORT:-3086}"
 REF="${REF:-u001}"                      # 参考实例（复制 profile 骨架与凭据）
-DSH_RELEASE="${DSH_RELEASE:-/opt/dsh-releases/0.1.5-rc.1}"
+DSH_RELEASE="${DSH_RELEASE:-/opt/dsh-releases/0.2.1-rc.2}"
 BASE="${BASE:-/srv/dsh-users}"
 TRUSTED_HOST="${TRUSTED_HOST:-stage.dsharness.dpdns.org}"
 PROXY="${PROXY:-http://127.0.0.1:7890}"
```

- 只改这两处（文件头注释 + `DSH_RELEASE` 默认值），`grep -n "0\.1\.5"` 已无残留
- `bash -n` 通过
- 「不要用仓库原版教室覆盖线上裁剪版」那段完全没碰

⚠️ **提交状态说明**：我按要求**没有 commit**，改动当时留在工作树。但主代理在并行提交，`82ce769`（主题是「右栏面板 tab 实测…」）把我这两行一起带走了 —— 现在 `git diff -- tools/deploy/deploy-stage.sh` 是空的，内容已在 HEAD 里。**该提交的 message 没有提到这个文件**，主代理如需按主题拆分，可考虑把这两行单独提一次。除本报告外，我没有对仓库做别的写入。

---

## 6. 主代理补做：§4.1 的预设迁移（本轮已解决）

> 追加于 2026-10-20 23:5x（美国东部）。上面 §4.1 记的「唯一未达成项」**已经补做并验证**，本节是它的结论。

**做法**：用班级服务器既有的转换脚本，把 stage 的目录形态预设内联成 0.2.1 的插件行：

```bash
# 先体检（不改文件）
python3 /opt/dsh-class/dsh-convert-presets-021.py \
  --presets-root /srv/dsh-users/stage/home/presets-private --report
# → cs-os-classroom  insert  order=9  18 插件行  1 个技能目录

# 再应用（--apply 自己留 .bak-presets-021-<stamp>，YAML 复核不过会还原并非零退出）
python3 /opt/dsh-class/dsh-convert-presets-021.py \
  --presets-root /srv/dsh-users/stage/home/presets-private \
  --default cs-os-classroom \
  --apply /srv/dsh-users/stage/home/cordis.patch.yml
# → 替换旧块（第 3–11 行，原 9 行 → 新 290 行）；文件 171 → 453 行；属主/权限保持 dsh-stage:0600
```

**生成结果的三道体检**（都是「0 命中」，也就是三处坑都没漏）：

| 检查 | 结果 |
|---|---|
| `workflow-worker-thread`（0.2.1 已删的包） | 0 |
| `{{cwd}}`（0.2.1 未注册的 prompt 变量） | 0 |
| `name: ./`（相对路径插件行） | 0 |
| 技能目录 `customSkillDirs` | `/srv/dsh-users/stage/home/presets-private/cs-os-classroom/skills`（**绝对路径**，不是 `baseUrl` 相对） |

**验证**：

- `--dump-config` 退出码 0；树里出现 `- id: preset-cs-os-classroom`（第 1411 行）与
  `- id: agent-preset-registry` 的 `config.default: cs-os-classroom`；
  `patch: entry "agent-presets" not found` 这条**消失了**。
- `systemctl restart dsh-web@stage` 之后：端口 **t+10s** listen（401）、`active`、`NRestarts=0`、
  `did not activate|failed to import|never started|invalid` 命中 **0**。
- **真浏览器**（经 SSH 隧道 + Playwright）打开「Choose the agent preset」，
  四个选项：Standard mode / Minimal mode / Creator mode / **计算机系教室 · 操作系统**。
  证据：`docs/证据图/迁移0.2.1/stage-preset-picker-0.2.1.json`。
- 合成后的 preset persona 里逐字带教室声明（「…都来自工作区里的教室包（classrooms/cs-os），
  由教学引擎按 classroom.yaml 的声明注入给你」）。**`_anchor` 纪律未验**——它由引擎按 manifest
  的 `anchor.*` 块在回合里注入，要一个真实回合才能看到，属 M4-T。

**未做（有意）**：没有把这次迁移推广到 `u001`–`u005`。那是班级服务器的运维动作，不在本任务授权范围内；
真要推广，照上面两条命令换 `--presets-root` 与 `--apply` 的目标即可，且**必须先在一个实例上 dump + 真启动验过**。

**仓库侧同步**：`tools/deploy/deploy-stage.sh` 第 8 步已经会调用这个脚本（脚本缺失时大声告警，
不再静默留下死预设）；第 9 步的 `sleep 30` + `is-active` 也按要求改成了端口轮询。
