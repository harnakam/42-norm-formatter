'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ToolService,
  buildRequest,
  parseRunnerResponse
} = require('../../lib/python/tool-service');

test('buildRequest keeps document source and options structured', () => {
  const actual = buildRequest('check-document', {
    filename: '/work/a.py',
    source: 'x = 1\n',
    workspaceRoot: '/work',
    config: { mypy: { strict: true } }
  });

  assert.deepEqual(actual, {
    version: 1,
    kind: 'check-document',
    filename: '/work/a.py',
    source: 'x = 1\n',
    workspaceRoot: '/work',
    config: { mypy: { strict: true } }
  });
});

test('parseRunnerResponse rejects malformed and failed responses', () => {
  assert.throws(() => parseRunnerResponse('not-json'), /valid JSON/);
  assert.throws(
    () => parseRunnerResponse('{"ok":false,"error":"boom"}'),
    /boom/
  );
});

test('ToolService sends JSON to the bundled runner with bounded execution', async () => {
  const observed = {};
  const fakeExecFile = (command, args, options, callback) => {
    Object.assign(observed, { command, args, options });
    return {
      stdin: {
        end(payload) {
          observed.payload = payload;
          callback(null, '{"ok":true,"diagnostics":[],"summary":{}}', '');
        }
      }
    };
  };
  const service = new ToolService('/extension', null, fakeExecFile);
  const request = buildRequest('check-workspace', {
    workspaceRoot: '/work',
    config: {}
  });

  const result = await service.run(request, { pythonPath: '/usr/bin/python3' });

  assert.equal(observed.command, '/usr/bin/python3');
  assert.deepEqual(observed.args, ['-B', path.join('/extension', 'python', 'tool_runner.py')]);
  assert.equal(observed.options.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.timeout, 120000);
  assert.equal(observed.options.maxBuffer, 16 * 1024 * 1024);
  assert.deepEqual(JSON.parse(observed.payload), request);
  assert.equal(result.ok, true);
});
