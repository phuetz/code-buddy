import { isEuAllergenId } from './allergens.js';
import {
  FOOD_PROFILE_SCHEMA_VERSION,
  FOOD_PROVENANCE_SOURCES,
  type FoodConstraint,
  type FoodConstraintTarget,
  type FoodProfile,
  type FoodProvenance,
  type MealValidationIssue,
} from './types.js';

const PROVENANCE_SOURCES = new Set<string>(FOOD_PROVENANCE_SOURCES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value));
}

function validateProvenance(value: unknown, path: string, issues: MealValidationIssue[]): value is FoodProvenance {
  if (!isRecord(value)) {
    issues.push({ code: 'INVALID_PROVENANCE', path, message: 'Provenance is required.' });
    return false;
  }
  if (typeof value.source !== 'string' || !PROVENANCE_SOURCES.has(value.source)) {
    issues.push({ code: 'INVALID_PROVENANCE_SOURCE', path: `${path}.source`, message: 'Unknown provenance source.' });
  }
  if (typeof value.sourceId !== 'string' || value.sourceId.trim().length === 0) {
    issues.push({ code: 'INVALID_PROVENANCE_ID', path: `${path}.sourceId`, message: 'A provenance source id is required.' });
  }
  if (!isIsoDate(value.recordedAt)) {
    issues.push({ code: 'INVALID_PROVENANCE_DATE', path: `${path}.recordedAt`, message: 'recordedAt must be an ISO-compatible date.' });
  }
  if (value.status !== 'confirmed' && value.status !== 'unknown') {
    issues.push({ code: 'INVALID_EVIDENCE_STATUS', path: `${path}.status`, message: 'Evidence status must be confirmed or unknown.' });
  }
  return true;
}

function validateTarget(value: unknown, path: string, issues: MealValidationIssue[]): value is FoodConstraintTarget {
  if (!isRecord(value)) {
    issues.push({ code: 'INVALID_CONSTRAINT_TARGET', path, message: 'Constraint target is required.' });
    return false;
  }
  if (value.type !== 'ingredient' && value.type !== 'allergen' && value.type !== 'tag') {
    issues.push({ code: 'INVALID_TARGET_TYPE', path: `${path}.type`, message: 'Target type must be ingredient, allergen, or tag.' });
  }
  if (typeof value.value !== 'string' || value.value.trim().length === 0) {
    issues.push({ code: 'INVALID_TARGET_VALUE', path: `${path}.value`, message: 'Target value is required.' });
  } else if (value.type === 'allergen' && !isEuAllergenId(value.value)) {
    issues.push({ code: 'INVALID_ALLERGEN', path: `${path}.value`, message: 'Allergen target must use a canonical EU allergen id.' });
  }
  return true;
}

function validateConstraint(value: unknown, path: string, issues: MealValidationIssue[]): value is FoodConstraint {
  if (!isRecord(value)) {
    issues.push({ code: 'INVALID_CONSTRAINT', path, message: 'Constraint must be an object.' });
    return false;
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    issues.push({ code: 'INVALID_CONSTRAINT_ID', path: `${path}.id`, message: 'Constraint id is required.' });
  }
  if (value.status !== 'confirmed' && value.status !== 'unknown') {
    issues.push({ code: 'INVALID_CONSTRAINT_STATUS', path: `${path}.status`, message: 'Constraint status must be confirmed or unknown.' });
  }
  validateTarget(value.target, `${path}.target`, issues);
  validateProvenance(value.provenance, `${path}.provenance`, issues);

  if (value.kind === 'preference') {
    if (value.effect !== 'prefer' && value.effect !== 'dislike') {
      issues.push({ code: 'INVALID_PREFERENCE_EFFECT', path: `${path}.effect`, message: 'Preference effect must be prefer or dislike.' });
    }
    return true;
  }

  if (!['avoidance', 'intolerance', 'allergy', 'clinician', 'temporary'].includes(String(value.kind))) {
    issues.push({ code: 'INVALID_CONSTRAINT_KIND', path: `${path}.kind`, message: 'Unknown food constraint kind.' });
  }
  if (value.effect !== 'exclude') {
    issues.push({ code: 'INVALID_EXCLUSION_EFFECT', path: `${path}.effect`, message: 'Hard constraints must use the exclude effect.' });
  }
  if (value.kind === 'temporary' && !isIsoDate(value.expiresAt)) {
    issues.push({ code: 'INVALID_EXPIRY', path: `${path}.expiresAt`, message: 'Temporary constraints require an expiry date.' });
  }
  return true;
}

export function getFoodProfileValidationIssues(value: unknown): MealValidationIssue[] {
  const issues: MealValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ code: 'INVALID_PROFILE', path: '$', message: 'Food profile must be an object.' }];
  }
  if (value.schemaVersion !== FOOD_PROFILE_SCHEMA_VERSION) {
    issues.push({ code: 'UNSUPPORTED_PROFILE_SCHEMA', path: '$.schemaVersion', message: 'Unsupported food profile schema.' });
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    issues.push({ code: 'INVALID_PROFILE_ID', path: '$.id', message: 'Food profile id is required.' });
  }
  if (!isIsoDate(value.createdAt)) {
    issues.push({ code: 'INVALID_CREATED_AT', path: '$.createdAt', message: 'createdAt must be an ISO-compatible date.' });
  }
  if (!isIsoDate(value.updatedAt)) {
    issues.push({ code: 'INVALID_UPDATED_AT', path: '$.updatedAt', message: 'updatedAt must be an ISO-compatible date.' });
  }
  if (!Array.isArray(value.constraints)) {
    issues.push({ code: 'INVALID_CONSTRAINTS', path: '$.constraints', message: 'constraints must be an array.' });
  } else {
    const ids = new Set<string>();
    value.constraints.forEach((constraint, index) => {
      validateConstraint(constraint, `$.constraints[${index}]`, issues);
      if (isRecord(constraint) && typeof constraint.id === 'string') {
        if (ids.has(constraint.id)) {
          issues.push({ code: 'DUPLICATE_CONSTRAINT_ID', path: `$.constraints[${index}].id`, message: 'Constraint ids must be unique.' });
        }
        ids.add(constraint.id);
      }
    });
  }
  return issues;
}

export class FoodProfileValidationError extends Error {
  constructor(public readonly issues: MealValidationIssue[]) {
    super(`Invalid food profile (${issues.length} issue${issues.length === 1 ? '' : 's'}).`);
    this.name = 'FoodProfileValidationError';
  }
}

export function assertFoodProfile(value: unknown): asserts value is FoodProfile {
  const issues = getFoodProfileValidationIssues(value);
  if (issues.length > 0) throw new FoodProfileValidationError(issues);
}
