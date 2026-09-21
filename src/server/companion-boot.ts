/**
 * Drop-in boot hook for src/server/index.ts next to wireProactiveLoop:
 *
 *   const { wireCompanionServerLoops } = await import('./companion-boot.js');
 *   sensoryTeardown.push(wireCompanionServerLoops());
 */

import { startCompanionAlwaysOnLoops } from '../companion/companion-loops.js';

export function wireCompanionServerLoops(env: NodeJS.ProcessEnv = process.env): () => void {
  return startCompanionAlwaysOnLoops(env);
}
