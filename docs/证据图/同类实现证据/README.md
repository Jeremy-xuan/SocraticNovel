# 同类实现证据（第三方源码，已移出仓库）

> 2026-09-24 研究「DSH 立绘插件怎么写」时，把两个同类插件的**文本源文件**拷进本目录做逐字引用
> （当时 58 份 / 1.2 MB，不含贴图与模型资产）。引用它们的是
> [`docs/历史报告/研究_同类DSH立绘插件_2026-09-24.md`](../../历史报告/研究_同类DSH立绘插件_2026-09-24.md)。
>
> 🔴 **2026-10-20 整顿：第三方源码不再随本仓库分发**（版权归各自作者，且它们是可直接安装运行的插件源码）。
> 这里只留出处与复现命令——报告里的行号都能按下面这条命令重建后核对。

## 出处

| 目录（已删） | 仓库 | 取数 commit | 版本 | 跟踪文件数 |
|---|---|---|---|---|
| `sakiko/` | `https://github.com/hg4/sakiko-for-dsh.git` | `66fabb1`（2026-09-20） | 2.2.1 | 146 |
| `amadeus/` | `https://github.com/yyxcnasd/amadeus-for-dsh.git` | `f86a52f`（2026-09-08） | 2.3.0 | 105 |

commit 与版本取自报告的 §1.1 表格；`--depth 1` 的浅克隆即可拿到对应内容。

## 复现（只读，不装依赖、不加载插件）

```bash
mkdir -p /tmp/sakiko-read && cd /tmp/sakiko-read
git clone https://github.com/hg4/sakiko-for-dsh.git sakiko
git -C sakiko checkout 66fabb1
git clone https://github.com/yyxcnasd/amadeus-for-dsh.git amadeus
git -C amadeus checkout f86a52f
```

⚠️ 引用时注意两点：

1. **行号绑定上面那两个 commit**；跟主干再 clone 会漂，报告里的 `host.mjs:4452` 这类引用就对不上了。
2. 这两个仓库都**没有**在报告里做过许可裁决；本仓库不再分发它们的代码，也不引用其实现。
