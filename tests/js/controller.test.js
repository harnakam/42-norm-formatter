'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RunCoordinator } = require('../../lib/python/run-coordinator');

test('newer run invalidates an older result for the same URI', () => {
  const coordinator = new RunCoordinator();
  const first = coordinator.begin('file:///a.py', 1);
  const second = coordinator.begin('file:///a.py', 2);

  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
});

test('cancel removes current run without affecting another URI', () => {
  const coordinator = new RunCoordinator();
  const a = coordinator.begin('file:///a.py', 1);
  const b = coordinator.begin('file:///b.py', 1);

  coordinator.cancel('file:///a.py');

  assert.equal(coordinator.isCurrent(a), false);
  assert.equal(coordinator.isCurrent(b), true);
});

test('finish invalidates only the matching token', () => {
  const coordinator = new RunCoordinator();
  const stale = coordinator.begin('file:///a.py', 1);
  const current = coordinator.begin('file:///a.py', 1);

  coordinator.finish(stale);
  assert.equal(coordinator.isCurrent(current), true);
  coordinator.finish(current);
  assert.equal(coordinator.isCurrent(current), false);
});
