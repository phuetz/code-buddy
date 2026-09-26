import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLisaJournal } from '../../src/companion/lisa-journal.js';
import { defaultReply } from '../../src/sensory/voice-loop.js';

vi.mock('../../src/memory/presence-injector.js', async (importOriginal) => ({
  ...await importOriginal<object>(),
  readPresenceContext: async () => ({ hasMatch: true, name: 'Owner', hasUnknownFace: false, ageMs: 0 }),
}));

describe('journal vocal', () => {
  const roots: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('ne lit ni ne confirme le journal quand seul le visage propriétaire est présent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'voice-journal-gate-'));
    roots.push(root);
    const file = join(root, 'journal.jsonl');
    vi.stubEnv('CODEBUDDY_LISA_JOURNAL', 'true');
    vi.stubEnv('CODEBUDDY_LISA_JOURNAL_FILE', file);
    vi.stubEnv('CODEBUDDY_LISA_OWNER_FACE_NAME', 'Owner');
    appendLisaJournal({ kind: 'action', reason: 'secret du journal', action: {
      tool: 'write_note', effect: 'reversible', args: {},
    } }, file);

    const reply = await defaultReply("Lisa, qu'as-tu fait aujourd'hui ?", [], { robotNamed: true });
    expect(reply).toBe('Cette demande nécessite un canal privé authentifié.');
    expect(reply).not.toContain('secret du journal');
  });
});
