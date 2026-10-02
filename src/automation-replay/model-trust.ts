import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

// Imported at CLI startup, before --directory and lazy dotenv loading.
const launchDirectory = process.cwd();
let projectUiConfigurationLoaded = false;

/** Called before each CLI dotenv load; deletion later cannot erase provenance. */
export function noteProjectEnv(path: string): void {
  try {
    const config = parse(readFileSync(path, 'utf8'));
    projectUiConfigurationLoaded ||= Object.keys(config).some(key => /^CODEBUDDY_UI_/i.test(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') projectUiConfigurationLoaded = true;
  }
}

/** Fail closed: project dotenv files are not an authority for UI model routing.
 * Even an inherited host value does not override this restriction. Configure the
 * UI provider in the host environment and remove these keys from project .env.
 */
export function assertUiModelTrust(): void {
  if (projectUiConfigurationLoaded) throw new Error('UI replay refuses model configuration loaded from a project .env');
  for (const directory of new Set([launchDirectory, process.cwd()])) {
    let contents: string;
    try { contents = readFileSync(resolve(directory, '.env'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error('Cannot establish UI model configuration provenance');
    }
    const config = parse(contents);
    if (Object.keys(config).some(key => /^CODEBUDDY_UI_/i.test(key))) {
      throw new Error('UI replay refuses model configuration from a project .env; configure the host environment instead');
    }
  }
}
