import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const panelPath = path.join(root, 'cowork/src/renderer/components/settings/SettingsAutomations.tsx');
const settingsPath = path.join(root, 'cowork/src/renderer/components/SettingsPanel.tsx');
const ipcPath = path.join(root, 'cowork/src/main/ipc/automations-ipc.ts');
const preloadPath = path.join(root, 'cowork/src/preload/index.ts');
const mainPath = path.join(root, 'cowork/src/main/index.ts');

describe('Cowork Automations panel surface', () => {
  it('is a thin client over electronAPI.automations and the core rules engine', () => {
    const panel = fs.readFileSync(panelPath, 'utf8');
    expect(panel).toContain('window.electronAPI?.automations');
    expect(panel).toContain('buddy rules add');
    expect(panel).toContain('Derniers déclenchements');
    expect(panel).not.toContain('writeFile');
  });

  it('is mounted from Settings as the Automations tab', () => {
    const settings = fs.readFileSync(settingsPath, 'utf8');
    expect(settings).toContain('import { SettingsAutomations }');
    expect(settings).toContain("id: 'automations'");
    expect(settings).toContain('<SettingsAutomations');
  });

  it('IPC delegates to the same core modules as buddy rules / buddy remind', () => {
    const ipc = fs.readFileSync(ipcPath, 'utf8');
    expect(ipc).toContain("loadCoreModule<RulesMod>('sensory/sensory-rules-engine.js')");
    expect(ipc).toContain("loadCoreModule<RemindersMod>('companion/reminders.js')");
    expect(ipc).toContain("ipcMain.handle('automations.list'");
    expect(ipc).toContain("ipcMain.handle('automations.toggle'");
    expect(ipc).toContain("ipcMain.handle('automations.remove'");
  });

  it('preload and main wire the automations bridge', () => {
    const preload = fs.readFileSync(preloadPath, 'utf8');
    const main = fs.readFileSync(mainPath, 'utf8');
    expect(preload).toContain('automations.list');
    expect(preload).toContain('automations.toggle');
    expect(main).toContain('registerAutomationsIpcHandlers');
  });
});
