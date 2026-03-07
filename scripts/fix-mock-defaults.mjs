import fs from 'fs';
import path from 'path';

const MODULES_NEEDING_DEFAULT = ['crypto', 'chalk', 'os', 'fs-extra', 'react'];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const mod of MODULES_NEEDING_DEFAULT) {
    const escaped = escapeRegex(mod);
    const pattern = new RegExp(
      `vi\\.mock\\('${escaped}'\\s*,\\s*\\(\\)\\s*=>\\s*\\(\\{`
    );

    while (pattern.test(content)) {
      const startMatch = content.match(pattern);
      if (!startMatch) break;

      const startIdx = startMatch.index;
      const arrowIdx = content.indexOf('({', startIdx + 10);
      if (arrowIdx === -1) break;

      // Find matching closing })
      let depth = 0;
      let i = arrowIdx;
      let endIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) {
            const rest = content.substring(i + 1).trimStart();
            if (rest.startsWith(')')) {
              // Find the full )); ending
              const closeParenIdx = content.indexOf(')', i + 1);
              const semiIdx = content.indexOf(';', closeParenIdx);
              endIdx = content.indexOf(')', closeParenIdx + 1);
              if (endIdx !== -1) {
                // Check for semicolon
                const afterClose = content.substring(endIdx + 1).trimStart();
                if (afterClose.startsWith(';')) {
                  endIdx = content.indexOf(';', endIdx + 1) + 1;
                } else {
                  endIdx = endIdx + 1;
                }
              }
              break;
            }
          }
        }
        i++;
      }

      if (endIdx === -1) break;

      const bodyStart = arrowIdx + 2;
      const bodyEnd = i;
      const mockBody = content.substring(bodyStart, bodyEnd);

      const lineStart = content.lastIndexOf('\n', startIdx) + 1;
      const indent = content.substring(lineStart, startIdx).match(/^\s*/)[0];

      const replacement = `vi.mock('${mod}', () => {\n` +
        `${indent}  const impl = {${mockBody}};\n` +
        `${indent}  return { ...impl, default: impl };\n` +
        `${indent}});`;

      content = content.substring(0, startIdx) + replacement + content.substring(endIdx);
      modified = true;
    }
  }

  if (modified) {
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

const testsDir = path.resolve('tests');
const files = walkDir(testsDir);
let totalFixed = 0;

for (const file of files) {
  try {
    if (fixFile(file)) {
      totalFixed++;
      console.log(`Fixed: ${path.relative('.', file)}`);
    }
  } catch (e) {
    console.error(`Error in ${file}: ${e.message}`);
  }
}

console.log(`\nTotal files fixed: ${totalFixed}`);
