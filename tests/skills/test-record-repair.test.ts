import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
// @ts-expect-error standalone operator script has no TypeScript declarations
import { repairReportedTestRecords } from '../../scripts/repair-test-skill-records.mjs';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'cb-skill-repair-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
describe('reported fixture repair', () => {
  it('previews, backs up exact bytes, preserves real skills/files, and is idempotent', async () => {
    const file = join(dir, 'lock.json');
    const skillFile = join(dir, 'SKILL.md');
    await writeFile(skillFile, 'original content');
    const original = JSON.stringify({ version: 1, skills: {
      'healthy-helper': { name: 'healthy-helper', path: skillFile },
      'my-real-skill': { name: 'my-real-skill', path: skillFile },
      'healthy-helper-custom': { name: 'healthy-helper-custom' },
    } });
    await writeFile(file, original);
    expect(repairReportedTestRecords(file)).toMatchObject({ applied: false, candidates: ['healthy-helper'] });
    expect(await readFile(file, 'utf8')).toBe(original);
    const result = repairReportedTestRecords(file, true);
    expect(result.removed).toEqual(['healthy-helper']);
    expect(await readFile(result.backup, 'utf8')).toBe(original);
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).skills)).toEqual(['my-real-skill', 'healthy-helper-custom']);
    expect(await readFile(skillFile, 'utf8')).toBe('original content');
    expect(repairReportedTestRecords(file, true)).toMatchObject({ applied: false, removed: [] });
  });
  it('leaves malformed lockfiles untouched', async () => {
    const file = join(dir, 'lock.json');
    await writeFile(file, '{"skills":[]}');
    expect(() => repairReportedTestRecords(file, true)).toThrow('Unrecognized');
    expect(await readFile(file, 'utf8')).toBe('{"skills":[]}');
  });
});
