#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""顶象 demo 站（cap.dingxiang-inc.com / jsv=5.1.53）背景图还原。

算法来自前端那段 drawImage 循环（`图片回复.js` 里已扣好）：

    o.drawImage(t, r, 0, c, e, i * a, 0, c, e)
      t = 源图   r = 源 x   c = 片宽   e = 片高
      i = 第几片  a = 片宽（= c）

9 参数版 drawImage 是「从源图抠一块贴到目标」：

    ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
                      └── r  0    c        e      i*a  0    c        e

因为 sWidth == dWidth、sHeight == dHeight，**没有缩放，是纯搬运**。读成人话：

    目标第 i 片  ←  源图第 r 片

也就是按乱序表把切片搬回正确位置。

乱序表来自 **p1 的文件名**（32 位 hex），由 get_arr() 算出一个 0..31 的排列。

实测（2026-10-18）：
    bg.webp 400x200，切片宽 12，共 32 片 → 覆盖 0..384
    还原前 边界/片内 列差比 = 3.35
    还原后 边界/片内 列差比 = 1.09   ← 缝基本愈合，算法确认正确
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SLICE = 12      # 切片宽度（实测：缝都在 12 的倍数上）
HEIGHT = 200    # 切片高度 = 整图高度
N_SLICES = 32   # 片数（= 文件名 hex 长度）


# ---------------------------------------------------------------- 乱序表
def get_arr(name: str) -> list[int]:
    """从 p1 文件名算出乱序表 —— 前端 get_arr() 的 Python 版。

    JS 原文：
        for (var d = 0; d < n.length; d++) {
            var u = n.charCodeAt(d);
            if (32 === d) break;                 // 最多取 32 个字符
            for (; a(c, u % 32);) u++;           // a() 就是 Array.includes
            c.push(u % 32);
        }

    逐字符取 charCode，对 32 取余；**撞了就 +1 直到不重复**。
    所以结果一定是 0..31 的一个排列（32 位文件名正好用满）。
    """
    out: list[int] = []
    for d, ch in enumerate(name):
        if d >= N_SLICES:
            break
        u = ord(ch)
        while (u % 32) in out:      # 撞了就往后挪，保证唯一
            u += 1
        out.append(u % 32)
    return out


def name_from_p1(p1_url: str) -> str:
    """从 p1 的 URL 抠出文件名主干。

    '/dx/h1F6YALAEw/zib3/98c49d59e3c544ebb03aadc8262720a1.webp'
      -> '98c49d59e3c544ebb03aadc8262720a1'
    """
    return Path(p1_url).stem


# ---------------------------------------------------------------- 还原
def restore(bg: np.ndarray, table: list[int]) -> np.ndarray:
    """按乱序表把切片搬回原位。

    目标第 i 片  <-  源图第 table[i] 片
    """
    out = bg.copy()
    for i, src in enumerate(table):
        dx, sx = i * SLICE, src * SLICE
        out[:, dx:dx + SLICE] = bg[:, sx:sx + SLICE]
    return out


def seam_score(img: np.ndarray) -> tuple[float, float, float]:
    """边界/片内 的列差能量比 —— 越接近 1 说明缝越平，还原越对。

    切片被打乱时，12 的倍数处内容不连续，列差会明显高于片内部位。
    """
    d = np.abs(np.diff(img.astype(np.int16), axis=1)).mean(axis=(0, 2))
    edge = float(np.mean([d[x - 1] for x in range(SLICE, N_SLICES * SLICE, SLICE)]))
    inner = float(np.mean([d[x - 1] for x in range(SLICE // 2, N_SLICES * SLICE, SLICE)]))
    return edge, inner, edge / inner


# ---------------------------------------------------------------- CLI
def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        print("用法:")
        print("  python 图片还原.py <bg.webp> <p1的URL或文件名> [输出.png]")
        print()
        print("例:")
        print("  python 图片还原.py bg.webp 98c49d59e3c544ebb03aadc8262720a1.webp out.png")
        return 1

    bg_path = Path(sys.argv[1])
    raw = sys.argv[2]
    out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else bg_path.with_name(bg_path.stem + "_restored.png")

    name = name_from_p1(raw) if "/" in raw or "." in raw else raw
    table = get_arr(name)
    print(f"文件名主干 : {name}")
    print(f"乱序表     : {table}")
    print(f"是 0..31 的排列: {sorted(table) == list(range(N_SLICES))}")

    bg = np.asarray(Image.open(bg_path).convert("RGB"))
    print(f"原图       : {bg.shape[1]}x{bg.shape[0]}")

    fixed = restore(bg, table)
    Image.fromarray(fixed).save(out_path)

    a1, b1, r1 = seam_score(bg)
    a2, b2, r2 = seam_score(fixed)
    print(f"\n还原前 边界={a1:6.2f} 片内={b1:6.2f} 比值={r1:.2f}")
    print(f"还原后 边界={a2:6.2f} 片内={b2:6.2f} 比值={r2:.2f}")
    print(f"\n（比值越接近 1 越好；原始 3.35 -> 还原 1.09 就是对的）")
    print(f"已写出 {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
