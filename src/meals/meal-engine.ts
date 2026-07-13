import { evaluateRecipeCompatibility } from './compatibility.js';
import type { EuAllergenId } from './allergens.js';
import { assertFoodProfile } from './profile-validator.js';
import {
  MealRecipeValidationError,
  normalizeMealLookupValue,
  normalizeRecipe,
} from './recipe-normalizer.js';
import type {
  AllergenDisclosure,
  FoodConstraintTarget,
  FoodInventoryItem,
  FoodPreferenceConstraint,
  FoodProfile,
  FoodProvenance,
  MealScoreBreakdown,
  MealSubstitutionResult,
  MealSuggestion,
  MealSuggestionRequest,
  MealSuggestionResult,
  NormalizedRecipe,
  RecipeIngredientInput,
  RecipeInput,
} from './types.js';

function targetMatchesRecipe(target: FoodConstraintTarget, recipe: NormalizedRecipe): boolean {
  if (target.type === 'tag') {
    return recipe.tags.includes(normalizeMealLookupValue(target.value));
  }
  if (target.type === 'ingredient') {
    const normalized = normalizeMealLookupValue(target.value);
    return recipe.ingredients.some(ingredient => ingredient.normalizedName === normalized);
  }
  return recipe.ingredients.some((ingredient) => {
    const disclosure = ingredient.allergenDisclosure;
    return disclosure.status === 'known'
      && (disclosure.contains.includes(target.value as EuAllergenId)
        || disclosure.mayContain.includes(target.value as EuAllergenId));
  });
}

function scorePreferences(profile: FoodProfile, recipe: NormalizedRecipe): number {
  return profile.constraints
    .filter((constraint): constraint is FoodPreferenceConstraint => constraint.kind === 'preference')
    .filter(constraint => constraint.status === 'confirmed')
    .reduce((score, constraint) => {
      if (!targetMatchesRecipe(constraint.target, recipe)) return score;
      return score + (constraint.effect === 'prefer' ? 12 : -12);
    }, 0);
}

function activeInventory(inventory: readonly FoodInventoryItem[], now: Date): FoodInventoryItem[] {
  return inventory.filter((item) => {
    if (item.status !== 'confirmed') return false;
    if (!item.availableUntil) return true;
    const expiry = Date.parse(item.availableUntil);
    return !Number.isNaN(expiry) && expiry >= now.getTime();
  });
}

function scoreInventory(
  recipe: NormalizedRecipe,
  inventory: readonly FoodInventoryItem[],
): Pick<MealSuggestion, 'matchedInventoryIds' | 'missingIngredientIds'> & Pick<MealScoreBreakdown, 'pantryCoverage' | 'leftovers' | 'missingIngredients'> {
  const inventoryByName = new Map<string, FoodInventoryItem[]>();
  for (const item of inventory) {
    const key = normalizeMealLookupValue(item.name);
    const existing = inventoryByName.get(key) ?? [];
    existing.push(item);
    inventoryByName.set(key, existing);
  }

  const matchedInventoryIds = new Set<string>();
  const missingIngredientIds: string[] = [];
  let matchedRequired = 0;
  let required = 0;
  let leftoverMatches = 0;

  for (const ingredient of recipe.ingredients) {
    if (!ingredient.optional) required += 1;
    const matches = inventoryByName.get(ingredient.normalizedName) ?? [];
    const match = matches.find(item => !matchedInventoryIds.has(item.id));
    if (!match) {
      if (!ingredient.optional) missingIngredientIds.push(ingredient.id);
      continue;
    }
    matchedInventoryIds.add(match.id);
    if (!ingredient.optional) matchedRequired += 1;
    if (match.kind === 'leftover') leftoverMatches += 1;
  }

  const coverage = required === 0 ? 1 : matchedRequired / required;
  return {
    matchedInventoryIds: [...matchedInventoryIds],
    missingIngredientIds,
    pantryCoverage: Math.round(coverage * 20),
    leftovers: Math.min(16, leftoverMatches * 8),
    missingIngredients: -Math.min(20, missingIngredientIds.length * 2),
  };
}

function scoreRecipe(
  profile: FoodProfile,
  recipe: NormalizedRecipe,
  inventory: readonly FoodInventoryItem[],
): Omit<MealSuggestion, 'compatibility'> {
  const inventoryScore = scoreInventory(recipe, inventory);
  const scoreBreakdown: MealScoreBreakdown = {
    base: 50,
    preferences: scorePreferences(profile, recipe),
    pantryCoverage: inventoryScore.pantryCoverage,
    leftovers: inventoryScore.leftovers,
    missingIngredients: inventoryScore.missingIngredients,
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  return {
    recipe,
    score,
    scoreBreakdown,
    matchedInventoryIds: inventoryScore.matchedInventoryIds,
    missingIngredientIds: inventoryScore.missingIngredientIds,
  };
}

function cloneDisclosure(disclosure: AllergenDisclosure): AllergenDisclosure {
  if (disclosure.status === 'unknown') {
    return {
      status: 'unknown',
      ...(disclosure.provenance ? { provenance: { ...disclosure.provenance } } : {}),
    };
  }
  return {
    status: 'known',
    contains: [...disclosure.contains],
    mayContain: [...disclosure.mayContain],
    provenance: { ...disclosure.provenance },
  };
}

function recipeToInput(recipe: NormalizedRecipe): RecipeInput {
  return {
    id: recipe.id,
    title: recipe.title,
    servings: recipe.servings,
    tags: [...recipe.tags],
    provenance: { ...recipe.provenance },
    ingredients: recipe.ingredients.map(ingredient => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      optional: ingredient.optional,
      allergenDisclosure: cloneDisclosure(ingredient.allergenDisclosure),
      provenance: { ...ingredient.provenance },
    })),
  };
}

export function suggestMeals(request: MealSuggestionRequest): MealSuggestionResult {
  assertFoodProfile(request.profile);
  const now = request.now ?? new Date();
  const inventory = activeInventory(request.inventory ?? [], now);
  const suggestions: MealSuggestion[] = [];
  const rejected: MealSuggestionResult['rejected'] = [];

  for (const candidate of request.candidates) {
    let recipe: NormalizedRecipe;
    try {
      recipe = normalizeRecipe(candidate);
    } catch (error) {
      if (error instanceof MealRecipeValidationError) {
        rejected.push({
          recipeId: candidate.id,
          title: typeof candidate.title === 'string' ? candidate.title : '',
          reason: 'validation',
          validationIssues: error.issues,
        });
        continue;
      }
      throw error;
    }

    const compatibility = evaluateRecipeCompatibility(request.profile, recipe, now);
    // Conservative default: only an explicit compatible verdict is eligible.
    if (compatibility.status !== 'compatible') {
      rejected.push({
        recipeId: recipe.id,
        title: recipe.title,
        reason: 'compatibility',
        compatibility,
      });
      continue;
    }
    suggestions.push({
      ...scoreRecipe(request.profile, recipe, inventory),
      compatibility,
    });
  }

  suggestions.sort((left, right) => right.score - left.score
    || left.recipe.title.localeCompare(right.recipe.title));
  const limit = Number.isInteger(request.limit) && (request.limit ?? 0) > 0
    ? Math.min(request.limit as number, 100)
    : suggestions.length;
  return { suggestions: suggestions.slice(0, limit), rejected };
}

export interface MealSubstitutionInput extends RecipeIngredientInput {
  provenance: FoodProvenance;
}

/** Replace one ingredient, normalize again, then re-run the complete guardrail. */
export function tryMealSubstitution(
  profile: FoodProfile,
  recipe: NormalizedRecipe,
  ingredientId: string,
  replacement: MealSubstitutionInput,
  now = new Date(),
): MealSubstitutionResult {
  assertFoodProfile(profile);
  const input = recipeToInput(recipe);
  const index = input.ingredients.findIndex(ingredient => ingredient.id === ingredientId);
  if (index < 0) {
    return {
      accepted: false,
      validationIssues: [{
        code: 'INGREDIENT_NOT_FOUND',
        path: '$.ingredientId',
        message: `Ingredient "${ingredientId}" does not exist in the recipe.`,
      }],
    };
  }
  const replacedId = replacement.id?.trim() || ingredientId;
  input.ingredients[index] = { ...replacement, id: replacedId };

  let normalized: NormalizedRecipe;
  try {
    normalized = normalizeRecipe(input);
  } catch (error) {
    if (error instanceof MealRecipeValidationError) {
      return { accepted: false, validationIssues: error.issues };
    }
    throw error;
  }
  const compatibility = evaluateRecipeCompatibility(profile, normalized, now);
  if (compatibility.status !== 'compatible') {
    return { accepted: false, recipe: normalized, compatibility, validationIssues: [] };
  }
  return { accepted: true, recipe: normalized, compatibility, validationIssues: [] };
}
