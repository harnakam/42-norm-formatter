'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const manifest = require('../../package.json');

const expectedCommands = [
  'normFormatter.python.showMenu',
  'normFormatter.python.formatDocument',
  'normFormatter.python.checkCurrentFile',
  'normFormatter.python.checkWorkspace',
  'normFormatter.python.configure',
  'normFormatter.python.showOutput'
];

function collectLocalizationKeys(value, keys = new Set()) {
  if (typeof value === 'string' && /^%[^%]+%$/.test(value)) {
    keys.add(value.slice(1, -1));
  } else if (Array.isArray(value)) {
    for (const item of value) collectLocalizationKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectLocalizationKeys(item, keys);
  }
  return keys;
}

test('manifest contributes Python commands and a shared format shortcut', () => {
  const actual = manifest.contributes.commands.map((item) => item.command);

  for (const command of expectedCommands) assert.ok(actual.includes(command));
  assert.equal(manifest.contributes.keybindings[0].command, 'normFormatter.formatDocument');
  assert.match(manifest.contributes.keybindings[0].when, /python/);
});

test('manifest preserves safe automatic-action defaults', () => {
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties['normFormatter.python.formatOnSave'].default, false);
  assert.equal(properties['normFormatter.python.checkOnSave'].default, true);
  assert.equal(properties['normFormatter.python.mypy.strict'].default, true);
  assert.equal(properties['normFormatter.python.black.lineLength'].default, 88);
  assert.equal(properties['normFormatter.python.flake8.maxLineLength'].default, 88);
});

test('English and Japanese catalogs resolve every manifest placeholder', () => {
  const english = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.nls.json'), 'utf8')
  );
  const japanese = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.nls.ja.json'), 'utf8')
  );

  for (const key of collectLocalizationKeys(manifest)) {
    assert.equal(typeof english[key], 'string', `missing English key ${key}`);
    assert.equal(typeof japanese[key], 'string', `missing Japanese key ${key}`);
  }
});
