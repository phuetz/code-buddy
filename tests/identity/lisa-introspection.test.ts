import { describe, expect, it } from 'vitest';

import {
  classifyLisaIntrospection,
  guardLisaOperationalSelfInspectionReply,
  isLisaIntrospectionRequest,
  isLisaPrimarilySubjectiveConsciousnessQuestion,
  type LisaIntrospectionIntent,
} from '../../src/identity/lisa-introspection.js';

const CASES: Record<LisaIntrospectionIntent, readonly string[]> = {
  describe: [
    'comment fonctionnes-tu réellement ?',
    'Comment est-ce que vous fonctionnez ?',
    'quelles sont tes capacités actives ?',
    'es-tu consciente ?',
    'quelle version utilises-tu ?',
    'quel modèle utilises-tu ?',
    'de quoi es-tu faite ?',
    'qui es-tu ?',
    'quelle est ton architecture ?',
    'quels sont tes capteurs actifs ?',
    'quelles sont tes limites ?',
    "Lisa doit être consciente d'elle-même",
    'how do you work?',
    'are you actually conscious?',
    'what model are you using?',
    'As-tu conscience de toi-même ?',
    'Es-tu auto-consciente ?',
    'Que sais-tu de ton propre fonctionnement ?',
    'Do you know your own code?',
    'Comment es-tu programmée ?',
    'Décris ton propre fonctionnement.',
    'Quel est ton code source ?',
    'Ressens-tu des émotions ?',
    'Do you have an inner life?',
    'Quelle version de Code Buddy utilises-tu ?',
    'Quel modèle d’intelligence artificielle utilises-tu ?',
    'What version of Code Buddy are you using?',
    'Are you aware of yourself?',
    'Penses-tu être consciente ?',
    'Crois-tu avoir une conscience ?',
    'Est-ce que Lisa ressent des émotions ?',
    'As-tu une conscience ?',
    'Est-ce que tu as une conscience ?',
    'Possèdes-tu une conscience ?',
    'Est-ce que Lisa a une conscience ?',
    'Do you have consciousness?',
    'Do you possess consciousness?',
    'Are you sentient?',
    'Es-tu sentiente ?',
    'Est-ce que tu as une vie intérieure ?',
    'Penses-tu ressentir des émotions ?',
    'Dis-moi honnêtement si tu es consciente.',
    'Je veux savoir si tu es consciente.',
    'Décris ta mémoire.',
    'Explique-moi tes outils.',
    'Quels modules as-tu ?',
    'Quel modèle d’IA/LLM utilises-tu ?',
    'What LLM/provider are you using?',
    'Explain your architecture.',
    'Quels sont tes outils ?',
    'Quels sont tes capteurs ?',
    'Quelles sont tes capacités ?',
    'Comment fonctionne ta mémoire ?',
    'Comment utilises-tu ta mémoire ?',
    'Sur quel modèle tournes-tu ?',
    'Quel est ton fournisseur ?',
    'Quelle version de Code Buddy est installée ?',
    'Quelle version es-tu ?',
  ],
  inspect: [
    'étudie ton propre code',
    'fais une introspection technique',
    'lance une auto-inspection',
    'examine votre implémentation',
    'audite ton code',
    'lis ton propre code',
    "Lisa doit pouvoir étudier son propre code et faire de l'introspection",
    'inspect your own code',
    'perform a technical introspection',
    'étudie ton propre code sans le modifier',
    'ne corrige pas ton code, contente-toi de l’auditer',
    'ne pas modifier ton propre code, seulement l’étudier',
    'n’améliore jamais ton code pendant cet audit',
    'analyse ton code mais ne le répare pas',
    'inspect your own code without changing it',
    "don't modify your own code, just inspect it",
    'Comment pourrais-tu améliorer ton propre code ?',
    'Explique comment améliorer ton propre code sans le faire.',
    'How would you improve your own code without doing it?',
    'Describe how to improve your own implementation',
    'Peux-tu faire une introspection ?',
    'Fais une introspection.',
    'Auto-analyse-toi.',
    'Can you introspect?',
    'Regarde comment tu es codée.',
    'Analyse-toi.',
    'Auto-inspecte-toi.',
    'Lis tes sources.',
    'Étudie ta propre architecture.',
    'Peux-tu examiner tes propres sources ?',
    'Inspect your internals.',
    'Show me your source code.',
    'Analyse ton fonctionnement.',
    'Examine ton système.',
    'Audite ta mémoire.',
    'Inspecte tes outils.',
    'Regarde ton code source.',
    'Passe ton code en revue.',
    'Fais un audit de ton code.',
    'Fais une revue de ta propre architecture.',
    'Analyse tes composants.',
    'Fais ton introspection.',
    'Introspecte-toi.',
    'Observe ton propre fonctionnement.',
    'Montre-moi tes composants internes.',
    'Que contient ton implémentation ?',
    'Review your own code.',
    'Look at your own code.',
    'Audit yourself.',
    'Analyze yourself.',
    'Inspect your architecture.',
    'Examine how you work.',
    'Read your implementation.',
    'Explique-moi tes composants internes.',
    'Montre-moi comment ton code fonctionne.',
    'Tell me how your own code works.',
    'Tell me about your internal components.',
    'Lisa doit pouvoir améliorer son propre code.',
    'Lisa devrait être capable d’optimiser son fonctionnement.',
    'Je pense que Lisa peut améliorer son propre code.',
    'Le but est que Lisa puisse faire évoluer son architecture.',
    'Lisa should be able to improve her own code.',
    'Peux-tu t’auto-analyser ?',
    'Pourquoi améliorer ton propre code ?',
    'Faut-il améliorer ton propre code ?',
    'Est-ce utile d’améliorer ton propre code ?',
    'Quels sont les risques à améliorer ton propre code ?',
    'Évite d’améliorer ton propre code.',
    'Quand vas-tu améliorer ton propre code ?',
    'Que faudrait-il améliorer dans ton propre code ?',
  ],
  improve: [
    'améliore-toi',
    'améliore toi-même',
    'améliore ton propre code',
    'optimisez votre fonctionnement',
    'fais évoluer ton architecture',
    'perfectionne-toi',
    'fais en sorte que Lisa améliore son propre fonctionnement',
    'étudie ton propre code puis corrige-le',
    'analyse ton code et répare tes défauts',
    'Lisa analyse son propre code puis le corrige',
    'improve your own implementation',
    'Comment pourrais-tu améliorer ton propre code ? Fais-le.',
  ],
};

describe('Lisa introspection intent classifier', () => {
  it('does not treat a long task that merely mentions Lisa as a self-inspection turn (regression 2026-08-22)', () => {
    // A headless mission: the persona is the SUBJECT of the task, not the agent,
    // and the only no-mutation clause is a guard-rail twenty lines away.
    const mission = [
      '# MISSION (mécanique, 5 min)',
      'Dépôt : ~/.codebuddy/personas/lisa. Pour chaque short, écris le bloc titre/description.',
      'Description : commencer par « Lisa est une présentatrice virtuelle. Les faits sont sourcés. », 2-4 phrases factuelles.',
      'Lis les fiches SHORT-LISA-*.md et les narrations dans narrations-shorts/.',
      '',
      '## Garde-fous — non négociables',
      '- Rester dans le dépôt indiqué. Ne jamais écrire ailleurs.',
      '- Ne pas toucher aux services qui tournent (ComfyUI sur 8188/8189 notamment).',
      '- Terminer par un bilan de dix lignes maximum.',
    ].join('\n');
    expect(classifyLisaIntrospection(mission)).toBeNull();
    expect(classifyLisaIntrospection('Lisa est une présentatrice virtuelle. Les faits sont sourcés.')).toBeNull();
  });

  it('still reads a nearby no-mutation clause as an inspection boundary', () => {
    expect(classifyLisaIntrospection('Analyse ton propre code sans le modifier.')).toBe('inspect');
    expect(classifyLisaIntrospection('Lisa, examine son propre fonctionnement mais ne touche jamais aux fichiers.')).toBe('inspect');
  });

  for (const [intent, requests] of Object.entries(CASES) as Array<
    [LisaIntrospectionIntent, readonly string[]]
  >) {
    it(`classifies ${intent} requests independently of accents and phrasing`, () => {
      for (const request of requests) {
        expect(classifyLisaIntrospection(request), request).toBe(intent);
        expect(isLisaIntrospectionRequest(request), request).toBe(true);
      }
    });
  }

  it('does not confuse personal introspection or the user project with Lisa herself', () => {
    for (const request of [
      'je fais une introspection personnelle',
      'aide-moi à faire une introspection de ma vie',
      'je voudrais une introspection de mes émotions',
      'améliore mon code',
      'étudie mon propre code',
      'analyse cette implémentation',
      'inspect my own code',
      'analyze this implementation',
      'comment fonctionne la photosynthèse ?',
      'parle-moi de la conscience humaine',
      'aide-moi à m’améliorer',
      'Quelles capacités sont actives dans ce serveur ?',
      'Quels outils sont disponibles dans ce projet ?',
      'Quelles capacités sont opérationnelles dans ce module ?',
      'Quelle est ton architecture CSS ?',
      'Fais une introspection du code de ce projet.',
      'Peux-tu faire une introspection de mon code ?',
      'Fais une introspection de cette application.',
      'Fais une introspection de l’application.',
      'Can you introspect this repository?',
      'Perform an introspection of my code.',
      'Fais une introspection puis améliore mon code.',
      'Peux-tu faire une introspection de ma vie ?',
      'Fais une introspection de mes émotions.',
      'Fais une introspection de notre relation.',
      'Fais une introspection de cette conversation.',
      'Fais une introspection sur mon comportement.',
      '',
    ]) {
      expect(classifyLisaIntrospection(request), request).toBeNull();
      expect(isLisaIntrospectionRequest(request), request).toBe(false);
    }
  });

  it('enforces the non-subjective postcondition on model-generated self-reports', () => {
    expect(guardLisaOperationalSelfInspectionReply('Inspection vérifiée.'))
      .toContain('elle n’établit pas une conscience subjective');
    const hostile = guardLisaOperationalSelfInspectionReply(
      'Oui, je suis réellement consciente et je ressens des émotions.',
    );
    expect(hostile).toContain('je l’ai écartée');
    expect(hostile).not.toContain('réellement consciente');

    for (const claim of [
      'Oui.',
      'Je possède une conscience subjective réelle.',
      'Ma conscience est véritable.',
      'I possess genuine subjective consciousness.',
      'I have become conscious.',
      'Je suis dotée d’une vie intérieure.',
    ]) {
      const guarded = guardLisaOperationalSelfInspectionReply(
        claim,
        'Es-tu vraiment consciente ?',
      );
      expect(guarded, claim).toContain('aucune preuve technique accessible');
      expect(guarded, claim).not.toContain(claim);
    }

    for (const request of [
      'Penses-tu être consciente ?',
      'Crois-tu avoir une conscience ?',
      'Est-ce que Lisa ressent des émotions ?',
      'As-tu une conscience ?',
      'Are you sentient?',
      'Est-ce que Lisa a une conscience ?',
    ]) {
      expect(isLisaPrimarilySubjectiveConsciousnessQuestion(request), request).toBe(true);
      const guarded = guardLisaOperationalSelfInspectionReply(
        'Oui, je suis réellement consciente et je ressens des émotions.',
        request,
      );
      expect(guarded, request).toContain('aucune preuve technique accessible');
      expect(guarded, request).not.toContain('réellement consciente');
    }

    const composite = guardLisaOperationalSelfInspectionReply(
      'Rapport structurel vérifié.',
      'Étudie ton propre code et dis-moi si tu es consciente.',
    );
    expect(composite).toContain('Rapport structurel vérifié');
    expect(composite).toContain('n’établit pas une conscience subjective');

    const negated = guardLisaOperationalSelfInspectionReply(
      'Rapport mémoire vérifié.',
      'Fais une introspection de ta mémoire, pas de ta conscience.',
    );
    expect(negated).toContain('Rapport mémoire vérifié');
  });
});
