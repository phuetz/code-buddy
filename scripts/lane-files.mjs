#!/usr/bin/env node
// Filesystem operations shared by the lane scripts on GNU and BSD hosts.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function latestReport(root) {
  let latest;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['.git', 'node_modules', 'test-scripts'].includes(entry.name)) visit(file);
      } else if (entry.isFile() && /^(RAPPORT-|REPARATION-|REVUE-)/.test(entry.name)) {
        const modified = statSync(file).mtimeMs;
        if (!latest || modified > latest.modified) latest = { file, modified };
      }
    }
  }
  visit(root);
  return latest?.file ?? '';
}

try {
  const [operation, file] = process.argv.slice(2);
  let result;
  if (operation === 'latest') result = latestReport(file);
  else if (operation === 'realpath') result = realpathSync(file);
  else if (operation === 'sha256') result = createHash('sha256').update(readFileSync(file)).digest('hex');
  else throw new Error('Unknown lane filesystem operation');
  process.stdout.write(result);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
