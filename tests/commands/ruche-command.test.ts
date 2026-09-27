import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRucheCommand } from '../../src/commands/cli/ruche-command.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(() => `${'a'.repeat(40)}\n`),
}));

describe('buddy ruche JSON CLI', () => {
  let profile: string;

  beforeEach(() => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ruche-cli-'));
    const arbiter = generateKeyPairSync('ed25519');
    vi.stubEnv('CODEBUDDY_HOME', profile);
    vi.stubEnv('CODEBUDDY_RUCHE', 'true');
    vi.stubEnv('CODEBUDDY_RUCHE_ARBITER_PUBLIC_KEY',
      arbiter.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = 0;
    fs.rmSync(profile, { recursive: true, force: true });
  });

  it('fails closed in JSON without touching the local profile when disabled', async () => {
    vi.stubEnv('CODEBUDDY_RUCHE', '');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
    const program = new Command();
    registerRucheCommand(program);
    await program.parseAsync(['node', 'buddy', 'ruche', 'status']);
    expect(JSON.parse(errors[0]!)).toEqual({ ok: false, error: 'RUCHE_DISABLED' });
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ['heartbeat', ['heartbeat', 'lane-a'], 'heartbeat'],
    ['bail --request-only', ['bail', 'work-a', '--request-only'], 'lease.request'],
    ['liberer --request-only', ['liberer', 'work-a', '1', '--request-only'], 'lease.release.request'],
    ['renouveler --request-only', ['renouveler', 'work-a', '1', '--request-only'], 'lease.renew.request'],
    ['verdict', ['verdict', 'a'.repeat(40), 'test', '0', 'log.txt', 'report.txt'], 'verdict'],
  ])('persists one signed agent event for %s', async (_name, args, eventType) => {
    const log = path.join(profile, 'log.txt');
    const report = path.join(profile, 'report.txt');
    fs.writeFileSync(log, 'PASS assertion');
    fs.writeFileSync(report, 'Rapport');
    const commandArgs = args.map((arg) => arg === 'log.txt' ? log : arg === 'report.txt' ? report : arg);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
    const program = new Command();
    registerRucheCommand(program);
    await program.parseAsync(['node', 'buddy', 'ruche', ...commandArgs]);
    expect(errors, 'no CLI error').toEqual([]);
    expect(process.exitCode ?? 0, 'successful CLI exit').toBe(0);
    expect(JSON.parse(lines[0]!), 'CLI confirms the event').toMatchObject({
      ok: true, data: { type: eventType },
    });
    const events = fs.readFileSync(path.join(profile, 'ruche', 'events.jsonl'), 'utf8')
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; signature: string });
    expect(events, 'exactly one persisted signed event').toHaveLength(1);
    expect(events[0]!.type).toBe(eventType);
    expect(events[0]!.signature).toBeTruthy();
  });
});
