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
        if (depth === 0) {
          closeIdx = i;
          break;
        }
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
    const indentMatch = content.substring(lineStart, idx).match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';

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

  for (const mod of ['fs', 'path', 'react']) {
    const result = fixModuleMock(content, mod);
    if (result.modified) {
      content = result.content;
      fileModified = true;
    }
  }

  if (fileModified) {
    fs.writeFileSync(file, content, 'utf8');
    count++;
    console.log(`Fixed: ${file}`);
  }
}

console.log(`\nTotal fixed: ${count}`);
