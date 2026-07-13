/**
 * `buddy vision-train` — the synthetic perception-training faculty CLI.
 *
 * Opt-in, CLI-only, fail-closed (mirrors `buddy science`). It runs the
 * vision-train loop over labeled scenes and writes a perception benchmark that
 * shows where the robot's vision is weak — the "train the brain" feedback.
 *
 * Two modes:
 *   - generate (default): build a domain-randomized curriculum, generate each
 *     scene with image_generate (ComfyUI local / cloud), perceive with YOLO.
 *   - folder (--images DIR --labels FILE): perceive provided images against a
 *     ground-truth labels file — no generation needed (hardware-agnostic).
 */
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../utils/logger.js';
import { buildCurriculum, type SceneSpec } from '../vision-train/curriculum.js';
import { runVisionTrain, type VisionTrainDeps } from '../vision-train/engine.js';
import { renderReport } from '../vision-train/report.js';
import type { ScenePerception } from '../vision-train/scorer.js';

interface VisionTrainOpts {
  count?: string;
  prop?: string;
  images?: string;
  labels?: string;
  coco?: string;
  provider?: string;
  model?: string;
  minConfidence?: string;
  out?: string;
  ckg?: boolean;
}

export function createVisionTrainCommand(): Command {
  const cmd = new Command('vision-train');
  cmd
    .description('Score the robot vision on labeled synthetic/real scenes (train-the-brain benchmark)')
    .option('--count <n>', 'generate mode: number of synthetic scenes', '12')
    .option('--prop <name>', 'generate mode: labeled prop in peopled scenes (desk|chair|none)', 'desk')
    .option('--images <dir>', 'folder mode: perceive images from a directory instead of generating')
    .option('--labels <file>', 'folder mode: JSON mapping filename -> {label: count} ground truth')
    .option('--coco <file>', 'folder mode: derive ground truth from a COCO annotations file (e.g. BlenderProc output) instead of --labels')
    .option('--provider <name>', 'generate mode: image provider (comfyui|openai|xai)')
    .option('--model <ckpt>', 'generate mode: image model/checkpoint')
    .option('--min-confidence <n>', 'YOLO min confidence', '0.35')
    .option('--ckg', 'publish weak spots to the Collective Knowledge Graph (needs CODEBUDDY_COLLECTIVE_MEMORY=true)')
    .option('--out <dir>', 'report output directory', '.codebuddy/vision-train')
    .action(async (opts: VisionTrainOpts) => {
      // ── OPT-IN gate (default OFF = zero behaviour change) ──────────────────
      if (process.env.CODEBUDDY_VISION_TRAIN !== 'true') {
        logger.error(
          'vision-train is an opt-in, EXPERIMENTAL faculty (generates images and/or runs local YOLO).\n' +
            'Enable it explicitly for this session:\n\n' +
            '  CODEBUDDY_VISION_TRAIN=true buddy vision-train\n\n' +
            'Generate mode needs an image backend (e.g. CODEBUDDY_IMAGE_PROVIDER=comfyui with a\n' +
            'running ComfyUI, or a cloud key). Folder mode (--images --labels) needs only local\n' +
            'YOLO (ultralytics) — no generation.',
        );
        process.exitCode = 1;
        return;
      }

      const rootDir = process.cwd();
      const minConfidence = clampConfidence(opts.minConfidence);

      // Perception is the same in both modes: local YOLO via object_detect.
      const { detectObjectsInImage } = await import('../tools/vision/object-detection.js');
      const perceive = async (imagePath: string, spec: SceneSpec): Promise<ScenePerception> => {
        const classes = Object.keys(spec.expect.counts);
        const res = await detectObjectsInImage(
          { imagePath, minConfidence, ...(classes.length ? { classes } : {}) },
          { rootDir },
        );
        return { countsByLabel: res.summary.countsByLabel };
      };

      let specs: SceneSpec[];
      let obtainImage: VisionTrainDeps['obtainImage'];
      let source: string;

      // Folder mode without any ground truth → detection-only AUDIT (what does
      // the robot see?). Useful for real footage you can't hand-label.
      if (opts.images && !opts.labels && !opts.coco) {
        const dir = path.resolve(opts.images);
        let files: string[];
        try {
          files = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
        } catch (err) {
          logger.error(`Could not read --images dir: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
        if (files.length === 0) {
          logger.error(`No images found in ${dir}`);
          process.exitCode = 1;
          return;
        }
        const auditSpecs: SceneSpec[] = files.map((f) => ({ id: f, prompt: '', expect: { counts: {} }, tags: [] }));
        logger.info(`vision-train audit: ${auditSpecs.length} images · ${dir}`);
        const { runAudit } = await import('../vision-train/engine.js');
        const { renderAudit } = await import('../vision-train/report.js');
        const audit = await runAudit(auditSpecs, {
          obtainImage: async (spec) => path.join(dir, spec.id),
          perceive,
          onScene: (info) =>
            logger.info(`  [${info.index + 1}/${info.total}] ${info.id} — ${info.error ? `FAIL: ${info.error}` : 'ok'}`),
        });
        const outDir = path.resolve(opts.out ?? '.codebuddy/vision-train');
        await fs.mkdir(outDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const md = renderAudit(audit, {
          source: `folder ${dir}`,
          ...(process.env.CODEBUDDY_YOLO_MODEL ? { model: process.env.CODEBUDDY_YOLO_MODEL } : {}),
        });
        const mdPath = path.join(outDir, `audit-${stamp}.md`);
        await fs.writeFile(mdPath, md);
        logger.info(`\n${md}\n`);
        logger.info(`Audit → ${mdPath}`);
        return;
      }

      if (opts.images && (opts.labels || opts.coco)) {
        const dir = path.resolve(opts.images);
        let labelMap: Record<string, Record<string, number>>;
        if (opts.coco) {
          // COCO → {filename: {label: count}} (BlenderProc/Kubric/any sim export).
          try {
            const { cocoToVisionTrainLabels } = await import('../vision-train/coco-to-labels.js');
            const coco = JSON.parse(await fs.readFile(path.resolve(opts.coco), 'utf8'));
            labelMap = cocoToVisionTrainLabels(coco);
          } catch (err) {
            logger.error(`Could not read/parse --coco file: ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = 1;
            return;
          }
        } else {
          try {
            labelMap = JSON.parse(await fs.readFile(path.resolve(opts.labels!), 'utf8'));
          } catch (err) {
            logger.error(`Could not read --labels file: ${err instanceof Error ? err.message : String(err)}`);
            process.exitCode = 1;
            return;
          }
        }
        let files: string[];
        try {
          files = (await fs.readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
        } catch (err) {
          logger.error(`Could not read --images dir: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
        if (files.length === 0) {
          logger.error(`No images found in ${dir}`);
          process.exitCode = 1;
          return;
        }
        specs = files.map((f) => ({ id: f, prompt: '', expect: { counts: labelMap[f] ?? {} }, tags: [] }));
        obtainImage = async (spec) => path.join(dir, spec.id);
        source = `folder ${dir}`;
      } else {
        if (opts.provider) process.env.CODEBUDDY_IMAGE_PROVIDER = opts.provider;
        if (opts.model) process.env.CODEBUDDY_IMAGE_MODEL = opts.model;
        specs = buildCurriculum({
          count: Number(opts.count ?? '12'),
          prop: normalizeProp(opts.prop),
        });
        const { generateImage } = await import('../tools/media-generation-tool.js');
        obtainImage = async (spec) => {
          const r = await generateImage({ prompt: spec.prompt, aspectRatio: 'landscape' }, { rootDir });
          if (!r.outputPath) throw new Error('image generation returned no local path');
          return r.outputPath;
        };
        source = `generated (${process.env.CODEBUDDY_IMAGE_PROVIDER ?? 'openai'})`;
      }

      logger.info(`vision-train: ${specs.length} scenes · source=${source} · min-confidence=${minConfidence}`);
      const result = await runVisionTrain(specs, {
        obtainImage,
        perceive,
        onScene: (info) =>
          logger.info(
            `  [${info.index + 1}/${info.total}] ${info.id} — ${info.error ? `FAIL: ${info.error}` : info.ok ? 'ok' : 'mismatch'}`,
          ),
      });

      const outDir = path.resolve(opts.out ?? '.codebuddy/vision-train');
      await fs.mkdir(outDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const md = renderReport(result.benchmark, {
        source,
        ...(process.env.CODEBUDDY_YOLO_MODEL ? { model: process.env.CODEBUDDY_YOLO_MODEL } : {}),
      });
      const mdPath = path.join(outDir, `report-${stamp}.md`);
      await fs.writeFile(mdPath, md);
      await fs.writeFile(path.join(outDir, `report-${stamp}.json`), JSON.stringify(result, null, 2));

      logger.info(`\n${md}\n`);
      logger.info(`Report → ${mdPath}`);
      if (result.failures.length > 0) {
        logger.warn(`${result.failures.length} scene(s) failed to produce an image/perception (excluded from the benchmark).`);
      }

      // Optional: let the robot's brain RETAIN its weaknesses across runs.
      if (opts.ckg) {
        if (process.env.CODEBUDDY_COLLECTIVE_MEMORY !== 'true') {
          logger.warn('--ckg ignored: set CODEBUDDY_COLLECTIVE_MEMORY=true to publish to the Collective Knowledge Graph.');
        } else {
          try {
            const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
            const { publishBenchmark } = await import('../vision-train/ckg-publish.js');
            const wrote = await publishBenchmark(
              result.benchmark,
              { source, ...(process.env.CODEBUDDY_YOLO_MODEL ? { model: process.env.CODEBUDDY_YOLO_MODEL } : {}) },
              getCollectiveKnowledgeGraph(),
            );
            logger.info(`Published ${wrote} node(s) to the Collective Knowledge Graph.`);
          } catch (err) {
            logger.warn(`CKG publish failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    });
  return cmd;
}

function clampConfidence(raw: string | undefined): number {
  const n = Number(raw ?? '0.35');
  if (!Number.isFinite(n)) return 0.35;
  return Math.max(0, Math.min(1, n));
}

function normalizeProp(raw: string | undefined): 'desk' | 'chair' | 'none' {
  return raw === 'chair' || raw === 'none' ? raw : 'desk';
}
