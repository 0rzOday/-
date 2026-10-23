#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""亮环检测缺口：真坑是「暗心 + 一圈亮边」，自然暗区没有亮边。

score(y, x) = mean(bg[环]) - mean(bg[心])
    环 = 拼图块形状外扩一圈再挖掉本身
    心 = 拼图块形状内缩几像素
真坑：环亮、心暗 → 高分；碗底那种自然暗区：环不亮 → 低分。

用法: python _tools/gap_rim.py --bg x.webp --piece y.webp --infor z.json [--k 5]
输出: 每个候选的  环均 - 心均 分数 + 画布坐标 + 块坐标
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from 图片还原 import get_arr, name_from_p1, restore   # noqa: E402

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def rim_score(piece_rgba: np.ndarray, bg_gray: np.ndarray,
              inner_px: int = 4, ring_px: int = 5) -> np.ndarray:
    mask = (piece_rgba[:, :, 3] > 128).astype(np.uint8)
    inner = cv2.erode(mask, np.ones((2 * inner_px + 1,) * 2, np.uint8))
    outer = cv2.dilate(mask, np.ones((2 * ring_px + 1,) * 2, np.uint8))
    ring = ((outer > 0) & (mask == 0)).astype(np.float32)
    mi = inner.astype(np.float32)
    g = bg_gray.astype(np.float32)
    hi = cv2.matchTemplate(g, mi, cv2.TM_CCORR) / max(float(mi.sum()), 1.0)
    hr = cv2.matchTemplate(g, ring, cv2.TM_CCORR) / max(float(ring.sum()), 1.0)
    return hr - hi


def topk(score: np.ndarray, k: int, near: int = 30):
    flat = score.copy()
    out = []
    for _ in range(k):
        y, x = np.unravel_index(int(np.argmax(flat)), flat.shape)
        out.append((int(x), int(y), float(flat[y, x])))
        flat[:, max(0, x - near):x + near + 1] = -9e9
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", required=True)
    ap.add_argument("--piece", required=True)
    ap.add_argument("--infor", required=True)
    ap.add_argument("--k", type=int, default=5)
    a = ap.parse_args()

    inf = json.loads(Path(a.infor).read_text(encoding="utf-8"))
    p1 = inf.get("p1", "")
    bg = np.asarray(Image.open(a.bg).convert("RGB"))
    bg = restore(bg, get_arr(name_from_p1(p1)))
    gray = cv2.cvtColor(bg, cv2.COLOR_RGB2GRAY)
    piece = np.asarray(Image.open(a.piece).convert("RGBA"))

    alpha = piece[:, :, 3]
    ys, xs = np.where(alpha > 128)
    bx0, by0 = int(xs.min()), int(ys.min())
    bw, bh = int(xs.max()) + 1 - bx0, int(ys.max()) + 1 - by0

    score = rim_score(piece, gray)
    print(f"图 {gray.shape[1]}x{gray.shape[0]}  块不透明区 ({bx0},{by0}) {bw}x{bh}  "
          f"score 图 {score.shape[1]}x{score.shape[0]}")
    print("环均 - 心均（越大越像坑）:")
    for i, (x, y, v) in enumerate(topk(score, a.k)):
        print(f"  #{i+1}  score={v:+.2f}  画布=({x:3d},{y:3d})  块=({x+bx0:3d},{y+by0:3d})  "
              f"答案x={round((x + bx0) * 0.95)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
