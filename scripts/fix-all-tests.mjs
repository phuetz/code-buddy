/**
 * Comprehensive test file fixer for Vitest ESM compatibility.
 *
 * Fixes applied IN ORDER:
 * 1. jest.setTimeout → vi.setConfig
 * 2. vi.setTimeout → vi.setConfig
 * 3. vi.requireActual → await vi.importActual
 * 4. Add `default` export to mock factories for Node built-ins
 * 5. Replace `require()` with `import` for mocked modules
 * 6. Convert arrow functions → regular functions in mockImplementation (for constructors)
 * 7. Fix jest.requireMock → extract mock objects before vi.mock
 * 8. Fix vi.mock factories that don't return objects (ws, marked-terminal, etc.)
 */

import fs from 'fs';
import path from 'path';

const BUILTIN_MODULES = ['crypto', 'chalk', 'os', 'path', 'react', 'fs-extra', 'fs', 'fs/promises'];

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // === Fix 1: jest.setTimeout / vi.setTimeout → vi.setConfig ===
  content = content.replace(
    /(?:jest|vi)\.setTimeout\((\d+)\)\s*;?/g,
    'vi.setConfig({ testTimeout: $1 });'
  );

  // === Fix 2: vi.requireActual → await vi.importActual ===
  content = content.replace(
    /(?:jest|vi)\.requireActual(<[^>]*>)?\(/g,
    'await vi.importActual$1('
  );

  // === Fix 3: Add `default` to mock factories for built-in modules ===
  for (const mod of BUILTIN_MODULES) {
    const needle = `mock('${mod}', () => ({`;
    let idx = content.indexOf(needle);

    while (idx !== -1) {
      // Find the ({ opening
      const arrowIdx = content.indexOf('({', idx + 10);
      if (arrowIdx === -1) break;

      // Find matching closing })
      let depth = 0, i = arrowIdx, closeIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
        i++;
      }
      if (closeIdx === -1) break;

      // Check for closing )); or ))
      const rest = content.substring(closeIdx + 1);
      const cm = rest.match(/^(\s*\)\s*\)\s*;?)/);
      if (!cm) break;

      const endIdx = closeIdx + 1 + cm[1].length;
      const body = content.substring(arrowIdx + 2, closeIdx);
      const lineStart = content.lastIndexOf('\n', idx) + 1;
      const indent = (content.substring(lineStart, idx).match(/^(\s*)/) || ['', ''])[1];

      // Detect if this is jest.mock or vi.mock
      const mockPrefix = content.substring(idx - 5, idx).includes('jest') ? 'jest' : 'vi';

      const repl = `mock('${mod}', () => {\n` +
        `${indent}  const impl = {${body}};\n` +
        `${indent}  return { ...impl, default: impl };\n` +
        `${indent}});`;

      content = content.substring(0, idx) + repl + content.substring(endIdx);
      idx = content.indexOf(needle, idx + repl.length);
    }
  }

  // === Fix 4: Replace require() with import for mocked modules ===
  const lines = content.split('\n');
  const newLines = [];
  const importsToAdd = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // const { x } = require('module');
    const namedMatch = line.match(/^(\s*)const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(\s*'(child_process|crypto|fs|os|path)'\s*\)\s*;?\s*$/);
    if (namedMatch && content.includes(`mock('${namedMatch[3]}'`)) {
      const [, , vars, mod] = namedMatch;
      importsToAdd.push(`import { ${vars.trim()} } from '${mod}';`);
      newLines.push(`// ${line.trim()} -- replaced by import`);
      continue;
    }

    // const x = require('module');
    const defaultMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*'(child_process|crypto|fs|os|path)'\s*\)\s*;?\s*$/);
    if (defaultMatch && content.includes(`mock('${defaultMatch[3]}'`)) {
      const [, , varName, mod] = defaultMatch;
      importsToAdd.push(`import ${varName} from '${mod}';`);
      newLines.push(`// ${line.trim()} -- replaced by import`);
      continue;
    }

    // const x = require('module').property;
    const propMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*'(child_process|crypto|fs)'\s*\)\.(\w+)\s*(as\s+[^;]+)?\s*;?\s*$/);
    if (propMatch && content.includes(`mock('${propMatch[3]}'`)) {
      const [, , varName, mod, prop] = propMatch;
      importsToAdd.push(`import { ${prop} } from '${mod}';`);
      // Replace usage of varName with vi.mocked(prop)
      newLines.push(`const ${varName} = vi.mocked(${prop});`);
      continue;
    }

    // const fs = require('fs'); (for mocked fs)
    const fsMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*'(fs\/promises)'\s*\)\s*;?\s*$/);
    if (fsMatch && content.includes(`mock('${fsMatch[3]}'`)) {
      const [, , varName] = fsMatch;
      importsToAdd.push(`import * as ${varName} from 'fs/promises';`);
      newLines.push(`// ${line.trim()} -- replaced by import`);
      continue;
    }

    newLines.push(line);
  }

  if (importsToAdd.length > 0) {
    content = newLines.join('\n');
    // Add imports after last existing import
    const allLines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].match(/^import\s/)) lastImportIdx = i;
    }
    if (lastImportIdx >= 0) {
      allLines.splice(lastImportIdx + 1, 0, ...importsToAdd);
    } else {
      allLines.unshift(...importsToAdd);
    }
    content = allLines.join('\n');
  }

  // === Fix 5: Arrow → function in mockImplementation (for constructors) ===
  // Pattern: .mockImplementation(() => ({...}))
  {
    const pattern = /\.mockImplementation\(\s*\(\)\s*=>\s*\(\{/g;
    let match;
    let iterations = 0;
    while ((match = pattern.exec(content)) !== null && iterations < 500) {
      iterations++;
      const startIdx = match.index;
      const arrowIdx = content.indexOf('({', startIdx + 20);
      if (arrowIdx === -1) continue;

      let depth = 0, i = arrowIdx, closeIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
        i++;
      }
      if (closeIdx === -1) continue;

      const afterObj = content.substring(closeIdx + 1).trimStart();
      if (!afterObj.startsWith(')')) continue;

      const objBody = content.substring(arrowIdx + 1, closeIdx + 1); // ({...})
      const closeParen = content.indexOf(')', closeIdx + 1);
      const before = content.substring(0, startIdx);
      const after = content.substring(closeParen + 1);

      content = before + `.mockImplementation(function() { return ${objBody}; })` + after;
      pattern.lastIndex = 0; // Reset regex
    }
  }

  // Pattern: .mockImplementation(() => { ... }) — block body
  content = content.replace(
    /\.mockImplementation\(\s*\(\)\s*=>\s*\{/g,
    '.mockImplementation(function() {'
  );

  // Pattern: .mockImplementation(() => someVar) — returning a variable
  content = content.replace(
    /\.mockImplementation\(\s*\(\)\s*=>\s*(mock\w+|null)\s*\)/g,
    '.mockImplementation(function() { return $1; })'
  );

  // Pattern: jest.fn(() => ({...})) — shorthand constructor mock
  {
    const pattern = /(?:jest|vi)\.fn\(\s*\(\)\s*=>\s*\(\{/g;
    let match;
    let iterations = 0;
    while ((match = pattern.exec(content)) !== null && iterations < 500) {
      iterations++;
      const startIdx = match.index;
      const fnName = content.substring(startIdx, startIdx + 4) === 'jest' ? 'jest' : 'vi';
      const arrowIdx = content.indexOf('({', startIdx + 5);
      if (arrowIdx === -1) continue;

      let depth = 0, i = arrowIdx, closeIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
        i++;
      }
      if (closeIdx === -1) continue;

      const afterObj = content.substring(closeIdx + 1).trimStart();
      if (!afterObj.startsWith(')')) continue;

      const objBody = content.substring(arrowIdx + 1, closeIdx + 1);
      const closeParen = content.indexOf(')', closeIdx + 1);
      const before = content.substring(0, startIdx);
      const after = content.substring(closeParen + 1);

      content = before + `${fnName}.fn(function() { return ${objBody}; })` + after;
      pattern.lastIndex = 0;
    }
  }

  // Pattern: jest.fn(() => mockXyz) — returning a variable, might be constructor
  // Only fix if inside a mock factory (heuristic: preceded by key: )
  content = content.replace(
    /(\w+:\s*)(?:jest|vi)\.fn\(\s*\(\)\s*=>\s*(mock\w+)\s*\)/g,
    (match, prefix, varName) => {
      const fnName = match.includes('jest.fn') ? 'jest' : 'vi';
      return `${prefix}${fnName}.fn(function() { return ${varName}; })`;
    }
  );

  // === Fix 6: require('events') inside mock factories ===
  // Replace with top-level import
  if (content.includes("require('events')") || content.includes('require("events")')) {
    content = content.replace(
      /const\s+(?:\{\s*)?EventEmitter(?:\s*\})?\s*=\s*require\(\s*['"]events['"]\s*\)\s*;?/g,
      ''
    );
    // Add import at top if EventEmitter is used
    if (content.includes('EventEmitter') && !content.includes("import") || !content.includes("from 'events'")) {
      if (!content.includes("import { EventEmitter }") && !content.includes("import {EventEmitter}")) {
        const firstLine = content.indexOf('\n');
        content = `import { EventEmitter } from 'events';\n` + content;
      }
    }
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function walkDir(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !['_archived', 'node_modules'].includes(entry.name)) {
      files.push(...walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walkDir('tests');
let count = 0;
const errors = [];

for (const file of files) {
  try {
    if (fixFile(file)) {
      count++;
      console.log(`Fixed: ${path.relative('.', file)}`);
    }
  } catch (e) {
    errors.push(`${file}: ${e.message}`);
  }
}

console.log(`\nTotal files fixed: ${count}`);
if (errors.length > 0) {
  console.log(`\nErrors:`);
  errors.forEach(e => console.log(`  ${e}`));
}
