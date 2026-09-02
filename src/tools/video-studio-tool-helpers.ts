/**
 * Shared parsers and ToolResult helpers for the video-studio ITool adapters.
 * Pure: no I/O, no network.
 */

import type { ToolResult } from '../types/index.js';
import {
  CONTENT_TIERS,
  type HybridVideoCapacity,
  type HybridVideoRequest,
  type HybridVideoUseCase,
} from './video/hybrid-video-router.js';

export const HYBRID_USE_CASES: readonly HybridVideoUseCase[] = [
  'avatar-lipsync',
  'bulk-variation',
  'hero-shot',
  'long-form-b-roll',
  'transition',
];

export function toolOk(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data };
}

export function toolFail(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

export function firstPresent(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

export function pickString(record: Record<string, unknown>, keys: readonly string[], name: string): string {
  const value = firstPresent(record, keys);
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export function pickBoolean(record: Record<string, unknown>, keys: readonly string[], name: string): boolean {
  const value = firstPresent(record, keys);
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function pickFiniteNumber(record: Record<string, unknown>, keys: readonly string[], name: string): number {
  const value = firstPresent(record, keys);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

export function pickInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
  name: string,
  minimum = 0,
): number {
  const value = firstPresent(record, keys);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

export function pickOptionalBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
  name: string,
): boolean | undefined {
  const value = firstPresent(record, keys);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

export function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
}

export function parseHybridCapacity(value: unknown): HybridVideoCapacity {
  const record = requireRecord(value, 'capacity');
  return {
    gpuNode: pickBoolean(record, ['gpuNode'], 'capacity.gpuNode'),
    ministar: pickBoolean(record, ['ministar'], 'capacity.ministar'),
    googleFlow: pickBoolean(record, ['google_flow', 'googleFlow'], 'capacity.google_flow'),
    remainingFlowCredits: pickFiniteNumber(
      record,
      ['remaining_flow_credits', 'remainingFlowCredits'],
      'capacity.remaining_flow_credits',
    ),
    maxFlowCreditsPerBatch: pickFiniteNumber(
      record,
      ['max_flow_credits_per_batch', 'maxFlowCreditsPerBatch'],
      'capacity.max_flow_credits_per_batch',
    ),
  };
}

export function parseHybridRequest(value: unknown, name = 'request'): HybridVideoRequest {
  const record = requireRecord(value, name);
  const quantity = firstPresent(record, ['quantity']);
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`${name}.quantity must be a positive integer`);
  }
  const request: HybridVideoRequest = {
    id: pickString(record, ['id'], `${name}.id`),
    useCase: parseEnum(
      firstPresent(record, ['use_case', 'useCase']),
      HYBRID_USE_CASES,
      `${name}.use_case`,
    ),
    contentTier: parseEnum(
      firstPresent(record, ['content_tier', 'contentTier']),
      CONTENT_TIERS,
      `${name}.content_tier`,
    ),
    quantity,
    requiresLipSync: pickBoolean(
      record,
      ['requires_lip_sync', 'requiresLipSync'],
      `${name}.requires_lip_sync`,
    ),
    premium: pickBoolean(record, ['premium'], `${name}.premium`),
  };
  const upscale4k = pickOptionalBoolean(record, ['upscale_4k', 'upscale4k'], `${name}.upscale_4k`);
  if (upscale4k !== undefined) request.upscale4k = upscale4k;
  return request;
}

export function parseHybridRequestList(value: unknown): HybridVideoRequest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('requests must be a non-empty array');
  }
  return value.map((item, index) => parseHybridRequest(item, `requests[${index}]`));
}
