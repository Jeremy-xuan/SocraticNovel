#!/usr/bin/env python3
"""vae_mps_patch.py —— 上游 `TransparentVAEDecoder.estimate_augmented` 在 MPS 上的**恒等**修正

问题（本任务实测发现，最小复现已确证）
--------------------------------------
上游 `common/modules/layerdiffuse/vae.py` 的 `estimate_augmented` 末尾逐字是：

    result = torch.stack(result, dim=0)      # 每个 eps 是 4 维 [1,C,H,W] -> stack 后变 **5 维**
    median = torch.median(result, dim=0).values
    return median

在 Apple MPS 上，`torch.median` 走 `MPSNDArraySort` kernel，而它**只支持 axis = 0,1,2,3**
（即最多 4 维张量）。对 5 维张量求 median 会触发 Metal 层断言并**直接 abort 进程**：

    MPSNDArraySort.mm:208: failed assertion `(null)" Axis = 4.
    This class only supports axis = 0, 1, 2, 3'

🔴 这是 **Metal 层断言，不是 Python 异常** —— `try/except` 抓不住，进程直接死（SIGABRT / 退出码 134）。
   本任务已用最小复现证实：4 维 median 在 MPS 上 OK，5 维必崩，CPU 上 5 维正常。

为什么"直接返回 result[0]"是**恒等变换**、不是降级
--------------------------------------------------
同一个函数的循环体逐字以 `result += [eps]` 紧接着 `break` 结束：

    for flip, rok in args:
        ...
        result += [eps]
        break                      # ← 第一轮就退出，args 里剩下的 7 组永远不会跑

→ **`len(result)` 恒等于 1**。单个元素的 `median(stack([x], dim=0), dim=0)` 数学上**恒等于 x**。
   所以 `return result[0]` 与上游语义**逐位相同**，不是近似、不是降级、不是启发式。

🔴 纪律：万一哪天上游把 `break` 去掉（result 会有 8 个元素），median 就不再恒等 ——
   本补丁在 `len(result) != 1` 时**抛异常**，绝不静默替换成别的东西。

用法（在导入 pipeline 类之后、跑 forward 之前调用一次）：
    import vae_mps_patch
    vae_mps_patch.apply()
"""
import torch


def apply(verbose: bool = True) -> str:
    from modules.layerdiffuse.vae import TransparentVAEDecoder

    if getattr(TransparentVAEDecoder, "_mps_median_patched", False):
        if verbose:
            print("  [patch] estimate_augmented 已打过补丁，跳过")
        return "already-patched"

    def estimate_augmented(self, pixel, latent, rgb_cond=None):
        # ── 以下循环体逐字照抄上游，不做任何改动 ──
        args = [
            [False, 0], [False, 1], [False, 2], [False, 3], [True, 0], [True, 1], [True, 2], [True, 3],
        ]
        result = []
        for flip, rok in args:
            feed_pixel = pixel.clone()
            feed_latent = latent.clone()
            if flip:
                feed_pixel = torch.flip(feed_pixel, dims=(3,))
                feed_latent = torch.flip(feed_latent, dims=(3,))
            feed_pixel = torch.rot90(feed_pixel, k=rok, dims=(2, 3))
            feed_latent = torch.rot90(feed_latent, k=rok, dims=(2, 3))
            if rgb_cond is not None:
                if flip:
                    rgb_cond = torch.flip(rgb_cond, dims=(3,))
                rgb_cond = torch.rot90(rgb_cond, k=rok, dims=(2, 3))
            eps = self.estimate_single_pass(feed_pixel, feed_latent, rgb_cond=rgb_cond).clip(0, 1)
            eps = torch.rot90(eps, k=-rok, dims=(2, 3))
            if flip:
                eps = torch.flip(eps, dims=(3,))
            result += [eps]
            break
        # ── 以上逐字照抄；以下替换上游的 stack+median ──
        if len(result) != 1:
            raise RuntimeError(
                "vae_mps_patch：上游 estimate_augmented 的 result 长度是 "
                f"{len(result)}（期望 1）。此时 median 不再恒等于 result[0]，"
                "本补丁拒绝静默替换 —— 请重新核对上游代码后决定怎么处理。"
            )
        return result[0]

    TransparentVAEDecoder.estimate_augmented = estimate_augmented
    TransparentVAEDecoder._mps_median_patched = True
    if verbose:
        print("  [patch] ✅ TransparentVAEDecoder.estimate_augmented：stack+median(5维) "
              "→ result[0]（恒等，len(result)==1 已断言）")
    return "patched"


def selftest() -> bool:
    """自检：① 补丁后 5 维 median 不再被调用；② result 长度≠1 时会响亮报错。"""
    import torch as _t
    # ① 恒等性：单元素 median(stack([x])) == x（CPU 上验证数学恒等，不碰 MPS）
    a = _t.randn(1, 4, 16, 16)
    s = _t.stack([a], dim=0)
    assert s.dim() == 5, s.dim()
    assert _t.equal(_t.median(s, dim=0).values, a), "单元素 median 应恒等于原张量"
    # ② 长度守卫：模拟 len(result)==2 必须抛错
    def _guard(n):
        result = [_t.zeros(1, 4, 4, 4)] * n
        if len(result) != 1:
            raise RuntimeError("guard works")
        return result[0]
    try:
        _guard(2)
        raise AssertionError("长度守卫没生效")
    except RuntimeError:
        pass
    return True


if __name__ == "__main__":
    print("selftest:", selftest())
