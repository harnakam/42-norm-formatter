'use strict';

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function toDiagnosticData(item) {
  const line = positiveInteger(item.line, 1);
  const column = positiveInteger(item.column, 1);
  const start = { line: line - 1, character: column - 1 };
  const rawEndLine = positiveInteger(item.endLine, line);
  const rawEndColumn = positiveInteger(item.endColumn, column + 1);
  let end = { line: rawEndLine - 1, character: rawEndColumn - 1 };
  if (
    end.line < start.line ||
    (end.line === start.line && end.character <= start.character)
  ) {
    end = { line: start.line, character: start.character + 1 };
  }
  return {
    source: item.tool || '42-py-formatter',
    code: item.code || '',
    severity: item.severity || 'warning',
    message: item.message || '',
    range: { start, end }
  };
}

module.exports = { toDiagnosticData };
