"""Small source-preserving repairs; never invent parameter types or suppress errors."""

from __future__ import annotations

import ast
import io
import tokenize


def repair_missing_colons(source: str) -> str:
    """Repair block headers only when the whole candidate parses successfully."""
    try:
        ast.parse(source)
        return source
    except SyntaxError:
        pass
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (SyntaxError, tokenize.TokenError):
        return source
    lines = source.splitlines(keepends=True)
    statement: list[tokenize.TokenInfo] = []
    insertions: list[tuple[int, int]] = []
    headers = {
        "def",
        "class",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "try",
        "except",
        "finally",
        "with",
        "match",
        "case",
    }
    for token in tokens:
        if token.type == tokenize.NEWLINE:
            if statement:
                names = [item.string for item in statement]
                first = names[1] if names[0] == "async" and len(names) > 1 else names[0]
                if first in headers and statement[-1].string != ":":
                    depth = 0
                    has_colon = False
                    for item in statement:
                        if item.type != tokenize.OP:
                            continue
                        if item.string in ("(", "[", "{"):
                            depth += 1
                        elif item.string in (")", "]", "}"):
                            depth -= 1
                        elif item.string == ":" and depth == 0:
                            has_colon = True
                    if not has_colon:
                        insertions.append(statement[-1].end)
            statement = []
        elif token.type not in (
            tokenize.INDENT,
            tokenize.DEDENT,
            tokenize.NL,
            tokenize.COMMENT,
            tokenize.ENDMARKER,
        ):
            statement.append(token)
    for row, column in reversed(insertions):
        lines[row - 1] = lines[row - 1][:column] + ":" + lines[row - 1][column:]
    candidate = "".join(lines)
    try:
        ast.parse(candidate)
    except SyntaxError:
        return source
    return candidate


class Returns(ast.NodeVisitor):
    def __init__(self) -> None:
        self.values: list[ast.expr | None] = []
        self.generator = False

    def visit_Return(self, node: ast.Return) -> None:
        self.values.append(node.value)

    def visit_Yield(self, node: ast.Yield) -> None:
        self.generator = True

    def visit_YieldFrom(self, node: ast.YieldFrom) -> None:
        self.generator = True

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        pass

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        pass

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        pass


def add_return_annotations(source: str, *, literals: bool = True) -> str:
    """Annotate proven None returns and direct literal returns, preserving comments."""
    try:
        tree = ast.parse(source, type_comments=True)
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (SyntaxError, tokenize.TokenError):
        return source
    lines = source.splitlines(keepends=True)
    edits: list[tuple[int, int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.returns or node.type_comment or node.decorator_list:
            continue
        visitor = Returns()
        for child in node.body:
            visitor.visit(child)
        if visitor.generator:
            continue
        annotation: str | None = None
        if all(
            value is None or isinstance(value, ast.Constant) and value.value is None
            for value in visitor.values
        ):
            # Stub bodies may promise a value without implementing it yet.
            if all(
                isinstance(stmt, ast.Pass)
                or isinstance(stmt, ast.Expr)
                and isinstance(stmt.value, ast.Constant)
                and (stmt.value.value is Ellipsis or isinstance(stmt.value.value, str))
                for stmt in node.body
            ):
                continue
            annotation = "None"
        elif literals and isinstance(node.body[-1], ast.Return):
            # Require explicit return on the fallthrough path and literal-only returns.
            types: set[str] = set()
            for value in visitor.values:
                if value is None:
                    types.add("None")
                elif isinstance(value, ast.Constant) and type(value.value) in (
                    str,
                    int,
                    float,
                    bool,
                    bytes,
                    type(None),
                ):
                    types.add(
                        "None" if value.value is None else type(value.value).__name__
                    )
                else:
                    break
            else:
                if len(types) == 1:
                    annotation = next(iter(types))
        if annotation is None:
            continue
        # AST columns are UTF-8 bytes, token columns are characters.
        column = len(
            lines[node.lineno - 1].encode("utf-8")[: node.col_offset].decode("utf-8")
        )
        depth = 0
        for token in tokens:
            if token.start < (node.lineno, column):
                continue
            if token.type != tokenize.OP:
                continue
            if token.string in ("(", "[", "{"):
                depth += 1
            elif token.string in (")", "]", "}"):
                depth -= 1
            elif token.string == ":" and depth == 0:
                edits.append((*token.start, " -> " + annotation))
                break
    for row, column, text in sorted(edits, reverse=True):
        lines[row - 1] = lines[row - 1][:column] + text + lines[row - 1][column:]
    return "".join(lines)
