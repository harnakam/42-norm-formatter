'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

function buildRequest(kind, input = {}) {
  return { version: 1, kind, ...input };
}

function parseRunnerResponse(stdout) {
  let response;
  try {
    response = JSON.parse(stdout);
  } catch (_error) {
    throw new Error('Runner did not return valid JSON.');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Runner did not return a valid response object.');
  }
  if (response.ok !== true) {
    throw new Error(response.error || 'Python tool runner failed.');
  }
  return response;
}

class ToolService {
  constructor(extensionPath, outputChannel, execFileImpl = execFile) {
    this.runnerPath = path.join(extensionPath, 'python', 'tool_runner.py');
    this.output = outputChannel;
    this.execFile = execFileImpl;
  }

  run(request, options = {}) {
    const pythonPath = options.pythonPath || 'python';
    const payload = JSON.stringify(request);
    return new Promise((resolve, reject) => {
      const child = this.execFile(
        pythonPath,
        ['-B', this.runnerPath],
        {
          cwd: options.cwd || request.workspaceRoot || process.cwd(),
          windowsHide: true,
          encoding: 'utf8',
          shell: false,
          timeout: 120000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
        },
        (error, stdout, stderr) => {
          if (options.traceRunner && this.output) {
            this.output.appendLine(`$ ${pythonPath} ${this.runnerPath}`);
            if (stdout) this.output.appendLine(stdout.trimEnd());
            if (stderr) this.output.appendLine(stderr.trimEnd());
          }
          if (error && !stdout) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }
          try {
            resolve(parseRunnerResponse(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
      child.stdin.on?.('error', reject);
      child.stdin.end(payload);
    });
  }
}

module.exports = { ToolService, buildRequest, parseRunnerResponse };
