/**
 * Tests for Bug Finder Tool
 *
 * Validates regex-based pattern detection across multiple languages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  scanFile,
  scanDirectory,
  executeFindBugs,
  type BugReport,
} from '../../src/tools/bug-finder-tool.js';

const TEST_DIR = path.join(process.cwd(), '.test-bug-finder');

function writeTestFile(name: string, content: string): string {
  const filePath = path.join(TEST_DIR, name);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('Bug Finder - scanFile', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('returns empty for unsupported file types', () => {
    const file = writeTestFile('test.txt', 'eval("hello")');
    const bugs = scanFile(file);
    expect(bugs).toEqual([]);
  });

  it('detects eval() in TypeScript', () => {
    const file = writeTestFile('test.ts', 'const result = eval("1 + 1");');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('eval()'))).toBe(true);
  });

  it('detects innerHTML assignment', () => {
    const file = writeTestFile('test.ts', 'element.innerHTML = userInput;');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('innerHTML'))).toBe(true);
  });

  it('detects SQL injection via concatenation', () => {
    const file = writeTestFile('test.ts', `const query = "SELECT * FROM users WHERE id=" + userId;`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('SQL'))).toBe(true);
  });

  it('detects SQL injection via template literals', () => {
    const file = writeTestFile('test.ts', 'const query = `SELECT * FROM users WHERE id=${userId}`;');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('SQL'))).toBe(true);
  });

  it('detects hardcoded credentials', () => {
    const file = writeTestFile('test.ts', `const password = "my_secret_123";`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('credential'))).toBe(true);
  });

  it('detects setInterval without clearInterval', () => {
    const file = writeTestFile('test.ts', 'setInterval(() => console.log("tick"), 1000);');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'resource-leak' && b.message.includes('setInterval'))).toBe(true);
  });

  it('detects "as any" type assertion', () => {
    const file = writeTestFile('test.ts', 'const x = value as any;');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'type-error' && b.message.includes('as any'))).toBe(true);
  });

  it('detects @ts-ignore', () => {
    const file = writeTestFile('test.ts', `
// normal comment
// @ts-ignore
const x: string = 123;
`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'type-error' && b.message.includes('@ts-ignore'))).toBe(true);
  });

  it('detects NaN comparison', () => {
    const file = writeTestFile('test.ts', 'if (value === NaN) { }');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'logic-error' && b.message.includes('NaN'))).toBe(true);
  });

  it('detects document.write', () => {
    const file = writeTestFile('test.ts', 'document.write("<h1>Hello</h1>");');
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('document.write'))).toBe(true);
  });

  it('detects if(false) dead code', () => {
    const file = writeTestFile('test.ts', `if (false) { doSomething(); }`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'dead-code' && b.message.includes('always false'))).toBe(true);
  });

  it('detects if(true) redundant code', () => {
    const file = writeTestFile('test.ts', `if (true) { doSomething(); }`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'dead-code' && b.message.includes('always true'))).toBe(true);
  });

  it('skips comment lines', () => {
    const file = writeTestFile('test.ts', `
// eval("this is a comment")
/* eval("block comment") */
`);
    const bugs = scanFile(file);
    // eval in comments should not trigger security warning
    const evalBugs = bugs.filter(b => b.category === 'security' && b.message.includes('eval()'));
    expect(evalBugs.length).toBe(0);
  });

  it('respects severity filter', () => {
    const file = writeTestFile('test.ts', `
eval("danger");
const x = value as any;
if (false) { }
`);
    const criticalOnly = scanFile(file, 'critical');
    const allBugs = scanFile(file);

    expect(criticalOnly.length).toBeLessThanOrEqual(allBugs.length);
    expect(criticalOnly.every(b => b.severity === 'critical')).toBe(true);
  });

  it('returns correct line numbers', () => {
    const file = writeTestFile('test.ts', `line1
line2
eval("danger");
line4
`);
    const bugs = scanFile(file);
    const evalBug = bugs.find(b => b.message.includes('eval()'));
    expect(evalBug?.line).toBe(3);
  });

  it('deduplicates bugs on same line and category', () => {
    const file = writeTestFile('test.ts', `const result = eval("test");`);
    const bugs = scanFile(file);
    // Even if multiple patterns match eval on the same line,
    // deduplication should prevent duplicates
    const securityBugsLine1 = bugs.filter(
      b => b.line === 1 && b.category === 'security'
    );
    // Each category should appear at most once per line
    const categories = securityBugsLine1.map(b => b.category);
    const uniqueCategories = [...new Set(categories)];
    expect(categories.length).toBe(uniqueCategories.length);
  });

  // Python-specific patterns
  it('detects bare except in Python', () => {
    const file = writeTestFile('test.py', `try:
    do_something()
except:
    pass
`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'unchecked-error' && b.message.includes('Bare except'))).toBe(true);
  });

  it('detects global keyword in Python', () => {
    const file = writeTestFile('test.py', `def update():
    global counter
    counter += 1
`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'race-condition' && b.message.includes('Global variable'))).toBe(true);
  });

  // Go-specific patterns
  it('detects discarded error in Go', () => {
    const file = writeTestFile('test.go', `func main() {
    result, _ := doSomething()
}`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'unchecked-error' && b.message.includes('discarded'))).toBe(true);
  });

  // Rust-specific patterns
  it('detects .unwrap() in Rust', () => {
    const file = writeTestFile('test.rs', `fn main() {
    let value = some_option.unwrap();
}`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'unchecked-error' && b.message.includes('unwrap()'))).toBe(true);
  });

  it('detects unsafe block in Rust', () => {
    const file = writeTestFile('test.rs', `fn main() {
    unsafe {
        raw_ptr();
    }
}`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'security' && b.message.includes('Unsafe block'))).toBe(true);
  });

  // Java-specific patterns
  it('detects empty catch in Java', () => {
    const file = writeTestFile('Test.java', `class Test {
    void method() {
        try { doStuff(); }
        catch (Exception e) {}
    }
}`);
    const bugs = scanFile(file);
    expect(bugs.some(b => b.category === 'unchecked-error' && b.message.includes('Empty catch'))).toBe(true);
  });
});

describe('Bug Finder - scanDirectory', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('scans multiple files in directory', () => {
    writeTestFile('a.ts', 'eval("danger");');
    writeTestFile('b.ts', 'element.innerHTML = x;');

    const bugs = scanDirectory(TEST_DIR);
    expect(bugs.length).toBeGreaterThanOrEqual(2);
  });

  it('skips node_modules', () => {
    writeTestFile('node_modules/dep/index.ts', 'eval("danger");');
    writeTestFile('src/main.ts', 'const x = 1;');

    const bugs = scanDirectory(TEST_DIR);
    const nodeModuleBugs = bugs.filter(b => b.file.includes('node_modules'));
    expect(nodeModuleBugs.length).toBe(0);
  });

  it('respects maxFiles limit', () => {
    for (let i = 0; i < 10; i++) {
      writeTestFile(`file${i}.ts`, `eval("danger ${i}");`);
    }

    const bugs = scanDirectory(TEST_DIR, undefined, 3);
    // Should only scan 3 files
    const uniqueFiles = new Set(bugs.map(b => b.file));
    expect(uniqueFiles.size).toBeLessThanOrEqual(3);
  });

  it('applies severity filter across directory', () => {
    writeTestFile('a.ts', 'eval("danger");'); // critical
    writeTestFile('b.ts', 'const x = value as any;'); // medium

    const criticalBugs = scanDirectory(TEST_DIR, 'critical');
    expect(criticalBugs.every(b => b.severity === 'critical')).toBe(true);
  });

  it('scans subdirectories recursively', () => {
    writeTestFile('sub/deep/file.ts', 'eval("nested");');

    const bugs = scanDirectory(TEST_DIR);
    expect(bugs.some(b => b.file.includes('deep'))).toBe(true);
  });
});

describe('Bug Finder - executeFindBugs', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('returns success with formatted output for file', async () => {
    const file = writeTestFile('test.ts', 'eval("danger");');
    const result = await executeFindBugs({ path: file });

    expect(result.success).toBe(true);
    expect(result.output).toContain('CRITICAL');
    expect(result.output).toContain('eval()');
  });

  it('returns success with formatted output for directory', async () => {
    writeTestFile('a.ts', 'eval("danger");');
    writeTestFile('b.ts', 'element.innerHTML = x;');

    const result = await executeFindBugs({ path: TEST_DIR });

    expect(result.success).toBe(true);
    expect(result.output).toContain('potential bug');
  });

  it('returns no bugs message for clean files', async () => {
    const file = writeTestFile('clean.ts', `const x = 1;
const y = x + 2;
export { x, y };
`);
    const result = await executeFindBugs({ path: file });

    expect(result.success).toBe(true);
    expect(result.output).toContain('No potential bugs found');
  });

  it('applies severity filter', async () => {
    writeTestFile('mixed.ts', `
eval("danger");
const x = value as any;
if (false) { }
`);
    const result = await executeFindBugs({ path: TEST_DIR, severity: 'critical' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('CRITICAL');
    // Should not contain medium-severity findings
    expect(result.output).not.toContain('[MEDIUM]');
  });

  it('returns error for non-existent path', async () => {
    const nonExistent = path.join(TEST_DIR, 'does_not_exist_at_all', 'nope.ts');
    const result = await executeFindBugs({ path: nonExistent });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Bug finder error');
  });

  it('output includes summary line', async () => {
    writeTestFile('test.ts', `
eval("danger");
element.innerHTML = x;
`);
    const result = await executeFindBugs({ path: TEST_DIR });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Summary:');
    expect(result.output).toContain('critical');
  });

  it('output includes file paths and line numbers', async () => {
    const file = writeTestFile('test.ts', 'eval("danger");');
    const result = await executeFindBugs({ path: file });

    expect(result.success).toBe(true);
    expect(result.output).toContain('test.ts:1');
  });

  it('output includes suggestions', async () => {
    const file = writeTestFile('test.ts', 'eval("danger");');
    const result = await executeFindBugs({ path: file });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Fix:');
  });
});
