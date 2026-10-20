#!/usr/bin/env bash
# 按目标主机能力裁剪教室包（幂等）：没有 Manim 的机器必须关掉 animation 并删掉 prep 段，
# 否则引擎 loadManifest 直接抛「声明了备课清单但没启用动画」→ 整份教室内容不注入。
set -euo pipefail
C="${1:?用法: tailor-classroom-for-host.sh <classroom.yaml 路径>}"
python3 - "$C" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
changed = []
# 1) 关动画
if re.search(r'^animation:\n(?:[ \t#].*\n)*?[ \t]+enabled:\s*true', s, re.M):
    s = re.sub(r'(^animation:\n(?:[ \t#].*\n)*?[ \t]+enabled:\s*)true', r'\1false', s, count=1, flags=re.M)
    changed.append('animation.enabled -> false')
# 2) 删 prep 段（顶层键 prep: 到下一个顶层键之前）
lines = s.split('\n')
start = next((i for i, l in enumerate(lines) if l.rstrip() == 'prep:'), None)
if start is not None:
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j] and not lines[j][0].isspace() and not lines[j].startswith('#'):
            end = j; break
    note = ['# 🔴 本机无 Manim（无 libcairo/libpango/ffmpeg，apt 不可用），备课清单整段已移除；',
            '#    留着会让 loadManifest 抛错 → 教室内容不注入。原段见仓库 classrooms/cs-os/classroom.yaml。']
    lines = lines[:start] + note + lines[end:]
    changed.append(f'prep 段移除（{end-start} 行）')
    s = '\n'.join(lines)
open(p, 'w', encoding='utf-8').write(s)
print('  裁剪：', '；'.join(changed) if changed else '无需改动（已是裁剪态）')
PY
