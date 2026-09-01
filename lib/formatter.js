'use strict';

const path = require('path');
const { applyUnsafeTransforms } = require('./unsafe-transforms');

const CONTROL_KEYWORDS = new Set(['if', 'else', 'while', 'for', 'switch']);
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
const SPACE_BEFORE_PAREN_KEYWORDS = new Set(['if', 'while', 'for', 'return']);
const MULTI_CHAR_OPERATORS = [
  '>>=',
  '<<=',
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
const SINGLE_CHAR_OPERATORS = new Set(['=', '+', '-', '*', '/', '%', '<', '>', '!', '~', '&', '|', '^', '?', ':', '.']);
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ',', ';']);
const HEADER_REGEX = /^\/\* \*{74} \*\/\n(?:\/\*.*\*\/\n){9}\/\* \*{74} \*\/\n*/;
const CUSTOM_TYPE_REGEX = /^(?:va_list|[A-Za-z_][A-Za-z0-9_]*_t|[tsue]_[A-Za-z0-9_]+|[A-Z][A-Za-z0-9_]*)$/;
const KEYWORD_STATEMENTS_WITH_TRAILING_SPACE = new Set(['break', 'continue']);

function normalizeSource(source) {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function maybeApplyUnsafeTransforms(source, options = {}) {
  const transformOptions = {
    stripFunctionComments: Boolean(options.allowUnsafeTransforms || options.stripFunctionComments),
    // Keep body wrapping opt-in because it expands line count.
    wrapSingleStatementBodies: Boolean(options.wrapSingleStatementBodies),
    splitMultiInstructions: Boolean(options.allowUnsafeTransforms || options.splitMultiInstructions),
    splitDeclarationAssignment: Boolean(options.allowUnsafeTransforms || options.splitDeclarationAssignment),
    hoistDeclarationsToFunctionTop: Boolean(options.allowUnsafeTransforms || options.hoistDeclarationsToFunctionTop),
    rewriteForToWhile: Boolean(options.allowUnsafeTransforms || options.rewriteForToWhile)
  };
  if (
    !transformOptions.stripFunctionComments &&
    !transformOptions.wrapSingleStatementBodies &&
    !transformOptions.splitMultiInstructions &&
    !transformOptions.splitDeclarationAssignment &&
    !transformOptions.hoistDeclarationsToFunctionTop &&
    !transformOptions.rewriteForToWhile
  ) {
    return source;
  }
  return applyUnsafeTransforms(source, transformOptions);
}

function formatCoreText(source) {
  const normalized = normalizeSource(source);
  const explodedLines = explodeSource(normalized);
  const formattedLines = [];
  const braceKinds = [];
  const declarationBuffer = [];
  let declarationBufferKind = '';
  let inBlockComment = false;
  let preprocessorDepth = 0;
  let continuationDepth = 0;
  let previousSignificant = '';
  let pendingSingleControl = false;
  let pendingCarriedBlock = false;
  let carriedControlIndentDepth = 0;
  let lastWasDeclaration = false;
  let pendingTopLevelBlank = false;

  const flushDeclarationBuffer = () => {
    if (!declarationBuffer.length) {
      return;
    }
    const aligned = alignDeclarationBlock(declarationBuffer);
    formattedLines.push(...aligned);
    declarationBuffer.length = 0;
    declarationBufferKind = '';
  };

  for (let index = 0; index < explodedLines.length; index += 1) {
    const rawLine = explodedLines[index];
    const trimmed = rawLine.trim();
    const insideFunction = braceKinds.includes('function');
    const insideType = braceKinds.includes('type');
    const lineHasSingleControlIndent = pendingSingleControl;

    if (!trimmed) {
      if (!(insideFunction && declarationBufferKind === 'funcDecl')) {
        flushDeclarationBuffer();
      }
      if (!insideFunction && !pendingTopLevelBlank && formattedLines.length > 0) {
        pendingTopLevelBlank = true;
      }
      continue;
    }

    if (pendingTopLevelBlank && !insideFunction) {
      flushDeclarationBuffer();
      formattedLines.push('');
      pendingTopLevelBlank = false;
    }

    if (inBlockComment) {
      flushDeclarationBuffer();
      const indent = Math.max(0, braceKinds.length + (pendingSingleControl ? 1 : 0));
      formattedLines.push(`${'\t'.repeat(indent)}${trimmed}`);
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      previousSignificant = trimmed;
      pendingSingleControl = false;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      flushDeclarationBuffer();
      const indent = Math.max(0, braceKinds.length + (pendingSingleControl ? 1 : 0));
      formattedLines.push(`${'\t'.repeat(indent)}${trimmed}`);
      inBlockComment = !trimmed.includes('*/');
      previousSignificant = trimmed;
      pendingSingleControl = false;
      continue;
    }

    if (trimmed.startsWith('#')) {
      flushDeclarationBuffer();
      const { line, nextDepth } = formatPreprocessorLine(trimmed, preprocessorDepth);
      formattedLines.push(line);
      preprocessorDepth = nextDepth;
      previousSignificant = line;
      pendingSingleControl = false;
      lastWasDeclaration = false;
      continue;
    }

    const leadingClosers = countLeadingClosers(trimmed);
    let baseIndent = Math.max(0, braceKinds.length - leadingClosers);
    if (pendingSingleControl) {
      baseIndent += 1;
    }
    if (trimmed === '{' && pendingCarriedBlock) {
      baseIndent += 1;
    }
    if (carriedControlIndentDepth > 0 && braceKinds.length >= carriedControlIndentDepth) {
      baseIndent += 1;
    }
    if (continuationDepth > 0) {
      baseIndent += continuationDepth;
    }

    const formattedCode = formatCodeLine(trimmed);
    const declarationGroup = getAlignmentGroup(formattedCode, { insideFunction, insideType });
    const declaration = insideFunction && isDeclarationLine(formattedCode);

    if (declarationGroup) {
      if (declarationBufferKind && declarationBufferKind !== declarationGroup) {
        flushDeclarationBuffer();
      }
      declarationBufferKind = declarationGroup;
      declarationBuffer.push({
        indent: Math.max(0, baseIndent),
        code: formattedCode
      });
      updateBraceKinds(braceKinds, previousSignificant, formattedCode);
      continuationDepth = computeContinuationDepth(formattedCode);
      const nextSignificant = getNextSignificantLine(explodedLines, index + 1);
      pendingSingleControl = isSingleControlLine(formattedCode, nextSignificant);
      pendingCarriedBlock = lineHasSingleControlIndent && isControlHeader(formattedCode) && nextSignificant === '{';
      lastWasDeclaration = true;
      previousSignificant = formattedCode;
      continue;
    }

    flushDeclarationBuffer();

    if (insideFunction && lastWasDeclaration && !declaration && formattedCode !== '}' && formattedLines[formattedLines.length - 1] !== '') {
      formattedLines.push('');
    }

    if (!insideFunction && isFunctionSignature(formattedCode) && formattedLines.length > 0 && formattedLines[formattedLines.length - 1] !== '') {
      formattedLines.push('');
    }

    formattedLines.push(`${'\t'.repeat(Math.max(0, baseIndent))}${formattedCode}`);

    updateBraceKinds(braceKinds, previousSignificant, formattedCode);
    if (trimmed === '{' && pendingCarriedBlock) {
      carriedControlIndentDepth = braceKinds.length;
      pendingCarriedBlock = false;
    }
    if (carriedControlIndentDepth > 0 && braceKinds.length < carriedControlIndentDepth) {
      carriedControlIndentDepth = 0;
    }
    continuationDepth = computeContinuationDepth(formattedCode);
    const nextSignificant = getNextSignificantLine(explodedLines, index + 1);
    pendingSingleControl = isSingleControlLine(formattedCode, nextSignificant);
    pendingCarriedBlock = lineHasSingleControlIndent && isControlHeader(formattedCode) && nextSignificant === '{';
    lastWasDeclaration = declaration;
    previousSignificant = formattedCode;
  }

  flushDeclarationBuffer();

  return `${formattedLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function formatText(source, options = {}) {
  const normalized = normalizeSource(source);
  const transformed = maybeApplyUnsafeTransforms(normalized, options);
  return formatCoreText(transformed);
}

function formatDocumentText(source, options = {}) {
  if (!options.headerEnabled) {
    return formatText(normalizeHeaderProtection(source, options.fileName), options);
  }
  const username = options.headerUsername || 'username';
  const extracted = stripExistingHeader(source);
  const normalizedBody = normalizeHeaderProtection(extracted.body.replace(/^\s+/, ''), options.fileName);
  const body = formatText(normalizedBody, options);
  const header = build42Header({
    fileName: options.fileName || 'untitled.c',
    username,
    email: resolveHeaderEmail(username, options.headerEmail),
    createdAt: extracted.createdAt || formatTimestamp(new Date()),
    updatedAt: formatTimestamp(new Date())
  });
  if (!body.trim()) {
    return `${header}\n`;
  }
  return `${header}\n\n${body.replace(/^\n+/, '')}`;
}

function explodeSource(source) {
  const lines = source.split('\n');
  const output = [];
  let inBlockComment = false;

  for (const line of lines) {
    if (inBlockComment || line.trimStart().startsWith('#')) {
      output.push(line);
      if (inBlockComment && line.includes('*/')) {
        inBlockComment = false;
      }
      if (!inBlockComment && line.includes('/*') && !line.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    const fragments = [];
    let current = '';
    let state = 'code';
    let parenDepth = 0;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1] || '';

      if (state === 'lineComment') {
        current += char;
        continue;
      }
      if (state === 'blockComment') {
        current += char;
        if (char === '*' && next === '/') {
          current += '/';
          index += 1;
          state = 'code';
        }
        continue;
      }
      if (state === 'string') {
        current += char;
        if (char === '\\' && next) {
          current += next;
          index += 1;
          continue;
        }
        if (char === '"') {
          state = 'code';
        }
        continue;
      }
      if (state === 'char') {
        current += char;
        if (char === '\\' && next) {
          current += next;
          index += 1;
          continue;
        }
        if (char === '\'') {
          state = 'code';
        }
        continue;
      }

      if (char === '/' && next === '/') {
        current += line.slice(index);
        state = 'lineComment';
        break;
      }
      if (char === '/' && next === '*') {
        current += '/*';
        index += 1;
        state = 'blockComment';
        continue;
      }
      if (char === '"') {
        current += char;
        state = 'string';
        continue;
      }
      if (char === '\'') {
        current += char;
        state = 'char';
        continue;
      }
      if (char === '(') {
        current += char;
        parenDepth += 1;
        continue;
      }
      if (char === ')') {
        current += char;
        if (parenDepth > 0) {
          parenDepth -= 1;
        }
        continue;
      }
      if (char === '{') {
        pushFragment(fragments, current);
        fragments.push('{');
        current = '';
        continue;
      }
      if (char === '}') {
        pushFragment(fragments, current);
        current = '}';
        const { word, symbol } = peekNextWordOrSymbol(line, index + 1);
        if (word === 'else' || word === 'while') {
          fragments.push(current);
          current = '';
          continue;
        }
        if (symbol === ';' || symbol === ',' || symbol === ')' || (word && !['else', 'while'].includes(word))) {
          continue;
        }
        fragments.push(current);
        current = '';
        continue;
      }
      if (char === ';') {
        current += ';';
        if (parenDepth > 0) {
          continue;
        }
        pushFragment(fragments, current);
        current = '';
        continue;
      }
      current += char;
    }

    pushFragment(fragments, current);
    if (state === 'blockComment') {
      inBlockComment = true;
    }
    if (!fragments.length) {
      output.push('');
    } else {
      output.push(...fragments);
    }
  }

  return output;
}

function pushFragment(fragments, text) {
  const value = text.trim();
  if (value) {
    fragments.push(value);
  }
}

function peekNextWordOrSymbol(line, startIndex) {
  let index = startIndex;
  while (index < line.length && /\s/.test(line[index])) {
    index += 1;
  }
  const symbol = line[index] || '';
  if (!/[A-Za-z_]/.test(symbol)) {
    return { word: '', symbol };
  }
  let word = '';
  while (index < line.length && /[A-Za-z0-9_]/.test(line[index])) {
    word += line[index];
    index += 1;
  }
  return { word, symbol: '' };
}

function countLeadingClosers(line) {
  const match = line.match(/^[\]\)\}]+/);
  return match ? match[0].length : 0;
}

function computeContinuationDepth(line) {
  const tokens = tokenizeCode(stripTrailingComment(line).code);
  let depth = 0;
  for (const token of tokens) {
    if (token.value === '(' || token.value === '[') {
      depth += 1;
    } else if ((token.value === ')' || token.value === ']') && depth > 0) {
      depth -= 1;
    }
  }
  return depth;
}

function getNextSignificantLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function updateBraceKinds(braceKinds, previousSignificant, line) {
  const tokens = tokenizeCode(stripTrailingComment(line).code);
  for (const token of tokens) {
    if (token.value === '}') {
      braceKinds.pop();
    }
  }
  for (const token of tokens) {
    if (token.value === '{') {
      if (isFunctionSignature(previousSignificant)) {
        braceKinds.push('function');
      } else if (isTypeSignature(previousSignificant)) {
        braceKinds.push('type');
      } else {
        braceKinds.push('block');
      }
    }
  }
}

function formatPreprocessorLine(line, depth) {
  const body = line.slice(1).trim();
  const parts = body.split(/\s+/);
  const directive = parts.shift() || '';
  let indent = depth;
  if (['else', 'elif', 'endif'].includes(directive)) {
    indent = Math.max(0, indent - 1);
  }
  const content = parts.join(' ');
  let nextDepth = depth;
  if (['if', 'ifdef', 'ifndef', 'else', 'elif'].includes(directive)) {
    nextDepth = indent + 1;
  } else if (directive === 'endif') {
    nextDepth = indent;
  }
  return {
    line: `#${' '.repeat(indent)}${directive}${content ? ` ${content}` : ''}`.trimEnd(),
    nextDepth
  };
}

function formatCodeLine(line) {
  const { code, comment } = stripTrailingComment(line);
  const tokens = tokenizeCode(code);
  let rendered = renderTokens(tokens);
  rendered = normalizeTypeAliasLine(rendered);
  rendered = normalizeFunctionSignature(rendered);
  rendered = alignDeclaration(rendered);
  rendered = compactCastPointerSpacing(rendered);
  rendered = compactCastDereferenceSpacing(rendered);
  if (comment) {
    rendered = rendered ? `${rendered} ${comment.trim()}` : comment.trim();
  }
  return rendered.trim();
}

function stripTrailingComment(line) {
  let state = 'code';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1] || '';
    if (state === 'string') {
      if (char === '\\' && next) {
        index += 1;
        continue;
      }
      if (char === '"') {
        state = 'code';
      }
      continue;
    }
    if (state === 'char') {
      if (char === '\\' && next) {
        index += 1;
        continue;
      }
      if (char === '\'') {
        state = 'code';
      }
      continue;
    }
    if (char === '"') {
      state = 'string';
      continue;
    }
    if (char === '\'') {
      state = 'char';
      continue;
    }
    if (char === '/' && next === '/') {
      return {
        code: line.slice(0, index).trimEnd(),
        comment: line.slice(index)
      };
    }
  }
  return { code: line.trimEnd(), comment: '' };
}

function tokenizeCode(code) {
  const tokens = [];
  let index = 0;

  while (index < code.length) {
    const char = code[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const triple = code.slice(index, index + 3);
    const double = code.slice(index, index + 2);
    if (MULTI_CHAR_OPERATORS.includes(triple)) {
      tokens.push({ type: 'operator', value: triple });
      index += 3;
      continue;
    }
    if (MULTI_CHAR_OPERATORS.includes(double)) {
      tokens.push({ type: 'operator', value: double });
      index += 2;
      continue;
    }
    if (char === '"' || char === '\'') {
      const quote = char;
      let value = quote;
      index += 1;
      while (index < code.length) {
        const current = code[index];
        value += current;
        if (current === '\\' && index + 1 < code.length) {
          value += code[index + 1];
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) {
          break;
        }
      }
      tokens.push({ type: 'literal', value });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let value = char;
      index += 1;
      while (index < code.length && /[A-Za-z0-9_]/.test(code[index])) {
        value += code[index];
        index += 1;
      }
      tokens.push({ type: 'word', value });
      continue;
    }
    if (/[0-9]/.test(char)) {
      let value = char;
      index += 1;
      while (index < code.length && /[A-Za-z0-9_.]/.test(code[index])) {
        value += code[index];
        index += 1;
      }
      tokens.push({ type: 'number', value });
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ type: 'punct', value: char });
      index += 1;
      continue;
    }
    if (SINGLE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }
    tokens.push({ type: 'other', value: char });
    index += 1;
  }

  return tokens;
}

function renderTokens(tokens) {
  if (!tokens.length) {
    return '';
  }
  if (tokens[0].type === 'word' && tokens[0].value === 'return') {
    return renderReturn(tokens);
  }
  if (
    tokens[0].type === 'word' &&
    KEYWORD_STATEMENTS_WITH_TRAILING_SPACE.has(tokens[0].value) &&
    tokens.length === 2 &&
    tokens[1].value === ';'
  ) {
    return `${tokens[0].value} ;`;
  }

  let output = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const prev = previousToken(tokens, index);

    if (token.value === ',') {
      output = trimRight(output);
      output += ', ';
      continue;
    }
    if (token.value === ';') {
      output = trimRight(output);
      output += ';';
      continue;
    }
    if (token.value === '(' || token.value === '[') {
      const hadTrailingSpace = output.endsWith(' ');
      if (!hadTrailingSpace) {
        output = trimRight(output);
      }
      if (token.value === '(' && prev && prev.type === 'word' && SPACE_BEFORE_PAREN_KEYWORDS.has(prev.value) && !output.endsWith(' ')) {
        output += ' ';
      }
      output += token.value;
      continue;
    }
    if (token.value === ')' || token.value === ']') {
      output = trimRight(output);
      output += token.value;
      continue;
    }
    if (token.value === '{' || token.value === '}') {
      output = trimRight(output);
      output += token.value;
      continue;
    }
    if (token.type === 'operator') {
      if (token.value === '.' || token.value === '->') {
        output = trimRight(output);
        output += token.value;
        continue;
      }
      if (isUnaryOperator(token, prev)) {
        if (!output.endsWith(' ')) {
          output = trimRight(output);
        }
        output += token.value;
        continue;
      }
      output = trimRight(output);
      output += ` ${token.value} `;
      continue;
    }

    const prevPrev = index > 1 ? tokens[index - 2] : null;
    const prevIsPrefixUnary = prev && prev.type === 'operator' && isUnaryOperator(prev, prevPrev);
    const needsSpace = Boolean(
      output &&
      !output.endsWith(' ') &&
      !output.endsWith('(') &&
      !output.endsWith('[') &&
      !output.endsWith('{') &&
      prev &&
      prev.value !== '.' &&
      prev.value !== '->' &&
      !prevIsPrefixUnary
    );
    output += needsSpace ? ` ${token.value}` : token.value;
  }
  return trimRight(output);
}

function renderReturn(tokens) {
  const rest = tokens.slice(1).filter((token) => token.value !== ';');
  if (!rest.length) {
    return 'return ;';
  }
  const expression = renderTokens(rest);
  if (expression.startsWith('(') && expression.endsWith(')')) {
    return `return ${expression};`;
  }
  return `return (${expression});`;
}

function previousToken(tokens, index) {
  return index > 0 ? tokens[index - 1] : null;
}

function isUnaryOperator(token, prev) {
  if (['++', '--', '!', '~'].includes(token.value)) {
    return true;
  }
  if (!['+', '-', '*', '&'].includes(token.value)) {
    return false;
  }
  if (!prev) {
    return true;
  }
  if (prev.type === 'word' && prev.value === 'return') {
    return true;
  }
  if (prev.type === 'operator') {
    return prev.value !== ')' && prev.value !== ']';
  }
  return ['(', '[', '{', ',', ';', '?', ':'].includes(prev.value);
}

function trimRight(text) {
  return text.replace(/\s+$/g, '');
}

function parseFunctionSignature(line) {
  if (!line || /^(if|while|for|else|return)\b/.test(line)) {
    return null;
  }
  const signatureMatch = line.match(/^(.+?)\s*\((.*)\)(\s*;)?$/);
  if (!signatureMatch) {
    return null;
  }
  const headMatch = signatureMatch[1].match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*)\s+([*&\s]*)([A-Za-z_]\w*)$/);
  if (!headMatch) {
    return null;
  }
  const typeHead = headMatch[1].trim().split(/\s+/);
  if (!isTypeHeadTokens(typeHead)) {
    return null;
  }
  return {
    returnType: headMatch[1],
    pointer: (headMatch[2] || '').replace(/\s+/g, ''),
    name: headMatch[3],
    params: signatureMatch[2],
    trailer: signatureMatch[3] || ''
  };
}

function normalizeTypeAliasLine(line) {
  const match = line.match(/^\}\s+([A-Za-z_]\w*)\s*;$/);
  if (!match) {
    return line;
  }
  return `}\t${match[1]};`;
}

function normalizeFunctionSignature(line) {
  const signature = parseFunctionSignature(line);
  if (!signature) {
    return line;
  }
  const params = normalizeParameterList(signature.params);
  return `${signature.returnType}\t${signature.pointer}${signature.name}(${params})${signature.trailer}`;
}

function normalizeParameterList(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return 'void';
  }
  return splitTopLevelByComma(text)
    .map((segment) => normalizeParameter(segment))
    .join(', ');
}

function splitTopLevelByComma(text) {
  const segments = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
      segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

function normalizeParameter(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'void' || trimmed === '...') {
    return trimmed;
  }

  const functionPointer = parseFunctionPointerDeclarator(trimmed);
  if (functionPointer) {
    const returnPointer = functionPointer.returnPointer
      ? ` ${functionPointer.returnPointer}`
      : ' ';
    return `${functionPointer.type}${returnPointer}(${functionPointer.pointer}${functionPointer.name})${compactPointerSpacing(functionPointer.suffix)}`;
  }

  const simpleMatch = trimmed.match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*)\s+([*&\s]+)([A-Za-z_]\w*)(.*)$/);
  if (!simpleMatch || !isTypeHeadTokens(simpleMatch[1].split(/\s+/))) {
    return trimmed.replace(/\s+/g, ' ');
  }
  const pointer = simpleMatch[2].replace(/\s+/g, '');
  const suffix = compactPointerSpacing(simpleMatch[4]);
  return `${simpleMatch[1]} ${pointer}${simpleMatch[3]}${suffix}`;
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

function parseFunctionPointerDeclarator(line) {
  const match = line.match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*?)(?:\s+([*&]+))?\s*\(\s*([*&]+)\s*([A-Za-z_]\w*)\s*\)(.*)$/);
  if (!match || !isTypeHeadTokens(match[1].split(/\s+/))) {
    return null;
  }
  return {
    type: match[1],
    returnPointer: match[2] || '',
    pointer: match[3],
    name: match[4],
    suffix: match[5]
  };
}

function alignDeclaration(line) {
  const functionPointer = parseFunctionPointerDeclarator(line);
  if (functionPointer) {
    const suffix = compactPointerSpacing(functionPointer.suffix);
    return `${functionPointer.type}\t${functionPointer.returnPointer}(${functionPointer.pointer}${functionPointer.name})${suffix}`;
  }

  const simpleMatch = line.match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*)\s+([*&\s]*)([A-Za-z_]\w*)(.*)$/);
  if (!simpleMatch) {
    return line;
  }
  const headTokens = simpleMatch[1].split(/\s+/);
  if (!isTypeHeadTokens(headTokens) || CONTROL_KEYWORDS.has(headTokens[0])) {
    return line;
  }
  const prefix = simpleMatch[1];
  const pointer = (simpleMatch[2] || '').replace(/\s+/g, '');
  let suffix = simpleMatch[4] || '';
  const suffixTrimmed = suffix.trim();
  if (!suffixTrimmed || suffixTrimmed.startsWith('(')) {
    return line;
  }
  if (/^\(\s*\)(?!\s*=)/.test(suffix) && /[;)]?$/.test(suffix)) {
    suffix = suffix.replace(/^\(\s*\)/, '(void)');
  }
  suffix = compactPointerSpacing(suffix);
  return `${prefix}\t${pointer}${simpleMatch[3]}${suffix}`;
}

function compactPointerSpacing(text) {
  return text.replace(/([*&]+)\s+([A-Za-z_]\w*)/g, '$1$2');
}

function compactCastPointerSpacing(text) {
  return text.replace(/\(([^()]*?)\)/g, (match, inner) => {
    const normalized = normalizeParenthesizedPointerType(inner);
    if (!normalized) {
      return match;
    }
    return `(${normalized})`;
  });
}

function compactCastDereferenceSpacing(text) {
  return text.replace(/\(([^()]*?)\)\s+\*\s+([A-Za-z_]\w*)/g, (match, inner, identifier) => {
    const tokens = tokenizeCode(inner.trim());
    const pointerIndex = tokens.findIndex((token) => token.type === 'operator');
    const head = pointerIndex < 0 ? tokens : tokens.slice(0, pointerIndex);
    const tail = pointerIndex < 0 ? [] : tokens.slice(pointerIndex);
    if (
      !head.length ||
      !head.every((token) => token.type === 'word') ||
      !isTypeHeadTokens(head.map((token) => token.value)) ||
      !tail.every((token) => token.type === 'operator' && token.value === '*')
    ) {
      return match;
    }
    const typeName = head.map((token) => token.value).join(' ');
    const castPointer = tail.length ? ` ${'*'.repeat(tail.length)}` : '';
    return `(${typeName}${castPointer})*${identifier}`;
  });
}

function normalizeParenthesizedPointerType(inner) {
  const tokens = tokenizeCode(inner.trim());
  const pointerIndex = tokens.findIndex((token) => token.type === 'operator' && token.value === '*');
  if (pointerIndex <= 0) {
    return '';
  }
  const head = tokens.slice(0, pointerIndex);
  const tail = tokens.slice(pointerIndex);
  if (!head.every((token) => token.type === 'word')) {
    return '';
  }
  if (!isTypeHeadTokens(head.map((token) => token.value))) {
    return '';
  }
  const typeName = head.map((token) => token.value).join(' ');
  if (tail.every((token) => token.type === 'operator' && token.value === '*')) {
    return `${typeName} ${'*'.repeat(tail.length)}`;
  }
  if (tail[tail.length - 1].type !== 'word') {
    return '';
  }
  if (!tail.slice(0, -1).every((token) => token.type === 'operator' && token.value === '*')) {
    return '';
  }
  return `${typeName} ${'*'.repeat(tail.length - 1)}${tail[tail.length - 1].value}`;
}

function alignDeclarationBlock(entries) {
  const parsed = entries.map((entry) => {
    const splitIndex = entry.code.indexOf('\t');
    if (splitIndex < 0) {
      return null;
    }
    return {
      indent: entry.indent,
      prefix: entry.code.slice(0, splitIndex),
      rest: entry.code.slice(splitIndex + 1)
    };
  });

  const targetColumn = parsed.reduce((max, item, index) => {
    if (!item) {
      return max;
    }
    const currentColumn = entries[index].indent * 4 + item.prefix.length;
    return Math.max(max, nextTabStop(currentColumn));
  }, 0);

  return entries.map((entry, index) => {
    const item = parsed[index];
    if (!item) {
      return `${'\t'.repeat(entry.indent)}${entry.code}`;
    }
    const currentColumn = entry.indent * 4 + item.prefix.length;
    const tabsNeeded = Math.max(1, Math.ceil((targetColumn - currentColumn) / 4));
    return `${'\t'.repeat(entry.indent)}${item.prefix}${'\t'.repeat(tabsNeeded)}${item.rest}`;
  });
}

function nextTabStop(column) {
  return column + (4 - (column % 4));
}

function stripExistingHeader(source) {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const headerMatch = normalized.match(HEADER_REGEX);
  if (!headerMatch) {
    return {
      body: normalized,
      createdAt: null
    };
  }
  const createdMatch = headerMatch[0].match(/Created:\s+([0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}) by /);
  return {
    body: normalized.slice(headerMatch[0].length),
    createdAt: createdMatch ? createdMatch[1] : null
  };
}

function normalizeHeaderProtection(source, fileName) {
  if (!fileName || path.extname(fileName).toLowerCase() !== '.h') {
    return source;
  }
  const macro = buildHeaderGuardMacro(fileName);
  return source.replace(
    /^#ifndef\s+[A-Za-z0-9_]+\n#\s*define\s+[A-Za-z0-9_]+/,
    `#ifndef ${macro}\n# define ${macro}`
  );
}

function buildHeaderGuardMacro(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  const macro = base.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return macro.endsWith('_H') ? macro : `${macro}_H`;
}

function build42Header(options) {
  const fileName = path.basename(options.fileName || 'untitled.c');
  const username = options.username;
  const email = options.email;

  return [
    `/* ${'*'.repeat(74)} */`,
    headerLine('', ''),
    headerLine('', ':::      ::::::::   '),
    headerLine(`  ${fileName}`, ':+:      :+:    :+:   '),
    headerLine('', '+:+ +:+         +:+     '),
    headerLine(`  By: ${username} <${email}>`, '#+#  +:+       +#+        '),
    headerLine('', ' +#+#+#+#+#+   +#+           '),
    headerLine(`  Created: ${options.createdAt} by ${username}`, '#+#    #+#             '),
    headerLine(`  Updated: ${options.updatedAt} by ${username}`, '###   ########.fr       '),
    headerLine('', ''),
    `/* ${'*'.repeat(74)} */`
  ].join('\n');
}

function headerLine(left, right) {
  const innerWidth = 74;
  const safeRight = right || '';
  const maxLeft = Math.max(0, innerWidth - safeRight.length);
  const safeLeft = (left || '').slice(0, maxLeft);
  return `/* ${safeLeft}${' '.repeat(maxLeft - safeLeft.length)}${safeRight} */`;
}

function formatTimestamp(date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join('/') + ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function resolveHeaderEmail(username, email) {
  if (email && email.trim()) {
    return email.trim();
  }
  return `${username}@student.42tokyo.jp`;
}

function isDeclarationLine(line) {
  if (!line.endsWith(';')) {
    return false;
  }
  if (line.startsWith('return') || line.startsWith('if ') || line.startsWith('while ') || line.startsWith('else')) {
    return false;
  }
  if (parseFunctionSignature(line)) {
    return false;
  }
  const simpleMatch = line.match(/^([A-Za-z_][\w]*(?:\s+[A-Za-z_][\w]*)*)\s+([*&\s]*)([A-Za-z_]\w*)(.*)$/);
  if (!simpleMatch) {
    return false;
  }
  return isTypeHeadTokens(simpleMatch[1].split(/\s+/));
}

function isFunctionPrototypeLine(line) {
  const signature = parseFunctionSignature(line);
  return Boolean(signature && signature.trailer.trim() === ';');
}

function isFunctionSignature(line) {
  const signature = parseFunctionSignature(line);
  if (!signature) {
    return false;
  }
  return !signature.trailer;
}

function isTypeSignature(line) {
  if (!line) {
    return false;
  }
  return /^(typedef\s+)?(struct|union|enum)\b/.test(line) && !line.endsWith(';');
}

function getAlignmentGroup(line, context) {
  if (context.insideType && isDeclarationLine(line)) {
    return 'typeDecl';
  }
  if (context.insideFunction && isDeclarationLine(line)) {
    return 'funcDecl';
  }
  if (!context.insideFunction && !context.insideType) {
    if (isFunctionPrototypeLine(line)) {
      return 'prototype';
    }
    if (isDeclarationLine(line)) {
      return 'globalDecl';
    }
  }
  return '';
}

function isSingleControlLine(line, nextLine) {
  if (!(line.startsWith('if ') || line.startsWith('while ') || line.startsWith('for ') || line === 'else' || line.startsWith('else if '))) {
    return false;
  }
  return nextLine !== '{';
}

function isControlHeader(line) {
  return line.startsWith('if ') || line.startsWith('while ') || line.startsWith('for ') || line === 'else' || line.startsWith('else if ');
}

module.exports = {
  formatDocumentText,
  formatText
};
