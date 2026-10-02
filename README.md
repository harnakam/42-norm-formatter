# 42 Norm Formatter

One VS Code extension for C and Python, with bundled `norminette`, Black,
flake8 and strict mypy.

## Python / 統合版の使い方

- **Ctrl+Alt+F** (macOS: **Cmd+Alt+F**) formats the active C or Python document
  without saving it. The standard **Format Document** action also works;
  choose `harnakam.42-norm-formatter` as the Python default formatter.
- Python repairs missing block-header colons when the complete result parses,
  normalizes tabs / mixed indentation, expands one-line statements, and formats
  spacing, wrapping and blank lines with Black.
- It fills in `-> None` for implemented functions without a return value and
  return annotations for functions returning only literals of one type.
  Existing annotations and type comments are preserved.
- Checks use flake8 and `mypy --strict` against the current editor contents.
- `normFormatter.highlighter.enabled` toggles error/warning backgrounds for both
  languages. `wholeLine`, `errorColor`, and `warningColor` control their appearance.
- Python bytecode and tool caches are disabled for extension-launched processes:
  no new `__pycache__` or `.mypy_cache` is left in your project. Existing caches
  are not deleted. Tools launched separately from your terminal use their own settings.

Python の保存時整形は初期状態では OFF です。ショートカットだけでも使えます。
保存時にも整形したい場合は次の設定を有効にしてください。

```json
{
  "[python]": {
    "editor.defaultFormatter": "harnakam.42-norm-formatter"
  },
  "normFormatter.python.formatOnSave": true,
  "normFormatter.highlighter.enabled": true
}
```

自動補完は `normFormatter.python.repairMissingColons`、
`addNoneReturnAnnotations`、`addLiteralReturnAnnotations` で調整できます。
Black・flake8・mypy の設定も `normFormatter.python.*` に集約しています。
Python 実行ファイルは共通の `normFormatter.pythonPath` を使い、
必要なら `normFormatter.python.pythonPath` で Python 機能だけ上書きできます。

### Moving from 42 Py Formatter

Install this extension, then disable **42 Py Formatter** to avoid duplicate
checks and save handlers. Move any custom `pyFormatter.*` settings to
`normFormatter.python.*`. Existing C settings continue to work.

## C features

The C formatter provides:

- document formatting aimed at common Norminette spacing and layout rules
- diagnostics from bundled `norminette`
- a status bar menu for running checks and editing extension options

## Features

- Format `.c` and `.h` files manually or automatically on save
- Run `norminette` on the active file, including unsaved editor contents
- Run `norminette` across the whole workspace
- Toggle settings from a Quick Pick menu opened from the status bar
- Configure the Python executable and optional `-R` compatibility rules
- Toggle dangerous AST-based rewrites individually from settings or the status bar menu

## Notes

- The formatter focuses on layout issues: tabs, spacing, braces, returns, and basic declaration alignment.
- Dangerous rewrites such as function-scope comment removal, single-body brace insertion, multi-instruction splitting, declaration splitting, declaration hoisting, and `for` to `while` conversion are individually configurable and default to `Off`.
- Single-body brace insertion stays opt-in because it increases line count.
- `normFormatter.allowUnsafeTransforms` remains as a legacy bundle switch for the other dangerous rewrites, but granular settings are preferred.
- Python 3.10 or newer is required because the bundled `norminette` source uses that runtime.

## Commands

- `42 Norm Formatter: Open Menu`
- `42 Norm Formatter: Run Current File`
- `42 Norm Formatter: Run Workspace`
- `42 Norm Formatter: Format Current Document`
- `42 Norm Formatter: Configure`

## Settings

- `normFormatter.pythonPath`
- `normFormatter.useGitignore`
- `normFormatter.compatibilityRules`
- `normFormatter.formatOnSave`
- `normFormatter.lintOnSave`
- `normFormatter.lintOnOpen`
- `normFormatter.lintOnChange`
- `normFormatter.showStatusBar`
- `normFormatter.traceRunner`
- `normFormatter.headerEnabled`
- `normFormatter.headerUsername`
- `normFormatter.headerEmail`
- `normFormatter.removeFunctionScopeComments`
- `normFormatter.wrapSingleStatementBodies`
- `normFormatter.splitMultiInstructions`
- `normFormatter.splitDeclarationAssignment`
- `normFormatter.hoistDeclarationsToFunctionTop`
- `normFormatter.rewriteForToWhile`
- `normFormatter.allowUnsafeTransforms`

## Development

Run `npm test` with Node.js 22+ and Python 3.10+ to exercise C regression cases,
Python repairs, strict mypy, cache isolation, command routing and highlighting.

Open this folder in VS Code and press `F5` to launch the Extension Development Host.

Run the formatter smoke tests with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-smoke-tests.ps1
```

## License

This project is distributed under the MIT License. See `LICENSE`.

## Third-Party Licenses

This extension bundles `norminette` source code.

- Copyright (c) 2020 42 Association
- License: MIT

Full text is available in `THIRD_PARTY_NOTICES.md` and in `norm srcs/LICENSE`.

## NOTE

型注釈を補完できる範囲は、戻り値なし・同じ型のリテラルを返す関数です。
引数の型、外部 API の返り値、処理意図が必要な型エラーは診断として表示します。
すべてのコードを自動で `mypy --strict` に通せるわけではありません。
補完後も構文が成立しない場合は元の内容を保持し、整形エラーを通知します。
