/**
 * env-files — where Cowork looks for dotenv files at boot.
 *
 * dotenv never overrides variables already set, so loading in this order gives
 * the precedence: real environment > project cowork/.env (dev checkout) >
 * ~/.codebuddy/cowork.env > ~/.codebuddy/gpu-worker-client.env. The user-level files are the only ones that exist in
 * a packaged install (the project-relative path would point inside the asar) —
 * media/TTS settings (XAI_API_KEY, CODEBUDDY_IMAGE_PROVIDER,
 * CODEBUDDY_TTS_VOICE…) belong there so EVERY launcher gets them, not just a
 * dev shell that exports them.
 */
import { join, resolve } from 'path';

export function resolveEnvFileCandidates(mainDirname: string, homeDir: string): string[] {
  return [
    resolve(mainDirname, '../../.env'),
    join(homeDir, '.codebuddy', 'cowork.env'),
    join(homeDir, '.codebuddy', 'gpu-worker-client.env'),
  ];
}
