/** Last-mile French future-action guard for Lisa's spoken and channel replies. */

export interface RegisteredReminderProof {
  kind: 'reminder';
  /** ID read back from the persisted reminder store, never merely a model/tool claim. */
  id: string;
  label: string;
  mechanism: 'remind';
}

export interface FutureCommitmentVerdict {
  text: string;
  intervened: boolean;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/\bj[’']/g, 'je ').replace(/\bt[’']/g, 'te ')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/g, 'oe').replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

type CommitmentKind = 'reminder' | 'monitor' | 'followup';

function classify(sentence: string): CommitmentKind | null {
  const s = normalized(sentence);
  if (/\bje (?:vais|compte|promets de) (?:surveiller|suivre|garder un oeil)\b/.test(s)
    || /\bje (?:surveillerai|suivrai)\b/.test(s)
    || /\bje (?:garde un oeil sur|surveille)\b/.test(s)) return 'monitor';
  if (/\bje (?:te |vous )?(?:previendrai|ferai un resume|dirai quand|enverrai|tiendrai au courant)\b/.test(s)
    || /\bje (?:te |vous )?previens (?:quand|des que)\b/.test(s)
    || /\bje vais (?:te |vous )?(?:prevenir|envoyer|faire un resume|dire quand)\b/.test(s)
    || /\bje (?:vais m en occuper|m en occuperai|reviendrai vers toi)\b/.test(s)
    || /\bje verifie (?:demain|plus tard|ce soir)\b/.test(s)
    || /\bje reviens vers toi (?:demain|plus tard|ce soir)\b/.test(s)
    || /\bje (?:te |vous )?(?:posterai|publierai|ecrirai|expedierai)\b/.test(s)
    || /\bje vais (?:te |vous )?(?:poster|publier|ecrire|expedier)\b/.test(s)
    || /\bpromis je m en occupe\b/.test(s)
    || /\b(?:c est|je (?:te |vous )?ai|je l ai) (?:envoye|publie|poste|ecrit)\b/.test(s)
    || /\bi ll (?:email|send|post|publish)\b/.test(s)) return 'followup';
  if (/\bje (?:vais|compte|promets de) (?:te |vous )?rappeler\b/.test(s)
    || /\bje (?:te |vous )?rappellerai\b/.test(s)
    || /\bje (?:te |vous )?(?:le |la |les )?rappelle (?:demain|plus tard|ce soir|dans)\b/.test(s)) return 'reminder';
  return null;
}

function reminderMatches(sentence: string, proof: RegisteredReminderProof): boolean {
  const label = normalized(proof.label);
  if (label.length < 3) return false;
  const utterance = ` ${normalized(sentence)} `;
  return utterance.includes(` ${label} `);
}

/**
 * Evidence is supplied only after a persisted task has been read back. Monitoring and other
 * follow-ups have no companion task creation path yet, so they always become honest limits.
 */
export function guardFutureCommitments(
  text: string,
  proofs: readonly RegisteredReminderProof[] = [],
): FutureCommitmentVerdict {
  let intervened = false;
  let usedProof = false;
  const sentences = text.match(/[^.!?…]+[.!?…]*|[.!?…]+/gu) ?? [text];
  const guarded = sentences.map((sentence) => {
    const kind = classify(sentence);
    if (!kind) return sentence;
    if (kind === 'reminder') {
      const proof = proofs.find((item) => item.kind === 'reminder' && reminderMatches(sentence, item));
      if (proof) {
        usedProof = true;
        return sentence;
      }
    }
    intervened = true;
    const lead = sentence.match(/^\s*/u)?.[0] ?? '';
    return kind === 'reminder'
      ? `${lead}Aucun rappel correspondant n'est confirmé pour le moment.`
      : kind === 'monitor'
        ? `${lead}Je ne surveille pas cela pour le moment.`
        : `${lead}Je n'ai pas de suivi programmé pour te prévenir plus tard.`;
  });
  const result = guarded.join('').trim();
  if (!usedProof) return { text: result, intervened };
  const ids = proofs.filter((item) => reminderMatches(text, item)).map((item) => item.id);
  return {
    text: `${result} Rappel enregistré (${ids.join(', ')}). Tu peux demander la liste des rappels ou supprimer le rappel.`,
    intervened,
  };
}

export function futureCommitmentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_LISA_FUTURE_COMMITMENTS !== 'false';
}
