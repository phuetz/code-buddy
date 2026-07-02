/**
 * Assistant-mode P4: the `remind` agent tool — the agent's proper way to set a reminder instead of
 * shelling `buddy remind add` into the recurring store (the second layer of the "train" bug). It
 * wraps addReminder, so a one-time event is a DATED one-shot and duplicates are de-duplicated.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import { RemindTool } from '../../src/tools/registry/remind-tools.js';
import { listReminders } from '../../src/companion/reminders.js';

let dir: string;
let counter = 0;
beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-remtool-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'log.jsonl');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
});

describe('RemindTool', () => {
  const tool = new RemindTool();

  it('creates a recurring reminder (no date)', async () => {
    const r = await tool.execute({ label: 'médicaments', time: '09:00' });
    expect(r.success).toBe(true);
    expect(r.output).toMatch(/médicaments.*09:00.*tous les jours/);
    expect(r.data?.oneShot).toBe(false);
    expect(await listReminders()).toHaveLength(1);
  });

  it('creates a ONE-SHOT dated reminder that retires (the train fix, agent-side)', async () => {
    const r = await tool.execute({ label: 'train', time: '10:38', date: '2026-12-25' });
    expect(r.success).toBe(true);
    expect(r.data?.oneShot).toBe(true);
    expect(r.output).toContain('le 2026-12-25');
    const stored = await listReminders();
    expect(stored[0]?.date).toBe('2026-12-25');
  });

  it('de-duplicates identical reminders (no stacking)', async () => {
    await tool.execute({ label: 'train', time: '10:38', date: '2026-12-25' });
    await tool.execute({ label: 'Train', time: '10:38', date: '2026-12-25' }); // same, case-insensitive
    expect(await listReminders()).toHaveLength(1);
  });

  it('errors on a missing label or time', async () => {
    expect((await tool.execute({ time: '09:00' })).success).toBe(false);
    expect((await tool.execute({ label: 'x' })).success).toBe(false);
  });

  it('validate rejects a bad time / date and accepts a good one', () => {
    expect(tool.validate({ label: 'x', time: '99:99' }).valid).toBe(false);
    expect(tool.validate({ label: 'x', time: '09:00', date: 'demain' }).valid).toBe(false);
    expect(tool.validate({ label: 'x', time: '09:00' }).valid).toBe(true);
    expect(tool.validate({ label: 'x', time: '09:00', date: '2026-12-25' }).valid).toBe(true);
  });

  it('exposes a schema the LLM can call', () => {
    const s = tool.getSchema();
    expect(s.name).toBe('remind');
    expect(s.parameters.required).toEqual(['label', 'time']);
    expect(Object.keys(s.parameters.properties)).toContain('date');
    expect(Object.keys(s.parameters.properties)).toContain('leadMinutes');
  });

  it('leadMinutes fires BEFORE the event and labels how far ahead', async () => {
    const r = await tool.execute({ label: 'train', time: '10:38', leadMinutes: 30 });
    expect(r.success).toBe(true);
    const stored = await listReminders();
    expect(stored[0]!.time).toBe('10:08'); // 10:38 − 30 min
    expect(stored[0]!.label).toContain('dans 30 minutes');
  });

  it('leadMinutes accepts whole hours', async () => {
    await tool.execute({ label: 'réunion', time: '10:00', leadMinutes: 120 });
    const stored = await listReminders();
    expect(stored[0]!.time).toBe('08:00');
    expect(stored[0]!.label).toContain('dans 2 heures');
  });

  it('a lead that would cross midnight keeps the event time (no lead applied)', async () => {
    const r = await tool.execute({ label: 'nuit', time: '00:15', leadMinutes: 30 });
    expect(r.success).toBe(true);
    const stored = await listReminders();
    expect(stored[0]!.time).toBe('00:15');
    expect(stored[0]!.label).not.toContain('dans');
  });

  it('validate rejects a negative leadMinutes', () => {
    expect(tool.validate({ label: 'x', time: '09:00', leadMinutes: -5 }).valid).toBe(false);
    expect(tool.validate({ label: 'x', time: '09:00', leadMinutes: 15 }).valid).toBe(true);
  });
});
