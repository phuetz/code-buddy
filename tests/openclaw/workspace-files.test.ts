import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatOpenClawWorkspaceContext,
  readOpenClawWorkspace,
} from '../../src/openclaw/workspace-files.js';

describe('OpenClaw workspace import', () => {
  it('reads SOUL and HEARTBEAT when the workspace exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-ws-'));
    writeFileSync(join(dir, 'SOUL.md'), 'Tu es Lisa.');
    writeFileSync(join(dir, 'HEARTBEAT.md'), 'Chaque matin : brief.');
    const snapshot = readOpenClawWorkspace({ OPENCLAW_WORKSPACE: dir });
    expect(snapshot?.files.map((file) => file.name)).toEqual(['SOUL.md', 'HEARTBEAT.md']);
  });

  it('stays silent unless the import flag is on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openclaw-ws-'));
    writeFileSync(join(dir, 'SOUL.md'), 'Tu es Lisa.');
    expect(
      formatOpenClawWorkspaceContext({
        OPENCLAW_WORKSPACE: dir,
      }),
    ).toBe('');
    expect(
      formatOpenClawWorkspaceContext({
        OPENCLAW_WORKSPACE: dir,
        CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT: 'true',
      }),
    ).toContain('SOUL.md');
  });
});
