/**
 * Lightweight intent classifier for the Cowork super-agent composer.
 * Heuristic-only by design: callers can route to richer core tools later.
 *
 * @module renderer/utils/intent-classify
 */

export type IntentKind =
  | 'build'
  | 'research'
  | 'create'
  | 'analyze'
  | 'automate'
  | 'communicate'
  | 'other';

export interface IntentClassification {
  kind: IntentKind;
  suggestedTool: string;
  confidence: number;
}

interface IntentRule {
  kind: IntentKind;
  suggestedTool: string;
  confidence: number;
  keywords: readonly string[];
}

const INTENT_RULES: readonly IntentRule[] = [
  {
    kind: 'research',
    suggestedTool: 'deep_research',
    confidence: 0.88,
    keywords: ['recherche', 'cherche', 'compare', 'veille', 'sources', 'rapport', 'étude', 'study'],
  },
  {
    kind: 'analyze',
    suggestedTool: 'data_analysis',
    confidence: 0.84,
    keywords: ['analyse', 'analyser', 'csv', 'xlsx', 'tableau', 'données', 'metrics', 'dashboard'],
  },
  {
    kind: 'build',
    suggestedTool: 'code_edit',
    confidence: 0.82,
    keywords: ['code', 'implémente', 'corrige', 'build', 'app', 'feature', 'composant', 'bug'],
  },
  {
    kind: 'create',
    suggestedTool: 'generate_deliverable',
    confidence: 0.8,
    keywords: ['crée', 'génère', 'deck', 'slides', 'présentation', 'doc', 'image', 'podcast', 'brief'],
  },
  {
    kind: 'automate',
    suggestedTool: 'browser_operator',
    confidence: 0.78,
    keywords: ['automatise', 'navigue', 'remplis', 'browser', 'site', 'workflow', 'planifie', 'surveille'],
  },
  {
    kind: 'communicate',
    suggestedTool: 'channel_message',
    confidence: 0.76,
    keywords: ['email', 'mail', 'slack', 'telegram', 'whatsapp', 'réponds', 'message', 'appelle'],
  },
];

const DEFAULT_CLASSIFICATION: IntentClassification = {
  kind: 'other',
  suggestedTool: 'chat',
  confidence: 0.42,
};

function normalizeIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function keywordMatches(text: string, keyword: string): boolean {
  const normalizedKeyword = normalizeIntentText(keyword);
  return text.includes(normalizedKeyword);
}

export function classifyIntent(text: string): IntentClassification {
  const normalized = normalizeIntentText(text.trim());
  if (!normalized) return DEFAULT_CLASSIFICATION;

  let bestRule: IntentRule | null = null;
  let bestHits = 0;

  for (const rule of INTENT_RULES) {
    const hits = rule.keywords.filter((keyword) => keywordMatches(normalized, keyword)).length;
    if (hits > bestHits) {
      bestRule = rule;
      bestHits = hits;
    }
  }

  if (!bestRule) return DEFAULT_CLASSIFICATION;

  return {
    kind: bestRule.kind,
    suggestedTool: bestRule.suggestedTool,
    confidence: Math.min(0.98, bestRule.confidence + (bestHits - 1) * 0.04),
  };
}
