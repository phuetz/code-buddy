import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  EU_ALLERGEN_CANON,
  EU_ALLERGEN_IDS,
  FOOD_PROFILE_SCHEMA_VERSION,
  FoodInventoryStore,
  FoodProfileStore,
  MEAL_PLAN_STATUSES,
  MEAL_SLOTS,
  MealPlanStore,
  evaluateRecipeCompatibility,
  normalizeEuAllergenId,
  normalizeMealLookupValue,
  normalizeRecipe,
  suggestMeals,
  type EvidenceStatus,
  type FoodConstraint,
  type FoodConstraintTarget,
  type FoodInventoryKind,
  type FoodInventoryItem,
  type FoodProfile,
  type MealPlanStatus,
  type MealSlot,
  type RecipeInput,
} from '../meals/index.js';

const FOOD_KINDS = [
  'preference',
  'avoidance',
  'intolerance',
  'allergy',
  'clinician',
  'temporary',
] as const;
type FoodKind = (typeof FOOD_KINDS)[number];

const TARGET_TYPES = ['ingredient', 'allergen', 'tag'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

export interface MaisonFoodCommandDeps {
  foodProfileStore?: FoodProfileStore;
  mealPlanStore?: MealPlanStore;
  foodInventoryStore?: FoodInventoryStore;
  now?: () => Date;
  timeZone?: string;
}

function currentTime(deps: MaisonFoodCommandDeps): Date {
  const value = deps.now?.() ?? new Date();
  if (Number.isNaN(value.getTime())) throw new Error('Maison food clock returned an invalid date');
  return new Date(value.getTime());
}

function store(deps: MaisonFoodCommandDeps): FoodProfileStore {
  return deps.foodProfileStore ?? new FoodProfileStore();
}

function planStore(deps: MaisonFoodCommandDeps): MealPlanStore {
  return deps.mealPlanStore ?? new MealPlanStore();
}

function inventoryStore(deps: MaisonFoodCommandDeps): FoodInventoryStore {
  return deps.foodInventoryStore ?? new FoodInventoryStore();
}

function householdTimeZone(deps: MaisonFoodCommandDeps): string {
  return deps.timeZone
    || process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function userProvenance(
  deps: MaisonFoodCommandDeps,
  source: string,
  status: EvidenceStatus = 'confirmed'
) {
  return {
    source: 'user' as const,
    sourceId: `buddy-maison:${source}:${randomUUID()}`,
    recordedAt: currentTime(deps).toISOString(),
    status,
  };
}

function parseMealSlot(value: string): MealSlot {
  if (!(MEAL_SLOTS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`slot must be one of: ${MEAL_SLOTS.join(', ')}`);
  }
  return value as MealSlot;
}

function parseMealPlanStatus(value: string): MealPlanStatus {
  if (!(MEAL_PLAN_STATUSES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`status must be one of: ${MEAL_PLAN_STATUSES.join(', ')}`);
  }
  return value as MealPlanStatus;
}

function parseEvidenceStatus(value: string): EvidenceStatus {
  if (value !== 'confirmed' && value !== 'unknown') {
    throw new InvalidArgumentError('status must be one of: confirmed, unknown');
  }
  return value;
}

function parseInventoryKind(value: string): FoodInventoryKind {
  if (value !== 'pantry' && value !== 'leftover') {
    throw new InvalidArgumentError('kind must be one of: pantry, leftover');
  }
  return value;
}

function parsePositiveQuantity(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('quantity must be a positive finite number');
  }
  return parsed;
}

function emptyProfile(now: Date): FoodProfile {
  const timestamp = now.toISOString();
  return {
    schemaVersion: FOOD_PROFILE_SCHEMA_VERSION,
    id: 'primary',
    createdAt: timestamp,
    updatedAt: timestamp,
    constraints: [],
  };
}

async function loadProfile(
  deps: MaisonFoodCommandDeps,
  create = false
): Promise<FoodProfile | null> {
  const profile = await store(deps).load();
  return profile ?? (create ? emptyProfile(currentTime(deps)) : null);
}

function parseKind(value: string): FoodKind {
  if (!(FOOD_KINDS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`kind must be one of: ${FOOD_KINDS.join(', ')}`);
  }
  return value as FoodKind;
}

function parseTargetType(value: string): TargetType {
  if (!(TARGET_TYPES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`target type must be one of: ${TARGET_TYPES.join(', ')}`);
  }
  return value as TargetType;
}

function normalizeTarget(type: TargetType, value: string): FoodConstraintTarget {
  if (type === 'allergen') {
    const allergen = normalizeEuAllergenId(value);
    if (!allergen) {
      throw new InvalidArgumentError(
        `unknown EU allergen '${value}'. Run 'buddy maison food allergens'.`
      );
    }
    return { type, value: allergen };
  }
  const normalized = normalizeMealLookupValue(value);
  if (!normalized) throw new InvalidArgumentError('constraint target must not be empty');
  return { type, value: normalized };
}

function buildConstraint(input: {
  kind: FoodKind;
  target: FoodConstraintTarget;
  now: Date;
  confirmed: boolean;
  dislike: boolean;
  until?: string;
  note?: string;
}): FoodConstraint {
  const hardHealthRule = ['allergy', 'intolerance', 'clinician'].includes(input.kind);
  const status: EvidenceStatus = hardHealthRule && !input.confirmed ? 'unknown' : 'confirmed';
  const provenance = {
    // CLI entry is always user-reported. Selecting `clinician` describes the
    // rule's kind; it is not cryptographic proof that a clinician supplied it.
    source: 'user' as const,
    sourceId: `buddy-maison-food:${randomUUID()}`,
    recordedAt: input.now.toISOString(),
    status,
  };
  const common = {
    id: `food-${randomUUID()}`,
    status,
    target: input.target,
    provenance,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  if (input.kind === 'preference') {
    return { ...common, kind: 'preference', effect: input.dislike ? 'dislike' : 'prefer' };
  }
  if (input.kind === 'temporary') {
    if (!input.until || !Number.isFinite(Date.parse(input.until))) {
      throw new InvalidArgumentError('temporary constraints require --until <ISO timestamp>');
    }
    if (Date.parse(input.until) <= input.now.getTime()) {
      throw new InvalidArgumentError('--until must be in the future');
    }
    return { ...common, kind: 'temporary', effect: 'exclude', expiresAt: new Date(input.until).toISOString() };
  }
  return { ...common, kind: input.kind, effect: 'exclude' };
}

function profileSummary(profile: FoodProfile): Record<string, unknown> {
  const byKind = Object.fromEntries(FOOD_KINDS.map((kind) => [
    kind,
    profile.constraints.filter((constraint) => constraint.kind === kind).length,
  ]));
  return {
    configured: true,
    profileId: profile.id,
    updatedAt: profile.updatedAt,
    constraintCount: profile.constraints.length,
    confirmedCount: profile.constraints.filter((constraint) => constraint.status === 'confirmed').length,
    unknownCount: profile.constraints.filter((constraint) => constraint.status === 'unknown').length,
    byKind,
  };
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  } catch (error) {
    throw new InvalidArgumentError(
      `unable to read JSON file '${path}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function registerMaisonFoodCommands(
  parent: Command,
  deps: MaisonFoodCommandDeps = {}
): void {
  const food = parent
    .command('food')
    .description('Private food constraints, deterministic recipe checks, plans and inventory');

  food
    .command('status', { isDefault: true })
    .option('--json', 'Print structured JSON')
    .option('--reveal', 'Explicitly reveal constraint targets on this local terminal')
    .action(async (options: { json?: boolean; reveal?: boolean }) => {
      const profile = await loadProfile(deps);
      const output = profile
        ? {
            ...profileSummary(profile),
            ...(options.reveal ? { constraints: profile.constraints } : {}),
          }
        : { configured: false, constraintCount: 0 };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else if (!profile) console.log('Profil alimentaire non configuré (aucune donnée médicale inférée).');
      else console.log(
        `Profil alimentaire chiffré · ${profile.constraints.length} contrainte(s) · `
        + `${profile.constraints.filter((constraint) => constraint.status === 'unknown').length} à confirmer.`
      );
    });

  food
    .command('allergens')
    .description('List the canonical 14 EU allergen categories')
    .option('--json', 'Print structured JSON')
    .action((options: { json?: boolean }) => {
      const values = EU_ALLERGEN_IDS.map((id) => EU_ALLERGEN_CANON[id]);
      if (options.json) console.log(JSON.stringify(values, null, 2));
      else values.forEach((value) => console.log(`${value.id} · ${value.labelFr}`));
    });

  food
    .command('add')
    .description('Record an explicit food constraint; never infer one from a recipe')
    .argument('<kind>', FOOD_KINDS.join('|'), parseKind)
    .argument('<target-type>', TARGET_TYPES.join('|'), parseTargetType)
    .argument('<value>', 'Explicit ingredient, tag, or allergen declaration')
    .option('--confirm', 'Confirm a health-adjacent rule explicitly')
    .option('--dislike', 'For preference: record a dislike instead of a preference')
    .option('--until <timestamp>', 'Required expiry for a temporary exclusion')
    .option('--note <text>', 'Optional local private note')
    .option('--json', 'Print structured JSON')
    .option('--reveal', 'Reveal the private target in JSON output on this local terminal')
    .action(async (
      kind: FoodKind,
      targetType: TargetType,
      value: string,
      options: { confirm?: boolean; dislike?: boolean; until?: string; note?: string; json?: boolean; reveal?: boolean }
    ) => {
      if (options.dislike && kind !== 'preference') {
        throw new InvalidArgumentError('--dislike only applies to preference constraints');
      }
      const now = currentTime(deps);
      const profile = (await loadProfile(deps, true))!;
      const constraint = buildConstraint({
        kind,
        target: normalizeTarget(targetType, value),
        now,
        confirmed: options.confirm === true,
        dislike: options.dislike === true,
        ...(options.until ? { until: options.until } : {}),
        ...(options.note ? { note: options.note } : {}),
      });
      profile.constraints.push(constraint);
      profile.updatedAt = now.toISOString();
      await store(deps).save(profile);
      if (options.json) console.log(JSON.stringify(
        options.reveal
          ? constraint
          : {
              id: constraint.id,
              kind: constraint.kind,
              status: constraint.status,
              targetType: constraint.target.type,
            },
        null,
        2
      ));
      else console.log(
        `Contrainte chiffrée ajoutée · ${constraint.id} · ${constraint.kind} · ${constraint.status}`
        + (constraint.status === 'unknown' ? ' (à confirmer avant usage strict)' : '')
      );
    });

  food
    .command('remove')
    .argument('<id>', 'Constraint id')
    .action(async (id: string) => {
      const profile = await loadProfile(deps);
      if (!profile) throw new Error('No encrypted food profile exists.');
      const before = profile.constraints.length;
      profile.constraints = profile.constraints.filter((constraint) => constraint.id !== id);
      if (profile.constraints.length === before) throw new Error(`Unknown food constraint: ${id}`);
      profile.updatedAt = currentTime(deps).toISOString();
      await store(deps).save(profile);
      console.log(`Contrainte supprimée : ${id}`);
    });

  food
    .command('verify')
    .description('Normalize and verify one recipe JSON against confirmed local constraints')
    .argument('<recipe-json>', 'Path to a RecipeInput JSON file')
    .option('--json', 'Print structured JSON')
    .action(async (recipePath: string, options: { json?: boolean }) => {
      const profile = await loadProfile(deps);
      if (!profile) throw new Error('Configure explicit food constraints before recipe verification.');
      const recipe = normalizeRecipe(await readJsonFile(recipePath) as RecipeInput);
      const verdict = evaluateRecipeCompatibility(profile, recipe, currentTime(deps));
      if (options.json) console.log(JSON.stringify({ recipe: recipe.title, verdict }, null, 2));
      else console.log(
        `${verdict.status === 'compatible' ? '✓' : verdict.status === 'incompatible' ? '✗' : '?'} `
        + `${recipe.title} · ${verdict.status}${verdict.blocking ? ' · bloqué' : ''}`
      );
    });

  food
    .command('suggest')
    .description('Rank recipe JSON candidates; only explicit compatible results are emitted')
    .argument('<recipes-json>', 'Path to an array of RecipeInput objects')
    .option('--inventory <json>', 'Override the active private Maison inventory with a JSON array')
    .option('--limit <n>', 'Maximum suggestions', (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new InvalidArgumentError('--limit must be an integer between 1 and 100');
      }
      return parsed;
    }, 5)
    .option('--json', 'Print structured JSON')
    .action(async (
      recipesPath: string,
      options: { inventory?: string; limit: number; json?: boolean }
    ) => {
      const profile = await loadProfile(deps);
      if (!profile) throw new Error('Configure explicit food constraints before requesting suggestions.');
      const candidates = await readJsonFile(recipesPath);
      if (!Array.isArray(candidates)) throw new InvalidArgumentError('recipes JSON must be an array');
      const now = currentTime(deps);
      const inventory = options.inventory
        ? await readJsonFile(options.inventory)
        : await inventoryStore(deps).listActive(now);
      if (!Array.isArray(inventory)) throw new InvalidArgumentError('inventory JSON must be an array');
      const result = suggestMeals({
        profile,
        candidates: candidates as RecipeInput[],
        inventory: inventory as FoodInventoryItem[],
        limit: options.limit,
        now,
      });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        if (result.suggestions.length === 0) console.log('Aucune recette explicitement compatible.');
        result.suggestions.forEach((suggestion, index) => console.log(
          `${index + 1}. ${suggestion.recipe.title} · score ${suggestion.score} · `
          + `${suggestion.missingIngredientIds.length} ingrédient(s) manquant(s)`
        ));
        if (result.rejected.length > 0) console.log(`${result.rejected.length} recette(s) écartée(s) par les garde-fous.`);
      }
    });

  const plan = food
    .command('plan')
    .description('Private meal plan with explicit local dates, times and IANA timezones');

  plan
    .command('list', { isDefault: true })
    .description('List meal plan entries')
    .option('--date <yyyy-mm-dd>', 'Filter by explicit local date')
    .option('--slot <slot>', MEAL_SLOTS.join('|'), parseMealSlot)
    .option('--status <status>', MEAL_PLAN_STATUSES.join('|'), parseMealPlanStatus)
    .option('--json', 'Print structured JSON')
    .action(async (options: {
      date?: string;
      slot?: MealSlot;
      status?: MealPlanStatus;
      json?: boolean;
    }) => {
      const entries = await planStore(deps).list({
        ...(options.date ? { localDate: options.date } : {}),
        ...(options.slot ? { slot: options.slot } : {}),
        ...(options.status ? { status: options.status } : {}),
      });
      if (options.json) console.log(JSON.stringify(entries, null, 2));
      else if (entries.length === 0) console.log('Aucun repas planifié.');
      else entries.forEach((entry) => console.log(
        `${entry.localDate} ${entry.localTime} · ${entry.slot} · ${entry.recipeTitle} · `
        + `${entry.status} · ${entry.timeZone} · ${entry.id}`
      ));
    });

  plan
    .command('next')
    .description('Show the next suggested or planned meal as an absolute instant')
    .option('--json', 'Print structured JSON')
    .action(async (options: { json?: boolean }) => {
      const upcoming = await planStore(deps).nextUpcoming(currentTime(deps));
      if (options.json) console.log(JSON.stringify(upcoming, null, 2));
      else if (!upcoming) console.log('Aucun prochain repas planifié.');
      else console.log(
        `${upcoming.entry.recipeTitle} · ${upcoming.entry.slot} · ${upcoming.scheduledAt} · `
        + `${upcoming.entry.timeZone}${upcoming.adjustment === 'gap-forward' ? ' · heure ajustée DST' : ''}`
      );
    });

  plan
    .command('add')
    .description('Add a meal using a caller-supplied civil date and wall time')
    .argument('<date>', 'Local date in YYYY-MM-DD form')
    .argument('<time>', 'Local wall time in HH:mm form')
    .argument('<slot>', MEAL_SLOTS.join('|'), parseMealSlot)
    .argument('<recipe-id>', 'Stable recipe identifier')
    .argument('<title>', 'Recipe title')
    .option('--status <status>', MEAL_PLAN_STATUSES.join('|'), parseMealPlanStatus)
    .option('--timezone <iana>', 'Explicit IANA timezone; defaults to the configured Maison timezone')
    .option('--json', 'Print structured JSON')
    .action(async (
      date: string,
      time: string,
      slot: MealSlot,
      recipeId: string,
      title: string,
      options: { status?: MealPlanStatus; timezone?: string; json?: boolean }
    ) => {
      const entry = await planStore(deps).create({
        localDate: date,
        localTime: time,
        slot,
        recipeId,
        recipeTitle: title,
        ...(options.status ? { status: options.status } : {}),
        timeZone: options.timezone ?? householdTimeZone(deps),
        provenance: userProvenance(deps, 'food-plan-add'),
      });
      console.log(options.json
        ? JSON.stringify(entry, null, 2)
        : `Repas ajouté · ${entry.localDate} ${entry.localTime} · ${entry.recipeTitle} · ${entry.id}`);
    });

  plan
    .command('status')
    .description('Set the explicit lifecycle status of one planned meal')
    .argument('<id>', 'Meal plan entry id')
    .argument('<status>', MEAL_PLAN_STATUSES.join('|'), parseMealPlanStatus)
    .option('--json', 'Print structured JSON')
    .action(async (id: string, status: MealPlanStatus, options: { json?: boolean }) => {
      const entry = await planStore(deps).update(id, {
        status,
        provenance: userProvenance(deps, 'food-plan-status'),
      });
      if (!entry) throw new Error(`Unknown meal plan entry: ${id}`);
      console.log(options.json
        ? JSON.stringify(entry, null, 2)
        : `Repas ${entry.id} · ${entry.status}`);
    });

  plan
    .command('remove')
    .description('Remove one meal plan entry')
    .argument('<id>', 'Meal plan entry id')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const removed = await planStore(deps).remove(id);
      if (!removed) throw new Error(`Unknown meal plan entry: ${id}`);
      console.log(options.json
        ? JSON.stringify(removed, null, 2)
        : `Repas supprimé : ${removed.id}`);
    });

  const inventory = food
    .command('inventory')
    .description('Private pantry and leftovers with explicit evidence and expiration');

  inventory
    .command('list', { isDefault: true })
    .description('List inventory items, optionally filtering to active items')
    .option('--active', 'Exclude items whose explicit availableUntil has passed')
    .option('--kind <kind>', 'pantry|leftover', parseInventoryKind)
    .option('--status <status>', 'confirmed|unknown', parseEvidenceStatus)
    .option('--json', 'Print structured JSON')
    .action(async (options: {
      active?: boolean;
      kind?: FoodInventoryKind;
      status?: EvidenceStatus;
      json?: boolean;
    }) => {
      const filter = {
        ...(options.kind ? { kind: options.kind } : {}),
        ...(options.status ? { status: options.status } : {}),
      };
      const items = options.active
        ? await inventoryStore(deps).listActive(currentTime(deps), filter)
        : await inventoryStore(deps).list(filter);
      if (options.json) console.log(JSON.stringify(items, null, 2));
      else if (items.length === 0) console.log('Inventaire alimentaire vide.');
      else items.forEach((item) => console.log(
        `${item.kind === 'leftover' ? 'reste' : 'placard'} · ${item.name} · ${item.status}`
        + `${item.quantity !== undefined ? ` · ${item.quantity} ${item.unit}` : ''}`
        + `${item.availableUntil ? ` · jusqu’au ${item.availableUntil}` : ''} · ${item.id}`
      ));
    });

  inventory
    .command('add')
    .description('Record an explicit pantry or leftover fact; no allergen is inferred')
    .argument('<kind>', 'pantry|leftover', parseInventoryKind)
    .argument('<name>', 'Food name reported by the user')
    .option('--status <status>', 'confirmed|unknown', parseEvidenceStatus)
    .option('--quantity <number>', 'Optional positive quantity', parsePositiveQuantity)
    .option('--unit <unit>', 'Required with --quantity')
    .option('--until <timestamp>', 'Optional absolute availableUntil with Z or UTC offset')
    .option('--json', 'Print structured JSON')
    .action(async (
      kind: FoodInventoryKind,
      name: string,
      options: {
        status?: EvidenceStatus;
        quantity?: number;
        unit?: string;
        until?: string;
        json?: boolean;
      }
    ) => {
      if ((options.quantity === undefined) !== (options.unit === undefined)) {
        throw new InvalidArgumentError('--quantity and --unit must be supplied together');
      }
      const status = options.status ?? 'confirmed';
      const item = await inventoryStore(deps).create({
        name,
        kind,
        status,
        provenance: userProvenance(deps, `food-inventory-${kind}`, status),
        ...(options.quantity !== undefined ? { quantity: options.quantity } : {}),
        ...(options.unit !== undefined ? { unit: options.unit } : {}),
        ...(options.until !== undefined ? { availableUntil: options.until } : {}),
      });
      console.log(options.json
        ? JSON.stringify(item, null, 2)
        : `${item.kind === 'leftover' ? 'Reste' : 'Produit'} ajouté · ${item.name} · ${item.id}`);
    });

  inventory
    .command('remove')
    .description('Remove one inventory item')
    .argument('<id>', 'Inventory item id')
    .option('--json', 'Print structured JSON')
    .action(async (id: string, options: { json?: boolean }) => {
      const removed = await inventoryStore(deps).remove(id);
      if (!removed) throw new Error(`Unknown food inventory item: ${id}`);
      console.log(options.json
        ? JSON.stringify(removed, null, 2)
        : `Article supprimé : ${removed.id}`);
    });
}
