from __future__ import annotations

import unittest
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from python.tool_runner import (
    build_black_mode_kwargs,
    build_black_args,
    build_flake8_args,
    build_mypy_args,
    format_with_black,
    handle_request,
    parse_flake8,
    parse_mypy,
)


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


def document_request(filename: str = "/work/a.py") -> dict[str, object]:
    return {
        "version": 1,
        "kind": "check-document",
        "filename": filename,
        "source": "import os\nvalue = 1\n",
        "workspaceRoot": "/work",
        "config": default_config(),
    }


class FakeExecutor:
    def __init__(self, results: dict[str, tuple[int, str, str]]) -> None:
        self.results = results
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        tool: str,
        args: list[str],
        *,
        input_text: str | None,
        cwd: str,
    ) -> tuple[int, str, str]:
        self.calls.append(
            {
                "tool": tool,
                "args": list(args),
                "input_text": input_text,
                "cwd": cwd,
            }
        )
        return self.results[tool]


class RunnerParserTests(unittest.TestCase):
    def test_parse_flake8_preserves_code_and_location(self) -> None:
        raw = "/work/a.py\x1f3\x1f5\x1fF401\x1f'x' imported but unused\n"

        self.assertEqual(
            parse_flake8(raw)[0],
            {
                "tool": "flake8",
                "path": "/work/a.py",
                "line": 3,
                "column": 5,
                "endLine": 3,
                "endColumn": 6,
                "severity": "warning",
                "code": "F401",
                "message": "'x' imported but unused",
            },
        )

    def test_parse_flake8_ignores_unstructured_output(self) -> None:
        self.assertEqual(parse_flake8("flake8 internal chatter\n"), [])

    def test_parse_mypy_supports_windows_drive_paths(self) -> None:
        raw = "C:\\work\\a.py:4:7: error: Bad value  [assignment]\n"

        item = parse_mypy(raw)[0]

        self.assertEqual(item["path"], "C:\\work\\a.py")
        self.assertEqual(
            (item["line"], item["column"], item["code"]),
            (4, 7, "assignment"),
        )
        self.assertEqual(item["message"], "Bad value")

    def test_parse_mypy_maps_notes_to_information(self) -> None:
        item = parse_mypy("a.py:1: note: See this detail\n")[0]

        self.assertEqual(item["severity"], "information")
        self.assertEqual(item["column"], 1)


class RunnerArgumentTests(unittest.TestCase):
    def test_black_arguments_apply_extra_args_after_explicit_settings(self) -> None:
        args = build_black_args(
            "/work/a.py",
            {
                "lineLength": 88,
                "skipStringNormalization": True,
                "skipMagicTrailingComma": True,
                "targetVersions": ["py310"],
                "extraArgs": ["--line-length=120", "--preview"],
            },
        )

        self.assertEqual(
            args,
            [
                "--quiet",
                "--line-length=88",
                "--skip-string-normalization",
                "--skip-magic-trailing-comma",
                "--target-version=py310",
                "--line-length=120",
                "--preview",
                "--no-cache",
                "--stdin-filename=/work/a.py",
                "-",
            ],
        )

    def test_mypy_arguments_are_strict_by_default(self) -> None:
        args = build_mypy_args(
            ["/work/a.py"],
            {
                "strict": True,
                "followImports": "normal",
                "ignoreMissingImports": False,
                "extraArgs": [],
            },
        )

        self.assertIn("--strict", args)
        self.assertIn("--show-error-codes", args)
        self.assertIn("--show-column-numbers", args)
        self.assertEqual(args[-1], "/work/a.py")

    def test_mypy_arguments_apply_shadow_file_and_extra_args_last(self) -> None:
        args = build_mypy_args(
            ["/work/a.py"],
            {
                "strict": False,
                "followImports": "skip",
                "ignoreMissingImports": True,
                "extraArgs": ["--warn-unused-ignores"],
            },
            shadow_file=("/work/a.py", "/tmp/a.py"),
        )

        self.assertNotIn("--strict", args)
        self.assertIn("--ignore-missing-imports", args)
        self.assertEqual(
            args[-8:],
            [
                "--shadow-file",
                "/work/a.py",
                "/tmp/a.py",
                "--warn-unused-ignores",
                "--no-incremental",
                "--cache-dir",
                os.devnull,
                "/work/a.py",
            ],
        )

    def test_flake8_arguments_include_structured_format_and_filters(self) -> None:
        args = build_flake8_args(
            ["-"],
            {
                "maxLineLength": 99,
                "ignore": ["E203", "W503"],
                "select": ["E", "F"],
                "extraArgs": ["--statistics"],
            },
            stdin_filename="/work/a.py",
        )

        self.assertIn("--stdin-display-name=/work/a.py", args)
        self.assertIn("--max-line-length=99", args)
        self.assertIn("--ignore=E203,W503", args)
        self.assertIn("--select=E,F", args)
        self.assertEqual(args[-2:], ["--statistics", "-"])

    def test_black_mode_kwargs_normalize_targets(self) -> None:
        actual = build_black_mode_kwargs(
            {
                "lineLength": 100,
                "skipStringNormalization": True,
                "skipMagicTrailingComma": True,
                "targetVersions": ["py310", "PY311"],
                "extraArgs": [],
            }
        )

        self.assertEqual(actual["line_length"], 100)
        self.assertEqual(actual["string_normalization"], False)
        self.assertEqual(actual["magic_trailing_comma"], False)
        self.assertEqual(actual["target_versions"], {"PY310", "PY311"})

    def test_format_with_black_returns_formatted_text_from_configured_mode(
        self,
    ) -> None:
        class FakeBlack:
            TargetVersion = {"PY310": "target-310"}

            class NothingChanged(Exception):
                pass

            @staticmethod
            def FileMode(**kwargs: object) -> dict[str, object]:
                return kwargs

            @staticmethod
            def format_file_contents(
                source: str, *, fast: bool, mode: dict[str, object]
            ) -> str:
                self.assertFalse(fast)
                self.assertEqual(mode["line_length"], 100)
                self.assertEqual(mode["target_versions"], {"target-310"})
                return "value = {1, 2}\n"

        actual = format_with_black(
            "value={1,2}\n",
            "sample.py",
            {
                "lineLength": 100,
                "skipStringNormalization": False,
                "skipMagicTrailingComma": False,
                "targetVersions": ["py310"],
                "extraArgs": [],
            },
            black_module=FakeBlack,
        )

        self.assertEqual(actual, "value = {1, 2}\n")

    def test_format_with_black_keeps_normalized_indent_when_black_is_unchanged(
        self,
    ) -> None:
        class FakeBlack:
            TargetVersion: dict[str, object] = {}

            class NothingChanged(Exception):
                pass

            @staticmethod
            def FileMode(**kwargs: object) -> dict[str, object]:
                return kwargs

            @staticmethod
            def format_file_contents(
                source: str, *, fast: bool, mode: dict[str, object]
            ) -> str:
                del source, fast, mode
                raise FakeBlack.NothingChanged

        actual = format_with_black(
            "def example():\n\tvalue = 1\n    return value\n",
            "sample.py",
            default_config()["black"],
            black_module=FakeBlack,
        )

        self.assertEqual(
            actual,
            "def example():\n    value = 1\n    return value\n",
        )


class RunnerRequestTests(unittest.TestCase):
    def test_format_document_skips_black_parse_errors(self) -> None:
        source = "def coords_to_xyz(center, coords)\n    return center\n"
        executor = FakeExecutor(
            {
                "black": (
                    123,
                    "",
                    "error: cannot format /work/example.py: Cannot parse: 1:33\n"
                    "ParseError: bad input\n",
                )
            }
        )
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/example.py",
            "source": source,
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertTrue(response["ok"])
        self.assertEqual(response["formatted"], source)

    def test_format_document_keeps_non_parse_black_failures_visible(self) -> None:
        executor = FakeExecutor(
            {"black": (1, "", "Permission denied while starting Black")}
        )
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/example.py",
            "source": "value=1\n",
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        with self.assertRaisesRegex(RuntimeError, "Permission denied"):
            handle_request(request, executor=executor)

    def test_format_document_spaces_binary_power_operator(self) -> None:
        executor = FakeExecutor(
            {"black": (0, "def power(base, exp):\n    return base**exp\n", "")}
        )
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/power.py",
            "source": "def power(base, exp):\n    return base ** exp\n",
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertEqual(
            response["formatted"],
            "def power(base, exp):\n    return base ** exp\n",
        )

    def test_format_document_does_not_space_double_star_unpacking(self) -> None:
        formatted = (
            "def call(**kwargs):\n"
            "    return target(**kwargs)\n\n"
            "def merge(mapping):\n"
            "    return {**mapping}\n"
        )
        executor = FakeExecutor({"black": (0, formatted, "")})
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/unpacking.py",
            "source": formatted,
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertEqual(response["formatted"], formatted)

    def test_format_document_accepts_empty_source(self) -> None:
        executor = FakeExecutor({"black": (0, "", "")})
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/empty.py",
            "source": "",
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertEqual(response["formatted"], "")
        self.assertEqual(executor.calls[0]["input_text"], "")

    def test_check_document_accepts_empty_source(self) -> None:
        config = default_config()
        config["flake8"]["enabled"] = False
        config["mypy"]["enabled"] = False
        request = {
            "version": 1,
            "kind": "check-document",
            "filename": "/work/empty.py",
            "source": "",
            "workspaceRoot": "/work",
            "config": config,
        }

        response = handle_request(request, executor=FakeExecutor({}))

        self.assertTrue(response["ok"])
        self.assertEqual(response["diagnostics"], [])

    def test_format_document_normalizes_mixed_leading_tabs_before_black(self) -> None:
        executor = FakeExecutor(
            {"black": (0, "def example():\n    value = 1\n    return value\n", "")}
        )
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/sample.py",
            "source": "def example():\n\tvalue=1\n    return value\n",
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertEqual(
            executor.calls[0]["input_text"],
            "def example():\n    value=1\n    return value\n",
        )
        self.assertNotIn("\t", response["formatted"])

    def test_format_document_preserves_tabs_inside_multiline_strings(self) -> None:
        source = 'def example():\n\ttext = """first\n\tcontent\n\t"""\n\treturn text\n'
        normalized = (
            'def example():\n    text = """first\n\tcontent\n\t"""\n    return text\n'
        )
        executor = FakeExecutor({"black": (0, normalized, "")})
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/sample.py",
            "source": source,
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        handle_request(request, executor=executor)

        self.assertEqual(executor.calls[0]["input_text"], normalized)

    def test_format_document_returns_black_process_output(self) -> None:
        executor = FakeExecutor({"black": (0, "value = {1, 2}\n", "")})
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "/work/sample.py",
            "source": "value={1,2}\n",
            "workspaceRoot": "/work",
            "config": default_config(),
        }

        response = handle_request(request, executor=executor)

        self.assertEqual(response["formatted"], "value = {1, 2}\n")
        self.assertEqual(executor.calls[0]["tool"], "black")
        self.assertEqual(executor.calls[0]["input_text"], "value={1,2}\n")

    def test_format_document_returns_source_when_black_is_disabled(self) -> None:
        config = default_config()
        config["black"]["enabled"] = False
        request = {
            "version": 1,
            "kind": "format-document",
            "filename": "sample.py",
            "source": "value={1,2}\n",
            "workspaceRoot": "/work",
            "config": config,
        }

        response = handle_request(request)

        self.assertTrue(response["ok"])
        self.assertEqual(response["formatted"], "value={1,2}\n")
        self.assertEqual(response["diagnostics"], [])

    def test_check_document_keeps_flake8_when_mypy_fails(self) -> None:
        executor = FakeExecutor(
            {
                "flake8": (
                    1,
                    "/work/a.py\x1f1\x1f1\x1fF401\x1f'os' imported but unused\n",
                    "",
                ),
                "mypy": (2, "", "mypy crashed"),
            }
        )

        response = handle_request(document_request(), executor=executor)

        self.assertTrue(response["ok"])
        self.assertEqual(response["summary"]["flake8"], 1)
        self.assertEqual(response["summary"]["failedTools"], ["mypy"])
        self.assertEqual(response["diagnostics"][0]["tool"], "flake8")

    def test_check_document_uses_and_removes_mypy_shadow_file(self) -> None:
        shadow_paths: list[Path] = []

        def executor(
            tool: str,
            args: list[str],
            *,
            input_text: str | None,
            cwd: str,
        ) -> tuple[int, str, str]:
            if tool == "mypy":
                marker = args.index("--shadow-file")
                shadow = Path(args[marker + 2])
                self.assertTrue(shadow.exists())
                self.assertEqual(shadow.read_text(encoding="utf-8"), "x: int = 'bad'\n")
                shadow_paths.append(shadow)
            return 0, "", ""

        request = document_request()
        request["source"] = "x: int = 'bad'\n"

        response = handle_request(request, executor=executor)

        self.assertTrue(response["ok"])
        self.assertEqual(len(shadow_paths), 1)
        self.assertFalse(shadow_paths[0].exists())

    def test_untitled_document_uses_temporary_mypy_target(self) -> None:
        executor = FakeExecutor({"flake8": (0, "", ""), "mypy": (0, "", "")})

        response = handle_request(document_request("untitled.py"), executor=executor)

        self.assertTrue(response["ok"])
        mypy_call = next(call for call in executor.calls if call["tool"] == "mypy")
        self.assertNotIn("--shadow-file", mypy_call["args"])
        self.assertTrue(str(mypy_call["args"][-1]).endswith("untitled.py"))

    def test_check_workspace_prunes_environment_directories(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "app.py").write_text("x = 1\n", encoding="utf-8")
            (root / ".venv").mkdir()
            (root / ".venv" / "ignored.py").write_text("bad = 1\n", encoding="utf-8")
            executor = FakeExecutor({"flake8": (0, "", ""), "mypy": (0, "", "")})
            request = {
                "version": 1,
                "kind": "check-workspace",
                "workspaceRoot": str(root),
                "config": default_config(),
            }

            response = handle_request(request, executor=executor)

        self.assertTrue(response["ok"])
        for call in executor.calls:
            targets = [
                str(value) for value in call["args"] if str(value).endswith(".py")
            ]
            self.assertEqual(targets, [str(root / "app.py")])

    def test_handle_request_rejects_unknown_protocol_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "protocol version"):
            handle_request({"version": 9, "kind": "check-workspace"})


if __name__ == "__main__":
    unittest.main()
