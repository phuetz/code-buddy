import { createHash } from 'node:crypto';
import { isEuAllergenId } from './allergens.js';
import type {
  AllergenDisclosure,
  FoodProvenance,
  MealValidationIssue,
  NormalizedRecipe,
  RecipeIngredientInput,
  RecipeInput,
} from './types.js';

export class MealRecipeValidationError extends Error {
  constructor(public readonly issues: MealValidationIssue[]) {
    super(`Invalid recipe (${issues.length} issue${issues.length === 1 ? '' : 's'}).`);
    this.name = 'MealRecipeValidationError';
  }
}

export function normalizeMealLookupValue(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedId(prefix: string, seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneProvenance(provenance: FoodProvenance): FoodProvenance {
  return { ...provenance };
}

function normalizeAllergenDisclosure(
  value: AllergenDisclosure | undefined,
  fallbackProvenance: FoodProvenance,
  path: string,
  issues: MealValidationIssue[],
): AllergenDisclosure {
  if (value === undefined) {
    return { status: 'unknown', provenance: cloneProvenance(fallbackProvenance) };
  }
  if (!isRecord(value) || (value.status !== 'known' && value.status !== 'unknown')) {
    issues.push({ code: 'INVALID_ALLERGEN_DISCLOSURE', path, message: 'Allergen disclosure must be known or unknown.' });
    return { status: 'unknown', provenance: cloneProvenance(fallbackProvenance) };
  }
  if (value.status === 'unknown') {
    const provenance = value.provenance === undefined
      ? fallbackProvenance
      : validateProvenance(value.provenance, `${path}.provenance`, issues)
        ? value.provenance
        : fallbackProvenance;
    return { status: 'unknown', provenance: cloneProvenance(provenance) };
  }

  if (!Array.isArray(value.contains) || !Array.isArray(value.mayContain)) {
    issues.push({
      code: 'INCOMPLETE_ALLERGEN_DISCLOSURE',
      path,
      message: 'A known disclosure requires explicit contains and mayContain arrays.',
    });
    return { status: 'unknown', provenance: cloneProvenance(fallbackProvenance) };
  }
  const containsInput = value.contains;
  const mayContainInput = value.mayContain;
  const contains = containsInput.filter(isEuAllergenId);
  const mayContain = mayContainInput.filter(isEuAllergenId);
  if (contains.length !== containsInput.length || mayContain.length !== mayContainInput.length) {
    issues.push({ code: 'INVALID_ALLERGEN_ID', path, message: 'Allergen lists must only contain canonical EU allergen ids.' });
  }
  const provenance = validateProvenance(value.provenance, `${path}.provenance`, issues)
    ? value.provenance
    : fallbackProvenance;
  return {
    status: 'known',
    contains: [...new Set(contains)],
    mayContain: [...new Set(mayContain)],
    provenance: cloneProvenance(provenance),
  };
}

function validateProvenance(value: unknown, path: string, issues: MealValidationIssue[]): value is FoodProvenance {
  if (!isRecord(value)
    || typeof value.source !== 'string'
    || typeof value.sourceId !== 'string'
    || value.sourceId.trim().length === 0
    || typeof value.recordedAt !== 'string'
    || Number.isNaN(Date.parse(value.recordedAt))
    || (value.status !== 'confirmed' && value.status !== 'unknown')) {
    issues.push({ code: 'INVALID_PROVENANCE', path, message: 'Valid provenance is required.' });
    return false;
  }
  return true;
}

function normalizeIngredient(
  ingredient: RecipeIngredientInput,
  index: number,
  recipeId: string,
  recipeProvenance: FoodProvenance,
  issues: MealValidationIssue[],
): NormalizedRecipe['ingredients'][number] {
  const path = `$.ingredients[${index}]`;
  const name = typeof ingredient?.name === 'string' ? ingredient.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length === 0 || name.length > 200) {
    issues.push({ code: 'INVALID_INGREDIENT_NAME', path: `${path}.name`, message: 'Ingredient name must contain 1 to 200 characters.' });
  }
  const quantity = ingredient?.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    issues.push({ code: 'INVALID_INGREDIENT_QUANTITY', path: `${path}.quantity`, message: 'Ingredient quantity must be a positive finite number.' });
  }
  const unit = typeof ingredient?.unit === 'string' ? ingredient.unit.replace(/\s+/g, ' ').trim() : '';
  if (unit.length === 0 || unit.length > 40) {
    issues.push({ code: 'INVALID_INGREDIENT_UNIT', path: `${path}.unit`, message: 'Ingredient unit must contain 1 to 40 characters.' });
  }
  const provenance = ingredient?.provenance === undefined
    ? recipeProvenance
    : validateProvenance(ingredient.provenance, `${path}.provenance`, issues)
      ? ingredient.provenance
      : recipeProvenance;
  const id = typeof ingredient?.id === 'string' && ingredient.id.trim().length > 0
    ? ingredient.id.trim()
    : normalizedId('ingredient', `${recipeId}:${index}:${normalizeMealLookupValue(name)}`);

  return {
    id,
    name,
    normalizedName: normalizeMealLookupValue(name),
    quantity: typeof quantity === 'number' ? quantity : 0,
    unit,
    optional: ingredient?.optional === true,
    allergenDisclosure: normalizeAllergenDisclosure(
      ingredient?.allergenDisclosure,
      provenance,
      `${path}.allergenDisclosure`,
      issues,
    ),
    provenance: cloneProvenance(provenance),
  };
}

export function normalizeRecipe(input: RecipeInput): NormalizedRecipe {
  const issues: MealValidationIssue[] = [];
  const title = typeof input?.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
  if (title.length === 0 || title.length > 200) {
    issues.push({ code: 'INVALID_RECIPE_TITLE', path: '$.title', message: 'Recipe title must contain 1 to 200 characters.' });
  }
  if (typeof input?.servings !== 'number' || !Number.isFinite(input.servings) || input.servings <= 0 || input.servings > 100) {
    issues.push({ code: 'INVALID_SERVINGS', path: '$.servings', message: 'Servings must be a positive finite number no greater than 100.' });
  }
  if (!validateProvenance(input?.provenance, '$.provenance', issues)) {
    throw new MealRecipeValidationError(issues);
  }
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0 || input.ingredients.length > 500) {
    issues.push({ code: 'INVALID_INGREDIENTS', path: '$.ingredients', message: 'A recipe requires between 1 and 500 ingredients.' });
  }

  const normalizedTitle = normalizeMealLookupValue(title);
  const recipeId = typeof input.id === 'string' && input.id.trim().length > 0
    ? input.id.trim()
    : normalizedId('recipe', `${normalizedTitle}:${input.provenance.sourceId}`);
  const ingredients = Array.isArray(input.ingredients)
    ? input.ingredients.map((ingredient, index) => normalizeIngredient(
      ingredient,
      index,
      recipeId,
      input.provenance,
      issues,
    ))
    : [];
  const ingredientIds = new Set<string>();
  ingredients.forEach((ingredient, index) => {
    if (ingredientIds.has(ingredient.id)) {
      issues.push({ code: 'DUPLICATE_INGREDIENT_ID', path: `$.ingredients[${index}].id`, message: 'Ingredient ids must be unique.' });
    }
    ingredientIds.add(ingredient.id);
  });
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(normalizeMealLookupValue)
      .filter(Boolean))]
    : [];

  if (issues.length > 0) throw new MealRecipeValidationError(issues);
  return {
    id: recipeId,
    title,
    normalizedTitle,
    servings: input.servings,
    ingredients,
    tags,
    provenance: cloneProvenance(input.provenance),
  };
}
