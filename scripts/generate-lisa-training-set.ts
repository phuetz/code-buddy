/**
 * One-shot: generate Lisa LoRA training images via ComfyUI.
 *   CODEBUDDY_IMAGE_PROVIDER=comfyui npx tsx scripts/generate-lisa-training-set.ts [--count 40]
 */
import { generateLisaTrainingSet } from '../src/lora/generate-training-set.js';

async function main(): Promise<void> {
  const countArg = process.argv.find((a) => a.startsWith('--count='));
  const count = countArg ? Number(countArg.split('=')[1]) : 40;
  const result = await generateLisaTrainingSet({
    name: 'lisa',
    count: Number.isFinite(count) ? count : 40,
    triggerPhrase: 'ohwx lisa',
    resume: true,
    onProgress: (info) => {
      const tag = info.ok ? 'ok' : 'FAIL';
      console.log(
        `[${info.index + 1}/${info.total}] ${info.id} ${tag}${info.error ? ` ${info.error}` : ''}`,
      );
    },
  });
  console.log(
    JSON.stringify(
      {
        dir: result.projectDir,
        generated: result.generated,
        skipped: result.skipped,
        failed: result.failed,
        images: result.imagePaths.length,
        errors: result.errors.slice(0, 8),
      },
      null,
      2,
    ),
  );
  if (result.generated + result.skipped === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
