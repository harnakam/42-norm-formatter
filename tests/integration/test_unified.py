from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def request(
    root: Path, kind: str, source: str = "", config: dict[str, Any] | None = None
) -> dict[str, Any]:
    process = subprocess.run(
        [sys.executable, "-B", str(ROOT / "python/tool_runner.py")],
        input=json.dumps(
            {
                "version": 1,
                "kind": kind,
                "filename": str(root / "main.py"),
                "source": source,
                "workspaceRoot": str(root),
                "config": config or {},
            }
        ),
        text=True,
        capture_output=True,
        cwd=root,
        check=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        timeout=120,
    )
    result: dict[str, Any] = json.loads(process.stdout)
    assert result["ok"], result
    return result


class UnifiedIntegrationTests(unittest.TestCase):
    def test_rough_code_formats_passes_strict_and_leaves_no_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = 'def main()\n\tprint( "hello" );print(42)\n\nmain()\n'
            formatted = request(root, "format-document", source)["formatted"]
            self.assertIn("def main() -> None:", formatted)
            self.assertNotIn(";", formatted)
            (root / "main.py").write_text(formatted, encoding="utf-8")
            before = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
            for kind in ("check-document", "check-workspace"):
                checked = request(root, kind, formatted)
                self.assertEqual(checked["summary"]["failedTools"], [])
                self.assertEqual(checked["diagnostics"], [])
                self.assertEqual(
                    sorted(str(p.relative_to(root)) for p in root.rglob("*")), before
                )
            self.assertEqual(
                request(root, "format-document", formatted)["formatted"], formatted
            )

    def test_undefined_parameter_type_remains_a_strict_diagnostic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            formatted = request(
                root, "format-document", "def f(value):\n    return value\n"
            )["formatted"]
            (root / "main.py").write_text(formatted, encoding="utf-8")
            checked = request(root, "check-document", formatted)
            self.assertTrue(
                any(item["code"] == "no-untyped-def" for item in checked["diagnostics"])
            )
            self.assertNotIn("Any", formatted)
            self.assertNotIn("type: ignore", formatted)

    def test_repairs_can_be_disabled_and_unrepairable_source_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = "def main()\n    print(1)\n"
            result = request(
                root, "format-document", source, {"repairMissingColons": False}
            )
            self.assertEqual(result["formatted"], source)
            self.assertTrue(result["summary"]["formatError"])
            result = request(
                root,
                "format-document",
                "def main():\n    print(1)\n",
                {"addNoneReturnAnnotations": False},
            )
            self.assertNotIn("->", result["formatted"])

    def test_type_ignore_and_string_contents_survive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = 'x: int="value"  # type: ignore[assignment]\ns = "if x\\n  y"\n'
            formatted = request(root, "format-document", source)["formatted"]
            self.assertIn("# type: ignore[assignment]", formatted)
            (root / "main.py").write_text(formatted, encoding="utf-8")
            result = request(root, "check-document", formatted)
            self.assertEqual(
                [d for d in result["diagnostics"] if d["tool"] == "mypy"], []
            )
