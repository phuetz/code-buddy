import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendLisaJournal, isLisaJournalQuestion, maybeDeliverLisaEveningSummary,
  readLisaJournal, summarizeLisaDay,
} from '../../src/companion/lisa-journal.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-journal-'));
  roots.push(root);
  vi.stubEnv('CODEBUDDY_LISA_JOURNAL', 'true');
  vi.stubEnv('CODEBUDDY_TIMEZONE', 'UTC');
  const file = path.join(root, 'lisa', 'journal.jsonl');
  return { root, file, statePath: path.join(root, 'summary.json') };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lisa journal', () => {
  it('persists action, mandate, result and return point in append-only JSONL', () => {
    const { file } = fixture();
    appendLisaJournal({ kind: 'action', reason: 'checked the build', result: 'done', mandateId: 'm-1',
      checkpointId: 'cp-1', action: { tool: 'write_note', effect: 'reversible', args: {} } }, file);
    appendLisaJournal({ kind: 'silence', reason: 'No new signal' }, file);
    const entries = readLisaJournal(file);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ what: 'write_note', why: 'checked the build', result: 'done',
      mandateId: 'm-1', checkpointId: 'cp-1' });
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('summarizes only recorded acts, failures and decisions', () => {
    const { file } = fixture();
    vi.stubEnv('CODEBUDDY_LISA_JOURNAL_FILE', file);
    appendLisaJournal({ kind: 'action', reason: 'file saved', checkpointId: 'cp-2',
      action: { tool: 'write_note', effect: 'reversible', args: {} } }, file);
    appendLisaJournal({ kind: 'silence', reason: 'No change' }, file);
    const text = summarizeLisaDay(Date.now(), file);
    expect(text).toContain('1 action(s) autonome(s)');
    expect(text).toContain('retour cp-2');
    expect(text).not.toContain('No change');
    expect(isLisaJournalQuestion("Lisa, qu'as-tu fait aujourd'hui ?")).toBe(true);
  });

  it('delivers the evening summary once, to voice if present and Telegram otherwise', async () => {
    const { file, statePath } = fixture();
    const now = () => Date.UTC(2026, 8, 25, 20, 30);
    const say = vi.fn(async () => true);
    const telegram = vi.fn(async () => true);
    const deps = { now, journalPath: file, statePath, say, telegram, isPresent: async () => true };
    expect(await maybeDeliverLisaEveningSummary(deps)).toBe(true);
    expect(say).toHaveBeenCalledTimes(1);
    expect(telegram).not.toHaveBeenCalled();
    expect(await maybeDeliverLisaEveningSummary(deps)).toBe(false);
  });
});
