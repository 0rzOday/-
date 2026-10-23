#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""顶象 demo 站（cap.dingxiang-inc.com / jsv=5.1.53）缺口定位。

从 `../顶象/缺口.py` 搬过来的。搬运时只改了「喂进去的东西」，核心的
bright_map / candidates 一行没动 —— 那边 docstring 里记的三条线索
（ncc / chamfer / bright）在 demo 上的结论**完全一致**，所以只搬第三条。

为什么另外两条在 demo 上同样不成立（实测，不是照抄结论）
--------------------------------------------------------
拿 font.webp 做了多尺度掩码 NCC（TM_CCOEFF_NORMED，对整体压暗免疫），
score 最高才 0.648、多数落在 0.40~0.50 —— 就是噪声水平。原因是顶象把坑里
的内容**整个换掉了**（不是只压暗一层），所以「看内容找坑」这条路是死的。

bright_map 则很干净：全局最小 0.536，是个单峰，上下都掉回 0.74+，
正好落在 hb56 那边真坑的实测区间（0.35~0.57，别处 >0.78）。

和 hb56 的两处差别
------------------
1. **框尺寸**：hb56 的 piece 基本就是块本身；demo 的 font.webp 是 68x68 画布，
   但真正不透明的只有 **47x50**（左 10、上 8 的透明边距）。掩码用 alpha 本身
   是对的（透明区是 0，不参与均值），但**报坐标时要加回这个偏移**，
   否则会以为框比坑大一圈。

2. **y 的坐标系**：hb56 的表单没有 w/h，`/api/a` 的 y 和图像坐标 1:1，
   实测误差 0 像素。demo 就不是了 —— `y_resp` 和图像像素对不上，
   默认按 `y_img = y_resp * 4/3` 走（理由见常量那段）。
   10 组样本验证：带内 #1 在 10/10 组上都压在真坑上。

3. **demo 每张图都是"一暗一亮两个形状"**：一个暗色填充的缺口，加一个
   同形状的半透明"幽灵"（同 y、x 不同，像水印）。真坑是暗的那个。
   而且**全图最暗的那个不一定是坑** —— 10 组里 3 组（03/04/10）被暗地形
   或深色物体骗走了（ratio 低到 0.185，比真坑还暗）。所以
   **y 带不是可选项，它才是把坑摘出来的那一步**。

用法（在本目录下）：
    python 缺口.py                       # 用目录里现成的 bg.webp/font.webp/infor.json
    python 缺口.py --scale 1.0           # 关掉坐标缩放
    python 缺口.py --y 39 --scale 1.2121
产物：_缺口.png（可视化）
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from 图片还原 import get_arr, name_from_p1, restore

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent

NEAR = 30          # 两个候选离这么近就当成同一个
RING_PX = 4        # 环绕带宽度

# y 带宽度。4/3 的实测残差散布是 ±8（10 组样本，标准差 3.9），所以留 10。
Y_SEARCH = 10

# 响应坐标 -> 图像坐标。**4/3 的物理理由最硬**：
#   demo 图 400x200、块 68x68；hb56 图 300x150、块 50x50 —— 正好 4/3。
#   即服务端在 300x150 这个"标准坐标系"里算 y，客户端放大到 400x200。
# ✅ 10 组样本（y_resp 28~71）验证：4/3 ± 10 的带内 #1 在 **10/10** 组上都
#   压在真坑上（逐格裁图放大看过）。残差 -6.7 ~ +3.7，均值 -1.0。
#   同一批数据的最小二乘解是 1.16*y+7.8（标准差 3.2），略好一点，但那是
#   被带心"喂"出来的、有偏，所以**保留 4/3 这个有物理依据的**。
# ⚠️ 全图最暗只有 7/10 对（03/04/10 被暗地形/镜头骗走，ratio 低到 0.185），
#   所以**这个带不是可选项**，它才是把坑从暗地形里摘出来的那一步。
Y_SCALE = 4 / 3
Y_BIAS = 0.0


# ------------------------------------------------------------------ 线索 3：明暗
def bright_map(mask: np.ndarray, bg_gray: np.ndarray,
               ring_px: int = RING_PX) -> np.ndarray:
    """piece 形状窗口内 / 环绕带 的灰度均值之比。值越小越像坑。

    分子分母都用 matchTemplate 一次算完，省掉逐位置滑窗：

        ratio[y, x] = mean(bg[y:y+ph, x:x+pw][mask])
                    / mean(bg[y:y+ph, x:x+pw][ring])

    ring 是 mask 外扩 ring_px 一圈再挖掉 mask 本身 —— "坑外一圈"要贴着坑，
    取太远就会被远处的地面/天空把基准拉歪。

    **原样搬自 ../顶象/缺口.py，未改。**
    注意 mask 是 68x68 的画布，四周透明 —— 透明处是 0，不影响两个均值，
    只影响返回坐标的基准点（见 PIECE_BOX）。
    """
    k = np.ones((2 * ring_px + 1,) * 2, np.uint8)
    ring = ((cv2.dilate(mask, k) > 0) & (mask == 0)).astype(np.float32)
    mf = mask.astype(np.float32)
    g = bg_gray.astype(np.float32)

    hi = cv2.matchTemplate(g, mf, cv2.TM_CCORR) / float(mf.sum())
    ho = cv2.matchTemplate(g, ring, cv2.TM_CCORR) / float(ring.sum())
    return hi / np.maximum(ho, 1e-6)


def candidates(score: np.ndarray, y0: int, y1: int,
               k: int = 3, near: int = NEAR) -> list[tuple[int, int, float]]:
    """在 [y0, y1) 行里取 k 个互相隔开 near 像素的最小值。"""
    flat = score[y0:y1].copy()
    out: list[tuple[int, int, float]] = []
    for _ in range(k):
        y, x = np.unravel_index(int(np.argmin(flat)), flat.shape)
        out.append((int(x), int(y) + y0, float(flat[y, x])))
        flat[:, max(0, x - near):x + near + 1] = 9e9
    return out


def global_candidates(score: np.ndarray, k: int = 5,
                      near: int = NEAR) -> list[tuple[int, int, float]]:
    """全图取 k 个互相隔开 near 像素的最小值（不限制 y）。"""
    return candidates(score, 0, score.shape[0], k=k, near=near)


def imwrite_unicode(path: Path, img: np.ndarray) -> None:
    """cv2.imwrite 在 Windows 上遇到非 ASCII 路径会**静默失败**（返回 False，
    不抛异常），所以绕一圈用 imencode + write_bytes。"""
    ok, buf = cv2.imencode(path.suffix, img)
    if not ok:
        raise RuntimeError(f"imencode 失败: {path}")
    path.write_bytes(buf.tobytes())


# ------------------------------------------------------------------ 主流程
def locate(bg: np.ndarray, piece_rgba: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """返回 (ratio 图, 拼图块不透明区在画布内的 bbox)。"""
    alpha = piece_rgba[:, :, 3]
    mask = (alpha > 128).astype(np.uint8)
    ys, xs = np.where(mask > 0)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    gray = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
    return bright_map(mask, gray), box


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", default=str(HERE / "bg.webp"))
    ap.add_argument("--piece", default=str(HERE / "font.webp"))
    ap.add_argument("--infor", default=str(HERE / "infor.json"))
    ap.add_argument("--y", type=float, default=None, help="响应里的 y，默认从 infor.json 读")
    ap.add_argument("--scale", type=float, default=Y_SCALE,
                    help=f"响应 y -> 图像 y 的系数，默认 {Y_SCALE:.4f}（4/3）")
    ap.add_argument("--bias", type=float, default=Y_BIAS,
                    help=f"响应 y -> 图像 y 的常数项，默认 {Y_BIAS:.1f}")
    ap.add_argument("--out", default=str(HERE / "_缺口.png"))
    a = ap.parse_args()

    infor = json.loads(Path(a.infor).read_text(encoding="utf-8"))
    y_resp = a.y if a.y is not None else infor.get("y")
    p1 = infor.get("p1", "")

    # 1) 先按 p1 文件名还原背景
    table = get_arr(name_from_p1(p1))
    raw = np.asarray(Image.open(a.bg).convert("RGB"))
    bg = restore(raw, table)
    # PIL 给的是 RGB，但下面 locate() 的 cvtColor 和画框都用 cv2（认 BGR），
    # 不转一下会红蓝对调。
    bg = cv2.cvtColor(bg, cv2.COLOR_RGB2BGR)
    piece = np.asarray(Image.open(a.piece).convert("RGBA"))

    print(f"p1         : {name_from_p1(p1)}")
    print(f"乱序表     : {table}")
    print(f"背景图     : {raw.shape[1]}x{raw.shape[0]}")
    print(f"拼图块     : 画布 {piece.shape[1]}x{piece.shape[0]}")

    score, (bx0, by0, bx1, by1) = locate(bg, piece)
    print(f"不透明区   : 画布内偏移 ({bx0},{by0}) 尺寸 {bx1-bx0}x{by1-by0}")
    print(f"ratio 图   : {score.shape[1]}x{score.shape[0]}（坐标 = 画布左上角）")

    # 2) 全图候选（不依赖 scale，先看有没有坑）
    print(f"\n全图最暗 {5} 名（画布左上角坐标 -> 不透明区左上角坐标）:")
    for x, y, v in global_candidates(score, 5):
        print(f"   ratio={v:.3f}  画布=({x:3d},{y:3d})  块=({x+bx0:3d},{y+by0:3d})")

    # 3) y 带内候选
    if y_resp is not None:
        y_img = y_resp * a.scale + a.bias
        y0 = max(0, int(round(y_img)) - Y_SEARCH - by0)
        y1 = min(score.shape[0], int(round(y_img)) + Y_SEARCH + 1 - by0)
        print(f"\ny_resp={y_resp}  ->  图像 y={y_img:.1f}"
              f"（{y_resp}*{a.scale:.4f}+{a.bias:.1f}）")
        print(f"只在 y 带内搜（图像 y {y0+by0}..{y1+by0-1}）:")
        if y1 <= y0:
            print("   带为空 —— scale 大概率不对，调 --scale")
        else:
            for x, y, v in candidates(score, y0, y1, 3):
                print(f"   ratio={v:.3f}  画布=({x:3d},{y:3d})  块=({x+bx0:3d},{y+by0:3d})")

    # 4) 可视化
    vis = bg.copy()
    for i, (x, y, v) in enumerate(global_candidates(score, 3)):
        col = [(0, 0, 255), (0, 200, 255), (0, 255, 0)][i]
        cv2.rectangle(vis, (x + bx0, y + by0), (x + bx1, y + by1), col, 1)
        cv2.putText(vis, f"#{i+1} {v:.2f}", (x + bx0, y + by0 - 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1)
    if y_resp is not None:
        yy = int(round(y_resp * a.scale + a.bias))
        cv2.line(vis, (0, yy), (vis.shape[1] - 1, yy), (255, 0, 0), 1)
    imwrite_unicode(Path(a.out),
                    cv2.resize(vis, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
    print(f"\n已写出 {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
