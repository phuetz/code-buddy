import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookingTimerStore, HomeModeStore } from '../../src/life-rhythm/index.js';
import { MealPlanStore } from '../../src/meals/index.js';
import {
  handleMaisonVoiceCommand,
  parseMaisonVoiceCommand,
} from '../../src/companion/maison-voice-actions.js';
import { resolveCompanionIdentity } from '../../src/companion/companion-identity.js';

const owner = { role: 'owner' as const };

describe('Maison voice actions', () => {
  let dir: string;
  let now: Date;
  let modes: HomeModeStore;
  let timers: CookingTimerStore;
  let meals: MealPlanStore;
  let speak: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'maison-voice-'));
    now = new Date('2026-07-12T10:00:00.000Z');
    modes = new HomeModeStore({ filePath: join(dir, 'mode.json'), now: () => new Date(now) });
    timers = new CookingTimerStore({ filePath: join(dir, 'timers.json'), now: () => new Date(now) });
    meals = new MealPlanStore({ filePath: join(dir, 'meal-plan.json'), now: () => new Date(now) });
    speak = vi.fn(async () => undefined);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('consumes an unauthenticated Maison command without changing state or speaking', async () => {
    const guest = resolveCompanionIdentity({ channel: 'voice', isVoicePresence: true, robotNamed: false });
    const present = resolveCompanionIdentity({ channel: 'voice', isVoicePresence: true, robotNamed: true });
    const setMode = vi.spyOn(modes, 'setMode');
    for (const identity of [undefined, guest, present]) {
      expect(await handleMaisonVoiceCommand('mode absent', {
        identity,
        speak,
        homeModeStore: modes,
        cookingTimerStore: timers,
      })).toBe(true);
    }
    expect(setMode).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    expect((await modes.getCurrent()).mode).toBe('normal');
  });

  it('runs a Maison command only after an owner identity is supplied', async () => {
    const setMode = vi.spyOn(modes, 'setMode');
    expect(await handleMaisonVoiceCommand('mode absent', {
      identity: owner,
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
    })).toBe(true);
    expect(setMode).toHaveBeenCalledOnce();
    expect((await modes.getCurrent()).mode).toBe('away');
  });

  it('parses and starts a named cooking timer without an LLM', async () => {
    expect(parseMaisonVoiceCommand('Lisa, mets un minuteur de 10 minutes pour les pâtes'))
      .toMatchObject({ kind: 'timer-start', durationMs: 600_000, label: 'pates' });
    expect(await handleMaisonVoiceCommand(
      'Lisa, mets un minuteur de 10 minutes pour les pâtes',
      { identity: owner, speak, now: () => new Date(now), homeModeStore: modes, cookingTimerStore: timers }
    )).toBe(true);
    expect((await timers.listActive(now))[0]).toMatchObject({ label: 'pates' });
    expect(speak).toHaveBeenCalledWith(expect.stringMatching(/10 minutes/));
  });

  it('sets silence until the next local midnight for “aujourd’hui”', async () => {
    await handleMaisonVoiceCommand('Silence aujourd’hui', {
      identity: owner,
      speak,
      now: () => new Date(now),
      timeZone: 'Europe/Paris',
      homeModeStore: modes,
      cookingTimerStore: timers,
    });
    const state = await modes.getCurrent();
    expect(state.mode).toBe('silent');
    expect(state.expiresAt).toBe('2026-07-12T22:00:00.000Z');
  });

  it('activates guest privacy and returns to normal explicitly', async () => {
    await handleMaisonVoiceCommand("J'ai des invités", {
      identity: owner,
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
      now: () => new Date(now),
    });
    expect((await modes.getCurrent()).mode).toBe('guests');
    await handleMaisonVoiceCommand('Les invités sont partis', {
      identity: owner,
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
      now: () => new Date(now),
    });
    expect((await modes.getCurrent()).mode).toBe('normal');
  });

  it('lists and cancels a timer by its spoken label', async () => {
    await timers.start(600_000, 'four');
    await handleMaisonVoiceCommand('Quels minuteurs restent ?', {
      identity: owner,
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
      now: () => new Date(now),
    });
    expect(speak).toHaveBeenCalledWith(expect.stringContaining('four'));
    await handleMaisonVoiceCommand('Annule le minuteur du four', {
      identity: owner,
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
      now: () => new Date(now),
    });
    expect(await timers.listActive(now)).toHaveLength(0);
  });

  it('answers the next-meal question from the explicit local plan without an LLM', async () => {
    await meals.create({
      localDate: '2026-07-12',
      localTime: '13:00',
      slot: 'lunch',
      recipeId: 'ratatouille',
      recipeTitle: 'Ratatouille maison',
      status: 'planned',
      timeZone: 'Europe/Paris',
      provenance: {
        source: 'user',
        sourceId: 'voice-test',
        recordedAt: now.toISOString(),
        status: 'confirmed',
      },
    });

    expect(parseMaisonVoiceCommand("Qu'est-ce qu'on mange ?"))
      .toEqual({ kind: 'meal-next' });
    expect(await handleMaisonVoiceCommand("Qu'est-ce qu'on mange ?", {
      identity: owner,
      speak,
      now: () => new Date(now),
      mealPlanStore: meals,
      homeModeStore: modes,
      cookingTimerStore: timers,
    })).toBe(true);
    expect(speak).toHaveBeenCalledWith(expect.stringMatching(/Ratatouille maison.*déjeuner.*13:00/));
  });

  it('leaves unrelated speech to the normal conversation path', async () => {
    expect(parseMaisonVoiceCommand('Quel temps fera-t-il demain ?')).toBeNull();
    expect(await handleMaisonVoiceCommand('Quel temps fera-t-il demain ?', {
      speak,
      homeModeStore: modes,
      cookingTimerStore: timers,
    })).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });
});
