import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const COMFYUI_RECIPE_SCHEMA_VERSION = 1 as const;
export const MAX_COMFYUI_RECIPE_BYTES = 1024 * 1024;
export const MAX_COMFYUI_WORKFLOW_NODES = 512;

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_NODE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_NODE_CLASS = /^[A-Za-z0-9_.:-]{1,160}$/;
const SAFE_INPUT_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PLACEHOLDER = /\{\{([^{}]{1,160})\}\}/g;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type ComfyUIModality = 'text' | 'image' | 'mask' | 'audio' | 'video' | '3d';
export type ComfyUIOutputType = 'image' | 'video' | 'audio' | 'glb';
export type ComfyUIResourceTier = 'low' | 'balanced' | 'high' | 'extreme';

const identifierSchema = z.string().min(1).max(128).regex(SAFE_ID);
const nodeIdSchema = z.string().regex(SAFE_NODE_ID);
const nodeClassSchema = z.string().regex(SAFE_NODE_CLASS);
const inputNameSchema = z.string().regex(SAFE_INPUT_NAME);
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const bindingTargetSchema = z.object({
  nodeId: nodeIdSchema,
  input: inputNameSchema,
}).strict();

const assetBindingSchema = bindingTargetSchema.extend({
  required: z.boolean().default(true),
}).strict();

const imageBindingSchema = assetBindingSchema.extend({
  id: identifierSchema,
}).strict();

const dimensionsBindingSchema = z.object({
  width: bindingTargetSchema,
  height: bindingTargetSchema,
  default: z.object({
    width: z.number().int().min(16).max(16_384),
    height: z.number().int().min(16).max(16_384),
  }).strict(),
  min: z.number().int().min(16).max(16_384).default(64),
  max: z.number().int().min(16).max(16_384).default(8192),
  multipleOf: z.number().int().min(1).max(1024).default(8),
}).strict().superRefine((value, context) => {
  if (value.min > value.max) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'dimensions.min must not exceed dimensions.max' });
  }
  for (const [name, dimension] of Object.entries(value.default)) {
    if (dimension < value.min || dimension > value.max || dimension % value.multipleOf !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `dimensions.default.${name} is outside the declared bounds`,
      });
    }
  }
});

const seedBindingSchema = bindingTargetSchema.extend({
  default: nonNegativeSafeInteger.optional(),
}).strict();

const workflowNodeSchema = z.object({
  class_type: nodeClassSchema,
  inputs: z.record(z.unknown()),
  _meta: z.record(z.unknown()).optional(),
}).strict();

const outputFieldSchema = z.enum(['images', 'videos', 'audio', 'gifs', 'files', 'glbs']);

export const comfyUIRecipeSchema = z.object({
  schemaVersion: z.literal(COMFYUI_RECIPE_SCHEMA_VERSION),
  id: identifierSchema,
  version: z.string().max(80).regex(SEMVER),
  title: z.string().min(1).max(160),
  modalities: z.array(z.enum(['text', 'image', 'mask', 'audio', 'video', '3d']))
    .min(1)
    .max(8),
  license: z.object({
    spdx: z.string().min(1).max(80).regex(/^[A-Za-z0-9.+()-]+$/),
    name: z.string().min(1).max(160).optional(),
    url: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:', {
      message: 'license.url must use HTTPS',
    }).optional(),
  }).strict(),
  commercialAllowed: z.boolean(),
  workflow: z.object({
    format: z.literal('comfyui-api'),
    nodes: z.record(workflowNodeSchema),
  }).strict(),
  requirements: z.object({
    nodes: z.array(z.object({ classType: nodeClassSchema }).strict()).max(MAX_COMFYUI_WORKFLOW_NODES),
    models: z.array(z.object({
      id: identifierSchema,
      relativePath: z.string().min(1).max(1024),
      minBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      sha256: z.string().regex(SAFE_SHA256).optional(),
    }).strict()).max(128),
  }).strict(),
  bindings: z.object({
    prompt: bindingTargetSchema,
    negativePrompt: bindingTargetSchema.optional(),
    seed: seedBindingSchema.optional(),
    dimensions: dimensionsBindingSchema.optional(),
    images: z.array(imageBindingSchema).max(32).default([]),
    mask: assetBindingSchema.optional(),
    audio: assetBindingSchema.optional(),
  }).strict(),
  outputs: z.array(z.object({
    id: identifierSchema,
    type: z.enum(['image', 'video', 'audio', 'glb']),
    nodeId: nodeIdSchema,
    field: outputFieldSchema,
    required: z.boolean().default(true),
    maxItems: z.number().int().min(1).max(64).default(8),
    maxBytes: z.number().int().min(1).max(2 * 1024 * 1024 * 1024).optional(),
  }).strict()).min(1).max(32),
  resources: z.object({
    tier: z.enum(['low', 'balanced', 'high', 'extreme']),
    minVramMiB: z.number().int().nonnegative().max(1024 * 1024),
    minRamMiB: z.number().int().nonnegative().max(1024 * 1024),
    estimatedSeconds: z.number().int().positive().max(7 * 24 * 60 * 60).optional(),
    maxConcurrency: z.number().int().min(1).max(64).default(1),
  }).strict(),
  fallback: z.array(z.object({
    id: identifierSchema,
    version: z.string().max(80).regex(SEMVER).optional(),
    reason: z.string().min(1).max(240).optional(),
  }).strict()).max(8).default([]),
}).strict();

export type ComfyUIRecipe = z.infer<typeof comfyUIRecipeSchema>;
export type ComfyUIWorkflowNode = z.infer<typeof workflowNodeSchema>;
export type ComfyUIBindingTarget = z.infer<typeof bindingTargetSchema>;

export interface ComfyUIRecipeSelector {
  id: string;
  version?: string;
}

export interface ComfyUIRecipeRunInputs {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  dimensions?: { width: number; height: number };
  images?: Record<string, string>;
  mask?: string;
  audio?: string;
}

export interface MaterializedComfyUIWorkflow {
  workflow: Record<string, ComfyUIWorkflowNode>;
  seed?: number;
  dimensions?: { width: number; height: number };
}

export class ComfyUIRecipeValidationError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'ComfyUIRecipeValidationError';
    this.issues = issues;
  }
}

interface BindingExpectation {
  label: string;
  placeholder: string;
  target: ComfyUIBindingTarget;
}

/** Validate and clone an untrusted declarative recipe. */
export function validateComfyUIRecipe(value: unknown): ComfyUIRecipe {
  validateBoundedJson(value, 'ComfyUI recipe');
  const byteLength = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (byteLength > MAX_COMFYUI_RECIPE_BYTES) {
    throw new ComfyUIRecipeValidationError(`ComfyUI recipe exceeds ${MAX_COMFYUI_RECIPE_BYTES} bytes`);
  }

  const parsed = comfyUIRecipeSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
    throw new ComfyUIRecipeValidationError(`Invalid ComfyUI recipe contract: ${issues.join('; ')}`, issues);
  }

  const recipe = parsed.data;
  const issues: string[] = [];
  validateUniqueStrings(recipe.modalities, 'modalities', issues);
  validateRecipePaths(recipe, issues);
  validateWorkflow(recipe, issues);
  validateFallbacks(recipe, issues);
  if (hasForbiddenControlCharacter(recipe.title)) issues.push('title contains a control character');

  if (issues.length > 0) {
    throw new ComfyUIRecipeValidationError(`Invalid ComfyUI recipe semantics: ${issues.join('; ')}`, issues);
  }
  return cloneJson(recipe);
}

/** Replace only exact, contract-declared placeholders with typed input values. */
export function materializeComfyUIWorkflow(
  recipe: ComfyUIRecipe,
  inputs: ComfyUIRecipeRunInputs,
  seedFactory: () => number = secureSeed,
): MaterializedComfyUIWorkflow {
  if (!isPlainRecord(inputs)) {
    throw new ComfyUIRecipeValidationError('Recipe inputs must be an object');
  }
  const allowedInputKeys = new Set([
    'prompt',
    'negativePrompt',
    'seed',
    'dimensions',
    'images',
    'mask',
    'audio',
  ]);
  const unknownInput = Object.keys(inputs).find((key) => !allowedInputKeys.has(key));
  if (unknownInput) {
    throw new ComfyUIRecipeValidationError(`Unknown recipe input: ${unknownInput}`);
  }
  validatePrompt(inputs.prompt, 'prompt', false);
  if (inputs.negativePrompt !== undefined) validatePrompt(inputs.negativePrompt, 'negativePrompt', true);

  const nodes = cloneJson(recipe.workflow.nodes);
  setBinding(nodes, recipe.bindings.prompt, inputs.prompt);

  if (recipe.bindings.negativePrompt) {
    setBinding(nodes, recipe.bindings.negativePrompt, inputs.negativePrompt ?? '');
  } else if (inputs.negativePrompt !== undefined) {
    throw new ComfyUIRecipeValidationError('This recipe does not declare a negative-prompt binding');
  }

  let seed: number | undefined;
  if (recipe.bindings.seed) {
    seed = inputs.seed ?? recipe.bindings.seed.default ?? seedFactory();
    assertSafeSeed(seed);
    setBinding(nodes, recipe.bindings.seed, seed);
  } else if (inputs.seed !== undefined) {
    throw new ComfyUIRecipeValidationError('This recipe does not declare a seed binding');
  }

  let dimensions: { width: number; height: number } | undefined;
  if (recipe.bindings.dimensions) {
    dimensions = inputs.dimensions ?? recipe.bindings.dimensions.default;
    validateDimensions(dimensions, recipe.bindings.dimensions);
    setBinding(nodes, recipe.bindings.dimensions.width, dimensions.width);
    setBinding(nodes, recipe.bindings.dimensions.height, dimensions.height);
  } else if (inputs.dimensions !== undefined) {
    throw new ComfyUIRecipeValidationError('This recipe does not declare dimension bindings');
  }

  const suppliedImages = inputs.images ?? {};
  validateAssetMap(suppliedImages);
  const declaredImageIds = new Set(recipe.bindings.images.map((binding) => binding.id));
  for (const suppliedId of Object.keys(suppliedImages)) {
    if (!declaredImageIds.has(suppliedId)) {
      throw new ComfyUIRecipeValidationError(`Unknown recipe image binding: ${suppliedId}`);
    }
  }
  for (const binding of recipe.bindings.images) {
    const asset = suppliedImages[binding.id];
    if (asset === undefined && binding.required) {
      throw new ComfyUIRecipeValidationError(`Missing required recipe image: ${binding.id}`);
    }
    setBinding(nodes, binding, asset ?? '');
  }

  applyOptionalAsset(nodes, 'mask', recipe.bindings.mask, inputs.mask);
  applyOptionalAsset(nodes, 'audio', recipe.bindings.audio, inputs.audio);
  assertNoPlaceholders(nodes);

  return {
    workflow: nodes,
    ...(seed === undefined ? {} : { seed }),
    ...(dimensions === undefined ? {} : { dimensions: { ...dimensions } }),
  };
}

export function isSafeComfyUIRelativePath(value: string): boolean {
  if (!value || value.length > 1024 || value.includes('\\') || hasForbiddenControlCharacter(value)) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false;
  const segments = value.split('/');
  return segments.every((segment) => {
    if (!segment || segment === '.' || segment === '..' || DANGEROUS_KEYS.has(segment)) return false;
    return segment.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._ +()@-]*$/.test(segment);
  });
}

export function isSafeComfyUIAssetReference(value: string): boolean {
  return value.length <= 512 && isSafeComfyUIRelativePath(value);
}

function validateRecipePaths(recipe: ComfyUIRecipe, issues: string[]): void {
  const modelIds = new Set<string>();
  const modelPaths = new Set<string>();
  for (const model of recipe.requirements.models) {
    if (!isSafeComfyUIRelativePath(model.relativePath)) {
      issues.push(`model ${model.id} has an unsafe relativePath`);
    }
    if (modelIds.has(model.id)) issues.push(`duplicate model id: ${model.id}`);
    if (modelPaths.has(model.relativePath)) issues.push(`duplicate model relativePath: ${model.relativePath}`);
    modelIds.add(model.id);
    modelPaths.add(model.relativePath);
  }
}

function validateWorkflow(recipe: ComfyUIRecipe, issues: string[]): void {
  const nodes = recipe.workflow.nodes;
  const nodeIds = Object.keys(nodes);
  if (nodeIds.length === 0) issues.push('workflow.nodes must contain at least one node');
  if (nodeIds.length > MAX_COMFYUI_WORKFLOW_NODES) {
    issues.push(`workflow.nodes exceeds ${MAX_COMFYUI_WORKFLOW_NODES} nodes`);
  }
  for (const nodeId of nodeIds) {
    if (!SAFE_NODE_ID.test(nodeId) || DANGEROUS_KEYS.has(nodeId)) issues.push(`unsafe workflow node id: ${nodeId}`);
  }

  const requiredClasses = recipe.requirements.nodes.map((requirement) => requirement.classType);
  validateUniqueStrings(requiredClasses, 'requirements.nodes.classType', issues);
  const actualClasses = new Set(Object.values(nodes).map((node) => node.class_type));
  const declaredClasses = new Set(requiredClasses);
  for (const classType of actualClasses) {
    if (!declaredClasses.has(classType)) issues.push(`workflow node class is undeclared: ${classType}`);
  }
  for (const classType of declaredClasses) {
    if (!actualClasses.has(classType)) issues.push(`required node class is unused: ${classType}`);
  }

  for (const [nodeId, node] of Object.entries(nodes)) {
    collectNodeReferences(node.inputs, (dependencyId, outputIndex) => {
      if (!Object.prototype.hasOwnProperty.call(nodes, dependencyId)) {
        issues.push(`node ${nodeId} references missing node ${dependencyId}`);
      }
      if (outputIndex > 255) issues.push(`node ${nodeId} references an invalid output index`);
    });
  }

  const expectations = bindingExpectations(recipe);
  const targetKeys = new Set<string>();
  const placeholderCounts = new Map<string, number>();
  for (const expectation of expectations) {
    const key = targetKey(expectation.target);
    if (targetKeys.has(key)) issues.push(`multiple bindings target ${expectation.target.nodeId}.${expectation.target.input}`);
    targetKeys.add(key);
    const node = nodes[expectation.target.nodeId];
    if (!node) {
      issues.push(`${expectation.label} targets missing node ${expectation.target.nodeId}`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(node.inputs, expectation.target.input)) {
      issues.push(`${expectation.label} targets missing input ${expectation.target.input}`);
      continue;
    }
    if (node.inputs[expectation.target.input] !== expectation.placeholder) {
      issues.push(`${expectation.label} target must contain the exact placeholder ${expectation.placeholder}`);
    }
  }

  scanPlaceholders(nodes, (placeholder, embedded) => {
    placeholderCounts.set(placeholder, (placeholderCounts.get(placeholder) ?? 0) + 1);
    if (embedded) issues.push(`placeholder ${placeholder} must occupy the complete input value`);
  }, issues);
  const expectedPlaceholders = new Set(expectations.map((expectation) => expectation.placeholder));
  for (const placeholder of placeholderCounts.keys()) {
    if (!expectedPlaceholders.has(placeholder)) issues.push(`undeclared workflow placeholder: ${placeholder}`);
  }
  for (const placeholder of expectedPlaceholders) {
    if (placeholderCounts.get(placeholder) !== 1) {
      issues.push(`workflow placeholder must occur exactly once: ${placeholder}`);
    }
  }

  const outputIds = recipe.outputs.map((output) => output.id);
  validateUniqueStrings(outputIds, 'outputs.id', issues);
  for (const output of recipe.outputs) {
    if (!nodes[output.nodeId]) issues.push(`output ${output.id} references missing node ${output.nodeId}`);
    const compatibleFields: Record<ComfyUIOutputType, readonly string[]> = {
      image: ['images', 'files'],
      video: ['videos', 'gifs', 'files'],
      audio: ['audio', 'files'],
      glb: ['glbs', 'files'],
    };
    if (!compatibleFields[output.type].includes(output.field)) {
      issues.push(`output ${output.id} field ${output.field} is incompatible with ${output.type}`);
    }
  }

  const imageIds = recipe.bindings.images.map((binding) => binding.id);
  validateUniqueStrings(imageIds, 'bindings.images.id', issues);
  const reachable = collectNodesReachableFromOutputs(nodes, recipe.outputs.map((output) => output.nodeId));
  for (const expectation of expectations) {
    if (!reachable.has(expectation.target.nodeId)) {
      issues.push(`${expectation.label} is not connected to a declared output`);
    }
  }
}

function validateFallbacks(recipe: ComfyUIRecipe, issues: string[]): void {
  const selectors = new Set<string>();
  for (const fallback of recipe.fallback) {
    if (fallback.id === recipe.id && (!fallback.version || fallback.version === recipe.version)) {
      issues.push('a recipe cannot fall back to itself');
    }
    const key = `${fallback.id}@${fallback.version ?? '*'}`;
    if (selectors.has(key)) issues.push(`duplicate fallback: ${key}`);
    selectors.add(key);
  }
}

function bindingExpectations(recipe: ComfyUIRecipe): BindingExpectation[] {
  const expectations: BindingExpectation[] = [
    { label: 'prompt binding', placeholder: '{{prompt}}', target: recipe.bindings.prompt },
  ];
  if (recipe.bindings.negativePrompt) {
    expectations.push({
      label: 'negativePrompt binding',
      placeholder: '{{negativePrompt}}',
      target: recipe.bindings.negativePrompt,
    });
  }
  if (recipe.bindings.seed) {
    expectations.push({ label: 'seed binding', placeholder: '{{seed}}', target: recipe.bindings.seed });
  }
  if (recipe.bindings.dimensions) {
    expectations.push(
      { label: 'dimensions.width binding', placeholder: '{{width}}', target: recipe.bindings.dimensions.width },
      { label: 'dimensions.height binding', placeholder: '{{height}}', target: recipe.bindings.dimensions.height },
    );
  }
  for (const image of recipe.bindings.images) {
    expectations.push({ label: `image binding ${image.id}`, placeholder: `{{image:${image.id}}}`, target: image });
  }
  if (recipe.bindings.mask) {
    expectations.push({ label: 'mask binding', placeholder: '{{mask}}', target: recipe.bindings.mask });
  }
  if (recipe.bindings.audio) {
    expectations.push({ label: 'audio binding', placeholder: '{{audio}}', target: recipe.bindings.audio });
  }
  return expectations;
}

function collectNodeReferences(
  value: unknown,
  visitor: (nodeId: string, outputIndex: number) => void,
): void {
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]) && (value[1] as number) >= 0) {
      visitor(value[0], value[1] as number);
      return;
    }
    for (const item of value) collectNodeReferences(item, visitor);
    return;
  }
  if (isPlainRecord(value)) {
    for (const item of Object.values(value)) collectNodeReferences(item, visitor);
  }
}

function collectNodesReachableFromOutputs(
  nodes: Record<string, ComfyUIWorkflowNode>,
  outputNodeIds: string[],
): Set<string> {
  const reachable = new Set<string>();
  const pending = [...outputNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes[nodeId];
    if (!node) continue;
    collectNodeReferences(node.inputs, (dependencyId) => {
      if (!reachable.has(dependencyId)) pending.push(dependencyId);
    });
  }
  return reachable;
}

function scanPlaceholders(
  value: unknown,
  visitor: (placeholder: string, embedded: boolean) => void,
  issues: string[],
): void {
  if (typeof value === 'string') {
    PLACEHOLDER.lastIndex = 0;
    let matched = false;
    for (const match of value.matchAll(PLACEHOLDER)) {
      matched = true;
      visitor(match[0], match[0] !== value);
    }
    if (!matched && (value.includes('{{') || value.includes('}}'))) {
      issues.push('workflow contains malformed placeholder syntax');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanPlaceholders(item, visitor, issues);
  } else if (isPlainRecord(value)) {
    for (const item of Object.values(value)) scanPlaceholders(item, visitor, issues);
  }
}

function validateUniqueStrings(values: readonly string[], label: string, issues: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) issues.push(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

function validatePrompt(value: unknown, label: string, allowEmpty: boolean): asserts value is string {
  if (typeof value !== 'string' || value.length > 16_384 || hasForbiddenControlCharacter(value)) {
    throw new ComfyUIRecipeValidationError(`${label} must be a bounded text string`);
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new ComfyUIRecipeValidationError(`${label} must not be empty`);
  }
}

function assertSafeSeed(seed: unknown): asserts seed is number {
  if (!Number.isSafeInteger(seed) || (seed as number) < 0) {
    throw new ComfyUIRecipeValidationError('seed must be a non-negative safe integer');
  }
}

function validateDimensions(
  dimensions: { width: number; height: number },
  binding: NonNullable<ComfyUIRecipe['bindings']['dimensions']>,
): void {
  if (!isPlainRecord(dimensions)
    || Object.keys(dimensions).some((key) => key !== 'width' && key !== 'height')
    || !Object.prototype.hasOwnProperty.call(dimensions, 'width')
    || !Object.prototype.hasOwnProperty.call(dimensions, 'height')) {
    throw new ComfyUIRecipeValidationError('dimensions must contain only width and height');
  }
  for (const [name, dimension] of Object.entries(dimensions)) {
    if (!Number.isInteger(dimension)
      || dimension < binding.min
      || dimension > binding.max
      || dimension % binding.multipleOf !== 0) {
      throw new ComfyUIRecipeValidationError(`${name} is outside the recipe dimension constraints`);
    }
  }
}

function validateAssetMap(value: unknown): asserts value is Record<string, string> {
  if (!isPlainRecord(value) || Object.keys(value).length > 32) {
    throw new ComfyUIRecipeValidationError('images must be a bounded object');
  }
  for (const [id, asset] of Object.entries(value)) {
    if (!SAFE_ID.test(id) || typeof asset !== 'string' || !isSafeComfyUIAssetReference(asset)) {
      throw new ComfyUIRecipeValidationError(`Unsafe image asset reference: ${id}`);
    }
  }
}

function applyOptionalAsset(
  nodes: Record<string, ComfyUIWorkflowNode>,
  label: 'mask' | 'audio',
  binding: ComfyUIRecipe['bindings']['mask'] | ComfyUIRecipe['bindings']['audio'],
  value: string | undefined,
): void {
  if (!binding) {
    if (value !== undefined) throw new ComfyUIRecipeValidationError(`This recipe does not declare a ${label} binding`);
    return;
  }
  if (value === undefined && binding.required) {
    throw new ComfyUIRecipeValidationError(`Missing required recipe ${label}`);
  }
  if (value !== undefined && !isSafeComfyUIAssetReference(value)) {
    throw new ComfyUIRecipeValidationError(`Unsafe ${label} asset reference`);
  }
  setBinding(nodes, binding, value ?? '');
}

function setBinding(
  nodes: Record<string, ComfyUIWorkflowNode>,
  target: ComfyUIBindingTarget,
  value: string | number,
): void {
  const node = nodes[target.nodeId];
  if (!node || !Object.prototype.hasOwnProperty.call(node.inputs, target.input)) {
    throw new ComfyUIRecipeValidationError(`Recipe binding target disappeared: ${target.nodeId}.${target.input}`);
  }
  node.inputs[target.input] = value;
}

function assertNoPlaceholders(nodes: Record<string, ComfyUIWorkflowNode>): void {
  const issues: string[] = [];
  scanPlaceholders(nodes, (placeholder) => issues.push(`unresolved placeholder: ${placeholder}`), issues);
  if (issues.length > 0) throw new ComfyUIRecipeValidationError('Workflow still contains placeholders', issues);
}

function secureSeed(): number {
  return randomBytes(6).readUIntBE(0, 6);
}

function targetKey(target: ComfyUIBindingTarget): string {
  return `${target.nodeId}\u0000${target.input}`;
}

function validateBoundedJson(value: unknown, label: string): void {
  let entries = 0;
  const visit = (item: unknown, depth: number): void => {
    entries += 1;
    if (entries > 50_000) throw new ComfyUIRecipeValidationError(`${label} has too many values`);
    if (depth > 24) throw new ComfyUIRecipeValidationError(`${label} exceeds the nesting limit`);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > 65_536) throw new ComfyUIRecipeValidationError(`${label} contains an oversized string`);
      return;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new ComfyUIRecipeValidationError(`${label} contains a non-finite number`);
      return;
    }
    if (Array.isArray(item)) {
      if (item.length > 4096) throw new ComfyUIRecipeValidationError(`${label} contains an oversized array`);
      for (const entry of item) visit(entry, depth + 1);
      return;
    }
    if (!isPlainRecord(item)) throw new ComfyUIRecipeValidationError(`${label} contains a non-JSON value`);
    const keys = Object.keys(item);
    if (keys.length > 4096 || keys.some((key) => DANGEROUS_KEYS.has(key) || hasForbiddenControlCharacter(key))) {
      throw new ComfyUIRecipeValidationError(`${label} contains an unsafe object key`);
    }
    for (const entry of Object.values(item)) visit(entry, depth + 1);
  };
  visit(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
