# DSH git 数据（主代理 2026-09-23 实测，供侦察_L2 使用）

## 基线
- master(本地): d347e70390 2026-09-04 PR #3554 release/dsh-0.1.3-alpha.1
- origin/master(最新): 00102833df 2026-09-22 PR #4978 release-dsh-0.1.7-alpha.2
- master..origin/master: 19514 commits (18 天)

## 近 30 天提交量 (since 2026-08-24):
    5823

## release 提交 (since 2026-07-01, 前 20):
00102833df Merge pull request #4978 from deepseek-harness/worktree/release-dsh-0.1.7-alpha.2
10ea83bcc3 release(dsh): 0.1.7-alpha.2
178ee3a9eb Merge pull request #4975 from deepseek-harness/worktree/release-vendor-4.0.4
d0dca04e22 release(vendor): cordis 4.0.4, cosmokit 1.8.5, group 1.0.4, hmr 1.0.19, include 1.0.9, loader 1.0.5, logger-console 1.0.4, schemastery 3.18.4, timer 1.1.6
c22b226b18 fix: address review threads on the fatal-diagnostics PR
b980fdf5df Merge pull request #4950 from deepseek-harness/worktree/release-dsh-0.1.5-rc.3-history-to-master
3ae2f687f1 merge: record dsh 0.1.5-rc.3 history on master
cafb9b93b4 fix: address adversarial review of the fatal-diagnostics branch
a4c74a91e0 Merge pull request #4909 from deepseek-harness/worktree/release-dsh-0.1.5-rc.3
8e7cca22ca release(dsh): 0.1.5-rc.3
943af81a18 fix(release): pin vendor dependencies for dsh 0.1.5
22be805026 fix(ip-geolocation): align the package with the current release
9f9a50e553 feat(app-boot): treat uncaught exceptions as fatal through installFailLoud
ab62f09c22 fix(desktop): report Windows extraction failures with 7-Zip evidence
c36a83ff6b Merge pull request #4901 from deepseek-harness/rel/dsh-0.1.7-alpha.1
112ce776ac release(dsh): 0.1.7-alpha.1
1e9c7b410a Merge pull request #4891 from deepseek-harness/worktree/release-vendor-4.0.2
efa63a7fc4 release(vendor): cordis 4.0.3, cosmokit 1.8.4, group 1.0.3, hmr 1.0.18, include 1.0.8, loader 1.0.4, logger-console 1.0.3, schemastery 3.18.3, timer 1.1.5
481b6b57e5 fix(desktop): simplify the update-available restart notice
dcac4c6eac Merge pull request #4792 from deepseek-harness/build/windows-release-scripts

## tags (后 20):
dsh-v0.1.0-rc.8
dsh-v0.1.1-rc.1
dsh-v0.1.1-rc.2
dsh-v0.1.2-alpha.1
dsh-v0.1.2-alpha.2
dsh-v0.1.2-alpha.3
dsh-v0.1.2-alpha.4
dsh-v0.1.2-alpha.5
dsh-v0.1.2-rc.1
dsh-v0.1.3-alpha.1
dsh-v0.1.3-alpha.2
dsh-v0.1.5-alpha.1
dsh-v0.1.5-alpha.2
dsh-v0.1.5-rc.1
dsh-v0.1.5-rc.2
dsh-v0.1.5-rc.3
dsh-v0.1.6-alpha.1
dsh-v0.1.6-alpha.2
dsh-v0.1.7-alpha.1
dsh-v0.1.7-alpha.2

## 核心目录自 09-04 以来变更:
- packages/core/agent-loop: 81 commits
- packages/core/system-prompt: 43 commits
- packages/core/tools: 66 commits
- packages/core/agent: 35 commits

## agent-loop 最近 5 条:
10ea83bcc3 release(dsh): 0.1.7-alpha.2
4e6028a604 build: use tilde ranges for vendor and native workspaces
37372101b5 build: pin internal DSH workspace dependencies
112ce776ac release(dsh): 0.1.7-alpha.1
601d6761e4 feat(settings): project volatile Config through profile-backed forms (#4587)

## system-prompt 最近 5 条:
10ea83bcc3 release(dsh): 0.1.7-alpha.2
4e6028a604 build: use tilde ranges for vendor and native workspaces
37372101b5 build: pin internal DSH workspace dependencies
112ce776ac release(dsh): 0.1.7-alpha.1
7520fe94e1 refactor(preset): 精简创造模式的 system prompt (#4745)

## 主工作树本地未提交改动 (摘要):
      70
 M .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.i18n.yaml
 M .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md
 M .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.zh.md
 M apps/web/tests/scaffold.ts
 M packages/api/session-controller/README.i18n.yaml
 M packages/api/session-controller/README.md
 M packages/api/session-controller/README.zh.md
 M packages/api/session-controller/package.json
 M packages/api/session-controller/src/index.ts
 M packages/api/session-controller/src/types.ts
 M packages/api/session-controller/tests/fake-api.client.ts
 M packages/api/session-controller/tests/test-remote.ts
 M packages/api/session-controller/tsconfig.host.json
 M packages/api/workspace-controller/README.i18n.yaml
 M packages/api/workspace-controller/README.md
