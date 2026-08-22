/**
 * Generate all Krea-video style selfies via Darkstar Comfy.
 * Usage: COMFYUI_URL=http://100.73.222.64:8188 npx tsx scripts/darkstar/run-style-selfies.ts
 */
import { createAndMaybeSendLisaSelfie } from '../../src/companion/lisa-selfie.js';
import { listAvatarStyles } from '../../src/lora/lisa-avatar-bible.js';

const STYLES = [
  'studio',
  'wet-selfie',
  'street-rain',
  'neon-skate',
  'soft-editorial',
  'tender',
  'mika',
] as const;

async function main(): Promise<void> {
  process.env.CODEBUDDY_IMAGE_PROVIDER = process.env.CODEBUDDY_IMAGE_PROVIDER || 'comfyui';
  process.env.COMFYUI_URL = process.env.COMFYUI_URL || 'http://100.73.222.64:8188';
  process.env.CODEBUDDY_IMAGE_MODEL =
    process.env.CODEBUDDY_IMAGE_MODEL || 'sd_turbo.safetensors';
  process.env.CODEBUDDY_COMFYUI_LORA = process.env.CODEBUDDY_COMFYUI_LORA || 'auto';
  process.env.CODEBUDDY_LISA_AVATAR = 'lisa';

  const styles = process.argv.includes('--all-styles')
    ? listAvatarStyles('lisa')
    : [...STYLES];

  console.log(`[style-selfies] ${styles.length} styles via ${process.env.COMFYUI_URL}`);
  const results: Array<Record<string, unknown>> = [];

  for (const style of styles) {
    console.log(`→ ${style}`);
    const r = await createAndMaybeSendLisaSelfie({
      style,
      mood: style as 'studio',
      avatarId: 'lisa',
      force: true,
      sendTelegram: process.env.CODEBUDDY_LISA_SELFIE_TELEGRAM === 'true',
    });
    results.push({
      style,
      success: r.success,
      path: r.imagePath,
      telegram: r.telegramSent,
      error: r.error,
    });
    console.log(`  ${r.success ? 'OK' : 'FAIL'} ${r.imagePath ?? r.error ?? ''}`);
  }

  console.log(JSON.stringify({ count: results.length, results }, null, 2));
  if (results.some((x) => !x.success)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
