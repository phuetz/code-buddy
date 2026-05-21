export type RelationshipSubjectType =
  | 'public_person'
  | 'known_person'
  | 'unknown_person'
  | 'organization'
  | 'place'
  | 'concept';

export type RelationshipMode = 'general' | 'robot_conversation' | 'prospecting';

export type RelationshipEvidenceSource =
  | 'public_web'
  | 'user_provided'
  | 'local_memory'
  | 'perception'
  | 'conversation'
  | 'manual';

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface RelationshipEvidence {
  sourceType: RelationshipEvidenceSource;
  label?: string;
  url?: string;
  excerpt?: string;
  observedAt?: string;
  confidence?: number;
}

export interface RelationshipPermissions {
  usePublicKnowledge?: boolean;
  useRelationshipMemory?: boolean;
  identifyUnknownPeople?: boolean;
  persistNewMemory?: boolean;
  useSensitiveFacts?: boolean;
}

export interface RelationshipContextInput {
  subject: string;
  subjectType?: RelationshipSubjectType;
  mode?: RelationshipMode;
  confidence?: number;
  publicFacts?: string[];
  relationshipFacts?: string[];
  sensitiveFacts?: string[];
  visibleSignals?: string[];
  evidence?: RelationshipEvidence[];
  permissions?: RelationshipPermissions;
}

export interface RelationshipContextResult {
  subject: string;
  subjectType: RelationshipSubjectType;
  mode: RelationshipMode;
  confidence: number;
  confidenceBand: ConfidenceBand;
  contextLevel: 'public_context' | 'relationship_context' | 'visible_context_only';
  needsConfirmation: boolean;
  publicContext: string[];
  relationshipContext: string[];
  visibleContext: string[];
  withheld: string[];
  safetyWarnings: string[];
  evidence: RelationshipEvidence[];
  allowedUses: string[];
  recommendedNextAction: string;
  promptCard: string;
}

const DEFAULT_CONFIDENCE = 0.5;
const CONFIRMATION_THRESHOLD = 0.7;

export function buildRelationshipContext(
  input: RelationshipContextInput,
): RelationshipContextResult {
  const subject = normalizeRequired(input.subject, 'subject');
  const subjectType = input.subjectType ?? 'unknown_person';
  const mode = input.mode ?? 'general';
  const confidence = clampConfidence(input.confidence ?? DEFAULT_CONFIDENCE);
  const permissions = resolvePermissions(subjectType, mode, input.permissions);
  const confidenceBand = toConfidenceBand(confidence);
  const needsConfirmation = isPerson(subjectType) && confidence < CONFIRMATION_THRESHOLD;

  const publicFacts = normalizeList(input.publicFacts);
  const relationshipFacts = normalizeList(input.relationshipFacts);
  const sensitiveFacts = normalizeList(input.sensitiveFacts);
  const visibleSignals = normalizeList(input.visibleSignals);
  const evidence = normalizeEvidence(input.evidence);
  const safetyWarnings: string[] = [];
  const withheld: string[] = [];

  let publicContext: string[] = [];
  let relationshipContext: string[] = [];
  let visibleContext: string[] = visibleSignals;
  let contextLevel: RelationshipContextResult['contextLevel'] = 'visible_context_only';

  if (subjectType === 'unknown_person' && !permissions.identifyUnknownPeople) {
    contextLevel = 'visible_context_only';
    if (publicFacts.length > 0) {
      withheld.push('public facts withheld because unknown people should not be identified without consent');
    }
    if (relationshipFacts.length > 0) {
      withheld.push('relationship facts withheld because this is not a confirmed known person');
    }
    safetyWarnings.push(
      'Unknown person: use only visible context, avoid identity inference, and ask for consent or confirmation before storing memory.',
    );
  } else if (subjectType === 'known_person') {
    publicContext = permissions.usePublicKnowledge ? publicFacts : [];
    if (!permissions.usePublicKnowledge && publicFacts.length > 0) {
      withheld.push('public facts withheld by permissions');
    }

    if (permissions.useRelationshipMemory && !needsConfirmation) {
      relationshipContext = relationshipFacts;
      contextLevel = relationshipFacts.length > 0 ? 'relationship_context' : 'public_context';
    } else {
      if (relationshipFacts.length > 0) {
        withheld.push(
          needsConfirmation
            ? 'relationship facts withheld until identity confidence is confirmed'
            : 'relationship facts withheld by permissions',
        );
      }
      contextLevel = publicContext.length > 0 ? 'public_context' : 'visible_context_only';
    }
  } else {
    if (permissions.usePublicKnowledge) {
      publicContext = publicFacts;
      contextLevel = publicFacts.length > 0 ? 'public_context' : 'visible_context_only';
    } else if (publicFacts.length > 0) {
      withheld.push('public facts withheld by permissions');
    }
  }

  if (sensitiveFacts.length > 0) {
    if (permissions.useSensitiveFacts && subjectType === 'known_person' && !needsConfirmation) {
      relationshipContext = [...relationshipContext, ...sensitiveFacts.map((fact) => `Sensitive: ${fact}`)];
      contextLevel = 'relationship_context';
    } else {
      withheld.push(`${sensitiveFacts.length} sensitive fact(s) withheld`);
    }
  }

  if (needsConfirmation) {
    safetyWarnings.push(
      `Identity confidence is ${confidenceBand}; confirm before using private or relationship memory.`,
    );
  }

  if (requiresEvidence(subjectType) && publicContext.length > 0 && evidence.length === 0) {
    safetyWarnings.push('Public context has no attached evidence; treat it as unverified until sourced.');
  }

  const allowedUses = buildAllowedUses(permissions, subjectType, needsConfirmation);
  const recommendedNextAction = buildRecommendedNextAction({
    subject,
    subjectType,
    confidence,
    needsConfirmation,
    evidence,
    permissions,
  });
  const promptCard = renderPromptCard({
    subject,
    subjectType,
    mode,
    confidence,
    confidenceBand,
    contextLevel,
    needsConfirmation,
    publicContext,
    relationshipContext,
    visibleContext,
    withheld,
    safetyWarnings,
    allowedUses,
    recommendedNextAction,
    evidence,
  });

  return {
    subject,
    subjectType,
    mode,
    confidence,
    confidenceBand,
    contextLevel,
    needsConfirmation,
    publicContext,
    relationshipContext,
    visibleContext,
    withheld,
    safetyWarnings,
    evidence,
    allowedUses,
    recommendedNextAction,
    promptCard,
  };
}

function resolvePermissions(
  subjectType: RelationshipSubjectType,
  mode: RelationshipMode,
  overrides: RelationshipPermissions = {},
): Required<RelationshipPermissions> {
  const defaultPermissions: Required<RelationshipPermissions> = {
    usePublicKnowledge: subjectType !== 'unknown_person',
    useRelationshipMemory: subjectType === 'known_person' && mode !== 'prospecting',
    identifyUnknownPeople: false,
    persistNewMemory: false,
    useSensitiveFacts: false,
  };

  return {
    ...defaultPermissions,
    ...overrides,
  };
}

function buildAllowedUses(
  permissions: Required<RelationshipPermissions>,
  subjectType: RelationshipSubjectType,
  needsConfirmation: boolean,
): string[] {
  const allowed = ['visible conversation context'];

  if (permissions.usePublicKnowledge && subjectType !== 'unknown_person') {
    allowed.push('public knowledge');
  }

  if (permissions.useRelationshipMemory && subjectType === 'known_person' && !needsConfirmation) {
    allowed.push('relationship memory');
  }

  if (permissions.persistNewMemory) {
    allowed.push('memory persistence after explicit confirmation');
  }

  return allowed;
}

function buildRecommendedNextAction(input: {
  subject: string;
  subjectType: RelationshipSubjectType;
  confidence: number;
  needsConfirmation: boolean;
  evidence: RelationshipEvidence[];
  permissions: Required<RelationshipPermissions>;
}): string {
  if (input.subjectType === 'unknown_person' && !input.permissions.identifyUnknownPeople) {
    return 'Use visible context only. Ask who they are or request consent before identification or persistence.';
  }

  if (input.needsConfirmation) {
    return `Say a soft confirmation such as: "I think this is ${input.subject}; is that right?"`;
  }

  if (input.subjectType === 'public_person' && input.evidence.length === 0) {
    return 'Use only well-known public facts, then fetch or attach sources before making specific claims.';
  }

  if (input.subjectType === 'known_person' && input.permissions.useRelationshipMemory) {
    return 'Use relationship memory naturally, but avoid sensitive facts unless explicitly permitted.';
  }

  return 'Use the assembled context conservatively and cite evidence when making factual claims.';
}

function renderPromptCard(result: Omit<RelationshipContextResult, 'promptCard'>): string {
  const lines = [
    `# Relationship Context: ${result.subject}`,
    '',
    `Subject type: ${result.subjectType}`,
    `Mode: ${result.mode}`,
    `Confidence: ${result.confidence.toFixed(2)} (${result.confidenceBand})`,
    `Context level: ${result.contextLevel}`,
    '',
    'Allowed uses:',
    ...formatList(result.allowedUses),
  ];

  appendSection(lines, 'Visible context', result.visibleContext);
  appendSection(lines, 'Public context', result.publicContext);
  appendSection(lines, 'Relationship context', result.relationshipContext);
  appendSection(lines, 'Withheld', result.withheld);
  appendSection(lines, 'Safety warnings', result.safetyWarnings);

  if (result.evidence.length > 0) {
    lines.push('', 'Evidence:');
    for (const evidence of result.evidence) {
      const pieces = [
        evidence.sourceType,
        evidence.label,
        evidence.url,
        typeof evidence.confidence === 'number'
          ? `confidence=${evidence.confidence.toFixed(2)}`
          : undefined,
      ].filter(Boolean);
      lines.push(`- ${pieces.join(' | ')}`);
      if (evidence.excerpt) {
        lines.push(`  ${truncate(evidence.excerpt, 220)}`);
      }
    }
  }

  lines.push('', `Recommended next action: ${result.recommendedNextAction}`);

  return lines.join('\n');
}

function appendSection(lines: string[], title: string, values: string[]): void {
  if (values.length === 0) return;
  lines.push('', `${title}:`, ...formatList(values));
}

function formatList(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ['- none'];
}

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => (typeof value === 'string' ? normalizeText(value) : ''))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function normalizeEvidence(values: unknown): RelationshipEvidence[] {
  if (!Array.isArray(values)) return [];

  return values
    .map((rawEvidence) => {
      const evidence =
        typeof rawEvidence === 'object' && rawEvidence !== null
          ? (rawEvidence as Partial<RelationshipEvidence>)
          : {};

      if (!evidence.sourceType) {
        return null;
      }

      const normalized: RelationshipEvidence = {
        sourceType: evidence.sourceType,
      };

      const label = normalizeText(evidence.label);
      const url = normalizeText(evidence.url);
      const excerpt = normalizeText(evidence.excerpt);
      const observedAt = normalizeText(evidence.observedAt);

      if (label) normalized.label = label;
      if (url) normalized.url = url;
      if (excerpt) normalized.excerpt = excerpt;
      if (observedAt) normalized.observedAt = observedAt;
      if (typeof evidence.confidence === 'number') {
        normalized.confidence = clampConfidence(evidence.confidence);
      }

      return normalized;
    })
    .filter((evidence): evidence is RelationshipEvidence => evidence !== null)
    .slice(0, 10);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIDENCE;
  return Math.max(0, Math.min(1, value));
}

function toConfidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.55) return 'medium';
  return 'low';
}

function isPerson(subjectType: RelationshipSubjectType): boolean {
  return ['public_person', 'known_person', 'unknown_person'].includes(subjectType);
}

function requiresEvidence(subjectType: RelationshipSubjectType): boolean {
  return subjectType === 'public_person' || subjectType === 'organization';
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}
