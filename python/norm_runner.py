from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NORM_SOURCE_ROOT = ROOT / "norm srcs"

sys.path.insert(0, str(NORM_SOURCE_ROOT))

with contextlib.redirect_stdout(io.StringIO()):
    from norminette.context import Context
    from norminette.errors import Error
    from norminette.exceptions import CParsingError
    from norminette.file import File
    from norminette.lexer import Lexer
    from norminette.registry import Registry


def is_c_source(path: Path) -> bool:
    return path.suffix.lower() in {".c", ".h"}


def collect_targets(raw_targets: list[str]) -> list[Path]:
    if not raw_targets:
        raw_targets = [os.getcwd()]
    collected: list[Path] = []
    seen: set[Path] = set()
    for target in raw_targets:
        path = Path(target)
        if not path.exists():
            continue
        if path.is_file():
            resolved = path.resolve()
            if is_c_source(resolved) and resolved not in seen:
                collected.append(resolved)
                seen.add(resolved)
            continue
        for child in path.rglob("*"):
            if child.is_file() and is_c_source(child):
                resolved = child.resolve()
                if resolved not in seen:
                    collected.append(resolved)
                    seen.add(resolved)
    return collected


def filter_gitignored(targets: list[Path], workspace_root: Path | None) -> list[Path]:
    if workspace_root is None:
        return targets
    remaining: list[Path] = []
    for target in targets:
        result = subprocess.run(
            ["git", "check-ignore", "-q", str(target)],
            cwd=str(workspace_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode == 1:
            remaining.append(target)
        elif result.returncode == 128:
            remaining.append(target)
    return remaining


def run_norminette(file_path: str, source: str | None, rules: list[str]) -> File:
    registry = Registry()
    file = File(file_path, source)
    try:
        lexer = Lexer(file)
        tokens = list(lexer)
        context = Context(file, tokens, 0, rules)
        registry.run(context)
    except CParsingError as exc:
        error = Error("C_PARSING_ERROR", str(exc))
        error.add_highlight(1, 1, 1)
        file.errors.add(error)
    return file


def file_to_payload(file: File) -> dict:
    path = file.path
    if not path.startswith("untitled"):
        try:
            path = str(Path(path).resolve())
        except OSError:
            pass
    return {
        "path": path,
        "status": file.errors.status,
        "errors": [asdict(error) for error in file.errors],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--stdin-filename")
    parser.add_argument("--workspace-root")
    parser.add_argument("--use-gitignore", action="store_true")
    parser.add_argument("-R", "--rule", action="append", default=[])
    args = parser.parse_args()

    workspace_root = Path(args.workspace_root).resolve() if args.workspace_root else None

    if args.stdin_filename:
        source = sys.stdin.read()
        file = run_norminette(args.stdin_filename, source, args.rule)
        payload = {"files": [file_to_payload(file)]}
        print(json.dumps(payload, separators=(",", ":")))
        return 0

    targets = collect_targets(args.paths)
    if args.use_gitignore:
        targets = filter_gitignored(targets, workspace_root)
    files = [run_norminette(str(target), None, args.rule) for target in targets]
    payload = {"files": [file_to_payload(file) for file in files]}
    print(json.dumps(payload, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
