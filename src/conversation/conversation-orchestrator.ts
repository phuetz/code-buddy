import { ConversationStateManager } from './conversation-state.js';
import { planConversationResponse } from './discourse-planner.js';
import type { ConversationPlan, ConversationTurn } from './types.js';

export interface PreparedConversationTurn {
  plan: ConversationPlan;
  commonGround: string;
  systemGuidance: string;
  envelopedPrompt: string;
}

export interface PrepareConversationTurnOptions {
  /** Bounded, already-sanitized evidence shared by all companion surfaces. */
  freshContext?: string;
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
  const commonGround = state.renderForPrompt();
  const systemGuidance = [plan.guidance, commonGround, options.freshContext]
    .filter(Boolean)
    .join('\n\n');
  const envelopedPrompt = [
    '<companion_turn>',
    systemGuidance,
    '</companion_turn>',
    '',
    `Message de l'utilisateur : ${heard.trim()}`,
  ].join('\n');
  return { plan, commonGround, systemGuidance, envelopedPrompt };
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
