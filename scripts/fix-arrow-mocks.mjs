import fs from 'fs';
import path from 'path';

/**
 * Fix arrow functions in mockImplementation that are used as constructors.
 *
 * Patterns fixed:
 * 1. vi.fn().mockImplementation(() => ({...}))  →  vi.fn().mockImplementation(function() { return {...}; })
 * 2. vi.fn(() => ({...}))  →  vi.fn(function() { return {...}; })
 * 3. (X as Mock).mockImplementation(() => ({...}))  →  (X as Mock).mockImplementation(function() { return {...}; })
 *
 * Only inside vi.mock() factory blocks, where mocks are likely constructors.
 */

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Pattern 1: .mockImplementation(() => ({...}))
  // Replace with .mockImplementation(function() { return {...}; })
  {
    const pattern = /\.mockImplementation\(\(\) => \(\{/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const startIdx = match.index;
      // Find the arrow start: () => ({
      const arrowStart = content.indexOf('({', startIdx + '.mockImplementation('.length);
      if (arrowStart === -1) continue;

      // Find matching closing })
      let depth = 0;
      let i = arrowStart;
      let closeObjIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { closeObjIdx = i; break; }
        }
        i++;
      }
      if (closeObjIdx === -1) continue;

      // Check for closing ))  after })
      const afterObj = content.substring(closeObjIdx + 1).trimStart();
      if (!afterObj.startsWith(')')) continue;

      // The object body
      const objBody = content.substring(arrowStart + 1, closeObjIdx + 1); // ({...})

      // Build replacement
      const before = content.substring(0, startIdx);
      const closeParen = content.indexOf(')', closeObjIdx + 1);
      const after = content.substring(closeParen + 1);

      content = before + `.mockImplementation(function() { return ${objBody}; })` + after;
      modified = true;
      // Reset regex since content changed
      pattern.lastIndex = 0;
    }
  }

  // Pattern 2: .mockImplementation(() => {\n...return...})
  // These arrow functions with block bodies - just replace () => { with function() {
  {
    // This is trickier - multi-line. Replace the arrow with function keyword.
    const simplePattern = /\.mockImplementation\(\(\) => \{/g;
    if (simplePattern.test(content)) {
      content = content.replace(/\.mockImplementation\(\(\) => \{/g, '.mockImplementation(function() {');
      modified = true;
    }
  }

  // Pattern 3: vi.fn(() => ({...})) inside vi.mock factories
  // Only fix these inside vi.mock() blocks
  {
    const pattern = /vi\.fn\(\(\) => \(\{/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const startIdx = match.index;
      const arrowStart = content.indexOf('({', startIdx + 'vi.fn('.length);
      if (arrowStart === -1) continue;

      let depth = 0;
      let i = arrowStart;
      let closeObjIdx = -1;
      while (i < content.length) {
        if (content[i] === '{') depth++;
        else if (content[i] === '}') {
          depth--;
          if (depth === 0) { closeObjIdx = i; break; }
        }
        i++;
      }
      if (closeObjIdx === -1) continue;

      const afterObj = content.substring(closeObjIdx + 1).trimStart();
      if (!afterObj.startsWith(')')) continue;

      const objBody = content.substring(arrowStart + 1, closeObjIdx + 1);
      const before = content.substring(0, startIdx);
      const closeParen = content.indexOf(')', closeObjIdx + 1);
      const after = content.substring(closeParen + 1);

      content = before + `vi.fn(function() { return ${objBody}; })` + after;
      modified = true;
      pattern.lastIndex = 0;
    }
  }

  // Pattern 4: .mockImplementation(() => result) where result is not ({
  // (e.g., .mockImplementation(() => null) ) - these are usually fine
  // Skip these

  // Pattern 5: (X as Mock).mockImplementation(() => ({...}))
  // Already covered by Pattern 1

  // Pattern 6: require('events') inside vi.mock factories → import
  if (content.includes("require('events')") && content.includes('vi.mock(')) {
    content = content.replace(
      /const\s+EventEmitter\s*=\s*require\('events'\);?/g,
      "const { EventEmitter } = await import('events');"
    );
    // If we added await import, ensure the factory is async
    content = content.replace(
      /vi\.mock\(([^,]+),\s*\(\)\s*=>\s*\{([\s\S]*?)await import/g,
      'vi.mock($1, async () => {$2await import'
    );
    modified = true;
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

const files = walkDir('tests');
let count = 0;

for (const file of files) {
  try {
    if (fixFile(file)) {
      count++;
      console.log(`Fixed: ${path.relative('.', file)}`);
    }
  } catch (e) {
    console.error(`Error in ${file}: ${e.message}`);
  }
}

console.log(`\nTotal files fixed: ${count}`);
