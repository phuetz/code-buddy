import type { EuAllergenId } from './allergens.js';
import { assertFoodProfile } from './profile-validator.js';
import { normalizeMealLookupValue } from './recipe-normalizer.js';
import type {
  CompatibilityReason,
  CompatibilityVerdict,
  FoodConstraint,
  FoodProfile,
  NormalizedRecipe,
  NormalizedRecipeIngredient,
} from './types.js';

function isConstraintActive(constraint: FoodConstraint, now: Date): boolean {
  if (constraint.kind !== 'temporary') return true;
  const expiry = Date.parse(constraint.expiresAt);
  return !Number.isNaN(expiry) && expiry > now.getTime();
}

function targetMatchesIngredient(
  constraint: Exclude<FoodConstraint, { kind: 'preference' }>,
  ingredient: NormalizedRecipeIngredient,
): boolean {
  return constraint.target.type === 'ingredient'
    && normalizeMealLookupValue(constraint.target.value) === ingredient.normalizedName;
}

function targetMatchesTag(
  constraint: Exclude<FoodConstraint, { kind: 'preference' }>,
  tags: readonly string[],
): boolean {
  return constraint.target.type === 'tag'
    && tags.includes(normalizeMealLookupValue(constraint.target.value));
}

function allergenTarget(
  constraint: Exclude<FoodConstraint, { kind: 'preference' }>,
): EuAllergenId | undefined {
  return constraint.target.type === 'allergen'
    ? constraint.target.value as EuAllergenId
    : undefined;
}

function reason(
  code: CompatibilityReason['code'],
  message: string,
  options: Pick<CompatibilityReason, 'ingredientId' | 'constraintId' | 'allergen'> = {},
): CompatibilityReason {
  return { code, message, ...options };
}

/**
 * Evaluate only explicit constraints and explicit allergen declarations.
 * Ingredient names are intentionally never converted into medical facts.
 */
export function evaluateRecipeCompatibility(
  profile: FoodProfile,
  recipe: NormalizedRecipe,
  now = new Date(),
): CompatibilityVerdict {
  assertFoodProfile(profile);
  const exclusions = profile.constraints
    .filter((constraint): constraint is Exclude<FoodConstraint, { kind: 'preference' }> => constraint.kind !== 'preference')
    .filter(constraint => isConstraintActive(constraint, now));
  const allergenExclusions = exclusions.filter(constraint => constraint.target.type === 'allergen');
  const confirmedAllergenExclusions = allergenExclusions.filter(constraint => constraint.status === 'confirmed');
  const reasons: CompatibilityReason[] = [];
  const unknownIngredientIds: string[] = [];
  let incompatible = false;
  let unknown = false;
  let blockingUnknown = false;

  for (const constraint of exclusions) {
    if (targetMatchesTag(constraint, recipe.tags)) {
      incompatible = true;
      reasons.push(reason(
        'EXCLUDED_TAG',
        `Recipe tag "${constraint.target.value}" is explicitly excluded.`,
        { constraintId: constraint.id },
      ));
    }
  }

  for (const ingredient of recipe.ingredients) {
    for (const constraint of exclusions) {
      if (targetMatchesIngredient(constraint, ingredient)) {
        incompatible = true;
        reasons.push(reason(
          'EXCLUDED_INGREDIENT',
          `Ingredient "${ingredient.name}" is explicitly excluded.`,
          { ingredientId: ingredient.id, constraintId: constraint.id },
        ));
      }
    }

    const disclosure = ingredient.allergenDisclosure;
    if (disclosure.status === 'unknown') {
      unknownIngredientIds.push(ingredient.id);
      if (allergenExclusions.length > 0) {
        unknown = true;
        blockingUnknown ||= confirmedAllergenExclusions.length > 0;
        reasons.push(reason(
          'ALLERGEN_DATA_MISSING',
          `Allergen information is missing for "${ingredient.name}".`,
          { ingredientId: ingredient.id },
        ));
      }
      continue;
    }

    for (const constraint of allergenExclusions) {
      const allergen = allergenTarget(constraint);
      if (!allergen) continue;
      if (disclosure.contains.includes(allergen)) {
        incompatible = true;
        reasons.push(reason(
          'DECLARED_ALLERGEN',
          `Ingredient "${ingredient.name}" declares excluded allergen "${allergen}".`,
          { ingredientId: ingredient.id, constraintId: constraint.id, allergen },
        ));
      } else if (disclosure.mayContain.includes(allergen)) {
        if (constraint.status === 'confirmed') {
          incompatible = true;
        } else {
          unknown = true;
        }
        reasons.push(reason(
          'POSSIBLE_ALLERGEN',
          `Ingredient "${ingredient.name}" may contain excluded allergen "${allergen}".`,
          { ingredientId: ingredient.id, constraintId: constraint.id, allergen },
        ));
      }
    }
  }

  if (incompatible) {
    return {
      status: 'incompatible',
      blocking: true,
      allergenDataComplete: unknownIngredientIds.length === 0,
      unknownIngredientIds,
      reasons,
    };
  }
  if (unknown) {
    return {
      status: 'unknown',
      blocking: blockingUnknown,
      allergenDataComplete: unknownIngredientIds.length === 0,
      unknownIngredientIds,
      reasons,
    };
  }
  return {
    status: 'compatible',
    blocking: false,
    allergenDataComplete: unknownIngredientIds.length === 0,
    unknownIngredientIds,
    reasons,
  };
}
