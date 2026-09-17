#!/usr/bin/env node
/**
 * Thin CLI process entry. `--version` / `-V` print the package version without
 * evaluating the full Commander program. Every other argv shape loads `index.js`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const isVersionOnly =
  args.length === 1 && (args[0] === '--version' || args[0] === '-V');

if (isVersionOnly) {
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
  process.stdout.write(`${packageJson.version}\n`);
} else {
  await import('./index.js');
}
