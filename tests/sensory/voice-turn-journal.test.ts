import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogger } from '../../src/security/audit-logger.js';
import { recordVoiceTurn, voiceTurnLogPath } from '../../src/sensory/voice-turn-journal.js';

const dirs: string[] = [];
const previous = process.env.CODEBUDDY_VOICE_TURN_LOG;

afterEach(() => {
  vi.restoreAllMocks();
  if (previous === undefined) delete process.env.CODEBUDDY_VOICE_TURN_LOG;
  else process.env.CODEBUDDY_VOICE_TURN_LOG = previous;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function journalFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-turns-'));
  dirs.push(dir);
  const file = path.join(dir, 'lisa', 'voice-turns.jsonl');
  process.env.CODEBUDDY_VOICE_TURN_LOG = file;
  return file;
}

describe('voice-turn journal', () => {
  it('appends each turn with its route, owner-only', () => {
    const file = journalFile();
    recordVoiceTurn({ heard: 'Lisa supprime ce dossier', reply: 'Je te demande d’abord.', route: 'agent' }, new Date('2026-09-24T18:00:00Z'));
    recordVoiceTurn({ heard: 'merci', reply: 'Avec plaisir.', route: 'shortcut' });
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      ts: '2026-09-24T18:00:00.000Z',
      route: 'agent',
      heard: 'Lisa supprime ce dossier',
      reply: 'Je te demande d’abord.',
    });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('writes an audit entry without the words', () => {
    journalFile();
    const log = vi.spyOn(auditLogger, 'log');
    recordVoiceTurn({ heard: 'mon code secret est 1234', reply: 'Noté.', route: 'conversation' });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'voice_turn', source: 'voice', target: 'conversation' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('1234');
  });

  it('rotates past 5 MB instead of growing without bound', () => {
    const file = journalFile();
    recordVoiceTurn({ heard: 'a', reply: 'b', route: 'shortcut' });
    writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1));
    recordVoiceTurn({ heard: 'c', reply: 'd', route: 'shortcut' });
    expect(statSync(`${file}.1`).size).toBeGreaterThan(5 * 1024 * 1024);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('can be switched off, and never throws', () => {
    process.env.CODEBUDDY_VOICE_TURN_LOG = 'false';
    expect(voiceTurnLogPath()).toBeNull();
    expect(() => recordVoiceTurn({ heard: 'a', reply: 'b', route: 'shortcut' })).not.toThrow();
    process.env.CODEBUDDY_VOICE_TURN_LOG = path.join(tmpdir(), 'no-such-dir', '\0bad');
    expect(() => recordVoiceTurn({ heard: 'a', reply: 'b', route: 'shortcut' })).not.toThrow();
  });
});
