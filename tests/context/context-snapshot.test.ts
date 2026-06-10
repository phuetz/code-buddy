/**
 * WS3-T2 — periodic memory snapshot in ContextManagerV2.
 *
 * Covers: snapshot content + persistence, privacy redaction, trivial-session
 * gating, the periodic timer loop (start/stop, env-disable), and the
 * run-store observability hook staying optional.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

function msg(role: 'user' | 'assistant', content: string): CodeBuddyMessage {
  return { role, content } as CodeBuddyMessage;
}

function conversation(): CodeBuddyMessage[] {
  return [
    msg('user', 'Migre le schéma de la base'),
    msg('assistant', 'Je lis les migrations existantes.'),
    msg('user', 'Vérifie aussi le FTS'),
    msg('assistant', 'Migration 3 appliquée, FTS reconstruit.'),
  ];
}

describe('ContextManagerV2 periodic snapshot (WS3-T2)', () => {
  let workDir: string;
  let manager: ContextManagerV2;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'snap-'));
    manager = new ContextManagerV2({ model: 'gpt-4' });
  });

  afterEach(() => {
    manager.stopPeriodicSnapshot();
    rmSync(workDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  describe('takeSnapshot', () => {
    it('persists a compact snapshot with stats and summary', () => {
      const snapshot = manager.takeSnapshot(conversation(), workDir);

      expect(snapshot).not.toBeNull();
      expect(snapshot!.stats.messageCount).toBe(4);
      expect(snapshot!.stats.tokenCount).toBeGreaterThan(0);
      expect(snapshot!.summary).toContain('Migre le schéma');

      const onDisk = JSON.parse(
        readFileSync(join(workDir, '.codebuddy', 'context-snapshot.json'), 'utf8'),
      );
      expect(onDisk.sessionId).toBe(snapshot!.sessionId);
      expect(onDisk.summary).toContain('Migre le schéma');
    });

    it('returns null for trivial conversations and writes nothing', () => {
      expect(manager.takeSnapshot([msg('user', 'hi')], workDir)).toBeNull();
      expect(existsSync(join(workDir, '.codebuddy', 'context-snapshot.json'))).toBe(false);
    });

    it('redacts secrets from the persisted summary', () => {
      const history = [
        msg('user', 'voici la clé -----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg\n-----END PRIVATE KEY----- pour le déploiement'),
        msg('assistant', 'reçu'),
        msg('user', 'continue'),
        msg('assistant', 'ok'),
      ];
      const snapshot = manager.takeSnapshot(history, workDir);
      const onDisk = readFileSync(join(workDir, '.codebuddy', 'context-snapshot.json'), 'utf8');
      expect(snapshot!.summary).not.toContain('BEGIN PRIVATE KEY');
      expect(onDisk).not.toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('startPeriodicSnapshot', () => {
    it('snapshots on the configured interval and stops cleanly', () => {
      vi.useFakeTimers();
      const getMessages = vi.fn().mockReturnValue(conversation());

      manager.startPeriodicSnapshot(getMessages, 60_000, workDir);
      expect(getMessages).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60_000);
      expect(getMessages).toHaveBeenCalledTimes(1);
      expect(existsSync(join(workDir, '.codebuddy', 'context-snapshot.json'))).toBe(true);

      vi.advanceTimersByTime(120_000);
      expect(getMessages).toHaveBeenCalledTimes(3);

      manager.stopPeriodicSnapshot();
      vi.advanceTimersByTime(300_000);
      expect(getMessages).toHaveBeenCalledTimes(3);
    });

    it('is disabled by interval 0 (CODEBUDDY_SNAPSHOT_INTERVAL_MIN=0)', () => {
      vi.useFakeTimers();
      const getMessages = vi.fn().mockReturnValue(conversation());

      manager.startPeriodicSnapshot(getMessages, 0, workDir);
      vi.advanceTimersByTime(3_600_000);
      expect(getMessages).not.toHaveBeenCalled();
    });

    it('replaces a previous timer instead of stacking them', () => {
      vi.useFakeTimers();
      const first = vi.fn().mockReturnValue(conversation());
      const second = vi.fn().mockReturnValue(conversation());

      manager.startPeriodicSnapshot(first, 60_000, workDir);
      manager.startPeriodicSnapshot(second, 60_000, workDir);

      vi.advanceTimersByTime(60_000);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('survives a throwing message provider', () => {
      vi.useFakeTimers();
      const getMessages = vi.fn().mockImplementation(() => {
        throw new Error('history unavailable');
      });

      manager.startPeriodicSnapshot(getMessages, 60_000, workDir);
      expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
    });
  });
});
