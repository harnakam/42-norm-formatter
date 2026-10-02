'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { readConfig } = require('../../lib/python/config');

function fakeConfig(values = {}) {
  return {
    get(key, fallback) {
      return Object.hasOwn(values, key) ? values[key] : fallback;
    }
  };
}

test('readConfig enables strict checking but not format on save', () => {
  const actual = readConfig(fakeConfig());

  assert.equal(actual.formatOnSave, false);
  assert.equal(actual.checkOnSave, true);
  assert.deepEqual(actual.black, {
    enabled: true,
    lineLength: 88,
    skipStringNormalization: false,
    skipMagicTrailingComma: false,
    targetVersions: [],
    extraArgs: []
  });
  assert.equal(actual.flake8.maxLineLength, 88);
  assert.equal(actual.mypy.strict, true);
});

test('readConfig preserves granular overrides without sharing arrays', () => {
  const ignored = ['E203', 'W503'];
  const actual = readConfig(fakeConfig({
    'black.lineLength': 100,
    'flake8.ignore': ignored,
    'mypy.ignoreMissingImports': true
  }));

  ignored.push('E501');
  assert.equal(actual.black.lineLength, 100);
  assert.deepEqual(actual.flake8.ignore, ['E203', 'W503']);
  assert.equal(actual.mypy.ignoreMissingImports, true);
});
