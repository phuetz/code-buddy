import { describe, expect, it } from 'vitest';
import { fleetListenFailureHint } from '../../src/commands/handlers/fleet-handler.js';

describe('fleetListenFailureHint', () => {
  it('points to /ws when the URL has no WebSocket path', () => {
    const hint = fleetListenFailureHint('ws://127.0.0.1:3000', 'Unexpected server response: 404');
    expect(hint).toContain('/fleet listen ws://127.0.0.1:3000/ws --jwt <token>');
  });

  it('explains the shared JWT_SECRET on AUTH_FAILED', () => {
    const hint = fleetListenFailureHint('ws://127.0.0.1:3000/ws', 'Invalid credentials');
    expect(hint).not.toContain('endpoint is /ws');
    expect(hint).toContain('buddy fleet token');
    expect(hint).toContain('JWT_SECRET');
    expect(hint).toContain('fleet:listen,peer:invoke');
  });

  it('stays silent when neither trap applies', () => {
    expect(fleetListenFailureHint('ws://127.0.0.1:3000/ws', 'connect ECONNREFUSED')).toBe('');
  });
});
