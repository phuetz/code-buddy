/**
 * Canonical identifiers for the 14 allergen categories in Annex II of
 * Regulation (EU) No 1169/2011.
 *
 * These aliases only normalize an allergen declaration supplied by a trusted
 * source (for example a product label). They must never be used to infer an
 * allergen from an ingredient name.
 */
export const EU_ALLERGEN_IDS = [
  'cereals_containing_gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphur_dioxide_and_sulphites',
  'lupin',
  'molluscs',
] as const;

export type EuAllergenId = typeof EU_ALLERGEN_IDS[number];

export interface EuAllergenDefinition {
  id: EuAllergenId;
  labelFr: string;
  aliases: readonly string[];
}

export const EU_ALLERGEN_CANON: Readonly<Record<EuAllergenId, EuAllergenDefinition>> = {
  cereals_containing_gluten: {
    id: 'cereals_containing_gluten',
    labelFr: 'Céréales contenant du gluten',
    aliases: ['gluten', 'cereales contenant du gluten', 'blé', 'ble', 'seigle', 'orge', 'avoine', 'épeautre', 'epeautre', 'kamut'],
  },
  crustaceans: {
    id: 'crustaceans',
    labelFr: 'Crustacés',
    aliases: ['crustace', 'crustaces'],
  },
  eggs: {
    id: 'eggs',
    labelFr: 'Œufs',
    aliases: ['oeuf', 'oeufs', 'œuf', 'œufs'],
  },
  fish: {
    id: 'fish',
    labelFr: 'Poissons',
    aliases: ['poisson', 'poissons'],
  },
  peanuts: {
    id: 'peanuts',
    labelFr: 'Arachides',
    aliases: ['arachide', 'arachides', 'cacahuete', 'cacahuetes', 'cacahuète', 'cacahuètes'],
  },
  soybeans: {
    id: 'soybeans',
    labelFr: 'Soja',
    aliases: ['soja', 'soy', 'soybean', 'soybeans'],
  },
  milk: {
    id: 'milk',
    labelFr: 'Lait',
    aliases: ['lait', 'milk', 'lactose'],
  },
  tree_nuts: {
    id: 'tree_nuts',
    labelFr: 'Fruits à coque',
    aliases: ['fruit a coque', 'fruits a coque', 'fruit à coque', 'fruits à coque', 'nuts', 'tree nuts'],
  },
  celery: {
    id: 'celery',
    labelFr: 'Céleri',
    aliases: ['celeri', 'céleri', 'celery'],
  },
  mustard: {
    id: 'mustard',
    labelFr: 'Moutarde',
    aliases: ['moutarde', 'mustard'],
  },
  sesame: {
    id: 'sesame',
    labelFr: 'Graines de sésame',
    aliases: ['sesame', 'sésame', 'graines de sesame', 'graines de sésame'],
  },
  sulphur_dioxide_and_sulphites: {
    id: 'sulphur_dioxide_and_sulphites',
    labelFr: 'Anhydride sulfureux et sulfites',
    aliases: ['sulfite', 'sulfites', 'sulphite', 'sulphites', 'anhydride sulfureux', 'dioxyde de soufre'],
  },
  lupin: {
    id: 'lupin',
    labelFr: 'Lupin',
    aliases: ['lupin'],
  },
  molluscs: {
    id: 'molluscs',
    labelFr: 'Mollusques',
    aliases: ['mollusque', 'mollusques', 'mollusc', 'molluscs'],
  },
};

const ALLERGEN_ID_SET = new Set<string>(EU_ALLERGEN_IDS);

function normalizeAlias(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ALLERGEN_ALIAS_INDEX = new Map<string, EuAllergenId>();
for (const id of EU_ALLERGEN_IDS) {
  const definition = EU_ALLERGEN_CANON[id];
  ALLERGEN_ALIAS_INDEX.set(normalizeAlias(id), id);
  ALLERGEN_ALIAS_INDEX.set(normalizeAlias(definition.labelFr), id);
  for (const alias of definition.aliases) {
    ALLERGEN_ALIAS_INDEX.set(normalizeAlias(alias), id);
  }
}

export function isEuAllergenId(value: unknown): value is EuAllergenId {
  return typeof value === 'string' && ALLERGEN_ID_SET.has(value);
}

/** Normalize an explicit allergen declaration, never an ingredient name. */
export function normalizeEuAllergenId(value: string): EuAllergenId | undefined {
  return ALLERGEN_ALIAS_INDEX.get(normalizeAlias(value));
}
