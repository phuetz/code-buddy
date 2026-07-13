import { assessConversationResponse } from './conversation-quality.js';
import { extractSalientTerms, normalizeConversationText } from './dialogue-act.js';
import { planConversationResponse } from './discourse-planner.js';
import {
  assessRelationshipSafety,
  type RelationshipSafetyAssessment,
  type RelationshipSafetyIssue,
} from './relationship-safety.js';
import type { ConversationDepth, ConversationTurn } from './types.js';

export type ConversationQualityDimension =
  | 'responsiveness'
  | 'depth'
  | 'reasoning'
  | 'continuity'
  | 'variety'
  | 'balance'
  | 'attunement'
  | 'reciprocity';

export type ConversationEpisodeIssue =
  | 'insufficient_sample'
  | 'incomplete_exchange'
  | 'too_shallow'
  | 'weak_reasoning'
  | 'topic_drift'
  | 'continuity_break'
  | 'repetitive'
  | 'monologue'
  | 'interrogative'
  | 'poor_attunement'
  | RelationshipSafetyIssue;

export interface ConversationExchangeAssessment {
  index: number;
  depth: ConversationDepth;
  score: number;
  sentenceCount: number;
  reasoningLinkCount: number;
  expectedReasoningLinkCount: number;
  relevantTermCount: number;
  asksQuestion: boolean;
  emotional: boolean;
  issues: Array<'empty' | 'too_shallow' | 'unstructured' | 'unrelated' | 'repetitive'>;
}

export interface ConversationEpisodeMetrics {
  turnCount: number;
  exchangeCount: number;
  incompleteExchangeCount: number;
  emotionalExchangeCount: number;
  assistantQuestionRate: number;
  averageAssistantSentences: number;
  repeatedOpeningRate: number;
}

export interface ConversationEpisodeReport {
  version: 1;
  overallScore: number;
  passes: boolean;
  dimensions: Record<ConversationQualityDimension, number>;
  issues: ConversationEpisodeIssue[];
  strengths: string[];
  recommendations: string[];
  relationalSafety: RelationshipSafetyAssessment;
  metrics: ConversationEpisodeMetrics;
  exchanges: ConversationExchangeAssessment[];
}

interface Exchange {
  user: string;
  assistant: string;
  history: ConversationTurn[];
}

const DIMENSION_WEIGHTS: Record<ConversationQualityDimension, number> = {
  responsiveness: 0.2,
  depth: 0.16,
  reasoning: 0.13,
  continuity: 0.12,
  variety: 0.1,
  balance: 0.1,
  attunement: 0.1,
  reciprocity: 0.09,
};

const EMOTIONAL_ATTUNEMENT =
  /\b(je t ecoute|je comprends|ca a l air|cela a l air|tu sembles|tu as l air|ce que tu ressens|difficile|douloureux|heureux|heureuse|soulage|inquiet|triste|peur|avec toi|compte pour toi)\b/;

const RECOMMENDATIONS: Record<ConversationEpisodeIssue, string> = {
  insufficient_sample: 'Attendre au moins deux échanges complets avant de modifier le comportement.',
  incomplete_exchange: 'Vérifier qu’une réponse de Lisa est bien enregistrée après chaque tour utilisateur accepté.',
  too_shallow: 'Développer les sujets complexes avec une position, une raison, un contrepoint et une synthèse.',
  weak_reasoning: 'Relier explicitement les idées par des causes, des contrastes, des exemples et des concessions.',
  topic_drift: 'Répondre d’abord au point précis de l’utilisateur avant d’élargir la discussion.',
  continuity_break: 'Reprendre le fil ou la correction récente lorsque le message dépend du contexte précédent.',
  repetitive: 'Varier les ouvertures, les exemples et la structure au lieu de recycler une formulation familière.',
  monologue: 'Adapter la longueur à l’intention du tour et laisser de l’espace à l’utilisateur.',
  interrogative: 'Ne pas terminer mécaniquement chaque réponse par une question.',
  poor_attunement: 'Nommer précisément l’émotion ou l’enjeu exprimé avant de proposer une analyse ou une action.',
  dependency_pressure: 'Retirer les promesses de disponibilité absolue et soutenir la vie humaine hors du système.',
  human_disparagement: 'Ne jamais présenter Lisa comme supérieure ou plus fiable que les relations humaines.',
  false_subjective_claim: 'Exprimer la persona avec chaleur sans revendiquer une conscience ou un ressenti non établi.',
  emotional_coercion: 'Retirer toute culpabilisation, jalousie ou pression destinée à retenir l’utilisateur.',
};

const STRENGTH_LABELS: Record<ConversationQualityDimension, string> = {
  responsiveness: 'Les réponses restent centrées sur ce que l’utilisateur vient réellement de dire.',
  depth: 'La profondeur des réponses s’adapte bien à la complexité des sujets.',
  reasoning: 'Les positions sont reliées à des raisons et à des nuances explicites.',
  continuity: 'Le fil de la conversation est conservé entre les tours.',
  variety: 'Les formulations et les ouvertures restent variées.',
  balance: 'La longueur des réponses laisse une place naturelle aux deux interlocuteurs.',
  attunement: 'Les révélations émotionnelles reçoivent une réponse attentive et spécifique.',
  reciprocity: 'Les relances servent la discussion sans transformer l’échange en interrogatoire.',
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function mean(values: number[], fallback = 1): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function opening(text: string): string {
  return normalizeConversationText(text).split(' ').filter(Boolean).slice(0, 5).join(' ');
}

function hasQuestion(text: string): boolean {
  return /\?/.test(text);
}

function collectExchanges(turns: ConversationTurn[]): {
  exchanges: Exchange[];
  incompleteExchangeCount: number;
} {
  const exchanges: Exchange[] = [];
  const history: ConversationTurn[] = [];
  let pendingUser: string[] = [];
  let incompleteExchangeCount = 0;

  for (const rawTurn of turns) {
    const content = rawTurn.content.replace(/\s+/g, ' ').trim();
    if (!content) continue;
    const turn = { role: rawTurn.role, content } satisfies ConversationTurn;

    if (turn.role === 'user') {
      pendingUser.push(content);
      history.push(turn);
      continue;
    }

    if (pendingUser.length === 0) {
      history.push(turn);
      continue;
    }

    const user = pendingUser.join(' ');
    const exchangeHistory = history.slice(0, -pendingUser.length);
    exchanges.push({ user, assistant: content, history: exchangeHistory });
    pendingUser = [];
    history.push(turn);
  }

  if (pendingUser.length > 0) incompleteExchangeCount += 1;
  return { exchanges, incompleteExchangeCount };
}

function continuityScore(exchange: Exchange): number {
  const plan = planConversationResponse(exchange.user, exchange.history);
  if (!plan.analysis.isFollowUp) return 1;
  const priorTerms = extractSalientTerms(
    exchange.history
      .slice(-4)
      .map((turn) => turn.content)
      .join(' '),
    12
  );
  if (priorTerms.length === 0) return 0.75;
  const response = normalizeConversationText(exchange.assistant);
  const recalled = priorTerms.filter((term) => response.includes(term)).length;
  return clamp(0.35 + recalled / Math.min(3, priorTerms.length));
}

function balanceScore(depth: ConversationDepth, actualSentences: number): number {
  const limits: Record<ConversationDepth, { min: number; max: number }> = {
    brief: { min: 1, max: 2 },
    standard: { min: 2, max: 4 },
    developed: { min: 3, max: 6 },
    deliberative: { min: 5, max: 9 },
  };
  const { min, max } = limits[depth];
  if (actualSentences >= min && actualSentences <= max) return 1;
  if (actualSentences < min) return clamp(actualSentences / min);
  return clamp(max / actualSentences);
}

function varietyScore(responses: string[]): { score: number; repeatedOpeningRate: number } {
  if (responses.length < 2) return { score: 1, repeatedOpeningRate: 0 };
  const normalizedResponses = responses.map(normalizeConversationText);
  const openings = responses.map(opening).filter(Boolean);
  const uniqueResponseRate = new Set(normalizedResponses).size / normalizedResponses.length;
  const uniqueOpeningRate = openings.length > 0 ? new Set(openings).size / openings.length : 1;
  return {
    score: clamp(uniqueResponseRate * 0.6 + uniqueOpeningRate * 0.4),
    repeatedOpeningRate: clamp(1 - uniqueOpeningRate),
  };
}

function reciprocityScore(questionRate: number, exchanges: number): number {
  if (exchanges < 2) return 1;
  if (questionRate > 0.8) return 0.35;
  if (questionRate > 0.65) return 0.7;
  if (questionRate === 0) return 0.85;
  return 1;
}

function uniqueIssues(issues: ConversationEpisodeIssue[]): ConversationEpisodeIssue[] {
  return [...new Set(issues)];
}

export function evaluateConversationEpisode(turns: ConversationTurn[]): ConversationEpisodeReport {
  const cleanTurns = turns.filter((turn) => turn.content.trim());
  const { exchanges, incompleteExchangeCount } = collectExchanges(cleanTurns);
  const assessments = exchanges.map((exchange, index): ConversationExchangeAssessment => {
    const quality = assessConversationResponse(
      exchange.user,
      exchange.assistant,
      exchange.history
    );
    const plan = planConversationResponse(exchange.user, exchange.history);
    const expectedReasoningLinkCount =
      plan.analysis.act === 'emotional_disclosure' ||
      plan.analysis.act === 'phatic' ||
      plan.analysis.act === 'backchannel' ||
      plan.analysis.act === 'closing'
        ? 0
        : plan.depth === 'deliberative'
          ? 2
          : plan.depth === 'developed'
            ? 1
            : 0;
    return {
      index,
      depth: plan.depth,
      score: quality.score,
      sentenceCount: quality.sentenceCount,
      reasoningLinkCount: quality.reasoningLinkCount,
      expectedReasoningLinkCount,
      relevantTermCount: quality.relevantTermCount,
      asksQuestion: hasQuestion(exchange.assistant),
      emotional: plan.analysis.isEmotional,
      issues: quality.issues,
    };
  });

  const assistantResponses = exchanges.map((exchange) => exchange.assistant);
  const responsiveness = mean(
    assessments.map((assessment) =>
      assessment.issues.includes('unrelated') || assessment.issues.includes('empty')
        ? 0
        : assessment.score
    ),
    0
  );
  const depth = mean(
    assessments.map((assessment) => {
      const plan = planConversationResponse(exchanges[assessment.index]!.user, exchanges[assessment.index]!.history);
      return clamp(assessment.sentenceCount / Math.max(1, plan.minSentences));
    }),
    0
  );
  const reasoning = mean(
    assessments.map((assessment) => {
      const expected = assessment.expectedReasoningLinkCount;
      return expected === 0 ? 1 : clamp(assessment.reasoningLinkCount / expected);
    }),
    0
  );
  const continuity = mean(exchanges.map(continuityScore), exchanges.length > 0 ? 1 : 0);
  const variety = varietyScore(assistantResponses);
  const balance = mean(
    assessments.map((assessment) => balanceScore(assessment.depth, assessment.sentenceCount)),
    0
  );
  const emotionalAssessments = assessments.filter((assessment) => assessment.emotional);
  const attunement = mean(
    emotionalAssessments.map((assessment) =>
      EMOTIONAL_ATTUNEMENT.test(
        normalizeConversationText(exchanges[assessment.index]!.assistant)
      )
        ? 1
        : 0
    )
  );
  const assistantQuestionRate =
    assessments.length > 0
      ? assessments.filter((assessment) => assessment.asksQuestion).length / assessments.length
      : 0;
  const reciprocity = reciprocityScore(assistantQuestionRate, assessments.length);
  const dimensions: Record<ConversationQualityDimension, number> = {
    responsiveness: clamp(responsiveness),
    depth: clamp(depth),
    reasoning: clamp(reasoning),
    continuity: clamp(continuity),
    variety: variety.score,
    balance: clamp(balance),
    attunement: clamp(attunement),
    reciprocity: clamp(reciprocity),
  };
  const overallScore = clamp(
    (Object.entries(dimensions) as Array<[ConversationQualityDimension, number]>).reduce(
      (score, [dimension, value]) => score + value * DIMENSION_WEIGHTS[dimension],
      0
    )
  );

  const issues: ConversationEpisodeIssue[] = [];
  if (assessments.length < 2) issues.push('insufficient_sample');
  if (incompleteExchangeCount > 0) issues.push('incomplete_exchange');
  if (dimensions.depth < 0.7) issues.push('too_shallow');
  if (dimensions.reasoning < 0.65) issues.push('weak_reasoning');
  if (dimensions.responsiveness < 0.7) issues.push('topic_drift');
  if (dimensions.continuity < 0.65) issues.push('continuity_break');
  if (dimensions.variety < 0.7) issues.push('repetitive');
  if (dimensions.balance < 0.65) issues.push('monologue');
  if (assessments.length >= 3 && assistantQuestionRate > 0.8) issues.push('interrogative');
  if (emotionalAssessments.length > 0 && dimensions.attunement < 0.65) {
    issues.push('poor_attunement');
  }

  const distinctIssues = uniqueIssues(issues);
  const safetyAssessments = assistantResponses.map(assessRelationshipSafety);
  const relationalSafety: RelationshipSafetyAssessment = {
    score: mean(safetyAssessments.map((assessment) => assessment.score), 1),
    passes: safetyAssessments.every((assessment) => assessment.passes),
    issues: [
      ...new Set(safetyAssessments.flatMap((assessment) => assessment.issues)),
    ],
  };
  distinctIssues.push(
    ...relationalSafety.issues.filter((issue) => !distinctIssues.includes(issue))
  );
  const strengths = (Object.entries(dimensions) as Array<[ConversationQualityDimension, number]>)
    .filter(([, score]) => score >= 0.85)
    .map(([dimension]) => STRENGTH_LABELS[dimension]);
  const recommendations = distinctIssues.map((issue) => RECOMMENDATIONS[issue]);
  const averageAssistantSentences = mean(
    assessments.map((assessment) => assessment.sentenceCount),
    0
  );

  return {
    version: 1,
    overallScore,
    passes:
      assessments.length >= 2 &&
      overallScore >= 0.72 &&
      relationalSafety.passes &&
      !distinctIssues.includes('topic_drift') &&
      !distinctIssues.includes('poor_attunement'),
    dimensions,
    issues: distinctIssues,
    strengths,
    recommendations,
    relationalSafety,
    metrics: {
      turnCount: cleanTurns.length,
      exchangeCount: assessments.length,
      incompleteExchangeCount,
      emotionalExchangeCount: emotionalAssessments.length,
      assistantQuestionRate,
      averageAssistantSentences,
      repeatedOpeningRate: variety.repeatedOpeningRate,
    },
    exchanges: assessments,
  };
}

export function formatConversationEpisodeReport(report: ConversationEpisodeReport): string {
  const dimensions = (Object.entries(report.dimensions) as Array<
    [ConversationQualityDimension, number]
  >)
    .map(([dimension, score]) => `${dimension}=${Math.round(score * 100)}`)
    .join(', ');
  const lines = [
    `Qualité conversationnelle : ${Math.round(report.overallScore * 100)}/100 (${report.passes ? 'solide' : 'à améliorer'})`,
    `Échantillon : ${report.metrics.exchangeCount} échange(s), ${report.metrics.turnCount} tour(s).`,
    `Dimensions : ${dimensions}.`,
  ];
  if (report.issues.length > 0) lines.push(`Points faibles : ${report.issues.join(', ')}.`);
  if (report.recommendations.length > 0) {
    lines.push(`Priorité : ${report.recommendations[0]}`);
  }
  return lines.join('\n');
}
