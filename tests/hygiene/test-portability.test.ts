import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function portabilityWarnings(source: string): string[] {
  const warnings: string[] = [];
  if (/['"]\/tmp\//.test(source)) warnings.push('temporary path literal: use os.tmpdir() and path.join');
  if (/setTimeout\([\s\S]{0,800}?\bexpect\(/.test(source)) {
    warnings.push('delay before assertion: await the operation or its completion event');
  }
  return warnings;
}

describe('advisory portability guard for new test code', () => {
  it('recognizes temporary path literals and delay-based assertions', () => {
    expect(portabilityWarnings("const dir = '" + '/tmp/' + "example';")).toHaveLength(1);
    expect(portabilityWarnings('await new Promise(r => set' + 'Timeout(r, 80)); expect(count).toBe(5);')).toHaveLength(1);
    expect(portabilityWarnings('await saved; expect(count).toBe(5);')).toEqual([]);
  });

  it('warns about added test code without blocking CI', () => {
    try {
      const base = process.env.CODEBUDDY_TEST_PORTABILITY_BASE ?? 'HEAD^';
      const diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', base, '--', 'tests'], { encoding: 'utf8' });
      const sections = diff.split(/^diff --git /m);
      for (const section of sections) {
        const file = section.match(/^a\/.* b\/(tests\/[^\n]+\.test\.tsx?)/)?.[1];
        if (!file || file.endsWith('/test-portability.test.ts')) continue;
        const added = section.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
        for (const warning of portabilityWarnings(added)) console.warn(`[test portability] ${file}: ${warning}`);
      }
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', 'tests'], { encoding: 'utf8' });
      for (const file of untracked.split('\0').filter(file => /\.test\.tsx?$/.test(file))) {
        if (file.endsWith('/test-portability.test.ts')) continue;
        for (const warning of portabilityWarnings(readFileSync(file, 'utf8'))) console.warn(`[test portability] ${file}: ${warning}`);
      }
    } catch {
      console.warn('[test portability] Git comparison unavailable; advisory scan skipped');
    }
  });
});
