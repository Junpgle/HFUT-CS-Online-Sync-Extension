#!/usr/bin/env python3
"""Create a reproducible Microsoft Edge Add-ons ZIP (Python 3.9+, stdlib only).

Usage:
    python3 scripts/package_edge.py
    python3 scripts/package_edge.py --output dist/custom.zip

The source manifest keeps its unpacked-install public key.
The Edge ZIP removes that key and enforces the official site-only access list.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    "manifest.json", "shared.js", "content.js",
    "popup.html", "popup.css", "popup.js",
    "icons/icon16.png", "icons/icon48.png", "icons/icon128.png",
    "_locales/zh_CN/messages.json", "_locales/en/messages.json",
]
OFFICIAL_SITE = "https://saltgardenia.github.io/HFUT-CS-Online/*"


def production_manifest() -> bytes:
    source = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if source.get("manifest_version") != 3:
        raise ValueError("Microsoft Edge package requires Manifest V3")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", source.get("version", "")):
        raise ValueError("Invalid extension version")
    # The key is a PUBLIC extension-ID key for unpacked Chrome installs.
    # Store-hosted extensions receive their own ID, so remove it only from the ZIP.
    source.pop("key", None)
    if source.get("default_locale") != "zh_CN":
        raise ValueError("The Edge package must declare Simplified Chinese as default_locale")
    for locale in ("zh_CN", "en"):
        catalog = json.loads((ROOT / f"_locales/{locale}/messages.json").read_text(encoding="utf-8"))
        for key in ("extensionName", "extensionDescription", "actionTitle"):
            if not isinstance(catalog.get(key, {}).get("message"), str):
                raise ValueError(f"Missing localized message {locale}:{key}")
    if source.get("name") != "__MSG_extensionName__" or source.get("description") != "__MSG_extensionDescription__":
        raise ValueError("Localized manifest name/description references are required for Edge Store")
    source["host_permissions"] = [OFFICIAL_SITE]
    scripts = source.get("content_scripts", [])
    if len(scripts) != 1:
        raise ValueError("Expected one explicitly scoped content script")
    scripts[0]["matches"] = [OFFICIAL_SITE]
    if scripts[0].get("js") != ["shared.js", "content.js"]:
        raise ValueError("Unexpected content scripts")
    if set(source.get("permissions", [])) != {"storage", "activeTab"}:
        raise ValueError("Permission list changed; re-audit before publishing")
    return (json.dumps(source, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def create_package(destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = {"manifest.json": production_manifest()}
    for relative in FILES[1:]:
        source = ROOT / relative
        if not source.is_file():
            raise FileNotFoundError(f"Extension asset missing: {relative}")
        payload[relative] = source.read_bytes()
    with ZipFile(destination, "w") as archive:
        for name in FILES:
            entry = ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, payload[name], compresslevel=9)
    try:
        shown = destination.relative_to(ROOT)
    except ValueError:
        shown = destination
    print(f"Created {shown}")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=None, help="Output ZIP path")
    args = parser.parse_args()
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    destination = args.output or ROOT / "dist" / f"HFUT-CS-Online-Sync-Extension-Edge-v{version}.zip"
    if not destination.is_absolute():
        destination = (ROOT / destination).resolve()
    create_package(destination)
    return 0


if __name__ == "__main__":
    sys.exit(main())
