'use strict';

const MULTI_CHAR_OPERATORS = [
  '>>=',
  '<<=',
  '...',
  '++',
  '--',
  '->',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>'
];
const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
const DECLARATION_KEYWORDS = new Set([
  'auto',
  'char',
  'const',
  'double',
  'enum',
  'extern',
  'float',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'short',
  'signed',
  'static',
  'struct',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile'
]);
const CUSTOM_TYPE_REGEX = /^(?:va_list|[A-Za-z_][A-Za-z0-9_]*_t|[tsue]_[A-Za-z0-9_]+|[A-Z][A-Za-z0-9_]*)$/;

function applyUnsafeTransforms(source, options = {}) {
  const tokens = tokenize(source);
  if (!tokens.length) {
    return source;
  }

  const parser = new Parser(tokens, source);
  const ast = parser.parseProgram();
  const edits = [];

  if (options.stripFunctionComments !== false) {
    collectFunctionCommentRemovals(ast, tokens, edits);
  }
  if (options.wrapSingleStatementBodies !== false) {
    collectControlBodyWraps(ast, edits);
  }

  let output = edits.length ? applyEdits(source, edits) : source;
  if (options.splitMultiInstructions) {
    output = splitMultipleInstructions(output);
  }
  if (options.wrapSingleStatementBodies !== false) {
    output = applyInlineControlWraps(output);
  }
  if (options.rewriteForToWhile) {
    output = rewriteForLoopsUntilStable(output);
  }
  if (options.splitMultiInstructions) {
    output = splitMultipleInstructions(output);
  }
  if (options.splitDeclarationAssignment) {
    output = splitDeclarationAssignments(output);
  }
  if (options.hoistDeclarationsToFunctionTop) {
    output = hoistDeclarationsToFunctionTop(output);
  }
  return output;
}

function tokenize(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      tokens.push({ type: 'comment', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const start = index;
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      tokens.push({ type: 'comment', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (char === '"' || char === '\'') {
      const quote = char;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\' && index + 1 < source.length) {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ type: 'literal', value: source.slice(start, index), start, end: index });
      continue;
    }

    const triple = source.slice(index, index + 3);
    const double = source.slice(index, index + 2);
    if (MULTI_CHAR_OPERATORS.includes(triple)) {
      tokens.push({ type: 'operator', value: triple, start: index, end: index + 3 });
      index += 3;
      continue;
    }
    if (MULTI_CHAR_OPERATORS.includes(double)) {
      tokens.push({ type: 'operator', value: double, start: index, end: index + 2 });
      index += 2;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: 'word', value: source.slice(start, index), start, end: index });
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_.]/.test(source[index])) {
        index += 1;
      }
      tokens.push({ type: 'number', value: source.slice(start, index), start, end: index });
      continue;
    }

    tokens.push({
      type: /[(){}\[\],;:?]/.test(char) ? 'punct' : 'operator',
      value: char,
      start: index,
      end: index + 1
    });
    index += 1;
  }

  return tokens;
}

class Parser {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.source = source;
    this.index = 0;
  }

  parseProgram() {
    const body = [];
    while (this.index < this.tokens.length) {
      const statement = this.parseStatement('top');
      if (!statement) {
        this.index += 1;
        continue;
      }
      body.push(statement);
    }
    return { type: 'Program', body };
  }

  current(offset = 0) {
    return this.tokens[this.index + offset] || null;
  }

  peekNonTrivia(from = this.index) {
    let index = from;
    while (index < this.tokens.length && this.tokens[index].type === 'comment') {
      index += 1;
    }
    return this.tokens[index] || null;
  }

  consume() {
    return this.tokens[this.index++] || null;
  }

  consumeLeadingTrivia() {
    let start = null;
    while (this.current() && this.current().type === 'comment') {
      start = start === null ? this.current().start : start;
      this.index += 1;
    }
    return start;
  }

  nextStatementStart() {
    const token = this.peekNonTrivia();
    if (!token) {
      return this.source.length;
    }
    const triviaStart = this.consumeLeadingTrivia();
    if (triviaStart !== null) {
      return triviaStart;
    }
    return token.start;
  }

  parseStatement(context = 'block', startOverride = null) {
    const triviaStart = this.consumeLeadingTrivia();
    const token = this.current();
    if (!token) {
      return null;
    }
    const start = startOverride ?? triviaStart ?? token.start;

    if (context === 'top') {
      const functionBodyIndex = this.findFunctionBodyOpen(this.index);
      if (functionBodyIndex >= 0) {
        return this.parseFunctionDef(start, functionBodyIndex);
      }
    }

    if (token.value === '{') {
      return this.parseCompoundStmt(start, context);
    }
    if (token.type === 'word' && token.value === 'if') {
      return this.parseIfStmt(start);
    }
    if (token.type === 'word' && token.value === 'while') {
      return this.parseWhileStmt(start);
    }
    if (token.type === 'word' && token.value === 'for') {
      return this.parseForStmt(start);
    }
    return this.parseSimpleStmt(start);
  }

  findFunctionBodyOpen(startIndex) {
    let depthParen = 0;
    let depthBracket = 0;
    let sawTopLevelParen = false;

    for (let index = startIndex; index < this.tokens.length; index += 1) {
      const token = this.tokens[index];
      if (token.type === 'comment') {
        continue;
      }
      if (token.value === '(') {
        depthParen += 1;
        continue;
      }
      if (token.value === ')') {
        if (depthParen > 0) {
          depthParen -= 1;
          if (depthParen === 0) {
            sawTopLevelParen = true;
          }
        }
        continue;
      }
      if (token.value === '[') {
        depthBracket += 1;
        continue;
      }
      if (token.value === ']') {
        if (depthBracket > 0) {
          depthBracket -= 1;
        }
        continue;
      }
      if (depthParen === 0 && depthBracket === 0 && ['=', ',', ';', '}'].includes(token.value)) {
        return -1;
      }
      if (depthParen === 0 && depthBracket === 0 && token.value === '{') {
        return sawTopLevelParen ? index : -1;
      }
    }
    return -1;
  }

  parseFunctionDef(start, openIndex) {
    while (this.index < openIndex) {
      this.index += 1;
    }
    const body = this.parseCompoundStmt(this.tokens[openIndex].start, 'block');
    return {
      type: 'FunctionDef',
      start,
      end: body.end,
      body
    };
  }

  parseCompoundStmt(start, context) {
    const open = this.consume();
    const body = [];
    while (this.current() && this.current().value !== '}') {
      const statement = this.parseStatement(context === 'top' ? 'top' : 'block');
      if (!statement) {
        this.index += 1;
        continue;
      }
      body.push(statement);
    }
    const close = this.current() && this.current().value === '}' ? this.consume() : open;
    return {
      type: 'CompoundStmt',
      start,
      openStart: open.start,
      end: close.end,
      body
    };
  }

  parseIfStmt(start) {
    this.consume();
    this.consumeBalanced('(', ')');
    const consequent = this.parseControlledStatement();
    let alternate = null;

    const next = this.peekNonTrivia();
    if (next && next.type === 'word' && next.value === 'else') {
      this.consumeLeadingTrivia();
      const elseToken = this.consume();
      const elseNext = this.peekNonTrivia();
      if (elseNext && elseNext.type === 'word' && elseNext.value === 'if') {
        alternate = this.parseIfStmt(elseToken.start);
      } else {
        alternate = this.parseControlledStatement();
      }
    }

    return {
      type: 'IfStmt',
      start,
      end: (alternate || consequent).end,
      consequent,
      alternate
    };
  }

  parseWhileStmt(start) {
    this.consume();
    this.consumeBalanced('(', ')');
    const body = this.parseControlledStatement();
    return {
      type: 'WhileStmt',
      start,
      end: body.end,
      body
    };
  }

  parseForStmt(start) {
    this.consume();
    const header = this.parseForHeader();
    const body = this.parseControlledStatement();
    return {
      type: 'ForStmt',
      start,
      end: body.end,
      header,
      body
    };
  }

  parseForHeader() {
    const open = this.current();
    if (!open || open.value !== '(') {
      return {
        initStart: 0,
        initEnd: 0,
        conditionStart: 0,
        conditionEnd: 0,
        updateStart: 0,
        updateEnd: 0
      };
    }
    this.consume();
    let depth = 1;
    let bracketDepth = 0;
    let braceDepth = 0;
    let clauseStart = open.end;
    const ranges = [];

    while (this.current()) {
      const token = this.consume();
      if (token.type === 'comment') {
        continue;
      }
      if (token.value === '[') {
        bracketDepth += 1;
        continue;
      }
      if (token.value === ']' && bracketDepth > 0) {
        bracketDepth -= 1;
        continue;
      }
      if (token.value === '{') {
        braceDepth += 1;
        continue;
      }
      if (token.value === '}' && braceDepth > 0) {
        braceDepth -= 1;
        continue;
      }
      if (token.value === '(') {
        depth += 1;
        continue;
      }
      if (token.value === ')' && depth > 0) {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start: clauseStart, end: token.start });
          break;
        }
        continue;
      }
      if (token.value === ';' && depth === 1 && bracketDepth === 0 && braceDepth === 0) {
        ranges.push({ start: clauseStart, end: token.start });
        clauseStart = token.end;
      }
    }

    while (ranges.length < 3) {
      ranges.push({ start: open.end, end: open.end });
    }
    return {
      initStart: ranges[0].start,
      initEnd: ranges[0].end,
      conditionStart: ranges[1].start,
      conditionEnd: ranges[1].end,
      updateStart: ranges[2].start,
      updateEnd: ranges[2].end
    };
  }

  parseControlledStatement() {
    const start = this.nextStatementStart();
    return this.parseStatement('block', start);
  }

  parseSimpleStmt(start) {
    let depthParen = 0;
    let depthBracket = 0;
    let depthBrace = 0;
    let last = this.current();

    while (this.current()) {
      const token = this.current();
      if (token.value === ';' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
        this.index += 1;
        return {
          type: 'SimpleStmt',
          start,
          end: token.end
        };
      }
      if (token.value === '}' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
        return {
          type: 'SimpleStmt',
          start,
          end: last ? last.end : start
        };
      }

      if (token.value === '(') {
        depthParen += 1;
      } else if (token.value === ')') {
        depthParen = Math.max(0, depthParen - 1);
      } else if (token.value === '[') {
        depthBracket += 1;
      } else if (token.value === ']') {
        depthBracket = Math.max(0, depthBracket - 1);
      } else if (token.value === '{') {
        depthBrace += 1;
      } else if (token.value === '}') {
        depthBrace = Math.max(0, depthBrace - 1);
      }

      last = token;
      this.index += 1;
    }

    return {
      type: 'SimpleStmt',
      start,
      end: last ? last.end : start
    };
  }

  consumeBalanced(openValue, closeValue) {
    if (!this.current() || this.current().value !== openValue) {
      return null;
    }
    let depth = 0;
    while (this.current()) {
      const token = this.consume();
      if (token.value === openValue) {
        depth += 1;
      } else if (token.value === closeValue) {
        depth -= 1;
        if (depth === 0) {
          return token.end;
        }
      }
    }
    return null;
  }
}

function collectFunctionCommentRemovals(node, tokens, edits) {
  if (!node) {
    return;
  }
  if (node.type === 'Program') {
    node.body.forEach((statement) => collectFunctionCommentRemovals(statement, tokens, edits));
    return;
  }
  if (node.type === 'FunctionDef') {
    for (const token of tokens) {
      if (token.type === 'comment' && token.start >= node.body.openStart && token.end <= node.body.end) {
        edits.push({ kind: 'remove', start: token.start, end: token.end });
      }
    }
    collectFunctionCommentRemovals(node.body, tokens, edits);
    return;
  }
  if (node.type === 'CompoundStmt') {
    node.body.forEach((statement) => collectFunctionCommentRemovals(statement, tokens, edits));
    return;
  }
  if (node.type === 'IfStmt') {
    collectFunctionCommentRemovals(node.consequent, tokens, edits);
    collectFunctionCommentRemovals(node.alternate, tokens, edits);
    return;
  }
  if (node.type === 'WhileStmt' || node.type === 'ForStmt') {
    collectFunctionCommentRemovals(node.body, tokens, edits);
  }
}

function collectControlBodyWraps(node, edits) {
  if (!node) {
    return;
  }
  if (node.type === 'Program' || node.type === 'CompoundStmt') {
    node.body.forEach((statement) => collectControlBodyWraps(statement, edits));
    return;
  }
  if (node.type === 'FunctionDef') {
    collectControlBodyWraps(node.body, edits);
    return;
  }
  if (node.type === 'IfStmt') {
    if (node.consequent && node.consequent.type !== 'CompoundStmt') {
      pushWrapEdits(node.consequent, edits);
    }
    if (node.alternate && node.alternate.type !== 'CompoundStmt' && node.alternate.type !== 'IfStmt') {
      pushWrapEdits(node.alternate, edits);
    }
    collectControlBodyWraps(node.consequent, edits);
    collectControlBodyWraps(node.alternate, edits);
    return;
  }
  if ((node.type === 'WhileStmt' || node.type === 'ForStmt') && node.body && node.body.type !== 'CompoundStmt') {
    pushWrapEdits(node.body, edits);
    collectControlBodyWraps(node.body, edits);
  }
}

function pushWrapEdits(node, edits) {
  edits.push({ kind: 'insert', start: node.start, text: '{' });
  edits.push({ kind: 'insert', start: node.end, text: '}' });
}

function applyEdits(source, edits) {
  const ordered = [...edits].sort((left, right) => {
    if (left.start !== right.start) {
      return right.start - left.start;
    }
    const priority = { remove: 0, replace: 1, insert: 2 };
    return priority[left.kind] - priority[right.kind];
  });

  let output = source;
  for (const edit of ordered) {
    if (edit.kind === 'remove') {
      output = output.slice(0, edit.start) + output.slice(edit.end);
      continue;
    }
    if (edit.kind === 'replace') {
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
      continue;
    }
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.start);
  }
  return output;
}

function applyInlineControlWraps(source) {
  const tokens = tokenize(source);
  const edits = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'word' && ['if', 'while', 'for'].includes(token.value)) {
      const openIndex = nextNonCommentIndex(tokens, index + 1);
      if (openIndex < 0 || tokens[openIndex].value !== '(') {
        continue;
      }
      const closeIndex = findBalancedClose(tokens, openIndex, '(', ')');
      if (closeIndex < 0) {
        continue;
      }
      const bodyIndex = nextNonCommentIndex(tokens, closeIndex + 1);
      if (bodyIndex < 0 || tokens[bodyIndex].value === '{' || tokens[bodyIndex].value === ';') {
        continue;
      }
      if (source.slice(tokens[closeIndex].end, tokens[bodyIndex].start).includes('\n')) {
        continue;
      }
      const stmtEnd = findStatementEnd(tokens, bodyIndex);
      if (stmtEnd < 0) {
        continue;
      }
      edits.push({ kind: 'insert', start: tokens[bodyIndex].start, text: '{' });
      edits.push({ kind: 'insert', start: tokens[stmtEnd].end, text: '}' });
      index = stmtEnd;
      continue;
    }
    if (token.type === 'word' && token.value === 'else') {
      const bodyIndex = nextNonCommentIndex(tokens, index + 1);
      if (bodyIndex < 0 || ['{', ';'].includes(tokens[bodyIndex].value)) {
        continue;
      }
      if (tokens[bodyIndex].type === 'word' && tokens[bodyIndex].value === 'if') {
        continue;
      }
      if (source.slice(token.end, tokens[bodyIndex].start).includes('\n')) {
        continue;
      }
      const stmtEnd = findStatementEnd(tokens, bodyIndex);
      if (stmtEnd < 0) {
        continue;
      }
      edits.push({ kind: 'insert', start: tokens[bodyIndex].start, text: '{' });
      edits.push({ kind: 'insert', start: tokens[stmtEnd].end, text: '}' });
      index = stmtEnd;
    }
  }

  if (!edits.length) {
    return source;
  }
  return applyEdits(source, dedupeEdits(edits));
}

function dedupeEdits(edits) {
  const seen = new Set();
  const output = [];
  for (const edit of edits) {
    const key = `${edit.kind}:${edit.start}:${edit.end || ''}:${edit.text || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(edit);
    }
  }
  return output;
}

function nextNonCommentIndex(tokens, startIndex) {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'comment') {
      return index;
    }
  }
  return -1;
}

function findBalancedClose(tokens, openIndex, openValue, closeValue) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === openValue) {
      depth += 1;
    } else if (token.value === closeValue) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findStatementEnd(tokens, startIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === '(') {
      parenDepth += 1;
      continue;
    }
    if (token.value === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (token.value === '[') {
      bracketDepth += 1;
      continue;
    }
    if (token.value === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (token.value === '{') {
      braceDepth += 1;
      continue;
    }
    if (token.value === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (token.value === ';' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index;
    }
  }
  return -1;
}

function splitMultipleInstructions(source) {
  const tokens = tokenize(source);
  const edits = [];
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === '(') {
      parenDepth += 1;
      continue;
    }
    if (token.value === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (token.value === '[') {
      bracketDepth += 1;
      continue;
    }
    if (token.value === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (token.value !== ';' || parenDepth > 0 || bracketDepth > 0) {
      continue;
    }

    const nextIndex = nextNonCommentIndex(tokens, index + 1);
    if (nextIndex < 0) {
      continue;
    }
    const next = tokens[nextIndex];
    if (next.value === '}') {
      continue;
    }
    if (source.slice(token.end, next.start).includes('\n')) {
      continue;
    }
    edits.push({ kind: 'insert', start: token.end, text: '\n' });
  }

  if (!edits.length) {
    return source;
  }
  return applyEdits(source, dedupeEdits(edits));
}

function rewriteForLoops(source) {
  const tokens = tokenize(source);
  if (!tokens.length) {
    return source;
  }
  const parser = new Parser(tokens, source);
  const ast = parser.parseProgram();
  const edits = [];

  collectForLoopRewrites(ast, source, edits);
  if (!edits.length) {
    return source;
  }
  return applyEdits(source, edits);
}

function rewriteForLoopsUntilStable(source) {
  let previous = source;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const next = rewriteForLoops(previous);
    if (next === previous) {
      return next;
    }
    previous = next;
  }
  return previous;
}

function collectForLoopRewrites(node, source, edits) {
  if (!node) {
    return;
  }
  if (node.type === 'Program' || node.type === 'CompoundStmt') {
    node.body.forEach((statement) => collectForLoopRewrites(statement, source, edits));
    return;
  }
  if (node.type === 'FunctionDef') {
    collectForLoopRewrites(node.body, source, edits);
    return;
  }
  if (node.type === 'IfStmt') {
    collectForLoopRewrites(node.consequent, source, edits);
    collectForLoopRewrites(node.alternate, source, edits);
    return;
  }
  if (node.type === 'WhileStmt') {
    collectForLoopRewrites(node.body, source, edits);
    return;
  }
  if (node.type === 'ForStmt') {
    edits.push({
      kind: 'replace',
      start: node.start,
      end: node.end,
      text: buildForLoopReplacement(node, source)
    });
  }
}

function buildForLoopReplacement(node, source) {
  const init = source.slice(node.header.initStart, node.header.initEnd).trim();
  const condition = source.slice(node.header.conditionStart, node.header.conditionEnd).trim() || '1';
  const update = source.slice(node.header.updateStart, node.header.updateEnd).trim();
  const bodySource = rewriteForLoops(source.slice(node.body.start, node.body.end));
  const body = buildWhileBodySource(bodySource, node.body, update);
  const statements = [];

  if (init) {
    statements.push(ensureStatement(init));
  }
  statements.push(`while (${condition}) ${body}`);
  return `{\n${statements.join('\n')}\n}`;
}

function buildWhileBodySource(bodySource, bodyNode, update) {
  let inner = '';
  if (bodyNode.type === 'CompoundStmt') {
    const open = bodySource.indexOf('{');
    const close = bodySource.lastIndexOf('}');
    inner = open >= 0 && close > open ? bodySource.slice(open + 1, close).trim() : bodySource.trim();
  } else {
    inner = ensureStatement(bodySource.trim());
  }
  if (update) {
    inner = inner ? `${inner}\n${ensureStatement(update)}` : ensureStatement(update);
  }
  return `{\n${inner}\n}`;
}

function splitDeclarationAssignments(source) {
  const tokens = tokenize(source);
  if (!tokens.length) {
    return source;
  }
  const parser = new Parser(tokens, source);
  const ast = parser.parseProgram();
  const edits = [];

  collectDeclarationAssignmentSplits(ast, source, edits, false);
  if (!edits.length) {
    return source;
  }
  return applyEdits(source, edits);
}

function collectDeclarationAssignmentSplits(node, source, edits, inFunction) {
  if (!node) {
    return;
  }
  if (node.type === 'Program') {
    node.body.forEach((statement) => collectDeclarationAssignmentSplits(statement, source, edits, false));
    return;
  }
  if (node.type === 'FunctionDef') {
    collectDeclarationAssignmentSplits(node.body, source, edits, true);
    return;
  }
  if (node.type === 'CompoundStmt') {
    node.body.forEach((statement) => collectDeclarationAssignmentSplits(statement, source, edits, inFunction));
    return;
  }
  if (node.type === 'IfStmt') {
    collectDeclarationAssignmentSplits(node.consequent, source, edits, inFunction);
    collectDeclarationAssignmentSplits(node.alternate, source, edits, inFunction);
    return;
  }
  if (node.type === 'WhileStmt' || node.type === 'ForStmt') {
    collectDeclarationAssignmentSplits(node.body, source, edits, inFunction);
    return;
  }
  if (node.type !== 'SimpleStmt' || !inFunction) {
    return;
  }

  const parsed = parseDeclarationStatement(source.slice(node.start, node.end));
  if (!parsed || !parsed.hasAssignment || !parsed.canSplit) {
    return;
  }
  const replacement = buildSplitDeclarationReplacement(parsed);
  if (!replacement) {
    return;
  }
  edits.push({
    kind: 'replace',
    start: node.start,
    end: node.end,
    text: replacement
  });
}

function hoistDeclarationsToFunctionTop(source) {
  const tokens = tokenize(source);
  if (!tokens.length) {
    return source;
  }
  const parser = new Parser(tokens, source);
  const ast = parser.parseProgram();
  const edits = [];

  collectFunctionDeclarationHoists(ast, source, edits);
  if (!edits.length) {
    return source;
  }
  return applyEdits(source, edits);
}

function collectFunctionDeclarationHoists(node, source, edits) {
  if (!node) {
    return;
  }
  if (node.type === 'Program') {
    node.body.forEach((statement) => collectFunctionDeclarationHoists(statement, source, edits));
    return;
  }
  if (node.type !== 'FunctionDef') {
    return;
  }

  const declarations = [];
  collectFunctionScopedDeclarations(node.body, source, declarations);
  if (!declarations.length) {
    return;
  }

  const unique = [];
  const seen = new Set();
  for (const declaration of declarations) {
    const key = `${declaration.start}:${declaration.end}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(declaration);
    }
  }
  for (const declaration of unique) {
    edits.push({
      kind: 'replace',
      start: declaration.start,
      end: declaration.end,
      text: ''
    });
  }
  const hoistedText = unique
    .map((declaration) => declaration.declarationText)
    .filter(Boolean)
    .join('\n');
  if (!hoistedText) {
    return;
  }
  edits.push({
    kind: 'insert',
    start: node.body.openStart + 1,
    text: `\n${hoistedText}\n`
  });
}

function collectFunctionScopedDeclarations(node, source, output) {
  if (!node) {
    return;
  }
  if (node.type === 'CompoundStmt') {
    node.body.forEach((statement) => collectFunctionScopedDeclarations(statement, source, output));
    return;
  }
  if (node.type === 'IfStmt') {
    collectFunctionScopedDeclarations(node.consequent, source, output);
    collectFunctionScopedDeclarations(node.alternate, source, output);
    return;
  }
  if (node.type === 'WhileStmt' || node.type === 'ForStmt') {
    collectFunctionScopedDeclarations(node.body, source, output);
    return;
  }
  if (node.type !== 'SimpleStmt') {
    return;
  }
  const parsed = parseDeclarationStatement(source.slice(node.start, node.end));
  if (!parsed || parsed.typeHeadTokens.includes('typedef') || parsed.hasAssignment) {
    return;
  }
  output.push({
    start: node.start,
    end: node.end,
    declarationText: parsed.declarationText
  });
}

function parseDeclarationStatement(text) {
  const trimmed = text.trim();
  if (!trimmed.endsWith(';') || /^(if|while|for|else|return)\b/.test(trimmed)) {
    return null;
  }
  const statement = trimmed.slice(0, -1).trim();
  if (!statement) {
    return null;
  }

  const assignToken = findTopLevelAssignmentToken(statement);
  const assignIndex = assignToken ? assignToken.start : statement.length;
  const left = statement.slice(0, assignIndex).trim();
  const right = assignToken ? statement.slice(assignToken.end).trim() : '';

  if (hasTopLevelComma(left)) {
    return null;
  }

  const leftMatch = left.match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*)\s+([*&\s]*)([A-Za-z_]\w*)(\s*(?:\[[^\]]*\]\s*)*)$/);
  if (!leftMatch) {
    return null;
  }
  const typeHead = compactInlineWhitespace(leftMatch[1]);
  const typeHeadTokens = typeHead.split(/\s+/).filter(Boolean);
  if (!isTypeHeadTokens(typeHeadTokens) || typeHeadTokens.includes('typedef')) {
    return null;
  }

  const pointer = (leftMatch[2] || '').replace(/\s+/g, '');
  const name = leftMatch[3];
  const arraySuffix = compactInlineWhitespace(leftMatch[4] || '').replace(/\s*\[\s*/g, '[').replace(/\s*\]\s*/g, ']');
  const declarationText = buildDeclarationStatement({
    typeHead,
    pointer,
    name,
    arraySuffix
  });
  const assignmentOperator = assignToken ? assignToken.value : '';
  const isStaticOrConst = typeHeadTokens.includes('static') || typeHeadTokens.includes('const');

  return {
    typeHead,
    typeHeadTokens,
    pointer,
    name,
    arraySuffix,
    hasAssignment: Boolean(assignToken),
    assignmentOperator,
    initializer: right,
    declarationText,
    canSplit: Boolean(assignToken) && assignmentOperator === '=' && !isStaticOrConst
  };
}

function buildDeclarationStatement(parsed) {
  return `${parsed.typeHead} ${parsed.pointer}${parsed.name}${parsed.arraySuffix};`.replace(/\s+/g, ' ').replace(/\s(\[)/g, '$1').trim();
}

function buildSplitDeclarationReplacement(parsed) {
  if (!parsed.hasAssignment) {
    return parsed.declarationText;
  }
  if (!parsed.arraySuffix) {
    if (parsed.initializer.startsWith('{')) {
      return null;
    }
    return `${parsed.declarationText} ${parsed.name} = ${parsed.initializer};`;
  }

  const dimensions = (parsed.arraySuffix.match(/\[/g) || []).length;
  if (dimensions !== 1) {
    return null;
  }
  if (parsed.initializer.startsWith('{') && parsed.initializer.endsWith('}')) {
    const elements = splitTopLevelByComma(parsed.initializer.slice(1, -1));
    const assigns = elements
      .map((element, index) => element.trim())
      .filter(Boolean)
      .map((element, index) => `${parsed.name}[${index}] = ${element};`);
    return [parsed.declarationText, ...assigns].join(' ');
  }
  if (/^".*"$/.test(parsed.initializer)) {
    const bytes = parseCStringBytes(parsed.initializer);
    const assigns = bytes.map((value, index) => `${parsed.name}[${index}] = ${value};`);
    assigns.push(`${parsed.name}[${bytes.length}] = 0;`);
    return [parsed.declarationText, ...assigns].join(' ');
  }
  return null;
}

function findTopLevelAssignmentToken(statement) {
  const tokens = tokenize(statement);
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const token of tokens) {
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === '(') {
      parenDepth += 1;
      continue;
    }
    if (token.value === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (token.value === '[') {
      bracketDepth += 1;
      continue;
    }
    if (token.value === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (token.value === '{') {
      braceDepth += 1;
      continue;
    }
    if (token.value === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && ASSIGNMENT_OPERATORS.has(token.value)) {
      return token;
    }
  }
  return null;
}

function hasTopLevelComma(statement) {
  const tokens = tokenize(statement);
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const token of tokens) {
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === '(') {
      parenDepth += 1;
      continue;
    }
    if (token.value === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (token.value === '[') {
      bracketDepth += 1;
      continue;
    }
    if (token.value === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (token.value === '{') {
      braceDepth += 1;
      continue;
    }
    if (token.value === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && token.value === ',') {
      return true;
    }
  }
  return false;
}

function splitTopLevelByComma(text) {
  const tokens = tokenize(text);
  const segments = [];
  let cursor = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (const token of tokens) {
    if (token.type === 'comment') {
      continue;
    }
    if (token.value === '(') {
      parenDepth += 1;
      continue;
    }
    if (token.value === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (token.value === '[') {
      bracketDepth += 1;
      continue;
    }
    if (token.value === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (token.value === '{') {
      braceDepth += 1;
      continue;
    }
    if (token.value === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }
    if (token.value === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      segments.push(text.slice(cursor, token.start));
      cursor = token.end;
    }
  }
  segments.push(text.slice(cursor));
  return segments;
}

function parseCStringBytes(literal) {
  const bytes = [];
  for (let index = 1; index < literal.length - 1; index += 1) {
    const char = literal[index];
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0));
      continue;
    }
    const next = literal[index + 1] || '';
    index += 1;
    if (next === 'n') {
      bytes.push(10);
    } else if (next === 'r') {
      bytes.push(13);
    } else if (next === 't') {
      bytes.push(9);
    } else if (next === '0') {
      bytes.push(0);
    } else if (next === '\\') {
      bytes.push(92);
    } else if (next === '"') {
      bytes.push(34);
    } else if (next === '\'') {
      bytes.push(39);
    } else if (next === 'x') {
      let hex = '';
      while (index + 1 < literal.length - 1 && /[0-9A-Fa-f]/.test(literal[index + 1])) {
        hex += literal[index + 1];
        index += 1;
      }
      bytes.push(hex ? Number.parseInt(hex, 16) : 0);
    } else if (/[0-7]/.test(next)) {
      let octal = next;
      while (index + 1 < literal.length - 1 && octal.length < 3 && /[0-7]/.test(literal[index + 1])) {
        octal += literal[index + 1];
        index += 1;
      }
      bytes.push(Number.parseInt(octal, 8));
    } else {
      bytes.push(next.charCodeAt(0));
    }
  }
  return bytes;
}

function ensureStatement(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.endsWith(';') || trimmed.endsWith('}')) {
    return trimmed;
  }
  return `${trimmed};`;
}

function compactInlineWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function isTypeHeadTokens(tokens) {
  if (!tokens.length) {
    return false;
  }
  const [first, ...rest] = tokens;
  if (CUSTOM_TYPE_REGEX.test(first)) {
    return true;
  }
  if (['struct', 'union', 'enum'].includes(first)) {
    return rest.length > 0;
  }
  if (DECLARATION_KEYWORDS.has(first)) {
    return true;
  }
  if (['const', 'signed', 'unsigned', 'long', 'short', 'static', 'extern', 'inline', 'register', 'restrict', 'volatile'].includes(first)) {
    return rest.length > 0 && isTypeHeadTokens(rest);
  }
  return false;
}

module.exports = {
  applyUnsafeTransforms
};
