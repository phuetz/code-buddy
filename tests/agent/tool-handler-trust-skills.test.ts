/**
 * Regression test for the narrow read-only skills-dir trust exception.
 *
 * Background: the trust gate in ToolHandler.executeTool() blocks any tool whose
 * args carry a path outside a trusted folder. That blocked the agent from
 * reading its OWN managed skills directory (~/.codebuddy/skills) — needed to
 * follow its SKILL.md instructions — and pointed users at a `/trust` command
 * that does not exist.
 *
 * The fix grants a NARROW exception: read-only file tools may read paths under
 * ~/.codebuddy/skills. These tests prove the new-allowed case AND that the
 * security boundary still holds:
 *   - a WRITE tool targeting the skills dir is STILL blocked,
 *   - a read of a credential file elsewhere in ~/.codebuddy is STILL blocked,
 *   - a read of an arbitrary path (/etc/passwd) is STILL blocked.
 */
import fs from 'fs';
import * as os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTestDir } from '../helpers/tmp.js';

const { isolatedHome } = await vi.hoisted(async () => {
  const { mkdirSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const scratchRoot = join(process.cwd(), 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  return { isolatedHome: mkdtempSync(join(scratchRoot, 'r32-tool-handler-home-')) };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => isolatedHome };
});

import { initializeWorkspaceIsolation, resetWorkspaceIsolation } from '../../src/workspace/workspace-isolation.js';
import { grantAdditionalDirectories } from '../../src/cli/additional-directories.js';
import { ToolHandler } from '../../src/agent/tool-handler.js';
import {
  getTrustFolderManager,
  resetTrustFolderManager,
} from '../../src/security/trust-folders.js';

function makeHandler(): ToolHandler {
  return new ToolHandler({
    checkpointManager: {
      checkpointBeforeCreate: vi.fn(),
      checkpointBeforeEdit: vi.fn(),
    } as never,
    hooksManager: {
      executeHooks: vi.fn().mockResolvedValue(undefined),
    } as never,
    marketplace: {
      executeTool: vi.fn(),
    } as never,
    repairCoordinator: {
      isRepairEnabled: vi.fn(() => false),
    } as never,
  });
}

const TRUST_ERROR = 'is not in a trusted directory';
const originalCwd = process.cwd();

beforeAll(() => {
  // Keep the fake home outside the automatically trusted cwd while remaining
  // physically inside this repository.
  process.chdir(path.join(originalCwd, 'tests'));
});

afterAll(() => {
  process.chdir(originalCwd);
  removeTestDir(isolatedHome);
});

describe('ToolHandler trust gate — read-only skills exception', () => {
  const skillsDir = path.join(os.homedir(), '.codebuddy', 'skills');
  const skillFile = path.join(skillsDir, '__trust_test__', 'SKILL.md');
  let createdRoot: string | null = null;

  beforeEach(() => {
    // Trust enforcement is OFF by default in NODE_ENV=test; turn it ON so the
    // gate actually runs (this is the production code path we are guarding).
    resetTrustFolderManager();
    getTrustFolderManager().setEnforcement(true);

    // Materialize a real SKILL.md so view_file can actually read it.
    const root = path.join(skillsDir, '__trust_test__');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }
    fs.mkdirSync(root, { recursive: true });
    createdRoot = root;
    fs.writeFileSync(skillFile, '# Trust test skill\n');
    expect(path.relative(originalCwd, skillFile).startsWith(`tmp${path.sep}`)).toBe(true);
  });

  afterEach(() => {
    if (createdRoot) {
      fs.rmSync(createdRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      createdRoot = null;
    }
    resetTrustFolderManager();
  });

  it('ALLOWS a read-only tool (view_file) to read ~/.codebuddy/skills', async () => {
    const handler = makeHandler();
    const result = await handler.executeTool({
      id: 'c1',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: JSON.stringify({ path: skillFile }),
      },
    });
    // Must get past the trust gate and actually read the file. (Without the
    // fix this returns the trust block; with it, view_file reads the SKILL.md.)
    expect(result.error ?? '').not.toContain(TRUST_ERROR);
    expect(result.success).toBe(true);
    expect(result.output ?? '').toContain('Trust test skill');
  });

  it('reads a mission document granted by --add-dir and blocks it after release', async () => {
    const documents = path.join(isolatedHome, 'mission-documents');
    fs.mkdirSync(documents, { recursive: true });
    const report = path.join(documents, 'RAPPORT.md');
    fs.writeFileSync(report, 'Mission document supplied by the operator');
    const handler = makeHandler();
    const call = { id: 'mission-document', type: 'function' as const,
      function: { name: 'view_file', arguments: JSON.stringify({ path: report }) } };
    expect((await handler.executeTool(call)).error).toContain(TRUST_ERROR);
    initializeWorkspaceIsolation({ directory: process.cwd(), additionalPaths: [documents] });
    const release = grantAdditionalDirectories([documents]);
    try {
      const result = await handler.executeTool(call);
      expect(result.success, result.error).toBe(true);
      expect(result.output).toContain('Mission document supplied by the operator');
    } finally { release(); resetWorkspaceIsolation(); }
    expect((await handler.executeTool(call)).error).toContain(TRUST_ERROR);
  });

  it('STILL BLOCKS a write tool (create_file) targeting the skills dir', async () => {
    const handler = makeHandler();
    const result = await handler.executeTool({
      id: 'c2',
      type: 'function',
      function: {
        name: 'create_file',
        arguments: JSON.stringify({
          path: path.join(skillsDir, '__trust_test__', 'evil.txt'),
          content: 'nope',
        }),
      },
    });
    expect(result.success).toBe(false);
    expect(result.error ?? '').toContain(TRUST_ERROR);
  });

  it('STILL BLOCKS reading credential files elsewhere in ~/.codebuddy', async () => {
    const handler = makeHandler();
    const result = await handler.executeTool({
      id: 'c3',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: JSON.stringify({
          path: path.join(os.homedir(), '.codebuddy', 'codex-auth.json'),
        }),
      },
    });
    expect(result.success).toBe(false);
    expect(result.error ?? '').toContain(TRUST_ERROR);
  });

  it('STILL BLOCKS reading an arbitrary path (/etc/passwd)', async () => {
    const handler = makeHandler();
    const result = await handler.executeTool({
      id: 'c4',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: JSON.stringify({ path: '/etc/passwd' }),
      },
    });
    expect(result.success).toBe(false);
    expect(result.error ?? '').toContain(TRUST_ERROR);
  });

  it('points the user at a REAL recovery path (no dead-end /trust command)', async () => {
    const handler = makeHandler();
    const result = await handler.executeTool({
      id: 'c5',
      type: 'function',
      function: {
        name: 'view_file',
        arguments: JSON.stringify({ path: '/etc/passwd' }),
      },
    });
    expect(result.success).toBe(false);
    const error = result.error ?? '';
    // The old message sent users to a `/trust` slash command that does not
    // exist anywhere in the codebase. The new message must name working paths
    // and must NOT direct the user to that dead-end command.
    expect(error).not.toContain('Use /trust');
    expect(error).not.toContain('/trust to');
    expect(error).toContain('trusted-folders.json');
    expect(error).toContain('Run Code Buddy from within that directory');
  });
});
