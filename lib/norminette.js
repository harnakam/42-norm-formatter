'use strict';

const { execFile } = require('child_process');
const path = require('path');

class NorminetteService {
  constructor(extensionPath, outputChannel) {
    this.runnerPath = path.join(extensionPath, 'python', 'norm_runner.py');
    this.output = outputChannel;
  }

  async runForDocument(document, text, options) {
    const filename = document.uri.scheme === 'untitled'
      ? this.getUntitledName(document)
      : document.fileName;
    const args = ['--stdin-filename', filename];
    this.appendSharedArgs(args, options);
    const result = await this.execRunner(args, {
      pythonPath: options.pythonPath,
      stdin: text,
      cwd: options.workspaceRoot || path.dirname(filename),
      traceRunner: options.traceRunner
    });
    if (!result.files.length) {
      return { path: filename, status: 'OK', errors: [] };
    }
    return result.files[0];
  }

  async runForPaths(filePaths, options) {
    const args = [...filePaths];
    this.appendSharedArgs(args, options);
    return this.execRunner(args, {
      pythonPath: options.pythonPath,
      cwd: options.workspaceRoot || process.cwd(),
      traceRunner: options.traceRunner
    });
  }

  appendSharedArgs(args, options) {
    if (options.workspaceRoot) {
      args.push('--workspace-root', options.workspaceRoot);
    }
    if (options.useGitignore) {
      args.push('--use-gitignore');
    }
    for (const rule of options.compatibilityRules || []) {
      args.push('-R', rule);
    }
  }

  getUntitledName(document) {
    const extension = path.extname(document.fileName || '') || (document.languageId === 'cpp' ? '.h' : '.c');
    return `untitled${extension}`;
  }

  execRunner(args, options) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        options.pythonPath,
        [this.runnerPath, ...args],
        {
          cwd: options.cwd,
          windowsHide: true,
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONUTF8: '1'
          },
          maxBuffer: 16 * 1024 * 1024
        },
        (error, stdout, stderr) => {
          if (options.traceRunner) {
            this.output.appendLine(`$ ${options.pythonPath} ${this.runnerPath} ${args.join(' ')}`);
            if (stdout) {
              this.output.appendLine(stdout.trimEnd());
            }
            if (stderr) {
              this.output.appendLine(stderr.trimEnd());
            }
          }
          if (error && !stdout) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }
          try {
            const parsed = JSON.parse(stdout || '{"files":[]}');
            parsed.files = Array.isArray(parsed.files) ? parsed.files : [];
            resolve(parsed);
          } catch (parseError) {
            reject(new Error(`Unable to parse norminette JSON output: ${(stderr || stdout || parseError.message).trim()}`));
          }
        }
      );
      if (options.stdin) {
        child.stdin.end(options.stdin);
      }
    });
  }
}

module.exports = {
  NorminetteService
};
