#!/usr/bin/env python3
"""Inspect the actual Edge store ZIP before uploading (no external dependencies)."""
from __future__ import annotations

import argparse
import json
import re
import struct
import zlib
import sys
from pathlib import Path
from zipfile import ZipFile

EXPECTED = {
    "manifest.json", "shared.js", "content.js",
    "popup.html", "popup.css", "popup.js", "background.js",
    "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
    "_locales/zh_CN/messages.json", "_locales/en/messages.json",
}
SITE = "https://saltgardenia.github.io/HFUT-CS-Online/*"


def validate_png(data: bytes, size: int, label: str) -> None:
    """Check PNG dimensions, chunk CRCs and the entire compressed image stream."""
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), f"Invalid PNG signature: {label}"
    pos, chunks, info, ended = 8, bytearray(), None, False
    while pos + 12 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        end = pos + 12 + length
        assert end <= len(data), f"Truncated PNG: {label}"
        body = data[pos + 8:pos + 8 + length]
        expected_crc = struct.unpack(">I", data[pos + 8 + length:end])[0]
        assert zlib.crc32(typ + body) == expected_crc, f"PNG checksum error: {label}"
        if typ == b"IHDR":
            assert info is None and len(body) == 13
            info = struct.unpack(">IIBBBBB", body)
        elif typ == b"IDAT":
            chunks.extend(body)
        elif typ == b"IEND":
            assert length == 0, f"Invalid PNG end: {label}"
            ended = True
            pos = end
            break
        pos = end
    assert ended and pos == len(data) and info and chunks, f"Incomplete PNG: {label}"
    width, height, bits, color, compression, filtering, interlace = info
    assert (width, height) == (size, size), f"Wrong PNG dimensions: {label}"
    assert (compression, filtering, interlace) == (0, 0, 0), f"Unsupported PNG format: {label}"
    if label.startswith("icons/"):
        assert (bits, color) == (8, 6), f"Extension icons must use 8-bit RGBA PNG: {label}"
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    row = (width * bits * channels + 7) // 8
    stream = zlib.decompressobj()
    pixels = stream.decompress(bytes(chunks)) + stream.flush()
    assert stream.eof and not stream.unused_data, f"Damaged PNG DEFLATE stream: {label}"
    assert len(pixels) == height * (row + 1), f"Incomplete pixel data: {label}"
    assert all(pixels[i * (row + 1)] <= 4 for i in range(height)), f"Invalid PNG filter: {label}"



def inspect_package(filename: Path) -> None:
    with ZipFile(filename) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), "Duplicate ZIP entries"
        assert set(names) == EXPECTED, f"Unexpected ZIP file set: {set(names) ^ EXPECTED}"
        assert archive.testzip() is None, "Corrupt ZIP member"
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert manifest["manifest_version"] == 3
        assert re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", manifest["version"])
        assert "key" not in manifest, "Do not ship unpacked-install key in the store ZIP"
        assert manifest.get("host_permissions") == [SITE, "https://worker.junpgle.me/*"]
        assert manifest.get("background", {}).get("service_worker") == "background.js"
        assert set(manifest["permissions"]) == {"storage", "activeTab"}
        scripts = manifest["content_scripts"]
        assert len(scripts) == 1 and scripts[0]["matches"] == [SITE]
        assert scripts[0]["js"] == ["shared.js", "content.js"]
        assert manifest["action"]["default_popup"] == "popup.html"
        assert manifest.get("default_locale") == "zh_CN", "Default locale must be Simplified Chinese"
        assert manifest["name"] == "__MSG_extensionName__"
        assert manifest["description"] == "__MSG_extensionDescription__"
        assert manifest["action"]["default_title"] == "__MSG_actionTitle__"
        localized = {}
        for locale in ("zh_CN", "en"):
            messages = json.loads(archive.read(f"_locales/{locale}/messages.json").decode("utf-8"))
            assert set(messages) >= {"extensionName", "extensionDescription", "actionTitle"}
            for key in ("extensionName", "extensionDescription", "actionTitle"):
                assert isinstance(messages[key].get("message"), str) and messages[key]["message"].strip()
            assert len(messages["extensionName"]["message"]) <= 75
            assert len(messages["extensionDescription"]["message"]) <= 132
            localized[locale] = messages
        assert "同步" in localized["zh_CN"]["extensionName"]["message"], "Chinese extension name missing"
        assert "Sync" in localized["en"]["extensionName"]["message"], "English extension name missing"
        for icon_name, required in [(f"icons/icon{n}.png", n) for n in (16, 48, 128)]:
            validate_png(archive.read(icon_name), required, icon_name)
        page = archive.read("popup.html").decode("utf-8")
        assert 'src="shared.js"' in page and 'src="popup.js"' in page
        assert "PRIVACY.md" in page, "Privacy policy must be reachable from popup"
        assert not re.search(r'<script[^>]+src=["\x27]https?://', page), "Remote scripts not allowed"
        for file in ("content.js", "popup.js", "shared.js"):
            source = archive.read(file).decode("utf-8")
            assert not re.search(r"\beval\s*\(", source), f"Dynamic execution: {file}"
            assert not re.search(r"\bnew\s+Function\s*\(", source), f"Dynamic code compilation: {file}"
            assert "http://localhost" not in source, "Store runtime must not mention dev host"
        assert all(not item.startswith(("tests/", "scripts/", "store/", ".github/", "dist/")) for item in names)
    root = Path(__file__).resolve().parent.parent
    validate_png((root / "store/assets/logo-300.png").read_bytes(), 300, "store/assets/logo-300.png")
    privacy = (root / "PRIVACY.md").read_text(encoding="utf-8")
    listing = (root / "store/EDGE_LISTING.zh-CN.md").read_text(encoding="utf-8")
    english = (root / "store/EDGE_LISTING.en.md").read_text(encoding="utf-8")
    assert "chrome.storage.sync" in privacy and "Cookie" in privacy
    assert "## 商店详细介绍" in listing and "## 推荐类别" in listing
    body = listing.split("## 商店详细介绍", 1)[1].split("## 推荐类别", 1)[0].strip()
    assert 250 <= len(body) <= 10_000, "Chinese Edge listing must contain 250-10000 characters"
    assert "## Full description" in english and "## Store category" in english
    en_body = english.split("## Full description", 1)[1].split("## Store category", 1)[0].strip()
    assert 250 <= len(en_body) <= 10_000, "English Edge listing must contain 250-10000 characters"
    assert localized["zh_CN"]["extensionName"]["message"] in listing
    assert localized["en"]["extensionName"]["message"] in english
    print(f"PASS: Edge ZIP verified ({filename.name}, {manifest['version']}, {len(names)} files, Chinese {len(body)} / English {len(en_body)} chars)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Path to built ZIP package")
    args = parser.parse_args()
    inspect_package(args.package)
    return 0


if __name__ == "__main__":
    sys.exit(main())
