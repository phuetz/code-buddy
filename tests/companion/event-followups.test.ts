import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasFutureCue,
  loadEventFollowUps,
  addFollowUp,
  dueFollowUp,
  markFired,
  captureEventFollowUp,
  confirmationLine,
  FOLLOWUP_GRACE_DAYS,
  CAPTURE_HORIZON_DAYS,
  type EventExtractor,
} from '../../src/companion/event-followups.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-26T14:00:00').getTime(); // a Friday afternoon

let dir: string;
let p: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ef-'));
  p = path.join(dir, 'event-followups.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('hasFutureCue', () => {
  it('fires on future-time words, not on plain statements', () => {
    expect(hasFutureCue('j’ai un gros déploiement jeudi')).toBe(true);
    expect(hasFutureCue('mon rendez-vous médecin est demain')).toBe(true);
    expect(hasFutureCue('la réunion est la semaine prochaine')).toBe(true);
    expect(hasFutureCue('rappel dans 3 jours')).toBe(true);
    expect(hasFutureCue('il fait beau aujourd’hui')).toBe(false);
    expect(hasFutureCue('ça marche bien')).toBe(false);
  });
});

describe('store + due-logic', () => {
  it('addFollowUp schedules the ask for the day AFTER the event', () => {
    const eventDay = new Date('2026-06-30T00:00:00').getTime();
    const fu = addFollowUp({ event: 'le déploiement', eventDayAt: eventDay, followUp: 'Alors, ce déploiement ?' }, NOW, p);
    expect(fu.dueAt).toBe(eventDay + DAY);
    expect(loadEventFollowUps(p)).toHaveLength(1);
  });

  it('dueFollowUp returns a due, un-fired item and skips future ones', () => {
    addFollowUp({ event: 'passé', eventDayAt: NOW - 2 * DAY, followUp: 'Q1' }, NOW, p); // due yesterday
    addFollowUp({ event: 'futur', eventDayAt: NOW + 3 * DAY, followUp: 'Q2' }, NOW, p); // not due
    const due = dueFollowUp(NOW, p);
    expect(due?.event).toBe('passé');
  });

  it('prunes stale follow-ups (past the grace window) instead of ever asking', () => {
    addFollowUp({ event: 'vieux', eventDayAt: NOW - (FOLLOWUP_GRACE_DAYS + 5) * DAY, followUp: 'Q' }, NOW, p);
    expect(dueFollowUp(NOW, p)).toBeNull(); // too stale
    expect(loadEventFollowUps(p)[0]!.firedAt).toBeDefined(); // retired silently
  });

  it('markFired makes a follow-up ask exactly once', () => {
    const fu = addFollowUp({ event: 'x', eventDayAt: NOW - DAY, followUp: 'Q' }, NOW, p);
    expect(dueFollowUp(NOW, p)?.id).toBe(fu.id);
    markFired(fu.id, NOW, p);
    expect(dueFollowUp(NOW, p)).toBeNull();
  });

  it('does not treat a corrupt follow-up store as empty (jumeau D1)', () => {
    writeFileSync(p, '{this is not json');
    expect(() => loadEventFollowUps(p)).toThrow();
    writeFileSync(p, '{}');
    expect(() => loadEventFollowUps(p)).toThrow();
  });
});

describe('captureEventFollowUp (gate + extractor + sanity window)', () => {
  const okExtractor: EventExtractor = async () => ({
    event: 'ton rendez-vous',
    eventDayAt: NOW + 2 * DAY,
    followUp: 'Alors, ce rendez-vous ?',
  });

  it('skips utterances with no future cue WITHOUT calling the extractor', async () => {
    let called = false;
    const spy: EventExtractor = async () => {
      called = true;
      return null;
    };
    const out = await captureEventFollowUp('il fait beau', NOW, { extractor: spy, statePath: p });
    expect(out).toBeNull();
    expect(called).toBe(false); // gate short-circuits the LLM
  });

  it('captures a valid future event within the horizon', async () => {
    const out = await captureEventFollowUp('j’ai un rendez-vous demain', NOW, { extractor: okExtractor, statePath: p });
    expect(out?.event).toBe('ton rendez-vous');
    expect(loadEventFollowUps(p)).toHaveLength(1);
  });

  it('rejects a past date and a far-future hallucination', async () => {
    const past: EventExtractor = async () => ({ event: 'e', eventDayAt: NOW - 3 * DAY, followUp: 'Q' });
    const far: EventExtractor = async () => ({ event: 'e', eventDayAt: NOW + (CAPTURE_HORIZON_DAYS + 10) * DAY, followUp: 'Q' });
    expect(await captureEventFollowUp('c’était jeudi dernier', NOW, { extractor: past, statePath: p })).toBeNull();
    expect(await captureEventFollowUp('un truc dans longtemps jeudi', NOW, { extractor: far, statePath: p })).toBeNull();
    expect(loadEventFollowUps(p)).toHaveLength(0);
  });

  it('never throws when the extractor blows up', async () => {
    const boom: EventExtractor = async () => {
      throw new Error('llm down');
    };
    await expect(captureEventFollowUp('rendez-vous demain', NOW, { extractor: boom, statePath: p })).resolves.toBeNull();
  });
});

describe('confirmationLine', () => {
  it('names the captured event so a mis-hear is correctable on the spot', () => {
    const fu = addFollowUp({ event: 'le déploiement', eventDayAt: NOW + DAY, followUp: 'Q' }, NOW, p);
    const line = confirmationLine(fu, NOW);
    expect(line).toContain('le déploiement');
    expect(line).toMatch(/demain|redemander/i);
  });
});
