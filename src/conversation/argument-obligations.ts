import type { ConversationPlan } from './types.js';

/** A response can have at most one obligation of each semantic kind. */
export const MAX_ARGUMENT_OBLIGATIONS = 6;
export const MAX_ARGUMENT_OBLIGATION_TARGET_CHARS = 320;

export type ArgumentObligationTargetSource =
  | 'current_turn'
  | 'deliberation_open_question'
  | 'deliberation_objection'
  | 'deliberation_correction'
  | 'deliberation_assistant_position';

/**
 * Bounded evidence identifying what an obligation is about. The excerpt is
 * data, not an instruction or a completion criterion.
 */
export interface ArgumentObligationTarget {
  source: ArgumentObligationTargetSource;
  excerpt: string;
}

/**
 * Semantic commitments for a response. `kind` is the stable obligation ID;
 * each kind occurs at most once in a derived list.
 *
 * These types intentionally describe what must be achieved without defining
 * lexical proxies for whether it was achieved. A semantic reviewer can assess
 * the obligations later without rewarding connective words or sentence count.
 */
export type ArgumentObligation =
  | {
      kind: 'answer_question';
      mode: 'required';
      question?: ArgumentObligationTarget;
    }
  | {
      kind: 'support_position';
      mode: 'required';
      position?: ArgumentObligationTarget;
    }
  | {
      kind: 'address_objection';
      mode: 'required';
      objection: ArgumentObligationTarget;
    }
  | {
      kind: 'revise_or_defend_position';
      mode: 'required';
      priorPosition: ArgumentObligationTarget;
      challenge: ArgumentObligationTarget;
    }
  | {
      kind: 'source_fresh_facts';
      mode: 'required';
      topic?: ArgumentObligationTarget;
    }
  | {
      kind: 'express_uncertainty';
      mode: 'conditional';
      when: 'evidence_incomplete_or_conflicting' | 'conclusion_remains_contestable';
      topic?: ArgumentObligationTarget;
    };

function boundedExcerpt(value: string | undefined): string | undefined {
  const excerpt = value
    ?.replace(/\p{Cc}+/gu, ' ')
    .replace(/[<>&]/g, (character) => {
      if (character === '<') return '‹';
      if (character === '>') return '›';
      return '＆';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ARGUMENT_OBLIGATION_TARGET_CHARS);
  return excerpt || undefined;
}

function target(
  source: ArgumentObligationTargetSource,
  value: string | undefined
): ArgumentObligationTarget | undefined {
  const excerpt = boundedExcerpt(value);
  return excerpt ? { source, excerpt } : undefined;
}

function currentTurnTarget(currentTurn: string | undefined): ArgumentObligationTarget | undefined {
  return target('current_turn', currentTurn);
}

function questionTarget(
  plan: ConversationPlan,
  currentTurn: string | undefined
): ArgumentObligationTarget | undefined {
  return (
    currentTurnTarget(currentTurn) ??
    target('deliberation_open_question', plan.deliberation.openQuestion)
  );
}

function currentChallenge(plan: ConversationPlan): ArgumentObligationTarget | undefined {
  return plan.deliberation.correction
    ? target('deliberation_correction', plan.deliberation.correction)
    : target('deliberation_objection', plan.deliberation.objection);
}

function requiresDirectAnswer(plan: ConversationPlan, currentTurn: string | undefined): boolean {
  if (
    plan.act === 'question' ||
    plan.act === 'clarification' ||
    plan.act === 'fresh_information'
  ) {
    return true;
  }

  // Opinion questions are classified as `opinion` before the generic question
  // act. The punctuation/open-question state is used only to derive the target;
  // it is never used to validate a model response.
  if (
    plan.act === 'action' ||
    plan.act === 'closing' ||
    plan.act === 'phatic' ||
    plan.act === 'backchannel' ||
    plan.act === 'continuation'
  ) {
    return false;
  }
  if (currentTurn !== undefined) return currentTurn.includes('?');
  return plan.deliberation.phase === 'opening' && Boolean(plan.deliberation.openQuestion);
}

function normalizeEvidenceQuestion(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect a question whose answer claims direct knowledge of a runtime event.
 * These short confirmations need evidence just as much as a longer factual
 * answer, even though the dialogue planner otherwise treats them as ordinary
 * conversation.
 */
export function isRuntimeEvidenceVerificationRequest(value: string): boolean {
  const normalized = normalizeEvidenceQuestion(value);
  if (!normalized) return false;
  const asksQuestion =
    value.includes('?') ||
    /^(?:est ce que|as tu|avez vous|did you|have you|can you confirm|peux tu confirmer)\b/u.test(
      normalized
    );
  if (!asksQuestion) return false;
  const refersToReceiver =
    /\b(?:tu|te|t|toi|vous|you|lisa|robot|systeme|code buddy)\b/u.test(normalized);
  const asksAboutObservedEvent =
    /\b(?:transmis|transmise|transmettre|recu|recue|recevoir|entendu|entendue|entends|capt(?:e|ee|ure|uree)|arriv(?:e|ee)|received|receive|sent|transmitted|heard|captured)\b/u.test(
      normalized
    );
  return refersToReceiver && asksAboutObservedEvent;
}

function requiresFreshSources(plan: ConversationPlan, currentTurn?: string): boolean {
  return (
    plan.analysis.needsFreshContext ||
    plan.act === 'fresh_information' ||
    (plan.moves.includes('freshness') && plan.moves.includes('source')) ||
    (currentTurn !== undefined && isRuntimeEvidenceVerificationRequest(currentTurn))
  );
}

/**
 * Derive a deterministic, bounded set of semantic obligations from the plan
 * that already drives the response. The optional current turn supplies a more
 * precise target for normal questions and fresh-information requests.
 *
 * This function does not inspect a candidate response and deliberately makes
 * no claim that surface words, length or rhetorical markers satisfy an
 * obligation.
 */
export function deriveArgumentObligations(
  plan: ConversationPlan,
  currentTurn?: string
): ArgumentObligation[] {
  const obligations: ArgumentObligation[] = [];
  const topic = currentTurnTarget(currentTurn);
  const freshSources = requiresFreshSources(plan, currentTurn);

  if (requiresDirectAnswer(plan, currentTurn)) {
    const question = questionTarget(plan, currentTurn);
    obligations.push({
      kind: 'answer_question',
      mode: 'required',
      ...(question ? { question } : {}),
    });
  }

  if (plan.moves.includes('position')) {
    obligations.push({
      kind: 'support_position',
      mode: 'required',
    });
  }

  const challenge =
    plan.deliberation.phase === 'challenging' ? currentChallenge(plan) : undefined;
  if (challenge) {
    obligations.push({
      kind: 'address_objection',
      mode: 'required',
      objection: challenge,
    });

    const priorPosition = target(
      'deliberation_assistant_position',
      plan.deliberation.assistantPosition
    );
    if (priorPosition) {
      obligations.push({
        kind: 'revise_or_defend_position',
        mode: 'required',
        priorPosition,
        challenge,
      });
    }
  }

  if (freshSources) {
    obligations.push({
      kind: 'source_fresh_facts',
      mode: 'required',
      ...(topic ? { topic } : {}),
    });
  }

  if (freshSources) {
    obligations.push({
      kind: 'express_uncertainty',
      mode: 'conditional',
      when: 'evidence_incomplete_or_conflicting',
      ...(topic ? { topic } : {}),
    });
  } else if (plan.depth === 'deliberative') {
    obligations.push({
      kind: 'express_uncertainty',
      mode: 'conditional',
      when: 'conclusion_remains_contestable',
      ...(topic ? { topic } : {}),
    });
  }

  return obligations.slice(0, MAX_ARGUMENT_OBLIGATIONS);
}
