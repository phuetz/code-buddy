/**
 * LessonsTracker management API — get / update / removeWithReport.
 *
 * Real fs in temp dirs (no store mocks). os.homedir() is redirected so the
 * developer's real ~/.codebuddy/lessons.md is never read or written.
 *
 * Locks the origin-tracking fix: the old remove() rewrote only the PROJECT
 * file, so a lesson living only in the global file resurrected on the next
 * fresh load.
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let _fakeHome = '/tmp/lessons-manage-home-placeholder';
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: vi.fn(() => _fakeHome) };
});

import { LessonsTracker } from '../../src/agent/lessons-tracker.js';

const GLOBAL_MD = [
  '# Lessons Learned',
  '',
  '## RULE',
  '- [gid1] always run tests before marking done <!-- 2026-01-01 manual -->',
  '',
].join('\n');

describe('LessonsTracker management (show/rm/edit)', () => {
  let tmpDir: string;
  let projectDir: string;
  let globalFile: string;
  let projectFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lessons-manage-'));
    _fakeHome = path.join(tmpDir, 'fake-home');
    projectDir = path.join(tmpDir, 'project');
    await fs.ensureDir(projectDir);
    globalFile = path.join(_fakeHome, '.codebuddy', 'lessons.md');
    projectFile = path.join(projectDir, '.codebuddy', 'lessons.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('get(id) returns the lesson with its file location(s)', async () => {
    const tracker = new LessonsTracker(projectDir);
    const added = tracker.add('PATTERN', 'prefer small commits', 'manual', 'git');
    await tracker.save();

    const got = tracker.get(added.id);
    expect(got?.content).toBe('prefer small commits');
    expect(got?.locations).toEqual([{ scope: 'project', path: projectFile }]);
    expect(tracker.get('nope')).toBeUndefined();
  });

  it('removeWithReport deletes a GLOBAL-only lesson from the global file — no resurrection', async () => {
    await fs.ensureDir(path.dirname(globalFile));
    await fs.writeFile(globalFile, GLOBAL_MD);

    const tracker = new LessonsTracker(projectDir);
    expect(tracker.get('gid1')?.locations).toEqual([{ scope: 'global', path: globalFile }]);

    const result = await tracker.removeWithReport('gid1');
    expect(result).toEqual({ removed: true, removedFrom: [{ scope: 'global', path: globalFile }] });
    expect(await fs.readFile(globalFile, 'utf-8')).not.toContain('gid1');

    // The regression: a FRESH tracker (new load from disk) must not see it again.
    const fresh = new LessonsTracker(projectDir);
    expect(fresh.get('gid1')).toBeUndefined();
  });

  it('removeWithReport on a project lesson reports the project file', async () => {
    const tracker = new LessonsTracker(projectDir);
    const added = tracker.add('RULE', 'no mocks in integration tests');
    await tracker.save();

    const result = await tracker.removeWithReport(added.id);
    expect(result.removed).toBe(true);
    expect(result.removedFrom).toEqual([{ scope: 'project', path: projectFile }]);
    expect(await fs.readFile(projectFile, 'utf-8')).not.toContain(added.id);
  });

  it('removeWithReport deletes a duplicated id from BOTH files', async () => {
    await fs.ensureDir(path.dirname(globalFile));
    await fs.writeFile(globalFile, GLOBAL_MD);
    await fs.ensureDir(path.dirname(projectFile));
    await fs.writeFile(
      projectFile,
      '# Lessons Learned\n\n## RULE\n- [gid1] always run tests before marking done <!-- 2026-01-01 manual -->\n',
    );

    const tracker = new LessonsTracker(projectDir);
    const result = await tracker.removeWithReport('gid1');
    expect(result.removedFrom.map((l) => l.scope).sort()).toEqual(['global', 'project']);
    expect(await fs.readFile(globalFile, 'utf-8')).not.toContain('gid1');
    expect(await fs.readFile(projectFile, 'utf-8')).not.toContain('gid1');
  });

  it('remove(id) (fire-and-forget wrapper) also fixes the global file', async () => {
    await fs.ensureDir(path.dirname(globalFile));
    await fs.writeFile(globalFile, GLOBAL_MD);

    const tracker = new LessonsTracker(projectDir);
    expect(tracker.remove('gid1')).toBe(true);
    // Drain the serialized write queue.
    await tracker.save();
    expect(await fs.readFile(globalFile, 'utf-8')).not.toContain('gid1');
    expect(tracker.remove('gid1')).toBe(false);
  });

  it('update edits content + category + context and preserves id/date/source in the raw file', async () => {
    await fs.ensureDir(path.dirname(globalFile));
    await fs.writeFile(globalFile, GLOBAL_MD);

    const tracker = new LessonsTracker(projectDir);
    const updated = await tracker.update('gid1', {
      content: 'always run the FULL gate before marking done',
      category: 'PATTERN',
      context: 'ci',
    });
    expect(updated?.category).toBe('PATTERN');
    expect(updated?.locations).toEqual([{ scope: 'global', path: globalFile }]);

    const raw = await fs.readFile(globalFile, 'utf-8');
    // Regrouped under the new heading, metadata comment regenerated from the
    // preserved createdAt/source, context appended.
    expect(raw).toContain('## PATTERN');
    expect(raw).toContain('- [gid1] always run the FULL gate before marking done <!-- 2026-01-01 manual:ci -->');

    // A fresh load sees the edit (round-trips through the parser).
    const fresh = new LessonsTracker(projectDir);
    const got = fresh.get('gid1');
    expect(got?.category).toBe('PATTERN');
    expect(got?.context).toBe('ci');
    expect(got?.source).toBe('manual');
  });

  it('update(context: null) clears the context', async () => {
    const tracker = new LessonsTracker(projectDir);
    const added = tracker.add('CONTEXT', 'repo uses ESM imports', 'manual', 'typescript');
    await tracker.save();

    const updated = await tracker.update(added.id, { context: null });
    expect(updated?.context).toBeUndefined();
    const raw = await fs.readFile(projectFile, 'utf-8');
    expect(raw).toContain(`- [${added.id}] repo uses ESM imports <!--`);
    expect(raw).not.toContain(':typescript');
  });

  it('update validates against the markdown line format', async () => {
    const tracker = new LessonsTracker(projectDir);
    const added = tracker.add('RULE', 'valid content');
    await tracker.save();

    await expect(tracker.update(added.id, { content: 'line1\nline2' })).rejects.toThrow(/single line/);
    await expect(tracker.update(added.id, { content: 'sneaky <!-- comment' })).rejects.toThrow(/single line/);
    await expect(tracker.update(added.id, { content: '   ' })).rejects.toThrow(/empty/);
    await expect(tracker.update(added.id, { context: 'has-hyphen' })).rejects.toThrow(/hyphens/);
    expect(await tracker.update('missing-id', { content: 'x' })).toBeUndefined();
  });

  it('save() does NOT leak global lessons into the project file (duplication bug)', async () => {
    await fs.ensureDir(path.dirname(globalFile));
    await fs.writeFile(globalFile, GLOBAL_MD); // gid1 lives ONLY in the global file

    const tracker = new LessonsTracker(projectDir);
    const added = tracker.add('INSIGHT', 'project-only note');
    await tracker.save();

    const projectRaw = await fs.readFile(projectFile, 'utf-8');
    expect(projectRaw).toContain(`[${added.id}]`);
    // The global lesson must NOT be duplicated into the project file.
    expect(projectRaw).not.toContain('gid1');
    // And it still lives untouched in the global file.
    expect(await fs.readFile(globalFile, 'utf-8')).toContain('gid1');

    // A fresh load still sees both, each from its own file.
    const fresh = new LessonsTracker(projectDir);
    expect(fresh.get('gid1')?.locations).toEqual([{ scope: 'global', path: globalFile }]);
    expect(fresh.get(added.id)?.locations).toEqual([{ scope: 'project', path: projectFile }]);
  });

  it('serializes concurrent update + remove without clobbering (write queue)', async () => {
    const tracker = new LessonsTracker(projectDir);
    const a = tracker.add('RULE', 'lesson a');
    const b = tracker.add('RULE', 'lesson b');
    const c = tracker.add('RULE', 'lesson c');
    await tracker.save();

    await Promise.all([tracker.update(a.id, { content: 'lesson a v2' }), tracker.removeWithReport(b.id)]);

    const raw = await fs.readFile(projectFile, 'utf-8');
    expect(raw).toContain('lesson a v2');
    expect(raw).not.toContain(`[${b.id}]`);
    expect(raw).toContain(`[${c.id}]`);
    // No temp artifact left behind by the atomic swap.
    expect(await fs.pathExists(`${projectFile}.tmp`)).toBe(false);
  });
});
