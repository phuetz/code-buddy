#!/usr/bin/env npx tsx

/** Replay the twelve chalet and ten Japan composites through continuous matting. */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { matteCompositeAgainstPlate } from './insert-character-in-location.js';

const SCENES_ROOT = '/home/patrice/Videos/personas/ambre-scenes/automne-composites';
const REPAIRS_ROOT = '/home/patrice/Videos/personas/composites-identite-2026-08-01';
const DEFAULT_OUTPUT_ROOT =
  '/home/patrice/Videos/personas/composites-cheveux-2026-08-01/replays';

export interface HairMatteReplayTask {
  id: string;
  slug: string;
  plate: string;
  repairedSource?: string;
}

export const HAIR_MATTE_REPLAY_TASKS: readonly HairMatteReplayTask[] = [
  { id: '001', slug: 'chalet-exterieur-doudoune', plate: '001' },
  { id: '002', slug: 'chalet-exterieur-flanelle', plate: '001' },
  { id: '003', slug: 'chalet-salon-pull-creme', plate: '002' },
  { id: '004', slug: 'chalet-salon-flanelle', plate: '002' },
  { id: '005', slug: 'chalet-terrasse-doudoune', plate: '004' },
  { id: '006', slug: 'chalet-terrasse-bordeaux', plate: '004' },
  { id: '007', slug: 'chalet-large-doudoune', plate: '023' },
  {
    id: '008', slug: 'chalet-fenetre-pull-creme', plate: '025',
    repairedSource: 'live-008/composite.png',
  },
  { id: '009', slug: 'chalet-fenetre-flanelle', plate: '025' },
  {
    id: '010', slug: 'chalet-aube-bordeaux', plate: '047',
    repairedSource: 'replays-v2/ambre-010-chalet-aube-bordeaux/composite.png',
  },
  { id: '011', slug: 'chalet-interieur-flanelle', plate: '048' },
  {
    id: '012', slug: 'chalet-balcon-doudoune', plate: '073',
    repairedSource: 'replays-v2/ambre-012-chalet-balcon-doudoune/composite.png',
  },
  { id: '013', slug: 'sakura-allee-kimono-traditionnel', plate: '007' },
  { id: '014', slug: 'sakura-allee-kimono-rouille', plate: '007' },
  { id: '015', slug: 'temple-kimono-traditionnel', plate: '008' },
  { id: '016', slug: 'temple-kimono-rouille', plate: '008' },
  {
    id: '017', slug: 'jardin-pluie-kimono-traditionnel', plate: '009',
    repairedSource: 'replays-v3/ambre-017-jardin-pluie-kimono-traditionnel/composite.png',
  },
  { id: '018', slug: 'sakura-aube-kimono-traditionnel', plate: '029' },
  {
    id: '019', slug: 'temple-mousse-kimono-rouille', plate: '030',
    repairedSource: 'replays/ambre-019-temple-mousse-kimono-rouille/composite.png',
  },
  {
    id: '020', slug: 'temple-zen-kimono-traditionnel', plate: '053',
    repairedSource: 'replays/ambre-020-temple-zen-kimono-traditionnel/composite.png',
  },
  { id: '021', slug: 'jardin-pierres-kimono-rouille', plate: '054' },
  { id: '022', slug: 'sakura-soleil-kimono-traditionnel', plate: '076' },
] as const;

function selectedTasks(argv: readonly string[]): readonly HairMatteReplayTask[] {
  const only = argv.find((argument) => argument.startsWith('--only='));
  if (!only) return HAIR_MATTE_REPLAY_TASKS;
  const selectedIds = new Set(only.slice('--only='.length).split(',').map((id) => id.trim()));
  return HAIR_MATTE_REPLAY_TASKS.filter((task) => selectedIds.has(task.id));
}

export function hairMatteReplaySourcePath(task: HairMatteReplayTask): string {
  if (task.repairedSource) return path.join(REPAIRS_ROOT, task.repairedSource);
  return path.join(SCENES_ROOT, `ambre-${task.id}-${task.slug}.png`);
}

async function worker(
  comfyUrl: string,
  tasks: readonly HairMatteReplayTask[],
  outputRoot: string,
  force: boolean,
): Promise<void> {
  for (const task of tasks) {
    const basename = `ambre-${task.id}-${task.slug}`;
    const outputPath = path.join(outputRoot, basename, 'composite.png');
    console.log(`[hair-matte-replay] start=${task.id} gpu=${comfyUrl}`);
    await matteCompositeAgainstPlate({
      compositePath: hairMatteReplaySourcePath(task),
      platePath: path.join(SCENES_ROOT, '_plates', `ambre-${task.plate}.png`),
      outputPath,
      outputPrefix: `hair-matte/${basename}`,
      comfyUrl,
      force,
    });
    console.log(`[hair-matte-replay] done=${task.id} output=${outputPath}`);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const tasks = selectedTasks(argv);
  if (tasks.length === 0) throw new Error('No hair-matte replay task selected');
  if (argv.includes('--print-manifest')) {
    console.log(JSON.stringify(tasks.map((task) => ({
      ...task,
      sourcePath: hairMatteReplaySourcePath(task),
      platePath: path.join(SCENES_ROOT, '_plates', `ambre-${task.plate}.png`),
    })), null, 2));
    return;
  }
  const endpoints = [
    process.env.HAIR_MATTE_COMFY_0 ?? 'http://darkstar:8188',
    process.env.HAIR_MATTE_COMFY_1 ?? 'http://darkstar:8189',
  ];
  const outputRoot = process.env.HAIR_MATTE_REPLAY_OUTPUT ?? DEFAULT_OUTPUT_ROOT;
  const force = argv.includes('--force');
  await Promise.all(endpoints.map((endpoint, index) => (
    worker(
      endpoint,
      tasks.filter((_task, taskIndex) => taskIndex % endpoints.length === index),
      outputRoot,
      force,
    )
  )));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
