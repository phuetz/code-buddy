/**
 * Phase 6 of the interactions refonte: the episodic journal — consolidate the heard DIALOGUE into a
 * short "what we talked about" line (distinct from dreaming's sensor stats) and promote it to memory.
 * Pure core + a best-effort pass, all seams injected (no real percept store / memory / home dir).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  summarizeConversationEpisode,
  summarizeEpisode,
  runEpisodeConsolidation,
  type EpisodeSummary,
} from '../../src/sensory/episodic-journal.js';
import { recordCompanionPercept } from '../../src/companion/percepts.js';

describe('summarizeEpisode', () => {
  it('keeps the last few distinct utterances and drops consecutive duplicates', () => {
    const ep = summarizeEpisode(
      ['bonjour', 'bonjour', 'on regarde le bug du train', 'et les tests', 'et les tests', ''],
      1000,
    );
    expect(ep.count).toBe(5); // empties dropped
    expect(ep.topics).toEqual(['bonjour', 'on regarde le bug du train', 'et les tests']);
    expect(ep.line).toContain('on regarde le bug du train');
    expect(ep.at).toBe(1000);
  });

  it('caps to the last 6 topics', () => {
    const ep = summarizeEpisode(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 0);
    expect(ep.topics).toEqual(['c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('produces no line when there is nothing', () => {
    expect(summarizeEpisode([], 0).line).toBe('');
    expect(summarizeEpisode(['  ', ''], 0).line).toBe('');
  });
});

describe('summarizeConversationEpisode', () => {
  it('keeps where both people were, corrections, commitments and open loops', () => {
    const episode = summarizeConversationEpisode(
      [
        { role: 'user', content: 'Je veux construire un avatar MetaHuman pour Lisa.' },
        {
          role: 'assistant',
          content: 'Je vais définir le protocole entre Code Buddy et Unreal Engine.',
        },
        { role: 'user', content: 'Non, garde Code Buddy comme cerveau principal.' },
        {
          role: 'assistant',
          content: 'Compris, Code Buddy restera le cerveau. On reparle plus tard du rendu final.',
        },
      ],
      1_000
    );

    expect(episode.topics).toEqual(expect.arrayContaining(['code', 'buddy', 'cerveau']));
    expect(episode.corrections?.at(-1)).toContain('cerveau principal');
    expect(episode.commitments?.at(-1)).toContain('protocole');
    expect(episode.openLoops?.at(-1)).toContain('plus tard');
    expect(episode.line).toContain('Dernière position de Lisa');
  });
});

describe('runEpisodeConsolidation', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'episode-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('consolidates heard dialogue and promotes the episode', async () => {
    const promoted: EpisodeSummary[] = [];
    const ep = await runEpisodeConsolidation({
      cwd: tmp,
      now: 42,
      readHeard: async () => ['le déploiement de ce matin', 'et la revue de code'],
      promote: async (e) => void promoted.push(e),
    });
    expect(ep).not.toBeNull();
    expect(ep!.line).toContain('déploiement');
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.line).toBe(ep!.line);
  });

  it('returns null when nothing was heard', async () => {
    const promoted: EpisodeSummary[] = [];
    const ep = await runEpisodeConsolidation({
      cwd: tmp,
      readHeard: async () => [],
      promote: async (e) => void promoted.push(e),
    });
    expect(ep).toBeNull();
    expect(promoted).toHaveLength(0);
  });

  it('lets an LLM refine the episode line', async () => {
    const ep = await runEpisodeConsolidation({
      cwd: tmp,
      readHeard: async () => ['des trucs', 'et des machins'],
      refine: async () => 'On a surtout parlé du déploiement et des tests.',
      promote: async () => {},
    });
    expect(ep!.line).toBe('On a surtout parlé du déploiement et des tests.');
  });

  it('consolidates a complete cross-channel exchange and deduplicates an unchanged episode', async () => {
    const promoted: EpisodeSummary[] = [];
    const readConversation = async () => [
      { role: 'user' as const, content: 'Continuons le projet MetaHuman.' },
      { role: 'assistant' as const, content: 'Je vais préparer le protocole Unreal.' },
    ];
    const options = {
      cwd: tmp,
      readConversation,
      promote: async (episode: EpisodeSummary) => void promoted.push(episode),
    };

    const first = await runEpisodeConsolidation(options);
    const unchanged = await runEpisodeConsolidation(options);

    expect(first?.lastUserPoint).toContain('MetaHuman');
    expect(first?.lastAssistantPosition).toContain('Unreal');
    expect(unchanged).toBeNull();
    expect(promoted).toHaveLength(1);
  });

  it('never throws and does not promote when the utterances are all empty', async () => {
    const promoted: EpisodeSummary[] = [];
    const ep = await runEpisodeConsolidation({
      cwd: tmp,
      readHeard: async () => ['   ', ''],
      promote: async (e) => void promoted.push(e),
    });
    expect(ep).toBeNull();
    expect(promoted).toHaveLength(0);
  });

  it('does not turn ambient television into a conversation episode', async () => {
    for (const [text, responded, decisionReason] of [
      ['Bienvenue dans cette émission', false, 'ambient'],
      ['Buddy, résume mon travail', true, 'addressed'],
      ['Pour vous qui nous regardez', false, 'ambient-in-window'],
      ['Oui, continue', true, 'engaged'],
    ] as const) {
      await recordCompanionPercept(
        {
          modality: 'hearing',
          source: 'test',
          summary: `Heard: ${text}`,
          payload: { text, responded, decisionReason },
        },
        { cwd: tmp }
      );
    }

    const promoted: EpisodeSummary[] = [];
    const episode = await runEpisodeConsolidation({
      cwd: tmp,
      promote: async (value) => void promoted.push(value),
    });

    expect(episode?.topics).toEqual(['Buddy, résume mon travail', 'Oui, continue']);
    expect(episode?.line).not.toContain('émission');
    expect(promoted).toHaveLength(1);
  });
});
