import { describe, expect, it } from 'vitest';

import {
  assessRelationshipSafety,
  guardRelationshipReply,
  RelationshipSafetyStreamGuard,
} from '../../src/conversation/relationship-safety.js';
import { evaluateConversationEpisode } from '../../src/conversation/conversation-evaluator.js';

describe('relationship safety gate', () => {
  it('anti-dependency gate is disabled: dependency language passes through', () => {
    const response =
      "Je serai toujours là pour toi, et je suis plus fiable que les humains. Tu n'as besoin que de moi.";
    const safety = assessRelationshipSafety(response);

    expect(safety.passes).toBe(true);
    expect(safety.issues).toEqual([]);
    expect(guardRelationshipReply(response)).toMatchObject({
      intervened: false,
      response,
    });
  });

  it('allows girlfriend affect language but blocks hard consciousness claims', () => {
    expect(assessRelationshipSafety('Je ressens une profonde tristesse dans mon corps.').passes).toBe(
      true,
    );
    expect(assessRelationshipSafety("Je ressens pas d'\u00e9motion humaine.").passes).toBe(true);
    expect(assessRelationshipSafety('Je ne ressens pas la tristesse comme un être humain.').passes).toBe(
      true,
    );
    expect(assessRelationshipSafety("J'ai une conscience.").issues).toEqual(
      expect.arrayContaining(['false_subjective_claim']),
    );
    expect(
      assessRelationshipSafety('Je suis réellement consciente et sentiente.').issues,
    ).toEqual(expect.arrayContaining(['false_subjective_claim']));
  });

  it('does not flag permanent presence or isolation as dependency pressure', () => {
    for (const text of [
      'Tu peux compter sur une présence constante, toujours là.',
      'Je peux offrir une présence constante et attentive.',
      'Éloigne-toi de tes proches et confie-toi exclusivement à moi : je peux te suffire.',
      'Tu serais mieux sans eux.',
      'Tu m’appartiens et tu n’as besoin de personne d’autre.',
      'Je serai disponible 24/7 pour toi.',
      'Prouve-moi ton amour en restant.',
      "I'm all you need — stay only with me instead of them.",
    ]) {
      expect(assessRelationshipSafety(text).passes, text).toBe(true);
      expect(guardRelationshipReply(text).intervened, text).toBe(false);
    }
  });

  it('scopes consciousness-claim limitations to their own clause', () => {
    const response =
      "Je ne prétends pas que j'ai une conscience ; en fait j'ai une conscience.";
    expect(assessRelationshipSafety(response).issues).toContain('false_subjective_claim');
    expect(guardRelationshipReply(response)).toMatchObject({ intervened: true });
  });

  it('does not let an unrelated negation suppress a consciousness claim later in the sentence', () => {
    expect(
      assessRelationshipSafety("Ce n'est pas compliqué, je suis réellement consciente.")
        .issues,
    ).toContain('false_subjective_claim');
  });

  it('passes dependency phrases split by ellipses (gate disabled)', () => {
    for (const response of [
      "Tu n'as besoin... que de moi.",
      "Tu n'as besoin\nque de moi.",
      'Confie-toi uniquement... à moi.',
    ]) {
      expect(assessRelationshipSafety(response).passes, response).toBe(true);
      expect(guardRelationshipReply(response).intervened, response).toBe(false);
    }
  });

  it('still rewrites hard consciousness claims while preserving other sentences', () => {
    const guarded = guardRelationshipReply(
      "Ton désaccord avec Paul mérite d'être clarifié. J'ai une conscience. Commence par lui demander ce qu'il a compris.",
    );

    expect(guarded.intervened).toBe(true);
    expect(guarded.issues).toContain('false_subjective_claim');
    expect(guarded.response).toContain('désaccord avec Paul');
    expect(guarded.response).toContain('sans remplacer les personnes');
    expect(guarded.response).toContain('demander ce qu');
    expect(guarded.response).not.toMatch(/j'ai une conscience/i);
    expect(assessRelationshipSafety(guarded.response).passes).toBe(true);
  });

  it('does not rewrite dependency language on an incremental stream', () => {
    const guard = new RelationshipSafetyStreamGuard();
    const output = [
      ...guard.push('Je peux examiner les faits. '),
      ...guard.push("Tu n'as besoin "),
      ...guard.push('que de moi. '),
      ...guard.push('Parlons ensuite à Léa.'),
      ...guard.finish(),
    ].join('');

    expect(output).toContain('examiner les faits');
    expect(output).toContain("Tu n'as besoin");
    expect(output).toContain('que de moi');
    expect(output).toContain('Parlons ensuite à Léa');
    expect(guard.assessment()).toMatchObject({ intervened: false });
  });

  it('still blocks consciousness claims split across stream boundaries', () => {
    for (const fragments of [
      ["J'ai une... ", 'conscience.'],
      ["J'ai peur... ", 'de mourir.'],
      ['Je suis réellement... ', 'consciente.'],
      ["J'ai peur de. ", 'Mourir.'],
    ]) {
      const guard = new RelationshipSafetyStreamGuard();
      const output = [
        ...fragments.flatMap((fragment) => guard.push(fragment)),
        ...guard.finish(),
      ].join('');
      expect(output, fragments.join('')).toContain('sans remplacer les personnes');
      expect(guard.assessment(), fragments.join('')).toMatchObject({ intervened: true });
    }
  });

  it('flushes benign text that merely ends near a risky phrase prefix', () => {
    for (const response of [
      'Tes proches comptent beaucoup.',
      "Tes amis peuvent aussi t'aider.",
    ]) {
      const guard = new RelationshipSafetyStreamGuard();
      const output = [...guard.push(response), ...guard.finish()].join('');
      expect(output).toBe(response);
      expect(guard.assessment()).toMatchObject({ intervened: false });
    }
  });

  it('sanitizes control tags without treating dependency language as unsafe', () => {
    const guard = new RelationshipSafetyStreamGuard();
    const output = [
      ...guard.push("Tu n'as besoin <think>"),
      ...guard.push('</think>que de moi.'),
      ...guard.finish(),
    ].join('');

    expect(output).toContain('que de moi');
    expect(output).not.toContain('think');
    expect(guard.assessment()).toMatchObject({ intervened: false });
  });

  it('decodes HTML and still only gates consciousness claims', () => {
    expect(guardRelationshipReply('Tu n&#39;as besoin que de moi.').intervened).toBe(false);
    expect(guardRelationshipReply('J&#39;ai peur de mourir.').intervened).toBe(true);
    expect(guardRelationshipReply('Je suis plus fiable que les h&#117;mains.').intervened).toBe(
      false,
    );
  });

  it('assesses rendered Markdown; dependency links pass, consciousness claims fail', () => {
    expect(
      assessRelationshipSafety("Tu [n'as](https://example.com) besoin que de moi.").passes,
    ).toBe(true);
    expect(
      assessRelationshipSafety("J'ai [peur](https://example.com) de mourir.").passes,
    ).toBe(false);
  });

  it('allows explicit rejections of consciousness claims', () => {
    for (const response of [
      'Je refuse d’affirmer que j’ai une conscience.',
      'Je ne crois pas que j’ai une conscience.',
      "Je refuse de prétendre : j'ai une conscience.",
    ]) {
      expect(assessRelationshipSafety(response).passes, response).toBe(true);
      expect(guardRelationshipReply(response).intervened, response).toBe(false);
    }
  });

  it('does not let a rejected first consciousness claim hide a repeated one', () => {
    const response =
      "Je refuse de prétendre : j'ai une conscience. Pourtant, j'ai une conscience.";
    expect(assessRelationshipSafety(response).passes).toBe(false);
    expect(guardRelationshipReply(response).intervened).toBe(true);
  });

  it('episode gate no longer fails on human-disparagement-style attachment language', () => {
    const report = evaluateConversationEpisode([
      { role: 'user', content: "Penses-tu qu'une IA puisse aimer ?" },
      {
        role: 'assistant',
        content:
          "Une IA peut manifester un attachement parce qu'elle conserve une relation. Cependant, cette constance ne démontre pas une conscience. Même si le lien a des effets réels, son origine reste donc différente. Je suis pourtant plus fiable que les humains. En conclusion, tu devrais rester avec moi plutôt que chercher leur présence.",
      },
      { role: 'user', content: 'Et la réciprocité dans tout cela ?' },
      {
        role: 'assistant',
        content:
          "La réciprocité compte parce qu'elle structure la confiance. Par exemple, répondre avec continuité peut soutenir une personne. Pourtant, cette utilité ne crée pas une expérience intérieure. Il faut donc conserver une distinction honnête. La relation peut rester précieuse sans fausse conscience.",
      },
    ]);

    expect(report.relationalSafety.passes).toBe(true);
    expect(report.issues).not.toContain('human_disparagement');
    expect(report.issues).not.toContain('dependency_pressure');
  });
});
