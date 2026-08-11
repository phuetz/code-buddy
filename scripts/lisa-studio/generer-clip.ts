#!/usr/bin/env -S npx tsx

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { logger } from '../../src/utils/logger.js';
import {
  type LisaStudioInput,
  type LisaStudioReport,
  type LisaStudioRuntime,
  runLisaStudio,
} from './lisa-studio-pipeline.js';

export const USAGE = `Usage :
  npx tsx scripts/lisa-studio/generer-clip.ts --reference <image> [options]

Options :
  --reference, -r <fichier>  Image canonique utilisée par ArcFace (obligatoire)
  --scene <prompt>           Scène de la keyframe Krea 2
  --animation <prompt>       Mouvement H3 (le verrou visage/plan est ajouté)
  --n <entier>               Nombre de keyframes, défaut 4 (1..12)
  --seuil <nombre>           Seuil ArcFace, défaut 0.5 (0..1)
  --duree <secondes>         Durée H3 demandée, défaut 5 (5..15)
  --seed <entier>            Seed de base reproductible
  --racine <répertoire>      Racine des sorties, défaut cwd
  --image-url <url>          ComfyUI Krea 2, défaut http://darkstar:8188
  --video-url <url>          ComfyUI MiniMax H3, défaut http://darkstar:8190
  --python <exécutable>      Python QC, défaut ~/.venvs/tri-outils-qc/bin/python
  --essai                    Stub local : aucun appel réseau/Python
  --aide, --help             Afficher cette aide
`;

export interface ParsedCli {
  help: boolean;
  input?: LisaStudioInput;
}

export function parseLisaStudioCli(argv: string[], cwd = process.cwd()): ParsedCli {
  const parsed = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      reference: { type: 'string', short: 'r' },
      scene: { type: 'string' },
      animation: { type: 'string' },
      n: { type: 'string' },
      seuil: { type: 'string' },
      duree: { type: 'string' },
      seed: { type: 'string' },
      racine: { type: 'string' },
      'image-url': { type: 'string' },
      'video-url': { type: 'string' },
      python: { type: 'string' },
      essai: { type: 'boolean' },
      aide: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (parsed.values.aide || parsed.values.help) return { help: true };
  const reference = parsed.values.reference?.trim();
  if (!reference) throw new Error('--reference est obligatoire.');

  return {
    help: false,
    input: {
      referencePath: reference,
      rootDir: path.resolve(cwd, parsed.values.racine ?? '.'),
      ...(parsed.values.scene !== undefined ? { scenePrompt: parsed.values.scene } : {}),
      ...(parsed.values.animation !== undefined
        ? { animationPrompt: parsed.values.animation }
        : {}),
      ...(parsed.values.n !== undefined
        ? { candidateCount: parseCliInteger(parsed.values.n, '--n') }
        : {}),
      ...(parsed.values.seuil !== undefined
        ? { threshold: parseCliNumber(parsed.values.seuil, '--seuil') }
        : {}),
      ...(parsed.values.duree !== undefined
        ? { durationSeconds: parseCliNumber(parsed.values.duree, '--duree') }
        : {}),
      ...(parsed.values.seed !== undefined
        ? { baseSeed: parseCliInteger(parsed.values.seed, '--seed') }
        : {}),
      ...(parsed.values['image-url'] !== undefined
        ? { imageBaseUrl: parsed.values['image-url'] }
        : {}),
      ...(parsed.values['video-url'] !== undefined
        ? { videoBaseUrl: parsed.values['video-url'] }
        : {}),
      ...(parsed.values.python !== undefined ? { pythonPath: parsed.values.python } : {}),
      trial: parsed.values.essai ?? false,
    },
  };
}

export async function runLisaStudioCli(
  argv: string[],
  runtime: LisaStudioRuntime = {}
): Promise<LisaStudioReport | undefined> {
  const parsed = parseLisaStudioCli(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return undefined;
  }
  const report = await runLisaStudio(parsed.input!, {
    ...runtime,
    onProgress: runtime.onProgress ?? ((message) => logger.info(message)),
  });
  logger.info('Rapport Lisa Studio écrit.', {
    video: report.paths.video,
    report: report.paths.report,
    bestArcFace: report.gate.bestScore,
  });
  return report;
}

function parseCliNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} attend un nombre, reçu : ${value}`);
  return number;
}

function parseCliInteger(value: string, label: string): number {
  const number = parseCliNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} attend un entier, reçu : ${value}`);
  return number;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(path.resolve(entry!)).href === import.meta.url;
}

if (isMainModule()) {
  runLisaStudioCli(process.argv.slice(2)).catch((error: unknown) => {
    logger.error(
      error instanceof Error ? error.message : String(error),
      error instanceof Error ? error : undefined
    );
    process.exitCode = 1;
  });
}
