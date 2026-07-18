/**
 * `buddy lora` — Krea 2 LoRA train pipeline (dataset → cloud fal / local plan → ComfyUI install).
 * Opt-in for cloud: CODEBUDDY_LORA_TRAIN=true + FAL_KEY.
 */
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  defaultLoraRoot,
  fillMissingCaptions,
  initLoraProject,
  loadProjectMeta,
  resolveProjectDir,
  validateDataset,
} from '../lora/dataset.js';
import { packDatasetZip } from '../lora/pack-dataset.js';
import { trainKrea2Cloud, resolveFalKey } from '../lora/fal-krea-trainer.js';
import { writeLocalTrainPlan } from '../lora/local-plan.js';
import { installLoraToComfy, listInstalledLoras } from '../lora/install-comfy.js';

function requireLoraTrainGate(): boolean {
  if (process.env.CODEBUDDY_LORA_TRAIN !== 'true') {
    logger.error(
      'Cloud LoRA training is opt-in (uploads dataset + spends fal credits).\n' +
        'Enable for this session:\n\n' +
        '  CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud <project>\n',
    );
    return false;
  }
  return true;
}

export function createLoraCommand(): Command {
  const cmd = new Command('lora');
  cmd.description(
    'Krea 2 character/style LoRA: init dataset, train (cloud fal or local plan), install into ComfyUI',
  );

  cmd
    .command('init')
    .description('Create a LoRA project under .codebuddy/lora/<name>/images')
    .argument('<name>', 'project name (e.g. lisa)')
    .option('--trigger <phrase>', 'trigger phrase for missing captions', 'ohwx person')
    .option('--character <id>', 'optional character tag (e.g. lisa)')
    .option('--root <dir>', 'projects root (default .codebuddy/lora)')
    .action(async (name: string, opts: { trigger?: string; character?: string; root?: string }) => {
      const { dir, imagesDir } = await initLoraProject({
        name,
        triggerPhrase: opts.trigger ?? 'ohwx person',
        ...(opts.root ? { root: opts.root } : {}),
        ...(opts.character ? { character: opts.character } : {}),
      });
      logger.info(`LoRA project ready: ${dir}`);
      logger.info(`Drop 40–50 images into: ${imagesDir}`);
      logger.info(`Then: buddy lora validate ${name}`);
    });

  cmd
    .command('validate')
    .description('Validate images/captions for a project')
    .argument('<nameOrPath>', 'project name or path')
    .option('--fill-captions', 'write missing .txt captions from project trigger phrase')
    .option('--quality', 'also run lightweight quality gate (size + exact duplicates)')
    .action(async (nameOrPath: string, opts: { fillCaptions?: boolean; quality?: boolean }) => {
      const dir = await resolveProjectDir(nameOrPath);
      const meta = await loadProjectMeta(dir);
      if (opts.fillCaptions) {
        const trigger = meta?.triggerPhrase?.trim();
        if (!trigger) {
          logger.error('No triggerPhrase in project.json — set with buddy lora init --trigger');
          process.exitCode = 1;
          return;
        }
        const n = await fillMissingCaptions(dir, trigger);
        logger.info(`Wrote ${n} caption file(s) with trigger « ${trigger} »`);
      }
      const v = await validateDataset(dir);
      for (const w of v.warnings) logger.warn(w);
      for (const e of v.errors) logger.error(e);
      logger.info(
        `Images: ${v.imageCount} · Captions: ${v.captionCount} · Missing captions: ${v.missingCaptions.length}`,
      );
      if (opts.quality) {
        const { assessDatasetQuality, qualityGatePassed } = await import('../lora/quality-gate.js');
        const q = await assessDatasetQuality(dir);
        for (const w of q.warnings) logger.warn(w);
        for (const issue of q.issues) {
          logger.warn(`[quality] ${issue.kind}: ${path.basename(issue.path)} — ${issue.detail}`);
        }
        logger.info(
          `Quality: kept ${q.kept.length} · reject ${q.reject.length} · gate ${qualityGatePassed(q) ? 'PASS' : 'FAIL'}`,
        );
        if (!qualityGatePassed(q)) process.exitCode = 1;
      }
      if (!v.ok) process.exitCode = 1;
      else if (process.exitCode !== 1) logger.info('Dataset OK for train');
    });

  cmd
    .command('dataset')
    .description('Generate a synthetic training image set (ComfyUI/xAI/OpenAI)')
    .argument('[name]', 'project name', 'lisa')
    .option('--count <n>', 'number of images (1–80)', '40')
    .option('--trigger <phrase>', 'caption/trigger phrase', 'ohwx lisa')
    .option(
      '--avatar <id>',
      'avatar profile: lisa (brunette muse from Krea video) | lisa-classic',
      'lisa',
    )
    .option('--no-resume', 'regenerate even if files exist')
    .action(
      async (
        name: string,
        opts: { count?: string; trigger?: string; resume?: boolean; avatar?: string },
      ) => {
        const count = Math.max(1, Math.min(80, parseInt(opts.count ?? '40', 10) || 40));
        logger.info(
          `Generating ${count} training images for « ${name} » avatar=${opts.avatar ?? 'lisa'}…`,
        );
        const { generateLisaTrainingSet } = await import('../lora/generate-training-set.js');
        const result = await generateLisaTrainingSet({
          name: name || 'lisa',
          count,
          triggerPhrase: opts.trigger ?? 'ohwx lisa',
          avatarId: opts.avatar ?? 'lisa',
          resume: opts.resume !== false,
          onProgress: (info) => {
            if (!info.ok) {
              logger.warn(`  [${info.index + 1}/${info.total}] ${info.id} FAIL ${info.error ?? ''}`);
            } else if ((info.index + 1) % 5 === 0 || info.index === 0) {
              logger.info(`  [${info.index + 1}/${info.total}] ${info.id}`);
            }
          },
        });
        logger.info(
          `Done: generated=${result.generated} skipped=${result.skipped} failed=${result.failed}`,
        );
        logger.info(`Images: ${result.imagesDir}`);
        if (result.failed > 0) {
          logger.warn(`First errors: ${result.errors.slice(0, 3).join(' | ')}`);
        }
        const v = await validateDataset(result.projectDir);
        logger.info(
          `Validate: images=${v.imageCount} captions=${v.captionCount} ok=${v.ok}`,
        );
        if (v.ok) {
          logger.info(`Next: CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud ${name} --steps 1000`);
          logger.info(`  or: buddy lora train local ${name}`);
        }
        if (result.generated === 0 && result.skipped === 0) process.exitCode = 1;
      },
    );

  cmd
    .command('pack')
    .description('Zip images (+ captions) for fal upload')
    .argument('<nameOrPath>', 'project name or path')
    .option('--out <file>', 'output zip path')
    .action(async (nameOrPath: string, opts: { out?: string }) => {
      const dir = await resolveProjectDir(nameOrPath);
      const v = await validateDataset(dir);
      if (!v.ok) {
        for (const e of v.errors) logger.error(e);
        process.exitCode = 1;
        return;
      }
      const { zipPath, fileCount } = await packDatasetZip(dir, opts.out);
      logger.info(`Packed ${fileCount} files → ${zipPath}`);
    });

  const train = cmd.command('train').description('Train a Krea 2 LoRA (cloud or local plan)');

  train
    .command('cloud')
    .description('Train on fal.ai krea-2-trainer (needs FAL_KEY + CODEBUDDY_LORA_TRAIN=true)')
    .argument('<nameOrPath>', 'project name or path')
    .option('--steps <n>', 'training steps (default 1000)', '1000')
    .option('--trigger <phrase>', 'override trigger phrase')
    .option('--resolution <n>', '768 or 1024', '768')
    .option('--lr <n>', 'learning rate', '0.0005')
    .option('--auto-caption <mode>', 'Off|Object/Character|Style|Custom', 'Off')
    .option('--out <dir>', 'download directory for .safetensors')
    .action(
      async (
        nameOrPath: string,
        opts: {
          steps?: string;
          trigger?: string;
          resolution?: string;
          lr?: string;
          autoCaption?: string;
          out?: string;
        },
      ) => {
        if (!requireLoraTrainGate()) {
          process.exitCode = 1;
          return;
        }
        if (!resolveFalKey()) {
          logger.error('FAL_KEY is not set (fal.ai API key).');
          process.exitCode = 1;
          return;
        }
        const dir = await resolveProjectDir(nameOrPath);
        const meta = await loadProjectMeta(dir);
        const trigger = (opts.trigger ?? meta?.triggerPhrase ?? '').trim();
        const v = await validateDataset(dir, { triggerPhrase: trigger });
        for (const w of v.warnings) logger.warn(w);
        if (!v.ok) {
          for (const e of v.errors) logger.error(e);
          process.exitCode = 1;
          return;
        }

        logger.info('Packing dataset…');
        const { zipPath } = await packDatasetZip(dir);
        const steps = Math.max(50, parseInt(opts.steps ?? '1000', 10) || 1000);
        const resolution = opts.resolution === '1024' ? 1024 : 768;
        const est = (Math.max(steps, 100) * 0.003).toFixed(2);
        logger.info(
          `Submitting fal-ai/krea-2-trainer · ${steps} steps · ~$${est} (list price) · res ${resolution}`,
        );

        const result = await trainKrea2Cloud({
          imagesDataUrl: 'upload',
          localZipPath: zipPath,
          triggerPhrase: trigger,
          steps,
          resolution,
          learningRate: parseFloat(opts.lr ?? '0.0005') || 0.0005,
          autoCaptioning: (opts.autoCaption as 'Off') || 'Off',
          outDir: opts.out
            ? path.resolve(opts.out)
            : path.join(dir, 'output'),
          onStatus: (s, d) => logger.info(`[train] ${s}${d ? ` ${d}` : ''}`),
        });

        if (!result.success) {
          logger.error(result.error ?? 'train failed');
          process.exitCode = 1;
          return;
        }
        logger.info(`Done. LoRA: ${result.loraPath}`);
        logger.info(`Install: buddy lora install ${result.loraPath} --name ${meta?.name ?? 'lora'}`);
      },
    );

  train
    .command('local')
    .description('Write local AI-Toolkit/musubi plan + train-local.sh (no multi-GB download)')
    .argument('<nameOrPath>', 'project name or path')
    .option('--steps <n>', 'planned steps', '1500')
    .option('--trigger <phrase>', 'override trigger')
    .option('--resolution <n>', '768 or 1024', '768')
    .action(
      async (
        nameOrPath: string,
        opts: { steps?: string; trigger?: string; resolution?: string },
      ) => {
        const dir = await resolveProjectDir(nameOrPath);
        const plan = await writeLocalTrainPlan(dir, {
          steps: parseInt(opts.steps ?? '1500', 10) || 1500,
          ...(opts.trigger ? { triggerPhrase: opts.trigger } : {}),
          resolution: opts.resolution === '1024' ? 1024 : 768,
        });
        logger.info(`Local plan written:`);
        for (const s of plan.steps) logger.info(`  ${s}`);
        logger.info(`README: ${plan.readmePath}`);
      },
    );

  cmd
    .command('install')
    .description('Copy a .safetensors LoRA into ComfyUI models/loras')
    .argument('<file>', 'path to .safetensors')
    .option('--name <id>', 'installed filename stem')
    .option('--comfy-root <dir>', 'override COMFYUI_ROOT')
    .action(async (file: string, opts: { name?: string; comfyRoot?: string }) => {
      try {
        const { destPath, lorasDir } = await installLoraToComfy({
          loraPath: file,
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.comfyRoot ? { comfyRoot: opts.comfyRoot } : {}),
        });
        logger.info(`Installed → ${destPath}`);
        logger.info(`ComfyUI loras dir: ${lorasDir}`);
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  cmd
    .command('status')
    .description('Readiness for Lisa selfie (image backend, LoRA, Telegram)')
    .action(async () => {
      const env = process.env;
      const provider = (env.CODEBUDDY_IMAGE_PROVIDER || '').trim() || (env.COMFYUI_URL ? 'comfyui (inferred)' : '(unset)');
      const comfyUrl = env.COMFYUI_URL || env.CODEBUDDY_IMAGE_BASE_URL || 'http://127.0.0.1:8188';
      const loraEnv = env.CODEBUDDY_COMFYUI_LORA || 'auto';
      const { detectInstalledLisaLoraSync } = await import('../tools/media-generation-tool.js');
      const detected = detectInstalledLisaLoraSync(env);
      const { resolveLisaTrigger } = await import('../companion/lisa-selfie.js');
      const trig = await resolveLisaTrigger(process.cwd());
      const tg = Boolean(env.CODEBUDDY_SENSORY_ALERT_TOKEN && env.CODEBUDDY_SENSORY_ALERT_CHAT);
      const fal = Boolean(env.FAL_KEY || env.FAL_API_KEY);
      logger.info('Lisa selfie / LoRA readiness:');
      logger.info(`  image provider:     ${provider}`);
      logger.info(`  ComfyUI URL:        ${comfyUrl}`);
      logger.info(`  COMFYUI_LORA:       ${loraEnv}`);
      logger.info(`  detected LoRA file: ${detected ?? '(none under models/loras)'}`);
      logger.info(`  trigger phrase:     ${trig.trigger}${trig.hasLoraHint ? ' (project)' : ''}`);
      logger.info(`  Telegram alerts:    ${tg ? 'configured' : 'missing TOKEN/CHAT'}`);
      logger.info(`  FAL_KEY (train):    ${fal ? 'set' : 'missing'}`);
      logger.info(`  LORA_TRAIN opt-in:  ${env.CODEBUDDY_LORA_TRAIN === 'true' ? 'yes' : 'no'}`);
      logger.info(`  SELFIE intercept:   ${env.CODEBUDDY_LISA_SELFIE === 'false' ? 'off' : 'on'}`);
      if (!detected) {
        logger.info('  → Train + install: buddy lora lisa && … train cloud … && buddy lora install … --name lisa');
      }
      if (!tg) {
        logger.info('  → Set CODEBUDDY_SENSORY_ALERT_TOKEN + CODEBUDDY_SENSORY_ALERT_CHAT for photo push');
      }
    });

  cmd
    .command('list')
    .description('List projects and ComfyUI LoRAs')
    .action(async () => {
      const root = defaultLoraRoot();
      try {
        const names = await fs.readdir(root);
        logger.info(`Projects in ${root}:`);
        for (const n of names.sort()) {
          const meta = await loadProjectMeta(path.join(root, n));
          if (meta) logger.info(`  - ${n}  trigger=« ${meta.triggerPhrase} »`);
        }
      } catch {
        logger.info(`No projects yet (run buddy lora init <name>)`);
      }
      const installed = await listInstalledLoras();
      logger.info(`ComfyUI loras: ${installed.length ? installed.join(', ') : '(none found)'}`);
    });

  cmd
    .command('lisa')
    .description('Shortcut: init a Lisa character LoRA project (trigger ohwx lisa)')
    .action(async () => {
      const { dir, imagesDir } = await initLoraProject({
        name: 'lisa',
        triggerPhrase: 'ohwx lisa',
        character: 'lisa',
      });
      logger.info(`Lisa LoRA project: ${dir}`);
      logger.info(`1. Put 40–50 portraits in ${imagesDir}`);
      logger.info('2. buddy lora validate lisa --fill-captions');
      logger.info('3. CODEBUDDY_LORA_TRAIN=true FAL_KEY=… buddy lora train cloud lisa --steps 1000');
      logger.info('   OR: buddy lora train local lisa');
      logger.info('4. buddy lora install .codebuddy/lora/lisa/output/*.safetensors --name lisa');
      logger.info('5. buddy lora selfie [--mood tender]  # generate + send Telegram');
    });

  cmd
    .command('avatars')
    .description('List multi-style avatar profiles (Krea brunette muse + classic)')
    .action(async () => {
      const { formatAvatarCatalog } = await import('../lora/lisa-avatar-bible.js');
      logger.info(formatAvatarCatalog());
    });

  cmd
    .command('selfie')
    .description('Generate a photo of Lisa (LoRA trigger) and send it on Telegram')
    .option(
      '--mood <mood>',
      'tender|playful|bold|sparkly|calm|mika|portrait (alias of --style)',
      'studio',
    )
    .option(
      '--style <style>',
      'studio|wet-selfie|street-rain|neon-skate|soft-editorial|tender|playful|bold|…',
    )
    .option('--avatar <id>', 'lisa (brunette muse) | lisa-classic', 'lisa')
    .option('--scene <text>', 'optional scene description')
    .option('--no-telegram', 'generate only, do not send Telegram')
    .option('--aspect <ratio>', 'portrait|square|landscape', 'portrait')
    .option('--tier <tier>', 'safe|sensual|explicit (explicit requires verified gate)', 'safe')
    .action(
      async (opts: {
        mood?: string;
        style?: string;
        avatar?: string;
        scene?: string;
        telegram?: boolean;
        aspect?: string;
        tier?: string;
      }) => {
        const { createAndMaybeSendLisaSelfie } = await import('../companion/lisa-selfie.js');
        const style = opts.style ?? opts.mood ?? 'studio';
        const aspect = (opts.aspect ?? 'portrait') as 'portrait' | 'square' | 'landscape';
        const requestedTier = (opts.tier ?? 'safe').trim().toLowerCase();
        if (!['safe', 'sensual', 'explicit'].includes(requestedTier)) {
          logger.error(`Unknown content tier: ${requestedTier}`);
          process.exitCode = 1;
          return;
        }
        logger.info(
          `Generating Lisa selfie (avatar=${opts.avatar ?? 'lisa'} style=${style})…`,
        );
        const result = await createAndMaybeSendLisaSelfie({
          mood: style as 'studio',
          style,
          avatarId: opts.avatar ?? 'lisa',
          ...(opts.scene ? { scene: opts.scene } : {}),
          sendTelegram: opts.telegram !== false,
          aspectRatio: aspect,
          contentTier: requestedTier as 'safe' | 'sensual' | 'explicit',
          force: true,
        });
        if (!result.success) {
          logger.error(result.error ?? 'selfie failed');
          logger.info(result.spokenReply);
          process.exitCode = 1;
          return;
        }
        logger.info(`Image: ${result.imagePath}`);
        logger.info(`Telegram: ${result.telegramSent ? 'sent' : 'not sent'}`);
        logger.info(result.spokenReply);
      },
    );

  cmd
    .command('selfie-cache')
    .description('Pre-generate rotating Lisa selfies under safe/sensual/explicit tier folders')
    .option('--tier <tier>', 'safe|sensual|explicit', 'safe')
    .option('--per-style <n>', 'images per style (1-20)', '5')
    .option('--styles <csv>', 'optional comma-separated style subset')
    .option('--avatar <id>', 'lisa (brunette muse) | lisa-classic', 'lisa')
    .option('--cache-dir <dir>', 'override cache root')
    .option('--no-resume', 'regenerate existing entries')
    .action(async (opts: {
      tier?: string;
      perStyle?: string;
      styles?: string;
      avatar?: string;
      cacheDir?: string;
      resume?: boolean;
    }) => {
      const tier = (opts.tier ?? 'safe').trim().toLowerCase();
      if (!['safe', 'sensual', 'explicit'].includes(tier)) {
        logger.error(`Unknown content tier: ${tier}`);
        process.exitCode = 1;
        return;
      }
      const { AVATAR_STYLE_IDS } = await import('../lora/lisa-avatar-bible.js');
      const requested = opts.styles
        ?.split(',')
        .map((style) => style.trim())
        .filter(Boolean);
      const styles = requested?.filter(
        (style): style is (typeof AVATAR_STYLE_IDS)[number] =>
          AVATAR_STYLE_IDS.includes(style as (typeof AVATAR_STYLE_IDS)[number]),
      );
      if (requested?.length && styles?.length !== requested.length) {
        const unknown = requested.filter((style) => !styles?.includes(style as never));
        logger.error(`Unknown Lisa style(s): ${unknown.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const imagesPerStyle = Math.max(
        1,
        Math.min(20, parseInt(opts.perStyle ?? '5', 10) || 5),
      );
      const { generateLisaSelfieCache } = await import('../companion/lisa-selfie-cache.js');
      logger.info(
        `Pre-generating Lisa cache tier=${tier} styles=${styles?.length ?? AVATAR_STYLE_IDS.length} perStyle=${imagesPerStyle}…`,
      );
      try {
        const result = await generateLisaSelfieCache({
          contentTier: tier as 'safe' | 'sensual' | 'explicit',
          imagesPerStyle,
          avatarId: opts.avatar ?? 'lisa',
          ...(styles?.length ? { styles } : {}),
          ...(opts.cacheDir ? { cacheDir: path.resolve(opts.cacheDir) } : {}),
          resume: opts.resume !== false,
          onProgress: ({ index, total, style, error }) => {
            if (error) logger.warn(`  [${index + 1}/${total}] ${style}: ${error}`);
            else if ((index + 1) % 5 === 0 || index === 0) {
              logger.info(`  [${index + 1}/${total}] ${style}`);
            }
          },
        });
        logger.info(
          `Cache ${result.contentTier}: generated=${result.generated} skipped=${result.skipped} failed=${result.failed}`,
        );
        logger.info(`Directory: ${path.join(result.cacheDir, result.contentTier)}`);
        if (result.failed > 0) process.exitCode = 1;
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  return cmd;
}
