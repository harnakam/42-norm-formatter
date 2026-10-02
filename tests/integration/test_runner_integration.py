from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any, cast

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNNER = PROJECT_ROOT / "python" / "tool_runner.py"
FIXTURES = PROJECT_ROOT / "tests" / "fixtures"


def default_config() -> dict[str, Any]:
    return {
        "traceRunner": False,
        "black": {
            "enabled": True,
            "lineLength": 88,
            "skipStringNormalization": False,
            "skipMagicTrailingComma": False,
            "targetVersions": [],
            "extraArgs": [],
        },
        "flake8": {
            "enabled": True,
            "maxLineLength": 88,
            "ignore": [],
            "select": [],
            "extraArgs": [],
        },
        "mypy": {
            "enabled": True,
            "strict": True,
            "followImports": "normal",
            "ignoreMissingImports": False,
            "extraArgs": [],
        },
    }


def run_request(request: dict[str, Any]) -> dict[str, Any]:
    env = os.environ.copy()
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONPATH"] = ""
    result = subprocess.run(
        [sys.executable, str(RUNNER)],
        cwd=PROJECT_ROOT,
        env=env,
        input=json.dumps(request),
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
        check=False,
    )
    if result.stderr:
        raise AssertionError(f"runner wrote unexpected stderr: {result.stderr}")
    response = cast(dict[str, Any], json.loads(result.stdout))
    if not response.get("ok"):
        raise AssertionError(f"runner failed: {response}")
    return response


class BundledRunnerIntegrationTests(unittest.TestCase):
    def test_format_document_spaces_binary_power_operator(self) -> None:
        response = run_request(
            {
                "version": 1,
                "kind": "format-document",
                "filename": "power.py",
                "source": "def power(base, exp):\n    return base ** exp\n",
                "workspaceRoot": str(FIXTURES),
                "config": default_config(),
            }
        )

        self.assertEqual(
            response["formatted"],
            "def power(base, exp):\n    return base ** exp\n",
        )

    def test_format_document_accepts_empty_source(self) -> None:
        response = run_request(
            {
                "version": 1,
                "kind": "format-document",
                "filename": "empty.py",
                "source": "",
                "workspaceRoot": str(FIXTURES),
                "config": default_config(),
            }
        )

        self.assertEqual(response["formatted"], "")

    def test_format_document_repairs_mixed_tabs_and_spaces(self) -> None:
        response = run_request(
            {
                "version": 1,
                "kind": "format-document",
                "filename": "sample.py",
                "source": "def example():\n\tvalue=1\n    return value\n",
                "workspaceRoot": str(FIXTURES),
                "config": default_config(),
            }
        )

        self.assertEqual(
            response["formatted"],
            "def example():\n    value = 1\n    return value\n",
        )

    def test_format_document_repairs_tab_with_trailing_indent_space(self) -> None:
        for trailing_spaces in range(1, 4):
            with self.subTest(trailing_spaces=trailing_spaces):
                response = run_request(
                    {
                        "version": 1,
                        "kind": "format-document",
                        "filename": "sample.py",
                        "source": (
                            "def example():\n"
                            + "\t"
                            + (" " * trailing_spaces)
                            + "value=1\n    return value\n"
                        ),
                        "workspaceRoot": str(FIXTURES),
                        "config": default_config(),
                    }
                )

                self.assertEqual(
                    response["formatted"],
                    "def example():\n    value = 1\n    return value\n",
                )

    def test_format_document_uses_bundled_black(self) -> None:
        response = run_request(
            {
                "version": 1,
                "kind": "format-document",
                "filename": "sample.py",
                "source": "value={1,2}\n",
                "workspaceRoot": str(FIXTURES),
                "config": default_config(),
            }
        )

        self.assertEqual(response["formatted"], "value = {1, 2}\n")

    def test_check_document_reports_flake8_and_strict_mypy(self) -> None:
        fixture = FIXTURES / "strict_failure.py"
        response = run_request(
            {
                "version": 1,
                "kind": "check-document",
                "filename": str(fixture),
                "source": fixture.read_text(encoding="utf-8"),
                "workspaceRoot": str(FIXTURES),
                "config": default_config(),
            }
        )

        tools = {item["tool"] for item in response["diagnostics"]}
        self.assertEqual(tools, {"flake8", "mypy"})
        self.assertEqual(response["summary"]["failedTools"], [])
        self.assertTrue(any(item["code"] == "F401" for item in response["diagnostics"]))
        self.assertTrue(
            any(item["code"] == "return-value" for item in response["diagnostics"])
        )

    def test_bundled_modules_are_loaded_without_user_site_packages(self) -> None:
        script = (
            "import importlib.metadata as metadata, sys; "
            f"sys.path.insert(0, {str(PROJECT_ROOT / 'python' / 'vendor')!r}); "
            "import black, flake8, mypy; "
            "print(black.__version__, flake8.__version__, metadata.version('mypy'))"
        )
        env = os.environ.copy()
        env["PYTHONNOUSERSITE"] = "1"
        env["PYTHONPATH"] = ""

        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=PROJECT_ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "26.5.1 7.3.0 1.18.2")


if __name__ == "__main__":
    unittest.main()
