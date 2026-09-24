# test/fixtures/discovery-* —— 教室目录自动发现的目录树 fixture

> 产出者：S2（2026-09-23）｜配套：`lib/discovery.mjs` ＋ `test/discovery.test.mjs`
> 这些 fixture 是**工作区形状**，供 `discoverClassrooms({ workspaceRoot: <此目录> })` 直接使用。

## 各 fixture 覆盖什么

| fixture | 树形 | 期望 |
|---|---|---|
| `discovery-none/` | `plain-dir/README.txt`（无任何 `classroom.yaml`） | `status='none'`，0 候选，**不抛错** |
| `discovery-multi/` | `classrooms/alpha/` ＋ `classrooms/beta/`（convention）＋ `notes/nested/gamma/`（deep，depth 3） | `status='ambiguous'`，3 候选；选中 **alpha**（convention 优先于 deep，同来源同深度取字典序）；beta 与 gamma 必须出现在「其余未选中」 |
| `discovery-deep-limit/` | `shallow-room/`（depth 1）＋ `l1/l2/l3/too-deep/`（depth 4） | 默认 `maxDepth=3` → 只有 `shallow-room`（1 候选，`ok`）；传 `maxDepth:4` → `too-deep` 也进来（2 候选，`ambiguous`） |
| `discovery-missing-manifest/` | `classrooms/not-a-classroom/notes.txt`（目录在、manifest 不在） | `status='none'`；**缺 manifest 的目录不算教室**，且约定目录下不记 `skipped`（常态噪音） |
| `discovery-explicit-priority/` | `vendor/pinned/`（任意位置）＋ `classrooms/main/`（convention） | 不传 `explicitDirs` → 选中 `main`（convention）；传 `explicitDirs:['…/vendor/pinned']` → 选中 **pinned**（`source='explicit'` 压过 convention） |

## 符号链接 / 不可读目录**不在** fixture 里（刻意）

这两种情形**无法用提交进 git 的目录树表达**：

- **符号链接**：git 能存 symlink，但跨平台（尤其 Windows checkout）行为不一致，且它会让「读 fixture 目录」本身产生副作用。
- **不可读目录**（`chmod 000`）：权限位不随 git 传输。

→ 二者一律由 `test/discovery.test.mjs` 在 `os.tmpdir()` 下**临时建树**覆盖（`symlink()` / `chmod(dir, 0o000)`），
并已在测试里锁死行为（见「符号链接目录一律拒绝」「不可读目录被跳过并记录，不中断扫描」等用例）。

## 手动核对命令

```bash
cd 开源线/DSH定制/code/plugins/socratic-engine
/opt/homebrew/bin/node --input-type=module -e "
import { discoverClassrooms, formatDiscovery } from './lib/discovery.mjs'
import { resolve } from 'node:path'
const ws = resolve('test/fixtures/discovery-multi')
console.log(formatDiscovery(await discoverClassrooms({ workspaceRoot: ws })))
"
```

预期输出含：「3 个候选（状态 ambiguous）」「已选：…/classrooms/alpha」「其余未选中（2 个…）」。

## ⚠️ 已知：fixture 不会被 npm 打包

`package.json` 的 `files` 字段是 `["index.mjs","lib","README.md","cordis.patch.yml"]`，**不含 `test/`**。
→ 若插件将来以 npm 包分发，这些 fixture 不会随包发布。
🔴 本任务明令**不得修改 `package.json`**，故此处只记录、不改。单测 `test/discovery.test.mjs` 全部自建临时树，
**不依赖这些 fixture**，因此即使 fixture 缺失，测试仍可跑通。
