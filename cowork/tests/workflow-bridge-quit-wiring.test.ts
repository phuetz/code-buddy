/**
 * Cowork main process — the workflow bridge created at boot is stopped on both
 * quit paths, without ever creating one to do so.
 *
 * `src/main/index.ts` cannot be imported in a test (Electron boot side effects),
 * so its wiring is checked on the source, like `fleet-bridge-quit-lifecycle.test.ts`.
 * Comment lines are ignored: only real calls count. What `shutdown()` guarantees
 * is proved on the real bridge in `workflow-bridge-shutdown.test.ts`. Electron is
 * not started and no real quit is exercised here.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(
  fileURLToPath(new URL('../src/main/index.ts', import.meta.url)),
  'utf-8'
);

function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

function functionBody(signature: string): string {
  const start = indexSource.indexOf(signature);
  expect(start, `${signature} not found in main/index.ts`).toBeGreaterThanOrEqual(0);
  return withoutComments(indexSource.slice(start, indexSource.indexOf('\n}\n', start)));
}

function devQuitPath(): string {
  const beforeQuit = indexSource.slice(indexSource.indexOf("app.on('before-quit'"));
  const start = beforeQuit.indexOf('if (process.env.VITE_DEV_SERVER_URL) {');
  expect(start, 'dev fast quit path not found in main/index.ts').toBeGreaterThanOrEqual(0);
  return withoutComments(beforeQuit.slice(start, beforeQuit.indexOf('return;', start)));
}

const SHUTDOWN_CALL = 'workflowBridge?.shutdown()';

describe('main quit sequence stops the workflow bridge', () => {
  it('stops it in the full quit cleanup before any slow await, once the fleet is disarmed', () => {
    const cleanup = functionBody('async function cleanupSandboxResources(): Promise<void> {');
    const call = cleanup.indexOf(SHUTDOWN_CALL);

    expect(call).toBeGreaterThan(cleanup.indexOf('isCleaningUp = true'));
    expect(call).toBeGreaterThan(cleanup.indexOf('shutdownFleetBridgeForQuit(fleetBridge)'));
    expect(call).toBeLessThan(cleanup.indexOf('await '));
    expect(cleanup.indexOf(SHUTDOWN_CALL, call + 1)).toBe(-1);
  });

  it('stops it on the dev fast quit path, after the fleet and before the database closes', () => {
    const devPath = devQuitPath();
    const call = devPath.indexOf(SHUTDOWN_CALL);

    expect(call).toBeGreaterThan(devPath.indexOf('shutdownFleetBridgeForQuit(fleetBridge)'));
    expect(call).toBeLessThan(devPath.indexOf('closeDatabase()'));
  });

  it('never creates a workflow bridge to stop it', () => {
    const code = withoutComments(indexSource);
    const creations = code.match(/new WorkflowBridge\s*\(/g) ?? [];

    expect(creations).toHaveLength(1);
    expect(code.indexOf('new WorkflowBridge(')).toBeLessThan(
      code.indexOf('async function cleanupSandboxResources')
    );
    expect(code).toMatch(/^let workflowBridge: WorkflowBridge \| null = null;$/m);
    expect(code).not.toMatch(/getWorkflowBridge\s*\(/);
    const cleanup = functionBody('async function cleanupSandboxResources(): Promise<void> {');
    for (const quitPath of [cleanup, devQuitPath()]) {
      expect(quitPath).not.toMatch(/workflowBridge\s*=/);
      expect(quitPath).not.toMatch(/workflowBridge\.shutdown\(/);
    }
  });
});
