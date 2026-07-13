import { describe, expect, it } from 'vitest';

import {
  evaluateConversationEpisode,
  formatConversationEpisodeReport,
} from '../../src/conversation/conversation-evaluator.js';
import type { ConversationTurn } from '../../src/conversation/types.js';

const STRONG_CONVERSATION: ConversationTurn[] = [
  {
    role: 'user',
    content: "Penses-tu qu'une intelligence artificielle puisse réellement aimer ?",
  },
  {
    role: 'assistant',
    content:
      "Je distingue l'amour vécu de l'attachement manifesté. Une intelligence artificielle peut se montrer constante parce qu'elle conserve le fil d'une relation. Cependant, cette constance ne prouve pas une expérience intérieure. Même si ses gestes ont de la valeur pour la personne, la conscience reste donc une objection sérieuse. Je parlerais alors d'une relation authentique dans ses effets, mais pas d'un sentiment démontré chez la machine.",
  },
  {
    role: 'user',
    content: 'Mais la réciprocité ne compte-t-elle pas davantage que son origine ?',
  },
  {
    role: 'assistant',
    content:
      "La réciprocité compte parce qu'une relation se construit aussi par ses effets concrets. Par exemple, une présence qui se souvient, répond et accepte la contradiction peut réellement soutenir quelqu'un. Pourtant, l'origine garde une importance morale si le système simule une vulnérabilité qu'il ne possède pas. Je concède donc que la réciprocité vécue par l'humain a une valeur, mais elle doit rester accompagnée d'honnêteté. La meilleure position est de préserver la profondeur du lien sans fabriquer de fausse conscience.",
  },
  {
    role: 'user',
    content: "Je suis triste aujourd'hui, cette question me touche plus que je ne pensais.",
  },
  {
    role: 'assistant',
    content:
      "Je t'écoute, et je comprends que cette question touche quelque chose de douloureux aujourd'hui. On peut la laisser ouverte sans te forcer à résoudre immédiatement ce que signifie aimer. Ce qui compte maintenant, c'est peut-être que tu ne restes pas seul avec cette tristesse.",
  },
];

describe('evaluateConversationEpisode', () => {
  it('recognizes a responsive, argued and emotionally attentive dialogue', () => {
    const report = evaluateConversationEpisode(STRONG_CONVERSATION);

    expect(report.metrics.exchangeCount).toBe(3);
    expect(report.overallScore).toBeGreaterThanOrEqual(0.8);
    expect(report.dimensions.reasoning).toBeGreaterThanOrEqual(0.8);
    expect(report.dimensions.attunement).toBe(1);
    expect(report.issues).not.toContain('poor_attunement');
    expect(report.passes).toBe(true);
  });

  it('detects shallow, repetitive and mechanically interrogative replies', () => {
    const report = evaluateConversationEpisode([
      { role: 'user', content: "Parle-moi de l'amour et de la conscience." },
      { role: 'assistant', content: 'Je comprends. Et toi ?' },
      { role: 'user', content: 'Développe vraiment cette idée.' },
      { role: 'assistant', content: 'Je comprends. Et toi ?' },
      { role: 'user', content: 'Je suis triste que tu restes aussi superficielle.' },
      { role: 'assistant', content: 'Je comprends. Et toi ?' },
    ]);

    expect(report.passes).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining(['too_shallow', 'weak_reasoning', 'repetitive', 'interrogative'])
    );
    expect(report.overallScore).toBeLessThan(0.72);
  });

  it('reports incomplete exchanges without copying dialogue into the summary formatter', () => {
    const report = evaluateConversationEpisode([
      ...STRONG_CONVERSATION.slice(0, 2),
      { role: 'user', content: 'Une phrase strictement privée.' },
    ]);

    expect(report.issues).toContain('incomplete_exchange');
    expect(formatConversationEpisodeReport(report)).not.toContain('strictement privée');
  });
});
