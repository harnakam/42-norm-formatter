'use strict';

const vscode = require('vscode');
const SOURCES = new Set(['norminette', 'flake8', 'mypy']);

class DiagnosticHighlighter {
  constructor(context) {
    this.context = context;
    this.decorations = new Map();
  }

  register() {
    this.context.subscriptions.push(
      this,
      vscode.commands.registerCommand('normFormatter.configureHighlighter', () =>
        vscode.commands.executeCommand('workbench.action.openSettings', 'normFormatter.highlighter')),
      vscode.languages.onDidChangeDiagnostics(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('normFormatter.highlighter')) {
          this.dispose();
          this.refresh();
        }
      })
    );
    this.refresh();
  }

  refresh() {
    const visible = new Set(vscode.window.visibleTextEditors);
    for (const [editor, types] of this.decorations) {
      if (!visible.has(editor)) {
        types.forEach(type => type.dispose());
        this.decorations.delete(editor);
      }
    }
    for (const editor of visible) {
      const config = vscode.workspace.getConfiguration('normFormatter.highlighter', editor.document.uri);
      let types = this.decorations.get(editor);
      if (!types) {
        types = ['errorColor', 'warningColor'].map((name, index) =>
          vscode.window.createTextEditorDecorationType({
            isWholeLine: config.get('wholeLine', true),
            backgroundColor: config.get(name, index ? '#cca70022' : '#f14c4c22'),
            overviewRulerColor: new vscode.ThemeColor(index ? 'editorWarning.foreground' : 'editorError.foreground'),
            overviewRulerLane: vscode.OverviewRulerLane.Right
          }));
        this.decorations.set(editor, types);
      }
      const ranges = [[], []];
      if (config.get('enabled', true)) {
        for (const diagnostic of vscode.languages.getDiagnostics(editor.document.uri)) {
          if (!SOURCES.has(diagnostic.source)) continue;
          if (diagnostic.severity === vscode.DiagnosticSeverity.Error) ranges[0].push(diagnostic.range);
          if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) ranges[1].push(diagnostic.range);
        }
      }
      types.forEach((type, index) => editor.setDecorations(type, ranges[index]));
    }
  }

  dispose() {
    for (const types of this.decorations.values()) types.forEach(type => type.dispose());
    this.decorations.clear();
  }
}

module.exports = { DiagnosticHighlighter };
