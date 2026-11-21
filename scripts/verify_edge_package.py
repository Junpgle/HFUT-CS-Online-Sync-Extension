#!/usr/bin/env python3
"""Inspect the actual Edge store ZIP before uploading (no external dependencies)."""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path
from zipfile import ZipFile

EXPECTED = {
    "manifest.json", "shared.js", "content.js",
    "popup.html", "popup.css", "popup.js",
    "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
}
SITE = "https://saltgardenia.github.io/HFUT-CS-Online/*"


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
        assert manifest.get("host_permissions") == [SITE]
        assert set(manifest["permissions"]) == {"storage", "activeTab"}
        scripts = manifest["content_scripts"]
        assert len(scripts) == 1 and scripts[0]["matches"] == [SITE]
        assert scripts[0]["js"] == ["shared.js", "content.js"]
        assert manifest["action"]["default_popup"] == "popup.html"
        assert len(manifest.get("description", "")) <= 132
        for icon_name, required in [(f"icons/icon{n}.png", n) for n in (16, 48, 128)]:
            data = archive.read(icon_name)
            assert data[:8] == b"\x89PNG\r\n\x1a\n", f"Not a PNG: {icon_name}"
            width, height = struct.unpack(">II", data[16:24])
            assert (width, height) == (required, required), f"Wrong icon size: {icon_name}"
        page = archive.read("popup.html").decode("utf-8")
        assert 'src="shared.js"' in page and 'src="popup.js"' in page
        for file in ("content.js", "popup.js", "shared.js"):
            source = archive.read(file).decode("utf-8")
            assert not re.search(r"\beval\s*\(", source), f"Remote/dynamic execution: {file}"
            assert "http://localhost" not in source, "Store runtime must not mention dev host"
        assert all(not item.startswith(("tests/", "scripts/", "store/", ".github/", "dist/")) for item in names)
    print(f"PASS: Edge ZIP verified ({filename.name}, {manifest['version']}, {len(names)} files)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Path to built ZIP package")
    args = parser.parse_args()
    inspect_package(args.package)
    return 0


if __name__ == "__main__":
    sys.exit(main())
