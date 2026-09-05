/**
 * Hermetic system-prompt budget report.
 *
 * This deliberately builds the prompt in-process and never creates a provider
 * or calls fetch. HOME is supplied by the caller so persistent-memory reads and
 * writes stay below _qa/promptbudget1/home.
 *
 * Run:
 *   HOME="$PWD/_qa/promptbudget1/home" npx tsx scripts/measure-system-prompt.ts
 */

import path from 'node:path';
import { PromptBuilder, type PromptBlockMeasurement } from '../src/services/prompt-builder.js';
import { PromptCacheManager } from '../src/optimization/prompt-cache.js';
import { getModelToolConfig } from '../src/config/model-tools.js';
import { getMemoryManager } from '../src/memory/index.js';
import { getPersonaManager } from '../src/personas/persona-manager.js';

const MODELS = ['gpt-5.6-luna', 'mistral-medium-latest', 'qwen3.8:27b'] as const;
const cwd = process.cwd();
const qaHome = path.join(cwd, '_qa', 'promptbudget1', 'home');

function budgetFor(modelName: string): { tokens: number; chars: number } {
  const config = getModelToolConfig(modelName);
  const contextWindow = config.contextWindow ?? 8192;
  const maxOutputTokens = config.maxOutputTokens ?? 2048;
  const leftover = contextWindow - maxOutputTokens;
  const rawBudget = leftover > 0
    ? Math.floor(leftover * 0.5)
    : Math.floor(contextWindow * 0.25);
  const tokens = leftover > 0
    ? Math.min(rawBudget, 32_000)
    : Math.max(256, Math.min(rawBudget, 32_000));
  return { tokens, chars: tokens * 4 };
}

function percent(value: number, total: number): string {
  return total === 0 ? '0.00' : ((value / total) * 100).toFixed(2);
}

function groupDuplicates(blocks: PromptBlockMeasurement[]): Array<{ hash: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const block of blocks) {
    const ids = groups.get(block.sha256) ?? [];
    ids.push(block.id);
    groups.set(block.sha256, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, ids]) => ({ hash, ids }));
}

async function main(): Promise<void> {
  // Keep memory deterministic and confined to the mission QA directory. The
  // empty stores still exercise the production memory-manager wiring, without
  // importing the SQLite/embedding subsystem or touching the real HOME.
  const memory = getMemoryManager({
    projectMemoryPath: path.join(qaHome, 'project', 'CODEBUDDY_MEMORY.md'),
    userMemoryPath: path.join(qaHome, 'user', 'memory.md'),
  });
  const personas = getPersonaManager({
    customPersonasDir: path.join(qaHome, 'personas'),
    persistActivePersona: false,
  });
  await personas.ready();

  // Optional dynamic blocks are local filesystem reads. Explicitly disable the
  // query-dependent collective graph and variation so the section ledger sums
  // byte-for-byte to the pre-truncation prompt and is reproducible day to day.
  process.env.CODEBUDDY_COLLECTIVE_MEMORY = 'false';
  process.env.GROK_FORCE_TOOLS = 'false';

  const rows: Array<{
    model: string;
    prompt: string;
    blocks: PromptBlockMeasurement[];
    preChars: number;
    budgetChars: number;
  }> = [];

  for (const model of MODELS) {
    const builder = new PromptBuilder(
      {
        yoloMode: false,
        memoryEnabled: true,
        morphEditorEnabled: false,
        cwd,
      },
      new PromptCacheManager({ enabled: false }),
      undefined,
      undefined,
      memory,
    );
    const prompt = await builder.buildSystemPrompt(undefined, model, null, {
      includeVariation: false,
    });
    const blocks = builder.getLastPromptBlocks();
    const preChars = blocks.reduce((sum, block) => sum + block.chars, 0);
    if (preChars !== prompt.length && prompt.length >= preChars) {
      throw new Error(`${model}: section ledger is not byte-complete (${preChars} vs ${prompt.length})`);
    }
    rows.push({ model, prompt, blocks, preChars, budgetChars: budgetFor(model).chars });
  }

  console.log('# System-prompt budget report');
  console.log(`cwd: ${cwd}`);
  console.log('mode: legacy default, memory enabled, variation disabled for deterministic section accounting');
  console.log('network: none (no provider/client/fetch is created)');
  console.log('estimated tokens: ceil(characters / 4), matching PromptBuilder cache/budget approximation');
  console.log('');
  console.log('| Modèle | Bloc | Source | Caractères | Jetons estimés | % du pré-tronquage | SHA-256 |');
  console.log('|---|---|---|---:|---:|---:|---|');
  for (const row of rows) {
    for (const block of row.blocks) {
      console.log(`| ${row.model} | ${block.id} | ${block.source} | ${block.chars} | ${block.estimatedTokens} | ${percent(block.chars, row.preChars)}% | ${block.sha256.slice(0, 12)} |`);
    }
  }

  console.log('');
  console.log('## Totals');
  console.log('| Modèle | Pré-tronquage | Jetons pré-tronquage | Budget | Prompt livré | Jetons livrés |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    console.log(`| ${row.model} | ${row.preChars} | ${Math.ceil(row.preChars / 4)} | ${row.budgetChars} | ${row.prompt.length} | ${Math.ceil(row.prompt.length / 4)} |`);
  }

  console.log('');
  console.log('## Exact duplicate blocks');
  const duplicateLines = rows.flatMap(row => groupDuplicates(row.blocks).map(group =>
    `- ${row.model}: ${group.ids.join(' + ')} (sha256 ${group.hash.slice(0, 12)})`,
  ));
  console.log(duplicateLines.length > 0 ? duplicateLines.join('\n') : '- none');
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
