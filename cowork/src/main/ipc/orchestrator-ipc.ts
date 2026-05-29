import { ipcMain } from 'electron';
import type { OrchestratorBridge, OrchestratorOptions } from '../agent/orchestrator-bridge';

// Getter, not value: the bridge is assigned during async boot, AFTER this
// top-level registration runs. Capturing the bare value pins `null` forever
// (every handler hits the not-initialized fallback). Resolve lazily per call.
export function registerOrchestratorIpcHandlers(getBridge: () => OrchestratorBridge | null) {
  ipcMain.handle(
    'orchestrator.run',
    async (_event, sessionId: string, goal: string, options?: OrchestratorOptions) => {
      const orchestratorBridge = getBridge();
      if (!orchestratorBridge)
        return {
          success: false,
          summary: 'Orchestrator not initialized',
          artifacts: {},
          agentResults: [],
          duration: 0,
          errors: ['not initialized'],
        };
      return orchestratorBridge.run(sessionId, goal, options);
    }
  );

  ipcMain.handle('orchestrator.isComplex', async (_event, goal: string) => {
    const orchestratorBridge = getBridge();
    if (!orchestratorBridge) return false;
    return orchestratorBridge.isComplexGoal(goal);
  });
}
