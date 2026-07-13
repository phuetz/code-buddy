import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  generateMeetingNotes,
  parseJsonTranscript,
  parseTextTranscript,
  parseTranscriptTimestamp,
} from '../../src/meeting/index.js';

describe('meeting transcript ingestion', () => {
  it('parses timestamped speaker lines without inventing missing times', () => {
    const segments = parseTextTranscript([
      '[00:12] Alice: Bonjour à tous.',
      'Bob: Point sans horodatage.',
      '[01:02:03.500] Alice: Fin de réunion.',
    ].join('\n'));

    expect(segments).toEqual([
      { sequence: 1, startSeconds: 12, endSeconds: null, speaker: 'Alice', text: 'Bonjour à tous.' },
      { sequence: 2, startSeconds: null, endSeconds: null, speaker: 'Bob', text: 'Point sans horodatage.' },
      { sequence: 3, startSeconds: 3723.5, endSeconds: null, speaker: 'Alice', text: 'Fin de réunion.' },
    ]);
    expect(parseTranscriptTimestamp('00:61')).toBeNull();
  });

  it('parses SRT cues and strips display tags', () => {
    const segments = parseTextTranscript([
      '1',
      '00:00:01,250 --> 00:00:04,000',
      '<v Alice>Alice: Nous commençons.</v>',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,500',
      'Bob: Très bien.',
    ].join('\n'));

    expect(segments).toEqual([
      { sequence: 1, startSeconds: 1.25, endSeconds: 4, speaker: 'Alice', text: 'Nous commençons.' },
      { sequence: 2, startSeconds: 5, endSeconds: 7.5, speaker: 'Bob', text: 'Très bien.' },
    ]);
  });

  it('preserves WebVTT voice labels and ignores cue identifiers', () => {
    const segments = parseTextTranscript([
      'WEBVTT',
      '',
      'intro-cue',
      '00:00:01.000 --> 00:00:03.000',
      '<v Alice>Bienvenue à tous.</v>',
    ].join('\n'));

    expect(segments).toEqual([
      { sequence: 1, startSeconds: 1, endSeconds: 3, speaker: 'Alice', text: 'Bienvenue à tous.' },
    ]);
  });

  it('normalizes Whisper and Code Buddy JSON segment shapes', () => {
    const segments = parseJsonTranscript({
      segments: [
        { start: 1.5, end: 3, text: 'Hello', speaker: 'S1' },
        { t_start: 4, t_end: 6, said: 'World', speaker_label: 'S2' },
      ],
    });

    expect(segments).toEqual([
      { sequence: 1, startSeconds: 1.5, endSeconds: 3, speaker: 'S1', text: 'Hello' },
      { sequence: 2, startSeconds: 4, endSeconds: 6, speaker: 'S2', text: 'World' },
    ]);
  });

  it('bounds segment count for direct text input before rendering duplicate outputs', async () => {
    await expect(
      generateMeetingNotes(
        { kind: 'text', text: Array.from({ length: 100_001 }, () => 'x').join('\n') },
        { useAI: false },
      ),
    ).rejects.toThrow(/too many segments/);
  });
});

describe('generateMeetingNotes', () => {
  const now = () => new Date('2026-07-12T08:00:00.000Z');

  it('builds grounded deterministic notes without calling an analyzer', async () => {
    const analyzer = vi.fn(async () => '{"title":"should not run"}');
    const result = await generateMeetingNotes(
      {
        kind: 'text',
        sourceName: 'point-equipe.txt',
        text: [
          '[00:10] Alice: Nous avons décidé de garder Pocket TTS.',
          '[00:25] Bob: Je vais préparer le benchmark demain.',
          '[00:40] Alice: Quelle latence cible reste à clarifier ?',
        ].join('\n'),
      },
      { language: 'fr' },
      { analyzer, now },
    );

    expect(analyzer).not.toHaveBeenCalled();
    expect(result.notes).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-12T08:00:00.000Z',
      analysisMode: 'deterministic',
      title: 'point equipe',
      participants: [
        { name: 'Alice', speakingTurns: 2 },
        { name: 'Bob', speakingTurns: 1 },
      ],
    });
    expect(result.notes.decisions[0]).toMatchObject({
      id: 'decision-1',
      owner: 'Alice',
      evidence: { sequence: 1, timestamp: '00:10', quote: 'Nous avons décidé de garder Pocket TTS.' },
    });
    expect(result.notes.actionItems[0]).toMatchObject({
      id: 'action-1',
      owner: 'Bob',
      dueDate: 'demain',
      status: 'open',
    });
    expect(result.notes.openQuestions).toHaveLength(1);
    expect(result.markdown).toContain('## Actions');
    expect(result.markdown).toContain('[00:25] Bob');
    expect(JSON.parse(result.json)).toEqual(result.notes);
  });

  it('repairs malformed analyzer JSON and only accepts source-grounded evidence', async () => {
    const analyzer = vi.fn(async ({ userPrompt }: { userPrompt: string }) => {
      if (userPrompt.startsWith('Analyze this transcript')) return '```json\n{"title": }\n```';
      return JSON.stringify({
        title: 'Sync produit',
        summary: 'Le lancement est validé.',
        keyPoints: ['Lancement mardi'],
        decisions: [{ text: 'Lancement validé', evidenceSequence: 1, evidence: 'citation inventée' }],
        actionItems: [{ task: 'Publier la note', owner: 'Alice', dueDate: '2026-07-14', evidenceSequence: 2 }],
        openQuestions: [],
      });
    });

    const result = await generateMeetingNotes(
      {
        kind: 'json',
        sourceName: 'sync.json',
        value: [
          { start: 5, end: 8, speaker: 'Bob', text: 'Le lancement mardi est validé.' },
          { start: 9, end: 12, speaker: 'Alice', text: 'Je vais publier la note.' },
        ],
      },
      { language: 'fr', useAI: true },
      { analyzer, now },
    );

    expect(analyzer).toHaveBeenCalledTimes(2);
    expect(result.notes.analysisMode).toBe('ai');
    expect(result.notes.title).toBe('Sync produit');
    expect(result.notes.decisions[0]?.evidence?.quote).toBe('Le lancement mardi est validé.');
    expect(result.notes.actionItems[0]?.evidence?.quote).toBe('Je vais publier la note.');
    // The model proposed an ISO date not present in the source segment: it is rejected.
    expect(result.notes.actionItems[0]?.dueDate).toBeNull();
    expect(result.notes.transcript).toHaveLength(2);
  });

  it('drops an unrelated analyzer claim instead of keeping an unproven decision', async () => {
    const result = await generateMeetingNotes(
      { kind: 'text', text: '[00:01] Alice: La réunion commence.' },
      { useAI: true },
      {
        analyzer: async () => JSON.stringify({
          title: 'Test',
          summary: 'Résumé',
          decisions: [{ text: 'Le budget est approuvé', evidenceSequence: 1 }],
        }),
        now,
      },
    );

    expect(result.notes.analysisMode).toBe('ai');
    expect(result.notes.decisions).toEqual([]);
  });

  it('rejects hallucinated owners and deadlines while keeping explicit source deadlines', async () => {
    const result = await generateMeetingNotes(
      {
        kind: 'text',
        text: [
          '[00:01] Alice: Bonjour.',
          '[00:05] Bob: Je vais publier le rapport demain.',
        ].join('\n'),
      },
      { useAI: true },
      {
        analyzer: async () => JSON.stringify({
          title: 'Test',
          summary: 'Résumé',
          actionItems: [{
            task: 'Publier le rapport',
            owner: 'Mallory',
            dueDate: '2035-01-01',
            evidenceSequence: 2,
          }],
        }),
        now,
      },
    );

    expect(result.notes.actionItems[0]).toMatchObject({
      owner: null,
      dueDate: 'demain',
      evidence: { sequence: 2, quote: 'Je vais publier le rapport demain.' },
    });
  });

  it('requires multiple meaningful overlaps to ground a long LLM paraphrase', async () => {
    const result = await generateMeetingNotes(
      { kind: 'text', text: '[00:01] Alice: La réunion commence avec un point météo.' },
      { useAI: true },
      {
        analyzer: async () => JSON.stringify({
          title: 'Test',
          summary: 'Résumé',
          decisions: [{
            text: 'La réunion approuve définitivement le budget commercial international annuel',
            evidenceSequence: 1,
          }],
        }),
        now,
      },
    );

    expect(result.notes.decisions).toEqual([]);
  });

  it('falls back to deterministic extraction when the optional analyzer fails', async () => {
    const analyzer = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await generateMeetingNotes(
      { kind: 'text', text: 'Alice: Nous avons décidé de livrer vendredi.' },
      { useAI: true },
      { analyzer, now },
    );

    expect(analyzer).toHaveBeenCalled();
    expect(result.notes.analysisMode).toBe('deterministic');
    expect(result.notes.decisions).toHaveLength(1);
  });

  it('routes media files through the injected long transcriber and redacts absolute paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'meeting-media-'));
    const mediaPath = join(directory, 'demo.mp4');
    await writeFile(mediaPath, 'fixture', 'utf8');
    const transcribe = vi.fn(async () => [
      { t_start: 0, t_end: 4.5, said: 'Bienvenue.' },
      { t_start: 4.5, t_end: 9, said: 'Action: envoyer le compte rendu.' },
    ]);
    try {
      const result = await generateMeetingNotes(
        { kind: 'file', path: mediaPath },
        { useAI: false },
        { transcribe, now },
      );

      expect(transcribe).toHaveBeenCalledWith(mediaPath);
      expect(result.notes.source).toEqual({ kind: 'media', name: 'demo.mp4' });
      expect(result.json).not.toContain(directory);
      expect(result.notes.transcript[1]).toMatchObject({ startSeconds: 4.5, endSeconds: 9 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
