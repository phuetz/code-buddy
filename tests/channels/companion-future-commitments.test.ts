import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';
import { RemindTool } from '../../src/tools/registry/remind-tools.js';
import { loadReminders, removeReminder } from '../../src/companion/reminders.js';
import type { CompanionIdentity } from '../../src/companion/companion-identity.js';

const owner: CompanionIdentity = { role: 'owner', channel: 'telegram', confidence: 'high', reason: 'test' };
const guest: CompanionIdentity = { role: 'guest', channel: 'telegram', confidence: 'none', reason: 'test' };
const previous = process.env.CODEBUDDY_REMINDERS_FILE;
let scratch: string | undefined;

afterEach(async () => {
  if (previous === undefined) delete process.env.CODEBUDDY_REMINDERS_FILE;
  else process.env.CODEBUDDY_REMINDERS_FILE = previous;
  if (scratch) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function reply(content: string) {
  return { model: 'm', choices: [{ message: { role: 'assistant' as const, content }, finish_reason: 'stop' }] };
}

describe('channel future commitment gate', () => {
  it('guards a no-tool guest reply by default before storing it', async () => {
    const base = {
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user' as const, content: 'Et le traitement ?' }],
      identity: guest,
      chat: async () => reply('Je vais surveiller ce traitement.'),
    };
    const off = await runCompanionChannelTurn({ ...base, env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'false' } });
    const on = await runCompanionChannelTurn({ ...base, env: {} });
    expect(off.text).toBe('Je vais surveiller ce traitement.');
    expect(on.text).toBe('Je ne surveille pas cela pour le moment.');
  });

  it('allows a reminder only after readback, then it is listable and cancellable', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'lisa-engagements-'));
    process.env.CODEBUDDY_REMINDERS_FILE = join(scratch, 'reminders.json');
    let round = 0;
    const result = await runCompanionChannelTurn({
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user', content: 'Rappelle-moi le train à 09:00.' }],
      identity: owner,
      env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'true', CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      executeTool: async (name, args) => new RemindTool().execute(args),
      chat: async () => {
        round += 1;
        if (round === 1) return {
          model: 'm', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
            id: 'call-r', type: 'function', function: { name: 'remind', arguments: JSON.stringify({ label: 'train', time: '09:00' }) },
          }] }, finish_reason: 'tool_calls' }],
        };
        return reply('Je te rappellerai le train.');
      },
    });
    const saved = await loadReminders();
    expect(saved).toHaveLength(1);
    expect(result.text).toContain(saved[0]!.id);
    expect(result.text).toMatch(/liste des rappels.*supprimer le rappel/i);
    expect(await removeReminder(saved[0]!.id)).toBe(true);
    expect(await loadReminders()).toHaveLength(0);
  });

  it('does not trust a successful-looking tool response without a stored task', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'lisa-engagements-'));
    process.env.CODEBUDDY_REMINDERS_FILE = join(scratch, 'reminders.json');
    let round = 0;
    const result = await runCompanionChannelTurn({
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user', content: 'Rappelle-moi le train.' }],
      identity: owner,
      env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'true', CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      executeTool: async () => ({ success: true, output: 'Reminder set', data: { id: 'r-faux', label: 'train' } }),
      chat: async () => {
        round += 1;
        return round === 1 ? {
          model: 'm', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
            id: 'call-r', type: 'function', function: { name: 'remind', arguments: JSON.stringify({ label: 'train', time: '09:00' }) },
          }] }, finish_reason: 'tool_calls' }],
        } : reply('Je te rappellerai le train.');
      },
    });
    expect(result.text).toBe('Échec : remind (résultat non confirmé).');
    expect(result.historySuffix ?? '').not.toContain('[Rappel créé');
  });

  it('does not say a reminder is done when its tool failed and the model is silent', async () => {
    let round = 0;
    const result = await runCompanionChannelTurn({
      apiKey: 'k', baseUrl: 'http://localhost', model: 'm',
      messages: [{ role: 'user', content: 'Rappelle-moi le train.' }],
      identity: owner,
      env: { CODEBUDDY_LISA_FUTURE_COMMITMENTS: 'true', CODEBUDDY_COMPANION_TOOLS_ENABLED: 'true' },
      executeTool: async () => ({ success: false, error: 'store unavailable' }),
      chat: async () => {
        round += 1;
        return round === 1 ? {
          model: 'm', choices: [{ message: { role: 'assistant', content: '', tool_calls: [{
            id: 'call-r', type: 'function', function: { name: 'remind', arguments: JSON.stringify({ label: 'train', time: '09:00' }) },
          }] }, finish_reason: 'tool_calls' }],
        } : reply('');
      },
    });
    expect(result.text).toBe('Échec : remind (store unavailable).');
    expect(result.historySuffix ?? '').not.toContain('[Rappel créé');
  });
});
