from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import tokenize
import traceback
from pathlib import Path
from typing import Any, Callable, cast

ROOT = Path(__file__).resolve().parent.parent
VENDOR_ROOT = ROOT / "python" / "vendor"
sys.path.insert(0, str(VENDOR_ROOT))
sys.path.insert(0, str(ROOT / "python"))
sys.dont_write_bytecode = True
from repairs import add_return_annotations, repair_missing_colons

FLAKE8_SEPARATOR = "\x1f"
FLAKE8_FORMAT = FLAKE8_SEPARATOR.join(
    ["%(path)s", "%(row)d", "%(col)d", "%(code)s", "%(text)s"]
)
MYPY_PATTERN = re.compile(
    r"^(.*?):(\d+)(?::(\d+))?: (error|warning|note): " r"(.*?)(?:  \[([^\]]+)\])?$"
)
Executor = Callable[..., tuple[int, str, str]]
PRUNED_DIRECTORIES = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
}


def parse_flake8(output: str) -> list[dict[str, object]]:
    diagnostics: list[dict[str, object]] = []
    for line in output.splitlines():
        parts = line.split(FLAKE8_SEPARATOR, 4)
        if len(parts) != 5:
            continue
        path, raw_line, raw_column, code, message = parts
        try:
            line_number = int(raw_line)
            column = int(raw_column)
        except ValueError:
            continue
        diagnostics.append(
            {
                "tool": "flake8",
                "path": path,
                "line": line_number,
                "column": column,
                "endLine": line_number,
                "endColumn": column + 1,
                "severity": "warning",
                "code": code,
                "message": message,
            }
        )
    return diagnostics


def parse_mypy(output: str) -> list[dict[str, object]]:
    diagnostics: list[dict[str, object]] = []
    for line in output.splitlines():
        match = MYPY_PATTERN.match(line)
        if match is None:
            continue
        path, raw_line, raw_column, level, message, code = match.groups()
        line_number = int(raw_line)
        column = int(raw_column or "1")
        severity = "information" if level == "note" else "error"
        if level == "warning":
            severity = "warning"
        diagnostics.append(
            {
                "tool": "mypy",
                "path": path,
                "line": line_number,
                "column": column,
                "endLine": line_number,
                "endColumn": column + 1,
                "severity": severity,
                "code": code or "",
                "message": message,
            }
        )
    return diagnostics


def build_black_mode_kwargs(config: dict[str, Any]) -> dict[str, object]:
    targets = {
        str(target).upper()
        for target in config.get("targetVersions", [])
        if str(target).strip()
    }
    return {
        "line_length": int(config.get("lineLength", 88)),
        "string_normalization": not bool(config.get("skipStringNormalization", False)),
        "magic_trailing_comma": not bool(config.get("skipMagicTrailingComma", False)),
        "target_versions": targets,
    }


def build_black_args(filename: str, config: dict[str, Any]) -> list[str]:
    args = ["--quiet", f"--line-length={int(config.get('lineLength', 88))}"]
    if config.get("skipStringNormalization", False):
        args.append("--skip-string-normalization")
    if config.get("skipMagicTrailingComma", False):
        args.append("--skip-magic-trailing-comma")
    for target in config.get("targetVersions", []):
        args.append(f"--target-version={str(target).lower()}")
    args.extend(str(item) for item in config.get("extraArgs", []))
    args.append("--no-cache")
    args.extend([f"--stdin-filename={filename}", "-"])
    return args


def build_flake8_args(
    targets: list[str],
    config: dict[str, Any],
    *,
    stdin_filename: str | None = None,
) -> list[str]:
    args = [f"--format={FLAKE8_FORMAT}"]
    if stdin_filename is not None:
        args.append(f"--stdin-display-name={stdin_filename}")
    args.append(f"--max-line-length={int(config.get('maxLineLength', 88))}")
    ignored = [str(item) for item in config.get("ignore", [])]
    selected = [str(item) for item in config.get("select", [])]
    if ignored:
        args.append(f"--ignore={','.join(ignored)}")
    if selected:
        args.append(f"--select={','.join(selected)}")
    args.extend(str(item) for item in config.get("extraArgs", []))
    args.extend(targets)
    return args


def build_mypy_args(
    targets: list[str],
    config: dict[str, Any],
    *,
    shadow_file: tuple[str, str] | None = None,
) -> list[str]:
    args = [
        "--show-column-numbers",
        "--show-error-codes",
        "--no-error-summary",
        "--no-pretty",
        f"--follow-imports={config.get('followImports', 'normal')}",
    ]
    if config.get("strict", True):
        args.append("--strict")
    if config.get("ignoreMissingImports", False):
        args.append("--ignore-missing-imports")
    if shadow_file is not None:
        args.extend(["--shadow-file", shadow_file[0], shadow_file[1]])
    args.extend(str(item) for item in config.get("extraArgs", []))
    args.extend(["--no-incremental", "--cache-dir", os.devnull])
    args.extend(targets)
    return args


def normalize_leading_indentation(source: str, tab_width: int = 4) -> str:
    """Replace leading code tabs with spaces without changing string contents."""
    lines = source.splitlines(keepends=True)
    if not any("\t" in line[: len(line) - len(line.lstrip(" \t"))] for line in lines):
        return source

    normalized_lines: list[str] = []
    for line in lines:
        prefix = line[: len(line) - len(line.lstrip(" \t"))]
        normalized_prefix = prefix.expandtabs(tab_width)
        if "\t" in prefix and normalized_prefix:
            columns = len(normalized_prefix)
            rounded_columns = max(
                tab_width,
                (columns // tab_width) * tab_width,
            )
            normalized_prefix = " " * rounded_columns
        normalized_lines.append(normalized_prefix + line[len(prefix) :])
    normalized = "".join(normalized_lines)

    protected_rows: set[int] = set()
    try:
        tokens = tokenize.generate_tokens(io.StringIO(normalized).readline)
        for token in tokens:
            if token.type == tokenize.STRING and token.start[0] < token.end[0]:
                protected_rows.update(range(token.start[0] + 1, token.end[0] + 1))
    except (IndentationError, SyntaxError, tokenize.TokenError):
        return normalized

    for row in protected_rows:
        if row < 1 or row > len(lines):
            continue
        original_prefix = lines[row - 1][
            : len(lines[row - 1]) - len(lines[row - 1].lstrip(" \t"))
        ]
        normalized_prefix = normalized_lines[row - 1][
            : len(normalized_lines[row - 1])
            - len(normalized_lines[row - 1].lstrip(" \t"))
        ]
        normalized_lines[row - 1] = (
            original_prefix + normalized_lines[row - 1][len(normalized_prefix) :]
        )
    return "".join(normalized_lines)


def space_binary_power_operators(source: str) -> str:
    """Use spaced binary powers while preserving double-star unpacking."""
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (IndentationError, SyntaxError, tokenize.TokenError):
        return source

    ignored_types = {
        tokenize.COMMENT,
        tokenize.DEDENT,
        tokenize.ENDMARKER,
        tokenize.INDENT,
        tokenize.NEWLINE,
        tokenize.NL,
    }
    significant = [token for token in tokens if token.type not in ignored_types]
    line_offsets: list[int] = []
    offset = 0
    for line in source.splitlines(keepends=True):
        line_offsets.append(offset)
        offset += len(line)

    edits: list[tuple[int, int, str]] = []
    for index, token in enumerate(significant):
        if token.type != tokenize.OP or token.string != "**":
            continue
        if index == 0 or index + 1 >= len(significant):
            continue
        previous = significant[index - 1]
        following = significant[index + 1]
        previous_ends_expression = previous.type in {
            tokenize.NAME,
            tokenize.NUMBER,
            tokenize.STRING,
        } or previous.string in {")", "]", "}", "..."}
        if not previous_ends_expression:
            continue
        if previous.end[0] != token.start[0] or following.start[0] != token.end[0]:
            continue

        line_offset = line_offsets[token.start[0] - 1]
        start = line_offset + token.start[1]
        end = line_offset + token.end[1]
        previous_end = line_offset + previous.end[1]
        following_start = line_offset + following.start[1]
        while start > previous_end and source[start - 1] in " \t":
            start -= 1
        while end < following_start and source[end] in " \t":
            end += 1
        edits.append((start, end, " ** "))

    formatted = source
    for start, end, replacement in reversed(edits):
        formatted = formatted[:start] + replacement + formatted[end:]
    return formatted


def format_with_black(
    source: str,
    filename: str,
    config: dict[str, Any],
    *,
    black_module: Any = None,
) -> str:
    del filename
    if black_module is None:
        import black as black_module

    kwargs = build_black_mode_kwargs(config)
    raw_targets = cast(set[str], kwargs.pop("target_versions"))
    kwargs["target_versions"] = {
        black_module.TargetVersion[target] for target in raw_targets
    }
    mode = black_module.FileMode(**kwargs)
    normalized_source = normalize_leading_indentation(source)
    try:
        formatted = cast(
            str,
            black_module.format_file_contents(normalized_source, fast=False, mode=mode),
        )
        return space_binary_power_operators(formatted)
    except black_module.NothingChanged:
        return space_binary_power_operators(normalized_source)


def run_process(
    tool: str,
    args: list[str],
    *,
    input_text: str | None,
    cwd: str,
) -> tuple[int, str, str]:
    env = os.environ.copy()
    existing_python_path = env.get("PYTHONPATH")
    paths = [str(VENDOR_ROOT)]
    if existing_python_path:
        paths.append(existing_python_path)
    env["PYTHONPATH"] = os.pathsep.join(paths)
    env["PYTHONUTF8"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run(
        [sys.executable, "-B", "-m", tool, *args],
        cwd=cwd,
        env=env,
        input=input_text,
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=110,
        check=False,
    )
    return result.returncode, result.stdout, result.stderr


def collect_python_files(workspace_root: str) -> list[str]:
    root = Path(workspace_root).resolve()
    if not root.is_dir():
        raise ValueError(f"Workspace does not exist: {workspace_root}")
    files: list[str] = []
    for current_root, directories, filenames in os.walk(root):
        directories[:] = sorted(
            directory
            for directory in directories
            if directory not in PRUNED_DIRECTORIES
        )
        for filename in sorted(filenames):
            if filename.endswith((".py", ".pyi")):
                files.append(str(Path(current_root, filename)))
    return files


def _required_string(
    request: dict[str, Any], key: str, *, allow_empty: bool = False
) -> str:
    value = request.get(key)
    if not isinstance(value, str) or (not allow_empty and not value):
        raise ValueError(f"Request field '{key}' must be a non-empty string")
    return value


def _tool_config(config: dict[str, Any], name: str) -> dict[str, Any]:
    value = config.get(name, {})
    return value if isinstance(value, dict) else {}


def _run_checker(
    tool: str,
    args: list[str],
    *,
    input_text: str | None,
    cwd: str,
    executor: Executor,
) -> tuple[list[dict[str, object]], str | None]:
    returncode, stdout, stderr = executor(tool, args, input_text=input_text, cwd=cwd)
    if returncode not in {0, 1}:
        return [], (stderr or stdout or f"{tool} exited with {returncode}").strip()
    parser = parse_flake8 if tool == "flake8" else parse_mypy
    return parser(stdout), None


def _check_document(request: dict[str, Any], executor: Executor) -> dict[str, Any]:
    filename = _required_string(request, "filename")
    source = _required_string(request, "source", allow_empty=True)
    workspace_root = str(request.get("workspaceRoot") or os.getcwd())
    config = request.get("config", {})
    if not isinstance(config, dict):
        raise ValueError("Request field 'config' must be an object")
    diagnostics: list[dict[str, object]] = []
    failed_tools: list[str] = []
    failure_reasons: dict[str, str] = {}

    flake8_config = _tool_config(config, "flake8")
    if flake8_config.get("enabled", True):
        args = build_flake8_args(["-"], flake8_config, stdin_filename=filename)
        findings, failure = _run_checker(
            "flake8",
            args,
            input_text=source,
            cwd=workspace_root,
            executor=executor,
        )
        diagnostics.extend(findings)
        if failure is not None:
            failed_tools.append("flake8")
            failure_reasons["flake8"] = failure

    mypy_config = _tool_config(config, "mypy")
    if mypy_config.get("enabled", True):
        with tempfile.TemporaryDirectory(prefix="42-py-formatter-") as temp_dir:
            logical_path = Path(filename)
            shadow_file: tuple[str, str] | None = None
            if logical_path.is_absolute():
                temp_path = Path(temp_dir, logical_path.name or "document.py")
                target = filename
                shadow_file = (filename, str(temp_path))
            else:
                temp_path = Path(temp_dir, logical_path.name or "untitled.py")
                target = str(temp_path)
            temp_path.write_text(source, encoding="utf-8")
            args = build_mypy_args([target], mypy_config, shadow_file=shadow_file)
            findings, failure = _run_checker(
                "mypy",
                args,
                input_text=None,
                cwd=workspace_root,
                executor=executor,
            )
            if shadow_file is None:
                for finding in findings:
                    if finding.get("path") == target:
                        finding["path"] = filename
            diagnostics.extend(findings)
            if failure is not None:
                failed_tools.append("mypy")
                failure_reasons["mypy"] = failure

    return _check_response(diagnostics, failed_tools, failure_reasons)


def _check_workspace(request: dict[str, Any], executor: Executor) -> dict[str, Any]:
    workspace_root = _required_string(request, "workspaceRoot")
    config = request.get("config", {})
    if not isinstance(config, dict):
        raise ValueError("Request field 'config' must be an object")
    targets = collect_python_files(workspace_root)
    diagnostics: list[dict[str, object]] = []
    failed_tools: list[str] = []
    failure_reasons: dict[str, str] = {}
    if not targets:
        return _check_response(diagnostics, failed_tools, failure_reasons)

    flake8_config = _tool_config(config, "flake8")
    if flake8_config.get("enabled", True):
        findings, failure = _run_checker(
            "flake8",
            build_flake8_args(targets, flake8_config),
            input_text=None,
            cwd=workspace_root,
            executor=executor,
        )
        diagnostics.extend(findings)
        if failure is not None:
            failed_tools.append("flake8")
            failure_reasons["flake8"] = failure

    mypy_config = _tool_config(config, "mypy")
    if mypy_config.get("enabled", True):
        findings, failure = _run_checker(
            "mypy",
            build_mypy_args(targets, mypy_config),
            input_text=None,
            cwd=workspace_root,
            executor=executor,
        )
        diagnostics.extend(findings)
        if failure is not None:
            failed_tools.append("mypy")
            failure_reasons["mypy"] = failure

    return _check_response(diagnostics, failed_tools, failure_reasons)


def _check_response(
    diagnostics: list[dict[str, object]],
    failed_tools: list[str],
    failure_reasons: dict[str, str],
) -> dict[str, Any]:
    summary: dict[str, object] = {
        "flake8": sum(item.get("tool") == "flake8" for item in diagnostics),
        "mypy": sum(item.get("tool") == "mypy" for item in diagnostics),
        "failedTools": failed_tools,
    }
    if failure_reasons:
        summary["failureReasons"] = failure_reasons
    return {
        "ok": True,
        "formatted": None,
        "diagnostics": diagnostics,
        "summary": summary,
    }


def handle_request(
    request: dict[str, Any], *, executor: Executor = run_process
) -> dict[str, Any]:
    if request.get("version") != 1:
        raise ValueError("Unsupported protocol version")
    kind = request.get("kind")
    if kind == "check-document":
        return _check_document(request, executor)
    if kind == "check-workspace":
        return _check_workspace(request, executor)
    if kind == "format-document":
        filename = _required_string(request, "filename")
        source = _required_string(request, "source", allow_empty=True)
        config = request.get("config", {})
        if not isinstance(config, dict):
            raise ValueError("Request field 'config' must be an object")
        black_config = _tool_config(config, "black")
        formatted = source
        format_error = None
        if black_config.get("enabled", True):
            workspace_root = str(request.get("workspaceRoot") or os.getcwd())
            normalized_source = normalize_leading_indentation(source)
            if config.get("repairMissingColons", True):
                normalized_source = repair_missing_colons(normalized_source)
            if config.get("addNoneReturnAnnotations", True) and not filename.endswith(
                ".pyi"
            ):
                normalized_source = add_return_annotations(
                    normalized_source,
                    literals=config.get("addLiteralReturnAnnotations", True),
                )
            returncode, stdout, stderr = executor(
                "black",
                build_black_args(filename, black_config),
                input_text=normalized_source,
                cwd=workspace_root,
            )
            if returncode != 0:
                failure = (
                    stderr or stdout or f"black exited with {returncode}"
                ).strip()
                if "Cannot parse:" in failure or "ParseError:" in failure:
                    formatted = source
                    format_error = failure
                else:
                    raise RuntimeError(failure)
            else:
                formatted = space_binary_power_operators(stdout)
        return {
            "ok": True,
            "formatted": formatted,
            "diagnostics": [],
            "summary": {
                "flake8": 0,
                "mypy": 0,
                "failedTools": [],
                **({"formatError": format_error} if format_error else {}),
            },
        }
    raise ValueError(f"Unsupported request kind: {kind}")


def main() -> int:
    request: dict[str, Any] = {}
    try:
        raw_request = json.load(sys.stdin)
        if not isinstance(raw_request, dict):
            raise ValueError("Request must be a JSON object")
        request = raw_request
        response = handle_request(request)
    except Exception as error:
        if request.get("traceRunner") or (
            isinstance(request.get("config"), dict)
            and request["config"].get("traceRunner")
        ):
            traceback.print_exc(file=sys.stderr)
        response = {
            "ok": False,
            "error": str(error) or error.__class__.__name__,
            "diagnostics": [],
            "summary": {"failedTools": ["runner"]},
        }
    json.dump(response, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
