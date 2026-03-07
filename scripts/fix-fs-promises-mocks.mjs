import fs from 'fs';
import path from 'path';

function fixModuleMock(content, mod) {
  const needle = `vi.mock('${mod}', () => ({`;
  let idx = content.indexOf(needle);
  let modified = false;

  while (idx !== -1) {
    const arrowIdx = content.indexOf('({', idx + 10);
    if (arrowIdx === -1) break;

    let depth = 0;
    let i = arrowIdx;
    let closeIdx = -1;
    while (i < content.length) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
      i++;
    }
    if (closeIdx === -1) break;

    const rest = content.substring(closeIdx + 1);
    const cm = rest.match(/^\s*\)\s*\)\s*;?/);
    if (!cm) break;

    const endIdx = closeIdx + 1 + cm[0].length;
    const body = content.substring(arrowIdx + 2, closeIdx);
    const lineStart = content.lastIndexOf('\n', idx) + 1;
    const indent = (content.substring(lineStart, idx).match(/^(\s*)/) || ['', ''])[1];

    const repl = `vi.mock('${mod}', () => {\n` +
      `${indent}  const impl = {${body}};\n` +
      `${indent}  return { ...impl, default: impl };\n` +
      `${indent}});`;

    content = content.substring(0, idx) + repl + content.substring(endIdx);
    modified = true;
    idx = content.indexOf(needle, idx + repl.length);
  }

  return { content, modified };
}

// Fix require() → import for mocked modules
function fixRequireToImport(content) {
  let modified = false;
  const lines = content.split('\n');
  const newLines = [];
  const importsToAdd = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern: const fs = require('fs');
    const defaultReqMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\('(fs|fs\/promises|child_process|crypto)'\)\s*;?\s*$/);
    if (defaultReqMatch) {
      const [, indent, varName, mod] = defaultReqMatch;
      // Check if this module is mocked
      if (content.includes(`vi.mock('${mod}'`)) {
        importsToAdd.push(`import ${varName} from '${mod}';`);
        newLines.push(`${indent}// ${line.trim()} -- replaced by import above`);
        modified = true;
        continue;
      }
    }

    // Pattern: const { x } = require('module');
    const namedReqMatch = line.match(/^(\s*)const\s+\{([^}]+)\}\s*=\s*require\('(fs|fs\/promises|child_process|crypto)'\)\s*;?\s*$/);
    if (namedReqMatch) {
      const [, indent, vars, mod] = namedReqMatch;
      if (content.includes(`vi.mock('${mod}'`)) {
        importsToAdd.push(`import { ${vars.trim()} } from '${mod}';`);
        newLines.push(`${indent}// ${line.trim()} -- replaced by import above`);
        modified = true;
        continue;
      }
    }

    // Pattern: const x = require('fs').promises;
    const promisesReqMatch = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\('fs'\)\.promises\s*;?\s*$/);
    if (promisesReqMatch) {
      const [, indent, varName] = promisesReqMatch;
      if (content.includes("vi.mock('fs'")) {
        importsToAdd.push(`import { promises as ${varName} } from 'fs';`);
        newLines.push(`${indent}// ${line.trim()} -- replaced by import above`);
        modified = true;
        continue;
      }
    }

    newLines.push(line);
  }

  if (modified && importsToAdd.length > 0) {
    content = newLines.join('\n');
    // Add imports after the last existing import statement
    const importLines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < importLines.length; i++) {
      if (importLines[i].match(/^import\s/)) lastImportIdx = i;
    }
    if (lastImportIdx >= 0) {
      importLines.splice(lastImportIdx + 1, 0, ...importsToAdd);
    } else {
      importLines.unshift(...importsToAdd);
    }
    content = importLines.join('\n');
  }

  return { content, modified };
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

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let fileModified = false;

  // Fix fs/promises mock default
  for (const mod of ['fs/promises', 'child_process']) {
    const result = fixModuleMock(content, mod);
    if (result.modified) {
      content = result.content;
      fileModified = true;
    }
  }

  // Fix require → import
  const reqResult = fixRequireToImport(content);
  if (reqResult.modified) {
    content = reqResult.content;
    fileModified = true;
  }

  if (fileModified) {
    fs.writeFileSync(file, content, 'utf8');
    count++;
    console.log(`Fixed: ${file}`);
  }
}

console.log(`\nTotal fixed: ${count}`);
