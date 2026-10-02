'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toDiagnosticData } = require('../../lib/python/diagnostics');

test('toDiagnosticData converts one-based inclusive positions', () => {
  assert.deepEqual(toDiagnosticData({
    tool: 'mypy',
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 5,
    severity: 'error',
    code: 'assignment',
    message: 'bad type'
  }), {
    source: 'mypy',
    code: 'assignment',
    severity: 'error',
    message: 'bad type',
    range: {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 4 }
    }
  });
});

test('toDiagnosticData clamps invalid and reversed positions', () => {
  const actual = toDiagnosticData({
    tool: 'flake8',
    line: 0,
    column: -4,
    endLine: 0,
    endColumn: 0,
    severity: 'warning',
    code: 'E999',
    message: 'syntax error'
  });

  assert.deepEqual(actual.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 }
  });
});
