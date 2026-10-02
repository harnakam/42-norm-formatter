'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {formatDocumentText} = require('../../lib/formatter');
const root = path.resolve(__dirname, '../..');
const manifest = require('../cases/manifest.json');
for (const entry of manifest.cases) {
  test('C regression: ' + entry.name, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-regression-'));
    try {
      const name = path.basename(entry.file);
      const source = fs.readFileSync(path.join(root, entry.file), 'utf8');
      const formatted = formatDocumentText(source, {
        fileName: name, headerEnabled: entry.headerEnabled !== false,
        headerUsername: 'username', headerEmail: 'username@student.42tokyo.jp',
        ...(entry.unsafe ? {stripFunctionComments:true, splitMultiInstructions:true,
          splitDeclarationAssignment:true, hoistDeclarationsToFunctionTop:true, rewriteForToWhile:true} : {}),
        ...entry.transforms
      });
      for(const needle of entry.expectContains || []) assert.ok(formatted.includes(needle), needle);
      for(const needle of entry.expectNotContains || []) assert.ok(!formatted.includes(needle), needle);
      if(entry.expectCreated) assert.ok(formatted.includes('Created: '+entry.expectCreated+' by username'));
      const target = path.join(dir, name);
      fs.writeFileSync(target, formatted);
      const response = JSON.parse(execFileSync('python', ['-B', path.join(root,'python/norm_runner.py'), target],
        {encoding:'utf8', env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}}));
      const actual = response.files[0].errors.filter(e => e.level !== 'Notice').map(e => e.name).sort();
      assert.deepEqual(actual, [...entry.expectedErrors].sort());
    } finally { fs.rmSync(dir, {recursive:true, force:true}); }
  });
}
