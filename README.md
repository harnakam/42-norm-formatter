# 42 Norm Formatter

VS Code extension project that bundles `norminette` and adds:

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
