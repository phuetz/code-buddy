/**
 * Use Darkstar Flux.1-dev-fp8 for a short HQ portrait showcase (second use-case).
 * Requires ComfyUI + flux1-dev-fp8.safetensors on Darkstar.
 *
 * COMFYUI_URL=http://100.73.222.64:8188 CODEBUDDY_IMAGE_MODEL=flux1-dev-fp8.safetensors \
 *   npx tsx scripts/darkstar/run-flux-showcase.ts
 */
import path from 'path';
import fs from 'fs/promises';
import { buildLisaAvatarPrompt } from '../../src/lora/lisa-avatar-bible.js';

const PROMPTS = [
  buildLisaAvatarPrompt({ style: 'studio', forWhom: 'camera' }),
  buildLisaAvatarPrompt({ style: 'soft-editorial', forWhom: 'camera' }),
  buildLisaAvatarPrompt({
    style: 'street-rain',
    scene: 'cinematic wet paris boulevard, shallow depth of field',
  }),
];

async function main(): Promise<void> {
  process.env.CODEBUDDY_IMAGE_PROVIDER = 'comfyui';
  process.env.COMFYUI_URL = process.env.COMFYUI_URL || 'http://100.73.222.64:8188';
  process.env.CODEBUDDY_IMAGE_MODEL =
    process.env.CODEBUDDY_IMAGE_MODEL || 'flux1-dev-fp8.safetensors';
  process.env.CODEBUDDY_LORA_INFER_CHECKPOINT = process.env.CODEBUDDY_IMAGE_MODEL;
  // Flux workflows often ignore classic LoraLoader; keep off for base showcase
  process.env.CODEBUDDY_COMFYUI_LORA = 'none';

  const outDir = path.join(process.cwd(), '.codebuddy', 'lora', 'lisa', 'flux-showcase');
  await fs.mkdir(outDir, { recursive: true });
  const { generateImage } = await import('../../src/tools/media-generation-tool.js');

  console.log(`[flux-showcase] model=${process.env.CODEBUDDY_IMAGE_MODEL} n=${PROMPTS.length}`);
  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i]!;
    console.log(`→ flux ${i + 1}/${PROMPTS.length}`);
    const r = await generateImage(
      { prompt, aspectRatio: 'portrait' },
      { rootDir: process.cwd(), env: process.env },
    );
    if (!r.success || !(r.outputPath || r.image)) {
      console.error('FAIL', r.error);
      continue;
    }
    const src = r.outputPath || r.image!;
    const dest = path.join(outDir, `flux_${String(i + 1).padStart(2, '0')}.png`);
    await fs.copyFile(src, dest);
    console.log('OK', dest);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
