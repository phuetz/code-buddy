import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ComputerControlTool } from '../../src/tools/computer-control-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { removeTestDirAsync } from '../helpers/tmp.js';

describe('audit export simulation', () => {
  it('simulateOnly creates neither an audit file nor its parent directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-export-simulation-'));
    try {
      const target = path.join(root, 'uncreated', 'audit.json');
      const result = await new ComputerControlTool().execute({ action: 'export_audit_log', exportAuditPath: target, simulateOnly: true });
      expect(result.success).toBe(true);
      expect((result.data as { audit: { simulated: boolean } }).audit.simulated).toBe(true);
      await expect(access(path.dirname(target))).rejects.toThrow();
    } finally {
      await removeTestDirAsync(root);
    }
  });

  it('exports audit only after a fresh human approval', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'audit-export-approved-'));
    const service = ConfirmationService.getInstance();
    service.setInteractiveBridge(async () => ({ confirmed: true }));
    try {
      const target = path.join(root, 'audit.json');
      const result = await new ComputerControlTool().execute({ action: 'export_audit_log', exportAuditPath: target });
      expect(result.success).toBe(true);
      expect(JSON.parse(await readFile(target, 'utf8')).entries).toEqual([]);
    } finally {
      service.setInteractiveBridge(null);
      await removeTestDirAsync(root);
    }
  });

  it.each(['save_macro', 'delete_macro', 'play_macro'] as const)('%s simulation never calls macro storage', async (action) => {
    const { MacroManager } = await import('../../src/tools/macro-manager.js');
    const storage = vi.spyOn(MacroManager, 'getInstance').mockImplementation(() => {
      throw new Error('Simulation must not touch macro storage');
    });
    try {
      const result = await new ComputerControlTool().execute({
        action, macroName: 'simulation-fixture', steps: [{ action: 'close_window' }], simulateOnly: true,
      });
      expect(result.success).toBe(true);
      expect((result.data as { audit: { simulated: boolean } }).audit.simulated).toBe(true);
      expect(storage).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });
});
