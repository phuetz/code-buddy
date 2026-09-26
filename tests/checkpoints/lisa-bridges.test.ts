import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CheckpointManager as LegacyCheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import { PersistentCheckpointManager } from '../../src/checkpoints/persistent-checkpoint-manager.js';
import { CheckpointManager as UndoCheckpointManager } from '../../src/undo/checkpoint-manager.js';
import { LisaActionStore } from '../../src/checkpoints/lisa-action-store.js';
import { handleUndo } from '../../src/commands/handlers/extra-handlers.js';
import { logger } from '../../src/utils/logger.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { completeLisaActionBestEffort } from '../../src/checkpoints/lisa-action-store.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

const initialCwd = process.cwd();
const temporaryRoots: string[] = [];

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-bridges-')));
  temporaryRoots.push(root);
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  vi.stubEnv('CODEBUDDY_LISA_UNIFIED_CHECKPOINTS', 'true');
  process.chdir(root);
  return root;
}

afterEach(() => {
  process.chdir(initialCwd);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lisa checkpoint integration', () => {
  it('a second /undo does not redo the first action', async () => {
    const root = fixture();
    const target = path.join(root, 'work.txt');
    fs.writeFileSync(target, 'before');
    const store = new LisaActionStore();
    const checkpoint = store.prepare('edit-one', 'edit', 'tool', [target]);
    fs.writeFileSync(target, 'after');
    store.complete(checkpoint.id);

    const first = await handleUndo([]);
    expect(first.failed).not.toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('before');
    const second = await handleUndo([]);
    expect(fs.readFileSync(target, 'utf8')).toBe('before');
    expect(second.failed).toBe(true);
  });

  for (const scenario of ['oversized', 'outside', 'symlink'] as const) {
    it.skipIf(scenario === 'symlink' && process.platform === 'win32')(`ordinary checkpoint managers survive a ${scenario} Lisa capture failure`, async () => {
      const root = fixture();
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      let target = path.join(root, 'work.txt');
      if (scenario === 'oversized') fs.writeFileSync(target, Buffer.alloc(4 * 1024 * 1024 + 1));
      if (scenario === 'outside') {
        target = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
        fs.writeFileSync(target, 'outside');
      }
      if (scenario === 'symlink') {
        const linked = path.join(root, 'linked');
        fs.symlinkSync(root, linked, 'dir');
        target = path.join(linked, 'work.txt');
        fs.writeFileSync(path.join(root, 'work.txt'), 'linked');
      }
      try {
        const legacy = new LegacyCheckpointManager();
        expect(legacy.createCheckpoint('ordinary edit', [target]).files).toHaveLength(1);
        const persistent = new PersistentCheckpointManager({ historyDir: path.join(root, 'history') });
        expect(persistent.createCheckpoint('ordinary edit', [target]).files).toHaveLength(1);
        const undo = new UndoCheckpointManager(root, { autoCheckpoint: false });
        await undo.waitUntilReady();
        expect((await undo.createCheckpoint({ operation: 'edit', files: [target] })).files).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
      } finally {
        if (scenario === 'outside') fs.rmSync(target, { force: true });
      }
    });
  }

  it.skipIf(process.platform === 'win32')('bash executes with an oversized target when capture is unavailable', async () => {
    const root = fixture();
    const target = path.join(root, 'large.txt');
    fs.writeFileSync(target, Buffer.alloc(4 * 1024 * 1024 + 1));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const confirmation = ConfirmationService.getInstance();
    confirmation.setSessionFlag('bashCommands', true);
    confirmation.setInteractiveBridge(async () => ({ confirmed: true }));
    const bash = new BashTool();
    try {
      const result = await bash.execute('rm large.txt', 10_000, root);
      expect(result.success, result.error ?? result.output).toBe(true);
      expect(fs.existsSync(target)).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds checkpoint limit'));
    } finally {
      bash.dispose();
      confirmation.setInteractiveBridge(null);
    }
  });

  it('a failed completion is logged without replacing the operation result', () => {
    const root = fixture();
    const target = path.join(root, 'work.txt');
    fs.writeFileSync(target, 'before');
    const store = new LisaActionStore();
    const point = store.prepare('edit', 'edit', 'bash', [target]);
    fs.writeFileSync(target, Buffer.alloc(4 * 1024 * 1024 + 1));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(() => completeLisaActionBestEffort({ store, id: point.id })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds checkpoint limit'));
    expect(fs.statSync(target).size).toBe(4 * 1024 * 1024 + 1);
  });
});
