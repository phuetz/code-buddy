import type { EuAllergenId } from './allergens.js';

export const FOOD_PROFILE_SCHEMA_VERSION = 1 as const;

export type EvidenceStatus = 'confirmed' | 'unknown';

export const FOOD_PROVENANCE_SOURCES = [
  'user',
  'label',
  'official-dataset',
  'recipe',
  'pantry',
  'leftover',
  'clinician',
  'system',
] as const;

export type ProvenanceSource = typeof FOOD_PROVENANCE_SOURCES[number];

export interface FoodProvenance {
  source: ProvenanceSource;
  sourceId: string;
  recordedAt: string;
  status: EvidenceStatus;
  uri?: string;
  contentHash?: string;
}

export type ConstraintTargetType = 'ingredient' | 'allergen' | 'tag';

export interface FoodConstraintTarget {
  type: ConstraintTargetType;
  /** Canonical allergen id for `allergen`, normalized exact value otherwise. */
  value: string;
}

interface FoodConstraintBase {
  id: string;
  status: EvidenceStatus;
  target: FoodConstraintTarget;
  provenance: FoodProvenance;
  note?: string;
}

export interface FoodPreferenceConstraint extends FoodConstraintBase {
  kind: 'preference';
  effect: 'prefer' | 'dislike';
}

export interface FoodExclusionConstraint extends FoodConstraintBase {
  kind: 'avoidance' | 'intolerance' | 'allergy' | 'clinician';
  effect: 'exclude';
}

export interface TemporaryFoodConstraint extends FoodConstraintBase {
  kind: 'temporary';
  effect: 'exclude';
  expiresAt: string;
}

export type FoodConstraint =
  | FoodPreferenceConstraint
  | FoodExclusionConstraint
  | TemporaryFoodConstraint;

/**
 * Food-only profile. It deliberately has no dependency on the user/persona
 * model so health-adjacent data cannot silently leak into general identity.
 */
export interface FoodProfile {
  schemaVersion: typeof FOOD_PROFILE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  constraints: FoodConstraint[];
}

export interface KnownAllergenDisclosure {
  status: 'known';
  contains: EuAllergenId[];
  mayContain: EuAllergenId[];
  provenance: FoodProvenance;
}

export interface UnknownAllergenDisclosure {
  status: 'unknown';
  provenance?: FoodProvenance;
}

export type AllergenDisclosure = KnownAllergenDisclosure | UnknownAllergenDisclosure;

export interface RecipeIngredientInput {
  id?: string;
  name: string;
  quantity: number;
  unit: string;
  optional?: boolean;
  allergenDisclosure?: AllergenDisclosure;
  provenance?: FoodProvenance;
}

export interface RecipeInput {
  id?: string;
  title: string;
  servings: number;
  ingredients: RecipeIngredientInput[];
  tags?: string[];
  provenance: FoodProvenance;
}

export interface NormalizedRecipeIngredient {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number;
  unit: string;
  optional: boolean;
  allergenDisclosure: AllergenDisclosure;
  provenance: FoodProvenance;
}

export interface NormalizedRecipe {
  id: string;
  title: string;
  normalizedTitle: string;
  servings: number;
  ingredients: NormalizedRecipeIngredient[];
  tags: string[];
  provenance: FoodProvenance;
}

export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';

export type CompatibilityReasonCode =
  | 'EXCLUDED_INGREDIENT'
  | 'EXCLUDED_TAG'
  | 'DECLARED_ALLERGEN'
  | 'POSSIBLE_ALLERGEN'
  | 'ALLERGEN_DATA_MISSING';

export interface CompatibilityReason {
  code: CompatibilityReasonCode;
  message: string;
  ingredientId?: string;
  constraintId?: string;
  allergen?: EuAllergenId;
}

export interface CompatibilityVerdict {
  status: CompatibilityStatus;
  /** Incompatible is always blocking; unknown blocks confirmed hard rules. */
  blocking: boolean;
  allergenDataComplete: boolean;
  unknownIngredientIds: string[];
  reasons: CompatibilityReason[];
}

export interface FoodInventoryItem {
  id: string;
  name: string;
  kind: 'pantry' | 'leftover';
  status: EvidenceStatus;
  provenance: FoodProvenance;
  quantity?: number;
  unit?: string;
  availableUntil?: string;
}

export interface MealSuggestionRequest {
  profile: FoodProfile;
  candidates: RecipeInput[];
  inventory?: FoodInventoryItem[];
  limit?: number;
  now?: Date;
}

export interface MealScoreBreakdown {
  base: number;
  preferences: number;
  pantryCoverage: number;
  leftovers: number;
  missingIngredients: number;
}

export interface MealSuggestion {
  recipe: NormalizedRecipe;
  compatibility: CompatibilityVerdict;
  score: number;
  scoreBreakdown: MealScoreBreakdown;
  matchedInventoryIds: string[];
  missingIngredientIds: string[];
}

export interface RejectedMealSuggestion {
  recipeId?: string;
  title: string;
  reason: 'validation' | 'compatibility';
  compatibility?: CompatibilityVerdict;
  validationIssues?: MealValidationIssue[];
}

export interface MealSuggestionResult {
  suggestions: MealSuggestion[];
  rejected: RejectedMealSuggestion[];
}

export interface MealValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface MealSubstitutionResult {
  accepted: boolean;
  recipe?: NormalizedRecipe;
  compatibility?: CompatibilityVerdict;
  validationIssues: MealValidationIssue[];
}
