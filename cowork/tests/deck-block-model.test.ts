/**
 * deck-block-model — real tests (no mocks): parse the agent-emitted ```deck
 * block into SlideDeckPreview slides, strip it from chat text, pick the
 * newest deck in a session, and build the generation/export prompts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeckExportPrompt,
  buildDeckGenerationPrompt,
  latestDeckBlock,
  parseDeckBlock,
  stripDeckBlocks,
} from '../src/renderer/components/deliverables/deck-block-model';

const block = (json: string) => 'Voici le deck :\n```deck\n' + json + '\n```\nRésumé en deux phrases.';

describe('parseDeckBlock', () => {
  it('parses a real deck block into preview slides', () => {
    const deck = parseDeckBlock(
      block(
        JSON.stringify({
          title: 'Lancer Code Buddy',
          slides: [
            { title: 'Pourquoi maintenant', bullets: ['15 providers', '27K tests'], notes: 'ouvrir fort' },
            { title: 'Démo', bullets: ['bolt.new intégré'] },
          ],
        }),
      ),
    )!;
    expect(deck.title).toBe('Lancer Code Buddy');
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0]).toEqual({
      title: 'Pourquoi maintenant',
      bullets: ['15 providers', '27K tests'],
      notes: 'ouvrir fort',
    });
  });

  it('drops empty slides, tolerates missing title, rejects malformed blocks', () => {
    const deck = parseDeckBlock(block('{"slides":[{"bullets":["a"]},{"bullets":[]},{"title":"  "}]}'))!;
    expect(deck.title).toBe('Deck');
    expect(deck.slides).toHaveLength(1);

    expect(parseDeckBlock(block('{oops'))).toBeNull();
    expect(parseDeckBlock(block('{"slides":[]}'))).toBeNull();
    expect(parseDeckBlock('pas de bloc')).toBeNull();
  });
});

describe('stripDeckBlocks', () => {
  it('hides the block from the visible reply', () => {
    const text = 'Avant.\n```deck\n{"slides":[{"title":"x"}]}\n```\nAprès.';
    expect(stripDeckBlocks(text)).toBe('Avant.\n\nAprès.');
  });
});

describe('latestDeckBlock', () => {
  const msg = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
  const deckText = (title: string) => '```deck\n{"title":"' + title + '","slides":[{"title":"s"}]}\n```';

  it('prefers the streaming partial, else the newest assistant deck', () => {
    const messages = [msg('assistant', deckText('Ancien')), msg('assistant', deckText('Récent'))];
    expect(latestDeckBlock(messages)!.title).toBe('Récent');
    expect(latestDeckBlock(messages, deckText('Live'))!.title).toBe('Live');
    expect(latestDeckBlock([msg('user', 'salut')])).toBeNull();
  });
});

describe('prompts', () => {
  it('generation prompt carries the subject and the contract', () => {
    const p = buildDeckGenerationPrompt('vendre NexusFile');
    expect(p).toContain('vendre NexusFile');
    expect(p).toContain('```deck');
    expect(p).toContain("N'utilise AUCUN outil");
  });

  it('export prompt embeds the parsed deck verbatim for the pptx skill', () => {
    const p = buildDeckExportPrompt({ title: 'Mon deck', slides: [{ title: 'A', bullets: ['b'] }] });
    expect(p).toContain('skill pptx');
    expect(p).toContain('« Mon deck.pptx »');
    expect(p).toContain('"bullets"');
  });
});
