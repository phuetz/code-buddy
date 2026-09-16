import { describe, it, expect } from 'vitest';
import {
  COPINE_PROFILE,
  DEFAULT_INITIATIVE_POLICY,
  angleForHour,
  constantRng,
  emptyInitiativeState,
  evaluateTriggers,
  inWindow,
  interpolate,
  isHotThread,
  isPauseRequest,
  isPaused,
  isShameLine,
  nextAngle,
  normalizeInitiativeState,
  noteInbound,
  pauseInitiatives,
  pickTrigger,
  planInitiative,
  resolveCivilClock,
  rollInitiativeDay,
  type InitiativeState,
} from '../src/index.js';

const TZ = 'UTC';
const at = (iso: string) => resolveCivilClock(Date.parse(iso), TZ);

function plan(state: InitiativeState, iso: string) {
  return planInitiative({
    state,
    clock: at(iso),
    profile: COPINE_PROFILE,
    rng: constantRng(0),
  });
}

describe('initiative — fenêtre et angles', () => {
  it('choisit l’angle selon l’heure', () => {
    expect(angleForHour(8)).toBe('morning');
    expect(angleForHour(14)).toBe('thought');
    expect(angleForHour(20)).toBe('evening');
  });

  it('refuse un angle déjà dépensé', () => {
    expect(nextAngle(8, ['morning'])).toBeNull();
    expect(nextAngle(8, ['evening'])).toBe('morning');
  });

  it('borne la fenêtre horaire, minuit compris', () => {
    expect(inWindow(9 * 60, DEFAULT_INITIATIVE_POLICY)).toBe(true);
    expect(inWindow(7 * 60, DEFAULT_INITIATIVE_POLICY)).toBe(false);
    const nuit = { ...DEFAULT_INITIATIVE_POLICY, windowStartMinute: 22 * 60, windowEndMinute: 2 * 60 };
    expect(inWindow(23 * 60, nuit)).toBe(true);
    expect(inWindow(1 * 60, nuit)).toBe(true);
    expect(inWindow(12 * 60, nuit)).toBe(false);
    expect(inWindow(600, { ...DEFAULT_INITIATIVE_POLICY, windowStartMinute: 600, windowEndMinute: 600 })).toBe(false);
  });
});

describe('initiative — plan plafonné', () => {
  it('émet une seule ligne par angle et par jour', () => {
    const matin = plan(emptyInitiativeState(), '2026-03-02T09:00:00Z');
    expect(matin.ok).toBe(true);
    if (!matin.ok) return;
    expect(matin.initiative.angle).toBe('morning');

    const second = plan(matin.state, '2026-03-02T10:00:00Z');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('angle');
  });

  it('couvre trois angles au maximum dans la journée', () => {
    let state = emptyInitiativeState();
    for (const iso of ['2026-03-02T09:00:00Z', '2026-03-02T14:00:00Z', '2026-03-02T20:00:00Z']) {
      const result = plan(state, iso);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(state.sent).toEqual(['morning', 'thought', 'evening']);
    const cap = planInitiative({
      state: { ...state, sent: ['morning', 'thought', 'evening'] },
      clock: at('2026-03-02T21:00:00Z'),
      profile: COPINE_PROFILE,
      policy: { ...DEFAULT_INITIATIVE_POLICY, maxPerDay: 3 },
      rng: constantRng(0),
    });
    expect(cap.ok).toBe(false);
    if (!cap.ok) expect(cap.reason).toBe('cap');
  });

  it('remet les compteurs à zéro au jour suivant, sans lever la pause', () => {
    const pause = Date.parse('2026-03-03T12:00:00Z');
    const rolled = rollInitiativeDay(
      { date: '2026-03-02', sent: ['morning'], pauseUntil: pause, lastInboundAt: 42, lastLine: 'Bonjour.' },
      '2026-03-03',
    );
    expect(rolled.sent).toEqual([]);
    expect(rolled.pauseUntil).toBe(pause);
    expect(rolled.lastInboundAt).toBe(42);
    expect(rolled.lastLine).toBe('Bonjour.');
  });

  it('se tait hors de la fenêtre horaire', () => {
    const result = plan(emptyInitiativeState(), '2026-03-02T06:00:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('window');
  });

  it('se tait tant que le fil est chaud', () => {
    const now = Date.parse('2026-03-02T09:00:00Z');
    const result = plan({ sent: [], lastInboundAt: now - 60_000 }, '2026-03-02T09:00:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('hot-thread');
    expect(isHotThread({ sent: [], lastInboundAt: now - 60_000 }, now, DEFAULT_INITIATIVE_POLICY.hotThreadMs)).toBe(true);
    expect(isHotThread({ sent: [] }, now, DEFAULT_INITIATIVE_POLICY.hotThreadMs)).toBe(false);
  });

  it('ne redit pas la dernière ligne', () => {
    const first = plan(emptyInitiativeState(), '2026-03-02T09:00:00Z');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const lendemain = plan({ ...first.state, date: '2026-03-02' }, '2026-03-03T09:00:00Z');
    expect(lendemain.ok).toBe(true);
    if (lendemain.ok) expect(lendemain.initiative.line).not.toBe(first.initiative.line);
  });

  it('reste muet si le profil n’a pas de pool pour l’angle', () => {
    const result = planInitiative({
      state: emptyInitiativeState(),
      clock: at('2026-03-02T09:00:00Z'),
      profile: { ...COPINE_PROFILE, away: { ...COPINE_PROFILE.away, morning: [] } },
      rng: constantRng(0),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('pool');
  });
});

describe('initiative — le stop de 24 h', () => {
  it('reconnaît un stop de message entier, pas un « arrête ce test »', () => {
    expect(isPauseRequest('stop')).toBe(true);
    expect(isPauseRequest('Pas maintenant')).toBe(true);
    expect(isPauseRequest('not now')).toBe(true);
    expect(isPauseRequest('arrête ce test stp')).toBe(false);
    expect(isPauseRequest('')).toBe(false);
  });

  it('un stop entrant coupe les initiatives pour 24 h', () => {
    const now = Date.parse('2026-03-02T09:00:00Z');
    const state = noteInbound(emptyInitiativeState(), 'stop', now);
    expect(isPaused(state, now + 60_000)).toBe(true);
    expect(isPaused(state, now + 25 * 60 * 60 * 1000)).toBe(false);
    const result = plan(state, '2026-03-02T09:01:00Z');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('paused');
  });

  it('un message ordinaire réchauffe le fil sans mettre en pause', () => {
    const now = Date.parse('2026-03-02T09:00:00Z');
    const state = noteInbound(emptyInitiativeState(), 'coucou', now);
    expect(state.pauseUntil).toBeUndefined();
    expect(state.lastInboundAt).toBe(now);
  });

  it('la pause peut être posée directement par l’hôte', () => {
    const now = 1_000;
    expect(isPaused(pauseInitiatives(emptyInitiativeState(), now), now + 1)).toBe(true);
  });
});

describe('initiative — jamais de culpabilisation', () => {
  it('reconnaît une ligne qui compte les jours ou reproche le silence', () => {
    expect(isShameLine('Ça fait 4 jours sans te voir.')).toBe(true);
    expect(isShameLine('tu m’ignores')).toBe(true);
    expect(isShameLine('it s been 3 days')).toBe(true);
    expect(isShameLine('Bonjour. Juste un bonjour.')).toBe(false);
  });

  it('aucun pool « away » du profil ne culpabilise', () => {
    for (const angle of ['morning', 'thought', 'evening'] as const) {
      for (const line of COPINE_PROFILE.away[angle]) {
        expect(isShameLine(line)).toBe(false);
      }
    }
  });

  it('supprime le déclencheur d’inactivité quand l’absence est connue', () => {
    const base = {
      hour: 9,
      daysTogether: 3,
      daysSinceLastSeen: 6,
      celebratedMilestones: [] as number[],
    };
    expect(evaluateTriggers(base).some((c) => c.trigger === 'inactivity')).toBe(true);
    expect(
      evaluateTriggers({ ...base, suppressInactivity: true }).some((c) => c.trigger === 'inactivity'),
    ).toBe(false);
  });
});

describe('initiative — déclencheurs priorisés', () => {
  it('un jalon passe devant tout le reste', () => {
    const winner = pickTrigger({
      hour: 9,
      daysTogether: 30,
      daysSinceLastSeen: 5,
      celebratedMilestones: [],
    });
    expect(winner?.trigger).toBe('milestone');
    expect(winner?.data.days).toBe(30);
  });

  it('rend null quand rien ne s’applique', () => {
    expect(
      pickTrigger({ hour: 15, daysTogether: 1, daysSinceLastSeen: 0, celebratedMilestones: [] }),
    ).toBeNull();
  });

  it('interpole sans jamais déclencher l’expansion de $', () => {
    expect(interpolate('{{a}} et {{b}}', { a: '$&', b: 2 })).toBe('$& et 2');
    expect(interpolate('{{absent}}', {})).toBe('');
  });
});

describe('initiative — état douteux', () => {
  it('nettoie une entrée arbitraire', () => {
    const state = normalizeInitiativeState({
      sent: ['morning', 'sieste', 42],
      date: '2026-03-02',
      pauseUntil: 'demain',
      lastLine: 'Bonjour.',
    });
    expect(state.sent).toEqual(['morning']);
    expect(state.date).toBe('2026-03-02');
    expect(state.pauseUntil).toBeUndefined();
    expect(state.lastLine).toBe('Bonjour.');
    expect(normalizeInitiativeState(null).sent).toEqual([]);
  });
});
