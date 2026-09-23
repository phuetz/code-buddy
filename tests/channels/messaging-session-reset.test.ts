/**
 * Messaging session reset. The clock is a number of milliseconds.
 * Nothing in this file waits on a real timer.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyChannelMessagingSessionReset,
  decideMessagingSessionReset,
  DEFAULT_MESSAGING_SESSION_RESET_POLICY,
  enforceMessagingSessionReset,
  messagingMemoryArchivePath,
  proveMessagingMemorySave,
  resolveSessionResetPolicy,
  type MessagingSessionResetPolicy,
  type MessagingSessionSnapshot,
} from '../../src/channels/messaging-session-reset.js';
import {
  clearCompanionChannelHistoriesForTests,
  clearCompanionChannelHistory,
  inspectCompanionChannelHistory,
  readCompanionChannelHistory,
  rememberCompanionChannelTurn,
} from '../../src/companion/channel-history.js';
import { assignSessionReset, parseTOML, serializeTOML, DEFAULT_CONFIG } from '../../src/config/toml-config.js';

const dirs: string[] = [];

afterEach(() => {
  clearCompanionChannelHistoriesForTests();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cb-session-reset-'));
  dirs.push(dir);
  return dir;
}

/** Local calendar time, so the daily boundary does not depend on a fixed offset. */
function localMs(year: number, month: number, day: number, hour: number, minute: number, second = 0, ms = 0): number {
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

function policy(overrides: Partial<MessagingSessionResetPolicy> = {}): MessagingSessionResetPolicy {
  return { ...DEFAULT_MESSAGING_SESSION_RESET_POLICY, ...overrides };
}

function snapshot(lastActivityAt: number | null, transcript = 'user: bonjour\nassistant: salut'): MessagingSessionSnapshot {
  return { lastActivityAt, transcript };
}

describe('remise à zéro des sessions de messagerie', () => {
  it('none conserve la session même après une longue inactivité et n appelle pas la sauvegarde', async () => {
    let saved = false;
    let reset = false;
    const last = localMs(2026, 1, 1, 10, 0);
    const now = localMs(2026, 9, 23, 18, 0);
    expect(decideMessagingSessionReset(policy({ mode: 'none' }), last, now)).toBeNull();
    const outcome = await enforceMessagingSessionReset({
      policy: policy({ mode: 'none' }),
      now,
      snapshot: snapshot(last),
      saveMemory: async () => {
        saved = true;
        return { ok: true, receipt: 'a'.repeat(64) };
      },
      resetSession: async () => {
        reset = true;
      },
    });
    expect(outcome).toEqual({ action: 'kept' });
    expect(saved).toBe(false);
    expect(reset).toBe(false);
  });

  it('idle ne coupe pas à la deadline exacte et coupe une milliseconde après, sauvegarde puis remise à zéro', async () => {
    const last = localMs(2026, 9, 23, 12, 0);
    const idle = policy({ mode: 'idle', idleMinutes: 60 });
    const exact = last + 60 * 60_000;
    expect(decideMessagingSessionReset(idle, last, exact)).toBeNull();
    const kept = await enforceMessagingSessionReset({
      policy: idle,
      now: exact,
      snapshot: snapshot(last),
      saveMemory: async () => {
        throw new Error('ne doit pas sauvegarder');
      },
      resetSession: async () => {
        throw new Error('ne doit pas remettre à zéro');
      },
    });
    expect(kept).toEqual({ action: 'kept' });

    const order: string[] = [];
    const overdue = exact + 1;
    expect(decideMessagingSessionReset(idle, last, overdue)).toBe('idle');
    const outcome = await enforceMessagingSessionReset({
      policy: idle,
      now: overdue,
      snapshot: snapshot(last, 'user: toujours là'),
      saveMemory: async (transcript) => {
        order.push(`save:${transcript}`);
        return { ok: true, receipt: 'b'.repeat(64) };
      },
      resetSession: async () => {
        expect(order).toEqual(['save:user: toujours là']);
        order.push('reset');
      },
    });
    expect(order).toEqual(['save:user: toujours là', 'reset']);
    expect(outcome).toEqual({ action: 'reset', reason: 'idle', receipt: 'b'.repeat(64) });
  });

  it('daily suit la frontière locale et ne coupe pas avant l heure, ni juste après si le tour est plus récent', async () => {
    const daily = policy({ mode: 'daily', atHour: 4, idleMinutes: 1 });
    const beforeHour = localMs(2026, 9, 23, 3, 30);
    const yesterdayEarly = localMs(2026, 9, 22, 3, 0);
    const yesterdayAfterBoundary = localMs(2026, 9, 22, 5, 0);
    const todayAfter = localMs(2026, 9, 23, 5, 0);
    const todayAtBoundary = localMs(2026, 9, 23, 4, 0);

    expect(decideMessagingSessionReset(daily, yesterdayAfterBoundary, beforeHour)).toBeNull();
    expect(decideMessagingSessionReset(daily, yesterdayEarly, beforeHour)).toBe('daily');
    expect(decideMessagingSessionReset(daily, todayAtBoundary, todayAfter)).toBeNull();
    expect(decideMessagingSessionReset(daily, localMs(2026, 9, 23, 3, 0), todayAfter)).toBe('daily');

    let reset = false;
    const kept = await enforceMessagingSessionReset({
      policy: daily,
      now: todayAfter,
      snapshot: snapshot(todayAtBoundary),
      saveMemory: async () => {
        throw new Error('ne doit pas sauvegarder');
      },
      resetSession: async () => {
        reset = true;
      },
    });
    expect(kept).toEqual({ action: 'kept' });
    expect(reset).toBe(false);

    const order: string[] = [];
    const outcome = await enforceMessagingSessionReset({
      policy: daily,
      now: todayAfter,
      snapshot: snapshot(localMs(2026, 9, 23, 3, 0), 'user: hier soir'),
      saveMemory: async () => {
        order.push('save');
        return { ok: true, receipt: 'c'.repeat(64) };
      },
      resetSession: async () => {
        expect(order).toEqual(['save']);
        order.push('reset');
      },
    });
    expect(outcome).toEqual({ action: 'reset', reason: 'daily', receipt: 'c'.repeat(64) });
    expect(order).toEqual(['save', 'reset']);
  });

  it('both prend idle si les deux matchent, idle seul, ou daily seul', async () => {
    const idleWindow = policy({ mode: 'both', idleMinutes: 60, atHour: 4 });
    const dayWindow = policy({ mode: 'both', idleMinutes: 1440, atHour: 4 });
    const afternoon = localMs(2026, 9, 23, 15, 0);
    const idleOnly = localMs(2026, 9, 23, 12, 0);
    const stillFresh = localMs(2026, 9, 23, 14, 30);
    const bothMatch = localMs(2026, 9, 20, 8, 0);
    const beforeBoundary = localMs(2026, 9, 23, 3, 0);
    const afterBoundary = localMs(2026, 9, 23, 5, 0);

    expect(decideMessagingSessionReset(idleWindow, idleOnly, afternoon)).toBe('idle');
    expect(decideMessagingSessionReset(idleWindow, stillFresh, afternoon)).toBeNull();
    expect(decideMessagingSessionReset(idleWindow, bothMatch, afternoon)).toBe('idle');
    expect(decideMessagingSessionReset(dayWindow, beforeBoundary, afterBoundary)).toBe('daily');
    expect(decideMessagingSessionReset(dayWindow, localMs(2026, 9, 23, 4, 30), afterBoundary)).toBeNull();

    const reasons: string[] = [];
    const idleOutcome = await enforceMessagingSessionReset({
      policy: idleWindow,
      now: afternoon,
      snapshot: snapshot(bothMatch),
      saveMemory: async (_transcript, reason) => {
        reasons.push(reason);
        return { ok: true, receipt: 'd'.repeat(64) };
      },
      resetSession: async () => {
        reasons.push('reset');
      },
    });
    expect(idleOutcome).toMatchObject({ action: 'reset', reason: 'idle' });

    const dailyOutcome = await enforceMessagingSessionReset({
      policy: dayWindow,
      now: afterBoundary,
      snapshot: snapshot(beforeBoundary),
      saveMemory: async () => ({ ok: true, receipt: 'e'.repeat(64) }),
      resetSession: async () => undefined,
    });
    expect(dailyOutcome).toMatchObject({ action: 'reset', reason: 'daily' });
    expect(reasons).toEqual(['idle', 'reset']);
  });

  it('un échec, une exception ou un reçu vide annule la remise à zéro', async () => {
    const idle = policy({ mode: 'idle', idleMinutes: 10 });
    const now = localMs(2026, 9, 23, 12, 0);
    const last = now - 11 * 60_000;
    const cases: Array<{ label: string; save: () => Promise<{ ok: true; receipt: string } | { ok: false; error: string }> | never }> = [
      { label: 'refus', save: async () => ({ ok: false, error: 'archive unreadable' }) },
      { label: 'exception', save: async () => { throw new Error('disk full'); } },
      { label: 'reçu vide', save: async () => ({ ok: true, receipt: '' }) },
      { label: 'reçu court', save: async () => ({ ok: true, receipt: 'pas-un-digest' }) },
    ];
    expect(cases).toHaveLength(4);
    for (const entry of cases) {
      let reset = false;
      const outcome = await enforceMessagingSessionReset({
        policy: idle,
        now,
        snapshot: snapshot(last, `transcript ${entry.label}`),
        saveMemory: entry.save as (transcript: string, reason: 'idle' | 'daily') => Promise<{ ok: true; receipt: string } | { ok: false; error: string }>,
        resetSession: async () => {
          reset = true;
        },
      });
      expect(reset, entry.label).toBe(false);
      expect(outcome.action, entry.label).toBe('cancelled');
      if (outcome.action === 'cancelled') expect(outcome.reason).toBe('idle');
    }
  });

  it('la sauvegarde réelle est relue avant la remise à zéro, et un dossier impossible l annule', async () => {
    const dir = tempDir();
    const idle = policy({ mode: 'idle', idleMinutes: 5 });
    const now = localMs(2026, 9, 23, 9, 0);
    const last = now - 6 * 60_000;
    const transcript = 'user: retiens le train\nassistant: noté';
    let reset = false;
    const outcome = await applyChannelMessagingSessionReset({
      sessionKey: 'telegram:conversation',
      now,
      policy: idle,
      snapshot: snapshot(last, transcript),
      archiveDir: dir,
      resetSession: async () => {
        const files = await import('node:fs');
        const written = files.readdirSync(dir).filter((name) => name.endsWith('.json'));
        expect(written).toHaveLength(1);
        const raw = files.readFileSync(path.join(dir, written[0] ?? ''), 'utf8');
        const parsed = JSON.parse(raw) as { transcript?: string; digest?: string };
        expect(parsed.transcript).toBe(transcript);
        expect(parsed.digest).toMatch(/^[a-f0-9]{64}$/);
        expect(raw).not.toContain('telegram:conversation');
        reset = true;
      },
    });
    expect(reset).toBe(true);
    expect(outcome.action).toBe('reset');
    if (outcome.action === 'reset') expect(outcome.receipt).toMatch(/^[a-f0-9]{64}$/);

    const blocker = path.join(dir, 'pas-un-dossier');
    writeFileSync(blocker, 'occupé');
    let blockedReset = false;
    const cancelled = await applyChannelMessagingSessionReset({
      sessionKey: 'webchat:conversation',
      now,
      policy: idle,
      snapshot: snapshot(last, transcript),
      archiveDir: blocker,
      resetSession: async () => {
        blockedReset = true;
      },
    });
    expect(blockedReset).toBe(false);
    expect(cancelled).toMatchObject({ action: 'cancelled', reason: 'idle', error: 'memory archive write failed' });

    const direct = proveMessagingMemorySave({
      archiveDir: dir,
      sessionKey: 'autre',
      transcript,
      now,
      reason: 'daily',
    });
    expect(direct.ok).toBe(true);
  });

  it('la configuration absente vaut none, et le toml existant accepte les quatre modes', () => {
    expect(resolveSessionResetPolicy(undefined)).toEqual(DEFAULT_MESSAGING_SESSION_RESET_POLICY);
    expect(resolveSessionResetPolicy(undefined).mode).toBe('none');
    expect(resolveSessionResetPolicy({ mode: 'nope', idle_minutes: 0, at_hour: 24 })).toEqual(
      DEFAULT_MESSAGING_SESSION_RESET_POLICY,
    );
    expect(resolveSessionResetPolicy({ mode: 'both', idle_minutes: 15, at_hour: 6 })).toEqual({
      mode: 'both',
      idleMinutes: 15,
      atHour: 6,
    });
    expect(resolveSessionResetPolicy({ mode: 'IDLE' }).mode).toBe('idle');
    expect(resolveSessionResetPolicy({ mode: 'daily' }).idleMinutes).toBe(1440);
    expect(resolveSessionResetPolicy({ mode: 'idle' }).atHour).toBe(4);

    const parsed = parseTOML(`
[session_reset]
mode = "both"
idle_minutes = 30
at_hour = 7
`);
    const holder: { session_reset?: { mode?: string; idle_minutes?: number; at_hour?: number } } = {};
    assignSessionReset(holder, parsed);
    expect(resolveSessionResetPolicy(holder.session_reset)).toEqual({
      mode: 'both',
      idleMinutes: 30,
      atHour: 7,
    });
    assignSessionReset(holder, { session_reset: ['non'] });
    expect(holder.session_reset?.mode).toBe('both');

    const serialized = serializeTOML({
      ...DEFAULT_CONFIG,
      session_reset: { mode: 'daily', idle_minutes: 90, at_hour: 5 },
    });
    expect(serialized).toContain('[session_reset]');
    expect(serialized).toContain('mode = "daily"');
    expect(resolveSessionResetPolicy(parseTOML(serialized).session_reset)).toEqual({
      mode: 'daily',
      idleMinutes: 90,
      atHour: 5,
    });
    expect(serializeTOML(DEFAULT_CONFIG)).not.toContain('[session_reset]');
  });

  it('chaque partie effacée est archivée dans son propre fichier avant la remise à zéro', async () => {
    const dir = tempDir();
    const sessionKey = 'webchat:cartes';
    const now = localMs(2026, 9, 23, 12, 0);
    const last = now - 11 * 60_000;
    const parts = [
      { source: 'agent-cache' as const, transcript: 'user: memoire agent' },
      { source: 'session-store' as const, transcript: 'user: memoire disque' },
      { source: 'companion-history' as const, transcript: 'user: memoire fichier' },
      { source: 'local-map' as const, transcript: 'assistant: CAPTION-SELFIE-UNIQUE' },
    ];
    let reset = false;
    const saved = await applyChannelMessagingSessionReset({
      sessionKey,
      now,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(last, 'ignore'),
      parts,
      archiveDir: dir,
      resetSession: async () => {
        for (const part of parts) {
          const raw = readFileSync(messagingMemoryArchivePath(dir, sessionKey, part.source), 'utf8');
          expect(raw).toContain(part.transcript);
        }
        reset = true;
      },
    });
    expect(reset).toBe(true);
    expect(saved.action).toBe('reset');
    if (saved.action === 'reset') expect(saved.receipt).toMatch(/^[a-f0-9]{64}$/);
  });

  it('un échec de sauvegarde de la carte annule la remise à zéro', async () => {
    const dir = tempDir();
    const sessionKey = 'webchat:carte-bloquee';
    const now = localMs(2026, 9, 23, 12, 0);
    const last = now - 11 * 60_000;
    const parts = [
      { source: 'agent-cache' as const, transcript: 'user: memoire agent' },
      { source: 'session-store' as const, transcript: 'user: memoire disque' },
      { source: 'companion-history' as const, transcript: 'user: memoire fichier' },
      { source: 'local-map' as const, transcript: 'assistant: CAPTION-SELFIE-UNIQUE' },
    ];
    const blockedPath = messagingMemoryArchivePath(dir, sessionKey, 'local-map');
    mkdirSync(blockedPath, { recursive: true });
    expect(statSync(blockedPath).isDirectory()).toBe(true);
    let blockedReset = false;
    const cancelled = await applyChannelMessagingSessionReset({
      sessionKey,
      now,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(last, 'ignore'),
      parts,
      archiveDir: dir,
      resetSession: async () => {
        blockedReset = true;
      },
    });
    expect(blockedReset, 'carte').toBe(false);
    expect(cancelled).toMatchObject({ action: 'cancelled', reason: 'idle' });
    expect(readFileSync(messagingMemoryArchivePath(dir, sessionKey, 'session-store'), 'utf8')).toContain(
      'user: memoire disque',
    );
    expect(readFileSync(messagingMemoryArchivePath(dir, sessionKey, 'agent-cache'), 'utf8')).toContain(
      'user: memoire agent',
    );
    expect(readFileSync(messagingMemoryArchivePath(dir, sessionKey, 'companion-history'), 'utf8')).toContain(
      'user: memoire fichier',
    );
    expect(statSync(messagingMemoryArchivePath(dir, sessionKey, 'local-map')).isDirectory()).toBe(true);
    expect(existsSync(messagingMemoryArchivePath(dir, sessionKey, 'local-map'))).toBe(true);
  });

  it('un historique de canal déjà périmé pour le prompt reste lisible pour la sauvegarde, puis s efface', () => {
    const dir = tempDir();
    const env = {
      CODEBUDDY_CHANNEL_HISTORY: 'true',
      CODEBUDDY_CHANNEL_HISTORY_DIR: dir,
    };
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    rememberCompanionChannelTurn('telegram:conversation', 'bonjour', 'salut', env, eightDaysAgo);
    expect(readCompanionChannelHistory('telegram:conversation', env, Date.now())).toEqual([]);
    const inspected = inspectCompanionChannelHistory('telegram:conversation', env);
    expect(inspected?.transcript).toContain('user: bonjour');
    expect(inspected?.transcript).toContain('assistant: salut');
    expect(inspected && inspected.updatedAtMs).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000);
    clearCompanionChannelHistory('telegram:conversation', env, Date.now());
    expect(inspectCompanionChannelHistory('telegram:conversation', env)).toBeNull();
    expect(readCompanionChannelHistory('telegram:conversation', env, Date.now())).toEqual([]);
  });
});
