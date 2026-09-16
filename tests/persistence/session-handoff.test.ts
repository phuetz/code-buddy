/** P6 — Cowork → terminal handoff into the real CLI session store format. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeHandoffSession } from '../../src/persistence/session-handoff.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { scanFileForSecrets } from '../../src/security/secrets-detector.js';
import { coworkMessagesToTurns, exportCoworkSessionToCli } from '../../cowork/src/main/session/cli-session-continuity.js';

describe('session handoff (P6)', () => {
  let dir: string;
  const previous = process.env.CODEBUDDY_SESSIONS_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
    process.env.CODEBUDDY_SESSIONS_DIR = dir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const coworkMessages = [
    { role: 'user', content: [{ type: 'text', text: 'Corrige le calcul de remise dans src/facture.ts' }], timestamp: Date.parse('2026-09-15T08:00:00Z') },
    { role: 'assistant', content: [{ type: 'tool_use', name: 'view_file' }, { type: 'text', text: 'Je lis src/facture.ts.' }], timestamp: Date.parse('2026-09-15T08:00:05Z') },
    { role: 'system', content: [{ type: 'text', text: '<context>hidden</context>' }], timestamp: Date.parse('2026-09-15T08:00:06Z') },
    { role: 'user', content: [{ type: 'text', text: 'Ma clé est sk-test-abcdefghijklmnopqrstuvwxyz0123456789ABCD et le jeton eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' }], timestamp: Date.parse('2026-09-15T08:01:00Z') },
    { role: 'assistant', content: [{ type: 'text', text: 'Ne partage pas de clé ici.' }], timestamp: Date.parse('2026-09-15T08:01:02Z') },
    { role: 'user', content: [{ type: 'text', text: 'brouillon annulé' }], timestamp: Date.parse('2026-09-15T08:02:00Z'), localStatus: 'cancelled' },
  ];

  it('writes a 0600 CLI session readable by the real store, text only, secrets redacted', async () => {
    const result = await exportCoworkSessionToCli({
      session: { id: 'sess-42', title: 'Remise', cwd: dir, model: 'gpt-5.5', createdAt: Date.parse('2026-09-15T07:59:00Z') },
      messages: coworkMessages,
      loadCore: async () => ({ writeHandoffSession }),
    });
    expect(result.command).toBe('buddy --resume cowork-sess-42');
    expect(result.messageCount).toBe(4);
    expect(result.redactions).toBeGreaterThan(0);
    if (process.platform !== 'win32') expect(fs.statSync(result.path).mode & 0o777).toBe(0o600);

    const raw = fs.readFileSync(result.path, 'utf8');
    expect(raw).not.toContain('sk-test-abcdefghijklmnopqrstuvwxyz');
    expect(raw).not.toContain('eyJhbGciOiJIUzI1NiJ9.eyJzdWIi');
    expect(raw).not.toContain('<context>hidden</context>');
    expect(raw).not.toContain('brouillon annulé');
    expect(scanFileForSecrets(result.path)).toEqual([]);

    const store = new SessionStore({ useSQLite: false });
    const resumed = await store.getSessionByPartialId('cowork-sess-42');
    expect(resumed?.messages.map((m) => m.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(resumed?.messages[1]?.content).toBe('Je lis src/facture.ts.');
    expect(await store.resumeSession(resumed!.id)).not.toBeNull();
  });

  it('round trip CLI → Cowork turns → CLI keeps order and count of text messages', async () => {
    const cliMessages = [
      { type: 'user', content: 'un', timestamp: '2026-09-15T08:00:00.000Z' },
      { type: 'assistant', content: 'deux', timestamp: '2026-09-15T08:00:01.000Z' },
      { type: 'user', content: 'trois', timestamp: '2026-09-15T08:00:02.000Z' },
    ];
    // Cowork import maps CLI types to roles with one text block (session-manager importExternalSession).
    const imported = cliMessages.map((m) => ({ role: m.type, content: [{ type: 'text', text: m.content }], timestamp: Date.parse(m.timestamp) }));
    const turns = coworkMessagesToTurns(imported);
    const result = await writeHandoffSession({ source: 'cowork', sourceId: 'cli-import:abc', name: 'aller-retour', turns });
    const back = await new SessionStore({ useSQLite: false }).getSessionByPartialId(result.id);
    expect(back?.messages.map((m) => [m.type, m.content])).toEqual(cliMessages.map((m) => [m.type, m.content]));
    expect(back?.messages.map((m) => m.timestamp)).toEqual(cliMessages.map((m) => m.timestamp));
  });

  it('refuses an empty conversation and a missing engine', async () => {
    await expect(writeHandoffSession({ source: 'cowork', sourceId: 'x', name: 'x', turns: [] })).rejects.toThrow('HANDOFF_EMPTY_CONVERSATION');
    await expect(exportCoworkSessionToCli({ session: { id: 'x' }, messages: [], loadCore: async () => null })).rejects.toThrow(/Moteur/);
    await expect(exportCoworkSessionToCli({ session: null, messages: [], loadCore: async () => ({ writeHandoffSession }) })).rejects.toThrow('Session not found');
  });
});
