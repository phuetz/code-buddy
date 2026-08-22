/**
 * Regenerate Lisa brunette multi-style training set via Darkstar ComfyUI.
 * Usage:
 *   COMFYUI_URL=http://100.73.222.64:8188 npx tsx scripts/darkstar/run-brunette-dataset.ts
 */
import { generateLisaTrainingSet } from '../../src/lora/generate-training-set.js';

async function main(): Promise<void> {
  process.env.CODEBUDDY_IMAGE_PROVIDER = process.env.CODEBUDDY_IMAGE_PROVIDER || 'comfyui';
  process.env.COMFYUI_URL = process.env.COMFYUI_URL || 'http://100.73.222.64:8188';
  process.env.CODEBUDDY_IMAGE_MODEL =
    process.env.CODEBUDDY_IMAGE_MODEL || 'sd_turbo.safetensors';
  process.env.CODEBUDDY_LORA_INFER_CHECKPOINT =
    process.env.CODEBUDDY_LORA_INFER_CHECKPOINT || process.env.CODEBUDDY_IMAGE_MODEL;
  process.env.CODEBUDDY_COMFYUI_LORA = 'none';
  process.env.CODEBUDDY_LISA_AVATAR = process.env.CODEBUDDY_LISA_AVATAR || 'lisa';
  // Hard negatives for sd_turbo multi-face artifacts (seen on first brunette batch).
  const { getAvatarProfile } = await import('../../src/lora/lisa-avatar-bible.js');
  process.env.CODEBUDDY_IMAGE_NEGATIVE =
    process.env.CODEBUDDY_IMAGE_NEGATIVE ||
    getAvatarProfile('lisa').negative +
      ', multiple faces, double face, extra eyes, fused faces, split composition';

  const count = Math.max(1, Math.min(80, parseInt(process.argv[2] || '40', 10) || 40));
  console.log(
    `[brunette-dataset] comfy=${process.env.COMFYUI_URL} model=${process.env.CODEBUDDY_IMAGE_MODEL} count=${count}`,
  );

  const r = await generateLisaTrainingSet({
    name: 'lisa',
    count,
    avatarId: 'lisa',
    triggerPhrase: 'ohwx lisa',
    resume: false,
    onProgress: (i) => {
      if (!i.ok) console.log(`FAIL ${i.index + 1}/${i.total} ${i.id} ${i.error ?? ''}`);
      else if ((i.index + 1) % 5 === 0 || i.index === 0) {
        console.log(`OK ${i.index + 1}/${i.total} ${i.id}`);
      }
    },
  });

  console.log(
    JSON.stringify(
      {
        generated: r.generated,
        skipped: r.skipped,
        failed: r.failed,
        dir: r.imagesDir,
        errors: r.errors.slice(0, 8),
      },
      null,
      2,
    ),
  );
  if (r.generated === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
