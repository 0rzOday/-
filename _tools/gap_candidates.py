#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""三个检测器各出候选，合并去重，输出候选答案 x（JSON 数组）。

检测器：
  bright : 明暗比值（缺口.py 的 bright_map，越小越像坑）
  rim    : 亮环 - 暗心（越大越像坑）
  edge   : 拼图轮廓在背景边缘图上的响应（越大越像坑）

用法: python _tools/gap_candidates.py --bg x --piece y --infor z [--top 4]
输出: {"pieceX": [...], "ansX": [...]}  —— ansX 已按 ×0.95 换算
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from 图片还原 import get_arr, name_from_p1, restore          # noqa: E402
from 缺口 import bright_map                                   # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def topk(score, k, largest, near=25):
    flat = score.copy()
    out = []
    fill = -9e9 if largest else 9e9
    for _ in range(k):
        idx = int(np.argmax(flat)) if largest else int(np.argmin(flat))
        y, x = np.unravel_index(idx, flat.shape)
        out.append((int(x), int(y), float(flat[y, x])))
        flat[:, max(0, x - near):x + near + 1] = fill
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", required=True)
    ap.add_argument("--piece", required=True)
    ap.add_argument("--infor", required=True)
    ap.add_argument("--top", type=int, default=4)
    a = ap.parse_args()

    inf = json.loads(Path(a.infor).read_text(encoding="utf-8"))
    bg = np.asarray(Image.open(a.bg).convert("RGB"))
    bg = restore(bg, get_arr(name_from_p1(inf.get("p1", ""))))
    gray = cv2.cvtColor(bg, cv2.COLOR_RGB2GRAY).astype(np.float32)
    pc = np.asarray(Image.open(a.piece).convert("RGBA"))
    mask = (pc[:, :, 3] > 128).astype(np.uint8)
    ys, xs = np.where(mask > 0)
    bx0 = int(xs.min())

    # 1) 明暗
    bright = bright_map(mask, gray)
    # 2) 亮环 - 暗心
    inner = cv2.erode(mask, np.ones((9, 9), np.uint8)).astype(np.float32)
    outer = cv2.dilate(mask, np.ones((11, 11), np.uint8))
    ring = ((outer > 0) & (mask == 0)).astype(np.float32)
    rim = (cv2.matchTemplate(gray, ring, cv2.TM_CCORR) / max(ring.sum(), 1.0)
           - cv2.matchTemplate(gray, inner, cv2.TM_CCORR) / max(inner.sum(), 1.0))
    # 3) 轮廓 vs 边缘图
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    cont = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(np.float32)
    edge = cv2.matchTemplate(mag, cont, cv2.TM_CCORR) / max(cont.sum(), 1.0)

    lists = [("bright", topk(bright, a.top, False)),
             ("rim", topk(rim, a.top, True)),
             ("edge", topk(edge, a.top, True))]

    # 交错合并 + 去重
    out, seen = [], []
    for r in range(a.top):
        for name, lst in lists:
            if r >= len(lst):
                continue
            x, y, v = lst[r]
            px = x + bx0
            if any(abs(px - s) <= 4 for s in seen):
                continue
            seen.append(px)
            out.append({"src": name, "rank": r + 1, "canvasX": x, "canvasY": y,
                        "pieceX": px, "ansX": round(px * 0.95), "score": round(v, 3)})

    for o in out:
        print(f"  {o['src']:6s}#{o['rank']}  画布=({o['canvasX']:3d},{o['canvasY']:3d})  "
              f"块={o['pieceX']:3d}  答案x={o['ansX']:3d}  score={o['score']}", file=sys.stderr)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
