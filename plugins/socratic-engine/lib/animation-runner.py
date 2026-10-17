#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ANIM-ORCH 渲染器 —— 被宿主**以 detached 子进程**拉起来的执行体（不是宿主线程）。

为什么是独立进程而不是宿主里的异步任务（🔴 这是设计决定，不是随手）：
  ① 渲染是 **Python**（ManimCE 在 venv 里），宿主是 Node —— 跨语言只能用进程；
  ② 用户要的是"老师别干等"：宿主进程是回合制的，把渲染挂在宿主里就只能在回合边界上等；
     拉成独立进程后，宿主**立刻返回**、模型继续讲，渲染在后台自己跑完；
  ③ detached（新会话 + 不共享 stdio）意味着**宿主进程退出也不杀它** ——
     无头会话"一进程一回合"时这一点是必需的（否则回合结束 = 渲染被杀）；
  ④ 状态写盘（`status.json`）而不是只靠内存回调：宿主重启、渲染器被 OOM 杀掉、
     会话换了进程，**状态都还在盘上**，下一回合照样能读到"已经好了"。

🔴 两条不变量：
  · **状态只前推、不回退**（queued → rendering → gating → ready/blocked/failed）；
  · **任何失败都要留下原因**（`reason` 字段），不许只写一个 `failed` 就走人 ——
    老师下一轮要据此决定"改脚本重试"还是"改用板书图"。

用法（宿主拼的命令）：
  <venv>/python lib/animation-runner.py \
      --task-dir <教室>/runtime/animations/<任务号> \
      --manim <venv>/bin/manim --quality l --scene-class Xxx \
      [--gate <animation_gate.py> --gate-python <python> --gate-timeout 300]

退出码：0 = 跑完（**不代表渲染成功**，成功与否看 status.json）；
        非 0 = 渲染器自己出了无法归因的错（也会尽力写 status.json）。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT_FILE = "scene.py"
TASK_FILE = "task.json"
STATUS_FILE = "status.json"
RENDER_LOG = "render.log"


def now_ms() -> int:
    return int(time.time() * 1000)


def write_status(task_dir: Path, payload: dict) -> None:
    """原子写 status.json（临时文件 + os.replace：读者永不看到半截 JSON）。"""
    tmp = task_dir / f".{STATUS_FILE}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, task_dir / STATUS_FILE)


def read_status(task_dir: Path) -> dict | None:
    try:
        return json.loads((task_dir / STATUS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def advance(task_dir: Path, state: str, **fields) -> dict:
    """把状态**前推**一格并落盘。已有的字段保留（不覆盖 taskId/createdAt 之类）。"""
    current = read_status(task_dir) or {}
    merged = {**current, **fields, "state": state, "updatedAt": now_ms()}
    write_status(task_dir, merged)
    return merged


def tail(text: str, limit: int = 4000) -> str:
    text = text.strip()
    return text if len(text) <= limit else "…（前略）\n" + text[-limit:]


class Heartbeat:
    """渲染期间每 10 s 往 status.json 里写一次 `heartbeatAt`。

    🔴 为什么需要它（不是可选项）：宿主判断"渲染器是不是死了"必须有**不靠猜**的判据。
       只看 pid 会被 pid 复用骗到；只看"状态很久没变"会在长渲染上误判。
       心跳给出的是"这个进程 10 秒前还活着"这个**事实**，宿主据此在 60 s 无心跳时才判死。
       心跳线程是 daemon：主线程一结束它立刻走，不会吊住这个进程。
    """

    def __init__(self, task_dir: Path, interval: float = 10.0) -> None:
        self.task_dir = task_dir
        self.interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                current = read_status(self.task_dir) or {}
                current["heartbeatAt"] = now_ms()
                write_status(self.task_dir, current)
            except OSError:
                # 心跳写不进去不致命：宿主会退化成"60 s 无心跳判死"，最坏是把活着的任务判失败，
                # 而这一点会在 status.json 的 reason 里说清楚（不静默）。
                pass

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def find_mp4(media_dir: Path, output_stem: str) -> Path | None:
    """在 manim 的产物树里找这次渲染的 mp4（按文件名找，不猜分辨率目录名）。"""
    hits = sorted(media_dir.rglob(f"{output_stem}.mp4"), key=lambda p: p.stat().st_mtime)
    return hits[-1] if hits else None


def probe_duration(mp4: Path) -> float | None:
    """用 ffprobe 量视频时长。ffprobe 不在就返回 None（**不编数字**）。"""
    if shutil.which("ffprobe") is None:
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
            capture_output=True, text=True, timeout=30,
        )
        return float(out.stdout.strip())
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def run_gate(gate_py: Path, gate_python: str, mp4: Path, script: Path, out_dir: Path, timeout: int) -> dict:
    """跑质量闸门。返回 {ran, verdict, blocking, summary, stdoutTail, exit}。

    🔴 闸门是**另一个工作线的产物**（仓库根 `tools/animation-gate/`），本渲染器只按它的
       命令行契约调用、只读它写出的 `verdict.json`，**不 import 它的内部**。
       闸门自己起不来（exit=2 / 没有 verdict.json）→ 记成 `ran:false` 并带原文，
       由宿主决定怎么办；**不许当成"通过"**。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [gate_python, str(gate_py), str(mp4), "--script", str(script), "--out", str(out_dir), "--quiet"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.SubprocessError as exc:
        return {"ran": False, "error": f"闸门进程异常：{exc}", "exit": None}
    verdict = None
    vj = out_dir / "verdict.json"
    if vj.exists():
        try:
            verdict = json.loads(vj.read_text(encoding="utf-8"))
        except ValueError as exc:
            return {"ran": False, "error": f"verdict.json 不是合法 JSON：{exc}", "exit": p.returncode}
    if verdict is None:
        return {
            "ran": False,
            "error": "闸门没有写出 verdict.json",
            "exit": p.returncode,
            "stdoutTail": tail(p.stdout + p.stderr, 2000),
        }
    # 🔴 字段名按**闸门实际写出的 verdict.json** 取（实测核过）：`verdict` / `blocking_count` /
    #    `findings[].kind`＋`findings[].sub` / `human_review_required`。
    #    早期版本按 `findings[].blocking` / `[].code` 取，实测**取到空数组**（真实 verdict 里没有这两个键）
    #    → 通报里会出现"5 处阻断级画面缺陷（）"这种括号里没内容的句子。改为按 kind 归类。
    findings = verdict.get("findings") or []
    kinds = []
    for f in findings:
        label = str(f.get("kind") or "?")
        sub = f.get("sub")
        text = f"{label}·{sub}" if sub else label
        if text not in kinds:
            kinds.append(text)
    return {
        "ran": True,
        "exit": p.returncode,
        "verdict": verdict.get("verdict"),
        "blockingCount": int(verdict.get("blocking_count") or 0),
        "blockingKinds": kinds,
        "humanReviewRequired": verdict.get("human_review_required"),
        "summary": tail(str(verdict.get("summary") or ""), 800),
        "verdictFile": str(vj),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task-dir", type=Path, required=True)
    ap.add_argument("--manim", required=True, help="manim 可执行文件绝对路径（venv 里的那个）")
    # 🔴 画质档就是 manim 自己的那个字母（`manim render -q <l|m|h|p|k>`），
    #    **不是**命令行简写 `-ql` 里的两个字符。曾经把 `ql` 直接拼进 `-q{quality}` 得到 `-qql`，
    #    manim 报 "Invalid value for '-q': 'ql' is not one of 'l','m','h','p','k'"（exit 2）。
    ap.add_argument("--quality", default="l", choices=["l", "m", "h", "p", "k"])
    ap.add_argument("--scene-class", required=True)
    ap.add_argument("--gate", type=Path, default=None)
    ap.add_argument("--gate-python", default=None)
    ap.add_argument("--gate-timeout", type=int, default=300)
    ap.add_argument("--keep-media", action="store_true", help="保留 manim 的中间 media 树（默认渲染后删掉）")
    a = ap.parse_args(argv)

    task_dir: Path = a.task_dir
    script = task_dir / SCRIPT_FILE
    media_dir = task_dir / "media"
    t_start = now_ms()
    advance(
        task_dir, "rendering",
        startedAt=t_start, runnerPid=os.getpid(), heartbeatAt=t_start, manim=a.manim, quality=a.quality,
    )
    # 心跳只在这一个进程存活期间有意义：进程一退出 pid 就没了，宿主按 pid 判死。
    # 故**不显式 stop**（daemon 线程随进程一起走），少一条可能忘掉的分支。
    Heartbeat(task_dir).start()

    if not script.exists():
        advance(task_dir, "failed", reason=f"脚本不存在：{script}", finishedAt=now_ms())
        return 0

    # ① 真编译校验（权威的语法判据；比任何正则预检都硬）
    try:
        compile(script.read_text(encoding="utf-8"), str(script), "exec")
    except SyntaxError as exc:
        advance(
            task_dir, "failed",
            reason=f"Python 语法错误（第 {exc.lineno} 行）：{exc.msg}",
            finishedAt=now_ms(),
        )
        return 0

    # ② 真渲染
    cmd = [
        a.manim, f"-q{a.quality}", "--disable_caching",
        "-o", task_dir.name, str(script), a.scene_class,
        "--media_dir", str(media_dir),
    ]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, cwd=str(task_dir))
        render_out = p.stdout + p.stderr
        exit_code = p.returncode
    except subprocess.TimeoutExpired:
        (task_dir / RENDER_LOG).write_text("渲染超过 1800 s 未结束，已中止。\n", encoding="utf-8")
        advance(task_dir, "failed", reason="渲染超时（>1800 s）", exit=None, finishedAt=now_ms())
        return 0
    except OSError as exc:
        (task_dir / RENDER_LOG).write_text(f"渲染器无法启动 manim：{exc}\n", encoding="utf-8")
        advance(task_dir, "failed", reason=f"渲染器无法启动 manim：{exc}", exit=None, finishedAt=now_ms())
        return 0

    (task_dir / RENDER_LOG).write_text(render_out, encoding="utf-8")
    t_rendered = now_ms()
    mp4 = find_mp4(media_dir, task_dir.name)

    if exit_code != 0 or mp4 is None:
        reason = (
            f"manim 退出码 {exit_code}，且没有产出 mp4" if mp4 is None else f"manim 退出码 {exit_code}"
        )
        advance(
            task_dir, "failed",
            reason=reason,
            exit=exit_code,
            renderMs=t_rendered - t_start,
            logTail=tail(render_out),
            finishedAt=t_rendered,
        )
        if not a.keep_media:
            shutil.rmtree(media_dir, ignore_errors=True)
        return 0

    bytes_ = mp4.stat().st_size
    duration = probe_duration(mp4)
    final_mp4 = task_dir / f"{task_dir.name}.mp4"
    shutil.move(str(mp4), str(final_mp4))
    if not a.keep_media:
        shutil.rmtree(media_dir, ignore_errors=True)

    base = {
        "renderMs": t_rendered - t_start,
        "mp4": final_mp4.name,
        "bytes": bytes_,
        "durationSec": duration,
        "exit": exit_code,
    }

    # ③ 质量闸门（未配置就跳过 —— 这不是"降级"，是这一项本来就没开）
    if a.gate is None:
        advance(task_dir, "ready", gateRan=False, gateNote="未配置质量闸门（config.animation.gate 为空）", finishedAt=now_ms(), **base)
        return 0

    advance(task_dir, "gating", **base)
    gate = run_gate(
        a.gate, a.gate_python or sys.executable, final_mp4, script,
        task_dir / "gate", a.gate_timeout,
    )
    if not gate.get("ran"):
        # 🔴 闸门起不来 ≠ 通过：状态停在 failed 并带上原文，让老师知道"这段片子没人验过"
        advance(
            task_dir, "failed",
            reason=f"质量闸门没能跑起来：{gate.get('error')}（片子渲染出来了，但没有过闸，不许播）",
            gate=gate, finishedAt=now_ms(), **base,
        )
        return 0
    if gate.get("verdict") == "BLOCK":
        advance(
            task_dir, "blocked",
            reason=(
                f"闸门判 BLOCK：{gate.get('blockingCount')} 处阻断级画面缺陷"
                f"（{'、'.join(gate.get('blockingKinds') or []) or '闸门未给分类'}"
                f"{'；另有需人工目视确认的项' if gate.get('humanReviewRequired') else ''}）"
            ),
            gate=gate, finishedAt=now_ms(), **base,
        )
        return 0
    advance(task_dir, "ready", gate=gate, finishedAt=now_ms(), **base)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 —— 渲染器是 detached 进程，崩了没人看见，必须自己落盘
        try:
            td = Path(sys.argv[sys.argv.index("--task-dir") + 1])
            write_status(td, {
                "state": "failed",
                "reason": "渲染器自身异常：" + tail(traceback.format_exc(), 2000),
                "updatedAt": now_ms(),
                "finishedAt": now_ms(),
            })
        except Exception:  # noqa: BLE001
            pass
        raise
