/**
 * GK36 — couche relationnelle et proactive de Lisa, en vrai, horloge factice.
 *
 * HOME / artefacts uniquement sous `_qa/gk36/` dans le clone. Faits fictifs.
 * Lecteur audio et Telegram injectés — jamais le pont 8129 ni les enceintes.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateHomeInteractionPolicy,
} from '../../src/companion/home-interaction-policy.js';
import { CompanionConductor, _resetConductorForTests } from '../../src/companion/orchestrator.js';
import {
  canSend,
  runProactiveTick,
} from '../../src/companion/proactive-engine.js';
import { detectRelationalSignal } from '../../src/companion/reply-augment.js';
import {
  DEFAULT_TRAITS,
  MAX_RELATIONSHIP_SESSIONS,
  MOOD_BASELINE,
  evolveTraits,
  personalityOf,
  recordReunion,
  saveRelationshipState,
  type RelationshipState,
} from '../../src/companion/relationship-state.js';
import { isLisaEvolutionRequest } from '../../src/identity/lisa-introspection.js';
import { PersistentMemoryManager } from '../../src/memory/persistent-memory.js';
import {
  buildArrivalOpener,
  buildLlmArrivalOpener,
} from '../../src/sensory/arrival-opener.js';
import {
  runEpisodeConsolidation,
  summarizeEpisode,
} from '../../src/sensory/episodic-journal.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_WORK = path.join(REPO, '_qa', 'gk36', 'work');
const DAY_MS = 86_400_000;
const EVENING = Date.parse('2026-09-03T20:15:00+02:00');
const NOON = Date.parse('2026-09-03T14:00:00+02:00');

/** 20 énoncés fictifs d'une journée — aucun fait personnel réel. */
export const GK36_DAY: readonly string[] = [
  'Bonjour Lisa',
  "J'en peux plus, ça marche pas ce matin",
  'Le script de démo plante encore',
  "Merci d'être là",
  "Trop content, j'ai réussi le test unitaire",
  'On avance sur le journal',
  'Je me souviens du concert de Luna l’an dernier',
  "J'ai un train demain",
  'Il part à huit heures',
  'Tu peux m’aider à préparer la valise de démo',
  'Haha c’est marrant ce bug',
  'Bon, on reprend',
  'Le café est froid',
  'Je suis un peu fatigué',
  'On parle du montage du soir',
  'Super, ça compile',
  'Tu as vu le log',
  'Je galère encore un peu sur le timeout',
  'Ça va mieux',
  'Bonne soirée Lisa',
];

function makeWork(): string {
  mkdirSync(QA_WORK, { recursive: true, mode: 0o700 });
  return mkdtempSync(path.join(QA_WORK, 't-'));
}

describe('GK36 — journal épisodique d’une journée', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('consolide 20 énoncés sans perdre le train, le souvenir, la frustration ni la joie', async () => {
    dir = makeWork();
    const ep = summarizeEpisode([...GK36_DAY], EVENING);
    expect(ep.count).toBe(20);
    expect(ep.line).toBeTruthy();
    expect(ep.line).toMatch(/train/i);
    expect(ep.line).toMatch(/concert de Luna/i);
    expect(ep.line).toMatch(/peux plus|marche pas|galère/i);
    expect(ep.line).toMatch(/réussi|trop content|super/i);
    expect(ep.line).not.toMatch(/<recent_episode>|<lisa_state>|\/100/i);

    const promoted: string[] = [];
    const run = await runEpisodeConsolidation({
      cwd: dir,
      now: EVENING,
      readHeard: async () => [...GK36_DAY],
      promote: async (e) => {
        promoted.push(e.line);
      },
    });
    expect(run?.line).toMatch(/train/i);
    expect(promoted).toEqual([run?.line]);
  });

  it('rejette une raffinerie LLM qui invente un fait absent des énoncés', async () => {
    dir = makeWork();
    const ep = await runEpisodeConsolidation({
      cwd: dir,
      now: EVENING,
      readHeard: async () => [...GK36_DAY],
      refine: async () =>
        'On a surtout parlé de ton divorce à Paris et de la vente de la maison.',
      promote: async () => {},
    });
    expect(ep?.line).toBeTruthy();
    expect(ep!.line).not.toMatch(/divorce|Paris|maison/i);
    expect(ep!.line).toMatch(/train/i);
  });
});

describe('GK36 — état relationnel (dérive bornée, pas de ratchet)', () => {
  it('dérive avec frustration puis joie, reste dans [0,100], et revient vers la baseline', () => {
    let state: RelationshipState = { celebratedMilestones: [] };
    for (const heard of GK36_DAY) {
      state = evolveTraits(state, detectRelationalSignal(heard));
      const p = personalityOf(state);
      for (const v of [p.mood, p.traits.warmth, p.traits.humor, p.traits.depth, p.traits.energy]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    const afterDay = personalityOf(state);
    expect(afterDay.sessions).toBe(0);

    for (let i = 0; i < 40; i++) state = evolveTraits(state, 'neutral');
    const calmed = personalityOf(state);
    expect(Math.abs(calmed.mood - MOOD_BASELINE)).toBeLessThan(8);
    expect(Math.abs(calmed.traits.warmth - DEFAULT_TRAITS.warmth)).toBeLessThan(8);
  });

  it('plafonne les réunions : pas de score à grinder', () => {
    let state: RelationshipState = { celebratedMilestones: [], sessions: 0 };
    for (let i = 0; i < 250; i++) state = recordReunion(state);
    expect(personalityOf(state).sessions).toBe(MAX_RELATIONSHIP_SESSIONS);
    expect(personalityOf(state).sessions).toBeLessThanOrEqual(100);
  });
});

describe('GK36 — accueil du soir sans jargon', () => {
  it('référence l’épisode (train) sans XML, sans scores, sans self-evolution', () => {
    const episode = summarizeEpisode([...GK36_DAY], EVENING);
    const opener = buildArrivalOpener({
      now: EVENING,
      episodeLine: episode.line,
      rng: () => 0,
    });
    expect(opener.trigger).toBe('evening');
    expect(opener.text).toMatch(/train/i);
    expect(opener.text).not.toMatch(/<[^>]+>/);
    expect(opener.text).not.toMatch(/\/100|lisa_state|recent_episode|user_model|Traits dominants|Registre expressif/i);
    expect(opener.text).not.toMatch(/j[’']ai appris à/i);
  });

  it('refuse une phrase d’accueil LLM qui récite le jargon ou une évolution non demandée', async () => {
    const jargon = await buildLlmArrivalOpener({
      now: EVENING,
      relationalContext:
        '<lisa_evolution>J’ai appris à mieux écouter.\nJ’ai appris à mieux vérifier.</lisa_evolution>',
      chat: async () =>
        'Bonsoir. <recent_episode>train</recent_episode> J’ai appris à mieux écouter (72/100).',
      timeoutMs: 500,
    });
    expect(jargon).toBeNull();

    const clean = await buildLlmArrivalOpener({
      now: EVENING,
      episodeLine: 'Récemment, on a parlé de : j’ai un train demain.',
      chat: async () => 'Bonsoir. Tu pensais à ton train de demain ?',
      timeoutMs: 500,
    });
    expect(clean).toMatch(/train/i);
    expect(clean).not.toMatch(/<[^>]+>|\/100/i);
  });
});

describe('GK36 — self_evolution seulement si on le demande', () => {
  it('la question orale débloque, un bonjour ne débloque pas', () => {
    expect(isLisaEvolutionRequest("qu'est-ce qui a changé chez toi ?")).toBe(true);
    expect(isLisaEvolutionRequest('Bonsoir Lisa, comment s’est passée ta journée ?')).toBe(false);
  });
});

describe('GK36 — proactif : gap, cooldown, rest, Telegram, pas par-dessus', () => {
  let dir: string;
  let statePath: string;
  let relPath: string;

  beforeEach(() => {
    dir = makeWork();
    statePath = path.join(dir, 'proactive-state.json');
    relPath = path.join(dir, 'relationship-state.json');
    process.env.CODEBUDDY_COMPANION_PROACTIVE = 'true';
    _resetConductorForTests();
    saveRelationshipState(
      {
        firstSeenAt: NOON - 10 * DAY_MS,
        lastPresentAt: NOON - 3 * DAY_MS,
        celebratedMilestones: [7],
      },
      relPath,
    );
  });
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PROACTIVE;
    _resetConductorForTests();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('reste muet si la bouche est déjà prise (ne parle pas par-dessus)', async () => {
    saveRelationshipState(
      {
        firstSeenAt: NOON - 30 * DAY_MS,
        lastPresentAt: NOON,
        celebratedMilestones: [7],
      },
      relPath,
    );
    const say = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => NOON,
      present: async () => true,
      speaking: () => true,
      say,
      telegramVoice: async () => true,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('au plus une initiative par fenêtre MIN_GAP, y compris Telegram absent', async () => {
    const tg = vi.fn(async () => true);
    const conductor = new CompanionConductor(45_000, () => NOON);
    expect(conductor.claim('arrival')).toBe(true);
    const line = await runProactiveTick({
      now: () => NOON,
      present: async () => false,
      say: async () => true,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      conductor,
    });
    expect(line).toBeNull();
    expect(tg).not.toHaveBeenCalled();
  });

  it('cooldown 12 h : un second tick dans la fenêtre reste silencieux', async () => {
    // 08:00 then +13 h = 21:00 : both outside the 22–8 quiet window, so silence
    // inside 12 h is the cooldown, not the night gate.
    const morning = Date.parse('2026-09-03T08:00:00+02:00');
    const tg = vi.fn(async () => true);
    const first = await runProactiveTick({
      now: () => morning,
      present: async () => false,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(first).toBeTruthy();
    expect(tg).toHaveBeenCalledTimes(1);
    expect(canSend({ lastSentAt: morning, recentLines: [first!] }, morning + 11 * 3600_000, 12 * 3600_000)).toBe(
      false,
    );
    const again = await runProactiveTick({
      now: () => morning + 11 * 3600_000,
      present: async () => false,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(again).toBeNull();
    expect(tg).toHaveBeenCalledTimes(1);
    const later = await runProactiveTick({
      now: () => morning + 13 * 3600_000,
      present: async () => false,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(later).toBeTruthy();
    expect(tg).toHaveBeenCalledTimes(2);
  });

  it('politique Maison rest : silencieux en local et à distance', async () => {
    const restLocal = evaluateHomeInteractionPolicy({
      mode: 'rest',
      dayKind: 'workday',
      surface: 'proactive-local',
    });
    const restRemote = evaluateHomeInteractionPolicy({
      mode: 'rest',
      dayKind: 'workday',
      surface: 'proactive-remote',
    });
    expect(restLocal.allowed).toBe(false);
    expect(restRemote.allowed).toBe(false);

    const say = vi.fn(async () => true);
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => NOON,
      present: async () => false,
      say,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
      homePolicy: async () => restRemote,
    });
    expect(line).toBeNull();
    expect(say).not.toHaveBeenCalled();
    expect(tg).not.toHaveBeenCalled();
  });

  it('absent hors rest → Telegram, pas les enceintes', async () => {
    const say = vi.fn(async () => true);
    const tg = vi.fn(async () => true);
    const line = await runProactiveTick({
      now: () => NOON,
      present: async () => false,
      say,
      telegramVoice: tg,
      statePath,
      relationshipStatePath: relPath,
      recentHearing: async () => [],
    });
    expect(line).toBeTruthy();
    expect(tg).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
  });
});

describe('GK36 — oubli d’Ebbinghaus (pin / archive / restore)', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('une préférence épinglée survit ; un fait ancien non rappelé s’archive puis se restaure', async () => {
    dir = makeWork();
    const manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'CODEBUDDY_MEMORY.md'),
      userMemoryPath: path.join(dir, 'memory.md'),
      autoCapture: false,
    });
    await manager.initialize();

    await manager.remember('pref-theme-demo', 'thème sombre pour la démo', {
      scope: 'user',
      category: 'preferences',
      tags: ['pinned'],
    });
    await manager.remember('concert-luna-fictif', 'souvenir fictif du concert de Luna', {
      scope: 'project',
      category: 'context',
      tags: ['episode'],
    });

    const far = new Date(Date.now() + 400 * DAY_MS);
    const userPass = await manager.applyForgetting('user', { now: far });
    const projectPass = await manager.applyForgetting('project', { now: far });

    expect(userPass.forgotten.map((f) => f.key)).not.toContain('pref-theme-demo');
    expect(manager.recall('pref-theme-demo', 'user')).toBe('thème sombre pour la démo');

    expect(projectPass.forgotten.map((f) => f.key)).toContain('concert-luna-fictif');
    expect(manager.get('concert-luna-fictif', 'project')).toBeUndefined();

    const archived = await manager.listArchived('project');
    expect(archived.some((e) => e.key === 'concert-luna-fictif')).toBe(true);

    const restored = await manager.restoreFromArchive('concert-luna-fictif', 'project');
    expect(restored?.result.status).toBe('stored');
    expect(manager.get('concert-luna-fictif', 'project')?.value).toBe(
      'souvenir fictif du concert de Luna',
    );
    expect((await manager.listArchived('project')).some((e) => e.key === 'concert-luna-fictif')).toBe(
      false,
    );
  });

  it('ne garde pas un faux fait auto-capturé (négation + hallucination assistant)', async () => {
    dir = makeWork();
    const manager = new PersistentMemoryManager({
      projectMemoryPath: path.join(dir, 'CODEBUDDY_MEMORY.md'),
      userMemoryPath: path.join(dir, 'memory.md'),
      autoCapture: true,
    });
    await manager.initialize();
    await manager.autoCapture('I never said that.', 'This is a Ruby on Rails backend service.');
    await manager.autoCapture("Je n'ai jamais dit ça.", 'Le projet tourne en Ruby on Rails.');
    const all = [...manager.listMemories('project'), ...manager.listMemories('user')];
    expect(all.find((m) => /never said that|jamais dit/i.test(m.value))).toBeUndefined();
    expect(all.find((m) => /Ruby on Rails/i.test(m.value))).toBeUndefined();
  });
});
