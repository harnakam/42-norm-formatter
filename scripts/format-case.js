'use strict';

const fs = require('fs');
const path = require('path');

const { formatDocumentText, formatText } = require('../lib/formatter');

function parseArgs(argv) {
  const args = {
    headerEnabled: true,
    unsafe: false,
    stripFunctionComments: false,
    wrapSingleStatementBodies: false,
    splitMultiInstructions: false,
    splitDeclarationAssignment: false,
    hoistDeclarationsToFunctionTop: false,
    rewriteForToWhile: false,
    username: 'username',
    email: 'username@student.42tokyo.jp',
    file: '',
    output: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--no-header') {
      args.headerEnabled = false;
      continue;
    }
    if (value === '--unsafe') {
      args.unsafe = true;
      continue;
    }
    if (value === '--strip-function-comments') {
      args.stripFunctionComments = true;
      continue;
    }
    if (value === '--wrap-single-statement-bodies') {
      args.wrapSingleStatementBodies = true;
      continue;
    }
    if (value === '--split-multi-instructions') {
      args.splitMultiInstructions = true;
      continue;
    }
    if (value === '--split-declaration-assignment') {
      args.splitDeclarationAssignment = true;
      continue;
    }
    if (value === '--hoist-declarations-to-function-top') {
      args.hoistDeclarationsToFunctionTop = true;
      continue;
    }
    if (value === '--rewrite-for-to-while') {
      args.rewriteForToWhile = true;
      continue;
    }
    if (value === '--file') {
      args.file = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (value === '--output') {
      args.output = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (value === '--username') {
      args.username = argv[index + 1] || args.username;
      index += 1;
      continue;
    }
    if (value === '--email') {
      args.email = argv[index + 1] || args.email;
      index += 1;
    }
  }

  if (!args.file) {
    throw new Error('Missing --file argument.');
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.file);
  const source = fs.readFileSync(inputPath, 'utf8');
  const transformOptions = {
    stripFunctionComments: args.unsafe || args.stripFunctionComments,
    wrapSingleStatementBodies: args.unsafe || args.wrapSingleStatementBodies,
    splitMultiInstructions: args.unsafe || args.splitMultiInstructions,
    splitDeclarationAssignment: args.unsafe || args.splitDeclarationAssignment,
    hoistDeclarationsToFunctionTop: args.unsafe || args.hoistDeclarationsToFunctionTop,
    rewriteForToWhile: args.unsafe || args.rewriteForToWhile
  };
  const formatted = args.headerEnabled
    ? formatDocumentText(source, {
      fileName: path.basename(inputPath),
      headerEnabled: true,
      headerUsername: args.username,
      headerEmail: args.email,
      splitMultiInstructions: transformOptions.splitMultiInstructions,
      splitDeclarationAssignment: transformOptions.splitDeclarationAssignment,
      hoistDeclarationsToFunctionTop: transformOptions.hoistDeclarationsToFunctionTop,
      rewriteForToWhile: transformOptions.rewriteForToWhile,
      stripFunctionComments: transformOptions.stripFunctionComments,
      wrapSingleStatementBodies: transformOptions.wrapSingleStatementBodies
    })
    : formatText(source, transformOptions);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), formatted, 'utf8');
    return;
  }
  process.stdout.write(formatted);
}

main();
