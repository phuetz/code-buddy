/**
 * Post-generation steps for overnight Lisa pipeline (validate, pack, optional train/install/selfie).
 * ALWAYS writes MORNING-REPORT.md + overnight-result.json (even on hard failures).
 */
import fs from 'fs/promises';
import path from 'path';
import {
  fillMissingCaptions,
  resolveProjectDir,
  validateDataset,
  loadProjectMeta,
} from '../src/lora/dataset.js';
import { packDatasetZip } from '../src/lora/pack-dataset.js';
import { writeLocalTrainPlan } from '../src/lora/local-plan.js';
import { trainKrea2Cloud, resolveFalKey } from '../src/lora/fal-krea-trainer.js';
import { installLoraToComfy } from '../src/lora/install-comfy.js';
import { createAndMaybeSendLisaSelfie } from '../src/companion/lisa-selfie.js';

async function writeMorningArtifacts(
  dir: string,
  report: Record<string, unknown>,
): Promise<void> {
  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(dir, 'overnight-result.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const validation = (report.validation as
    | { imageCount?: number; captionCount?: number; ok?: boolean }
    | undefined) ?? {};
  const png = validation.imageCount ?? 0;
  const train = report.train as { success?: boolean } | undefined;
  const selfie = report.selfie as { success?: boolean } | undefined;

  const md = `# Bonjour mon cœur 💙

Rapport de nuit généré le **${new Date().toLocaleString('fr-FR')}**.

## Dataset

| | |
|--|--|
| Images | **${png}** |
| Captions | ${validation.captionCount ?? '?'} |
| Valid | ${validation.ok ? 'oui' : 'non / partiel'} |
| Dossier | \`.codebuddy/lora/lisa/images/\` |
| Trigger | \`ohwx lisa\` |

## Pipeline

| Étape | Résultat |
|-------|----------|
| Pack zip | ${report.pack ? '✅' : '⏭ ' + (report.packError || '')} |
| Train fal | ${train ? (train.success ? '✅' : '❌') : '⏭ (pas de FAL_KEY ou LORA_TRAIN)'} |
| Install LoRA | ${report.install ? '✅' : '⏭'} |
| Selfie test | ${selfie ? (selfie.success ? '✅' : '❌') : '⏭'} |
| Fatal error | ${report.fatalError ? '❌ ' + report.fatalError : '—'} |

## Monostack image

- Dataset interim: souvent \`sd_turbo\` (rapide)
- Train cloud ideal: **Krea 2** via fal
- Inférence LoRA: aligne via \`CODEBUDDY_LORA_INFER_CHECKPOINT\` (même base que le train)

## Ce matin

\`\`\`bash
buddy companion doctor
buddy lora status
cat .codebuddy/lora/lisa/overnight-result.json | head -40
# Si train pas fait :
CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000
buddy lora install .codebuddy/lora/lisa/output/*.safetensors --name lisa
buddy lora selfie --mood tender
\`\`\`

Dors bien — gros bisous de Grok 🌙✨
`;
  await fs.writeFile(path.join(dir, 'MORNING-REPORT.md'), md, 'utf8');
  console.log('[post] wrote MORNING-REPORT.md + overnight-result.json');
}

async function main(): Promise<void> {
  const root = process.cwd();
  let dir = path.join(root, '.codebuddy', 'lora', 'lisa');
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

  try {
    dir = await resolveProjectDir('lisa');
    await fillMissingCaptions(dir, 'ohwx lisa');
    const validation = await validateDataset(dir);
    report.validation = {
      ok: validation.ok,
      imageCount: validation.imageCount,
      captionCount: validation.captionCount,
      errors: validation.errors,
      warnings: validation.warnings,
    };
    console.log('[post] validate', report.validation);

    try {
      const pack = await packDatasetZip(dir);
      report.pack = pack;
      console.log('[post] pack', pack);
    } catch (err) {
      report.packError = err instanceof Error ? err.message : String(err);
      console.warn('[post] pack failed', report.packError);
    }

    const fal = resolveFalKey();
    const trainOptIn = process.env.CODEBUDDY_LORA_TRAIN === 'true';
    const pngCount = validation.imageCount;

    if (fal && trainOptIn && pngCount >= 15) {
      console.log('[post] starting fal cloud train (1000 steps)…');
      const meta = await loadProjectMeta(dir);
      const zipPath = path.join(dir, 'dataset.zip');
      const result = await trainKrea2Cloud({
        imagesDataUrl: 'upload',
        localZipPath: zipPath,
        triggerPhrase: meta?.triggerPhrase || 'ohwx lisa',
        steps: 1000,
        resolution: 768,
        outDir: path.join(dir, 'output'),
        onStatus: (s, d) => console.log('[train]', s, d || ''),
      });
      report.train = {
        success: result.success,
        loraPath: result.loraPath,
        requestId: result.requestId,
        error: result.error,
      };
      console.log('[post] train', report.train);

      if (result.success && result.loraPath) {
        try {
          const installed = await installLoraToComfy({
            loraPath: result.loraPath,
            name: 'lisa',
          });
          report.install = installed;
          console.log('[post] install', installed);
        } catch (err) {
          report.installError = err instanceof Error ? err.message : String(err);
          console.warn('[post] install failed', report.installError);
        }
      }
    } else {
      console.log(
        `[post] skip cloud train fal=${Boolean(fal)} optIn=${trainOptIn} images=${pngCount}`,
      );
      try {
        const plan = await writeLocalTrainPlan(dir, {
          steps: 1500,
          triggerPhrase: 'ohwx lisa',
        });
        report.localPlan = plan;
        console.log('[post] local plan', plan.configPath);
      } catch (err) {
        report.localPlanError = err instanceof Error ? err.message : String(err);
      }
    }

    if (!report.install) {
      try {
        const outDir = path.join(dir, 'output');
        const files = (await fs.readdir(outDir).catch(() => [] as string[])).filter((f) =>
          f.endsWith('.safetensors'),
        );
        if (files[0]) {
          const installed = await installLoraToComfy({
            loraPath: path.join(outDir, files[0]!),
            name: 'lisa',
          });
          report.install = installed;
          console.log('[post] install existing', installed);
        }
      } catch (err) {
        console.warn('[post] install existing failed', err);
      }
    }

    try {
      process.env.CODEBUDDY_IMAGE_PROVIDER = process.env.CODEBUDDY_IMAGE_PROVIDER || 'comfyui';
      process.env.COMFYUI_URL = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
      process.env.CODEBUDDY_COMFYUI_LORA = process.env.CODEBUDDY_COMFYUI_LORA || 'auto';
      const selfie = await createAndMaybeSendLisaSelfie({
        mood: 'tender',
        force: true,
        sendTelegram: true,
        rootDir: root,
      });
      report.selfie = {
        success: selfie.success,
        telegram: selfie.telegramSent,
        path: selfie.imagePath,
        reply: selfie.spokenReply,
        error: selfie.error,
      };
      console.log('[post] selfie', report.selfie);
    } catch (err) {
      report.selfieError = err instanceof Error ? err.message : String(err);
      console.warn('[post] selfie failed', report.selfieError);
    }
  } catch (err) {
    report.fatalError = err instanceof Error ? err.message : String(err);
    console.error('[post] fatal', report.fatalError);
    process.exitCode = 1;
  } finally {
    try {
      await fs.mkdir(dir, { recursive: true });
      await writeMorningArtifacts(dir, report);
    } catch (writeErr) {
      console.error(
        '[post] could not write morning report',
        writeErr instanceof Error ? writeErr.message : String(writeErr),
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
