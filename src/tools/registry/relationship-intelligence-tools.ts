import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  buildRelationshipContext,
  type RelationshipContextInput,
  type RelationshipSubjectType,
  type RelationshipMode,
  type RelationshipEvidenceSource,
} from '../../identity/relationship-intelligence.js';

const SUBJECT_TYPES: RelationshipSubjectType[] = [
  'public_person',
  'known_person',
  'unknown_person',
  'organization',
  'place',
  'concept',
];

const MODES: RelationshipMode[] = ['general', 'robot_conversation', 'prospecting'];

const EVIDENCE_SOURCES: RelationshipEvidenceSource[] = [
  'public_web',
  'user_provided',
  'local_memory',
  'perception',
  'conversation',
  'manual',
];

export class RelationshipContextTool implements ITool {
  readonly name = 'relationship_context';
  readonly description =
    'Build a safe context card for a person, organization, place, or concept using public facts, relationship memory, evidence, confidence, and permissions.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const context = buildRelationshipContext(input as unknown as RelationshipContextInput);
      return {
        success: true,
        output: [
          context.promptCard,
          '',
          'Structured result:',
          JSON.stringify(context, null, 2),
        ].join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'Name or label of the entity being discussed.',
          },
          subjectType: {
            type: 'string',
            enum: SUBJECT_TYPES,
            description:
              'Relationship class. Default unknown_person is intentionally conservative.',
          },
          mode: {
            type: 'string',
            enum: MODES,
            description: 'Use-case posture for the context card.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence that the subject is correctly recognized.',
          },
          publicFacts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Public or encyclopedic facts safe to use when permitted.',
          },
          relationshipFacts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Private relationship memory, used only for confirmed known people.',
          },
          sensitiveFacts: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sensitive facts withheld unless explicitly permitted.',
          },
          visibleSignals: {
            type: 'array',
            items: { type: 'string' },
            description: 'Visible, non-identifying context such as badge text or current setting.',
          },
          evidence: {
            type: 'array',
            description: 'Evidence attached to public facts or recognition.',
            items: {
              type: 'object',
              properties: {
                sourceType: {
                  type: 'string',
                  enum: EVIDENCE_SOURCES,
                  description: 'Where this evidence came from.',
                },
                label: { type: 'string', description: 'Short source label.' },
                url: { type: 'string', description: 'Source URL, if public.' },
                excerpt: { type: 'string', description: 'Short source excerpt.' },
                observedAt: { type: 'string', description: 'ISO timestamp or human-readable time.' },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                  description: 'Evidence confidence.',
                },
              },
              required: ['sourceType'],
            },
          },
          permissions: {
            type: 'object',
            description: 'Explicit permissions controlling what context may be used.',
            properties: {
              usePublicKnowledge: {
                type: 'boolean',
                description: 'Allow public knowledge for this subject.',
              },
              useRelationshipMemory: {
                type: 'boolean',
                description: 'Allow relationship memory for confirmed known people.',
              },
              identifyUnknownPeople: {
                type: 'boolean',
                description: 'Allow identity inference for unknown people. Defaults false.',
              },
              persistNewMemory: {
                type: 'boolean',
                description: 'Allow memory persistence after explicit confirmation.',
              },
              useSensitiveFacts: {
                type: 'boolean',
                description: 'Allow sensitive facts for confirmed known people.',
              },
            },
          },
        },
        required: ['subject'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.subject !== 'string' || data.subject.trim() === '') {
      return { valid: false, errors: ['subject must be a non-empty string'] };
    }

    if (data.subjectType !== undefined && !SUBJECT_TYPES.includes(data.subjectType as RelationshipSubjectType)) {
      return { valid: false, errors: [`subjectType must be one of: ${SUBJECT_TYPES.join(', ')}`] };
    }

    if (data.mode !== undefined && !MODES.includes(data.mode as RelationshipMode)) {
      return { valid: false, errors: [`mode must be one of: ${MODES.join(', ')}`] };
    }

    if (data.confidence !== undefined) {
      if (typeof data.confidence !== 'number' || !Number.isFinite(data.confidence)) {
        return { valid: false, errors: ['confidence must be a finite number'] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: [
        'relationship',
        'identity',
        'person',
        'public figure',
        'people memory',
        'world memory',
        'permission',
        'evidence',
        'robot',
        'recognition',
      ],
      priority: 6,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createRelationshipIntelligenceTools(): ITool[] {
  return [new RelationshipContextTool()];
}
