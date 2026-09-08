import { describe, expect, it } from 'vitest';
import { toBashPath } from '../../scripts/lane-shell-path.mjs';

describe('Node paths returned to lane Bash scripts', () => {
  it.each([
    ['D:\\work tree\\lane\\REPARATION-DEMO.md', '/d/work tree/lane/REPARATION-DEMO.md'],
    ['C:/repo/report.md', '/c/repo/report.md'],
    ['\\\\server\\share\\report.md', '//server/share/report.md'],
    ['', ''],
  ])('converts Windows path %s', (native, shell) => {
    expect(toBashPath(native, 'win32')).toBe(shell);
  });

  it.each(['linux', 'darwin'])('preserves POSIX filenames on %s', (platform) => {
    expect(toBashPath('/work/literal\\name/report.md', platform)).toBe('/work/literal\\name/report.md');
  });

  it('keeps the report inside the Bash clone prefix and yields the ledger-relative path', () => {
    const clone = '/d/work/lane';
    const report = toBashPath('D:\\work\\lane\\REPARATION-DEMO.md', 'win32');
    expect(report.startsWith(`${clone}/`)).toBe(true);
    expect(report.slice(clone.length + 1)).toBe('REPARATION-DEMO.md');
  });
});
