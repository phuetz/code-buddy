import { ConversationStateManager } from './conversation-state.js';
import { planConversationResponse } from './discourse-planner.js';
import type {
  ConversationPlan,
  ConversationTurn,
  DeliberationThreadSnapshot,
} from './types.js';

export interface PreparedConversationTurn {
  plan: ConversationPlan;
  deliberation: DeliberationThreadSnapshot;
  commonGround: string;
  systemGuidance: string;
  envelopedPrompt: string;
}

export interface PrepareConversationTurnOptions {
  /** Bounded, already-sanitized evidence shared by all companion surfaces. */
  freshContext?: string;
  /**
   * Raw-free relational observations derived from the shared multimodal thread.
   * This is deliberately separate from fresh evidence so callers can keep both
   * provenance and privacy boundaries visible in the prompt.
   */
  relationshipContext?: string;
  /**
   * Include recent raw excerpts inside common ground. Default true; voice sets
   * false because those turns are already sent as separate provider messages.
   */
  includeRecentDialogue?: boolean;
}

/**
 * Pure conversation preparation shared by the resident voice and Cowork.
 * It plans discourse and common ground; provider/tool routing stays with the
 * surface adapter so this module remains safe to bundle in the renderer.
 */
export function prepareConversationTurn(
  heard: string,
  history: ConversationTurn[] = [],
  options: PrepareConversationTurnOptions = {}
): PreparedConversationTurn {
  const state = new ConversationStateManager(history);
  const plan = planConversationResponse(heard, history);
  const suppressHistoricalContext =
    plan.deliberation.topicShifted || plan.act === 'action' || plan.act === 'closing';
  // Common ground describes prior shared context only. `plan.deliberation`
  // already includes the current user turn for classification and phase
  // selection; rendering that snapshot here would copy the current message
  // into both the context block and the explicit user-message envelope.
  const commonGround = state.renderForPrompt(undefined, {
    suppressHistoricalContext,
    ...(options.includeRecentDialogue === undefined
      ? {}
      : { includeRecentDialogue: options.includeRecentDialogue }),
  });
  const systemGuidance = [
    plan.guidance,
    commonGround,
    options.relationshipContext,
    options.freshContext,
  ]
    .filter(Boolean)
    .join('\n\n');
  const envelopedPrompt = [
    '<companion_turn>',
    systemGuidance,
    '</companion_turn>',
    '',
    `Message de l'utilisateur : ${heard.trim()}`,
  ].join('\n');
  return {
    plan,
    deliberation: plan.deliberation,
    commonGround,
    systemGuidance,
    envelopedPrompt,
  };
}

export function buildConversationTurnEnvelope(
  heard: string,
  history: ConversationTurn[] = [],
  options: PrepareConversationTurnOptions = {}
): string {
  return prepareConversationTurn(heard, history, options).envelopedPrompt;
}

/** Non-empty, honest recovery for accepted turns. Cancellation remains the caller's concern. */
export function conversationFailureReply(
  heard: string,
  history: ConversationTurn[] = []
): string {
  const { analysis } = prepareConversationTurn(heard, history).plan;
  if (analysis.needsFreshContext) {
    return "Je n'arrive pas à joindre des sources assez fraîches pour te répondre correctement. Je préfère te le dire plutôt que d'inventer.";
  }
  if (analysis.isEmotional) {
    return "Je t'écoute, mais je n'ai pas réussi à construire ma réponse. Reprends juste la dernière idée et je reste avec toi.";
  }
  return "Je n'ai pas réussi à formuler une réponse fiable. Dis-moi simplement quelle partie tu veux que je reprenne.";
}
