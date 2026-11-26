"""Offline release transport tests: never contact Microsoft."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("publish_edge", Path(__file__).resolve().parents[1] / "scripts/publish_edge.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PublishTests(unittest.TestCase):
    def test_operation_id(self):
        self.assertEqual(p.operation_id("abc-123"), "abc-123")
        self.assertEqual(p.operation_id("https://api.addons.microsoftedge.microsoft.com/operations/abc"), "abc")
        for bad in ("", "/", "..", "a%2Fb"):
            with self.assertRaises(p.PublishError):
                p.operation_id(bad)

    def test_product_guid(self):
        with self.assertRaises(p.PublishError):
            p.EdgeClient("ladgbknkfnbpmdfmjffhhbiajjceicip", "client", "key")

    def test_poll(self):
        client = p.EdgeClient("12345678-1234-1234-1234-123456789abc", "client", "key")
        client.request = Mock(side_effect=[
            (200, {}, b'{"status":"InProgress"}'),
            (200, {}, b'{"status":"Succeeded"}'),
        ])
        client.wait("/operations/example", delay=0)
        client.request = Mock(return_value=(200, {}, b'{"status":"Failed","errorCode":"SubmissionValidationError"}'))
        with self.assertRaises(p.PublishError):
            client.wait("/operations/example", delay=0)
        client.request = Mock(return_value=(200, {}, b'{"status":"InProgress"}'))
        with self.assertRaises(p.PublishError):
            client.wait("/operations/example", attempts=1, delay=0)

    def test_upload_failure_blocks_submission(self):
        client = Mock()
        client.start.return_value = "upload-id"
        client.wait.side_effect = p.PublishError("invalid package")
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "extension.zip"
            file.write_bytes(b"example")
            with self.assertRaises(p.PublishError):
                p.submit(client, file, "2.4.0")
        self.assertEqual(client.start.call_count, 1)

    def test_success_order_and_notes(self):
        client = Mock()
        client.start.side_effect = ["upload-id", "publish-id"]
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "extension.zip"
            file.write_bytes(b"example")
            p.submit(client, file, "2.4.0")
        self.assertEqual([c.args[0] for c in client.method_calls], [
            "/draft/package", "/draft/package/operations/upload-id", "", "/operations/publish-id"])
        self.assertIn("v2.4.0", json.loads(client.start.call_args.args[1])["notes"])

    def test_manifest_version(self):
        version = json.loads((p.ROOT / "manifest.json").read_text())["version"]
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "extension.zip"
            with ZipFile(file, "w") as archive:
                archive.writestr("manifest.json", json.dumps({"version": version}))
            self.assertEqual(p.verify_version(file, "v" + version), version)
            with self.assertRaises(p.PublishError):
                p.verify_version(file, "v0.0.0")


if __name__ == "__main__":
    unittest.main()
