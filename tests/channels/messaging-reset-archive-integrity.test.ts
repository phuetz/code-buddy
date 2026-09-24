/**
 * What the reset archives and purges stays what it proved: a record edited
 * after its proof is refused on restore, a symlink is never followed on
 * restore, an archive never replaces a file that appeared at its name, and a
 * companion turn written after a purge by another process does not bring the
 * purged turns back from that process's cache.
 *
 * Every file lives in a throwaway directory created by the test.
 */
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openMessagingMemoryArchive,
  proveMessagingMemorySave,
  readMessagingMemoryArchive,
} from '../../src/channels/messaging-session-reset.js';
import {
  clearCompanionChannelHistoriesForTests,
  personKeyFromSession,
  rememberCompanionChannelTurn,
  resolveChannelHistoryFile,
} from '../../src/companion/channel-history.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  clearCompanionChannelHistoriesForTests();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-reset-integrity-'));
  dirs.push(dir);
  return dir;
}

const SAVE = { sessionKey: 'integrite', source: 'agent-cache' as const, now: 10_000_000, reason: 'idle' as const };

describe('remise a zero : integrite des archives et des purges', () => {
  it('une archive modifiee apres sa preuve est refusee a la restauration', () => {
    const archiveDir = tempDir();
    const saved = proveMessagingMemorySave({ ...SAVE, archiveDir, transcript: 'user: ORIGINAL' });
    expect(saved.ok).toBe(true);
    expect(openMessagingMemoryArchive(archiveDir, SAVE.sessionKey, SAVE.source)).toEqual(['user: ORIGINAL']);
    const directory = path.join(archiveDir, SAVE.source);
    const file = path.join(directory, readdirSync(directory)[0]!);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { transcript: string };
    record.transcript = 'user: MODIFIE';
    writeFileSync(file, JSON.stringify(record));
    expect(() => openMessagingMemoryArchive(archiveDir, SAVE.sessionKey, SAVE.source)).toThrow('memory archive digest mismatch');
  });

  it.skipIf(process.platform === 'win32')(
    'un lien symbolique de nom conforme n est pas suivi par la restauration (liens reserves aux administrateurs sous Windows)',
    () => {
      const archiveDir = tempDir();
      expect(proveMessagingMemorySave({ ...SAVE, archiveDir, transcript: 'user: ORIGINAL' }).ok).toBe(true);
      const directory = path.join(archiveDir, SAVE.source);
      const valid = readdirSync(directory)[0]!;
      const forged = path.join(archiveDir, 'forge.json');
      writeFileSync(forged, JSON.stringify({
        schemaVersion: 1, savedAt: 'x', reason: 'idle', transcript: 'user: FORGE', digest: '0'.repeat(64), epoch: 'abcdefgh',
      }));
      symlinkSync(forged, path.join(directory, valid.replace(/\.[^.]+\.json$/, '.zzzzzzzz.json')));
      expect(readMessagingMemoryArchive(archiveDir, SAVE.sessionKey, SAVE.source)).not.toContain('FORGE');
      expect(openMessagingMemoryArchive(archiveDir, SAVE.sessionKey, SAVE.source)).toEqual(['user: ORIGINAL']);
    },
  );

  for (const verbatim of [false, true]) {
    it(`${verbatim ? 'copie brute' : 'enregistrement'} : un fichier apparu au nom de l archive n est pas remplace`, () => {
      const archiveDir = tempDir();
      const competitor = 'ARCHIVE_D_UNE_AUTRE_REMISE_A_ZERO';
      let target = '';
      const openSync = fs.openSync.bind(fs);
      const renameSync = fs.renameSync.bind(fs);
      // Another reset publishes at the same name between the existence check and this write.
      const appear = (file: string): void => {
        if (!target && path.dirname(file) === path.join(archiveDir, SAVE.source)) {
          target = file;
          writeFileSync(file, competitor);
        }
      };
      vi.spyOn(fs, 'openSync').mockImplementation(((file: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
        if (flags === 'wx') appear(String(file));
        return openSync(file, flags, mode);
      }) as typeof fs.openSync);
      vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
        appear(String(to));
        return renameSync(from, to);
      }) as typeof fs.renameSync);
      syncBuiltinESMExports();
      const saved = proveMessagingMemorySave({
        ...SAVE,
        archiveDir,
        transcript: 'user: CETTE_REMISE',
        ...(verbatim ? { raw: Buffer.from('{"messages":[]}') } : {}),
      });
      console.log('ARCHIVE_CONCURRENTE', JSON.stringify({ verbatim, saved, target: path.basename(target) }));
      expect(target, 'point d injection atteint').not.toBe('');
      expect(readFileSync(target, 'utf8'), 'archive concurrente intacte').toBe(competitor);
      expect(saved.ok, 'sauvegarde refusee').toBe(false);
    });
  }

  it('un tour ecrit apres une purge par un autre processus ne ramene pas le cache de celui-ci', () => {
    const historyDir = tempDir();
    const env = { ...process.env, CODEBUDDY_CHANNEL_HISTORY: 'true', CODEBUDDY_CHANNEL_HISTORY_DIR: historyDir };
    const key = 'telegram:integrite-cache';
    const t0 = Date.now() - 60_000;
    rememberCompanionChannelTurn(key, 'bonjour', 'TOUR_AVANT_PURGE', env, t0);
    // Another process purges the file: an empty record, newer than this cache.
    const file = resolveChannelHistoryFile(key, env);
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1, personKey: personKeyFromSession(key), updatedAt: new Date(t0 + 1_000).toISOString(), turns: [],
    }));
    rememberCompanionChannelTurn(key, 'encore', 'TOUR_APRES_PURGE', env, t0 + 2_000);
    const disk = readFileSync(file, 'utf8');
    console.log('CACHE_PERIME', JSON.stringify({ avant: disk.includes('TOUR_AVANT_PURGE'), apres: disk.includes('TOUR_APRES_PURGE') }));
    expect(disk).toContain('TOUR_APRES_PURGE');
    expect(disk, 'tour purge ramene par le cache').not.toContain('TOUR_AVANT_PURGE');
  });
});
