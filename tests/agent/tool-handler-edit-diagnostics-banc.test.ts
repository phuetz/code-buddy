import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
const { isolatedHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return { isolatedHome: fs.mkdtempSync(path.join(os.tmpdir(), 'edit-diagnostics-home-')) };
});
vi.mock('os', async (original) => ({ ...await original<typeof import('os')>(), homedir: () => isolatedHome }));
afterAll(() => rmSync(isolatedHome, { recursive: true, force: true }));

import { ToolHandler } from '../../src/agent/tool-handler.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { WritePolicy } from '../../src/security/write-policy.js';
import { initializeWorkspaceIsolation, resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';

const originalCwd = process.cwd();
let root: string;
let handler: ToolHandler;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'edit-diagnostics-'));
  process.chdir(root);
  initializeWorkspaceIsolation({ directory: root });
  ConfirmationService.getInstance().setSessionFlag('fileOperations', true);
  WritePolicy.getInstance().setMode('off');
  getPermissionModeManager().setMode('dontAsk');
  handler = new ToolHandler({
    checkpointManager: { checkpointBeforeCreate: vi.fn(), checkpointBeforeEdit: vi.fn() } as never,
    hooksManager: { executeHooks: vi.fn().mockResolvedValue(undefined) } as never,
    marketplace: { executeTool: vi.fn() } as never,
    repairCoordinator: { isRepairEnabled: () => false } as never,
  });
});
afterEach(() => {
  ConfirmationService.getInstance().setSessionFlag('fileOperations', false);
  resetWorkspaceIsolation();
  getPermissionModeManager().setMode('default');
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

it('reports the invalid optional object member from A-4B immediately after applying the edit', async () => {
  const file = join(root, 'schema.ts');
  writeFileSync(file, "export const schema = { confirmDangerous: { type: 'boolean' } };\n");
  const result = await handler.executeTool({ id: 'a-4b-invalid-object', type: 'function', function: {
    name: 'str_replace_editor', arguments: JSON.stringify({ path: file, old_str: 'confirmDangerous:', new_str: 'confirmDangerous?:' }),
  } });
  expect(result.success, result.error).toBe(true); // The edit really happened.
  expect(readFileSync(file, 'utf8')).toContain('confirmDangerous?:');
  expect(result.output).toContain('1162');
  expect(result.output).toContain('An object member cannot be declared optional');
});

it('reports an unfinished class on create and clears the diagnostic after repair', async () => {
  const file = join(root, 'license.ts');
  const created = await handler.executeTool({ id: 'c-incomplete-class', type: 'function', function: {
    name: 'create_file', arguments: JSON.stringify({ path: file, content: 'export class Signer {\n' }),
  } });
  expect(created.success, created.error).toBe(true);
  expect(created.output).toContain('TS1005');
  const repaired = await handler.executeTool({ id: 'c-repair-class', type: 'function', function: {
    name: 'str_replace_editor', arguments: JSON.stringify({ path: file, old_str: 'export class Signer {', new_str: 'export class Signer {}' }),
  } });
  expect(repaired.success, repaired.error).toBe(true);
  expect(repaired.output).not.toContain('syntax checking failed');
});

it('reports malformed JSON written through apply_patch', async () => {
  const file = join(root, 'package.json');
  writeFileSync(file, '{"name":"fixture"}\n');
  const result = await handler.executeTool({ id: 'invalid-json-patch', type: 'function', function: {
    name: 'apply_patch', arguments: JSON.stringify({ patch: `*** Begin Patch\n*** Update File: ${file}\n@@\n-{"name":"fixture"}\n+{"name":}\n*** End Patch` }),
  } });
  expect(result.success, result.error).toBe(true);
  expect(result.output).toContain('syntax checking failed');
});
