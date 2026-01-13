import { OperatingMode, OperatingModeManager, getOperatingModeManager } from './operating-modes.js';

export type AgentMode = OperatingMode;

export class AgentModeManager {
  private modeManager: OperatingModeManager;

  constructor() {
    this.modeManager = getOperatingModeManager();
  }

  getMode(): AgentMode {
    return this.modeManager.getMode();
  }

  setMode(mode: AgentMode): void {
    this.modeManager.setMode(mode);
  }

  getModeConfig() {
    return this.modeManager.getModeConfig();
  }

  isToolAllowed(toolName: string): boolean {
    return this.modeManager.isToolAllowed(toolName);
  }

  getSystemPromptAddition(): string {
    return this.modeManager.getSystemPromptAddition();
  }

  onModeChange(listener: (mode: AgentMode) => void): () => void {
    const wrapper = (data: { newMode: OperatingMode }) => listener(data.newMode);
    this.modeManager.on('mode:changed', wrapper);
    return () => {
      this.modeManager.off('mode:changed', wrapper);
    };
  }

  formatModeStatus(): string {
    return this.modeManager.formatModeStatus();
  }

  static getModeHelp(): string {
    return OperatingModeManager.getModeHelp();
  }
}

// Singleton instance
let modeManagerInstance: AgentModeManager | null = null;

export function getAgentModeManager(): AgentModeManager {
  if (!modeManagerInstance) {
    modeManagerInstance = new AgentModeManager();
  }
  return modeManagerInstance;
}
