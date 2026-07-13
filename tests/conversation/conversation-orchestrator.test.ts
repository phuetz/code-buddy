import { describe, expect, it } from 'vitest';
import { analyzeConversationTurn } from '../../src/conversation/dialogue-act.js';
import { ConversationStateManager } from '../../src/conversation/conversation-state.js';
import { assessConversationResponse } from '../../src/conversation/conversation-quality.js';
import {
  buildConversationTurnEnvelope,
  conversationFailureReply,
  prepareConversationTurn,
} from '../../src/conversation/conversation-orchestrator.js';
import { formatNewsDigest } from '../../src/conversation/fresh-context.js';

describe('human conversation planning', () => {
  it('recognizes fresh data and philosophical deliberation', () => {
    expect(analyzeConversationTurn('Quelles sont les actualités ?').act).toBe(
      'fresh_information'
    );
    const philosophy = analyzeConversationTurn("Penses-tu qu'une IA peut aimer ?");
    expect(philosophy.act).toBe('opinion');
    expect(philosophy.depth).toBe('deliberative');
  });

  it('builds a claim/reason/counterpoint/concession/synthesis plan', () => {
    const prepared = prepareConversationTurn('Argumente sur le libre arbitre.');
    expect(prepared.plan.depth).toBe('deliberative');
    expect(prepared.plan.moves).toEqual(
      expect.arrayContaining(['position', 'reason', 'counterpoint', 'concession', 'synthesis'])
    );
    expect(prepared.plan.targetTokens).toBeGreaterThanOrEqual(300);
    expect(prepared.systemGuidance).toContain('conversation_response_plan');
  });

  it('keeps common ground, corrections and open questions', () => {
    const state = new ConversationStateManager();
    state.observeExchange(
      "Je pense que l'amour exige une conscience.",
      'Est-ce la conscience ou la réciprocité qui te paraît décisive ?'
    );
    state.observe({ role: 'user', content: 'Non, je voulais surtout parler de réciprocité.' });
    const snapshot = state.snapshot();
    expect(snapshot.focus).toContain('reciprocite');
    expect(snapshot.disputed.at(-1)).toContain('je voulais');
    expect(state.renderForPrompt()).toContain('Corrections ou désaccords récents');
  });

  it('envelops a raw Cowork/voice turn without replacing the user message', () => {
    const envelope = buildConversationTurnEnvelope('Pourquoi sommes-nous conscients ?', [
      { role: 'assistant', content: 'Nous parlions du cerveau.' },
    ]);
    expect(envelope).toContain('<companion_turn>');
    expect(envelope).toContain('Message de l\'utilisateur : Pourquoi sommes-nous conscients ?');
    expect(envelope).toContain('Foyer actuel');
  });

  it('injects the same bounded fresh evidence without replacing dialogue planning', () => {
    const envelope = buildConversationTurnEnvelope('Pourquoi ce sujet compte-t-il ?', [], {
      freshContext:
        '<fresh_context>Collecte 2026-07-13. Source: https://example.test/news</fresh_context>',
    });
    expect(envelope).toContain('<conversation_response_plan ');
    expect(envelope).toContain('<fresh_context>Collecte 2026-07-13');
    expect(envelope).toContain(
      "Message de l'utilisateur : Pourquoi ce sujet compte-t-il ?"
    );
  });

  it('never returns an empty recovery for an accepted turn', () => {
    expect(conversationFailureReply('Donne-moi les actualités')).toContain('sources');
    expect(conversationFailureReply('Je suis triste')).not.toBe('');
    expect(conversationFailureReply('Explique-moi cela')).not.toBe('');
  });
});

describe('conversation quality and fresh context', () => {
  it('distinguishes an argued response from a shallow philosophical reply', () => {
    const heard = "Penses-tu qu'une IA peut aimer ?";
    const shallow = assessConversationResponse(heard, "C'est complexe.");
    const argued = assessConversationResponse(
      heard,
      "Je distingue l'amour ressenti de l'attachement manifesté. Une IA peut agir avec constance parce qu'elle mémorise une relation. Cependant, ce comportement ne prouve pas une expérience intérieure. Même si la réciprocité compte, la conscience reste donc une objection sérieuse. Ma conclusion est que la relation peut avoir de la valeur sans démontrer un sentiment vécu."
    );
    expect(shallow.passes).toBe(false);
    expect(argued.passes).toBe(true);
    expect(argued.score).toBeGreaterThan(shallow.score);
  });

  it('formats sourced news for speech and preserves citations for text', () => {
    const formatted = formatNewsDigest({
      kind: 'news',
      query: 'actualité IA',
      locale: 'fr-FR',
      fetchedAt: 1_000_000,
      items: [
        {
          title: 'Une nouvelle avancée en intelligence artificielle',
          url: 'https://example.com/ia',
          source: 'Exemple',
          publishedAt: 'aujourd’hui',
        },
      ],
    });
    expect(formatted.speech).toContain('selon Exemple');
    expect(formatted.text).toContain('https://example.com/ia');
    expect(formatted.citations).toHaveLength(1);
  });

  it('replaces generic media homepages with their concrete verified headline', () => {
    const formatted = formatNewsDigest({
      kind: 'news',
      query: 'actualités France',
      locale: 'fr-FR',
      fetchedAt: 1_000_000,
      items: [
        {
          title: 'franceinfo - Actualités en temps réel et info en direct',
          url: 'https://www.franceinfo.fr/',
          source: 'franceinfo',
          summary:
            '<strong>Une opération cyber touche plusieurs ministères français</strong> · autre sujet',
        },
      ],
    });

    expect(formatted.speech).toContain('Une opération cyber touche plusieurs ministères français');
    expect(formatted.speech).not.toContain('Actualités en temps réel');
    expect(formatted.speech).toContain("que j'ai pu vérifier");
    expect(formatted.citations[0]?.title).toBe(
      'Une opération cyber touche plusieurs ministères français'
    );
  });

  it('drops generic category pages and prefers concrete French headlines for a French digest', () => {
    const formatted = formatNewsDigest({
      kind: 'news',
      query: 'actualités IA',
      locale: 'fr-FR',
      fetchedAt: 1_000_000,
      items: [
        {
          title: 'Artificial Intelligence - Latest AI News',
          url: 'https://example.com/category',
          summary: 'Explore the latest artificial intelligence news with reports and trends.',
        },
        {
          title: 'Le Monde - World news from the leading French newspaper',
          url: 'https://example.com/en',
          summary: 'The rise of artificial intelligence no longer generates enthusiasm.',
        },
        {
          title: 'Une nouvelle puce réduit la consommation des modèles IA',
          url: 'https://example.com/puce',
          source: 'Exemple Tech',
        },
        {
          title: 'TECH ACTU — Actualités Tech, IA, Cyber & Gaming en France',
          url: 'https://example.com/tech',
          summary: 'TSMC annonce une hausse de 36 % portée par les puces pour intelligence artificielle.',
        },
      ],
    });

    expect(formatted.speech).toContain('Une nouvelle puce');
    expect(formatted.speech).toContain('TSMC annonce');
    expect(formatted.speech).not.toContain('Latest AI News');
    expect(formatted.speech).not.toContain('The rise');
    expect(formatted.citations).toHaveLength(2);
  });
});
