/**
 * Messaging session reset. The clock is a number of milliseconds.
 * Nothing in this file waits on a real timer.
 */
// First import: the user config path is frozen when the loader module loads.
import '../helpers/config-home-first.js';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyChannelMessagingSessionReset,
  decideMessagingSessionReset,
  DEFAULT_MESSAGING_SESSION_RESET_POLICY,
  enforceMessagingSessionReset,
  proveMessagingMemorySave,
  readMessagingMemoryArchive,
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
import { assignSessionReset, getConfigManager, parseTOML, serializeTOML, DEFAULT_CONFIG } from '../../src/config/toml-config.js';
import { resetSessionStore } from '../../src/persistence/session-store.js';
import {
  __beforeMessagingResetEraseForTests,
  __resetChannelAIHandlerForTests,
  __resetInboundMessagingSessionForTests,
  __seedLocalCompanionHistoryForTests,
} from '../../src/commands/handlers/channel-handlers.js';

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
          const raw = readMessagingMemoryArchive(dir, sessionKey, part.source);
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
    const blockedPath = path.join(dir, 'local-map');
    writeFileSync(blockedPath, 'bloque');
    expect(statSync(blockedPath).isFile()).toBe(true);
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
    expect(readMessagingMemoryArchive(dir, sessionKey, 'session-store')).toContain('user: memoire disque');
    expect(readMessagingMemoryArchive(dir, sessionKey, 'agent-cache')).toContain('user: memoire agent');
    expect(readMessagingMemoryArchive(dir, sessionKey, 'companion-history')).toContain('user: memoire fichier');
    expect(statSync(blockedPath).isFile()).toBe(true);
    expect(readMessagingMemoryArchive(dir, sessionKey, 'local-map')).toBe('');
  });

  function walkJsonFiles(dir: string, depth = 0): string[] {
    if (depth > 4) return [];
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const name of names) {
      if (name === '.' || name === '..') continue;
      const full = path.join(dir, name);
      let listed;
      try {
        listed = lstatSync(full);
      } catch {
        continue;
      }
      if (listed.isSymbolicLink()) continue;
      if (listed.isDirectory()) files.push(...walkJsonFiles(full, depth + 1));
      else if (listed.isFile() && name.endsWith('.json')) files.push(full);
    }
    return files;
  }

  it('P1 deux cycles de la même session conservent l archive du premier', async () => {
    const dir = tempDir();
    const sessionKey = 'webchat:deux-epoques';
    const now1 = localMs(2026, 9, 23, 12, 0);
    const base = now1 - 11 * 60_000;
    const firstParts = [
      { source: 'agent-cache' as const, transcript: 'SECRET_FIRST_EPOCH' },
      { source: 'session-store' as const, transcript: 'disque-1' },
      { source: 'companion-history' as const, transcript: 'comp-1' },
      { source: 'local-map' as const, transcript: 'carte-1' },
    ];
    const first = await applyChannelMessagingSessionReset({
      sessionKey,
      now: now1,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(base, 'SECRET_FIRST_EPOCH'),
      parts: firstParts,
      archiveDir: dir,
      resetSession: async () => undefined,
    });
    const second = await applyChannelMessagingSessionReset({
      sessionKey,
      now: now1 + 60 * 60_000,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(now1, 'SECOND_EPOCH'),
      parts: [
        { source: 'agent-cache' as const, transcript: 'SECOND_EPOCH' },
        { source: 'session-store' as const, transcript: 'disque-2' },
        { source: 'companion-history' as const, transcript: 'comp-2' },
        { source: 'local-map' as const, transcript: 'carte-2' },
      ],
      archiveDir: dir,
      resetSession: async () => undefined,
    });
    const files = walkJsonFiles(dir);
    const blob = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const firstStillSaved = blob.includes('SECRET_FIRST_EPOCH');
    const secondSaved = blob.includes('SECOND_EPOCH');
    expect(first.action, 'P1 premier cycle').toBe('reset');
    expect(second.action, 'P1 second cycle').toBe('reset');
    expect(firstStillSaved, 'P1 firstStillSaved').toBe(true);
    expect(secondSaved, 'P1 secondSaved').toBe(true);
  });

  it('P2 une lecture ratée n est pas une archive vide', async () => {
    const dir = tempDir();
    const sessionKey = 'webchat:lecture-ratee';
    const now = localMs(2026, 9, 23, 12, 0);
    let reset = false;
    const parts: Array<{
      source: 'agent-cache' | 'session-store' | 'companion-history' | 'local-map';
      transcript: string;
      readState: 'ok' | 'failed';
    }> = [
      { source: 'agent-cache', transcript: '', readState: 'failed' },
      { source: 'session-store', transcript: 'user: ANCIEN-DISQUE', readState: 'ok' },
      { source: 'companion-history', transcript: '', readState: 'ok' },
      { source: 'local-map', transcript: '', readState: 'ok' },
    ];
    const outcome = await applyChannelMessagingSessionReset({
      sessionKey,
      now,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(now - 11 * 60_000, 'user: ANCIEN-DISQUE'),
      parts,
      archiveDir: dir,
      resetSession: async () => {
        reset = true;
      },
    });
    expect(reset, 'P2 resetSession après lecture ratée').toBe(false);
    expect(outcome.action, 'P2 action').toBe('cancelled');
    const emptyAgentCertified = walkJsonFiles(dir).some((file) => {
      return file.includes('agent-cache') && readFileSync(file, 'utf8').includes('"transcript": ""');
    });
    expect(emptyAgentCertified, 'P2 archive vide certifiée').toBe(false);
  });

  it('P3 un lien symbolique de dossier d archive n est pas suivi', () => {
    const dir = tempDir();
    const outside = tempDir();
    const link = path.join(dir, 'archive-lie');
    symlinkSync(outside, link);
    const saved = proveMessagingMemorySave({
      archiveDir: link,
      sessionKey: 'webchat:lien',
      transcript: 'NE-DOIT-PAS-SORTIR',
      now: localMs(2026, 9, 23, 12, 0),
      reason: 'idle',
      source: 'agent-cache',
    });
    const outsideFiles = readdirSync(outside);
    expect(saved.ok, 'P3 lien suivi').toBe(false);
    expect(outsideFiles, 'P3 outsideFiles').toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('P3b un tube nommé à la place du dossier est refusé sans attente', () => {
    const dir = tempDir();
    const fifo = path.join(dir, 'tube');
    execFileSync('mkfifo', [fifo], { timeout: 2000 });
    const started = Date.now();
    const saved = proveMessagingMemorySave({
      archiveDir: fifo,
      sessionKey: 'webchat:tube',
      transcript: 'NE-DOIT-PAS-BLOQUER',
      now: localMs(2026, 9, 23, 12, 0),
      reason: 'idle',
      source: 'agent-cache',
    });
    expect(Date.now() - started, 'P3b attente').toBeLessThan(2000);
    expect(saved.ok, 'P3b tube ouvert').toBe(false);
  });

  it('une mémoire vide lue avec succès reste archivée', async () => {
    const dir = tempDir();
    const sessionKey = 'webchat:vide-lu';
    const now = localMs(2026, 9, 23, 12, 0);
    let reset = false;
    const parts: Array<{
      source: 'agent-cache' | 'session-store' | 'companion-history' | 'local-map';
      transcript: string;
      readState: 'ok' | 'failed';
    }> = [
      { source: 'agent-cache', transcript: '', readState: 'ok' },
      { source: 'session-store', transcript: 'user: ANCIEN-DISQUE', readState: 'ok' },
      { source: 'companion-history', transcript: '', readState: 'ok' },
      { source: 'local-map', transcript: '', readState: 'ok' },
    ];
    const outcome = await applyChannelMessagingSessionReset({
      sessionKey,
      now,
      policy: policy({ mode: 'idle', idleMinutes: 10 }),
      snapshot: snapshot(now - 11 * 60_000, 'user: ANCIEN-DISQUE'),
      parts,
      archiveDir: dir,
      resetSession: async () => {
        reset = true;
      },
    });
    expect(reset, 'vide lu').toBe(true);
    expect(outcome.action).toBe('reset');
    expect(readMessagingMemoryArchive(dir, sessionKey, 'agent-cache')).toContain('"transcript": ""');
    expect(readMessagingMemoryArchive(dir, sessionKey, 'session-store')).toContain('user: ANCIEN-DISQUE');
  });

  it.runIf(process.platform !== 'win32')('P5 un vidage compagnon non écrit ne réussit pas et l ancien texte revient', () => {
    const dir = tempDir();
    const env = {
      CODEBUDDY_CHANNEL_HISTORY: 'true',
      CODEBUDDY_CHANNEL_HISTORY_DIR: dir,
    };
    rememberCompanionChannelTurn('telegram:p5', 'bonjour', 'ANCIEN-COMPAGNON', env, Date.now() - 1000);
    chmodSync(dir, 0o500);
    let failed = false;
    try {
      const result = clearCompanionChannelHistory('telegram:p5', env, Date.now()) as { ok?: boolean } | void;
      failed = Boolean(result && typeof result === 'object' && result.ok === false);
    } catch {
      failed = true;
    } finally {
      chmodSync(dir, 0o700);
    }
    clearCompanionChannelHistoriesForTests();
    const restored = inspectCompanionChannelHistory('telegram:p5', env)?.transcript.includes('ANCIEN-COMPAGNON') === true;
    expect(failed, 'P5 vidage compagnon échoué non signalé').toBe(true);
    expect(restored, 'P5 oldRestored').toBe(true);
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

  it('P7 une session absente reste une lecture prouvee et la remise a zero peut suivre', async () => {
    const sessionsDir = tempDir();
    const archiveDir = tempDir();
    const sessionKey = 'probe-absent';
    const previousSessions = process.env.CODEBUDDY_SESSIONS_DIR;
    const previousArchive = process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
    const previousHistory = process.env.CODEBUDDY_CHANNEL_HISTORY;
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
    process.env.CODEBUDDY_CHANNEL_HISTORY = 'false';
    resetSessionStore();
    __resetChannelAIHandlerForTests();
    __seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
    const cfg = getConfigManager().getConfig() as { session_reset?: { mode?: string; idle_minutes?: number } };
    const previousPolicy = cfg.session_reset;
    cfg.session_reset = { mode: 'idle', idle_minutes: 1 };
    try {
      await __resetInboundMessagingSessionForTests(sessionKey);
      expect(readMessagingMemoryArchive(archiveDir, sessionKey, 'local-map'), 'P7 archive absente').toContain('AGENT_OLD');
      expect(readMessagingMemoryArchive(archiveDir, sessionKey, 'session-store'), 'P7 session absente archivee').toContain('"transcript": ""');
    } finally {
      cfg.session_reset = previousPolicy;
      __beforeMessagingResetEraseForTests(undefined);
      __resetChannelAIHandlerForTests();
      resetSessionStore();
      if (previousSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
      else process.env.CODEBUDDY_SESSIONS_DIR = previousSessions;
      if (previousArchive === undefined) delete process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
      else process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = previousArchive;
      if (previousHistory === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY;
      else process.env.CODEBUDDY_CHANNEL_HISTORY = previousHistory;
    }
  });

  it('P8 une session modifiee entre l archive et l effacement n est pas effacee', async () => {
    const sessionsDir = tempDir();
    const archiveDir = tempDir();
    const sessionKey = 'probe-changed';
    const sessionFile = path.join(sessionsDir, `${sessionKey}.json`);
    const previousSessions = process.env.CODEBUDDY_SESSIONS_DIR;
    const previousArchive = process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
    const previousHistory = process.env.CODEBUDDY_CHANNEL_HISTORY;
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
    process.env.CODEBUDDY_CHANNEL_HISTORY = 'false';
    resetSessionStore();
    __resetChannelAIHandlerForTests();
    const idle = new Date(Date.now() - 3_600_000).toISOString();
    const session = {
      id: sessionKey,
      name: 'probe',
      workingDirectory: sessionsDir,
      model: 'probe',
      messages: [{ type: 'user', content: 'ARCHIVED_SECRET', timestamp: idle }],
      createdAt: idle,
      lastAccessedAt: idle,
    };
    writeFileSync(sessionFile, JSON.stringify(session));
    __seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
    __beforeMessagingResetEraseForTests(() => {
      writeFileSync(sessionFile, JSON.stringify({
        ...session,
        messages: [...session.messages, { type: 'user', content: 'LATE_SECRET', timestamp: idle }],
      }));
    });
    const cfg = getConfigManager().getConfig() as { session_reset?: { mode?: string; idle_minutes?: number } };
    const previousPolicy = cfg.session_reset;
    cfg.session_reset = { mode: 'idle', idle_minutes: 1 };
    try {
      await __resetInboundMessagingSessionForTests(sessionKey);
      const archived = readMessagingMemoryArchive(archiveDir, sessionKey, 'session-store');
      expect(archived, 'P8 archive ecrite avant la modification').toContain('ARCHIVED_SECRET');
      expect(archived, 'P8 le message tardif n est pas archive').not.toContain('LATE_SECRET');
      expect(readFileSync(sessionFile, 'utf8'), 'P8 message tardif efface sans archive').toContain('LATE_SECRET');
    } finally {
      cfg.session_reset = previousPolicy;
      __beforeMessagingResetEraseForTests(undefined);
      __resetChannelAIHandlerForTests();
      resetSessionStore();
      if (previousSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
      else process.env.CODEBUDDY_SESSIONS_DIR = previousSessions;
      if (previousArchive === undefined) delete process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
      else process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = previousArchive;
      if (previousHistory === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY;
      else process.env.CODEBUDDY_CHANNEL_HISTORY = previousHistory;
    }
  });

  it('P8 un historique compagnon modifie entre l archive et l effacement n est pas efface', async () => {
    const historyDir = tempDir();
    const archiveDir = tempDir();
    const sessionsDir = tempDir();
    const sessionKey = 'probe-companion-changed';
    const env = {
      CODEBUDDY_CHANNEL_HISTORY: 'true',
      CODEBUDDY_CHANNEL_HISTORY_DIR: historyDir,
    };
    const previousSessions = process.env.CODEBUDDY_SESSIONS_DIR;
    const previousArchive = process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
    const previousHistory = process.env.CODEBUDDY_CHANNEL_HISTORY;
    const previousHistoryDir = process.env.CODEBUDDY_CHANNEL_HISTORY_DIR;
    process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
    process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
    process.env.CODEBUDDY_CHANNEL_HISTORY = 'true';
    process.env.CODEBUDDY_CHANNEL_HISTORY_DIR = historyDir;
    resetSessionStore();
    __resetChannelAIHandlerForTests();
    clearCompanionChannelHistoriesForTests();
    rememberCompanionChannelTurn(sessionKey, 'bonjour', 'HISTORY_ARCHIVED', env, Date.now() - 3_600_000);
    const historyFile = path.join(historyDir, readdirSync(historyDir).find((name) => name.endsWith('.json')) ?? '');
    __seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
    __beforeMessagingResetEraseForTests(() => {
      rememberCompanionChannelTurn(sessionKey, 'encore', 'HISTORY_LATE', env, Date.now());
    });
    const cfg = getConfigManager().getConfig() as { session_reset?: { mode?: string; idle_minutes?: number } };
    const previousPolicy = cfg.session_reset;
    cfg.session_reset = { mode: 'idle', idle_minutes: 1 };
    try {
      await __resetInboundMessagingSessionForTests(sessionKey);
      const archived = readMessagingMemoryArchive(archiveDir, sessionKey, 'companion-history');
      expect(archived, 'P8 archive compagnon ecrite avant la modification').toContain('HISTORY_ARCHIVED');
      expect(archived, 'P8 le tour compagnon tardif n est pas archive').not.toContain('HISTORY_LATE');
      expect(readFileSync(historyFile, 'utf8'), 'P8 tour compagnon tardif efface sans archive').toContain('HISTORY_LATE');
    } finally {
      cfg.session_reset = previousPolicy;
      __beforeMessagingResetEraseForTests(undefined);
      __resetChannelAIHandlerForTests();
      clearCompanionChannelHistoriesForTests();
      resetSessionStore();
      if (previousSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
      else process.env.CODEBUDDY_SESSIONS_DIR = previousSessions;
      if (previousArchive === undefined) delete process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
      else process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = previousArchive;
      if (previousHistory === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY;
      else process.env.CODEBUDDY_CHANNEL_HISTORY = previousHistory;
      if (previousHistoryDir === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY_DIR;
      else process.env.CODEBUDDY_CHANNEL_HISTORY_DIR = previousHistoryDir;
    }
  });

  it.runIf(process.platform !== 'win32')(
    'P7 une session illisible puis relisible n est pas archivee vide ni effacee',
    async () => {
      const sessionsDir = tempDir();
      const archiveDir = tempDir();
      const sessionKey = 'probe-store';
      const sessionFile = path.join(sessionsDir, `${sessionKey}.json`);
      const previousSessions = process.env.CODEBUDDY_SESSIONS_DIR;
      const previousArchive = process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
      const previousHistory = process.env.CODEBUDDY_CHANNEL_HISTORY;
      process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
      process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
      process.env.CODEBUDDY_CHANNEL_HISTORY = 'false';
      resetSessionStore();
      __resetChannelAIHandlerForTests();
      const now = new Date().toISOString();
      writeFileSync(sessionFile, JSON.stringify({
        id: sessionKey,
        name: 'probe',
        workingDirectory: sessionsDir,
        model: 'probe',
        messages: [{ type: 'user', content: 'STORE_SECRET', timestamp: now }],
        createdAt: now,
        lastAccessedAt: now,
      }));
      chmodSync(sessionFile, 0o000);
      __seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
      __beforeMessagingResetEraseForTests(() => {
        chmodSync(sessionFile, 0o600);
      });
      const cfg = getConfigManager().getConfig() as { session_reset?: { mode?: string; idle_minutes?: number } };
      const previousPolicy = cfg.session_reset;
      cfg.session_reset = { mode: 'idle', idle_minutes: 1 };
      try {
        await __resetInboundMessagingSessionForTests(sessionKey);
        chmodSync(sessionFile, 0o600);
        const raw = readFileSync(sessionFile, 'utf8');
        expect(raw, 'P7 secret session conserve').toContain('STORE_SECRET');
        expect(raw.includes('"messages":[]') || raw.includes('"messages": []'), 'P7 messages effaces').toBe(false);
        const archived = readMessagingMemoryArchive(archiveDir, sessionKey, 'session-store');
        expect(archived, 'P7 archive vide du secret').not.toContain('STORE_SECRET');
        expect(archived.includes('"transcript": ""') || archived.includes('"transcript":""'), 'P7 archive session vide').toBe(false);
      } finally {
        try { chmodSync(sessionFile, 0o600); } catch { /* deja lisible */ }
        cfg.session_reset = previousPolicy;
        __beforeMessagingResetEraseForTests(undefined);
        __resetChannelAIHandlerForTests();
        resetSessionStore();
        if (previousSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
        else process.env.CODEBUDDY_SESSIONS_DIR = previousSessions;
        if (previousArchive === undefined) delete process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
        else process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = previousArchive;
        if (previousHistory === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY;
        else process.env.CODEBUDDY_CHANNEL_HISTORY = previousHistory;
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'P7 un historique compagnon illisible et un cache vide ne sont pas effaces',
    async () => {
      const historyDir = tempDir();
      const archiveDir = tempDir();
      const sessionsDir = tempDir();
      const sessionKey = 'probe-companion';
      const env = {
        CODEBUDDY_CHANNEL_HISTORY: 'true',
        CODEBUDDY_CHANNEL_HISTORY_DIR: historyDir,
      };
      const previousSessions = process.env.CODEBUDDY_SESSIONS_DIR;
      const previousArchive = process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
      const previousHistory = process.env.CODEBUDDY_CHANNEL_HISTORY;
      const previousHistoryDir = process.env.CODEBUDDY_CHANNEL_HISTORY_DIR;
      process.env.CODEBUDDY_SESSIONS_DIR = sessionsDir;
      process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = archiveDir;
      process.env.CODEBUDDY_CHANNEL_HISTORY = 'true';
      process.env.CODEBUDDY_CHANNEL_HISTORY_DIR = historyDir;
      resetSessionStore();
      __resetChannelAIHandlerForTests();
      clearCompanionChannelHistoriesForTests();
      rememberCompanionChannelTurn(sessionKey, 'bonjour', 'HISTORY_SECRET', env, Date.now() - 1000);
      const historyFile = path.join(historyDir, readdirSync(historyDir).find((name) => name.endsWith('.json')) ?? '');
      clearCompanionChannelHistoriesForTests();
      chmodSync(historyFile, 0o000);
      __seedLocalCompanionHistoryForTests(sessionKey, 'AGENT_OLD', Date.now() - 3_600_000);
      const cfg = getConfigManager().getConfig() as { session_reset?: { mode?: string; idle_minutes?: number } };
      const previousPolicy = cfg.session_reset;
      cfg.session_reset = { mode: 'idle', idle_minutes: 1 };
      try {
        await __resetInboundMessagingSessionForTests(sessionKey);
        chmodSync(historyFile, 0o600);
        const raw = readFileSync(historyFile, 'utf8');
        expect(raw, 'P7 secret compagnon conserve').toContain('HISTORY_SECRET');
        const archived = readMessagingMemoryArchive(archiveDir, sessionKey, 'companion-history');
        expect(archived, 'P7 archive compagnon du secret').not.toContain('HISTORY_SECRET');
        expect(
          archived.includes('"transcript": ""') || archived.includes('"transcript":""'),
          'P7 archive compagnon vide',
        ).toBe(false);
      } finally {
        try { chmodSync(historyFile, 0o600); } catch { /* deja lisible */ }
        cfg.session_reset = previousPolicy;
        __beforeMessagingResetEraseForTests(undefined);
        __resetChannelAIHandlerForTests();
        clearCompanionChannelHistoriesForTests();
        resetSessionStore();
        if (previousSessions === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
        else process.env.CODEBUDDY_SESSIONS_DIR = previousSessions;
        if (previousArchive === undefined) delete process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR;
        else process.env.CODEBUDDY_SESSION_RESET_ARCHIVE_DIR = previousArchive;
        if (previousHistory === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY;
        else process.env.CODEBUDDY_CHANNEL_HISTORY = previousHistory;
        if (previousHistoryDir === undefined) delete process.env.CODEBUDDY_CHANNEL_HISTORY_DIR;
        else process.env.CODEBUDDY_CHANNEL_HISTORY_DIR = previousHistoryDir;
      }
    },
  );

  it.runIf(process.platform !== 'win32')(
    'P7 le vidage compagnon ne remplace pas un fichier illisible',
    () => {
      const historyDir = tempDir();
      const sessionKey = 'probe-clear';
      const env = {
        CODEBUDDY_CHANNEL_HISTORY: 'true',
        CODEBUDDY_CHANNEL_HISTORY_DIR: historyDir,
      };
      clearCompanionChannelHistoriesForTests();
      rememberCompanionChannelTurn(sessionKey, 'bonjour', 'HISTORY_SECRET', env, Date.now() - 1000);
      const historyFile = path.join(historyDir, readdirSync(historyDir).find((name) => name.endsWith('.json')) ?? '');
      clearCompanionChannelHistoriesForTests();
      chmodSync(historyFile, 0o000);
      try {
        const cleared = clearCompanionChannelHistory(sessionKey, env, Date.now());
        expect(cleared.ok, 'P7 vidage illisible accepte').toBe(false);
        chmodSync(historyFile, 0o600);
        expect(readFileSync(historyFile, 'utf8'), 'P7 secret apres vidage refuse').toContain('HISTORY_SECRET');
      } finally {
        try { chmodSync(historyFile, 0o600); } catch { /* deja lisible */ }
        clearCompanionChannelHistoriesForTests();
      }
    },
  );
});
