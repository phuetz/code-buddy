import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeHeartbeatChecklists,
  readHeartbeatSources,
} from '../../src/daemon/heartbeat-sources.js';

describe('heartbeat sources', () => {
  it('merges local and OpenClaw HEARTBEAT.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hb-src-'));
    const localPath = join(root, 'local-HEARTBEAT.md');
    const clawDir = join(root, 'openclaw');
    mkdirSync(clawDir);
    writeFileSync(localPath, 'Local: check tests.');
    writeFileSync(join(clawDir, 'HEARTBEAT.md'), 'OpenClaw: morning brief.');

    const sources = await readHeartbeatSources({
      localPath,
      env: {
        CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT: 'true',
        OPENCLAW_WORKSPACE: clawDir,
      },
    });

    expect(sources.map((source) => source.label)).toEqual(['code-buddy', 'openclaw']);
    expect(mergeHeartbeatChecklists(sources)).toContain('morning brief');
  });

  it('survives a missing local file when OpenClaw has one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hb-src-'));
    const clawDir = join(root, 'openclaw');
    mkdirSync(clawDir);
    writeFileSync(join(clawDir, 'HEARTBEAT.md'), 'Only claw.');

    const sources = await readHeartbeatSources({
      localPath: join(root, 'missing.md'),
      env: {
        CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT: 'true',
        OPENCLAW_WORKSPACE: clawDir,
        // Le semis cree le fichier local absent, qui cesse donc d'etre absent :
        // sans le couper, ce cas ne teste plus ce qu'il annonce.
        CODEBUDDY_HEARTBEAT_SEED: 'false',
      },
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.label).toBe('openclaw');
  });
});
