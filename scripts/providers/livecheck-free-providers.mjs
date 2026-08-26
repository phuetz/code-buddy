#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '../..');
const CATALOG_PATH = path.join(REPOSITORY_ROOT, 'src/providers/provider-catalog.ts');
const TIMEOUT_MS = 10_000;
const MAX_PARALLEL = 4;
const FAKE_AUTHORIZATION = 'Bearer test';
// The mission names the 24 imported free-tier entries explicitly. The catalog
// also contains unrelated high-priority placeholders (for example `azure`),
// so they must not expand this livecheck's scope.
const IMPORTED_FREE_PROVIDER_IDS = [
  'ai21',
  'ant-ling',
  'cerebras',
  'cohere',
  'deepinfra',
  'featherless-ai',
  'friendliai',
  'hyperbolic',
  'inception',
  'inference-net',
  'internlm',
  'liquid',
  'longcat',
  'modelscope',
  'nscale',
  'openadapter',
  'pioneer',
  'reka',
  'sambanova',
  'sarvam',
  'scaleway',
  'tokenrouter',
  'typhoon',
  'zenmux',
];
const IMPORTED_FREE_PROVIDER_ID_SET = new Set(IMPORTED_FREE_PROVIDER_IDS);

function usage() {
  return 'Usage: node scripts/providers/livecheck-free-providers.mjs [--json]';
}

function parseArguments(argv) {
  const json = argv.includes('--json');
  const unknown = argv.filter((argument) => argument !== '--json');
  if (unknown.length > 0) {
    throw new Error(`${usage()}\nUnknown argument: ${unknown[0]}`);
  }
  return { json };
}

/**
 * Extract top-level object literals from the catalog array without needing a
 * TypeScript loader. Strings and comments are skipped so braces in comments
 * cannot end a provider entry early.
 */
function extractCatalogObjects(source) {
  const catalogMarker = 'export const RUNTIME_PROVIDER_CATALOG';
  const markerIndex = source.indexOf(catalogMarker);
  if (markerIndex < 0) {
    throw new Error(`Could not find ${catalogMarker} in ${CATALOG_PATH}`);
  }

  const assignmentIndex = source.indexOf('=', markerIndex);
  const arrayStart = source.indexOf('[', assignmentIndex);
  if (arrayStart < 0) {
    throw new Error(`Could not find the provider catalog array in ${CATALOG_PATH}`);
  }

  const objects = [];
  let arrayDepth = 0;
  let objectDepth = 0;
  let objectStart = -1;
  let state = 'code';
  let quote = '';

  for (let index = arrayStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === 'line-comment') {
      if (character === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && nextCharacter === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }

    if (character === '/' && nextCharacter === '/') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      state = 'string';
      quote = character;
      continue;
    }

    if (character === '[') {
      arrayDepth += 1;
      continue;
    }
    if (character === ']') {
      arrayDepth -= 1;
      if (arrayDepth === 0 && objectDepth === 0) break;
      continue;
    }
    if (character === '{') {
      if (arrayDepth === 1 && objectDepth === 0) objectStart = index;
      objectDepth += 1;
      continue;
    }
    if (character === '}') {
      objectDepth -= 1;
      if (objectDepth === 0 && objectStart >= 0) {
        objects.push(source.slice(objectStart, index + 1));
        objectStart = -1;
      }
    }
  }

  return objects;
}

function readSingleQuotedField(objectSource, fieldName) {
  const expression = new RegExp(`\\b${fieldName}:\\s*'([^']*)'`);
  return objectSource.match(expression)?.[1] ?? null;
}

function readNumberField(objectSource, fieldName) {
  const expression = new RegExp(`\\b${fieldName}:\\s*(\\d+)`);
  const value = objectSource.match(expression)?.[1];
  return value === undefined ? null : Number(value);
}

function readCatalogProviders(source) {
  const providers = extractCatalogObjects(source)
    .map((objectSource) => ({
      id: readSingleQuotedField(objectSource, 'id'),
      baseURL: readSingleQuotedField(objectSource, 'defaultBaseURL'),
      priority: readNumberField(objectSource, 'priority'),
    }))
    .filter((provider) => provider.id !== null && provider.baseURL !== null && provider.priority !== null)
    .filter((provider) => provider.priority >= 300 || provider.id === 'omniroute');

  const selected = providers.filter((provider) => provider.id === 'omniroute' || IMPORTED_FREE_PROVIDER_ID_SET.has(provider.id));
  const selectedIds = new Set(selected.map((provider) => provider.id));
  const missing = IMPORTED_FREE_PROVIDER_IDS.filter((id) => !selectedIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Expected imported free-tier providers missing from priority filter: ${missing.join(', ')}`);
  }
  return selected;
}

function modelsURLFor(baseURL) {
  return `${baseURL.replace(/\/+$/, '')}/models`;
}

function errorKind(error, signal) {
  if (signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return 'timeout';
  }

  const code = error?.cause?.code ?? error?.code;
  if (['EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) {
    return 'dns';
  }
  return 'error';
}

function errorCode(error) {
  return error?.cause?.code ?? error?.code ?? error?.name ?? 'fetch failed';
}

function modelIdsFromJSON(payload) {
  const candidates = [
    Array.isArray(payload) ? payload : null,
    Array.isArray(payload?.data) ? payload.data : null,
    Array.isArray(payload?.models) ? payload.models : null,
    Array.isArray(payload?.result?.data) ? payload.result.data : null,
  ].find((candidate) => candidate !== null);

  if (!candidates) return [];

  return [...new Set(candidates
    .map((model) => {
      if (typeof model === 'string') return model;
      if (!model || typeof model !== 'object') return null;
      if (typeof model.id === 'string') return model.id;
      if (typeof model.model === 'string') return model.model;
      return null;
    })
    .filter((modelId) => modelId !== null))];
}

async function getModels(baseURL, authorization) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  const url = modelsURLFor(baseURL);

  try {
    const headers = { accept: 'application/json' };
    if (authorization) headers.authorization = authorization;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const body = await response.text();
    let json = null;
    let jsonValid = false;

    if (response.status === 200) {
      try {
        json = JSON.parse(body);
        jsonValid = true;
      } catch {
        // A 200 response without JSON is still useful reachability evidence.
      }
    }

    return {
      httpStatus: response.status,
      elapsedMs: Date.now() - startedAt,
      jsonValid,
      modelIds: jsonValid ? modelIdsFromJSON(json) : [],
    };
  } catch (error) {
    return {
      httpStatus: null,
      elapsedMs: Date.now() - startedAt,
      errorKind: errorKind(error, controller.signal),
      errorCode: errorCode(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isStatus(attempt, ...statuses) {
  return statuses.includes(attempt.httpStatus);
}

function classify(noKey, fakeKey) {
  if (isStatus(noKey, 200) || isStatus(fakeKey, 200)) return 'reachable-open';
  if (isStatus(noKey, 401, 403) || isStatus(fakeKey, 401, 403)) return 'reachable-auth';
  if (isStatus(noKey, 404) || isStatus(fakeKey, 404)) return 'not-found';

  const errors = [noKey, fakeKey].filter((attempt) => attempt.errorKind);
  if (errors.length > 0 && errors.every((attempt) => attempt.errorKind === 'dns')) return 'dns';
  if (errors.length > 0 && errors.every((attempt) => attempt.errorKind === 'timeout')) return 'timeout';
  return 'error';
}

function displayHTTP(attempt) {
  if (attempt.httpStatus !== null) return String(attempt.httpStatus);
  return attempt.errorKind ?? 'error';
}

function attemptNote(attempt) {
  if (attempt.httpStatus !== null) {
    if (attempt.httpStatus === 200) {
      if (!attempt.jsonValid) return 'HTTP 200, réponse non-JSON';
      if (attempt.modelIds.length === 0) return 'HTTP 200, JSON sans id de modèle';
      return `HTTP 200, ${attempt.modelIds.length} modèle(s)`;
    }
    return `HTTP ${attempt.httpStatus}`;
  }
  return `${attempt.errorKind} (${attempt.errorCode})`;
}

function makeNote(provider, noKey, fakeKey) {
  const observations = `sans clé: ${attemptNote(noKey)}; Bearer test: ${attemptNote(fakeKey)}`;
  if (noKey.httpStatus !== 200 || !noKey.jsonValid) return observations;

  if (provider.id === 'omniroute') {
    return `${observations}; OmniRoute: ${noKey.modelIds.length} modèle(s)`;
  }
  if (noKey.modelIds.length === 0) return observations;
  return `${observations}; ids: ${noKey.modelIds.join(', ')}`;
}

async function checkProvider(provider) {
  const noKey = await getModels(provider.baseURL, null);
  const fakeKey = await getModels(provider.baseURL, FAKE_AUTHORIZATION);
  const status = classify(noKey, fakeKey);

  return {
    id: provider.id,
    baseURL: provider.baseURL,
    modelsURL: modelsURLFor(provider.baseURL),
    status,
    httpCode: `${displayHTTP(noKey)} / ${displayHTTP(fakeKey)}`,
    note: makeNote(provider, noKey, fakeKey),
    models: noKey.httpStatus === 200 && noKey.jsonValid ? noKey.modelIds : [],
    attempts: {
      withoutKey: noKey,
      withFakeKey: fakeKey,
    },
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => consume());
  await Promise.all(workers);
  return output;
}

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function toMarkdown(checkedAt, results) {
  const lines = [
    '# OmniRoute free providers — livecheck',
    '',
    `Date UTC: ${checkedAt}`,
    '',
    '| id | baseURL | statut | code HTTP (sans clé / Bearer test) | note |',
    '|---|---|---|---|---|',
  ];

  for (const result of results) {
    lines.push(`| ${markdownEscape(result.id)} | ${markdownEscape(result.baseURL)} | ${markdownEscape(result.status)} | ${markdownEscape(result.httpCode)} | ${markdownEscape(result.note)} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const { json: jsonOutput } = parseArguments(process.argv.slice(2));
  const catalogSource = await readFile(CATALOG_PATH, 'utf8');
  const providers = readCatalogProviders(catalogSource);
  if (providers.length === 0) throw new Error('No provider matched priority >= 300 or id omniroute');

  const checkedAt = new Date().toISOString();
  const results = await mapWithConcurrency(providers, MAX_PARALLEL, checkProvider);
  const payload = {
    checkedAt,
    timeoutMs: TIMEOUT_MS,
    maxParallel: MAX_PARALLEL,
    providerCount: results.length,
    results,
  };

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(toMarkdown(checkedAt, results));
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
