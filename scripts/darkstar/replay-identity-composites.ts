#!/usr/bin/env npx tsx

/** Replay the objectively identity-rejected Ambre composites on both darkstar GPUs. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  insertCharacterInLocation,
  type InsertCharacterOptions,
} from './insert-character-in-location.js';

const SOURCE_ROOT = '/home/patrice/.codebuddy/personas/ambre/wardrobe-automne';
const COMPOSITE_ROOT = '/home/patrice/Videos/personas/ambre-scenes/automne-composites';
const DEFAULT_OUTPUT_ROOT =
  '/home/patrice/Videos/personas/composites-identite-2026-08-01/replays';
const WORKFLOWS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'workflows');

interface ReplayTask {
  id: string;
  slug: string;
  outfit: string;
  plate: string;
}

// The 38 QC sidecars contain eleven (not twelve) identity rejects. 037/038 are
// absent-judge rejects and are evaluated separately without regeneration.
const TASKS: readonly ReplayTask[] = [
  { id: '030', slug: 'salon-dore-flanelle', outfit: 'cocooning-flanelle-sapin', plate: '082' },
  { id: '008', slug: 'chalet-fenetre-pull-creme', outfit: 'pull-torsade-creme', plate: '025' },
  { id: '017', slug: 'jardin-pluie-kimono-traditionnel', outfit: 'kimono-traditionnel-sakura', plate: '009' },
  { id: '012', slug: 'chalet-balcon-doudoune', outfit: 'doudoune-sapin', plate: '073' },
  { id: '010', slug: 'chalet-aube-bordeaux', outfit: 'manteau-voyage-bordeaux', plate: '047' },
  { id: '034', slug: 'ruelle-pluie-trench', outfit: 'trench-camel', plate: '021' },
  { id: '035', slug: 'ruelle-pluie-bordeaux', outfit: 'manteau-voyage-bordeaux', plate: '021' },
  { id: '019', slug: 'temple-mousse-kimono-rouille', outfit: 'kimono-manteau-rouille', plate: '030' },
  { id: '036', slug: 'cafe-montagne-bordeaux', outfit: 'manteau-voyage-bordeaux', plate: '022' },
  { id: '023', slug: 'salon-cocooning-flanelle', outfit: 'cocooning-flanelle-sapin', plate: '013' },
  { id: '020', slug: 'temple-zen-kimono-traditionnel', outfit: 'kimono-traditionnel-sakura', plate: '053' },
];

function selectedTasks(argv: readonly string[]): readonly ReplayTask[] {
  const only = argv.find((value) => value.startsWith('--only='));
  if (!only) return TASKS;
  const ids = new Set(only.slice('--only='.length).split(',').map((value) => value.trim()));
  return TASKS.filter((task) => ids.has(task.id));
}

async function worker(
  comfyUrl: string,
  tasks: readonly ReplayTask[],
  outputRoot: string,
): Promise<void> {
  for (const task of tasks) {
    const basename = `ambre-${task.id}-${task.slug}`;
    const options: InsertCharacterOptions = {
      characterPath: path.join(SOURCE_ROOT, `ambre-${task.outfit}.png`),
      platePath: path.join(COMPOSITE_ROOT, '_plates', `ambre-${task.plate}.png`),
      draftPath: path.join(COMPOSITE_ROOT, `${basename}.png`),
      comfyUrl,
      outputDir: path.join(outputRoot, basename),
      seed: 810_000 + Number(task.id),
      relight: false,
      frontalMedium: false,
      gate: false,
      force: false,
      locationsRoot: path.resolve('.codebuddy/locations'),
      workflowsDir: WORKFLOWS_DIR,
    };
    console.log(`[identity-replay] start=${task.id} gpu=${comfyUrl}`);
    const result = await insertCharacterInLocation(options);
    console.log(`[identity-replay] done=${task.id} output=${result.outputPath}`);
  }
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const tasks = selectedTasks(argv);
  if (tasks.length === 0) throw new Error('No replay task selected');
  const outputRoot = process.env.IDENTITY_REPLAY_OUTPUT ?? DEFAULT_OUTPUT_ROOT;
  const fresh = argv.includes('--fresh');
  const endpoints = [
    process.env.IDENTITY_REPLAY_COMFY_0 ?? 'http://darkstar:8188',
    process.env.IDENTITY_REPLAY_COMFY_1 ?? 'http://darkstar:8189',
  ];
  if (!fresh) {
    await Promise.all(endpoints.map((endpoint, index) => (
      worker(endpoint, tasks.filter((_task, taskIndex) => taskIndex % endpoints.length === index), outputRoot)
    )));
    return;
  }
  await Promise.all(endpoints.map(async (endpoint, index) => {
    for (const task of tasks.filter((_task, taskIndex) => taskIndex % endpoints.length === index)) {
      const basename = `ambre-${task.id}-${task.slug}`;
      console.log(`[identity-replay] fresh-start=${task.id} gpu=${endpoint}`);
      const result = await insertCharacterInLocation({
        characterPath: path.join(SOURCE_ROOT, `ambre-${task.outfit}.png`),
        platePath: path.join(COMPOSITE_ROOT, '_plates', `ambre-${task.plate}.png`),
        comfyUrl: endpoint,
        outputDir: path.join(outputRoot, basename),
        seed: 820_000 + Number(task.id),
        relight: false,
        frontalMedium: false,
        gate: false,
        force: false,
        locationsRoot: path.resolve('.codebuddy/locations'),
        workflowsDir: WORKFLOWS_DIR,
      });
      console.log(`[identity-replay] fresh-done=${task.id} output=${result.outputPath}`);
    }
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
