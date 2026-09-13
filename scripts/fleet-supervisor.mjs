#!/usr/bin/env node
/** Compatibility entry point; native command: buddy fleet supervise. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSupervisor } from '../dist/harness/fleet-supervisor.js';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const [manifest, action] = process.argv.slice(2);
    if (!manifest || !action) throw new Error('Usage: node scripts/fleet-supervisor.mjs <operator-manifest.json> <operation>');
    const result = await runSupervisor(manifest, action, { signal: controller.signal });
    console.log(JSON.stringify({ kind: 'fleet_supervisor_result', action, ...result }));
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
