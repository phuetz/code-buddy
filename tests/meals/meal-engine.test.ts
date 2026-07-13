import { describe, expect, it } from 'vitest';
import { EU_ALLERGEN_IDS, type EuAllergenId } from '../../src/meals/allergens.js';
import { evaluateRecipeCompatibility } from '../../src/meals/compatibility.js';
import { suggestMeals, tryMealSubstitution } from '../../src/meals/meal-engine.js';
import { MealRecipeValidationError, normalizeRecipe } from '../../src/meals/recipe-normalizer.js';
import type {
  AllergenDisclosure,
  FoodProfile,
  FoodProvenance,
  RecipeIngredientInput,
  RecipeInput,
} from '../../src/meals/types.js';

const userProvenance: FoodProvenance = {
  source: 'user',
  sourceId: 'meal-settings',
  recordedAt: '2026-07-12T08:00:00.000Z',
  status: 'confirmed',
};

const recipeProvenance: FoodProvenance = {
  source: 'recipe',
  sourceId: 'test-recipe-book',
  recordedAt: '2026-07-12T08:00:00.000Z',
  status: 'confirmed',
};

const labelProvenance: FoodProvenance = {
  source: 'label',
  sourceId: 'verified-label',
  recordedAt: '2026-07-12T08:00:00.000Z',
  status: 'confirmed',
};

function known(
  contains: EuAllergenId[] = [],
  mayContain: EuAllergenId[] = [],
): AllergenDisclosure {
  return { status: 'known', contains, mayContain, provenance: labelProvenance };
}

function ingredient(
  id: string,
  name: string,
  allergenDisclosure: AllergenDisclosure = known(),
): RecipeIngredientInput {
  return {
    id,
    name,
    quantity: 1,
    unit: 'portion',
    allergenDisclosure,
    provenance: recipeProvenance,
  };
}

function recipe(
  id: string,
  title: string,
  ingredients: RecipeIngredientInput[],
  tags: string[] = [],
): RecipeInput {
  return {
    id,
    title,
    servings: 2,
    ingredients,
    tags,
    provenance: recipeProvenance,
  };
}

function peanutAllergyProfile(status: 'confirmed' | 'unknown' = 'confirmed'): FoodProfile {
  return {
    schemaVersion: 1,
    id: 'food-profile',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T08:00:00.000Z',
    constraints: [{
      id: 'peanut-allergy',
      kind: 'allergy',
      effect: 'exclude',
      status,
      target: { type: 'allergen', value: 'peanuts' },
      provenance: { ...userProvenance, status },
    }],
  };
}

const unconstrainedProfile: FoodProfile = {
  schemaVersion: 1,
  id: 'unconstrained-profile',
  createdAt: '2026-07-12T08:00:00.000Z',
  updatedAt: '2026-07-12T08:00:00.000Z',
  constraints: [],
};

describe('EU allergen canon and conservative compatibility', () => {
  it('contains exactly the 14 regulated EU allergen categories', () => {
    expect(EU_ALLERGEN_IDS).toHaveLength(14);
    expect(new Set(EU_ALLERGEN_IDS).size).toBe(14);
  });

  it('returns blocking unknown when allergen data is missing for a confirmed allergy', () => {
    const normalized = normalizeRecipe(recipe(
      'unknown-sauce',
      'Sauce inconnue',
      [ingredient('sauce', 'Sauce du commerce', { status: 'unknown', provenance: labelProvenance })],
    ));

    const verdict = evaluateRecipeCompatibility(peanutAllergyProfile(), normalized);

    expect(verdict.status).toBe('unknown');
    expect(verdict.blocking).toBe(true);
    expect(verdict.allergenDataComplete).toBe(false);
    expect(suggestMeals({
      profile: peanutAllergyProfile(),
      candidates: [recipe(
        'unknown-sauce',
        'Sauce inconnue',
        [ingredient('sauce', 'Sauce du commerce', { status: 'unknown', provenance: labelProvenance })],
      )],
    }).suggestions).toHaveLength(0);
  });

  it('does not infer safety from an ingredient name or missing disclosure', () => {
    const normalized = normalizeRecipe({
      ...recipe('named-peanut', 'Nom non vérifié', [ingredient('item', 'Cacahuètes')]),
      ingredients: [{
        id: 'item',
        name: 'Cacahuètes',
        quantity: 1,
        unit: 'portion',
        provenance: recipeProvenance,
      }],
    });

    const verdict = evaluateRecipeCompatibility(peanutAllergyProfile(), normalized);

    expect(verdict.status).toBe('unknown');
    expect(verdict.reasons.some(item => item.code === 'ALLERGEN_DATA_MISSING')).toBe(true);
  });

  it('returns incompatible for an explicitly declared excluded allergen', () => {
    const normalized = normalizeRecipe(recipe(
      'peanut-dish',
      'Plat aux arachides',
      [ingredient('nuts', 'Garniture', known(['peanuts']))],
    ));

    const verdict = evaluateRecipeCompatibility(peanutAllergyProfile(), normalized);

    expect(verdict.status).toBe('incompatible');
    expect(verdict.blocking).toBe(true);
    expect(verdict.reasons[0]?.allergen).toBe('peanuts');
  });

  it('keeps missing allergen data visible even without an allergy constraint', () => {
    const normalized = normalizeRecipe({
      ...recipe('unknown-data', 'Données incomplètes', [ingredient('item', 'Produit')]),
      ingredients: [{ id: 'item', name: 'Produit', quantity: 1, unit: 'portion' }],
    });

    const verdict = evaluateRecipeCompatibility(unconstrainedProfile, normalized);

    expect(verdict.status).toBe('compatible');
    expect(verdict.allergenDataComplete).toBe(false);
    expect(verdict.unknownIngredientIds).toEqual(['item']);
  });
});

describe('recipe validation and substitutions', () => {
  it('rejects invalid servings and ingredient quantities', () => {
    expect(() => normalizeRecipe({
      ...recipe('invalid', 'Invalide', [ingredient('bad', 'Ingrédient')]),
      servings: 0,
      ingredients: [{ ...ingredient('bad', 'Ingrédient'), quantity: -1 }],
    })).toThrow(MealRecipeValidationError);
  });

  it('re-runs the complete safety validation for substitutions', () => {
    const base = normalizeRecipe(recipe(
      'base',
      'Base sûre',
      [ingredient('sauce', 'Sauce', known()), ingredient('grain', 'Riz', known())],
    ));

    const rejected = tryMealSubstitution(peanutAllergyProfile(), base, 'sauce', {
      name: 'Sauce aux arachides',
      quantity: 1,
      unit: 'portion',
      allergenDisclosure: known(['peanuts']),
      provenance: recipeProvenance,
    });
    const accepted = tryMealSubstitution(peanutAllergyProfile(), base, 'sauce', {
      name: 'Sauce tomate vérifiée',
      quantity: 1,
      unit: 'portion',
      allergenDisclosure: known(),
      provenance: recipeProvenance,
    });

    expect(rejected.accepted).toBe(false);
    expect(rejected.compatibility?.status).toBe('incompatible');
    expect(accepted.accepted).toBe(true);
    expect(accepted.compatibility?.status).toBe('compatible');
  });

  it('does not let a safe replacement hide another unsafe ingredient', () => {
    const unsafeRecipe = normalizeRecipe(recipe(
      'unsafe-elsewhere',
      'Autre ingrédient dangereux',
      [ingredient('sauce', 'Sauce', known()), ingredient('garnish', 'Garniture', known(['peanuts']))],
    ));

    const result = tryMealSubstitution(peanutAllergyProfile(), unsafeRecipe, 'sauce', {
      name: 'Sauce tomate vérifiée',
      quantity: 1,
      unit: 'portion',
      allergenDisclosure: known(),
      provenance: recipeProvenance,
    });

    expect(result.accepted).toBe(false);
    expect(result.compatibility?.status).toBe('incompatible');
    expect(result.compatibility?.reasons.some(item => item.ingredientId === 'garnish')).toBe(true);
  });
});

describe('meal suggestions', () => {
  it('uses confirmed preferences as scoring signals, never as medical facts', () => {
    const profile: FoodProfile = {
      ...unconstrainedProfile,
      constraints: [{
        id: 'prefers-basil',
        kind: 'preference',
        effect: 'prefer',
        status: 'confirmed',
        target: { type: 'ingredient', value: 'Basilic' },
        provenance: userProvenance,
      }],
    };
    const result = suggestMeals({
      profile,
      candidates: [
        recipe('plain', 'Pâtes nature', [ingredient('pasta', 'Pâtes')]),
        recipe('basil', 'Pâtes au basilic', [ingredient('pasta', 'Pâtes'), ingredient('basil', 'Basilic')]),
      ],
    });

    expect(result.suggestions.map(item => item.recipe.id)).toEqual(['basil', 'plain']);
    expect(result.suggestions[0]?.scoreBreakdown.preferences).toBe(12);
  });

  it('prioritizes confirmed leftovers while ignoring unknown inventory', () => {
    const candidates = [
      recipe('rice', 'Riz sauté', [ingredient('rice-item', 'Riz')]),
      recipe('pasta', 'Pâtes', [ingredient('pasta-item', 'Pâtes')]),
    ];
    const result = suggestMeals({
      profile: unconstrainedProfile,
      candidates,
      inventory: [
        {
          id: 'leftover-rice',
          name: 'Riz',
          kind: 'leftover',
          status: 'confirmed',
          provenance: { ...recipeProvenance, source: 'leftover' },
        },
        {
          id: 'uncertain-pasta',
          name: 'Pâtes',
          kind: 'pantry',
          status: 'unknown',
          provenance: { ...recipeProvenance, source: 'pantry', status: 'unknown' },
        },
      ],
    });

    expect(result.suggestions[0]?.recipe.id).toBe('rice');
    expect(result.suggestions[0]?.matchedInventoryIds).toEqual(['leftover-rice']);
    expect(result.suggestions[1]?.matchedInventoryIds).toEqual([]);
  });
});
