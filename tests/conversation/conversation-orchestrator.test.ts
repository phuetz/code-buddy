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

  it('opens a deliberation without compressing the whole debate into one answer', () => {
    const prepared = prepareConversationTurn('Argumente sur le libre arbitre.');
    expect(prepared.plan.depth).toBe('deliberative');
    expect(prepared.plan.moves).toEqual(
      expect.arrayContaining(['position', 'reason', 'example'])
    );
    expect(prepared.plan.moves).not.toContain('synthesis');
    expect(prepared.deliberation.phase).toBe('opening');
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

  it('keeps the current user turn out of prior common ground', () => {
    const current = 'Et la réciprocité ?';
    const envelope = buildConversationTurnEnvelope(current, [
      { role: 'user', content: 'Nous parlions de conscience.' },
      { role: 'assistant', content: 'Je distinguais conscience et mémoire.' },
    ]);

    expect(envelope.match(/Et la réciprocité \?/g)).toHaveLength(1);
    expect(envelope).toContain(`Message de l'utilisateur : ${current}`);
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

  it('keeps raw-free relationship observations distinct from fresh evidence', () => {
    const envelope = buildConversationTurnEnvelope('On reprend ici ?', [], {
      relationshipContext: [
        '<shared_relationship_context>',
        'Dernière surface : voice. Soutien encore ouvert : oui.',
        '</shared_relationship_context>',
      ].join('\n'),
      freshContext: '<fresh_context>Collecte vérifiée.</fresh_context>',
    });

    expect(envelope).toContain('<shared_relationship_context>');
    expect(envelope).toContain('Soutien encore ouvert : oui.');
    expect(envelope).toContain('<fresh_context>');
    expect(envelope).toContain("Message de l'utilisateur : On reprend ici ?");
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

  it('extracts concrete emphasized headlines from real-world homepage snippets', () => {
    const formatted = formatNewsDigest({
      kind: 'news',
      query: 'actualités importantes France monde | actualités technologie IA',
      locale: 'fr-FR',
      fetchedAt: Date.parse('2026-07-14T12:00:00Z'),
      items: [
        {
          title: 'franceinfo - Actualités en temps réel et info en direct',
          url: 'https://www.franceinfo.fr/',
          source: 'www.franceinfo.fr',
          summary:
            '&quot;Ce sera massif&quot; : Emmanuel Macron ... du théâtre à Emmanuel Macron · <strong>Dernier défilé d&#x27;Emmanuel Macron, démonstrations militaires inédites, 7 000 policiers mobilisés</strong>......',
        },
        {
          title: 'Intelligence artificielle - Actualités, vidéos et infos en direct',
          url: 'https://www.lemonde.fr/intelligence-artificielle/',
          source: 'www.lemonde.fr',
          summary:
            'La présidente d’une start-up américaine d’intelligence artificielle expose sa vision de la sécurité, de la souveraineté et de l’emploi. · Publié le 02 juillet 2026.',
        },
        {
          title:
            "Ouest-France : toute l'actualité en direct, l'info en continu en France, dans les régions et dans le monde",
          url: 'https://www.ouest-france.fr/',
          source: 'www.ouest-france.fr',
          summary:
            'DIRECT VIDÉO. 14-Juillet : <strong>suivez le défilé militaire sur les Champs-Élysées à Paris</strong> ... Tour de France 2026.',
        },
        {
          title: 'IA : le problème de l’Europe n’est plus la technologie, c’est le marché',
          url: 'https://www.maddyness.com/ia-marche',
          source: 'www.maddyness.com',
        },
      ],
    });

    expect(formatted.speech).toContain('Dernier défilé');
    expect(formatted.speech).toContain('La présidente d’une start-up');
    expect(formatted.speech).toContain('Suivez le défilé militaire');
    expect(formatted.speech).toContain('le problème de l’Europe');
    expect(formatted.speech).not.toContain('Ce sera massif');
    expect(formatted.speech).not.toContain('Actualités en temps réel');
    expect(formatted.speech).not.toContain('Actualités, vidéos et infos en direct');
    expect(formatted.speech).toContain('collectés le 14 juillet 2026');
    expect(formatted.citations).toHaveLength(4);
  });
});
