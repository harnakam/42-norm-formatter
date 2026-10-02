'use strict';

const path = require('node:path');
const vscode = require('vscode');

const { readConfig } = require('./config');
const { toDiagnosticData } = require('./diagnostics');
const { RunCoordinator } = require('./run-coordinator');
const { ToolService, buildRequest } = require('./tool-service');

const CONFIG_SECTION = 'normFormatter.python';
const IS_JA = (vscode.env.language || '').toLowerCase().startsWith('ja');

function t(english, japanese) {
  return IS_JA ? japanese : english;
}

function severityFor(name) {
  if (name === 'error') return vscode.DiagnosticSeverity.Error;
  if (name === 'information') return vscode.DiagnosticSeverity.Information;
  if (name === 'hint') return vscode.DiagnosticSeverity.Hint;
  return vscode.DiagnosticSeverity.Warning;
}

class PyFormatterExtension {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel('42 Norm Formatter — Python');
    this.flake8Diagnostics = vscode.languages.createDiagnosticCollection('flake8');
    this.mypyDiagnostics = vscode.languages.createDiagnosticCollection('mypy');
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      20
    );
    this.statusBar.name = '42 Norm Formatter — Python';
    this.statusBar.command = 'normFormatter.python.showMenu';
    this.service = new ToolService(context.extensionPath, this.output);
    this.coordinator = new RunCoordinator();
    this.pendingTimers = new Map();
    this.lastCounts = new Map();
    this.busyUris = new Set();
    this.failedUris = new Set();
  }

  register() {
    const selectors = [
      { language: 'python', scheme: 'file' },
      { language: 'python', scheme: 'untitled' }
    ];
    this.context.subscriptions.push(
      this.output,
      this.flake8Diagnostics,
      this.mypyDiagnostics,
      this.statusBar,
      vscode.commands.registerCommand('normFormatter.python.showMenu', () => this.showMenu()),
      vscode.commands.registerCommand('normFormatter.python.formatDocument', () => this.formatActiveEditor()),
      vscode.commands.registerCommand('normFormatter.python.checkCurrentFile', () => this.checkCurrentFile()),
      vscode.commands.registerCommand('normFormatter.python.checkWorkspace', () => this.checkWorkspace()),
      vscode.commands.registerCommand('normFormatter.python.configure', () => this.openSettings()),
      vscode.commands.registerCommand('normFormatter.python.showOutput', () => this.output.show(true)),
      vscode.languages.registerDocumentFormattingEditProvider(selectors, {
        provideDocumentFormattingEdits: (document) => this.buildFormattingEdits(document)
      }),
      vscode.workspace.onWillSaveTextDocument((event) => this.onWillSave(event)),
      vscode.workspace.onDidSaveTextDocument((document) => this.onDidSave(document)),
      vscode.workspace.onDidOpenTextDocument((document) => this.onDidOpen(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.onDidClose(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDidChange(event)),
      vscode.workspace.onDidChangeConfiguration((event) => this.onConfigurationChanged(event)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditorChanged(editor)),
      { dispose: () => this.disposeTimers() }
    );
    this.refreshStatusBar();
    for (const document of vscode.workspace.textDocuments) {
      if (this.isPythonDocument(document) && this.configFor(document.uri).checkOnOpen) {
        this.scheduleCheck(document, 250, 'activation');
      }
    }
  }

  isPythonDocument(document) {
    return Boolean(
      document &&
      document.languageId === 'python' &&
      ['file', 'untitled'].includes(document.uri.scheme)
    );
  }

  configFor(resource) {
    const python = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
    const shared = vscode.workspace.getConfiguration('normFormatter', resource);
    return readConfig({ get(key, fallback) {
      if (['pythonPath', 'showStatusBar', 'traceRunner'].includes(key)) {
        const inspected = python.inspect(key);
        const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
        return explicit ?? shared.get(key, fallback);
      }
      return python.get(key, fallback);
    } });
  }

  workspaceFolderFor(resource) {
    return resource ? vscode.workspace.getWorkspaceFolder(resource) : null;
  }

  workspaceRootFor(document) {
    const folder = this.workspaceFolderFor(document.uri);
    if (folder) return folder.uri.fsPath;
    if (document.uri.scheme === 'file') return path.dirname(document.fileName);
    return process.cwd();
  }

  logicalFilename(document) {
    if (document.uri.scheme === 'file') return document.fileName;
    const base = path.basename(document.fileName || 'untitled.py');
    return base.endsWith('.py') ? base : `${base}.py`;
  }

  requestOptions(document, config) {
    return {
      pythonPath: config.pythonPath,
      cwd: this.workspaceRootFor(document),
      traceRunner: config.traceRunner
    };
  }

  async buildFormattingEdits(document) {
    if (!this.isPythonDocument(document)) return [];
    const config = this.configFor(document.uri);
    if (!config.black.enabled) return [];
    const version = document.version;
    const request = buildRequest('format-document', {
      filename: this.logicalFilename(document),
      source: document.getText(),
      workspaceRoot: this.workspaceRootFor(document),
      config
    });
    try {
      const response = await this.service.run(request, this.requestOptions(document, config));
      if (document.isClosed || document.version !== version) return [];
      if (response.summary?.formatError) {
        throw new Error(response.summary.formatError);
      }
      if (typeof response.formatted !== 'string' || response.formatted === document.getText()) {
        return [];
      }
      const formatted = document.eol === vscode.EndOfLine.CRLF
        ? response.formatted.replace(/\r?\n/g, '\r\n') : response.formatted;
      return [vscode.TextEdit.replace(this.wholeDocumentRange(document), formatted)];
    } catch (error) {
      this.reportFailure(document.uri, 'format', error, true);
      throw error;
    }
  }

  wholeDocumentRange(document) {
    if (document.lineCount === 0) {
      return new vscode.Range(0, 0, 0, 0);
    }
    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(0, 0, lastLine.range.end.line, lastLine.range.end.character);
  }

  async formatActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isPythonDocument(editor.document)) {
      vscode.window.showWarningMessage(
        t('Open a Python document first.', '先にPythonドキュメントを開いてください。')
      );
      return;
    }
    let edits;
    try { edits = await this.buildFormattingEdits(editor.document); }
    catch (_) { return; }
    if (!edits.length) {
      vscode.window.showInformationMessage(
        t('Black: no formatting changes.', 'Black: 整形による変更はありません。')
      );
      return;
    }
    const applied = await editor.edit((builder) => {
      for (const edit of edits) builder.replace(edit.range, edit.newText);
    });
    if (applied) this.scheduleCheck(editor.document, 75, 'format');
  }

  onWillSave(event) {
    if (!this.isPythonDocument(event.document)) return;
    if (!this.configFor(event.document.uri).formatOnSave) return;
    event.waitUntil(this.buildFormattingEdits(event.document));
  }

  onDidSave(document) {
    if (this.isPythonDocument(document) && this.configFor(document.uri).checkOnSave) {
      this.scheduleCheck(document, 75, 'save');
    }
  }

  onDidOpen(document) {
    if (this.isPythonDocument(document) && this.configFor(document.uri).checkOnOpen) {
      this.scheduleCheck(document, 200, 'open');
    }
  }

  onDidClose(document) {
    const key = document.uri.toString();
    this.clearPending(key);
    this.coordinator.cancel(key);
    this.flake8Diagnostics.delete(document.uri);
    this.mypyDiagnostics.delete(document.uri);
    this.lastCounts.delete(key);
    this.busyUris.delete(key);
    this.failedUris.delete(key);
    this.refreshStatusBar();
  }

  onDidChange(event) {
    if (!this.isPythonDocument(event.document) || !event.contentChanges.length) return;
    const key = event.document.uri.toString();
    this.coordinator.cancel(key);
    const config = this.configFor(event.document.uri);
    if (config.checkOnChange) {
      this.scheduleCheck(event.document, config.checkOnChangeDelay, 'change');
    }
  }

  onConfigurationChanged(event) {
    if (!event.affectsConfiguration(CONFIG_SECTION)) return;
    this.refreshStatusBar();
  }

  onActiveEditorChanged(editor) {
    this.refreshStatusBar();
    if (!editor || !this.isPythonDocument(editor.document)) return;
    const key = editor.document.uri.toString();
    if (this.configFor(editor.document.uri).checkOnOpen && !this.lastCounts.has(key)) {
      this.scheduleCheck(editor.document, 150, 'focus');
    }
  }

  scheduleCheck(document, delay, reason) {
    const key = document.uri.toString();
    this.clearPending(key);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key);
      void this.checkDocument(document, { manual: false, reason });
    }, delay);
    this.pendingTimers.set(key, timer);
  }

  clearPending(key) {
    const timer = this.pendingTimers.get(key);
    if (timer) clearTimeout(timer);
    this.pendingTimers.delete(key);
  }

  disposeTimers() {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
  }

  async checkCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isPythonDocument(editor.document)) {
      vscode.window.showWarningMessage(
        t('Open a Python document first.', '先にPythonドキュメントを開いてください。')
      );
      return;
    }
    await this.checkDocument(editor.document, { manual: true, reason: 'command' });
  }

  async checkDocument(document, options) {
    if (!this.isPythonDocument(document)) return null;
    const key = document.uri.toString();
    this.clearPending(key);
    const token = this.coordinator.begin(key, document.version);
    this.busyUris.add(key);
    this.failedUris.delete(key);
    this.refreshStatusBar();
    const config = this.configFor(document.uri);
    const request = buildRequest('check-document', {
      filename: this.logicalFilename(document),
      source: document.getText(),
      workspaceRoot: this.workspaceRootFor(document),
      config
    });
    try {
      const response = await this.service.run(request, this.requestOptions(document, config));
      if (!this.coordinator.isCurrent(token) || document.version !== token.documentVersion) {
        return null;
      }
      this.applyDocumentDiagnostics(document, response.diagnostics || []);
      if (response.summary?.failedTools?.length) {
        this.failedUris.add(key);
        this.output.appendLine(JSON.stringify(response.summary.failureReasons || {}));
      }
      const count = (response.diagnostics || []).length;
      this.lastCounts.set(key, count);
      if (options.manual) this.showCheckSummary(count, response.summary);
      return response;
    } catch (error) {
      if (this.coordinator.isCurrent(token)) {
        this.reportFailure(document.uri, options.reason, error, options.manual);
      }
      return null;
    } finally {
      if (this.coordinator.isCurrent(token)) this.coordinator.finish(token);
      this.busyUris.delete(key);
      this.refreshStatusBar();
    }
  }

  applyDocumentDiagnostics(document, items) {
    const grouped = this.groupDiagnostics(items, document);
    this.flake8Diagnostics.set(document.uri, grouped.flake8.get(document.uri.toString()) || []);
    this.mypyDiagnostics.set(document.uri, grouped.mypy.get(document.uri.toString()) || []);
    for (const [key, diagnostics] of grouped.flake8) {
      if (key !== document.uri.toString()) this.flake8Diagnostics.set(vscode.Uri.parse(key), diagnostics);
    }
    for (const [key, diagnostics] of grouped.mypy) {
      if (key !== document.uri.toString()) this.mypyDiagnostics.set(vscode.Uri.parse(key), diagnostics);
    }
  }

  groupDiagnostics(items, currentDocument = null) {
    const groups = { flake8: new Map(), mypy: new Map() };
    const logicalFilename = currentDocument ? this.logicalFilename(currentDocument) : null;
    for (const item of items) {
      if (!groups[item.tool]) continue;
      let uri;
      if (currentDocument && (currentDocument.uri.scheme === 'untitled' || item.path === logicalFilename)) {
        uri = currentDocument.uri;
      } else if (typeof item.path === 'string' && item.path) {
        uri = vscode.Uri.file(item.path);
      } else if (currentDocument) {
        uri = currentDocument.uri;
      } else {
        continue;
      }
      const data = toDiagnosticData(item);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          data.range.start.line,
          data.range.start.character,
          data.range.end.line,
          data.range.end.character
        ),
        data.message,
        severityFor(data.severity)
      );
      diagnostic.source = data.source;
      diagnostic.code = data.code;
      const key = uri.toString();
      if (!groups[item.tool].has(key)) groups[item.tool].set(key, []);
      groups[item.tool].get(key).push(diagnostic);
    }
    return groups;
  }

  async checkWorkspace() {
    const folder = await this.chooseWorkspaceFolder();
    if (!folder) return;
    const config = this.configFor(folder.uri);
    const request = buildRequest('check-workspace', {
      workspaceRoot: folder.uri.fsPath,
      config
    });
    this.statusBar.text = '$(sync~spin) Py';
    this.statusBar.show();
    try {
      const response = await this.service.run(request, {
        pythonPath: config.pythonPath,
        cwd: folder.uri.fsPath,
        traceRunner: config.traceRunner
      });
      this.flake8Diagnostics.clear();
      this.mypyDiagnostics.clear();
      const grouped = this.groupDiagnostics(response.diagnostics || []);
      for (const [key, diagnostics] of grouped.flake8) {
        this.flake8Diagnostics.set(vscode.Uri.parse(key), diagnostics);
      }
      for (const [key, diagnostics] of grouped.mypy) {
        this.mypyDiagnostics.set(vscode.Uri.parse(key), diagnostics);
      }
      this.showCheckSummary((response.diagnostics || []).length, response.summary);
    } catch (error) {
      this.reportFailure(folder.uri, 'workspace', error, true);
    } finally {
      this.refreshStatusBar();
    }
  }

  async chooseWorkspaceFolder() {
    const active = vscode.window.activeTextEditor?.document;
    const activeFolder = active ? this.workspaceFolderFor(active.uri) : null;
    if (activeFolder) return activeFolder;
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) {
      vscode.window.showWarningMessage(
        t('Open a workspace folder first.', '先にワークスペースフォルダーを開いてください。')
      );
      return null;
    }
    if (folders.length === 1) return folders[0];
    const choice = await vscode.window.showQuickPick(
      folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
      { placeHolder: t('Choose a workspace to check', '検査するワークスペースを選択') }
    );
    return choice?.folder || null;
  }

  showCheckSummary(count, summary = {}) {
    const failed = Array.isArray(summary?.failedTools) ? summary.failedTools : [];
    if (failed.length) {
      vscode.window.showWarningMessage(
        t(
          `${count} issue(s); ${failed.join(', ')} failed. See output for details.`,
          `${count}件の問題。${failed.join(', ')}の実行に失敗しました。詳細は出力を確認してください。`
        )
      );
    } else if (count === 0) {
      vscode.window.showInformationMessage(
        t('flake8 and mypy: no issues found.', 'flake8とmypy: 問題はありません。')
      );
    } else {
      vscode.window.showWarningMessage(
        t(`${count} issue(s) found.`, `${count}件の問題が見つかりました。`)
      );
    }
  }

  reportFailure(resource, operation, error, notify) {
    const key = resource.toString();
    this.failedUris.add(key);
    this.output.appendLine(`[${operation}] ${error.stack || error.message || String(error)}`);
    this.refreshStatusBar();
    if (notify) {
      vscode.window.showErrorMessage(
        t(
          `42 Norm Formatter — Python failed: ${error.message || error}`,
          `42 Norm Formatter — Pythonの実行に失敗しました: ${error.message || error}`
        )
      );
    }
  }

  refreshStatusBar() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !this.isPythonDocument(document)) {
      this.statusBar.hide();
      return;
    }
    const config = this.configFor(document.uri);
    if (!config.showStatusBar) {
      this.statusBar.hide();
      return;
    }
    const key = document.uri.toString();
    if (this.busyUris.has(key)) {
      this.statusBar.text = '$(sync~spin) Py';
      this.statusBar.tooltip = t('Checking Python…', 'Pythonを検査中…');
    } else if (this.failedUris.has(key)) {
      this.statusBar.text = '$(error) Py';
      this.statusBar.tooltip = t('Last run failed', '前回の実行に失敗しました');
    } else {
      const count = this.lastCounts.get(key) || 0;
      this.statusBar.text = count ? `$(warning) Py ${count}` : '$(check) Py';
      this.statusBar.tooltip = count
        ? t(`${count} Python issue(s)`, `${count}件のPython問題`)
        : t('No known Python issues', '既知のPython問題はありません');
    }
    this.statusBar.show();
  }

  async showMenu() {
    const document = vscode.window.activeTextEditor?.document;
    const resource = document?.uri;
    const config = this.configFor(resource);
    const items = [
      { label: '$(wand) ' + t('Format Current Document', '現在のドキュメントを整形'), command: 'normFormatter.python.formatDocument' },
      { label: '$(checklist) ' + t('Check Current File', '現在のファイルを検査'), command: 'normFormatter.python.checkCurrentFile' },
      { label: '$(folder-opened) ' + t('Check Workspace', 'ワークスペースを検査'), command: 'normFormatter.python.checkWorkspace' },
      { label: this.toggleLabel('Format on Save', '保存時に整形', config.formatOnSave), setting: 'formatOnSave', value: !config.formatOnSave },
      { label: this.toggleLabel('Check on Save', '保存時に検査', config.checkOnSave), setting: 'checkOnSave', value: !config.checkOnSave },
      { label: this.toggleLabel('Check on Open', 'ファイルを開いた時に検査', config.checkOnOpen), setting: 'checkOnOpen', value: !config.checkOnOpen },
      { label: this.toggleLabel('Check on Change', '編集中に検査', config.checkOnChange), setting: 'checkOnChange', value: !config.checkOnChange },
      { label: this.toggleLabel('Black', 'Black', config.black.enabled), setting: 'black.enabled', value: !config.black.enabled },
      { label: this.toggleLabel('flake8', 'flake8', config.flake8.enabled), setting: 'flake8.enabled', value: !config.flake8.enabled },
      { label: this.toggleLabel('mypy', 'mypy', config.mypy.enabled), setting: 'mypy.enabled', value: !config.mypy.enabled },
      { label: this.toggleLabel('Repair missing colons', 'ブロック末尾のコロンを補完', config.repairMissingColons), setting: 'repairMissingColons', value: !config.repairMissingColons },
      { label: this.toggleLabel('Add None return annotations', '戻り値なしの型注釈を補完', config.addNoneReturnAnnotations), setting: 'addNoneReturnAnnotations', value: !config.addNoneReturnAnnotations },
      { label: t('Error highlighter settings', 'エラーハイライト設定'), command: 'normFormatter.configureHighlighter' },
      { label: '$(gear) ' + t('Open All Settings', 'すべての設定を開く'), command: 'normFormatter.python.configure' },
      { label: '$(output) ' + t('Show Output', '出力を表示'), command: 'normFormatter.python.showOutput' }
    ];
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: t('42 Norm Formatter — Python actions and toggles', '42 Norm Formatter — Pythonの操作と切り替え')
    });
    if (!selected) return;
    if (selected.command) {
      await vscode.commands.executeCommand(selected.command);
      return;
    }
    if (selected.setting) await this.updateSetting(selected.setting, selected.value, resource);
  }

  toggleLabel(english, japanese, enabled) {
    return `${enabled ? '$(check)' : '$(circle-slash)'} ${t(english, japanese)}: ${enabled ? 'On' : 'Off'}`;
  }

  async updateSetting(key, value, resource) {
    const folder = resource ? this.workspaceFolderFor(resource) : null;
    const target = folder
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Workspace;
    await vscode.workspace.getConfiguration(CONFIG_SECTION, resource).update(key, value, target);
    this.refreshStatusBar();
  }

  openSettings() {
    return vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:harnakam.42-norm-formatter'
    );
  }
}

function activate(context) {
  const extension = new PyFormatterExtension(context);
  extension.register();
}

function deactivate() {}

module.exports = { activate, deactivate, PyFormatterExtension };
