/**
 * `buddy sensory status` — Commander parseAsync + exitOverride, isolated HOME.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerSensoryCommand } from '../../src/commands/cli/sensory-command.js';
import { writeJsonAtomicSync } from '../../src/utils/atomic-write.js';
import type { SensoryStatusSnapshot } from '../../src/sensory/sensory-status.js';

const QA = join(process.cwd(), '_qa/grok-v2/sensory-status-cli');

function createProgram(write: (msg: string) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerSensoryCommand(program, write);
  return program;
}

async function run(
  args: string[],
): Promise<{ out: string; exitCode: number | undefined }> {
  const chunks: string[] = [];
  const previous = process.exitCode;
  process.exitCode = undefined;
  const program = createProgram((msg) => {
    chunks.push(msg);
  });
  await program.parseAsync(['node', 'buddy', ...args]);
  const exitCode = process.exitCode;
  process.exitCode = previous;
  return { out: chunks.join('\n'), exitCode };
}

const originalHome = process.env.HOME;
const originalStatus = process.env.CODEBUDDY_SENSORY_STATUS_FILE;
const originalRules = process.env.CODEBUDDY_SENSORY_RULES_FILE;
const originalRuns = process.env.CODEBUDDY_RULE_RUNS_FILE;
const originalFlags: Array<[string, string | undefined]> = [];

function snapshotFile(): string {
  return join(QA, 'sensory-status.json');
}
function rulesFile(): string {
  return join(QA, 'sensory-rules.json');
}
function runsFile(): string {
  return join(QA, 'rule-runs.jsonl');
}

beforeEach(async () => {
  await rm(QA, { recursive: true, force: true });
  await mkdir(QA, { recursive: true });
  process.env.HOME = QA;
  process.env.CODEBUDDY_SENSORY_STATUS_FILE = snapshotFile();
  process.env.CODEBUDDY_SENSORY_RULES_FILE = rulesFile();
  process.env.CODEBUDDY_RULE_RUNS_FILE = runsFile();
  for (const key of [
    'CODEBUDDY_SENSORY',
    'CODEBUDDY_SYSTEM_VITALS',
    'CODEBUDDY_SCHEDULE_TICKS',
    'CODEBUDDY_DOMAIN_EVENTS',
    'CODEBUDDY_SENSORY_RULES',
    'CODEBUDDY_HEARTBEAT_FALLBACK',
  ]) {
    originalFlags.push([key, process.env[key]]);
    delete process.env[key];
  }
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalStatus === undefined) delete process.env.CODEBUDDY_SENSORY_STATUS_FILE;
  else process.env.CODEBUDDY_SENSORY_STATUS_FILE = originalStatus;
  if (originalRules === undefined) delete process.env.CODEBUDDY_SENSORY_RULES_FILE;
  else process.env.CODEBUDDY_SENSORY_RULES_FILE = originalRules;
  if (originalRuns === undefined) delete process.env.CODEBUDDY_RULE_RUNS_FILE;
  else process.env.CODEBUDDY_RULE_RUNS_FILE = originalRuns;
  for (const [key, value] of originalFlags.splice(0)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(QA, { recursive: true, force: true });
});

describe('buddy sensory status', () => {
  it('without a state file: says serveur non joignable and default flags off', async () => {
    const { out, exitCode } = await run(['sensory', 'status']);
    expect(out).toContain('serveur non joignable');
    expect(out).toContain('SENSORY=off');
    expect(out).toContain('SYSTEM_VITALS=off');
    expect(out).toContain('HEARTBEAT_FALLBACK=off');
    expect(out).toContain('Battement : aucun');
    expect(exitCode).toBeUndefined();
  });

  it('--json reports serverReachable false and source aucun', async () => {
    const { out } = await run(['sensory', 'status', '--json']);
    const json = JSON.parse(out) as {
      serverReachable: boolean;
      serverMessage: string;
      heartbeat: { source: string };
      flags: { SENSORY: boolean };
    };
    expect(json.serverReachable).toBe(false);
    expect(json.serverMessage).toBe('serveur non joignable sur http://127.0.0.1:3000');
    expect(json.heartbeat.source).toBe('aucun');
    expect(json.flags.SENSORY).toBe(false);
  });

  it('reads a live snapshot: flags, rust beat age, treatments, last 5 percepts', async () => {
    const now = Date.now();
    const snap: SensoryStatusSnapshot = {
      pid: process.pid,
      startedAt: now - 60_000,
      updatedAt: now - 2_000,
      flags: {
        SENSORY: true,
        SYSTEM_VITALS: true,
        SCHEDULE_TICKS: true,
        DOMAIN_EVENTS: false,
        RULES: true,
        HEARTBEAT_FALLBACK: true,
      },
      heartbeat: { source: 'rust', lastBeatAt: now - 3_000, beat: 42 },
      treatments: [
        { name: 'system-vitals', everyBeats: 30 },
        { name: 'schedule-ticks', everyBeats: 20 },
      ],
      recent: [
        { modality: 'system', kind: 'resource_threshold', receivedAt: now - 5_000, payload: { rssMb: 1 } },
        { modality: 'time', kind: 'tick', receivedAt: now - 4_000, payload: { hhmm: '21:00' } },
      ],
    };
    writeJsonAtomicSync(snapshotFile(), snap, { mode: 0o600 });

    const { out } = await run(['sensory', 'status']);
    expect(out).toContain(`serveur pid ${process.pid} en cours`);
    expect(out).toContain('SENSORY=on');
    expect(out).toContain('SYSTEM_VITALS=on');
    expect(out).toContain('DOMAIN_EVENTS=off');
    expect(out).toContain('HEARTBEAT_FALLBACK=on');
    expect(out).toMatch(/Battement : rust \(dernier beat il y a \d+ s\)/);
    expect(out).toContain('system-vitals  every 30');
    expect(out).toContain('schedule-ticks  every 20');
    expect(out).toContain('system/resource_threshold');
    expect(out).toContain('time/tick');
  });

  it('dead pid: serveur non joignable but still prints the last snapshot', async () => {
    const now = Date.now();
    const snap: SensoryStatusSnapshot = {
      pid: 1_000_000_007,
      startedAt: now - 10_000,
      updatedAt: now - 8_000,
      flags: {
        SENSORY: true,
        SYSTEM_VITALS: false,
        SCHEDULE_TICKS: false,
        DOMAIN_EVENTS: false,
        RULES: false,
        HEARTBEAT_FALLBACK: false,
      },
      heartbeat: { source: 'fallback', lastBeatAt: now - 8_000, beat: 3 },
      treatments: [{ name: 'pacemaker-tick', everyBeats: 10 }],
      recent: [],
    };
    writeJsonAtomicSync(snapshotFile(), snap, { mode: 0o600 });
    const { out } = await run(['sensory', 'status']);
    expect(out).toContain('serveur non joignable');
    expect(out).toContain('SENSORY=on');
    expect(out).toContain('Battement : fallback');
    expect(out).toContain('pacemaker-tick');
  });

  it('lists loaded rules with enabled flag and last fire from rule-runs.jsonl', async () => {
    writeJsonAtomicSync(
      rulesFile(),
      [
        {
          id: 'tpl-process-runaway-alert',
          name: 'process-runaway-alert',
          enabled: true,
          match: { kind: 'process_runaway' },
          action: { type: 'alert', message: 'runaway' },
        },
        {
          id: 'tpl-disk-low-alert',
          name: 'disk-low-alert',
          enabled: false,
          match: { kind: 'disk_low' },
          action: { type: 'alert', message: 'disk' },
        },
      ],
      { mode: 0o600 },
    );
    const older = Date.now() - 120_000;
    const newer = Date.now() - 40_000;
    await writeFile(
      runsFile(),
      `${JSON.stringify({ ts: older, rule: 'tpl-process-runaway-alert', action: 'alert', ok: true })}\n` +
        `${JSON.stringify({ ts: newer, rule: 'tpl-process-runaway-alert', action: 'alert', ok: true })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );

    const { out } = await run(['sensory', 'status']);
    expect(out).toMatch(/process-runaway-alert\s+activée\s+dernier déclenchement il y a \d+ s/);
    expect(out).toContain('disk-low-alert  désactivée  jamais déclenchée');
  });

  it('unknown action: usage + exitCode 1', async () => {
    const { out, exitCode } = await run(['sensory', 'start']);
    expect(out).toContain('Usage: buddy sensory status [--server-url <url>] [--json]');
    expect(exitCode).toBe(1);
  });

  it('buddy sensory (no action) defaults to status', async () => {
    const { out, exitCode } = await run(['sensory']);
    expect(out).toContain('serveur non joignable');
    expect(exitCode).toBeUndefined();
  });
});
