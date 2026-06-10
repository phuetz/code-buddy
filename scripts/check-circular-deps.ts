#!/usr/bin/env tsx
/**
 * Circular Dependency Detection Script
 *
 * Runs madge on the TypeScript source to find circular imports.
 * Used as part of `npm run validate` to prevent circular dependencies.
 *
 * Exit codes:
 *   0 - No circular dependencies found
 *   1 - Circular dependencies detected
 */

import madge from 'madge';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

// Known circular dependencies that are intentional or too costly to fix right now.
// Each entry is a sorted, JSON-stringified cycle array for stable comparison.
const KNOWN_CYCLES: string[] = [
  // Agent profiles ↔ operating modes (mutual type dependency)
  JSON.stringify(['agent/operating-modes.ts', 'agent/profiles/index.ts', 'agent/profiles/profile-loader.ts']),
  // Phase 2.1 hand-off cycles: still runtime-coupled, documented in PHASE2-CIRCULAR-DEPS.md.
  JSON.stringify(['agent/autonomous/fleet-tick-handler.ts', 'agent/codebuddy-agent.ts']),
  JSON.stringify([
    'agent/codebuddy-agent.ts',
    'agent/execution/agent-executor.ts',
    'agent/execution/tool-hooks.ts',
    'server/agent-adapter.ts',
    'server/websocket/fleet-bridge.ts',
    'server/websocket/handler.ts',
  ]),
  JSON.stringify(['agent/codebuddy-agent.ts', 'daemon/heartbeat.ts']),
  JSON.stringify(['config/config-mutator.ts', 'config/toml-config.ts']),
  // Lessons loop ↔ run store: run-store lazily imports learning-agent
  // (dynamic import at flush time) and lessons-tracker lazily imports
  // run-store back; learning-agent's static run-store import is type-only.
  // No module-init coupling at runtime — accepted (QA 1.0.0 validation).
  JSON.stringify([
    'agent/learning-agent.ts',
    'agent/lesson-candidate-queue.ts',
    'agent/lessons-tracker.ts',
    'observability/run-store.ts',
  ]),
  JSON.stringify([
    'agent/learning-agent.ts',
    'observability/run-store.ts',
    'observability/run-trajectory-export.ts',
  ]),
];

async function main() {
  const result = await madge(SRC, {
    fileExtensions: ['ts', 'tsx'],
    tsConfig: path.join(ROOT, 'tsconfig.json'),
    detectiveOptions: {
      ts: { skipTypeImports: true },
    },
  });

  const cycles = result.circular();
  const cycleKeys = new Set(cycles.map(cycle => JSON.stringify([...cycle].sort())));
  const staleKnownCycles = KNOWN_CYCLES.filter(key => !cycleKeys.has(key));

  if (staleKnownCycles.length > 0) {
    console.error(`✗ Found ${staleKnownCycles.length} stale accepted circular dependencies:\n`);
    for (const key of staleKnownCycles) {
      const cycle = JSON.parse(key) as string[];
      console.error(`  ${cycle.join(' → ')}`);
    }
    console.error('\nRemove stale entries from KNOWN_CYCLES before accepting new results.');
    process.exit(1);
  }

  if (cycles.length === 0) {
    console.log('✓ No circular dependencies found.');
    process.exit(0);
  }

  // Filter out known/accepted cycles
  const newCycles = cycles.filter(cycle => {
    const key = JSON.stringify([...cycle].sort());
    return !KNOWN_CYCLES.includes(key);
  });

  if (newCycles.length === 0) {
    console.log(`✓ ${cycles.length} known circular dependencies (all accepted).`);
    process.exit(0);
  }

  console.error(`✗ Found ${newCycles.length} circular dependencies:\n`);
  for (const cycle of newCycles) {
    console.error(`  ${cycle.join(' → ')} → ${cycle[0]}`);
  }

  console.error(`\nTo accept a cycle, add it to KNOWN_CYCLES in scripts/check-circular-deps.ts`);
  process.exit(1);
}

main().catch(err => {
  console.error('Failed to run circular dependency check:', err);
  process.exit(1);
});
