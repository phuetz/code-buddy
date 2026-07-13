import { extractSalientTerms, normalizeConversationText } from './dialogue-act.js';
import { planConversationResponse } from './discourse-planner.js';
import type { ConversationTurn } from './types.js';

export interface ConversationQualityAssessment {
  score: number;
  passes: boolean;
  sentenceCount: number;
  reasoningLinkCount: number;
  relevantTermCount: number;
  issues: Array<'empty' | 'too_shallow' | 'unstructured' | 'unrelated' | 'repetitive'>;
}

const REASONING_LINKS =
  /\b(parce que|car|donc|ainsi|cependant|pourtant|mais|en revanche|autrement dit|par exemple|meme si|bien que|en consequence|cela dit|d un cote|de l autre)\b/g;

const SEMANTIC_TOPICS: RegExp[] = [
  /\b(ia|intelligence artificielle)\b/,
  /\b(aim\w*|amour)\b/,
  /\b(conscien\w*)\b/,
  /\b(libre arbitre|liberte)\b/,
  /\b(ethique|morale)\b/,
  /\b(actualite|nouvelles|news)\b/,
  /\b(humain\w*|relation\w*|proche\w*|ami\w*)\b/,
  /\b(epuise\w*|fatigue\w*|decourage\w*|lourd\w*|vide\w*|repos|effort\w*)\b/,
];

function sentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+(?:\s|$)|[^.!?…]+$/g) ?? [];
  return matches.map((sentence) => sentence.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function assessConversationResponse(
  heard: string,
  response: string,
  history: ConversationTurn[] = []
): ConversationQualityAssessment {
  const clean = response.replace(/\s+/g, ' ').trim();
  const plan = planConversationResponse(heard, history);
  if (!clean) {
    return {
      score: 0,
      passes: false,
      sentenceCount: 0,
      reasoningLinkCount: 0,
      relevantTermCount: 0,
      issues: ['empty'],
    };
  }

  const responseSentences = sentences(clean);
  const normalized = normalizeConversationText(clean);
  const normalizedHeard = normalizeConversationText(heard);
  const reasoningLinkCount = normalized.match(REASONING_LINKS)?.length ?? 0;
  const salient = extractSalientTerms(heard, 8);
  const directRelevantTerms = salient.filter((term) => normalized.includes(term));
  const semanticTopicCount = SEMANTIC_TOPICS.filter(
    (topic) => topic.test(normalizedHeard) && topic.test(normalized)
  ).length;
  const relevantTermCount = directRelevantTerms.length + semanticTopicCount;
  const uniqueSentences = new Set(responseSentences.map(normalizeConversationText));
  const issues: ConversationQualityAssessment['issues'] = [];

  if (
    (plan.analysis.depth === 'developed' && responseSentences.length < 2) ||
    (plan.analysis.depth === 'deliberative' && responseSentences.length < 3)
  ) {
    issues.push('too_shallow');
  }
  if (plan.analysis.depth === 'deliberative' && reasoningLinkCount < 2) {
    issues.push('unstructured');
  }
  if (salient.length >= 2 && relevantTermCount === 0 && plan.analysis.act !== 'phatic') {
    issues.push('unrelated');
  }
  if (responseSentences.length >= 2 && uniqueSentences.size < responseSentences.length) {
    issues.push('repetitive');
  }

  const score = Math.max(
    0,
    Math.min(
      1,
      1 -
        (issues.includes('too_shallow') ? 0.3 : 0) -
        (issues.includes('unstructured') ? 0.25 : 0) -
        (issues.includes('unrelated') ? 0.3 : 0) -
        (issues.includes('repetitive') ? 0.2 : 0)
    )
  );
  return {
    score,
    passes: issues.length === 0,
    sentenceCount: responseSentences.length,
    reasoningLinkCount,
    relevantTermCount,
    issues,
  };
}
