/**
 * Diff model — build from disk, base hashing, conflict detection (TOCTOU).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  buildProposedDiff,
  detectConflicts,
  hashContent,
  renderUnifiedPreview,
} from '../../src/review/diff-model.js';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-model-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function write(rel: string, content: string): void {
  const abs = path.join(workDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

const ORIGIN = { kind: 'agent' as const, label: 'test-agent' };

describe('buildProposedDiff', () => {
  it('captures base content + hash and infers actions', () => {
    write('src/a.ts', 'export const a = 1;\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'bump a, add b, drop nothing',
      origin: ORIGIN,
      changes: [
        { path: 'src/a.ts', newContent: 'export const a = 2;\n' },
        { path: 'src/b.ts', newContent: 'export const b = 1;\n' },
      ],
    });

    expect(diff.files).toHaveLength(2);
    const [a, b] = diff.files;
    expect(a!.action).toBe('modify');
    expect(a!.baseHash).toBe(hashContent('export const a = 1;\n'));
    expect(b!.action).toBe('create');
    expect(b!.baseContent).toBeNull();
    expect(diff.id).toMatch(/^diff-[0-9a-f]{16}$/);
  });

  it('treats null newContent as delete', () => {
    write('gone.ts', 'x\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'remove gone.ts',
      origin: ORIGIN,
      changes: [{ path: 'gone.ts', newContent: null }],
    });
    expect(diff.files[0]!.action).toBe('delete');
    expect(diff.files[0]!.newContent).toBeNull();
  });

  it('rejects absolute paths and workDir escapes (contract violation)', () => {
    expect(() =>
      buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: '/etc/passwd', newContent: 'x' }] }),
    ).toThrow(/relative/);
    expect(() =>
      buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [{ path: '../outside.ts', newContent: 'x' }] }),
    ).toThrow(/escapes/);
  });

  it('rejects an empty change set', () => {
    expect(() => buildProposedDiff({ workDir, intent: 'x', origin: ORIGIN, changes: [] })).toThrow(/at least one/);
  });
});

describe('detectConflicts (TOCTOU)', () => {
  it('reports a clean diff as conflict-free', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [{ path: 'a.ts', newContent: 'v2\n' }],
    });
    expect(detectConflicts(diff)).toEqual([]);
  });

  it('detects a stale base (file modified after proposal)', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [{ path: 'a.ts', newContent: 'v2\n' }],
    });
    write('a.ts', 'someone else won the race\n');

    const conflicts = detectConflicts(diff);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('stale-base');
  });

  it('detects a vanished base and an unexpected existing file', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'v2\n' },
        { path: 'new.ts', newContent: 'fresh\n' },
      ],
    });
    fs.rmSync(path.join(workDir, 'a.ts'));
    write('new.ts', 'created by someone else\n');

    const kinds = detectConflicts(diff).map((c) => c.kind).sort();
    expect(kinds).toEqual(['missing-file', 'unexpected-existing']);
  });

  it('flags duplicate paths inside one diff', () => {
    write('a.ts', 'v1\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'v2\n' },
        { path: 'a.ts', newContent: 'v3\n' },
      ],
    });
    expect(detectConflicts(diff).some((c) => c.kind === 'duplicate-path')).toBe(true);
  });
});

describe('renderUnifiedPreview', () => {
  it('renders modify/create/delete previews', () => {
    write('a.ts', 'line1\nline2\n');
    const diff = buildProposedDiff({
      workDir,
      intent: 'x',
      origin: ORIGIN,
      changes: [
        { path: 'a.ts', newContent: 'line1\nline2 changed\n' },
        { path: 'b.ts', newContent: 'created\n' },
      ],
    });
    expect(renderUnifiedPreview(diff.files[0]!)).toContain('line2 changed');
    expect(renderUnifiedPreview(diff.files[1]!)).toContain('+created');
  });
});
