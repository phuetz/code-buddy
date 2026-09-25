import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lisaPulseEnabled, observeLisaSignals, runLisaPulse, type LisaDecision, type LisaSignal } from '../../src/companion/lisa-pulse.js';

const roots: string[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-pulse-'));
  roots.push(root);
  vi.stubEnv('CODEBUDDY_LISA_PULSE', 'true');
  vi.stubEnv('CODEBUDDY_LISA_UNIFIED_CHECKPOINTS', 'true');
  vi.stubEnv('CODEBUDDY_LISA_JOURNAL', 'true');
  vi.stubEnv('CODEBUDDY_LISA_PULSE_GH', 'false');
  vi.stubEnv('CODEBUDDY_COMPANION_AWAY_HOURS', '00:00-23:59');
  vi.stubEnv('CODEBUDDY_COMPANION_AWAY_STATE_FILE', path.join(root, 'away.json'));
  return { root, statePath: path.join(root, 'pulse.json'), now: () => Date.UTC(2026, 8, 25, 12) };
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lisa pulse', () => {
  it('does not run without both opt-in switches', () => {
    expect(lisaPulseEnabled({})).toBe(false);
    expect(lisaPulseEnabled({ CODEBUDDY_LISA_PULSE: 'true' })).toBe(false);
  });

  it('records a baseline, wakes only on change, and archives silence', async () => {
    const fixture = setup();
    let signals: LisaSignal[] = [{ source: 'git', fingerprint: 'clean', summary: 'clean' }];
    const decide = vi.fn(async (): Promise<LisaDecision> => ({ kind: 'silence', reason: 'Nothing useful' }));
    const deps = { ...fixture, workspace: fixture.root, observe: async () => signals, decide };
    expect((await runLisaPulse('check', deps)).reason).toBe('Baseline recorded');
    expect((await runLisaPulse('check', deps)).reason).toBe('No new signal');
    expect(decide).not.toHaveBeenCalled();
    signals = [{ source: 'git', fingerprint: 'changed', summary: 'changed' }];
    expect((await runLisaPulse('check', deps)).reason).toBe('Nothing useful');
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('refuses emissions and initiative creating tools even if a mandate callback says allow', async () => {
    const fixture = setup();
    let signal = 'one';
    const executeAction = vi.fn(async () => ({ success: true, detail: 'executed' }));
    const authorizeAction = vi.fn(async () => ({ decision: 'allow+checkpoint' as const, mandateId: 'm-1' }));
    const deps = { ...fixture, workspace: fixture.root,
      observe: async () => [{ source: 'git', fingerprint: signal, summary: signal }],
      decide: async (): Promise<LisaDecision> => ({ kind: 'act', reason: 'proposed', action: { tool: 'cron_create', args: {}, effect: 'reversible', files: ['a.txt'] } }),
      authorizeAction, executeAction };
    await runLisaPulse('', deps);
    signal = 'two';
    expect((await runLisaPulse('', deps)).kind).toBe('decision_required');
    expect(authorizeAction).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('takes a return point before an authorized reversible action', async () => {
    const fixture = setup();
    const target = path.join(fixture.root, 'note.txt');
    fs.writeFileSync(target, 'before');
    let signal = 'one';
    const events: string[] = [];
    const deps = { ...fixture, workspace: fixture.root,
      observe: async () => [{ source: 'git', fingerprint: signal, summary: signal }],
      decide: async (): Promise<LisaDecision> => ({ kind: 'act', reason: 'edit', action: {
        tool: 'write_file', args: { path: target }, effect: 'reversible', files: [target], mandateId: 'm-1',
      } }),
      authorizeAction: async () => ({ decision: 'allow+checkpoint' as const, mandateId: 'm-1' }),
      record: (event: { kind: string }) => { events.push(event.kind); },
      executeAction: async () => { expect(events.at(-1)).toBe('action_started'); fs.writeFileSync(target, 'after'); return { success: true, detail: 'edited' }; },
    };
    await runLisaPulse('', deps);
    signal = 'two';
    const event = await runLisaPulse('', deps);
    expect(event.kind).toBe('action');
    expect(events.slice(-2)).toEqual(['action_started', 'action']);
    expect(event.checkpointId).toBeTruthy();
    expect(fs.readFileSync(target, 'utf8')).toBe('after');
  });

  it('enforces the daily wake cap and a 24-hour owner stop', async () => {
    const fixture = setup();
    let signal = 0;
    const decide = vi.fn(async (): Promise<LisaDecision> => ({ kind: 'silence', reason: 'No action' }));
    const deps = { ...fixture, workspace: fixture.root, decide,
      observe: async () => [{ source: 'git', fingerprint: String(signal), summary: 'changed' }] };
    await runLisaPulse('', deps);
    for (signal = 1; signal <= 4; signal++) await runLisaPulse('', deps);
    expect(decide).toHaveBeenCalledTimes(3);
    expect((await runLisaPulse('', deps)).reason).toBe('Daily wake cap');
    fs.writeFileSync(path.join(fixture.root, 'away.json'), JSON.stringify({ sent: [], pauseUntil: fixture.now() + 24 * 60 * 60 * 1000 }));
    expect((await runLisaPulse('', deps)).reason).toBe('Paused by owner');
  });

  it('refuses a reversible action whose declared target is not the saved file', async () => {
    const fixture = setup();
    let signal = 'one';
    const executeAction = vi.fn(async () => ({ success: true, detail: 'bad' }));
    const deps = { ...fixture, workspace: fixture.root,
      observe: async () => [{ source: 'git', fingerprint: signal, summary: signal }],
      decide: async (): Promise<LisaDecision> => ({ kind: 'act', reason: 'edit', action: {
        tool: 'write_file', effect: 'reversible', args: { path: 'actual.txt' }, files: ['other.txt'],
      } }),
      authorizeAction: vi.fn(async () => ({ decision: 'allow+checkpoint' as const })),
      executeAction,
    };
    await runLisaPulse('', deps);
    signal = 'two';
    expect((await runLisaPulse('', deps)).reason).toBe('Action target and checkpoint target differ');
    expect(deps.authorizeAction).not.toHaveBeenCalled();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it('reads fleet, reminder, agenda and mail counts without changing their snapshots', async () => {
    const fixture = setup();
    const fleet = path.join(fixture.root, 'colab-tasks.json');
    const reminders = path.join(fixture.root, 'reminders.json');
    const agenda = path.join(fixture.root, 'agenda.json');
    const mail = path.join(fixture.root, 'mail.json');
    fs.writeFileSync(fleet, JSON.stringify({ tasks: [{ id: 'a', status: 'open' }, { id: 'b', status: 'blocked' }] }));
    fs.writeFileSync(reminders, JSON.stringify([{ id: 'r', enabled: true, time: '12:00' }]));
    fs.writeFileSync(agenda, JSON.stringify([{ id: 'today' }]));
    fs.writeFileSync(mail, JSON.stringify({ count: 2 }));
    vi.stubEnv('CODEBUDDY_FLEET_COLAB_DIR', fixture.root);
    vi.stubEnv('CODEBUDDY_REMINDERS_FILE', reminders);
    vi.stubEnv('CODEBUDDY_LISA_PULSE_AGENDA_SNAPSHOT', agenda);
    vi.stubEnv('CODEBUDDY_LISA_PULSE_MAIL_COUNT_SNAPSHOT', mail);
    const before = [fleet, reminders, agenda, mail].map(file => fs.readFileSync(file, 'utf8'));
    const signals = await observeLisaSignals(fixture.root);
    expect(signals.map(signal => signal.source)).toEqual(expect.arrayContaining(['fleet', 'reminders', 'agenda', 'mail']));
    expect(signals.find(signal => signal.source === 'fleet')?.summary).toContain('1 open, 1 blocked');
    expect([fleet, reminders, agenda, mail].map(file => fs.readFileSync(file, 'utf8'))).toEqual(before);
  });
});
