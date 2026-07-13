/**
 * Interactive confirmation bridge — the dead link that made every embedded
 * (Cowork) confirmation fail closed with « requires an interactive terminal ».
 * Real ConfirmationService + real DesktopPermissionBridge; only the renderer
 * IPC hop is simulated by calling handleResponse like Cowork's main does.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { DesktopPermissionBridge } from '../../src/desktop/permission-bridge.js';
import type { EnginePermissionRequest } from '../../src/shared/engine-types.js';

const originalIsTTY = process.stdin.isTTY;

function freshService(): ConfirmationService {
  (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
  return ConfirmationService.getInstance();
}

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  delete process.env.CODEBUDDY_AUTO_CONFIRM;
  (ConfirmationService as unknown as { instance?: ConfirmationService }).instance = undefined;
});

describe('ConfirmationService.setInteractiveBridge', () => {
  it('routes non-TTY confirmations through the bridge instead of failing closed', async () => {
    const service = freshService();
    service.setInteractiveBridge(async () => ({ confirmed: true }));
    const result = await service.requestConfirmation(
      { operation: 'write_file', filename: '/tmp/x.txt' },
      'file',
    );
    expect(result.confirmed).toBe(true);
    service.dispose();
  });

  it('carries the denial reason back as feedback (Hermes /deny parity)', async () => {
    const service = freshService();
    service.setInteractiveBridge(async () => ({ confirmed: false, feedback: 'pas ce fichier, utilise config/' }));
    const result = await service.requestConfirmation(
      { operation: 'write_file', filename: '/tmp/x.txt' },
      'file',
    );
    expect(result).toMatchObject({ confirmed: false, feedback: 'pas ce fichier, utilise config/' });
    service.dispose();
  });

  it('without a bridge, non-TTY still fails closed (unchanged default)', async () => {
    const service = freshService();
    const result = await service.requestConfirmation(
      { operation: 'write_file', filename: '/tmp/x.txt' },
      'file',
    );
    expect(result.confirmed).toBe(false);
    expect(result.feedback).toContain('interactive terminal');
    service.dispose();
  });

  it('dontAskAgain from the bridge sets the session flag', async () => {
    const service = freshService();
    service.setInteractiveBridge(async () => ({ confirmed: true, dontAskAgain: true }));
    await service.requestConfirmation({ operation: 'bash', filename: 'ls' }, 'bash');
    // Next request short-circuits on the session flag without calling the bridge.
    let bridgeCalls = 0;
    service.setInteractiveBridge(async () => {
      bridgeCalls++;
      return { confirmed: true };
    });
    const second = await service.requestConfirmation({ operation: 'bash', filename: 'pwd' }, 'bash');
    expect(second.confirmed).toBe(true);
    expect(bridgeCalls).toBe(0);
    service.dispose();
  });

  it('forcePrompt bypasses auto-confirm and session flags for externally visible effects', async () => {
    const service = freshService();
    process.env.CODEBUDDY_AUTO_CONFIRM = 'true';
    service.setSessionFlag('allOperations', true);
    let bridgeCalls = 0;
    service.setInteractiveBridge(async () => {
      bridgeCalls++;
      return { confirmed: false, feedback: 'interaction refusée' };
    });

    const result = await service.requestConfirmation({
      operation: 'browser_write',
      filename: 'click',
      content: 'Cliquer sur le bouton relu',
      forcePrompt: true,
    });

    expect(result).toMatchObject({ confirmed: false, feedback: 'interaction refusée' });
    expect(bridgeCalls).toBe(1);
    service.dispose();
    delete process.env.CODEBUDDY_AUTO_CONFIRM;
  });
});

describe('DesktopPermissionBridge detailed responses', () => {
  const request: EnginePermissionRequest = { id: 'req-1', operation: 'write_file', filename: '/tmp/y.txt' };

  it('round-trips the denial reason from handleResponse', async () => {
    const bridge = new DesktopPermissionBridge(() => {});
    const pending = bridge.requestPermissionDetailed(request);
    bridge.handleResponse('req-1', 'deny', 'mauvais dossier');
    await expect(pending).resolves.toEqual({ response: 'deny', reason: 'mauvais dossier' });
  });

  it('legacy requestPermission still returns the bare response', async () => {
    const bridge = new DesktopPermissionBridge(() => {});
    const pending = bridge.requestPermission({ ...request, id: 'req-2' });
    bridge.handleResponse('req-2', 'allow');
    await expect(pending).resolves.toBe('allow');
  });
});
