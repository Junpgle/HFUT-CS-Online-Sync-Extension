#!/usr/bin/env python3
"""Upload an existing Edge Add-ons product update using the v1.1 API."""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID
from zipfile import ZipFile

API = "https://api.addons.microsoftedge.microsoft.com/v1"
ROOT = Path(__file__).resolve().parent.parent


class PublishError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    # Never forward credentials to a redirected host.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise PublishError(f"Missing GitHub Actions secret: {name}")
    return value


def operation_id(location):
    # The API returns either the ID or a location ending in the ID.
    value = urlsplit(location or "").path.rstrip("/").rsplit("/", 1)[-1]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise PublishError("Microsoft did not return a valid operation ID")
    return value


class EdgeClient:
    def __init__(self, product_id, client_id, api_key):
        try:
            product_id = str(UUID(product_id))
        except ValueError:
            raise PublishError("EDGE_PRODUCT_ID must be the Partner Center product GUID, not the browser extension ID") from None
        self.base = API + "/products/" + product_id + "/submissions"
        self.headers = {"Authorization": "ApiKey " + api_key, "X-ClientID": client_id}
        self.opener = build_opener(NoRedirect())

    def request(self, path, method="GET", data=None, content_type=None):
        headers = dict(self.headers)
        if content_type:
            headers["Content-Type"] = content_type
        request = Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=25) as response:
                return response.status, response.headers, response.read()
        except HTTPError as exc:
            # No response body or credential/header dumps in public CI logs.
            raise PublishError(f"Microsoft API HTTP {exc.code} for {method} {path}; check Partner Center before retrying") from None
        except (URLError, TimeoutError):
            raise PublishError(f"Microsoft API connection failed for {method} {path}; check operation state before retrying") from None

    def start(self, path, payload, content_type):
        status, headers, _ = self.request(path, "POST", payload, content_type)
        if status != 202:
            raise PublishError(f"Expected HTTP 202, received {status}")
        return operation_id(headers.get("Location"))

    def wait(self, path, attempts=40, delay=10):
        for attempt in range(attempts):
            status, _, raw = self.request(path)
            if status != 200:
                raise PublishError(f"Unexpected operation HTTP status {status}")
            try:
                result = json.loads(raw)
                state = result["status"]
            except (ValueError, KeyError, TypeError):
                raise PublishError("Invalid Microsoft operation response") from None
            if state == "Succeeded":
                return
            if state != "InProgress":
                code = result.get("errorCode") or "unknown"
                if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", code):
                    code = "unknown"
                raise PublishError(f"Operation did not succeed ({code}); inspect Partner Center")
            if attempt + 1 < attempts:
                time.sleep(delay)
        raise PublishError("Microsoft operation did not finish in time; check Partner Center before retrying")


def verify_version(package, tag):
    with ZipFile(package) as archive:
        version = json.loads(archive.read("manifest.json"))["version"]
    source = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:\.\d+)?", tag) or tag != "v" + version or version != source:
        raise PublishError("Tag, source manifest and ZIP manifest versions must match")
    return version


def submit(client, package, version):
    upload = client.start("/draft/package", package.read_bytes(), "application/zip")
    print("Package upload accepted; waiting for validation.", flush=True)
    client.wait("/draft/package/operations/" + upload)
    notes = (
        f"HFUT-CS-Online Sync Extension v{version}. "
        "Test at https://saltgardenia.github.io/HFUT-CS-Online/ : complete a quiz, "
        "scroll a chapter, open the extension to inspect progress and sync. "
        "Optional Question-Bank login enables independent cloud sync. "
        "No remote executable code. See the repository certification guide."
    )
    publication = client.start("", json.dumps({"notes": notes}).encode("utf-8"), "application/json")
    print("Certification submission accepted; checking operation status.", flush=True)
    client.wait("/operations/" + publication)
    print("Submission created successfully. Microsoft certification and store publication are still pending.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    try:
        version = verify_version(args.package, args.tag)
        client = EdgeClient(required("EDGE_PRODUCT_ID"), required("EDGE_CLIENT_ID"), required("EDGE_API_KEY"))
        submit(client, args.package, version)
        return 0
    except (PublishError, OSError, ValueError, KeyError) as exc:
        print(f"Edge submission failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
