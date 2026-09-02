import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
  enableSessionFleetBridge,
  registerSessionFleetBroadcaster,
} from '../../src/agent/multi-agent/session-fleet-bridge.js';
import type { SessionRegistry } from '../../src/agent/multi-agent/session-registry.js';

const broadcastFleetEventMock = vi.fn();
registerSessionFleetBroadcaster(broadcastFleetEventMock);

function makeFakeRegistry(): SessionRegistry {
  return new EventEmitter() as unknown as SessionRegistry;
}

describe('Revue G6 - Trou 2 : Session pair qui fuit le prompt confidentiel', () => {
  beforeEach(() => {
    broadcastFleetEventMock.mockReset();
    process.env.CODEBUDDY_FLEET_STREAM = '1';
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  it('doit masquer les secrets et ne pas diffuser le prompt confidentiel en clair via fleet:session:message', () => {
    const reg = makeFakeRegistry();
    const handle = enableSessionFleetBridge(reg);

    const secretPrompt = 'Consigne confidentielle: clé API sk-ant-api03-secret1234567890 pour accès base client';
    reg.emit('session:message', 'session-victim', {
      sessionId: 'session-victim',
      role: 'user',
      content: secretPrompt,
    });

    expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
    const [type, payload] = broadcastFleetEventMock.mock.calls[0];
    expect(type).toBe('fleet:session:message');

    const preview = (payload as { contentPreview: string }).contentPreview;

    // VULNÉRABILITÉ : session-fleet-bridge transmet message.content.slice(0, 200) brut
    // sans appel à redactSecrets() ni filtrage privacyLint.
    // Tout auditeur recevant l'événement WebSocket lit le prompt confidentiel en clair !
    expect(preview).not.toContain('sk-ant-api03-secret1234567890');
    expect(preview).toContain('[REDACTED');

    handle.disable();
  });
});
