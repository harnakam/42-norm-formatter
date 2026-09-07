'use strict';

const path = require('path');
const vscode = require('vscode');

const { formatDocumentText } = require('./lib/formatter');
const { NorminetteService } = require('./lib/norminette');

const SUPPORTED_EXTENSIONS = new Set(['.c', '.h']);
const SUPPORTED_LANGUAGE_IDS = new Set(['c', 'cpp', 'objective-c']);
const CONFIG_SECTION = 'normFormatter';
const IS_JA = (vscode.env.language || '').toLowerCase().startsWith('ja');

function t(english, japanese) {
  return IS_JA ? japanese : english;
}

class NormFormatterExtension {
  constructor(context) {
    this.context = context;
    this.output = vscode.window.createOutputChannel('42 Norm Formatter');
    this.diagnostics = vscode.languages.createDiagnosticCollection('norminette');
    this.service = new NorminetteService(context.extensionPath, this.output);
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    this.statusBar.command = 'normFormatter.showMenu';
    this.statusBar.name = '42 Norm Formatter';
    this.pendingTimers = new Map();
    this.lastResults = new Map();
    this.runningDocuments = new Set();
  }

  register() {
    this.context.subscriptions.push(
      this.output,
      this.diagnostics,
      this.statusBar,
      vscode.commands.registerCommand('normFormatter.showMenu', () => this.showMenu()),
      vscode.commands.registerCommand('normFormatter.runCurrentFile', () => this.runCurrentFile(true)),
      vscode.commands.registerCommand('normFormatter.runWorkspace', () => this.runWorkspace()),
      vscode.commands.registerCommand('normFormatter.formatDocument', () => this.formatActiveEditor()),
      vscode.commands.registerCommand('normFormatter.configure', () => this.showConfigurationMenu()),
      vscode.languages.registerDocumentFormattingEditProvider(
        [{ language: 'c' }, { language: 'cpp' }, { language: 'objective-c' }],
        { provideDocumentFormattingEdits: (document) => this.buildFormattingEdits(document) }
      ),
      vscode.workspace.onWillSaveTextDocument((event) => this.onWillSave(event)),
      vscode.workspace.onDidSaveTextDocument((document) => this.onDidSave(document)),
      vscode.workspace.onDidOpenTextDocument((document) => this.onDidOpen(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.onDidClose(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDidChange(event)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onDidChangeActiveEditor(editor)),
      vscode.workspace.onDidChangeConfiguration((event) => this.onDidChangeConfiguration(event))
    );

    this.refreshStatusBar();
    for (const document of vscode.workspace.textDocuments) {
      if (this.shouldLintOnOpen(document)) {
        this.scheduleLint(document, 'open', 200);
      }
    }
  }

  getConfig(resource) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
    return {
      pythonPath: config.get('pythonPath', 'python'),
      useGitignore: config.get('useGitignore', true),
      compatibilityRules: config.get('compatibilityRules', []),
      formatOnSave: config.get('formatOnSave', true),
      lintOnSave: config.get('lintOnSave', true),
      lintOnOpen: config.get('lintOnOpen', true),
      lintOnChange: config.get('lintOnChange', false),
      showStatusBar: config.get('showStatusBar', true),
      traceRunner: config.get('traceRunner', false),
      headerEnabled: config.get('headerEnabled', true),
      headerUsername: config.get('headerUsername', 'username'),
      headerEmail: config.get('headerEmail', 'username@student.42tokyo.jp'),
      removeFunctionScopeComments: config.get('removeFunctionScopeComments', false),
      wrapSingleStatementBodies: config.get('wrapSingleStatementBodies', false),
      splitMultiInstructions: config.get('splitMultiInstructions', false),
      splitDeclarationAssignment: config.get('splitDeclarationAssignment', false),
      hoistDeclarationsToFunctionTop: config.get('hoistDeclarationsToFunctionTop', false),
      rewriteForToWhile: config.get('rewriteForToWhile', false),
      allowUnsafeTransforms: config.get('allowUnsafeTransforms', false)
    };
  }

  getTransformOptions(config) {
    const legacyUnsafe = Boolean(config.allowUnsafeTransforms);
    return {
      stripFunctionComments: legacyUnsafe || Boolean(config.removeFunctionScopeComments),
      wrapSingleStatementBodies: Boolean(config.wrapSingleStatementBodies),
      splitMultiInstructions: legacyUnsafe || Boolean(config.splitMultiInstructions),
      splitDeclarationAssignment: legacyUnsafe || Boolean(config.splitDeclarationAssignment),
      hoistDeclarationsToFunctionTop: legacyUnsafe || Boolean(config.hoistDeclarationsToFunctionTop),
      rewriteForToWhile: legacyUnsafe || Boolean(config.rewriteForToWhile)
    };
  }

  formatTransformState(rawValue, effectiveValue) {
    if (rawValue) {
      return 'On';
    }
    if (effectiveValue) {
      return 'On (legacy)';
    }
    return 'Off';
  }

  getWorkspaceFolder(resource) {
    if (!resource) {
      return vscode.workspace.workspaceFolders?.[0] || null;
    }
    return vscode.workspace.getWorkspaceFolder(resource) || vscode.workspace.workspaceFolders?.[0] || null;
  }

  isSupportedDocument(document) {
    if (!document) {
      return false;
    }
    if (!['file', 'untitled'].includes(document.uri.scheme)) {
      return false;
    }
    const extension = path.extname(document.fileName || '').toLowerCase();
    return SUPPORTED_EXTENSIONS.has(extension) || SUPPORTED_LANGUAGE_IDS.has(document.languageId);
  }

  shouldLintOnOpen(document) {
    return this.isSupportedDocument(document) && this.getConfig(document.uri).lintOnOpen;
  }

  onDidOpen(document) {
    if (this.shouldLintOnOpen(document)) {
      this.scheduleLint(document, 'open', 300);
    }
  }

  onDidClose(document) {
    this.clearPending(document.uri);
    this.diagnostics.delete(document.uri);
    this.lastResults.delete(document.uri.toString());
    this.refreshStatusBar(document);
  }

  onDidSave(document) {
    if (!this.isSupportedDocument(document)) {
      return;
    }
    if (this.getConfig(document.uri).lintOnSave) {
      this.scheduleLint(document, 'save', 100);
    }
  }

  onDidChange(event) {
    const document = event.document;
    if (!this.isSupportedDocument(document)) {
      return;
    }
    if (!event.contentChanges.length) {
      return;
    }
    if (this.getConfig(document.uri).lintOnChange) {
      this.scheduleLint(document, 'change', 500);
    }
  }

  onDidChangeActiveEditor(editor) {
    this.refreshStatusBar(editor?.document);
    if (editor?.document && this.shouldLintOnOpen(editor.document) && !this.lastResults.has(editor.document.uri.toString())) {
      this.scheduleLint(editor.document, 'focus', 250);
    }
  }

  onDidChangeConfiguration(event) {
    if (!event.affectsConfiguration(CONFIG_SECTION)) {
      return;
    }
    this.refreshStatusBar(vscode.window.activeTextEditor?.document);
    for (const document of vscode.workspace.textDocuments) {
      if (this.isSupportedDocument(document) && this.getConfig(document.uri).lintOnOpen) {
        this.scheduleLint(document, 'config', 250);
      }
    }
  }

  onWillSave(event) {
    const document = event.document;
    if (!this.isSupportedDocument(document)) {
      return;
    }
    if (!this.getConfig(document.uri).formatOnSave) {
      return;
    }
    event.waitUntil(Promise.resolve(this.buildFormattingEdits(document)));
  }

  clearPending(uri) {
    const key = uri.toString();
    const timer = this.pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(key);
    }
  }

  scheduleLint(document, reason, delayMs) {
    if (!this.isSupportedDocument(document)) {
      return;
    }
    this.clearPending(document.uri);
    const key = document.uri.toString();
    const timer = setTimeout(() => {
      this.pendingTimers.delete(key);
      void this.lintDocument(document, { reason, manual: false });
    }, delayMs);
    this.pendingTimers.set(key, timer);
  }

  async lintDocument(document, options = {}) {
    if (!this.isSupportedDocument(document)) {
      return null;
    }
    const key = document.uri.toString();
    if (this.runningDocuments.has(key)) {
      return null;
    }
    this.runningDocuments.add(key);
    this.refreshStatusBar(document, { busy: true });
    try {
      const config = this.getConfig(document.uri);
      const workspaceFolder = this.getWorkspaceFolder(document.uri);
      const result = await this.service.runForDocument(document, document.getText(), {
        pythonPath: config.pythonPath,
        traceRunner: config.traceRunner,
        workspaceRoot: workspaceFolder?.uri.fsPath || null,
        useGitignore: config.useGitignore,
        compatibilityRules: config.compatibilityRules
      });
      this.applyDiagnostics(document.uri, result);
      this.lastResults.set(key, result);
      this.refreshStatusBar(document);
      if (options.manual) {
        const errorCount = this.countErrors(result);
        if (errorCount === 0) {
          vscode.window.showInformationMessage(t('norminette: current file is clean.', 'norminette: 現在のファイルにエラーはありません。'));
        } else {
          vscode.window.showWarningMessage(t(`norminette: ${errorCount} issue(s) in current file.`, `norminette: 現在のファイルに ${errorCount} 件の問題があります。`));
        }
      }
      return result;
    } catch (error) {
      this.refreshStatusBar(document, { failed: true });
      if (options.manual) {
        vscode.window.showErrorMessage(t(`norminette failed: ${error.message}`, `norminette の実行に失敗しました: ${error.message}`));
      }
      this.output.appendLine(`[lint:${options.reason || 'manual'}] ${error.stack || error.message}`);
      return null;
    } finally {
      this.runningDocuments.delete(key);
    }
  }

  async runCurrentFile(manual) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSupportedDocument(editor.document)) {
      vscode.window.showWarningMessage(t('Open a .c or .h file first.', '.c または .h ファイルを開いてください。'));
      return;
    }
    await this.lintDocument(editor.document, { reason: 'manual', manual });
  }

  async runWorkspace() {
    const workspaceFolder = this.getWorkspaceFolder(vscode.window.activeTextEditor?.document?.uri);
    if (!workspaceFolder) {
      vscode.window.showWarningMessage(t('Open a workspace folder to run norminette on all files.', 'ワークスペースフォルダを開いてから norminette を実行してください。'));
      return;
    }
    const patterns = ['**/*.c', '**/*.h'];
    const uriLists = await Promise.all(patterns.map((pattern) => vscode.workspace.findFiles(pattern)));
    const seen = new Set();
    const filePaths = [];
    for (const list of uriLists) {
      for (const uri of list) {
        const key = uri.toString();
        if (!seen.has(key)) {
          seen.add(key);
          filePaths.push(uri.fsPath);
        }
      }
    }
    if (!filePaths.length) {
      vscode.window.showInformationMessage(t('No .c or .h files were found in the workspace.', 'ワークスペース内に .c / .h ファイルが見つかりませんでした。'));
      return;
    }
    const config = this.getConfig(workspaceFolder.uri);
    this.statusBar.text = 'Norm $(sync~spin) workspace';
    this.statusBar.tooltip = 'Running norminette on the workspace';
    const results = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t('Running norminette on the workspace', 'ワークスペース全体で norminette を実行中'),
        cancellable: false
      },
      async () => this.service.runForPaths(filePaths, {
        pythonPath: config.pythonPath,
        traceRunner: config.traceRunner,
        workspaceRoot: workspaceFolder.uri.fsPath,
        useGitignore: config.useGitignore,
        compatibilityRules: config.compatibilityRules
      })
    );
    this.diagnostics.clear();
    let totalErrors = 0;
    let failedFiles = 0;
    for (const result of results.files) {
      const uri = vscode.Uri.file(result.path);
      this.applyDiagnostics(uri, result);
      this.lastResults.set(uri.toString(), result);
      const errors = this.countErrors(result);
      totalErrors += errors;
      if (errors > 0) {
        failedFiles += 1;
      }
    }
    this.refreshStatusBar(vscode.window.activeTextEditor?.document);
    if (totalErrors === 0) {
      vscode.window.showInformationMessage(t(`norminette: ${results.files.length} file(s) checked, no issues found.`, `norminette: ${results.files.length} ファイルを確認し、問題は見つかりませんでした。`));
    } else {
      vscode.window.showWarningMessage(t(`norminette: ${totalErrors} issue(s) across ${failedFiles} file(s).`, `norminette: ${failedFiles} ファイルで合計 ${totalErrors} 件の問題があります。`));
    }
  }

  async formatActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isSupportedDocument(editor.document)) {
      vscode.window.showWarningMessage(t('Open a .c or .h file first.', '.c または .h ファイルを開いてください。'));
      return;
    }
    const edits = await this.buildFormattingEdits(editor.document);
    if (!edits.length) {
      vscode.window.showInformationMessage(t('Document is already formatted.', 'このドキュメントは既に整形済みです。'));
      return;
    }
    await editor.edit((builder) => {
      for (const edit of edits) {
        builder.replace(edit.range, edit.newText);
      }
    });
  }

  async showMenu() {
    const editor = vscode.window.activeTextEditor;
    const config = this.getConfig(editor?.document?.uri);
    const transforms = this.getTransformOptions(config);
    const items = [
      { label: t('Run current file', '現在のファイルを実行'), description: t('Execute norminette on the active document', 'アクティブなドキュメントに norminette を実行します'), action: () => this.runCurrentFile(true) },
      { label: t('Run workspace', 'ワークスペースを実行'), description: t('Execute norminette on all .c and .h files', 'ワークスペース内の .c / .h 全体に norminette を実行します'), action: () => this.runWorkspace() },
      { label: t('Format current document', '現在のドキュメントを整形'), description: t('Apply the built-in norm formatter', '組み込みの norm formatter を適用します'), action: () => this.formatActiveEditor() },
      { label: t(`Format on save: ${config.formatOnSave ? 'On' : 'Off'}`, `保存時に整形: ${config.formatOnSave ? 'オン' : 'オフ'}`), description: t('Toggle automatic formatting before save', '保存前の自動整形を切り替えます'), action: () => this.updateSetting('formatOnSave', !config.formatOnSave) },
      { label: t(`Lint on save: ${config.lintOnSave ? 'On' : 'Off'}`, `保存時に lint: ${config.lintOnSave ? 'オン' : 'オフ'}`), description: t('Toggle automatic norminette checks after save', '保存後の自動 norminette 実行を切り替えます'), action: () => this.updateSetting('lintOnSave', !config.lintOnSave) },
      { label: t(`Lint on change: ${config.lintOnChange ? 'On' : 'Off'}`, `変更時に lint: ${config.lintOnChange ? 'オン' : 'オフ'}`), description: t('Toggle debounced linting while typing', '入力中の遅延 lint を切り替えます'), action: () => this.updateSetting('lintOnChange', !config.lintOnChange) },
      { label: t(`Use .gitignore: ${config.useGitignore ? 'On' : 'Off'}`, `.gitignore を使う: ${config.useGitignore ? 'オン' : 'オフ'}`), description: t('Toggle Git ignore filtering', 'Git ignore の除外を切り替えます'), action: () => this.updateSetting('useGitignore', !config.useGitignore) },
      { label: t(`42 header: ${config.headerEnabled ? 'On' : 'Off'}`, `42 ヘッダ: ${config.headerEnabled ? 'オン' : 'オフ'}`), description: t('Toggle automatic 42 header insertion and refresh', '42 header の自動挿入・更新を切り替えます'), action: () => this.updateSetting('headerEnabled', !config.headerEnabled) },
      { label: t(`Remove function comments: ${this.formatTransformState(config.removeFunctionScopeComments, transforms.stripFunctionComments)}`, `関数内コメント削除: ${this.formatTransformState(config.removeFunctionScopeComments, transforms.stripFunctionComments)}`), description: t('Dangerous rewrite. Delete comments inside function bodies before formatting.', '危険な変換です。関数本体内のコメントを整形前に削除します。'), action: () => this.updateSetting('removeFunctionScopeComments', !config.removeFunctionScopeComments) },
      { label: t(`Wrap single bodies: ${this.formatTransformState(config.wrapSingleStatementBodies, transforms.wrapSingleStatementBodies)}`, `単文 body を波括弧化: ${this.formatTransformState(config.wrapSingleStatementBodies, transforms.wrapSingleStatementBodies)}`), description: t('Dangerous rewrite. Add braces to single-statement if/while/for/else bodies. Opt-in only because it increases line count.', '危険な変換です。単文の if/while/for/else body に波括弧を追加します。行数が増えるため明示的に有効化した場合のみ適用します。'), action: () => this.updateSetting('wrapSingleStatementBodies', !config.wrapSingleStatementBodies) },
      { label: t(`Split multi instructions: ${this.formatTransformState(config.splitMultiInstructions, transforms.splitMultiInstructions)}`, `複数命令を分割: ${this.formatTransformState(config.splitMultiInstructions, transforms.splitMultiInstructions)}`), description: t('Dangerous rewrite. Break several statements on one line into separate instructions.', '危険な変換です。1 行の複数命令を別行に分割します。'), action: () => this.updateSetting('splitMultiInstructions', !config.splitMultiInstructions) },
      { label: t(`Split decl + assign: ${this.formatTransformState(config.splitDeclarationAssignment, transforms.splitDeclarationAssignment)}`, `宣言と代入を分離: ${this.formatTransformState(config.splitDeclarationAssignment, transforms.splitDeclarationAssignment)}`), description: t('Dangerous rewrite. Convert local declarations with initializers into declaration plus assignment.', '危険な変換です。初期化付きローカル宣言を宣言と代入に分離します。'), action: () => this.updateSetting('splitDeclarationAssignment', !config.splitDeclarationAssignment) },
      { label: t(`Hoist declarations: ${this.formatTransformState(config.hoistDeclarationsToFunctionTop, transforms.hoistDeclarationsToFunctionTop)}`, `宣言を関数先頭へ移動: ${this.formatTransformState(config.hoistDeclarationsToFunctionTop, transforms.hoistDeclarationsToFunctionTop)}`), description: t('Dangerous rewrite. Move local declarations to the top of the function body.', '危険な変換です。ローカル変数宣言を関数先頭へ移動します。'), action: () => this.updateSetting('hoistDeclarationsToFunctionTop', !config.hoistDeclarationsToFunctionTop) },
      { label: t(`Rewrite for -> while: ${this.formatTransformState(config.rewriteForToWhile, transforms.rewriteForToWhile)}`, `for を while に変換: ${this.formatTransformState(config.rewriteForToWhile, transforms.rewriteForToWhile)}`), description: t('Dangerous rewrite. Convert for-loops into while-loops.', '危険な変換です。for ループを while ループへ変換します。'), action: () => this.updateSetting('rewriteForToWhile', !config.rewriteForToWhile) },
      { label: t(`Legacy unsafe bundle: ${config.allowUnsafeTransforms ? 'On' : 'Off'}`, `旧 unsafe 一括設定: ${config.allowUnsafeTransforms ? 'オン' : 'オフ'}`), description: t('Compatibility toggle that enables most dangerous rewrites at once. Single-body brace wrapping stays opt-in.', '互換用の一括設定です。危険な変換の大半をまとめて有効化します。単文 body の波括弧化は個別設定のままです。'), action: () => this.updateSetting('allowUnsafeTransforms', !config.allowUnsafeTransforms) },
      { label: t('Edit header username', 'header のユーザー名を編集'), description: t(`Current: ${config.headerUsername}`, `現在: ${config.headerUsername}`), action: () => this.editHeaderUsername(config.headerUsername) },
      { label: t('Edit header email', 'header のメールアドレスを編集'), description: t(`Current: ${config.headerEmail}`, `現在: ${config.headerEmail}`), action: () => this.editHeaderEmail(config.headerEmail) },
      { label: t('Edit Python path', 'Python パスを編集'), description: t(`Current: ${config.pythonPath}`, `現在: ${config.pythonPath}`), action: () => this.editPythonPath(config.pythonPath) },
      { label: t('Edit compatibility rules', '互換ルールを編集'), description: t(`Current: ${(config.compatibilityRules || []).join(', ') || '(none)'}`, `現在: ${(config.compatibilityRules || []).join(', ') || '(なし)'}`), action: () => this.editCompatibilityRules(config.compatibilityRules) },
      { label: t('Open extension settings', '拡張機能設定を開く'), description: t('Open VS Code settings for this extension', 'この拡張機能の VS Code 設定を開きます'), action: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:username.42-norm-formatter') }
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: t('42 Norm Formatter', '42 Norm Formatter'),
      placeHolder: t('Choose an action', '実行する操作を選んでください')
    });
    if (pick) {
      await pick.action();
    }
  }

  async showConfigurationMenu() {
    await this.showMenu();
  }

  async editPythonPath(currentValue) {
    const nextValue = await vscode.window.showInputBox({
      title: '42 Norm Formatter',
      prompt: t('Python executable used for the bundled norminette runner', '同梱された norminette runner に使う Python 実行ファイル'),
      value: currentValue,
      ignoreFocusOut: true
    });
    if (typeof nextValue === 'string' && nextValue.trim()) {
      await this.updateSetting('pythonPath', nextValue.trim());
    }
  }

  async editCompatibilityRules(currentValue) {
    const nextValue = await vscode.window.showInputBox({
      title: '42 Norm Formatter',
      prompt: t('Comma-separated compatibility rule names passed as -R values', '-R で渡す互換ルール名をカンマ区切りで入力してください'),
      value: (currentValue || []).join(', '),
      ignoreFocusOut: true
    });
    if (typeof nextValue !== 'string') {
      return;
    }
    const rules = nextValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    await this.updateSetting('compatibilityRules', rules);
  }

  async editHeaderUsername(currentValue) {
    const nextValue = await vscode.window.showInputBox({
      title: '42 Norm Formatter',
      prompt: t('Username used in the generated 42 header', '生成する 42 header に使うユーザー名'),
      value: currentValue,
      ignoreFocusOut: true
    });
    if (typeof nextValue === 'string' && nextValue.trim()) {
      await this.updateSetting('headerUsername', nextValue.trim());
    }
  }

  async editHeaderEmail(currentValue) {
    const nextValue = await vscode.window.showInputBox({
      title: '42 Norm Formatter',
      prompt: t('Email address used in the generated 42 header', '生成する 42 header に使うメールアドレス'),
      value: currentValue,
      ignoreFocusOut: true
    });
    if (typeof nextValue === 'string' && nextValue.trim()) {
      await this.updateSetting('headerEmail', nextValue.trim());
    }
  }

  async updateSetting(key, value) {
    const resource = vscode.window.activeTextEditor?.document?.uri;
    const workspaceFolder = this.getWorkspaceFolder(resource);
    const target = workspaceFolder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
    await vscode.workspace.getConfiguration(CONFIG_SECTION, resource).update(key, value, target);
    this.refreshStatusBar(vscode.window.activeTextEditor?.document);
  }

  async buildFormattingEdits(document) {
    if (!this.isSupportedDocument(document)) {
      return [];
    }
    const original = document.getText();
    const config = this.getConfig(document.uri);
    const transforms = this.getTransformOptions(config);
    const formatted = formatDocumentText(original, {
      fileName: document.fileName,
      headerEnabled: config.headerEnabled,
      headerUsername: config.headerUsername,
      headerEmail: config.headerEmail,
      stripFunctionComments: transforms.stripFunctionComments,
      wrapSingleStatementBodies: transforms.wrapSingleStatementBodies,
      splitMultiInstructions: transforms.splitMultiInstructions,
      splitDeclarationAssignment: transforms.splitDeclarationAssignment,
      hoistDeclarationsToFunctionTop: transforms.hoistDeclarationsToFunctionTop,
      rewriteForToWhile: transforms.rewriteForToWhile
    });
    if (formatted === original) {
      return [];
    }
    const normalized = document.eol === vscode.EndOfLine.CRLF ? formatted.replace(/\n/g, '\r\n') : formatted;
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(original.length));
    return [vscode.TextEdit.replace(fullRange, normalized)];
  }

  applyDiagnostics(uri, result) {
    const diagnostics = [];
    for (const error of result.errors || []) {
      const highlights = Array.isArray(error.highlights) ? error.highlights : [];
      const primary = highlights[0] || { lineno: 1, column: 1, length: 1 };
      const line = Math.max(0, (primary.lineno || 1) - 1);
      const column = Math.max(0, (primary.column || 1) - 1);
      const length = Math.max(1, primary.length || 1);
      const range = new vscode.Range(line, column, line, column + length);
      const severity = error.level === 'Notice' ? vscode.DiagnosticSeverity.Information : vscode.DiagnosticSeverity.Error;
      const diagnostic = new vscode.Diagnostic(range, `${error.name}: ${error.text}`, severity);
      diagnostic.source = 'norminette';
      diagnostic.code = error.name;
      diagnostics.push(diagnostic);
    }
    this.diagnostics.set(uri, diagnostics);
  }

  countErrors(result) {
    return (result.errors || []).filter((error) => error.level !== 'Notice').length;
  }

  refreshStatusBar(document, state = {}) {
    const config = this.getConfig(document?.uri);
    if (!config.showStatusBar) {
      this.statusBar.hide();
      return;
    }
    const currentDocument = document || vscode.window.activeTextEditor?.document;
    if (state.busy) {
      this.statusBar.text = 'Norm $(sync~spin)';
      this.statusBar.tooltip = 'Running norminette';
      this.statusBar.show();
      return;
    }
    if (state.failed) {
      this.statusBar.text = 'Norm $(warning)';
      this.statusBar.tooltip = 'Last norminette run failed. Click for menu.';
      this.statusBar.show();
      return;
    }
    if (!currentDocument || !this.isSupportedDocument(currentDocument)) {
      this.statusBar.text = 'Norm $(gear)';
      this.statusBar.tooltip = 'Click to open the 42 Norm Formatter menu';
      this.statusBar.show();
      return;
    }
    const result = this.lastResults.get(currentDocument.uri.toString());
    if (!result) {
      this.statusBar.text = 'Norm $(circle-large-outline)';
      this.statusBar.tooltip = 'No norminette result yet. Click for menu.';
      this.statusBar.show();
      return;
    }
    const errorCount = this.countErrors(result);
    if (errorCount === 0) {
      this.statusBar.text = 'Norm $(check)';
      this.statusBar.tooltip = 'Current file passes norminette. Click for menu.';
    } else {
      this.statusBar.text = `Norm $(error) ${errorCount}`;
      this.statusBar.tooltip = `${errorCount} norminette issue(s) in the current file. Click for menu.`;
    }
    this.statusBar.show();
  }
}

function activate(context) {
  const extension = new NormFormatterExtension(context);
  extension.register();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
