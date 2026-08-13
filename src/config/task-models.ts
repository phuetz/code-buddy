/**
 * Per-task model configuration and persistence helpers.
 *
 * `[task_models]` is the generalized successor to `[model_pairs]`. The latter
 * remains a supported compatibility layer: `architect` maps to the
 * `architect` task and `editor` maps to `edit`. Explicit task mappings always
 * win, and an absent map is a strict no-op for the routing layer.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import {
  DEFAULT_CONFIG,
  getConfigManager,
  parseTOML,
  type CodeBuddyConfig,
  type ModelPairsConfig,
} from './toml-config.js';

export const TASK_MODEL_DEFINITIONS = [
  {
    type: 'architect',
    label: 'Architecture',
    description: 'Planning, design, trade-offs and deep reasoning.',
  },
  {
    type: 'edit',
    label: 'Editing',
    description: 'Implementation, refactoring, fixes and code changes.',
  },
  {
    type: 'review',
    label: 'Review',
    description: 'Code review, audits, critique and risk assessment.',
  },
  {
    type: 'research',
    label: 'Research',
    description: 'Source discovery, comparison and evidence gathering.',
  },
  {
    type: 'chat',
    label: 'Chat',
    description: 'General conversation and uncategorized requests.',
  },
] as const;

export type TaskType = (typeof TASK_MODEL_DEFINITIONS)[number]['type'];
export type TaskModelsConfig = Partial<Record<TaskType, string>>;

export interface TaskModelRoutingConfig {
  task_models?: TaskModelsConfig;
  model_pairs?: ModelPairsConfig;
}

export interface ActiveTaskModel {
  /** Model ID sent to the provider. */
  id: string;
  /** Key under `[models.<key>]` when one exists. */
  key: string;
  provider: string;
  label: string;
}

export interface TaskModelSettings {
  configPath: string;
  defaultModel: string;
  taskTypes: Array<(typeof TASK_MODEL_DEFINITIONS)[number]>;
  /** Explicit values from the new `[task_models]` section. */
  mappings: TaskModelsConfig;
  /** Compatibility values inherited from `[model_pairs]`. */
  legacyMappings: TaskModelsConfig;
  /** New values overlaid on the compatibility values. */
  effectiveMappings: TaskModelsConfig;
  models: ActiveTaskModel[];
}

const USER_CONFIG_FILE = join(homedir(), '.codebuddy', 'config.toml');
const SAFE_MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const TASK_TYPES = new Set<string>(TASK_MODEL_DEFINITIONS.map(({ type }) => type));

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && TASK_TYPES.has(value);
}

/** Keep only supported task keys with safe, non-empty model IDs. */
export function normalizeTaskModels(value: unknown): TaskModelsConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: TaskModelsConfig = {};
  for (const [taskType, model] of Object.entries(value as Record<string, unknown>)) {
    if (!isTaskType(taskType) || typeof model !== 'string') continue;
    const trimmed = model.trim();
    if (SAFE_MODEL_ID_RE.test(trimmed)) normalized[taskType] = trimmed;
  }
  return normalized;
}

/** Translate legacy pairs without mutating or rewriting the source config. */
export function legacyModelPairsToTaskModels(pairs: ModelPairsConfig | null | undefined): TaskModelsConfig {
  const mapped: TaskModelsConfig = {};
  if (typeof pairs?.architect === 'string' && SAFE_MODEL_ID_RE.test(pairs.architect.trim())) {
    mapped.architect = pairs.architect.trim();
  }
  if (typeof pairs?.editor === 'string' && SAFE_MODEL_ID_RE.test(pairs.editor.trim())) {
    mapped.edit = pairs.editor.trim();
  }
  return mapped;
}

export function getEffectiveTaskModels(config: TaskModelRoutingConfig | null | undefined): TaskModelsConfig {
  return {
    ...legacyModelPairsToTaskModels(config?.model_pairs),
    ...normalizeTaskModels(config?.task_models),
  };
}

export function resolveConfiguredTaskModel(
  config: TaskModelRoutingConfig | null | undefined,
  taskType: TaskType,
): string | null {
  return getEffectiveTaskModels(config)[taskType] ?? null;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Replace only `[task_models]`, preserving every unrelated TOML byte as far as
 * line boundaries allow. This avoids the intentionally partial global
 * serializer dropping profiles or advanced sections.
 */
export function replaceTaskModelsSection(content: string, mappings: TaskModelsConfig): string {
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const start = lines.findIndex((line) => /^\s*\[task_models\]\s*(?:#.*)?$/.test(line));
  let before = lines;
  let after: string[] = [];
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[end] ?? '')) {
      end += 1;
    }
    before = lines.slice(0, start);
    after = lines.slice(end);
    while (before.at(-1) === '') before.pop();
    while (after[0] === '') after.shift();
  } else {
    while (before.at(-1) === '') before.pop();
  }

  const block: string[] = [];
  const normalized = normalizeTaskModels(mappings);
  if (Object.keys(normalized).length > 0) {
    block.push('[task_models]');
    for (const { type } of TASK_MODEL_DEFINITIONS) {
      const model = normalized[type];
      if (model) block.push(`${type} = "${escapeTomlString(model)}"`);
    }
  }

  const output: string[] = [...before];
  if (block.length > 0) {
    if (output.length > 0) output.push('');
    output.push(...block);
  }
  if (after.length > 0) {
    if (output.length > 0) output.push('');
    output.push(...after);
  }
  return output.length > 0 ? `${output.join('\n')}\n` : '';
}

function mergeForSettings(raw: Partial<CodeBuddyConfig>): CodeBuddyConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    providers: { ...DEFAULT_CONFIG.providers, ...(raw.providers ?? {}) },
    models: { ...DEFAULT_CONFIG.models, ...(raw.models ?? {}) },
    tool_config: { ...DEFAULT_CONFIG.tool_config, ...(raw.tool_config ?? {}) },
    middleware: { ...DEFAULT_CONFIG.middleware, ...(raw.middleware ?? {}) },
    ui: { ...DEFAULT_CONFIG.ui, ...(raw.ui ?? {}) },
    agent: { ...DEFAULT_CONFIG.agent, ...(raw.agent ?? {}) },
    integrations: { ...DEFAULT_CONFIG.integrations, ...(raw.integrations ?? {}) },
  };
}

function activeModels(config: Readonly<CodeBuddyConfig>): ActiveTaskModel[] {
  const models: ActiveTaskModel[] = [];
  const seen = new Set<string>();
  for (const [key, model] of Object.entries(config.models)) {
    const provider = config.providers[model.provider];
    if (!provider || provider.enabled === false) continue;
    const id = model.model_id?.trim() || key;
    if (!SAFE_MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      key,
      provider: model.provider,
      label: model.description ? `${key} — ${model.description}` : key,
    });
  }

  const configuredDefault = config.models[config.active_model];
  const defaultId = configuredDefault?.model_id?.trim() || config.active_model;
  if (SAFE_MODEL_ID_RE.test(defaultId) && !seen.has(defaultId)) {
    models.unshift({
      id: defaultId,
      key: config.active_model,
      provider: configuredDefault?.provider ?? 'default',
      label: `${config.active_model} — current default`,
    });
  }
  return models.sort((left, right) => left.label.localeCompare(right.label));
}

function readRawConfig(configPath: string): Partial<CodeBuddyConfig> {
  if (!existsSync(configPath)) return {};
  return parseTOML(readFileSync(configPath, 'utf8')) as Partial<CodeBuddyConfig>;
}

export function readTaskModelSettings(configPath?: string): TaskModelSettings {
  const path = configPath?.trim() || USER_CONFIG_FILE;
  const raw = readRawConfig(path);
  const effective = configPath
    ? mergeForSettings(raw)
    : getConfigManager().reload();
  const mappings = normalizeTaskModels(raw.task_models);
  const legacyMappings = legacyModelPairsToTaskModels(effective.model_pairs);
  const effectiveMappings = getEffectiveTaskModels(effective);
  const defaultConfig = effective.models[effective.active_model];

  return {
    configPath: path,
    defaultModel: defaultConfig?.model_id?.trim() || effective.active_model,
    taskTypes: TASK_MODEL_DEFINITIONS.map((definition) => ({ ...definition })),
    mappings,
    legacyMappings,
    effectiveMappings,
    models: activeModels(effective),
  };
}

function validateSaveInput(
  value: unknown,
  choices: ActiveTaskModel[],
): { ok: true; mappings: TaskModelsConfig } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'task model mappings must be an object' };
  }

  const byChoice = new Map<string, string>();
  for (const choice of choices) {
    byChoice.set(choice.id, choice.id);
    byChoice.set(choice.key, choice.id);
  }

  const mappings: TaskModelsConfig = {};
  for (const [taskType, rawModel] of Object.entries(value as Record<string, unknown>)) {
    if (!isTaskType(taskType)) return { ok: false, error: `unsupported task type: ${taskType}` };
    if (rawModel === null || rawModel === undefined || rawModel === '') continue;
    if (typeof rawModel !== 'string' || !SAFE_MODEL_ID_RE.test(rawModel.trim())) {
      return { ok: false, error: `invalid model for task type: ${taskType}` };
    }
    const activeId = byChoice.get(rawModel.trim());
    if (!activeId) return { ok: false, error: `model is not active: ${rawModel.trim()}` };
    mappings[taskType] = activeId;
  }
  return { ok: true, mappings };
}

export function saveTaskModelSettings(value: unknown, configPath?: string): TaskModelSettings {
  const path = configPath?.trim() || USER_CONFIG_FILE;
  const current = readTaskModelSettings(configPath);
  const validated = validateSaveInput(value, current.models);
  if (!validated.ok) throw new Error(validated.error);

  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const updated = replaceTaskModelsSection(existing, validated.mappings);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporaryPath, updated, { mode: 0o600 });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup; preserve the original write error.
    }
    throw error;
  }

  if (!configPath) getConfigManager().reload();
  return readTaskModelSettings(configPath);
}
