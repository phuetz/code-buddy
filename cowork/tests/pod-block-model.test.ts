/**
 * pod-block-model — real tests (no mocks): parse the agent-emitted ```pod
 * block into PodcastComposer segments, strip it, pick the newest, prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPodExportPrompt,
  buildPodGenerationPrompt,
  latestPodBlock,
  parsePodBlock,
  stripPodBlocks,
} from '../src/renderer/components/deliverables/pod-block-model';

const block = (json: string) => 'Voici le script :\n```pod\n' + json + '\n```\nRésumé.';

describe('parsePodBlock', () => {
  it('parses a real pod block into composer segments', () => {
    const pod = parsePodBlock(
      block(
        JSON.stringify({
          title: 'La nuit autopilote',
          segments: [
            { title: 'Intro', voice: 'narrateur', script: 'Cette nuit, un agent a travaillé seul.' },
            { script: 'Deuxième segment sans titre.' },
          ],
        }),
      ),
    )!;
    expect(pod.title).toBe('La nuit autopilote');
    expect(pod.segments).toHaveLength(2);
    expect(pod.segments[0]).toEqual({
      id: 'seg-1',
      title: 'Intro',
      voice: 'narrateur',
      script: 'Cette nuit, un agent a travaillé seul.',
    });
    expect(pod.segments[1]!.title).toBe('Segment 2');
    expect(pod.segments[1]!.voice).toBe('narrateur');
  });

  it('drops empty segments and rejects malformed blocks', () => {
    expect(parsePodBlock(block('{"segments":[{"script":"  "}]}'))).toBeNull();
    expect(parsePodBlock(block('{oops'))).toBeNull();
    expect(parsePodBlock('pas de bloc')).toBeNull();
  });
});

describe('stripPodBlocks', () => {
  it('hides the block from the visible reply', () => {
    const text = 'Avant.\n```pod\n{"segments":[{"script":"x"}]}\n```\nAprès.';
    expect(stripPodBlocks(text)).toBe('Avant.\n\nAprès.');
  });
});

describe('latestPodBlock', () => {
  const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
  const podText = (title: string) =>
    '```pod\n{"title":"' + title + '","segments":[{"script":"x"}]}\n```';

  it('prefers the streaming partial, else the newest assistant pod', () => {
    const messages = [msg('assistant', podText('Ancien')), msg('assistant', podText('Récent'))];
    expect(latestPodBlock(messages)!.title).toBe('Récent');
    expect(latestPodBlock(messages, podText('Live'))!.title).toBe('Live');
  });
});

describe('prompts', () => {
  it('generation prompt carries the subject and the spoken-style contract', () => {
    const p = buildPodGenerationPrompt('la nuit autopilote');
    expect(p).toContain('la nuit autopilote');
    expect(p).toContain('```pod');
    expect(p).toContain('VOIX HAUTE');
  });

  it('export prompt concatenates the full script for one text_to_speech call', () => {
    const p = buildPodExportPrompt({
      title: 'Épisode 1',
      segments: [
        { id: 's1', title: 'A', voice: 'n', script: 'Première phrase.' },
        { id: 's2', title: 'B', voice: 'n', script: 'Seconde phrase.' },
      ],
    });
    expect(p).toContain('text_to_speech');
    expect(p).toContain('« Épisode 1.wav »');
    expect(p).toContain('Première phrase.\n\nSeconde phrase.');
  });
});
