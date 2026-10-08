/**
 * Plus aucun identifiant de modèle Claude figé dans le code métier (mission du
 * 2026-10-08) : un défaut vient de `src/config/model-defaults.ts`, qui se
 * remplace par ANTHROPIC_MODEL / CLAUDE_MODEL ; le reste de `src/` l'importe.
 *
 * Fichiers autorisés à nommer des modèles, et pourquoi :
 * - model-defaults.ts : la source unique ;
 * - model-tools.ts : motifs de capacités par famille (glob), pas des défauts ;
 * - model-price-data.ts : lignes de tarifs versionnées ;
 * - provider-catalog.ts, bedrock-provider.ts : ids d'autres passerelles
 *   (OpenCode, OpenRouter, Copilot, Bedrock), dans leur propre espace de noms ;
 * - prompt-manager.ts, image-input.ts : préfixes de familles (voir ci-dessous).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTHROPIC_MODEL_CATALOG, MODEL_DEFAULTS } from '../../src/config/model-defaults.js';
import { findRuntimeProvider } from '../../src/providers/provider-catalog.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

const ALLOWED = new Set([
  'config/model-defaults.ts',
  'config/model-tools.ts',
  'config/model-price-data.ts',
  'config/models-snapshot.json',
  'providers/provider-catalog.ts',
  'plugins/bundled/bedrock-provider.ts',
  // préfixes de familles « includes » (claude-3, claude-4 historiques) ; les
  // noms version-agnostiques (claude-sonnet, claude-haiku…) couvrent la suite
  'prompts/prompt-manager.ts',
  'tools/image-input.ts',
]);

const FROZEN = /['"`]claude-(?:opus|sonnet|haiku|fable)-\d|['"`]claude-3/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('identifiants Claude figés dans src/', () => {
  it('aucun littéral de modèle Claude hors des fichiers autorisés', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // commentaires
        if (FROZEN.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('le catalogue Anthropic du produit est la gamme actuelle et le défaut en fait partie', () => {
    const anthropic = findRuntimeProvider('anthropic');
    expect(anthropic?.defaultModel).toBe(MODEL_DEFAULTS.anthropic);
    expect(anthropic?.models).toEqual([...ANTHROPIC_MODEL_CATALOG]);
    expect(ANTHROPIC_MODEL_CATALOG).toContain(MODEL_DEFAULTS.anthropic);
  });
});
