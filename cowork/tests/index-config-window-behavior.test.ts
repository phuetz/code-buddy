import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');
const windowManagementPath = path.resolve(process.cwd(), 'src/main/window-management.ts');

describe('Main process window/config behavior', () => {
  it('second-instance path focuses existing window and only recreates when none found', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const secondInstanceBlock = source.match(/app\.on\('second-instance'[\s\S]*?\n {2}}\);\n}/)?.[0] || '';

    expect(secondInstanceBlock).toContain('BrowserWindow.getAllWindows()');
    expect(secondInstanceBlock).toContain('focused existing window');
    // createWindow is allowed as a fallback when no existing window is found
    expect(secondInstanceBlock).toContain('No existing window found');
  });

  it('session.start blocked by active set emits structured error without forcing config.status', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const sessionStartGuard = source.match(/if \(event\.type === 'session\.start'[\s\S]*?return null;\n {2}}/)?.[0] || '';
    const configErrorHelper =
      source.match(/function sendActiveSetConfigRequiredError[\s\S]*?\n}\n\nasync function handleClientEvent/)?.[0] ||
      '';

    expect(sessionStartGuard).toContain('hasUsableCredentialsForActiveSet');
    expect(sessionStartGuard).toContain('sendActiveSetConfigRequiredError');
    expect(configErrorHelper).toContain("code: 'CONFIG_REQUIRED_ACTIVE_SET'");
    expect(configErrorHelper).toContain("action: 'open_api_settings'");
    expect(configErrorHelper).not.toContain("type: 'config.status'");
  });

  it('session.continue blocked by active set includes session id for renderer cleanup', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const continueGuard = source.match(/if \(event\.type === 'session\.continue'[\s\S]*?return null;\n {2}}/)?.[0] || '';

    expect(continueGuard).toContain('hasUsableCredentialsForActiveSet');
    expect(continueGuard).toContain('sendActiveSetConfigRequiredError(event.payload.sessionId)');
  });

  it('only exposes redacted provider config to the renderer', () => {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    const windowSource = fs.readFileSync(windowManagementPath, 'utf8');

    expect(indexSource).toContain("ipcMain.handle('config.get'");
    expect(indexSource).toContain('return configStore.getAllRedacted();');
    expect(indexSource).not.toContain('config: configStore.getAll(),');
    expect(windowSource).not.toContain('config: configStore.getAll(),');
    expect(windowSource).toContain('config: configStore.getAllRedacted(),');
  });
});
