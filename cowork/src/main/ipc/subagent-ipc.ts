import { ipcMain } from 'electron';
import type { SubAgentBridge } from '../agent/sub-agent-bridge';

// Getter, not value: the bridge is assigned during async boot, AFTER this
// top-level registration runs. Resolve lazily per call (see command-ipc.ts).
export function registerSubAgentIpcHandlers(getBridge: () => SubAgentBridge | null) {
  ipcMain.handle('subagent.list', async () => {
    const subAgentBridge = getBridge();
    if (!subAgentBridge) return [];
    return subAgentBridge.list();
  });

  ipcMain.handle(
    'subagent.spawn',
    async (
      _event,
      options: {
        sessionId: string;
        prompt: string;
        role?: string;
        forkContext?: boolean;
        parentId?: string;
      }
    ) => {
      const subAgentBridge = getBridge();
      if (!subAgentBridge) return { error: 'SubAgentBridge not initialized' };
      return subAgentBridge.spawn(options);
    }
  );

  ipcMain.handle(
    'subagent.sendInput',
    async (_event, agentId: string, message: string, interrupt?: boolean) => {
      const subAgentBridge = getBridge();
      if (!subAgentBridge) return false;
      return subAgentBridge.sendInput(agentId, message, interrupt);
    }
  );

  ipcMain.handle('subagent.close', async (_event, agentId: string) => {
    const subAgentBridge = getBridge();
    if (!subAgentBridge) return false;
    return subAgentBridge.close(agentId);
  });

  ipcMain.handle('subagent.resume', async (_event, agentId: string, prompt?: string) => {
    const subAgentBridge = getBridge();
    if (!subAgentBridge) return false;
    return subAgentBridge.resume(agentId, prompt);
  });

  ipcMain.handle('subagent.wait', async (_event, agentIds: string[], timeoutMs?: number) => {
    const subAgentBridge = getBridge();
    if (!subAgentBridge) return [];
    return subAgentBridge.wait(agentIds, timeoutMs);
  });
}
