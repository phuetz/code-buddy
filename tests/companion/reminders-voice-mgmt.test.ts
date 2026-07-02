/**
 * Assistant-mode P1: manage reminders BY VOICE (list / remove / disable) — so Patrice can say
 * "supprime le rappel du train" instead of needing the CLI. Parse + fuzzy match + spoken summary are
 * pure; handleReminderVoiceCommand is proven end-to-end with injected store seams (no real store).
 */
import { describe, it, expect } from 'vitest';
import {
  parseReminderCommand,
  isReminderVoiceCommand,
  matchReminderByLabel,
  describeRemindersForSpeech,
  handleReminderVoiceCommand,
  type Reminder,
} from '../../src/companion/reminders.js';

function rem(id: string, label: string, over: Partial<Reminder> = {}): Reminder {
  return { id, label, time: '09:00', enabled: true, createdAt: '2026-07-02T00:00:00Z', ...over };
}

describe('parseReminderCommand', () => {
  it('recognizes list queries', () => {
    expect(parseReminderCommand('quels sont mes rappels ?')).toEqual({ kind: 'list' });
    expect(parseReminderCommand('montre-moi mes rappels')).toEqual({ kind: 'list' });
  });
  it('recognizes remove and disable with a target', () => {
    expect(parseReminderCommand('supprime le rappel du train')).toEqual({ kind: 'remove', target: 'train' });
    expect(parseReminderCommand('oublie le rappel du dentiste')).toEqual({ kind: 'remove', target: 'dentiste' });
    expect(parseReminderCommand('désactive le rappel des médicaments')).toEqual({ kind: 'disable', target: 'medicaments' });
  });
  it('does NOT fire on a creation, an ack, or a bare verb without "rappel"', () => {
    expect(parseReminderCommand('rappelle-moi le train demain à 10h38')).toBeNull();
    expect(parseReminderCommand("c'est fait")).toBeNull();
    expect(parseReminderCommand('oublie ça')).toBeNull(); // no "rappel"
  });
  it('isReminderVoiceCommand mirrors the parser', () => {
    expect(isReminderVoiceCommand('supprime le rappel du train')).toBe(true);
    expect(isReminderVoiceCommand('rappelle-moi à 9h')).toBe(false);
  });
});

describe('matchReminderByLabel', () => {
  const list = [rem('a', 'Train 10h38 — prépare-toi à partir'), rem('b', 'médicaments du soir'), rem('c', 'appeler maman')];
  it('matches by token overlap / substring', () => {
    expect(matchReminderByLabel(list, 'train')?.id).toBe('a');
    expect(matchReminderByLabel(list, 'medicaments')?.id).toBe('b');
    expect(matchReminderByLabel(list, 'maman')?.id).toBe('c');
  });
  it('returns null when nothing overlaps', () => {
    expect(matchReminderByLabel(list, 'voiture')).toBeNull();
    expect(matchReminderByLabel(list, '')).toBeNull();
  });
});

describe('describeRemindersForSpeech', () => {
  it('handles none / one / many', () => {
    expect(describeRemindersForSpeech([])).toMatch(/aucun rappel/i);
    expect(describeRemindersForSpeech([rem('a', 'médicaments')])).toMatch(/un rappel.*médicaments.*09:00.*tous les jours/i);
    // Far date → deterministic absolute cadence ("le …") regardless of when the suite runs
    // (a near date would read back relatively, e.g. "demain").
    const many = describeRemindersForSpeech([rem('a', 'x'), rem('b', 'y', { date: '2026-12-25' })]);
    expect(many).toMatch(/2 rappels/);
    expect(many).toContain('le 2026-12-25');
  });
  it('skips disabled reminders', () => {
    expect(describeRemindersForSpeech([rem('a', 'off', { enabled: false })])).toMatch(/aucun rappel/i);
  });
});

describe('handleReminderVoiceCommand — end to end (injected store)', () => {
  it('lists reminders aloud', async () => {
    const spoken: string[] = [];
    const handled = await handleReminderVoiceCommand('quels sont mes rappels', {
      speak: async (t) => void spoken.push(t),
      list: async () => [rem('a', 'médicaments')],
    });
    expect(handled).toBe(true);
    expect(spoken[0]).toMatch(/médicaments/);
  });

  it('removes the matching reminder and confirms', async () => {
    const spoken: string[] = [];
    const removed: string[] = [];
    const handled = await handleReminderVoiceCommand('supprime le rappel du train', {
      speak: async (t) => void spoken.push(t),
      list: async () => [rem('a', 'Train 10h38 — en route'), rem('b', 'médicaments')],
      remove: async (id) => {
        removed.push(id);
        return true;
      },
    });
    expect(handled).toBe(true);
    expect(removed).toEqual(['a']); // matched the train, not the meds
    expect(spoken[0]).toMatch(/supprim/i);
  });

  it('disables the matching reminder', async () => {
    const spoken: string[] = [];
    const disabled: string[] = [];
    await handleReminderVoiceCommand('désactive le rappel des médicaments', {
      speak: async (t) => void spoken.push(t),
      list: async () => [rem('b', 'médicaments du soir')],
      disable: async (id) => {
        disabled.push(id);
        return null;
      },
    });
    expect(disabled).toEqual(['b']);
    expect(spoken[0]).toMatch(/désactiv/i);
  });

  it('speaks a "not found" line when nothing matches', async () => {
    const spoken: string[] = [];
    await handleReminderVoiceCommand('supprime le rappel de la voiture', {
      speak: async (t) => void spoken.push(t),
      list: async () => [rem('a', 'train'), rem('b', 'médicaments')],
      remove: async () => true,
    });
    expect(spoken[0]).toMatch(/je ne trouve pas/i);
  });

  it('returns false for a non-command (falls through to create/reply)', async () => {
    const handled = await handleReminderVoiceCommand('rappelle-moi le train demain à 10h38', {
      speak: async () => {},
    });
    expect(handled).toBe(false);
  });
});
