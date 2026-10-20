#!/bin/sh
# 把源教室目录同步成本技能包内的自包含副本（classroom/）。
#
# 为什么需要它：技能包必须自带教室（装上就能用），但教室正文由另一条工作线持续写入。
# 两边不自动联动 —— 每次教室内容更新后跑一次本脚本，包内副本才会跟上。
#
# 用法：
#   sh sync-classroom.sh                 # 默认从 ../../classrooms/cs-os 同步
#   sh sync-classroom.sh <源教室目录>     # 指定别的教室
#
# 只用 rsync，无第三方依赖。--delete 让副本与源一致（源里删掉的文件在副本里也删掉）。
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
src=${1:-"$here/../../classrooms/cs-os"}
dst="$here/classroom"

if [ ! -f "$src/classroom.yaml" ]; then
  echo "错误：$src 不是一个教室目录（找不到 classroom.yaml）" >&2
  exit 1
fi

mkdir -p "$dst"
rsync -a --delete "$src/" "$dst/"
echo "已同步：$src -> $dst"
