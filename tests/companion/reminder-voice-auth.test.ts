import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCompanionIdentity } from '../../src/companion/companion-identity.js';
import {
  addReminder,
  listReminders,
  openAck,
  resetAcks,
  resetUndo,
  noteCreatedForUndo,
  whenRemindersPersisted,
  bypassesAddressGate,
} from '../../src/companion/reminders.js';
import { createReminderVoiceCoordinator } from '../../src/companion/reminder-voice-auth.js';
import { reminderVoiceCoordinator } from '../../src/companion/reminder-voice-auth.js';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';

const NOW = new Date('2026-09-26T08:00:00.000Z').getTime();
const voice = resolveCompanionIdentity({ channel: 'voice', isVoicePresence: true, robotNamed: true });
const owner = resolveCompanionIdentity({
  channel: 'telegram', chatId: 'owner-chat', senderId: 'owner-chat',
  env: { CODEBUDDY_SENSORY_ALERT_CHAT: 'owner-chat' },
});
const guest = resolveCompanionIdentity({ channel: 'telegram', chatId: 'visitor-chat', env: {} });
const groupGuest = resolveCompanionIdentity({
  channel: 'telegram', chatId: 'owner-chat', senderId: 'visitor',
  env: { CODEBUDDY_SENSORY_ALERT_CHAT: 'owner-chat' },
});
const pwaOwner = resolveCompanionIdentity({
  channel: 'pwa', userId: 'owner-user', env: { CODEBUDDY_OWNER_USER_ID: 'owner-user' },
});

let dir: string;
let speak: ReturnType<typeof vi.fn>;
let notifyOwner: ReturnType<typeof vi.fn>;
let coordinator: ReturnType<typeof createReminderVoiceCoordinator>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reminder-voice-auth-'));
  process.env.CODEBUDDY_REMINDERS_FILE = join(dir, 'reminders.json');
  process.env.CODEBUDDY_REMINDER_LOG_FILE = join(dir, 'reminder-log.jsonl');
  process.env.CODEBUDDY_REMINDER_SNOOZE_FILE = join(dir, 'snoozes.json');
  resetAcks();
  resetUndo();
  speak = vi.fn(async () => undefined);
  notifyOwner = vi.fn(async () => true);
  coordinator = createReminderVoiceCoordinator({ now: () => NOW, code: () => 'a1b2c3d4e5f6' });
});

afterEach(async () => {
  await whenRemindersPersisted();
  resetAcks();
  resetUndo();
  await rm(dir, { recursive: true, force: true });
  delete process.env.CODEBUDDY_REMINDERS_FILE;
  delete process.env.CODEBUDDY_REMINDER_LOG_FILE;
  delete process.env.CODEBUDDY_REMINDER_SNOOZE_FILE;
});

const deps = () => ({ identity: voice, robotName: 'Lisa', speak, notifyOwner });

describe('spoken reminder authorization', () => {
  it('ignores a TV greeting followed by an unaddressed reminder; no daily alert is armed', async () => {
    expect(await coordinator.handleVoice('rappelle-moi mes médicaments à 9h', deps())).toBe(true);
    expect(await listReminders()).toEqual([]);
    expect(notifyOwner).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it('does not treat a third-person mention or a similar word as a command to Lisa', async () => {
    expect(await coordinator.handleVoice('Lisa est partie et rappelle-moi mes médicaments à 9h', deps())).toBe(true);
    expect(await coordinator.handleVoice('Lise, rappelle-moi mes médicaments à 9h', deps())).toBe(true);
    expect(await listReminders()).toEqual([]);
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('keeps an addressed owner request usable through fresh authenticated confirmation', async () => {
    expect(await coordinator.handleVoice('Lisa, rappelle-moi mes médicaments à 9h', deps())).toBe(true);
    expect(await listReminders()).toEqual([]);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(await coordinator.confirm('confirme rappel a1b2c3d4e5f6', guest)).toMatchObject({ handled: true, success: false });
    expect(await listReminders()).toEqual([]);
    expect(await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).toMatchObject({ handled: true, success: true });
    expect((await listReminders())[0]).toMatchObject({ label: 'médicaments', time: '09:00', enabled: true });
    expect(await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).toMatchObject({ handled: true, success: false });
  });

  it('does not let a member of the alert group confirm for the owner', async () => {
    await coordinator.handleVoice('Lisa, rappelle-moi mes médicaments à 9h', deps());
    expect(groupGuest.role).toBe('owner'); // chat-level classification is insufficient here
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', groupGuest)).success).toBe(false);
    expect(await listReminders()).toEqual([]);
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).success).toBe(true);
  });

  it.each(["c'est fait", 'dans 10 minutes'])('does not mutate a pending medicine reminder from bare %s', async (phrase) => {
    const reminder = await addReminder({ label: 'médicaments', time: '09:00', now: new Date(NOW) });
    openAck(reminder, NOW);
    expect(bypassesAddressGate(phrase, NOW)).toBe(false);
    expect(await coordinator.handleVoice(phrase, deps())).toBe(true);
    expect(notifyOwner).not.toHaveBeenCalled();
    expect((await listReminders())[0]?.lastDoneAt).toBeUndefined();
  });

  it('does not remove a fresh reminder when the TV says annule', async () => {
    const reminder = await addReminder({ label: 'médicaments', time: '09:00', now: new Date(NOW) });
    noteCreatedForUndo(reminder, NOW);
    expect(bypassesAddressGate('annule', NOW)).toBe(false);
    expect(await coordinator.handleVoice('annule', deps())).toBe(true);
    expect((await listReminders()).map((item) => item.id)).toContain(reminder.id);
  });

  it('refuses a stale acknowledgement if the same reminder fires again before confirmation', async () => {
    const reminder = await addReminder({ label: 'médicaments', time: '09:00', now: new Date(NOW) });
    openAck(reminder, NOW);
    await coordinator.handleVoice("Lisa, c'est fait", deps());
    openAck(reminder, NOW + 1);
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).success).toBe(false);
    expect((await listReminders())[0]?.lastDoneAt).toBeUndefined();
  });

  it('lets the owner acknowledge, defer and cancel addressed requests after authentication', async () => {
    const reminder = await addReminder({ label: 'médicaments', time: '09:00', now: new Date(NOW) });
    openAck(reminder, NOW);
    await coordinator.handleVoice("Lisa, c'est fait", deps());
    expect((await listReminders())[0]?.lastDoneAt).toBeUndefined();
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).success).toBe(true);
    expect((await listReminders())[0]?.lastDoneAt).toBeDefined();

    openAck(reminder, NOW);
    await coordinator.handleVoice('Lisa, dans 10 minutes', deps());
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).success).toBe(true);

    noteCreatedForUndo(reminder, NOW);
    await coordinator.handleVoice('Lisa, annule', deps());
    expect((await coordinator.confirm('confirme rappel a1b2c3d4e5f6', owner)).success).toBe(true);
    expect(await listReminders()).toEqual([]);
  });

  it('routes the authenticated channel reply through the live confirmation entry', async () => {
    await reminderVoiceCoordinator.handleVoice('Lisa, rappelle-moi le train à 10h', deps());
    const prompt = notifyOwner.mock.calls[0]?.[0] as string;
    const token = prompt.match(/confirme rappel ([a-f0-9]{12})/)?.[1];
    expect(token).toBeDefined();
    const chat = vi.fn(async () => { throw new Error('LLM must not see confirmation tokens'); });
    const baseTurn = {
      apiKey: 'unused', baseUrl: 'http://invalid.test', model: 'test',
      messages: [{ role: 'user' as const, content: 'confirme rappel ' + token }],
      surface: 'telegram', env: { CODEBUDDY_REMINDERS: 'true' }, chat,
    };
    const denied = await runCompanionChannelTurn({ ...baseTurn, identity: guest });
    expect(denied.text).toContain('refusée');
    expect(await listReminders()).toEqual([]);
    const result = await runCompanionChannelTurn({
      ...baseTurn, identity: owner,
    });
    expect(result.text).toContain('train');
    expect(chat).not.toHaveBeenCalled();
    expect((await listReminders())[0]?.label).toBe('le train');
  });

  it('also accepts a verified PWA owner and rejects an expired request', async () => {
    let clock = NOW;
    const gate = createReminderVoiceCoordinator({ now: () => clock, code: () => 'a1b2c3d4e5f6' });
    await gate.handleVoice('Lisa, rappelle-moi le train à 10h', deps());
    clock += 120_000;
    expect((await gate.confirm('confirme rappel a1b2c3d4e5f6', pwaOwner)).success).toBe(false);
    expect(await listReminders()).toEqual([]);
    clock += 1;
    await gate.handleVoice('Lisa, rappelle-moi le train à 10h', deps());
    expect((await gate.confirm('confirme rappel a1b2c3d4e5f6', pwaOwner)).success).toBe(true);
  });
});
