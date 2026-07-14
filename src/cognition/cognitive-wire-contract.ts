import { z } from 'zod';

export const COGNITIVE_WIRE_VERSION = 1 as const;

export const WORKSPACE_KINDS = [
  'percept',
  'utterance',
  'fact',
  'hypothesis',
  'goal',
  'plan',
  'proposal',
  'alert',
  'action',
  'result',
] as const;

export const WORKSPACE_PRIVACY = ['cloud-ok', 'trusted-lan', 'local-only'] as const;

const safeText = (max: number) =>
  z.string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'text cannot be blank')
    .refine((value) => !value.includes('\0'), 'NUL bytes are forbidden');

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]*$/);
const itemId = z.string().min(1).max(160).regex(/^workspace_[a-zA-Z0-9_.:-]+$/);
const commonDraftShape = {
  correlationId: identifier,
  salience: z.number().finite().min(0).max(1),
  confidence: z.number().finite().min(0).max(1),
  privacy: z.enum(WORKSPACE_PRIVACY),
  ttlMs: z.number().int().min(100).max(86_400_000).optional(),
  dedupeKey: identifier.optional(),
  parentItemIds: z.array(itemId).max(16).optional(),
};

export const cognitiveUtterancePayloadSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: safeText(8_000),
  surface: identifier.max(64),
}).strict();

export const cognitiveSummaryPayloadSchema = z.object({
  summary: safeText(1_000),
  tags: z.array(identifier.max(64)).max(16).optional(),
}).strict();

export const cognitivePerceptPayloadSchema = z.object({
  modality: identifier.max(64),
  kind: identifier.max(64),
  observedAt: z.number().int().nonnegative(),
  sensorId: identifier.max(64),
  confidence: z.number().finite().min(0).max(1),
}).strict();

const summaryDraft = <T extends 'fact' | 'hypothesis' | 'goal' | 'plan' | 'proposal' | 'alert'>(
  kind: T,
) => z.object({
  ...commonDraftShape,
  kind: z.literal(kind),
  payload: cognitiveSummaryPayloadSchema,
}).strict();

/**
 * Network-safe drafts. `action` is intentionally absent: remote clients may
 * describe a proposal, but cannot inject executable intent into the workspace.
 */
export const cognitiveDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    ...commonDraftShape,
    kind: z.literal('percept'),
    payload: cognitivePerceptPayloadSchema,
  }).strict(),
  z.object({
    ...commonDraftShape,
    kind: z.literal('utterance'),
    payload: cognitiveUtterancePayloadSchema,
  }).strict(),
  summaryDraft('fact'),
  summaryDraft('hypothesis'),
  summaryDraft('goal'),
  summaryDraft('plan'),
  summaryDraft('proposal'),
  summaryDraft('alert'),
  z.object({
    ...commonDraftShape,
    kind: z.literal('result'),
    payload: cognitiveUtterancePayloadSchema,
  }).strict(),
]);

export const cognitivePublishRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  clientEventId: z.string().uuid(),
  draft: cognitiveDraftSchema,
}).strict();

export const cognitiveCancelRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  correlationId: identifier,
}).strict();

export const cognitiveContextAcquireRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  query: z.string().max(4_000).optional(),
  excludeCorrelationId: identifier.optional(),
  maxItems: z.number().int().min(0).max(16).optional(),
  maxChars: z.number().int().min(0).max(8_000).optional(),
  minSalience: z.number().finite().min(0).max(1).optional(),
  minConfidence: z.number().finite().min(0).max(1).optional(),
}).strict();

export const cognitiveLeaseRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  leaseId: z.string().uuid(),
}).strict();

export const cognitiveSubscriptionRequestSchema = z.object({
  version: z.literal(COGNITIVE_WIRE_VERSION),
  afterRevision: z.number().int().nonnegative().optional(),
  kinds: z.array(z.enum(WORKSPACE_KINDS)).max(WORKSPACE_KINDS.length).optional(),
}).strict();

export const cognitiveSnapshotRequestSchema = cognitiveSubscriptionRequestSchema.extend({
  limit: z.number().int().min(1).max(256).optional(),
}).strict();

export type CognitiveDraft = z.infer<typeof cognitiveDraftSchema>;
export type CognitivePublishRequest = z.infer<typeof cognitivePublishRequestSchema>;
export type CognitiveCancelRequest = z.infer<typeof cognitiveCancelRequestSchema>;
export type CognitiveContextAcquireRequest = z.infer<typeof cognitiveContextAcquireRequestSchema>;
export type CognitiveLeaseRequest = z.infer<typeof cognitiveLeaseRequestSchema>;
export type CognitiveSubscriptionRequest = z.infer<typeof cognitiveSubscriptionRequestSchema>;
export type CognitiveSnapshotRequest = z.infer<typeof cognitiveSnapshotRequestSchema>;
