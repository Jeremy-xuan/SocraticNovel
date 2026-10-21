# 验证_技能包安装 —— 三种状态的实测输出

本目录是**真跑**出来的，不是推演。三个文件对应技能包自检 `validate` 的三种状态：

| 文件 | 场景 | 退出码 | 结论行 |
|---|---|---|---|
| `validate_装对了_退出码0.txt` | 整包 `cp -a` 到 `<root>/.dsh/skills/socratic-classroom`（模拟正确安装） | **0** | `结论：全部通过（退出码 0）` |
| `validate_装错了_退出码1.txt` | 在源位置 `code/skills/socratic-classroom` 原地跑（**不在任何扫描根下**） | **1** | `结论：发现 1 个问题（退出码 1）` → 打印三条可复制的目标路径 |
| `validate_残包_退出码2.txt` | 工作区里那份**缺 `node_modules/yaml`** 的项目级安装 | **2** | 无结论行（在检查前就失败）：`错误：找不到 YAML 解析器（require('yaml') 失败）` |

## 复现命令

> 🔴 **2026-10-20 整顿**：目录里那份 `.dsh/skills/socratic-classroom/` 整包副本**已移出仓库**
> （它是 `skills/` 的重复副本，500 KB，一条命令就能重建）。下面是按现盘路径重写的复现步骤，
> 在**仓库根**执行。

```sh
# ① 装对了（自己重建那份「正确安装」的副本）
R="$(mktemp -d)"
mkdir -p "$R/.dsh/skills"
cp -a skills/socratic-classroom "$R/.dsh/skills/"
node "$R/.dsh/skills/socratic-classroom/validate" --project-root "$R"
# → 退出码 0

# ② 装错了（在源位置原地跑：不在任何扫描根下）
node skills/socratic-classroom/validate --project-root "$PWD"
# → 退出码 1，并打印可复制的目标路径

# ③ 残包（缺 node_modules/yaml 的项目级安装）
cp -a skills/socratic-classroom "$R/残包"
rm -rf "$R/残包/node_modules"
node "$R/残包/validate" --project-root "$R"
# → 退出码 2，指出缺哪个依赖
```

## 关键判读

- **退出码 0/1 就是「装对了没」的判据**：装对＝0，装错＝1 且**打印可复制的目标路径**，装残＝2 且**指出缺哪个依赖**。
- 🔴 **「技能出现在列表里」判不出残包** —— 残包的 `SKILL.md` frontmatter 合法、位置也在扫描根下，**宿主照样会发现它**，但它的自检跑不起来。所以安装流程**必须把跑一次 `validate` 当成验收**。
- 「正确安装长什么样」＝ 用上面 ① 的命令自己重建（`cp -a` 整包，含 `node_modules/`）；仓库里不再保留那份副本。
