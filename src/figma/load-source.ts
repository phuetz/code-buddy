import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { FigmaImportError } from './types.js';
import type { FigmaSourceKind } from './types.js';

const FILE_KEY_RE = /^[a-zA-Z0-9]{8,128}$/;

export interface LoadFigmaSourceInput {
  jsonPath?: string;
  fileKey?: string;
  token?: string;
}

export interface FigmaFetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface LoadFigmaSourceDeps {
  readFile?: (filePath: string, encoding: 'utf8') => Promise<string>;
  fetch?: FigmaFetchLike;
}

export interface LoadedFigmaSource {
  kind: FigmaSourceKind;
  nameHint: string;
  fileKey?: string;
  json: unknown;
}

export function resolveToken(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [explicit, env.FIGMA_TOKEN, env.CODEBUDDY_FIGMA_TOKEN];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export async function loadFigmaSource(
  input: LoadFigmaSourceInput,
  deps: LoadFigmaSourceDeps = {},
): Promise<LoadedFigmaSource> {
  const jsonPath = input.jsonPath?.trim();
  const fileKey = input.fileKey?.trim();

  if (jsonPath && fileKey) {
    throw new FigmaImportError('Provide either a local JSON export or a file key, not both');
  }
  if (!jsonPath && !fileKey) {
    throw new FigmaImportError('Provide --json <file> or --file-key <id> (with a token at call time)');
  }

  if (jsonPath) {
    const resolved = path.resolve(jsonPath);
    const read = deps.readFile ?? ((file, encoding) => readFile(file, encoding));
    let raw: string;
    try {
      raw = await read(resolved, 'utf8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new FigmaImportError(`Cannot read Figma JSON: ${message}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      throw new FigmaImportError('Local Figma export is not valid JSON');
    }
    return {
      kind: 'local-json',
      nameHint: path.basename(resolved, path.extname(resolved)),
      json,
    };
  }

  if (!fileKey || !FILE_KEY_RE.test(fileKey)) {
    throw new FigmaImportError('Figma file key must be 8–128 alphanumeric characters');
  }

  const token = resolveToken(input.token);
  if (!token) {
    throw new FigmaImportError(
      'A Figma personal access token must be passed at call time (--token, FIGMA_TOKEN, or CODEBUDDY_FIGMA_TOKEN). It is never stored.',
    );
  }

  const fetchFn = deps.fetch ?? (globalThis.fetch as FigmaFetchLike | undefined);
  if (!fetchFn) {
    throw new FigmaImportError('fetch is unavailable; pass a local JSON export instead of a file key');
  }

  const url = `https://api.figma.com/v1/files/${fileKey}`;
  const response = await fetchFn(url, { headers: { 'X-Figma-Token': token } });
  const body = await response.text();
  if (!response.ok) {
    throw new FigmaImportError(`Figma API responded ${response.status}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new FigmaImportError('Figma API returned non-JSON');
  }
  return { kind: 'file-key', nameHint: fileKey, fileKey, json };
}
