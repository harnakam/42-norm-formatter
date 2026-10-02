'use strict';

function arraySetting(config, key) {
  const value = config.get(key, []);
  return Array.isArray(value) ? [...value] : [];
}

function readConfig(config) {
  return Object.freeze({
    pythonPath: config.get('pythonPath', 'python'),
    formatOnSave: config.get('formatOnSave', false),
    checkOnSave: config.get('checkOnSave', true),
    checkOnOpen: config.get('checkOnOpen', true),
    checkOnChange: config.get('checkOnChange', false),
    checkOnChangeDelay: config.get('checkOnChangeDelay', 750),
    showStatusBar: config.get('showStatusBar', true),
    traceRunner: config.get('traceRunner', false),
    repairMissingColons: config.get('repairMissingColons', true),
    addNoneReturnAnnotations: config.get('addNoneReturnAnnotations', true),
    addLiteralReturnAnnotations: config.get('addLiteralReturnAnnotations', true),
    black: {
      enabled: config.get('black.enabled', true),
      lineLength: config.get('black.lineLength', 88),
      skipStringNormalization: config.get('black.skipStringNormalization', false),
      skipMagicTrailingComma: config.get('black.skipMagicTrailingComma', false),
      targetVersions: arraySetting(config, 'black.targetVersions'),
      extraArgs: arraySetting(config, 'black.extraArgs')
    },
    flake8: {
      enabled: config.get('flake8.enabled', true),
      maxLineLength: config.get('flake8.maxLineLength', 88),
      ignore: arraySetting(config, 'flake8.ignore'),
      select: arraySetting(config, 'flake8.select'),
      extraArgs: arraySetting(config, 'flake8.extraArgs')
    },
    mypy: {
      enabled: config.get('mypy.enabled', true),
      strict: config.get('mypy.strict', true),
      followImports: config.get('mypy.followImports', 'normal'),
      ignoreMissingImports: config.get('mypy.ignoreMissingImports', false),
      extraArgs: arraySetting(config, 'mypy.extraArgs')
    }
  });
}

module.exports = { readConfig };
