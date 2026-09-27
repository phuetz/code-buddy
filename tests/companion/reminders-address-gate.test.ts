import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';

import {
  bypassesAddressGate,
  isReminderVoiceCommand,
  openAck,
  parseVoiceReminder,
  resetAcks,
  whenRemindersPersisted,
} from '../../src/companion/reminders.js';

// Before this rule, any agenda phrase or reminder-creation phrase skipped the
// "am I being addressed?" gate. On 2026-09-22/23 the radio ("…l'intelligence à
// venir", France Inter) made the robot recite the agenda twice.
let dir: string;
let counter = 0;

beforeEach(() => {
  dir = path.join(os.tmpdir(), `cb-rem-gate-${process.pid}-${counter++}`);
  process.env.CODEBUDDY_REMINDERS_FILE = path.join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = path.join(dir, 'reminder-log.jsonl');
  process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS = '300000';
  resetAcks();
});

afterEach(async () => {
  await whenRemindersPersisted();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_ACK_WINDOW_MS;
});

describe('reminder phrases and the address gate', () => {
  it.each([
    "sur France Inter, le vrai risque de l'intelligence à venir",
    "Qu'est-ce que j'ai fait de mes clés ?",
  ])('an agenda-looking phrase no longer skips the gate: %s', (phrase) => {
    expect(isReminderVoiceCommand(phrase)).toBe(true); // still served when addressed
    expect(bypassesAddressGate(phrase, Date.now())).toBe(false);
  });

  it('a reminder-creation phrase no longer skips the gate', () => {
    const phrase = 'la note de restaurant à 20h était salée';
    expect(parseVoiceReminder(phrase)).not.toBeNull(); // still parsed when addressed
    expect(bypassesAddressGate(phrase, Date.now())).toBe(false);
  });

  it('an acknowledgement of a reminder that just fired still needs an address and owner confirmation', () => {
    const now = Date.now();
    openAck({ id: 'r1', label: 'médicaments' }, now);
    expect(bypassesAddressGate("c'est fait", now)).toBe(false);
  });

  it('a question is never taken as an acknowledgement', () => {
    const now = Date.now();
    openAck({ id: 'r1', label: 'médicaments' }, now);
    expect(bypassesAddressGate("le rapport c'est fait ?", now)).toBe(false);
  });

  it('nothing skips the gate when no reminder is pending', () => {
    expect(bypassesAddressGate("c'est fait", Date.now())).toBe(false);
    expect(bypassesAddressGate('dans 10 minutes', Date.now())).toBe(false);
  });
});
