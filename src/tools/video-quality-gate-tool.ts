/**
 * ITool adapter over visual-gate-report + youtube-master-quality.
 * Evaluates measured visual gates and digest-bound YouTube human review.
 * Read-only: never writes, never publishes, never calls YouTube.
 */

import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './registry/types.js';
import {
  evaluateVisualGates,
  parseVisualGateReport,
  assertReportMatchesClip,
  type HumanConfirmedVisualGates,
  type VisualGateThresholdProfileId,
} from './video/visual-gate-report.js';
import {
  requestYouTubeMasterChanges,
  reviewYouTubeMaster,
  type YouTubeHumanReviewChecks,
  type YouTubeTechnicalReport,
} from './video/youtube-master-quality.js';
import {
  optionalString,
  parseEnum,
  pickBoolean,
  requireRecord,
  toolFail,
  toolOk,
} from './video-studio-tool-helpers.js';

const OPERATIONS = ['evaluate_visual', 'review_youtube', 'request_youtube_changes'] as const;
type QualityGateOperation = (typeof OPERATIONS)[number];

const VISUAL_PROFILES: readonly VisualGateThresholdProfileId[] = ['native-fashion-v1'];

function parseYouTubeChecks(value: unknown): YouTubeHumanReviewChecks {
  const record = requireRecord(value, 'checks');
  return {
    voice: pickBoolean(record, ['voice'], 'checks.voice'),
    lipSync: pickBoolean(record, ['lip_sync', 'lipSync'], 'checks.lip_sync'),
    identity: pickBoolean(record, ['identity'], 'checks.identity'),
    anatomy: pickBoolean(record, ['anatomy'], 'checks.anatomy'),
    captions: pickBoolean(record, ['captions'], 'checks.captions'),
    disclosure: pickBoolean(record, ['disclosure'], 'checks.disclosure'),
    editorial: pickBoolean(record, ['editorial'], 'checks.editorial'),
  };
}

function parseOperation(input: Record<string, unknown>): QualityGateOperation {
  return parseEnum(input.operation, OPERATIONS, 'operation');
}

export const VIDEO_QUALITY_GATE_PARAMETERS = {
  type: 'object' as const,
  properties: {
    operation: {
      type: 'string',
      enum: [...OPERATIONS],
      description:
        'evaluate_visual: score a schema-V1 visual gate report. review_youtube / request_youtube_changes: digest-bound human review of a technical YouTube master report (never uploads).',
    },
    report: {
      type: 'object',
      description:
        'VisualGateReport (evaluate_visual) or YouTubeTechnicalReport (review_youtube / request_youtube_changes).',
    },
    profile: {
      type: 'string',
      enum: ['native-fashion-v1', 'legacy-localized-v1'],
      description: 'Threshold profile. Defaults to report.profile for evaluate_visual.',
    },
    clip_sha256: {
      type: 'string',
      description: 'Optional lowercase SHA-256; when set, the visual report must match this clip digest.',
    },
    confirm_outfit: {
      type: 'boolean',
      description: 'Human confirmation that outfit matches the approved look (evaluate_visual).',
    },
    confirm_decor_framing: {
      type: 'boolean',
      description: 'Human confirmation that decor/framing is approved (evaluate_visual).',
    },
    expected_video_sha256: {
      type: 'string',
      description: 'Expected master digest for YouTube review operations.',
    },
    reviewer: { type: 'string', description: 'Reviewer name (YouTube review operations).' },
    reason: { type: 'string', description: 'Review reason (YouTube review operations).' },
    checks: {
      type: 'object',
      description: 'YouTube human-review checks (all booleans).',
      properties: {
        voice: { type: 'boolean', description: 'Voice rights and performance approved.' },
        lip_sync: { type: 'boolean', description: 'Lip sync approved.' },
        identity: { type: 'boolean', description: 'Identity/face approved.' },
        anatomy: { type: 'boolean', description: 'Anatomy approved.' },
        captions: { type: 'boolean', description: 'Captions approved.' },
        disclosure: { type: 'boolean', description: 'Synthetic-media disclosure approved.' },
        editorial: { type: 'boolean', description: 'Editorial approved.' },
      },
      required: ['voice', 'lip_sync', 'identity', 'anatomy', 'captions', 'disclosure', 'editorial'],
      additionalProperties: false,
    },
  },
  required: ['operation', 'report'] as string[],
  additionalProperties: false,
};

export class VideoQualityGateTool implements ITool {
  readonly name = 'video_quality_gate';
  readonly description =
    'Fail-closed visual quality gate (identity/anatomy/flicker/sharpness/master) plus digest-bound YouTube master human review. Never writes files, never publishes, never calls YouTube.';

  async execute(input: Record<string, unknown>, _context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const operation = parseOperation(input);
      const reportValue = input.report;
      if (operation === 'evaluate_visual') {
        const report = parseVisualGateReport(reportValue);
        const profile = input.profile === undefined
          ? parseEnum(report.profile, VISUAL_PROFILES, 'profile')
          : parseEnum(input.profile, VISUAL_PROFILES, 'profile');
        const clipSha = optionalString(input, 'clip_sha256');
        if (clipSha) assertReportMatchesClip(report, clipSha);
        const humanConfirmed: HumanConfirmedVisualGates = {};
        if (input.confirm_outfit === true) humanConfirmed.outfit = true;
        if (input.confirm_decor_framing === true) humanConfirmed.decorFraming = true;
        const gateResults = evaluateVisualGates(report, profile, humanConfirmed);
        return toolOk({
          profile,
          passed: gateResults.every((result) => result.pass),
          gateResults,
        });
      }

      const report = requireRecord(reportValue, 'report') as unknown as YouTubeTechnicalReport;
      const expected = optionalString(input, 'expected_video_sha256');
      const reviewer = optionalString(input, 'reviewer');
      const reason = optionalString(input, 'reason');
      if (!expected || !reviewer || !reason) {
        throw new Error('expected_video_sha256, reviewer and reason are required for YouTube review operations');
      }
      const checks = parseYouTubeChecks(input.checks);
      if (operation === 'review_youtube') {
        return toolOk(await reviewYouTubeMaster({
          report,
          expectedVideoSha256: expected,
          reviewer,
          reason,
          checks,
        }));
      }
      return toolOk(await requestYouTubeMasterChanges({
        report,
        expectedVideoSha256: expected,
        reviewer,
        reason,
        checks,
      }));
    } catch (error) {
      return toolFail(error);
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: VIDEO_QUALITY_GATE_PARAMETERS as unknown as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.operation !== 'string' || !(OPERATIONS as readonly string[]).includes(data.operation)) {
      return { valid: false, errors: [`operation must be one of: ${OPERATIONS.join(', ')}`] };
    }
    if (!data.report || typeof data.report !== 'object' || Array.isArray(data.report)) {
      return { valid: false, errors: ['report (object) is required'] };
    }
    if (data.operation !== 'evaluate_visual') {
      const missing: string[] = [];
      if (typeof data.expected_video_sha256 !== 'string' || !data.expected_video_sha256.trim()) {
        missing.push('expected_video_sha256');
      }
      if (typeof data.reviewer !== 'string' || !data.reviewer.trim()) missing.push('reviewer');
      if (typeof data.reason !== 'string' || !data.reason.trim()) missing.push('reason');
      if (!data.checks || typeof data.checks !== 'object' || Array.isArray(data.checks)) {
        missing.push('checks');
      }
      if (missing.length) return { valid: false, errors: [`${missing.join(', ')} required for ${data.operation}`] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: [
        'video', 'quality', 'gate', 'youtube', 'master', 'visual', 'identity', 'anatomy',
        'fashion', 'review', 'qa', 'qualité', 'contrôle', 'gate visuel',
      ],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
