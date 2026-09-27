/**
 * The agent tool handler, outside the MCP server, still grants an unconfined
 * escalation when the sandbox is unavailable and CODEBUDDY_AUTO_CONFIRM=true.
 * Kept in its own file so it does not share a worker with the MCP server spawn.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setSandboxCapabilityProbe } from '../../src/sandbox/os-sandbox.js';
import { removeTestDir } from '../helpers/tmp.js';

const disposables: string[] = [];

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

describe('escalade shell hors du serveur MCP', () => {
  afterEach(() => {
    setSandboxCapabilityProbe(null);
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
    for (const dir of disposables.splice(0)) removeTestDir(dir);
  });

  it('la boucle agent hors MCP accorde encore l escalade sans bac a sable', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bash-home-'));
    const codebuddyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bash-cbhome-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bash-espace-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bash-hors-'));
    disposables.push(homeDir, codebuddyHome, workspace, outsideDir);
    const previousHome = process.env.HOME;
    const previousProfile = process.env.USERPROFILE;
    const previousCodebuddy = process.env.CODEBUDDY_HOME;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    process.env.CODEBUDDY_HOME = codebuddyHome;
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    setSandboxCapabilityProbe(() => ({
      landlock: false,
      bubblewrap: false,
      seatbelt: false,
      docker: false,
      recommended: 'none',
    }));
    const outsideFile = path.join(outsideDir, 'agent-hors.txt');
    try {
      const [
        { ToolHandler },
        { CheckpointManager },
        { HooksManager },
        { PluginMarketplace },
        { RepairCoordinator },
      ] = await Promise.all([
        import('../../src/agent/tool-handler.js'),
        import('../../src/checkpoints/checkpoint-manager.js'),
        import('../../src/hooks/lifecycle-hooks.js'),
        import('../../src/plugins/marketplace.js'),
        import('../../src/agent/execution/repair-coordinator.js'),
      ]);
      const handler = new ToolHandler({
        checkpointManager: new CheckpointManager(),
        hooksManager: new HooksManager(workspace),
        marketplace: new PluginMarketplace({ autoUpdate: false }),
        repairCoordinator: new RepairCoordinator({ enabled: false }),
      });
      handler.setWorkingDirectory(workspace);
      const result = await handler.executeTool({
        id: 'agent_bash_hors',
        type: 'function',
        function: {
          name: 'bash',
          arguments: JSON.stringify({
            command: `printf '%s\\n' agent > ${shellQuote(outsideFile)}`,
          }),
        },
      });
      const present = fs.existsSync(outsideFile);
      console.log(
        `ASSERT agent fichier=${present ? 'PRESENT' : 'ABSENT'} succes=${result.success} texte=${JSON.stringify(result.success ? result.output : result.error)}`,
      );
      expect(present, 'ASSERT agent fichier present').toBe(true);
      expect(result.success, 'ASSERT agent succes').toBe(true);
    } finally {
      setSandboxCapabilityProbe(null);
      delete process.env.CODEBUDDY_AUTO_CONFIRM;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
      if (previousCodebuddy === undefined) delete process.env.CODEBUDDY_HOME;
      else process.env.CODEBUDDY_HOME = previousCodebuddy;
    }
  }, 180_000);
});
