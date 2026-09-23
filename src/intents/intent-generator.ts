/** LLM-backed conversion of a natural-language task into a falsifiable intent. */

import { generateJsonWithRetry } from '../utils/llm-retry.js';
import { logger } from '../utils/logger.js';
import type { CreateIntentInput, IntentCriterion } from './intent-store.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GenerateIntentOptions {
  model?: string;
}

export interface IntentGeneratorDeps {
  /** Injectable one-shot LLM seam for unit tests. */
  chat?: (system: string, user: string) => Promise<string>;
}

export type GeneratedIntent = Pick<CreateIntentInput, 'title' | 'files' | 'criteria' | 'body'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Décrit le dépôt courant pour le générateur : langage, lanceur de tests et
 * scripts npm réellement disponibles.
 *
 * Sans cela, le modèle devine — et devine mal : le 21/09/2026 il a produit un
 * critère `python -m pytest tests/…py` sur un dépôt TypeScript qui utilise
 * vitest, donc un critère qui échoue toujours, pour la mauvaise raison. Une
 * spécification falsifiable doit être falsifiable sur CE projet.
 *
 * Lecture au mieux : si package.json est absent ou illisible, on rend une chaîne
 * vide et le prompt retombe sur ses consignes générales.
 */
export function describeRepositoryContext(cwd: string = process.cwd()): string {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = Object.keys(pkg.scripts ?? {});
    if (scripts.length === 0) return '';

    const interessants = ['test', 'typecheck', 'lint', 'build', 'validate']
      .filter((nom) => scripts.includes(nom));
    const lanceur = /vitest/.test(pkg.scripts?.test ?? '')
      ? 'vitest (utiliser `npx vitest run <chemin>`)'
      : /jest/.test(pkg.scripts?.test ?? '')
        ? 'jest'
        : 'see the test script';

    return (
      '\n\nTHIS repository (do not assume another stack):\n' +
      '- Node.js / TypeScript project with a package.json.\n' +
      `- Test runner: ${lanceur}.\n` +
      `- Available npm scripts: ${interessants.join(', ') || scripts.slice(0, 8).join(', ')}.\n` +
      'Never invent commands from another ecosystem (no pytest, cargo, go test, maven) ' +
      'unless you can see such a project here. Reference only files that exist.'
    );
  } catch {
    return '';
  }
}

export function buildIntentGeneratorSystemPrompt(cwd: string = process.cwd()): string {
  return (
    'You turn software tasks into durable, falsifiable intent specifications. ' +
    'Return only one JSON object with this exact shape:\n' +
    '{"title":"short title","files":["repo/relative/path"],"criteria":' +
    '[{"desc":"verifiable outcome","cmd":"non-interactive shell command","expectExit":0}]}\n' +
    'Every criterion must be objectively verifiable solely by its command exit code. ' +
    'Prefer focused commands such as `npm test -- tests/path.test.ts`, `npm run typecheck`, or `grep -q ...`. ' +
    'Commands must be non-interactive, bounded in scope, require no sudo, and avoid destructive actions. ' +
    'File paths must be relative to the repository root. Include at least one criterion.' +
    describeRepositoryContext(cwd)
  );
}

function normalizeGeneratedIntent(raw: unknown, description: string): GeneratedIntent {
  const candidate = isRecord(raw) && isRecord(raw.intent) ? raw.intent : raw;
  if (!isRecord(candidate)) {
    throw new Error('the model response is not an intent object');
  }
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!title) throw new Error('the generated intent has no title');

  if (!Array.isArray(candidate.files)) throw new Error('the generated intent has no files array');
  const files = candidate.files
    .filter((file): file is string => typeof file === 'string' && file.trim() !== '')
    .map((file) => file.trim());
  if (files.length !== candidate.files.length) {
    throw new Error('the generated intent contains an invalid file path');
  }

  if (!Array.isArray(candidate.criteria) || candidate.criteria.length === 0) {
    throw new Error('the generated intent has no verifiable criteria');
  }
  const criteria: IntentCriterion[] = candidate.criteria.map((value, index) => {
    if (!isRecord(value)) throw new Error(`criterion ${index + 1} is not an object`);
    const desc = typeof value.desc === 'string' ? value.desc.trim() : '';
    const cmd = typeof value.cmd === 'string' ? value.cmd.trim() : '';
    if (!desc || !cmd || typeof value.expectExit !== 'number' || !Number.isSafeInteger(value.expectExit)) {
      throw new Error(`criterion ${index + 1} is incomplete or invalid`);
    }
    return { desc, cmd, expectExit: value.expectExit };
  });

  return {
    title,
    files,
    criteria,
    body: `## Context\n\n${description.trim()}\n`,
  };
}

async function defaultChat(system: string, user: string, model?: string): Promise<string> {
  const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
  const resolved = resolveCommandProvider(model ? { explicitModel: model } : {});
  if (!resolved) {
    throw new Error(
      'No LLM provider is configured. Run `buddy login` or configure a provider API key.',
    );
  }
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const client = new CodeBuddyClient(resolved.apiKey, resolved.model, resolved.baseURL);
  const response = await client.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    undefined,
    { responseFormat: 'json' },
  );
  return response.choices?.[0]?.message?.content ?? '';
}

export async function generateIntent(
  description: string,
  options: GenerateIntentOptions = {},
  deps: IntentGeneratorDeps = {},
): Promise<GeneratedIntent> {
  const normalizedDescription = description.trim();
  if (!normalizedDescription) {
    throw new Error('Cannot generate an intent from an empty description.');
  }
  const system = buildIntentGeneratorSystemPrompt();
  const chat = deps.chat ?? ((systemPrompt: string, userPrompt: string) =>
    defaultChat(systemPrompt, userPrompt, options.model));
  try {
    const raw = await generateJsonWithRetry<unknown>(
      (prompt) => chat(system, prompt),
      `Task description:\n${normalizedDescription}`,
      1,
    );
    const intent = normalizeGeneratedIntent(raw, normalizedDescription);
    logger.info(`[intents] Generated intent "${intent.title}" with ${intent.criteria.length} criterion/criteria.`);
    return intent;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn('[intents] Intent generation failed.', { error: detail });
    throw new Error(`Unable to generate a valid intent: ${detail}`);
  }
}
