#!/usr/bin/env python3
"""Re-encode runtime icons as standards-compliant 8-bit RGBA PNG files.

The previous indexed-color PNGs could pass ZIP checks but were rejected by
some Chromium extension installers. Install Pillow to use this repair tool:
    python -m pip install Pillow==11.3.0
    python scripts/repair_icons.py
"""
from __future__ import annotations

import hashlib
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def repair_icon(size: int) -> None:
    path = ROOT / "icons" / f"icon{size}.png"
    with Image.open(path) as source:
        source.load()  # Fail on incomplete or malformed image streams.
        if source.size != (size, size):
            raise ValueError(f"{path}: expected {size}x{size}, got {source.size}")
        rgba = source.convert("RGBA")
    rgba.save(path, format="PNG", optimize=True, compress_level=9)
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: missing PNG signature")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", raw[16:29]
    )
    if (width, height, depth, color, compression, filtering, interlace) != (
        size, size, 8, 6, 0, 0, 0
    ):
        raise ValueError(f"{path}: output must be 8-bit RGBA PNG")
    with Image.open(path) as check:
        check.verify()
    with Image.open(path) as check:
        check.load()
    print(f"OK {path.relative_to(ROOT)}: RGBA, {len(raw)} bytes, sha256={hashlib.sha256(raw).hexdigest()}")


if __name__ == "__main__":
    for size in (16, 48, 128):
        repair_icon(size)
